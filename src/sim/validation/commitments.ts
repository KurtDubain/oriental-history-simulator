import {
  firstPoliticalAllianceEndFact,
  politicalAllianceFormationFact,
  politicalAllianceRelationIsActive,
} from '../politics/faction-commitments';
import type { InvariantViolation, WorldState } from '../types';

function issue(code: string, message: string, entityId?: string): InvariantViolation {
  return { code, message, ...(entityId ? { entityId } : {}) };
}

export function validateCommitmentState(world: WorldState): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const eventById = new Map(world.history.map((event) => [event.id, event]));
  const characterById = new Map(world.characters.map((character) => [character.id, character]));
  const polityById = new Map(world.polities.map((polity) => [polity.id, polity]));
  const legacyFactBoundaryTurn = Math.max(
    world.legacyArchiveBoundary?.turn ?? -1,
    world.legacyFactionFactBoundaryTurn ?? -1,
  );
  if (world.legacyFactionFactBoundaryTurn !== null && (
    !Number.isSafeInteger(world.legacyFactionFactBoundaryTurn)
    || world.legacyFactionFactBoundaryTurn < 0
    || world.legacyFactionFactBoundaryTurn > world.turn
  )) {
    violations.push(issue(
      'commitment.faction-legacy-boundary',
      '旧派系事实边界季度无效',
    ));
  }

  for (const commitment of world.commitments) {
    if (!eventById.has(commitment.eventId)) violations.push(issue('commitment.event', `${commitment.id}建立事件不可追溯`, commitment.id));
    if (!characterById.has(commitment.promisorId) || !characterById.has(commitment.promiseeId)) violations.push(issue('commitment.characters', `${commitment.id}承诺人物引用无效`, commitment.id));
    if (commitment.polityIds.some((id) => !polityById.has(id))) violations.push(issue('commitment.polities', `${commitment.id}承诺政权引用无效`, commitment.id));
    if (commitment.status === '生效') {
      if (commitment.resolvedTurn !== null || commitment.resolutionEventId !== null) violations.push(issue('commitment.active', `${commitment.id}生效状态却已有结案`, commitment.id));
    } else if (commitment.resolvedTurn === null || !commitment.resolutionEventId || !eventById.has(commitment.resolutionEventId)) {
      violations.push(issue('commitment.resolution', `${commitment.id}结案不可追溯`, commitment.id));
    } else if (
      (commitment.status === '履约' || commitment.status === '背约')
      && world.turn - commitment.resolvedTurn < 32
    ) {
      const expectedMemory = commitment.status === '履约' ? '恩义' : '背叛';
      const hasResolutionMemory = world.relationships.some((relationship) => relationship.memories.some((memory) => (
        memory.eventId === commitment.resolutionEventId && memory.kind === expectedMemory
      )));
      if (!hasResolutionMemory) violations.push(issue('commitment.memory', `${commitment.id}${commitment.status}没有对应关系记忆`, commitment.id));
    }
    if (commitment.kind !== '政治联盟') continue;

    const formationFact = politicalAllianceFormationFact(world, commitment);
    if (!formationFact) {
      if (commitment.madeTurn > legacyFactBoundaryTurn) {
        violations.push(issue('commitment.faction-alliance-source', `${commitment.id}没有可追溯的派系联盟建立Fact`, commitment.id));
      }
      continue;
    }
    const endingFact = firstPoliticalAllianceEndFact(world, formationFact);
    if (commitment.status === '生效' && (
      endingFact !== null || !politicalAllianceRelationIsActive(world, formationFact)
    )) {
      violations.push(issue('commitment.faction-alliance-active', `${commitment.id}仍生效但对应派系联盟已经终止`, commitment.id));
    }
    if (
      endingFact
      && (commitment.status === '履约' || commitment.status === '背约')
      && commitment.resolvedTurn !== null
      && endingFact.turn < commitment.resolvedTurn
    ) {
      violations.push(issue('commitment.faction-alliance-outcome', `${commitment.id}在派系联盟终止后被判为${commitment.status}`, commitment.id));
    }
    if (endingFact && commitment.status === '失效') {
      const resolutionEvent = commitment.resolutionEventId
        ? eventById.get(commitment.resolutionEventId)
        : undefined;
      if (
        commitment.resolvedTurn === null
        || commitment.resolvedTurn < endingFact.turn
        || resolutionEvent?.turn !== commitment.resolvedTurn
        || !resolutionEvent?.sourceFactIds.includes(endingFact.id)
      ) {
        violations.push(issue('commitment.faction-alliance-resolution', `${commitment.id}失效结案没有直接引用联盟终止Fact`, commitment.id));
      }
    }
  }

  return violations;
}
