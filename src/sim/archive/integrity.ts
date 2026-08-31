import { stableHash, stableStringify } from '../random';
import type { SimulationFact } from '../facts';
import type { HistoryEvent } from '../types';
import { readWorldFacts, readWorldHistory } from './archive';
import { decodeArchiveBlock } from './codec';
import {
  buildArchiveHistorySummary,
  buildArchiveIndexes,
  buildImportantEventPreviews,
  buildTerritoryDeltas,
  compareRecordIds,
  extendFactDigest,
  extendHistoryDigest,
} from './metadata';
import {
  collectLegacyPinnedFactIds,
  collectPinnedFactIds,
  isPermanentlyPinnedEvent,
} from './pins';
import type {
  ArchiveDigestCheckpoint,
  ArchiveIntegrityIssue,
  ArchiveWorldState,
  WorldArchiveBlockPayload,
  WorldArchiveSystemState,
} from './types';
import {
  WORLD_ARCHIVE_CHUNK_TURNS,
  WORLD_ARCHIVE_HOT_TURNS,
  WORLD_ARCHIVE_VERSION,
} from './types';

function addIssue(
  issues: ArchiveIntegrityIssue[],
  code: string,
  message: string,
  options?: { blockId?: string; recordId?: string },
): void {
  issues.push({ code, message, ...options });
}

function ids(records: readonly { id: string }[]): string[] {
  return records.map((record) => record.id);
}

function equalValues(left: unknown, right: unknown): boolean {
  return stableStringify(left) === stableStringify(right);
}

function validateRecordOrder(
  records: readonly { id: string; turn: number }[],
  label: string,
  blockId: string,
  issues: ArchiveIntegrityIssue[],
): void {
  let previousTurn = -1;
  let previousId = '';
  for (const record of records) {
    if (record.turn < previousTurn
      || (record.turn === previousTurn && compareRecordIds(record.id, previousId) <= 0)) {
      addIssue(issues, 'archive.block.record-order', `${label} records are not in source order`, {
        blockId,
        recordId: record.id,
      });
      return;
    }
    previousTurn = record.turn;
    previousId = record.id;
  }
}

function validatePayloadRange(
  payload: WorldArchiveBlockPayload,
  fromTurn: number,
  throughTurn: number,
  blockId: string,
  issues: ArchiveIntegrityIssue[],
): void {
  for (const record of [...payload.facts, ...payload.history]) {
    if (!Number.isSafeInteger(record.turn) || record.turn < fromTurn || record.turn > throughTurn) {
      addIssue(issues, 'archive.block.record-turn', `${record.id} is outside its archive turn range`, {
        blockId,
        recordId: record.id,
      });
    }
  }
  validateRecordOrder(payload.facts, 'Fact', blockId, issues);
  validateRecordOrder(payload.history, 'Chronicle', blockId, issues);
}

function expectedFullFactDigest(facts: readonly SimulationFact[]): string {
  let digest = stableHash([]);
  for (const fact of facts) digest = extendFactDigest(digest, fact);
  return digest;
}

function expectedFullHistoryDigest(
  world: ArchiveWorldState,
  history: readonly HistoryEvent[],
): string {
  const boundary = world.legacyArchiveBoundary;
  const legacyCount = boundary?.historyEventCount ?? 0;
  let digest = boundary?.historyDigest ?? '';
  let count = legacyCount;
  for (const event of history.slice(legacyCount)) {
    digest = extendHistoryDigest(digest, count, event);
    count += 1;
  }
  return digest;
}

function expectedActiveFacts(
  world: ArchiveWorldState,
  facts: readonly SimulationFact[],
  archivedThroughTurn: number,
  pinSet = collectPinnedFactIds(world, facts),
): { records: SimulationFact[]; pinnedIds: string[] } {
  const pins = facts.filter((fact) => fact.turn <= archivedThroughTurn && pinSet.has(fact.id));
  return {
    records: [...pins, ...facts.filter((fact) => fact.turn > archivedThroughTurn)],
    pinnedIds: ids(pins),
  };
}

