import {
  advanceWorldDetailed,
  computeWorldHash,
  createWorld,
  serializeWorld,
  stableHash,
  type CharacterState,
  type WorldState,
} from '../src/sim';
import {
  MAX_PLAN_STEPS,
  MAX_RECENTLY_CLOSED_GOALS,
  MAX_SECONDARY_GOALS,
  PRIMARY_GOAL_MINIMUM_TURNS,
  PRIMARY_REPLACEMENT_CONFIRMATIONS,
  ROOT_DESIRES,
  SECONDARY_GOAL_MINIMUM_TURNS,
  evaluateGoalTerminalState,
  projectCharacterAgency,
  projectCharacterDesires,
  type AgencyGoalProjection,
  type CharacterAgencyShadowProjection,
  type RootDesire,
} from '../src/sim/agency';

const DEFAULT_SEEDS = [
  '军权春秋',
  '春战副将',
  '同源世界',
  '沧海一粟',
  '赤潮',
  '归档校验',
  '副将立功',
  '北境军令',
] as const;

const MAX_REPORTED_FAILURES = 200;
const HARD_CLOSURE_REASONS = new Set<NonNullable<AgencyGoalProjection['closureReason']>>([
  'actor_dead',
  'target_missing',
  'target_dead',
  'target_polity_extinct',
  'target_family_extinct',
  'target_role_changed',
  'lost_required_position',
  'independent_command_obtained',
]);

function stableCompare(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function positiveIntegerFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, received ${raw}`);
  }
  return value;
}

function positiveNumberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number, received ${raw}`);
  }
  return value;
}

const configuredSeeds = process.env.PHASE_C_AGENCY_AUDIT_SEEDS
  ?.split(',')
  .map((seed) => seed.trim())
  .filter(Boolean);
const seeds = configuredSeeds?.length ? configuredSeeds : [...DEFAULT_SEEDS];
const turns = positiveIntegerFromEnv('PHASE_C_AGENCY_AUDIT_TURNS', 80);
const representativeLimit = positiveIntegerFromEnv('PHASE_C_AGENCY_AUDIT_REPRESENTATIVES', 8);
const serializationInterval = positiveIntegerFromEnv('PHASE_C_AGENCY_AUDIT_SERIALIZE_INTERVAL', 4);
const maximumSingleProjectionP95Ms = positiveNumberFromEnv('PHASE_C_AGENCY_AUDIT_MAX_SINGLE_P95_MS', 12);
const maximumBatchProjectionP95Ms = positiveNumberFromEnv('PHASE_C_AGENCY_AUDIT_MAX_BATCH_P95_MS', 80);

interface DesireDistribution {
  observations: number;
  coreCount: number;
  minimumWeight: number;
  maximumWeight: number;
  totalWeight: number;
}

interface MutableMetrics {
  projectionChecks: number;
  repeatedDeterminismChecks: number;
  worldHashPurityChecks: number;
  fullSerializationPurityChecks: number;
  contractChecks: number;
  noPreviousIdentityChecks: number;
  crossModeIdentityChecks: number;
  transitionIdentityChecks: number;
  inertiaChecks: number;
  hardTerminalChecks: number;
  hardTerminalClosures: number;
  primaryReplacements: number;
  maximumRepresentatives: number;
  maximumActiveGoals: number;
  maximumPlanSteps: number;
  maximumClosedGoals: number;
  singleProjectionTimingsMs: number[];
  noPreviousProjectionTimingsMs: number[];
  representativeBatchTimingsMs: number[];
  desireProjectionTimingsMs: number[];
  simulationTimingsMs: number[];
  distribution: Record<RootDesire, DesireDistribution>;
}

interface SeedSample {
  seed: string;
  finalTurn: number;
  finalHash: string;
  sampledCharacters: number;
  projectionSequenceDigest: string;
  representativeBatchTiming: ReturnType<typeof timingSummary>;
  singleProjectionTiming: ReturnType<typeof timingSummary>;
  maximumActiveGoals: number;
  maximumPlanSteps: number;
}

const failures: string[] = [];
let failureCount = 0;

