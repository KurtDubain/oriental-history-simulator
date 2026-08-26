import type { WorldState } from '../sim/types';
import type {
  SituationEvidenceRef,
  SituationParticipants,
  SituationPhase,
  SituationRecentChange,
  SituationSignal,
  SituationSignalRole,
  SituationState,
  SituationStatus,
} from '../sim/situations';

export const MAX_SNAPSHOT_OPEN_SITUATIONS = 12;
export const MAX_SNAPSHOT_RECENT_RESOLVED_SITUATIONS = 2;
export const MAX_SNAPSHOT_SITUATION_EVIDENCE = 4;

export type SituationParticipantGroupKey = keyof SituationParticipants;

export interface SituationSnapshotEntity {
  id: string;
  label: string;
}

export interface SituationSnapshotParticipantGroup {
  key: SituationParticipantGroupKey;
  label: string;
  entities: SituationSnapshotEntity[];
}

export interface SituationSnapshotEvidence {
  key: string;
  label: string;
  role: SituationSignalRole;
  roleLabel: string;
  contribution: number;
  refs: SituationEvidenceRef[];
  factIds: string[];
}

export interface SituationSnapshotChange {
  turn: number;
  kind: SituationRecentChange['kind'];
  label: string;
  tension: number;
  fromPhase: SituationPhase | null;
  toPhase: SituationPhase | null;
  sourceFactIds: string[];
}

export interface SituationSnapshotNextSignal {
  key: string;
  label: string;
  refs: SituationEvidenceRef[];
  factIds: string[];
}

export interface SituationSnapshotItem {
  id: string;
  type: string;
  typeLabel: string;
  title: string;
  status: SituationStatus;
  statusLabel: string;
  phase: SituationPhase;
  phaseLabel: string;
  tension: number;
  momentum: number;
  startedTurn: number;
  phaseSinceTurn: number;
  lastUpdatedTurn: number;
  resolvedTurn: number | null;
  causalFactIds: string[];
  milestoneFactIds: string[];
  participants: SituationSnapshotParticipantGroup[];
  evidence: SituationSnapshotEvidence[];
  latestChange: SituationSnapshotChange | null;
  nextSignal: SituationSnapshotNextSignal;
}

export interface SituationSystemSnapshot {
  version: 1;
  lastReducedTurn: number;
  openCount: number;
  resolvedCount: number;
  archivedResolvedCount: number;
  open: SituationSnapshotItem[];
  recentResolved: SituationSnapshotItem[];
}

export type SituationSnapshotLabelWorld = Pick<
  WorldState,
  'characters' | 'families' | 'factions' | 'polities' | 'regions' | 'armies' | 'fleets'
>;

const TYPE_LABELS: Readonly<Record<string, string>> = {
  military_power_crisis: '军权危机',
  inheritance_crisis: '继承危机',
};

const STATUS_LABELS: Record<SituationStatus, string> = {
  open: '发展中',
  resolved: '已结案',
};

const PHASE_LABELS: Record<SituationPhase, string> = {
  emerging: '萌芽',
  active: '发展',
  critical: '临界',
};

const SIGNAL_ROLE_LABELS: Record<SituationSignalRole, string> = {
  structural: '结构压力',
  trigger: '近期触发',
  inhibitor: '抑制因素',
  capability: '行动能力',
  outcome: '结果信号',
};

