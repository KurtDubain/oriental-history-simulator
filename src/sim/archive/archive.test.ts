import { describe, expect, it } from 'vitest';
import { zlibSync } from 'fflate';

import { getDateForTurn } from '../calendar';
import { computeWorldHash, createWorld } from '../engine';
import type { SimulationFact } from '../facts';
import { deserializeWorld, serializeWorld } from '../persistence';
import { stableHash, stableStringify } from '../random';
import type { HistoryEvent, TurnReport, WorldState } from '../types';
import { archiveDecodeCacheEntryCount } from './codec';
import { createArchiveBlock } from './metadata';
import {
  MAX_ARCHIVE_BLOCK_RAW_BYTES,
  MAX_ARCHIVE_BLOCK_COMPRESSED_BYTES,
  WORLD_ARCHIVE_CHUNK_TURNS,
  clearWorldArchiveDecodeCache,
  cloneWorldArchiveState,
  compactWorldArchive,
  createWorldArchiveState,
  decodeArchiveBlock,
  findActiveWorldEvent,
  findActiveWorldFact,
  findWorldEvent,
  findWorldFact,
  normalizeWorldArchiveState,
  readWorldFacts,
  readWorldHistory,
  validateWorldArchiveIntegrity,
  type ArchiveWorldState,
} from './index';

function appendFact(
  world: ArchiveWorldState,
  turn: number,
  sourceFactIds: string[] = [],
): SimulationFact {
  const date = getDateForTurn(turn);
  world.counters.fact += 1;
  const fact: SimulationFact = {
    id: `fact_${String(world.counters.fact).padStart(7, '0')}`,
    turn,
    year: date.year,
    season: date.season,
    kind: 'situation_milestone',
    category: '政治',
    importance: (turn % 5 + 1) as 1 | 2 | 3 | 4 | 5,
    actorIds: [world.characters[turn % world.characters.length]?.id ?? 'missing'],
    polityIds: [world.polities[turn % world.polities.length]?.id ?? 'missing'],
    regionIds: [world.regions[turn % world.regions.length]?.id ?? 'missing'],
    causes: [{ label: '测试链', weight: 1, evidence: `第${turn}季` }],
    stateDeltas: [],
    sourceFactIds,
    payload: {
      situationId: `situation_test_${turn}`,
      situationType: 'archive_test',
      transition: 'formed',
      fromPhase: null,
      toPhase: 'emerging',
      tension: turn % 100,
      momentum: 1,
      outcomeKey: null,
    },
  };
  world.facts.push(fact);
  world.factDigest = stableHash([world.factDigest, fact]);
  return fact;
}

function appendEvent(
  world: ArchiveWorldState,
  turn: number,
  kind = 'archive_test_event',
): HistoryEvent {
  const date = getDateForTurn(turn);
  world.counters.event += 1;
  const event: HistoryEvent = {
    id: `event_${String(world.counters.event).padStart(6, '0')}`,
    turn,
    year: date.year,
    season: date.season,
    category: '政治',
    kind,
    title: `第${turn}季试事`,
    summary: `第${turn}季发生了可核验的试事。`,
    importance: (turn % 5 + 1) as 1 | 2 | 3 | 4 | 5,
    actorIds: [world.characters[turn % world.characters.length]?.id ?? 'missing'],
    polityIds: [world.polities[turn % world.polities.length]?.id ?? 'missing'],
    regionIds: [world.regions[turn % world.regions.length]?.id ?? 'missing'],
    causes: [{ label: '测试链', weight: 1, evidence: `第${turn}季` }],
    evidence: [`第${turn}季`],
    stateDeltas: [],
    sourceFactIds: [],
    situationIds: [],
  };
  world.history.push(event);
  world.historyDigest = stableHash([world.historyDigest, event]);
  return event;
}

function setWorldTurn(world: ArchiveWorldState, turn: number): void {
  const date = getDateForTurn(turn);
  world.turn = turn;
  world.year = date.year;
  world.season = date.season;
}

function syntheticWorld(completedTurns: number): ArchiveWorldState {
  const world = createWorld('冷档案聚焦测试') as ArchiveWorldState;
  let recursiveSourceId = '';
  let referencedId = '';
  for (let turn = 0; turn < completedTurns; turn += 1) {
    const sourceFactIds = turn === 5 ? [recursiveSourceId] : [];
    const fact = appendFact(world, turn, sourceFactIds);
    if (turn === 4) recursiveSourceId = fact.id;
    if (turn === 5) referencedId = fact.id;
    appendEvent(world, turn, turn === 2 ? 'observer_intervention_support_character' : undefined);
  }
  setWorldTurn(world, completedTurns);
  (world.situationSystem as unknown as { archiveTestFactId: string }).archiveTestFactId = referencedId;
  world.lastTurn = { factIds: [world.facts.at(-1)?.id ?? ''] } as unknown as TurnReport;
  world.hash = computeWorldHash(world as never);
  return world;
}

