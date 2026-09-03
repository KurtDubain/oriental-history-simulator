import { emitSimulationFact, type FactTurnBuffer } from '../facts';
import { stableCompare, stableHash } from '../random';
import {
  factionAllianceEndMatchesFormation,
  politicalAllianceFormationFact,
  type FactionRelationChangedFact,
} from './faction-commitments';
import type {
  CharacterState,
  CommitmentState,
  EventCause,
  FactionEndReason,
  FactionKind,
  FactionLifecycleRecord,
  FactionState,
  HistoryEvent,
  StateDelta,
  WorldState,
} from '../types';

export interface FactionChronicleInput {
  category: HistoryEvent['category'];
  kind: string;
  title: string;
  summary: string;
  importance: HistoryEvent['importance'];
  actorIds?: string[];
  polityIds?: string[];
  regionIds?: string[];
  causes: EventCause[];
  evidence?: string[];
  stateDeltas?: StateDelta[];
  sourceFactIds?: string[];
  situationIds?: string[];
}

export type EmitFactionChronicle = (input: FactionChronicleInput) => HistoryEvent;

const MAX_ACTIVE_FACTIONS_PER_POLITY = 4;
const MAX_CORE_MEMBERS = 5;
const MAX_LIFECYCLE_RECORDS = 12;
const MAX_BIOGRAPHY_RECORDS = 80;

const POLITICAL_REASON_TEXT: Readonly<Record<string, string>> = {
  opening_order: '开局人物依照军旅、亲族与现实任职根基结成集团',
  shared_root: '人物因共同军旅、亲族、任职或明确支持形成集团',
  legacy_boundary: '旧卷只保留当时的派系关系，具体年月已不可考',
  leader_unavailable: '原领袖已无法继续主持派系事务',
  leader_departed: '原领袖已脱离所属政权，不再能主持旧派事务',
  shared_agenda: '数名人物围绕同一政治主张共同议事',
  internal_break: '成员之间的主张与信任裂痕已无法调和',
  allied_union: '两个同盟派系决定结束旧名并合议重组',
  split_grievance: '分裂留下的旧怨使双方公开相争',
  court_support_exchange: '双方以朝中支持交换合作承诺',
  faction_merge: '旧派合议重组，原有关系随旧身份一并终止',
  faction_core_exhausted: '派系已没有能够继续维系议席的核心人物',
  faction_polity_destroyed: '所属政权覆亡，原有朝局关系随之终止',
  faction_polity_dissolved: '所属政权解体，原有朝局关系随之终止',
  core_exhausted: '派系已没有能够继续维系议席的核心人物',
  polity_destroyed: '所属政权已经覆亡',
  polity_dissolved: '所属政权已经解体',
};

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function politicalReasonText(reasonCode: string): string {
  const direct = POLITICAL_REASON_TEXT[reasonCode];
  if (direct) return direct;
  if (reasonCode.endsWith('_superseded')) return '新的政治关系取代了双方此前的约定';
  return '双方所处的政治条件已经发生变化';
}

function currentDeathFactIds(context: FactTurnBuffer, characterIds: readonly string[]): string[] {
  const characters = new Set(characterIds);
  return context.facts
    .filter((fact) => fact.kind === 'character_death' && characters.has(fact.payload.characterId))
    .map((fact) => fact.id)
    .sort(stableCompare);
}

export function factionKindFor(character: CharacterState): FactionKind {
  if (character.politicalClass === '宗室' || character.politicalClass === '外戚') return '宗室';
  if (character.politicalClass === '军门' || character.commandingArmyId || character.commandingFleetId) return '军门';
  if (character.politicalClass === '地方豪强' || character.governedRegionId) return '地方';
  if (character.politicalClass === '士族') return '士族';
  return '官僚';
}

export function factionAgendaFor(character: CharacterState): FactionState['agenda'] {
  const kind = factionKindFor(character);
  if (kind === '军门') return character.caution >= character.ambition + 15 ? '维持秩序' : '对外战争';
  if (kind === '地方') return character.loyalty >= 72 ? '维持秩序' : '地方自治';
  if (kind === '宗室') return character.ambition >= 72 && character.loyalty < 62 ? '扩张权势' : '维持秩序';
  if (kind === '士族') return character.ambition >= 72 ? '扩张权势' : '休养生息';
  if (character.governance + character.caution >= character.ambition + character.cunning + 24) return '休养生息';
  return character.loyalty >= 72 ? '维持秩序' : '扩张权势';
}

function scoreLeader(character: CharacterState): number {
  return character.influence * 2 + character.renown + character.cunning + character.merit * 0.4;
}

function orderedMembers(world: WorldState, memberIds: readonly string[]): CharacterState[] {
  const ids = new Set(memberIds);
  return world.characters
    .filter((character) => ids.has(character.id) && character.alive && character.age >= 16)
    .sort((left, right) => scoreLeader(right) - scoreLeader(left) || stableCompare(left.id, right.id));
}

function hasExplicitBacking(world: WorldState, memberId: string, leaderId: string): boolean {
  return (world.relationships ?? []).some((relation) => (
    ((relation.sourceId === memberId && relation.targetId === leaderId)
      || (relation.sourceId === leaderId && relation.targetId === memberId))
    && (relation.kinship !== '无' || relation.trust >= 64 || relation.gratitude >= 24
      || relation.memories.some((memory) => ['提携', '共战', '恩义'].includes(memory.kind)))
  )) || (world.facts ?? []).some((fact) => (
    fact.kind === 'agency_support_resolved'
    && fact.payload.outcome === 'secured'
    && ((fact.payload.actorId === memberId && fact.payload.targetId === leaderId)
      || (fact.payload.actorId === leaderId && fact.payload.targetId === memberId))
  ));
}

function isPowerBearer(world: WorldState, member: CharacterState, leaderId: string): boolean {
  return member.id === leaderId
    || Boolean(member.commandingArmyId || member.commandingFleetId || member.governedRegionId)
    || (world.armies ?? []).some((army) => army.deputyCommanderId === member.id || army.allegiance?.characterId === member.id)
    || (world.fleets ?? []).some((fleet) => fleet.deputyCommanderId === member.id)
    || (world.offices ?? []).some((office) => office.active && office.holderId === member.id && office.kind !== '廷臣')
    || hasExplicitBacking(world, member.id, leaderId);
}

function coreFor(world: WorldState, memberIds: readonly string[], leaderId: string): string[] {
  const ordered = orderedMembers(world, memberIds)
    .filter((character) => isPowerBearer(world, character, leaderId))
    .map((character) => character.id);
  return [leaderId, ...ordered.filter((id) => id !== leaderId)].slice(0, MAX_CORE_MEMBERS);
}

