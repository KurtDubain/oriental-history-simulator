import type { SimulationFact } from '../facts';
import { stableCompare, stableHash } from '../random';
import type { HistoryEvent } from '../types';
import { decodeArchiveBlock } from './codec';
import { buildArchiveHistorySummary, compareRecordIds } from './metadata';
import type {
  ArchiveCategoryCounts,
  ArchiveEventCategory,
  ArchiveImportanceCounts,
  ArchiveHistorySummary,
  ArchiveTerritoryDelta,
  ArchiveWorldState,
  WorldArchiveBlock,
} from './types';

export type WorldHistoryRelatedKind = 'character' | 'polity' | 'region';

export interface WorldHistoryRelatedRef {
  kind: WorldHistoryRelatedKind;
  id: string;
}

export interface WorldHistoryQueryFilters {
  query?: string;
  categories?: readonly ArchiveEventCategory[];
  minimumImportance?: number;
  relatedEntity?: WorldHistoryRelatedRef | null;
  throughTurn?: number;
  /** Chronicle kinds beginning with one of these prefixes are skipped. */
  excludedKindPrefixes?: readonly string[];
}

export interface WorldHistoryQueryCursor {
  signature: string;
  phase: 'active' | 'cold' | 'legacy';
  activeOffset: number;
  blockIndex: number;
  blockOffset: number;
  legacyOffset: number;
}

export interface WorldHistoryQueryInput extends WorldHistoryQueryFilters {
  cursor?: WorldHistoryQueryCursor | null;
  limit?: number;
  /** Maximum compressed blocks decoded by this synchronous slice. Defaults to one. */
  maxColdBlocks?: number;
}

export interface WorldHistoryQueryResult {
  events: HistoryEvent[];
  nextCursor: WorldHistoryQueryCursor | null;
  exhausted: boolean;
  decodedColdBlocks: number;
  skippedColdBlocks: number;
}

export interface WorldHistoryRelatedFacet extends WorldHistoryRelatedRef {
  eventCount: number;
}

export interface WorldHistoryMetadataSummary {
  throughTurn: number;
  eventCount: number;
  majorEventCount: number;
  categoryCounts: ArchiveCategoryCounts;
  importanceCounts: ArchiveImportanceCounts;
  eventsAtTurn: number;
  majorEventsAtTurn: number;
  categoryCountsAtTurn: ArchiveCategoryCounts;
}

export interface WorldTerritoryDeltaQuery {
  afterTurn?: number;
  throughTurn?: number;
}

export interface WorldTerritoryDeltaResult {
  deltas: ArchiveTerritoryDelta[];
  skippedFactIds: string[];
}

interface NormalizedHistoryFilters {
  query: string;
  tokens: string[];
  categories: ArchiveEventCategory[];
  categorySet: ReadonlySet<ArchiveEventCategory>;
  minimumImportance: 1 | 2 | 3 | 4 | 5;
  related: WorldHistoryRelatedRef | null;
  throughTurn: number;
  excludedKindPrefixes: string[];
}

function emptyImportanceCounts(): ArchiveImportanceCounts {
  return { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
}

function normalizeSearchText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/\s+/g, ' ').trim();
}

function clampTurn(world: ArchiveWorldState, value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return world.turn;
  return Math.max(0, Math.min(world.turn, Math.floor(value)));
}

function normalizeFilters(
  world: ArchiveWorldState,
  input: WorldHistoryQueryFilters,
): NormalizedHistoryFilters {
  const query = normalizeSearchText(input.query ?? '');
  const requestedImportance = Number.isFinite(input.minimumImportance)
    ? Math.floor(input.minimumImportance as number)
    : 1;
  const minimumImportance = Math.max(1, Math.min(5, requestedImportance)) as 1 | 2 | 3 | 4 | 5;
  const categories = [...new Set(input.categories ?? [])].sort(stableCompare);
  const related = input.relatedEntity && input.relatedEntity.id
    ? { kind: input.relatedEntity.kind, id: input.relatedEntity.id }
    : null;
  const excludedKindPrefixes = [...new Set(
    (input.excludedKindPrefixes ?? []).map((prefix) => prefix.trim()).filter(Boolean),
  )].sort(stableCompare);
  return {
    query,
    tokens: query.split(' ').filter(Boolean),
    categories,
    categorySet: new Set(categories),
    minimumImportance,
    related,
    throughTurn: clampTurn(world, input.throughTurn),
    excludedKindPrefixes,
  };
}