function incrementallyCompactedWorld(completedTurns: number): ArchiveWorldState {
  const world = createWorld('冷档案聚焦测试') as ArchiveWorldState;
  let recursiveSourceId = '';
  for (let turn = 0; turn < completedTurns; turn += 1) {
    const sourceFactIds = turn === 5 ? [recursiveSourceId] : [];
    const fact = appendFact(world, turn, sourceFactIds);
    if (turn === 4) recursiveSourceId = fact.id;
    if (turn === 5) {
      (world.situationSystem as unknown as { archiveTestFactId: string }).archiveTestFactId = fact.id;
    }
    appendEvent(world, turn, turn === 2 ? 'observer_intervention_support_character' : undefined);
    world.lastTurn = { factIds: [fact.id] } as unknown as TurnReport;
    setWorldTurn(world, turn + 1);
    compactWorldArchive(world);
  }
  world.hash = computeWorldHash(world as never);
  return world;
}

describe('self-contained world cold archive', () => {
  it('keeps complete chains, cold pins, indexes and world hash while compacting', () => {
    const world = syntheticWorld(96);
    const originalFacts = stableStringify(world.facts);
    const originalHistory = stableStringify(world.history);
    const originalHash = computeWorldHash(world as never);
    compactWorldArchive(world);

    const archive = world.archiveSystem;
    expect(archive?.blocks).toHaveLength(2);
    expect(archive?.archivedThroughTurn).toBe(31);
    expect(archive?.blocks.map((block) => [block.fromTurn, block.throughTurn])).toEqual([
      [0, 15],
      [16, 31],
    ]);
    expect(archive?.pinnedFactIds).toEqual(['fact_0000005', 'fact_0000006']);
    expect(archive?.pinnedEventIds).toEqual(['event_000001', 'event_000004']);
    expect(world.facts.slice(0, 2).map((fact) => fact.id)).toEqual(archive?.pinnedFactIds);
    expect(world.facts.at(-1)?.turn).toBe(95);
    expect(world.history.at(-1)?.turn).toBe(95);
    expect(stableStringify(readWorldFacts(world))).toBe(originalFacts);
    expect(stableStringify(readWorldHistory(world))).toBe(originalHistory);
    expect(computeWorldHash(world as never)).toBe(originalHash);
    expect(validateWorldArchiveIntegrity(world)).toEqual([]);

    expect(findActiveWorldFact(world, 'fact_0000001')).toBeUndefined();
    expect(findWorldFact(world, 'fact_0000001')?.turn).toBe(0);
    expect(findActiveWorldEvent(world, 'event_000002')).toBeUndefined();
    expect(findWorldEvent(world, 'event_000002')?.turn).toBe(0);
    const firstBlock = archive?.blocks[0];
    expect(firstBlock?.indexes.kind.situation_milestone).toHaveLength(16);
    expect(firstBlock?.importantEventPreviews.length).toBeLessThanOrEqual(8);
    expect(firstBlock ? decodeArchiveBlock(firstBlock).facts : []).toHaveLength(16);

    const clone = archive ? cloneWorldArchiveState(archive) : null;
    expect(clone).not.toBe(archive);
    expect(clone?.blocks).not.toBe(archive?.blocks);
    expect(clone?.blocks[0]).toBe(archive?.blocks[0]);
    expect(clone?.pinnedFactIds).not.toBe(archive?.pinnedFactIds);
    expect(clone?.digestCheckpoints).not.toBe(archive?.digestCheckpoints);
    expect(clone?.digestCheckpoints[0]).not.toBe(archive?.digestCheckpoints[0]);
  });

  it('uses bounded authenticated chunk checkpoints without changing canonical blocks', () => {
    const incremental = incrementallyCompactedWorld(96);
    const fallback = syntheticWorld(96);
    compactWorldArchive(fallback);

    expect(incremental.archiveSystem?.digestCheckpoints.map((checkpoint) => checkpoint.throughTurn))
      .toEqual([47, 63, 79, 95]);
    expect(incremental.archiveSystem?.digestCheckpoints).toHaveLength(4);
    expect(stableStringify(incremental.archiveSystem?.blocks))
      .toBe(stableStringify(fallback.archiveSystem?.blocks));
    expect(validateWorldArchiveIntegrity(incremental)).toEqual([]);
  });

  it('falls back to digest replay unless both checkpoint counts match the block tail', () => {
    const source = syntheticWorld(16);
    const input = {
      fromTurn: 0,
      throughTurn: 15,
      facts: source.facts,
      history: source.history,
      beforeFactCount: 0,
      beforeHistoryCount: 0,
      beforeFactDigest: stableHash([]),
      beforeHistoryDigest: '',
    };
    const replayed = createArchiveBlock(input);
    const checkpointed = createArchiveBlock({
      ...input,
      digestCheckpoint: {
        throughTurn: 15,
        factCount: source.counters.fact,
        factDigest: source.factDigest,
        historyCount: source.counters.event,
        historyDigest: source.historyDigest,
      },
    });
    const mismatched = createArchiveBlock({
      ...input,
      digestCheckpoint: {
        throughTurn: 15,
        factCount: source.counters.fact + 1,
        factDigest: 'poisoned-fact-digest',
        historyCount: source.counters.event,
        historyDigest: 'poisoned-history-digest',
      },
    });
    expect(stableStringify(checkpointed)).toBe(stableStringify(replayed));
    expect(stableStringify(mismatched)).toBe(stableStringify(replayed));
  });

  it('normalizes old saves and rejects poisoned, duplicate or future checkpoints', () => {
    const oldSave = syntheticWorld(96);
    compactWorldArchive(oldSave);
    delete (oldSave.archiveSystem as unknown as { digestCheckpoints?: unknown }).digestCheckpoints;
    expect(validateWorldArchiveIntegrity(oldSave)).toEqual([]);
    expect(normalizeWorldArchiveState(oldSave).digestCheckpoints).toEqual([]);

    const world = incrementallyCompactedWorld(96);
    const checkpoints = world.archiveSystem?.digestCheckpoints;
    expect(checkpoints).toBeDefined();
    if (!checkpoints || checkpoints.length === 0) return;
    const first = checkpoints[0] as (typeof checkpoints)[number];
    const originalDigest = first.factDigest;
    first.factDigest = 'poisoned-fact-digest';
    expect(validateWorldArchiveIntegrity(world).map((issue) => issue.code))
      .toContain('archive.checkpoint.digest');
    first.factDigest = originalDigest;

    checkpoints.push({ ...first });
    expect(validateWorldArchiveIntegrity(world).map((issue) => issue.code))
      .toContain('archive.checkpoint.layout');
    checkpoints.pop();

    const originalTurn = first.throughTurn;
    first.throughTurn = world.turn + WORLD_ARCHIVE_CHUNK_TURNS - 1;
    expect(validateWorldArchiveIntegrity(world).map((issue) => issue.code))
      .toContain('archive.checkpoint.layout');
    first.throughTurn = originalTurn;
    expect(validateWorldArchiveIntegrity(world)).toEqual([]);
  });

  it('archives the second block at T96, not one completed turn early at T95', () => {
    const world = syntheticWorld(95);
    compactWorldArchive(world);
    expect(world.archiveSystem?.blocks.map((block) => block.throughTurn)).toEqual([15]);

    appendFact(world, 95);
    appendEvent(world, 95);
    setWorldTurn(world, 96);
    compactWorldArchive(world);
    expect(world.archiveSystem?.blocks.map((block) => block.throughTurn)).toEqual([15, 31]);
    expect(world.facts.filter((fact) => fact.turn > 31)).toHaveLength(64);
  });

  it('never decodes old blocks during a normal seal or repin pass', () => {
    const world = syntheticWorld(95);
    compactWorldArchive(world);
    const poisoned = world.archiveSystem?.blocks[0];
    expect(poisoned).toBeDefined();
    if (!poisoned) return;
    poisoned.payloadBase64 = `!${poisoned.payloadBase64.slice(1)}`;
    clearWorldArchiveDecodeCache();

    appendFact(world, 95);
    appendEvent(world, 95);
    setWorldTurn(world, 96);
    expect(() => compactWorldArchive(world)).not.toThrow();
    expect(world.archiveSystem?.blocks).toHaveLength(2);
  });

  it('rejects a compressed bomb before accepting output beyond the declared raw size', () => {
    const world = syntheticWorld(80);
    compactWorldArchive(world);
    const source = world.archiveSystem?.blocks[0];
    expect(source).toBeDefined();
    if (!source) return;
    const compressed = zlibSync(new Uint8Array(MAX_ARCHIVE_BLOCK_RAW_BYTES + 1));
    let binary = '';
    for (const byte of compressed) binary += String.fromCharCode(byte);
    const payloadBase64 = btoa(binary);
    const forged = {
      ...source,
      payloadRawBytes: 1,
      payloadCompressedBytes: compressed.byteLength,
      payloadBase64,
      compressedDigest: stableHash(payloadBase64),
    };
    clearWorldArchiveDecodeCache();
    expect(() => decodeArchiveBlock(forged)).toThrow(/declared byte limit/);
  });

  it('rejects changed active copies of cold pinned Facts and Chronicle records', () => {
    const factWorld = syntheticWorld(96);
    compactWorldArchive(factWorld);
    const pinnedFact = factWorld.facts.find((fact) => fact.id === factWorld.archiveSystem?.pinnedFactIds[0]);
    expect(pinnedFact).toBeDefined();
    if (!pinnedFact) return;
    pinnedFact.importance = pinnedFact.importance === 5 ? 4 : 5;
    expect(validateWorldArchiveIntegrity(factWorld).map((issue) => issue.code))
      .toContain('archive.active.facts');
    expect(() => deserializeWorld(serializeWorld(factWorld as WorldState)))
      .toThrow(/历史冷档案校验失败/);

    const historyWorld = syntheticWorld(96);
    compactWorldArchive(historyWorld);
    const pinnedEvent = historyWorld.history.find(
      (event) => event.id === historyWorld.archiveSystem?.pinnedEventIds[0],
    );
    expect(pinnedEvent).toBeDefined();
    if (!pinnedEvent) return;
    pinnedEvent.summary = `${pinnedEvent.summary}伪改`;
    expect(validateWorldArchiveIntegrity(historyWorld).map((issue) => issue.code))
      .toContain('archive.active.history');
    expect(() => deserializeWorld(serializeWorld(historyWorld as WorldState)))
      .toThrow(/历史冷档案校验失败/);
  });

  it('rejects an under-compacted archive even when every existing block is valid', () => {
    const world = syntheticWorld(96);
    compactWorldArchive(world);
    const archive = world.archiveSystem;
    expect(archive?.blocks).toHaveLength(2);
    if (!archive) return;
    archive.blocks.pop();
    const first = archive.blocks[0];
    expect(first).toBeDefined();
    if (!first) return;
    archive.archivedThroughTurn = first.throughTurn;
    archive.archivedFactCount = first.afterFactCount - archive.factBaseCount;
    archive.archivedHistoryCount = first.afterHistoryCount - archive.historyBaseCount;
    archive.archivedFactDigest = first.afterFactDigest;
    archive.archivedHistoryDigest = first.afterHistoryDigest;
    expect(validateWorldArchiveIntegrity(world).map((issue) => issue.code)).toContain('archive.frontier');
  });

  it('strongly retains no more than four decoded cold blocks', () => {
    const world = syntheticWorld(160);
    compactWorldArchive(world);
    const blocks = world.archiveSystem?.blocks ?? [];
    expect(blocks.length).toBeGreaterThan(4);
    clearWorldArchiveDecodeCache();
    for (const block of blocks) decodeArchiveBlock(block);
    expect(archiveDecodeCacheEntryCount()).toBe(4);
  });

  it('keeps migrated Chronicle before the schema-4 chain base and rejects oversized payloads', () => {
    const world = createWorld('旧档冷边界') as ArchiveWorldState;
    const legacyDigest = world.historyDigest;
    world.legacyArchiveBoundary = {
      sourceSchemaVersion: 3,
      turn: 32,
      historyEventCount: 1,
      historyDigest: legacyDigest,
    };
    world.archiveSystem = createWorldArchiveState(world.legacyArchiveBoundary);
    world.facts = [];
    world.factDigest = stableHash([]);
    world.counters.fact = 0;
    for (let turn = 32; turn < 112; turn += 1) {
      appendFact(world, turn);
      appendEvent(world, turn);
    }
    setWorldTurn(world, 112);
    const originalHistory = stableStringify(world.history);
    compactWorldArchive(world);

    const archive = world.archiveSystem;
    expect(archive?.archiveStartTurn).toBe(32);
    expect(archive?.blocks[0]?.beforeHistoryCount).toBe(1);
    expect(archive?.blocks[0]?.beforeHistoryDigest).toBe(legacyDigest);
    expect(world.history[0]?.kind).toBe('world_created');
    expect(archive?.pinnedEventIds).toEqual([]);
    expect(stableStringify(readWorldHistory(world))).toBe(originalHistory);
    expect(validateWorldArchiveIntegrity(world)).toEqual([]);

    const block = archive?.blocks[0];
    expect(block).toBeDefined();
    if (!block) return;
    block.payloadCompressedBytes = MAX_ARCHIVE_BLOCK_COMPRESSED_BYTES + 1;
    clearWorldArchiveDecodeCache();
    expect(() => decodeArchiveBlock(block)).toThrow(/exceeds/);
    expect(validateWorldArchiveIntegrity(world).map((issue) => issue.code)).toContain('archive.block.decode');
  });
});
