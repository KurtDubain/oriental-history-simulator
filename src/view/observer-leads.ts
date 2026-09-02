import type { MapOverlay } from '../components/WorldMap';
import type { SituationPhase, SituationState } from '../sim/situations';
import type { SimulationFact, WorldState } from '../sim/types';
import { projectFactNarrative, projectSituationHistoricalScenes } from './historical-scenes';
import {
  projectSituationSnapshotItem,
  situationOutcomeLabel,
  type SituationParticipantGroupKey,
  type SituationSnapshotItem,
} from './situation-snapshot';
import { historyTurnDate } from './v1-history';

export type ObserverLeadTargetKind = 'person' | 'country' | 'region';
export type ObserverLeadSource = 'situation' | 'fact';
export type ObserverLeadDisplayMode = 'tracking' | 'resolution_echo' | 'fact';

export interface ObserverLeadTarget {
  kind: ObserverLeadTargetKind;
  id: string;
}

export interface ObserverLead {
  id: string;
  label: '军争' | '朝局';
  question: string;
  evidence: readonly [string, string];
  target: ObserverLeadTarget;
  overlay: MapOverlay;
  source: ObserverLeadSource;
  situationId: string | null;
  situationType: string | null;
  factId: string | null;
  displayMode: ObserverLeadDisplayMode;
  startedLabel: string | null;
  trackingTurns: number;
  recentChange: string | null;
}

/** A stateless wrapper retained for the app/text-snapshot integration boundary. */
export interface ObserverLeadProjection {
  leads: ObserverLead[];
}

export const OBSERVER_LEAD_VISIBILITY_THRESHOLD = 40;
export const OBSERVER_LEAD_RESOLUTION_ECHO_TURNS = 1;

const PHASE_ORDER: Readonly<Record<SituationPhase, number>> = {
  critical: 0,
  active: 1,
  emerging: 2,
};
const WAR_SITUATION_TYPES = new Set(['war_progress', 'military_power_crisis']);
const STORY_FACT_KINDS = new Set<SimulationFact['kind']>([
  'war_started',
  'war_ended',
  'battle',
  'territory_control_changed',
  'army_order_changed',
  'appointment_started',
  'appointment_ended',
  'agency_support_resolved',
  'agency_intent_resolved',
  'faction_lifecycle',
  'faction_relation_changed',
  'court_action_resolved',
  'embodied_action_resolved',
]);
const WAR_FACT_KINDS = new Set<SimulationFact['kind']>([
  'war_started',
  'war_ended',
  'battle',
  'territory_control_changed',
  'army_order_changed',
  'agency_support_resolved',
  'agency_intent_resolved',
]);
const HIGH_OFFICES = new Set([
  '君主',
  '宰辅',
  '枢密使',
  '军团主帅',
  '军团副将',
  '水师提督',
  '水师副将',
]);

function stableCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareSituations(left: SituationState, right: SituationState): number {
  return PHASE_ORDER[left.phase] - PHASE_ORDER[right.phase]
    || right.importance - left.importance
    || right.tension - left.tension
    || left.startedTurn - right.startedTurn
    || stableCompare(left.id, right.id);
}

function participant(
  item: SituationSnapshotItem,
  key: SituationParticipantGroupKey,
): { id: string; label: string } | null {
  return item.participants.find((group) => group.key === key)?.entities[0] ?? null;
}

function targetForSituation(
  world: WorldState,
  situation: SituationState,
  item: SituationSnapshotItem,
): ObserverLeadTarget | null {
  if (situation.type === 'military_power_crisis') {
    const person = participant(item, 'coreCharacterIds')
      ?? participant(item, 'supportingCharacterIds')
      ?? participant(item, 'opposingCharacterIds');
    if (person) return { kind: 'person', id: person.id };
  }
  if (situation.type === 'war_progress') {
    const attackerId = world.wars.find((war) => war.id === situation.scopeKey)?.attackerId;
    if (attackerId) return { kind: 'country', id: attackerId };
  }
  const polity = participant(item, 'polityIds');
  if (polity) return { kind: 'country', id: polity.id };
  const person = participant(item, 'coreCharacterIds');
  if (person) return { kind: 'person', id: person.id };
  const region = participant(item, 'regionIds');
  return region ? { kind: 'region', id: region.id } : null;
}

