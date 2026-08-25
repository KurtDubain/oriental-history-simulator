export const DEFAULT_AUTOSAVE_TURN_INTERVAL = 8;
export const DEFAULT_AUTOSAVE_IDLE_DELAY_MS = 5_000;
export const DEFAULT_AUTOSAVE_MIN_WRITE_INTERVAL_MS = 5_000;
export const DEFAULT_AUTOSAVE_RETRY_BASE_MS = 1_000;
export const DEFAULT_AUTOSAVE_RETRY_MAX_MS = 30_000;

export type AutosaveFlushReason =
  | 'turn-interval'
  | 'idle'
  | 'retry'
  | 'pause'
  | 'background'
  | 'intervention'
  | 'manual';

export interface AutosaveClock {
  now: () => number;
  setTimeout: (callback: () => void, delayMs: number) => number;
  clearTimeout: (handle: number) => void;
}

export interface AutosaveDirtySnapshot {
  /** Completed simulation turn represented by this immutable snapshot. */
  turn: number;
  /** Kept lazy so coalesced intermediate worlds are never serialized. */
  serialize: () => string;
}

export interface AutosaveWriteContext {
  generation: number;
  turn: number;
  reason: AutosaveFlushReason;
}

export type AutosaveWriter = (
  payload: string,
  context: AutosaveWriteContext,
) => Promise<unknown> | unknown;

export interface AutosaveCoordinatorOptions {
  save: AutosaveWriter;
  /** Turn already represented by the autosave when this coordinator is created. */
  initialSavedTurn?: number;
  turnInterval?: number;
  idleDelayMs?: number;
  /** Minimum gap between successful ordinary automatic writes. */
  minWriteIntervalMs?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  clock?: AutosaveClock;
  onSaved?: (context: AutosaveWriteContext) => void;
  onError?: (error: unknown, context: AutosaveWriteContext) => void;
}

export interface AutosaveCoordinatorState {
  dirtyGeneration: number | null;
  dirtyTurn: number | null;
  lastSavedGeneration: number;
  lastSavedTurn: number;
  inFlightGeneration: number | null;
  retryAttempt: number;
  retryAt: number | null;
  lastError: string | null;
  disposed: boolean;
}

export interface AutosaveFlushResult {
  status: 'saved' | 'clean' | 'deferred' | 'failed' | 'disposed';
  reason: AutosaveFlushReason;
  generation: number | null;
  turn: number | null;
  error?: unknown;
}

interface DirtyGeneration extends AutosaveDirtySnapshot {
  generation: number;
  dirtyAt: number;
}

const EXPLICIT_FLUSH_REASONS = new Set<AutosaveFlushReason>([
  'pause',
  'background',
  'intervention',
  'manual',
]);

const REASON_PRIORITY: Record<AutosaveFlushReason, number> = {
  retry: 0,
  idle: 1,
  'turn-interval': 2,
  manual: 3,
  pause: 4,
  background: 5,
  intervention: 6,
};

const browserClock: AutosaveClock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
};

function wholeNonNegative(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label}必须是非负安全整数。`);
  }
  return value;
}

function wholePositive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label}必须是正安全整数。`);
  }
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Coalesces immutable world snapshots into one ordered autosave stream.
 *
 * Integration deliberately stays presentation-agnostic:
 *
 *   coordinator.markDirty({ turn: world.turn, serialize: () => serializeWorld(world) });
 *   await coordinator.flush('pause');
 *
 * `save` is never called concurrently. A newer dirty generation replaces every
 * queued-but-not-started generation, so a slow older write can only finish before
 * (never after) the latest write.
 */
export class AutosaveCoordinator {
  private readonly save: AutosaveWriter;
  private readonly clock: AutosaveClock;
  private readonly turnInterval: number;
  private readonly idleDelayMs: number;
  private readonly minWriteIntervalMs: number;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;
  private readonly onSaved?: AutosaveCoordinatorOptions['onSaved'];
  private readonly onError?: AutosaveCoordinatorOptions['onError'];

  private generation = 0;
  private latest: DirtyGeneration | null = null;
  private lastSavedGeneration = 0;
  private lastSavedTurn: number;
  private inFlightGeneration: number | null = null;
  private retryAttempt = 0;
  private retryAt: number | null = null;
  private lastError: string | null = null;
  private timer: number | null = null;
  private timerAt: number | null = null;
  private timerReason: 'idle' | 'retry' | 'turn-interval' | null = null;
  private lastWriteAt: number | null = null;
  private pendingReason: AutosaveFlushReason | null = null;
  private pendingBypassesBackoff = false;
  private drainPromise: Promise<AutosaveFlushResult> | null = null;
  private disposed = false;

