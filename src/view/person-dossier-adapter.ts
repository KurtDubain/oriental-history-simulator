import type {
  PersonAgencyCommandRequestView,
  PersonAgencyQuarterChoiceView,
  PersonInspectorData,
  PersonRelationshipView,
} from '../components/Inspector';
import type { ArchiveDossier, ArchiveRecord } from '../components/HistoricalArchive';
import type {
  BiographyFact,
  CharacterState,
  HistoryEvent,
  RelationshipState,
  SimulationFact,
  WorldState,
} from '../sim/types';
import {
  findWorldHistoryEvent,
  readWorldFacts,
  readWorldHistory,
} from '../sim/archive';
import {
  projectCharacterAgency,
  toCharacterAgencyPlayerProjection,
  toPersonalMemoryPlayerViews,
  type CharacterAgencyShadowProjection,
} from '../sim/agency';
import { calculateCharacterPowerPosition } from '../sim/politics/power-ledger';
import { projectHistoricalScenes } from './historical-scenes';
import { isDefaultVisibleHistoryEvent } from './history-visibility';
import {
  character,
  eventArchiveRecord,
  family,
  polity,
  region,
  toHistoricalSceneView,
  toPowerMovementView,
  toPowerResourceView,
  turnLabel,
  uniqueArchiveLinks,
  worldRelationships,
} from './dossier-adapter-shared';
import {
  projectPersonPoliticalFocus,
  type PoliticalFocusLink,
} from './political-focus';

export type PersonInspectorProjection = PersonInspectorData & {
  politicalFocus: readonly PoliticalFocusLink[];
};

export type PersonArchiveProjection = ArchiveDossier & {
  politicalFocus: readonly PoliticalFocusLink[];
};

interface PersonExperienceEntry {
  turn: number;
  record: ArchiveRecord;
}

function factNamesCharacter(fact: SimulationFact, characterId: string): boolean {
  if (!fact.actorIds.includes(characterId)) return false;
  switch (fact.kind) {
    case 'battle':
      return [fact.payload.attacker, ...fact.payload.defenders].some((force) => (
        force.commanderId === characterId || force.deputyCommanderId === characterId
      ));
    case 'appointment_started':
    case 'appointment_ended':
      return fact.payload.holderId === characterId;
    case 'character_death':
      return fact.payload.characterId === characterId;
    case 'marriage':
      return fact.payload.leftCharacterId === characterId || fact.payload.rightCharacterId === characterId;
    default:
      return true;
  }
}

function biographySource(
  item: CharacterState,
  biography: BiographyFact,
  eventById: ReadonlyMap<string, HistoryEvent>,
  factById: ReadonlyMap<string, SimulationFact>,
): { event: HistoryEvent | null; fact: SimulationFact | null } | null {
  if (biography.factId !== null) {
    if (biography.eventId !== null) return null;
    const sourceFact = factById.get(biography.factId);
    return sourceFact && sourceFact.turn === biography.turn && factNamesCharacter(sourceFact, item.id)
      ? { event: null, fact: sourceFact }
      : null;
  }
  if (biography.eventId !== null) {
    const sourceEvent = eventById.get(biography.eventId);
    return sourceEvent && sourceEvent.turn === biography.turn && sourceEvent.actorIds.includes(item.id)
      ? { event: sourceEvent, fact: null }
      : null;
  }
  return biography.kind === '旧档人物' && biography.turn === 0
    ? { event: null, fact: null }
    : null;
}

function appointmentSummary(world: WorldState, item: CharacterState, fact: Extract<SimulationFact, { kind: 'appointment_started' | 'appointment_ended' }>): string {
  const owner = polity(world, fact.payload.polityId)?.name ?? '所属政权';
  const scope = fact.payload.armyId
    ? world.armies.find((army) => army.id === fact.payload.armyId)?.name ?? '所部军团'
    : fact.payload.fleetId
      ? world.fleets.find((fleet) => fleet.id === fact.payload.fleetId)?.name ?? '所部水师'
      : fact.payload.regionId
        ? region(world, fact.payload.regionId)?.name ?? '地方官署'
        : '中枢官署';
  return fact.kind === 'appointment_started'
    ? `${item.name}受${owner}任为${fact.payload.officeKind}，职掌系于${scope}。`
    : `${item.name}卸下${owner}${fact.payload.officeKind}之职，原职掌系于${scope}。`;
}

/**
 * Projects a person's dated record from sources that explicitly name that
 * person. Biography prose is presentation data, so every linked entry is
 * checked against its authoritative Fact or Chronicle actor list before it is
 * shown. Appointment Facts are included even though they deliberately have no
 * Chronicle projection.
 */
