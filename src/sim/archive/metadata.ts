import { stableCompare, stableHash } from '../random';
import type { SimulationFact } from '../facts';
import type { HistoryEvent } from '../types';
import { encodeArchivePayload } from './codec';
import type {
  ArchiveCategoryCounts,
  ArchiveCountIndex,
  ArchiveDigestCheckpoint,
  ArchiveHistorySummary,
  ArchiveHistoryTurnSummary,
  ArchiveImportanceCounts,
  ArchiveImportantEventPreview,
  ArchiveRecordIndex,
  ArchiveTerritoryDelta,
  WorldArchiveBlock,
  WorldArchiveBlockIndexes,
  WorldArchiveBlockPayload,
} from './types';
import { WORLD_ARCHIVE_VERSION } from './types';

export function compareRecordIds(left: string, right: string): number {
  const leftMatch = /^(.*_)(\d+)$/.exec(left);
  const rightMatch = /^(.*_)(\d+)$/.exec(right);
  if (leftMatch && rightMatch && leftMatch[1] === rightMatch[1]) {
    const ordinalDifference = Number(leftMatch[2]) - Number(rightMatch[2]);
    if (ordinalDifference !== 0) return ordinalDifference;
  }
  return stableCompare(left, right);
}

export function extendFactDigest(digest: string, fact: SimulationFact): string {
  return stableHash([digest, fact]);
}

export function extendHistoryDigest(
  digest: string,
  priorCount: number,
  event: HistoryEvent,
): string {
  return priorCount === 0 ? stableHash(event) : stableHash([digest, event]);
}

function addIndex(index: Map<string, Set<string>>, key: string, recordId: string): void {
  let records = index.get(key);
  if (!records) {
    records = new Set<string>();
    index.set(key, records);
  }
  records.add(recordId);
}

function finishIndex(index: Map<string, Set<string>>): ArchiveRecordIndex {
  return Object.fromEntries(
    [...index.entries()]
      .sort(([left], [right]) => stableCompare(left, right))
      .map(([key, records]) => [key, [...records].sort(compareRecordIds)]),
  );
}

export function buildArchiveIndexes(payload: WorldArchiveBlockPayload): WorldArchiveBlockIndexes {
  const actors = new Map<string, Set<string>>();
  const polities = new Map<string, Set<string>>();
  const regions = new Map<string, Set<string>>();
  const kinds = new Map<string, Set<string>>();
  const categories = new Map<string, Set<string>>();
  for (const record of [...payload.facts, ...payload.history]) {
    for (const actorId of record.actorIds) addIndex(actors, actorId, record.id);
    for (const polityId of record.polityIds) addIndex(polities, polityId, record.id);
    for (const regionId of record.regionIds) addIndex(regions, regionId, record.id);
    addIndex(kinds, record.kind, record.id);
    addIndex(categories, record.category, record.id);
  }
  return {
    actor: finishIndex(actors),
    polity: finishIndex(polities),
    region: finishIndex(regions),
    kind: finishIndex(kinds),
    category: finishIndex(categories),
  };
}

