import { describe, expect, it } from 'vitest';

import { getDateForTurn } from '../calendar';
import { createWorld } from '../engine';
import type { SimulationFact } from '../facts';
import { stableCompare, stableHash } from '../random';
import type { HistoryEvent, WorldState } from '../types';
import {
  clearWorldArchiveDecodeCache,
  compactWorldArchive,
  createWorldArchiveState,
  normalizeWorldArchiveState,
  queryWorldHistory,
  readWorldHistory,
  readWorldHistoryRelatedFacets,
  readWorldTerritoryDeltas,
  summarizeWorldHistory,
  validateWorldArchiveIntegrity,
  type WorldHistoryMetadataSummary,
  type WorldHistoryQueryCursor,
  type WorldHistoryQueryFilters,
  type WorldHistoryRelatedFacet,
  type WorldHistoryRelatedRef,
} from './index';
import { extendFactDigest, extendHistoryDigest } from './metadata';

const TOTAL_TURNS = 112;

function categoryForTurn(turn: number): HistoryEvent['category'] {
  if (turn < 16) return '军事';
  if (turn < 32) return '政治';
  if (turn < 48) return '经济';
  return '世界';
}

function importanceFor(turn: number, slot: number): HistoryEvent['importance'] {
  if (turn >= 32 && turn < 48) return 1;
  if (turn === 20 && slot === 1) return 5;
  return ((turn + slot) % 5 + 1) as HistoryEvent['importance'];
}

function historyEvent(
  world: WorldState,
  id: string,
  turn: number,
  slot: number,
): HistoryEvent {
  const date = getDateForTurn(turn);
  const causeOnlyCharacter = world.characters[1] as WorldState['characters'][number];
  const isCauseOnly = turn === 20 && slot === 1;
  return {
    id,
    turn,
    year: date.year,
    season: date.season,
    category: categoryForTurn(turn),
    kind: turn === 0 && slot === 0
      ? 'world_created'
      : turn === 4 && slot === 0
        ? 'observer_intervention_support_character'
        : slot === 1 && turn % 9 === 0
          ? 'situation_phase_changed'
        : 'archive_query_test',
    title: isCauseOnly ? '密议孤证' : `第${turn}季史事${slot + 1}`,
    summary: `第${turn}季的可核验记载。`,
    importance: importanceFor(turn, slot),
    actorIds: isCauseOnly ? [] : [world.characters[0]?.id ?? 'missing-character'],
    polityIds: [world.polities[0]?.id ?? 'missing-polity'],
    regionIds: [world.regions[0]?.id ?? 'missing-region'],
    causes: isCauseOnly
      ? [{
          label: '秘密证言',
          weight: 1,
          evidence: '孤证密语只存于因由',
          refs: [{
            kind: 'entity',
            entityType: 'character',
            entityId: causeOnlyCharacter.id,
            label: '因由中的人物',
          }],
        }]
      : [{ label: '季度记录', weight: 1, evidence: `史证 ${turn}-${slot}` }],
    evidence: isCauseOnly ? ['孤证密语'] : [`史证 ${turn}-${slot}`],
    stateDeltas: [],
    sourceFactIds: [],
    situationIds: [],
  };
}

function territoryFact(
  world: WorldState,
  id: string,
  turn: number,
): Extract<SimulationFact, { kind: 'territory_control_changed' }> {
  const date = getDateForTurn(turn);
  const regionId = world.regions[0]?.id ?? 'missing-region';
  const previousControllerId = world.polities[0]?.id ?? 'missing-polity-1';
  const nextControllerId = world.polities[1]?.id ?? 'missing-polity-2';
  return {
    id,
    turn,
    year: date.year,
    season: date.season,
    kind: 'territory_control_changed',
    category: '军事',
    importance: 4,
    actorIds: [],
    polityIds: [previousControllerId, nextControllerId],
    regionIds: [regionId],
    causes: [{ label: '控制权测试', weight: 1, evidence: `${previousControllerId}→${nextControllerId}` }],
    stateDeltas: [{
      entityType: 'region',
      entityId: regionId,
      field: 'controllerId',
      before: previousControllerId,
      after: nextControllerId,
    }],
    sourceFactIds: [],
    payload: {
      regionId,
      previousControllerId,
      nextControllerId,
      reason: 'battle_capture',
      warId: null,
    },
  };
}

