import { stableCompare, stableHash } from '../random';
import type { LegacyArchiveBoundary, SimulationFact } from '../facts';
import type { HistoryEvent } from '../types';
import { decodeArchiveBlock } from './codec';
import { buildArchiveHistorySummary, compareRecordIds, createArchiveBlock } from './metadata';
import { collectReferencedFactIds, isPermanentlyPinnedEvent } from './pins';
import type {
  ArchiveWorldState,
  WorldArchiveBlock,
  WorldArchiveSystemState,
} from './types';
import {
  WORLD_ARCHIVE_CHUNK_TURNS,
  WORLD_ARCHIVE_HOT_TURNS,
  WORLD_ARCHIVE_VERSION,
} from './types';

function setArchiveSystem(
  world: ArchiveWorldState,
  archiveSystem: WorldArchiveSystemState,
): WorldArchiveSystemState {
  world.archiveSystem = archiveSystem;
  return archiveSystem;
}

export function createWorldArchiveState(
  boundary: LegacyArchiveBoundary | null = null,
): WorldArchiveSystemState {
  const archiveStartTurn = boundary?.turn ?? 0;
  return {
    version: WORLD_ARCHIVE_VERSION,
    chunkTurns: WORLD_ARCHIVE_CHUNK_TURNS,
    hotTurns: WORLD_ARCHIVE_HOT_TURNS,
    archiveStartTurn,
    archivedThroughTurn: archiveStartTurn - 1,
    factBaseCount: 0,
    factBaseDigest: stableHash([]),
    historyBaseCount: boundary?.historyEventCount ?? 0,
    historyBaseDigest: boundary?.historyDigest ?? '',
    archivedFactCount: 0,
    archivedHistoryCount: 0,
    archivedFactDigest: stableHash([]),
    archivedHistoryDigest: boundary?.historyDigest ?? '',
    pinnedFactIds: [],
    pinnedEventIds: [],
    digestCheckpoints: [],
    blocks: [],
  };
}

/** Adds missing v1 residency fields but refuses to reinterpret another layout. */
export function normalizeWorldArchiveState(world: ArchiveWorldState): WorldArchiveSystemState {
  const existing = world.archiveSystem;
  if (!existing) return setArchiveSystem(world, createWorldArchiveState(world.legacyArchiveBoundary));
  if (existing.version !== WORLD_ARCHIVE_VERSION) {
    throw new Error(`unsupported world archive version ${String(existing.version)}`);
  }
  if (existing.chunkTurns !== WORLD_ARCHIVE_CHUNK_TURNS
    || existing.hotTurns !== WORLD_ARCHIVE_HOT_TURNS) {
    throw new Error('world archive retention constants do not match this build');
  }
  existing.pinnedFactIds ??= [];
  existing.pinnedEventIds ??= [];
  existing.digestCheckpoints ??= [];
  existing.blocks ??= [];
  existing.blocks = existing.blocks.map((block) => block.historySummary
    ? block
    : {
        ...block,
        historySummary: buildArchiveHistorySummary(decodeArchiveBlock(block).history),
      });
  return existing;
}

/** Clone mutable residency containers while sharing immutable compressed blocks. */
export function cloneWorldArchiveState(
  archive: WorldArchiveSystemState,
): WorldArchiveSystemState {
  return {
    ...archive,
    pinnedFactIds: [...archive.pinnedFactIds],
    pinnedEventIds: [...archive.pinnedEventIds],
    digestCheckpoints: archive.digestCheckpoints.map((checkpoint) => ({ ...checkpoint })),
    blocks: [...archive.blocks],
  };
}

function recordIsAtOrBefore(record: { turn: number }, throughTurn: number): boolean {
  return record.turn <= throughTurn;
}

function legacyHistoryPrefix(world: ArchiveWorldState): HistoryEvent[] {
  const legacyCount = world.legacyArchiveBoundary?.historyEventCount ?? 0;
  return legacyCount > 0 ? world.history.slice(0, legacyCount) : [];
}

function appendUnique<T extends { id: string }>(
  target: T[],
  seen: Set<string>,
  records: readonly T[],
): void {
  for (const record of records) {
    if (seen.has(record.id)) continue;
    seen.add(record.id);
    target.push(record);
  }
}

function sortedBlocks(archive: WorldArchiveSystemState): WorldArchiveBlock[] {
  return archive.blocks.slice().sort((left, right) => (
    left.fromTurn - right.fromTurn || stableCompare(left.id, right.id)
  ));
}

/** Returns the entire authoritative Fact chain, deduplicating active cold pins. */
export function readWorldFacts(world: ArchiveWorldState): SimulationFact[] {
  const archive = world.archiveSystem;
  if (!archive || archive.blocks.length === 0) return [...world.facts];
  const result: SimulationFact[] = [];
  const seen = new Set<string>();
  for (const block of sortedBlocks(archive)) {
    appendUnique(result, seen, decodeArchiveBlock(block).facts);
  }
  appendUnique(result, seen, world.facts);
  return result;
}