function relationshipBetween(world: WorldState, leftId: string, rightId: string): { trust: number; grievance: number } {
  const relations = world.relationships.filter((item) => (
    (item.sourceId === leftId && item.targetId === rightId)
    || (item.sourceId === rightId && item.targetId === leftId)
  ));
  if (!relations.length) return { trust: 50, grievance: 0 };
  return {
    trust: relations.reduce((sum, item) => sum + item.trust, 0) / relations.length,
    grievance: Math.max(...relations.map((item) => item.grievance)),
  };
}

function factionSnapshot(faction: FactionState) {
  return {
    factionId: faction.id,
    name: faction.name,
    leaderId: faction.leaderId,
    coreMemberIds: [...faction.coreMemberIds],
    memberCount: faction.memberIds.length,
    agenda: faction.agenda,
    active: faction.active,
  };
}

function rememberLifecycle(faction: FactionState, record: FactionLifecycleRecord): void {
  faction.lifecycle.push({ ...record, relatedFactionIds: [...record.relatedFactionIds].sort(stableCompare) });
  if (faction.lifecycle.length > MAX_LIFECYCLE_RECORDS) {
    faction.lifecycle.splice(0, faction.lifecycle.length - MAX_LIFECYCLE_RECORDS);
  }
}

function rememberPoliticalBiography(
  world: WorldState,
  event: HistoryEvent,
  factId: string,
  actorIds: readonly string[],
  kind: string,
): void {
  for (const actorId of [...new Set(actorIds)].sort(stableCompare)) {
    const character = world.characters.find((item) => item.id === actorId);
    if (!character || character.biography.some((item) => item.factId === factId && item.kind === kind)) continue;
    character.biography.push({
      id: `${character.id}:bio:${factId}:${kind}`,
      turn: event.turn,
      kind,
      summary: event.summary,
      importance: event.importance,
      eventId: null,
      factId,
    });
    if (character.biography.length > MAX_BIOGRAPHY_RECORDS) {
      character.biography.splice(0, character.biography.length - MAX_BIOGRAPHY_RECORDS);
    }
    character.biographyDigest = stableHash(character.biography);
  }
}

function chineseOrdinal(value: number): string {
  return ['', '二', '三', '四', '五', '六', '七', '八', '九'][value - 1] ?? String(value);
}

function factionName(world: WorldState, polityId: string, leader: CharacterState): string {
  const army = (world.armies ?? []).find((item) => item.commanderId === leader.id || item.allegiance?.characterId === leader.id);
  const governed = leader.governedRegionId
    ? world.regions.find((item) => item.id === leader.governedRegionId)
    : null;
  const office = (world.offices ?? []).find((item) => item.active && item.holderId === leader.id);
  const family = (world.families ?? []).find((item) => item.id === leader.familyId);
  const armyRoot = army
    ? army.name.replace(/中军$|行营$|新军$/, '')
    : '';
  const base = army
    ? `${armyRoot}${army.name.endsWith('行营') ? '边军' : '系'}`
    : governed
      ? `${governed.name}系`
      : office?.kind === '枢密使'
        ? '枢府一系'
        : office && ['宰辅', '廷臣'].includes(office.kind)
          ? '台阁一系'
          : family
            ? `${family.familyName}氏`
            : `${leader.name}旧部`;
  const duplicates = world.factions.filter((item) => item.polityId === polityId && item.name.startsWith(base)).length;
  return duplicates === 0 ? base : `${base}${chineseOrdinal(duplicates + 1)}`;
}

function createFactionState(
  world: WorldState,
  polityId: string,
  members: readonly CharacterState[],
  origin: FactionState['origin'],
  agenda: FactionState['agenda'],
  predecessorFactionIds: readonly string[] = [],
  preferredLeaderId: string | null = null,
): FactionState {
  const ordered = [...members].sort((left, right) => scoreLeader(right) - scoreLeader(left) || stableCompare(left.id, right.id));
  const leader = ordered.find((item) => item.id === preferredLeaderId) ?? ordered[0];
  if (!leader) throw new Error(`Cannot form an empty faction for ${polityId}`);
  world.counters.faction += 1;
  const kind = factionKindFor(leader);
  const id = `fac_${String(world.counters.faction).padStart(4, '0')}`;
  const memberIds = ordered.map((item) => item.id).sort(stableCompare);
  const faction: FactionState = {
    id,
    polityId,
    name: factionName(world, polityId, leader),
    kind,
    leaderId: leader.id,
    memberIds,
    power: 0,
    cohesion: Math.round(clamp(48 + ordered.reduce((sum, item) => sum + item.loyalty, 0) / Math.max(1, ordered.length) * 0.2)),
    agenda,
    alliedFactionIds: [],
    rivalFactionIds: [],
    relationSinceTurns: {},
    lastActionTurn: -100,
    active: true,
    endedTurn: null,
    origin,
    formedTurn: origin === 'legacy' ? null : world.turn,
    coreMemberIds: coreFor(world, memberIds, leader.id),
    predecessorFactionIds: [...predecessorFactionIds].sort(stableCompare),
    successorFactionIds: [],
    leaderSinceTurn: world.turn,
    lastLifecycleTurn: world.turn,
    originFactId: null,
    endedReason: null,
    endedFactId: null,
    lifecycle: [],
  };
  world.factions.push(faction);
  for (const member of ordered) member.factionId = id;
  return faction;
}