export function toPersonExperienceRecords(
  world: WorldState,
  item: CharacterState,
  readScope: 'all' | 'active' = 'all',
): ArchiveRecord[] {
  const entries: PersonExperienceEntry[] = [];
  const knownEventIds = new Set<string>();
  const knownFactIds = new Set<string>();
  const biography = Array.isArray(item.biography) ? item.biography : [];
  const history = (readScope === 'all' ? readWorldHistory(world) : world.history)
    .filter(isDefaultVisibleHistoryEvent);
  const facts = readScope === 'all' ? readWorldFacts(world) : world.facts;
  const eventById = new Map(history.map((event) => [event.id, event]));
  const factById = new Map(facts.map((fact) => [fact.id, fact]));
  const eventsBySourceFactId = new Map<string, HistoryEvent[]>();
  for (const event of history) {
    if (!event.actorIds.includes(item.id)) continue;
    for (const sourceFactId of event.sourceFactIds) {
      const linked = eventsBySourceFactId.get(sourceFactId) ?? [];
      linked.push(event);
      eventsBySourceFactId.set(sourceFactId, linked);
    }
  }

  for (const fact of biography) {
    const source = biographySource(item, fact, eventById, factById);
    if (!source) continue;
    const linkedFactEvents = source.fact
      ? (eventsBySourceFactId.get(source.fact.id) ?? []).filter((event) => event.turn === fact.turn)
      : [];
    const canonicalEvents = source.event ? [source.event] : linkedFactEvents;
    const canonicalEvent = canonicalEvents[0] ?? null;
    for (const linkedEvent of canonicalEvents) {
      knownEventIds.add(linkedEvent.id);
      // The opening Chronicle is an umbrella for many independent founding
      // Facts. Treating every one of them as already narrated by a person's
      // generic “entered the annals” biography would hide that person's
      // concrete initial appointment. Ordinary events remain canonical for
      // all of their direct source Facts.
      if (linkedEvent.kind !== 'world_created') {
        for (const sourceFactId of linkedEvent.sourceFactIds) knownFactIds.add(sourceFactId);
      }
    }
    if (source.fact) knownFactIds.add(source.fact.id);
    entries.push({
      turn: fact.turn,
      record: {
        ...(canonicalEvent ? eventArchiveRecord(canonicalEvent) : {
          id: fact.id,
          date: turnLabel(fact.turn),
          title: fact.kind,
          summary: fact.summary,
          eventId: null,
          importance: fact.importance,
        }),
        // Biography rows are the person's index into a canonical Fact or
        // Chronicle, not a second telling. Keep the biography identity for
        // stable dossier ordering while reusing any Chronicle projection that
        // cites the same Fact.
        id: fact.id,
      },
    });
  }

  for (const event of history) {
    if (!event.actorIds.includes(item.id) || knownEventIds.has(event.id)) continue;
    entries.push({
      turn: event.turn,
      record: eventArchiveRecord(event),
    });
    knownEventIds.add(event.id);
    if (event.kind !== 'world_created') {
      for (const sourceFactId of event.sourceFactIds) knownFactIds.add(sourceFactId);
    }
  }

  const appointmentFacts = facts.filter((fact): fact is Extract<SimulationFact, { kind: 'appointment_started' | 'appointment_ended' }> => (
    (fact.kind === 'appointment_started' || fact.kind === 'appointment_ended')
    && factNamesCharacter(fact, item.id)
  ));
  const startedAppointmentIds = new Set(appointmentFacts
    .filter((fact) => fact.kind === 'appointment_started')
    .map((fact) => fact.payload.appointmentId));
  for (const fact of appointmentFacts) {
    if (knownFactIds.has(fact.id)) continue;
    entries.push({
      turn: fact.turn,
      record: {
        id: `${item.id}:experience:${fact.id}`,
        date: turnLabel(fact.turn),
        title: fact.kind === 'appointment_started' ? `就任${fact.payload.officeKind}` : `卸任${fact.payload.officeKind}`,
        summary: appointmentSummary(world, item, fact),
        eventId: null,
        importance: fact.importance,
      },
    });
  }

  for (const office of world.offices) {
    if (office.holderId !== item.id || startedAppointmentIds.has(office.id)) continue;
    const owner = polity(world, office.polityId)?.name ?? '所属政权';
    entries.push({
      turn: office.appointedTurn,
      record: {
        id: `${item.id}:experience:${office.id}:initial`,
        date: turnLabel(office.appointedTurn),
        title: `任${office.kind}`,
        summary: `${item.name}在初始官档中登记为${owner}${office.kind}。`,
        eventId: null,
        importance: office.rank >= 80 ? 2 : 1,
      },
    });
  }

  return entries
    .sort((left, right) => left.turn - right.turn || left.record.id.localeCompare(right.record.id))
    .map((entry) => entry.record);
}

function characterTraits(item: CharacterState) {
  const traits: string[] = [];
  if (item.ambition >= 72) traits.push('雄心炽盛');
  if (item.loyalty >= 75) traits.push('重诺');
  if (item.loyalty <= 35) traits.push('离心');
  if (item.caution >= 72) traits.push('审慎');
  if (item.caution <= 30) traits.push('敢决');
  if (item.renown >= 65) traits.push('声名远播');
  return traits.length ? traits : ['尚未显露鲜明声名'];
}

function relationSalience(item: RelationshipState) {
  return Math.max(Math.abs(item.affinity), item.trust, item.fear, item.grievance, item.gratitude);
}

function relationSentiment(item: RelationshipState) {
  if (item.grievance >= 65) return '积怨深重';
  if (item.fear >= 65) return '敬惧';
  if (item.trust >= 70 && item.affinity >= 30) return '亲信';
  if (item.gratitude >= 60) return '感恩';
  if (item.affinity <= -35) return '不睦';
  if (item.affinity >= 35) return '亲近';
  return '往来平淡';
}

interface PersonRelationshipPair {
  targetId: string;
  outward?: RelationshipState;
  inward?: RelationshipState;
}

function inverseKinship(kinship: RelationshipState['kinship']): RelationshipState['kinship'] {
  if (kinship === '父母') return '子女';
  if (kinship === '子女') return '父母';
  return kinship;
}

function preferredDirection(
  current: RelationshipState | undefined,
  candidate: RelationshipState,
): RelationshipState {
  if (!current) return candidate;
  const salienceDifference = relationSalience(candidate) - relationSalience(current);
  if (salienceDifference !== 0) return salienceDifference > 0 ? candidate : current;
  if (candidate.lastInteractionTurn !== current.lastInteractionTurn) {
    return candidate.lastInteractionTurn > current.lastInteractionTurn ? candidate : current;
  }
  return candidate.id.localeCompare(current.id) < 0 ? candidate : current;
}