function queryWorld(options: { legacy?: boolean } = {}): WorldState {
  const world = createWorld(options.legacy ? '分卷查询旧档' : '分卷查询新世界');
  const history: HistoryEvent[] = [];
  let eventOrdinal = 0;
  const appendEvent = (turn: number, slot: number) => {
    eventOrdinal += 1;
    history.push(historyEvent(
      world,
      `event_${String(eventOrdinal).padStart(7, '0')}`,
      turn,
      slot,
    ));
  };

  let legacyCount = 0;
  if (options.legacy) {
    appendEvent(0, 0);
    appendEvent(0, 1);
    appendEvent(1, 0);
    appendEvent(2, 0);
    legacyCount = history.length;
  }
  for (let turn = options.legacy ? 3 : 0; turn < TOTAL_TURNS; turn += 1) {
    appendEvent(turn, 0);
    appendEvent(turn, 1);
  }

  const facts: SimulationFact[] = [
    territoryFact(world, 'fact_0000001', 5),
    territoryFact(world, 'fact_0000002', 37),
    territoryFact(world, 'fact_0000003', 80),
  ];
  let factDigest = stableHash([]);
  for (const fact of facts) factDigest = extendFactDigest(factDigest, fact);
  let historyDigest = '';
  let historyCount = 0;
  let legacyDigest = '';
  for (const event of history) {
    historyDigest = extendHistoryDigest(historyDigest, historyCount, event);
    historyCount += 1;
    if (historyCount === legacyCount) legacyDigest = historyDigest;
  }

  const boundary = options.legacy
    ? {
        sourceSchemaVersion: 3 as const,
        turn: 3,
        historyEventCount: legacyCount,
        historyDigest: legacyDigest,
      }
    : null;
  const date = getDateForTurn(TOTAL_TURNS);
  world.turn = TOTAL_TURNS;
  world.year = date.year;
  world.season = date.season;
  world.history = history;
  world.historyDigest = historyDigest;
  world.facts = facts;
  world.factDigest = factDigest;
  world.legacyArchiveBoundary = boundary;
  world.archiveSystem = createWorldArchiveState(boundary);
  world.lastTurn = null;
  world.counters.event = eventOrdinal;
  world.counters.fact = facts.length;
  compactWorldArchive(world);
  return world;
}

function normalizeText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/\s+/g, ' ').trim();
}

function references(event: HistoryEvent, related: WorldHistoryRelatedRef): boolean {
  if (related.kind === 'character' && event.actorIds.includes(related.id)) return true;
  if (related.kind === 'polity' && event.polityIds.includes(related.id)) return true;
  if (related.kind === 'region' && event.regionIds.includes(related.id)) return true;
  return event.causes.some((cause) => cause.refs?.some((reference) => (
    reference.entityType === related.kind && reference.entityId === related.id
  )));
}

