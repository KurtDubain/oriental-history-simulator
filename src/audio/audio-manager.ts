export type Soundscape = 'land' | 'sea' | 'tension';

export type AudioCue =
  | 'select'
  | 'open'
  | 'close'
  | 'quarter'
  | 'action_submit'
  | 'action_resolve'
  | 'battle'
  | 'territory'
  | 'death'
  | 'turning_point';

export interface AudioSettings {
  muted: boolean;
  masterVolume: number;
  ambienceVolume: number;
  effectsVolume: number;
}

export type SoundscapeMix = Record<Soundscape, number>;

export interface AudioManagerSnapshot {
  supported: boolean;
  attached: boolean;
  unlocked: boolean;
  contextState: AudioContextState | 'unavailable';
  manuallyPaused: boolean;
  hidden: boolean;
  activeEffects: number;
  maxEffects: number;
  settings: AudioSettings;
  soundscape: SoundscapeMix;
}

export type AudioManagerListener = (snapshot: AudioManagerSnapshot) => void;

interface VisibilityTarget extends EventTarget {
  readonly visibilityState?: DocumentVisibilityState;
}

export interface AudioManagerOptions {
  contextFactory?: () => AudioContext;
  gestureTarget?: EventTarget;
  visibilityTarget?: VisibilityTarget;
  maxEffects?: number;
  defaultSettings?: Partial<AudioSettings>;
  defaultSoundscape?: Partial<SoundscapeMix>;
}

interface AudioGraph {
  master: GainNode;
  ambience: GainNode;
  effects: GainNode;
  soundscapes: Record<Soundscape, GainNode>;
}

interface ActiveEffect {
  id: number;
  endsAt: number;
  sources: AudioScheduledSourceNode[];
  stopped: boolean;
}

interface ToneSpec {
  start: number;
  duration: number;
  from: number;
  to?: number;
  gain: number;
  wave?: OscillatorType;
}

interface NoiseSpec {
  start: number;
  duration: number;
  gain: number;
  frequency: number;
  type: BiquadFilterType;
}

interface CueRecipe {
  tones: ToneSpec[];
  noise?: NoiseSpec;
}

const SOUND_EFFECTS: Record<AudioCue, CueRecipe> = {
  select: {
    tones: [{ start: 0, duration: 0.08, from: 520, to: 450, gain: 0.085, wave: 'sine' }],
  },
  open: {
    tones: [
      { start: 0, duration: 0.12, from: 310, to: 390, gain: 0.065, wave: 'triangle' },
      { start: 0.045, duration: 0.14, from: 460, to: 540, gain: 0.045, wave: 'sine' },
    ],
  },
  close: {
    tones: [
      { start: 0, duration: 0.14, from: 430, to: 300, gain: 0.055, wave: 'triangle' },
      { start: 0.035, duration: 0.12, from: 320, to: 250, gain: 0.035, wave: 'sine' },
    ],
  },
  quarter: {
    tones: [
      { start: 0, duration: 0.32, from: 392, gain: 0.055, wave: 'sine' },
      { start: 0.13, duration: 0.38, from: 587.33, gain: 0.045, wave: 'sine' },
    ],
  },
  action_submit: {
    tones: [
      { start: 0, duration: 0.12, from: 280, to: 350, gain: 0.06, wave: 'triangle' },
      { start: 0.07, duration: 0.16, from: 420, gain: 0.04, wave: 'sine' },
    ],
  },
  action_resolve: {
    tones: [
      { start: 0, duration: 0.18, from: 330, to: 440, gain: 0.06, wave: 'triangle' },
      { start: 0.11, duration: 0.28, from: 523.25, gain: 0.05, wave: 'sine' },
    ],
  },
  battle: {
    tones: [
      { start: 0, duration: 0.34, from: 82, to: 48, gain: 0.11, wave: 'sawtooth' },
      { start: 0.08, duration: 0.24, from: 110, to: 61, gain: 0.07, wave: 'triangle' },
    ],
    noise: { start: 0, duration: 0.26, gain: 0.12, frequency: 620, type: 'lowpass' },
  },
  territory: {
    tones: [
      { start: 0, duration: 0.2, from: 261.63, gain: 0.05, wave: 'triangle' },
      { start: 0.1, duration: 0.24, from: 392, gain: 0.05, wave: 'triangle' },
      { start: 0.2, duration: 0.34, from: 523.25, gain: 0.045, wave: 'sine' },
    ],
  },
  death: {
    tones: [
      { start: 0, duration: 0.48, from: 293.66, to: 220, gain: 0.045, wave: 'sine' },
      { start: 0.08, duration: 0.56, from: 233.08, to: 164.81, gain: 0.04, wave: 'triangle' },
    ],
  },
  turning_point: {
    tones: [
      { start: 0, duration: 0.25, from: 196, to: 246.94, gain: 0.055, wave: 'triangle' },
      { start: 0.13, duration: 0.34, from: 293.66, gain: 0.05, wave: 'sine' },
      { start: 0.27, duration: 0.52, from: 440, gain: 0.045, wave: 'sine' },
    ],
  },
};