/** Returns legacy Chronicle, exact cold records and the active hot suffix in chain order. */
export function readWorldHistory(world: ArchiveWorldState): HistoryEvent[] {
  const archive = world.archiveSystem;
  if (!archive || archive.blocks.length === 0) return [...world.history];
  const result: HistoryEvent[] = [];
  const seen = new Set<string>();
  const legacyCount = world.legacyArchiveBoundary?.historyEventCount ?? 0;
  appendUnique(result, seen, world.history.slice(0, legacyCount));
  for (const block of sortedBlocks(archive)) {
    appendUnique(result, seen, decodeArchiveBlock(block).history);
  }
  appendUnique(result, seen, world.history.slice(legacyCount));
  return result;
}

function binaryFindActive<T extends { id: string }>(records: readonly T[], id: string): T | undefined {
  let low = 0;
  let high = records.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const record = records[middle] as T;
    const comparison = compareRecordIds(record.id, id);
    if (comparison === 0) return record;
    if (comparison < 0) low = middle + 1;
    else high = middle - 1;
  }
  return undefined;
}

/** Active-only getters are safe for quarterly validation and never decompress. */
export function findActiveWorldFact(
  world: Pick<ArchiveWorldState, 'facts'>,
  factId: string,
): SimulationFact | undefined {
  return binaryFindActive(world.facts, factId);
}

export function findActiveWorldEvent(
  world: Pick<ArchiveWorldState, 'history'>,
  eventId: string,
): HistoryEvent | undefined {
  return binaryFindActive(world.history, eventId);
}

function blockCouldContainId(
  id: string,
  firstId: string | null,
  lastId: string | null,
): boolean {
  return firstId !== null
    && lastId !== null
    && compareRecordIds(firstId, id) <= 0
    && compareRecordIds(id, lastId) <= 0;
}

export function findWorldFact(
  world: ArchiveWorldState,
  factId: string,
): SimulationFact | undefined {
  const active = findActiveWorldFact(world, factId);
  if (active) return active;
  for (const block of world.archiveSystem?.blocks ?? []) {
    if (!blockCouldContainId(factId, block.firstFactId, block.lastFactId)) continue;
    const found = binaryFindActive(decodeArchiveBlock(block).facts, factId);
    if (found) return found;
  }
  return undefined;
}

export function findWorldEvent(
  world: ArchiveWorldState,
  eventId: string,
): HistoryEvent | undefined {
  const active = findActiveWorldEvent(world, eventId);
  if (active) return active;
  for (const block of world.archiveSystem?.blocks ?? []) {
    if (!blockCouldContainId(eventId, block.firstEventId, block.lastEventId)) continue;
    const found = binaryFindActive(decodeArchiveBlock(block).history, eventId);
    if (found) return found;
  }
  return undefined;
}

export const findWorldHistoryEvent = findWorldEvent;

function createEligibleBlocks(
  world: ArchiveWorldState,
  archive: WorldArchiveSystemState,
  allFacts: readonly SimulationFact[],
  allHistory: readonly HistoryEvent[],
): void {
  const eligibleThroughTurn = world.turn - WORLD_ARCHIVE_HOT_TURNS - 1;
  let fromTurn = archive.archivedThroughTurn + 1;
  const legacyCount = world.legacyArchiveBoundary?.historyEventCount ?? 0;
  const schema4History = allHistory.slice(legacyCount);
  while (fromTurn + WORLD_ARCHIVE_CHUNK_TURNS - 1 <= eligibleThroughTurn) {
    const throughTurn = fromTurn + WORLD_ARCHIVE_CHUNK_TURNS - 1;
    const facts = allFacts.filter((fact) => fact.turn >= fromTurn && fact.turn <= throughTurn);
    const history = schema4History.filter((event) => event.turn >= fromTurn && event.turn <= throughTurn);
    const block = createArchiveBlock({
      fromTurn,
      throughTurn,
      facts,
      history,
      beforeFactCount: archive.factBaseCount + archive.archivedFactCount,
      beforeHistoryCount: archive.historyBaseCount + archive.archivedHistoryCount,
      beforeFactDigest: archive.archivedFactDigest,
      beforeHistoryDigest: archive.archivedHistoryDigest,
      digestCheckpoint: archive.digestCheckpoints.find(
        (checkpoint) => checkpoint.throughTurn === throughTurn,
      ),
    });
    archive.blocks.push(block);
    archive.archivedThroughTurn = throughTurn;
    archive.archivedFactCount += block.factCount;
    archive.archivedHistoryCount += block.historyCount;
    archive.archivedFactDigest = block.afterFactDigest;
    archive.archivedHistoryDigest = block.afterHistoryDigest;
    fromTurn = throughTurn + 1;
  }
  const maximumPendingCheckpoints = Math.ceil(
    WORLD_ARCHIVE_HOT_TURNS / WORLD_ARCHIVE_CHUNK_TURNS,
  );
  archive.digestCheckpoints = archive.digestCheckpoints
    .filter((checkpoint) => checkpoint.throughTurn > archive.archivedThroughTurn)
    .slice(-maximumPendingCheckpoints);
}

