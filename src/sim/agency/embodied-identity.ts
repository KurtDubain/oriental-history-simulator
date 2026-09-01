export const EMBODIED_IDENTITY_ACTION_KINDS = [
  'cultivate_military_support',
  'request_backing',
  'request_independent_command',
  'open_granary',
  'reduce_levy',
  'form_court_alliance',
] as const;

export const EMBODIED_COURT_ACTION_KINDS = [
  'form_court_alliance',
] as const;

export type EmbodiedIdentityActionKind = (typeof EMBODIED_IDENTITY_ACTION_KINDS)[number];

type EmbodiedActionFactKind = EmbodiedIdentityActionKind
  | 'strengthen_relationship'
  | 'seek_opportunity'
  | 'declare_stance';
type EmbodiedActionTargetKind = 'character' | 'faction' | 'army' | 'region';
type EmbodiedActionStance = 'support' | 'oppose' | null;
type EmbodiedFactCategory = '世界' | '人口' | '经济' | '政治' | '军事' | '外交' | '海洋' | '疾病' | '知识' | '迁徙';

export interface EmbodiedCommandIdentity {
  actionId: string;
  issuedTurn: number;
  actorId: string;
  kind: string;
  targetKind: EmbodiedActionTargetKind;
  targetId: string;
  stance: EmbodiedActionStance;
}

export function createEmbodiedCommand<TKind extends string>(
  seed: string,
  turn: number,
  actorId: string,
  kind: TKind,
  targetKind: EmbodiedActionTargetKind,
  targetId: string,
  stance: EmbodiedActionStance = null,
): EmbodiedCommandIdentity & { kind: TKind } {
  return {
    actionId: `emb_${stableHash([seed, turn, actorId, kind, targetId, stance, 'embodied-action-v1']).slice(0, 14)}`,
    issuedTurn: turn,
    actorId,
    kind,
    targetKind,
    targetId,
    stance,
  };
}

interface EmbodiedIdentityCommand extends EmbodiedCommandIdentity {
  kind: EmbodiedActionFactKind;
}

interface EmbodiedIdentityProjectionView {
  targetLabel: string;
  intent: string;
  cost: string;
  nextSignal: string;
}

interface EmbodiedIdentityWorldView {
  characters: readonly {
    id: string;
    name: string;
    polityId: string | null;
    locationRegionId: string;
  }[];
  armies: readonly { id: string; regionId: string }[];
  regions: readonly { id: string; name: string }[];
}

interface EmbodiedIdentityDomainFact {
  id: string;
  category: EmbodiedFactCategory;
  importance: 1 | 2 | 3 | 4 | 5;
  actorIds: string[];
  polityIds: string[];
  regionIds: string[];
}

interface EmbodiedIdentityCause {
  label: string;
  weight: number;
  evidence: string;
  role?: '结构' | '条件' | '触发' | '选择' | '结果';
}

interface EmbodiedIdentitySubmittedPayload {
  actionId: string;
  issuedTurn: number;
  source: 'player_embodied';
  actorId: string;
  action: EmbodiedActionFactKind;
  targetKind: EmbodiedActionTargetKind;
  targetId: string;
  stance: EmbodiedActionStance;
}

export interface EmbodiedIdentitySubmittedFactInput {
  kind: 'embodied_action_submitted';
  category: '经济' | '政治' | '军事';
  importance: 1;
  actorIds: string[];
  polityIds: string[];
  regionIds: string[];
  causes: EmbodiedIdentityCause[];
  stateDeltas: [];
  sourceFactIds: string[];
  payload: EmbodiedIdentitySubmittedPayload;
}

export interface EmbodiedIdentityResolvedFactInput {
  kind: 'embodied_action_resolved';
  category: EmbodiedFactCategory;
  importance: 1 | 2 | 3 | 4 | 5;
  actorIds: string[];
  polityIds: string[];
  regionIds: string[];
  causes: EmbodiedIdentityCause[];
  stateDeltas: [];
  sourceFactIds: string[];
  payload: EmbodiedIdentitySubmittedPayload & {
    submissionFactId: string;
    domainFactId: string | null;
    targetLabel: string;
    outcome: 'succeeded' | 'deferred' | 'refused' | 'invalidated';
    reasonCode: 'conditions_changed' | 'accepted' | 'insufficient_support' | 'target_refused';
    score: number;
    threshold: number;
    cost: string;
    resultSummary: string;
    nextSignal: string;
  };
}

export interface EmbodiedIdentityResolutionInput {
  outcome: 'succeeded' | 'deferred' | 'refused' | 'invalidated';
  reasonCode: 'conditions_changed' | 'accepted' | 'insufficient_support' | 'target_refused';
  score: number;
  threshold: number;
  summary: string;
  domainFact: EmbodiedIdentityDomainFact | null;
}

export function embodiedCommandsMatch(left: EmbodiedCommandIdentity, right: EmbodiedCommandIdentity): boolean {
  return left.actionId === right.actionId
    && left.issuedTurn === right.issuedTurn
    && left.actorId === right.actorId
    && left.kind === right.kind
    && left.targetKind === right.targetKind
    && left.targetId === right.targetId
    && left.stance === right.stance;
}