export const DEFAULT_AUDIO_SETTINGS: Readonly<AudioSettings> = Object.freeze({
  muted: false,
  masterVolume: 0.7,
  ambienceVolume: 0.32,
  effectsVolume: 0.68,
});

const DEFAULT_SOUNDSCAPE: Readonly<SoundscapeMix> = Object.freeze({
  land: 1,
  sea: 0,
  tension: 0,
});

const SOUNDSCAPE_NAMES: readonly Soundscape[] = ['land', 'sea', 'tension'];
const MIN_GAIN = 0.0001;

function clampUnit(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

export function normalizeAudioSettings(
  settings: Partial<AudioSettings> | null | undefined,
  fallback: AudioSettings = DEFAULT_AUDIO_SETTINGS,
): AudioSettings {
  return {
    muted: typeof settings?.muted === 'boolean' ? settings.muted : fallback.muted,
    masterVolume: clampUnit(settings?.masterVolume, fallback.masterVolume),
    ambienceVolume: clampUnit(settings?.ambienceVolume, fallback.ambienceVolume),
    effectsVolume: clampUnit(settings?.effectsVolume, fallback.effectsVolume),
  };
}

function normalizeSoundscapeMix(mix: Partial<SoundscapeMix> | null | undefined): SoundscapeMix {
  const normalized: SoundscapeMix = {
    land: clampUnit(mix?.land, 0),
    sea: clampUnit(mix?.sea, 0),
    tension: clampUnit(mix?.tension, 0),
  };
  const total = normalized.land + normalized.sea + normalized.tension;
  if (total > 1) {
    normalized.land /= total;
    normalized.sea /= total;
    normalized.tension /= total;
  }
  return normalized;
}

function volumeCurve(value: number): number {
  // Keep fine control near zero without making normal laptop/mobile settings
  // effectively inaudible. This is roughly +3 dB for effects and +5 dB for
  // the default ambience compared with the former square curve.
  return value * (0.45 + value * 0.55);
}

function getBrowserAudioContextFactory(): (() => AudioContext) | undefined {
  if (typeof window === 'undefined') return undefined;
  const AudioContextConstructor = (
    window as typeof window & { webkitAudioContext?: typeof AudioContext }
  ).AudioContext ?? (
    window as typeof window & { webkitAudioContext?: typeof AudioContext }
  ).webkitAudioContext;
  return AudioContextConstructor ? () => new AudioContextConstructor() : undefined;
}

function createDeterministicNoise(context: AudioContext, seconds: number, seed: number): AudioBuffer {
  const frameCount = Math.max(1, Math.floor(context.sampleRate * seconds));
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const channel = buffer.getChannelData(0);
  let state = seed >>> 0;
  let brown = 0;
  for (let index = 0; index < channel.length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const white = ((state >>> 0) / 0xffffffff) * 2 - 1;
    brown = Math.max(-1, Math.min(1, brown * 0.965 + white * 0.055));
    channel[index] = brown;
  }
  return buffer;
}

function smoothlySet(param: AudioParam, target: number, context: AudioContext, seconds: number): void {
  const now = context.currentTime;
  param.cancelScheduledValues(now);
  param.setValueAtTime(Math.max(0, param.value), now);
  param.linearRampToValueAtTime(Math.max(0, target), now + Math.max(0.001, seconds));
}

function envelope(param: AudioParam, start: number, duration: number, peak: number): void {
  const attack = Math.min(0.018, duration * 0.22);
  param.setValueAtTime(MIN_GAIN, start);
  param.linearRampToValueAtTime(Math.max(MIN_GAIN, peak), start + attack);
  param.linearRampToValueAtTime(MIN_GAIN, start + duration);
}

/**
 * Observer-only Web Audio engine. It never reads or mutates simulation state and
 * creates its AudioContext only after an explicit unlock call or user gesture.
 */
export class GameAudioManager {
  private readonly contextFactory?: () => AudioContext;
  private readonly gestureTarget?: EventTarget;
  private readonly visibilityTarget?: VisibilityTarget;
  private readonly maxEffects: number;
  private context: AudioContext | null = null;
  private graph: AudioGraph | null = null;
  private settings: AudioSettings;
  private soundscape: SoundscapeMix;
  private ambienceSources: AudioScheduledSourceNode[] = [];
  private noiseBuffer: AudioBuffer | null = null;
  private effects = new Map<number, ActiveEffect>();
  private nextEffectId = 1;
  private unlockPromise: Promise<boolean> | null = null;
  private unlocked = false;
  private manuallyPaused = false;
  private hidden = false;
  private resumeAfterVisibility = false;
  private detachLifecycle: (() => void) | null = null;
  private readonly listeners = new Set<AudioManagerListener>();

  constructor(options: AudioManagerOptions = {}) {
    this.contextFactory = options.contextFactory;
    this.gestureTarget = options.gestureTarget;
    this.visibilityTarget = options.visibilityTarget;
    this.maxEffects = Math.max(1, Math.min(16, Math.floor(options.maxEffects ?? 8)));
    this.settings = normalizeAudioSettings(options.defaultSettings);
    this.soundscape = normalizeSoundscapeMix(options.defaultSoundscape ?? DEFAULT_SOUNDSCAPE);
  }

  /** Attach gesture unlock and page-visibility handling. Safe and idempotent on SSR. */
  attach(): () => void {
    if (this.detachLifecycle) return this.detachLifecycle;
    const gestureTarget = this.gestureTarget
      ?? (typeof document === 'undefined' ? undefined : document);
    const visibilityTarget = this.visibilityTarget
      ?? (typeof document === 'undefined' ? undefined : document);
    if (!gestureTarget && !visibilityTarget) return () => undefined;

    const onGesture = (): void => {
      void this.unlock();
    };
    const onVisibility = (): void => {
      const isHidden = visibilityTarget?.visibilityState === 'hidden';
      void this.handleVisibility(isHidden);
    };
    const passiveCapture: AddEventListenerOptions = { capture: true, passive: true };
    gestureTarget?.addEventListener('pointerdown', onGesture, passiveCapture);
    gestureTarget?.addEventListener('touchend', onGesture, passiveCapture);
    gestureTarget?.addEventListener('keydown', onGesture, { capture: true });
    visibilityTarget?.addEventListener('visibilitychange', onVisibility);
    this.hidden = visibilityTarget?.visibilityState === 'hidden';

    const detach = (): void => {
      gestureTarget?.removeEventListener('pointerdown', onGesture, passiveCapture);
      gestureTarget?.removeEventListener('touchend', onGesture, passiveCapture);
      gestureTarget?.removeEventListener('keydown', onGesture, { capture: true });
      visibilityTarget?.removeEventListener('visibilitychange', onVisibility);
      if (this.detachLifecycle === detach) this.detachLifecycle = null;
      this.emit();
    };
    this.detachLifecycle = detach;
    this.emit();
    return detach;
  }

  subscribe(listener: AudioManagerListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  async unlock(): Promise<boolean> {
    if (this.context?.state === 'running' && this.unlocked) return true;
    if (this.unlockPromise) return this.unlockPromise;
    this.unlockPromise = this.performUnlock()
      .then((unlocked) => {
        this.emit();
        return unlocked;
      })
      .finally(() => {
        this.unlockPromise = null;
      });
    return this.unlockPromise;
  }

  private async performUnlock(): Promise<boolean> {
    const context = this.ensureContext();
    if (!context || context.state === 'closed') return false;
    try {
      if (context.state !== 'running' && !this.hidden && !this.manuallyPaused) {
        await context.resume();
      }
      if (context.state === 'running') {
        this.playSilentUnlockPulse(context);
        this.unlocked = true;
        return true;
      }
    } catch {
      return false;
    }
    return false;
  }

  async pause(): Promise<void> {
    this.manuallyPaused = true;
    this.resumeAfterVisibility = false;
    if (this.context && this.context.state === 'running') {
      try {
        await this.context.suspend();
      } catch {
        // Some mobile browsers can reject while changing lifecycle state.
      }
    }
    this.emit();
  }

  async resume(): Promise<boolean> {
    this.manuallyPaused = false;
    if (this.hidden) {
      this.emit();
      return false;
    }
    const resumed = await this.unlock();
    this.emit();
    return resumed;
  }

  setSettings(settings: Partial<AudioSettings>): AudioSettings {
    this.settings = normalizeAudioSettings(settings, this.settings);
    this.applySettings(0.08);
    this.emit();
    return { ...this.settings };
  }

  setMuted(muted: boolean): void {
    this.setSettings({ muted });
  }

  setSoundscape(soundscape: Soundscape | 'none', fadeSeconds = 1.4): SoundscapeMix {
    return this.setSoundscapeBlend(
      soundscape === 'none'
        ? { land: 0, sea: 0, tension: 0 }
        : { land: 0, sea: 0, tension: 0, [soundscape]: 1 },
      fadeSeconds,
    );
  }

  setSoundscapeBlend(mix: Partial<SoundscapeMix>, fadeSeconds = 1.4): SoundscapeMix {
    this.soundscape = normalizeSoundscapeMix(mix);
    if (this.context && this.graph) {
      for (const name of SOUNDSCAPE_NAMES) {
        smoothlySet(
          this.graph.soundscapes[name].gain,
          this.soundscape[name],
          this.context,
          Math.max(0.04, fadeSeconds),
        );
      }
    }
    this.emit();
    return { ...this.soundscape };
  }

  play(cue: AudioCue, intensity = 1): boolean {
    const context = this.context;
    const graph = this.graph;
    if (!this.unlocked || !context || !graph || context.state !== 'running') return false;
    if (this.settings.muted || this.settings.masterVolume === 0 || this.settings.effectsVolume === 0) {
      return false;
    }
    this.pruneEffects(context.currentTime);
    while (this.effects.size >= this.maxEffects) this.stopOldestEffect(context.currentTime);

    const recipe = SOUND_EFFECTS[cue];
    const effect: ActiveEffect = {
      id: this.nextEffectId,
      endsAt: context.currentTime,
      sources: [],
      stopped: false,
    };
    this.nextEffectId += 1;
    const strength = clampUnit(intensity, 1);
    for (const tone of recipe.tones) this.addTone(effect, tone, strength);
    if (recipe.noise) this.addNoise(effect, recipe.noise, strength);
    if (effect.sources.length === 0) return false;

    const anchor = effect.sources.reduce((latest, source) => {
      const latestEnd = Number((latest as AudioScheduledSourceNode & { __endsAt?: number }).__endsAt ?? 0);
      const sourceEnd = Number((source as AudioScheduledSourceNode & { __endsAt?: number }).__endsAt ?? 0);
      return sourceEnd >= latestEnd ? source : latest;
    });
    anchor.onended = () => {
      this.effects.delete(effect.id);
      this.emit();
    };
    this.effects.set(effect.id, effect);
    this.emit();
    return true;
  }

  getSnapshot(): AudioManagerSnapshot {
    if (this.context) this.pruneEffects(this.context.currentTime);
    return {
      supported: Boolean(this.contextFactory ?? getBrowserAudioContextFactory()),
      attached: Boolean(this.detachLifecycle),
      unlocked: this.unlocked,
      contextState: this.context?.state ?? 'unavailable',
      manuallyPaused: this.manuallyPaused,
      hidden: this.hidden,
      activeEffects: this.effects.size,
      maxEffects: this.maxEffects,
      settings: { ...this.settings },
      soundscape: { ...this.soundscape },
    };
  }

  async dispose(): Promise<void> {
    this.detachLifecycle?.();
    const context = this.context;
    if (!context) return;
    for (const effect of this.effects.values()) this.stopEffect(effect, context.currentTime);
    this.effects.clear();
    for (const source of this.ambienceSources) {
      try {
        source.stop();
      } catch {
        // A source may already have stopped during browser teardown.
      }
      source.disconnect();
    }
    this.ambienceSources = [];
    this.graph?.master.disconnect();
    if (context.state !== 'closed') {
      try {
        await context.close();
      } catch {
        // Closing is best-effort during browser teardown.
      }
    }
    this.context = null;
    this.graph = null;
    this.noiseBuffer = null;
    this.unlocked = false;
    this.emit();
  }

  private ensureContext(): AudioContext | null {
    if (this.context) return this.context;
    const factory = this.contextFactory ?? getBrowserAudioContextFactory();
    if (!factory) return null;
    try {
      const context = factory();
      this.context = context;
      this.graph = this.createGraph(context);
      this.applySettings(0.001);
      return context;
    } catch {
      this.context = null;
      this.graph = null;
      return null;
    }
  }

  private createGraph(context: AudioContext): AudioGraph {
    const master = context.createGain();
    const ambience = context.createGain();
    const effects = context.createGain();
    const land = context.createGain();
    const sea = context.createGain();
    const tension = context.createGain();
    ambience.connect(master);
    effects.connect(master);
    master.connect(context.destination);
    land.connect(ambience);
    sea.connect(ambience);
    tension.connect(ambience);
    land.gain.value = Math.max(MIN_GAIN, this.soundscape.land);
    sea.gain.value = Math.max(MIN_GAIN, this.soundscape.sea);
    tension.gain.value = Math.max(MIN_GAIN, this.soundscape.tension);
    this.noiseBuffer = createDeterministicNoise(context, 3.2, 0x6d2b79f5);
    this.createLandSoundscape(context, land);
    this.createSeaSoundscape(context, sea);
    this.createTensionSoundscape(context, tension);
    return { master, ambience, effects, soundscapes: { land, sea, tension } };
  }

  private createLandSoundscape(context: AudioContext, destination: GainNode): void {
    const noise = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const color = context.createGain();
    noise.buffer = this.noiseBuffer;
    noise.loop = true;
    filter.type = 'bandpass';
    filter.frequency.value = 840;
    filter.Q.value = 0.32;
    color.gain.value = 0.035;
    noise.connect(filter).connect(color).connect(destination);

    const breath = context.createOscillator();
    const breathGain = context.createGain();
    const drift = context.createOscillator();
    const driftGain = context.createGain();
    breath.type = 'sine';
    breath.frequency.value = 73.42;
    breathGain.gain.value = 0.007;
    drift.type = 'sine';
    drift.frequency.value = 0.043;
    driftGain.gain.value = 0.0025;
    drift.connect(driftGain).connect(breathGain.gain);
    breath.connect(breathGain).connect(destination);
    noise.start();
    breath.start();
    drift.start();
    this.ambienceSources.push(noise, breath, drift);
  }

  private createSeaSoundscape(context: AudioContext, destination: GainNode): void {
    const wash = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const washGain = context.createGain();
    const tide = context.createOscillator();
    const tideDepth = context.createGain();
    wash.buffer = this.noiseBuffer;
    wash.loop = true;
    filter.type = 'lowpass';
    filter.frequency.value = 680;
    filter.Q.value = 0.55;
    washGain.gain.value = 0.055;
    tide.type = 'sine';
    tide.frequency.value = 0.075;
    tideDepth.gain.value = 0.018;
    tide.connect(tideDepth).connect(washGain.gain);
    wash.connect(filter).connect(washGain).connect(destination);

    const horizon = context.createOscillator();
    const horizonGain = context.createGain();
    horizon.type = 'sine';
    horizon.frequency.value = 55;
    horizonGain.gain.value = 0.004;
    horizon.connect(horizonGain).connect(destination);
    wash.start();
    tide.start();
    horizon.start();
    this.ambienceSources.push(wash, tide, horizon);
  }

  private createTensionSoundscape(context: AudioContext, destination: GainNode): void {
    const low = context.createOscillator();
    const lowGain = context.createGain();
    const beat = context.createOscillator();
    const beatGain = context.createGain();
    const pulse = context.createOscillator();
    const pulseDepth = context.createGain();
    low.type = 'sine';
    low.frequency.value = 46.25;
    lowGain.gain.value = 0.018;
    beat.type = 'triangle';
    beat.frequency.value = 47.05;
    beatGain.gain.value = 0.009;
    pulse.type = 'sine';
    pulse.frequency.value = 0.19;
    pulseDepth.gain.value = 0.004;
    pulse.connect(pulseDepth).connect(lowGain.gain);
    low.connect(lowGain).connect(destination);
    beat.connect(beatGain).connect(destination);
    low.start();
    beat.start();
    pulse.start();
    this.ambienceSources.push(low, beat, pulse);
  }

  private addTone(effect: ActiveEffect, tone: ToneSpec, intensity: number): void {
    const context = this.context;
    const destination = this.graph?.effects;
    if (!context || !destination) return;
    const start = context.currentTime + tone.start;
    const end = start + tone.duration;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = tone.wave ?? 'sine';
    oscillator.frequency.setValueAtTime(Math.max(1, tone.from), start);
    if (tone.to && tone.to !== tone.from) {
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, tone.to), end);
    }
    envelope(gain.gain, start, tone.duration, tone.gain * intensity);
    oscillator.connect(gain).connect(destination);
    oscillator.start(start);
    oscillator.stop(end + 0.01);
    (oscillator as AudioScheduledSourceNode & { __endsAt?: number }).__endsAt = end + 0.01;
    effect.sources.push(oscillator);
    effect.endsAt = Math.max(effect.endsAt, end + 0.01);
  }

  private addNoise(effect: ActiveEffect, noise: NoiseSpec, intensity: number): void {
    const context = this.context;
    const destination = this.graph?.effects;
    if (!context || !destination || !this.noiseBuffer) return;
    const start = context.currentTime + noise.start;
    const end = start + noise.duration;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = this.noiseBuffer;
    filter.type = noise.type;
    filter.frequency.value = noise.frequency;
    filter.Q.value = 0.7;
    envelope(gain.gain, start, noise.duration, noise.gain * intensity);
    source.connect(filter).connect(gain).connect(destination);
    source.start(start, (effect.id * 0.137) % 2.4, noise.duration);
    source.stop(end + 0.01);
    (source as AudioScheduledSourceNode & { __endsAt?: number }).__endsAt = end + 0.01;
    effect.sources.push(source);
    effect.endsAt = Math.max(effect.endsAt, end + 0.01);
  }

  private applySettings(fadeSeconds: number): void {
    if (!this.context || !this.graph) return;
    smoothlySet(
      this.graph.master.gain,
      this.settings.muted ? 0 : volumeCurve(this.settings.masterVolume),
      this.context,
      fadeSeconds,
    );
    smoothlySet(
      this.graph.ambience.gain,
      volumeCurve(this.settings.ambienceVolume),
      this.context,
      fadeSeconds,
    );
    smoothlySet(
      this.graph.effects.gain,
      volumeCurve(this.settings.effectsVolume),
      this.context,
      fadeSeconds,
    );
  }

  private playSilentUnlockPulse(context: AudioContext): void {
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = context.createBuffer(1, 1, context.sampleRate);
    gain.gain.value = 0;
    source.connect(gain).connect(context.destination);
    source.start();
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
    };
  }

  private async handleVisibility(isHidden: boolean): Promise<void> {
    this.hidden = isHidden;
    const context = this.context;
    if (!context) {
      this.emit();
      return;
    }
    if (isHidden) {
      this.resumeAfterVisibility = context.state === 'running' && !this.manuallyPaused;
      if (context.state === 'running') {
        try {
          await context.suspend();
        } catch {
          this.resumeAfterVisibility = false;
        }
      }
      this.emit();
      return;
    }
    if (this.resumeAfterVisibility && !this.manuallyPaused) {
      this.resumeAfterVisibility = false;
      try {
        await context.resume();
        this.unlocked = context.state === 'running';
      } catch {
        this.unlocked = false;
      }
    }
    this.emit();
  }

  private pruneEffects(now: number): void {
    for (const [id, effect] of this.effects) {
      if (effect.stopped || effect.endsAt <= now) this.effects.delete(id);
    }
  }

  private stopOldestEffect(now: number): void {
    const oldest = this.effects.values().next().value as ActiveEffect | undefined;
    if (!oldest) return;
    this.stopEffect(oldest, now);
    this.effects.delete(oldest.id);
  }

  private stopEffect(effect: ActiveEffect, now: number): void {
    if (effect.stopped) return;
    effect.stopped = true;
    for (const source of effect.sources) {
      try {
        source.stop(now + 0.012);
      } catch {
        // A short cue can finish before voice stealing or disposal.
      }
      source.disconnect();
    }
  }

  private emit(): void {
    if (this.listeners.size === 0) return;
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}

/** Shared lazy singleton; importing it is SSR-safe and creates no AudioContext. */
export const gameAudio = new GameAudioManager();