function emitLifecycle(
  world: WorldState,
  context: FactTurnBuffer,
  transition: 'formed' | 'leader_changed' | 'split' | 'merged' | 'ended',
  reasonCode: string,
  polityId: string,
  affected: readonly FactionState[],
  created: readonly FactionState[],
  ended: readonly FactionState[],
  before: ReturnType<typeof factionSnapshot>[],
  previousLeaderId: string | null,
  nextLeaderId: string | null,
  stateDeltas: StateDelta[],
  emit?: EmitFactionChronicle,
  sourceFactIds: readonly string[] = [],
) {
  const all = [...new Map([...affected, ...created, ...ended].map((faction) => [faction.id, faction])).values()];
  const actorIds = [...new Set([
    ...all.flatMap((faction) => [faction.leaderId, ...faction.coreMemberIds]),
    ...(previousLeaderId ? [previousLeaderId] : []),
    ...(nextLeaderId ? [nextLeaderId] : []),
  ])].sort(stableCompare);
  const memberCountBefore = before.reduce((sum, item) => sum + item.memberCount, 0);
  const memberCountAfter = new Set(
    all.filter((faction) => faction.active).flatMap((faction) => faction.memberIds),
  ).size;
  const causes: EventCause[] = [
    { label: '派系身份', role: '结构', weight: 0.32, evidence: all.map((item) => `${item.name}（${item.agenda}）`).join('、') },
    { label: '政治变化', role: '触发', weight: 0.34, evidence: politicalReasonText(reasonCode) },
    { label: '成员归属', role: '结果', weight: 0.34, evidence: `${memberCountBefore}人此前归属，变化后有${memberCountAfter}人仍归入活动议席` },
  ];
  const fact = emitSimulationFact(world, context, {
    kind: 'faction_lifecycle',
    category: '政治',
    importance: transition === 'leader_changed' ? 2 : transition === 'formed' ? 3 : 4,
    actorIds,
    polityIds: [polityId],
    regionIds: world.polities.find((item) => item.id === polityId)?.capitalRegionId
      ? [world.polities.find((item) => item.id === polityId)!.capitalRegionId as string]
      : [],
    causes,
    stateDeltas,
    sourceFactIds: [...sourceFactIds],
    payload: {
      transition,
      reasonCode,
      polityId,
      affectedFactionIds: affected.map((item) => item.id).sort(stableCompare),
      createdFactionIds: created.map((item) => item.id).sort(stableCompare),
      endedFactionIds: ended.map((item) => item.id).sort(stableCompare),
      previousLeaderId,
      nextLeaderId,
      before,
      after: all.map(factionSnapshot).sort((left, right) => stableCompare(left.factionId, right.factionId)),
    },
  });
  for (const faction of all) {
    faction.lastLifecycleTurn = context.turn;
    rememberLifecycle(faction, { turn: context.turn, transition, reasonCode, factId: fact.id, relatedFactionIds: all.filter((item) => item.id !== faction.id).map((item) => item.id) });
  }
  for (const faction of created) faction.originFactId = fact.id;
  for (const faction of ended) faction.endedFactId = fact.id;
  if (emit) {
    const names = all.map((item) => item.name).join('、');
    const title = transition === 'formed'
      ? `${created[0]?.name ?? names}结成`
      : transition === 'leader_changed'
        ? `${affected[0]?.name ?? names}更换领袖`
        : transition === 'split'
          ? `${affected[0]?.name ?? names}发生分裂`
          : transition === 'merged'
            ? `${names}合为新议`
            : `${ended[0]?.name ?? names}退出朝局`;
    const summary = transition === 'formed'
      ? `${created[0]?.name ?? names}由${created[0]?.memberIds.length ?? 0}名人物围绕“${created[0]?.agenda ?? '共同议程'}”结成。`
      : transition === 'leader_changed'
        ? `${world.characters.find((item) => item.id === previousLeaderId)?.name ?? '旧领袖'}离开领袖位置，${world.characters.find((item) => item.id === nextLeaderId)?.name ?? '继任者'}凭核心成员支持接掌${affected[0]?.name ?? names}。`
        : transition === 'split'
          ? `${affected[0]?.name ?? names}未能继续容纳内部歧见，${created[0]?.name ?? '新派'}由原成员另立议席。`
          : transition === 'merged'
            ? `${ended.map((item) => item.name).join('与')}结束旧名，共同组成${created[0]?.name ?? '新议席'}。`
            : reasonCode === 'polity_destroyed'
              ? `${ended[0]?.name ?? names}因所属政权覆亡而退出朝局。`
              : reasonCode === 'polity_dissolved'
                ? `${ended[0]?.name ?? names}因所属政权解体而退出朝局。`
                : `${ended[0]?.name ?? names}已没有能够继续维系议席的核心人物。`;
    const event = emit({
      category: '政治', kind: `faction_${transition}`, title, summary,
      importance: fact.importance, actorIds, polityIds: [polityId], regionIds: [...fact.regionIds],
      causes, stateDeltas, sourceFactIds: [fact.id], evidence: [], situationIds: [],
    });
    const biographyKind = transition === 'formed'
      ? '参与立派'
      : transition === 'leader_changed'
        ? '经历派系领袖更替'
        : transition === 'split'
          ? '经历派系分裂'
          : transition === 'merged'
            ? '参与派系合并'
            : '派系退出朝局';
    rememberPoliticalBiography(world, event, fact.id, actorIds, biographyKind);
  }
  return fact;
}

interface OpeningFactionGroup {
  leader: CharacterState;
  members: CharacterState[];
}

function sharedArmy(world: WorldState, leftId: string, rightId: string): boolean {
  return world.armies.some((army) => {
    const attached = new Set([
      army.commanderId,
      army.deputyCommanderId,
      army.allegiance?.characterId,
      ...(army.retinues ?? []).map((retinue) => retinue.ownerId),
    ].filter((id): id is string => Boolean(id)));
    return attached.has(leftId) && attached.has(rightId);
  });
}

function groupAffinity(world: WorldState, member: CharacterState, leader: CharacterState): number {
  if (member.id === leader.id) return 1_000;
  let score = 0;
  if (sharedArmy(world, member.id, leader.id)) score += 400;
  if (member.spouseIds.includes(leader.id) || leader.spouseIds.includes(member.id)) score += 90;
  if (member.familyId && member.familyId === leader.familyId) score += 70;
  const relations = (world.relationships ?? []).filter((relation) => (
    (relation.sourceId === member.id && relation.targetId === leader.id)
    || (relation.sourceId === leader.id && relation.targetId === member.id)
  ));
  for (const relation of relations) {
    if (relation.kinship !== '无') score += 45;
    if (relation.trust >= 62) score += (relation.trust - 55) * 0.6;
    score += relation.gratitude * 0.45;
    score -= relation.grievance * 0.55;
    score += relation.memories.filter((memory) => ['提携', '共战', '恩义'].includes(memory.kind)).length * 28;
  }
  for (const fact of world.facts ?? []) {
    if (fact.kind !== 'agency_support_resolved' || fact.payload.outcome !== 'secured') continue;
    if ((fact.payload.actorId === member.id && fact.payload.targetId === leader.id)
      || (fact.payload.actorId === leader.id && fact.payload.targetId === member.id)) score += 52;
  }
  const central = (character: CharacterState) => (world.offices ?? []).some((office) => (
    office.active && office.holderId === character.id && ['君主', '宰辅', '枢密使', '廷臣'].includes(office.kind)
  ));
  if (central(member) && central(leader)) score += 18;
  return score;
}

