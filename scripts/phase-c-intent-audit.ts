import {
  advanceWorld,
  advanceWorldDetailed,
  createWorld,
  deserializeWorld,
  serializeWorld,
  validateTurnRuntime,
  validateWorldFull,
  type SimulationFact,
  type WorldState,
} from '../src/sim';
import {
  MAX_AGENCY_DECISION_ACTORS,
  MAX_AGENCY_INTENTS_PER_TURN,
  validateAgencyDecisionSystemState,
} from '../src/sim/agency';

const DEFAULT_SEEDS = [
  '军权春秋',
  '北境军令',
  '沧衡将星',
  '关河旧梦',
  '东海风云',
  '燕云逐鹿',
] as const;
const MAX_REPORTED_FAILURES = 120;

function positiveIntegerFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, received ${raw}`);
  }
  return parsed;
}

function positiveNumberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number, received ${raw}`);
  }
  return parsed;
}

const configuredSeeds = process.env.PHASE_C_INTENT_AUDIT_SEEDS
  ?.split(',')
  .map((seed) => seed.trim())
  .filter(Boolean);
const seeds = configuredSeeds?.length ? configuredSeeds : [...DEFAULT_SEEDS];
const turns = positiveIntegerFromEnv('PHASE_C_INTENT_AUDIT_TURNS', 80);
const fullValidationInterval = positiveIntegerFromEnv('PHASE_C_INTENT_AUDIT_FULL_INTERVAL', 20);
const maximumAgencyPhaseP95Ms = positiveNumberFromEnv('PHASE_C_INTENT_AUDIT_MAX_PHASE_P95_MS', 25);
const maximumSubmissionsPerWorld = positiveIntegerFromEnv('PHASE_C_INTENT_AUDIT_MAX_SUBMISSIONS', 40);
const maximumExecutionsPerWorld = positiveIntegerFromEnv('PHASE_C_INTENT_AUDIT_MAX_EXECUTIONS', 20);

type ResolutionFact = Extract<SimulationFact, { kind: 'agency_intent_resolved' }>;

interface OutcomeCounts {
  executed: number;
  rejected: number;
  deferred: number;
  invalidated: number;
}

interface SeedSample extends OutcomeCounts {
  seed: string;
  finalTurn: number;
  finalHash: string;
  submitted: number;
  maximumSubmittedInQuarter: number;
  maximumDecisionActors: number;
  saveResumeExact: boolean;
}

const failures: string[] = [];
let failureCount = 0;
let runtimeChecks = 0;
let fullChecks = 0;
let decisionStateChecks = 0;
let saveRoundtrips = 0;
let resumedQuarters = 0;
const agencyPhaseTimingsMs: number[] = [];

function fail(seed: string, turn: number, message: string): void {
  failureCount += 1;
  if (failures.length < MAX_REPORTED_FAILURES) failures.push(`${seed}@T${turn}: ${message}`);
}

function check(condition: boolean, seed: string, turn: number, message: string): void {
  if (!condition) fail(seed, turn, message);
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.max(0, Math.ceil(ordered.length * fraction) - 1))] ?? 0;
}

function timingSummary(values: readonly number[]) {
  return {
    samples: values.length,
    p50Ms: Number(percentile(values, 0.5).toFixed(3)),
    p95Ms: Number(percentile(values, 0.95).toFixed(3)),
    maxMs: Number(Math.max(0, ...values).toFixed(3)),
  };
}

function appendedDecisionFacts(previous: WorldState, next: WorldState): {
  submitted: SimulationFact[];
  resolved: ResolutionFact[];
} {
  const appended = next.facts.slice(previous.facts.length);
  return {
    submitted: appended.filter((fact) => fact.kind === 'agency_intent_submitted'),
    resolved: appended.filter((fact): fact is ResolutionFact => fact.kind === 'agency_intent_resolved'),
  };
}

function auditCompletedQuarter(previous: WorldState, next: WorldState): void {
  runtimeChecks += 1;
  for (const violation of validateTurnRuntime(previous, next)) {
    fail(next.seed, previous.turn, `${violation.code}: ${violation.message}`);
  }
  decisionStateChecks += 1;
  for (const message of validateAgencyDecisionSystemState(next)) fail(next.seed, previous.turn, message);
  const decisionFacts = appendedDecisionFacts(previous, next);
  check(
    decisionFacts.submitted.length === decisionFacts.resolved.length,
    next.seed,
    previous.turn,
    `submitted/resolved mismatch ${decisionFacts.submitted.length}/${decisionFacts.resolved.length}`,
  );
  check(
    decisionFacts.submitted.length <= MAX_AGENCY_INTENTS_PER_TURN,
    next.seed,
    previous.turn,
    `quarter intent count ${decisionFacts.submitted.length} exceeds ${MAX_AGENCY_INTENTS_PER_TURN}`,
  );
  check(
    next.agencyDecisionSystem.actors.length <= MAX_AGENCY_DECISION_ACTORS,
    next.seed,
    previous.turn,
    `decision actor count ${next.agencyDecisionSystem.actors.length} exceeds ${MAX_AGENCY_DECISION_ACTORS}`,
  );
}

function replayFromSave(seed: string, serialized: string, remainingTurns: number): WorldState {
  let world = deserializeWorld(serialized);
  saveRoundtrips += 1;
  check(serializeWorld(world) === serialized, seed, world.turn, 'save roundtrip changed authoritative serialization');
  for (let index = 0; index < remainingTurns; index += 1) {
    const previous = world;
    world = advanceWorld(previous);
    resumedQuarters += 1;
    auditCompletedQuarter(previous, world);
  }
  return world;
}

