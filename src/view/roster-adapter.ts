import {
  EMBODIED_IDENTITY_ACTION_KINDS,
  projectCharacterEmbodiedActions,
} from '../sim/agency';
import { stableCompare } from '../sim/random';
import type {
  CharacterState,
  HistoryEvent,
  OfficeAppointment,
  SimulationFact,
  WorldState,
} from '../sim/types';
import type { SituationState } from '../sim/situations';
import { OBSERVER_LEAD_VISIBILITY_THRESHOLD } from './observer-leads';
import {
  applyRosterDiscovery,
  createRosterDiscoveryState,
  type RosterAttentionKind,
  type RosterAttentionOrder,
  type RosterDiscoveryDefinition,
  type RosterDiscoveryResult,
  type RosterDiscoveryState,
  type RosterItem,
  type RosterReason,
  type RosterReasonTarget,
  type RosterScope,
} from './roster-discovery';
import { situationTypeLabel } from './situation-snapshot';
import { isDefaultVisibleHistoryEvent } from './history-visibility';
import type { ObserverWatchItem } from './v1-observer';
import {
  character,
  compact,
  livingCharacter,
  polity,
  polityPopulation,
  region,
  worldFamilies,
  worldOffices,
} from './dossier-adapter-shared';

export type RosterWatchedRef = Pick<ObserverWatchItem, 'kind' | 'id' | 'alert'>;

export interface RosterCollectionDefinition {
  scope: RosterScope;
  title: string;
  eyebrow: string;
  items: RosterItem[];
  emptyMessage: string;
  searchPlaceholder: string;
  definition: RosterDiscoveryDefinition;
}

export interface RosterDirectorySection {
  id: Exclude<RosterScope, 'people'>;
  label: string;
  count: number;
  alertCount?: number;
}

export interface RosterDirectory {
  people: RosterCollectionDefinition;
  polities: RosterCollectionDefinition;
  families: RosterCollectionDefinition;
  military: RosterCollectionDefinition;
  sections: RosterDirectorySection[];
}

export interface RosterCollectionProjection extends RosterCollectionDefinition {
  state: RosterDiscoveryState;
  totalCount: number;
  matchedCount: number;
  activeFilterCount: number;
  conditionLabels: string[];
  conditionSummary: string;
}

interface ProjectionContext {
  world: WorldState;
  watched: ReadonlyMap<string, RosterWatchedRef>;
  factsById: ReadonlyMap<string, SimulationFact>;
  recentEvents: readonly HistoryEvent[];
  currentEventIds: ReadonlySet<string>;
  currentFactIds: ReadonlySet<string>;
  openSituations: readonly SituationState[];
  characterFamilyIds: ReadonlyMap<string, string>;
  activeOfficesByHolder: ReadonlyMap<string, readonly OfficeAppointment[]>;
}

interface AttentionCandidate {
  reason: RosterReason;
  order: RosterAttentionOrder;
}

type PersonIdentity = 'ruler' | 'court' | 'governor' | 'military' | 'unassigned';

const ATTENTION_PRIORITY: Readonly<Record<RosterAttentionKind, number>> = {
  'watched-alert': 0,
  'critical-situation': 1,
  'current-event': 2,
  watched: 3,
  'open-situation': 4,
  'recent-event': 5,
  'urgent-status': 6,
  authority: 7,
  command: 8,
  standing: 9,
};

const COLLECTION_COPY: Readonly<Record<RosterScope, Omit<RosterCollectionDefinition, 'items' | 'definition'>>> = {
  people: {
    scope: 'people',
    title: '时人群像',
    eyebrow: '声望与所图',
    emptyMessage: '暂无可记名人物。',
    searchPlaceholder: '检索姓名、身份或近况',
  },
  polities: {
    scope: 'polities',
    title: '天下列国',
    eyebrow: '势力诸卷 · 政权根基',
    emptyMessage: '天下已无成形政权。',
    searchPlaceholder: '检索国号、君主或都城',
  },
  families: {
    scope: 'families',
    title: '天下世家',
    eyebrow: '势力诸卷 · 门第传承',
    emptyMessage: '尚无被谱牒记名的家族。',
    searchPlaceholder: '检索家名、家主或门望',
  },
  military: {
    scope: 'military',
    title: '天下军旅',
    eyebrow: '势力诸卷 · 兵力军需',
    emptyMessage: '天下暂无宏观军团。',
    searchPlaceholder: '检索军号、主帅或驻地',
  },
};