function relationshipLabel(pair: PersonRelationshipPair): string {
  if (pair.outward?.kinship && pair.outward.kinship !== '无') return pair.outward.kinship;
  if (pair.inward?.kinship && pair.inward.kinship !== '无') return inverseKinship(pair.inward.kinship);
  const latestMemory = [
    ...(pair.outward?.memories ?? []),
    ...(pair.inward?.memories ?? []),
  ].sort((left, right) => right.turn - left.turn || left.summary.localeCompare(right.summary))[0];
  return latestMemory?.kind ?? '相识';
}

function relationshipMemories(
  subjectName: string,
  targetName: string,
  pair: PersonRelationshipPair,
): string[] {
  const projected = [
    ...(pair.outward?.memories ?? []).map((memory) => ({ memory, owner: subjectName })),
    ...(pair.inward?.memories ?? []).map((memory) => ({ memory, owner: targetName })),
  ];
  const grouped = new Map<string, { turn: number; summary: string; owners: Set<string> }>();
  for (const { memory, owner } of projected) {
    const sourceKey = memory.eventId
      ? `event:${memory.eventId}`
      : `memory:${memory.turn}:${memory.kind}`;
    const key = `${sourceKey}:${memory.summary}`;
    const current = grouped.get(key);
    if (current) {
      current.owners.add(owner);
      current.turn = Math.max(current.turn, memory.turn);
    } else {
      grouped.set(key, { turn: memory.turn, summary: memory.summary, owners: new Set([owner]) });
    }
  }
  return [...grouped.values()]
    .sort((left, right) => right.turn - left.turn || left.summary.localeCompare(right.summary))
    .slice(0, 2)
    .map((entry) => entry.owners.size > 1
      ? `双方所记：${entry.summary}`
      : `${[...entry.owners][0]}所记：${entry.summary}`);
}

function projectPersonRelationships(world: WorldState, item: CharacterState): PersonRelationshipView[] {
  const pairs = new Map<string, PersonRelationshipPair>();
  for (const relation of worldRelationships(world)) {
    const outward = relation.sourceId === item.id;
    const inward = relation.targetId === item.id;
    if (!outward && !inward) continue;
    const targetId = outward ? relation.targetId : relation.sourceId;
    if (targetId === item.id) continue;
    const pair = pairs.get(targetId) ?? { targetId };
    if (outward) pair.outward = preferredDirection(pair.outward, relation);
    else pair.inward = preferredDirection(pair.inward, relation);
    pairs.set(targetId, pair);
  }

  return [...pairs.values()]
    .sort((left, right) => {
      const leftSalience = Math.max(
        left.outward ? relationSalience(left.outward) : 0,
        left.inward ? relationSalience(left.inward) : 0,
      );
      const rightSalience = Math.max(
        right.outward ? relationSalience(right.outward) : 0,
        right.inward ? relationSalience(right.inward) : 0,
      );
      const leftTurn = Math.max(left.outward?.lastInteractionTurn ?? -1, left.inward?.lastInteractionTurn ?? -1);
      const rightTurn = Math.max(right.outward?.lastInteractionTurn ?? -1, right.inward?.lastInteractionTurn ?? -1);
      return rightSalience - leftSalience || rightTurn - leftTurn || left.targetId.localeCompare(right.targetId);
    })
    .slice(0, 10)
    .map((pair) => {
      const targetName = character(world, pair.targetId)?.name ?? '无名之人';
      const outwardSentiment = pair.outward ? relationSentiment(pair.outward) : '尚无定见';
      const inwardSentiment = pair.inward ? relationSentiment(pair.inward) : '尚无记载';
      const outwardDetail = pair.outward
        ? `信任 ${Math.round(pair.outward.trust)} · 怨 ${Math.round(pair.outward.grievance)}`
        : '未留下明确态度';
      const inwardDetail = pair.inward
        ? `信任 ${Math.round(pair.inward.trust)} · 怨 ${Math.round(pair.inward.grievance)}`
        : '未留下明确态度';
      return {
        id: `${item.id}:relation:${pair.targetId}`,
        targetId: pair.targetId,
        name: targetName,
        relation: relationshipLabel(pair),
        sentiment: outwardSentiment,
        detail: `${item.name}：${outwardSentiment}（${outwardDetail}）；${targetName}：${inwardSentiment}（${inwardDetail}）`,
        memories: relationshipMemories(item.name, targetName, pair),
      };
    });
}

export interface PersonAgencyDossierOptions {
  projection?: CharacterAgencyShadowProjection | null;
  quarterChoice?: PersonAgencyQuarterChoiceView | null;
  commandRequest?: PersonAgencyCommandRequestView | null;
}

function naturalAgencyLabel(label: string): string {
  if (label === '争取独立统军') return '谋求独领一军';
  if (label === '正式请求独立军令') return '向朝廷请领军令';
  return label;
}

type AgencyIntentSubmittedFact = Extract<SimulationFact, { kind: 'agency_intent_submitted' }>;
type AgencyIntentResolvedFact = Extract<SimulationFact, { kind: 'agency_intent_resolved' }>;

const COMMAND_PLAN_STEP_LABELS: Readonly<Record<string, string>> = {
  earn_merit: '积累可查证的功绩',
  seek_patronage: '寻找愿意提携自己的上位者',
  build_military_support: '在军中建立支持',
  seek_family_backing: '争取家族背书',
  request_independent_command: '向朝廷请领军令',
};

