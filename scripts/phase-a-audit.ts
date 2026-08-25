import {
  advanceWorldDetailed,
  createWorld,
  measureFullValidation,
  measureRuntimeValidation,
  SIMULATION_SYSTEM_PHASES,
  serializeWorld,
  type SimulationSystemPhase,
  type WorldState,
} from '../src/sim';

const seeds = process.env.PHASE_A_AUDIT_SEEDS?.split(',').map((seed) => seed.trim()).filter(Boolean)
  ?? ['北境事实链', '海路事实链', '旧史新纪'];
const turns = Math.max(1, Number.parseInt(process.env.PHASE_A_AUDIT_TURNS ?? '80', 10));
const maximumSimulationP95Ms = Math.max(1, Number(process.env.PHASE_A_AUDIT_MAX_SIM_P95_MS ?? '250'));
const maximumRuntimeP95Ms = Math.max(1, Number(process.env.PHASE_A_AUDIT_MAX_RUNTIME_P95_MS ?? '120'));
const maximumSaveMiB = Math.max(1, Number(process.env.PHASE_A_AUDIT_MAX_SAVE_MIB ?? '16'));

interface SeedSample {
  seed: string;
  turn: number;
  hash: string;
  facts: number;
  chronicleEntries: number;
  battleFacts: number;
  battleChronicleEntries: number;
  factChronicleRatio: number;
  saveMiB: number;
  checkpoints: Array<{
    turn: number;
    yearsElapsed: number;
    facts: number;
    chronicleEntries: number;
    saveMiB: number;
    serializationMs: number;
  }>;
}

const simulationTimings: number[] = [];
const cloneTimings: number[] = [];
const systemsTimings: number[] = [];
const hashTimings: number[] = [];
const perSystemTimings = Object.fromEntries(
  SIMULATION_SYSTEM_PHASES.map((phase) => [phase, []]),
) as Record<SimulationSystemPhase, number[]>;
const runtimeValidationTimings: number[] = [];
const fullValidationTimings: number[] = [];
const serializationTimings: number[] = [];
const failures: string[] = [];
const samples: SeedSample[] = [];

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index] ?? 0;
}

function timingSummary(values: readonly number[]) {
  return {
    samples: values.length,
    p50Ms: Number(percentile(values, 0.5).toFixed(3)),
    p95Ms: Number(percentile(values, 0.95).toFixed(3)),
    maxMs: Number(Math.max(0, ...values).toFixed(3)),
  };
}

function fail(seed: string, turn: number, message: string): void {
  failures.push(`${seed}@T${turn}: ${message}`);
}

function undefinedPaths(value: unknown, path: string, output: string[] = []): string[] {
  if (value === undefined) {
    output.push(path);
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => undefinedPaths(item, `${path}[${index}]`, output));
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      undefinedPaths(item, path ? `${path}.${key}` : key, output);
    }
  }
  return output;
}

function checkFactLinks(previous: WorldState, next: WorldState): void {
  const appendedFacts = next.facts.slice(previous.facts.length);
  const invalidPaths = undefinedPaths(appendedFacts, 'facts');
  if (invalidPaths.length) fail(next.seed, next.turn, `Fact含undefined：${invalidPaths.slice(0, 4).join(', ')}`);
  const appendedFactIds = new Set(appendedFacts.map((fact) => fact.id));
  for (const event of next.history.slice(previous.history.length)) {
    for (const factId of event.sourceFactIds) {
      if (!appendedFactIds.has(factId) && !next.facts.some((fact) => fact.id === factId)) {
        fail(next.seed, next.turn, `${event.id}引用未知事实${factId}`);
      }
    }
  }
  const reportIds = next.lastTurn?.factIds ?? [];
  if (reportIds.length !== appendedFacts.length
    || reportIds.some((id, index) => id !== appendedFacts[index]?.id)) {
    fail(next.seed, next.turn, '季度报告没有精确封存本季 Fact buffer');
  }
}

