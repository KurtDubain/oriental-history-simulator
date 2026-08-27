import { describe, expect, it } from 'vitest';

import { SIMULATION_SYSTEM_PHASES } from './advance-timing';
import { createTurnPipelineRunner } from './turn-pipeline';

describe('typed turn pipeline runner', () => {
  it('runs every phase exactly once in the declared order', () => {
    let now = 0;
    const calls: string[] = [];
    const runner = createTurnPipelineRunner(() => now);
    for (const phase of SIMULATION_SYSTEM_PHASES) {
      runner.run(phase, () => {
        calls.push(phase);
        now += 2;
      });
    }
    const result = runner.finish();
    expect(calls).toEqual(SIMULATION_SYSTEM_PHASES);
    expect(Object.keys(result.systems)).toEqual(SIMULATION_SYSTEM_PHASES);
    expect(Object.values(result.systems).every((duration) => duration === 2)).toBe(true);
    expect(result.elapsedMs).toBe(SIMULATION_SYSTEM_PHASES.length * 2);
  });

  it('rejects reordered or partially committed quarters', () => {
    const runner = createTurnPipelineRunner(() => 0);
    expect(() => runner.run(SIMULATION_SYSTEM_PHASES[1]!, () => undefined)).toThrow(/expected/);
    expect(() => runner.finish()).toThrow(/stopped/);
  });
});
