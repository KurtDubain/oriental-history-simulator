import { continuousRulerSeatIds } from '../sim/facts/projector';
import type { SituationState } from '../sim/situations';
import type { SimulationFact } from '../sim/facts/types';
import type { DeltaValue, StateDelta, WorldState } from '../sim/types';
import { readWorldFacts, readWorldHistory } from '../sim/archive';
import { projectCoreImpacts } from './core-impact-projection';
import { historyTurnDate } from './v1-history';
import { isDefaultVisibleHistoryEvent } from './history-visibility';
import { projectWarGroups } from './war-group-projection';
import {
  projectFactNarrative,
  projectSituationHistoricalScenes,
  type HistoricalScene,
} from './historical-scenes';
import {
  projectSituationSnapshotItem,
  situationOutcomeLabel,
  type SituationSnapshotItem,
  type SituationSnapshotParticipantGroup,
} from './situation-snapshot';

export const MAX_SITUATION_DIRECTORY_RESOLVED = 8;
export const MAX_SITUATION_DETAIL_FACTS = 16;
export const MAX_SITUATION_DETAIL_DELTAS = 8;

export interface SituationDirectoryItem {
  id: string;
  type: string;
  typeLabel: string;
  title: string;
  status: SituationSnapshotItem['status'];
  dateLabel: string;
}

export interface SituationDetailDelta {
  factId: string;
  entityType: StateDelta['entityType'];
  entityId: string;
  entityLabel: string;
  field: string;
  fieldLabel: string;
  before: DeltaValue;
  after: DeltaValue;
  beforeLabel: string;
  afterLabel: string;
  delta: number | null;
}

export interface SituationDetailFact {
  id: string;
  kind: SimulationFact['kind'];
  kindLabel: string;
  turn: number;
  dateLabel: string;
  title: string;
  summary: string;
  importance: number;
  stateDeltas: SituationDetailDelta[];
  sourceFactIds: string[];
  historyEventIds: string[];
}

export interface SituationDetailConsequence {
  id: string;
  factId: string;
  entityLabel: string;
  fieldLabel: string;
  beforeLabel: string;
  afterLabel: string;
}

export interface SituationDetailProjection {
  id: string;
  type: string;
  typeLabel: string;
  title: string;
  status: SituationSnapshotItem['status'];
  startDateLabel: string;
  endDateLabel: string;
  durationLabel: string;
  playerSummary: string[];
  currentChange: string;
  coreImpact: null | { summary: string; sourceEventId: string | null };
  recentDeltas: SituationDetailDelta[];
  outcome: null | {
    key: string;
    label: string;
    summary: string;
    resultFactIds: string[];
  };
  participants: SituationSnapshotParticipantGroup[];
  politicalFocus: SituationSnapshotItem['politicalFocus'];
  scenes: HistoricalScene[];
  evidence: SituationDetailFact[];
  consequences: SituationDetailConsequence[];
}

export interface SituationWorkbenchProjection {
  version: 1;
  openCount: number;
  resolvedCount: number;
  archivedResolvedCount: number;
  open: SituationDirectoryItem[];
  recentResolved: SituationDirectoryItem[];
  selectedId: string | null;
  selected: SituationDetailProjection | null;
}

const FACT_KIND_LABELS: Record<SimulationFact['kind'], string> = {
  war_started: '宣战事实',
  war_ended: '停战事实',
  battle: '战役事实',
  army_order_changed: '军令变更',
  territory_control_changed: '领土事实',
  appointment_started: '任命事实',
  appointment_ended: '去职事实',
  character_wounded: '人物负伤',
  character_death: '人物事实',
  marriage: '婚姻事实',
  agency_support_resolved: '支持行动',
  agency_intent_submitted: '军令请求',
  agency_intent_resolved: '军令裁决',
  local_governance_resolved: '地方施政',
  embodied_action_submitted: '人物行动',
  embodied_action_resolved: '行动结果',
  faction_lifecycle: '派系变动',
  faction_relation_changed: '派系关系',
  court_action_resolved: '朝堂行动',
  situation_milestone: '局势里程碑',
};

