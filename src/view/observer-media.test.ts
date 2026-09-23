import { afterEach, describe, expect, it, vi } from 'vitest';
import { ObserverMedia, settledCue } from './observer-media';
import { createObserverInterfaceSettings } from './observer-interface-settings';
import frozenSignals from '../../scripts/fixtures/media/settled-signals.json';

function harness() {
  let clock = 0;
  const voices: Array<{ start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }> = [];
  const context = { state: 'running', destination: {}, resume: vi.fn(async () => {}), close: vi.fn(async () => {}),
    createGain: () => ({ gain: { value: 0 }, connect: vi.fn() }),
    decodeAudioData: vi.fn(async () => ({ duration: .5 })),
    createBufferSource: () => { const v = { start: vi.fn(), stop: vi.fn(), connect: vi.fn(), disconnect: vi.fn() }; voices.push(v); return v; },
  };
  const factory = vi.fn(function () { return context; });
  vi.stubGlobal('AudioContext', factory);
  vi.stubGlobal('document', { hidden: false });
  vi.stubGlobal('performance', { now: () => clock });
  const fetcher = vi.fn(async (_url: string) => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) }));
  vi.stubGlobal('fetch', fetcher);
  const media = new ObserverMedia();
  return { media, context, voices, factory, fetcher, later: () => { clock += 4000; }, enable: () => {
    media.configure({ ...createObserverInterfaceSettings(), sound: true }); media.unlock();
  } };
}
const drained = async () => { for (let i=0;i<10;i++) await Promise.resolve(); };
afterEach(() => vi.unstubAllGlobals());

describe('presentation-only media', () => {
  it('uses frozen current-rule natural evidence without requiring old-world import or a future death quota', () => {
    const {death,succession,battle,sources,source}=frozenSignals;
    const records=[death,succession,battle,...sources],ids=new Set(records.map(r=>r.id));
    expect(records.every(r=>r.sourceFactIds.every(id=>ids.has(id)))).toBe(true);
    expect(death.kind).toBe('character_death');expect(death.importance).toBeGreaterThanOrEqual(4);
    expect(['succession','regency']).toContain(succession.kind);
    expect(battle.kind).toBe('territory_control_changed');expect(battle.importance).toBeGreaterThanOrEqual(4);
    expect(settledCue([death],death.turn)).toBe('farewell');
    expect(settledCue([succession],succession.turn)).toBe('accession');
    expect(settledCue([battle],battle.turn)).toBe('battle-seal');
    expect(settledCue([death],source.turn)).toBeNull();
  });
  it('chooses one representative actual settled event, ignoring old and ordinary history', () => {
    const events = [
      {turn: 3,kind:'character_death',importance:5},
      {turn: 4,kind:'battle',importance:4},
      {turn: 4,kind:'succession',importance:5},
    ];
    expect(settledCue(events,4)).toBe('accession');
    expect(settledCue([...events,{turn:4,kind:'character_death',importance:4}],4)).toBe('farewell');
    expect(settledCue([{turn:4,kind:'battle',importance:3}],4)).toBeNull();
    expect(settledCue([{turn:4,kind:'polity_eliminated',importance:5}],4)).toBe('farewell');
  });
  it('is silent on startup and remembered-on restoration until a gesture; reset never replays history', async () => {
    const h=harness(); h.media.settled([],0,true); h.media.read();
    expect(h.factory).not.toHaveBeenCalled();
    h.media.configure({...createObserverInterfaceSettings(),sound:true}); h.media.settled([],1,true);
    expect(h.fetcher).not.toHaveBeenCalled();
    h.enable(); h.media.reset(); await drained(); expect(h.voices).toHaveLength(0);
    h.media.settled([],400,true); await drained(); expect(h.voices).toHaveLength(1);
  });
  it('deduplicates turns, coalesces rapid automatic events and reads old evidence only as paper', async () => {
    const h=harness();h.enable();
    const records=[{turn:9,kind:'character_death',importance:5},{turn:9,kind:'succession',importance:5}];
    h.media.settled(records,9,false); await drained();
    h.media.settled(records,9,false); h.media.settled(records.map(r=>({...r,turn:10})),10,false);await drained();
    expect(h.voices).toHaveLength(1); expect(h.fetcher).toHaveBeenCalledTimes(1);
    h.later();h.media.read();await drained();expect(h.fetcher.mock.calls.at(-1)?.[0]).toContain('folio-open');
    expect(h.voices[0].stop).toHaveBeenCalled();
  });
  it('mute, zero volume, world switch and page hiding invalidate deferred loads', async () => {
    for (const cancel of ['mute','zero','reset','hidden'] as const) {
      const h=harness(); h.enable();
      let resolve!: (value: unknown) => void;
      h.context.decodeAudioData.mockImplementationOnce(() => new Promise(r => { resolve = r; }) as never);
      h.media.read();await drained();
      if (cancel==='reset') h.media.reset();
      else if (cancel==='hidden') { vi.stubGlobal('document',{hidden:true});h.media.stop(); }
      else h.media.configure({...createObserverInterfaceSettings(),sound:cancel==='zero',volume:cancel==='zero'?0:.4});
      resolve({duration:.5});await drained();expect(h.voices).toHaveLength(0);
    }
  });
  it('drops slow loads, unsupported APIs, fetch/decode/rejected resume failures without throwing', async () => {
    const h=harness();h.enable();h.media.read();h.later();await drained();expect(h.voices).toHaveLength(0);
    h.media.dispose();h.enable();h.fetcher.mockRejectedValueOnce(new Error('offline'));h.media.read();await drained();
    h.later();h.media.read();await drained();expect(h.voices).toHaveLength(0); // failed cue is not fetched each quarter
    h.media.dispose();vi.stubGlobal('AudioContext',function(){throw new Error('blocked');});
    expect(()=>h.media.unlock()).not.toThrow();h.media.settled([],5,true);await drained();
    const blocked=harness();blocked.context.state='suspended';blocked.context.resume.mockRejectedValueOnce(new Error('gesture rejected'));
    blocked.enable();blocked.media.read();await drained();expect(blocked.voices).toHaveLength(0);
    const corrupt=harness();corrupt.enable();corrupt.context.decodeAudioData.mockRejectedValueOnce(new Error('invalid audio'));
    corrupt.media.read();await drained();expect(corrupt.voices).toHaveLength(0);
  });
});
