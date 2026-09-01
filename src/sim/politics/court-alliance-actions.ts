import type { FactTurnBuffer } from '../facts';
import { stableCompare } from '../random';
import type {
  CommitmentKind,
  CommitmentState,
  HistoryEvent,
  MemoryKind,
  SimulationFact,
  WorldState,
} from '../types';
import { changeFactionRelation, type EmitFactionChronicle } from './faction-lifecycle';
import { refreshFactionPowerLedgers } from './power-ledger';
import {
  COURT_ALLIANCE_COMBINED_COHESION_THRESHOLD,
  COURT_ALLIANCE_DURATION_TURNS,
  COURT_ALLIANCE_TARGET_COHESION_THRESHOLD,
  COURT_ALLIANCE_TERMS,
} from './court-alliance-contract';

export {
  COURT_ALLIANCE_COMBINED_COHESION_THRESHOLD,
  COURT_ALLIANCE_DURATION_TURNS,
  COURT_ALLIANCE_TARGET_COHESION_THRESHOLD,
  COURT_ALLIANCE_TERMS,
  MAX_COURT_ALLIANCE_ACTIONS_PER_POLITY,
} from './court-alliance-contract';

export interface CourtAllianceTurnContext extends FactTurnBuffer {
  events: HistoryEvent[];
}

/**
 * A fully resolved, exact domain target. Snapshot values are used only for
 * deterministic queue ordering; the resolver revalidates live identities and
 * eligibility before it mutates the world.
 */
export interface CourtAllianceCandidate {
  candidateId: string;
  turn: number;
  polityId: string;
  actorId: string;
  actorFactionId: string;
  targetId: string;
  targetFactionId: string;
  actorPower: number;
  targetPower: number;
  actorCohesion: number;
  targetCohesion: number;
}

export interface CourtAllianceActionEffects {
  createCommitment: (
    world: WorldState,
    kind: CommitmentKind,
    promisorId: string,
    promiseeId: string,
    polityIds: string[],
    terms: string,
    eventId: string,
    dueTurn: number | null,
    trustStake: number,
  ) => CommitmentState;
  remember: (
    world: WorldState,
    sourceId: string,
    targetId: string,
    kind: MemoryKind,
    impact: number,
    summary: string,
    eventId: string,
  ) => void;
}

export interface CourtAllianceResolution {
  outcome: 'formed' | 'invalidated';
  reasonCode: 'alliance_formed' | 'conditions_changed';
  score: number;
  threshold: number;
  candidate: CourtAllianceCandidate;
  fact: Extract<SimulationFact, { kind: 'faction_relation_changed' }> | null;
  event: HistoryEvent | null;
  commitment: CommitmentState | null;
}

function candidateForExactPair(
  world: WorldState,
  context: CourtAllianceTurnContext,
  actorFactionId: string,
  targetFactionId: string,
): CourtAllianceCandidate | null {
  if (
    context.season !== '冬'
    || world.turn !== context.turn
    || actorFactionId === targetFactionId
  ) return null;
  const actorFaction = world.factions.find((faction) => (
    faction.id === actorFactionId && faction.active && faction.memberIds.length > 0
  ));
  const targetFaction = world.factions.find((faction) => (
    faction.id === targetFactionId && faction.active && faction.memberIds.length > 0
  ));
  if (!actorFaction || !targetFaction || actorFaction.polityId !== targetFaction.polityId) return null;
  const polity = world.polities.find((item) => item.id === actorFaction.polityId && item.alive);
  if (!polity || !world.characters.some((character) => character.id === polity.rulerId && character.alive)) return null;
  const actor = world.characters.find((character) => character.id === actorFaction.leaderId && character.alive);
  const target = world.characters.find((character) => character.id === targetFaction.leaderId && character.alive);
  if (!actor || !target) return null;
  if (actorFaction.alliedFactionIds.includes(targetFaction.id)) return null;
  if (targetFaction.cohesion < COURT_ALLIANCE_TARGET_COHESION_THRESHOLD) return null;
  if (actorFaction.cohesion + targetFaction.cohesion < COURT_ALLIANCE_COMBINED_COHESION_THRESHOLD) return null;
  return {
    candidateId: `court-alliance:${context.turn}:${polity.id}:${actorFaction.id}:${targetFaction.id}`,
    turn: context.turn,
    polityId: polity.id,
    actorId: actor.id,
    actorFactionId: actorFaction.id,
    targetId: target.id,
    targetFactionId: targetFaction.id,
    actorPower: actorFaction.power,
    targetPower: targetFaction.power,
    actorCohesion: actorFaction.cohesion,
    targetCohesion: targetFaction.cohesion,
  };
}

/** Pure exact-target validation for callers that already hold both faction IDs. */
export function courtAllianceCandidateFor(
  world: WorldState,
  context: CourtAllianceTurnContext,
  actorFactionId: string,
  targetFactionId: string,
): CourtAllianceCandidate | null {
  return candidateForExactPair(world, context, actorFactionId, targetFactionId);
}

function activeFactionsByPower(world: WorldState, polityId: string) {
  return world.factions
    .filter((faction) => faction.active && faction.polityId === polityId && faction.memberIds.length > 0)
    .sort((left, right) => right.power - left.power || stableCompare(left.id, right.id));
}

/**
 * Pure autonomous discovery. It intentionally tests only the first otherwise
 * eligible partner of the dominant faction, matching the original winter
 * court loop instead of falling through to a later faction.
 */