function fail(seed: string, turn: number, message: string): void {
  failureCount += 1;
  if (failures.length < MAX_REPORTED_FAILURES) failures.push(`${seed}@T${turn}: ${message}`);
}

function createMetrics(): MutableMetrics {
  const distribution = Object.fromEntries(ROOT_DESIRES.map((kind) => [kind, {
    observations: 0,
    coreCount: 0,
    minimumWeight: Number.POSITIVE_INFINITY,
    maximumWeight: Number.NEGATIVE_INFINITY,
    totalWeight: 0,
  }])) as Record<RootDesire, DesireDistribution>;
  return {
    projectionChecks: 0,
    repeatedDeterminismChecks: 0,
    worldHashPurityChecks: 0,
    fullSerializationPurityChecks: 0,
    contractChecks: 0,
    noPreviousIdentityChecks: 0,
    crossModeIdentityChecks: 0,
    transitionIdentityChecks: 0,
    inertiaChecks: 0,
    hardTerminalChecks: 0,
    hardTerminalClosures: 0,
    primaryReplacements: 0,
    maximumRepresentatives: 0,
    maximumActiveGoals: 0,
    maximumPlanSteps: 0,
    maximumClosedGoals: 0,
    singleProjectionTimingsMs: [],
    noPreviousProjectionTimingsMs: [],
    representativeBatchTimingsMs: [],
    desireProjectionTimingsMs: [],
    simulationTimingsMs: [],
    distribution,
  };
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.min(ordered.length - 1, Math.max(0, Math.ceil(ordered.length * fraction) - 1));
  return ordered[index] ?? 0;
}

function timingSummary(values: readonly number[]) {
  return {
    samples: values.length,
    p50Ms: Number(percentile(values, 0.5).toFixed(3)),
    p95Ms: Number(percentile(values, 0.95).toFixed(3)),
    maxMs: Number(Math.max(0, ...values).toFixed(3)),
  };
}

function mergeMetrics(target: MutableMetrics, source: MutableMetrics): void {
  target.projectionChecks += source.projectionChecks;
  target.repeatedDeterminismChecks += source.repeatedDeterminismChecks;
  target.worldHashPurityChecks += source.worldHashPurityChecks;
  target.fullSerializationPurityChecks += source.fullSerializationPurityChecks;
  target.contractChecks += source.contractChecks;
  target.noPreviousIdentityChecks += source.noPreviousIdentityChecks;
  target.crossModeIdentityChecks += source.crossModeIdentityChecks;
  target.transitionIdentityChecks += source.transitionIdentityChecks;
  target.inertiaChecks += source.inertiaChecks;
  target.hardTerminalChecks += source.hardTerminalChecks;
  target.hardTerminalClosures += source.hardTerminalClosures;
  target.primaryReplacements += source.primaryReplacements;
  target.maximumRepresentatives = Math.max(target.maximumRepresentatives, source.maximumRepresentatives);
  target.maximumActiveGoals = Math.max(target.maximumActiveGoals, source.maximumActiveGoals);
  target.maximumPlanSteps = Math.max(target.maximumPlanSteps, source.maximumPlanSteps);
  target.maximumClosedGoals = Math.max(target.maximumClosedGoals, source.maximumClosedGoals);
  target.singleProjectionTimingsMs.push(...source.singleProjectionTimingsMs);
  target.noPreviousProjectionTimingsMs.push(...source.noPreviousProjectionTimingsMs);
  target.representativeBatchTimingsMs.push(...source.representativeBatchTimingsMs);
  target.desireProjectionTimingsMs.push(...source.desireProjectionTimingsMs);
  target.simulationTimingsMs.push(...source.simulationTimingsMs);
  for (const kind of ROOT_DESIRES) {
    const destination = target.distribution[kind];
    const item = source.distribution[kind];
    destination.observations += item.observations;
    destination.coreCount += item.coreCount;
    destination.minimumWeight = Math.min(destination.minimumWeight, item.minimumWeight);
    destination.maximumWeight = Math.max(destination.maximumWeight, item.maximumWeight);
    destination.totalWeight += item.totalWeight;
  }
}

function characterGrievance(world: WorldState, characterId: string): number {
  return world.relationships
    .filter((relationship) => relationship.sourceId === characterId)
    .reduce((maximum, relationship) => Math.max(maximum, relationship.grievance), 0);
}

