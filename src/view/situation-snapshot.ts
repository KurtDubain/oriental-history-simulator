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
  'characters' | 'families' | 'factions' | 'polities' | 'regions' | 'armies' | 'fleets' | 'wars'
>;

const TYPE_LABELS: Readonly<Record<string, string>> = {
  military_power_crisis: '军权危机',
  inheritance_crisis: '继承危机',
  war_progress: '战争进程',
  court_power_struggle: '朝堂权斗',
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
  military_network_support: '政治网络支持',
  family_mobilization_capacity: '家族可动员支撑',
  weak_family_base: '家族支撑有限',
  personal_caution: '谨慎抑制',
  actor_died: '军权主体死亡',
  command_removed: '军职已经解除',
  submission: '军权重新归于朝廷',
  appeased_or_promoted: '安抚或升任',
  recalled_or_reassigned: '召还或调任',
  order_refused: '拒绝军令',
  court_purge: '朝廷清洗',
  armed_breakaway: '拥兵自立',
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
  ongoing_war: '战争仍在持续',
  opposing_belligerents: '交战双方仍有国家载体',
  war_goal_and_duration: '战争目标与持续时间',
  recorded_war_score: '已记录的战果',
  recent_war_declaration: '近期宣战',
  recent_battles: '近期战役',
  recent_territory_changes: '近期领土控制变化',
  quiet_front: '近期战线平静',
  war_weariness: '战争疲劳积累',
  no_field_army: '缺少可持续作战军团',
  frontline_supply_strain: '前线补给承压',
  frontline_supply_ready: '前线补给尚可支撑',
  field_army_capacity: '双方仍有野战能力',
  critical_operational_evidence: '战事升级条件具备',
  attacker_advantage: '攻方以优势结束战争',
  defender_advantage: '守方以优势结束战争',
  negotiated_peace: '双方议和停战',
  attacker_destroyed: '攻方政权覆灭',
  defender_destroyed: '守方政权覆灭',
  attacker_dissolved: '攻方因继承断绝而解体',
  defender_dissolved: '守方因继承断绝而解体',
  challenger_central_office: '实掌中枢官席',
  challenger_regional_office: '地方任官根基',
  challenger_military_command: '手中军令',
  challenger_family_renown: '家门与人物声望',
  challenger_alliance_support: '盟约与背书',
  challenger_cohesion: '派内凝聚',
  challenger_power_margin: '与君主派系的实力差',
  weak_court_authority: '中央权威不足',
  strong_court_authority: '中央仍能节制百官',
  public_faction_rivalry: '与君主派系公开相争',
  recent_court_action: '本季朝堂行动',
  recent_faction_relation: '派系盟争生变',
  recent_power_resource_change: '官席、军令或支持变动',
  ruler_reasserted_control: '君主重掌朝局',
  factional_compromise: '双方暂成妥协',
  power_broker_fell: '权臣失势',
  palace_coup_succeeded: '宫变夺位已成',
};

export function situationTypeLabel(type: string): string {
  return TYPE_LABELS[type] ?? '历史局势';
}

export function situationStatusLabel(status: SituationStatus): string {
  return STATUS_LABELS[status];
}

export function situationPhaseLabel(phase: SituationPhase): string {
  return PHASE_LABELS[phase];
}

export function situationSignalLabel(key: string, role: SituationSignalRole): string {
  return SIGNAL_LABELS[key] ?? SIGNAL_ROLE_LABELS[role];
}

export function situationOutcomeLabel(key: string): string {
  return SIGNAL_LABELS[key] ?? '结构压力已经消散';
}

