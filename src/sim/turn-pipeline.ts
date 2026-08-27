import {
  SIMULATION_SYSTEM_PHASES,
  type SimulationSystemPhase,
} from './advance-timing';

export type TurnPipelineClock = () => number;

export interface TurnPipelineRunner {
  run(phase: SimulationSystemPhase, operation: () => void): void;
  finish(): { systems: Record<SimulationSystemPhase, number>; elapsedMs: number };
}

/**
 * Owns phase ordering and timing only. Domain modules still own every state
 * mutation and artifact; this runner cannot inspect or rewrite WorldState.
 */
export function createTurnPipelineRunner(clock: TurnPipelineClock): TurnPipelineRunner {
  const startedAt = clock();
  const systems = Object.fromEntries(
    SIMULATION_SYSTEM_PHASES.map((phase) => [phase, 0]),
  ) as Record<SimulationSystemPhase, number>;
  let nextPhaseIndex = 0;
  let finished = false;
  return {
    run(phase, operation) {
      if (finished) throw new Error('Turn pipeline is already finished');
      const expected = SIMULATION_SYSTEM_PHASES[nextPhaseIndex];
      if (phase !== expected) throw new Error(`Turn pipeline expected ${String(expected)}, received ${phase}`);
      const phaseStartedAt = clock();
      operation();
      systems[phase] = Math.max(0, clock() - phaseStartedAt);
      nextPhaseIndex += 1;
    },
    finish() {
      if (finished) throw new Error('Turn pipeline is already finished');
      if (nextPhaseIndex !== SIMULATION_SYSTEM_PHASES.length) {
        throw new Error(`Turn pipeline stopped after ${nextPhaseIndex}/${SIMULATION_SYSTEM_PHASES.length} phases`);
      }
      finished = true;
      return { systems, elapsedMs: Math.max(0, clock() - startedAt) };
    },
  };
}