function selectRepresentatives(world: WorldState): CharacterState[] {
  const alive = world.characters.filter((character) => character.alive);
  const byId = new Map<string, CharacterState>();
  const add = (character: CharacterState | undefined): void => {
    if (character) byId.set(character.id, character);
  };
  for (const polity of world.polities.filter((item) => item.alive).sort((left, right) => stableCompare(left.id, right.id))) {
    add(alive.find((character) => character.id === polity.rulerId));
  }
  add(alive.find((character) => world.armies.some((army) => army.commanderId === character.id)));
  add(alive.find((character) => world.armies.some((army) => army.deputyCommanderId === character.id)));
  add(alive.find((character) => world.fleets.some((fleet) => fleet.commanderId === character.id)));
  add(alive.find((character) => world.fleets.some((fleet) => fleet.deputyCommanderId === character.id)));
  add([...alive].sort((left, right) => right.ambition - left.ambition || left.loyalty - right.loyalty || stableCompare(left.id, right.id))[0]);
  add([...alive].sort((left, right) => right.governance - left.governance || stableCompare(left.id, right.id))[0]);
  add([...alive].sort((left, right) => right.caution - left.caution || stableCompare(left.id, right.id))[0]);
  add([...alive].sort((left, right) => characterGrievance(world, right.id) - characterGrievance(world, left.id) || stableCompare(left.id, right.id))[0]);
  return [...byId.values()].sort((left, right) => stableCompare(left.id, right.id)).slice(0, representativeLimit);
}

function activeGoals(projection: CharacterAgencyShadowProjection): AgencyGoalProjection[] {
  return [
    ...(projection.primaryGoal ? [projection.primaryGoal] : []),
    ...projection.secondaryGoals,
  ];
}

function goalIdentityBySignature(projection: CharacterAgencyShadowProjection): Map<string, string> {
  return new Map(activeGoals(projection).map((goal) => [goal.signature, goal.id]));
}

function planIdentityByGoal(projection: CharacterAgencyShadowProjection): Map<string, string> {
  return new Map(projection.plans.filter((plan) => plan.status === 'active').map((plan) => [plan.goalId, plan.id]));
}

function updateDesireDistribution(
  seed: string,
  world: WorldState,
  characterId: string,
  metrics: MutableMetrics,
): void {
  const startedAt = performance.now();
  const desire = projectCharacterDesires(world, characterId);
  metrics.desireProjectionTimingsMs.push(performance.now() - startedAt);
  const kinds = desire.axes.map((axis) => axis.kind);
  if (desire.axes.length !== ROOT_DESIRES.length
    || new Set(kinds).size !== ROOT_DESIRES.length
    || ROOT_DESIRES.some((kind) => !kinds.includes(kind))) {
    fail(seed, world.turn, `${characterId} does not expose exactly the eight root desires`);
  }
  if (desire.coreDesireKinds.length !== 2 || desire.axes.filter((axis) => axis.core).length !== 2) {
    fail(seed, world.turn, `${characterId} does not expose exactly two core desires`);
  }
  if (desire.pressures.length > 4) fail(seed, world.turn, `${characterId} exposes more than four dynamic pressures`);
  for (const axis of desire.axes) {
    const item = metrics.distribution[axis.kind];
    item.observations += 1;
    item.coreCount += axis.core ? 1 : 0;
    item.minimumWeight = Math.min(item.minimumWeight, axis.weight);
    item.maximumWeight = Math.max(item.maximumWeight, axis.weight);
    item.totalWeight += axis.weight;
    if (!Number.isInteger(axis.weight) || axis.weight < 0 || axis.weight > 100) {
      fail(seed, world.turn, `${characterId}/${axis.kind} has invalid weight ${axis.weight}`);
    }
  }
}

