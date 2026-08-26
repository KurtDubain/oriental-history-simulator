import { emitSimulationFact, projectFactLinks, type SimulationFact } from '../facts';
import type { HistoryEvent, StateDelta, WorldState } from '../types';
import type { V03Emit, V03TurnContext } from '../v03-context';
import {
  buildMilitaryPowerCrisisIndex,
  MILITARY_POWER_CRISIS_TEMPLATE,
  militaryPowerCrisisDetector,
} from './military-power-crisis-detector';
import { attachSituationMilestoneFacts, reduceSituationTurn } from './reducer';
import type { SituationPhase, SituationState, SituationTransition } from './types';

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
  military_network_support: '军中网络',
  family_mobilization_capacity: '家族支撑',
};

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
  return situation.titleKey;
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
      summary: `${title}已连续两个季度维持结构性压力，并由真实军职或会战事实提供起点证据。`,
    };
  }
  if (transition.kind === 'resolved') {
    return {
      title: `${title}告一段落`,
      summary: `${title}以“${transition.outcomeKey ?? '矛盾消散'}”结案；此后不再参与季度更新。`,
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
  const leadingSignals = situation.signals
    .filter((signal) => signal.role === 'structural' || signal.role === 'trigger')
    .slice(0, 3);
  const fact = emitSimulationFact(world, context, {
    kind: 'situation_milestone',
    category: '政治',
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
          ? leadingSignals.map((signal) => `${SIGNAL_LABELS[signal.key] ?? signal.key}${signal.contribution >= 0 ? '+' : ''}${signal.contribution.toFixed(1)}`).join('；')
          : `当前张力${Math.round(situation.tension)}`,
      },
      {
        label: '生命周期规则',
        role: '结果',
        weight: 0.25,
        evidence: transition.kind === 'formed'
          ? '连续两季越过形成门槛'
          : transition.kind === 'resolved'
            ? `结案结果${transition.outcomeKey ?? 'dissipated'}`
            : `${transition.fromPhase ?? 'none'}→${transition.toPhase ?? 'none'}`,
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
    category: '政治',
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
      index: buildMilitaryPowerCrisisIndex(world),
      detectors: [militaryPowerCrisisDetector],
    },
    { templates: [MILITARY_POWER_CRISIS_TEMPLATE] },
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