for (const seed of seeds) {
  let world = createWorld(seed);
  const checkpointTurns = new Set([0, 80, 200, 400, turns].filter((turn) => turn <= turns));
  const checkpoints: SeedSample['checkpoints'] = [];
  const captureCheckpoint = (): void => {
    const serializationStartedAt = performance.now();
    const serialized = serializeWorld(world);
    const serializationMs = performance.now() - serializationStartedAt;
    serializationTimings.push(serializationMs);
    const saveMiB = Buffer.byteLength(serialized, 'utf8') / 1024 / 1024;
    if (saveMiB > maximumSaveMiB) fail(seed, world.turn, `存档${saveMiB.toFixed(2)}MiB超过${maximumSaveMiB}MiB`);
    checkpoints.push({
      turn: world.turn,
      yearsElapsed: Number((world.turn / 4).toFixed(2)),
      facts: world.facts.length,
      chronicleEntries: world.history.length,
      saveMiB: Number(saveMiB.toFixed(3)),
      serializationMs: Number(serializationMs.toFixed(3)),
    });
  };
  if (world.schemaVersion !== 4) fail(seed, world.turn, `新世界不是 schema 4，而是${world.schemaVersion}`);
  const openingValidation = measureFullValidation(world);
  fullValidationTimings.push(openingValidation.durationMs);
  if (openingValidation.violations.length) {
    fail(seed, world.turn, openingValidation.violations[0]?.message ?? '开局完整校验失败');
  }
  captureCheckpoint();

  for (let index = 0; index < turns; index += 1) {
    const previous = world;
    const detailed = advanceWorldDetailed(previous);
    world = detailed.world;
    simulationTimings.push(detailed.timings.totalMs);
    cloneTimings.push(detailed.timings.cloneMs);
    systemsTimings.push(detailed.timings.systemsMs);
    hashTimings.push(detailed.timings.hashMs);
    for (const phase of SIMULATION_SYSTEM_PHASES) {
      perSystemTimings[phase].push(detailed.timings.systems[phase]);
    }

    const runtime = measureRuntimeValidation(previous, world);
    runtimeValidationTimings.push(runtime.durationMs);
    if (runtime.violations.length) {
      fail(seed, world.turn, `${runtime.violations[0]?.code}: ${runtime.violations[0]?.message}`);
    }
    checkFactLinks(previous, world);

    if ((index + 1) % 20 === 0 || index === turns - 1) {
      const full = measureFullValidation(world);
      fullValidationTimings.push(full.durationMs);
      if (full.violations.length) {
        fail(seed, world.turn, `${full.violations[0]?.code}: ${full.violations[0]?.message}`);
      }
    }
    if (checkpointTurns.has(world.turn)) captureCheckpoint();
  }

  const saveMiB = checkpoints.at(-1)?.saveMiB ?? 0;

  const battleFacts = world.facts.filter((fact) => fact.kind === 'battle').length;
  const battleChronicleEntries = world.history.filter((event) => event.kind === 'battle').length;
  if (battleChronicleEntries > battleFacts) fail(seed, world.turn, '公开战役数超过真实 BattleFact 数');
  samples.push({
    seed,
    turn: world.turn,
    hash: world.hash,
    facts: world.facts.length,
    chronicleEntries: world.history.length,
    battleFacts,
    battleChronicleEntries,
    factChronicleRatio: Number((world.facts.length / Math.max(1, world.history.length)).toFixed(3)),
    saveMiB,
    checkpoints,
  });
}

const simulation = timingSummary(simulationTimings);
const runtimeValidation = timingSummary(runtimeValidationTimings);
if (simulation.p95Ms > maximumSimulationP95Ms) {
  failures.push(`simulation P95 ${simulation.p95Ms}ms 超过 ${maximumSimulationP95Ms}ms`);
}
if (runtimeValidation.p95Ms > maximumRuntimeP95Ms) {
  failures.push(`runtime validation P95 ${runtimeValidation.p95Ms}ms 超过 ${maximumRuntimeP95Ms}ms`);
}

console.log(JSON.stringify({
  phase: 'A',
  schemaVersion: 4,
  seeds: seeds.length,
  turnsPerSeed: turns,
  timings: {
    simulation,
    engine: {
      clone: timingSummary(cloneTimings),
      systems: timingSummary(systemsTimings),
      hash: timingSummary(hashTimings),
      perSystem: Object.fromEntries(
        SIMULATION_SYSTEM_PHASES.map((phase) => [phase, timingSummary(perSystemTimings[phase])]),
      ),
    },
    runtimeValidation,
    fullValidation: timingSummary(fullValidationTimings),
    serialization: timingSummary(serializationTimings),
  },
  samples,
  failures,
}, null, 2));

if (failures.length > 0) process.exitCode = 1;
