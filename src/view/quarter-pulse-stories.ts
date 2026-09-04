import type { HistoryEvent, SimulationFact, WorldState } from '../sim/types';
import { projectCoreImpacts, type CoreImpactProjection } from './core-impact-projection';
import { toChronicleEvent } from './history-causal-adapter';
import { projectHistoricalScenes } from './historical-scenes';
import type { QuarterPulseSituationChange } from './quarter-pulse-situations';

export const MAX_QUARTER_PULSE_STORIES = 3;

const MAIN_APPOINTMENT_KINDS = new Set(['君主', '宰辅', '枢密使', '军团主帅', '水师提督']);
const MAIN_FACT_KINDS = new Set<SimulationFact['kind']>(['war_started', 'war_ended', 'battle', 'territory_control_changed',
  'army_order_changed', 'faction_lifecycle', 'faction_relation_changed', 'court_action_resolved']);
const MAIN_CHRONICLE_KINDS = new Set([
  'capital_fall', 'rebellion', 'army_raised', 'succession', 'polity_eliminated', 'polity_dissolved',
  'power_broker', 'power_broker_fell', 'purge',
]);

interface QuarterPulseStoryBase {
  id: string;
  title: string;
  summary: string;
  importance: number;
  sourceFactIds: readonly string[];
  historyEventIds: readonly string[];
  regionIds: readonly string[];
}

export interface QuarterPulseEventStory extends QuarterPulseStoryBase {
  kind: 'event';
  category: string;
  location?: string;
  eventId: string | null;
  source: 'fact' | 'chronicle';
}

export interface QuarterPulseSituationStory extends QuarterPulseStoryBase {
  kind: 'situation';
  situationId: string;
  situationKind: QuarterPulseSituationChange['kind'];
  kindLabel: QuarterPulseSituationChange['kindLabel'];
  basis: QuarterPulseSituationChange['basis'];
  typeLabel: string;
  threadTitle: string;
  tension: number;
  delta: number;
}

export type QuarterPulseStory = QuarterPulseEventStory | QuarterPulseSituationStory;

export interface QuarterPulseProjection {
  stories: readonly QuarterPulseStory[];
  highlightedRegionIds: readonly string[];
}

function stableCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(stableCompare);
}