function anchorScore(world: WorldState, character: CharacterState): number {
  const army = (world.armies ?? []).find((item) => item.commanderId === character.id || item.allegiance?.characterId === character.id);
  const governed = character.governedRegionId ? world.regions.find((item) => item.id === character.governedRegionId) : null;
  const office = (world.offices ?? []).find((item) => item.active && item.holderId === character.id);
  return scoreLeader(character)
    + (character.role === '君主' ? 180 : 0)
    + (army ? 145 + army.soldiers / 180 : 0)
    + (character.commandingFleetId ? 115 : 0)
    + (governed ? 75 + governed.strategicValue * 2 : 0)
    + (office && office.kind !== '廷臣' ? 70 - office.rank * 3 : 0);
}

function openingGroups(world: WorldState, polityId: string): OpeningFactionGroup[] {
  const adults = world.characters.filter((item) => item.alive && item.age >= 16 && item.polityId === polityId);
  const ranked = adults
    .filter((character) => eligibleFounder(world, character))
    .sort((left, right) => anchorScore(world, right) - anchorScore(world, left) || stableCompare(left.id, right.id));
  const anchors: CharacterState[] = [];
  for (const candidate of ranked) {
    if (anchors.some((anchor) => groupAffinity(world, candidate, anchor) >= 100)) continue;
    anchors.push(candidate);
    if (anchors.length >= MAX_ACTIVE_FACTIONS_PER_POLITY) break;
  }
  for (const candidate of ranked) {
    if (anchors.length >= Math.min(2, adults.length)) break;
    if (!anchors.some((anchor) => anchor.id === candidate.id)) anchors.push(candidate);
  }
  const groups = anchors.map((leader) => ({ leader, members: [leader] }));
  const anchorIds = new Set(anchors.map((item) => item.id));
  for (const member of adults.filter((item) => !anchorIds.has(item.id)).sort((left, right) => stableCompare(left.id, right.id))) {
    const best = groups
      .map((group) => ({ group, score: groupAffinity(world, member, group.leader) }))
      .sort((left, right) => right.score - left.score || stableCompare(left.group.leader.id, right.group.leader.id))[0];
    if (best && best.score >= 35) best.group.members.push(member);
  }
  return groups;
}

export function bootstrapFactionModel(
  world: WorldState,
  origin: 'opening' | 'legacy',
  context?: FactTurnBuffer,
): string[] {
  if (origin === 'legacy') {
    if (world.factions.length > 0) {
      migrateFactionIdentityModel(world);
      return [];
    }
    for (const character of world.characters) character.factionId = null;
    for (const polity of [...world.polities].sort((left, right) => stableCompare(left.id, right.id))) {
      for (const group of openingGroups(world, polity.id)) {
        const faction = createFactionState(world, polity.id, group.members, 'legacy', factionAgendaFor(group.leader), [], group.leader.id);
        rememberLifecycle(faction, { turn: world.turn, transition: 'formed', reasonCode: 'legacy_boundary', factId: null, relatedFactionIds: [] });
      }
    }
    return [];
  }
  if (world.factions.length > 0) return [];
  const factIds: string[] = [];
  for (const polity of [...world.polities].sort((left, right) => stableCompare(left.id, right.id))) {
    for (const group of openingGroups(world, polity.id)) {
      const beforeIds = group.members.map((item) => item.factionId);
      const faction = createFactionState(world, polity.id, group.members, 'opening', factionAgendaFor(group.leader), [], group.leader.id);
      if (!context) {
        rememberLifecycle(faction, { turn: world.turn, transition: 'formed', reasonCode: 'opening_order', factId: null, relatedFactionIds: [] });
        continue;
      }
      const fact = emitLifecycle(
        world, context, 'formed', 'opening_order', polity.id, [faction], [faction], [], [], null, faction.leaderId,
        group.members.map((member, index) => ({ entityType: 'character', entityId: member.id, field: 'factionId', before: beforeIds[index] ?? null, after: faction.id })),
      );
      factIds.push(fact.id);
    }
  }
  return factIds;
}

export function migrateFactionIdentityModel(world: WorldState, forceLegacyBoundary = false): boolean {
  let changed = false;
  for (const character of world.characters) {
    if (!Object.prototype.hasOwnProperty.call(character, 'factionId')) {
      character.factionId = null;
      changed = true;
    }
  }
  const claimed = new Set<string>();
  for (const faction of [...world.factions].sort((left, right) => stableCompare(left.id, right.id))) {
    const legacy = faction as FactionState;
    const polity = world.polities.find((item) => item.id === legacy.polityId);
    const legalMembers = legacy.active
      ? legacy.memberIds
        .map((id) => world.characters.find((character) => character.id === id))
        .filter((character): character is CharacterState => Boolean(character?.alive && character.age >= 16 && character.polityId === legacy.polityId && !claimed.has(character.id)))
      : [];
    const polityAlive = polity?.alive === true;
    if (legacy.active && polityAlive) {
      const leader = world.characters.find((character) => character.id === legacy.leaderId && character.alive && character.age >= 16 && character.polityId === legacy.polityId);
      if (leader && !claimed.has(leader.id) && !legalMembers.some((item) => item.id === leader.id)) legalMembers.unshift(leader);
    }
    if (legacy.active && polityAlive && legalMembers.length > 0) {
      for (const member of legalMembers) {
        member.factionId = legacy.id;
        claimed.add(member.id);
      }
      legacy.memberIds = legalMembers.map((item) => item.id).sort(stableCompare);
      if (!legacy.memberIds.includes(legacy.leaderId)) legacy.leaderId = orderedMembers(world, legacy.memberIds)[0]?.id ?? legacy.leaderId;
    } else if (legacy.active) {
      legacy.active = false;
      legacy.endedTurn ??= world.turn;
      legacy.memberIds = [];
      changed = true;
    }
    if (forceLegacyBoundary || !Object.prototype.hasOwnProperty.call(legacy, 'origin')) {
      if (!legacy.name) {
        const leader = legalMembers.find((item) => item.id === legacy.leaderId) ?? legalMembers[0];
        if (leader) legacy.name = factionName(world, legacy.polityId, leader);
      }
      legacy.origin = 'legacy';
      legacy.formedTurn = null;
      legacy.coreMemberIds = legacy.active ? coreFor(world, legacy.memberIds, legacy.leaderId) : [];
      legacy.predecessorFactionIds = [];
      legacy.successorFactionIds = [];
      legacy.leaderSinceTurn = world.turn;
      legacy.lastLifecycleTurn = world.turn;
      legacy.originFactId = null;
      legacy.endedReason = legacy.active ? null : 'legacy';
      legacy.endedFactId = null;
      legacy.rivalFactionIds = [];
      // Pre-POL02 saves did not record when an alliance began. Keep the
      // relation itself, but do not turn the migration boundary into a false
      // historical date.
      legacy.relationSinceTurns = {};
      legacy.lifecycle = [{ turn: world.turn, transition: legacy.active ? 'formed' : 'ended', reasonCode: 'legacy_boundary', factId: null, relatedFactionIds: [] }];
      changed = true;
    } else {
      legacy.rivalFactionIds ??= [];
      legacy.relationSinceTurns ??= {};
      legacy.lifecycle ??= [];
    }
  }
  const activeFactionIds = new Set(world.factions.filter((item) => item.active).map((item) => item.id));
  for (const faction of world.factions) {
    const relationSnapshot = JSON.stringify([
      faction.alliedFactionIds,
      faction.rivalFactionIds,
      faction.relationSinceTurns,
      faction.endedTurn,
    ]);
    if (!faction.active) {
      faction.alliedFactionIds = [];
      faction.rivalFactionIds = [];
      faction.relationSinceTurns = {};
      faction.endedTurn ??= world.turn;
    } else {
      faction.alliedFactionIds = faction.alliedFactionIds.filter((id) => activeFactionIds.has(id));
      faction.rivalFactionIds = faction.rivalFactionIds.filter((id) => activeFactionIds.has(id));
      const relatedIds = new Set([...faction.alliedFactionIds, ...faction.rivalFactionIds]);
      faction.relationSinceTurns = Object.fromEntries(
        Object.entries(faction.relationSinceTurns).filter(([id]) => relatedIds.has(id)),
      );
    }
    if (relationSnapshot !== JSON.stringify([
      faction.alliedFactionIds,
      faction.rivalFactionIds,
      faction.relationSinceTurns,
      faction.endedTurn,
    ])) changed = true;
  }
  return changed;
}

