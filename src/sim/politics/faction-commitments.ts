import type { CommitmentState, SimulationFact, WorldState } from '../types';

export type FactionRelationChangedFact = Extract<SimulationFact, { kind: 'faction_relation_changed' }>;

function sameFactionPair(
  leftFactionId: string,
  rightFactionId: string,
  otherLeftFactionId: string,
  otherRightFactionId: string,
): boolean {
  return (leftFactionId === otherLeftFactionId && rightFactionId === otherRightFactionId)
    || (leftFactionId === otherRightFactionId && rightFactionId === otherLeftFactionId);
}

/**
 * Political promises are owned by the concrete faction alliance Fact that
 * created their chronicle event. Character or polity membership can change
 * later, so matching by the original leaders alone would attach the promise
 * to the wrong political relation after a succession or conquest.
 */
export function politicalAllianceFormationFact(
  world: Pick<WorldState, 'facts' | 'history'>,
  commitment: CommitmentState,
): FactionRelationChangedFact | null {
  if (commitment.kind !== '政治联盟') return null;
  const creationEvent = world.history.find((event) => event.id === commitment.eventId);
  if (!creationEvent) return null;
  const actorPair = new Set([commitment.promisorId, commitment.promiseeId]);
  for (const factId of creationEvent.sourceFactIds) {
    const fact = world.facts.find((candidate) => candidate.id === factId);
    if (
      fact?.kind === 'faction_relation_changed'
      && fact.payload.relation === 'alliance'
      && fact.payload.action === 'formed'
      && fact.turn === commitment.madeTurn
      && commitment.polityIds.includes(fact.payload.polityId)
      && actorPair.has(fact.payload.leftLeaderId)
      && actorPair.has(fact.payload.rightLeaderId)
    ) return fact;
  }
  return null;
}

export function factionAllianceEndMatchesFormation(
  ending: FactionRelationChangedFact,
  formation: FactionRelationChangedFact,
): boolean {
  return ending.payload.relation === 'alliance'
    && ending.payload.action === 'ended'
    && (
      ending.turn > formation.turn
      || (ending.turn === formation.turn && ending.id > formation.id)
    )
    && sameFactionPair(
      ending.payload.leftFactionId,
      ending.payload.rightFactionId,
      formation.payload.leftFactionId,
      formation.payload.rightFactionId,
    );
}

export function firstPoliticalAllianceEndFact(
  world: Pick<WorldState, 'facts'>,
  formation: FactionRelationChangedFact,
): FactionRelationChangedFact | null {
  return world.facts
    .filter((fact): fact is FactionRelationChangedFact => (
      fact.kind === 'faction_relation_changed'
      && factionAllianceEndMatchesFormation(fact, formation)
    ))
    .sort((left, right) => left.turn - right.turn || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))[0] ?? null;
}

export function politicalAllianceRelationIsActive(
  world: Pick<WorldState, 'factions'>,
  formation: FactionRelationChangedFact,
): boolean {
  const left = world.factions.find((faction) => faction.id === formation.payload.leftFactionId);
  const right = world.factions.find((faction) => faction.id === formation.payload.rightFactionId);
  return Boolean(
    left?.active
    && right?.active
    && left.polityId === right.polityId
    && left.alliedFactionIds.includes(right.id)
    && right.alliedFactionIds.includes(left.id),
  );
}

/**
 * Pre-POL02 schema-4 saves have no typed relation Fact to own an existing
 * political promise. At that authenticated boundary, the narrowest reliable
 * evidence is that the two original promise characters still belong to two
 * distinct, active, mutually allied factions in the promised polity.
 */
export function legacyPoliticalAllianceRelationIsActive(
  world: Pick<WorldState, 'characters' | 'factions'>,
  commitment: CommitmentState,
): boolean {
  if (commitment.kind !== '政治联盟') return false;
  const promisor = world.characters.find((character) => character.id === commitment.promisorId);
  const promisee = world.characters.find((character) => character.id === commitment.promiseeId);
  if (!promisor?.factionId || !promisee?.factionId || promisor.factionId === promisee.factionId) return false;
  const left = world.factions.find((faction) => faction.id === promisor.factionId);
  const right = world.factions.find((faction) => faction.id === promisee.factionId);
  return Boolean(
    left?.active
    && right?.active
    && left.polityId === right.polityId
    && commitment.polityIds.includes(left.polityId)
    && left.alliedFactionIds.includes(right.id)
    && right.alliedFactionIds.includes(left.id),
  );
}