const WATCH_SIGNAL_LABELS: Readonly<Record<string, string>> = {
  watch_military_order_resolution: '观察军令会被履行、拒绝，还是随升迁而解除',
  watch_independent_command: '观察副将是否获得独立军令、积累新战功或与主帅失和',
  watch_recall_or_refusal: '观察朝廷是否召还、调任或安抚主帅，以及主帅是否服从',
  watch_command_and_army_support: '观察军职、战功、政治网络与家族支撑是否继续扩大',
  watch_command_succession: '观察军团由谁接掌，以及旧有军中与家族网络流向何处',
  watch_post_command_settlement: '观察解除军职后的安置、清洗、再任命或余部追随',
  watch_ruler_health_and_succession: '观察君主健康与可执行的继承安排',
  watch_heir_designation: '观察统治家族是否出现合法候选人',
  watch_claimant_support_balance: '观察候选人的家族、派系、官职与军方支持消长',
  watch_successor_states: '观察故国人物、家族、军队与领土的去向',
  watch_new_reign_consolidation: '观察新君能否重建合法性、中央权威与统治联盟',
  watch_next_engagement: '观察双方是否发生下一场战役，或有州域控制权转移',
  watch_frontline_supply: '观察低补给军团会撤退、溃散，还是仍能改变战线',
  watch_war_score_and_control: '观察下一场战役是否扩大战果差距并改变州域控制权',
  watch_postwar_absorption: '观察故国领土、军队、人物与家族如何进入新的政治秩序',
  watch_postwar_settlement: '观察停战边界、赔款与双方战争疲劳是否稳定',
  watch_court_power_resources: '观察下一次任免、军令、结盟或清洗，会把实权推向哪一方',
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
    label: situationSignalLabel(signal.key, signal.role),
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
  world: SituationSnapshotLabelWorld,
): string {
  const core = participants.find((group) => group.key === 'coreCharacterIds')?.entities[0]?.label;
  const polity = participants.find((group) => group.key === 'polityIds')?.entities[0]?.label;
  if (situation.type === 'military_power_crisis' && core && polity) {
    return `${core}与${polity}的军权危机`;
  }
  if (situation.type === 'inheritance_crisis' && polity) {
    return `${polity}的继承危机`;
  }
  if (situation.type === 'court_power_struggle' && polity) {
    return `${polity}的朝堂权斗`;
  }
  if (situation.type === 'war_progress') {
    const war = world.wars.find((item) => item.id === situation.scopeKey);
    if (!war) return '这场战争的进程';
    const polityLabels = new Map(world.polities.map((item) => [item.id, item.shortName || item.name]));
    const attacker = polityLabels.get(war.attackerId) ?? '未载攻方';
    const defender = polityLabels.get(war.defenderId) ?? '未载守方';
    return `${attacker}进攻${defender}的战争进程`;
  }
  return TYPE_LABELS[situation.type] ?? '未命名历史局势';
}

function situationItem(
  situation: SituationState,
  labels: Record<SituationParticipantGroupKey, ReadonlyMap<string, string>>,
  world: SituationSnapshotLabelWorld,
): SituationSnapshotItem {
  const participants = participantGroups(situation.participants, labels);
  const nextRefs = situation.nextWatch.refs.map(cloneRef);
  return {
    id: situation.id,
    type: situation.type,
    typeLabel: situationTypeLabel(situation.type),
    title: situationTitle(situation, participants, world),
    status: situation.status,
    statusLabel: situationStatusLabel(situation.status),
    phase: situation.phase,
    phaseLabel: situationPhaseLabel(situation.phase),
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

/** Projects one retained Situation without imposing the compact list caps. */
export function projectSituationSnapshotItem(
  situation: SituationState,
  world: SituationSnapshotLabelWorld,
): SituationSnapshotItem {
  return situationItem(situation, entityLabelMaps(world), world);
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
    open: open.slice(0, MAX_SNAPSHOT_OPEN_SITUATIONS).map((item) => situationItem(item, labels, world)),
    recentResolved: resolved
      .slice(0, MAX_SNAPSHOT_RECENT_RESOLVED_SITUATIONS)
      .map((item) => situationItem(item, labels, world)),
  };
}

/** Direct App/makeTextSnapshot integration seam. */
export function toSituationSnapshot(world: WorldState): SituationSystemSnapshot {
  return projectSituationSystemSnapshot(world.situationSystem, world);
}
