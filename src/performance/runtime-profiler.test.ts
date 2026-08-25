import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getRuntimePerformanceSnapshot,
  measureRuntimePhase,
  measureRuntimePhaseAsync,
  recordRuntimeMetric,
  resetRuntimePerformanceMetrics,
} from './runtime-profiler';

describe('runtime performance profiler', () => {
  beforeEach(() => resetRuntimePerformanceMetrics());

  it('keeps bounded percentile summaries', () => {
    for (let index = 1; index <= 140; index += 1) recordRuntimeMetric('canvas.draw', index, index);
    expect(getRuntimePerformanceSnapshot().phases['canvas.draw']).toEqual({
      count: 128,
      latestMs: 140,
      meanMs: 76.5,
      p50Ms: 76,
      p95Ms: 134,
      maxMs: 140,
      latestTurn: 140,
    });
  });

  it('records synchronous and asynchronous failures in finally blocks', async () => {
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValueOnce(10).mockReturnValueOnce(13).mockReturnValueOnce(14)
      .mockReturnValueOnce(20).mockReturnValueOnce(25).mockReturnValueOnce(26);
    expect(() => measureRuntimePhase('validation.full', () => {
      throw new Error('invalid');
    }, 4)).toThrow('invalid');
    await expect(measureRuntimePhaseAsync('persistence.indexeddb', async () => {
      throw new Error('offline');
    }, 5)).rejects.toThrow('offline');
    expect(getRuntimePerformanceSnapshot().phases['validation.full']?.latestMs).toBe(3);
    expect(getRuntimePerformanceSnapshot().phases['persistence.indexeddb']?.latestMs).toBe(5);
    now.mockRestore();
  });

  it('publishes individual simulation-system samples', () => {
    recordRuntimeMetric('simulation.system.military', 7.25, 12);
    expect(getRuntimePerformanceSnapshot().phases['simulation.system.military']).toMatchObject({
      count: 1,
      latestMs: 7.25,
      latestTurn: 12,
    });
  });
});
