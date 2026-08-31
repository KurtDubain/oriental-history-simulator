import { emitSimulationFact, projectFactLinks, type SimulationFact } from '../facts';
import type { HistoryEvent, StateDelta, WorldState } from '../types';
import type { V03Emit, V03TurnContext } from '../v03-context';
import {
  buildMilitaryPowerCrisisIndex,
  MILITARY_POWER_CRISIS_TEMPLATE,
  MILITARY_POWER_CRISIS_TYPE,
  militaryPowerCrisisDetector,
} from './military-power-crisis-detector';
import {
  buildInheritanceCrisisIndex,
  INHERITANCE_CRISIS_TEMPLATE,
  INHERITANCE_CRISIS_TYPE,
  inheritanceCrisisDetector,
} from './inheritance-crisis-detector';
import {
  buildWarProgressIndex,
  WAR_PROGRESS_TEMPLATE,
  WAR_PROGRESS_TYPE,
  warProgressDetector,
} from './war-progress-detector';
import { attachSituationMilestoneFacts, reduceSituationTurn } from './reducer';
import type {
  SituationDetector,
  SituationPhase,
  SituationState,
  SituationTransition,
} from './types';

interface SituationRuntimeIndex {
  militaryPower: ReturnType<typeof buildMilitaryPowerCrisisIndex>;
  inheritance: ReturnType<typeof buildInheritanceCrisisIndex>;
  warProgress: ReturnType<typeof buildWarProgressIndex>;
}

const militaryPowerRuntimeDetector: SituationDetector<SituationRuntimeIndex> = {
  id: militaryPowerCrisisDetector.id,
  detect: ({ turn, facts, index }) => militaryPowerCrisisDetector.detect({
    turn,
    facts,
    index: index.militaryPower,
  }),
};

const inheritanceRuntimeDetector: SituationDetector<SituationRuntimeIndex> = {
  id: inheritanceCrisisDetector.id,
  detect: ({ turn, facts, index }) => inheritanceCrisisDetector.detect({
    turn,
    facts,
    index: index.inheritance,
  }),
};

const warProgressRuntimeDetector: SituationDetector<SituationRuntimeIndex> = {
  id: warProgressDetector.id,
  detect: ({ turn, facts, index }) => warProgressDetector.detect({
    turn,
    facts,
    index: index.warProgress,
  }),
};

const PHASE_LABEL: Record<SituationPhase, string> = {
  emerging: '萌芽',
  active: '发展',
  critical: '临界',
};

const SIGNAL_LABELS: Record<string, string> = {
  actual_army_command: '实际掌军',
  deputy_command_position: '副将军中位置',
  force_concentration: '军力集中',
  deputy_military_footing: '副将战功与资历',
  high_ambition: '权位野心',
  weak_loyalty: '忠诚松动',
  weak_central_authority: '中央权威不足',
  minister_ruler_relationship: '君臣关系紧张',
  ruler_court_relationship: '君臣关系紧张',
  ruler_court_relationship_unrecorded: '君臣关系尚无记录',
  court_suspicion: '朝廷猜忌',
  military_order_breached: '军令背约',
  recent_battle_record: '可核验战功',
  recent_command_granted: '新授军权',
  recent_command_removed: '削去军职',
  military_network_support: '政治网络',
  family_mobilization_capacity: '家族支撑',
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
};

const OUTCOME_LABELS: Readonly<Record<string, string>> = {
  dissipated: '结构压力消退',
  actor_died: '军权主体死亡',
  command_removed: '军职已被解除',
  lawful_succession: '合法继承完成',
  orderly_succession: '有序继承完成',
  regency: '监国秩序建立',
  regency_established: '监国秩序建立',
  factional_compromise: '派系协调完成',
  dynastic_usurpation: '异姓权力交接完成',
  dynasty_replaced: '王朝已被替代',
  palace_transfer: '宫廷内部权力交接',
  usurpation: '篡位成功',
  polity_extinguished: '政权灭亡',
  polity_destroyed: '政权被军事消灭',
  lineage_extinguished_and_absorbed: '王系断绝且故国被吸收',
  attacker_advantage: '攻方以优势结束战争',
  defender_advantage: '守方以优势结束战争',
  negotiated_peace: '双方议和停战',
  attacker_destroyed: '攻方政权覆灭',
  defender_destroyed: '守方政权覆灭',
  attacker_dissolved: '攻方因继承断绝而解体',
  defender_dissolved: '守方因继承断绝而解体',
};

