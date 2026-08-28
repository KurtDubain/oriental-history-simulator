import {
  emitSimulationFact,
  type AgencySupportActionKind,
  type AgencySupportTargetKind,
  type FactTurnBuffer,
} from '../facts';
import type { SimulationFact, WorldState } from '../types';
import {
  createEmbodiedActionCommand,
  EMBODIED_IDENTITY_ACTION_KINDS,
  EMBODIED_MILITARY_ACTION_KINDS,
  type EmbodiedActionCommand,
  type EmbodiedActionProjection,
} from './embodiment';

export interface MilitaryEmbodimentActorState {
  characterId: string;
  goal: { status: string; targetArmyId: string };
  plan: {
    status: string;
    steps: readonly { action: string; evidence: string }[];
  };
  nextEligibleSupportTurn: number;
}

export interface MilitaryEmbodimentSupportAction {
  actorId: string;
  action: AgencySupportActionKind;
  targetArmyId: string;
  targetKind: AgencySupportTargetKind;
  targetId: string;
}

export interface MilitaryEmbodimentIntent {
  actorId: string;
  targetArmyId: string;
}

export interface EmbodiedMilitaryActionCandidate<
  TSupport extends MilitaryEmbodimentSupportAction,
  TIntent extends MilitaryEmbodimentIntent,
> {
  projection: EmbodiedActionProjection;
  supportAction: TSupport | null;
  intent: TIntent | null;
}

export interface EmbodiedIdentityResolutionInput {
  outcome: 'succeeded' | 'deferred' | 'refused' | 'invalidated';
  reasonCode: 'conditions_changed' | 'accepted' | 'insufficient_support' | 'target_refused';
  score: number;
  threshold: number;
  summary: string;
  domainFact: SimulationFact | null;
}

function directedTrust(world: WorldState, sourceId: string, targetId: string): number {
  return world.relationships.find((item) => (
    item.sourceId === sourceId && item.targetId === targetId
  ))?.trust ?? 0;
}

function supportActionCopy(
  world: WorldState,
  action: MilitaryEmbodimentSupportAction,
): Omit<EmbodiedActionProjection, 'command' | 'available' | 'unavailableReason'> {
  const army = world.armies.find((item) => item.id === action.targetArmyId);
  const target = world.characters.find((item) => item.id === action.targetId);
  const armyLabel = army?.name ?? '本军';
  if (action.action === 'cultivate_military_support') {
    return {
      label: '联络本军将校',
      targetLabel: `${armyLabel}将校`,
      intent: `亲自巡营联络${armyLabel}将校，为日后独当一面争取军中支持。`,
      cost: '本季心力与至多 1 点私产',
      obstacle: `将校会衡量其战功、统率、名望与${armyLabel}当前军心`,
      nextSignal: `观察${armyLabel}将校是响应、观望还是拒绝`,
    };
  }
  const relationLabel = action.targetKind === 'family_head'
    ? '家主'
    : action.targetKind === 'ruler'
      ? '主君'
      : '主帅';
  return {
    label: `请${relationLabel}背书`,
    targetLabel: target?.name ?? relationLabel,
    intent: `向${target?.name ?? relationLabel}说明独立统军之志，请其为日后的军令请求明确背书。`,
    cost: '本季人情与双方关系',
    obstacle: `${target?.name ?? relationLabel}目前对其信任为${target ? directedTrust(world, target.id, action.actorId) : 0}，也会衡量忠诚与军功`,
    nextSignal: `观察${target?.name ?? relationLabel}是答应相助、留待后议还是拒绝`,
  };
}

/** Builds the one military role action from already-authoritative Agency candidates. */
export function projectEmbodiedMilitaryAction<
  TSupport extends MilitaryEmbodimentSupportAction,
  TIntent extends MilitaryEmbodimentIntent,