function auditProjectionContract(
  seed: string,
  world: WorldState,
  projection: CharacterAgencyShadowProjection,
  metrics: MutableMetrics,
): void {
  metrics.contractChecks += 1;
  if (projection.seed !== world.seed
    || projection.characterId.length === 0
    || projection.reviewedTurn !== world.turn
    || projection.sourceWorldHash !== world.hash) {
    fail(seed, world.turn, `${projection.characterId} projection is not anchored to the current world`);
  }
  const goals = activeGoals(projection);
  metrics.maximumActiveGoals = Math.max(metrics.maximumActiveGoals, goals.length);
  metrics.maximumClosedGoals = Math.max(metrics.maximumClosedGoals, projection.recentlyClosedGoals.length);
  if (projection.availability === 'active' && projection.primaryGoal === null) {
    fail(seed, world.turn, `${projection.characterId} is active without a primary goal`);
  }
  if (projection.secondaryGoals.length > MAX_SECONDARY_GOALS) {
    fail(seed, world.turn, `${projection.characterId} has ${projection.secondaryGoals.length} secondary goals`);
  }
  if (goals.length > 1 + MAX_SECONDARY_GOALS) {
    fail(seed, world.turn, `${projection.characterId} exceeds the 1+2 active goal cap`);
  }
  if (projection.recentlyClosedGoals.length > MAX_RECENTLY_CLOSED_GOALS) {
    fail(seed, world.turn, `${projection.characterId} exceeds the recently-closed goal cap`);
  }
  if (new Set(goals.map((goal) => goal.id)).size !== goals.length) {
    fail(seed, world.turn, `${projection.characterId} has duplicate active goal IDs`);
  }
  if (new Set(goals.map((goal) => goal.signature)).size !== goals.length) {
    fail(seed, world.turn, `${projection.characterId} has duplicate active goal signatures`);
  }
  const goalIds = new Set(goals.map((goal) => goal.id));
  if (new Set(projection.plans.map((plan) => plan.id)).size !== projection.plans.length) {
    fail(seed, world.turn, `${projection.characterId} has duplicate plan IDs`);
  }
  for (const plan of projection.plans) {
    metrics.maximumPlanSteps = Math.max(metrics.maximumPlanSteps, plan.steps.length);
    if (plan.steps.length > MAX_PLAN_STEPS) {
      fail(seed, world.turn, `${plan.id} exceeds the five-step plan cap`);
    }
    if (plan.status === 'active' && !goalIds.has(plan.goalId)) {
      fail(seed, world.turn, `${plan.id} does not belong to an active goal`);
    }
    if (new Set(plan.steps.map((step) => step.id)).size !== plan.steps.length) {
      fail(seed, world.turn, `${plan.id} has duplicate step IDs`);
    }
    if (plan.steps.filter((step) => step.status === 'available').length > 1) {
      fail(seed, world.turn, `${plan.id} exposes more than one available step`);
    }
  }
  if (projection.primaryGoal
    && projection.primaryGoal.minimumCommitUntilTurn < projection.primaryGoal.createdTurn + PRIMARY_GOAL_MINIMUM_TURNS) {
    fail(seed, world.turn, `${projection.primaryGoal.id} does not carry the four-quarter primary inertia`);
  }
  for (const goal of projection.secondaryGoals) {
    if (goal.minimumCommitUntilTurn < goal.createdTurn + SECONDARY_GOAL_MINIMUM_TURNS) {
      fail(seed, world.turn, `${goal.id} does not carry the secondary inertia contract`);
    }
  }
}

function auditNoPreviousIdentity(
  seed: string,
  world: WorldState,
  previous: CharacterAgencyShadowProjection | undefined,
  current: CharacterAgencyShadowProjection,
  metrics: MutableMetrics,
): void {
  if (!previous) return;
  const previousGoals = goalIdentityBySignature(previous);
  const currentGoals = goalIdentityBySignature(current);
  const previousPlans = planIdentityByGoal(previous);
  const currentPlans = planIdentityByGoal(current);
  for (const [signature, goalId] of previousGoals) {
    const nextGoalId = currentGoals.get(signature);
    if (!nextGoalId) continue;
    metrics.noPreviousIdentityChecks += 1;
    if (nextGoalId !== goalId) {
      fail(seed, world.turn, `${current.characterId}/${signature} changed no-previous goal identity ${goalId} -> ${nextGoalId}`);
    }
    const previousPlanId = previousPlans.get(goalId);
    if (previousPlanId && currentPlans.get(nextGoalId) !== previousPlanId) {
      fail(seed, world.turn, `${current.characterId}/${signature} changed no-previous plan identity`);
    }
  }
}