function clearFactionRelations(
  world: WorldState,
  context: FactTurnBuffer,
  faction: FactionState,
  reasonCode: string,
  emit?: EmitFactionChronicle,
  sourceFactIds: readonly string[] = [],
): string[] {
  const endedFactIds: string[] = [];
  const relations = [
    ...faction.alliedFactionIds.map((id) => ({ id, relation: 'alliance' as const })),
    ...faction.rivalFactionIds.map((id) => ({ id, relation: 'rivalry' as const })),
  ].sort((left, right) => stableCompare(left.id, right.id) || stableCompare(left.relation, right.relation));
  for (const item of relations) {
    const fact = changeFactionRelation(
      world,
      context,
      faction.id,
      item.id,
      item.relation,
      'ended',
      reasonCode,
      emit,
      sourceFactIds,
    );
    if (fact) endedFactIds.push(fact.id);
  }
  return endedFactIds;
}

function endFaction(
  world: WorldState,
  context: FactTurnBuffer,
  faction: FactionState,
  reason: Exclude<FactionEndReason, null>,
  emit?: EmitFactionChronicle,
  sourceFactIds: readonly string[] = [],
): void {
  if (!faction.active) return;
  const before = factionSnapshot(faction);
  const deltas: StateDelta[] = [];
  for (const character of world.characters.filter((item) => item.factionId === faction.id)) {
    character.factionId = null;
    deltas.push({ entityType: 'character', entityId: character.id, field: 'factionId', before: faction.id, after: null });
  }
  const relationFactIds = clearFactionRelations(world, context, faction, `faction_${reason}`, emit, sourceFactIds);
  faction.active = false;
  faction.endedTurn = context.turn;
  faction.endedReason = reason;
  deltas.push({ entityType: 'faction', entityId: faction.id, field: 'active', before: true, after: false });
  emitLifecycle(
    world,
    context,
    'ended',
    reason,
    faction.polityId,
    [faction],
    [],
    [faction],
    [before],
    faction.leaderId,
    null,
    deltas,
    emit,
    [...sourceFactIds, ...relationFactIds],
  );
}

function syncMemberships(world: WorldState): void {
  const activeById = new Map(world.factions.filter((item) => item.active).map((item) => [item.id, item]));
  for (const character of world.characters) {
    if (!character.factionId) continue;
    const faction = activeById.get(character.factionId);
    if (!faction || !character.alive || character.age < 16 || character.polityId !== faction.polityId) character.factionId = null;
  }
  for (const faction of activeById.values()) {
    faction.memberIds = world.characters
      .filter((character) => character.factionId === faction.id)
      .map((character) => character.id)
      .sort(stableCompare);
  }
}

function updateCohesion(world: WorldState, faction: FactionState): void {
  const members = orderedMembers(world, faction.memberIds);
  if (!members.length) return;
  const leader = world.characters.find((item) => item.id === faction.leaderId);
  const alignment = members.filter((item) => factionAgendaFor(item) === faction.agenda).length / members.length;
  const trust = leader
    ? members.filter((item) => item.id !== leader.id).map((item) => relationshipBetween(world, item.id, leader.id)).reduce((sum, item) => sum + item.trust - item.grievance * 0.7, 0) / Math.max(1, members.length - 1)
    : 20;
  const ambitionPressure = members.filter((item) => item.id !== faction.leaderId).reduce((sum, item) => sum + Math.max(0, item.ambition - item.loyalty), 0) / Math.max(1, members.length - 1);
  const target = 28 + alignment * 30 + trust * 0.35 - ambitionPressure * 0.3;
  faction.cohesion = Math.round(clamp(faction.cohesion * 0.78 + target * 0.22));
}

function repairLeadership(
  world: WorldState,
  context: FactTurnBuffer,
  faction: FactionState,
  emit?: EmitFactionChronicle,
  departureSourceFactIds: readonly string[] = [],
): boolean {
  const coreUnavailabilitySourceFactIds = [...new Set([
    ...currentDeathFactIds(context, [faction.leaderId, ...faction.coreMemberIds]),
    ...departureSourceFactIds,
  ])].sort(stableCompare);
  const members = orderedMembers(world, faction.memberIds);
  if (!members.length) {
    endFaction(
      world,
      context,
      faction,
      'core_exhausted',
      emit,
      coreUnavailabilitySourceFactIds,
    );
    return true;
  }
  const leaderValid = members.some((item) => item.id === faction.leaderId);
  if (leaderValid) {
    faction.coreMemberIds = coreFor(world, faction.memberIds, faction.leaderId);
    return false;
  }
  const survivingCore = members.filter((item) => faction.coreMemberIds.includes(item.id));
  if (!survivingCore.length) {
    endFaction(
      world,
      context,
      faction,
      'core_exhausted',
      emit,
      coreUnavailabilitySourceFactIds,
    );
    return true;
  }
  const before = factionSnapshot(faction);
  const previousLeaderId = faction.leaderId;
  const next = survivingCore.sort((left, right) => scoreLeader(right) - scoreLeader(left) || stableCompare(left.id, right.id))[0] as CharacterState;
  const leaderSourceFactIds = [...new Set([
    ...currentDeathFactIds(context, [previousLeaderId]),
    ...departureSourceFactIds,
  ])].sort(stableCompare);
  faction.leaderId = next.id;
  faction.leaderSinceTurn = context.turn;
  faction.coreMemberIds = coreFor(world, faction.memberIds, next.id);
  emitLifecycle(world, context, 'leader_changed', departureSourceFactIds.length > 0 ? 'leader_departed' : 'leader_unavailable', faction.polityId, [faction], [], [], [before], previousLeaderId, next.id, [
    { entityType: 'faction', entityId: faction.id, field: 'leaderId', before: previousLeaderId, after: next.id },
  ], emit, leaderSourceFactIds);
  return true;
}

