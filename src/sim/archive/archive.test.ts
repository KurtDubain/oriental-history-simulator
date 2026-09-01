import { describe, expect, it } from 'vitest';
import { zlibSync } from 'fflate';

import { getDateForTurn } from '../calendar';
import { advanceWorldDetailed, computeWorldHash, createWorld } from '../engine';
import type { SimulationFact } from '../facts';
import { deserializeWorld, serializeWorld } from '../persistence';
import { stableHash, stableStringify } from '../random';
import type { HistoryEvent, TurnReport, WorldState } from '../types';
import { archiveDecodeCacheEntryCount } from './codec';
import { createArchiveBlock } from './metadata';
import { collectLegacyPinnedFactIds } from './pins';
import {
  MAX_ARCHIVE_BLOCK_RAW_BYTES,
  MAX_ARCHIVE_BLOCK_COMPRESSED_BYTES,
  WORLD_ARCHIVE_CHUNK_TURNS,
  clearWorldArchiveDecodeCache,
  cloneWorldArchiveState,
  collectReferencedFactIds,
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

function appendPowerBrokerFact(
  world: ArchiveWorldState,
  turn: number,
  action: 'power_broker_formed' | 'power_broker_fell' | 'purge',
  brokerId: string,
  brokerFactionId: string,
  rulerId: string,
  rulerFactionId: string | null,
): SimulationFact {
  const date = getDateForTurn(turn);
  world.counters.fact += 1;
  const fact: SimulationFact = {
    id: `fact_${String(world.counters.fact).padStart(7, '0')}`,
    turn,
    year: date.year,
    season: date.season,
    kind: 'court_action_resolved',
    category: '政治',
    importance: 3,
    actorIds: [brokerId, rulerId],
    polityIds: [world.characters.find((item) => item.id === brokerId)?.polityId ?? 'missing'],
    regionIds: [],
    causes: [{ label: '权臣任期测试', role: '结果', weight: 1, evidence: action }],
    stateDeltas: [],
    sourceFactIds: [],
    payload: {
      action,
      polityId: world.characters.find((item) => item.id === brokerId)?.polityId ?? 'missing',
      actorFactionId: action === 'power_broker_formed' ? brokerFactionId : rulerFactionId,
      targetFactionId: action === 'power_broker_formed' ? rulerFactionId : brokerFactionId,
      initiatorId: action === 'power_broker_formed' ? brokerId : rulerId,
      targetId: action === 'power_broker_formed' ? rulerId : brokerId,
      reasonCode: action,
      score: action === 'power_broker_formed' ? 70 : action === 'purge' ? 68 : 20,
      threshold: action === 'power_broker_formed' ? 66 : action === 'purge' ? 66 : 54,
      rulerBeforeId: rulerId,
      rulerAfterId: rulerId,
      affectedFactionIds: [brokerFactionId, ...(rulerFactionId ? [rulerFactionId] : [])].sort(),
      removedMemberIds: [],
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
  (world.agencyDecisionSystem as unknown as { archiveTestFactId: string }).archiveTestFactId = referencedId;
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
      (world.agencyDecisionSystem as unknown as { archiveTestFactId: string }).archiveTestFactId = fact.id;
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
    const openingFactionFacts = world.facts.filter((fact) => (
      fact.kind === 'faction_lifecycle'
      && fact.payload.transition === 'formed'
      && fact.payload.reasonCode === 'opening_order'
    ));
    expect(openingFactionFacts).toHaveLength(40);
    const referencedFactId = (world.agencyDecisionSystem as unknown as { archiveTestFactId: string })
      .archiveTestFactId;
    const referencedFact = world.facts.find((fact) => fact.id === referencedFactId);
    const recursiveSourceFactId = referencedFact?.sourceFactIds[0];
    expect(referencedFact?.turn).toBe(5);
    expect(recursiveSourceFactId).toBeDefined();
    if (!referencedFact || !recursiveSourceFactId) return;
    const expectedFirstBlockFactIds = world.facts
      .filter((fact) => fact.turn >= 0 && fact.turn <= 15)
      .map((fact) => fact.id);
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
    expect(archive?.pinnedFactIds).toEqual([recursiveSourceFactId, referencedFactId]);
    expect(archive?.pinnedEventIds).toEqual(['event_000001', 'event_000004']);
    expect(world.facts.slice(0, 2).map((fact) => fact.id)).toEqual(archive?.pinnedFactIds);
    expect(findWorldFact(world, referencedFactId)?.sourceFactIds).toEqual([recursiveSourceFactId]);
    expect(findWorldFact(world, recursiveSourceFactId)?.turn).toBe(4);
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
    const firstBlockFacts = firstBlock ? decodeArchiveBlock(firstBlock).facts : [];
    expect(firstBlockFacts.filter((fact) => fact.kind === 'situation_milestone')).toHaveLength(16);
    expect(firstBlockFacts.filter((fact) => fact.kind === 'faction_lifecycle'))
      .toHaveLength(openingFactionFacts.length);
    expect(firstBlockFacts.map((fact) => fact.id)).toEqual(expectedFirstBlockFactIds);

    const clone = archive ? cloneWorldArchiveState(archive) : null;
    expect(clone).not.toBe(archive);
    expect(clone?.blocks).not.toBe(archive?.blocks);
    expect(clone?.blocks[0]).toBe(archive?.blocks[0]);
    expect(clone?.pinnedFactIds).not.toBe(archive?.pinnedFactIds);
    expect(clone?.digestCheckpoints).not.toBe(archive?.digestCheckpoints);
    expect(clone?.digestCheckpoints[0]).not.toBe(archive?.digestCheckpoints[0]);
  });

  it('pins candidate and open-Situation evidence but leaves resolved evidence cold', () => {
    const world = createWorld('冷档案存活根测试') as ArchiveWorldState;
    const factIds = world.facts.slice(0, 6).map((fact) => fact.id);
    expect(factIds).toHaveLength(6);
    const [candidateFactId, openFactId, resolvedFactId, archivedRootFactId, decisionFactId, lastTurnFactId] = factIds as [string, string, string, string, string, string];
    const situationSystem = world.situationSystem as unknown as {
      candidates: unknown[];
      situations: unknown[];
      archivedRootFactId: string;
    };
    situationSystem.candidates = [{ evidenceFactIds: [candidateFactId] }];
    situationSystem.situations = [
      { status: 'open', causalFactIds: [openFactId] },
      { status: 'resolved', causalFactIds: [resolvedFactId] },
    ];
    situationSystem.archivedRootFactId = archivedRootFactId;
    (world.agencyDecisionSystem as unknown as { archiveTestFactId: string }).archiveTestFactId = decisionFactId;
    world.lastTurn = { factIds: [lastTurnFactId] } as unknown as TurnReport;

    const referenced = collectReferencedFactIds(world);
    expect(referenced).toEqual(new Set([
      candidateFactId,
      openFactId,
      decisionFactId,
      lastTurnFactId,
    ]));
    expect(referenced.has(resolvedFactId)).toBe(false);
    expect(referenced.has(archivedRootFactId)).toBe(false);
  });

  it('keeps an active power-broker Fact beyond the hot window and unpins it only after explicit fall', () => {
    const world = createWorld('权臣事实冷档案存活根') as ArchiveWorldState;
    const polity = world.polities.find((item) => item.alive);
    const ruler = world.characters.find((item) => item.id === polity?.rulerId);
    const brokerFaction = world.factions.find((item) => (
      item.active && item.polityId === polity?.id && item.leaderId !== ruler?.id
    ));
    const broker = world.characters.find((item) => item.id === brokerFaction?.leaderId);
    if (!polity || !ruler || !brokerFaction || !broker) throw new Error('expected court actors for archive pin test');
    const formed = appendPowerBrokerFact(
      world,
      0,
      'power_broker_formed',
      broker.id,
      brokerFaction.id,
      ruler.id,
      ruler.factionId,
    );
    for (let turn = 0; turn < 96; turn += 1) {
      const filler = appendFact(world, turn);
      appendEvent(world, turn);
      world.lastTurn = { factIds: [filler.id] } as unknown as TurnReport;
    }
    setWorldTurn(world, 96);
    compactWorldArchive(world);

    expect(world.archiveSystem?.archivedThroughTurn).toBe(31);
    expect(world.archiveSystem?.pinnedFactIds).toContain(formed.id);
    expect(findActiveWorldFact(world, formed.id)).toEqual(formed);
    const originalRulerId = polity.rulerId;
    polity.rulerId = broker.id;
    expect(collectReferencedFactIds(world)).not.toContain(formed.id);
    polity.rulerId = originalRulerId;
    polity.alive = false;
    expect(collectReferencedFactIds(world)).not.toContain(formed.id);
    polity.alive = true;
    broker.alive = false;
    expect(collectReferencedFactIds(world)).not.toContain(formed.id);
    broker.alive = true;
    const originalBrokerPolityId = broker.polityId;
    const otherLivingPolity = world.polities.find((item) => item.alive && item.id !== polity.id);
    expect(otherLivingPolity).toBeDefined();
    broker.polityId = otherLivingPolity?.id ?? broker.polityId;
    expect(collectReferencedFactIds(world)).not.toContain(formed.id);
    broker.polityId = originalBrokerPolityId;
    expect(collectReferencedFactIds(world)).toContain(formed.id);

    appendPowerBrokerFact(
      world,
      96,
      'purge',
      broker.id,
      brokerFaction.id,
      ruler.id,
      ruler.factionId,
    );
    for (let turn = 96; turn < 176; turn += 1) {
      const filler = appendFact(world, turn);
      appendEvent(world, turn);
      world.lastTurn = { factIds: [filler.id] } as unknown as TurnReport;
    }
    setWorldTurn(world, 176);
    compactWorldArchive(world);

    expect(world.archiveSystem?.archivedThroughTurn).toBe(111);
    expect(world.archiveSystem?.pinnedFactIds).toContain(formed.id);
    expect(findActiveWorldFact(world, formed.id)).toEqual(formed);

    const fell = appendPowerBrokerFact(
      world,
      176,
      'power_broker_fell',
      broker.id,
      brokerFaction.id,
      ruler.id,
      ruler.factionId,
    );
    for (let turn = 176; turn < 256; turn += 1) {
      const filler = appendFact(world, turn);
      appendEvent(world, turn);
      world.lastTurn = { factIds: [filler.id] } as unknown as TurnReport;
    }
    setWorldTurn(world, 256);
    compactWorldArchive(world);

    expect(world.archiveSystem?.archivedThroughTurn).toBe(191);
    expect(world.archiveSystem?.pinnedFactIds).not.toContain(formed.id);
    expect(findActiveWorldFact(world, formed.id)).toBeUndefined();
    expect(findWorldFact(world, formed.id)).toEqual(formed);
    expect(findWorldFact(world, fell.id)).toEqual(fell);
    expect(validateWorldArchiveIntegrity(world)).toEqual([]);
  });

  it('imports the original whole-Situation pin layout and repins it to live roots', () => {
    let world = createWorld('冷档案旧引用根兼容') as ArchiveWorldState;
    for (let turn = 0; turn < 80; turn += 1) world = advanceWorldDetailed(world as WorldState).world;
    const archive = world.archiveSystem;
    expect(archive?.blocks).toHaveLength(1);
    if (!archive) return;
    const legacyOnlyFact = readWorldFacts(world).find((fact) => (
      fact.turn <= archive.archivedThroughTurn
      && !archive.pinnedFactIds.includes(fact.id)
    ));
    expect(legacyOnlyFact).toBeDefined();
    if (!legacyOnlyFact) return;

    (world.situationSystem as unknown as { archivedResolvedFactId: string })
      .archivedResolvedFactId = legacyOnlyFact.id;
    world.hash = computeWorldHash(world as never);
    const allFacts = readWorldFacts(world);
    const legacyPinSet = collectLegacyPinnedFactIds(world, allFacts);
    const legacyColdPins = allFacts.filter((fact) => (
      fact.turn <= archive.archivedThroughTurn && legacyPinSet.has(fact.id)
    ));
    const hotFacts = allFacts.filter((fact) => fact.turn > archive.archivedThroughTurn);
    archive.pinnedFactIds = legacyColdPins.map((fact) => fact.id);
    world.facts = [...legacyColdPins, ...hotFacts];

    expect(validateWorldArchiveIntegrity(world)).toEqual([]);
    const blocksBefore = stableStringify(archive.blocks);
    const serializedLegacy = serializeWorld(world as WorldState);
    const restored = deserializeWorld(serializedLegacy);
    expect(restored.hash).toBe(world.hash);
    expect(restored.factDigest).toBe(world.factDigest);
    expect(restored.historyDigest).toBe(world.historyDigest);
    expect(stableStringify(restored.archiveSystem?.blocks)).toBe(blocksBefore);
    expect(restored.archiveSystem?.pinnedFactIds).not.toContain(legacyOnlyFact.id);
    expect(findActiveWorldFact(restored, legacyOnlyFact.id)).toBeUndefined();
    expect(findWorldFact(restored, legacyOnlyFact.id)).toEqual(legacyOnlyFact);
    expect(validateWorldArchiveIntegrity(restored)).toEqual([]);
    const normalized = serializeWorld(restored);
    expect(new TextEncoder().encode(normalized).byteLength)
      .toBeLessThan(new TextEncoder().encode(serializedLegacy).byteLength);
    expect(serializeWorld(deserializeWorld(normalized))).toBe(normalized);
  }, 60_000);

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

  it('rejects an arbitrary extra cold pin that belongs to neither residency layout', () => {
    const world = syntheticWorld(96);
    compactWorldArchive(world);
    const archive = world.archiveSystem;
    expect(archive).toBeDefined();
    if (!archive) return;
    const extra = readWorldFacts(world).find((fact) => (
      fact.turn <= archive.archivedThroughTurn
      && !archive.pinnedFactIds.includes(fact.id)
    ));
    expect(extra).toBeDefined();
    if (!extra) return;
    const coldPins = [...world.facts.filter((fact) => archive.pinnedFactIds.includes(fact.id)), extra]
      .sort((left, right) => left.id.localeCompare(right.id));
    archive.pinnedFactIds = coldPins.map((fact) => fact.id);
    world.facts = [
      ...coldPins,
      ...world.facts.filter((fact) => fact.turn > archive.archivedThroughTurn),
    ];

    expect(validateWorldArchiveIntegrity(world).map((issue) => issue.code))
      .toContain('archive.active.facts');
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
