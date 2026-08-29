import type { InspectorRecord, HistoricalSceneView } from '../components/Inspector';
import type { ArchiveLink, ArchiveRecord } from '../components/HistoricalArchive';
import type { HistoryEvent, WorldState } from '../sim/types';
import type {
  PoliticalPowerMovement,
  PoliticalPowerResource,
} from '../sim/politics/power-ledger';
import type { HistoricalScene } from './historical-scenes';

export const compact = new Intl.NumberFormat('zh-CN', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

const SEASON_NAMES = ['春', '夏', '秋', '冬'] as const;

export function worldFamilies(world: WorldState) {
  return Array.isArray(world.families) ? world.families : [];
}

export function worldRelationships(world: WorldState) {
  return Array.isArray(world.relationships) ? world.relationships : [];
}

export function worldFactions(world: WorldState) {
  return Array.isArray(world.factions) ? world.factions : [];
}

export function worldDiplomacy(world: WorldState) {
  return Array.isArray(world.diplomacy) ? world.diplomacy : [];
}

export function worldOffices(world: WorldState) {
  return Array.isArray(world.offices) ? world.offices : [];
}

export function turnLabel(turn: number) {
  const safeTurn = Math.max(0, Number.isFinite(turn) ? Math.floor(turn) : 0);
  return `第 ${Math.floor(safeTurn / 4) + 1} 年 · ${SEASON_NAMES[safeTurn % 4]}`;
}

export function sourceEventIdForFact(world: WorldState, factId: string): string | null {
  return [...world.history]
    .filter((event) => event.sourceFactIds.includes(factId))
    .sort((left, right) => right.turn - left.turn || right.id.localeCompare(left.id))[0]?.id ?? null;
}

export function toHistoricalSceneView(scene: HistoricalScene): HistoricalSceneView {
  return {
    id: scene.id,
    periodLabel: scene.dateLabel,
    title: scene.title,
    summary: scene.summary,
    result: scene.result,
    sourceEventId: scene.historyEventIds[0] ?? null,
  };
}

export function toPowerResourceView(world: WorldState, resource: PoliticalPowerResource) {
  const sourceFactId = resource.evidence.find((item) => item.entityType === 'fact')?.entityId;
  return {
    id: resource.id,
    category: resource.category,
    label: resource.label,
    detail: resource.detail,
    value: resource.value,
    sourceEventId: sourceFactId ? sourceEventIdForFact(world, sourceFactId) : null,
  };
}

export function toPowerMovementView(world: WorldState, movement: PoliticalPowerMovement) {
  return {
    id: movement.id,
    periodLabel: turnLabel(movement.turn),
    direction: movement.direction,
    label: movement.label,
    detail: movement.detail,
    sourceEventId: sourceEventIdForFact(world, movement.factId),
  };
}

export function family(world: WorldState, id: string | null | undefined) {
  if (!id) return undefined;
  return worldFamilies(world).find((candidate) => candidate.id === id);
}

export function livingCharacter(world: WorldState, id: string | null | undefined) {
  if (!id) return undefined;
  return world.characters.find((candidate) => candidate.id === id && candidate.alive);
}

export function character(world: WorldState, id: string | null | undefined) {
  if (!id) return undefined;
  return world.characters.find((candidate) => candidate.id === id);
}

export function polity(world: WorldState, id: string | null | undefined) {
  if (!id) return undefined;
  return world.polities.find((candidate) => candidate.id === id);
}

export function region(world: WorldState, id: string | null | undefined) {
  if (!id) return undefined;
  return world.regions.find((candidate) => candidate.id === id);
}

export function historyRecord(item: HistoryEvent): InspectorRecord {
  return {
    id: item.id,
    date: `第 ${item.year} 年 · ${item.season}`,
    title: item.title,
    summary: item.summary,
    eventId: item.id,
    importance: item.importance,
  };
}

export function scopedHistory(
  world: WorldState,
  predicate: (event: HistoryEvent) => boolean,
  limit = 8,
) {
  return world.history.filter(predicate).slice(-limit).reverse().map(historyRecord);
}

export function uniqueArchiveLinks(links: Array<ArchiveLink | null | undefined>) {
  const seen = new Set<string>();
  return links.filter((link): link is ArchiveLink => {
    if (!link) return false;
    const key = `${link.kind}:${link.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function eventArchiveRecord(item: HistoryEvent): ArchiveRecord {
  return {
    id: item.id,
    date: `第 ${item.year} 年 · ${item.season}`,
    title: item.title,
    summary: item.summary,
    importance: item.importance,
    eventId: item.id,
  };
}