function eligibleFounder(world: WorldState, character: CharacterState): boolean {
  return character.role === '君主'
    || character.governedRegionId !== null
    || character.commandingArmyId !== null
    || character.commandingFleetId !== null
    || character.influence >= 35
    || world.offices.some((office) => office.active && office.holderId === character.id);
}

function formUnaffiliatedFaction(
  world: WorldState,
  context: FactTurnBuffer,
  polityId: string,
  emit?: EmitFactionChronicle,
): boolean {
  const activeCount = world.factions.filter((item) => item.active && item.polityId === polityId).length;
  if (activeCount >= MAX_ACTIVE_FACTIONS_PER_POLITY) return false;
  const candidates = world.characters
    .filter((item) => item.alive && item.age >= 16 && item.polityId === polityId && !item.factionId && eligibleFounder(world, item))
    .sort((left, right) => anchorScore(world, right) - anchorScore(world, left) || stableCompare(left.id, right.id));
  const leader = candidates[0];
  if (!leader) return false;
  const members = candidates.filter((candidate) => candidate.id === leader.id || groupAffinity(world, candidate, leader) >= 35);
  if (members.length < 2 && activeCount >= 2) return false;
  const previous = members.map((item) => item.factionId);
  const faction = createFactionState(world, polityId, members, 'formed', factionAgendaFor(leader), [], leader.id);
  emitLifecycle(world, context, 'formed', 'shared_root', polityId, [faction], [faction], [], [], null, faction.leaderId,
    members.map((member, index) => ({ entityType: 'character', entityId: member.id, field: 'factionId', before: previous[index] ?? null, after: faction.id })), emit);
  return true;
}

function splitFaction(
  world: WorldState,
  context: FactTurnBuffer,
  faction: FactionState,
  emit?: EmitFactionChronicle,
): boolean {
  if (world.factions.filter((item) => item.active && item.polityId === faction.polityId).length >= MAX_ACTIVE_FACTIONS_PER_POLITY) return false;
  if (context.turn - faction.lastLifecycleTurn < 16 || faction.memberIds.length < 4 || faction.cohesion > 35) return false;
  const members = orderedMembers(world, faction.memberIds);
  const challengers = members.filter((item) => item.id !== faction.leaderId && item.ambition >= 65).sort((left, right) => {
    const leftRelation = relationshipBetween(world, left.id, faction.leaderId);
    const rightRelation = relationshipBetween(world, right.id, faction.leaderId);
    const leftScore = left.ambition + left.insubordination + leftRelation.grievance * 1.4 - left.loyalty * 0.35;
    const rightScore = right.ambition + right.insubordination + rightRelation.grievance * 1.4 - right.loyalty * 0.35;
    return rightScore - leftScore || stableCompare(left.id, right.id);
  });
  const challenger = challengers.find((item) => {
    const relation = relationshipBetween(world, item.id, faction.leaderId);
    return relation.grievance >= 30 || item.insubordination >= 50 || item.ambition - item.loyalty >= 25;
  });
  if (!challenger) return false;
  const desired = Math.max(2, Math.ceil(members.length / 3));
  const supporters = members
    .filter((item) => item.id !== faction.leaderId && item.id !== challenger.id)
    .sort((left, right) => {
      const leftRelation = relationshipBetween(world, left.id, challenger.id);
      const rightRelation = relationshipBetween(world, right.id, challenger.id);
      const leftScore = leftRelation.trust - leftRelation.grievance + (left.familyId === challenger.familyId ? 25 : 0) + left.ambition * 0.2;
      const rightScore = rightRelation.trust - rightRelation.grievance + (right.familyId === challenger.familyId ? 25 : 0) + right.ambition * 0.2;
      return rightScore - leftScore || stableCompare(left.id, right.id);
    });
  const leaving = [challenger, ...supporters.slice(0, desired - 1)];
  if (members.length - leaving.length < 2) return false;
  const before = factionSnapshot(faction);
  const leavingIds = new Set(leaving.map((item) => item.id));
  for (const member of leaving) member.factionId = null;
  faction.memberIds = faction.memberIds.filter((id) => !leavingIds.has(id));
  faction.coreMemberIds = coreFor(world, faction.memberIds, faction.leaderId);
  faction.lastLifecycleTurn = context.turn;
  const branch = createFactionState(world, faction.polityId, leaving, 'split', factionAgendaFor(challenger), [faction.id]);
  faction.successorFactionIds = [...new Set([...faction.successorFactionIds, branch.id])].sort(stableCompare);
  const fact = emitLifecycle(world, context, 'split', 'internal_break', faction.polityId, [faction, branch], [branch], [], [before], faction.leaderId, branch.leaderId,
    leaving.map((member) => ({ entityType: 'character', entityId: member.id, field: 'factionId', before: faction.id, after: branch.id })), emit);
  branch.originFactId = fact.id;
  changeFactionRelation(world, context, faction.id, branch.id, 'rivalry', 'formed', 'split_grievance', emit, [fact.id]);
  return true;
}