function outcomeLabel(outcomeKey: string | null): string {
  return outcomeKey ? OUTCOME_LABELS[outcomeKey] ?? '局势已依事实结案' : '矛盾消散';
}

function characterName(world: WorldState, id: string): string {
  return world.characters.find((character) => character.id === id)?.name ?? id;
}

function polityName(world: WorldState, id: string): string {
  return world.polities.find((polity) => polity.id === id)?.name ?? id;
}

function situationTitle(world: WorldState, situation: SituationState): string {
  if (situation.type === 'military_power_crisis') {
    const actor = characterName(world, situation.participants.coreCharacterIds[0] ?? '未知将领');
    const polity = polityName(world, situation.participants.polityIds[0] ?? '未知政权');
    return `${actor}与${polity}的军权之争`;
  }
  if (situation.type === INHERITANCE_CRISIS_TYPE) {
    const polity = polityName(world, situation.participants.polityIds[0] ?? '未知政权');
    return `${polity}的继承之局`;
  }
  if (situation.type === WAR_PROGRESS_TYPE) {
    const war = world.wars.find((item) => item.id === situation.scopeKey);
    if (!war) return '这场战争的进程';
    return `${polityName(world, war.attackerId)}进攻${polityName(world, war.defenderId)}的战争进程`;
  }
  return '这场历史局势';
}

function formationSummary(title: string, type: string): string {
  if (type === MILITARY_POWER_CRISIS_TYPE) {
    return `${title}已连续两个季度维持结构性压力，并由真实军职或会战事实提供起点证据。`;
  }
  if (type === INHERITANCE_CRISIS_TYPE) {
    return `${title}已连续两个季度维持结构性压力，人物谱系与可追溯的任免、婚姻、参战或领土事实共同提供证据。`;
  }
  if (type === WAR_PROGRESS_TYPE) {
    return `${title}已连续两个季度维持结构性张力，并由开战、会战或领土控制变更事实提供可追溯的战争证据。`;
  }
  return `${title}已连续两个季度维持结构性压力，并由可核验的当季事实提供起点证据。`;
}

function situationCategory(situation: SituationState): HistoryEvent['category'] {
  return situation.type === WAR_PROGRESS_TYPE ? '军事' : '政治';
}

function transitionCopy(transition: SituationTransition): SituationTransition {
  return { ...transition, sourceFactIds: [...transition.sourceFactIds] };
}

function transitionDelta(transition: SituationTransition): StateDelta {
  if (transition.kind === 'formed') {
    return {
      entityType: 'situation',
      entityId: transition.situationId,
      field: 'status',
      before: null,
      after: 'open',
    };
  }
  if (transition.kind === 'resolved') {
    return {
      entityType: 'situation',
      entityId: transition.situationId,
      field: 'status',
      before: 'open',
      after: 'resolved',
    };
  }
  return {
    entityType: 'situation',
    entityId: transition.situationId,
    field: 'phase',
    before: transition.fromPhase,
    after: transition.toPhase,
  };
}

function transitionText(
  world: WorldState,
  situation: SituationState,
  transition: SituationTransition,
): { title: string; summary: string } {
  const title = situationTitle(world, situation);
  if (transition.kind === 'formed') {
    return {
      title: `${title}开始显形`,
      summary: formationSummary(title, situation.type),
    };
  }
  if (transition.kind === 'resolved') {
    return {
      title: `${title}告一段落`,
      summary: `${title}以“${outcomeLabel(transition.outcomeKey)}”结案；此后不再参与季度更新。`,
    };
  }
  const from = transition.fromPhase ? PHASE_LABEL[transition.fromPhase] : '未定';
  const to = transition.toPhase ? PHASE_LABEL[transition.toPhase] : '未定';
  return {
    title: `${title}转入${to}`,
    summary: `${title}由${from}转入${to}，当前张力${Math.round(situation.tension)}，动量${Math.round(situation.momentum)}。`,
  };
}

function milestoneImportance(transition: SituationTransition): 3 | 4 {
  return transition.kind === 'formed'
    || (transition.kind === 'phase_changed' && transition.toPhase !== 'critical')
    ? 3
    : 4;
}