function commandSourceEventId(world: WorldState, sourceFactId: string): string | null {
  return [...world.history]
    .filter((event) => isDefaultVisibleHistoryEvent(event) && event.sourceFactIds.includes(sourceFactId))
    .sort((left, right) => right.turn - left.turn || right.id.localeCompare(left.id))[0]?.id ?? null;
}

function commandCheckEvidence(
  fact: AgencyIntentResolvedFact,
): PersonAgencyCommandRequestView['evidence'] {
  const copy: Readonly<Record<string, { pass: string; fail: string }>> = {
    permission: {
      pass: '仍任该军副将，授令权也未发生变化',
      fail: '军职或授令权已经改变，此次请求无从继续',
    },
    resource: {
      pass: '副将历练与可查战功足以进入朝廷考量',
      fail: '副将历练与可查战功仍显不足',
    },
    relationship: {
      pass: '已有可查支持足以进入朝廷考量',
      fail: '尚无足够的上位提携或家门背书',
    },
    risk: {
      pass: '朝廷认为授令风险尚可承受',
      fail: '朝廷担心军权过重，暂不愿授令',
    },
  };
  const reasonCode = String(fact.payload.reasonCode);
  const institution = fact.payload.institutionResponse === 'curbed'
    ? [{ tone: 'barrier' as const, label: '朝廷回应', detail: '军令未授，此人的副将之职也已被撤下' }]
    : fact.payload.institutionResponse === 'appeased'
      ? [{ tone: 'support' as const, label: '朝廷回应', detail: '军令未授，但朝廷另以名位与礼遇安抚' }]
      : [];
  const decisive = reasonCode === 'claim_weaker'
    ? [{ tone: 'barrier' as const, label: '掣肘', detail: '与现任主帅相比，朝廷认为其资望仍不足' }]
    : reasonCode === 'competing_request'
      ? [{ tone: 'barrier' as const, label: '掣肘', detail: '同一朝廷本季另有更优先的军令请求' }]
      : [];
  const relationshipDetail = (check: AgencyIntentResolvedFact['payload']['checks'][number]): string => {
    if (check.kind !== 'relationship' || !check.passed) return copy[check.kind]?.fail ?? '这项条件仍未具备';
    const passedSources = new Set(check.components?.filter((item) => item.passed).map((item) => item.source) ?? []);
    const patrons = [
      passedSources.has('commander_patronage') ? '主帅' : null,
      passedSources.has('ruler_patronage') ? '主君' : null,
    ].filter((item): item is string => Boolean(item));
    const familyBacks = passedSources.has('family_backing');
    if (patrons.length && familyBacks) return `${patrons.join('与')}愿意提携，家门也足以背书`;
    if (patrons.length) return `${patrons.join('与')}已有明确提携`;
    if (familyBacks) return '家门声望足以为其背书';
    return copy.relationship.pass;
  };
  const checks = [...fact.payload.checks]
    .sort((left, right) => Number(left.passed) - Number(right.passed)
      || ['permission', 'resource', 'relationship', 'risk'].indexOf(left.kind)
        - ['permission', 'resource', 'relationship', 'risk'].indexOf(right.kind))
    .map((check) => ({
      tone: check.passed ? 'support' as const : 'barrier' as const,
      label: check.passed ? '有利' : '掣肘',
      detail: check.kind === 'relationship'
        ? relationshipDetail(check)
        : check.passed
          ? copy[check.kind]?.pass ?? '这项条件已经具备'
          : copy[check.kind]?.fail ?? '这项条件仍未具备',
    }));
  return [...institution, ...decisive, ...checks].slice(0, 3);
}

function commandResolutionCopy(
  fact: AgencyIntentResolvedFact,
  armyName: string,
): Pick<PersonAgencyCommandRequestView, 'stage' | 'statusLabel' | 'title' | 'summary'> {
  if (fact.payload.outcome === 'executed') {
    return {
      stage: 'approved',
      statusLabel: '军令已授',
      title: `获授${armyName}军令`,
      summary: `此前请令获准，现已由副将升任${armyName}主帅。`,
    };
  }
  if (fact.payload.outcome === 'invalidated') {
    return {
      stage: 'blocked',
      statusLabel: '请令作罢',
      title: `所请${armyName}军令已经作罢`,
      summary: '军职或授令权已经改变，原有请求资格不再成立。',
    };
  }
  if (fact.payload.outcome === 'deferred') {
    const reason = String(fact.payload.reasonCode);
    return {
      stage: 'blocked',
      statusLabel: '暂缓授令',
      title: `所请${armyName}军令暂缓再议`,
      summary: reason === 'insufficient_record'
        ? '朝廷认为军旅履历仍显不足，待再有功绩后复议。'
        : reason === 'insufficient_support'
          ? '军中与朝廷支持尚未稳固，此次暂缓再议。'
          : reason === 'competing_request'
            ? '同一朝廷本季另有更优先的军令请求，此请暂缓再议。'
            : '朝廷本季没有作出授令决定，留待日后复议。',
    };
  }
  if (fact.payload.institutionResponse === 'curbed') {
    return {
      stage: 'blocked',
      statusLabel: '已遭削权',
      title: `请领${armyName}军令未准，副将之职被撤`,
      summary: '朝廷把这次请令视作军权风险；没有授令，并撤下其副将之职。',
    };
  }
  if (fact.payload.institutionResponse === 'appeased') {
    return {
      stage: 'blocked',
      statusLabel: '另受安抚',
      title: `未获${armyName}军令，朝廷另作安抚`,
      summary: '资望尚不足以换帅；朝廷没有交出军令，但以名位与礼遇作了安抚。',
    };
  }
  return {
    stage: 'blocked',
    statusLabel: '此次未准',
    title: `朝廷未准${armyName}军令`,
    summary: fact.payload.reasonCode === 'court_risk'
      ? '朝廷担心军权过重，本季没有准许这项请求。'
      : '朝廷认为其资望尚不足以取代现任主帅，本季未准。',
  };
}

