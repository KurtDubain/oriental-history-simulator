import {
  INHERITANCE_CRISIS_TEMPLATE,
  MILITARY_POWER_CRISIS_TEMPLATE,
  WAR_PROGRESS_TEMPLATE,
  type SituationEvidenceRef,
  type SituationPhase,
  type SituationRecentChange,
  type SituationSignalRole,
  type SituationState,
  type SituationTemplate,
} from '../sim/situations';
import type { SimulationFact } from '../sim/facts/types';
import type { DeltaValue, StateDelta, WorldState } from '../sim/types';
import { historyTurnDate } from './v1-history';
import {
  projectSituationSnapshotItem,
  situationOutcomeLabel,
  situationPhaseLabel,
  situationSignalLabel,
  type SituationSnapshotItem,
  type SituationSnapshotParticipantGroup,
} from './situation-snapshot';

export const MAX_SITUATION_DIRECTORY_RESOLVED = 8;
export const MAX_SITUATION_DETAIL_TIMELINE = 6;
export const MAX_SITUATION_DETAIL_FACTS = 16;
export const MAX_SITUATION_DETAIL_DELTAS = 8;

export interface SituationDirectoryItem {
  id: string;
  type: string;
  typeLabel: string;
  title: string;
  status: SituationSnapshotItem['status'];
  statusLabel: string;
  phase: SituationPhase;
  phaseLabel: string;
  tension: number;
  momentum: number;
  dateLabel: string;
}

export interface SituationDetailDriver {
  key: string;
  label: string;
  role: SituationSignalRole;
  roleLabel: string;
  direction: 'drives' | 'restrains' | 'records';
  contribution: number;
  refs: SituationEvidenceRef[];
}