function runSeed(seed: string): SeedSample {
  let world = createWorld(seed);
  const splitTurn = Math.floor(turns / 2);
  let checkpoint: string | null = null;
  let maximumSubmittedInQuarter = 0;
  let maximumDecisionActors = 0;
  for (let index = 0; index < turns; index += 1) {
    const previous = world;
    const detailed = advanceWorldDetailed(previous);
    world = detailed.world;
    agencyPhaseTimingsMs.push(detailed.timings.systems.agency_decisions);
    auditCompletedQuarter(previous, world);
    const decisionFacts = appendedDecisionFacts(previous, world);
    maximumSubmittedInQuarter = Math.max(maximumSubmittedInQuarter, decisionFacts.submitted.length);
    maximumDecisionActors = Math.max(maximumDecisionActors, world.agencyDecisionSystem.actors.length);
    if (world.turn % fullValidationInterval === 0 || index === turns - 1) {
      fullChecks += 1;
      for (const violation of validateWorldFull(world)) {
        fail(seed, world.turn, `${violation.code}: ${violation.message}`);
      }
    }
    if (world.turn === splitTurn) checkpoint = serializeWorld(world);
  }

  const submitted = world.facts.filter((fact) => fact.kind === 'agency_intent_submitted').length;
  const resolutions = world.facts.filter(
    (fact): fact is ResolutionFact => fact.kind === 'agency_intent_resolved',
  );
  const outcomes: OutcomeCounts = {
    executed: resolutions.filter((fact) => fact.payload.outcome === 'executed').length,
    rejected: resolutions.filter((fact) => fact.payload.outcome === 'rejected').length,
    deferred: resolutions.filter((fact) => fact.payload.outcome === 'deferred').length,
    invalidated: resolutions.filter((fact) => fact.payload.outcome === 'invalidated').length,
  };
  check(submitted === resolutions.length, seed, world.turn, `archive submitted/resolved mismatch ${submitted}/${resolutions.length}`);
  check(submitted <= maximumSubmissionsPerWorld, seed, world.turn, `${submitted} submissions exceed density ceiling ${maximumSubmissionsPerWorld}`);
  check(outcomes.executed <= maximumExecutionsPerWorld, seed, world.turn, `${outcomes.executed} grants exceed density ceiling ${maximumExecutionsPerWorld}`);
  check(outcomes.invalidated <= 2, seed, world.turn, `${outcomes.invalidated} invalid requests should have been filtered before submission`);

  let saveResumeExact = false;
  if (!checkpoint) {
    fail(seed, world.turn, `missing split checkpoint at turn ${splitTurn}`);
  } else {
    const resumed = replayFromSave(seed, checkpoint, turns - splitTurn);
    saveResumeExact = resumed.hash === world.hash && serializeWorld(resumed) === serializeWorld(world);
    check(saveResumeExact, seed, world.turn, 'save/resume continuation diverged from uninterrupted world');
  }
  return {
    seed,
    finalTurn: world.turn,
    finalHash: world.hash,
    submitted,
    ...outcomes,
    maximumSubmittedInQuarter,
    maximumDecisionActors,
    saveResumeExact,
  };
}

const samples: SeedSample[] = [];
for (const seed of seeds) {
  try {
    samples.push(runSeed(seed));
  } catch (error) {
    fail(seed, -1, `audit aborted: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const totals = samples.reduce((sum, sample) => ({
  submitted: sum.submitted + sample.submitted,
  executed: sum.executed + sample.executed,
  rejected: sum.rejected + sample.rejected,
  deferred: sum.deferred + sample.deferred,
  invalidated: sum.invalidated + sample.invalidated,
}), { submitted: 0, executed: 0, rejected: 0, deferred: 0, invalidated: 0 });
check(totals.executed > 0, 'aggregate', turns, 'natural cohort produced no granted independent command');
check(totals.rejected + totals.deferred > 0, 'aggregate', turns, 'natural cohort produced no rejected or deferred request');
const phaseTiming = timingSummary(agencyPhaseTimingsMs);
check(
  phaseTiming.p95Ms <= maximumAgencyPhaseP95Ms,
  'aggregate',
  turns,
  `agency_decisions P95 ${phaseTiming.p95Ms}ms exceeds ${maximumAgencyPhaseP95Ms}ms`,
);

console.log(JSON.stringify({
  phase: 'C10-C11',
  scope: {
    seeds: seeds.length,
    quartersPerSeed: turns,
    splitTurn: Math.floor(turns / 2),
    fullValidationInterval,
  },
  contract: {
    owner: 'WorldState.agencyDecisionSystem + agency intent Facts',
    maximumActors: MAX_AGENCY_DECISION_ACTORS,
    maximumIntentsPerQuarter: MAX_AGENCY_INTENTS_PER_TURN,
    maximumSubmissionsPerWorld,
    maximumExecutionsPerWorld,
    maximumAgencyPhaseP95Ms,
  },
  metrics: {
    runtimeChecks,
    fullChecks,
    decisionStateChecks,
    saveRoundtrips,
    resumedQuarters,
    totals,
    agencyDecisionTiming: phaseTiming,
  },
  samples,
  failureCount,
  failures,
  omittedFailures: Math.max(0, failureCount - failures.length),
}, null, 2));

if (failureCount > 0) process.exitCode = 1;
