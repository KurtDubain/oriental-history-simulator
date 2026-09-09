import type {
  PersonAgencyCommandRequestView,
  PersonAgencyView,
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
} from '../sim/archive';
import {
  projectCharacterDesires,
  ROOT_DESIRE_LABELS,
  toPersonalMemoryPlayerViews,
  type CharacterAgencyDecisionState,
} from '../sim/agency';
import { calculateCharacterPowerPosition } from '../sim/politics/power-ledger';
import { battleRecoveryStatus } from '../sim/military/battle-readiness';
import { canonicalEventKey, canonicalStoryKey, playerHistoryText, projectFactNarrative, projectHistoricalScenes } from './historical-scenes';
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
import { projectPersonStoryArc, personHistoricalOffice, personShortBiography, personHistoryEvidence } from './person-story-arc';
import { continuousRulerSeatIds } from '../sim/facts/projector';

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
  if (fact.kind !== 'battle' && !fact.actorIds.includes(characterId)) return false;
  switch (fact.kind) {
    case 'battle':
      return [fact.payload.attacker, ...fact.payload.defenders].some((force) => (
        force.commanderId === characterId || force.deputyCommanderId === characterId
        || force.allegianceCharacterId === characterId
        || force.participants?.some((participant) => participant.characterId === characterId)
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
  const evidence = readScope === 'all' ? personHistoryEvidence(world) : null;
  const history = (evidence?.events ?? world.history)
    .filter(isDefaultVisibleHistoryEvent);
  const facts = evidence?.facts ?? world.facts;
  const continuations = evidence?.continuations ?? continuousRulerSeatIds(facts);
  const eventById = new Map(history.map((event) => [event.id, event]));
  const factById = new Map(facts.map((fact) => [fact.id, fact]));
  const claimed = new Set<string>();
  const battles = facts.filter((fact): fact is Extract<SimulationFact, { kind: 'battle' }> => (
    fact.kind === 'battle' && factNamesCharacter(fact, item.id)
  )).sort((a, b) => a.turn - b.turn || a.id.localeCompare(b.id));
  const firstDeputy = battles.find((fact) => [fact.payload.attacker, ...fact.payload.defenders]
    .some((side) => side.deputyCommanderId === item.id));
  const battleRecord = (fact: SimulationFact | undefined, record: ArchiveRecord): ArchiveRecord => {
    if (fact?.kind !== 'battle') return record;
    const first = readScope === 'all' && fact.id === battles[0]?.id;
    const deputy = readScope === 'all' && !first && fact.id === firstDeputy?.id;
    const narrative = projectFactNarrative(world, fact);
    return { ...record, title: `${first ? '首次参战 · ' : deputy ? '首次以副将身份参战 · ' : ''}${narrative.title}`,
      summary: `${item.name}${deputy ? '首次以副将身份随军' : '参战'}。${narrative.summary}` };
  };
  const addEvent = (event: HistoryEvent, id = event.id) => {
    const sourceFacts = event.sourceFactIds.map(sourceId => factById.get(sourceId));
    const relocation = sourceFacts.length > 0 && sourceFacts.every(f => f && continuations.has(f.id));
    const continued = relocation ? sourceFacts.find(f => f?.kind === 'appointment_started') : undefined;
    if (relocation && !continued) return;
    const key = canonicalEventKey(event, factById);
    if (claimed.has(key) || event.kind !== 'world_created' && event.sourceFactIds.length > 0
      && event.sourceFactIds.every((sourceId) => knownFactIds.has(sourceId))) return;
    claimed.add(key);
    const battle = event.sourceFactIds.map((factId) => factById.get(factId))
      .find((fact) => fact?.kind === 'battle' && factNamesCharacter(fact, item.id));
    entries.push({ turn: event.turn, record: continued?.kind === 'appointment_started'
      ? { ...eventArchiveRecord(event), id, title: '君位移驻', summary: `${item.name}仍在位，君位驻地改为${region(world, continued.payload.regionId)?.name ?? '新驻地'}。` }
      : battleRecord(battle, { ...eventArchiveRecord(event), id }) });
    knownEventIds.add(event.id);
    if (event.kind !== 'world_created') event.sourceFactIds.forEach((factId) => knownFactIds.add(factId));
  };
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
    // This old biography label described a deputy debut and was bounded; reconstruct from all battles.
    if (fact.kind === '首次参战') continue;
    const source = biographySource(item, fact, eventById, factById);
    if (!source) continue;
    const linkedFactEvents = source.fact
      ? (eventsBySourceFactId.get(source.fact.id) ?? []).filter((event) => event.turn === fact.turn)
      : [];
    const canonicalEvents = source.event ? [source.event] : linkedFactEvents;
    const canonicalEvent = canonicalEvents[0] ?? null;
    if (canonicalEvent) { addEvent(canonicalEvent, fact.id); continue; }
    const key = source.fact ? canonicalStoryKey(source.fact) : fact.id;
    if (claimed.has(key)) continue;
    claimed.add(key);
    if (source.fact) knownFactIds.add(source.fact.id);
    entries.push({
      turn: fact.turn,
      record: battleRecord(source.fact ?? undefined, {
        id: fact.id,
        date: turnLabel(fact.turn), title: fact.kind, summary: fact.summary,
        eventId: null, importance: fact.importance,
      }),
    });
  }

  for (const event of history) {
    if (!event.actorIds.includes(item.id) || knownEventIds.has(event.id)) continue;
    addEvent(event);
  }

  for (const fact of battles) {
    if (knownFactIds.has(fact.id)) continue;
    entries.push({ turn: fact.turn, record: battleRecord(fact, {
      id: `${item.id}:experience:${fact.id}`, date: turnLabel(fact.turn), ...projectFactNarrative(world, fact),
      eventId: null, importance: fact.importance,
    }) });
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
    const continued = continuations.has(fact.id);
    if (continued && fact.kind === 'appointment_ended') continue;
    entries.push({
      turn: fact.turn,
      record: {
        id: `${item.id}:experience:${fact.id}`,
        date: turnLabel(fact.turn),
        title: continued ? '君位移驻' : fact.kind === 'appointment_started' ? `就任${fact.payload.officeKind}` : `卸任${fact.payload.officeKind}`,
        summary: continued ? `${item.name}仍在位，君位驻地改为${region(world, fact.payload.regionId)?.name ?? '新驻地'}。` : appointmentSummary(world, item, fact),
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
    .map(({ record }) => ({ ...record, title: playerHistoryText(world, record.title), summary: playerHistoryText(world, record.summary) }));
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
        memories: relationshipMemories(item.name, targetName, pair).map((text) => playerHistoryText(world, text)),
      };
    });
}

type AgencyIntentSubmittedFact = Extract<SimulationFact, { kind: 'agency_intent_submitted' }>;
type AgencyIntentResolvedFact = Extract<SimulationFact, { kind: 'agency_intent_resolved' }>;

const COMMAND_PLAN_STEP_LABELS: Readonly<Record<string, string>> = {
  earn_merit: '积累军功',
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
      pass: '仍任副将，授令权未变',
      fail: '军职或授令权已变',
    },
    resource: {
      pass: '历练与战功足以请令',
      fail: '历练与战功不足',
    },
    relationship: {
      pass: '已有足够支持',
      fail: '提携与家门支持不足',
    },
    risk: {
      pass: '朝廷认为可以授令',
      fail: '朝廷顾忌军权过重',
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
      summary: '军职已变，此请作罢。',
    };
  }
  if (fact.payload.outcome === 'deferred') {
    const reason = String(fact.payload.reasonCode);
    return {
      stage: 'blocked',
      statusLabel: '暂缓授令',
      title: `所请${armyName}军令暂缓再议`,
      summary: reason === 'insufficient_record'
        ? '履历不足，待立功后再议。'
        : reason === 'insufficient_support'
          ? '支持不足，暂缓再议。'
          : reason === 'competing_request'
            ? '朝廷先议另一份请令。'
            : '朝廷尚未决定授令。',
    };
  }
  if (fact.payload.institutionResponse === 'curbed') {
    return {
      stage: 'blocked',
      statusLabel: '已遭削权',
      title: `请领${armyName}军令未准，副将之职被撤`,
      summary: '朝廷顾忌军权，驳回请令并撤下副将之职。',
    };
  }
  if (fact.payload.institutionResponse === 'appeased') {
    return {
      stage: 'blocked',
      statusLabel: '另受安抚',
      title: `未获${armyName}军令，朝廷另作安抚`,
      summary: '未获军令，另以名位安抚。',
    };
  }
  return {
    stage: 'blocked',
    statusLabel: '此次未准',
    title: `朝廷未准${armyName}军令`,
    summary: fact.payload.reasonCode === 'court_risk'
      ? '朝廷顾忌军权，未准。'
      : '资望不足以换帅，未准。',
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
      evidence: [{ tone: 'support', label: '现任', detail: `现领${armyName}` }],
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
      ? '人物已经去世，请令至此终止。'
      : targetMissing
        ? '所请军团已经解散。'
        : '已不再担任该军副将，此请作罢。',
    evidence: [],
    sourceEventId: null,
  };
}