function watchedKey(kind: RosterWatchedRef['kind'], id: string): string {
  return `${kind}:${id}`;
}

function situationPhaseOrder(phase: SituationState['phase']): number {
  if (phase === 'critical') return 0;
  if (phase === 'active') return 1;
  return 2;
}

function attentionCompare(left: AttentionCandidate, right: AttentionCandidate): number {
  return ATTENTION_PRIORITY[left.order.kind] - ATTENTION_PRIORITY[right.order.kind]
    || left.order.phase - right.order.phase
    || right.order.tension - left.order.tension
    || right.order.turn - left.order.turn
    || right.order.importance - left.order.importance
    || right.order.value - left.order.value
    || stableCompare(`${left.reason.target.kind}:${left.reason.target.id}`, `${right.reason.target.kind}:${right.reason.target.id}`)
    || stableCompare(left.reason.label, right.reason.label);
}

function candidate(
  kind: RosterAttentionKind,
  label: string,
  target: RosterReasonTarget,
  values: Partial<Omit<RosterAttentionOrder, 'kind'>> = {},
): AttentionCandidate {
  return {
    reason: { kind, label, target },
    order: {
      kind,
      phase: values.phase ?? 3,
      tension: values.tension ?? 0,
      turn: values.turn ?? -1,
      importance: values.importance ?? 0,
      value: values.value ?? 0,
    },
  };
}

function chooseAttention(candidates: readonly AttentionCandidate[]): AttentionCandidate {
  return candidates.slice().sort(attentionCompare)[0];
}

function buildContext(world: WorldState, watchedRefs: readonly RosterWatchedRef[]): ProjectionContext {
  const recentSince = Math.max(0, world.turn - 3);
  const currentEventIds = new Set(world.lastTurn?.eventIds ?? []);
  const currentFactIds = new Set(world.lastTurn?.factIds ?? []);
  const recentEvents = world.history
    .filter((event) => isDefaultVisibleHistoryEvent(event) && event.kind !== 'world_created' && event.turn >= recentSince && (
      event.importance >= 3
      || currentEventIds.has(event.id)
      || event.sourceFactIds.some((id) => currentFactIds.has(id))
    ))
    .slice()
    .sort((left, right) => (
      Number(currentEventIds.has(right.id)) - Number(currentEventIds.has(left.id))
      || right.turn - left.turn
      || right.importance - left.importance
      || stableCompare(left.id, right.id)
    ));
  const offices = new Map<string, OfficeAppointment[]>();
  for (const office of worldOffices(world)) {
    if (!office.active) continue;
    const entries = offices.get(office.holderId) ?? [];
    entries.push(office);
    offices.set(office.holderId, entries);
  }
  for (const entries of offices.values()) {
    entries.sort((left, right) => right.rank - left.rank || stableCompare(left.id, right.id));
  }
  return {
    world,
    watched: new Map(watchedRefs.map((ref) => [watchedKey(ref.kind, ref.id), ref])),
    factsById: new Map(world.facts.map((fact) => [fact.id, fact])),
    recentEvents,
    currentEventIds,
    currentFactIds,
    openSituations: world.situationSystem.situations
      .filter((item) => item.status === 'open' && item.visibility >= OBSERVER_LEAD_VISIBILITY_THRESHOLD)
      .slice()
      .sort((left, right) => (
        situationPhaseOrder(left.phase) - situationPhaseOrder(right.phase)
        || right.tension - left.tension
        || right.importance - left.importance
        || stableCompare(left.id, right.id)
      )),
    characterFamilyIds: new Map(world.characters.map((item) => [item.id, item.familyId])),
    activeOfficesByHolder: offices,
  };
}

function eventIsCurrent(context: ProjectionContext, event: HistoryEvent): boolean {
  return context.currentEventIds.has(event.id)
    || event.sourceFactIds.some((id) => context.currentFactIds.has(id));
}