>(
  world: WorldState,
  actorState: MilitaryEmbodimentActorState,
  supportAction: TSupport | null,
  intent: TIntent | null,
): EmbodiedMilitaryActionCandidate<TSupport, TIntent> | null {
  if (actorState.goal.status !== 'active' || actorState.plan.status !== 'active') return null;
  const actor = world.characters.find((item) => item.id === actorState.characterId && item.alive);
  const army = world.armies.find((item) => item.id === actorState.goal.targetArmyId);
  if (!actor || !army || army.deputyCommanderId !== actor.id) return null;
  if (intent) {
    return {
      projection: {
        command: createEmbodiedActionCommand(world, actor.id, 'request_independent_command', 'army', army.id),
        label: '请领独立军令',
        targetLabel: army.name,
        intent: `正式向朝廷请求接掌${army.name}，由军令审查决定是否换帅。`,
        cost: '押上本季军中声望与朝廷信任',
        obstacle: '朝廷将同时审查职位、履历、明确支持、风险，并与本季其他军令请求一并裁定',
        nextSignal: `观察朝廷是授下${army.name}军令、暂缓、安抚还是削权`,
        available: true,
        unavailableReason: null,
      },
      supportAction: null,
      intent,
    };
  }
  if (supportAction) {
    return {
      projection: {
        command: createEmbodiedActionCommand(
          world,
          actor.id,
          supportAction.action,
          supportAction.targetKind === 'army_officers' ? 'army' : 'character',
          supportAction.targetId,
        ),
        ...supportActionCopy(world, supportAction),
        available: true,
        unavailableReason: null,
      },
      supportAction,
      intent: null,
    };
  }
  const request = actorState.plan.steps.find((step) => step.action === 'request_independent_command');
  const retry = actorState.nextEligibleSupportTurn > world.turn
    ? `上一次争取支持后，需等到第${actorState.nextEligibleSupportTurn}回合再行动`
    : request?.evidence ?? '军功、支持或职位条件仍不足';
  return {
    projection: {
      command: createEmbodiedActionCommand(world, actor.id, 'request_independent_command', 'army', army.id),
      label: '筹措独立军令',
      targetLabel: army.name,
      intent: `继续为接掌${army.name}准备履历、军中支持与上位者背书。`,
      cost: '本季尚无可提交的具体行动',
      obstacle: retry,
      nextSignal: `观察${army.name}军功、支持与朝廷受理条件是否出现缺口`,
      available: false,
      unavailableReason: retry,
    },
    supportAction: null,
    intent: null,
  };
}

export function embodiedCommandsMatch(left: EmbodiedActionCommand, right: EmbodiedActionCommand): boolean {
  return left.actionId === right.actionId
    && left.issuedTurn === right.issuedTurn
    && left.actorId === right.actorId
    && left.kind === right.kind
    && left.targetKind === right.targetKind
    && left.targetId === right.targetId
    && left.stance === right.stance;
}

export function isEmbodiedIdentityAction(
  command: EmbodiedActionCommand | null | undefined,
): command is EmbodiedActionCommand {
  return Boolean(command && EMBODIED_IDENTITY_ACTION_KINDS.includes(
    command.kind as (typeof EMBODIED_IDENTITY_ACTION_KINDS)[number],
  ));
}

export function isEmbodiedMilitaryAction(
  command: EmbodiedActionCommand | null | undefined,
): command is EmbodiedActionCommand & { kind: (typeof EMBODIED_MILITARY_ACTION_KINDS)[number] } {
  return Boolean(command && EMBODIED_MILITARY_ACTION_KINDS.includes(
    command.kind as (typeof EMBODIED_MILITARY_ACTION_KINDS)[number],
  ));
}

export function mergeEmbodiedQueueCandidate<T extends { actorId: string }>(
  autonomous: readonly T[],
  player: T | null,
  maximum: number,
  compare: (left: T, right: T) => number,
): { items: T[]; playerAccepted: boolean } {
  const candidates = player
    ? [...autonomous.filter((item) => item.actorId !== player.actorId), player]
    : [...autonomous];
  const items = candidates.sort(compare).slice(0, maximum);
  return { items, playerAccepted: !player || items.includes(player) };
}