function naturalCommandEvidence(value: string): string {
  const retryTurn = value.match(/等到第(\d+)回合再议/);
  return retryTurn
    ? `上次裁决后尚在等待，${turnLabel(Number(retryTurn[1]))}方可再议`
    : value;
}

function preparedCommandEvidence(
  world: WorldState,
  actor: WorldState['agencyDecisionSystem']['actors'][number],
): PersonAgencyCommandRequestView['evidence'] {
  const preparations = actor.plan.steps.filter((step) => step.action !== 'request_independent_command');
  const request = actor.plan.steps.find((step) => step.action === 'request_independent_command');
  const requestBarrier = request?.status === 'blocked'
    ? [{ tone: 'barrier' as const, label: '掣肘', detail: naturalCommandEvidence(request.evidence) }]
    : [];
  const completed = preparations
    .filter((step) => step.status === 'completed')
    .map((step) => ({ tone: 'support' as const, label: '有利', detail: naturalCommandEvidence(step.evidence) }));
  const missing = preparations
    .filter((step) => step.status !== 'completed')
    .map((step) => ({ tone: 'barrier' as const, label: '掣肘', detail: naturalCommandEvidence(step.evidence) }));
  const latestSupport = actor.supportActions.at(-1);
  const supportEvidence = latestSupport ? [{
    tone: latestSupport.outcome === 'secured' ? 'support' as const : 'barrier' as const,
    label: latestSupport.outcome === 'secured' ? '已行' : '上次所行',
    detail: latestSupport.action === 'cultivate_military_support'
      ? latestSupport.outcome === 'secured'
        ? `${world.armies.find((army) => army.id === actor.goal.targetArmyId)?.name ?? '本军'}已有将校明确响应`
        : '联络本军将校未成，眼下还没有可用的军中支持'
      : `${world.characters.find((character) => character.id === latestSupport.targetId)?.name ?? '所请之人'}${latestSupport.outcome === 'secured' ? '已经明确答应背书' : latestSupport.outcome === 'deferred' ? '仍在观望，没有明确答应' : '没有答应替其背书'}`,
  }] : [];
  return [...supportEvidence, ...requestBarrier, ...missing.slice(0, supportEvidence.length || requestBarrier.length ? 0 : 1), ...completed].slice(0, 3);
}

interface CommandRequestProjection {
  view: PersonAgencyCommandRequestView | null;
  authoritative: boolean;
}

type AgencyDecisionActor = WorldState['agencyDecisionSystem']['actors'][number];

function latestTerminalCommandResolution(
  world: WorldState,
  actor: AgencyDecisionActor,
  outcome: 'executed' | 'invalidated',
): AgencyIntentResolvedFact | undefined {
  return [...world.facts]
    .filter((fact): fact is AgencyIntentResolvedFact => (
      fact.kind === 'agency_intent_resolved'
      && fact.payload.actorId === actor.characterId
      && fact.payload.goalId === actor.goal.id
      && fact.payload.targetArmyId === actor.goal.targetArmyId
      && fact.payload.outcome === outcome
    ))
    .sort((left, right) => right.turn - left.turn || right.id.localeCompare(left.id))[0];
}

function commandAppointmentEventId(
  world: WorldState,
  actor: AgencyDecisionActor,
): string | null {
  return [...world.history]
    .filter((event) => isDefaultVisibleHistoryEvent(event) && event.stateDeltas.some((delta) => (
      delta.entityType === 'army'
      && delta.entityId === actor.goal.targetArmyId
      && delta.field === 'commanderId'
      && delta.after === actor.characterId
    )))
    .sort((left, right) => right.turn - left.turn || right.id.localeCompare(left.id))[0]?.id ?? null;
}