const FIELD_LABELS: Readonly<Record<string, string>> = {
  active: '存续状态',
  alive: '存续状态',
  authority: '中央权威',
  legitimacy: '合法性',
  rulerId: '君主',
  controllerId: '控制权',
  controlledRegionIds: '统辖州域',
  commandingArmyId: '所掌军团',
  holderId: '任职者',
  soldiers: '兵力',
  morale: '士气',
  supply: '补给',
  attackerScore: '攻方战果',
  defenderScore: '守方战果',
  outcomeKey: '结案结果',
  status: '状态',
  phase: '阶段',
  tension: '局势张力',
  power: '派系实力',
  memberCount: '派系成员',
  coreMemberCount: '核心成员',
  influence: '人物影响',
  loyalty: '人物忠诚',
  governedRegionId: '所掌州域',
  factionId: '派系归属',
  rulingFamilyId: '统治家族',
  dynastyName: '王朝名号',
  rulingFamilyPower: '王室根基',
  dynastyStability: '王朝稳定',
  'order.kind': '军令',
  'order.warId': '所属战事',
  'order.issuerId': '下令者',
  'order.targetRegionId': '军令去向',
  'order.targetArmyId': '追踪军团',
  'order.status': '执行状态',
  'order.reasonCode': '改令缘由',
};

const ORDER_VALUE_LABELS: Readonly<Record<string, string>> = {
  hold: '固守',
  advance: '进军',
  intercept: '截击',
  reinforce: '驰援',
  retreat: '撤退',
  active: '可以执行',
  blocked: '道路受阻',
  peace_garrison: '战事已息，留营守备',
  war_goal: '夺取战争目标',
  enemy_approach: '敌军逼近',
  frontline_support: '接应友军',
  enemy_strength: '暂缓攻坚',
  defend_war_goal: '守卫战守要地',
  amphibious_landing: '改由水师送登陆岸',
  low_readiness: '军粮或军心不足',
  target_invalid: '原定目标失效',
};

function stableCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(stableCompare);
}

function boundChronological<T>(items: readonly T[], max: number): T[] {
  if (items.length <= max) return [...items];
  return [items[0], ...items.slice(-(max - 1))];
}

function dateLabel(turn: number): string {
  return historyTurnDate(turn).label;
}

const compactNumber = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format;

function valueLabel(world: WorldState, value: DeltaValue, field: string): string {
  if (typeof value === 'number') return compactNumber(value);
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (value === null) return '无';
  if (field.startsWith('order.') && ORDER_VALUE_LABELS[value]) return ORDER_VALUE_LABELS[value];
  const named = world.characters.find((item) => item.id === value)?.name
    ?? world.polities.find((item) => item.id === value)?.shortName
    ?? world.polities.find((item) => item.id === value)?.name
    ?? world.regions.find((item) => item.id === value)?.name
    ?? world.families.find((item) => item.id === value)?.name
    ?? world.factions.find((item) => item.id === value)?.name
    ?? world.armies.find((item) => item.id === value)?.name
    ?? world.wars.find((item) => item.id === value)?.reason;
  if (named) return named;
  return field === 'outcomeKey' ? situationOutcomeLabel(value) : value;
}

function entityLabel(world: WorldState, type: StateDelta['entityType'], id: string): string {
  if (type === 'character') return world.characters.find((item) => item.id === id)?.name ?? '已佚人物';
  if (type === 'polity') return world.polities.find((item) => item.id === id)?.shortName
    ?? world.polities.find((item) => item.id === id)?.name
    ?? '已佚政权';
  if (type === 'region') return world.regions.find((item) => item.id === id)?.name ?? '未载州域';
  if (type === 'family') return world.families.find((item) => item.id === id)?.name ?? '已佚家族';
  if (type === 'faction') return world.factions.find((item) => item.id === id)?.name ?? '已佚派系';
  if (type === 'army') return world.armies.find((item) => item.id === id)?.name ?? '已解散军团';
  if (type === 'fleet') return world.fleets.find((item) => item.id === id)?.name ?? '已解散舰队';
  if (type === 'war') return '该场战争';
  if (type === 'situation') return '该局势';
  return '相关对象';
}

function projectDelta(world: WorldState, factId: string, delta: StateDelta): SituationDetailDelta {
  return {
    factId,
    entityType: delta.entityType,
    entityId: delta.entityId,
    entityLabel: entityLabel(world, delta.entityType, delta.entityId),
    field: delta.field,
    fieldLabel: delta.field === 'alive' && delta.entityType === 'character' ? '生死'
      : delta.field === 'alive' && delta.entityType === 'polity' ? '政权存续'
      : FIELD_LABELS[delta.field] ?? '状态变化',
    before: delta.before,
    after: delta.after,
    beforeLabel: delta.field === 'alive' ? delta.before ? '存续' : '已退场' : valueLabel(world, delta.before, delta.field),
    afterLabel: delta.field === 'alive' ? delta.after ? '存续' : delta.entityType === 'character' ? '已故' : '已亡' : valueLabel(world, delta.after, delta.field),
    delta: typeof delta.delta === 'number' ? delta.delta : null,
  };
}

