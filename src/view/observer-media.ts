import type { ObserverInterfaceSettings } from './observer-interface-settings';

type Cue = 'quarter-step' | 'folio-open' | 'battle-seal' | 'accession' | 'farewell';
type Signal = { turn: number; kind: string; importance: number };

/** Only just-settled Facts/Events; never inspect a dossier or import history. */
export function settledCue(records: readonly Signal[], turn: number): Cue | null {
  const kinds = new Set(records.filter(r => r.turn === turn && r.importance >= 4).map(r => r.kind));
  if (kinds.has('character_death') || kinds.has('polity_eliminated')) return 'farewell';
  if (kinds.has('succession') || kinds.has('regency')) return 'accession';
  if (kinds.has('territory_control_changed') || kinds.has('war_ended')) return 'battle-seal';
  return null;
}

/** One voice, five lazily decoded buffers, no world references or persisted history. */
export class ObserverMedia {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private voice: AudioBufferSourceNode | null = null;
  private buffers = new Map<Cue, Promise<AudioBuffer>>();
  private enabled = false;
  private volume = .4;
  private generation = 0;
  private lastTime = -Infinity;
  private lastTurn = -1;

  configure(settings: ObserverInterfaceSettings) {
    this.enabled = settings.sound;
    this.volume = settings.volume;
    if (!this.enabled || !this.volume) this.stop();
    if (this.gain) this.gain.gain.value = this.volume;
  }

  /** Called from a real gesture, never from mount, advance timers or restoration. */
  unlock() {
    if (!this.enabled || !this.volume || document.hidden) return;
    try {
      if (!this.context) {
        this.context = new AudioContext();
        this.gain = this.context.createGain();
        this.gain.gain.value = this.volume;
        this.gain.connect(this.context.destination);
      }
      if (this.context.state === 'suspended') void this.context.resume().catch(() => {});
    } catch { /* Unsupported/blocked audio must not block the game. */ }
  }

  stop() {
    this.generation++;
    this.voice?.stop();
    this.voice = null;
  }

  reset() {
    this.stop();
    this.lastTurn = -1;
    this.lastTime = -Infinity;
  }

  settled(records: readonly Signal[], turn: number, manual: boolean) {
    if (turn <= this.lastTurn) return;
    this.lastTurn = turn;
    const cue = settledCue(records, turn) ?? (manual ? 'quarter-step' : null);
    if (cue) this.play(cue, manual ? 350 : 3000);
  }

  read() { this.play('folio-open', 700); }

  play(cue: Cue, interval: number) {
    const context = this.context;
    if (!this.enabled || !this.volume || !context || context.state !== 'running' || document.hidden) return;
    const now = performance.now();
    if (now - this.lastTime < interval) return;
    this.lastTime = now;
    this.stop();
    const generation = this.generation;
    let buffer = this.buffers.get(cue);
    if (!buffer) {
      buffer = fetch(`${import.meta.env.BASE_URL}media/sfx/${cue}.mp3`)
        .then(r => { if (!r.ok) throw new Error('audio unavailable'); return r.arrayBuffer(); })
        .then(bytes => context.decodeAudioData(bytes));
      this.buffers.set(cue, buffer);
    }
    void buffer.then(decoded => {
      // Drop late loads, mute/world-switch races and stale cues; never queue them.
      if (generation !== this.generation || document.hidden || performance.now() - now > 1200) return;
      const voice = context.createBufferSource();
      voice.buffer = decoded;
      voice.connect(this.gain!);
      voice.onended = () => { voice.disconnect(); if (this.voice === voice) this.voice = null; };
      this.voice = voice;
      voice.start();
    }).catch(() => {});
  }

  dispose() {
    this.reset();
    void this.context?.close().catch(() => {});
    this.context = null;
    this.buffers.clear();
  }
}