function eventFacts(context: ProjectionContext, event: HistoryEvent): SimulationFact[] {
  return event.sourceFactIds
    .map((id) => context.factsById.get(id))
    .filter((fact): fact is SimulationFact => Boolean(fact));
}

function factReferencesCharacter(fact: SimulationFact, characterId: string): boolean {
  if (fact.actorIds.includes(characterId)) return true;
  if (fact.stateDeltas.some((delta) => delta.entityType === 'character' && delta.entityId === characterId)) return true;
  switch (fact.kind) {
    case 'appointment_started':
    case 'appointment_ended':
      return fact.payload.holderId === characterId;
    case 'character_death':
      return fact.payload.characterId === characterId;
    case 'marriage':
      return fact.payload.leftCharacterId === characterId || fact.payload.rightCharacterId === characterId;
    case 'battle':
      return fact.payload.attacker.commanderId === characterId
        || fact.payload.attacker.deputyCommanderId === characterId
        || fact.payload.defenders.some((force) => force.commanderId === characterId || force.deputyCommanderId === characterId);
    case 'agency_support_resolved':
    case 'agency_intent_submitted':
    case 'agency_intent_resolved':
    case 'local_governance_resolved':
    case 'embodied_action_submitted':
    case 'embodied_action_resolved':
      return fact.payload.actorId === characterId;
    default:
      return false;
  }
}

function factReferencesFamily(
  context: ProjectionContext,
  fact: SimulationFact,
  familyId: string,
): boolean {
  if (fact.stateDeltas.some((delta) => delta.entityType === 'family' && delta.entityId === familyId)) return true;
  if (fact.actorIds.some((id) => context.characterFamilyIds.get(id) === familyId)) return true;
  return fact.kind === 'marriage'
    && (fact.payload.leftFamilyId === familyId || fact.payload.rightFamilyId === familyId);
}

function factReferencesMilitary(fact: SimulationFact, kind: 'army' | 'fleet', id: string): boolean {
  if (fact.stateDeltas.some((delta) => delta.entityType === kind && delta.entityId === id)) return true;
  if (fact.causes.some((cause) => cause.refs?.some((ref) => (
    ref.kind === 'entity' && ref.entityType === kind && ref.entityId === id
  )))) return true;
  if (kind === 'fleet') {
    return (fact.kind === 'appointment_started' || fact.kind === 'appointment_ended')
      && fact.payload.fleetId === id;
  }
  switch (fact.kind) {
    case 'battle':
      return fact.payload.attacker.armyId === id
        || fact.payload.defenders.some((force) => force.armyId === id);
    case 'appointment_started':
    case 'appointment_ended':
      return fact.payload.armyId === id;
    case 'agency_support_resolved':
    case 'agency_intent_submitted':
    case 'agency_intent_resolved':
      return fact.payload.targetArmyId === id;
    case 'embodied_action_submitted':
    case 'embodied_action_resolved':
      return fact.payload.targetKind === 'army' && fact.payload.targetId === id;
    default:
      return false;
  }
}

function personEvent(context: ProjectionContext, characterId: string): HistoryEvent | undefined {
  return context.recentEvents.find((event) => (
    event.actorIds.includes(characterId)
    || event.stateDeltas.some((delta) => delta.entityType === 'character' && delta.entityId === characterId)
    || eventFacts(context, event).some((fact) => factReferencesCharacter(fact, characterId))
  ));
}

function polityEvent(context: ProjectionContext, polityId: string): HistoryEvent | undefined {
  return context.recentEvents.find((event) => (
    event.polityIds.includes(polityId)
    || event.stateDeltas.some((delta) => delta.entityType === 'polity' && delta.entityId === polityId)
    || eventFacts(context, event).some((fact) => fact.polityIds.includes(polityId))
  ));
}

function familyEvent(context: ProjectionContext, familyId: string): HistoryEvent | undefined {
  return context.recentEvents.find((event) => (
    event.stateDeltas.some((delta) => delta.entityType === 'family' && delta.entityId === familyId)
    || event.actorIds.some((id) => context.characterFamilyIds.get(id) === familyId)
    || eventFacts(context, event).some((fact) => factReferencesFamily(context, fact, familyId))
  ));
}