function currentTerminalCommandRequest(
  world: WorldState,
  actor: AgencyDecisionActor,
  armyName: string,
): PersonAgencyCommandRequestView | null {
  const character = world.characters.find((item) => item.id === actor.characterId);
  const targetArmy = world.armies.find((item) => item.id === actor.goal.targetArmyId);
  const commandsTarget = Boolean(
    character?.alive
    && targetArmy?.commanderId === actor.characterId
    && character.commandingArmyId === actor.goal.targetArmyId,
  );
  const commandAchieved = commandsTarget || actor.goal.status === 'achieved';
  const requestInvalidated = !commandAchieved && (
    actor.goal.status === 'invalidated'
    || !character?.alive
    || !targetArmy
    || targetArmy.deputyCommanderId !== actor.characterId
  );
  if (!commandAchieved && !requestInvalidated) return null;

  const terminalOutcome = commandAchieved ? 'executed' : 'invalidated';
  const terminalResolution = latestTerminalCommandResolution(world, actor, terminalOutcome)
    ?? (actor.lastResolutionFactId
      ? world.facts.find((fact): fact is AgencyIntentResolvedFact => (
          fact.kind === 'agency_intent_resolved'
          && fact.id === actor.lastResolutionFactId
          && fact.payload.actorId === actor.characterId
          && fact.payload.goalId === actor.goal.id
          && fact.payload.institutionResponse === 'curbed'
        ))
      : undefined);
  if (terminalResolution) {
    return {
      id: terminalResolution.payload.submissionFactId,
      periodLabel: turnLabel(terminalResolution.turn),
      ...commandResolutionCopy(terminalResolution, armyName),
      evidence: commandCheckEvidence(terminalResolution),
      sourceEventId: commandSourceEventId(world, terminalResolution.id),
    };
  }

  if (commandAchieved) {
    const appointmentEventId = commandAppointmentEventId(world, actor);
    const appointmentEvent = appointmentEventId
      ? findWorldHistoryEvent(world, appointmentEventId)
      : undefined;
    return {
      id: actor.goal.id,
      stage: 'approved',
      periodLabel: turnLabel(appointmentEvent?.turn ?? actor.goal.resolvedTurn ?? actor.goal.lastReviewedTurn),
      statusLabel: '已经掌军',
      title: `现掌${armyName}军令`,
      summary: `此人后来经正式任命成为${armyName}主帅，早先的请令结果已不再代表现状。`,
      evidence: [{ tone: 'support', label: '现任', detail: `军团与人物任职记录均表明其正在统领${armyName}` }],
      sourceEventId: appointmentEventId,
    };
  }

  const closedTurn = actor.goal.resolvedTurn ?? actor.goal.lastReviewedTurn;
  const requestExhausted = actor.goal.closureReason === 'request_exhausted';
  const actorDead = !character?.alive || actor.goal.closureReason === 'actor_dead';
  const targetMissing = !targetArmy || actor.goal.closureReason === 'target_missing';
  if (requestExhausted) {
    const finalAttempt = actor.lastResolutionFactId
      ? world.facts.find((fact): fact is AgencyIntentResolvedFact => (
        fact.kind === 'agency_intent_resolved'
        && fact.id === actor.lastResolutionFactId
        && fact.payload.actorId === actor.characterId
        && fact.payload.goalId === actor.goal.id
      ))
      : undefined;
    return {
      id: actor.goal.id,
      stage: 'blocked',
      periodLabel: turnLabel(closedTurn),
      statusLabel: '暂搁此议',
      title: `请领${armyName}军令之议暂且搁下`,
      summary: '三次请令均未获准，此人暂且搁下此议；日后境况有变，仍可重新起意。',
      evidence: [{ tone: 'barrier', label: '缘由', detail: '多次正式请令已有裁定，眼下不再继续申求' }],
      sourceEventId: finalAttempt ? commandSourceEventId(world, finalAttempt.id) : null,
    };
  }
  return {
    id: actor.goal.id,
    stage: 'blocked',
    periodLabel: turnLabel(closedTurn),
    statusLabel: actorDead ? '此事已止' : targetMissing ? '所指已失' : '已经离任',
    title: actorDead
      ? `请领${armyName}军令之事已止`
      : targetMissing
        ? `原先所指军团已经不复存在`
        : `已无从再请领${armyName}军令`,
    summary: actorDead
      ? '人物已经去世，原有请令打算随其生平一并终止。'
      : targetMissing
        ? '原先所指军团已经不复存在，这项打算失去了对象。'
        : '此人如今已不再担任该军副将，早先未准或暂缓的结果已不再代表眼下进展。',
    evidence: [{
      tone: 'barrier',
      label: '现状',
      detail: actorDead
        ? '人物生卒记录表明其已无法继续请令'
        : targetMissing
          ? '当世军团名录中已无原先所指军团'
          : '当前军职记录中，此人已不是该军副将',
    }],
    sourceEventId: null,
  };
}

export function toPersonCommandRequestView(
  world: WorldState,
  characterId: string,
): CommandRequestProjection {
  const actor = world.agencyDecisionSystem?.actors.find((entry) => entry.characterId === characterId);
  if (!actor) return { view: null, authoritative: false };
  const armyName = world.armies.find((army) => army.id === actor.goal.targetArmyId)?.name ?? '所部军团';
  const terminalView = currentTerminalCommandRequest(world, actor, armyName);
  if (terminalView) return { view: terminalView, authoritative: true };
  const resolved = actor.lastResolutionFactId
    ? world.facts.find((fact): fact is AgencyIntentResolvedFact => (
      fact.kind === 'agency_intent_resolved'
      && fact.id === actor.lastResolutionFactId
      && fact.payload.actorId === characterId
    ))
    : undefined;
  if (resolved) {
    const copy = commandResolutionCopy(resolved, armyName);
    return {
      authoritative: true,
      view: {
        id: resolved.payload.submissionFactId,
        periodLabel: turnLabel(resolved.turn),
        ...copy,
        evidence: commandCheckEvidence(resolved),
        sourceEventId: commandSourceEventId(world, resolved.id),
      },
    };
  }
  const resolvedSubmissionIds = new Set(world.facts
    .filter((fact): fact is AgencyIntentResolvedFact => fact.kind === 'agency_intent_resolved')
    .map((fact) => fact.payload.submissionFactId));
  const submitted = [...world.facts]
    .filter((fact): fact is AgencyIntentSubmittedFact => (
      fact.kind === 'agency_intent_submitted'
      && fact.payload.actorId === characterId
      && fact.payload.goalId === actor.goal.id
      && !resolvedSubmissionIds.has(fact.id)
    ))
    .sort((left, right) => right.turn - left.turn || right.id.localeCompare(left.id))[0];
  if (submitted) {
    return {
      authoritative: true,
      view: {
        id: submitted.id,
        stage: 'submitted',
        periodLabel: turnLabel(submitted.turn),
        statusLabel: '已经请令',
        title: `已向朝廷请领${armyName}军令`,
        summary: '请令已经入册，尚待朝廷作出裁定。',
        evidence: [{ tone: 'support', label: '已行', detail: '正式请令已经递出，不再只是个人盘算' }],
        sourceEventId: commandSourceEventId(world, submitted.id),
      },
    };
  }
  if (actor.goal.status !== 'active') return { view: null, authoritative: true };
  const completedCount = actor.plan.steps.filter((step) => (
    step.action !== 'request_independent_command' && step.status === 'completed'
  )).length;
  const currentStep = actor.plan.steps.find((step) => step.status === 'available');
  const requestStep = actor.plan.steps.find((step) => step.action === 'request_independent_command');
  const stage = completedCount > 0 ? 'preparing' : 'planned';
  return {
    authoritative: true,
    view: {
      id: actor.goal.id,
      stage,
      periodLabel: `起意于${turnLabel(actor.goal.createdTurn)}`,
      statusLabel: stage === 'planned' ? '已有此意' : '正在筹备',
      title: stage === 'planned' ? `想独领${armyName}` : `为请领${armyName}军令铺路`,
      summary: currentStep
        ? currentStep.action === 'request_independent_command'
          ? '所需条件已经大致齐备，下一步才会正式请令。'
          : `眼下先${COMMAND_PLAN_STEP_LABELS[currentStep.action] ?? '补足所需准备'}；尚未正式请令。`
        : requestStep?.evidence
          ? `${naturalCommandEvidence(requestStep.evidence)}，尚未正式请令。`
          : '所需准备尚未齐备，眼下还不能正式请令。',
      evidence: preparedCommandEvidence(world, actor),
      sourceEventId: null,
    },
  };
}