function sortedBlocks(world: ArchiveWorldState): WorldArchiveBlock[] {
  return (world.archiveSystem?.blocks ?? []).slice().sort((left, right) => (
    left.fromTurn - right.fromTurn || stableCompare(left.id, right.id)
  ));
}

function legacyHistory(world: ArchiveWorldState): HistoryEvent[] {
  const legacyCount = world.legacyArchiveBoundary?.historyEventCount ?? 0;
  return legacyCount > 0 ? world.history.slice(0, legacyCount) : [];
}

function activeHotHistory(world: ArchiveWorldState): HistoryEvent[] {
  const legacyCount = world.legacyArchiveBoundary?.historyEventCount ?? 0;
  const archivedThroughTurn = world.archiveSystem?.archivedThroughTurn ?? -1;
  return world.history.slice(legacyCount).filter((event) => event.turn > archivedThroughTurn);
}

function relatedIds(event: HistoryEvent): {
  character: Set<string>;
  polity: Set<string>;
  region: Set<string>;
} {
  const result = {
    character: new Set(event.actorIds),
    polity: new Set(event.polityIds),
    region: new Set(event.regionIds),
  };
  for (const reference of event.causes.flatMap((cause) => cause.refs ?? [])) {
    if (reference.entityType === 'character') result.character.add(reference.entityId);
    if (reference.entityType === 'polity') result.polity.add(reference.entityId);
    if (reference.entityType === 'region') result.region.add(reference.entityId);
  }
  return result;
}

function eventReferences(event: HistoryEvent, related: WorldHistoryRelatedRef): boolean {
  return relatedIds(event)[related.kind].has(related.id);
}

interface SearchNames {
  character: ReadonlyMap<string, string>;
  polity: ReadonlyMap<string, string>;
  region: ReadonlyMap<string, string>;
}

function buildSearchNames(world: ArchiveWorldState): SearchNames {
  return {
    character: new Map(world.characters.map((character) => [character.id, character.name])),
    polity: new Map(world.polities.map((polity) => [polity.id, `${polity.name} ${polity.shortName}`])),
    region: new Map(world.regions.map((region) => [region.id, region.name])),
  };
}

function eventSearchText(event: HistoryEvent, names: SearchNames): string {
  return normalizeSearchText([
    event.title,
    event.summary,
    event.category,
    event.kind,
    ...event.evidence,
    ...event.causes.flatMap((cause) => [
      cause.label,
      cause.evidence,
    ]),
    ...event.actorIds.map((id) => names.character.get(id) ?? ''),
    ...event.polityIds.map((id) => names.polity.get(id) ?? ''),
    ...event.regionIds.map((id) => names.region.get(id) ?? ''),
  ].join(' '));
}

function eventMatches(
  event: HistoryEvent,
  filters: NormalizedHistoryFilters,
  names: SearchNames | null,
): boolean {
  if (event.turn > filters.throughTurn || event.importance < filters.minimumImportance) return false;
  if (filters.excludedKindPrefixes.some((prefix) => event.kind.startsWith(prefix))) return false;
  if (filters.categorySet.size > 0 && !filters.categorySet.has(event.category)) return false;
  if (filters.related && !eventReferences(event, filters.related)) return false;
  if (filters.tokens.length === 0) return true;
  const searchText = eventSearchText(event, names as SearchNames);
  return filters.tokens.every((token) => searchText.includes(token));
}

function blockCouldMatch(
  block: WorldArchiveBlock,
  filters: NormalizedHistoryFilters,
): boolean {
  if (block.historyCount === 0 || block.fromTurn > filters.throughTurn) return false;
  const summary = block.historySummary;
  // Missing metadata belongs to a pre-summary development save. It remains
  // queryable, but cannot be rejected without inspecting its exact payload.
  if (!summary) return true;
  if (filters.categorySet.size > 0
    && !filters.categories.some((category) => (summary.categoryCounts[category] ?? 0) > 0)) {
    return false;
  }
  let importanceMatches = 0;
  for (let importance = filters.minimumImportance; importance <= 5; importance += 1) {
    importanceMatches += summary.importanceCounts[importance as 1 | 2 | 3 | 4 | 5] ?? 0;
  }
  if (importanceMatches === 0) return false;
  if (filters.related
    && (summary.relatedCounts[filters.related.kind][filters.related.id] ?? 0) === 0) {
    return false;
  }
  return true;
}

