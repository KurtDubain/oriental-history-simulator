import { emitSimulationFact, type FactTurnBuffer } from '../facts';
import type {
  CourtActionKind,
  CourtActionResolvedFact,
} from '../facts/types';
import type { EventCause, StateDelta, WorldState } from '../types';

export const POWER_BROKER_FORMATION_THRESHOLD = 66;

export interface CourtActionResolvedInput {
  action: CourtActionKind;
  polityId: string;
  actorFactionId: string | null;
  targetFactionId: string | null;
  initiatorId: string;
  targetId: string;
  reasonCode: string;
  score: number;
  threshold: number;
  rulerBeforeId: string;
  rulerAfterId: string;
  affectedFactionIds?: readonly string[];
  removedMemberIds?: readonly string[];
  importance: 3 | 4 | 5;
  causes: readonly EventCause[];
  stateDeltas: readonly StateDelta[];
  sourceFactIds?: readonly string[];
}

function stableCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * The sole typed Fact boundary for legacy court actions. Mutations remain in
 * their owning political systems; this records who acted, why the action
 * qualified, and the concrete state changes that the Situation layer may cite.
 */
export function emitCourtActionResolvedFact(
  world: WorldState,
  context: FactTurnBuffer,
  input: CourtActionResolvedInput,
): CourtActionResolvedFact {
  const capitalRegionId = world.polities.find((polity) => polity.id === input.polityId)?.capitalRegionId ?? null;
  return emitSimulationFact(world, context, {
    kind: 'court_action_resolved',
    category: '政治',
    importance: input.importance,
    actorIds: [input.initiatorId, input.targetId],
    polityIds: [input.polityId],
    regionIds: capitalRegionId ? [capitalRegionId] : [],
    causes: input.causes.map((cause) => ({
      ...cause,
      ...(cause.refs ? { refs: cause.refs.map((reference) => ({ ...reference })) } : {}),
    })),
    stateDeltas: input.stateDeltas.map((delta) => ({ ...delta })),
    sourceFactIds: [...(input.sourceFactIds ?? [])],
    payload: {
      action: input.action,
      polityId: input.polityId,
      actorFactionId: input.actorFactionId,
      targetFactionId: input.targetFactionId,
      initiatorId: input.initiatorId,
      targetId: input.targetId,
      reasonCode: input.reasonCode,
      score: input.score,
      threshold: input.threshold,
      rulerBeforeId: input.rulerBeforeId,
      rulerAfterId: input.rulerAfterId,
      affectedFactionIds: [...new Set(input.affectedFactionIds ?? [input.actorFactionId, input.targetFactionId])]
        .filter((id): id is string => Boolean(id))
        .sort(stableCompare),
      removedMemberIds: [...new Set(input.removedMemberIds ?? [])].sort(stableCompare),
    },
  }) as CourtActionResolvedFact;
}
