import { computeWorldHash, getDateForTurn } from './engine';
import { stableCompare, stableHash } from './random';
import { validateSituationSystemState } from './situations/reducer';
import { reducePersonalMemorySystem, validateAgencySystemState } from './agency/memory';
import {
  MAX_AGENCY_DECISION_ACTORS,
  MAX_AGENCY_GOAL_SOURCE_FACTS,
  MAX_AGENCY_INTENT_ATTEMPTS,
  MAX_AGENCY_INTENTS_PER_TURN,
  MAX_AGENCY_SUPPORT_ACTIONS,
  validateAgencyDecisionSystemState,
} from './agency/decision';
import type { SituationRecentChange } from './situations/types';
import type { HistoryEvent, InvariantViolation, SimulationFact, WorldState } from './types';

export type RuntimeEntityKind =
  | 'region'
  | 'route'
  | 'seaZone'
  | 'seaLane'
  | 'portLink'
  | 'port'
  | 'polity'
  | 'character'
  | 'army'
  | 'fleet'
  | 'war'
  | 'family'
  | 'relationship'
  | 'faction'
  | 'diplomacy'
  | 'office'
  | 'backgroundPerson'
  | 'commitment'
  | 'tradeCorridor'
  | 'navalOperation'
  | 'shipbuildingProject'
  | 'pathogen'
  | 'infection'
  | 'practice'
  | 'practiceState'
  | 'situation';

/**
 * Describes an append-only digest without exposing or scanning its archive.
 * The Fact layer can pass its current-quarter buffer here once it lands.
 */
export interface RuntimeAppendOnlyChainArtifact {
  label?: string;
  previousDigest: string;
  nextDigest: string;
  appendedItems: readonly unknown[];
}

/**
 * Optional data emitted by a detailed turn result. Runtime validation remains
 * usable before that result exists, which keeps the App integration incremental.
 */
export interface RuntimeTurnArtifacts {
  changedEntityIds?: Readonly<Partial<Record<RuntimeEntityKind, readonly string[]>>>;
  factChain?: RuntimeAppendOnlyChainArtifact;
}

const RUNTIME_ENTITY_KIND_SET = new Set<RuntimeEntityKind>([
  'region',
  'route',
  'seaZone',
  'seaLane',
  'portLink',
  'port',
  'polity',
  'character',
  'army',
  'fleet',
  'war',
  'family',
  'relationship',
  'faction',
  'diplomacy',
  'office',
  'backgroundPerson',
  'commitment',
  'tradeCorridor',
  'navalOperation',
  'shipbuildingProject',
  'pathogen',
  'infection',
  'practice',
  'practiceState',
  'situation',
]);

export interface ValidationMeasurement {
  mode: 'runtime' | 'full';
  durationMs: number;
  violations: InvariantViolation[];
}

function duplicateIds(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort(stableCompare);
}

function push(
  violations: InvariantViolation[],
  code: string,
  message: string,
  entityId?: string,
): void {
  violations.push({ code, message, ...(entityId ? { entityId } : {}) });
}