function militaryEvent(
  context: ProjectionContext,
  kind: 'army' | 'fleet',
  id: string,
): HistoryEvent | undefined {
  return context.recentEvents.find((event) => (
    event.stateDeltas.some((delta) => delta.entityType === kind && delta.entityId === id)
    || eventFacts(context, event).some((fact) => factReferencesMilitary(fact, kind, id))
  ));
}

function eventCandidate(context: ProjectionContext, event: HistoryEvent, label = event.title): AttentionCandidate {
  return candidate(
    eventIsCurrent(context, event) ? 'current-event' : 'recent-event',
    label,
    { kind: 'event', id: event.id },
    { turn: event.turn, importance: event.importance },
  );
}

function watchCandidate(
  context: ProjectionContext,
  kind: RosterWatchedRef['kind'],
  id: string,
): AttentionCandidate | null {
  const watched = context.watched.get(watchedKey(kind, id));
  if (!watched) return null;
  return candidate(
    watched.alert ? 'watched-alert' : 'watched',
    watched.alert ? '关注对象出现新动向' : '已列入关注',
    { kind: 'item', id },
  );
}

function explainWatchAlert(
  watched: AttentionCandidate | null,
  evidence: AttentionCandidate | null,
): AttentionCandidate | null {
  if (!watched || watched.reason.kind !== 'watched-alert' || !evidence) return watched;
  return {
    reason: { ...evidence.reason, kind: 'watched-alert' },
    order: { ...evidence.order, kind: 'watched-alert' },
  };
}

function situationMatches(
  situation: SituationState,
  scope: RosterScope,
  id: string,
): boolean {
  if (scope === 'people') {
    return situation.participants.coreCharacterIds.includes(id)
      || situation.participants.supportingCharacterIds.includes(id)
      || situation.participants.opposingCharacterIds.includes(id)
      || situation.executableActorIds.includes(id);
  }
  if (scope === 'polities') return situation.participants.polityIds.includes(id);
  if (scope === 'families') return situation.participants.familyIds.includes(id);
  return situation.participants.armyIds.includes(id) || situation.participants.fleetIds.includes(id);
}

function situationCandidate(
  context: ProjectionContext,
  scope: RosterScope,
  id: string,
): AttentionCandidate | null {
  const situation = context.openSituations.find((item) => situationMatches(item, scope, id));
  if (!situation) return null;
  const watched = context.watched.get(watchedKey('situation', situation.id));
  const attentionKind: RosterAttentionKind = watched
    ? (watched.alert ? 'watched-alert' : 'watched')
    : situation.phase === 'critical' ? 'critical-situation' : 'open-situation';
  const label = situation.type === 'war_progress'
    ? (scope === 'polities' || scope === 'military' ? '正在交战' : '身处战局')
    : `卷入${situationTypeLabel(situation.type)}`;
  return candidate(attentionKind, label, { kind: 'situation', id: situation.id }, {
    phase: situationPhaseOrder(situation.phase),
    tension: situation.tension,
    turn: situation.lastUpdatedTurn,
    importance: situation.importance,
  });
}

function personIdentity(
  context: ProjectionContext,
  person: CharacterState,
): { id: PersonIdentity; label: string; rank: number } {
  const office = context.activeOfficesByHolder.get(person.id)?.[0];
  if (office?.kind === '君主') return { id: 'ruler', label: '君主', rank: office.rank };
  if (office?.kind === '宰辅' || office?.kind === '枢密使' || office?.kind === '廷臣') {
    return { id: 'court', label: office.kind, rank: office.rank };
  }
  if (office?.kind === '地方长官') return { id: 'governor', label: '地方长官', rank: office.rank };
  if (office) return { id: 'military', label: office.kind, rank: office.rank };
  if (context.world.polities.some((item) => item.alive && item.rulerId === person.id)) {
    return { id: 'ruler', label: '君主', rank: 100 };
  }
  if (person.governedRegionId) return { id: 'governor', label: '地方长官', rank: 55 };
  const army = context.world.armies.find((item) => item.commanderId === person.id || item.deputyCommanderId === person.id);
  if (army) return { id: 'military', label: army.commanderId === person.id ? '军团主帅' : '军团副将', rank: army.commanderId === person.id ? 65 : 45 };
  const fleet = context.world.fleets.find((item) => item.commanderId === person.id || item.deputyCommanderId === person.id);
  if (fleet) return { id: 'military', label: fleet.commanderId === person.id ? '水师提督' : '水师副将', rank: fleet.commanderId === person.id ? 65 : 45 };
  return { id: 'unassigned', label: '暂无实职', rank: 0 };
}