type FactHistoryIndex = ReadonlyMap<string, readonly string[]>;

function buildFactHistoryIndex(world: WorldState): FactHistoryIndex {
  const index = new Map<string, string[]>();
  for (const event of readWorldHistory(world)) {
    if (!isDefaultVisibleHistoryEvent(event)) continue;
    for (const factId of event.sourceFactIds) {
      const eventIds = index.get(factId) ?? [];
      if (eventIds.length < 2 && !eventIds.includes(event.id)) eventIds.push(event.id);
      index.set(factId, eventIds);
    }
  }
  return index;
}

function projectFact(world: WorldState, fact: SimulationFact, historyByFact: FactHistoryIndex): SituationDetailFact {
  const copy = projectFactNarrative(world, fact);
  return {
    id: fact.id,
    kind: fact.kind,
    kindLabel: FACT_KIND_LABELS[fact.kind],
    turn: fact.turn,
    dateLabel: `第 ${fact.year} 年 · ${fact.season}季`,
    title: copy.title,
    summary: copy.summary,
    importance: fact.importance,
    stateDeltas: fact.stateDeltas.slice(0, MAX_SITUATION_DETAIL_DELTAS).map((delta) => projectDelta(world, fact.id, delta)),
    sourceFactIds: [...fact.sourceFactIds],
    historyEventIds: [...(historyByFact.get(fact.id) ?? [])],
  };
}

function warFactMatches(fact: SimulationFact, warId: string): boolean {
  if (fact.kind === 'war_started' || fact.kind === 'war_ended' || fact.kind === 'battle') {
    return fact.payload.warId === warId;
  }
  return fact.kind === 'territory_control_changed' && fact.payload.warId === warId;
}

function evidenceFacts(
  situation: SituationState,
  milestoneFacts: readonly Extract<SimulationFact, { kind: 'situation_milestone' }>[],
  availableFacts: readonly SimulationFact[],
): { facts: SimulationFact[]; missingFactIds: string[] } {
  const directIds = unique([
    ...situation.causalFactIds,
    ...situation.milestoneFactIds,
    ...(situation.resolution?.resultFactIds ?? []),
    ...milestoneFacts.map((fact) => fact.id),
    ...milestoneFacts.flatMap((fact) => fact.sourceFactIds),
  ]);
  const factById = new Map(availableFacts.map((fact) => [fact.id, fact]));
  const missingFactIds = directIds.filter((id) => !factById.has(id));
  const selected = new Map<string, SimulationFact>();
  for (const id of directIds) {
    const fact = factById.get(id);
    if (fact) selected.set(id, fact);
  }
  if (situation.type === 'war_progress') {
    for (const fact of availableFacts) {
      if (warFactMatches(fact, situation.scopeKey)) selected.set(fact.id, fact);
    }
  }
  const ordered = [...selected.values()].sort((left, right) => left.turn - right.turn || stableCompare(left.id, right.id));
  return { facts: boundChronological(ordered, MAX_SITUATION_DETAIL_FACTS), missingFactIds };
}

function outcomeSummary(situation: SituationState, label: string): string {
  if (situation.type === 'war_progress') return `这场战争以“${label}”收束，双方已经停下交兵。`;
  if (situation.type === 'inheritance_crisis') return `君位承继以“${label}”收束。`;
  if (situation.type === 'court_power_struggle') {
    return `这场朝堂争权以“${label}”收束。`;
  }
  return `这场军权争执以“${label}”收束。`;
}