function auditCrossModeIdentity(
  seed: string,
  world: WorldState,
  transitioned: CharacterAgencyShadowProjection,
  fresh: CharacterAgencyShadowProjection,
  metrics: MutableMetrics,
): void {
  const transitionedGoals = goalIdentityBySignature(transitioned);
  const freshGoals = goalIdentityBySignature(fresh);
  const transitionedPlans = planIdentityByGoal(transitioned);
  const freshPlans = planIdentityByGoal(fresh);
  for (const [signature, goalId] of transitionedGoals) {
    const freshGoalId = freshGoals.get(signature);
    if (!freshGoalId) continue;
    metrics.crossModeIdentityChecks += 1;
    if (freshGoalId !== goalId) {
      fail(seed, world.turn, `${transitioned.characterId}/${signature} differs between transition and fresh goal identity`);
      continue;
    }
    const transitionedPlanId = transitionedPlans.get(goalId);
    if (transitionedPlanId && freshPlans.get(freshGoalId) !== transitionedPlanId) {
      fail(seed, world.turn, `${transitioned.characterId}/${signature} differs between transition and fresh plan identity`);
    }
  }
}

function auditTransition(
  seed: string,
  world: WorldState,
  previous: CharacterAgencyShadowProjection | undefined,
  current: CharacterAgencyShadowProjection,
  metrics: MutableMetrics,
): void {
  if (!previous || previous.reviewedTurn !== world.turn - 1) return;
  const previousPrimary = previous.primaryGoal;
  if (previousPrimary) {
    const terminal = evaluateGoalTerminalState(world, previousPrimary);
    if (terminal.status !== 'active') {
      metrics.hardTerminalChecks += 1;
      const closed = current.recentlyClosedGoals.find((goal) => goal.id === previousPrimary.id);
      if (!closed || closed.status !== terminal.status || closed.closureReason !== terminal.reason) {
        fail(seed, world.turn, `${previousPrimary.id} did not preserve its hard terminal result`);
      } else {
        metrics.hardTerminalClosures += 1;
      }
    }
  }
  const currentPrimary = current.primaryGoal;
  if (!previousPrimary || !currentPrimary || previousPrimary.id === currentPrimary.id) {
    if (previousPrimary && currentPrimary?.id === previousPrimary.id) metrics.transitionIdentityChecks += 1;
    return;
  }
  metrics.primaryReplacements += 1;
  const closed = current.recentlyClosedGoals.find((goal) => goal.id === previousPrimary.id);
  if (!closed) {
    fail(seed, world.turn, `${previousPrimary.id} disappeared without a bounded closure record`);
    return;
  }
  if (closed.closureReason === 'superseded_after_inertia') {
    metrics.inertiaChecks += 1;
    if (world.turn < previousPrimary.minimumCommitUntilTurn) {
      fail(seed, world.turn, `${previousPrimary.id} was superseded inside its four-quarter inertia`);
    }
  } else if (!closed.closureReason || !HARD_CLOSURE_REASONS.has(closed.closureReason)) {
    fail(seed, world.turn, `${previousPrimary.id} changed for unsupported reason ${String(closed.closureReason)}`);
  }
}

function publicDistribution(metrics: MutableMetrics) {
  return Object.fromEntries(ROOT_DESIRES.map((kind) => {
    const item = metrics.distribution[kind];
    return [kind, {
      observations: item.observations,
      coreCount: item.coreCount,
      coreShare: item.observations > 0 ? Number((item.coreCount / item.observations).toFixed(4)) : 0,
      minimumWeight: Number.isFinite(item.minimumWeight) ? item.minimumWeight : 0,
      maximumWeight: Number.isFinite(item.maximumWeight) ? item.maximumWeight : 0,
      averageWeight: item.observations > 0 ? Number((item.totalWeight / item.observations).toFixed(3)) : 0,
    }];
  }));
}