function captureDigestCheckpoint(
  world: ArchiveWorldState,
  archive: WorldArchiveSystemState,
): void {
  const completedTurns = world.turn - archive.archiveStartTurn;
  if (completedTurns <= 0 || completedTurns % WORLD_ARCHIVE_CHUNK_TURNS !== 0) return;
  const checkpoint = {
    throughTurn: world.turn - 1,
    factCount: world.counters.fact,
    factDigest: world.factDigest,
    historyCount: world.counters.event,
    historyDigest: world.historyDigest,
  };
  archive.digestCheckpoints = archive.digestCheckpoints
    .filter((entry) => entry.throughTurn !== checkpoint.throughTurn)
    .concat(checkpoint)
    .sort((left, right) => left.throughTurn - right.throughTurn);
}

function retainActiveFacts(
  world: ArchiveWorldState,
  archive: WorldArchiveSystemState,
  activeFacts: readonly SimulationFact[],
): void {
  const requestedPins = collectReferencedFactIds(world);
  const activeFactById = new Map(activeFacts.map((fact) => [fact.id, fact]));
  const resolvedPins = new Map<string, SimulationFact>();
  const pending = [...requestedPins];
  while (pending.length > 0) {
    const factId = pending.pop() as string;
    if (resolvedPins.has(factId)) continue;
    const fact = activeFactById.get(factId);
    if (!fact) continue;
    resolvedPins.set(factId, fact);
    for (const sourceFactId of fact.sourceFactIds) pending.push(sourceFactId);
  }
  const coldPins = [...resolvedPins.values()]
    .filter((fact) => recordIsAtOrBefore(fact, archive.archivedThroughTurn))
    .sort((left, right) => compareRecordIds(left.id, right.id));
  const hotSuffix = activeFacts.filter((fact) => fact.turn > archive.archivedThroughTurn);
  archive.pinnedFactIds = coldPins.map((fact) => fact.id);
  world.facts = [...coldPins, ...hotSuffix];
}

function retainActiveHistory(
  world: ArchiveWorldState,
  archive: WorldArchiveSystemState,
  allHistory: readonly HistoryEvent[],
): void {
  const legacyCount = world.legacyArchiveBoundary?.historyEventCount ?? 0;
  const legacyPrefix = allHistory.slice(0, legacyCount);
  const schema4History = allHistory.slice(legacyCount);
  const coldPins = schema4History.filter((event) => (
    recordIsAtOrBefore(event, archive.archivedThroughTurn) && isPermanentlyPinnedEvent(event)
  ));
  const hotSuffix = schema4History.filter((event) => event.turn > archive.archivedThroughTurn);
  archive.pinnedEventIds = coldPins.map((event) => event.id);
  world.history = [...legacyPrefix, ...coldPins, ...hotSuffix];
}

/**
 * Compacts all complete sixteen-turn intervals older than the sixty-four-turn
 * hot window. It mutates residency only and returns the same world object.
 */
export function compactWorldArchive<T extends ArchiveWorldState>(
  world: T,
): T & { archiveSystem: WorldArchiveSystemState } {
  const archive = normalizeWorldArchiveState(world);
  const activeFacts = [...world.facts];
  const activeHistory = [...world.history];
  captureDigestCheckpoint(world, archive);
  createEligibleBlocks(world, archive, activeFacts, activeHistory);
  retainActiveFacts(world, archive, activeFacts);
  retainActiveHistory(world, archive, activeHistory);
  return world as T & { archiveSystem: WorldArchiveSystemState };
}

export function activeWorldArchivePins(world: ArchiveWorldState): {
  facts: readonly SimulationFact[];
  history: readonly HistoryEvent[];
} {
  const archive = world.archiveSystem;
  if (!archive) return { facts: [], history: [] };
  return {
    facts: archive.pinnedFactIds
      .map((id) => findActiveWorldFact(world, id))
      .filter((fact): fact is SimulationFact => fact !== undefined),
    history: archive.pinnedEventIds
      .map((id) => findActiveWorldEvent(world, id))
      .filter((event): event is HistoryEvent => event !== undefined),
  };
}

export function getLegacyActiveHistoryPrefix(world: ArchiveWorldState): readonly HistoryEvent[] {
  return legacyHistoryPrefix(world);
}