export function toPersonCommandRequestView(
  world: WorldState,
  characterId: string,
): PersonAgencyCommandRequestView | null {
  const actor = world.agencyDecisionSystem?.actors.find((entry) => entry.characterId === characterId);
  if (!actor) return null;
  const armyName = world.armies.find((army) => army.id === actor.goal.targetArmyId)?.name ?? '所部军团';
  const terminalView = currentTerminalCommandRequest(world, actor, armyName);
  if (terminalView) return terminalView;
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
      id: resolved.payload.submissionFactId,
      periodLabel: turnLabel(resolved.turn),
      ...copy,
      evidence: commandCheckEvidence(resolved),
      sourceEventId: commandSourceEventId(world, resolved.id),
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
      id: submitted.id,
      stage: 'submitted',
      periodLabel: turnLabel(submitted.turn),
      statusLabel: '已经请令',
      title: `已向朝廷请领${armyName}军令`,
      summary: '请令已经入册，尚待朝廷作出裁定。',
      evidence: [{ tone: 'support', label: '已行', detail: '请令已递出' }],
      sourceEventId: commandSourceEventId(world, submitted.id),
    };
  }
  if (actor.goal.status !== 'active') return null;
  const completedCount = actor.plan.steps.filter((step) => (
    step.action !== 'request_independent_command' && step.status === 'completed'
  )).length;
  const currentStep = actor.plan.steps.find((step) => step.status === 'available');
  const requestStep = actor.plan.steps.find((step) => step.action === 'request_independent_command');
  const stage = completedCount > 0 ? 'preparing' : 'planned';
  return {
    id: actor.goal.id,
    stage,
    periodLabel: `起意于${turnLabel(actor.goal.createdTurn)}`,
    statusLabel: stage === 'planned' ? '已有此意' : '正在筹备',
    title: stage === 'planned' ? `想独领${armyName}` : `为请领${armyName}军令铺路`,
    summary: currentStep
      ? currentStep.action === 'request_independent_command'
        ? '准备已齐，尚待请令。'
        : `眼下先${COMMAND_PLAN_STEP_LABELS[currentStep.action] ?? '补足所需准备'}；尚未正式请令。`
      : requestStep?.evidence
        ? `${naturalCommandEvidence(requestStep.evidence)}，尚未正式请令。`
        : '准备未齐，尚不能请令。',
    evidence: preparedCommandEvidence(world, actor),
    sourceEventId: null,
  };
}