function runSeed(seed: string): { sample: SeedSample; metrics: MutableMetrics } {
  let world = createWorld(seed);
  const metrics = createMetrics();
  const transitionByCharacter = new Map<string, CharacterAgencyShadowProjection>();
  const noPreviousByCharacter = new Map<string, CharacterAgencyShadowProjection>();
  const sequence: Array<{ turn: number; characterId: string; digest: string }> = [];
  const sampledCharacterIds = new Set<string>();

  // Opening distribution is deliberately exhaustive: it is cheap before the
  // Fact archive grows and catches seed/origin/family bias across all 192 names.
  const openingSerialization = serializeWorld(world);
  for (const character of world.characters) {
    updateDesireDistribution(seed, world, character.id, metrics);
  }
  if (serializeWorld(world) !== openingSerialization || world.hash !== computeWorldHash(world)) {
    fail(seed, world.turn, 'opening desire distribution mutated the world');
  }
  metrics.fullSerializationPurityChecks += 1;

  for (let checkpoint = 0; checkpoint <= turns; checkpoint += 1) {
    if (checkpoint > 0) {
      const advanced = advanceWorldDetailed(world);
      world = advanced.world;
      metrics.simulationTimingsMs.push(advanced.timings.totalMs);
    }
    const beforeHash = world.hash;
    const shouldSerialize = world.turn % serializationInterval === 0 || world.turn === turns;
    const beforeSerialization = shouldSerialize ? serializeWorld(world) : null;
    const representatives = selectRepresentatives(world);
    metrics.maximumRepresentatives = Math.max(metrics.maximumRepresentatives, representatives.length);
    const batchStartedAt = performance.now();

    for (const character of representatives) {
      sampledCharacterIds.add(character.id);
      const previous = transitionByCharacter.get(character.id);
      const adjacentPrevious = previous?.reviewedTurn === world.turn - 1 ? previous : null;
      const startedAt = performance.now();
      const first = projectCharacterAgency(world, character.id, adjacentPrevious);
      metrics.singleProjectionTimingsMs.push(performance.now() - startedAt);
      const repeated = projectCharacterAgency(world, character.id, adjacentPrevious);
      metrics.projectionChecks += 1;
      metrics.repeatedDeterminismChecks += 1;
      if (JSON.stringify(first) !== JSON.stringify(repeated)) {
        fail(seed, world.turn, `${character.id} repeated projection is not deterministic`);
      }
      auditProjectionContract(seed, world, first, metrics);
      auditTransition(seed, world, adjacentPrevious ?? undefined, first, metrics);
      transitionByCharacter.set(character.id, first);

      const noPreviousStartedAt = performance.now();
      const snapshot = projectCharacterAgency(world, character.id);
      metrics.noPreviousProjectionTimingsMs.push(performance.now() - noPreviousStartedAt);
      auditProjectionContract(seed, world, snapshot, metrics);
      auditNoPreviousIdentity(seed, world, noPreviousByCharacter.get(character.id), snapshot, metrics);
      auditCrossModeIdentity(seed, world, first, snapshot, metrics);
      noPreviousByCharacter.set(character.id, snapshot);

      updateDesireDistribution(seed, world, character.id, metrics);
      sequence.push({ turn: world.turn, characterId: character.id, digest: stableHash(first) });
    }
    metrics.representativeBatchTimingsMs.push(performance.now() - batchStartedAt);
    metrics.worldHashPurityChecks += 1;
    if (world.hash !== beforeHash || computeWorldHash(world) !== beforeHash) {
      fail(seed, world.turn, 'representative Agency projections mutated authoritative world state or hash');
    }
    if (beforeSerialization !== null) {
      metrics.fullSerializationPurityChecks += 1;
      if (serializeWorld(world) !== beforeSerialization) {
        fail(seed, world.turn, 'Agency projections mutated the serialized world at a purity checkpoint');
      }
    }
  }

  return {
    metrics,
    sample: {
      seed,
      finalTurn: world.turn,
      finalHash: world.hash,
      sampledCharacters: sampledCharacterIds.size,
      projectionSequenceDigest: stableHash(sequence),
      representativeBatchTiming: timingSummary(metrics.representativeBatchTimingsMs),
      singleProjectionTiming: timingSummary(metrics.singleProjectionTimingsMs),
      maximumActiveGoals: metrics.maximumActiveGoals,
      maximumPlanSteps: metrics.maximumPlanSteps,
    },
  };
}

