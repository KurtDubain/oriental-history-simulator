import type {
  EventCategory,
  HistoryEvent,
  Season,
  WorldState,
} from '../sim/types';
import {
  readWorldHistory,
  readWorldHistoryRelatedFacets,
  readWorldTerritoryDeltas,
  summarizeWorldHistory,
} from '../sim/archive';
import { isDefaultVisibleHistoryEvent } from './history-visibility';

export const HISTORY_EVENT_CATEGORIES = [
  '世界',
  '人口',
  '经济',
  '政治',
  '军事',
  '外交',
  '海洋',
  '疾病',
  '知识',
  '迁徙',
] as const satisfies readonly EventCategory[];

const SEASONS = ['春', '夏', '秋', '冬'] as const satisfies readonly Season[];

export type HistoryRelatedKind = 'character' | 'polity' | 'region';

export interface HistoryRelatedEntityRef {
  kind: HistoryRelatedKind;
  id: string;
}

export interface HistoryRelatedEntityOption extends HistoryRelatedEntityRef {
  label: string;
  eventCount: number;
}

export interface HistoryEventFilters {
  query?: string;
  categories?: readonly EventCategory[];
  minimumImportance?: number;
  relatedEntity?: HistoryRelatedEntityRef | null;
  throughTurn?: number;
}

export interface HistoricalPolityView {
  id: string;
  name: string;
  shortName: string;
  color: string;
  regionCount: number;
}

export interface HistoricalEventStats {
  eventsThroughTurn: number;
  eventsAtTurn: number;
  majorEventsThroughTurn: number;
  majorEventsAtTurn: number;
  controllerChangesThroughTurn: number;
  categoryCountsThroughTurn: Record<EventCategory, number>;
  categoryCountsAtTurn: Record<EventCategory, number>;
}

export interface HistoricalTerritoryView {
  turn: number;
  year: number;
  season: Season;
  controllerByRegionId: Record<string, string>;
  extantPolities: HistoricalPolityView[];
  historyStats: HistoricalEventStats;
  reversedControllerChanges: number;
  skippedControllerChanges: number;
  confidence: 'complete' | 'partial';
}

export function clampHistoryTurn(world: WorldState, turn: number): number {
  if (!Number.isFinite(turn)) return world.turn;
  return Math.max(0, Math.min(world.turn, Math.floor(turn)));
}

export function historyTurnDate(turn: number): { year: number; season: Season; label: string } {
  const safeTurn = Math.max(0, Number.isFinite(turn) ? Math.floor(turn) : 0);
  const year = Math.floor(safeTurn / 4) + 1;
  const season = SEASONS[safeTurn % SEASONS.length];
  return { year, season, label: `第 ${year} 年 · ${season}季` };
}

function emptyCategoryCounts(): Record<EventCategory, number> {
  return Object.fromEntries(HISTORY_EVENT_CATEGORIES.map((category) => [category, 0])) as Record<EventCategory, number>;
}

function completeCategoryCounts(
  counts: Readonly<Partial<Record<EventCategory, number>>>,
): Record<EventCategory, number> {
  const complete = emptyCategoryCounts();
  for (const category of HISTORY_EVENT_CATEGORIES) complete[category] = counts[category] ?? 0;
  return complete;
}

function isHistoricalPolityExtant(world: WorldState, polityId: string, turn: number): boolean {
  const polity = world.polities.find((item) => item.id === polityId);
  if (!polity || polity.foundedTurn > turn) return false;
  return polity.eliminatedTurn === null || polity.eliminatedTurn > turn;
}

/**
 * Rebuilds the territorial ownership visible immediately after `targetTurn`.
 * It starts from the authoritative current state and reverses only recorded
 * region controller deltas that happened later, leaving the world untouched.
 */
