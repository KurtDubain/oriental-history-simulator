import { describe, expect, it, vi } from 'vitest';
import {
  GameAudioManager,
  normalizeAudioSettings,
  type AudioCue,
} from './audio-manager';

class FakeAudioParam {
  value = 0;
  readonly changes: Array<{ kind: string; value: number; time: number }> = [];

  cancelScheduledValues(time: number): this {
    this.changes.push({ kind: 'cancel', value: this.value, time });
    return this;
  }

  setValueAtTime(value: number, time: number): this {
    this.value = value;
    this.changes.push({ kind: 'set', value, time });
    return this;
  }

  linearRampToValueAtTime(value: number, time: number): this {
    this.value = value;
    this.changes.push({ kind: 'linear', value, time });
    return this;
  }

  exponentialRampToValueAtTime(value: number, time: number): this {
    this.value = value;
    this.changes.push({ kind: 'exponential', value, time });
    return this;
  }
}

class FakeAudioNode {
  disconnected = false;

  connect<T>(destination: T): T {
    return destination;
  }

  disconnect(): void {
    this.disconnected = true;
  }
}

class FakeGainNode extends FakeAudioNode {
  readonly gain = new FakeAudioParam();
}

class FakeBiquadNode extends FakeAudioNode {
  readonly frequency = new FakeAudioParam();
  readonly Q = new FakeAudioParam();
  type: BiquadFilterType = 'lowpass';
}

class FakeScheduledSource extends FakeAudioNode {
  onended: (() => void) | null = null;
  readonly starts: number[] = [];
  readonly stops: number[] = [];

  start(when = 0): void {
    this.starts.push(when);
  }

  stop(when = 0): void {
    this.stops.push(when);
  }
}

class FakeOscillatorNode extends FakeScheduledSource {
  readonly frequency = new FakeAudioParam();
  type: OscillatorType = 'sine';
}

class FakeBufferSourceNode extends FakeScheduledSource {
  buffer: AudioBuffer | null = null;
  loop = false;
}

class FakeAudioBuffer {
  private readonly channel: Float32Array;

  constructor(length: number) {
    this.channel = new Float32Array(length);
  }

  getChannelData(): Float32Array {
    return this.channel;
  }
}

class FakeAudioContext {
  state: AudioContextState = 'suspended';
  currentTime = 10;
  readonly sampleRate = 800;
  readonly destination = new FakeAudioNode();
  readonly gains: FakeGainNode[] = [];
  readonly sources: FakeScheduledSource[] = [];
  resumeCalls = 0;
  rejectedResumes = 0;
  suspendCalls = 0;
  closeCalls = 0;

  createGain(): GainNode {
    const gain = new FakeGainNode();
    this.gains.push(gain);
    return gain as unknown as GainNode;
  }

  createBiquadFilter(): BiquadFilterNode {
    return new FakeBiquadNode() as unknown as BiquadFilterNode;
  }

  createOscillator(): OscillatorNode {
    const source = new FakeOscillatorNode();
    this.sources.push(source);
    return source as unknown as OscillatorNode;
  }

  createBufferSource(): AudioBufferSourceNode {
    const source = new FakeBufferSourceNode();
    this.sources.push(source);
    return source as unknown as AudioBufferSourceNode;
  }

  createBuffer(_channels: number, length: number): AudioBuffer {
    return new FakeAudioBuffer(length) as unknown as AudioBuffer;
  }

  async resume(): Promise<void> {
    this.resumeCalls += 1;
    if (this.rejectedResumes > 0) {
      this.rejectedResumes -= 1;
      throw new Error('gesture was not accepted');
    }
    this.state = 'running';
  }

  async suspend(): Promise<void> {
    this.suspendCalls += 1;
    this.state = 'suspended';
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
    this.state = 'closed';
  }
}

class FakePage extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible';
}