const SIGNAL_LABELS: Readonly<Record<string, string>> = {
  actual_army_command: '实际主帅军令',
  deputy_command_position: '副将军中位置',
  force_concentration: '军力集中',
  deputy_military_footing: '副将军中立足',
  high_ambition: '权位野心',
  low_ambition: '野心有限',
  weak_loyalty: '忠诚松动',
  strong_loyalty: '忠诚约束',
  weak_central_authority: '中央权威不足',
  strong_central_authority: '中央仍能制军',
  minister_ruler_relationship: '君臣关系',
  minister_ruler_relationship_unrecorded: '君臣关系尚无记录',
  ruler_court_relationship: '君臣关系',
  ruler_court_relationship_unrecorded: '君臣关系尚无记录',
  court_suspicion: '朝廷猜忌与信任',
  chain_of_command_relationship: '主副将关系',
  active_military_order: '生效军令',
  military_order_breached: '近期拒令或背约',
  military_order_fulfilled: '近期履行军令',
  subordinate_order_breached: '麾下军令链破裂',
  recent_battle_record: '近期战功与败绩',
  recent_command_removed: '近期削去军职',
  recent_command_granted: '近期授予军职',
  army_operational_readiness: '军团行动能力',
  military_network_support: '军中网络支持',
  family_mobilization_capacity: '家族可动员支撑',
  weak_family_base: '家族支撑有限',
  personal_caution: '谨慎抑制',
  actor_died: '军权主体死亡',
  command_removed: '军职已经解除',
  ruler_mortality_exposure: '君主寿命风险',
  ruler_health_stable: '君主健康稳定',
  no_legal_successor: '合法继承人缺位',
  competing_legal_claims: '合法主张相互竞争',
  clear_legal_successor: '继承次序清晰',
  weak_dynastic_legitimacy: '王朝合法性不足',
  strong_dynastic_legitimacy: '王朝合法性稳固',
  weak_succession_enforcement: '中央难以执行继承安排',
  strong_succession_enforcement: '中央仍能维持次序',
  weak_ruling_family_capacity: '统治家族组织力薄弱',
  strong_ruling_family_capacity: '统治家族仍可协调',
  factional_succession_split: '派系分押候选人',
  consort_clan_pressure: '姻亲家族集团施压',
  claimant_military_support: '候选人掌握军方支持',
  ruler_death_without_lawful_settlement: '君主死亡后交接尚未落定',
  current_succession_evidence: '本季权力网络变化',
  lawful_succession: '合法继承已完成',
  orderly_succession: '有序继承已完成',
  regency_established: '监国秩序已建立',
  dynasty_replaced: '王朝已被替代',
  palace_transfer: '宫廷内部权力交接',
  usurpation: '篡位已成',
  dynastic_usurpation: '异姓权力交接已完成',
  polity_extinguished: '政权已灭亡',
  polity_destroyed: '政权已被军事消灭',
  lineage_extinguished_and_absorbed: '王系断绝且故国被吸收',
};

const WATCH_SIGNAL_LABELS: Readonly<Record<string, string>> = {
  watch_military_order_resolution: '观察军令会被履行、拒绝，还是随升迁而解除',
  watch_independent_command: '观察副将是否获得独立军令、积累新战功或与主帅失和',
  watch_recall_or_refusal: '观察朝廷是否召还、调任或安抚主帅，以及主帅是否服从',
  watch_command_and_army_support: '观察军职、战功、军中网络与家族支撑是否继续扩大',
  watch_command_succession: '观察军团由谁接掌，以及旧有军中与家族网络流向何处',
  watch_post_command_settlement: '观察解除军职后的安置、清洗、再任命或余部追随',
  watch_ruler_health_and_succession: '观察君主健康与可执行的继承安排',
  watch_heir_designation: '观察统治家族是否出现合法候选人',
  watch_claimant_support_balance: '观察候选人的家族、派系、官职与军方支持消长',
  watch_successor_states: '观察故国人物、家族、军队与领土的去向',
  watch_new_reign_consolidation: '观察新君能否重建合法性、中央权威与统治联盟',
};

const PARTICIPANT_GROUP_LABELS: Record<SituationParticipantGroupKey, string> = {
  coreCharacterIds: '核心人物',
  supportingCharacterIds: '支持人物',
  opposingCharacterIds: '反对人物',
  familyIds: '相关家族',
  factionIds: '相关派系',
  polityIds: '相关政权',
  regionIds: '相关地区',
  armyIds: '相关军团',
  fleetIds: '相关舰队',
};