export function toPersonInspector(
  world: WorldState,
  item: CharacterState,
  options: PersonAgencyDossierOptions = {},
): PersonInspectorProjection {
  const owner = polity(world, item.polityId);
  const home = region(world, item.locationRegionId);
  const personFamily = family(world, item.familyId);
  const projectedAgency = toCharacterAgencyPlayerProjection(
    options.projection ?? projectCharacterAgency(world, item.id),
  );
  const projectedCommandRequest = toPersonCommandRequestView(world, item.id);
  const commandRequest = options.commandRequest !== undefined
    ? options.commandRequest
    : projectedCommandRequest.view;
  const hasAuthoritativeCommandRequest = options.commandRequest !== undefined
    ? Boolean(options.commandRequest)
    : projectedCommandRequest.authoritative;
  const powerPosition = calculateCharacterPowerPosition(world, item.id);
  const powerFaction = powerPosition.factionId
    ? world.factions.find((faction) => faction.id === powerPosition.factionId)
    : undefined;
  const powerScenes = projectHistoricalScenes(
    world,
    world.facts.filter((fact) => {
      if (fact.turn < Math.max(0, world.turn - 24)) return false;
      if (fact.kind === 'agency_support_resolved'
        || fact.kind === 'agency_intent_submitted'
        || fact.kind === 'agency_intent_resolved'
        || fact.kind === 'local_governance_resolved') {
        return fact.payload.actorId === item.id;
      }
      return (fact.kind === 'appointment_started' || fact.kind === 'appointment_ended')
        && fact.payload.holderId === item.id;
    }),
    3,
    'active',
  ).map(toHistoricalSceneView);
  const agency = {
    ...projectedAgency,
    primaryGoal: projectedAgency.primaryGoal
      ? { ...projectedAgency.primaryGoal, label: naturalAgencyLabel(projectedAgency.primaryGoal.label) }
      : null,
    secondaryGoals: projectedAgency.secondaryGoals.map((goal) => ({
      ...goal,
      label: naturalAgencyLabel(goal.label),
    })),
    currentPlanSteps: projectedAgency.currentPlanSteps.map((step) => ({
      ...step,
      label: naturalAgencyLabel(step.label),
    })),
    memories: toPersonalMemoryPlayerViews(world, item.id),
    quarterChoice: hasAuthoritativeCommandRequest ? null : options.quarterChoice ?? null,
    commandRequest,
    powerPosition: {
      total: powerPosition.total,
      standing: powerPosition.standing,
      groupName: powerFaction?.name ?? null,
      resources: powerPosition.resources.slice(0, 6).map((resource) => toPowerResourceView(world, resource)),
      recentMovements: powerPosition.recentMovements.map((movement) => toPowerMovementView(world, movement)),
    },
    recentPowerScenes: powerScenes,
  };
  const currentStep = agency.currentPlanSteps.find((step) => step.status === 'available');
  const coreDesires = agency.desires.map((desire) => desire.label);
  const relationships = projectPersonRelationships(world, item);
  const experiences = toPersonExperienceRecords(world, item, 'active').slice(-12).reverse();
  return {
    id: item.id,
    name: item.name,
    age: item.age,
    gender: item.sex,
    role: item.alive ? item.role : '已故',
    lifeStage: item.lifeStage,
    politicalClass: item.politicalClass,
    tier: item.tier,
    origin: home?.name,
    family: personFamily?.name ?? `${item.familyName}氏`,
    familyId: personFamily?.id ?? null,
    polity: owner?.name,
    health: item.alive ? 100 : 0,
    influence: item.influence,
    personalWealth: item.personalWealth,
    merit: item.merit,
    deputyExperience: item.deputyExperience,
    insubordination: item.insubordination,
    ambition: item.ambition,
    loyalty: item.loyalty,
    caution: item.caution,
    abilities: {
      command: item.leadership,
      martial: Math.round(item.leadership * 0.72 + item.caution * 0.12),
      governance: item.governance,
      strategy: item.cunning,
      charisma: Math.round((item.renown + item.loyalty) / 2),
      scholarship: Math.round((item.governance + item.cunning) / 2),
    },
    agency,
    traits: characterTraits(item),
    relationships,
    experiences,
    politicalFocus: projectPersonPoliticalFocus(world, item),
    summary: commandRequest && ['submitted', 'approved', 'blocked'].includes(commandRequest.stage)
      ? `请令：${commandRequest.title}。${commandRequest.summary}`
      : agency.primaryGoal
        ? `所图：${agency.primaryGoal.label}。${currentStep ? `眼下先${currentStep.label}` : agency.primaryGoal.reason}${agency.primaryGoal.barrier ? `；难处在于${agency.primaryGoal.barrier}` : ''}。`
      : agency.availability === 'dormant'
        ? `最看重${coreDesires.join('与') || agency.longTermDirectionLabel}，尚未成年，眼下还没有明确打算。`
        : agency.availability === 'closed'
          ? `此人生平已定；其长远所重以${agency.longTermDirectionLabel}为先。`
          : `最看重${coreDesires.join('与') || agency.longTermDirectionLabel}，眼下仍在权衡。`,
  };
}