const aggregate = createMetrics();
const samples: SeedSample[] = [];
for (const seed of seeds) {
  try {
    const result = runSeed(seed);
    samples.push(result.sample);
    mergeMetrics(aggregate, result.metrics);
  } catch (error) {
    fail(seed, -1, `audit aborted: ${error instanceof Error ? error.message : String(error)}`);
  }
}

for (const kind of ROOT_DESIRES) {
  const distribution = aggregate.distribution[kind];
  if (distribution.observations === 0) failures.push(`${kind}: root desire was never observed`);
  if (distribution.coreCount === 0) failures.push(`${kind}: root desire never appeared in a core slot`);
}

const singleProjection = timingSummary(aggregate.singleProjectionTimingsMs);
const representativeBatch = timingSummary(aggregate.representativeBatchTimingsMs);
if (singleProjection.p95Ms > maximumSingleProjectionP95Ms) {
  failures.push(`single Agency projection P95 ${singleProjection.p95Ms}ms exceeds ${maximumSingleProjectionP95Ms}ms`);
}
if (representativeBatch.p95Ms > maximumBatchProjectionP95Ms) {
  failures.push(`representative Agency batch P95 ${representativeBatch.p95Ms}ms exceeds ${maximumBatchProjectionP95Ms}ms`);
}
failureCount += Math.max(0, failures.length - failureCount);

console.log(JSON.stringify({
  phase: 'C06-C07',
  scope: {
    seeds: seeds.length,
    quartersPerSeed: turns,
    representativeLimit,
    serializationInterval,
    openingCharactersAudited: seeds.length * 192,
  },
  contract: {
    rootDesires: ROOT_DESIRES,
    primaryGoals: 1,
    maximumSecondaryGoals: MAX_SECONDARY_GOALS,
    maximumPlanSteps: MAX_PLAN_STEPS,
    primaryMinimumQuarters: PRIMARY_GOAL_MINIMUM_TURNS,
    primaryReplacementConfirmations: PRIMARY_REPLACEMENT_CONFIRMATIONS,
    secondaryMinimumQuarters: SECONDARY_GOAL_MINIMUM_TURNS,
    maximumRecentlyClosedGoals: MAX_RECENTLY_CLOSED_GOALS,
    maximumSingleProjectionP95Ms,
    maximumBatchProjectionP95Ms,
  },
  metrics: {
    projectionChecks: aggregate.projectionChecks,
    repeatedDeterminismChecks: aggregate.repeatedDeterminismChecks,
    worldHashPurityChecks: aggregate.worldHashPurityChecks,
    fullSerializationPurityChecks: aggregate.fullSerializationPurityChecks,
    contractChecks: aggregate.contractChecks,
    noPreviousIdentityChecks: aggregate.noPreviousIdentityChecks,
    crossModeIdentityChecks: aggregate.crossModeIdentityChecks,
    transitionIdentityChecks: aggregate.transitionIdentityChecks,
    inertiaChecks: aggregate.inertiaChecks,
    hardTerminalChecks: aggregate.hardTerminalChecks,
    hardTerminalClosures: aggregate.hardTerminalClosures,
    primaryReplacements: aggregate.primaryReplacements,
    maximumRepresentatives: aggregate.maximumRepresentatives,
    maximumActiveGoals: aggregate.maximumActiveGoals,
    maximumPlanSteps: aggregate.maximumPlanSteps,
    maximumClosedGoals: aggregate.maximumClosedGoals,
    timings: {
      singleProjection,
      noPreviousProjection: timingSummary(aggregate.noPreviousProjectionTimingsMs),
      representativeBatch,
      desireProjection: timingSummary(aggregate.desireProjectionTimingsMs),
      simulation: timingSummary(aggregate.simulationTimingsMs),
    },
    desireDistribution: publicDistribution(aggregate),
  },
  samples,
  failureCount,
  failures: failures.slice(0, MAX_REPORTED_FAILURES),
  omittedFailures: Math.max(0, failureCount - MAX_REPORTED_FAILURES),
}, null, 2));

if (failureCount > 0) process.exitCode = 1;