function highOfficeAttentionLabel(identity: ReturnType<typeof personIdentity>): string {
  if (identity.id === 'ruler') return '君主在位';
  if (identity.label === '枢密使') return '执掌枢密';
  if (identity.label === '军团主帅') return '统领一军';
  if (identity.label === '水师提督') return '统领水师';
  return `现任${identity.label}`;
}

function personItems(context: ProjectionContext): RosterItem[] {
  return context.world.characters.filter((item) => item.alive).map((item) => {
    const identity = personIdentity(context, item);
    const recent = personEvent(context, item.id);
    const actualCommand = context.world.armies.some((army) => army.commanderId === item.id)
      || context.world.fleets.some((fleet) => fleet.commanderId === item.id);
    const actionable = projectCharacterEmbodiedActions(context.world, item.id).some((action) => (
      action.available
      && EMBODIED_IDENTITY_ACTION_KINDS.includes(
        action.command.kind as (typeof EMBODIED_IDENTITY_ACTION_KINDS)[number],
      )
    ));
    const watchAlert = watchCandidate(context, 'person', item.id);
    const situation = situationCandidate(context, 'people', item.id);
    const appointment = recent
      ? eventFacts(context, recent).find((fact) => (
        fact.kind === 'appointment_started' && fact.payload.holderId === item.id
      ))
      : undefined;
    const event = recent
      ? eventCandidate(
        context,
        recent,
        appointment?.kind === 'appointment_started'
          ? `本季获任·${appointment.payload.officeKind}`
          : recent.title,
      )
      : null;
    const watched = explainWatchAlert(watchAlert, event ?? situation);
    const structural = identity.rank >= 70
      ? candidate('authority', highOfficeAttentionLabel(identity), { kind: 'item', id: item.id }, { value: identity.rank })
      : actualCommand
        ? candidate('command', '现掌一军', { kind: 'item', id: item.id }, { value: item.leadership })
        : candidate('standing', '声望渐显', { kind: 'item', id: item.id }, { value: item.influence ?? item.renown });
    const attention = chooseAttention([watched, situation, event, structural].filter((entry): entry is AttentionCandidate => Boolean(entry)));
    const quickViews = [
      recent ? 'recent' : null,
      identity.rank >= 70 ? 'high-office' : null,
      actualCommand ? 'command' : null,
      actionable ? 'actionable' : null,
    ].filter((entry): entry is string => Boolean(entry));
    return {
      id: item.id,
      title: item.name,
      subtitle: `${polity(context.world, item.polityId)?.name ?? '无属'} · ${identity.label} · ${item.politicalClass ?? '出身未详'}`,
      meta: `${item.age} 岁 · 影响 ${Math.round(item.influence ?? item.renown)}`,
      accent: polity(context.world, item.polityId)?.color,
      alert: Boolean(watched?.reason.kind === 'watched-alert') || (item.ambition > 78 && item.loyalty < 40),
      reason: attention.reason,
      discovery: {
        quickViews,
        filters: { polity: item.polityId, identity: identity.id },
        sortValues: {
          influence: item.influence ?? item.renown,
          merit: item.merit,
          age: item.age,
        },
        attention: attention.order,
      },
    };
  });
}