function expectedActiveHistory(
  world: ArchiveWorldState,
  history: readonly HistoryEvent[],
  archivedThroughTurn: number,
): { records: HistoryEvent[]; pinnedIds: string[] } {
  const legacyCount = world.legacyArchiveBoundary?.historyEventCount ?? 0;
  const prefix = history.slice(0, legacyCount);
  const schema4 = history.slice(legacyCount);
  const pins = schema4.filter((event) => (
    event.turn <= archivedThroughTurn && isPermanentlyPinnedEvent(event)
  ));
  return {
    records: [...prefix, ...pins, ...schema4.filter((event) => event.turn > archivedThroughTurn)],
    pinnedIds: ids(pins),
  };
}

function validateDigestCheckpoints(
  world: ArchiveWorldState,
  archive: WorldArchiveSystemState,
  chainTail: {
    factCount: number;
    factDigest: string;
    historyCount: number;
    historyDigest: string;
  },
  issues: ArchiveIntegrityIssue[],
): void {
  const rawCheckpoints = (archive as unknown as {
    digestCheckpoints?: unknown;
  }).digestCheckpoints;
  // Development saves written before checkpoints existed remain readable and
  // are initialized by normalizeWorldArchiveState after authentication.
  if (rawCheckpoints === undefined) return;
  if (!Array.isArray(rawCheckpoints)) {
    addIssue(issues, 'archive.checkpoint.layout', 'archive digest checkpoints are not an array');
    return;
  }
  const maximumCheckpoints = Math.ceil(WORLD_ARCHIVE_HOT_TURNS / WORLD_ARCHIVE_CHUNK_TURNS);
  if (rawCheckpoints.length > maximumCheckpoints) {
    addIssue(issues, 'archive.checkpoint.layout', 'archive retains too many pending digest checkpoints');
  }

  const checkpoints: ArchiveDigestCheckpoint[] = [];
  const seenTurns = new Set<number>();
  let previousTurn = archive.archivedThroughTurn;
  let layoutValid = rawCheckpoints.length <= maximumCheckpoints;
  for (const rawCheckpoint of rawCheckpoints) {
    if (!rawCheckpoint || typeof rawCheckpoint !== 'object') {
      addIssue(issues, 'archive.checkpoint.layout', 'archive digest checkpoint is not an object');
      layoutValid = false;
      continue;
    }
    const checkpoint = rawCheckpoint as ArchiveDigestCheckpoint;
    const aligned = Number.isSafeInteger(checkpoint.throughTurn)
      && (checkpoint.throughTurn + 1 - archive.archiveStartTurn)
        % WORLD_ARCHIVE_CHUNK_TURNS === 0;
    const inRange = checkpoint.throughTurn > archive.archivedThroughTurn
      && checkpoint.throughTurn <= world.turn - 1;
    const ordered = checkpoint.throughTurn > previousTurn;
    const duplicate = seenTurns.has(checkpoint.throughTurn);
    const countersValid = Number.isSafeInteger(checkpoint.factCount)
      && checkpoint.factCount >= chainTail.factCount
      && Number.isSafeInteger(checkpoint.historyCount)
      && checkpoint.historyCount >= chainTail.historyCount;
    const digestsValid = typeof checkpoint.factDigest === 'string'
      && typeof checkpoint.historyDigest === 'string';
    if (!aligned || !inRange || !ordered || duplicate || !countersValid || !digestsValid) {
      addIssue(
        issues,
        'archive.checkpoint.layout',
        'archive digest checkpoint is duplicated, out of range, misaligned or malformed',
      );
      layoutValid = false;
    }
    seenTurns.add(checkpoint.throughTurn);
    previousTurn = checkpoint.throughTurn;
    checkpoints.push(checkpoint);
  }
  if (!layoutValid) return;

  const hotFacts = world.facts.filter((fact) => fact.turn > archive.archivedThroughTurn);
  const hotHistory = world.history.filter((event) => event.turn > archive.archivedThroughTurn);
  let factIndex = 0;
  let factCount = chainTail.factCount;
  let factDigest = chainTail.factDigest;
  let historyIndex = 0;
  let historyCount = chainTail.historyCount;
  let historyDigest = chainTail.historyDigest;
  for (const checkpoint of checkpoints) {
    while (factIndex < hotFacts.length
      && (hotFacts[factIndex] as SimulationFact).turn <= checkpoint.throughTurn) {
      factDigest = extendFactDigest(factDigest, hotFacts[factIndex] as SimulationFact);
      factCount += 1;
      factIndex += 1;
    }
    while (historyIndex < hotHistory.length
      && (hotHistory[historyIndex] as HistoryEvent).turn <= checkpoint.throughTurn) {
      historyDigest = extendHistoryDigest(
        historyDigest,
        historyCount,
        hotHistory[historyIndex] as HistoryEvent,
      );
      historyCount += 1;
      historyIndex += 1;
    }
    if (checkpoint.factCount !== factCount
      || checkpoint.factDigest !== factDigest
      || checkpoint.historyCount !== historyCount
      || checkpoint.historyDigest !== historyDigest) {
      addIssue(
        issues,
        'archive.checkpoint.digest',
        `archive digest checkpoint through turn ${checkpoint.throughTurn} does not match its chain`,
      );
    }
  }
}

