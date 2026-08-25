import {
  SIMULATION_SYSTEM_PHASES,
  type SimulationSystemPhase,
} from '../sim/advance-timing';

const BASE_RUNTIME_PHASES = [
  'simulation.clone',
  'simulation.systems',
  'simulation.hash',
  'simulation.total',
  'validation.runtime',
  'validation.full',
  'react.commit',
  'canvas.draw',
  'persistence.serialize',
  'persistence.indexeddb',
] as const;

type BaseRuntimePhase = (typeof BASE_RUNTIME_PHASES)[number];
export type SimulationRuntimePhase = `simulation.system.${SimulationSystemPhase}`;
export type RuntimePhase = BaseRuntimePhase | SimulationRuntimePhase;

const SIMULATION_RUNTIME_PHASES = SIMULATION_SYSTEM_PHASES.map(
  (phase): SimulationRuntimePhase => `simulation.system.${phase}`,
);

export const RUNTIME_PHASES: readonly RuntimePhase[] = [
  ...BASE_RUNTIME_PHASES,
  ...SIMULATION_RUNTIME_PHASES,
];

export interface RuntimeMetricSample {
  durationMs: number;
  turn: number | null;
  recordedAt: number;
}

export interface RuntimeMetricSummary {
  count: number;
  latestMs: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  latestTurn: number | null;
}

export interface RuntimePerformanceSnapshot {
  sampleLimit: number;
  phases: Partial<Record<RuntimePhase, RuntimeMetricSummary>>;
}

const SAMPLE_LIMIT = 128;
const samples = new Map<RuntimePhase, RuntimeMetricSample[]>();

export function runtimeNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index] ?? 0;
}

/**
 * Bounded presentation telemetry. Samples never enter WorldState, saves, or hashes.
 */
export function recordRuntimeMetric(
  phase: RuntimePhase,
  durationMs: number,
  turn: number | null = null,
): void {
  if (!Number.isFinite(durationMs) || durationMs < 0) return;
  const bucket = samples.get(phase) ?? [];
  bucket.push({ durationMs, turn, recordedAt: runtimeNow() });
  if (bucket.length > SAMPLE_LIMIT) bucket.splice(0, bucket.length - SAMPLE_LIMIT);
  samples.set(phase, bucket);
}

export function measureRuntimePhase<T>(
  phase: RuntimePhase,
  operation: () => T,
  turn: number | null = null,
): T {
  const startedAt = runtimeNow();
  try {
    return operation();
  } finally {
    recordRuntimeMetric(phase, runtimeNow() - startedAt, turn);
  }
}

export async function measureRuntimePhaseAsync<T>(
  phase: RuntimePhase,
  operation: () => Promise<T>,
  turn: number | null = null,
): Promise<T> {
  const startedAt = runtimeNow();
  try {
    return await operation();
  } finally {
    recordRuntimeMetric(phase, runtimeNow() - startedAt, turn);
  }
}

export function getRuntimePerformanceSnapshot(): RuntimePerformanceSnapshot {
  const phases: Partial<Record<RuntimePhase, RuntimeMetricSummary>> = {};
  for (const phase of RUNTIME_PHASES) {
    const bucket = samples.get(phase);
    if (!bucket?.length) continue;
    const durations = bucket.map((sample) => sample.durationMs).sort((left, right) => left - right);
    const latest = bucket[bucket.length - 1];
    if (!latest) continue;
    phases[phase] = {
      count: bucket.length,
      latestMs: round(latest.durationMs),
      meanMs: round(durations.reduce((sum, value) => sum + value, 0) / durations.length),
      p50Ms: round(percentile(durations, 0.5)),
      p95Ms: round(percentile(durations, 0.95)),
      maxMs: round(durations[durations.length - 1] ?? 0),
      latestTurn: latest.turn,
    };
  }
  return { sampleLimit: SAMPLE_LIMIT, phases };
}

export function resetRuntimePerformanceMetrics(): void {
  samples.clear();
}