  constructor(options: AutosaveCoordinatorOptions) {
    this.save = options.save;
    this.clock = options.clock ?? browserClock;
    this.turnInterval = wholePositive(
      options.turnInterval ?? DEFAULT_AUTOSAVE_TURN_INTERVAL,
      '自动保存季度间隔',
    );
    this.idleDelayMs = wholeNonNegative(
      options.idleDelayMs ?? DEFAULT_AUTOSAVE_IDLE_DELAY_MS,
      '自动保存空闲等待',
    );
    this.minWriteIntervalMs = wholeNonNegative(
      options.minWriteIntervalMs ?? DEFAULT_AUTOSAVE_MIN_WRITE_INTERVAL_MS,
      '自动保存最小写入间隔',
    );
    this.retryBaseMs = wholePositive(
      options.retryBaseMs ?? DEFAULT_AUTOSAVE_RETRY_BASE_MS,
      '自动保存重试基础等待',
    );
    this.retryMaxMs = wholePositive(
      options.retryMaxMs ?? DEFAULT_AUTOSAVE_RETRY_MAX_MS,
      '自动保存最大重试等待',
    );
    if (this.retryMaxMs < this.retryBaseMs) {
      throw new RangeError('自动保存最大重试等待不得小于基础等待。');
    }
    this.lastSavedTurn = wholeNonNegative(options.initialSavedTurn ?? 0, '初始保存季度');
    this.onSaved = options.onSaved;
    this.onError = options.onError;
  }

  markDirty(snapshot: AutosaveDirtySnapshot): number {
    if (this.disposed) throw new Error('自动保存协调器已经关闭。');
    const turn = wholeNonNegative(snapshot.turn, '脏快照季度');
    const minimumTurn = Math.max(this.lastSavedTurn, this.latest?.turn ?? this.lastSavedTurn);
    if (turn < minimumTurn) {
      throw new RangeError(`不能以较旧季度 T${turn} 覆盖当前 T${minimumTurn}。`);
    }
    if (typeof snapshot.serialize !== 'function') {
      throw new TypeError('脏快照必须提供延迟序列化函数。');
    }

    this.generation += 1;
    this.latest = {
      turn,
      serialize: snapshot.serialize,
      generation: this.generation,
      dirtyAt: this.clock.now(),
    };

    this.scheduleLatest();
    return this.generation;
  }

  /** Pause, background and intervention callers use the same explicit flush API. */
  flush(reason: AutosaveFlushReason = 'manual'): Promise<AutosaveFlushResult> {
    if (this.disposed) {
      return Promise.resolve({
        status: 'disposed',
        reason,
        generation: this.latest?.generation ?? null,
        turn: this.latest?.turn ?? null,
      });
    }
    if (!this.latest) {
      return this.drainPromise ?? Promise.resolve({
        status: 'clean',
        reason,
        generation: null,
        turn: null,
      });
    }

    this.clearTimer();
    if (
      !this.pendingReason
      || REASON_PRIORITY[reason] > REASON_PRIORITY[this.pendingReason]
    ) {
      this.pendingReason = reason;
    }
    this.pendingBypassesBackoff ||= EXPLICIT_FLUSH_REASONS.has(reason);

    if (!this.drainPromise) {
      const drain = this.runPendingDrains();
      this.drainPromise = drain.finally(() => {
        this.drainPromise = null;
        if (!this.disposed && this.latest) this.scheduleLatest();
      });
    }
    return this.drainPromise;
  }

  /** Resolves after the currently active write/drain, if any. */
  async whenSettled(): Promise<void> {
    const active = this.drainPromise;
    if (active) await active;
  }

  getState(): AutosaveCoordinatorState {
    return {
      dirtyGeneration: this.latest?.generation ?? null,
      dirtyTurn: this.latest?.turn ?? null,
      lastSavedGeneration: this.lastSavedGeneration,
      lastSavedTurn: this.lastSavedTurn,
      inFlightGeneration: this.inFlightGeneration,
      retryAttempt: this.retryAttempt,
      retryAt: this.retryAt,
      lastError: this.lastError,
      disposed: this.disposed,
    };
  }

  dispose(): void {
    this.disposed = true;
    this.pendingReason = null;
    this.pendingBypassesBackoff = false;
    this.clearTimer();
  }

  private async runPendingDrains(): Promise<AutosaveFlushResult> {
    let result = await this.runDrain();
    // A lifecycle flush can arrive after an automatic drain has synchronously
    // deferred but before its promise settles. Keep it in this same single-flight
    // chain so awaiting that explicit flush still means the write is durable.
    while (!this.disposed && this.latest && this.pendingReason) {
      result = await this.runDrain();
    }
    return result;
  }