/**
 * Exhaustive save/import validator. Runtime validation should instead use the
 * active-only getters and the already authenticated chain tails.
 */
export function validateWorldArchiveIntegrity(world: ArchiveWorldState): ArchiveIntegrityIssue[] {
  const issues: ArchiveIntegrityIssue[] = [];
  const archive = world.archiveSystem;
  if (!archive) return issues;
  if (archive.version !== WORLD_ARCHIVE_VERSION) {
    addIssue(issues, 'archive.version', `unsupported archive version ${String(archive.version)}`);
    return issues;
  }
  if (archive.chunkTurns !== WORLD_ARCHIVE_CHUNK_TURNS
    || archive.hotTurns !== WORLD_ARCHIVE_HOT_TURNS) {
    addIssue(issues, 'archive.retention', 'archive retention constants do not match this build');
  }
  const boundary = world.legacyArchiveBoundary;
  const expectedStartTurn = boundary?.turn ?? 0;
  const expectedHistoryBaseCount = boundary?.historyEventCount ?? 0;
  const expectedHistoryBaseDigest = boundary?.historyDigest ?? '';
  if (archive.archiveStartTurn !== expectedStartTurn
    || archive.factBaseCount !== 0
    || archive.factBaseDigest !== stableHash([])
    || archive.historyBaseCount !== expectedHistoryBaseCount
    || archive.historyBaseDigest !== expectedHistoryBaseDigest) {
    addIssue(issues, 'archive.base', 'archive base does not match the schema-4 legacy boundary');
  }

  let expectedFromTurn = archive.archiveStartTurn;
  let factCount = archive.factBaseCount;
  let historyCount = archive.historyBaseCount;
  let factDigest = archive.factBaseDigest;
  let historyDigest = archive.historyBaseDigest;
  const factIds = new Set<string>();
  const eventIds = new Set<string>();
  const legacyIds = new Set(world.history.slice(0, expectedHistoryBaseCount).map((event) => event.id));
  let allBlocksDecoded = true;

  for (const block of archive.blocks) {
    if (block.version !== WORLD_ARCHIVE_VERSION
      || block.fromTurn !== expectedFromTurn
      || block.throughTurn !== block.fromTurn + WORLD_ARCHIVE_CHUNK_TURNS - 1) {
      addIssue(issues, 'archive.block.range', 'archive blocks are not contiguous sixteen-turn intervals', {
        blockId: block.id,
      });
    }
    let payload: WorldArchiveBlockPayload;
    try {
      payload = decodeArchiveBlock(block);
    } catch (error) {
      allBlocksDecoded = false;
      addIssue(
        issues,
        'archive.block.decode',
        error instanceof Error ? error.message : 'archive block could not be decoded',
        { blockId: block.id },
      );
      expectedFromTurn = block.throughTurn + 1;
      continue;
    }
    validatePayloadRange(payload, block.fromTurn, block.throughTurn, block.id, issues);
    for (const fact of payload.facts) {
      if (factIds.has(fact.id)) {
        addIssue(issues, 'archive.fact.duplicate', `${fact.id} appears in more than one cold block`, {
          blockId: block.id,
          recordId: fact.id,
        });
      }
      factIds.add(fact.id);
    }
    for (const event of payload.history) {
      if (eventIds.has(event.id)) {
        addIssue(issues, 'archive.event.duplicate', `${event.id} appears in more than one cold block`, {
          blockId: block.id,
          recordId: event.id,
        });
      }
      if (legacyIds.has(event.id)) {
        addIssue(issues, 'archive.event.legacy', `${event.id} belongs to the permanent legacy prefix`, {
          blockId: block.id,
          recordId: event.id,
        });
      }
      eventIds.add(event.id);
    }
    let afterFactDigest = factDigest;
    for (const fact of payload.facts) afterFactDigest = extendFactDigest(afterFactDigest, fact);
    let afterHistoryDigest = historyDigest;
    let afterHistoryCount = historyCount;
    for (const event of payload.history) {
      afterHistoryDigest = extendHistoryDigest(afterHistoryDigest, afterHistoryCount, event);
      afterHistoryCount += 1;
    }
    const expectedMetadata = {
      version: WORLD_ARCHIVE_VERSION,
      id: `archive_${String(block.fromTurn).padStart(7, '0')}_${String(block.throughTurn).padStart(7, '0')}_${block.payloadDigest}`,
      fromTurn: block.fromTurn,
      throughTurn: block.throughTurn,
      factCount: payload.facts.length,
      historyCount: payload.history.length,
      firstFactId: payload.facts[0]?.id ?? null,
      lastFactId: payload.facts.at(-1)?.id ?? null,
      firstEventId: payload.history[0]?.id ?? null,
      lastEventId: payload.history.at(-1)?.id ?? null,
      beforeFactCount: factCount,
      afterFactCount: factCount + payload.facts.length,
      beforeHistoryCount: historyCount,
      afterHistoryCount,
      beforeFactDigest: factDigest,
      afterFactDigest,
      beforeHistoryDigest: historyDigest,
      afterHistoryDigest,
      indexes: buildArchiveIndexes(payload),
      historySummary: buildArchiveHistorySummary(payload.history),
      territoryDeltas: buildTerritoryDeltas(payload.facts),
      importantEventPreviews: buildImportantEventPreviews(payload.history),
    };
    const actualMetadata = {
      version: block.version,
      id: block.id,
      fromTurn: block.fromTurn,
      throughTurn: block.throughTurn,
      factCount: block.factCount,
      historyCount: block.historyCount,
      firstFactId: block.firstFactId,
      lastFactId: block.lastFactId,
      firstEventId: block.firstEventId,
      lastEventId: block.lastEventId,
      beforeFactCount: block.beforeFactCount,
      afterFactCount: block.afterFactCount,
      beforeHistoryCount: block.beforeHistoryCount,
      afterHistoryCount: block.afterHistoryCount,
      beforeFactDigest: block.beforeFactDigest,
      afterFactDigest: block.afterFactDigest,
      beforeHistoryDigest: block.beforeHistoryDigest,
      afterHistoryDigest: block.afterHistoryDigest,
      indexes: block.indexes,
      // Development saves created before historySummary are accepted once;
      // normalizeWorldArchiveState derives and persists this exact metadata.
      historySummary: block.historySummary ?? expectedMetadata.historySummary,
      territoryDeltas: block.territoryDeltas,
      importantEventPreviews: block.importantEventPreviews,
    };
    if (!equalValues(actualMetadata, expectedMetadata)) {
      addIssue(issues, 'archive.block.metadata', 'archive block metadata or canonical encoding is inconsistent', {
        blockId: block.id,
      });
    }
    factCount = expectedMetadata.afterFactCount;
    historyCount = expectedMetadata.afterHistoryCount;
    factDigest = expectedMetadata.afterFactDigest;
    historyDigest = expectedMetadata.afterHistoryDigest;
    expectedFromTurn = block.throughTurn + 1;
  }

  const expectedArchivedThrough = archive.blocks.at(-1)?.throughTurn ?? archive.archiveStartTurn - 1;
  const expectedBlockCount = Math.floor(Math.max(
    0,
    world.turn - WORLD_ARCHIVE_HOT_TURNS - archive.archiveStartTurn,
  ) / WORLD_ARCHIVE_CHUNK_TURNS);
  const expectedCanonicalThrough = archive.archiveStartTurn
    + expectedBlockCount * WORLD_ARCHIVE_CHUNK_TURNS
    - 1;
  if (archive.blocks.length !== expectedBlockCount
    || expectedArchivedThrough !== expectedCanonicalThrough) {
    addIssue(
      issues,
      'archive.frontier',
      'archive blocks do not reach the canonical cold frontier for this turn',
    );
  }
  if (archive.archivedThroughTurn !== expectedArchivedThrough
    || archive.archivedFactCount !== factCount - archive.factBaseCount
    || archive.archivedHistoryCount !== historyCount - archive.historyBaseCount
    || archive.archivedFactDigest !== factDigest
    || archive.archivedHistoryDigest !== historyDigest) {
    addIssue(issues, 'archive.tail', 'archive counters or digest tails do not match its blocks');
  }

  if (allBlocksDecoded) {
    validateDigestCheckpoints(world, archive, {
      factCount,
      factDigest,
      historyCount,
      historyDigest,
    }, issues);
  }

  if (!allBlocksDecoded) return issues;
  let facts: SimulationFact[];
  let history: HistoryEvent[];
  try {
    facts = readWorldFacts(world);
    history = readWorldHistory(world);
  } catch (error) {
    addIssue(
      issues,
      'archive.read',
      error instanceof Error ? error.message : 'archive could not be reconstructed',
    );
    return issues;
  }
  if (new Set(ids(facts)).size !== facts.length) {
    addIssue(issues, 'archive.fact.identity', 'reconstructed Fact identities are not unique');
  }
  if (new Set(ids(history)).size !== history.length) {
    addIssue(issues, 'archive.event.identity', 'reconstructed Chronicle identities are not unique');
  }
  if (world.factDigest !== expectedFullFactDigest(facts)) {
    addIssue(issues, 'archive.fact.digest', 'reconstructed Fact chain does not reach world.factDigest');
  }
  if (world.historyDigest !== expectedFullHistoryDigest(world, history)) {
    addIssue(issues, 'archive.history.digest', 'reconstructed Chronicle chain does not reach world.historyDigest');
  }
  const activeFacts = expectedActiveFacts(world, facts, archive.archivedThroughTurn);
  const currentResidencyMatches = equalValues(archive.pinnedFactIds, activeFacts.pinnedIds)
    && equalValues(world.facts, activeFacts.records);
  const legacyActiveFacts = currentResidencyMatches
    ? null
    : expectedActiveFacts(
        world,
        facts,
        archive.archivedThroughTurn,
        collectLegacyPinnedFactIds(world, facts),
      );
  const legacyResidencyMatches = legacyActiveFacts !== null
    && equalValues(archive.pinnedFactIds, legacyActiveFacts.pinnedIds)
    && equalValues(world.facts, legacyActiveFacts.records);
  if (!currentResidencyMatches && !legacyResidencyMatches) {
    addIssue(issues, 'archive.active.facts', 'active Facts are not cold pins followed by the hot suffix');
  }
  const activeHistory = expectedActiveHistory(world, history, archive.archivedThroughTurn);
  if (!equalValues(archive.pinnedEventIds, activeHistory.pinnedIds)
    || !equalValues(world.history, activeHistory.records)) {
    addIssue(
      issues,
      'archive.active.history',
      'active Chronicle is not legacy prefix, cold pins, then hot suffix',
    );
  }
  return issues;
}

export function assertWorldArchiveIntegrity(world: ArchiveWorldState): void {
  const issues = validateWorldArchiveIntegrity(world);
  if (issues.length === 0) return;
  throw new Error(issues.map((issue) => `${issue.code}: ${issue.message}`).join('\n'));
}