function fullFilter(
  world: WorldState,
  filters: WorldHistoryQueryFilters = {},
): HistoryEvent[] {
  const throughTurn = Math.max(0, Math.min(
    world.turn,
    Number.isFinite(filters.throughTurn) ? Math.floor(filters.throughTurn as number) : world.turn,
  ));
  const minimumImportance = Math.max(1, Math.min(
    5,
    Number.isFinite(filters.minimumImportance) ? Math.floor(filters.minimumImportance as number) : 1,
  ));
  const categories = new Set(filters.categories ?? []);
  const excludedKindPrefixes = (filters.excludedKindPrefixes ?? []).filter(Boolean);
  const tokens = normalizeText(filters.query ?? '').split(' ').filter(Boolean);
  const characterNames = new Map(world.characters.map((item) => [item.id, item.name]));
  const polityNames = new Map(world.polities.map((item) => [item.id, `${item.name} ${item.shortName}`]));
  const regionNames = new Map(world.regions.map((item) => [item.id, item.name]));
  return readWorldHistory(world)
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => {
      if (event.turn > throughTurn || event.importance < minimumImportance) return false;
      if (excludedKindPrefixes.some((prefix) => event.kind.startsWith(prefix))) return false;
      if (categories.size > 0 && !categories.has(event.category)) return false;
      if (filters.relatedEntity && !references(event, filters.relatedEntity)) return false;
      if (tokens.length === 0) return true;
      const text = normalizeText([
        event.title,
        event.summary,
        event.category,
        event.kind,
        ...event.evidence,
        ...event.causes.flatMap((cause) => [cause.label, cause.evidence]),
        ...event.actorIds.map((id) => characterNames.get(id) ?? ''),
        ...event.polityIds.map((id) => polityNames.get(id) ?? ''),
        ...event.regionIds.map((id) => regionNames.get(id) ?? ''),
      ].join(' '));
      return tokens.every((token) => text.includes(token));
    })
    .sort((left, right) => right.event.turn - left.event.turn || right.index - left.index)
    .map(({ event }) => event);
}

function drainQuery(
  world: WorldState,
  filters: WorldHistoryQueryFilters = {},
  limit = 7,
): HistoryEvent[] {
  const events: HistoryEvent[] = [];
  let cursor: WorldHistoryQueryCursor | null | undefined;
  for (let call = 0; call < 500; call += 1) {
    const previousCursor = cursor ? JSON.stringify(cursor) : null;
    const result = queryWorldHistory(world, {
      ...filters,
      cursor,
      limit,
      maxColdBlocks: 1,
    });
    expect(result.decodedColdBlocks).toBeLessThanOrEqual(1);
    events.push(...result.events);
    if (result.exhausted) {
      expect(result.nextCursor).toBeNull();
      return events;
    }
    expect(result.nextCursor).not.toBeNull();
    cursor = result.nextCursor;
    expect(JSON.stringify(cursor)).not.toBe(previousCursor);
  }
  throw new Error('history query did not exhaust within 500 slices');
}

function bruteSummary(world: WorldState, throughTurn: number): WorldHistoryMetadataSummary {
  const turn = Math.max(0, Math.min(world.turn, Math.floor(throughTurn)));
  const summary: WorldHistoryMetadataSummary = {
    throughTurn: turn,
    eventCount: 0,
    majorEventCount: 0,
    categoryCounts: {},
    importanceCounts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    eventsAtTurn: 0,
    majorEventsAtTurn: 0,
    categoryCountsAtTurn: {},
  };
  for (const event of readWorldHistory(world)) {
    if (event.turn > turn) continue;
    summary.eventCount += 1;
    if (event.importance >= 4) summary.majorEventCount += 1;
    summary.categoryCounts[event.category] = (summary.categoryCounts[event.category] ?? 0) + 1;
    summary.importanceCounts[event.importance] += 1;
    if (event.turn !== turn) continue;
    summary.eventsAtTurn += 1;
    if (event.importance >= 4) summary.majorEventsAtTurn += 1;
    summary.categoryCountsAtTurn[event.category] = (summary.categoryCountsAtTurn[event.category] ?? 0) + 1;
  }
  return summary;
}

