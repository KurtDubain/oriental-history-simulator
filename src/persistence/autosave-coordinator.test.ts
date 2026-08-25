import { describe, expect, it, vi } from 'vitest';
import {
  AutosaveCoordinator,
  type AutosaveClock,
  type AutosaveFlushReason,
  type AutosaveWriteContext,
} from './autosave-coordinator';

interface ScheduledTask {
  id: number;
  at: number;
  callback: () => void;
}

class FakeClock implements AutosaveClock {
  private current = 0;
  private nextId = 1;
  private readonly tasks = new Map<number, ScheduledTask>();

  now = () => this.current;

  setTimeout = (callback: () => void, delayMs: number): number => {
    const id = this.nextId;
    this.nextId += 1;
    this.tasks.set(id, {
      id,
      at: this.current + Math.max(0, delayMs),
      callback,
    });
    return id;
  };

  clearTimeout = (handle: number): void => {
    this.tasks.delete(handle);
  };

  advance(milliseconds: number): void {
    const target = this.current + milliseconds;
    while (true) {
      const next = [...this.tasks.values()]
        .filter((task) => task.at <= target)
        .sort((left, right) => left.at - right.at || left.id - right.id)[0];
      if (!next) break;
      this.current = next.at;
      this.tasks.delete(next.id);
      next.callback();
    }
    this.current = target;
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

async function runContinuousQuarterRate(cadenceMs: number): Promise<{
  writes: number[];
  maximumActive: number;
}> {
  const clock = new FakeClock();
  const writes: number[] = [];
  let active = 0;
  let maximumActive = 0;
  const coordinator = new AutosaveCoordinator({
    clock,
    save: async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      writes.push(clock.now());
      active -= 1;
    },
  });
  let turn = 0;
  let elapsed = 0;
  while (elapsed < 60_000) {
    const step = Math.min(cadenceMs, 60_000 - elapsed);
    clock.advance(step);
    elapsed += step;
    if (step === cadenceMs) {
      turn += 1;
      coordinator.markDirty({ turn, serialize: () => `T${turn}` });
    }
    await coordinator.whenSettled();
  }
  return { writes, maximumActive };
}

describe('AutosaveCoordinator', () => {
  it('keeps serialization lazy and writes only the latest generation every eight quarters', async () => {
    const clock = new FakeClock();
    const serialized: number[] = [];
    const writes: AutosaveWriteContext[] = [];
    const coordinator = new AutosaveCoordinator({
      clock,
      initialSavedTurn: 0,
      save: (_payload, context) => {
        writes.push(context);
      },
    });

    for (let turn = 1; turn <= 7; turn += 1) {
      coordinator.markDirty({
        turn,
        serialize: () => {
          serialized.push(turn);
          return `T${turn}`;
        },
      });
    }
    expect(serialized).toEqual([]);
    expect(writes).toEqual([]);

    coordinator.markDirty({
      turn: 8,
      serialize: () => {
        serialized.push(8);
        return 'T8';
      },
    });
    await coordinator.whenSettled();

    expect(serialized).toEqual([8]);
    expect(writes).toEqual([{ generation: 8, turn: 8, reason: 'turn-interval' }]);
    expect(coordinator.getState()).toMatchObject({
      dirtyGeneration: null,
      lastSavedGeneration: 8,
      lastSavedTurn: 8,
    });
  });

  it('flushes the latest snapshot after five seconds of inactivity', async () => {
    const clock = new FakeClock();
    const save = vi.fn(async (_payload: string, _context: AutosaveWriteContext) => undefined);
    const coordinator = new AutosaveCoordinator({ clock, save });
    coordinator.markDirty({ turn: 1, serialize: () => 'idle-world' });

    clock.advance(4_999);
    await coordinator.whenSettled();
    expect(save).not.toHaveBeenCalled();

    clock.advance(1);
    await coordinator.whenSettled();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[1]).toEqual({ generation: 1, turn: 1, reason: 'idle' });
  });

  it('does not let continuous dirty updates postpone an eligible write deadline', async () => {
    const clock = new FakeClock();
    const writes: Array<{ at: number; context: AutosaveWriteContext }> = [];
    const coordinator = new AutosaveCoordinator({
      clock,
      save: (_payload, context) => {
        writes.push({ at: clock.now(), context });
      },
    });
    coordinator.markDirty({ turn: 1, serialize: () => 'baseline' });
    await coordinator.flush('manual');

    for (let turn = 2; turn <= 50; turn += 1) {
      clock.advance(100);
      coordinator.markDirty({ turn, serialize: () => `T${turn}` });
      await coordinator.whenSettled();
    }
    expect(writes).toHaveLength(1);

    clock.advance(100);
    coordinator.markDirty({ turn: 51, serialize: () => 'T51' });
    await coordinator.whenSettled();

    expect(writes).toHaveLength(2);
    expect(writes[1]).toMatchObject({
      at: 5_000,
      context: { turn: 50, reason: 'turn-interval' },
    });
  });

  it.each([
    ['4×', 450],
    ['8×', 225],
  ] as const)(
    'throttles continuous %s play to at most twelve single-flight writes per minute',
    async (_label, cadenceMs) => {
      const { writes, maximumActive } = await runContinuousQuarterRate(cadenceMs);

      expect(writes.length).toBeGreaterThanOrEqual(1);
      expect(writes.length).toBeLessThanOrEqual(12);
      expect(maximumActive).toBe(1);
      for (let index = 1; index < writes.length; index += 1) {
        expect((writes[index] ?? 0) - (writes[index - 1] ?? 0)).toBeGreaterThanOrEqual(5_000);
      }
    },
  );

  it('keeps one write in flight and coalesces newer worlds behind it', async () => {
    const clock = new FakeClock();
    const gates = [deferred(), deferred()];
    const started: number[] = [];
    const completed: number[] = [];
    let active = 0;
    let maximumActive = 0;
    const coordinator = new AutosaveCoordinator({
      clock,
      save: async (_payload, context) => {
        const gate = gates[started.length];
        started.push(context.generation);
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await gate?.promise;
        completed.push(context.generation);
        active -= 1;
      },
    });

    coordinator.markDirty({ turn: 1, serialize: () => 'generation-1' });
    const firstFlush = coordinator.flush('manual');
    await Promise.resolve();
    expect(started).toEqual([1]);

    coordinator.markDirty({ turn: 2, serialize: () => 'generation-2' });
    coordinator.markDirty({ turn: 3, serialize: () => 'generation-3' });
    const coalescedFlush = coordinator.flush('pause');
    gates[0]?.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(started).toEqual([1, 3]);
    expect(active).toBe(1);
    gates[1]?.resolve();
    await Promise.all([firstFlush, coalescedFlush]);

    expect(maximumActive).toBe(1);
    expect(completed).toEqual([1, 3]);
    expect(coordinator.getState()).toMatchObject({
      dirtyGeneration: null,
      lastSavedGeneration: 3,
      lastSavedTurn: 3,
      inFlightGeneration: null,
    });
  });

  it('never lets an older asynchronous snapshot finish after the latest write', async () => {
    const first = deferred();
    const second = deferred();
    const gates = [first, second];
    const durableWrites: number[] = [];
    let started = 0;
    const coordinator = new AutosaveCoordinator({
      save: async (_payload, context) => {
        const gate = gates[started];
        started += 1;
        await gate?.promise;
        durableWrites.push(context.generation);
      },
    });

    coordinator.markDirty({ turn: 1, serialize: () => 'old' });
    const flush = coordinator.flush('manual');
    await Promise.resolve();
    coordinator.markDirty({ turn: 4, serialize: () => 'latest' });
    void coordinator.flush('intervention');

    first.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(durableWrites).toEqual([1]);
    second.resolve();
    await flush;

    expect(durableWrites).toEqual([1, 2]);
    expect(durableWrites.at(-1)).toBe(2);
  });

  it('keeps the latest generation dirty after failure and retries with exponential backoff', async () => {
    const clock = new FakeClock();
    const attempts: AutosaveWriteContext[] = [];
    let failuresRemaining = 2;
    const coordinator = new AutosaveCoordinator({
      clock,
      retryBaseMs: 1_000,
      retryMaxMs: 8_000,
      save: (_payload, context) => {
        attempts.push(context);
        if (failuresRemaining > 0) {
          failuresRemaining -= 1;
          throw new Error(`disk-${failuresRemaining}`);
        }
      },
    });
    coordinator.markDirty({ turn: 1, serialize: () => 'first' });

    const failed = await coordinator.flush('manual');
    expect(failed.status).toBe('failed');
    expect(coordinator.getState()).toMatchObject({
      dirtyGeneration: 1,
      retryAttempt: 1,
      retryAt: 1_000,
    });

    clock.advance(999);
    await coordinator.whenSettled();
    expect(attempts).toHaveLength(1);
    clock.advance(1);
    await coordinator.whenSettled();
    expect(attempts).toHaveLength(2);
    expect(coordinator.getState()).toMatchObject({
      dirtyGeneration: 1,
      retryAttempt: 2,
      retryAt: 3_000,
    });

    clock.advance(1_999);
    coordinator.markDirty({ turn: 2, serialize: () => 'newest-after-failure' });
    expect(coordinator.getState().dirtyGeneration).toBe(2);
    clock.advance(1);
    await coordinator.whenSettled();

    expect(attempts.map((context) => context.generation)).toEqual([1, 1, 2]);
    expect(coordinator.getState()).toMatchObject({
      dirtyGeneration: null,
      lastSavedGeneration: 2,
      lastSavedTurn: 2,
      retryAttempt: 0,
      retryAt: null,
      lastError: null,
    });
  });

  it.each(['pause', 'background', 'intervention', 'manual'] as const)(
    'allows %s lifecycle events to bypass the normal write throttle',
    async (reason: AutosaveFlushReason) => {
      const clock = new FakeClock();
      const writes: AutosaveWriteContext[] = [];
      const coordinator = new AutosaveCoordinator({
        clock,
        save: (_payload, context) => {
          writes.push(context);
        },
      });
      coordinator.markDirty({ turn: 1, serialize: () => 'baseline' });
      await coordinator.flush('manual');
      coordinator.markDirty({ turn: 2, serialize: () => reason });

      const result = await coordinator.flush(reason);

      expect(result.status).toBe('saved');
      expect(writes).toEqual([
        { generation: 1, turn: 1, reason: 'manual' },
        { generation: 2, turn: 2, reason },
      ]);
    },
  );

  it('keeps a lifecycle flush in the active single-flight chain after an auto defer', async () => {
    const clock = new FakeClock();
    const writes: AutosaveWriteContext[] = [];
    const coordinator = new AutosaveCoordinator({
      clock,
      save: (_payload, context) => {
        writes.push(context);
      },
    });
    coordinator.markDirty({ turn: 1, serialize: () => 'baseline' });
    await coordinator.flush('manual');
    coordinator.markDirty({ turn: 9, serialize: () => 'eligible' });

    const automatic = coordinator.flush('turn-interval');
    const lifecycle = coordinator.flush('pause');
    const [, result] = await Promise.all([automatic, lifecycle]);

    expect(result.status).toBe('saved');
    expect(clock.now()).toBe(0);
    expect(writes).toEqual([
      { generation: 1, turn: 1, reason: 'manual' },
      { generation: 2, turn: 9, reason: 'pause' },
    ]);
  });

  it('rejects stale turns before they can replace a newer dirty generation', () => {
    const coordinator = new AutosaveCoordinator({ save: () => undefined });
    coordinator.markDirty({ turn: 4, serialize: () => 'new' });

    expect(() => coordinator.markDirty({ turn: 3, serialize: () => 'stale' }))
      .toThrow(/较旧季度/);
    expect(coordinator.getState()).toMatchObject({ dirtyGeneration: 1, dirtyTurn: 4 });
  });
});