function polityItems(context: ProjectionContext): RosterItem[] {
  return context.world.polities.filter((item) => item.alive).map((item) => {
    const atWar = context.world.wars.some((war) => war.active && (war.attackerId === item.id || war.defenderId === item.id));
    const recent = polityEvent(context, item.id);
    const watchAlert = watchCandidate(context, 'country', item.id);
    const situation = situationCandidate(context, 'polities', item.id);
    const event = recent ? eventCandidate(context, recent) : null;
    const watched = explainWatchAlert(watchAlert, event ?? situation);
    const structural = atWar
      ? candidate('urgent-status', '战事未决', { kind: 'item', id: item.id }, { value: item.warWeariness })
      : candidate('standing', '疆域根基', { kind: 'item', id: item.id }, { value: item.controlledRegionIds.length });
    const attention = chooseAttention([watched, situation, event, structural].filter((entry): entry is AttentionCandidate => Boolean(entry)));
    return {
      id: item.id,
      title: item.name,
      subtitle: `${livingCharacter(context.world, item.rulerId)?.name ?? '君位空悬'} · ${region(context.world, item.capitalRegionId)?.name ?? '无都'}`,
      meta: `${item.controlledRegionIds.length} 地 · 威权 ${Math.round(item.authority)}`,
      accent: item.color,
      alert: Boolean(watched?.reason.kind === 'watched-alert') || item.warWeariness > 55,
      reason: attention.reason,
      discovery: {
        quickViews: [],
        filters: { war: atWar ? 'at-war' : 'at-peace' },
        sortValues: {
          territory: item.controlledRegionIds.length,
          population: polityPopulation(context.world, item.id),
          treasury: item.treasury,
          authority: item.authority,
        },
        attention: attention.order,
      },
    };
  });
}

function familyItems(context: ProjectionContext): RosterItem[] {
  return worldFamilies(context.world).map((item) => {
    const recent = familyEvent(context, item.id);
    const watchAlert = watchCandidate(context, 'family', item.id);
    const situation = situationCandidate(context, 'families', item.id);
    const event = recent ? eventCandidate(context, recent) : null;
    const watched = explainWatchAlert(watchAlert, event ?? situation);
    const headAlive = Boolean(character(context.world, item.headId)?.alive);
    const structural = item.active && !headAlive
      ? candidate('urgent-status', '家主之位待定', { kind: 'item', id: item.id }, { value: item.prestige })
      : item.politicalInfluence >= 60
        ? candidate('authority', '门第在朝', { kind: 'item', id: item.id }, { value: item.politicalInfluence })
        : candidate('standing', item.active ? '家望在积累' : '谱系已绝', { kind: 'item', id: item.id }, { value: item.prestige });
    const attention = chooseAttention([watched, situation, event, structural].filter((entry): entry is AttentionCandidate => Boolean(entry)));
    return {
      id: item.id,
      title: item.name,
      subtitle: `${polity(context.world, item.polityId)?.name ?? '无属'} · ${item.active === false ? '谱系已绝' : `家主 ${character(context.world, item.headId)?.name ?? '未定'}`}`,
      meta: `${item.memberIds.length} 人 · 家望 ${Math.round(item.prestige)}`,
      accent: polity(context.world, item.polityId)?.color,
      alert: Boolean(watched?.reason.kind === 'watched-alert') || item.active === false || !headAlive,
      reason: attention.reason,
      discovery: {
        quickViews: [],
        filters: {},
        sortValues: {
          politicalInfluence: item.politicalInfluence,
          prestige: item.prestige,
          wealth: item.wealth,
        },
        attention: attention.order,
      },
    };
  });
}