function questionForSituation(
  item: SituationSnapshotItem,
  situation: SituationState,
  resolvedEcho: boolean,
): string {
  if (resolvedEcho) {
    return `${item.title}如何以“${situationOutcomeLabel(situation.resolution?.outcomeKey ?? '')}”收束？`;
  }
  const core = participant(item, 'coreCharacterIds')?.label ?? '这名将领';
  const polity = participant(item, 'polityIds')?.label ?? '该政权';
  if (item.type === 'military_power_crisis') return `${core}现在掌着什么兵权？`;
  if (item.type === 'inheritance_crisis') return `${polity}的继承问题现在卡在哪里？`;
  if (item.type === 'court_power_struggle') return `${polity}眼下由谁左右朝局？`;
  return `${item.title.replace(/的战争进程$/u, '')}，目前打到哪里？`;
}

function situationEvidence(
  world: WorldState,
  situation: SituationState,
  item: SituationSnapshotItem,
  resolvedEcho: boolean,
): readonly [string, string] {
  const scene = projectSituationHistoricalScenes(world, situation, 1, null, 'active')[0];
  if (scene) {
    const lines = [scene.summary.trim(), scene.result.trim()]
      .filter((line, index, all) => Boolean(line) && all.indexOf(line) === index);
    if (lines.length < 2) {
      const names = item.participants
        .flatMap((group) => group.entities.map((entity) => entity.label))
        .filter((label, index, all) => all.indexOf(label) === index)
        .slice(0, 3);
      lines.push(names.length ? `相关各方 · ${names.join('、')}` : `始于${historyTurnDate(item.startedTurn).label}`);
    }
    return [lines[0], lines[1]];
  }
  if (resolvedEcho) {
    return [
      `结案结果 · ${situationOutcomeLabel(situation.resolution?.outcomeKey ?? '')}`,
      item.latestChange ? `${historyTurnDate(item.latestChange.turn).label} · ${item.latestChange.label}` : '结果事实已经封存',
    ];
  }
  const lines = item.evidence
    .filter((entry) => entry.role !== 'outcome')
    .map((entry) => entry.label)
    .filter((label, index, all) => all.indexOf(label) === index)
    .slice(0, 2);
  if (lines.length < 2) lines.push(`始于${historyTurnDate(item.startedTurn).label} · ${item.typeLabel}`);
  if (lines.length < 2) lines.push('本季没有新的具名行动');
  return [lines[0], lines[1]];
}

function projectSituationLead(
  world: WorldState,
  situation: SituationState,
  resolvedEcho: boolean,
): ObserverLead | null {
  const item = projectSituationSnapshotItem(situation, world);
  const target = targetForSituation(world, situation, item);
  if (!target) return null;
  const scene = projectSituationHistoricalScenes(world, situation, 1, null, 'active')[0];
  const recentChange = scene
    ? `${scene.dateLabel} · ${scene.title}`
    : resolvedEcho
      ? `已以“${situationOutcomeLabel(situation.resolution?.outcomeKey ?? '')}”结案`
      : '本季无新动作';
  return {
    id: `lead-situation:${situation.id}`,
    label: WAR_SITUATION_TYPES.has(situation.type) ? '军争' : '朝局',
    question: questionForSituation(item, situation, resolvedEcho),
    evidence: situationEvidence(world, situation, item, resolvedEcho),
    target,
    overlay: WAR_SITUATION_TYPES.has(situation.type) ? 'war' : 'political',
    source: 'situation',
    situationId: situation.id,
    situationType: situation.type,
    factId: null,
    displayMode: resolvedEcho ? 'resolution_echo' : 'tracking',
    startedLabel: historyTurnDate(situation.startedTurn).label,
    trackingTurns: Math.max(1, world.turn - situation.startedTurn + 1),
    recentChange,
  };
}

function isStoryFact(fact: SimulationFact): boolean {
  if (!STORY_FACT_KINDS.has(fact.kind)) return false;
  if (fact.kind === 'appointment_started' || fact.kind === 'appointment_ended') {
    return HIGH_OFFICES.has(fact.payload.officeKind);
  }
  return true;
}