export function reconstructHistoricalTerritory(
  world: WorldState,
  targetTurn: number,
): HistoricalTerritoryView {
  const turn = clampHistoryTurn(world, targetTurn);
  const controllerByRegionId = Object.fromEntries(
    world.regions.map((region) => [region.id, region.controllerId]),
  );
  const regionIds = new Set(world.regions.map((region) => region.id));
  let reversedControllerChanges = 0;
  let skippedControllerChanges = 0;
  const rawFacts = (world as unknown as { facts?: unknown }).facts;
  const hasFactArchive = Array.isArray(rawFacts);
  const boundary = hasFactArchive && world.legacyArchiveBoundary ? world.legacyArchiveBoundary : null;
  const legacyEventCount = hasFactArchive ? boundary?.historyEventCount ?? 0 : world.history.length;
  const legacyEvents = world.history.slice(0, legacyEventCount);
  const territory = hasFactArchive
    ? readWorldTerritoryDeltas(world, { throughTurn: world.turn })
    : { deltas: [], skippedFactIds: [] };
  const activeFactById = new Map((hasFactArchive ? world.facts : []).map((fact) => [fact.id, fact]));

  // Schema 4 territory facts are authoritative. Chronicle events linked to
  // them are deliberately not replayed, preventing one control transfer from
  // being reversed twice merely because its prose was also projected.
  for (let index = territory.deltas.length - 1; index >= 0; index -= 1) {
    const delta = territory.deltas[index];
    if (delta.turn <= turn) continue;
    if (!regionIds.has(delta.regionId)) {
      skippedControllerChanges += 1;
      continue;
    }
    controllerByRegionId[delta.regionId] = delta.previousControllerId;
    reversedControllerChanges += 1;
  }
  skippedControllerChanges += territory.skippedFactIds.filter((factId) => {
    const fact = activeFactById.get(factId);
    return fact && fact.turn > turn;
  }).length;

  const reverseLegacyEvents = !hasFactArchive || (boundary !== null && turn < boundary.turn);
  if (reverseLegacyEvents) {
    for (let eventIndex = legacyEvents.length - 1; eventIndex >= 0; eventIndex -= 1) {
      const event = legacyEvents[eventIndex];
      if (event.turn <= turn) continue;

      for (let deltaIndex = event.stateDeltas.length - 1; deltaIndex >= 0; deltaIndex -= 1) {
        const delta = event.stateDeltas[deltaIndex];
        if (delta.entityType !== 'region' || delta.field !== 'controllerId') continue;
        if (!regionIds.has(delta.entityId) || typeof delta.before !== 'string') {
          skippedControllerChanges += 1;
          continue;
        }
        controllerByRegionId[delta.entityId] = delta.before;
        reversedControllerChanges += 1;
      }
    }
  }

  const regionCountByPolity = new Map<string, number>();
  for (const controllerId of Object.values(controllerByRegionId)) {
    regionCountByPolity.set(controllerId, (regionCountByPolity.get(controllerId) ?? 0) + 1);
  }

  const extantPolities = world.polities
    .filter((polity) => isHistoricalPolityExtant(world, polity.id, turn))
    .map((polity) => ({
      id: polity.id,
      name: polity.name,
      shortName: polity.shortName,
      color: polity.color,
      regionCount: regionCountByPolity.get(polity.id) ?? 0,
    }))
    .sort((left, right) => right.regionCount - left.regionCount || left.name.localeCompare(right.name, 'zh-CN'));

  const historySummary = summarizeWorldHistory(world, turn);
  let controllerChangesThroughTurn = territory.deltas.filter((delta) => delta.turn <= turn).length;
  controllerChangesThroughTurn += territory.skippedFactIds.filter((factId) => {
    const fact = activeFactById.get(factId);
    return fact && fact.turn <= turn;
  }).length;
  controllerChangesThroughTurn += legacyEvents
    .filter((event) => event.turn <= turn)
    .reduce((total, event) => total + event.stateDeltas.filter(
      (delta) => delta.entityType === 'region' && delta.field === 'controllerId',
    ).length, 0);

  const date = historyTurnDate(turn);
  return {
    turn,
    year: date.year,
    season: date.season,
    controllerByRegionId,
    extantPolities,
    historyStats: {
      eventsThroughTurn: historySummary.eventCount,
      eventsAtTurn: historySummary.eventsAtTurn,
      majorEventsThroughTurn: historySummary.majorEventCount,
      majorEventsAtTurn: historySummary.majorEventsAtTurn,
      controllerChangesThroughTurn,
      categoryCountsThroughTurn: completeCategoryCounts(historySummary.categoryCounts),
      categoryCountsAtTurn: completeCategoryCounts(historySummary.categoryCountsAtTurn),
    },
    reversedControllerChanges,
    skippedControllerChanges,
    confidence: skippedControllerChanges === 0 ? 'complete' : 'partial',
  };
}

function normalizeSearchText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/\s+/g, ' ').trim();
}

function eventReferencesEntity(event: HistoryEvent, entity: HistoryRelatedEntityRef): boolean {
  if (entity.kind === 'character' && event.actorIds.includes(entity.id)) return true;
  if (entity.kind === 'polity' && event.polityIds.includes(entity.id)) return true;
  if (entity.kind === 'region' && event.regionIds.includes(entity.id)) return true;
  const evidenceType = entity.kind === 'character' ? 'character' : entity.kind;
  return event.causes.some((cause) => cause.refs?.some(
    (reference) => reference.entityType === evidenceType && reference.entityId === entity.id,
  ));
}