export function discoverCourtAllianceCandidates(
  world: WorldState,
  context: CourtAllianceTurnContext,
  polityIds?: readonly string[],
): CourtAllianceCandidate[] {
  if (context.season !== '冬') return [];
  const includedPolityIds = polityIds ? new Set(polityIds) : null;
  const candidates: CourtAllianceCandidate[] = [];
  for (const polity of world.polities
    .filter((item) => item.alive && (!includedPolityIds || includedPolityIds.has(item.id)))
    .sort((left, right) => stableCompare(left.id, right.id))) {
    const candidate = autonomousCourtAllianceCandidateFor(world, context, polity.id);
    if (candidate) candidates.push(candidate);
  }
  return candidates.sort(compareCourtAllianceCandidates);
}

/** Pure one-polity AI candidate using the original dominant/first-partner rule. */
export function autonomousCourtAllianceCandidateFor(
  world: WorldState,
  context: CourtAllianceTurnContext,
  polityId: string,
): CourtAllianceCandidate | null {
  if (context.season !== '冬') return null;
  const polity = world.polities.find((item) => item.id === polityId && item.alive);
  if (!polity) return null;
  const factions = activeFactionsByPower(world, polity.id);
  const dominant = factions[0];
  if (!dominant || factions.length < 2) return null;
  const partner = factions.find((faction) => (
    faction.id !== dominant.id
    && !dominant.alliedFactionIds.includes(faction.id)
    && faction.cohesion >= COURT_ALLIANCE_TARGET_COHESION_THRESHOLD
  ));
  return partner ? candidateForExactPair(world, context, dominant.id, partner.id) : null;
}

/** Current polity order first; within one polity, preserve the old power/ID order. */
export function compareCourtAllianceCandidates(
  left: CourtAllianceCandidate,
  right: CourtAllianceCandidate,
): number {
  return stableCompare(left.polityId, right.polityId)
    || right.actorPower - left.actorPower
    || stableCompare(left.actorFactionId, right.actorFactionId)
    || right.targetPower - left.targetPower
    || stableCompare(left.targetFactionId, right.targetFactionId)
    || stableCompare(left.candidateId, right.candidateId);
}

/** Pure capacity gate: at most one court-alliance action may resolve per polity. */
export function buildCourtAllianceActionQueue<T extends CourtAllianceCandidate>(
  candidates: readonly T[],
): T[] {
  const selected: T[] = [];
  const occupiedPolityIds = new Set<string>();
  for (const candidate of [...candidates].sort(compareCourtAllianceCandidates)) {
    if (occupiedPolityIds.has(candidate.polityId)) continue;
    occupiedPolityIds.add(candidate.polityId);
    selected.push(candidate);
  }
  return selected;
}

/** The sole mutating court-alliance entry point. Invalid or stale candidates do nothing. */
export function resolveCourtAllianceAction(
  world: WorldState,
  context: CourtAllianceTurnContext,
  candidate: CourtAllianceCandidate,
  emit: EmitFactionChronicle,
  effects: CourtAllianceActionEffects,
): CourtAllianceResolution {
  const live = candidateForExactPair(
    world,
    context,
    candidate.actorFactionId,
    candidate.targetFactionId,
  );
  const score = (live?.actorCohesion ?? candidate.actorCohesion)
    + (live?.targetCohesion ?? candidate.targetCohesion);
  if (
    !live
    || candidate.turn !== context.turn
    || live.candidateId !== candidate.candidateId
    || live.polityId !== candidate.polityId
    || live.actorId !== candidate.actorId
    || live.targetId !== candidate.targetId
  ) {
    return {
      outcome: 'invalidated',
      reasonCode: 'conditions_changed',
      score,
      threshold: COURT_ALLIANCE_COMBINED_COHESION_THRESHOLD,
      candidate,
      fact: null,
      event: null,
      commitment: null,
    };
  }

  const relationFact = changeFactionRelation(
    world,
    context,
    live.actorFactionId,
    live.targetFactionId,
    'alliance',
    'formed',
    'court_support_exchange',
    emit,
  );
  if (!relationFact || relationFact.kind !== 'faction_relation_changed') {
    return {
      outcome: 'invalidated',
      reasonCode: 'conditions_changed',
      score,
      threshold: COURT_ALLIANCE_COMBINED_COHESION_THRESHOLD,
      candidate: live,
      fact: null,
      event: null,
      commitment: null,
    };
  }
  const event = [...context.events].reverse().find((item) => item.sourceFactIds.includes(relationFact.id)) ?? null;
  let commitment: CommitmentState | null = null;
  if (event) {
    commitment = effects.createCommitment(
      world,
      '政治联盟',
      live.actorId,
      live.targetId,
      [live.polityId],
      COURT_ALLIANCE_TERMS,
      event.id,
      context.turn + COURT_ALLIANCE_DURATION_TURNS,
      18,
    );
    effects.remember(world, live.actorId, live.targetId, '恩义', 10, event.summary, event.id);
    effects.remember(world, live.targetId, live.actorId, '恩义', 10, event.summary, event.id);
  }
  refreshFactionPowerLedgers(world, live.polityId);
  return {
    outcome: 'formed',
    reasonCode: 'alliance_formed',
    score,
    threshold: COURT_ALLIANCE_COMBINED_COHESION_THRESHOLD,
    candidate: live,
    fact: relationFact,
    event,
    commitment,
  };
}
