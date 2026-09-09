import type { MapOverlay } from '../components/WorldMap';
import type { SituationPhase, SituationState } from '../sim/situations';
import type { SimulationFact, WorldState } from '../sim/types';
import { projectCoreImpacts } from './core-impact-projection';
import { participantBattleHeadline, projectFactNarrative, projectSituationHistoricalScenes, readableParticipant, type HistoricalScene } from './historical-scenes';
import {
  projectSituationSnapshotItem,
  situationOutcomeLabel,
  type SituationParticipantGroupKey,
  type SituationSnapshotEvidence,
  type SituationSnapshotItem,
} from './situation-snapshot';
import { historyTurnDate } from './v1-history';
import { projectWarGroups } from './war-group-projection';
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
  primarySceneId: string;
  primarySourceFactIds: readonly string[];
}
export interface ObserverLeadProjection { leads: ObserverLead[] }
export const OBSERVER_LEAD_VISIBILITY_THRESHOLD = 40;
export const OBSERVER_LEAD_RESOLUTION_ECHO_TURNS = 1;
const PHASE_ORDER: Readonly<Record<SituationPhase, number>> = { critical: 0, active: 1, emerging: 2 };
const WAR_SITUATION_TYPES = new Set(['war_progress', 'military_power_crisis']);
const STORY_FACT_KINDS = new Set<SimulationFact['kind']>([
  'war_started', 'war_ended', 'battle', 'territory_control_changed', 'army_order_changed',
  'appointment_started', 'appointment_ended', 'agency_support_resolved', 'agency_intent_resolved',
  'character_wounded', 'character_death',
  'faction_lifecycle', 'faction_relation_changed', 'court_action_resolved', 'embodied_action_resolved',
]);
const WAR_FACT_KINDS = new Set<SimulationFact['kind']>([
  'war_started', 'war_ended', 'battle', 'territory_control_changed', 'army_order_changed',
  'agency_support_resolved', 'agency_intent_resolved',
  'character_wounded',
]);
const HIGH_OFFICES = new Set(['君主', '宰辅', '枢密使', '军团主帅', '军团副将', '水师提督', '水师副将']);
const MAJOR_APPOINTMENT_OFFICES = new Set(['君主', '宰辅', '枢密使', '军团主帅', '水师提督']);
interface SituationLeadChoice {
  primarySceneId: string;
  primarySourceFactIds: readonly string[];
  evidence: readonly [string, string];
  recentChange: string;
}
const stableCompare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
function compareSituations(left: SituationState, right: SituationState): number {
  return PHASE_ORDER[left.phase] - PHASE_ORDER[right.phase]
    || right.importance - left.importance
    || right.tension - left.tension
    || left.startedTurn - right.startedTurn
    || stableCompare(left.id, right.id);
}
function participant(item: SituationSnapshotItem, key: SituationParticipantGroupKey): { id: string; label: string } | null {
  return item.participants.find((group) => group.key === key)?.entities[0] ?? null;
}
function targetForSituation(world: WorldState, situation: SituationState, item: SituationSnapshotItem): ObserverLeadTarget | null {
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
function situationHeadline(world: WorldState, item: SituationSnapshotItem, situation: SituationState, resolvedEcho: boolean): string {
  const core = participant(item, 'coreCharacterIds')?.label ?? '这名将领';
  const polity = participant(item, 'polityIds')?.label ?? '该政权';
  if (resolvedEcho) return `${item.title.replace(/的战争进程$/u, '')}以“${situationOutcomeLabel(situation.resolution?.outcomeKey ?? '')}”收束`;
  if (item.type === 'war_progress') {
    const war = projectWarGroups(world, situation.scopeKey);
    const contact = war?.contacts[0];
    if (contact) {
      const ids = [contact.attackerArmyId, ...contact.defenderArmyIds];
      const armies = world.armies.filter((army) => ids.includes(army.id));
      const person = readableParticipant(world, armies.flatMap((army) => army.participantIds));
      const army = armies.find((entry) => entry.participantIds.includes(person?.id ?? ''));
      if (person && army) return `${person.name}${army.commanderId === person.id ? '统领' : '随'}${army.name}，将在${contact.region}${army.id === contact.attackerArmyId ? '进攻' : '迎战'}${army.id === contact.attackerArmyId ? contact.defenderCommanders : contact.attackerCommander}`;
      return `${contact.attackerCommander}率${contact.attacker}将在${contact.region}迎战${contact.defenderCommanders}`;
    }
    if (war?.latestBattle) return participantBattleHeadline(world, war.latestBattle.factId);
    const moving = war?.sides.flatMap((side) => side.groups.flatMap((group) => group.armies))
      .filter((army) => army.nextRegion)
      .sort((left, right) => (left.stepsToTarget ?? 99) - (right.stepsToTarget ?? 99) || stableCompare(left.id, right.id))[0];
    return moving ? `${moving.commander}率${moving.name}${moving.posture}${moving.nextRegion}` : item.title.replace(/的战争进程$/u, '交兵未休');
  }
  if (item.type === 'military_power_crisis') {
    const characterId = participant(item, 'coreCharacterIds')?.id;
    const army = world.armies.find((entry) => entry.commanderId === characterId || entry.allegiance.characterId === characterId || entry.participantIds.includes(characterId ?? ''));
    return army ? `${core}掌${army.name}，军中归属仍牵动${polity}` : `${core}的军权去留牵动${polity}`;
  }
  if (item.type === 'inheritance_crisis') {
    const state = world.polities.find((entry) => entry.id === participant(item, 'polityIds')?.id);
    const ruler = world.characters.find((entry) => entry.id === state?.rulerId)?.name;
    const candidate = participant(item, 'supportingCharacterIds')?.label ?? participant(item, 'coreCharacterIds')?.label;
    return ruler && candidate && ruler !== candidate ? `${ruler}仍在位，${candidate}列入${polity}继承人选` : `${polity}正在排定君位承继`;
  }
  const factions = item.participants.find((group) => group.key === 'factionIds')?.entities.slice(0, 2).map((entry) => entry.label) ?? [];
  return factions.length > 1 ? `${factions[0]}与${factions[1]}争夺${polity}朝权` : `${core}正在影响${polity}朝局`;
}
function sceneEvidence(item: SituationSnapshotItem, scene: HistoricalScene): readonly [string, string] {
  const lines = [scene.summary.trim(), scene.result.trim()]
    .filter((line, index, all) => Boolean(line) && all.indexOf(line) === index);
  const names = item.participants
    .flatMap((group) => group.entities.map((entity) => entity.label))
    .filter((label, index, all) => all.indexOf(label) === index)
    .slice(0, 3);
  if (lines.length < 2) lines.push(names.length ? `相关各方 · ${names.join('、')}` : `始于${historyTurnDate(item.startedTurn).label}`);
  return [lines[0], lines[1]];
}
function primaryFactId(world: WorldState, scene: HistoricalScene): string | null {
  const priorities: Partial<Record<SimulationFact['kind'], number>> = scene.id.startsWith('scene:war:')
    ? { battle: 0, war_ended: 1, war_started: 2, territory_control_changed: 3 }
    : scene.id.startsWith('scene:agency:')
      ? { agency_intent_resolved: 0, agency_intent_submitted: 1, agency_support_resolved: 2 }
      : {};
  return world.facts
    .filter((fact) => scene.sourceFactIds.includes(fact.id) && (!scene.id.startsWith('scene:war:') || priorities[fact.kind] !== undefined))
    .sort((left, right) => (priorities[left.kind] ?? 10) - (priorities[right.kind] ?? 10)
      || right.turn - left.turn || right.importance - left.importance || stableCompare(left.id, right.id))[0]?.id ?? null;
}

function structuralChoice(item: SituationSnapshotItem, evidence: SituationSnapshotEvidence): SituationLeadChoice {
  const refKey = evidence.refs.map((ref) => ref.kind === 'fact'
    ? `fact:${ref.factId}`
    : `${ref.entityType}:${ref.entityId}:${ref.field}:${String(ref.value)}`).sort(stableCompare).join('|');
  const names = item.participants.flatMap((group) => group.entities.map((entity) => entity.label)).slice(0, 3);
  const primaryFact = evidence.refs.find((ref) => ref.kind === 'fact');
  return {
    primarySceneId: `structure:${evidence.key}:${refKey || 'unreferenced'}`,
    primarySourceFactIds: primaryFact?.kind === 'fact' ? [primaryFact.factId] : [],
    evidence: [evidence.label, names.length ? `相关人物 · ${names.join('、')}` : `始于${historyTurnDate(item.startedTurn).label}`],
    recentChange: `眼下 · ${evidence.label}`,
  };
}

function situationChoices(world: WorldState, situation: SituationState, item: SituationSnapshotItem): SituationLeadChoice[] {
  const scenes = projectSituationHistoricalScenes(world, situation, 24, null, 'active').map((scene) => {
    const factId = primaryFactId(world, scene);
    return {
      primarySceneId: scene.id,
      primarySourceFactIds: factId ? scene.sourceFactIds : [],
      evidence: sceneEvidence(item, scene),
      recentChange: `${scene.dateLabel} · ${scene.title}`,
    };
  });
  const structural = item.evidence.filter((entry) => entry.role === 'structural').map((entry) => structuralChoice(item, entry));
  if (situation.type === 'war_progress') {
    const war = projectWarGroups(world, situation.scopeKey);
    const contact = war?.contacts[0];
    const current: SituationLeadChoice | null = contact ? {
      primarySceneId: `war-state:${situation.scopeKey}:${contact.attackerArmyId}:${contact.regionId}`,
      primarySourceFactIds: war?.latestBattle ? [war.latestBattle.factId] : [],
      evidence: [war?.latestBattle
        ? `最近一战在${war.latestBattle.region}，${war.latestBattle.attackerCommander}${war.latestBattle.result}。`
        : `${contact.attackerCommander}正率${contact.attacker}接近${contact.region}。`,
      `${contact.attackerCommander}约${contact.steps}步后将迎上${contact.defenderCommanders}。`],
      recentChange: `眼下 · ${contact.region}即将接敌`,
    } : null;
    const warScenes = scenes.filter((scene) => scene.primarySceneId.startsWith('scene:war:') && scene.primarySourceFactIds.length > 0);
    const otherScenes = scenes.filter((scene) => !scene.primarySceneId.startsWith('scene:war:'));
    return current ? [current, ...warScenes, ...otherScenes, ...structural]
      : warScenes.length ? [warScenes[0], ...otherScenes, ...structural, ...warScenes.slice(1)] : [...otherScenes, ...structural];
  }
  return scenes.length ? [scenes[0], ...structural, ...scenes.slice(1)] : structural;
}

function projectSituationLead(world: WorldState, situation: SituationState, resolvedEcho: boolean, choice: SituationLeadChoice): ObserverLead | null {
  const item = projectSituationSnapshotItem(situation, world);
  const target = targetForSituation(world, situation, item);
  if (!target) return null;
  return {
    id: `lead-situation:${situation.id}`,
    label: WAR_SITUATION_TYPES.has(situation.type) ? '军争' : '朝局',
    question: choice.primarySceneId.startsWith('scene:war:') ? choice.recentChange.slice(choice.recentChange.lastIndexOf(' · ') + 3) : situationHeadline(world, item, situation, resolvedEcho),
    evidence: choice.evidence,
    target,
    overlay: WAR_SITUATION_TYPES.has(situation.type) ? 'war' : 'political',
    source: 'situation',
    situationId: situation.id,
    situationType: situation.type,
    factId: null,
    displayMode: resolvedEcho ? 'resolution_echo' : 'tracking',
    startedLabel: historyTurnDate(situation.startedTurn).label,
    trackingTurns: Math.max(1, world.turn - situation.startedTurn + 1),
    recentChange: choice.recentChange,
    primarySceneId: choice.primarySceneId,
    primarySourceFactIds: choice.primarySourceFactIds,
  };
}

function sameAppointmentSeat(left: SimulationFact, right: SimulationFact): boolean {
  if ((left.kind !== 'appointment_started' && left.kind !== 'appointment_ended') || (right.kind !== 'appointment_started' && right.kind !== 'appointment_ended')) return false;
  return left.payload.polityId === right.payload.polityId
    && left.payload.officeKind === right.payload.officeKind
    && left.payload.regionId === right.payload.regionId
    && left.payload.armyId === right.payload.armyId
    && left.payload.fleetId === right.payload.fleetId;
}

function isStoryFact(fact: SimulationFact, currentFacts: readonly SimulationFact[]): boolean {
  if (!STORY_FACT_KINDS.has(fact.kind)) return false;
  if (fact.kind === 'appointment_started' || fact.kind === 'appointment_ended') {
    if (!HIGH_OFFICES.has(fact.payload.officeKind)) return false;
    return MAJOR_APPOINTMENT_OFFICES.has(fact.payload.officeKind) || currentFacts.some((other) => (
      other.id !== fact.id && (sameAppointmentSeat(fact, other)
        || other.sourceFactIds.includes(fact.id) || fact.sourceFactIds.includes(other.id))
    ));
  }
  if (fact.kind === 'embodied_action_resolved' && fact.payload.domainFactId) return false;
  if (fact.kind === 'character_wounded') return fact.importance >= 3;
  if (fact.kind === 'character_death') {
    return fact.payload.cause === 'battle' || fact.payload.role === '君主' || fact.importance >= 3;
  }
  return true;
}

function targetForFact(world: WorldState, fact: SimulationFact): ObserverLeadTarget | null {
  const actorId = readableParticipant(world, fact.actorIds)?.id;
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
  const war = WAR_FACT_KINDS.has(fact.kind) || (fact.kind === 'character_death' && fact.payload.cause === 'battle');
  const question = fact.kind === 'battle'
    ? `${world.characters.find((item) => item.id === fact.payload.attacker.commanderId)?.name ?? '攻方主将'}在${world.regions.find((item) => item.id === fact.payload.targetRegionId)?.name ?? '战地'}${fact.payload.attackerWon ? '击退守军' : '进攻受阻'}`
    : narrative.title;
  return {
    id: `lead-fact:${fact.id}`,
    label: war ? '军争' : '朝局',
    question,
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
    primarySceneId: `scene:fact:${fact.id}`,
    primarySourceFactIds: [fact.id],
  };
}

type AppointmentFact = Extract<SimulationFact, { kind: 'appointment_started' | 'appointment_ended' }>;

function projectAppointmentTransferLead(world: WorldState, left: AppointmentFact, right: AppointmentFact): ObserverLead | null {
  const ended = left.kind === 'appointment_ended' ? left : right;
  const started = left.kind === 'appointment_started' ? left : right;
  if (ended.kind !== 'appointment_ended' || started.kind !== 'appointment_started') return null;
  const lead = projectFactLead(world, started);
  if (!lead) return null;
  const former = world.characters.find((item) => item.id === ended.payload.holderId)?.name ?? '前任';
  const successor = world.characters.find((item) => item.id === started.payload.holderId)?.name ?? '新任';
  const seat = started.payload.officeKind;
  const authority = started.payload.armyId || started.payload.fleetId ? '兵权' : '官权';
  const sourceFactIds = [ended.id, started.id].sort(stableCompare);
  return {
    ...lead,
    question: `${former}卸任${seat}，${successor}接掌${authority}`,
    evidence: [`${former}下、${successor}上；${seat}的${authority}已完成交接。`, lead.evidence[1]],
    primarySceneId: `scene:fact:${sourceFactIds.join(':')}`, primarySourceFactIds: sourceFactIds,
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

export function deriveObserverLeads(world: WorldState): ObserverLead[] {
  const open = world.situationSystem.situations
    .filter((item) => item.status === 'open' && item.visibility >= OBSERVER_LEAD_VISIBILITY_THRESHOLD)
    .sort(compareSituations);
  const selectedSituations: SituationState[] = [];
  const leads: ObserverLead[] = [];
  const usedSceneIds = new Set<string>();
  const usedPrimaryFacts = new Set<string>();
  const appendSituation = (situation: SituationState, resolvedEcho: boolean) => {
    const item = projectSituationSnapshotItem(situation, world);
    const choice = situationChoices(world, situation, item).find((candidate) => (
      !usedSceneIds.has(candidate.primarySceneId)
      && candidate.primarySourceFactIds.every((id) => !usedPrimaryFacts.has(id))
    ));
    if (!choice) return;
    const lead = projectSituationLead(world, situation, resolvedEcho, choice);
    if (!lead) return;
    leads.push(lead);
    selectedSituations.push(situation);
    usedSceneIds.add(choice.primarySceneId);
    choice.primarySourceFactIds.forEach((id) => usedPrimaryFacts.add(id));
  };
  for (const situation of open) {
    appendSituation(situation, false);
    if (leads.length >= 3) break;
  }

  if (leads.length < 3) {
    const echoes = world.situationSystem.situations
      .filter((item) => item.status === 'resolved'
        && item.resolvedTurn !== null
        && item.visibility >= OBSERVER_LEAD_VISIBILITY_THRESHOLD
        && world.turn - item.resolvedTurn >= 0
        && world.turn - item.resolvedTurn <= OBSERVER_LEAD_RESOLUTION_ECHO_TURNS)
      .sort(compareSituations);
    for (const situation of echoes) {
      appendSituation(situation, true);
      if (leads.length >= 3) break;
    }
  }

  if (leads.length < 3 && world.lastTurn) {
    const currentFactIds = new Set(world.lastTurn.factIds);
    const covered = coveredFactIds(selectedSituations);
    const currentFacts = world.facts.filter((fact) => currentFactIds.has(fact.id));
    const facts = currentFacts
      .filter((fact) => !covered.has(fact.id) && isStoryFact(fact, currentFacts))
      .sort((left, right) => right.importance - left.importance || stableCompare(left.id, right.id));
    let appointmentSelected = false;
    for (const fact of facts) {
      const appointment = fact.kind === 'appointment_started' || fact.kind === 'appointment_ended';
      if ((appointment && appointmentSelected) || usedPrimaryFacts.has(fact.id)) continue;
      const counterpart = appointment ? currentFacts.find((other): other is AppointmentFact => (
        other.id !== fact.id && other.kind !== fact.kind && sameAppointmentSeat(fact, other)
      )) : undefined;
      const lead = counterpart ? projectAppointmentTransferLead(world, fact as AppointmentFact, counterpart) : projectFactLead(world, fact);
      if (lead && !usedSceneIds.has(lead.primarySceneId)
        && lead.primarySourceFactIds.every((id) => !usedPrimaryFacts.has(id))) {
        leads.push(lead);
        usedSceneIds.add(lead.primarySceneId);
        lead.primarySourceFactIds.forEach((id) => usedPrimaryFacts.add(id));
        if (appointment) appointmentSelected = true;
      }
      if (leads.length >= 3) break;
    }
  }
  return leads.slice(0, 3);
}

export function deriveObserverLeadProjection(world: WorldState): ObserverLeadProjection {
  return { leads: deriveObserverLeads(world).map((lead) => {
    const situation = lead.situationId
      ? world.situationSystem.situations.find((item) => item.id === lead.situationId)
      : null;
    const impact = (lead.primarySourceFactIds.length
      ? projectCoreImpacts(world, { sourceFactIds: lead.primarySourceFactIds, limit: 1 })[0]
      : undefined) ?? (situation?.type === 'war_progress'
      ? projectCoreImpacts(world, { warId: situation.scopeKey, limit: 1 })[0]
      : undefined);
    return impact ? { ...lead, evidence: [lead.evidence[0], `军政牵动 · ${impact.summary}`] } : lead;
  }) };
}