function isWholeNonNegative(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isFiniteRange(value: number, minimum: number, maximum: number): boolean {
  return Number.isFinite(value) && value >= minimum && value <= maximum;
}

function numericIdSuffix(id: string): number {
  const match = id.match(/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function runtimeTotalPopulation(world: WorldState): number {
  return world.regions.reduce((sum, region) => sum + region.population, 0)
    + world.armies.reduce((sum, army) => sum + army.soldiers, 0)
    + world.fleets.reduce((sum, fleet) => sum + fleet.sailors, 0);
}

function runtimeTotalFood(world: WorldState): number {
  return world.regions.reduce((sum, region) => sum + region.food, 0)
    + world.armies.reduce((sum, army) => sum + army.food, 0)
    + world.fleets.reduce((sum, fleet) => sum + fleet.food, 0)
    + world.navalOperations
      .filter((operation) => operation.stage !== '完成' && operation.stage !== '失败')
      .reduce((sum, operation) => sum + operation.foodLoaded, 0);
}

function runtimeTotalWealth(world: WorldState): number {
  return world.regions.reduce((sum, region) => sum + region.wealth, 0)
    + world.polities.reduce((sum, polity) => sum + polity.treasury, 0);
}

function extendAppendOnlyDigest(digest: string, item: unknown): string {
  return digest.length === 0 ? stableHash(item) : stableHash([digest, item]);
}

function sameOrderedStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function normalizedFactEntityIds(values: readonly string[]): string[] {
  return [...new Set(values)].sort(stableCompare);
}

function warEndRolesAreConsistent(
  fact: Extract<SimulationFact, { kind: 'war_ended' }>,
): boolean {
  const { attackerId, defenderId, result, winnerId, loserId } = fact.payload;
  if (result === 'attacker_advantage') return winnerId === attackerId && loserId === defenderId;
  if (result === 'defender_advantage') return winnerId === defenderId && loserId === attackerId;
  if (result === 'negotiated_peace') return winnerId === null && loserId === null;
  if (result === 'attacker_destroyed' || result === 'attacker_dissolved') {
    return loserId === attackerId && (winnerId === null || winnerId === defenderId);
  }
  return loserId === defenderId && (winnerId === null || winnerId === attackerId);
}

function milestoneMatchesSituationChange(
  fact: SimulationFact,
  situationId: string,
  change: SituationRecentChange,
): boolean {
  if (fact.kind !== 'situation_milestone' || change.kind === 'participants_changed') return false;
  return fact.turn === change.turn
    && fact.payload.situationId === situationId
    && fact.payload.transition === change.kind
    && fact.payload.fromPhase === change.fromPhase
    && fact.payload.toPhase === change.toPhase;
}

type AgencyIntentSubmittedFact = Extract<SimulationFact, { kind: 'agency_intent_submitted' }>;
type AgencyIntentResolvedFact = Extract<SimulationFact, { kind: 'agency_intent_resolved' }>;
type AgencyAppointmentFact = Extract<
  SimulationFact,
  { kind: 'appointment_started' | 'appointment_ended' }
>;

const AGENCY_CHECK_CONTRACT = {
  permission: { threshold: 100, comparison: 'at_least' },
  resource: { threshold: 34, comparison: 'at_least' },
  relationship: { threshold: 40, comparison: 'at_least' },
  risk: { threshold: 55, comparison: 'at_most' },
} as const;

function sourceFactMentionsDeputy(
  fact: SimulationFact | undefined,
  actorId: string,
  armyId: string,
): boolean {
  if (!fact) return false;
  if (fact.kind === 'battle') {
    return [fact.payload.attacker, ...fact.payload.defenders].some((force) => (
      force.armyId === armyId && force.deputyCommanderId === actorId
    ));
  }
  if (fact.kind === 'appointment_started' || fact.kind === 'appointment_ended') {
    return fact.payload.holderId === actorId && fact.payload.armyId === armyId;
  }
  if (fact.kind === 'agency_support_resolved') {
    return fact.payload.actorId === actorId && fact.payload.targetArmyId === armyId;
  }
  return false;
}

function agencyResolutionDeltasAreExact(fact: AgencyIntentResolvedFact): boolean {
  const payload = fact.payload;
  if (payload.institutionResponse === 'appeased') {
    if (payload.outcome !== 'rejected' || payload.reasonCode !== 'claim_weaker' || fact.stateDeltas.length !== 2) return false;
    const influence = fact.stateDeltas.find((delta) => delta.entityType === 'character' && delta.entityId === payload.actorId && delta.field === 'influence');
    const loyalty = fact.stateDeltas.find((delta) => delta.entityType === 'character' && delta.entityId === payload.actorId && delta.field === 'loyalty');
    return typeof influence?.before === 'number' && typeof influence.after === 'number' && influence.after >= influence.before
      && typeof loyalty?.before === 'number' && typeof loyalty.after === 'number' && loyalty.after >= loyalty.before;
  }
  if (payload.institutionResponse === 'curbed') {
    if (payload.outcome !== 'rejected' || payload.reasonCode !== 'court_risk' || fact.stateDeltas.length !== 3) return false;
    const deputy = fact.stateDeltas.find((delta) => delta.entityType === 'army' && delta.entityId === payload.targetArmyId && delta.field === 'deputyCommanderId');
    const influence = fact.stateDeltas.find((delta) => delta.entityType === 'character' && delta.entityId === payload.actorId && delta.field === 'influence');
    const insubordination = fact.stateDeltas.find((delta) => delta.entityType === 'character' && delta.entityId === payload.actorId && delta.field === 'insubordination');
    return deputy?.before === payload.actorId && deputy.after === null
      && typeof influence?.before === 'number' && typeof influence.after === 'number' && influence.after <= influence.before
      && typeof insubordination?.before === 'number' && typeof insubordination.after === 'number' && insubordination.after >= insubordination.before;
  }
  if (payload.outcome !== 'executed') return payload.institutionResponse === 'none' && fact.stateDeltas.length === 0;
  if (payload.institutionResponse !== 'command_granted') return false;
  return stableHash(fact.stateDeltas) === stableHash([
    {
      entityType: 'army',
      entityId: payload.targetArmyId,
      field: 'commanderId',
      before: payload.previousCommanderId,
      after: payload.actorId,
    },
    {
      entityType: 'army',
      entityId: payload.targetArmyId,
      field: 'deputyCommanderId',
      before: payload.actorId,
      after: payload.previousCommanderId,
    },
    {
      entityType: 'character',
      entityId: payload.actorId,
      field: 'commandingArmyId',
      before: null,
      after: payload.targetArmyId,
    },
    {
      entityType: 'character',
      entityId: payload.previousCommanderId,
      field: 'commandingArmyId',
      before: payload.targetArmyId,
      after: null,
    },
  ]);
}

function agencyCommandChronicleDeltasAreValid(
  event: HistoryEvent,
  resolution: AgencyIntentResolvedFact,
  commitmentById: ReadonlyMap<string, WorldState['commitments'][number]>,
): boolean {
  if (resolution.payload.outcome !== 'executed') {
    return stableHash(event.stateDeltas) === stableHash(resolution.stateDeltas);
  }
  const unmatched = event.stateDeltas.map((delta) => ({ delta, matched: false }));
  for (const expected of resolution.stateDeltas) {
    const match = unmatched.find((candidate) => (
      !candidate.matched && stableHash(candidate.delta) === stableHash(expected)
    ));
    if (!match) return false;
    match.matched = true;
  }
  return unmatched.filter((candidate) => !candidate.matched).every(({ delta }) => {
    if (delta.entityType !== 'commitment'
      || delta.field !== 'status'
      || delta.before !== '生效'
      || delta.after !== '失效') return false;
    const commitment = commitmentById.get(delta.entityId);
    return commitment?.kind === '军令'
      && commitment.promisorId === resolution.payload.actorId
      && commitment.promiseeId === resolution.payload.previousCommanderId
      && commitment.status === '失效'
      && commitment.resolvedTurn === resolution.turn
      && commitment.resolutionEventId === event.id;
  });
}

function agencyResolutionReasonIsCoherent(fact: AgencyIntentResolvedFact): boolean {
  const payload = fact.payload;
  const checks = new Map(payload.checks.map((check) => [check.kind, check]));
  const permission = checks.get('permission')?.passed === true;
  const resource = checks.get('resource')?.passed === true;
  const relationship = checks.get('relationship')?.passed === true;
  const risk = checks.get('risk')?.passed === true;
  if (payload.outcome === 'invalidated' && payload.reasonCode === 'permission_lost') return !permission && payload.institutionResponse === 'none';
  if (payload.outcome === 'deferred' && payload.reasonCode === 'insufficient_record') {
    return permission && !resource && payload.institutionResponse === 'none';
  }
  if (payload.outcome === 'deferred' && payload.reasonCode === 'insufficient_support') {
    return permission && resource && !relationship && payload.institutionResponse === 'none';
  }
  if (payload.outcome === 'deferred' && payload.reasonCode === 'competing_request') {
    return permission && resource && relationship && payload.institutionResponse === 'none';
  }
  if (payload.outcome === 'rejected' && payload.reasonCode === 'court_risk') {
    return permission && resource && relationship && !risk
      && (payload.institutionResponse === 'curbed' || payload.institutionResponse === 'none');
  }
  if (payload.outcome === 'rejected' && payload.reasonCode === 'claim_weaker') {
    return permission && resource && relationship && risk && payload.decisionScore < payload.decisionThreshold
      && (payload.institutionResponse === 'appeased' || payload.institutionResponse === 'none');
  }
  return payload.outcome === 'executed'
    && payload.reasonCode === 'command_granted'
    && permission
    && resource
    && relationship
    && risk
    && payload.institutionResponse === 'command_granted'
    && payload.decisionScore >= payload.decisionThreshold;
}

function validateAgencyDecisionStateFromReferences(
  world: WorldState,
  getFactById: (factId: string) => SimulationFact | undefined,
): readonly string[] {
  const boundedActors = world.agencyDecisionSystem.actors.slice(0, MAX_AGENCY_DECISION_ACTORS + 1);
  const referenceFactIds = new Set<string>();
  for (const actor of boundedActors) {
    for (const factId of actor.goal.sourceFactIds.slice(0, MAX_AGENCY_GOAL_SOURCE_FACTS + 1)) {
      referenceFactIds.add(factId);
    }
    if (actor.lastResolutionFactId) referenceFactIds.add(actor.lastResolutionFactId);
    for (const action of actor.supportActions.slice(0, MAX_AGENCY_SUPPORT_ACTIONS + 1)) {
      referenceFactIds.add(action.sourceFactId);
    }
  }
  const referencedFacts: SimulationFact[] = [];
  for (const factId of referenceFactIds) {
    const fact = getFactById(factId);
    if (fact) referencedFacts.push(fact);
  }
  return validateAgencyDecisionSystemState({
    ...world,
    facts: referencedFacts,
    agencyDecisionSystem: {
      ...world.agencyDecisionSystem,
      actors: boundedActors,
    },
  });
}

interface AgencyIntentArchiveValidationOptions {
  codePrefix: 'runtime' | 'fact';
  facts: readonly SimulationFact[];
  getFactById: (factId: string) => SimulationFact | undefined;
  events: readonly HistoryEvent[];
  world: WorldState;
  requireEveryPromotionOwned: boolean;
  enforceCurrentSnapshot: boolean;
}

/**
 * Validates the authoritative C10/C11 intent transaction. The projection and
 * Chronicle are deliberately absent from the decision inputs: submitted Fact,
 * resolved Fact, exact state deltas and appointment Facts form the ownership
 * chain.
 */
function validateAgencyIntentArchive(
  options: AgencyIntentArchiveValidationOptions,
  violations: InvariantViolation[],
): void {
  const {
    codePrefix,
    facts,
    getFactById,
    events,
    world,
    requireEveryPromotionOwned,
    enforceCurrentSnapshot,
  } = options;
  const code = (suffix: string): string => `${codePrefix}.agency-intent-${suffix}`;
  const submissions: AgencyIntentSubmittedFact[] = [];
  const resolutions: AgencyIntentResolvedFact[] = [];
  const appointmentsBySourceFactId = new Map<string, AgencyAppointmentFact[]>();
  for (const fact of facts) {
    if (fact.kind === 'agency_intent_submitted') submissions.push(fact);
    else if (fact.kind === 'agency_intent_resolved') resolutions.push(fact);
    if (fact.kind !== 'appointment_started' && fact.kind !== 'appointment_ended') continue;
    for (const sourceFactId of fact.sourceFactIds) {
      const linked = appointmentsBySourceFactId.get(sourceFactId) ?? [];
      linked.push(fact);
      appointmentsBySourceFactId.set(sourceFactId, linked);
    }
  }
  const eventsBySourceFactId = new Map<string, HistoryEvent[]>();
  const promotionEvents: HistoryEvent[] = [];
  for (const event of events) {
    if (event.kind === 'deputy_promoted') promotionEvents.push(event);
    for (const sourceFactId of event.sourceFactIds) {
      const linked = eventsBySourceFactId.get(sourceFactId) ?? [];
      linked.push(event);
      eventsBySourceFactId.set(sourceFactId, linked);
    }
  }
  const officesByRoleKey = new Map<string, WorldState['offices']>();
  for (const office of world.offices) {
    const key = `${office.armyId ?? ''}\u0000${office.holderId}\u0000${office.kind}`;
    const linked = officesByRoleKey.get(key) ?? [];
    linked.push(office);
    officesByRoleKey.set(key, linked);
  }
  const commitmentById = new Map(world.commitments.map((commitment) => [commitment.id, commitment]));
  const resolutionsBySubmission = new Map<string, AgencyIntentResolvedFact[]>();
  const executedByTurnAndPolity = new Map<string, AgencyIntentResolvedFact[]>();
  const earliestExecutedFactNumberByTurnAndPolity = new Map<string, number>();
  for (const resolution of resolutions) {
    const linked = resolutionsBySubmission.get(resolution.payload.submissionFactId) ?? [];
    linked.push(resolution);
    resolutionsBySubmission.set(resolution.payload.submissionFactId, linked);
    if (resolution.payload.outcome !== 'executed') continue;
    const key = `${resolution.turn}:${resolution.payload.polityId}`;
    const cohort = executedByTurnAndPolity.get(key) ?? [];
    cohort.push(resolution);
    executedByTurnAndPolity.set(key, cohort);
    earliestExecutedFactNumberByTurnAndPolity.set(
      key,
      Math.min(
        earliestExecutedFactNumberByTurnAndPolity.get(key) ?? Number.POSITIVE_INFINITY,
        numericIdSuffix(resolution.id),
      ),
    );
  }
  const submissionsByTurn = new Map<number, AgencyIntentSubmittedFact[]>();
  for (const submission of submissions) {
    const turnSubmissions = submissionsByTurn.get(submission.turn) ?? [];
    turnSubmissions.push(submission);
    submissionsByTurn.set(submission.turn, turnSubmissions);
  }
  for (const [turn, turnSubmissions] of submissionsByTurn) {
    if (turnSubmissions.length > MAX_AGENCY_INTENTS_PER_TURN) {
      push(
        violations,
        code('limit'),
        `第${turn}回合提交${turnSubmissions.length}项人物意图，超过上限${MAX_AGENCY_INTENTS_PER_TURN}`,
      );
    }
    for (const actorId of duplicateIds(turnSubmissions.map((fact) => fact.payload.actorId))) {
      push(violations, code('actor-duplicate'), `第${turn}回合人物${actorId}重复提交意图`, actorId);
    }
    for (const armyId of duplicateIds(turnSubmissions.map((fact) => fact.payload.targetArmyId))) {
      push(violations, code('target-duplicate'), `第${turn}回合军团${armyId}收到重复独立军令请求`, armyId);
    }
  }

  for (const submission of submissions) {
    const payload = submission.payload;
    const exactActors = normalizedFactEntityIds([
      payload.actorId,
      payload.currentCommanderId,
      payload.appointingAuthorityId,
    ]);
    const shapeValid = payload.goalType === 'secure_independent_command'
      && payload.action === 'request_independent_command'
      && payload.actorId.length > 0
      && payload.goalId.length > 0
      && payload.planId.length > 0
      && payload.planStepId.length > 0
      && payload.targetArmyId.length > 0
      && payload.polityId.length > 0
      && payload.currentCommanderId.length > 0
      && payload.appointingAuthorityId.length > 0
      && Number.isSafeInteger(payload.goalCreatedTurn)
      && payload.goalCreatedTurn >= 0
      && payload.goalCreatedTurn <= submission.turn
      && Number.isSafeInteger(payload.attemptOrdinal)
      && payload.attemptOrdinal >= 1
      && payload.attemptOrdinal <= MAX_AGENCY_INTENT_ATTEMPTS
      && sameOrderedStrings(submission.actorIds, exactActors)
      && sameOrderedStrings(submission.polityIds, normalizedFactEntityIds([payload.polityId]))
      && submission.stateDeltas.length === 0
      && submission.sourceFactIds.length > 0;
    if (!shapeValid) {
      push(violations, code('submission-shape'), `${submission.id}的提交载荷或参与者不符合契约`, submission.id);
    }
    if (submission.sourceFactIds.some((sourceId) => {
      const source = getFactById(sourceId);
      return !source
        || source.turn < payload.goalCreatedTurn
        || !sourceFactMentionsDeputy(source, payload.actorId, payload.targetArmyId);
    })) {
      push(violations, code('submission-evidence'), `${submission.id}含有不属于该副将目标的履历事实`, submission.id);
    }
    const linkedResolutions = resolutionsBySubmission.get(submission.id) ?? [];
    if (linkedResolutions.length !== 1) {
      push(
        violations,
        code('pair'),
        `${submission.id}应恰有一个同季裁决，实际${linkedResolutions.length}`,
        submission.id,
      );
    }
  }

  for (const resolution of resolutions) {
    const payload = resolution.payload;
    const submission = getFactById(payload.submissionFactId);
    if (!submission || submission.kind !== 'agency_intent_submitted' || submission.turn !== resolution.turn) {
      push(violations, code('orphan-resolution'), `${resolution.id}没有同季权威提交`, resolution.id);
      continue;
    }
    const submitted = submission.payload;
    const identityValid = payload.actorId === submitted.actorId
      && payload.goalId === submitted.goalId
      && payload.planId === submitted.planId
      && payload.planStepId === submitted.planStepId
      && payload.action === submitted.action
      && payload.attemptOrdinal === submitted.attemptOrdinal
      && payload.targetArmyId === submitted.targetArmyId
      && payload.polityId === submitted.polityId
      && payload.previousCommanderId === submitted.currentCommanderId
      && payload.appointingAuthorityId === submitted.appointingAuthorityId
      && sameOrderedStrings(resolution.actorIds, normalizedFactEntityIds([
        payload.actorId,
        payload.previousCommanderId,
        payload.appointingAuthorityId,
      ]))
      && sameOrderedStrings(resolution.polityIds, normalizedFactEntityIds([payload.polityId]))
      && sameOrderedStrings(resolution.sourceFactIds, [submission.id]);
    if (!identityValid) {
      push(violations, code('identity'), `${resolution.id}与提交${submission.id}的身份字段不一致`, resolution.id);
    }
    const checkKinds = payload.checks.map((check) => check.kind);
    const checksValid = payload.checks.length === 4
      && duplicateIds(checkKinds).length === 0
      && (Object.keys(AGENCY_CHECK_CONTRACT) as Array<keyof typeof AGENCY_CHECK_CONTRACT>)
        .every((kind) => {
          const actual = payload.checks.find((check) => check.kind === kind);
          const expected = AGENCY_CHECK_CONTRACT[kind];
          if (!actual) return false;
          return Number.isFinite(actual.value)
            && actual.value >= 0
            && actual.value <= 100
            && actual.threshold === expected.threshold
            && actual.comparison === expected.comparison
            && actual.passed === (
              actual.comparison === 'at_least'
                ? actual.value >= actual.threshold
                : actual.value <= actual.threshold
            );
        });
    if (!checksValid) {
      push(violations, code('checks'), `${resolution.id}的资格、资源、关系或风险检查无效`, resolution.id);
    }
    const retryValid = payload.outcome === 'executed' || payload.outcome === 'invalidated' || payload.institutionResponse === 'curbed'
      ? payload.retryAfterTurn === null
      : payload.retryAfterTurn === resolution.turn + (payload.outcome === 'deferred' ? 4 : 8);
    if (!Number.isSafeInteger(payload.decisionScore)
      || !Number.isSafeInteger(payload.decisionThreshold)
      || payload.decisionThreshold <= 0
      || !retryValid
      || !agencyResolutionReasonIsCoherent(resolution)) {
      push(violations, code('outcome'), `${resolution.id}的裁决结果、理由或再议时间不一致`, resolution.id);
    }
    if (!agencyResolutionDeltasAreExact(resolution)) {
      push(violations, code('deltas'), `${resolution.id}没有记录唯一且完整的统军权转换`, resolution.id);
    }

    const expectedEventKind = payload.outcome === 'executed'
      ? 'deputy_promoted'
      : payload.institutionResponse === 'curbed'
        ? 'command_request_curbed'
        : payload.institutionResponse === 'appeased'
          ? 'command_request_appeased'
      : payload.outcome === 'deferred'
        ? 'command_request_deferred'
        : payload.outcome === 'rejected'
          ? 'command_request_rejected'
          : 'command_request_invalidated';
    const matchingEvents = (eventsBySourceFactId.get(resolution.id) ?? []).filter((event) => (
      event.kind === expectedEventKind
      && event.turn === resolution.turn
      && sameOrderedStrings(event.sourceFactIds, [submission.id, resolution.id])
      && agencyCommandChronicleDeltasAreValid(event, resolution, commitmentById)
    ));
    if (matchingEvents.length !== 1) {
      push(violations, code('chronicle'), `${resolution.id}没有唯一且一致的史册投影`, resolution.id);
    }

    if (payload.outcome === 'executed') {
      const requiredAppointments = [
        ['appointment_ended', '军团副将', payload.actorId],
        ['appointment_started', '军团主帅', payload.actorId],
        ['appointment_started', '军团副将', payload.previousCommanderId],
      ] as const;
      const linkedAppointments = (appointmentsBySourceFactId.get(resolution.id) ?? [])
        .filter((fact) => fact.payload.armyId === payload.targetArmyId);
      // The appointment synchronizer may also close a stale commander office
      // discovered in this pass. Require the three transitions implied by the
      // authoritative role swap, while allowing those additional repairs to
      // retain the same resolution source.
      const appointmentsValid = linkedAppointments.length >= requiredAppointments.length
        && linkedAppointments.every((fact) => (
          fact.payload.polityId === payload.polityId
          && sameOrderedStrings(fact.sourceFactIds, [resolution.id])
        ))
        && requiredAppointments.every(([kind, officeKind, holderId]) => linkedAppointments.filter((fact) => (
          fact.kind === kind
          && fact.payload.officeKind === officeKind
          && fact.payload.holderId === holderId
        )).length === 1);
      if (!appointmentsValid) {
        push(violations, code('appointments'), `${resolution.id}没有同步唯一的新主帅、新副将与旧副将卸任`, resolution.id);
      }
      const previousCommanderRoleKey = `${payload.targetArmyId}\u0000${payload.previousCommanderId}\u0000军团主帅`;
      const previousCommanderMainOffices = (officesByRoleKey.get(previousCommanderRoleKey) ?? []).filter((office) => (
        office.appointedTurn < resolution.turn
        && (office.endedTurn === null || office.endedTurn >= resolution.turn)
      ));
      if (previousCommanderMainOffices.some((office) => (
        office.endedTurn !== resolution.turn
        || !linkedAppointments.some((fact) => (
          fact.kind === 'appointment_ended'
          && fact.payload.appointmentId === office.id
          && fact.payload.officeKind === '军团主帅'
          && fact.payload.holderId === payload.previousCommanderId
        ))
      ))) {
        push(
          violations,
          code('previous-commander-office'),
          `${resolution.id}没有关闭裁决前实际存在的前主帅职务`,
          resolution.id,
        );
      }
      if (enforceCurrentSnapshot) {
        const army = world.armies.find((item) => item.id === payload.targetArmyId);
        const actor = world.characters.find((item) => item.id === payload.actorId);
        const previousCommander = world.characters.find((item) => item.id === payload.previousCommanderId);
        if (!army
          || army.commanderId !== payload.actorId
          || army.deputyCommanderId !== payload.previousCommanderId
          || actor?.commandingArmyId !== payload.targetArmyId
          || previousCommander?.commandingArmyId !== null) {
          push(violations, code('snapshot'), `${resolution.id}与本季结束时的统军权状态不一致`, resolution.id);
        }
      }
    }
  }

  for (const [key, cohort] of executedByTurnAndPolity) {
    if (cohort.length > 1) {
      push(violations, code('conflict-owner'), `${key}同季出现${cohort.length}项获准独立军令`);
    }
  }
  for (const resolution of resolutions) {
    if (resolution.payload.reasonCode !== 'competing_request') continue;
    const key = `${resolution.turn}:${resolution.payload.polityId}`;
    const firstGrant = earliestExecutedFactNumberByTurnAndPolity.get(key);
    const priorGrant = firstGrant !== undefined && firstGrant < numericIdSuffix(resolution.id);
    if (!priorGrant) {
      push(violations, code('conflict-order'), `${resolution.id}声称请求冲突但此前没有同政权获准军令`, resolution.id);
    }
  }

  for (const event of promotionEvents) {
    const owners = event.sourceFactIds
      .map((id) => getFactById(id))
      .filter((fact): fact is AgencyIntentResolvedFact => (
        fact?.kind === 'agency_intent_resolved' && fact.payload.outcome === 'executed'
      ));
    if (requireEveryPromotionOwned && owners.length !== 1) {
      push(violations, code('single-owner'), `${event.id}副将晋升不归属于唯一的军令裁决`, event.id);
    }
  }
}

/**
 * Derive the incremental validation envelope only from this quarter's appended
 * Facts/Events. The operation deliberately uses array slices and never walks an
 * existing archive prefix.
 */
export function deriveRuntimeTurnArtifacts(
  previous: WorldState,
  next: WorldState,
): RuntimeTurnArtifacts {
  const appendedFacts = next.facts.slice(previous.facts.length);
  const appendedEvents = next.history.slice(previous.history.length);
  const practiceStateIds = new Set([
    ...previous.practiceStates.map((state) => state.id),
    ...next.practiceStates.map((state) => state.id),
  ]);
  const changed = new Map<RuntimeEntityKind, Set<string>>();
  for (const record of [...appendedFacts, ...appendedEvents]) {
    for (const delta of record.stateDeltas) {
      if (!RUNTIME_ENTITY_KIND_SET.has(delta.entityType as RuntimeEntityKind)) continue;
      // Schema 3/4 StateDelta calls regional practice-state records `practice`.
      // Preserve that archive spelling, but normalize the runtime artifact to
      // the authoritative collection that actually owns region-practice_* IDs.
      const kind: RuntimeEntityKind = delta.entityType === 'practice' && practiceStateIds.has(delta.entityId)
        ? 'practiceState'
        : delta.entityType as RuntimeEntityKind;
      const ids = changed.get(kind) ?? new Set<string>();
      ids.add(delta.entityId);
      changed.set(kind, ids);
    }
  }
  const changedEntityIds: Partial<Record<RuntimeEntityKind, readonly string[]>> = {};
  for (const [kind, ids] of changed) changedEntityIds[kind] = [...ids].sort(stableCompare);
  return {
    changedEntityIds,
    factChain: {
      label: 'quarter-facts',
      previousDigest: previous.factDigest,
      nextDigest: next.factDigest,
      appendedItems: appendedFacts,
    },
  };
}

function runtimeCollection(world: WorldState, kind: RuntimeEntityKind): readonly { id: string }[] {
  switch (kind) {
    case 'region': return world.regions;
    case 'route': return world.routes;
    case 'seaZone': return world.seaZones;
    case 'seaLane': return world.seaLanes;
    case 'portLink': return world.portLinks;
    case 'port': return world.ports;
    case 'polity': return world.polities;
    case 'character': return world.characters;
    case 'army': return world.armies;
    case 'fleet': return world.fleets;
    case 'war': return world.wars;
    case 'family': return world.families;
    case 'relationship': return world.relationships;
    case 'faction': return world.factions;
    case 'diplomacy': return world.diplomacy;
    case 'office': return world.offices;
    case 'backgroundPerson': return world.backgroundPeople;
    case 'commitment': return world.commitments;
    case 'tradeCorridor': return world.tradeCorridors;
    case 'navalOperation': return world.navalOperations;
    case 'shipbuildingProject': return world.shipbuildingProjects;
    case 'pathogen': return world.pathogens;
    case 'infection': return world.infections;
    case 'practice': return world.practices;
    case 'practiceState': return world.practiceStates;
    case 'situation': return world.situationSystem.situations;
    default: return [];
  }
}

function validateRuntimeEvent(
  event: HistoryEvent,
  expectedTurn: number,
  maximumFactCounter: number,
  characterIds: ReadonlySet<string>,
  polityIds: ReadonlySet<string>,
  regionIds: ReadonlySet<string>,
  violations: InvariantViolation[],
): void {
  if (event.turn !== expectedTurn) {
    push(violations, 'runtime.event-turn', `${event.id}不属于本次结算季度`, event.id);
  }
  const expectedDate = getDateForTurn(event.turn);
  if (event.year !== expectedDate.year || event.season !== expectedDate.season) {
    push(violations, 'runtime.event-date', `${event.id}纪年与回合不一致`, event.id);
  }
  if (event.actorIds.some((id) => id.length > 0 && !characterIds.has(id))) {
    push(violations, 'runtime.event-actor', `${event.id}引用未知人物`, event.id);
  }
  if (event.polityIds.some((id) => !polityIds.has(id))) {
    push(violations, 'runtime.event-polity', `${event.id}引用未知政权`, event.id);
  }
  if (event.regionIds.some((id) => !regionIds.has(id))) {
    push(violations, 'runtime.event-region', `${event.id}引用未知区域`, event.id);
  }
  if (duplicateIds(event.sourceFactIds).length > 0
    || event.sourceFactIds.some((id) => !/^fact_\d+$/.test(id) || numericIdSuffix(id) > maximumFactCounter)) {
    push(violations, 'runtime.event-source-fact', `${event.id}引用重复、未知或未来事实`, event.id);
  }
  if (event.causes.length === 0) {
    push(violations, 'runtime.event-causes', `${event.id}没有因果凭证`, event.id);
  }
  const causeWeight = event.causes.reduce((sum, cause) => sum + cause.weight, 0);
  if (
    event.causes.some((cause) => !Number.isFinite(cause.weight) || cause.weight < 0)
    || !Number.isFinite(causeWeight)
    || Math.abs(causeWeight - 1) > 0.011
  ) {
    push(violations, 'runtime.event-cause-weight', `${event.id}原因权重无效`, event.id);
  }
  for (const delta of event.stateDeltas) {
    if (delta.delta !== undefined && !Number.isFinite(delta.delta)) {
      push(violations, 'runtime.event-delta-finite', `${event.id}含非有限差量`, event.id);
    }
    if (
      typeof delta.before === 'number'
      && typeof delta.after === 'number'
      && delta.delta !== undefined
      && Math.abs(delta.after - delta.before - delta.delta) > 1e-9
    ) {
      push(violations, 'runtime.event-delta', `${event.id}差量与前后值不一致`, event.id);
    }
  }
}

function validateRuntimeFact(
  fact: SimulationFact,
  expectedTurn: number,
  maximumFactCounter: number,
  characterIds: ReadonlySet<string>,
  polityIds: ReadonlySet<string>,
  regionIds: ReadonlySet<string>,
  violations: InvariantViolation[],
): void {
  if (fact.turn !== expectedTurn) push(violations, 'runtime.fact-turn', `${fact.id}不属于本次结算季度`, fact.id);
  const expectedDate = getDateForTurn(fact.turn);
  if (fact.year !== expectedDate.year || fact.season !== expectedDate.season) {
    push(violations, 'runtime.fact-date', `${fact.id}纪年与回合不一致`, fact.id);
  }
  if (fact.actorIds.some((id) => id.length > 0 && !characterIds.has(id))) {
    push(violations, 'runtime.fact-actor', `${fact.id}引用未知人物`, fact.id);
  }
  if (fact.polityIds.some((id) => !polityIds.has(id))) {
    push(violations, 'runtime.fact-polity', `${fact.id}引用未知政权`, fact.id);
  }
  if (fact.regionIds.some((id) => !regionIds.has(id))) {
    push(violations, 'runtime.fact-region', `${fact.id}引用未知区域`, fact.id);
  }
  const currentFactNumber = numericIdSuffix(fact.id);
  if (fact.sourceFactIds.some((id) => (
    !/^fact_\d+$/.test(id)
    || numericIdSuffix(id) > maximumFactCounter
    || numericIdSuffix(id) >= currentFactNumber
  ))) {
    push(violations, 'runtime.fact-source', `${fact.id}引用未知或未来事实`, fact.id);
  }
  if (duplicateIds(fact.sourceFactIds).length > 0) {
    push(violations, 'runtime.fact-source-duplicate', `${fact.id}重复引用来源事实`, fact.id);
  }
  const causeWeight = fact.causes.reduce((sum, cause) => sum + cause.weight, 0);
  if (
    fact.causes.length === 0
    || fact.causes.some((cause) => !Number.isFinite(cause.weight) || cause.weight < 0)
    || !Number.isFinite(causeWeight)
    || Math.abs(causeWeight - 1) > 0.011
  ) {
    push(violations, 'runtime.fact-causes', `${fact.id}因果凭证无效`, fact.id);
  }
  for (const delta of fact.stateDeltas) {
    if (delta.delta !== undefined && !Number.isFinite(delta.delta)) {
      push(violations, 'runtime.fact-delta-finite', `${fact.id}含非有限差量`, fact.id);
    }
    if (
      typeof delta.before === 'number'
      && typeof delta.after === 'number'
      && delta.delta !== undefined
      && Math.abs(delta.after - delta.before - delta.delta) > 1e-9
    ) {
      push(violations, 'runtime.fact-delta', `${fact.id}差量与前后值不一致`, fact.id);
    }
  }
}

export function authoritativeTransientArmyIds(
  appendedFacts: readonly SimulationFact[],
  appendedEvents: readonly HistoryEvent[],
): ReadonlySet<string> {
  const raisedArmyIds = new Set<string>();
  for (const event of appendedEvents) {
    if (event.kind !== 'army_raised') continue;
    for (const delta of event.stateDeltas) {
      if (delta.entityType === 'army'
        && delta.field === 'soldiers'
        && delta.before === 0
        && typeof delta.after === 'number'
        && delta.after > 0) raisedArmyIds.add(delta.entityId);
    }
  }
  const explainedArmyIds = new Set<string>();
  for (const fact of appendedFacts) {
    if (fact.kind !== 'battle') continue;
    for (const force of [fact.payload.attacker, ...fact.payload.defenders]) {
      if (fact.stateDeltas.some((delta) => delta.entityType === 'army' && delta.entityId === force.armyId)) {
        explainedArmyIds.add(force.armyId);
      }
    }
  }
  const removalEventKinds = new Set(['army_disbanded', 'army_destroyed', 'army_demobilized', 'army_removed']);
  for (const event of appendedEvents) {
    for (const delta of event.stateDeltas) {
      if (delta.entityType !== 'army') continue;
      const explicitRemoval = delta.field === 'soldiers'
        && typeof delta.before === 'number'
        && delta.before > 0
        && delta.after === 0;
      if (explicitRemoval || removalEventKinds.has(event.kind)) explainedArmyIds.add(delta.entityId);
    }
  }
  return new Set([...raisedArmyIds].filter((id) => explainedArmyIds.has(id)));
}

/**
 * Validate only the completed turn and current authoritative snapshot. This
 * function deliberately reads at most the previous history tail plus newly
 * appended events; it never iterates the pre-existing history or Fact archive.
 */
export function validateTurnRuntime(
  previous: WorldState,
  next: WorldState,
  artifacts: RuntimeTurnArtifacts = deriveRuntimeTurnArtifacts(previous, next),
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  if (next === previous) push(violations, 'runtime.identity', '季度推进复用了原世界对象');
  if (next.seed !== previous.seed) push(violations, 'runtime.seed', '季度推进改变了世界种子');
  if (next.schemaVersion !== previous.schemaVersion) push(violations, 'runtime.schema', '季度推进改变了存档版本');
  if (next.mapContentVersion !== previous.mapContentVersion) push(violations, 'runtime.map-version', '季度推进改变了地图版本');
  if (next.turn !== previous.turn + 1) push(violations, 'runtime.clock', `季度应从${previous.turn}推进到${previous.turn + 1}，实际${next.turn}`);
  const expectedDate = getDateForTurn(next.turn);
  if (next.year !== expectedDate.year || next.season !== expectedDate.season) {
    push(violations, 'runtime.date', `推进后应为${expectedDate.year}年${expectedDate.season}`);
  }

  const historyStart = previous.history.length;
  if (next.history.length < historyStart) {
    push(violations, 'runtime.history-truncated', '季度推进截断了既有史册');
  }
  if (historyStart > 0 && next.history.length >= historyStart) {
    const previousTail = previous.history[historyStart - 1] as HistoryEvent;
    const nextPrefixTail = next.history[historyStart - 1] as HistoryEvent;
    if (stableHash(previousTail) !== stableHash(nextPrefixTail)) {
      push(violations, 'runtime.history-prefix', '季度推进改写了既有史册尾部', previousTail.id);
    }
  }
  const appendedEvents = next.history.slice(historyStart);
  if (next.counters.event !== previous.counters.event + appendedEvents.length) {
    push(violations, 'runtime.event-counter', '事件计数器与本季新增事件数不一致');
  }
  const appendedEventIds = appendedEvents.map((event) => event.id);
  for (const duplicate of duplicateIds(appendedEventIds)) {
    push(violations, 'runtime.event-duplicate', `本季重复事件ID ${duplicate}`, duplicate);
  }
  const characterIds = new Set(next.characters.map((character) => character.id));
  const polityIds = new Set(next.polities.map((polity) => polity.id));
  const regionIds = new Set(next.regions.map((region) => region.id));
  for (const [index, event] of appendedEvents.entries()) {
    const expectedId = `event_${String(previous.counters.event + index + 1).padStart(6, '0')}`;
    if (event.id !== expectedId) push(violations, 'runtime.event-id', `本季事件ID应为${expectedId}，实际${event.id}`, event.id);
    validateRuntimeEvent(event, previous.turn, next.counters.fact, characterIds, polityIds, regionIds, violations);
  }
  const expectedHistoryDigest = appendedEvents.reduce(
    (digest, event) => extendAppendOnlyDigest(digest, event),
    previous.historyDigest,
  );
  if (next.historyDigest !== expectedHistoryDigest) {
    push(violations, 'runtime.history-digest', '本季增量事件与历史摘要不一致');
  }

  const factStart = previous.facts.length;
  if (next.facts.length < factStart) push(violations, 'runtime.facts-truncated', '季度推进截断了既有事实档案');
  if (factStart > 0 && next.facts.length >= factStart) {
    const previousFactTail = previous.facts[factStart - 1] as SimulationFact;
    const nextFactPrefixTail = next.facts[factStart - 1] as SimulationFact;
    if (stableHash(previousFactTail) !== stableHash(nextFactPrefixTail)) {
      push(violations, 'runtime.fact-prefix', '季度推进改写了既有事实档案尾部', previousFactTail.id);
    }
  }
  const appendedFacts = next.facts.slice(factStart);
  if (next.counters.fact !== previous.counters.fact + appendedFacts.length) {
    push(violations, 'runtime.fact-counter', '事实计数器与本季新增事实数不一致');
  }
  const appendedFactIds = appendedFacts.map((fact) => fact.id);
  for (const duplicate of duplicateIds(appendedFactIds)) {
    push(violations, 'runtime.fact-duplicate', `本季重复事实ID ${duplicate}`, duplicate);
  }
  for (const [index, fact] of appendedFacts.entries()) {
    const expectedId = `fact_${String(previous.counters.fact + index + 1).padStart(7, '0')}`;
    if (fact.id !== expectedId) push(violations, 'runtime.fact-id', `本季事实ID应为${expectedId}，实际${fact.id}`, fact.id);
    validateRuntimeFact(fact, previous.turn, next.counters.fact, characterIds, polityIds, regionIds, violations);
  }
  const embodiedSubmissions = appendedFacts.filter(
    (fact): fact is Extract<SimulationFact, { kind: 'embodied_action_submitted' }> => fact.kind === 'embodied_action_submitted',
  );
  const embodiedResolutions = appendedFacts.filter(
    (fact): fact is Extract<SimulationFact, { kind: 'embodied_action_resolved' }> => fact.kind === 'embodied_action_resolved',
  );
  const appendedFactById = new Map(appendedFacts.map((fact) => [fact.id, fact]));
  if (embodiedSubmissions.length > 1) {
    push(violations, 'runtime.embodied-action-limit', '同一季度只能登记一项入世行动');
  }
  for (const submission of embodiedSubmissions) {
    const matches = embodiedResolutions.filter((resolution) => (
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
      push(violations, 'runtime.embodied-action-pair', `${submission.id}没有唯一且一致的入世行动结果`, submission.id);
    }
  }
  if (embodiedResolutions.some((resolution) => !embodiedSubmissions.some((submission) => submission.id === resolution.payload.submissionFactId))) {
    push(violations, 'runtime.embodied-action-orphan', '本季存在没有权威提交来源的入世行动结果');
  }
  for (const resolution of embodiedResolutions) {
    if (!resolution.payload.domainFactId) continue;
    const domain = appendedFactById.get(resolution.payload.domainFactId);
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
      push(
        violations,
        'runtime.embodied-action-domain',
        `${resolution.id}没有链接同一人物与行动的领域裁决事实`,
        resolution.id,
      );
    }
  }
  const expectedFactDigest = appendedFacts.reduce(
    (digest, fact) => extendAppendOnlyDigest(digest, fact),
    previous.factDigest,
  );
  if (next.factDigest !== expectedFactDigest) push(violations, 'runtime.fact-digest', '本季增量事实与事实摘要不一致');
  if (previous.agencyDecisionSystem.reviewedThroughTurn !== previous.turn - 1) {
    push(violations, 'runtime.agency-decision-parent', '推进前人物决策游标与世界回合不一致');
  }
  const runtimeFactById = (factId: string): SimulationFact | undefined => {
    if (!/^fact_\d+$/.test(factId)) return undefined;
    const candidate = next.facts[numericIdSuffix(factId) - 1];
    return candidate?.id === factId ? candidate : undefined;
  };
  // Resolve only the bounded Facts reachable from retained decision accounts;
  // never rebuild a map for the append-only archive during a live quarter.
  for (const message of validateAgencyDecisionStateFromReferences(next, runtimeFactById)) {
    push(violations, 'runtime.agency-decision-state', message);
  }
  validateAgencyIntentArchive({
    codePrefix: 'runtime',
    facts: appendedFacts,
    getFactById: runtimeFactById,
    events: appendedEvents,
    world: next,
    requireEveryPromotionOwned: true,
    enforceCurrentSnapshot: true,
  }, violations);
  const appendedAgencyResolutions = appendedFacts.filter(
    (fact): fact is AgencyIntentResolvedFact => fact.kind === 'agency_intent_resolved',
  );
  for (const resolution of appendedAgencyResolutions) {
    const actorState = next.agencyDecisionSystem.actors.find((actor) => actor.characterId === resolution.payload.actorId);
    const requestExhausted = resolution.payload.attemptOrdinal >= MAX_AGENCY_INTENT_ATTEMPTS
      && resolution.payload.outcome !== 'executed'
      && resolution.payload.outcome !== 'invalidated';
    const expectedGoalStatus = resolution.payload.outcome === 'executed'
      ? 'achieved'
      : resolution.payload.outcome === 'invalidated'
        || resolution.payload.institutionResponse === 'curbed'
        || requestExhausted
        ? 'invalidated'
        : 'active';
    const expectedClosureReason = resolution.payload.outcome === 'executed'
      ? 'command_obtained'
      : resolution.payload.institutionResponse === 'curbed'
        ? 'position_lost'
      : requestExhausted
        ? 'request_exhausted'
        : resolution.payload.outcome === 'invalidated'
          ? 'position_lost'
          : null;
    if (!actorState
      || actorState.lastResolutionFactId !== resolution.id
      || actorState.attemptOrdinal !== resolution.payload.attemptOrdinal
      || actorState.nextEligibleIntentTurn !== (resolution.payload.retryAfterTurn ?? previous.turn)
      || actorState.goal.id !== resolution.payload.goalId
      || actorState.goal.status !== expectedGoalStatus
      || actorState.goal.closureReason !== expectedClosureReason) {
      push(
        violations,
        'runtime.agency-intent-decision-state',
        `${resolution.id}没有归并到唯一的人物目标与计划状态`,
        resolution.id,
      );
    }
  }
  if (next.agencySystem.version !== 1 || next.agencySystem.memoryThroughTurn !== previous.turn) {
    push(violations, 'runtime.personal-memory-turn', `人物记忆应结算至回合${previous.turn}`);
  }
  if (previous.agencySystem.memoryThroughTurn !== previous.turn - 1) {
    push(violations, 'runtime.personal-memory-parent', '推进前人物记忆游标与世界回合不一致');
  }
  if (previous.agencySystem.memoryThroughTurn === previous.turn - 1) {
    const expectedAgencySystem = reducePersonalMemorySystem(
      { ...next, agencySystem: previous.agencySystem },
      previous.turn,
      appendedFacts,
    );
    if (stableHash(next.agencySystem) !== stableHash(expectedAgencySystem)) {
      push(violations, 'runtime.personal-memory-reducer', '人物记忆与本季权威事实的归并结果不一致');
    }
  }

  const previousWars = new Map(previous.wars.map((war) => [war.id, war]));
  const nextWars = new Map(next.wars.map((war) => [war.id, war]));
  const warStartedFacts = appendedFacts.filter(
    (fact): fact is Extract<SimulationFact, { kind: 'war_started' }> => fact.kind === 'war_started',
  );
  const warEndedFacts = appendedFacts.filter(
    (fact): fact is Extract<SimulationFact, { kind: 'war_ended' }> => fact.kind === 'war_ended',
  );
  for (const war of next.wars) {
    const prior = previousWars.get(war.id);
    if (!prior) {
      const matchingFacts = warStartedFacts.filter((candidate) => candidate.payload.warId === war.id);
      const fact = matchingFacts[0];
      if (matchingFacts.length !== 1
        || !fact
        || fact.payload.attackerId !== war.attackerId
        || fact.payload.defenderId !== war.defenderId
        || fact.payload.warKind !== war.kind
        || fact.payload.goal !== war.goal
        || !sameOrderedStrings(fact.payload.targetRegionIds, war.targetRegionIds)) {
        push(violations, 'runtime.war-start-fact', `${war.id}新建战争缺少匹配的war_started事实`, war.id);
      }
    }
    if ((prior?.active ?? !war.active) && !war.active) {
      const matchingFacts = warEndedFacts.filter((candidate) => candidate.payload.warId === war.id);
      const fact = matchingFacts[0];
      if (matchingFacts.length !== 1
        || !fact
        || fact.payload.attackerId !== war.attackerId
        || fact.payload.defenderId !== war.defenderId
        || war.endedTurn !== fact.turn
        || fact.payload.durationTurns !== fact.turn - war.startedTurn + 1
        || !warEndRolesAreConsistent(fact)) {
        push(violations, 'runtime.war-end-fact', `${war.id}结束战争缺少匹配的war_ended事实`, war.id);
      }
    }
  }
  for (const fact of warStartedFacts) {
    if (previousWars.has(fact.payload.warId) || !nextWars.has(fact.payload.warId)) {
      push(violations, 'runtime.war-start-orphan', `${fact.id}没有对应的当季新建战争`, fact.id);
    }
  }
  for (const fact of warEndedFacts) {
    const prior = previousWars.get(fact.payload.warId);
    const current = nextWars.get(fact.payload.warId);
    if ((!prior?.active && prior !== undefined) || !current || current.active) {
      push(violations, 'runtime.war-end-orphan', `${fact.id}没有对应的当季战争结束转换`, fact.id);
    }
  }

  for (const message of validateSituationSystemState(next.situationSystem)) {
    push(violations, 'runtime.situation-state', message);
  }
  if (next.situationSystem.lastReducedTurn !== previous.turn) {
    push(
      violations,
      'runtime.situation-turn',
      `局势系统应结算回合${previous.turn}，实际${next.situationSystem.lastReducedTurn}`,
    );
  }
  const retainedSituations = new Map(next.situationSystem.situations.map((situation) => [situation.id, situation]));
  for (const fact of appendedFacts) {
    if (fact.kind !== 'situation_milestone') continue;
    const situation = retainedSituations.get(fact.payload.situationId);
    if (fact.sourceFactIds.length === 0) {
      push(violations, 'runtime.situation-cause', `${fact.id}没有来源事实`, fact.id);
    }
    if (!situation || !situation.milestoneFactIds.includes(fact.id)) {
      push(violations, 'runtime.situation-milestone', `${fact.id}未挂接到权威局势`, fact.id);
    }
  }
  for (const situation of next.situationSystem.situations) {
    for (const change of situation.recentChanges) {
      if (change.turn !== previous.turn || change.kind === 'participants_changed') continue;
      const milestone = appendedFacts.find((fact) => milestoneMatchesSituationChange(fact, situation.id, change));
      if (!milestone || !situation.milestoneFactIds.includes(milestone.id)) {
        push(
          violations,
          'runtime.situation-transition-milestone',
          `${situation.id}的${change.kind}变化没有同季里程碑事实`,
          situation.id,
        );
      }
    }
  }

  const report = next.lastTurn;
  if (!report) {
    push(violations, 'runtime.last-turn-missing', '推进后缺少本季账本');
  } else {
    if (report.turn !== previous.turn || report.year !== previous.year || report.season !== previous.season) {
      push(violations, 'runtime.last-turn-clock', '本季账本与推进前时钟不一致');
    }
    const boundaryIntervention = previous.history.at(-1);
    const carriedEventIds = boundaryIntervention
      && boundaryIntervention.turn === previous.turn
      && boundaryIntervention.kind.startsWith('observer_intervention_')
      ? [boundaryIntervention.id]
      : [];
    const expectedEventIds = [...carriedEventIds, ...appendedEventIds];
    if (!sameOrderedStrings(report.eventIds, expectedEventIds)) {
      push(violations, 'runtime.last-turn-events', '本季账本未精确引用边界干预与新增事件');
    }
    if (!sameOrderedStrings(report.factIds, appendedFactIds)) {
      push(violations, 'runtime.last-turn-facts', '本季账本未精确引用新增事实');
    }

    const population = report.population;
    const expectedPopulation = population.start + population.births - population.civilianDeaths - population.militaryDeaths;
    if (Object.values(population).some((value) => !isWholeNonNegative(value))) {
      push(violations, 'runtime.population-fields', '本季人口账含负数或非整数');
    }
    if (
      population.start !== runtimeTotalPopulation(previous)
      || population.end !== expectedPopulation
      || population.end !== runtimeTotalPopulation(next)
    ) {
      push(violations, 'runtime.population-ledger', '本季人口账与前后世界快照不一致');
    }

    const food = report.food;
    const expectedFood = food.start + food.produced - food.civilianConsumed - food.armyConsumed - food.spoiled - food.warDestroyed;
    if (Object.values(food).some((value) => !isWholeNonNegative(value))) {
      push(violations, 'runtime.food-fields', '本季粮食账含负数或非整数');
    }
    if (food.start !== runtimeTotalFood(previous) || food.end !== expectedFood || food.end !== runtimeTotalFood(next)) {
      push(violations, 'runtime.food-ledger', '本季粮食账与前后世界快照不一致');
    }

    const wealth = report.wealth;
    const expectedWealth = wealth.start + wealth.produced - wealth.householdConsumed - wealth.warDestroyed;
    if (Object.values(wealth).some((value) => !isWholeNonNegative(value))) {
      push(violations, 'runtime.wealth-fields', '本季财富账含负数或非整数');
    }
    if (wealth.start !== runtimeTotalWealth(previous) || wealth.end !== expectedWealth || wealth.end !== runtimeTotalWealth(next)) {
      push(violations, 'runtime.wealth-ledger', '本季财富账与前后世界快照不一致');
    }

    const commodities = ['木材', '铁器', '马匹', '盐', '纺织品', '奢侈品'] as const;
    for (const commodity of commodities) {
      const start = report.trade.stockStart[commodity];
      const end = report.trade.stockEnd[commodity];
      const produced = report.trade.produced[commodity] ?? 0;
      const consumed = report.trade.consumed[commodity] ?? 0;
      const lost = report.trade.lost[commodity] ?? 0;
      const previousStock = previous.regions.reduce((sum, region) => sum + region.goods[commodity], 0);
      const nextStock = next.regions.reduce((sum, region) => sum + region.goods[commodity], 0);
      if (![start, end, produced, consumed, lost].every(isWholeNonNegative)
        || start !== previousStock
        || end !== start + produced - consumed - lost
        || end !== nextStock) {
        push(violations, 'runtime.commodity-ledger', `${commodity}本季账与前后快照不一致`);
      }
    }

    const shipmentIds = new Set<string>();
    for (const shipment of report.trade.shipments) {
      if (shipmentIds.has(shipment.id)) push(violations, 'runtime.shipment-duplicate', `${shipment.id}本季重复`, shipment.id);
      shipmentIds.add(shipment.id);
      if (shipment.acceptedAmount !== shipment.deliveredAmount + shipment.lostAmount + shipment.raidedAmount
        || shipment.peopleDeparted !== shipment.peopleArrived + shipment.peopleLost) {
        push(violations, 'runtime.shipment-balance', `${shipment.id}货量或人数不守恒`, shipment.id);
      }
    }
    const migrationShipments = report.trade.shipments.filter((shipment) => shipment.kind === '迁徙');
    if (
      report.migration.departed !== report.migration.arrived + report.migration.travelDeaths
      || report.migration.departed !== migrationShipments.reduce((sum, shipment) => sum + shipment.peopleDeparted, 0)
      || report.migration.arrived !== migrationShipments.reduce((sum, shipment) => sum + shipment.peopleArrived, 0)
      || report.migration.travelDeaths !== migrationShipments.reduce((sum, shipment) => sum + shipment.peopleLost, 0)
      || report.migration.flowIds.some((id) => !shipmentIds.has(id))
    ) {
      push(violations, 'runtime.migration-ledger', '本季迁徙账与Shipment不一致');
    }
    const infectiousEnd = next.infections.reduce((sum, infection) => sum + infection.infectious, 0);
    if (![report.health.infectiousStart, report.health.newExposures, report.health.importedExposures,
      report.health.civilianDeaths, report.health.militaryDeaths, report.health.infectiousEnd]
      .every(isWholeNonNegative)
      || report.health.infectiousEnd !== infectiousEnd) {
      push(violations, 'runtime.health-infectious', '本季传染者账字段无效或终值与快照不一致');
    }
    if (report.health.civilianDeaths > population.civilianDeaths
      || report.health.militaryDeaths > population.militaryDeaths) {
      push(violations, 'runtime.health-deaths', '本季疾病死亡超过人口死亡总账');
    }
    if (report.health.outbreakRegionIds.some((id) => !regionIds.has(id))) {
      push(violations, 'runtime.health-region', '本季疾病账引用未知暴发区域');
    }
    for (const usage of report.logistics.routeUsage) {
      const capacity = next.routes.find((route) => route.id === usage.routeId)?.supplyCapacity;
      if (capacity === undefined || usage.capacity !== capacity || usage.reserved < 0 || usage.reserved > capacity) {
        push(violations, 'runtime.route-capacity', `${usage.routeId}本季陆路运力无效`, usage.routeId);
      }
    }
    for (const usage of report.logistics.seaUsage) {
      const laneCapacity = next.seaLanes.find((lane) => lane.id === usage.edgeId)?.capacity;
      const linkCapacity = next.portLinks.find((link) => link.id === usage.edgeId)?.capacity;
      const maximumEffectiveCapacity = laneCapacity !== undefined ? Math.floor(laneCapacity * 1.05) : linkCapacity;
      if (maximumEffectiveCapacity === undefined
        || !isWholeNonNegative(usage.reserved)
        || !isWholeNonNegative(usage.capacity)
        || usage.reserved > maximumEffectiveCapacity
        || usage.capacity > maximumEffectiveCapacity) {
        push(violations, 'runtime.sea-capacity', `${usage.edgeId}本季海运运力无效`, usage.edgeId);
      }
    }
  }

  for (const key of Object.keys(previous.counters) as Array<keyof WorldState['counters']>) {
    if (!isWholeNonNegative(next.counters[key]) || next.counters[key] < previous.counters[key]) {
      push(violations, 'runtime.counter', `${key}计数器发生回退`);
    }
  }

  if (artifacts.changedEntityIds) {
    const transientArmyIds = authoritativeTransientArmyIds(appendedFacts, appendedEvents);
    for (const [kind, ids] of Object.entries(artifacts.changedEntityIds) as Array<[
      RuntimeEntityKind,
      readonly string[] | undefined,
    ]>) {
      const changedIds = ids ?? [];
      const knownIds = new Set([
        ...runtimeCollection(previous, kind).map((entity) => entity.id),
        ...runtimeCollection(next, kind).map((entity) => entity.id),
      ]);
      for (const duplicate of duplicateIds(changedIds)) {
        push(violations, 'runtime.changed-id-duplicate', `${kind}重复声明变更ID ${duplicate}`, duplicate);
      }
      for (const id of changedIds) {
        if (!knownIds.has(id) && (kind !== 'army' || !transientArmyIds.has(id))) {
          push(violations, 'runtime.changed-id', `${kind}声明未知变更ID ${id}`, id);
        }
      }
    }
  }

  if (artifacts.factChain) {
    const expectedFactDigest = artifacts.factChain.appendedItems.reduce<string>(
      (digest, fact) => extendAppendOnlyDigest(digest, fact),
      artifacts.factChain.previousDigest,
    );
    if (expectedFactDigest !== artifacts.factChain.nextDigest) {
      push(violations, 'runtime.fact-digest', `${artifacts.factChain.label ?? 'Fact'}增量摘要不一致`);
    }
  }

  if (next.hash !== computeWorldHash(next)) push(violations, 'runtime.hash', '推进后世界哈希与当前权威状态不一致');
  return violations;
}

export function assertTurnRuntime(
  previous: WorldState,
  next: WorldState,
  artifacts?: RuntimeTurnArtifacts,
): void {
  const violations = validateTurnRuntime(previous, next, artifacts);
  if (violations.length > 0) {
    throw new Error(`Runtime world invariant violation:\n${violations.map((item) => `${item.code}: ${item.message}`).join('\n')}`);
  }
}

function validationClock(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

export function measureRuntimeValidation(
  previous: WorldState,
  next: WorldState,
  artifacts?: RuntimeTurnArtifacts,
  now: () => number = validationClock,
): ValidationMeasurement {
  const startedAt = now();
  const violations = validateTurnRuntime(previous, next, artifacts);
  return { mode: 'runtime', durationMs: Math.max(0, now() - startedAt), violations };
}

export function validateWorldFull(world: WorldState): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  if (world.schemaVersion !== 4) push(violations, 'schema.version', `不支持的存档版本 ${String(world.schemaVersion)}`);
  if (!world.seed) push(violations, 'seed.empty', '世界种子不能为空');
  if (!isWholeNonNegative(world.turn)) push(violations, 'clock.turn', '世界回合必须为非负安全整数');

  const expectedDate = getDateForTurn(world.turn);
  if (world.year !== expectedDate.year || world.season !== expectedDate.season) {
    push(violations, 'clock.mismatch', `回合${world.turn}应为${expectedDate.year}年${expectedDate.season}`);
  }

  const collections: Array<[string, string[]]> = [
    ['region', world.regions.map((item) => item.id)],
    ['route', world.routes.map((item) => item.id)],
    ['polity', world.polities.map((item) => item.id)],
    ['character', world.characters.map((item) => item.id)],
    ['army', world.armies.map((item) => item.id)],
    ['war', world.wars.map((item) => item.id)],
    ['event', world.history.map((item) => item.id)],
    ['fact', world.facts.map((item) => item.id)],
    ['family', world.families.map((item) => item.id)],
    ['faction', world.factions.map((item) => item.id)],
    ['relationship', world.relationships.map((item) => item.id)],
    ['office', world.offices.map((item) => item.id)],
    ['background', world.backgroundPeople.map((item) => item.id)],
    ['commitment', world.commitments.map((item) => item.id)],
    ['sea-zone', world.seaZones.map((item) => item.id)],
    ['sea-lane', world.seaLanes.map((item) => item.id)],
    ['port-link', world.portLinks.map((item) => item.id)],
    ['port', world.ports.map((item) => item.id)],
    ['fleet', world.fleets.map((item) => item.id)],
    ['trade-corridor', world.tradeCorridors.map((item) => item.id)],
    ['naval-operation', world.navalOperations.map((item) => item.id)],
    ['ship-project', world.shipbuildingProjects.map((item) => item.id)],
    ['pathogen', world.pathogens.map((item) => item.id)],
    ['infection', world.infections.map((item) => item.id)],
    ['practice', world.practices.map((item) => item.id)],
    ['practice-state', world.practiceStates.map((item) => item.id)],
    ['situation', world.situationSystem.situations.map((item) => item.id)],
  ];
  for (const [kind, ids] of collections) {
    for (const id of duplicateIds(ids)) push(violations, 'id.duplicate', `${kind}出现重复ID ${id}`, id);
  }

  const counterChecks: Array<[keyof WorldState['counters'], string[], number]> = [
    ['character', world.characters.map((item) => item.id), world.characters.length],
    ['army', world.armies.map((item) => item.id), 0],
    ['polity', world.polities.map((item) => item.id), world.polities.length],
    ['war', world.wars.map((item) => item.id), world.wars.length],
    ['event', world.history.map((item) => item.id), world.history.length],
    ['fact', world.facts.map((item) => item.id), world.facts.length],
    ['family', world.families.map((item) => item.id), world.families.length],
    ['faction', world.factions.map((item) => item.id), world.factions.length],
    ['relationship', world.relationships.map((item) => item.id), world.relationships.length],
    ['office', world.offices.map((item) => item.id), world.offices.length],
    ['commitment', world.commitments.map((item) => item.id), world.commitments.length],
    ['fleet', world.fleets.map((item) => item.id), world.fleets.length],
    ['tradeCorridor', world.tradeCorridors.map((item) => item.id), world.tradeCorridors.length],
    ['navalOperation', world.navalOperations.map((item) => item.id), world.navalOperations.length],
    ['shipProject', world.shipbuildingProjects.map((item) => item.id), world.shipbuildingProjects.length],
  ];
  for (const [name, ids, minimumCount] of counterChecks) {
    const counter = world.counters[name];
    const maximumSuffix = ids.reduce((maximum, id) => Math.max(maximum, numericIdSuffix(id)), 0);
    if (!isWholeNonNegative(counter) || counter < maximumSuffix || counter < minimumCount) {
      push(violations, 'counter.invalid', `${name}计数器${counter}低于实体下界${Math.max(maximumSuffix, minimumCount)}`);
    }
  }

  const regionById = new Map(world.regions.map((region) => [region.id, region]));
  const routeById = new Map(world.routes.map((route) => [route.id, route]));
  const polityById = new Map(world.polities.map((polity) => [polity.id, polity]));
  const characterById = new Map(world.characters.map((character) => [character.id, character]));
  const armyById = new Map(world.armies.map((army) => [army.id, army]));
  const seaZoneById = new Map(world.seaZones.map((zone) => [zone.id, zone]));
  const fleetById = new Map(world.fleets.map((fleet) => [fleet.id, fleet]));
  const pathogenById = new Map(world.pathogens.map((pathogen) => [pathogen.id, pathogen]));
  const practiceById = new Map(world.practices.map((practice) => [practice.id, practice]));
  const familyById = new Map(world.families.map((family) => [family.id, family]));
  const factionById = new Map(world.factions.map((faction) => [faction.id, faction]));
  const warById = new Map(world.wars.map((war) => [war.id, war]));
  const eventById = new Map(world.history.map((event) => [event.id, event]));
  const factById = new Map(world.facts.map((fact) => [fact.id, fact]));

  const warStartsById = new Map<string, Extract<SimulationFact, { kind: 'war_started' }>[]>();
  const warEndsById = new Map<string, Extract<SimulationFact, { kind: 'war_ended' }>[]>();
  for (const fact of world.facts) {
    if (fact.kind === 'war_started') {
      const facts = warStartsById.get(fact.payload.warId) ?? [];
      facts.push(fact);
      warStartsById.set(fact.payload.warId, facts);
    } else if (fact.kind === 'war_ended') {
      const facts = warEndsById.get(fact.payload.warId) ?? [];
      facts.push(fact);
      warEndsById.set(fact.payload.warId, facts);
    }
  }
  const legacyFactBoundaryTurn = world.legacyArchiveBoundary?.turn ?? -1;
  for (const war of world.wars) {
    const starts = warStartsById.get(war.id) ?? [];
    const ends = warEndsById.get(war.id) ?? [];
    if (starts.length > 1 || (war.startedTurn > legacyFactBoundaryTurn && starts.length !== 1)) {
      push(violations, 'fact.war-start-count', `${war.id}的war_started数量应为1，实际${starts.length}`, war.id);
    }
    const endFactRequired = !war.active
      && war.endedTurn !== null
      && war.endedTurn > legacyFactBoundaryTurn;
    if (ends.length > 1 || (endFactRequired && ends.length !== 1) || (war.active && ends.length > 0)) {
      push(violations, 'fact.war-end-count', `${war.id}的war_ended数量与生命周期不一致：${ends.length}`, war.id);
    }
  }

  for (const message of validateSituationSystemState(world.situationSystem)) {
    push(violations, 'situation.state', message);
  }
  if (world.situationSystem.lastReducedTurn !== world.turn - 1) {
    push(
      violations,
      'situation.turn',
      `局势系统应停在回合${world.turn - 1}，实际${world.situationSystem.lastReducedTurn}`,
    );
  }
  for (const message of validateAgencySystemState(world)) {
    push(violations, 'agency.memory-state', message);
  }
  for (const message of validateAgencyDecisionStateFromReferences(world, (factId) => factById.get(factId))) {
    push(violations, 'agency.decision-state', message);
  }
  const firstAgencyIntentTurn = world.facts.reduce((earliest, fact) => (
    fact.kind === 'agency_intent_submitted' ? Math.min(earliest, fact.turn) : earliest
  ), Number.POSITIVE_INFINITY);
  const agencyDecisionEvents = world.history.filter((event) => (
    event.kind !== 'deputy_promoted'
    || (Number.isFinite(firstAgencyIntentTurn) && event.turn >= firstAgencyIntentTurn)
  ));
  validateAgencyIntentArchive({
    codePrefix: 'fact',
    facts: world.facts,
    getFactById: (factId) => factById.get(factId),
    events: agencyDecisionEvents,
    world,
    requireEveryPromotionOwned: true,
    enforceCurrentSnapshot: false,
  }, violations);
  const situationById = new Map(world.situationSystem.situations.map((situation) => [situation.id, situation]));
  const validateSituationFactId = (factId: string, ownerId: string, role: string): void => {
    if (!factById.has(factId)) push(violations, 'situation.fact', `${ownerId}的${role}引用未知事实${factId}`, ownerId);
  };
  for (const candidate of world.situationSystem.candidates) {
    for (const factId of candidate.evidenceFactIds) validateSituationFactId(factId, candidate.key, '候选证据');
  }
  for (const situation of world.situationSystem.situations) {
    const participants = situation.participants;
    for (const characterId of [
      ...participants.coreCharacterIds,
      ...participants.supportingCharacterIds,
      ...participants.opposingCharacterIds,
      ...situation.executableActorIds,
    ]) {
      if (!characterById.has(characterId)) push(violations, 'situation.character', `${situation.id}引用未知人物${characterId}`, situation.id);
    }
    for (const familyId of participants.familyIds) {
      if (!familyById.has(familyId)) push(violations, 'situation.family', `${situation.id}引用未知家族${familyId}`, situation.id);
    }
    for (const factionId of participants.factionIds) {
      if (!factionById.has(factionId)) push(violations, 'situation.faction', `${situation.id}引用未知派系${factionId}`, situation.id);
    }
    for (const polityId of participants.polityIds) {
      if (!polityById.has(polityId)) push(violations, 'situation.polity', `${situation.id}引用未知政权${polityId}`, situation.id);
    }
    for (const regionId of participants.regionIds) {
      if (!regionById.has(regionId)) push(violations, 'situation.region', `${situation.id}引用未知区域${regionId}`, situation.id);
    }
    // Characters, families, factions, polities and regions are durable records.
    // Army/fleet snapshots are intentionally historical: those operational
    // entities may be disbanded after the Fact that made them participants.
    for (const factId of situation.causalFactIds) validateSituationFactId(factId, situation.id, '因果链');
    for (const factId of situation.milestoneFactIds) {
      const fact = factById.get(factId);
      if (fact?.kind !== 'situation_milestone' || fact.payload.situationId !== situation.id) {
        push(violations, 'situation.milestone', `${situation.id}引用无效里程碑事实${factId}`, situation.id);
      }
    }
    for (const change of situation.recentChanges) {
      for (const factId of change.sourceFactIds) validateSituationFactId(factId, situation.id, '变更证据');
      if (change.kind !== 'participants_changed') {
        const milestone = situation.milestoneFactIds
          .map((factId) => factById.get(factId))
          .find((fact): fact is SimulationFact => Boolean(
            fact && milestoneMatchesSituationChange(fact, situation.id, change),
          ));
        if (!milestone) {
          push(
            violations,
            'situation.transition-milestone',
            `${situation.id}的${change.kind}变化没有匹配的里程碑事实`,
            situation.id,
          );
        }
      }
    }
    for (const signal of [...situation.signals, situation.nextWatch]) {
      for (const reference of signal.refs) {
        if (reference.kind === 'fact') validateSituationFactId(reference.factId, situation.id, '信号证据');
      }
    }
    for (const factId of situation.resolution?.resultFactIds ?? []) {
      validateSituationFactId(factId, situation.id, '结案证据');
    }
  }

  if (world.mapContentVersion === 'v03-82' && (world.regions.length !== 82 || world.seaZones.length !== 10)) {
    push(violations, 'map.v03-size', `V0.3新世界应有82陆区与10海域，实际${world.regions.length}/${world.seaZones.length}`);
  }
  if (world.mapContentVersion === 'legacy-v02-48' && (world.regions.length > 48 || world.seaZones.length !== 10)) {
    push(violations, 'map.legacy-size', `旧世界不得扩充陆区且应挂接10海域，实际${world.regions.length}/${world.seaZones.length}`);
  }

  for (const region of world.regions) {
    if (!isWholeNonNegative(region.population)) push(violations, 'region.population', `${region.name}人口不是非负整数`, region.id);
    if (!isWholeNonNegative(region.food)) push(violations, 'region.food', `${region.name}粮食不是非负整数`, region.id);
    if (!isWholeNonNegative(region.wealth)) push(violations, 'region.wealth', `${region.name}财富不是非负整数`, region.id);
    if (!isWholeNonNegative(region.refugeePopulation) || region.refugeePopulation > region.population) {
      push(violations, 'region.refugees', `${region.name}流民不是人口的有效子集`, region.id);
    }
    if (!isFiniteRange(region.sanitation, 0, 100) || !isFiniteRange(region.medicalCapacity, 0, 100)) {
      push(violations, 'region.health-capacity', `${region.name}卫生或医疗能力越界`, region.id);
    }
    if (!Number.isSafeInteger(region.marketLevel) || region.marketLevel < 1 || region.marketLevel > 5
      || !Number.isSafeInteger(region.portLevel) || region.portLevel < 0 || region.portLevel > 4
      || (!region.port && region.portLevel !== 0)) {
      push(violations, 'region.market-port', `${region.name}市场或港口等级无效`, region.id);
    }
    if (Object.values(region.goods).some((value) => !isWholeNonNegative(value))
      || Object.values(region.prices).some((value) => !Number.isFinite(value) || value <= 0)
      || Object.values(region.resourcePotential).some((value) => !isFiniteRange(value, 0, 100))) {
      push(violations, 'region.commodities', `${region.name}商品库存、价格或资源潜力无效`, region.id);
    }
    if (!isFiniteRange(region.unrest, 0, 100) || !isFiniteRange(region.devastation, 0, 100)) {
      push(violations, 'region.pressure-range', `${region.name}不安或破坏度越界`, region.id);
    }
    if (!isFiniteRange(region.fertility, 0, 150) || !Number.isFinite(region.defense) || region.defense < 0) {
      push(violations, 'region.definition-range', `${region.name}地力或防御值无效`, region.id);
    }
    const controller = polityById.get(region.controllerId);
    if (!controller?.alive) push(violations, 'region.controller', `${region.name}由不存在或已灭亡的政权控制`, region.id);
    for (const neighborId of region.neighbors) {
      const neighbor = regionById.get(neighborId);
      if (!neighbor) push(violations, 'region.neighbor.missing', `${region.name}连接未知区域${neighborId}`, region.id);
      else if (!neighbor.neighbors.includes(region.id)) push(violations, 'region.neighbor.asymmetric', `${region.name}与${neighbor.name}的邻接不对称`, region.id);
      if (!routeById.size || !region.routeIds.some((routeId) => {
        const route = routeById.get(routeId);
        return route && (
          (route.fromRegionId === region.id && route.toRegionId === neighborId)
          || (route.toRegionId === region.id && route.fromRegionId === neighborId)
        );
      })) push(violations, 'region.neighbor.route', `${region.name}到${neighborId}没有对应路线`, region.id);
    }
    for (const routeId of region.routeIds) {
      const route = routeById.get(routeId);
      if (!route || (route.fromRegionId !== region.id && route.toRegionId !== region.id)) {
        push(violations, 'region.route.missing', `${region.name}引用无效路线${routeId}`, region.id);
      }
    }
  }

  for (const route of world.routes) {
    if (!regionById.has(route.fromRegionId) || !regionById.has(route.toRegionId)) {
      push(violations, 'route.endpoint', `${route.id}存在无效端点`, route.id);
    }
    if (!isWholeNonNegative(route.supplyCapacity) || route.supplyCapacity === 0) {
      push(violations, 'route.capacity', `${route.id}运力必须为正整数`, route.id);
    }
    if (!isWholeNonNegative(route.distance) || route.distance === 0) {
      push(violations, 'route.distance', `${route.id}距离必须为正整数`, route.id);
    }
  }

  for (const zone of world.seaZones) {
    if (!isFiniteRange(zone.stormRisk, 0, 100) || !isFiniteRange(zone.piracy, 0, 100)
      || !isWholeNonNegative(zone.traffic)) {
      push(violations, 'sea-zone.metrics', `${zone.name}风暴、海盗或船流无效`, zone.id);
    }
    for (const adjacentId of zone.adjacentSeaZoneIds) {
      const adjacent = seaZoneById.get(adjacentId);
      if (!adjacent || !adjacent.adjacentSeaZoneIds.includes(zone.id)) {
        push(violations, 'sea-zone.adjacency', `${zone.name}与${adjacentId}海域邻接不对称`, zone.id);
      }
      const linked = world.seaLanes.some((lane) => (
        (lane.fromSeaZoneId === zone.id && lane.toSeaZoneId === adjacentId)
        || (lane.toSeaZoneId === zone.id && lane.fromSeaZoneId === adjacentId)
      ));
      if (!linked) push(violations, 'sea-zone.lane', `${zone.name}到${adjacentId}没有航道`, zone.id);
    }
    for (const regionId of zone.portRegionIds) {
      if (!regionById.get(regionId)?.port || !world.portLinks.some((link) => link.regionId === regionId && link.seaZoneId === zone.id)) {
        push(violations, 'sea-zone.port', `${zone.name}引用无效港口${regionId}`, zone.id);
      }
    }
    if (zone.controllerId && !polityById.get(zone.controllerId)?.alive) {
      push(violations, 'sea-zone.controller', `${zone.name}由不存在或已灭亡政权控制`, zone.id);
    }
    if (Object.values(zone.powerByPolity).some((value) => !Number.isFinite(value) || value < 0)) {
      push(violations, 'sea-zone.power', `${zone.name}海权投射无效`, zone.id);
    }
  }
  for (const lane of world.seaLanes) {
    if (!seaZoneById.has(lane.fromSeaZoneId) || !seaZoneById.has(lane.toSeaZoneId) || lane.fromSeaZoneId === lane.toSeaZoneId) {
      push(violations, 'sea-lane.endpoint', `${lane.id}海域端点无效`, lane.id);
    }
    if (!isWholeNonNegative(lane.capacity) || lane.capacity === 0 || !isWholeNonNegative(lane.distance) || lane.distance === 0
      || !isFiniteRange(lane.baseRisk, 0, 100)) {
      push(violations, 'sea-lane.metrics', `${lane.id}距离、运力或风险无效`, lane.id);
    }
  }
  for (const link of world.portLinks) {
    if (!regionById.get(link.regionId)?.port || !seaZoneById.has(link.seaZoneId)) {
      push(violations, 'port-link.endpoint', `${link.id}港区或海域端点无效`, link.id);
    }
    if (!isWholeNonNegative(link.capacity) || link.capacity === 0 || !isWholeNonNegative(link.distance) || link.distance === 0) {
      push(violations, 'port-link.metrics', `${link.id}距离或运力无效`, link.id);
    }
  }
  const portRegions = new Set<string>();
  for (const port of world.ports) {
    if (portRegions.has(port.regionId)) push(violations, 'port.region-duplicate', `${port.regionId}存在多个港口状态`, port.id);
    portRegions.add(port.regionId);
    if (!regionById.get(port.regionId)?.port || !isFiniteRange(port.merchantConfidence, 0, 100)
      || !isFiniteRange(port.blockadePressure, 0, 100) || !isFiniteRange(port.damage, 0, 100)
      || !isWholeNonNegative(port.throughput) || !isWholeNonNegative(port.customsRevenue)) {
      push(violations, 'port.metrics', `${port.id}引用或港务指标无效`, port.id);
    }
  }

  for (const polity of world.polities) {
    if (!isWholeNonNegative(polity.treasury)) push(violations, 'polity.treasury', `${polity.name}国库不是非负整数`, polity.id);
    if (
      !isFiniteRange(polity.legitimacy, 0, 100)
      || !isFiniteRange(polity.authority, 0, 100)
      || !isFiniteRange(polity.administration, 0, 100)
      || !isFiniteRange(polity.warWeariness, 0, 100)
      || !isFiniteRange(polity.courtInfluence, 0, 100)
      || !isFiniteRange(polity.maritimeOrientation, 0, 100)
      || !isFiniteRange(polity.diplomaticReputation, 0, 100)
      || !isFiniteRange(polity.taxRate, 0, 1)
    ) push(violations, 'polity.metric-range', `${polity.name}统治指标越界或非有限数`, polity.id);
    if (!isWholeNonNegative(polity.tradeRevenue) || !isWholeNonNegative(polity.navalBudget)) {
      push(violations, 'polity.maritime-ledger', `${polity.name}贸易收入或水师预算无效`, polity.id);
    }
    if (polity.foundedTurn < 0 || polity.foundedTurn > world.turn) {
      push(violations, 'polity.founded-turn', `${polity.name}建立时间无效`, polity.id);
    }
    if (!Number.isSafeInteger(polity.lastCourtCrisisTurn) || polity.lastCourtCrisisTurn > world.turn) {
      push(violations, 'polity.court-turn', `${polity.name}最近朝廷危机时间无效`, polity.id);
    }
    const actualRegions = world.regions
      .filter((region) => region.controllerId === polity.id)
      .map((region) => region.id)
      .sort(stableCompare);
    const recordedRegions = [...polity.controlledRegionIds].sort(stableCompare);
    if (JSON.stringify(actualRegions) !== JSON.stringify(recordedRegions)) {
      push(violations, 'polity.territory', `${polity.name}领土缓存与区域控制权不一致`, polity.id);
    }
    if (polity.alive) {
      if (polity.eliminatedTurn !== null) push(violations, 'polity.alive-eliminated', `${polity.name}存续却记录了灭亡时间`, polity.id);
      if (actualRegions.length === 0) push(violations, 'polity.landless', `${polity.name}存续却没有领土`, polity.id);
      if (!polity.capitalRegionId || !actualRegions.includes(polity.capitalRegionId)) {
        push(violations, 'polity.capital', `${polity.name}首都不在控制区`, polity.id);
      }
      const ruler = characterById.get(polity.rulerId);
      if (!ruler?.alive || ruler.polityId !== polity.id) {
        push(violations, 'polity.ruler', `${polity.name}君主引用无效`, polity.id);
      }
      if (!polity.rulingFamilyId || !familyById.has(polity.rulingFamilyId)) {
        push(violations, 'polity.ruling-family', `${polity.name}统治家族引用无效`, polity.id);
      }
    } else if (actualRegions.length > 0) {
      push(violations, 'polity.dead-territory', `${polity.name}已灭亡却仍有领土`, polity.id);
    } else if (polity.eliminatedTurn === null || polity.eliminatedTurn < polity.foundedTurn || polity.eliminatedTurn >= world.turn) {
      push(violations, 'polity.eliminated-turn', `${polity.name}灭亡时间无效`, polity.id);
    }
  }
  const livingRulerIds = world.polities.filter((polity) => polity.alive).map((polity) => polity.rulerId);
  for (const duplicate of duplicateIds(livingRulerIds)) push(violations, 'polity.ruler-duplicate', `${duplicate}同时统治多个存续政权`, duplicate);

  for (const family of world.families) {
    const recorded = [...family.memberIds].sort(stableCompare);
    if (new Set(family.memberIds).size !== family.memberIds.length) push(violations, 'family.member-duplicate', `${family.name}成员缓存含重复ID`, family.id);
    const actual = world.characters.filter((character) => character.familyId === family.id).map((character) => character.id).sort(stableCompare);
    if (JSON.stringify(recorded) !== JSON.stringify(actual)) {
      push(violations, 'family.members', `${family.name}成员缓存与人物谱系不一致`, family.id);
    }
    if (!characterById.has(family.founderId)) push(violations, 'family.founder', `${family.name}创始人引用无效`, family.id);
    if (!characterById.has(family.headId)) push(violations, 'family.head', `${family.name}家主引用无效`, family.id);
    if (family.parentFamilyId && !familyById.has(family.parentFamilyId)) push(violations, 'family.parent', `${family.name}父支系引用无效`, family.id);
    if (!isFiniteRange(family.prestige, 0, 100) || !isFiniteRange(family.politicalInfluence, 0, 100) || !isWholeNonNegative(family.wealth)) {
      push(violations, 'family.metrics', `${family.name}声望、财富或政治影响无效`, family.id);
    }
    if (Object.values(family.traditions).some((value) => !isFiniteRange(value, 0, 100))) {
      push(violations, 'family.traditions', `${family.name}传统指标无效`, family.id);
    }
    const livingMembers = actual.filter((id) => characterById.get(id)?.alive);
    if (family.active) {
      const head = characterById.get(family.headId);
      if (family.extinctTurn !== null || livingMembers.length === 0 || !head?.alive || head.familyId !== family.id) {
        push(violations, 'family.active', `${family.name}存续状态、家主或成员不一致`, family.id);
      }
    } else if (family.extinctTurn === null || livingMembers.length > 0) {
      push(violations, 'family.extinct', `${family.name}绝嗣状态与成员不一致`, family.id);
    }
    for (const alliedId of family.marriageAllianceFamilyIds) {
      const allied = familyById.get(alliedId);
      if (!allied || !allied.marriageAllianceFamilyIds.includes(family.id)) {
        push(violations, 'family.marriage-alliance', `${family.name}婚盟引用不对称`, family.id);
      }
    }
  }

  const relationPairs = new Set<string>();
  for (const relation of world.relationships) {
    const pair = `${relation.sourceId}:${relation.targetId}`;
    if (relationPairs.has(pair)) push(violations, 'relationship.duplicate', `${pair}存在重复有向关系`, relation.id);
    relationPairs.add(pair);
    if (relation.sourceId === relation.targetId || !characterById.has(relation.sourceId) || !characterById.has(relation.targetId)) {
      push(violations, 'relationship.characters', `${relation.id}人物引用无效`, relation.id);
    }
    if ([relation.affinity, relation.trust, relation.fear, relation.grievance, relation.gratitude].some((value) => !isFiniteRange(value, 0, 100))) {
      push(violations, 'relationship.metrics', `${relation.id}关系指标越界`, relation.id);
    }
    if (relation.memories.length > 8) push(violations, 'relationship.memory-bound', `${relation.id}记忆超过8条上限`, relation.id);
    for (const memory of relation.memories) {
      if (memory.turn < 0 || memory.turn > world.turn || (memory.eventId && !eventById.has(memory.eventId))) {
        push(violations, 'relationship.memory', `${relation.id}存在不可追溯记忆`, relation.id);
      }
    }
  }

  for (const faction of world.factions) {
    if (!polityById.has(faction.polityId) || !characterById.has(faction.leaderId)) push(violations, 'faction.references', `${faction.name}政权或首领引用无效`, faction.id);
    if (!isFiniteRange(faction.power, 0, 100) || !isFiniteRange(faction.cohesion, 0, 100)) push(violations, 'faction.metrics', `${faction.name}权力或凝聚越界`, faction.id);
    for (const memberId of faction.memberIds) if (!characterById.has(memberId)) push(violations, 'faction.member', `${faction.name}引用未知成员${memberId}`, faction.id);
    if (faction.active) {
      const leader = characterById.get(faction.leaderId);
      if (faction.endedTurn !== null || !polityById.get(faction.polityId)?.alive || !leader?.alive || leader.polityId !== faction.polityId) {
        push(violations, 'faction.active', `${faction.name}活动状态或首领归属无效`, faction.id);
      }
      for (const memberId of faction.memberIds) {
        const member = characterById.get(memberId);
        if (!member?.alive || member.polityId !== faction.polityId) push(violations, 'faction.active-member', `${faction.name}包含非本国在世成员${memberId}`, faction.id);
      }
    } else if (faction.endedTurn === null || faction.endedTurn < faction.lastActionTurn || faction.alliedFactionIds.length > 0) {
      push(violations, 'faction.ended', `${faction.name}解散状态无效`, faction.id);
    }
    for (const alliedId of faction.alliedFactionIds) {
      const allied = factionById.get(alliedId);
      if (!allied || !allied.alliedFactionIds.includes(faction.id)) push(violations, 'faction.alliance', `${faction.name}派系联盟不对称`, faction.id);
    }
  }

  const diplomaticPairs = new Set<string>();
  for (const relation of world.diplomacy) {
    const pair = [relation.polityAId, relation.polityBId].sort(stableCompare).join(':');
    if (diplomaticPairs.has(pair)) push(violations, 'diplomacy.duplicate', `${pair}外交关系重复`, relation.id);
    diplomaticPairs.add(pair);
    if (relation.polityAId === relation.polityBId || !polityById.has(relation.polityAId) || !polityById.has(relation.polityBId)) {
      push(violations, 'diplomacy.polities', `${relation.id}政权引用无效`, relation.id);
    }
    if ([relation.threatAtoB, relation.threatBtoA, relation.trust, relation.grievance, relation.culturalAffinity, relation.tradeDependency]
      .some((value) => !isFiniteRange(value, 0, 100))) push(violations, 'diplomacy.metrics', `${relation.id}外交指标越界`, relation.id);
    if (
      (relation.tradeAgreementUntilTurn !== null
        && (!Number.isSafeInteger(relation.tradeAgreementUntilTurn) || relation.tradeAgreementUntilTurn < 0))
      || !isWholeNonNegative(relation.tributePerTurn)
      || relation.treatyEventIds.length > 12
      || relation.treatyEventIds.some((id) => !eventById.has(id))
    ) push(violations, 'diplomacy.v03-fields', `${relation.id}商约、贡额或条约凭证无效`, relation.id);
    const tributeValid = relation.status === '朝贡'
      ? relation.tributePayerId !== null
        && [relation.polityAId, relation.polityBId].includes(relation.tributePayerId)
        && relation.tributePerTurn > 0
      : relation.tributePayerId === null && relation.tributePerTurn === 0;
    if (!tributeValid) push(violations, 'diplomacy.tribute-state', `${relation.id}朝贡状态与付款义务不一致`, relation.id);
    if (relation.status === '战争' && relation.tradeAgreementUntilTurn !== null) {
      push(violations, 'diplomacy.wartime-trade', `${relation.id}战争状态仍保留有效商约`, relation.id);
    }
  }

  const activeOfficeKeys = new Set<string>();
  for (const office of world.offices) {
    if (!polityById.has(office.polityId) || !characterById.has(office.holderId)) push(violations, 'office.references', `${office.id}政权或人物引用无效`, office.id);
    if (office.regionId && !regionById.has(office.regionId)) push(violations, 'office.region', `${office.id}地区引用无效`, office.id);
    if (office.armyId && !armyById.has(office.armyId) && office.active) push(violations, 'office.army', `${office.id}活动军职引用无效`, office.id);
    if (office.fleetId && !fleetById.has(office.fleetId) && office.active) push(violations, 'office.fleet', `${office.id}活动水师职引用无效`, office.id);
    if (office.active) {
      const key = `${office.kind}:${office.holderId}:${office.regionId ?? ''}:${office.armyId ?? ''}:${office.fleetId ?? ''}`;
      if (activeOfficeKeys.has(key)) push(violations, 'office.duplicate', `${office.id}活动官职重复`, office.id);
      activeOfficeKeys.add(key);
      const holder = characterById.get(office.holderId);
      if (office.endedTurn !== null || !holder?.alive || holder.polityId !== office.polityId) {
        push(violations, 'office.active', `${office.id}活动状态、持有人生死或政权归属无效`, office.id);
      }
    } else if (office.endedTurn === null || office.endedTurn < office.appointedTurn) {
      push(violations, 'office.ended', `${office.id}离任时间无效`, office.id);
    }
  }

  for (const region of world.regions) {
    const activeCohortSize = world.backgroundPeople.filter((person) => (
      person.regionId === region.id && person.promotedCharacterId === null
    )).length;
    if (activeCohortSize > 6) push(violations, 'background.bound', `${region.name}未具名背景候补超过6人上限`, region.id);
  }
  for (const background of world.backgroundPeople) {
    if (!regionById.has(background.regionId) || !polityById.has(background.polityId)) push(violations, 'background.references', `${background.id}地区或政权引用无效`, background.id);
    if (Object.values(background.potential).some((value) => !isFiniteRange(value, 0, 100))) push(violations, 'background.potential', `${background.id}潜能越界`, background.id);
    if (!Number.isSafeInteger(background.birthTurn) || background.birthTurn > world.turn || !isFiniteRange(background.opportunity, 0, 100)) {
      push(violations, 'background.lifecycle', `${background.id}出生时间或机会值无效`, background.id);
    }
    if (background.promotedCharacterId) {
      const promoted = characterById.get(background.promotedCharacterId);
      if (!promoted || promoted.sourceStubId !== background.id || background.promotedTurn === null) push(violations, 'background.promotion', `${background.id}晋升链接无效`, background.id);
    } else if (regionById.get(background.regionId)?.controllerId !== background.polityId) {
      push(violations, 'background.controller', `${background.id}未晋升归属与地区控制者不一致`, background.id);
    }
  }

  for (const commitment of world.commitments) {
    if (!eventById.has(commitment.eventId)) push(violations, 'commitment.event', `${commitment.id}建立事件不可追溯`, commitment.id);
    if (!characterById.has(commitment.promisorId) || !characterById.has(commitment.promiseeId)) push(violations, 'commitment.characters', `${commitment.id}承诺人物引用无效`, commitment.id);
    if (commitment.polityIds.some((id) => !polityById.has(id))) push(violations, 'commitment.polities', `${commitment.id}承诺政权引用无效`, commitment.id);
    if (commitment.status === '生效') {
      if (commitment.resolvedTurn !== null || commitment.resolutionEventId !== null) push(violations, 'commitment.active', `${commitment.id}生效状态却已有结案`, commitment.id);
    } else if (commitment.resolvedTurn === null || !commitment.resolutionEventId || !eventById.has(commitment.resolutionEventId)) {
      push(violations, 'commitment.resolution', `${commitment.id}结案不可追溯`, commitment.id);
    } else if (
      (commitment.status === '履约' || commitment.status === '背约')
      && world.turn - commitment.resolvedTurn < 32
    ) {
      const expectedMemory = commitment.status === '履约' ? '恩义' : '背叛';
      const hasResolutionMemory = world.relationships.some((relationship) => relationship.memories.some((memory) => (
        memory.eventId === commitment.resolutionEventId && memory.kind === expectedMemory
      )));
      if (!hasResolutionMemory) push(violations, 'commitment.memory', `${commitment.id}${commitment.status}没有对应关系记忆`, commitment.id);
    }
  }

  const commandAssignments = new Set<string>();
  const deputyAssignments = new Set<string>();
  for (const army of world.armies) {
    if (!isWholeNonNegative(army.soldiers) || army.soldiers === 0) push(violations, 'army.soldiers', `${army.name}兵力必须为正整数`, army.id);
    if (!isWholeNonNegative(army.food)) push(violations, 'army.food', `${army.name}军粮不是非负整数`, army.id);
    if (!regionById.has(army.regionId)) push(violations, 'army.region', `${army.name}位置无效`, army.id);
    if (!regionById.has(army.originRegionId)) push(violations, 'army.origin', `${army.name}来源区域无效`, army.id);
    if (
      !isFiniteRange(army.morale, 0, 100)
      || !isFiniteRange(army.training, 0, 100)
      || !isFiniteRange(army.experience, 0, 100)
      || !isFiniteRange(army.supply, 0, 100)
    ) push(violations, 'army.metric-range', `${army.name}战备指标越界或非有限数`, army.id);
    const polity = polityById.get(army.polityId);
    if (!polity?.alive) push(violations, 'army.polity', `${army.name}属于不存在或已灭亡的政权`, army.id);
    const commander = characterById.get(army.commanderId);
    if (!commander?.alive || commander.polityId !== army.polityId || commander.commandingArmyId !== army.id) {
      push(violations, 'army.commander', `${army.name}主帅引用不一致`, army.id);
    }
    if (commandAssignments.has(army.commanderId)) push(violations, 'army.commander.duplicate', `${army.commanderId}同时统领多军`, army.id);
    commandAssignments.add(army.commanderId);
    if (army.deputyCommanderId) {
      const deputy = characterById.get(army.deputyCommanderId);
      if (
        !deputy?.alive
        || deputy.polityId !== army.polityId
        || deputy.id === army.commanderId
        || Boolean(deputy.commandingArmyId)
        || Boolean(deputy.commandingFleetId)
        || Boolean(deputy.governedRegionId)
      ) {
        push(violations, 'army.deputy', `${army.name}副将引用无效`, army.id);
      }
      if (deputyAssignments.has(army.deputyCommanderId)) {
        push(violations, 'army.deputy.duplicate', `${army.deputyCommanderId}同时担任多军副将`, army.id);
      }
      deputyAssignments.add(army.deputyCommanderId);
    }
  }

  for (const fleet of world.fleets) {
    const totalShips = fleet.warships + fleet.transports + fleet.patrolShips;
    if (!isWholeNonNegative(fleet.sailors) || fleet.sailors === 0 || !isWholeNonNegative(fleet.food)
      || !isWholeNonNegative(fleet.warships) || !isWholeNonNegative(fleet.transports) || !isWholeNonNegative(fleet.patrolShips)
      || totalShips === 0) {
      push(violations, 'fleet.stock', `${fleet.name}舰船、水手或军粮无效`, fleet.id);
    }
    if (!polityById.get(fleet.polityId)?.alive || !regionById.get(fleet.homePortRegionId)?.port) {
      push(violations, 'fleet.references', `${fleet.name}政权或母港无效`, fleet.id);
    }
    if (fleet.portRegionId && !regionById.get(fleet.portRegionId)?.port) push(violations, 'fleet.port', `${fleet.name}所在港无效`, fleet.id);
    if (fleet.seaZoneId && !seaZoneById.has(fleet.seaZoneId)) push(violations, 'fleet.sea-zone', `${fleet.name}所在海域无效`, fleet.id);
    if (fleet.portRegionId && fleet.seaZoneId) push(violations, 'fleet.location', `${fleet.name}不能同时在港与海域`, fleet.id);
    if ([fleet.morale, fleet.training, fleet.experience, fleet.readiness, fleet.repairNeed].some((value) => !isFiniteRange(value, 0, 100))) {
      push(violations, 'fleet.metrics', `${fleet.name}战备指标越界`, fleet.id);
    }
    const commander = characterById.get(fleet.commanderId);
    if (!commander?.alive || commander.polityId !== fleet.polityId || commander.commandingFleetId !== fleet.id
      || Boolean(commander.commandingArmyId) || Boolean(commander.governedRegionId)) {
      push(violations, 'fleet.commander', `${fleet.name}提督引用不一致或兼任冲突`, fleet.id);
    }
    if (commandAssignments.has(fleet.commanderId) || deputyAssignments.has(fleet.commanderId)) push(violations, 'fleet.commander.duplicate', `${fleet.commanderId}同时统领或副署多支军旅`, fleet.id);
    commandAssignments.add(fleet.commanderId);
    if (fleet.deputyCommanderId) {
      const deputy = characterById.get(fleet.deputyCommanderId);
      if (!deputy?.alive || deputy.polityId !== fleet.polityId || deputy.id === fleet.commanderId
        || Boolean(deputy.commandingArmyId) || Boolean(deputy.commandingFleetId) || Boolean(deputy.governedRegionId)) {
        push(violations, 'fleet.deputy', `${fleet.name}副将引用无效`, fleet.id);
      }
      if (deputyAssignments.has(fleet.deputyCommanderId)) push(violations, 'fleet.deputy.duplicate', `${fleet.deputyCommanderId}同时担任多军副将`, fleet.id);
      deputyAssignments.add(fleet.deputyCommanderId);
    }
  }

  for (const character of world.characters) {
    if (!regionById.has(character.locationRegionId)) push(violations, 'character.location', `${character.name}位置无效`, character.id);
    if (!polityById.has(character.polityId)) push(violations, 'character.polity', `${character.name}政权引用无效`, character.id);
    if (!isWholeNonNegative(character.age)) push(violations, 'character.age', `${character.name}年龄无效`, character.id);
    if (!familyById.has(character.familyId)) push(violations, 'character.family', `${character.name}家族引用无效`, character.id);
    if (!Number.isSafeInteger(character.birthTurn) || character.birthTurn > world.turn) push(violations, 'character.birth-turn', `${character.name}出生时间无效`, character.id);
    if (character.adultTurn !== null && (!Number.isSafeInteger(character.adultTurn) || character.adultTurn > world.turn)) push(violations, 'character.adult-turn', `${character.name}成年时间无效`, character.id);
    const characterMetrics = [
      character.leadership,
      character.governance,
      character.cunning,
      character.ambition,
      character.loyalty,
      character.caution,
      character.rebellionReadiness,
      character.renown,
      character.influence,
      character.merit,
      character.deputyExperience,
      character.insubordination,
      character.health,
    ];
    if (characterMetrics.some((value) => !isFiniteRange(value, 0, 100))) {
      push(violations, 'character.metric-range', `${character.name}能力、人格或准备度越界`, character.id);
    }
    if (!isWholeNonNegative(character.personalWealth)) push(violations, 'character.wealth', `${character.name}私人财富无效`, character.id);
    if (character.alive && character.deathTurn !== null) push(violations, 'character.alive-death', `${character.name}存活却记录死亡时间`, character.id);
    if (!character.alive && (character.deathTurn === null || character.deathTurn >= world.turn)) {
      push(violations, 'character.death-turn', `${character.name}死亡时间无效`, character.id);
    }
    if (character.alive && !polityById.get(character.polityId)?.alive) {
      push(violations, 'character.dead-polity', `${character.name}仍效忠已灭亡政权`, character.id);
    }
    if (!character.alive && (character.governedRegionId || character.commandingArmyId || character.commandingFleetId)) {
      push(violations, 'character.dead-office', `${character.name}死亡后仍持有职权`, character.id);
    }
    if (character.governedRegionId) {
      const region = regionById.get(character.governedRegionId);
      if (!region || region.controllerId !== character.polityId) {
        push(violations, 'character.governorship', `${character.name}治理不属于其政权的区域`, character.id);
      }
      if (character.commandingArmyId || character.commandingFleetId || deputyAssignments.has(character.id)) {
        push(violations, 'character.office-conflict', `${character.name}同时持有地方治理权和军团职权`, character.id);
      }
    }
    if (character.commandingArmyId) {
      const army = armyById.get(character.commandingArmyId);
      if (!army || army.commanderId !== character.id) {
        push(violations, 'character.command', `${character.name}兵权引用不一致`, character.id);
      }
    }
    if (character.commandingFleetId) {
      const fleet = fleetById.get(character.commandingFleetId);
      if (!fleet || fleet.commanderId !== character.id) {
        push(violations, 'character.fleet-command', `${character.name}水师兵权引用不一致`, character.id);
      }
    }
    if (character.activeDiseaseId && !pathogenById.has(character.activeDiseaseId)) {
      push(violations, 'character.disease', `${character.name}疾病引用无效`, character.id);
    }
    if (character.protectedUntilTurn !== null && (!Number.isSafeInteger(character.protectedUntilTurn) || character.protectedUntilTurn < 0)) {
      push(violations, 'character.protection', `${character.name}保护期限无效`, character.id);
    }
    for (const parentId of character.parentIds) {
      const parent = characterById.get(parentId);
      if (parentId === character.id || !parent) {
        push(violations, 'character.parent', `${character.name}父母引用无效`, character.id);
      } else if (parent.birthTurn > character.birthTurn - 48) {
        push(violations, 'character.parent-age', `${parent.name}与${character.name}的谱系年龄不成立`, character.id);
      }
    }
    for (const spouseId of character.spouseIds) {
      const spouse = characterById.get(spouseId);
      if (!spouse || spouseId === character.id || !spouse.spouseIds.includes(character.id)) push(violations, 'character.spouse', `${character.name}配偶引用无效或不对称`, character.id);
    }
    for (const fact of character.biography) {
      if (fact.factId !== null) {
        const sourceFact = factById.get(fact.factId);
        if (!sourceFact || !sourceFact.actorIds.includes(character.id) || fact.turn !== sourceFact.turn || fact.eventId !== null) {
          push(violations, 'character.biography-fact', `${character.name}传记事实未被对应模拟事实支持`, character.id);
        }
        continue;
      }
      if (fact.eventId === null) {
        if (fact.kind !== '旧档人物' || fact.turn !== 0) push(violations, 'character.biography-unlinked', `${character.name}存在不可追溯的新传记事实`, character.id);
        continue;
      }
      const event = eventById.get(fact.eventId);
      if (!event || !event.actorIds.includes(character.id) || fact.turn !== event.turn) push(violations, 'character.biography', `${character.name}传记事实未被对应事件支持`, character.id);
    }
    if (character.biographyDigest !== stableHash(character.biography)) {
      push(violations, 'character.biography-digest', `${character.name}传记摘要与事实不一致`, character.id);
    }
    if (character.sourceStubId) {
      const source = world.backgroundPeople.find((person) => person.id === character.sourceStubId);
      if (!source || source.promotedCharacterId !== character.id) push(violations, 'character.background-source', `${character.name}背景来源引用无效`, character.id);
    }
  }

  const ancestryState = new Map<string, 0 | 1 | 2>();
  const visitAncestry = (characterId: string): void => {
    const state = ancestryState.get(characterId) ?? 0;
    if (state === 2) return;
    if (state === 1) {
      push(violations, 'character.ancestry-cycle', `${characterId}的父母谱系存在环`, characterId);
      return;
    }
    ancestryState.set(characterId, 1);
    const character = characterById.get(characterId);
    for (const parentId of character?.parentIds ?? []) {
      if (characterById.has(parentId)) visitAncestry(parentId);
    }
    ancestryState.set(characterId, 2);
  };
  for (const character of world.characters) visitAncestry(character.id);

  if (world.characters.filter((character) => character.alive && character.tier !== '配角').length > 240) {
    push(violations, 'character.core-bound', '在世核心与背景晋升人物超过240人上限');
  }

  const governedRegions = new Set<string>();
  for (const governor of world.characters.filter((character) => character.alive && character.governedRegionId)) {
    const regionId = governor.governedRegionId as string;
    if (governedRegions.has(regionId)) push(violations, 'character.governor-duplicate', `${regionId}存在多名地方长官`, governor.id);
    governedRegions.add(regionId);
  }

  for (const war of world.wars) {
    if (war.kind !== 'interstate' && war.kind !== 'rebellion') push(violations, 'war.kind', `${war.id}战争类型无效`, war.id);
    if (!polityById.has(war.attackerId) || !polityById.has(war.defenderId) || war.attackerId === war.defenderId) {
      push(violations, 'war.participant', `${war.id}参战方引用无效`, war.id);
    }
    if (war.active && (!polityById.get(war.attackerId)?.alive || !polityById.get(war.defenderId)?.alive)) {
      push(violations, 'war.dead-participant', `${war.id}仍包含已灭亡参战方`, war.id);
    }
    if (war.startedTurn < 0 || war.startedTurn >= world.turn) push(violations, 'war.started-turn', `${war.id}开始时间无效`, war.id);
    if (war.active && war.endedTurn !== null) push(violations, 'war.active-ended', `${war.id}进行中却记录结束时间`, war.id);
    if (!war.active && (war.endedTurn === null || war.endedTurn < war.startedTurn || war.endedTurn >= world.turn)) {
      push(violations, 'war.ended-turn', `${war.id}结束时间无效`, war.id);
    }
  }

  for (const corridor of world.tradeCorridors) {
    if (!regionById.has(corridor.originRegionId) || !regionById.has(corridor.destinationRegionId)
      || corridor.originRegionId === corridor.destinationRegionId) {
      push(violations, 'trade-corridor.endpoint', `${corridor.id}商路端点无效`, corridor.id);
    }
    if (corridor.pathEdgeIds.length === 0 || corridor.pathEdgeIds.some((edgeId) => (
      !routeById.has(edgeId)
      && !world.seaLanes.some((lane) => lane.id === edgeId)
      && !world.portLinks.some((link) => link.id === edgeId)
    ))) push(violations, 'trade-corridor.path', `${corridor.id}含无效运输边`, corridor.id);
    if (![corridor.lastVolume, corridor.rollingVolume, corridor.rollingProfit].every(isWholeNonNegative)
      || !isFiniteRange(corridor.risk, 0, 100) || corridor.lastActiveTurn > world.turn) {
      push(violations, 'trade-corridor.metrics', `${corridor.id}商路账目无效`, corridor.id);
    }
  }
  if (world.tradeCorridors.length > 160) push(violations, 'trade-corridor.bound', '活动与近期商路超过160条上限');

  for (const operation of world.navalOperations) {
    const activeOperation = operation.stage !== '完成' && operation.stage !== '失败';
    if (!world.wars.some((war) => war.id === operation.warId)
      || (activeOperation && !armyById.has(operation.armyId))
      || (activeOperation && operation.fleetIds.some((id) => !fleetById.has(id)))
      || !regionById.has(operation.originRegionId) || !regionById.has(operation.targetRegionId)
      || operation.seaZonePath.some((id) => !seaZoneById.has(id))
      || !isWholeNonNegative(operation.foodLoaded) || (!activeOperation && operation.foodLoaded !== 0)
      || !isFiniteRange(operation.progress, 0, 100)) {
      push(violations, 'naval-operation.references', `${operation.id}登陆行动引用或账目无效`, operation.id);
    }
  }
  for (const project of world.shipbuildingProjects) {
    if (!polityById.has(project.polityId) || !regionById.get(project.portRegionId)?.port
      || (project.status === '建造中' && project.targetFleetId && !fleetById.has(project.targetFleetId))
      || ![project.warships, project.transports, project.patrolShips, project.timberCommitted, project.ironCommitted, project.treasurySpent]
        .every(isWholeNonNegative)
      || !isFiniteRange(project.progress, 0, 100)) {
      push(violations, 'ship-project.references', `${project.id}造船工程引用或投入无效`, project.id);
    }
  }

  if (world.pathogens.length !== 2) push(violations, 'disease.pathogen-count', `V0.3应定义2个病原，实际${world.pathogens.length}`);
  const expectedHostKeys = [
    ...world.regions.map((item) => `region:${item.id}`),
    ...world.armies.map((item) => `army:${item.id}`),
    ...world.fleets.map((item) => `fleet:${item.id}`),
  ];
  const infectionPairs = new Set<string>();
  for (const infection of world.infections) {
    const pair = `${infection.hostKind}:${infection.hostId}:${infection.pathogenId}`;
    if (infectionPairs.has(pair)) push(violations, 'disease.host-duplicate', `${pair}存在重复疾病宿主`, infection.id);
    infectionPairs.add(pair);
    const hostSize = infection.hostKind === 'region'
      ? regionById.get(infection.hostId)?.population
      : infection.hostKind === 'army'
        ? armyById.get(infection.hostId)?.soldiers
        : fleetById.get(infection.hostId)?.sailors;
    const compartmentTotal = infection.susceptible + infection.exposed + infection.infectious + infection.recovered;
    if (!pathogenById.has(infection.pathogenId) || hostSize === undefined
      || ![infection.susceptible, infection.exposed, infection.infectious, infection.recovered, infection.peakInfectious].every(isWholeNonNegative)
      || compartmentTotal !== hostSize) {
      push(violations, 'disease.host-balance', `${infection.id}宿主引用或S/E/I/R人口不平`, infection.id);
    }
    if (infection.recentSources.length > 8 || infection.recentSources.some((source) => (
      source.turn < 0 || source.turn > world.turn || !isWholeNonNegative(source.importedExposures)
    ))) push(violations, 'disease.sources', `${infection.id}传播来源无效或无界`, infection.id);
  }
  for (const hostKey of expectedHostKeys) {
    for (const pathogen of world.pathogens) {
      if (!infectionPairs.has(`${hostKey}:${pathogen.id}`)) push(violations, 'disease.host-missing', `${hostKey}缺少${pathogen.id}疾病分舱`);
    }
  }

  if (world.practices.length !== 6) push(violations, 'knowledge.practice-count', `V0.3应定义6项实践，实际${world.practices.length}`);
  const practicePairs = new Set<string>();
  for (const state of world.practiceStates) {
    const pair = `${state.regionId}:${state.practiceId}`;
    if (practicePairs.has(pair)) push(violations, 'knowledge.state-duplicate', `${pair}存在重复地方实践`, state.id);
    practicePairs.add(pair);
    if (!regionById.has(state.regionId) || !practiceById.has(state.practiceId)
      || [state.innovationProgress, state.mastery, state.adoption, state.carrierStrength].some((value) => !isFiniteRange(value, 0, 100))
      || state.carrierCharacterIds.some((id) => !characterById.has(id))
      || (state.sourceRegionId && !regionById.has(state.sourceRegionId))) {
      push(violations, 'knowledge.state', `${state.id}地方实践引用或进度无效`, state.id);
    }
  }
  for (const region of world.regions) {
    for (const practice of world.practices) {
      if (!practicePairs.has(`${region.id}:${practice.id}`)) push(violations, 'knowledge.state-missing', `${region.id}缺少${practice.id}实践状态`);
    }
  }

  let previousFactTurn = -1;
  for (const fact of world.facts) {
    if (fact.turn < previousFactTurn || fact.turn < 0 || fact.turn >= Math.max(1, world.turn)) {
      push(violations, 'fact.turn-order', `${fact.id}回合时间无效或事实未按时间排序`, fact.id);
    }
    previousFactTurn = Math.max(previousFactTurn, fact.turn);
    const factDate = getDateForTurn(fact.turn);
    if (fact.year !== factDate.year || fact.season !== factDate.season) {
      push(violations, 'fact.date', `${fact.id}纪年与回合不一致`, fact.id);
    }
    for (const actorId of fact.actorIds) {
      if (actorId && !characterById.has(actorId)) push(violations, 'fact.actor', `${fact.id}引用未知人物${actorId}`, fact.id);
    }
    for (const polityId of fact.polityIds) {
      if (!polityById.has(polityId)) push(violations, 'fact.polity', `${fact.id}引用未知政权${polityId}`, fact.id);
    }
    for (const regionId of fact.regionIds) {
      if (!regionById.has(regionId)) push(violations, 'fact.region', `${fact.id}引用未知区域${regionId}`, fact.id);
    }
    for (const sourceFactId of fact.sourceFactIds) {
      const source = factById.get(sourceFactId);
      if (!source || source.turn > fact.turn || numericIdSuffix(source.id) >= numericIdSuffix(fact.id)) {
        push(violations, 'fact.source', `${fact.id}引用未知或未来事实${sourceFactId}`, fact.id);
      }
    }
    if (fact.kind === 'war_started') {
      const war = warById.get(fact.payload.warId);
      if (!war
        || war.startedTurn !== fact.turn
        || war.kind !== fact.payload.warKind
        || war.attackerId !== fact.payload.attackerId
        || war.defenderId !== fact.payload.defenderId
        || war.goal !== fact.payload.goal
        || !sameOrderedStrings(war.targetRegionIds, fact.payload.targetRegionIds)) {
        push(violations, 'fact.war-start', `${fact.id}与权威战争起点不一致`, fact.id);
      }
    }
    if (fact.kind === 'war_ended') {
      const war = warById.get(fact.payload.warId);
      const participantIds = new Set([fact.payload.attackerId, fact.payload.defenderId]);
      if (!war
        || war.active
        || war.endedTurn !== fact.turn
        || war.attackerId !== fact.payload.attackerId
        || war.defenderId !== fact.payload.defenderId
        || fact.payload.durationTurns !== fact.turn - war.startedTurn + 1
        || !Number.isFinite(fact.payload.attackerScore)
        || !Number.isFinite(fact.payload.defenderScore)
        || !isWholeNonNegative(fact.payload.indemnity)
        || (fact.payload.winnerId !== null && !participantIds.has(fact.payload.winnerId))
        || (fact.payload.loserId !== null && !participantIds.has(fact.payload.loserId))
        || !warEndRolesAreConsistent(fact)) {
        push(violations, 'fact.war-end', `${fact.id}与权威战争结束状态不一致`, fact.id);
      }
    }
    if (fact.kind === 'situation_milestone') {
      if (fact.sourceFactIds.length === 0) {
        push(violations, 'fact.situation-source', `${fact.id}没有来源事实`, fact.id);
      }
      const retainedSituation = situationById.get(fact.payload.situationId);
      if (retainedSituation && !retainedSituation.milestoneFactIds.includes(fact.id)) {
        push(violations, 'fact.situation-link', `${fact.id}未被${retainedSituation.id}反向引用`, fact.id);
      }
    }
    const factCauseWeight = fact.causes.reduce((sum, cause) => sum + cause.weight, 0);
    if (fact.causes.length === 0
      || fact.causes.some((cause) => !Number.isFinite(cause.weight) || cause.weight < 0)
      || !Number.isFinite(factCauseWeight)
      || Math.abs(factCauseWeight - 1) > 0.011) {
      push(violations, 'fact.causes', `${fact.id}因果凭证或权重无效`, fact.id);
    }
    for (const delta of fact.stateDeltas) {
      if (delta.delta !== undefined && !Number.isFinite(delta.delta)) {
        push(violations, 'fact.delta-finite', `${fact.id}含非有限差量`, fact.id);
      }
      if (typeof delta.before === 'number' && typeof delta.after === 'number' && delta.delta !== undefined
        && Math.abs(delta.after - delta.before - delta.delta) > 1e-9) {
        push(violations, 'fact.delta', `${fact.id}差量与前后值不一致`, fact.id);
      }
    }
  }
  const expectedFactDigest = world.facts.reduce(
    (digest, fact) => stableHash([digest, fact]),
    stableHash([]),
  );
  if (world.factDigest !== expectedFactDigest) push(violations, 'fact.digest', '事实档案摘要与事实链不一致');

  // Build once from authoritative battle facts. Chronicle battle records are a
  // lossy projection (for example, most non-winter battles are unpublished),
  // so they cannot be used as career evidence.
  const firstDeputyBattleTurn = new Map<string, number>();
  for (const fact of world.facts) {
    if (fact.kind !== 'battle') continue;
    for (const force of [fact.payload.attacker, ...fact.payload.defenders]) {
      if (!force.deputyCommanderId) continue;
      firstDeputyBattleTurn.set(
        force.deputyCommanderId,
        Math.min(firstDeputyBattleTurn.get(force.deputyCommanderId) ?? fact.turn, fact.turn),
      );
    }
  }

  if (world.legacyArchiveBoundary) {
    const boundary = world.legacyArchiveBoundary;
    const boundaryDigest = world.history.slice(0, boundary.historyEventCount).reduce(
      (digest, event, index) => {
        const { sourceFactIds: _sourceFactIds, situationIds: _situationIds, ...legacyEvent } = event;
        void _sourceFactIds;
        void _situationIds;
        return index === 0 ? stableHash(legacyEvent) : stableHash([digest, legacyEvent]);
      },
      '',
    );
    if (boundary.sourceSchemaVersion < 1 || boundary.sourceSchemaVersion > 3
      || boundary.turn < 0
      || boundary.turn > world.turn
      || boundary.historyEventCount < 0
      || boundary.historyEventCount > world.history.length
      || boundary.historyDigest.length === 0
      || boundary.historyDigest !== boundaryDigest) {
      push(violations, 'fact.legacy-boundary', '旧档事实边界无效');
    }
  }

  let previousEventTurn = -1;
  for (const [eventIndex, event] of world.history.entries()) {
    for (const actorId of event.actorIds) {
      if (actorId && !characterById.has(actorId)) push(violations, 'event.actor', `${event.id}引用未知人物${actorId}`, event.id);
    }
    for (const polityId of event.polityIds) {
      if (!polityById.has(polityId)) push(violations, 'event.polity', `${event.id}引用未知政权${polityId}`, event.id);
    }
    for (const regionId of event.regionIds) {
      if (!regionById.has(regionId)) push(violations, 'event.region', `${event.id}引用未知区域${regionId}`, event.id);
    }
    for (const sourceFactId of event.sourceFactIds) {
      const source = factById.get(sourceFactId);
      if (!source || source.turn > event.turn) push(violations, 'event.source-fact', `${event.id}引用未知或未来事实${sourceFactId}`, event.id);
    }
    if (event.causes.length === 0) push(violations, 'event.causes', `${event.id}没有因果凭证`, event.id);
    const currentBoundaryIntervention = event.turn === world.turn
      && event.kind.startsWith('observer_intervention_');
    if (
      event.turn < previousEventTurn
      || event.turn < 0
      || (event.turn >= Math.max(1, world.turn) && !currentBoundaryIntervention)
    ) {
      push(violations, 'event.turn-order', `${event.id}回合时间无效或历史未按时间排序`, event.id);
    }
    previousEventTurn = Math.max(previousEventTurn, event.turn);
    const eventDate = getDateForTurn(event.turn);
    if (event.year !== eventDate.year || event.season !== eventDate.season) {
      push(violations, 'event.date', `${event.id}纪年与回合不一致`, event.id);
    }
    if (event.causes.some((cause) => !Number.isFinite(cause.weight) || cause.weight < 0)) {
      push(violations, 'event.cause-weight', `${event.id}原因权重无效`, event.id);
    }
    const causeWeight = event.causes.reduce((sum, cause) => sum + cause.weight, 0);
    if (!Number.isFinite(causeWeight) || Math.abs(causeWeight - 1) > 0.011) {
      push(violations, 'event.cause-total', `${event.id}原因权重合计不是1`, event.id);
    }
    for (const delta of event.stateDeltas) {
      if (delta.delta !== undefined && !Number.isFinite(delta.delta)) {
        push(violations, 'event.delta-finite', `${event.id}的${delta.field}差量不是有限数`, event.id);
      }
      if (
        typeof delta.before === 'number'
        && typeof delta.after === 'number'
        && delta.delta !== undefined
        && Math.abs(delta.after - delta.before - delta.delta) > 1e-9
      ) push(violations, 'event.delta', `${event.id}的${delta.field}差量与前后值不一致`, event.id);
    }
    if (event.kind === 'family_inheritance' || event.kind === 'estate_inheritance') {
      const estateDeltas = event.stateDeltas.filter((delta) => delta.field === 'personalWealth' || delta.field === 'wealth');
      const estateBalance = estateDeltas.reduce((sum, delta) => sum + (delta.delta ?? 0), 0);
      if (estateDeltas.length === 0 || estateBalance !== 0) {
        push(violations, 'event.inheritance-balance', `${event.id}家产继承差量不守恒`, event.id);
      }
    }
    if (event.kind === 'deputy_promoted') {
      const promotedId = event.stateDeltas.find((delta) => delta.field === 'commanderId')?.after;
      const firstBattleTurn = typeof promotedId === 'string' ? firstDeputyBattleTurn.get(promotedId) : undefined;
      const hasBattleEvidence = firstBattleTurn !== undefined && firstBattleTurn <= event.turn;
      const hasAgencyDecisionEvidence = event.sourceFactIds.some((factId) => {
        const fact = factById.get(factId);
        return fact?.kind === 'agency_intent_resolved'
          && fact.payload.outcome === 'executed'
          && fact.payload.actorId === promotedId;
      });
      const isLegacyArchiveEvent = eventIndex < (world.legacyArchiveBoundary?.historyEventCount ?? 0);
      if (!hasBattleEvidence && !hasAgencyDecisionEvidence && !isLegacyArchiveEvent) {
        push(
          violations,
          'event.deputy-promotion-evidence',
          `${event.id}副将晋升既无BattleFact参战履历，也无获准军令裁决`,
          event.id,
        );
      }
    }
  }

  const legacyHistoryCount = world.legacyArchiveBoundary?.historyEventCount ?? 0;
  const expectedHistoryDigest = world.history.slice(legacyHistoryCount).reduce(
    (digest, event, index) => (
      legacyHistoryCount === 0 && index === 0 ? stableHash(event) : stableHash([digest, event])
    ),
    world.legacyArchiveBoundary?.historyDigest ?? '',
  );
  if (world.historyDigest !== expectedHistoryDigest) {
    push(
      violations,
      'history.digest',
      `历史记录摘要与事件链不一致：期望${expectedHistoryDigest || '空'}，实际${world.historyDigest || '空'}，旧档边界${legacyHistoryCount}`,
    );
  }

  if (world.lastTurn) {
    const boundaryInterventions = world.history.filter((event) => (
      event.turn === world.turn && event.kind.startsWith('observer_intervention_')
    ));
    const boundaryDelta = (field: string, entityType?: string): number => boundaryInterventions.reduce(
      (sum, event) => sum + event.stateDeltas
        .filter((delta) => delta.field === field && (!entityType || delta.entityType === entityType))
        .reduce((subtotal, delta) => subtotal + (delta.delta ?? 0), 0),
      0,
    );
    const expectedLastTurn = world.turn - 1;
    const expectedLastDate = getDateForTurn(expectedLastTurn);
    if (
      world.lastTurn.turn !== expectedLastTurn
      || world.lastTurn.year !== expectedLastDate.year
      || world.lastTurn.season !== expectedLastDate.season
    ) push(violations, 'last-turn.clock', '最近季度报告与世界时钟不一致');
    const reportEventIds = new Set(world.lastTurn.eventIds);
    if (reportEventIds.size !== world.lastTurn.eventIds.length) push(violations, 'last-turn.events-duplicate', '最近季度事件ID重复');
    for (const eventId of reportEventIds) {
      const event = world.history.find((item) => item.id === eventId);
      if (!event || event.turn !== world.lastTurn.turn) push(violations, 'last-turn.event', `最近季度引用无效事件${eventId}`);
    }
    const expectedEventIds = world.history
      .filter((event) => event.turn === world.lastTurn?.turn && event.kind !== 'world_created')
      .map((event) => event.id);
    if (JSON.stringify(expectedEventIds) !== JSON.stringify(world.lastTurn.eventIds)) {
      push(violations, 'last-turn.events-exact', '最近季度事件ID不是该季历史事件的完整有序集合');
    }
    const reportFactIds = new Set(world.lastTurn.factIds);
    if (reportFactIds.size !== world.lastTurn.factIds.length) push(violations, 'last-turn.facts-duplicate', '最近季度事实ID重复');
    for (const factId of reportFactIds) {
      const fact = factById.get(factId);
      if (!fact || fact.turn !== world.lastTurn.turn) push(violations, 'last-turn.fact', `最近季度引用无效事实${factId}`);
    }
    const expectedFactIds = world.facts
      .filter((fact) => fact.turn === world.lastTurn?.turn)
      .map((fact) => fact.id);
    if (JSON.stringify(expectedFactIds) !== JSON.stringify(world.lastTurn.factIds)) {
      push(violations, 'last-turn.facts-exact', '最近季度事实ID不是该季事实的完整有序集合');
    }
    const population = world.lastTurn.population;
    const populationFields = Object.values(population);
    if (populationFields.some((value) => !isWholeNonNegative(value))) push(violations, 'ledger.population-fields', '人口账本含负数或非整数');
    const expectedPopulation = population.start + population.births - population.civilianDeaths - population.militaryDeaths;
    if (population.end !== expectedPopulation) {
      push(violations, 'ledger.population', `人口账本不平：应为${expectedPopulation}，实为${population.end}`);
    }
    const food = world.lastTurn.food;
    const foodFields = Object.values(food);
    if (foodFields.some((value) => !isWholeNonNegative(value))) push(violations, 'ledger.food-fields', '粮食账本含负数或非整数');
    const expectedFood = food.start + food.produced - food.civilianConsumed - food.armyConsumed - food.spoiled - food.warDestroyed;
    if (food.end !== expectedFood) push(violations, 'ledger.food', `粮食账本不平：应为${expectedFood}，实为${food.end}`);
    const wealth = world.lastTurn.wealth;
    const wealthFields = Object.values(wealth);
    if (wealthFields.some((value) => !isWholeNonNegative(value))) push(violations, 'ledger.wealth-fields', '财富账本含负数或非整数');
    const expectedWealth = wealth.start + wealth.produced - wealth.householdConsumed - wealth.warDestroyed;
    if (wealth.end !== expectedWealth) push(violations, 'ledger.wealth', `财富账本不平：应为${expectedWealth}，实为${wealth.end}`);
    const currentPopulation = world.regions.reduce((sum, region) => sum + region.population, 0)
      + world.armies.reduce((sum, army) => sum + army.soldiers, 0)
      + world.fleets.reduce((sum, fleet) => sum + fleet.sailors, 0);
    const currentFood = world.regions.reduce((sum, region) => sum + region.food, 0)
      + world.armies.reduce((sum, army) => sum + army.food, 0)
      + world.fleets.reduce((sum, fleet) => sum + fleet.food, 0)
      + world.navalOperations
        .filter((operation) => operation.stage !== '完成' && operation.stage !== '失败')
        .reduce((sum, operation) => sum + operation.foodLoaded, 0);
    const currentWealth = world.regions.reduce((sum, region) => sum + region.wealth, 0)
      + world.polities.reduce((sum, polity) => sum + polity.treasury, 0);
    if (population.end + boundaryDelta('population', 'region') !== currentPopulation) {
      push(violations, 'ledger.population.snapshot', '人口账本终值加边界干预差量后与世界快照不一致');
    }
    if (food.end + boundaryDelta('food', 'region') !== currentFood) {
      push(violations, 'ledger.food.snapshot', '粮食账本终值加边界干预差量后与世界快照不一致');
    }
    if (wealth.end + boundaryDelta('wealth', 'region') !== currentWealth) {
      push(violations, 'ledger.wealth.snapshot', '财富账本终值加边界干预差量后与世界快照不一致');
    }

    const nonFoodCommodities = ['木材', '铁器', '马匹', '盐', '纺织品', '奢侈品'] as const;
    for (const commodity of nonFoodCommodities) {
      const start = world.lastTurn.trade.stockStart[commodity];
      const end = world.lastTurn.trade.stockEnd[commodity];
      const produced = world.lastTurn.trade.produced[commodity] ?? 0;
      const consumed = world.lastTurn.trade.consumed[commodity] ?? 0;
      const lost = world.lastTurn.trade.lost[commodity] ?? 0;
      if (![start, end, produced, consumed, lost].every(isWholeNonNegative)) {
        push(violations, 'ledger.commodity-fields', `${commodity}商品账本含负数或非整数`);
      } else if (end !== start + produced - consumed - lost) {
        push(violations, 'ledger.commodity', `${commodity}商品账本不平：应为${start + produced - consumed - lost}，实为${end}`);
      }
      const snapshot = world.regions.reduce((sum, region) => sum + region.goods[commodity], 0);
      if (end !== snapshot) push(violations, 'ledger.commodity-snapshot', `${commodity}商品终值与世界快照不一致`);
    }
    const shipments = world.lastTurn.trade.shipments;
    if (shipments.length > 512) push(violations, 'shipment.bound', '单季Shipment超过512条上限');
    const shipmentIds = new Set<string>();
    for (const shipment of shipments) {
      if (shipmentIds.has(shipment.id)) push(violations, 'shipment.duplicate', `${shipment.id}单季重复`, shipment.id);
      shipmentIds.add(shipment.id);
      if (!regionById.has(shipment.originRegionId) || !regionById.has(shipment.destinationRegionId)
        || ![shipment.acceptedAmount, shipment.deliveredAmount, shipment.lostAmount, shipment.raidedAmount,
          shipment.peopleDeparted, shipment.peopleArrived, shipment.peopleLost, shipment.contactVolume,
          shipment.value, shipment.tariff].every(isWholeNonNegative)) {
        push(violations, 'shipment.fields', `${shipment.id}端点或数量无效`, shipment.id);
      }
      if (shipment.acceptedAmount !== shipment.deliveredAmount + shipment.lostAmount + shipment.raidedAmount) {
        push(violations, 'shipment.goods-balance', `${shipment.id} accepted != delivered + lost + raided`, shipment.id);
      }
      if (shipment.peopleDeparted !== shipment.peopleArrived + shipment.peopleLost) {
        push(violations, 'shipment.people-balance', `${shipment.id} departed != arrived + lost`, shipment.id);
      }
      if (shipment.legs.some((leg) => (
        !isWholeNonNegative(leg.capacityUsed)
        || (leg.kind === 'route' && !routeById.has(leg.edgeId))
        || (leg.kind === 'sea-lane' && !world.seaLanes.some((lane) => lane.id === leg.edgeId))
        || (leg.kind === 'port-link' && !world.portLinks.some((link) => link.id === leg.edgeId))
      ))) push(violations, 'shipment.path', `${shipment.id}含无效运输边`, shipment.id);
    }
    const migrationShipments = shipments.filter((shipment) => shipment.kind === '迁徙');
    const migration = world.lastTurn.migration;
    if (migration.departed !== migration.arrived + migration.travelDeaths
      || migration.departed !== migrationShipments.reduce((sum, shipment) => sum + shipment.peopleDeparted, 0)
      || migration.arrived !== migrationShipments.reduce((sum, shipment) => sum + shipment.peopleArrived, 0)
      || migration.travelDeaths !== migrationShipments.reduce((sum, shipment) => sum + shipment.peopleLost, 0)
      || migration.flowIds.some((id) => !shipmentIds.has(id))) {
      push(violations, 'ledger.migration', '迁徙总账与实际迁徙Shipment不一致');
    }
    const health = world.lastTurn.health;
    const infectiousSnapshot = world.infections.reduce((sum, infection) => sum + infection.infectious, 0);
    if (![health.infectiousStart, health.newExposures, health.importedExposures, health.civilianDeaths,
      health.militaryDeaths, health.infectiousEnd].every(isWholeNonNegative)
      || health.infectiousEnd + boundaryDelta('infectious', 'infection') !== infectiousSnapshot
      || health.civilianDeaths > population.civilianDeaths
      || health.militaryDeaths > population.militaryDeaths
      || health.outbreakRegionIds.some((id) => !regionById.has(id))) {
      push(violations, 'ledger.health', '疾病总账与S/E/I/R快照或人口死亡账不一致');
    }
    const knowledgeIds = [
      ...world.lastTurn.knowledge.prototypeIds,
      ...world.lastTurn.knowledge.adoptedIds,
      ...world.lastTurn.knowledge.spreadIds,
      ...world.lastTurn.knowledge.lostIds,
    ];
    if (knowledgeIds.some((id) => !world.practiceStates.some((state) => state.id === id))) {
      push(violations, 'ledger.knowledge', '知识总账引用未知地方实践');
    }

    if (!isWholeNonNegative(world.lastTurn.logistics.remoteFoodTransferred)) {
      push(violations, 'logistics.remote-total', '远程粮食转运总量必须为非负整数');
    }
    const usedRouteIds = new Set<string>();
    for (const usage of world.lastTurn.logistics.routeUsage) {
      if (usedRouteIds.has(usage.routeId)) push(violations, 'logistics.route-duplicate', `${usage.routeId}在物流账本重复出现`, usage.routeId);
      usedRouteIds.add(usage.routeId);
      const route = routeById.get(usage.routeId);
      if (!route) {
        push(violations, 'logistics.route', `物流账本引用未知路线${usage.routeId}`, usage.routeId);
        continue;
      }
      if (!isWholeNonNegative(usage.reserved) || usage.reserved > route.supplyCapacity) {
        push(
          violations,
          'logistics.capacity',
          `${usage.routeId}本季预留${usage.reserved}超过运力${route.supplyCapacity}`,
          usage.routeId,
        );
      }
      if (usage.capacity !== route.supplyCapacity) {
        push(violations, 'logistics.capacity-snapshot', `${usage.routeId}账本运力与地图定义不一致`, usage.routeId);
      }
      for (const armyId of usage.armyIds) {
        if (!world.armies.some((army) => army.id === armyId) && !world.history.some((event) => event.actorIds.includes(armyId))) {
          // Armies may be destroyed later in the same turn; their reservation remains a valid historical fact.
          if (!armyId.startsWith('a_')) push(violations, 'logistics.army', `${usage.routeId}引用无效军团${armyId}`, usage.routeId);
        }
      }
    }
    const usedSeaEdgeIds = new Set<string>();
    for (const usage of world.lastTurn.logistics.seaUsage) {
      if (usedSeaEdgeIds.has(usage.edgeId)) push(violations, 'logistics.sea-duplicate', `${usage.edgeId}在海运账本重复出现`, usage.edgeId);
      usedSeaEdgeIds.add(usage.edgeId);
      const laneCapacity = world.seaLanes.find((lane) => lane.id === usage.edgeId)?.capacity;
      const linkCapacity = world.portLinks.find((link) => link.id === usage.edgeId)?.capacity;
      const maximumEffectiveCapacity = laneCapacity !== undefined ? Math.floor(laneCapacity * 1.05) : linkCapacity;
      if (maximumEffectiveCapacity === undefined || !isWholeNonNegative(usage.capacity) || usage.capacity > maximumEffectiveCapacity
        // Multiple systems reserve the same edge at different points in a
        // quarter. Blockade/damage can change between those reservations, so
        // `capacity` is one snapshot rather than a cap for their aggregate.
        || !isWholeNonNegative(usage.reserved) || usage.reserved > maximumEffectiveCapacity
        || usage.flowIds.some((id) => !shipmentIds.has(id))) {
        push(violations, 'logistics.sea-capacity', `${usage.edgeId}海运运力或流量引用无效`, usage.edgeId);
      }
    }
  } else if (world.turn > 0) {
    push(violations, 'last-turn.missing', '已推进的世界缺少最近季度报告');
  }

  if (world.hash !== computeWorldHash(world)) push(violations, 'hash.mismatch', '世界哈希与权威状态不一致');
  return violations;
}

/** Backwards-compatible name for the exhaustive archive-scanning validator. */
export function validateWorld(world: WorldState): InvariantViolation[] {
  return validateWorldFull(world);
}

export function measureFullValidation(
  world: WorldState,
  now: () => number = validationClock,
): ValidationMeasurement {
  const startedAt = now();
  const violations = validateWorldFull(world);
  return { mode: 'full', durationMs: Math.max(0, now() - startedAt), violations };
}

export function assertWorld(world: WorldState): void {
  const violations = validateWorldFull(world);
  if (violations.length > 0) {
    throw new Error(`World invariant violation:\n${violations.map((item) => `${item.code}: ${item.message}`).join('\n')}`);
  }
}