export function isEmbodiedIdentityAction<TCommand extends EmbodiedCommandIdentity>(
  command: TCommand | null | undefined,
): command is TCommand & { kind: EmbodiedIdentityActionKind } {
  return Boolean(command && EMBODIED_IDENTITY_ACTION_KINDS.includes(
    command.kind as EmbodiedIdentityActionKind,
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

export function submitEmbodiedIdentityAction<TFact>(
  world: EmbodiedIdentityWorldView,
  command: EmbodiedIdentityCommand,
  option: EmbodiedIdentityProjectionView | null,
  emit: (input: EmbodiedIdentitySubmittedFactInput) => TFact,
): TFact {
  const actor = world.characters.find((item) => item.id === command.actorId);
  const army = world.armies.find((item) => item.id === command.targetId);
  const region = world.regions.find((item) => item.id === command.targetId);
  const localGovernance = command.kind === 'open_granary' || command.kind === 'reduce_levy';
  const courtAction = EMBODIED_COURT_ACTION_KINDS.includes(
    command.kind as (typeof EMBODIED_COURT_ACTION_KINDS)[number],
  );
  return emit({
    kind: 'embodied_action_submitted',
    category: localGovernance ? '经济' : courtAction ? '政治' : '军事',
    importance: 1,
    actorIds: actor ? [actor.id] : [],
    polityIds: actor?.polityId ? [actor.polityId] : [],
    regionIds: region ? [region.id] : army?.regionId ? [army.regionId] : actor?.locationRegionId ? [actor.locationRegionId] : [],
    causes: [
      {
        label: localGovernance ? '地方职权' : courtAction ? '朝臣议事' : '军中身份', role: '结构', weight: 0.3,
        evidence: actor
          ? localGovernance
            ? `${actor.name}正以地方长官身份治理${region?.name ?? '原任所'}`
            : courtAction
              ? `${actor.name}正以朝臣身份参与朝中议事`
              : `${actor.name}正处在独立统军的军职链上`
          : localGovernance
            ? '原定人物已经失去地方官职载体'
            : courtAction
              ? '原定人物已经失去朝中议事的身份载体'
              : '原定人物已经失去军职载体',
      },
      { label: '人物所求', role: '选择', weight: 0.45, evidence: option?.intent ?? `原定${localGovernance ? '地方' : courtAction ? '朝中' : '军中'}行动已经失去可核验条件` },
      {
        label: '同一裁决', role: '条件', weight: 0.25,
        evidence: localGovernance
          ? '此事与其他地方长官使用相同的职权、财政、压力与治理规则'
          : courtAction
            ? '此事与其他朝臣使用相同的派系、关系、权势与朝议规则'
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
  });
}

export function resolveEmbodiedIdentityEnvelope<TFact>(
  world: EmbodiedIdentityWorldView,
  command: EmbodiedIdentityCommand,
  option: EmbodiedIdentityProjectionView | null,
  submission: { id: string },
  result: EmbodiedIdentityResolutionInput,
  emit: (input: EmbodiedIdentityResolvedFactInput) => TFact,
): TFact {
  const actor = world.characters.find((item) => item.id === command.actorId);
  const domainFact = result.domainFact;
  const localGovernance = command.kind === 'open_granary' || command.kind === 'reduce_levy';
  const courtAction = EMBODIED_COURT_ACTION_KINDS.includes(
    command.kind as (typeof EMBODIED_COURT_ACTION_KINDS)[number],
  );
  return emit({
    kind: 'embodied_action_resolved',
    category: domainFact?.category ?? (localGovernance ? '经济' : courtAction ? '政治' : '军事'),
    importance: domainFact?.importance ?? 1,
    actorIds: domainFact?.actorIds ?? (actor ? [actor.id] : []),
    polityIds: domainFact?.polityIds ?? (actor?.polityId ? [actor.polityId] : []),
    regionIds: domainFact?.regionIds ?? (actor?.locationRegionId ? [actor.locationRegionId] : []),
    causes: [
      { label: '入世决定', role: '触发', weight: 0.25, evidence: option?.intent ?? `原定${localGovernance ? '地方' : courtAction ? '朝中' : '军中'}行动已经失去条件` },
      {
        label: localGovernance ? '地方裁决' : courtAction ? '朝中裁决' : '军中裁决', role: '选择', weight: 0.45,
        evidence: domainFact
          ? `沿用人物原本的${localGovernance ? '地方治理' : courtAction ? '朝中议事' : '支持或军令'}裁决，没有玩家加成与成功保证`
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
      nextSignal: option?.nextSignal ?? (localGovernance
        ? '观察任所压力与朝廷财力是否重新出现行动条件'
        : courtAction
          ? '观察朝中关系、派系与议事条件是否重新出现'
          : '观察此人的军职与支持条件是否重新出现'),
    },
  });
}
import { stableHash } from '../random';