function militaryItem(
  context: ProjectionContext,
  kind: 'army' | 'fleet',
  item: WorldState['armies'][number] | WorldState['fleets'][number],
): RosterItem {
  const isArmy = kind === 'army';
  const strength = isArmy ? (item as WorldState['armies'][number]).soldiers : (item as WorldState['fleets'][number]).sailors;
  const coverage = item.food / Math.max(1, strength);
  const strained = coverage < 0.75;
  const army = isArmy ? item as WorldState['armies'][number] : null;
  const fleet = isArmy ? null : item as WorldState['fleets'][number];
  const recent = militaryEvent(context, kind, item.id);
  const watchAlert = watchCandidate(context, kind, item.id);
  const situation = situationCandidate(context, 'military', item.id);
  const battle = recent && eventFacts(context, recent).some((fact) => fact.kind === 'battle');
  const event = recent ? eventCandidate(context, recent, battle ? '近季亲历战事' : recent.title) : null;
  const watched = explainWatchAlert(watchAlert, event ?? situation);
  const structural = strained
    ? candidate('urgent-status', `军粮仅余 ${coverage.toFixed(1)} 季`, { kind: 'item', id: item.id }, { value: 1 - coverage })
    : item.morale < 40
      ? candidate('urgent-status', '军心不稳', { kind: 'item', id: item.id }, { value: 40 - item.morale })
      : candidate('command', isArmy ? '军团在列' : '水师在列', { kind: 'item', id: item.id }, { value: strength });
  const attention = chooseAttention([watched, situation, event, structural].filter((entry): entry is AttentionCandidate => Boolean(entry)));
  const location = army
    ? `驻${region(context.world, army.regionId)?.name ?? '途中'}`
    : fleet?.portRegionId
      ? `泊${region(context.world, fleet.portRegionId)?.name ?? '港外'}`
      : fleet?.seaZoneId ? '航行海上' : '待命港外';
  return {
    id: item.id,
    title: item.name,
    subtitle: `${livingCharacter(context.world, item.commanderId)?.name ?? '无帅'} · ${location}${fleet ? ` · ${fleet.mission}` : ''}`,
    meta: `${compact.format(strength)} 人 · 余粮 ${coverage.toFixed(1)} 季`,
    accent: polity(context.world, item.polityId)?.color,
    alert: Boolean(watched?.reason.kind === 'watched-alert') || strained || item.morale < 40,
    reason: attention.reason,
    discovery: {
      quickViews: [],
      filters: { kind, supply: strained ? 'strained' : 'ready' },
      sortValues: { strength, morale: item.morale, supply: coverage },
      attention: attention.order,
    },
  };
}

function militaryItems(context: ProjectionContext): RosterItem[] {
  return [
    ...context.world.armies.filter((item) => item.soldiers > 0).map((item) => militaryItem(context, 'army', item)),
    ...context.world.fleets.filter((item) => item.sailors > 0).map((item) => militaryItem(context, 'fleet', item)),
  ];
}

function discoveryDefinition(world: WorldState, scope: RosterScope): RosterDiscoveryDefinition {
  const attention = { id: 'attention', label: '值得关注', direction: 'desc' as const };
  if (scope === 'people') {
    return {
      scope,
      unitLabel: '人',
      quickViews: [
        { id: 'all', label: '全部' },
        { id: 'recent', label: '近季有事' },
        { id: 'high-office', label: '身居高位' },
        { id: 'command', label: '实际掌军' },
        { id: 'actionable', label: '有职事可办' },
      ],
      filters: [
        {
          id: 'polity',
          label: '所属',
          options: [
            { id: 'all', label: '全部政权' },
            ...world.polities.filter((item) => item.alive).slice().sort((left, right) => stableCompare(left.name, right.name) || stableCompare(left.id, right.id)).map((item) => ({ id: item.id, label: item.name })),
          ],
        },
        {
          id: 'identity',
          label: '身份',
          options: [
            { id: 'all', label: '全部身份' },
            { id: 'ruler', label: '君主' },
            { id: 'court', label: '朝臣' },
            { id: 'governor', label: '地方长官' },
            { id: 'military', label: '军中人物' },
            { id: 'unassigned', label: '暂无实职' },
          ],
        },
      ],
      sorts: [
        attention,
        { id: 'influence', label: '影响力', direction: 'desc' },
        { id: 'merit', label: '功名', direction: 'desc' },
        { id: 'age', label: '年龄', direction: 'asc' },
      ],
    };
  }
  if (scope === 'polities') {
    return {
      scope,
      unitLabel: '国',
      quickViews: [{ id: 'all', label: '全部' }],
      filters: [{
        id: 'war',
        label: '战况',
        options: [
          { id: 'all', label: '全部' },
          { id: 'at-war', label: '正在交战' },
          { id: 'at-peace', label: '暂处和平' },
        ],
      }],
      sorts: [
        attention,
        { id: 'territory', label: '疆域', direction: 'desc' },
        { id: 'population', label: '人口', direction: 'desc' },
        { id: 'treasury', label: '国库', direction: 'desc' },
        { id: 'authority', label: '威权', direction: 'desc' },
      ],
    };
  }
  if (scope === 'families') {
    return {
      scope,
      unitLabel: '族',
      quickViews: [{ id: 'all', label: '全部' }],
      filters: [],
      sorts: [
        attention,
        { id: 'politicalInfluence', label: '朝堂势力', direction: 'desc' },
        { id: 'prestige', label: '家望', direction: 'desc' },
        { id: 'wealth', label: '家产', direction: 'desc' },
      ],
    };
  }
  return {
    scope,
    unitLabel: '支军旅',
    quickViews: [{ id: 'all', label: '全部' }],
    filters: [
      {
        id: 'kind',
        label: '编制',
        options: [
          { id: 'all', label: '全部' },
          { id: 'army', label: '陆军' },
          { id: 'fleet', label: '水师' },
        ],
      },
      {
        id: 'supply',
        label: '军粮',
        options: [
          { id: 'all', label: '全部' },
          { id: 'strained', label: '吃紧' },
          { id: 'ready', label: '尚足' },
        ],
      },
    ],
    sorts: [
      attention,
      { id: 'strength', label: '兵力', direction: 'desc' },
      { id: 'morale', label: '士气', direction: 'desc' },
      { id: 'supply', label: '余粮最少', direction: 'asc' },
    ],
  };
}

