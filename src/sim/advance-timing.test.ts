import { describe, expect, it } from 'vitest';
import {
  advanceWorld,
  advanceWorldDetailed,
  createWorld,
  SIMULATION_SYSTEM_PHASES,
} from './index';

describe('detailed quarterly timing', () => {
  it('measures every phase without entering authoritative state', () => {
    const initial = createWorld('性能分段契约');
    const initialHash = initial.hash;
    let clock = 0;
    const detailed = advanceWorldDetailed(initial, () => {
      clock += 1;
      return clock;
    });
    const ordinary = advanceWorld(initial);

    expect(detailed.world).toEqual(ordinary);
    expect(initial.turn).toBe(0);
    expect(initial.hash).toBe(initialHash);
    expect(detailed.timings.cloneMs).toBeGreaterThanOrEqual(0);
    expect(detailed.timings.systemsMs).toBeGreaterThanOrEqual(0);
    expect(detailed.timings.hashMs).toBeGreaterThanOrEqual(0);
    expect(detailed.timings.totalMs).toBeGreaterThanOrEqual(0);
    expect(Object.keys(detailed.timings.systems)).toEqual(SIMULATION_SYSTEM_PHASES);
    expect(Object.values(detailed.timings.systems).every((duration) => duration >= 0)).toBe(true);
    expect('timings' in detailed.world).toBe(false);
  });
});