function uniqueInOrder(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function normalizedImportance(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function storyPriority(story: QuarterPulseStory): number {
  if (story.kind === 'event') return story.eventId ? (story.source === 'fact' ? 30 : 10) : 0;
  const kindPriority = {
    resolved: 4,
    born: 3,
    heated: 2,
    cooled: 1,
  }[story.situationKind];
  const basisPriority = story.basis === 'lifecycle' ? 60 : story.basis === 'phase' ? 50 : 20;
  return basisPriority + kindPriority;
}

function storyMagnitude(story: QuarterPulseStory): number {
  return story.kind === 'situation' ? Math.abs(story.delta) : story.sourceFactIds.length;
}

function compareStories(left: QuarterPulseStory, right: QuarterPulseStory): number {
  return right.importance - left.importance
    || storyPriority(right) - storyPriority(left)
    || storyMagnitude(right) - storyMagnitude(left)
    || stableCompare(left.id, right.id);
}

function hasCurrentConcreteEvidence(story: QuarterPulseStory): boolean {
  return story.kind === 'event'
    || story.basis !== 'trend'
    || story.sourceFactIds.length > 0
    || story.historyEventIds.length > 0;
}

function sharesEvidence(left: QuarterPulseStory, right: QuarterPulseStory): boolean {
  const leftFacts = new Set(left.sourceFactIds);
  if (right.sourceFactIds.some((id) => leftFacts.has(id))) return true;
  const leftEvents = new Set(left.historyEventIds);
  return right.historyEventIds.some((id) => leftEvents.has(id));
}

function evidenceClusters(stories: readonly QuarterPulseStory[]): QuarterPulseStory[][] {
  const parent = stories.map((_, index) => index);
  const find = (index: number): number => {
    let current = index;
    while (parent[current] !== current) {
      parent[current] = parent[parent[current]];
      current = parent[current];
    }
    return current;
  };
  const join = (left: number, right: number) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };
  for (let left = 0; left < stories.length; left += 1) {
    for (let right = left + 1; right < stories.length; right += 1) {
      if (sharesEvidence(stories[left], stories[right])) join(left, right);
    }
  }
  const clusters = new Map<number, QuarterPulseStory[]>();
  stories.forEach((story, index) => {
    const root = find(index);
    const cluster = clusters.get(root) ?? [];
    cluster.push(story);
    clusters.set(root, cluster);
  });
  return [...clusters.values()];
}

function isMainFactEligible(fact: SimulationFact, coreImpactFactIds: ReadonlySet<string>): boolean {
  if (coreImpactFactIds.has(fact.id)) return true;
  if (MAIN_FACT_KINDS.has(fact.kind)) return true;
  if (fact.kind === 'expedition_response') return fact.importance >= 2;
  if (fact.kind === 'character_wounded') return fact.importance >= 3;
  if (fact.kind === 'character_death') return fact.payload.cause === 'battle' || fact.payload.role === '君主' || fact.importance >= 3;
  if (fact.kind === 'appointment_started' || fact.kind === 'appointment_ended') {
    return MAIN_APPOINTMENT_KINDS.has(fact.payload.officeKind);
  }
  return fact.kind === 'local_governance_resolved'
    && fact.payload.outcome === 'enacted'
    && (fact.payload.unrestBefore !== fact.payload.unrestAfter || changesPolityStanding(fact.stateDeltas));
}

function changesPolityStanding(deltas: readonly HistoryEvent['stateDeltas'][number][]): boolean {
  return deltas.some((delta) => delta.entityType === 'polity' && (delta.field === 'legitimacy' || delta.field === 'authority')
    && delta.before !== delta.after);
}

function currentFactStories(world: WorldState, coreImpactFactIds: ReadonlySet<string>): QuarterPulseEventStory[] {
  const report = world.lastTurn;
  if (!report) return [];
  const reportFactIds = new Set(report.factIds);
  const reportEventIds = new Set(report.eventIds);
  const facts = world.facts.filter((fact) => fact.turn === report.turn && reportFactIds.has(fact.id));
  const factById = new Map(world.facts.map((fact) => [fact.id, fact]));
  const historyById = new Map(world.history.map((event) => [event.id, event]));
  return projectHistoricalScenes(world, facts, facts.length, 'active')
    .map<QuarterPulseEventStory | null>((scene) => {
      const sourceFactIds = uniqueSorted(scene.sourceFactIds.filter((id) => {
        const fact = factById.get(id);
        return reportFactIds.has(id) && fact?.turn === report.turn;
      }));
      const historyEventIds = uniqueSorted(scene.historyEventIds.filter((id) => {
        const event = historyById.get(id);
        return reportEventIds.has(id) && event?.turn === report.turn;
      }));
      const eventId = historyEventIds[0] ?? null;
      const currentFacts = sourceFactIds.flatMap((id) => factById.get(id) ?? []);
      if (!currentFacts.some((fact) => isMainFactEligible(fact, coreImpactFactIds))) return null;
      const strongestFact = [...currentFacts]
        .sort((left, right) => right.importance - left.importance || stableCompare(left.id, right.id))[0];
      const regionIds = uniqueInOrder(currentFacts.flatMap((fact) => fact.regionIds));
      const summary = [scene.summary, scene.result].filter(Boolean).join(' ');
      return {
        id: scene.id,
        kind: 'event' as const,
        title: scene.title,
        summary,
        category: strongestFact?.category ?? '世界',
        location: regionIds
          .map((id) => world.regions.find((region) => region.id === id)?.name)
          .filter((name): name is string => Boolean(name))
          .join('、') || undefined,
        eventId,
        source: 'fact' as const,
        importance: normalizedImportance((strongestFact?.importance ?? scene.importance) * 20),
        sourceFactIds,
        historyEventIds,
        regionIds,
      };
    }).filter((story): story is QuarterPulseEventStory => story !== null);
}

function chronicleFallbackStories(
  world: WorldState,
  coveredFacts: ReadonlySet<string>,
  coveredEvents: ReadonlySet<string>,
  coreImpactEventIds: ReadonlySet<string>,
): QuarterPulseEventStory[] {
  const report = world.lastTurn;
  if (!report) return [];
  const eventIds = new Set(report.eventIds);
  const reportFactIds = new Set(report.factIds);
  const factById = new Map(world.facts.map((fact) => [fact.id, fact]));
  return world.history
    .filter((event) => (
      eventIds.has(event.id)
      && event.turn === report.turn
      && event.kind !== 'quarter_summary'
      && !event.kind.startsWith('situation_')
      && (coreImpactEventIds.has(event.id) || event.category === '海洋' || MAIN_CHRONICLE_KINDS.has(event.kind)
        || (event.kind === 'legitimacy_crisis' && changesPolityStanding(event.stateDeltas)))
      && event.sourceFactIds.length + event.stateDeltas.length + event.actorIds.length
        + event.polityIds.length + event.regionIds.length > 0
      && !coveredEvents.has(event.id)
      && !event.sourceFactIds.some((id) => coveredFacts.has(id))
    ))
    .map((event) => {
      const chronicle = toChronicleEvent(world, event);
      return {
        id: event.id,
        kind: 'event' as const,
        title: chronicle.title,
        summary: chronicle.summary ?? '',
        category: chronicle.category,
        location: chronicle.location,
        eventId: event.id,
        source: 'chronicle' as const,
        importance: normalizedImportance(event.importance * 20),
        sourceFactIds: uniqueSorted(event.sourceFactIds.filter((id) => (
          reportFactIds.has(id) && factById.get(id)?.turn === report.turn
        ))),
        historyEventIds: [event.id],
        regionIds: uniqueInOrder([
          ...event.regionIds,
          ...event.stateDeltas
            .filter((delta) => delta.entityType === 'region')
            .map((delta) => delta.entityId),
        ]),
      };
    });
}

export function selectQuarterPulseStories(
  candidates: readonly QuarterPulseStory[],
  maximum = MAX_QUARTER_PULSE_STORIES,
): QuarterPulseStory[] {
  const limit = Number.isFinite(maximum) ? Math.max(0, Math.floor(maximum)) : 0;
  const representatives = evidenceClusters(candidates).map((cluster) => {
    const winner = [...cluster].sort(compareStories)[0];
    const related = cluster.filter((story) => story !== winner);
    return {
      ...winner,
      sourceFactIds: uniqueSorted(cluster.flatMap((story) => story.sourceFactIds)),
      historyEventIds: uniqueSorted(cluster.flatMap((story) => story.historyEventIds)),
      regionIds: uniqueInOrder([
        ...winner.regionIds,
        ...related.flatMap((story) => story.regionIds),
      ]),
    } as QuarterPulseStory;
  });
  const concrete = representatives.filter(hasCurrentConcreteEvidence).sort(compareStories);
  return concrete.slice(0, limit);
}

export function projectQuarterPulse(world: WorldState): QuarterPulseProjection {
  if (!world.lastTurn) return { stories: [], highlightedRegionIds: [] };
  const coreImpacts = projectCoreImpacts(world);
  const coreImpactFactIds = new Set(coreImpacts.flatMap((impact) => impact.sourceFactIds));
  const coreImpactEventIds = new Set(coreImpacts.flatMap((impact) => impact.sourceEventIds));
  const facts = currentFactStories(world, coreImpactFactIds);
  const coveredFacts = new Set(facts.flatMap((story) => story.sourceFactIds));
  const coveredEvents = new Set(facts.flatMap((story) => story.historyEventIds));
  const candidates: QuarterPulseStory[] = [
    ...facts,
    ...chronicleFallbackStories(world, coveredFacts, coveredEvents, coreImpactEventIds),
  ];
  const stories = selectQuarterPulseStories(candidates).map((story) => {
    const impact = coreImpacts.find((candidate) => sharesImpactEvidence(story, candidate));
    return impact ? { ...story, summary: `${story.summary} 军政牵动：${impact.summary}`.trim() } : story;
  });
  const knownRegions = new Set(world.regions.map((region) => region.id));
  return {
    stories,
    highlightedRegionIds: uniqueInOrder(stories.flatMap((story) => story.regionIds))
      .filter((id) => knownRegions.has(id))
      .slice(0, 16),
  };
}

function sharesImpactEvidence(story: QuarterPulseStory, impact: CoreImpactProjection): boolean {
  const facts = new Set(story.sourceFactIds);
  if (impact.sourceFactIds.some((id) => facts.has(id))) return true;
  const events = new Set(story.historyEventIds);
  return impact.sourceEventIds.some((id) => events.has(id));
}