function rawItems(context: ProjectionContext, scope: RosterScope): RosterItem[] {
  if (scope === 'people') return personItems(context);
  if (scope === 'polities') return polityItems(context);
  if (scope === 'families') return familyItems(context);
  return militaryItems(context);
}

function collection(
  world: WorldState,
  scope: RosterScope,
  context: ProjectionContext,
): RosterCollectionDefinition {
  const definition = discoveryDefinition(world, scope);
  const items = applyRosterDiscovery(rawItems(context, scope), definition, createRosterDiscoveryState()).items;
  return { ...COLLECTION_COPY[scope], definition, items };
}

/** Pure, deterministic projection of every roster tab from current hot world state. */
export function projectRosterDirectory(
  world: WorldState,
  watchedRefs: readonly RosterWatchedRef[] = [],
): RosterDirectory {
  const context = buildContext(world, watchedRefs);
  const people = collection(world, 'people', context);
  const polities = collection(world, 'polities', context);
  const families = collection(world, 'families', context);
  const military = collection(world, 'military', context);
  return {
    people,
    polities,
    families,
    military,
    sections: [
      { id: 'polities', label: '列国', count: polities.items.length },
      { id: 'families', label: '世家', count: families.items.length },
      {
        id: 'military',
        label: '军旅',
        count: military.items.length,
        alertCount: world.wars.filter((item) => item.active).length
          + military.items.filter((item) => item.alert).length,
      },
    ],
  };
}

/** Project one filtered/sorted roster without constructing the other tabs. */
export function projectRosterCollection(
  world: WorldState,
  scope: RosterScope,
  state: RosterDiscoveryState = createRosterDiscoveryState(),
  watchedRefs: readonly RosterWatchedRef[] = [],
): RosterCollectionProjection {
  const context = buildContext(world, watchedRefs);
  const definition = discoveryDefinition(world, scope);
  const result: RosterDiscoveryResult = applyRosterDiscovery(rawItems(context, scope), definition, state);
  return {
    ...COLLECTION_COPY[scope],
    definition,
    ...result,
  };
}

export function rosterScopeFor(
  view: 'world' | 'powers' | 'people' | 'chronicle',
  powerSection: 'polities' | 'families' | 'military',
): RosterScope | null {
  if (view === 'people') return 'people';
  if (view === 'powers') return powerSection;
  return null;
}

/** Compatibility wrappers retained while App callers migrate to projectRosterDirectory. */
export function polityRoster(world: WorldState): RosterItem[] {
  return projectRosterCollection(world, 'polities').items;
}

export function peopleRoster(world: WorldState): RosterItem[] {
  return projectRosterCollection(world, 'people').items;
}

export function familyRoster(world: WorldState): RosterItem[] {
  return projectRosterCollection(world, 'families').items;
}

export function militaryRoster(world: WorldState): RosterItem[] {
  return projectRosterCollection(world, 'military').items;
}