const CHANGE_LABELS: Record<SituationRecentChange['kind'], string> = {
  formed: '局势形成',
  phase_changed: '阶段变化',
  participants_changed: '参与者变化',
  resolved: '局势结案',
};

const PHASE_SORT_ORDER: Record<SituationPhase, number> = {
  critical: 0,
  active: 1,
  emerging: 2,
};

function stableCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
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

function factIdsFromRefs(refs: readonly SituationEvidenceRef[]): string[] {
  return [...new Set(refs.flatMap((ref) => ref.kind === 'fact' ? [ref.factId] : []))]
    .sort(stableCompare);
}

function entityLabelMaps(world: SituationSnapshotLabelWorld): Record<SituationParticipantGroupKey, ReadonlyMap<string, string>> {
  const characterLabels = new Map(world.characters.map((item) => [item.id, item.name]));
  return {
    coreCharacterIds: characterLabels,
    supportingCharacterIds: characterLabels,
    opposingCharacterIds: characterLabels,
    familyIds: new Map(world.families.map((item) => [item.id, item.name])),
    factionIds: new Map(world.factions.map((item) => [item.id, item.name])),
    polityIds: new Map(world.polities.map((item) => [item.id, item.shortName || item.name])),
    regionIds: new Map(world.regions.map((item) => [item.id, item.name])),
    armyIds: new Map(world.armies.map((item) => [item.id, item.name])),
    fleetIds: new Map(world.fleets.map((item) => [item.id, item.name])),
  };
}

function participantGroups(
  participants: SituationParticipants,
  labels: Record<SituationParticipantGroupKey, ReadonlyMap<string, string>>,
): SituationSnapshotParticipantGroup[] {
  return (Object.keys(PARTICIPANT_GROUP_LABELS) as SituationParticipantGroupKey[])
    .flatMap((key) => {
      const ids = participants[key];
      if (ids.length === 0) return [];
      const fallback = PARTICIPANT_GROUP_LABELS[key].replace(/^相关/, '未载');
      return [{
        key,
        label: PARTICIPANT_GROUP_LABELS[key],
        entities: ids.map((id) => ({ id, label: labels[key].get(id) ?? fallback })),
      }];
    });
}

function evidenceSnapshot(signal: SituationSignal): SituationSnapshotEvidence {
  const refs = signal.refs.map(cloneRef);
  return {
    key: signal.key,
    label: SIGNAL_LABELS[signal.key] ?? SIGNAL_ROLE_LABELS[signal.role],
    role: signal.role,
    roleLabel: SIGNAL_ROLE_LABELS[signal.role],
    contribution: signal.contribution,
    refs,
    factIds: factIdsFromRefs(refs),
  };
}

function situationEvidence(signals: readonly SituationSignal[]): SituationSnapshotEvidence[] {
  const withRefs = signals.filter((signal) => signal.refs.length > 0);
  const withoutRefs = signals.filter((signal) => signal.refs.length === 0);
  return [...withRefs, ...withoutRefs]
    .slice(0, MAX_SNAPSHOT_SITUATION_EVIDENCE)
    .map(evidenceSnapshot);
}

function latestChangeSnapshot(changes: readonly SituationRecentChange[]): SituationSnapshotChange | null {
  const latest = changes.reduce<SituationRecentChange | null>((current, change) => (
    current === null || change.turn >= current.turn ? change : current
  ), null);
  return latest ? {
    turn: latest.turn,
    kind: latest.kind,
    label: CHANGE_LABELS[latest.kind],
    tension: latest.tension,
    fromPhase: latest.fromPhase,
    toPhase: latest.toPhase,
    sourceFactIds: [...latest.sourceFactIds],
  } : null;
}

