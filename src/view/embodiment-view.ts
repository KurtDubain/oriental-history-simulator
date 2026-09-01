import {
  EMBODIED_COURT_ACTION_KINDS,
  EMBODIED_LOCAL_GOVERNANCE_ACTION_KINDS,
  EMBODIED_MILITARY_ACTION_KINDS,
  projectCharacterEmbodiedActions,
  type EmbodiedActionCommand,
  type EmbodiedActionKind,
  type WorldState,
} from '../sim';
import type { EmbodimentClosure } from './embodiment-observer';

export interface PersonEmbodiedActionView {
  actionId: string;
  kind: EmbodiedActionKind;
  identityLabel?: string | null;
  label: string;
  targetLabel: string;
  intent: string;
  cost: string;
  obstacle: string;
  nextSignal: string;
  available: boolean;
  unavailableReason: string | null;
}

export interface PersonEmbodimentView {
  active: boolean;
  activeCharacterName: string | null;
  pending: {
    actorName: string;
    label: string;
    targetLabel: string;
  } | null;
  usedThisQuarter: boolean;
  actions: readonly PersonEmbodiedActionView[];
  lastResult: {
    periodLabel: string;
    outcome: 'succeeded' | 'deferred' | 'refused' | 'invalidated';
    summary: string;
    nextSignal: string;
    sourceEventId: string | null;
  } | null;
  closure: {
    reason: 'died' | 'missing';
    summary: string;
    highlights: readonly string[];
    sourceEventId: string | null;
  } | null;
}

export interface EmbodimentTextSnapshotView {
  actorId: string | null;
  actorName: string | null;
  usedThisQuarter: boolean;
  closure: {
    actorId: string;
    actorName: string;
    reason: 'died' | 'missing';
    summary: string;
    sourceEventId: string | null;
  } | null;
  pending: {
    actionId: string;
    actorId: string;
    label: string;
    targetLabel: string;
  } | null;
  actions: readonly Pick<
    PersonEmbodiedActionView,
    'actionId' | 'kind' | 'identityLabel' | 'label' | 'targetLabel' | 'available' | 'unavailableReason'
  >[];
}

function periodLabel(turn: number): string {
  const seasons = ['春', '夏', '秋', '冬'] as const;
  const safeTurn = Math.max(0, Math.floor(turn));
  return `第 ${Math.floor(safeTurn / 4) + 1} 年${seasons[safeTurn % 4]}`;
}

export function embodiedActionIdentityLabel(kind: EmbodiedActionKind): string | null {
  if (EMBODIED_MILITARY_ACTION_KINDS.includes(kind as (typeof EMBODIED_MILITARY_ACTION_KINDS)[number])) {
    return '副将行事';
  }
  if (EMBODIED_LOCAL_GOVERNANCE_ACTION_KINDS.includes(kind as (typeof EMBODIED_LOCAL_GOVERNANCE_ACTION_KINDS)[number])) {
    return '地方施政';
  }
  if (EMBODIED_COURT_ACTION_KINDS.includes(kind as (typeof EMBODIED_COURT_ACTION_KINDS)[number])) {
    return '朝臣议事';
  }
  return null;
}

function projectActionViews(world: WorldState, characterId: string): PersonEmbodiedActionView[] {
  return projectCharacterEmbodiedActions(world, characterId).map((item) => ({
    actionId: item.command.actionId,
    kind: item.command.kind,
    identityLabel: embodiedActionIdentityLabel(item.command.kind),
    label: item.label,
    targetLabel: item.targetLabel,
    intent: item.intent,
    cost: item.cost,
    obstacle: item.obstacle,
    nextSignal: item.nextSignal,
    available: item.available,
    unavailableReason: item.unavailableReason,
  }));
}

function projectPendingAction(
  world: WorldState,
  command: EmbodiedActionCommand | null,
): { actorName: string; label: string; targetLabel: string } | null {
  if (!command) return null;
  const actor = world.characters.find((item) => item.id === command.actorId);
  const option = projectCharacterEmbodiedActions(world, command.actorId)
    .find((item) => item.command.actionId === command.actionId);
  return {
    actorName: actor?.name ?? '原定人物',
    label: option?.label ?? '本季行动',
    targetLabel: option?.targetLabel ?? command.targetId,
  };
}

function usedEmbodiedActionThisQuarter(world: WorldState): boolean {
  return world.facts.some((fact) => fact.turn === world.turn && fact.kind === 'embodied_action_submitted');
}

export function projectPersonEmbodimentView(
  world: WorldState,
  characterId: string,
  activeCharacterId: string | null,
  pendingCommand: EmbodiedActionCommand | null,
  closure: EmbodimentClosure | null,
): PersonEmbodimentView {
  const activeCharacter = activeCharacterId
    ? world.characters.find((item) => item.id === activeCharacterId)
    : null;
  const lastResult = [...world.facts].reverse().find((fact): fact is Extract<WorldState['facts'][number], { kind: 'embodied_action_resolved' }> => (
    fact.kind === 'embodied_action_resolved' && fact.payload.actorId === characterId
  ));
  const resultEvent = lastResult
    ? [...world.history].reverse().find((event) => (
        event.sourceFactIds.includes(lastResult.id)
        || (Boolean(lastResult.payload.domainFactId)
          && event.sourceFactIds.includes(lastResult.payload.domainFactId as string))
      ))
    : null;

  return {
    active: activeCharacterId === characterId,
    activeCharacterName: activeCharacter?.name ?? null,
    pending: projectPendingAction(world, pendingCommand),
    usedThisQuarter: usedEmbodiedActionThisQuarter(world),
    actions: projectActionViews(world, characterId),
    lastResult: lastResult?.kind === 'embodied_action_resolved' ? {
      periodLabel: periodLabel(lastResult.turn),
      outcome: lastResult.payload.outcome,
      summary: lastResult.payload.resultSummary,
      nextSignal: lastResult.payload.nextSignal,
      sourceEventId: resultEvent?.id ?? null,
    } : null,
    closure: closure?.actorId === characterId ? {
      reason: closure.reason,
      summary: closure.summary,
      highlights: closure.highlights,
      sourceEventId: closure.sourceEventId,
    } : null,
  };
}

export function projectEmbodimentTextSnapshot(
  world: WorldState,
  activeCharacterId: string | null,
  pendingCommand: EmbodiedActionCommand | null,
  closure: EmbodimentClosure | null,
): EmbodimentTextSnapshotView {
  const actor = activeCharacterId
    ? world.characters.find((item) => item.id === activeCharacterId)
    : null;
  const pending = projectPendingAction(world, pendingCommand);
  const actions = actor?.alive ? projectActionViews(world, actor.id) : [];
  return {
    actorId: actor?.id ?? null,
    actorName: actor?.name ?? null,
    usedThisQuarter: usedEmbodiedActionThisQuarter(world),
    closure: closure ? {
      actorId: closure.actorId,
      actorName: closure.actorName,
      reason: closure.reason,
      summary: closure.summary,
      sourceEventId: closure.sourceEventId,
    } : null,
    pending: pendingCommand && pending ? {
      actionId: pendingCommand.actionId,
      actorId: pendingCommand.actorId,
      label: pending.label,
      targetLabel: pending.targetLabel,
    } : null,
    actions: actions.map((action) => ({
      actionId: action.actionId,
      kind: action.kind,
      identityLabel: action.identityLabel,
      label: action.label,
      targetLabel: action.targetLabel,
      available: action.available,
      unavailableReason: action.unavailableReason,
    })),
  };
}