export function submitEmbodiedIdentityAction(
  world: WorldState,
  context: FactTurnBuffer,
  command: EmbodiedActionCommand,
  option: EmbodiedActionProjection | null,
): Extract<SimulationFact, { kind: 'embodied_action_submitted' }> {
  const actor = world.characters.find((item) => item.id === command.actorId);
  const army = world.armies.find((item) => item.id === command.targetId);
  const region = world.regions.find((item) => item.id === command.targetId);
  const localGovernance = command.kind === 'open_granary' || command.kind === 'reduce_levy';
  return emitSimulationFact(world, context, {
    kind: 'embodied_action_submitted',
    category: localGovernance ? '经济' : '军事',
    importance: 1,
    actorIds: actor ? [actor.id] : [],
    polityIds: actor?.polityId ? [actor.polityId] : [],
    regionIds: region ? [region.id] : army?.regionId ? [army.regionId] : actor?.locationRegionId ? [actor.locationRegionId] : [],
    causes: [
      {
        label: localGovernance ? '地方职权' : '军中身份', role: '结构', weight: 0.3,
        evidence: actor
          ? localGovernance ? `${actor.name}正以地方长官身份治理${region?.name ?? '原任所'}` : `${actor.name}正处在独立统军的军职链上`
          : localGovernance ? '原定人物已经失去地方官职载体' : '原定人物已经失去军职载体',
      },
      { label: '人物所求', role: '选择', weight: 0.45, evidence: option?.intent ?? `原定${localGovernance ? '地方' : '军中'}行动已经失去可核验条件` },
      {
        label: '同一裁决', role: '条件', weight: 0.25,
        evidence: localGovernance
          ? '此事与其他地方长官使用相同的职权、财政、压力与治理规则'
          : '此事与其他人物使用相同的军职、关系、资源、风险与冷却规则',
      },
    ],
    stateDeltas: [],
    sourceFactIds: [],
    payload: {
      actionId: command.actionId,
      issuedTurn: command.issuedTurn,
      source: 'player_embodied',
      actorId: command.actorId,
      action: command.kind,
      targetKind: command.targetKind,
      targetId: command.targetId,
      stance: command.stance,
    },
  }) as Extract<SimulationFact, { kind: 'embodied_action_submitted' }>;
}

export function resolveEmbodiedIdentityEnvelope(
  world: WorldState,
  context: FactTurnBuffer,
  command: EmbodiedActionCommand,
  option: EmbodiedActionProjection | null,
  submission: Extract<SimulationFact, { kind: 'embodied_action_submitted' }>,
  result: EmbodiedIdentityResolutionInput,
): Extract<SimulationFact, { kind: 'embodied_action_resolved' }> {
  const actor = world.characters.find((item) => item.id === command.actorId);
  const domainFact = result.domainFact;
  const localGovernance = command.kind === 'open_granary' || command.kind === 'reduce_levy';
  return emitSimulationFact(world, context, {
    kind: 'embodied_action_resolved',
    category: domainFact?.category ?? (localGovernance ? '经济' : '军事'),
    importance: domainFact?.importance ?? 1,
    actorIds: domainFact?.actorIds ?? (actor ? [actor.id] : []),
    polityIds: domainFact?.polityIds ?? (actor?.polityId ? [actor.polityId] : []),
    regionIds: domainFact?.regionIds ?? (actor?.locationRegionId ? [actor.locationRegionId] : []),
    causes: [
      { label: '入世决定', role: '触发', weight: 0.25, evidence: option?.intent ?? `原定${localGovernance ? '地方' : '军中'}行动已经失去条件` },
      {
        label: localGovernance ? '地方裁决' : '军中裁决', role: '选择', weight: 0.45,
        evidence: domainFact
          ? `沿用人物原本的${localGovernance ? '地方治理' : '支持或军令'}裁决，没有玩家加成与成功保证`
          : '行动条件或本季受理名额已经变化',
      },
      { label: '实际结果', role: '结果', weight: 0.3, evidence: result.summary },
    ],
    stateDeltas: [],
    sourceFactIds: [submission.id, ...(domainFact ? [domainFact.id] : [])],
    payload: {
      actionId: command.actionId,
      issuedTurn: command.issuedTurn,
      source: 'player_embodied',
      actorId: command.actorId,
      action: command.kind,
      targetKind: command.targetKind,
      targetId: command.targetId,
      stance: command.stance,
      submissionFactId: submission.id,
      domainFactId: domainFact?.id ?? null,
      targetLabel: option?.targetLabel ?? command.targetId,
      outcome: result.outcome,
      reasonCode: result.reasonCode,
      score: result.score,
      threshold: result.threshold,
      cost: option?.cost ?? '没有实际支出',
      resultSummary: result.summary,
      nextSignal: option?.nextSignal ?? (localGovernance ? '观察任所压力与朝廷财力是否重新出现行动条件' : '观察此人的军职与支持条件是否重新出现'),
    },
  }) as Extract<SimulationFact, { kind: 'embodied_action_resolved' }>;
}