function mergeFactions(
  world: WorldState,
  context: FactTurnBuffer,
  left: FactionState,
  right: FactionState,
  emit?: EmitFactionChronicle,
): boolean {
  if (!left.alliedFactionIds.includes(right.id) || left.agenda !== right.agenda) return false;
  if (left.cohesion < 60 || right.cohesion < 60 || context.turn - left.lastLifecycleTurn < 16 || context.turn - right.lastLifecycleTurn < 16) return false;
  if (left.memberIds.length + right.memberIds.length > 8) return false;
  const relation = relationshipBetween(world, left.leaderId, right.leaderId);
  if (relation.trust < 65 || relation.grievance > 15) return false;
  const before = [factionSnapshot(left), factionSnapshot(right)];
  const members = orderedMembers(world, [...left.memberIds, ...right.memberIds]);
  for (const member of members) member.factionId = null;
  const relationFactIds = [
    ...clearFactionRelations(world, context, left, 'faction_merge', emit),
    ...clearFactionRelations(world, context, right, 'faction_merge', emit),
  ];
  left.active = false;
  right.active = false;
  left.endedTurn = context.turn;
  right.endedTurn = context.turn;
  left.endedReason = 'merged';
  right.endedReason = 'merged';
  const merged = createFactionState(world, left.polityId, members, 'merged', left.agenda, [left.id, right.id]);
  left.successorFactionIds = [...new Set([...left.successorFactionIds, merged.id])].sort(stableCompare);
  right.successorFactionIds = [...new Set([...right.successorFactionIds, merged.id])].sort(stableCompare);
  const deltas: StateDelta[] = [
    { entityType: 'faction', entityId: left.id, field: 'active', before: true, after: false },
    { entityType: 'faction', entityId: right.id, field: 'active', before: true, after: false },
    ...members.map((member) => ({ entityType: 'character' as const, entityId: member.id, field: 'factionId', before: left.memberIds.includes(member.id) ? left.id : right.id, after: merged.id })),
  ];
  const fact = emitLifecycle(world, context, 'merged', 'allied_union', left.polityId, [left, right, merged], [merged], [left, right], before, null, merged.leaderId, deltas, emit, relationFactIds);
  left.endedFactId = fact.id;
  right.endedFactId = fact.id;
  merged.originFactId = fact.id;
  return true;
}

/**
 * A political-alliance commitment describes the life of one concrete faction
 * relation, not a free-standing promise between two characters. Settle it in
 * the same chronicle turn as that relation ends so it can never later mature
 * into either fulfillment or breach.
 */
export function invalidatePoliticalAllianceCommitment(
  world: WorldState,
  commitment: CommitmentState,
  endingFact: FactionRelationChangedFact,
  emit: EmitFactionChronicle,
): boolean {
  if (commitment.kind !== '政治联盟' || commitment.status !== '生效') return false;
  const formationFact = politicalAllianceFormationFact(world, commitment);
  if (!formationFact || !factionAllianceEndMatchesFormation(endingFact, formationFact)) return false;
  const left = world.factions.find((faction) => faction.id === formationFact.payload.leftFactionId);
  const right = world.factions.find((faction) => faction.id === formationFact.payload.rightFactionId);
  const promisor = world.characters.find((character) => character.id === commitment.promisorId);
  const promisee = world.characters.find((character) => character.id === commitment.promiseeId);
  const factionNames = `${left?.name ?? '原联盟一方'}与${right?.name ?? '原联盟另一方'}`;
  const promisorName = promisor?.name ?? '原承诺人';
  const promiseeName = promisee?.name ?? '原受诺人';
  const event = emit({
    category: '政治',
    kind: 'commitment_ended',
    title: `${factionNames}的政治联盟承诺失效`,
    summary: `${factionNames}的政治联盟已经终止，${promisorName}与${promiseeName}所作“${commitment.terms}”随联盟载体一并失效，不记为履约或背约。`,
    importance: 2,
    actorIds: [commitment.promisorId, commitment.promiseeId],
    polityIds: commitment.polityIds,
    regionIds: [...endingFact.regionIds],
    causes: [
      { label: '既有联盟承诺', role: '结构', weight: 0.3, evidence: `${factionNames}自第${commitment.madeTurn}回合承担该项承诺` },
      { label: '派系联盟终止', role: '触发', weight: 0.45, evidence: `${factionNames}因${politicalReasonText(endingFact.payload.reasonCode)}解除盟约` },
      { label: '承诺失效', role: '结果', weight: 0.25, evidence: `${commitment.id}状态生效→失效，未判定为履约或背约` },
    ],
    stateDeltas: [{ entityType: 'commitment', entityId: commitment.id, field: 'status', before: '生效', after: '失效' }],
    sourceFactIds: [endingFact.id],
  });
  commitment.status = '失效';
  commitment.resolvedTurn = event.turn;
  commitment.resolutionEventId = event.id;
  return true;
}

function invalidatePoliticalAllianceCommitmentsForRelation(
  world: WorldState,
  endingFact: FactionRelationChangedFact,
  emit?: EmitFactionChronicle,
): void {
  if (!emit) return;
  for (const commitment of world.commitments
    .filter((item) => item.kind === '政治联盟' && item.status === '生效')
    .sort((left, right) => stableCompare(left.id, right.id))) {
    invalidatePoliticalAllianceCommitment(world, commitment, endingFact, emit);
  }
}