function situationTitle(
  situation: SituationState,
  participants: readonly SituationSnapshotParticipantGroup[],
): string {
  const core = participants.find((group) => group.key === 'coreCharacterIds')?.entities[0]?.label;
  const polity = participants.find((group) => group.key === 'polityIds')?.entities[0]?.label;
  if (situation.type === 'military_power_crisis' && core && polity) {
    return `${core}与${polity}的军权危机`;
  }
  if (situation.type === 'inheritance_crisis' && polity) {
    return `${polity}的继承危机`;
  }
  return TYPE_LABELS[situation.type] ?? '未命名历史局势';
}

function situationItem(
  situation: SituationState,
  labels: Record<SituationParticipantGroupKey, ReadonlyMap<string, string>>,
): SituationSnapshotItem {
  const participants = participantGroups(situation.participants, labels);
  const nextRefs = situation.nextWatch.refs.map(cloneRef);
  return {
    id: situation.id,
    type: situation.type,
    typeLabel: TYPE_LABELS[situation.type] ?? '历史局势',
    title: situationTitle(situation, participants),
    status: situation.status,
    statusLabel: STATUS_LABELS[situation.status],
    phase: situation.phase,
    phaseLabel: PHASE_LABELS[situation.phase],
    tension: situation.tension,
    momentum: situation.momentum,
    startedTurn: situation.startedTurn,
    phaseSinceTurn: situation.phaseSinceTurn,
    lastUpdatedTurn: situation.lastUpdatedTurn,
    resolvedTurn: situation.resolvedTurn,
    causalFactIds: [...situation.causalFactIds],
    milestoneFactIds: [...situation.milestoneFactIds],
    participants,
    evidence: situationEvidence(situation.signals),
    latestChange: latestChangeSnapshot(situation.recentChanges),
    nextSignal: {
      key: situation.nextWatch.key,
      label: WATCH_SIGNAL_LABELS[situation.nextWatch.key] ?? '继续观察相关人物与局势变化',
      refs: nextRefs,
      factIds: factIdsFromRefs(nextRefs),
    },
  };
}

/**
 * Projects authoritative Situation state into a concise, detached observer payload.
 * It never reads Chronicle or observer settings and never retains world-owned arrays.
 */
export function projectSituationSystemSnapshot(
  situationSystem: WorldState['situationSystem'],
  world: SituationSnapshotLabelWorld,
): SituationSystemSnapshot {
  const labels = entityLabelMaps(world);
  const open = situationSystem.situations
    .filter((situation) => situation.status === 'open')
    .sort((left, right) => (
      PHASE_SORT_ORDER[left.phase] - PHASE_SORT_ORDER[right.phase]
      || right.importance - left.importance
      || right.tension - left.tension
      || left.startedTurn - right.startedTurn
      || stableCompare(left.id, right.id)
    ));
  const resolved = situationSystem.situations
    .filter((situation) => situation.status === 'resolved')
    .sort((left, right) => (
      (right.resolvedTurn ?? -1) - (left.resolvedTurn ?? -1)
      || right.lastUpdatedTurn - left.lastUpdatedTurn
      || stableCompare(left.id, right.id)
    ));

  return {
    version: 1,
    lastReducedTurn: situationSystem.lastReducedTurn,
    openCount: open.length,
    resolvedCount: situationSystem.archive.resolvedCount + resolved.length,
    archivedResolvedCount: situationSystem.archive.resolvedCount,
    open: open.slice(0, MAX_SNAPSHOT_OPEN_SITUATIONS).map((item) => situationItem(item, labels)),
    recentResolved: resolved
      .slice(0, MAX_SNAPSHOT_RECENT_RESOLVED_SITUATIONS)
      .map((item) => situationItem(item, labels)),
  };
}

/** Direct App/makeTextSnapshot integration seam. */
export function toSituationSnapshot(world: WorldState): SituationSystemSnapshot {
  return projectSituationSystemSnapshot(world.situationSystem, world);
}