function bruteFacets(world: WorldState): WorldHistoryRelatedFacet[] {
  const counts = new Map<string, number>();
  for (const event of readWorldHistory(world)) {
    const seen = new Set<string>();
    const add = (kind: WorldHistoryRelatedRef['kind'], id: string) => seen.add(`${kind}:${id}`);
    event.actorIds.forEach((id) => add('character', id));
    event.polityIds.forEach((id) => add('polity', id));
    event.regionIds.forEach((id) => add('region', id));
    for (const reference of event.causes.flatMap((cause) => cause.refs ?? [])) {
      if (reference.entityType === 'character'
        || reference.entityType === 'polity'
        || reference.entityType === 'region') {
        add(reference.entityType, reference.entityId);
      }
    }
    for (const key of seen) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([key, eventCount]) => {
    const separator = key.indexOf(':');
    return {
      kind: key.slice(0, separator) as WorldHistoryRelatedRef['kind'],
      id: key.slice(separator + 1),
      eventCount,
    };
  }).sort((left, right) => (
    stableCompare(left.kind, right.kind)
    || right.eventCount - left.eventCount
    || stableCompare(left.id, right.id)
  ));
}

describe('world history cold-block query', () => {
  it('serves the current first page from active history without decoding cold blocks', () => {
    const world = queryWorld();
    const result = queryWorldHistory(world, { limit: 72, maxColdBlocks: 1 });
    expect(world.archiveSystem.blocks).toHaveLength(3);
    expect(result.events).toHaveLength(72);
    expect(result.decodedColdBlocks).toBe(0);
    expect(result.events.map((event) => event.id)).toEqual(fullFilter(world).slice(0, 72).map((event) => event.id));
  });

  it('concatenates cursor pages exactly like a full authoritative read for every filter', () => {
    const world = queryWorld();
    const causeOnlyCharacter = world.characters[1] as WorldState['characters'][number];
    const filters: WorldHistoryQueryFilters[] = [
      {},
      { categories: ['政治'], minimumImportance: 4, throughTurn: 47 },
      { relatedEntity: { kind: 'character', id: causeOnlyCharacter.id } },
      { query: '孤证密语' },
      { categories: ['军事'], minimumImportance: 3, throughTurn: 35 },
      { excludedKindPrefixes: ['situation_'] },
    ];
    for (const filter of filters) {
      clearWorldArchiveDecodeCache();
      expect(drainQuery(world, filter).map((event) => event.id))
        .toEqual(fullFilter(world, filter).map((event) => event.id));
    }
    const ids = drainQuery(world, {}, 1).map((event) => event.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.slice(0, 2)).toEqual(fullFilter(world).slice(0, 2).map((event) => event.id));
  });

  it('excludes matching Chronicle kind prefixes across hot, cold and legacy pages', () => {
    const world = queryWorld({ legacy: true });
    const legacyEventCount = world.legacyArchiveBoundary?.historyEventCount ?? 0;
    expect(readWorldHistory(world).slice(0, legacyEventCount).some((item) => item.kind.startsWith('situation_'))).toBe(true);
    const visible = drainQuery(world, { excludedKindPrefixes: ['situation_'] }, 5);
    expect(visible.map((item) => item.id)).toEqual(
      fullFilter(world, { excludedKindPrefixes: ['situation_'] }).map((item) => item.id),
    );
    expect(visible.some((item) => item.kind.startsWith('situation_'))).toBe(false);
    expect(readWorldHistory(world).some((item) => item.kind.startsWith('situation_'))).toBe(true);
  });

  it('skips impossible blocks by category, importance and cause-only related metadata', () => {
    const world = queryWorld();
    const impossible = world.archiveSystem.blocks[2];
    expect(impossible?.historySummary?.categoryCounts['经济']).toBeGreaterThan(0);
    if (!impossible) return;
    impossible.payloadBase64 = `!${impossible.payloadBase64.slice(1)}`;
    clearWorldArchiveDecodeCache();

    const political = queryWorldHistory(world, {
      categories: ['政治'],
      minimumImportance: 5,
      throughTurn: 47,
      limit: 1,
      maxColdBlocks: 1,
    });
    expect(political.events).toHaveLength(1);
    expect(political.events[0]?.category).toBe('政治');
    expect(political.decodedColdBlocks).toBe(1);
    expect(political.skippedColdBlocks).toBeGreaterThanOrEqual(1);

    const causeOnlyCharacter = world.characters[1] as WorldState['characters'][number];
    clearWorldArchiveDecodeCache();
    const related = queryWorldHistory(world, {
      relatedEntity: { kind: 'character', id: causeOnlyCharacter.id },
      throughTurn: 47,
      limit: 10,
      maxColdBlocks: 1,
    });
    expect(related.events.map((event) => event.title)).toContain('密议孤证');
    expect(related.decodedColdBlocks).toBe(1);
  });

  it('keeps legacy prefix and permanent cold pins exactly once and rejects cursor reuse with other filters', () => {
    const world = queryWorld({ legacy: true });
    const events = drainQuery(world, {});
    const expected = fullFilter(world);
    expect(events.map((event) => event.id)).toEqual(expected.map((event) => event.id));
    expect(events.filter((event) => event.kind === 'world_created')).toHaveLength(1);
    expect(new Set(events.map((event) => event.id)).size).toBe(events.length);

    const first = queryWorldHistory(world, { limit: 5 });
    expect(first.nextCursor).not.toBeNull();
    expect(() => queryWorldHistory(world, {
      categories: ['政治'],
      cursor: first.nextCursor,
      limit: 5,
    })).toThrow(/cursor does not match/);
    expect(() => queryWorldHistory(world, {
      cursor: first.nextCursor ? { ...first.nextCursor, activeOffset: -1 } : null,
      limit: 5,
    })).toThrow(/cursor is invalid/);
  });
});