function buildEventSearchText(
  event: HistoryEvent,
  characterNames: ReadonlyMap<string, string>,
  polityNames: ReadonlyMap<string, string>,
  regionNames: ReadonlyMap<string, string>,
): string {
  return normalizeSearchText([
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
}

/** Searches immutable history and returns newest matches first. */
export function filterHistoryEvents(
  world: WorldState,
  filters: HistoryEventFilters = {},
): HistoryEvent[] {
  const throughTurn = clampHistoryTurn(world, filters.throughTurn ?? world.turn);
  const requestedImportance = filters.minimumImportance ?? 1;
  const minimumImportance = Number.isFinite(requestedImportance)
    ? Math.max(1, Math.min(5, Math.floor(requestedImportance)))
    : 1;
  const categorySet = new Set(filters.categories ?? []);
  const tokens = normalizeSearchText(filters.query ?? '').split(' ').filter(Boolean);
  const characterNames = new Map(world.characters.map((character) => [character.id, character.name]));
  const polityNames = new Map(world.polities.map((polity) => [polity.id, `${polity.name} ${polity.shortName}`]));
  const regionNames = new Map(world.regions.map((region) => [region.id, region.name]));

  return readWorldHistory(world)
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => {
      if (!isDefaultVisibleHistoryEvent(event)) return false;
      if (event.turn > throughTurn || event.importance < minimumImportance) return false;
      if (categorySet.size > 0 && !categorySet.has(event.category)) return false;
      if (filters.relatedEntity && !eventReferencesEntity(event, filters.relatedEntity)) return false;
      if (!tokens.length) return true;
      const searchText = buildEventSearchText(event, characterNames, polityNames, regionNames);
      return tokens.every((token) => searchText.includes(token));
    })
    .sort((left, right) => right.event.turn - left.event.turn || right.index - left.index)
    .map(({ event }) => event);
}

export function buildHistoryRelatedEntities(
  world: WorldState,
  source: 'visible-hot' | 'archive-metadata' = 'visible-hot',
): HistoryRelatedEntityOption[] {
  const counts = source === 'archive-metadata'
    ? new Map(readWorldHistoryRelatedFacets(world).map((facet) => [
        `${facet.kind}:${facet.id}`,
        facet.eventCount,
      ]))
    : new Map<string, number>();
  if (source === 'visible-hot') {
    for (const event of world.history) {
      if (!isDefaultVisibleHistoryEvent(event)) continue;
      const related = new Set<string>();
      for (const id of event.actorIds) related.add(`character:${id}`);
      for (const id of event.polityIds) related.add(`polity:${id}`);
      for (const id of event.regionIds) related.add(`region:${id}`);
      for (const reference of event.causes.flatMap((cause) => cause.refs ?? [])) {
        if (reference.entityType === 'character'
          || reference.entityType === 'polity'
          || reference.entityType === 'region') {
          related.add(`${reference.entityType}:${reference.entityId}`);
        }
      }
      for (const key of related) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  const options: HistoryRelatedEntityOption[] = [];
  for (const character of world.characters) {
    const eventCount = counts.get(`character:${character.id}`) ?? 0;
    if (eventCount > 0) options.push({ kind: 'character', id: character.id, label: character.name, eventCount });
  }
  for (const polity of world.polities) {
    const eventCount = counts.get(`polity:${polity.id}`) ?? 0;
    if (eventCount > 0) options.push({ kind: 'polity', id: polity.id, label: polity.name, eventCount });
  }
  for (const region of world.regions) {
    const eventCount = counts.get(`region:${region.id}`) ?? 0;
    if (eventCount > 0) options.push({ kind: 'region', id: region.id, label: region.name, eventCount });
  }
  return options.sort((left, right) => (
    left.kind.localeCompare(right.kind)
    || right.eventCount - left.eventCount
    || left.label.localeCompare(right.label, 'zh-CN')
  ));
}

export function encodeHistoryRelatedEntity(entity: HistoryRelatedEntityRef): string {
  return `${entity.kind}:${entity.id}`;
}

export function decodeHistoryRelatedEntity(value: string): HistoryRelatedEntityRef | null {
  const separator = value.indexOf(':');
  if (separator <= 0) return null;
  const kind = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (!id || (kind !== 'character' && kind !== 'polity' && kind !== 'region')) return null;
  return { kind, id };
}