function decisionClosureReason(actor: CharacterAgencyDecisionState): string {
  if (actor.goal.status === 'achieved' || actor.goal.closureReason === 'command_obtained') {
    return '已经获得这支军团的正式军令';
  }
  if (actor.goal.closureReason === 'actor_dead') return '人物已故，此事终止';
  if (actor.goal.closureReason === 'position_lost') return '已不再担任所指军团的副将，无从继续请令';
  if (actor.goal.closureReason === 'target_missing') return '所指军团已经不复存在';
  if (actor.goal.closureReason === 'request_exhausted') return '屡请未准，暂且搁下';
  return '这项打算已经结束';
}

function projectAuthoritativeAgency(
  world: WorldState,
  item: CharacterState,
  commandRequest: PersonAgencyCommandRequestView | null,
): PersonAgencyView {
  const desire = projectCharacterDesires(world, item.id);
  const actor = world.agencyDecisionSystem.actors.find((entry) => entry.characterId === item.id);
  const coreKinds = actor?.coreDesireKinds ?? desire.coreDesireKinds.slice(0, 2);
  const desires = coreKinds
    .filter((kind, index, values) => values.indexOf(kind) === index)
    .slice(0, 2)
    .map((kind) => ({
      label: ROOT_DESIRE_LABELS[kind],
      core: true,
      reason: '',
    }));
  const availability: PersonAgencyView['availability'] = !item.alive
    ? 'closed'
    : item.age < 16 || item.lifeStage === '幼年' || item.lifeStage === '成长'
      ? 'dormant'
      : 'active';
  const currentStep = actor?.plan.steps.find((step) => step.status === 'available')
    ?? actor?.plan.steps.find((step) => step.status === 'blocked');
  const armyName = actor
    ? world.armies.find((army) => army.id === actor.goal.targetArmyId)?.name ?? '所部军团'
    : null;
  const primaryGoal = actor && armyName ? {
    id: actor.goal.id,
    label: `谋求独领${armyName}`,
    status: actor.goal.status,
    reason: actor.goal.status === 'active'
      ? `${turnLabel(actor.goal.createdTurn)}起，此人开始为独领${armyName}作准备`
      : decisionClosureReason(actor),
    barrier: actor.goal.status === 'active' ? naturalCommandEvidence(currentStep?.evidence ?? '') : '',
  } : null;
  const currentPlanSteps = actor?.plan.steps.map((step) => ({
    label: COMMAND_PLAN_STEP_LABELS[step.action] ?? '推进眼下的打算',
    status: step.status,
    reason: naturalCommandEvidence(step.evidence),
  })) ?? [];
  const reason = availability === 'closed'
    ? '已故，不再行动'
    : availability === 'dormant'
      ? '尚未成年'
      : actor
        ? '已有打算，随演变推进'
        : '眼下没有新的行动';
  return {
    availability,
    reason,
    barrier: primaryGoal?.barrier || null,
    longTermDirectionLabel: ROOT_DESIRE_LABELS[coreKinds[0] ?? 'safety'],
    desires,
    primaryGoal,
    currentPlanSteps,
    memories: toPersonalMemoryPlayerViews(world, item.id),
    commandRequest,
  };
}