function playerSummary(
  world: WorldState,
  situation: SituationState,
  item: SituationSnapshotItem,
  durationLabel: string,
  outcomeLabel: string | null,
): string[] {
  const core = item.participants.find((group) => group.key === 'coreCharacterIds')?.entities[0]?.label;
  const polity = item.participants.find((group) => group.key === 'polityIds')?.entities[0]?.label;
  const courtParties = item.participants
    .find((group) => group.key === 'factionIds')
    ?.entities.slice(0, 2)
    .map((entity) => entity.label)
    .filter(Boolean) ?? [];
  if (situation.status === 'resolved') {
    const resolvedSummary = situation.type === 'court_power_struggle'
      ? `${courtParties.length > 0 ? courtParties.join('与') : core ?? '朝中各方'}在${polity ?? '该朝廷'}的角力以“${outcomeLabel ?? '争执平息'}”收束。`
      : outcomeSummary(situation, outcomeLabel ?? '争执平息');
    return [
      `${item.title}起于${dateLabel(situation.startedTurn)}，于${dateLabel(situation.resolvedTurn ?? situation.lastUpdatedTurn)}结案，历时${durationLabel}。`,
      resolvedSummary,
    ];
  }
  if (situation.type === 'war_progress') {
    const war = projectWarGroups(world, situation.scopeKey);
    if (!war) return [`${item.title}仍在继续。`];
    const contact = war.contacts[0];
    const latest = war.latestBattle;
    return [
      `${war.sides[0].polity}${war.sides[0].armyCount}营、${war.sides[1].polity}${war.sides[1].armyCount}营正在${war.mainFront}一带交兵。`,
      contact
        ? `${contact.attackerCommander}正率${contact.attacker}接近${contact.region}，将迎上${contact.defenderCommanders}。`
        : latest
          ? `最近一战在${latest.region}，${latest.attackerCommander}${latest.result}；${latest.aftermath}`
          : '双方尚未留下新的会战记录。',
    ];
  }
  if (situation.type === 'military_power_crisis') {
    return [
      `${core ?? '这名将领'}的军令与军中拥戴仍牵动${polity ?? '朝廷'}，目前尚未发生换帅或交兵。`,
    ];
  }
  if (situation.type === 'inheritance_crisis') {
    return [
      `${polity ?? '该政权'}仍在排定君位承继，目前尚未发生新君即位或监国更替。`,
    ];
  }
  if (situation.type === 'court_power_struggle') {
    const parties = courtParties.length > 0 ? courtParties.join('与') : core ?? '朝中各方';
    return [
      `${parties}正在${polity ?? '该朝廷'}争夺任命与支持，目前尚未发生夺位或清洗。`,
    ];
  }
  return [`${item.title}仍在继续。`];
}

function directoryItem(situation: SituationState, world: WorldState): SituationDirectoryItem {
  const item = projectSituationSnapshotItem(situation, world);
  return {
    id: item.id,
    type: item.type,
    typeLabel: item.typeLabel,
    title: item.title,
    status: item.status,
    dateLabel: item.status === 'resolved'
      ? dateLabel(item.resolvedTurn ?? item.lastUpdatedTurn)
      : `始于${dateLabel(item.startedTurn)}`,
  };
}