function emptyImportanceCounts(): ArchiveImportanceCounts {
  return { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
}

function addCategoryCount(
  counts: ArchiveCategoryCounts,
  category: HistoryEvent['category'],
): void {
  counts[category] = (counts[category] ?? 0) + 1;
}

function addCount(index: Map<string, number>, id: string): void {
  index.set(id, (index.get(id) ?? 0) + 1);
}

function finishCountIndex(index: Map<string, number>): ArchiveCountIndex {
  return Object.fromEntries(
    [...index.entries()].sort(([left], [right]) => stableCompare(left, right)),
  );
}

function historyRelatedIds(event: HistoryEvent): {
  character: Set<string>;
  polity: Set<string>;
  region: Set<string>;
} {
  const related = {
    character: new Set(event.actorIds),
    polity: new Set(event.polityIds),
    region: new Set(event.regionIds),
  };
  for (const reference of event.causes.flatMap((cause) => cause.refs ?? [])) {
    if (reference.entityType === 'character') related.character.add(reference.entityId);
    if (reference.entityType === 'polity') related.polity.add(reference.entityId);
    if (reference.entityType === 'region') related.region.add(reference.entityId);
  }
  return related;
}

/** Builds exact metadata-only Chronicle facets for one immutable block. */
export function buildArchiveHistorySummary(
  history: readonly HistoryEvent[],
): ArchiveHistorySummary {
  const categoryCounts: ArchiveCategoryCounts = {};
  const importanceCounts = emptyImportanceCounts();
  const characterCounts = new Map<string, number>();
  const polityCounts = new Map<string, number>();
  const regionCounts = new Map<string, number>();
  const byTurn: Record<string, ArchiveHistoryTurnSummary> = {};
  let majorEventCount = 0;

  for (const event of history) {
    addCategoryCount(categoryCounts, event.category);
    importanceCounts[event.importance] += 1;
    if (event.importance >= 4) majorEventCount += 1;

    const turnKey = String(event.turn);
    const turnSummary = byTurn[turnKey] ?? {
      eventCount: 0,
      majorEventCount: 0,
      categoryCounts: {},
      importanceCounts: emptyImportanceCounts(),
    };
    turnSummary.eventCount += 1;
    if (event.importance >= 4) turnSummary.majorEventCount += 1;
    addCategoryCount(turnSummary.categoryCounts, event.category);
    turnSummary.importanceCounts[event.importance] += 1;
    byTurn[turnKey] = turnSummary;

    const related = historyRelatedIds(event);
    for (const id of related.character) addCount(characterCounts, id);
    for (const id of related.polity) addCount(polityCounts, id);
    for (const id of related.region) addCount(regionCounts, id);
  }

  return {
    eventCount: history.length,
    majorEventCount,
    categoryCounts,
    importanceCounts,
    relatedCounts: {
      character: finishCountIndex(characterCounts),
      polity: finishCountIndex(polityCounts),
      region: finishCountIndex(regionCounts),
    },
    byTurn,
  };
}

export function buildTerritoryDeltas(facts: readonly SimulationFact[]): ArchiveTerritoryDelta[] {
  return facts
    .filter((fact): fact is Extract<SimulationFact, { kind: 'territory_control_changed' }> => (
      fact.kind === 'territory_control_changed'
    ))
    .map((fact) => ({
      factId: fact.id,
      turn: fact.turn,
      regionId: fact.payload.regionId,
      previousControllerId: fact.payload.previousControllerId,
      nextControllerId: fact.payload.nextControllerId,
      reason: fact.payload.reason,
      warId: fact.payload.warId,
    }));
}

export function buildImportantEventPreviews(
  history: readonly HistoryEvent[],
): ArchiveImportantEventPreview[] {
  const selected = history
    .filter((event) => event.importance >= 3)
    .slice()
    .sort((left, right) => (
      right.importance - left.importance
      || right.turn - left.turn
      || stableCompare(left.id, right.id)
    ))
    .slice(0, 8)
    .sort((left, right) => left.turn - right.turn || stableCompare(left.id, right.id));
  return selected.map((event) => ({
    eventId: event.id,
    turn: event.turn,
    category: event.category,
    kind: event.kind,
    importance: event.importance,
    title: event.title,
    summary: event.summary,
    actorIds: [...event.actorIds],
    polityIds: [...event.polityIds],
    regionIds: [...event.regionIds],
  }));
}

export interface CreateArchiveBlockInput {
  fromTurn: number;
  throughTurn: number;
  facts: SimulationFact[];
  history: HistoryEvent[];
  beforeFactCount: number;
  beforeHistoryCount: number;
  beforeFactDigest: string;
  beforeHistoryDigest: string;
  digestCheckpoint?: ArchiveDigestCheckpoint;
}

export function createArchiveBlock(input: CreateArchiveBlockInput): WorldArchiveBlock {
  const payload: WorldArchiveBlockPayload = {
    facts: input.facts,
    history: input.history,
  };
  const afterFactCount = input.beforeFactCount + input.facts.length;
  const afterHistoryCount = input.beforeHistoryCount + input.history.length;
  const checkpoint = input.digestCheckpoint;
  const canReuseCheckpoint = checkpoint?.throughTurn === input.throughTurn
    && checkpoint.factCount === afterFactCount
    && checkpoint.historyCount === afterHistoryCount;
  let afterFactDigest = input.beforeFactDigest;
  let afterHistoryDigest = input.beforeHistoryDigest;
  if (canReuseCheckpoint) {
    afterFactDigest = checkpoint.factDigest;
    afterHistoryDigest = checkpoint.historyDigest;
  } else {
    for (const fact of input.facts) afterFactDigest = extendFactDigest(afterFactDigest, fact);
    let historyCount = input.beforeHistoryCount;
    for (const event of input.history) {
      afterHistoryDigest = extendHistoryDigest(afterHistoryDigest, historyCount, event);
      historyCount += 1;
    }
  }
  const encoded = encodeArchivePayload(payload);
  return {
    version: WORLD_ARCHIVE_VERSION,
    id: `archive_${String(input.fromTurn).padStart(7, '0')}_${String(input.throughTurn).padStart(7, '0')}_${encoded.payloadDigest}`,
    fromTurn: input.fromTurn,
    throughTurn: input.throughTurn,
    factCount: input.facts.length,
    historyCount: input.history.length,
    firstFactId: input.facts[0]?.id ?? null,
    lastFactId: input.facts.at(-1)?.id ?? null,
    firstEventId: input.history[0]?.id ?? null,
    lastEventId: input.history.at(-1)?.id ?? null,
    beforeFactCount: input.beforeFactCount,
    afterFactCount,
    beforeHistoryCount: input.beforeHistoryCount,
    afterHistoryCount,
    beforeFactDigest: input.beforeFactDigest,
    afterFactDigest,
    beforeHistoryDigest: input.beforeHistoryDigest,
    afterHistoryDigest,
    indexes: buildArchiveIndexes(payload),
    historySummary: buildArchiveHistorySummary(input.history),
    territoryDeltas: buildTerritoryDeltas(input.facts),
    importantEventPreviews: buildImportantEventPreviews(input.history),
    ...encoded,
  };
}