export function toPersonInspector(
  world: WorldState,
  item: CharacterState,
): PersonInspectorProjection {
  const owner = polity(world, item.polityId);
  const home = region(world, item.locationRegionId);
  const personFamily = family(world, item.familyId);
  const commandRequest = toPersonCommandRequestView(world, item.id);
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
    ...projectAuthoritativeAgency(world, item, commandRequest),
    powerPosition: {
      total: powerPosition.total,
      standing: powerPosition.standing,
      groupName: powerFaction?.name ?? null,
      resources: powerPosition.resources.slice(0, 6).map((resource) => toPowerResourceView(world, resource)),
      recentMovements: powerPosition.recentMovements.map((movement) => toPowerMovementView(world, movement)),
    },
    recentPowerScenes: powerScenes,
  };
  const storyArc = projectPersonStoryArc(world, item);
  const relationships = projectPersonRelationships(world, item);
  const experiences = toPersonExperienceRecords(world, item).slice(-12).reverse();
  const personalForce = world.personalForces.find((force) => force.ownerId === item.id);
  const formation = personalForce?.formationId
    ? world.armies.find((army) => army.id === personalForce.formationId)
    : undefined;
  const inspectorFacts = item.alive ? world.facts : personHistoryEvidence(world).facts;
  const latestBattle = [...inspectorFacts].reverse().find((fact) => fact.kind === 'battle' && (
    fact.payload.attacker.participants?.some((participant) => participant.characterId === item.id)
    || fact.payload.defenders.some((defender) => defender.participants?.some((participant) => participant.characterId === item.id))
    || [fact.payload.attacker, ...fact.payload.defenders].some((side) => (
      side.commanderId === item.id || side.deputyCommanderId === item.id || side.allegianceCharacterId === item.id
    ))
  ));
  const latestPersonalBattle = latestBattle?.kind === 'battle'
    ? [latestBattle.payload.attacker, ...latestBattle.payload.defenders]
      .flatMap((side) => side.participants ?? [])
      .find((participant) => participant.characterId === item.id)
    : undefined;
  const forceFactionId = item.factionId ?? latestPersonalBattle?.factionId ?? null;
  const forceFaction = forceFactionId ? world.factions.find((faction) => faction.id === forceFactionId) : undefined;
  const recovery = item.alive ? battleRecoveryStatus(world, item.id) : null;
  const resting = Boolean(item.alive && (recovery?.recovering || item.health < 55));
  const lastCommander = latestPersonalBattle
    ? world.characters.find((character) => character.id === latestPersonalBattle.formationCommanderId)?.name ?? '主将不详'
    : '无';
  return {
    id: item.id,
    name: item.name,
    age: item.age,
    gender: item.sex,
    role: item.alive ? item.role : `生前曾任${personHistoricalOffice(world, item)}`,
    lifeStage: item.lifeStage,
    politicalClass: item.politicalClass,
    tier: item.tier,
    origin: home?.name,
    family: personFamily?.name ?? `${item.familyName}氏`,
    familyId: personFamily?.id ?? null,
    polity: owner?.name,
    health: item.alive ? item.health : 0,
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
    storyArc,
    militaryForce: personalForce || !item.alive && latestPersonalBattle ? {
      soldiers: personalForce?.soldiers ?? latestPersonalBattle?.soldiersAfter ?? 0,
      cohesion: personalForce?.cohesion,
      readiness: personalForce?.readiness,
      status: personalForce ? recovery?.recovering ? `休养至第${recovery.untilTurn}季` : resting ? '仍在养伤' : personalForce.status : '已解散',
      location: home?.name ?? '所在不详',
      faction: forceFaction?.name ?? '未入主要集团',
      formation: formation
        ? item.id === formation.commanderId ? `自领${formation.name}` : `随${world.characters.find((character) => character.id === formation.commanderId)?.name ?? '主将'}出征${home ? home.name : ''}`
        : personalForce ? resting ? '退离行营休养' : '独立驻留' : '最后一战后散归',
      commander: formation
        ? item.id === formation.commanderId ? '自领' : world.characters.find((character) => character.id === formation.commanderId)?.name ?? '主将暂缺'
        : personalForce ? '无' : lastCommander,
      latestBattle: latestBattle?.kind === 'battle'
        ? `最近参战：${region(world, latestBattle.payload.targetRegionId)?.name ?? '无名战场'}，本部${latestPersonalBattle?.soldiersBefore ?? 0}人损失${latestPersonalBattle?.losses ?? 0}人，战后余${latestPersonalBattle?.soldiersAfter ?? 0}人。`
        : null,
    } : undefined,
    politicalFocus: projectPersonPoliticalFocus(world, item),
    summary: personShortBiography(world, item, storyArc),
  };
}