function createHarness(maxEffects = 3): {
  context: FakeAudioContext;
  page: FakePage;
  manager: GameAudioManager;
  getFactoryCalls: () => number;
} {
  const context = new FakeAudioContext();
  const page = new FakePage();
  let factoryCalls = 0;
  const manager = new GameAudioManager({
    contextFactory: () => {
      factoryCalls += 1;
      return context as unknown as AudioContext;
    },
    gestureTarget: page,
    visibilityTarget: page,
    maxEffects,
  });
  return { context, page, manager, getFactoryCalls: () => factoryCalls };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('GameAudioManager', () => {
  it('is SSR-safe and does not create an AudioContext merely by attaching', () => {
    const manager = new GameAudioManager();
    const detach = manager.attach();
    expect(manager.getSnapshot()).toMatchObject({
      supported: false,
      attached: false,
      unlocked: false,
      contextState: 'unavailable',
    });
    expect(() => detach()).not.toThrow();
    expect(manager.play('select')).toBe(false);
  });

  it('lazily unlocks on the first pointer or keyboard gesture and attaches once', async () => {
    const { context, page, manager, getFactoryCalls } = createHarness();
    const detach = manager.attach();
    expect(manager.attach()).toBe(detach);
    expect(getFactoryCalls()).toBe(0);

    page.dispatchEvent(new Event('pointerdown'));
    await flushPromises();
    expect(getFactoryCalls()).toBe(1);
    expect(context.resumeCalls).toBe(1);
    expect(manager.getSnapshot()).toMatchObject({
      attached: true,
      unlocked: true,
      contextState: 'running',
    });

    page.dispatchEvent(new Event('keydown'));
    await flushPromises();
    expect(getFactoryCalls()).toBe(1);
    detach();
    expect(manager.getSnapshot().attached).toBe(false);
  });

  it('keeps gesture unlock armed when a mobile browser rejects the first resume', async () => {
    const { context, page, manager } = createHarness();
    context.rejectedResumes = 1;
    manager.attach();

    page.dispatchEvent(new Event('pointerdown'));
    await flushPromises();
    expect(manager.getSnapshot().unlocked).toBe(false);
    expect(context.resumeCalls).toBe(1);

    page.dispatchEvent(new Event('touchend'));
    await flushPromises();
    expect(manager.getSnapshot()).toMatchObject({ unlocked: true, contextState: 'running' });
    expect(context.resumeCalls).toBe(2);
  });

  it('publishes lifecycle snapshots for a settings UI without polling', async () => {
    const { page, manager } = createHarness();
    const states: string[] = [];
    const unsubscribe = manager.subscribe((snapshot) => {
      states.push(`${snapshot.attached}:${snapshot.contextState}:${snapshot.hidden}`);
    });
    manager.attach();
    await manager.unlock();
    page.visibilityState = 'hidden';
    page.dispatchEvent(new Event('visibilitychange'));
    await flushPromises();
    unsubscribe();

    expect(states).toContain('false:unavailable:false');
    expect(states).toContain('true:running:false');
    expect(states.at(-1)).toBe('true:suspended:true');
  });

  it('clamps settings, applies separate buses, and supports a true master mute', async () => {
    const { context, manager } = createHarness();
    await manager.unlock();
    const settings = manager.setSettings({
      masterVolume: 0.5,
      ambienceVolume: -2,
      effectsVolume: 4,
    });
    expect(settings).toEqual({
      muted: false,
      masterVolume: 0.5,
      ambienceVolume: 0,
      effectsVolume: 1,
    });
    expect(context.gains[0]?.gain.value).toBeCloseTo(0.3625);
    expect(context.gains[1]?.gain.value).toBe(0);
    expect(context.gains[2]?.gain.value).toBe(1);

    manager.setMuted(true);
    expect(context.gains[0]?.gain.value).toBe(0);
    expect(manager.play('select')).toBe(false);
  });

  it('crossfades normalized land, sea, and tension mixes without creating a context', () => {
    const { manager, getFactoryCalls } = createHarness();
    expect(manager.setSoundscape('sea', 0.2)).toEqual({ land: 0, sea: 1, tension: 0 });
    expect(manager.setSoundscapeBlend({ land: 1, sea: 1, tension: 1 }, 0.2)).toEqual({
      land: 1 / 3,
      sea: 1 / 3,
      tension: 1 / 3,
    });
    expect(manager.setSoundscape('none')).toEqual({ land: 0, sea: 0, tension: 0 });
    expect(getFactoryCalls()).toBe(0);
  });

  it('suspends in the background, resumes in the foreground, and honors manual pause', async () => {
    const { context, page, manager } = createHarness();
    manager.attach();
    await manager.unlock();

    page.visibilityState = 'hidden';
    page.dispatchEvent(new Event('visibilitychange'));
    await flushPromises();
    expect(context.state).toBe('suspended');
    expect(context.suspendCalls).toBe(1);

    page.visibilityState = 'visible';
    page.dispatchEvent(new Event('visibilitychange'));
    await flushPromises();
    expect(context.state).toBe('running');
    expect(context.resumeCalls).toBe(2);

    await manager.pause();
    page.visibilityState = 'hidden';
    page.dispatchEvent(new Event('visibilitychange'));
    page.visibilityState = 'visible';
    page.dispatchEvent(new Event('visibilitychange'));
    await flushPromises();
    expect(context.state).toBe('suspended');
    expect(manager.getSnapshot().manuallyPaused).toBe(true);
    await manager.resume();
    expect(context.state).toBe('running');
  });

  it('plays every semantic cue and steals the oldest voice at the configured cap', async () => {
    const { context, manager } = createHarness(3);
    await manager.unlock();
    const cues: AudioCue[] = [
      'select',
      'open',
      'close',
      'quarter',
      'action_submit',
      'action_resolve',
      'battle',
      'territory',
      'death',
      'turning_point',
    ];
    for (const cue of cues) expect(manager.play(cue)).toBe(true);
    expect(manager.getSnapshot()).toMatchObject({ activeEffects: 3, maxEffects: 3 });

    context.currentTime += 2;
    expect(manager.getSnapshot().activeEffects).toBe(0);
  });

  it('uses an isolated deterministic noise generator instead of global randomness', async () => {
    const random = vi.spyOn(Math, 'random');
    const { manager } = createHarness();
    await manager.unlock();
    manager.setSoundscapeBlend({ land: 0.4, sea: 0.4, tension: 0.2 });
    manager.play('battle');
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
  });

  it('disposes sources, listeners, and the context cleanly', async () => {
    const { context, page, manager } = createHarness();
    manager.attach();
    page.dispatchEvent(new Event('touchend'));
    await flushPromises();
    expect(manager.play('quarter')).toBe(true);

    await manager.dispose();
    expect(context.closeCalls).toBe(1);
    expect(manager.getSnapshot()).toMatchObject({
      attached: false,
      unlocked: false,
      contextState: 'unavailable',
      activeEffects: 0,
    });
  });
});

describe('normalizeAudioSettings', () => {
  it('accepts malformed persisted input without allowing invalid gain values', () => {
    expect(normalizeAudioSettings({
      masterVolume: Number.NaN,
      ambienceVolume: Number.POSITIVE_INFINITY,
      effectsVolume: -1,
      muted: true,
    })).toEqual({
      muted: true,
      masterVolume: 0.7,
      ambienceVolume: 0.32,
      effectsVolume: 0,
    });
  });
});