export function toPersonArchive(
  world: WorldState,
  item: CharacterState,
  options: PersonAgencyDossierOptions = {},
): PersonArchiveProjection {
  const inspector = toPersonInspector(world, item, options);
  const owner = polity(world, item.polityId);
  const personFamily = family(world, item.familyId);
  const records: ArchiveRecord[] = toPersonExperienceRecords(world, item);
  const relationships = inspector.relationships ?? [];
  const agency = inspector.agency;
  const desireSentence = agency?.desires.length
    ? `${item.name}眼下最看重${agency.desires.map((desire) => desire.label).join('与')}`
    : `${item.name}的心中轻重尚未显明`;
  const goalSentence = agency?.primaryGoal
    ? `目前正在盘算「${agency.primaryGoal.label}」；${agency.primaryGoal.reason}${agency.primaryGoal.barrier ? `，眼下难处在于${agency.primaryGoal.barrier}` : ''}。`
    : agency?.availability === 'dormant'
      ? '年岁尚轻，尚未形成可以付诸世事的打算。'
      : agency?.availability === 'closed'
        ? '生平已定，不再形成新的打算。'
        : '眼下尚未形成明确打算。';
  const agencyActionSentence = agency?.commandRequest
    ? agency.commandRequest.stage === 'planned'
      ? `${agency.commandRequest.title}，目前仍只是一个念头，尚未开始铺路。`
      : agency.commandRequest.stage === 'preparing'
        ? `${agency.commandRequest.title}，目前仍在筹备，尚未正式请令。`
        : `${agency.commandRequest.title}；${agency.commandRequest.summary}`
    : '这些只是当下盘算，不代表行动已经发生。';
  return {
    id: item.id,
    kind: 'person',
    eyebrow: '人物传 · 生平行状',
    title: `${item.name}传`,
    subtitle: `${owner?.name ?? '无属'} · ${item.role} · ${item.lifeStage ?? `${item.age}岁`}`,
    lead: `${item.name}并非一组能力数字。出身决定最初的道路，性情与欲望塑造每次选择，而战争、任职、恩怨和挫折将这些选择写成人生。`,
    facts: [
      { label: '生年', value: turnLabel(item.birthTurn ?? Math.max(0, world.turn - item.age * 4)) },
      { label: '家族', value: inspector.family ?? '家世不详' }, { label: '阶层', value: item.politicalClass ?? '出身未详' },
      { label: '功绩', value: String(Math.round(item.merit ?? 0)) }, { label: '影响', value: String(Math.round(item.influence ?? item.renown)) },
      { label: '现职', value: item.alive ? item.role : '已故' },
    ],
    chapters: [
      { id: 'origin', title: '身世与起点', paragraphs: [`${item.name}出自${personFamily?.name ?? `${item.familyName}氏`}，被归入${item.politicalClass ?? '未详'}阶层，早年活动于${region(world, item.locationRegionId)?.name ?? '乡里失考'}。`, item.adultTurn === null ? '尚未成年，未来身份仍将受家族与时代局势塑造。' : `于${turnLabel(item.adultTurn)}步入成年，此后才真正进入任职、婚姻与政治选择的网络。`] },
      { id: 'career', title: '仕途与功业', paragraphs: [`现任${item.role}，功绩${Math.round(item.merit ?? 0)}、个人影响${Math.round(item.influence ?? item.renown)}。${inspector.summary ?? ''}`, item.commandingArmyId ? `手握军令，且有${Math.round(item.deputyExperience ?? 0)}点副将历练；其抗命倾向为${Math.round(item.insubordination ?? 0)}。` : '此时未直接统率军团，政治与家族网络更能决定其下一步。'] },
      { id: 'mind', title: '心志与关系', paragraphs: [`${desireSentence}。${goalSentence}${agencyActionSentence}`, relationships.length ? `与其关系最深者包括${relationships.slice(0, 4).map((relation) => `${relation.name}（${relation.sentiment}）`).join('、')}。` : '现存史料未留下足以构成长期记忆的人际关系。'] },
    ],
    records,
    politicalFocus: inspector.politicalFocus,
    links: uniqueArchiveLinks([
      personFamily ? { id: personFamily.id, kind: 'family', label: personFamily.name, detail: '所属家族' } : null,
      owner ? { id: owner.id, kind: 'country', label: owner.name, detail: '所仕政权' } : null,
      ...relationships.slice(0, 7).map((relation) => ({ id: relation.targetId, kind: 'person' as const, label: relation.name, detail: `${relation.relation} · ${relation.sentiment}` })),
    ]).slice(0, 10),
  };
}