function emitSituationMilestone(
  world: WorldState,
  context: V03TurnContext,
  emit: V03Emit,
  situation: SituationState,
  transition: SituationTransition,
): { fact: SimulationFact; event: HistoryEvent } {
  if (transition.sourceFactIds.length === 0) {
    throw new Error(`${transition.situationId} Situation milestone lacks causal Fact evidence`);
  }
  const text = transitionText(world, situation, transition);
  const category = situationCategory(situation);
  const leadingSignals = situation.signals
    .filter((signal) => signal.role === 'structural' || signal.role === 'trigger')
    .slice(0, 3);
  const fact = emitSimulationFact(world, context, {
    kind: 'situation_milestone',
    category,
    importance: milestoneImportance(transition),
    actorIds: [...situation.participants.coreCharacterIds],
    polityIds: [...situation.participants.polityIds],
    regionIds: [...situation.participants.regionIds],
    causes: [
      {
        label: '事实链',
        role: '触发',
        weight: 0.4,
        evidence: `引用${transition.sourceFactIds.join('、')}，局势不由史册文案或随机事件生成`,
      },
      {
        label: '结构压力',
        role: '结构',
        weight: 0.35,
        evidence: leadingSignals.length > 0
          ? leadingSignals.map((signal) => `${SIGNAL_LABELS[signal.key] ?? '其他结构信号'}${signal.contribution >= 0 ? '+' : ''}${signal.contribution.toFixed(1)}`).join('；')
          : `当前张力${Math.round(situation.tension)}`,
      },
      {
        label: '生命周期规则',
        role: '结果',
        weight: 0.25,
        evidence: transition.kind === 'formed'
          ? '连续两季越过形成门槛'
          : transition.kind === 'resolved'
            ? `结案结果：${outcomeLabel(transition.outcomeKey)}`
            : `${transition.fromPhase ? PHASE_LABEL[transition.fromPhase] : '未定'}→${transition.toPhase ? PHASE_LABEL[transition.toPhase] : '未定'}`,
      },
    ],
    stateDeltas: [transitionDelta(transition)],
    sourceFactIds: [...transition.sourceFactIds],
    payload: {
      situationId: situation.id,
      situationType: situation.type,
      transition: transition.kind,
      fromPhase: transition.fromPhase,
      toPhase: transition.toPhase,
      tension: situation.tension,
      momentum: situation.momentum,
      outcomeKey: transition.outcomeKey,
    },
  });
  const event = emit({
    category,
    kind: `situation_${transition.kind}`,
    title: text.title,
    summary: text.summary,
    // Phase-C will bind Situation milestones to explicit pause rules. Keeping
    // this projection at importance 3 prevents the old generic major-history
    // rule from silently becoming that feature early.
    importance: 3,
    actorIds: [...situation.participants.coreCharacterIds],
    polityIds: [...situation.participants.polityIds],
    regionIds: [...situation.participants.regionIds],
    causes: fact.causes,
    stateDeltas: fact.stateDeltas,
    ...projectFactLinks(fact, [situation.id]),
  });
  return { fact, event };
}

/**
 * End-of-quarter Situation listener. It receives only this quarter's buffered
 * domain Facts plus an explicit current-state index; Chronicle is never input.
 */
export function processSituationSystem(
  world: WorldState,
  context: V03TurnContext,
  emit: V03Emit,
): readonly SituationTransition[] {
  const domainFacts = [...context.facts];
  const result = reduceSituationTurn(
    world.situationSystem,
    {
      turn: context.turn,
      facts: domainFacts,
      index: {
        militaryPower: buildMilitaryPowerCrisisIndex(world),
        inheritance: buildInheritanceCrisisIndex(world),
        warProgress: buildWarProgressIndex(world),
      },
      detectors: [
        militaryPowerRuntimeDetector,
        inheritanceRuntimeDetector,
        warProgressRuntimeDetector,
      ],
    },
    {
      templates: [
        MILITARY_POWER_CRISIS_TEMPLATE,
        INHERITANCE_CRISIS_TEMPLATE,
        WAR_PROGRESS_TEMPLATE,
      ],
      maxOpenByType: {
        [MILITARY_POWER_CRISIS_TYPE]: 5,
        [INHERITANCE_CRISIS_TYPE]: 3,
        [WAR_PROGRESS_TYPE]: 4,
      },
    },
  );
  world.situationSystem = result.state;
  for (const rawTransition of result.transitions) {
    const transition = transitionCopy(rawTransition);
    const situation = world.situationSystem.situations.find((item) => item.id === transition.situationId);
    if (!situation) throw new Error(`Situation transition references unknown state ${transition.situationId}`);
    const { fact } = emitSituationMilestone(world, context, emit, situation, transition);
    world.situationSystem = attachSituationMilestoneFacts(
      world.situationSystem,
      [{
        situationId: situation.id,
        turn: context.turn,
        transitionKind: transition.kind,
        milestoneFactIds: [fact.id],
      }],
      context.facts,
    );
  }
  return result.transitions.map(transitionCopy);
}