function historySummaryForBlock(block: WorldArchiveBlock): ArchiveHistorySummary {
  return block.historySummary ?? buildArchiveHistorySummary(decodeArchiveBlock(block).history);
}

function querySignature(
  world: ArchiveWorldState,
  filters: NormalizedHistoryFilters,
): string {
  return stableHash([
    'world-history-query-v1',
    world.seed,
    world.turn,
    world.historyDigest,
    world.archiveSystem?.archivedThroughTurn ?? -1,
    world.archiveSystem?.blocks.length ?? 0,
    filters.query,
    filters.categories,
    filters.minimumImportance,
    filters.related,
    filters.throughTurn,
    filters.excludedKindPrefixes,
  ]);
}

function initialCursor(signature: string, blockCount: number): WorldHistoryQueryCursor {
  return {
    signature,
    phase: 'active',
    activeOffset: 0,
    blockIndex: blockCount - 1,
    blockOffset: 0,
    legacyOffset: 0,
  };
}

function validateCursor(cursor: WorldHistoryQueryCursor, signature: string): void {
  if (cursor.signature !== signature) throw new Error('history query cursor does not match this world or filter');
  if (cursor.phase !== 'active' && cursor.phase !== 'cold' && cursor.phase !== 'legacy') {
    throw new Error('history query cursor is invalid');
  }
  if (!Number.isSafeInteger(cursor.blockIndex) || cursor.blockIndex < -1) {
    throw new Error('history query cursor is invalid');
  }
  for (const value of [cursor.activeOffset, cursor.blockOffset, cursor.legacyOffset]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('history query cursor is invalid');
  }
}

function copyCursor(cursor: WorldHistoryQueryCursor): WorldHistoryQueryCursor {
  return { ...cursor };
}

/**
 * Scans newest Chronicle records first. A synchronous call reads at most the
 * requested number of cold blocks, allowing the UI to yield between slices.
 */
export function queryWorldHistory(
  world: ArchiveWorldState,
  input: WorldHistoryQueryInput = {},
): WorldHistoryQueryResult {
  const filters = normalizeFilters(world, input);
  const blocks = sortedBlocks(world);
  const signature = querySignature(world, filters);
  const cursor = input.cursor
    ? copyCursor(input.cursor)
    : initialCursor(signature, blocks.length);
  validateCursor(cursor, signature);

  const hot = activeHotHistory(world);
  const legacy = legacyHistory(world);
  if (cursor.activeOffset > hot.length
    || cursor.blockIndex >= blocks.length
    || cursor.blockOffset < 0
    || cursor.legacyOffset > legacy.length) {
    throw new Error('history query cursor is invalid');
  }
  const requestedLimit = Number.isFinite(input.limit) ? Math.floor(input.limit as number) : 72;
  const requestedColdBlocks = Number.isFinite(input.maxColdBlocks)
    ? Math.floor(input.maxColdBlocks as number)
    : 1;
  const limit = Math.max(1, Math.min(500, requestedLimit));
  const maximumColdBlocks = Math.max(0, Math.min(16, requestedColdBlocks));
  const names = filters.tokens.length > 0 ? buildSearchNames(world) : null;
  const events: HistoryEvent[] = [];
  let decodedColdBlocks = 0;
  let skippedColdBlocks = 0;

  while (events.length < limit) {
    if (cursor.phase === 'active') {
      while (cursor.activeOffset < hot.length && events.length < limit) {
        const event = hot[hot.length - 1 - cursor.activeOffset] as HistoryEvent;
        cursor.activeOffset += 1;
        if (eventMatches(event, filters, names)) events.push(event);
      }
      if (cursor.activeOffset >= hot.length) cursor.phase = 'cold';
      if (events.length >= limit) break;
      continue;
    }

    if (cursor.phase === 'cold') {
      if (cursor.blockIndex < 0) {
        cursor.phase = 'legacy';
        continue;
      }
      const block = blocks[cursor.blockIndex];
      if (!block) {
        cursor.blockIndex -= 1;
        cursor.blockOffset = 0;
        continue;
      }
      if (!blockCouldMatch(block, filters)) {
        skippedColdBlocks += 1;
        cursor.blockIndex -= 1;
        cursor.blockOffset = 0;
        continue;
      }
      if (decodedColdBlocks >= maximumColdBlocks) break;

      const history = decodeArchiveBlock(block).history;
      decodedColdBlocks += 1;
      while (cursor.blockOffset < history.length && events.length < limit) {
        const event = history[history.length - 1 - cursor.blockOffset] as HistoryEvent;
        cursor.blockOffset += 1;
        if (eventMatches(event, filters, names)) events.push(event);
      }
      if (cursor.blockOffset >= history.length) {
        cursor.blockIndex -= 1;
        cursor.blockOffset = 0;
      }
      if (events.length >= limit || decodedColdBlocks >= maximumColdBlocks) break;
      continue;
    }

    while (cursor.legacyOffset < legacy.length && events.length < limit) {
      const event = legacy[legacy.length - 1 - cursor.legacyOffset] as HistoryEvent;
      cursor.legacyOffset += 1;
      if (eventMatches(event, filters, names)) events.push(event);
    }
    if (cursor.legacyOffset >= legacy.length) {
      return {
        events,
        nextCursor: null,
        exhausted: true,
        decodedColdBlocks,
        skippedColdBlocks,
      };
    }
  }

  if (cursor.phase === 'cold' && cursor.blockIndex < 0) cursor.phase = 'legacy';
  if (cursor.phase === 'legacy' && cursor.legacyOffset >= legacy.length) {
    return {
      events,
      nextCursor: null,
      exhausted: true,
      decodedColdBlocks,
      skippedColdBlocks,
    };
  }
  return {
    events,
    nextCursor: cursor,
    exhausted: false,
    decodedColdBlocks,
    skippedColdBlocks,
  };
}