export function changeFactionRelation(
  world: WorldState,
  context: FactTurnBuffer,
  leftId: string,
  rightId: string,
  relation: 'alliance' | 'rivalry',
  action: 'formed' | 'ended',
  reasonCode: string,
  emit?: EmitFactionChronicle,
  sourceFactIds: readonly string[] = [],
) {
  const left = world.factions.find((item) => item.id === leftId && item.active);
  const right = world.factions.find((item) => item.id === rightId && item.active);
  if (!left || !right || left.id === right.id || left.polityId !== right.polityId) return null;
  const ownKey = relation === 'alliance' ? 'alliedFactionIds' : 'rivalFactionIds';
  const oppositeKey = relation === 'alliance' ? 'rivalFactionIds' : 'alliedFactionIds';
  const effectiveSourceFactIds = [...sourceFactIds];
  if (action === 'formed' && left[oppositeKey].includes(right.id) && right[oppositeKey].includes(left.id)) {
    const endedOpposite = changeFactionRelation(
      world,
      context,
      left.id,
      right.id,
      relation === 'alliance' ? 'rivalry' : 'alliance',
      'ended',
      `${reasonCode}_superseded`,
      emit,
      sourceFactIds,
    );
    if (endedOpposite) effectiveSourceFactIds.push(endedOpposite.id);
  }
  const present = left[ownKey].includes(right.id) && right[ownKey].includes(left.id);
  if ((action === 'formed' && present) || (action === 'ended' && !present)) return null;
  if (action === 'formed') {
    left[ownKey] = [...new Set([...left[ownKey], right.id])].sort(stableCompare);
    right[ownKey] = [...new Set([...right[ownKey], left.id])].sort(stableCompare);
    left[oppositeKey] = left[oppositeKey].filter((id) => id !== right.id);
    right[oppositeKey] = right[oppositeKey].filter((id) => id !== left.id);
    left.relationSinceTurns[right.id] = context.turn;
    right.relationSinceTurns[left.id] = context.turn;
  } else {
    left[ownKey] = left[ownKey].filter((id) => id !== right.id);
    right[ownKey] = right[ownKey].filter((id) => id !== left.id);
    delete left.relationSinceTurns[right.id];
    delete right.relationSinceTurns[left.id];
  }
  const causes: EventCause[] = [
    { label: '双方位置', role: '结构', weight: 0.34, evidence: `${left.name}权势${left.power}，${right.name}权势${right.power}` },
    { label: relation === 'alliance' ? '共同议程' : '公开裂痕', role: '选择', weight: 0.33, evidence: politicalReasonText(reasonCode) },
    { label: action === 'formed' ? '关系成立' : '关系终止', role: '结果', weight: 0.33, evidence: action === 'formed'
      ? `${left.name}与${right.name}已在双方关系账中登记`
      : `${left.name}与${right.name}已从双方关系账中解除` },
  ];
  const field = `${relation}:${right.id}`;
  const fact = emitSimulationFact(world, context, {
    kind: 'faction_relation_changed', category: '政治', importance: 3,
    actorIds: [left.leaderId, right.leaderId], polityIds: [left.polityId],
    regionIds: world.polities.find((item) => item.id === left.polityId)?.capitalRegionId ? [world.polities.find((item) => item.id === left.polityId)!.capitalRegionId as string] : [],
    causes,
    stateDeltas: [
      { entityType: 'faction', entityId: left.id, field, before: action === 'formed' ? false : true, after: action === 'formed' },
      { entityType: 'faction', entityId: right.id, field: `${relation}:${left.id}`, before: action === 'formed' ? false : true, after: action === 'formed' },
    ],
    sourceFactIds: effectiveSourceFactIds,
    payload: { polityId: left.polityId, leftFactionId: left.id, rightFactionId: right.id, relation, action, reasonCode, leftLeaderId: left.leaderId, rightLeaderId: right.leaderId },
  });
  if (emit) {
    const event = emit({
      category: '政治', kind: `faction_${relation}_${action}`,
      title: `${left.name}与${right.name}${action === 'formed'
        ? (relation === 'alliance' ? '结成盟约' : '公开相争')
        : (relation === 'alliance' ? '解除盟约' : '停止相争')}`,
      summary: action === 'formed'
        ? `${left.name}与${right.name}${relation === 'alliance' ? '交换朝中支持，结成同盟' : '因公开裂痕彼此牵制'}。`
        : `${left.name}与${right.name}${relation === 'alliance' ? '解除此前的盟约' : '停止此前的公开相争'}。`,
      importance: 3, actorIds: [left.leaderId, right.leaderId], polityIds: [left.polityId], regionIds: [...fact.regionIds],
      causes, stateDeltas: fact.stateDeltas, sourceFactIds: [fact.id], evidence: [], situationIds: [],
    });
    rememberPoliticalBiography(
      world,
      event,
      fact.id,
      [left.leaderId, right.leaderId],
      action === 'formed'
        ? (relation === 'alliance' ? '结成政治联盟' : '卷入派系相争')
        : (relation === 'alliance' ? '结束政治联盟' : '结束派系相争'),
    );
  }
  if (relation === 'alliance' && action === 'ended' && fact.kind === 'faction_relation_changed') {
    invalidatePoliticalAllianceCommitmentsForRelation(world, fact, emit);
  }
  return fact;
}

export function expelFactionMembers(world: WorldState, factionId: string, memberIds: readonly string[]): void {
  const expelled = new Set(memberIds);
  for (const character of world.characters) if (character.factionId === factionId && expelled.has(character.id)) character.factionId = null;
  const faction = world.factions.find((item) => item.id === factionId && item.active);
  if (!faction) return;
  faction.memberIds = faction.memberIds.filter((id) => !expelled.has(id));
  faction.coreMemberIds = faction.coreMemberIds.filter((id) => !expelled.has(id));
}

/**
 * Some political departures happen after the regular faction tick (notably a
 * governor founding a rebel polity). Settle those departures in the same
 * quarter so an active faction can never retain a leader who has already left
 * its membership cache. The originating simulation Fact keeps the succession
 * or dissolution causally attached to the departure.
 */
export function settleFactionDepartures(
  world: WorldState,
  context: FactTurnBuffer,
  factionIds: readonly string[],
  sourceFactIds: readonly string[],
  emit?: EmitFactionChronicle,
): void {
  for (const factionId of [...new Set(factionIds)].sort(stableCompare)) {
    const faction = world.factions.find((item) => item.id === factionId && item.active);
    if (!faction || faction.memberIds.includes(faction.leaderId)) continue;
    repairLeadership(world, context, faction, emit, sourceFactIds);
  }
}

export function endPolityFactions(
  world: WorldState,
  context: FactTurnBuffer,
  polityId: string,
  reason: 'polity_destroyed' | 'polity_dissolved',
  sourceFactIds: readonly string[] = [],
  emit?: EmitFactionChronicle,
): void {
  for (const faction of world.factions.filter((item) => item.active && item.polityId === polityId).sort((left, right) => stableCompare(left.id, right.id))) {
    endFaction(world, context, faction, reason, emit, sourceFactIds);
  }
}

export function processFactionLifecycle(
  world: WorldState,
  context: FactTurnBuffer,
  emit?: EmitFactionChronicle,
): void {
  syncMemberships(world);
  for (const polity of world.polities.filter((item) => item.alive).sort((left, right) => stableCompare(left.id, right.id))) {
    const active = world.factions.filter((item) => item.active && item.polityId === polity.id).sort((left, right) => stableCompare(left.id, right.id));
    for (const faction of active) {
      if (!faction.active) continue;
      if (repairLeadership(world, context, faction, emit)) continue;
      updateCohesion(world, faction);
    }
    if (context.season !== '冬') continue;
    const current = world.factions.filter((item) => item.active && item.polityId === polity.id).sort((left, right) => stableCompare(left.id, right.id));
    if (current.some((faction) => splitFaction(world, context, faction, emit))) continue;
    let merged = false;
    for (let left = 0; left < current.length && !merged; left += 1) {
      for (let right = left + 1; right < current.length && !merged; right += 1) {
        merged = mergeFactions(world, context, current[left] as FactionState, current[right] as FactionState, emit);
      }
    }
    if (!merged) formUnaffiliatedFaction(world, context, polity.id, emit);
  }
  syncMemberships(world);
}