export function projectSituationDetail(world: WorldState, situation: SituationState): SituationDetailProjection {
  const item = projectSituationSnapshotItem(situation, world);
  const allFacts = readWorldFacts(world);
  const historyByFact = buildFactHistoryIndex(world);
  const milestoneFacts = allFacts
    .filter((fact): fact is Extract<SimulationFact, { kind: 'situation_milestone' }> => (
      fact.kind === 'situation_milestone' && fact.payload.situationId === situation.id
    ))
    .sort((left, right) => left.turn - right.turn || stableCompare(left.id, right.id));
  const evidenceSelection = evidenceFacts(situation, milestoneFacts, allFacts);
  const continuations = continuousRulerSeatIds(allFacts);
  const evidence = evidenceSelection.facts
    .filter((fact) => fact.kind !== 'situation_milestone' && !continuations.has(fact.id))
    .map((fact) => projectFact(world, fact, historyByFact));
  const resultFactIds = [...(situation.resolution?.resultFactIds ?? [])];
  const resultFactIdSet = new Set(resultFactIds);
  const consequences = evidence
    .filter((fact) => resultFactIdSet.has(fact.id))
    .flatMap((fact) => fact.stateDeltas.map((delta) => ({
      id: `${fact.id}:${delta.entityType}:${delta.entityId}:${delta.field}`,
      factId: fact.id,
      entityLabel: delta.entityLabel,
      fieldLabel: delta.fieldLabel,
      beforeLabel: delta.beforeLabel,
      afterLabel: delta.afterLabel,
    })))
    .slice(0, MAX_SITUATION_DETAIL_DELTAS);
  const outcomeKey = situation.resolution?.outcomeKey ?? null;
  const outcomeLabel = outcomeKey ? situationOutcomeLabel(outcomeKey) : null;
  const endTurn = situation.resolvedTurn;
  const durationTurns = Math.max(1, (endTurn ?? situation.lastUpdatedTurn) - situation.startedTurn + 1);
  const durationLabel = durationTurns < 4 ? `${durationTurns}季` : `${Math.floor(durationTurns / 4)}年${durationTurns % 4 ? `${durationTurns % 4}季` : ''}`;
  const scenes = projectSituationHistoricalScenes(world, situation, 3);
  const latestScene = scenes[0];
  const lastSettledTurn = world.lastTurn?.turn ?? Math.max(0, world.turn - 1);
  const recentFactIds = new Set(latestScene?.sourceFactIds ?? []);
  const coreImpact = (recentFactIds.size
    ? projectCoreImpacts(world, { sourceFactIds: [...recentFactIds], limit: 1 })[0]
    : undefined) ?? (situation.type === 'war_progress'
    ? projectCoreImpacts(world, { warId: situation.scopeKey, limit: 1 })[0]
    : undefined);
  const recentDeltas = evidence
    .filter((fact) => recentFactIds.has(fact.id))
    .flatMap((fact) => fact.stateDeltas)
    .filter((delta) => delta.entityLabel !== '相关对象' && delta.field !== 'status' && delta.field !== 'active')
    .slice(0, 4);
  return {
    id: situation.id,
    type: situation.type,
    typeLabel: item.typeLabel,
    title: item.title,
    status: situation.status,
    startDateLabel: dateLabel(situation.startedTurn),
    endDateLabel: dateLabel(endTurn ?? situation.lastUpdatedTurn),
    durationLabel,
    playerSummary: playerSummary(world, situation, item, durationLabel, outcomeLabel),
    currentChange: latestScene && latestScene.turn === lastSettledTurn
      ? latestScene.shortText
      : latestScene
        ? `本季暂无新进展；最近一次发生在${latestScene.dateLabel}：${latestScene.shortText}`
      : situation.status === 'resolved' && outcomeLabel
        ? `${dateLabel(situation.resolvedTurn ?? situation.lastUpdatedTurn)}，本案以“${outcomeLabel}”结案。`
        : '本季暂无新的交战、任免或权力变化。',
    coreImpact: coreImpact ? { summary: coreImpact.summary, sourceEventId: coreImpact.sourceEventIds[0] ?? null } : null,
    recentDeltas: situation.type === 'war_progress' ? [] : recentDeltas,
    outcome: outcomeKey ? {
      key: outcomeKey,
      label: outcomeLabel ?? '结构压力已经消散',
      summary: outcomeSummary(situation, outcomeLabel ?? '结构压力已经消散'),
      resultFactIds,
    } : null,
    participants: item.participants.map((group) => ({
      ...group,
      entities: group.entities.map((entity) => ({ ...entity })),
    })),
    politicalFocus: item.politicalFocus.map((link) => ({ ...link })),
    scenes,
    evidence,
    consequences,
  };
}

export function projectSituationWorkbench(
  world: WorldState,
  preferredSituationId: string | null = null,
): SituationWorkbenchProjection {
  const openSituations = world.situationSystem.situations
    .filter((situation) => situation.status === 'open')
    .sort((left, right) => (
      (left.phase === 'critical' ? 0 : left.phase === 'active' ? 1 : 2)
      - (right.phase === 'critical' ? 0 : right.phase === 'active' ? 1 : 2)
      || right.importance - left.importance
      || right.tension - left.tension
      || stableCompare(left.id, right.id)
    ));
  const resolvedSituations = world.situationSystem.situations
    .filter((situation) => situation.status === 'resolved')
    .sort((left, right) => (
      (right.resolvedTurn ?? -1) - (left.resolvedTurn ?? -1)
      || stableCompare(left.id, right.id)
    ));
  const visibleResolved = resolvedSituations.slice(0, MAX_SITUATION_DIRECTORY_RESOLVED);
  const visible = [...openSituations, ...visibleResolved];
  const selectedSituation = visible.find((situation) => situation.id === preferredSituationId)
    ?? openSituations[0]
    ?? visibleResolved[0]
    ?? null;
  return {
    version: 1,
    openCount: openSituations.length,
    resolvedCount: world.situationSystem.archive.resolvedCount + resolvedSituations.length,
    archivedResolvedCount: world.situationSystem.archive.resolvedCount,
    open: openSituations.map((situation) => directoryItem(situation, world)),
    recentResolved: visibleResolved.map((situation) => directoryItem(situation, world)),
    selectedId: selectedSituation?.id ?? null,
    selected: selectedSituation ? projectSituationDetail(world, selectedSituation) : null,
  };
}