function addRelatedEvent(counts: Map<string, number>, event: HistoryEvent): void {
  const related = relatedIds(event);
  for (const kind of ['character', 'polity', 'region'] as const) {
    for (const id of related[kind]) {
      const key = `${kind}:${id}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
}

/** Returns exact related-object facets without decoding any summarized cold block. */
export function readWorldHistoryRelatedFacets(
  world: ArchiveWorldState,
): WorldHistoryRelatedFacet[] {
  const counts = new Map<string, number>();
  for (const block of sortedBlocks(world)) {
    const summary = historySummaryForBlock(block);
    for (const kind of ['character', 'polity', 'region'] as const) {
      for (const [id, count] of Object.entries(summary.relatedCounts[kind])) {
        const key = `${kind}:${id}`;
        counts.set(key, (counts.get(key) ?? 0) + count);
      }
    }
  }
  for (const event of [...legacyHistory(world), ...activeHotHistory(world)]) addRelatedEvent(counts, event);
  return [...counts.entries()]
    .map(([key, eventCount]) => {
      const separator = key.indexOf(':');
      return {
        kind: key.slice(0, separator) as WorldHistoryRelatedKind,
        id: key.slice(separator + 1),
        eventCount,
      };
    })
    .sort((left, right) => (
      stableCompare(left.kind, right.kind)
      || right.eventCount - left.eventCount
      || stableCompare(left.id, right.id)
    ));
}

function addCategoryCounts(
  target: ArchiveCategoryCounts,
  source: ArchiveCategoryCounts,
): void {
  for (const [category, count] of Object.entries(source)) {
    const typedCategory = category as ArchiveEventCategory;
    target[typedCategory] = (target[typedCategory] ?? 0) + count;
  }
}

function addImportanceCounts(
  target: ArchiveImportanceCounts,
  source: ArchiveImportanceCounts,
): void {
  for (let importance = 1; importance <= 5; importance += 1) {
    const typedImportance = importance as 1 | 2 | 3 | 4 | 5;
    target[typedImportance] += source[typedImportance] ?? 0;
  }
}

function addEventToSummary(
  summary: WorldHistoryMetadataSummary,
  event: HistoryEvent,
): void {
  if (event.turn > summary.throughTurn) return;
  summary.eventCount += 1;
  if (event.importance >= 4) summary.majorEventCount += 1;
  summary.categoryCounts[event.category] = (summary.categoryCounts[event.category] ?? 0) + 1;
  summary.importanceCounts[event.importance] += 1;
  if (event.turn !== summary.throughTurn) return;
  summary.eventsAtTurn += 1;
  if (event.importance >= 4) summary.majorEventsAtTurn += 1;
  summary.categoryCountsAtTurn[event.category] = (summary.categoryCountsAtTurn[event.category] ?? 0) + 1;
}

/** Builds exact time/category/importance totals from block metadata only. */
export function summarizeWorldHistory(
  world: ArchiveWorldState,
  throughTurn: number = world.turn,
): WorldHistoryMetadataSummary {
  const targetTurn = clampTurn(world, throughTurn);
  const result: WorldHistoryMetadataSummary = {
    throughTurn: targetTurn,
    eventCount: 0,
    majorEventCount: 0,
    categoryCounts: {},
    importanceCounts: emptyImportanceCounts(),
    eventsAtTurn: 0,
    majorEventsAtTurn: 0,
    categoryCountsAtTurn: {},
  };

  for (const block of sortedBlocks(world)) {
    const summary = historySummaryForBlock(block);
    for (const [turnKey, turnSummary] of Object.entries(summary.byTurn)) {
      const turn = Number(turnKey);
      if (turn > targetTurn) continue;
      result.eventCount += turnSummary.eventCount;
      result.majorEventCount += turnSummary.majorEventCount;
      addCategoryCounts(result.categoryCounts, turnSummary.categoryCounts);
      addImportanceCounts(result.importanceCounts, turnSummary.importanceCounts);
      if (turn !== targetTurn) continue;
      result.eventsAtTurn += turnSummary.eventCount;
      result.majorEventsAtTurn += turnSummary.majorEventCount;
      addCategoryCounts(result.categoryCountsAtTurn, turnSummary.categoryCounts);
    }
  }
  for (const event of [...legacyHistory(world), ...activeHotHistory(world)]) addEventToSummary(result, event);
  return result;
}

function territoryDeltaFromFact(
  fact: Extract<SimulationFact, { kind: 'territory_control_changed' }>,
): ArchiveTerritoryDelta | null {
  const payload = fact.payload;
  if (!payload
    || typeof payload !== 'object'
    || typeof payload.regionId !== 'string'
    || typeof payload.previousControllerId !== 'string'
    || typeof payload.nextControllerId !== 'string'
    || (payload.warId !== null && typeof payload.warId !== 'string')) {
    return null;
  }
  return {
    factId: fact.id,
    turn: fact.turn,
    regionId: fact.payload.regionId,
    previousControllerId: fact.payload.previousControllerId,
    nextControllerId: fact.payload.nextControllerId,
    reason: fact.payload.reason,
    warId: fact.payload.warId,
  };
}

/** Returns exact territorial controller deltas without decoding cold payloads. */
export function readWorldTerritoryDeltas(
  world: ArchiveWorldState,
  query: WorldTerritoryDeltaQuery = {},
): WorldTerritoryDeltaResult {
  const afterTurn = Number.isFinite(query.afterTurn) ? Math.floor(query.afterTurn as number) : -1;
  const throughTurn = clampTurn(world, query.throughTurn);
  const result: ArchiveTerritoryDelta[] = [];
  const skippedFactIds: string[] = [];
  const seen = new Set<string>();
  const add = (delta: ArchiveTerritoryDelta) => {
    if (delta.turn <= afterTurn || delta.turn > throughTurn || seen.has(delta.factId)) return;
    seen.add(delta.factId);
    result.push({ ...delta });
  };
  for (const block of sortedBlocks(world)) {
    for (const delta of block.territoryDeltas) add(delta);
  }
  const archivedThroughTurn = world.archiveSystem?.archivedThroughTurn ?? -1;
  for (const fact of world.facts) {
    if (fact.turn <= archivedThroughTurn || fact.kind !== 'territory_control_changed') continue;
    const delta = territoryDeltaFromFact(fact);
    if (delta) add(delta);
    else skippedFactIds.push(fact.id);
  }
  return {
    deltas: result.sort((left, right) => (
      left.turn - right.turn || compareRecordIds(left.factId, right.factId)
    )),
    skippedFactIds: skippedFactIds.sort(compareRecordIds),
  };
}