function targetForFact(world: WorldState, fact: SimulationFact): ObserverLeadTarget | null {
  const actorId = fact.actorIds.find((id) => world.characters.some((character) => character.id === id));
  if (actorId) return { kind: 'person', id: actorId };
  const polityId = fact.polityIds.find((id) => world.polities.some((polity) => polity.id === id));
  if (polityId) return { kind: 'country', id: polityId };
  const regionId = fact.regionIds.find((id) => world.regions.some((region) => region.id === id));
  return regionId ? { kind: 'region', id: regionId } : null;
}

function projectFactLead(world: WorldState, fact: SimulationFact): ObserverLead | null {
  const target = targetForFact(world, fact);
  if (!target) return null;
  const narrative = projectFactNarrative(world, fact);
  const context = [
    ...fact.actorIds.map((id) => world.characters.find((item) => item.id === id)?.name),
    ...fact.polityIds.map((id) => world.polities.find((item) => item.id === id)?.shortName),
    ...fact.regionIds.map((id) => world.regions.find((item) => item.id === id)?.name),
  ].filter((label, index, all): label is string => Boolean(label) && all.indexOf(label) === index).slice(0, 3);
  const war = WAR_FACT_KINDS.has(fact.kind);
  return {
    id: `lead-fact:${fact.id}`,
    label: war ? '军争' : '朝局',
    question: `${narrative.title}，结果如何？`,
    evidence: [narrative.summary, `${historyTurnDate(fact.turn).label} · ${context.join('、')}`],
    target,
    overlay: war ? 'war' : 'political',
    source: 'fact',
    situationId: null,
    situationType: null,
    factId: fact.id,
    displayMode: 'fact',
    startedLabel: null,
    trackingTurns: 1,
    recentChange: null,
  };
}

function coveredFactIds(situations: readonly SituationState[]): Set<string> {
  return new Set(situations.flatMap((situation) => [
    ...situation.causalFactIds,
    ...situation.milestoneFactIds,
    ...(situation.resolution?.resultFactIds ?? []),
    ...situation.recentChanges.flatMap((change) => change.sourceFactIds),
  ]));
}

/**
 * Selects at most three current stories without retaining observer-owned state.
 * Open Situations lead, a one-quarter resolution echo may fill vacancies, and
 * current-quarter war/court Facts provide the final sparse fallback.
 */
export function deriveObserverLeads(world: WorldState): ObserverLead[] {
  const open = world.situationSystem.situations
    .filter((item) => item.status === 'open' && item.visibility >= OBSERVER_LEAD_VISIBILITY_THRESHOLD)
    .sort(compareSituations);
  const selectedSituations = open.slice(0, 3);
  const leads = selectedSituations
    .map((item) => projectSituationLead(world, item, false))
    .filter((item): item is ObserverLead => Boolean(item));

  if (leads.length < 3) {
    const echoes = world.situationSystem.situations
      .filter((item) => item.status === 'resolved'
        && item.resolvedTurn !== null
        && item.visibility >= OBSERVER_LEAD_VISIBILITY_THRESHOLD
        && world.turn - item.resolvedTurn >= 0
        && world.turn - item.resolvedTurn <= OBSERVER_LEAD_RESOLUTION_ECHO_TURNS)
      .sort(compareSituations);
    for (const situation of echoes) {
      const lead = projectSituationLead(world, situation, true);
      if (lead) {
        leads.push(lead);
        selectedSituations.push(situation);
      }
      if (leads.length >= 3) break;
    }
  }

  if (leads.length < 3 && world.lastTurn) {
    const currentFactIds = new Set(world.lastTurn.factIds);
    const covered = coveredFactIds(selectedSituations);
    const facts = world.facts
      .filter((fact) => currentFactIds.has(fact.id) && !covered.has(fact.id) && isStoryFact(fact))
      .sort((left, right) => right.importance - left.importance || stableCompare(left.id, right.id));
    for (const fact of facts) {
      const lead = projectFactLead(world, fact);
      if (lead) leads.push(lead);
      if (leads.length >= 3) break;
    }
  }
  return leads.slice(0, 3);
}

export function deriveObserverLeadProjection(world: WorldState): ObserverLeadProjection {
  return { leads: deriveObserverLeads(world) };
}