  private async runDrain(): Promise<AutosaveFlushResult> {
    let result: AutosaveFlushResult = {
      status: 'clean',
      reason: this.pendingReason ?? 'manual',
      generation: null,
      turn: null,
    };

    while (!this.disposed && this.latest && this.pendingReason) {
      const reason = this.pendingReason;
      const bypassesBackoff = this.pendingBypassesBackoff;
      const now = this.clock.now();
      if (this.retryAt !== null && now < this.retryAt && !bypassesBackoff) {
        this.pendingReason = null;
        this.pendingBypassesBackoff = false;
        this.scheduleAt(this.retryAt, 'retry');
        return {
          status: 'deferred',
          reason,
          generation: this.latest.generation,
          turn: this.latest.turn,
        };
      }
      if (
        (reason === 'idle' || reason === 'turn-interval')
        && this.lastWriteAt !== null
        && now < this.lastWriteAt + this.minWriteIntervalMs
      ) {
        const writeAt = this.lastWriteAt + this.minWriteIntervalMs;
        this.pendingReason = null;
        this.pendingBypassesBackoff = false;
        this.scheduleAt(writeAt, reason);
        return {
          status: 'deferred',
          reason,
          generation: this.latest.generation,
          turn: this.latest.turn,
        };
      }

      this.pendingReason = null;
      this.pendingBypassesBackoff = false;
      const candidate = this.latest;
      const context: AutosaveWriteContext = {
        generation: candidate.generation,
        turn: candidate.turn,
        reason,
      };
      this.inFlightGeneration = candidate.generation;

      try {
        const payload = candidate.serialize();
        await this.save(payload, context);
      } catch (error) {
        this.inFlightGeneration = null;
        this.retryAttempt += 1;
        const retryDelay = Math.min(
          this.retryMaxMs,
          this.retryBaseMs * (2 ** Math.min(30, this.retryAttempt - 1)),
        );
        this.retryAt = this.clock.now() + retryDelay;
        this.lastError = errorMessage(error);
        this.pendingReason = null;
        this.pendingBypassesBackoff = false;
        try {
          this.onError?.(error, context);
        } catch {
          // Observation callbacks must not break the persistence state machine.
        }
        this.scheduleAt(this.retryAt, 'retry');
        return {
          status: 'failed',
          reason,
          generation: candidate.generation,
          turn: candidate.turn,
          error,
        };
      }

      this.inFlightGeneration = null;
      this.lastSavedGeneration = candidate.generation;
      this.lastSavedTurn = candidate.turn;
      this.lastWriteAt = this.clock.now();
      this.retryAttempt = 0;
      this.retryAt = null;
      this.lastError = null;
      if (this.latest?.generation === candidate.generation) this.latest = null;
      if (!this.latest) {
        this.pendingReason = null;
        this.pendingBypassesBackoff = false;
      }
      try {
        this.onSaved?.(context);
      } catch {
        // Observation callbacks must not break the persistence state machine.
      }
      result = {
        status: 'saved',
        reason,
        generation: candidate.generation,
        turn: candidate.turn,
      };
    }

    return this.disposed ? {
      status: 'disposed',
      reason: result.reason,
      generation: this.latest?.generation ?? null,
      turn: this.latest?.turn ?? null,
    } : result;
  }

  private scheduleLatest(): void {
    if (this.disposed || !this.latest || this.drainPromise) return;
    if (this.retryAt !== null) {
      this.scheduleAt(this.retryAt, 'retry');
      return;
    }
    if (this.latest.turn - this.lastSavedTurn >= this.turnInterval) {
      const writeAt = this.lastWriteAt === null
        ? this.clock.now()
        : Math.max(
          this.clock.now(),
          this.lastWriteAt + this.minWriteIntervalMs,
        );
      if (writeAt <= this.clock.now()) {
        void this.flush('turn-interval');
      } else {
        this.scheduleAt(writeAt, 'turn-interval');
      }
      return;
    }
    this.scheduleAt(this.latest.dirtyAt + this.idleDelayMs, 'idle');
  }

  private scheduleAt(
    timestamp: number,
    reason: 'idle' | 'retry' | 'turn-interval',
  ): void {
    if (this.disposed || !this.latest) return;
    if (this.timer !== null && this.timerAt !== null && this.timerReason !== null) {
      if (this.timerReason === 'retry' && reason !== 'retry') return;
      if (reason === 'retry') {
        if (this.timerReason === 'retry' && this.timerAt === timestamp) return;
      } else if (this.timerReason === 'turn-interval') {
        if (reason === 'idle' || timestamp >= this.timerAt) return;
      } else if (this.timerReason === 'idle' && reason === 'turn-interval') {
        // Reaching the turn threshold invalidates the trailing-idle deadline.
      } else if (this.timerReason === 'idle' && reason === 'idle' && this.timerAt === timestamp) {
        return;
      }
    }
    this.clearTimer();
    const delay = Math.max(0, timestamp - this.clock.now());
    this.timerAt = timestamp;
    this.timerReason = reason;
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      this.timerAt = null;
      this.timerReason = null;
      void this.flush(reason);
    }, delay);
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    this.clock.clearTimeout(this.timer);
    this.timer = null;
    this.timerAt = null;
    this.timerReason = null;
  }
}

export function createAutosaveCoordinator(
  options: AutosaveCoordinatorOptions,
): AutosaveCoordinator {
  return new AutosaveCoordinator(options);
}