describe('world history archive metadata', () => {
  it('provides exact related facets, time summaries and territory deltas without cold decode', () => {
    const world = queryWorld();
    const expectedFacets = bruteFacets(world);
    const expectedSummary = bruteSummary(world, 37);
    const expectedDeltas = ['fact_0000001', 'fact_0000002', 'fact_0000003'];
    for (const block of world.archiveSystem.blocks) {
      block.payloadBase64 = `!${block.payloadBase64.slice(1)}`;
    }
    clearWorldArchiveDecodeCache();

    expect(readWorldHistoryRelatedFacets(world)).toEqual(expectedFacets);
    expect(summarizeWorldHistory(world, 37)).toEqual(expectedSummary);
    expect(readWorldTerritoryDeltas(world).deltas.map((delta) => delta.factId)).toEqual(expectedDeltas);
  });

  it('reports malformed active territory facts instead of throwing', () => {
    const world = queryWorld();
    const malformed = world.facts.find((fact) => fact.id === 'fact_0000003');
    expect(malformed?.kind).toBe('territory_control_changed');
    if (!malformed || malformed.kind !== 'territory_control_changed') return;
    malformed.payload = null as never;
    const result = readWorldTerritoryDeltas(world);
    expect(result.deltas.map((delta) => delta.factId)).toEqual(['fact_0000001', 'fact_0000002']);
    expect(result.skippedFactIds).toEqual(['fact_0000003']);
  });

  it('authenticates new history summaries and derives a missing development summary once', () => {
    const world = queryWorld();
    expect(validateWorldArchiveIntegrity(world)).toEqual([]);
    const first = world.archiveSystem.blocks[0];
    expect(first?.historySummary).toBeDefined();
    if (!first?.historySummary) return;
    first.historySummary.eventCount += 1;
    expect(validateWorldArchiveIntegrity(world).map((issue) => issue.code)).toContain('archive.block.metadata');

    const legacyDevelopmentWorld = queryWorld();
    const legacyBlock = legacyDevelopmentWorld.archiveSystem.blocks[0];
    expect(legacyBlock).toBeDefined();
    if (!legacyBlock) return;
    delete legacyBlock.historySummary;
    expect(validateWorldArchiveIntegrity(legacyDevelopmentWorld)).toEqual([]);
    normalizeWorldArchiveState(legacyDevelopmentWorld);
    expect(legacyDevelopmentWorld.archiveSystem.blocks[0]?.historySummary).toBeDefined();
    expect(readWorldHistoryRelatedFacets(legacyDevelopmentWorld)).toEqual(bruteFacets(legacyDevelopmentWorld));
  });
});