export function toPersonArchive(
  world: WorldState,
  item: CharacterState,
): PersonArchiveProjection {
  const inspector = toPersonInspector(world, item);
  const owner = polity(world, item.polityId);
  const personFamily = family(world, item.familyId);
  const records: ArchiveRecord[] = toPersonExperienceRecords(world, item);
  const relationships = inspector.relationships ?? [];
  return {
    id: item.id,
    kind: 'person',
    eyebrow: '人物传 · 生平行状',
    title: `${item.name}传`,
    subtitle: `${owner?.name ?? '无属'} · ${inspector.role} · ${item.lifeStage ?? `${item.age}岁`}`,
    lead: inspector.summary ?? '',
    facts: [
      { label: '生年', value: turnLabel(item.birthTurn ?? Math.max(0, world.turn - item.age * 4)) },
      { label: '家族', value: inspector.family ?? '家世不详' }, { label: '阶层', value: item.politicalClass ?? '出身未详' },
      { label: '功绩', value: String(Math.round(item.merit ?? 0)) }, { label: '影响', value: String(Math.round(item.influence ?? item.renown)) },
      { label: '现职', value: item.alive ? item.role : '已故' },
    ],
    chapters: [],
    records,
    politicalFocus: inspector.politicalFocus,
    links: uniqueArchiveLinks([
      personFamily ? { id: personFamily.id, kind: 'family', label: personFamily.name, detail: '所属家族' } : null,
      owner ? { id: owner.id, kind: 'country', label: owner.name, detail: '所仕政权' } : null,
      ...relationships.slice(0, 7).map((relation) => ({ id: relation.targetId, kind: 'person' as const, label: relation.name, detail: `${relation.relation} · ${relation.sentiment}` })),
    ]).slice(0, 10),
  };
}
