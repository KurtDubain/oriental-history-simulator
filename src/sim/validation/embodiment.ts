import type { InvariantViolation, SimulationFact } from '../types';

function violation(code: string, message: string, entityId?: string): InvariantViolation {
  return { code, message, ...(entityId ? { entityId } : {}) };
}

/**
 * Validates the authoritative player-action envelope emitted during one turn.
 * The domain resolver keeps ownership of outcomes; this boundary only verifies
 * submission/result pairing and the link to that resolver's Fact.
 */
export function validateRuntimeEmbodiedActions(
  appendedFacts: readonly SimulationFact[],
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const submissions = appendedFacts.filter(
    (fact): fact is Extract<SimulationFact, { kind: 'embodied_action_submitted' }> => fact.kind === 'embodied_action_submitted',
  );
  const resolutions = appendedFacts.filter(
    (fact): fact is Extract<SimulationFact, { kind: 'embodied_action_resolved' }> => fact.kind === 'embodied_action_resolved',
  );
  const factById = new Map(appendedFacts.map((fact) => [fact.id, fact]));

  if (submissions.length > 1) {
    violations.push(violation('runtime.embodied-action-limit', '同一季度只能登记一项入世行动'));
  }
  for (const submission of submissions) {
    const matches = resolutions.filter((resolution) => (
      resolution.payload.submissionFactId === submission.id
      && resolution.payload.actionId === submission.payload.actionId
      && resolution.payload.actorId === submission.payload.actorId
      && resolution.payload.source === 'player_embodied'
      && resolution.sourceFactIds[0] === submission.id
      && (resolution.payload.domainFactId == null
        ? resolution.sourceFactIds.length === 1
        : resolution.sourceFactIds.length === 2
          && resolution.sourceFactIds[1] === resolution.payload.domainFactId)
    ));
    if (matches.length !== 1) {
      violations.push(violation(
        'runtime.embodied-action-pair',
        `${submission.id}没有唯一且一致的入世行动结果`,
        submission.id,
      ));
    }
  }
  if (resolutions.some((resolution) => (
    !submissions.some((submission) => submission.id === resolution.payload.submissionFactId)
  ))) {
    violations.push(violation('runtime.embodied-action-orphan', '本季存在没有权威提交来源的入世行动结果'));
  }
  for (const resolution of resolutions) {
    if (!resolution.payload.domainFactId) continue;
    const domain = factById.get(resolution.payload.domainFactId);
    const matchingSupport = domain?.kind === 'agency_support_resolved'
      && domain.payload.actorId === resolution.payload.actorId
      && domain.payload.action === resolution.payload.action;
    const matchingIntent = domain?.kind === 'agency_intent_resolved'
      && domain.payload.actorId === resolution.payload.actorId
      && resolution.payload.action === 'request_independent_command';
    const matchingLocalGovernance = domain?.kind === 'local_governance_resolved'
      && domain.payload.actorId === resolution.payload.actorId
      && domain.payload.action === resolution.payload.action
      && domain.payload.regionId === resolution.payload.targetId;
    if (!matchingSupport && !matchingIntent && !matchingLocalGovernance) {
      violations.push(violation(
        'runtime.embodied-action-domain',
        `${resolution.id}没有链接同一人物与行动的领域裁决事实`,
        resolution.id,
      ));
    }
  }

  return violations;
}