export interface SituationDetailTimelineItem {
  id: string;
  turn: number;
  dateLabel: string;
  kind: SituationRecentChange['kind'];
  label: string;
  summary: string;
  phaseLabel: string | null;
  tension: number;
  milestoneFactId: string | null;
  sourceFactIds: string[];
  historyEventIds: string[];
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
  actorLabels: string[];
  polityLabels: string[];
  regionLabels: string[];
  causeLabels: string[];
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

export interface SituationDetailAudit {
  situationId: string;
  situationType: string;
  scopeKey: string;
  titleKey: string;
  executableActorIds: string[];
  startSnapshot: {
    turn: number;
    pressure: number;
    participantDigest: string;
    evidenceDigest: string;
  };
  finalSnapshotDigest: string | null;
  template: SituationTemplate | null;
  signals: SituationDetailDriver[];
  possibleOutcomes: Array<{ key: string; label: string; relativeScore: number }>;
  causalFactIds: string[];
  milestoneFactIds: string[];
  resultFactIds: string[];
  missingFactIds: string[];
  coverageNotes: string[];
  randomness: string;
}

export interface SituationDetailProjection {
  id: string;
  type: string;
  typeLabel: string;
  title: string;
  status: SituationSnapshotItem['status'];
  statusLabel: string;
  phase: SituationPhase;
  phaseLabel: string;
  tension: number;
  momentum: number;
  tensionBand: '平稳' | '紧张' | '临界';
  momentumLabel: '升温' | '持平' | '降温';
  startedTurn: number;
  endedTurn: number | null;
  startDateLabel: string;
  endDateLabel: string;
  durationTurns: number;
  durationLabel: string;
  playerSummary: string[];
  currentChange: string;
  nextWatch: string;
  outcome: null | {
    key: string;
    label: string;
    summary: string;
    resultFactIds: string[];
  };
  participants: SituationSnapshotParticipantGroup[];
  publicDrivers: SituationDetailDriver[];
  timeline: SituationDetailTimelineItem[];
  evidence: SituationDetailFact[];
  consequences: SituationDetailConsequence[];
  consequenceCoverage: string;
  audit: SituationDetailAudit;
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

const ROLE_LABELS: Record<SituationSignalRole, string> = {
  structural: '结构压力',
  trigger: '近期触发',
  inhibitor: '抑制因素',
  capability: '行动能力',
  outcome: '结果信号',
};

const CHANGE_LABELS: Record<SituationRecentChange['kind'], string> = {
  formed: '局势形成',
  phase_changed: '阶段转折',
  participants_changed: '人物更替',
  resolved: '局势结案',
};

const FACT_KIND_LABELS: Record<SimulationFact['kind'], string> = {
  war_started: '宣战事实',
  war_ended: '停战事实',
  battle: '战役事实',
  territory_control_changed: '领土事实',
  appointment_started: '任命事实',
  appointment_ended: '去职事实',
  character_death: '人物事实',
  marriage: '婚姻事实',
  agency_intent_submitted: '军令请求',
  agency_intent_resolved: '军令裁决',
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
};

const TEMPLATE_BY_TYPE: Readonly<Record<string, SituationTemplate>> = {
  military_power_crisis: MILITARY_POWER_CRISIS_TEMPLATE,
  inheritance_crisis: INHERITANCE_CRISIS_TEMPLATE,
  war_progress: WAR_PROGRESS_TEMPLATE,
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

function cloneRef(ref: SituationEvidenceRef): SituationEvidenceRef {
  return ref.kind === 'fact'
    ? { kind: 'fact', factId: ref.factId }
    : {
        kind: 'index',
        entityType: ref.entityType,
        entityId: ref.entityId,
        field: ref.field,
        value: ref.value,
      };
}

function dateLabel(turn: number): string {
  return historyTurnDate(turn).label;
}

function compactNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(value);
}

function valueLabel(world: WorldState, value: DeltaValue, field: string): string {
  if (typeof value === 'number') return compactNumber(value);
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (value === null) return '无';
  const named = world.characters.find((item) => item.id === value)?.name
    ?? world.polities.find((item) => item.id === value)?.shortName
    ?? world.polities.find((item) => item.id === value)?.name
    ?? world.regions.find((item) => item.id === value)?.name
    ?? world.families.find((item) => item.id === value)?.name;
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
    fieldLabel: FIELD_LABELS[delta.field] ?? '状态变化',
    before: delta.before,
    after: delta.after,
    beforeLabel: valueLabel(world, delta.before, delta.field),
    afterLabel: valueLabel(world, delta.after, delta.field),
    delta: typeof delta.delta === 'number' ? delta.delta : null,
  };
}

function polityLabel(world: WorldState, id: string): string {
  const polity = world.polities.find((item) => item.id === id);
  return polity?.shortName || polity?.name || '未载政权';
}

function characterLabel(world: WorldState, id: string): string {
  return world.characters.find((item) => item.id === id)?.name ?? '未载人物';
}

function regionLabel(world: WorldState, id: string): string {
  return world.regions.find((item) => item.id === id)?.name ?? '未载州域';
}

function armyLabel(world: WorldState, id: string): string {
  return world.armies.find((item) => item.id === id)?.name ?? '该军团';
}

function factCopy(world: WorldState, fact: SimulationFact): { title: string; summary: string } {
  if (fact.kind === 'war_started') {
    return {
      title: `${polityLabel(world, fact.payload.attackerId)}向${polityLabel(world, fact.payload.defenderId)}开战`,
      summary: `战争目标为${fact.payload.goal}。${fact.payload.reason}`,
    };
  }
  if (fact.kind === 'war_ended') {
    return {
      title: `${polityLabel(world, fact.payload.attackerId)}与${polityLabel(world, fact.payload.defenderId)}停战`,
      summary: `${situationOutcomeLabel(fact.payload.result)}；战果记为攻方 ${compactNumber(fact.payload.attackerScore)}、守方 ${compactNumber(fact.payload.defenderScore)}。${fact.payload.reason}`,
    };
  }
  if (fact.kind === 'battle') {
    const attacker = characterLabel(world, fact.payload.attacker.commanderId);
    const defenders = fact.payload.defenders.map((item) => characterLabel(world, item.commanderId)).join('、') || '守军';
    return {
      title: `${regionLabel(world, fact.payload.targetRegionId)}之战`,
      summary: `${attacker}所部与${defenders}交战，${fact.payload.attackerWon ? '攻方取胜' : '守方守住战线'}。双方有据可核的损失为 ${compactNumber(fact.payload.attacker.losses + fact.payload.defenders.reduce((sum, item) => sum + item.losses, 0))}。`,
    };
  }
  if (fact.kind === 'territory_control_changed') {
    return {
      title: `${regionLabel(world, fact.payload.regionId)}控制权变更`,
      summary: `${polityLabel(world, fact.payload.previousControllerId)}的控制转入${polityLabel(world, fact.payload.nextControllerId)}。`,
    };
  }
  if (fact.kind === 'appointment_started' || fact.kind === 'appointment_ended') {
    const entering = fact.kind === 'appointment_started';
    return {
      title: `${characterLabel(world, fact.payload.holderId)}${entering ? '受任' : '去职'}`,
      summary: `${entering ? '出任' : '卸下'}${fact.payload.officeKind}，任职政权为${polityLabel(world, fact.payload.polityId)}。`,
    };
  }
  if (fact.kind === 'character_death') {
    return {
      title: `${characterLabel(world, fact.payload.characterId)}去世`,
      summary: `终年 ${fact.payload.age} 岁，身后身份记为${fact.payload.role}。`,
    };
  }
  if (fact.kind === 'marriage') {
    return {
      title: `${characterLabel(world, fact.payload.leftCharacterId)}与${characterLabel(world, fact.payload.rightCharacterId)}成婚`,
      summary: fact.payload.diplomatic ? '这桩婚姻同时承担了政权之间的外交联结。' : '这桩婚姻进入双方家族谱牒。',
    };
  }
  if (fact.kind === 'agency_intent_submitted') {
    return {
      title: `${characterLabel(world, fact.payload.actorId)}请掌${armyLabel(world, fact.payload.targetArmyId)}`,
      summary: `这是其第${fact.payload.attemptOrdinal}次正式请求独立统军，现任主帅为${characterLabel(world, fact.payload.currentCommanderId)}。`,
    };
  }
  if (fact.kind === 'agency_intent_resolved') {
    const outcome = fact.payload.outcome === 'executed'
      ? '获准生效'
      : fact.payload.outcome === 'rejected'
        ? '未获准许'
        : fact.payload.outcome === 'deferred'
          ? '暂缓再议'
          : '因资格变化而作罢';
    const reason: Record<typeof fact.payload.reasonCode, string> = {
      permission_lost: '请求资格已经失去',
      insufficient_record: '军中履历仍显不足',
      insufficient_support: '主帅、主君或家门支持不足',
      competing_request: '本季已有另一项换帅军令先获处理',
      court_risk: '朝廷认为授令风险过高',
      claim_weaker: '资历尚不足以取代现任主帅',
      command_granted: '履历、支持与风险审查均已通过',
    };
    const claimAssessment = fact.payload.outcome === 'executed'
      ? fact.payload.decisionScore - fact.payload.decisionThreshold >= 16
        ? '其军中资望已明显足以受任'
        : '其军中资望已足以受任'
      : fact.payload.reasonCode === 'claim_weaker'
        ? '与现任主帅相比，朝廷认为其资望仍欠火候'
        : fact.payload.outcome === 'invalidated'
          ? '原有请求已不再具备裁决条件'
          : '朝廷本季没有授予军令';
    return {
      title: `${characterLabel(world, fact.payload.actorId)}所请军令${outcome}`,
      summary: `${reason[fact.payload.reasonCode]}；${claimAssessment}。`,
    };
  }
  const transitionLabel = fact.payload.transition === 'formed'
    ? '形成'
    : fact.payload.transition === 'resolved'
      ? '结案'
      : '进入新阶段';
  return {
    title: `局势${transitionLabel}`,
    summary: fact.payload.outcomeKey
      ? `以“${situationOutcomeLabel(fact.payload.outcomeKey)}”结案。`
      : `局势${transitionLabel}，其证据来自同季的领域事实。`,
  };
}

type FactHistoryIndex = ReadonlyMap<string, readonly string[]>;

function buildFactHistoryIndex(world: WorldState): FactHistoryIndex {
  const index = new Map<string, string[]>();
  for (const event of world.history) {
    for (const factId of event.sourceFactIds) {
      const eventIds = index.get(factId) ?? [];
      if (eventIds.length < 2 && !eventIds.includes(event.id)) eventIds.push(event.id);
      index.set(factId, eventIds);
    }
  }
  return index;
}

function projectFact(world: WorldState, fact: SimulationFact, historyByFact: FactHistoryIndex): SituationDetailFact {
  const copy = factCopy(world, fact);
  return {
    id: fact.id,
    kind: fact.kind,
    kindLabel: FACT_KIND_LABELS[fact.kind],
    turn: fact.turn,
    dateLabel: `第 ${fact.year} 年 · ${fact.season}季`,
    title: copy.title,
    summary: copy.summary,
    importance: fact.importance,
    actorLabels: unique(fact.actorIds.map((id) => characterLabel(world, id))),
    polityLabels: unique(fact.polityIds.map((id) => polityLabel(world, id))),
    regionLabels: unique(fact.regionIds.map((id) => regionLabel(world, id))),
    causeLabels: fact.causes.slice(0, 3).map((cause) => `${cause.label}：${cause.evidence}`),
    stateDeltas: fact.stateDeltas.slice(0, MAX_SITUATION_DETAIL_DELTAS).map((delta) => projectDelta(world, fact.id, delta)),
    sourceFactIds: [...fact.sourceFactIds],
    historyEventIds: [...(historyByFact.get(fact.id) ?? [])],
  };
}

function driverProjection(situation: SituationState): SituationDetailDriver[] {
  return situation.signals.map((signal) => ({
    key: signal.key,
    label: situationSignalLabel(signal.key, signal.role),
    role: signal.role,
    roleLabel: ROLE_LABELS[signal.role],
    direction: signal.role === 'inhibitor' || signal.contribution < 0
      ? 'restrains'
      : signal.role === 'outcome'
        ? 'records'
        : 'drives',
    contribution: signal.contribution,
    refs: signal.refs.map(cloneRef),
  }));
}

function publicDrivers(drivers: readonly SituationDetailDriver[]): SituationDetailDriver[] {
  const rolePriority: Record<SituationSignalRole, number> = {
    trigger: 0,
    capability: 1,
    structural: 2,
    inhibitor: 3,
    outcome: 4,
  };
  const driving = drivers
    .filter((item) => item.direction === 'drives')
    .sort((left, right) => rolePriority[left.role] - rolePriority[right.role] || Math.abs(right.contribution) - Math.abs(left.contribution))
    .slice(0, 3);
  const restraining = drivers.filter((item) => item.direction === 'restrains').slice(0, 2);
  return [...driving, ...restraining].slice(0, 5).map((item) => ({ ...item, refs: item.refs.map(cloneRef) }));
}

function momentumLabel(momentum: number): SituationDetailProjection['momentumLabel'] {
  if (momentum > 4) return '升温';
  if (momentum < -4) return '降温';
  return '持平';
}

function tensionBand(phase: SituationPhase): SituationDetailProjection['tensionBand'] {
  if (phase === 'critical') return '临界';
  if (phase === 'active') return '紧张';
  return '平稳';
}

function changeSummary(change: SituationRecentChange, phaseLabel: string | null): string {
  if (change.kind === 'formed') return '连续存在的结构信号已经足以形成一条可持续追踪的历史进程。';
  if (change.kind === 'resolved') return '明确的结果事实已经结束这条矛盾链，局势不再继续更新。';
  if (change.kind === 'participants_changed') return '局势中的关键人物或组织发生变化，后续力量关系需要重新观察。';
  return phaseLabel ? `局势转入“${phaseLabel}”阶段。` : '局势的公开阶段发生变化。';
}

function projectTimeline(
  situation: SituationState,
  milestoneFacts: readonly Extract<SimulationFact, { kind: 'situation_milestone' }>[],
  historyByFact: FactHistoryIndex,
): SituationDetailTimelineItem[] {
  const changeByKey = new Map(situation.recentChanges.map((change) => [`${change.turn}:${change.kind}`, change]));
  const milestoneItems = milestoneFacts.map((fact) => {
    const kind: SituationRecentChange['kind'] = fact.payload.transition === 'formed'
      ? 'formed'
      : fact.payload.transition === 'resolved'
        ? 'resolved'
        : 'phase_changed';
    const matching = changeByKey.get(`${fact.turn}:${kind}`);
    const targetPhase = fact.payload.toPhase ?? matching?.toPhase ?? null;
    const targetPhaseLabel = targetPhase ? situationPhaseLabel(targetPhase) : null;
    const relatedFactIds = unique([...fact.sourceFactIds, ...(matching?.sourceFactIds ?? [])]).slice(0, 8);
    return {
      id: `milestone:${fact.id}`,
      turn: fact.turn,
      dateLabel: `第 ${fact.year} 年 · ${fact.season}季`,
      kind,
      label: CHANGE_LABELS[kind],
      summary: changeSummary(matching ?? {
        turn: fact.turn,
        kind,
        tension: fact.payload.tension,
        fromPhase: fact.payload.fromPhase,
        toPhase: fact.payload.toPhase,
        sourceFactIds: fact.sourceFactIds,
      }, targetPhaseLabel),
      phaseLabel: targetPhaseLabel,
      tension: fact.payload.tension,
      milestoneFactId: fact.id,
      sourceFactIds: relatedFactIds,
      historyEventIds: [...(historyByFact.get(fact.id) ?? [])],
    } satisfies SituationDetailTimelineItem;
  });
  const milestoneKeys = new Set(milestoneItems.map((item) => `${item.turn}:${item.kind}`));
  const retainedChangeItems = situation.recentChanges
    .filter((change) => !milestoneKeys.has(`${change.turn}:${change.kind}`))
    .map((change) => {
      const targetPhaseLabel = change.toPhase ? situationPhaseLabel(change.toPhase) : null;
      return {
        id: `change:${change.turn}:${change.kind}`,
        turn: change.turn,
        dateLabel: dateLabel(change.turn),
        kind: change.kind,
        label: CHANGE_LABELS[change.kind],
        summary: changeSummary(change, targetPhaseLabel),
        phaseLabel: targetPhaseLabel,
        tension: change.tension,
        milestoneFactId: null,
        sourceFactIds: [...change.sourceFactIds].slice(0, 8),
        historyEventIds: [],
      } satisfies SituationDetailTimelineItem;
    });
  const all = [...milestoneItems, ...retainedChangeItems]
    .sort((left, right) => left.turn - right.turn || stableCompare(left.id, right.id));
  if (!all.some((item) => item.kind === 'formed')) {
    all.unshift({
      id: `start:${situation.id}`,
      turn: situation.startedTurn,
      dateLabel: dateLabel(situation.startedTurn),
      kind: 'formed',
      label: '卷宗起点',
      summary: '形成时只封存了局势压力与证据指纹；未留存的历史指标不会由当前数值倒推。',
      phaseLabel: '萌芽',
      tension: situation.startSnapshot.pressure,
      milestoneFactId: null,
      sourceFactIds: [],
      historyEventIds: [],
    });
  }
  return boundChronological(all, MAX_SITUATION_DETAIL_TIMELINE);
}

function warFactMatches(fact: SimulationFact, warId: string): boolean {
  if (fact.kind === 'war_started' || fact.kind === 'war_ended' || fact.kind === 'battle') {
    return fact.payload.warId === warId;
  }
  return fact.kind === 'territory_control_changed' && fact.payload.warId === warId;
}

function evidenceFacts(
  world: WorldState,
  situation: SituationState,
  milestoneFacts: readonly Extract<SimulationFact, { kind: 'situation_milestone' }>[],
): { facts: SimulationFact[]; missingFactIds: string[] } {
  const directIds = unique([
    ...situation.causalFactIds,
    ...situation.milestoneFactIds,
    ...(situation.resolution?.resultFactIds ?? []),
    ...milestoneFacts.map((fact) => fact.id),
    ...milestoneFacts.flatMap((fact) => fact.sourceFactIds),
  ]);
  const factById = new Map(world.facts.map((fact) => [fact.id, fact]));
  const missingFactIds = directIds.filter((id) => !factById.has(id));
  const selected = new Map<string, SimulationFact>();
  for (const id of directIds) {
    const fact = factById.get(id);
    if (fact) selected.set(id, fact);
  }
  if (situation.type === 'war_progress') {
    for (const fact of world.facts) {
      if (warFactMatches(fact, situation.scopeKey)) selected.set(fact.id, fact);
    }
  }
  const ordered = [...selected.values()].sort((left, right) => left.turn - right.turn || stableCompare(left.id, right.id));
  return { facts: boundChronological(ordered, MAX_SITUATION_DETAIL_FACTS), missingFactIds };
}

function outcomeSummary(situation: SituationState, label: string): string {
  if (situation.type === 'war_progress') return `这场战争以“${label}”收束；胜负与停战理由只取自战争结案事实。`;
  if (situation.type === 'inheritance_crisis') return `继承秩序以“${label}”收束；结果由同季任免、死亡或政权存续事实共同确认。`;
  return `军权矛盾以“${label}”收束；卷宗只陈述已发生的任免、死亡或结构消散，不推断人物谋反意图。`;
}

function playerSummary(
  situation: SituationState,
  item: SituationSnapshotItem,
  drivers: readonly SituationDetailDriver[],
  durationLabel: string,
  outcomeLabel: string | null,
): string[] {
  const core = item.participants.find((group) => group.key === 'coreCharacterIds')?.entities[0]?.label;
  const polity = item.participants.find((group) => group.key === 'polityIds')?.entities[0]?.label;
  const preferredDriver = publicDrivers(drivers).find((driver) => driver.direction === 'drives');
  const driving = preferredDriver?.label;
  const restraint = drivers.find((driver) => driver.direction === 'restrains')?.label;
  if (situation.status === 'resolved') {
    return [
      `${item.title}起于${dateLabel(situation.startedTurn)}，于${dateLabel(situation.resolvedTurn ?? situation.lastUpdatedTurn)}结案，历时${durationLabel}。`,
      outcomeSummary(situation, outcomeLabel ?? '结构压力消散'),
      driving ? `卷宗保留的主要推动因素是“${driving}”${restraint ? `，同时“${restraint}”曾形成约束` : ''}。` : '卷宗只保留有据可核的关键转折。',
    ];
  }
  if (situation.type === 'military_power_crisis') {
    return [
      `${core ?? '一名将领'}的实际军令、军中立足与${polity ?? '朝廷'}的约束正在形成持续张力；这不等同于人物已经决定叛乱。`,
      driving ? `目前最值得注意的推动因素是“${driving}”${restraint ? `，而“${restraint}”仍在压住局势` : ''}。` : '现有结构证据仍在积累。',
    ];
  }
  if (situation.type === 'inheritance_crisis') {
    return [
      `${polity ?? '该政权'}的继承次序、候选支持与中央执行能力尚未形成稳定闭环；卷宗不替任何候选人虚构意图。`,
      driving ? `当前矛盾主要由“${driving}”推动${restraint ? `，“${restraint}”仍提供秩序约束` : ''}。` : '现有结构证据仍在积累。',
    ];
  }
  return [
    `${item.title}仍在延续，攻守方向来自同一条权威战争记录，战役与州域易手会继续改变局面。`,
    driving ? `当前战线最重要的信号是“${driving}”${restraint ? `，而“${restraint}”正在抑制升级` : ''}。` : '战线暂时缺少新的决定性事实。',
  ];
}

function directoryItem(situation: SituationState, world: WorldState): SituationDirectoryItem {
  const item = projectSituationSnapshotItem(situation, world);
  return {
    id: item.id,
    type: item.type,
    typeLabel: item.typeLabel,
    title: item.title,
    status: item.status,
    statusLabel: item.statusLabel,
    phase: item.phase,
    phaseLabel: item.phaseLabel,
    tension: item.tension,
    momentum: item.momentum,
    dateLabel: item.status === 'resolved'
      ? dateLabel(item.resolvedTurn ?? item.lastUpdatedTurn)
      : `始于${dateLabel(item.startedTurn)}`,
  };
}

export function projectSituationDetail(world: WorldState, situation: SituationState): SituationDetailProjection {
  const item = projectSituationSnapshotItem(situation, world);
  const drivers = driverProjection(situation);
  const historyByFact = buildFactHistoryIndex(world);
  const milestoneFacts = world.facts
    .filter((fact): fact is Extract<SimulationFact, { kind: 'situation_milestone' }> => (
      fact.kind === 'situation_milestone' && fact.payload.situationId === situation.id
    ))
    .sort((left, right) => left.turn - right.turn || stableCompare(left.id, right.id));
  const evidenceSelection = evidenceFacts(world, situation, milestoneFacts);
  const evidence = evidenceSelection.facts.map((fact) => projectFact(world, fact, historyByFact));
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
  const timeline = projectTimeline(situation, milestoneFacts, historyByFact);
  const latestTimeline = timeline.at(-1);
  const missingResultFacts = resultFactIds.filter((id) => !world.facts.some((fact) => fact.id === id));
  const coverageNotes = [
    '形成时只封存压力、参与者指纹与证据指纹，未保存的制度、人口和财富起点不可倒推。',
    `里程碑最多展示 ${MAX_SITUATION_DETAIL_TIMELINE} 条，事实证据最多展示 ${MAX_SITUATION_DETAIL_FACTS} 条。`,
    '后果仅来自结案 result Fact 的直接状态差量，不把史册文案当作模拟事实。',
  ];
  if (evidenceSelection.missingFactIds.length) coverageNotes.push('部分被引用事实已不在当前热档案中，卷宗保留缺页标记。');

  return {
    id: situation.id,
    type: situation.type,
    typeLabel: item.typeLabel,
    title: item.title,
    status: situation.status,
    statusLabel: item.statusLabel,
    phase: situation.phase,
    phaseLabel: item.phaseLabel,
    tension: situation.tension,
    momentum: situation.momentum,
    tensionBand: tensionBand(situation.phase),
    momentumLabel: momentumLabel(situation.momentum),
    startedTurn: situation.startedTurn,
    endedTurn: endTurn,
    startDateLabel: dateLabel(situation.startedTurn),
    endDateLabel: dateLabel(endTurn ?? situation.lastUpdatedTurn),
    durationTurns,
    durationLabel,
    playerSummary: playerSummary(situation, item, drivers, durationLabel, outcomeLabel),
    currentChange: latestTimeline
      ? `${latestTimeline.dateLabel}，${latestTimeline.summary}`
      : '尚无可公开的阶段转折。',
    nextWatch: item.nextSignal.label,
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
    publicDrivers: publicDrivers(drivers),
    timeline,
    evidence,
    consequences,
    consequenceCoverage: missingResultFacts.length
      ? '结案事实有缺页，仅展示当前仍可核验的直接差量。'
      : consequences.length
        ? '仅展示结案事实直接记录的状态差量，不代表完整历史净变化。'
        : '结案事实没有记录可展示的直接状态差量；不会据当前数值反推起点。',
    audit: {
      situationId: situation.id,
      situationType: situation.type,
      scopeKey: situation.scopeKey,
      titleKey: situation.titleKey,
      executableActorIds: [...situation.executableActorIds],
      startSnapshot: { ...situation.startSnapshot },
      finalSnapshotDigest: situation.resolution?.finalSnapshotDigest ?? null,
      template: TEMPLATE_BY_TYPE[situation.type] ? { ...TEMPLATE_BY_TYPE[situation.type] } : null,
      signals: drivers.map((driver) => ({ ...driver, refs: driver.refs.map(cloneRef) })),
      possibleOutcomes: situation.possibleOutcomes.map((outcome) => ({
        key: outcome.key,
        label: situationOutcomeLabel(outcome.key),
        relativeScore: outcome.confidence,
      })),
      causalFactIds: [...situation.causalFactIds],
      milestoneFactIds: [...situation.milestoneFactIds],
      resultFactIds,
      missingFactIds: unique(evidenceSelection.missingFactIds),
      coverageNotes,
      randomness: '无：局势形成、升降温与结案由事实、阈值和滞回规则决定。',
    },
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
