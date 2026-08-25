import { describe, expect, it } from 'vitest';
import { advanceWorldBy, createWorld, deserializeWorld, serializeWorld } from '../sim';
import {
  createSaveEnvelope,
  encodeWorldFile,
  normalizeWorldSaveLabel,
  normalizeWorldSlot,
  readWorldFile,
  summarizeWorldSave,
} from './storage';

describe('portable V1 world files', () => {
  it('round-trips a 50-year chronicle without double-encoding the world', async () => {
    const world = advanceWorldBy(createWorld('五十年导出'), 200);
    const encoded = encodeWorldFile(serializeWorld(world));
    expect(JSON.parse(encoded)).toMatchObject({ schemaVersion: 1, engineVersion: '1.0.0' });
    const file = new File([encoded], 'world.json', { type: 'application/json' });
    expect(file.size).toBeLessThan(16 * 1024 * 1024);
    const restored = deserializeWorld(await readWorldFile(file));
    expect(restored.hash).toBe(world.hash);
  }, 30_000);

  it('continues to accept the V0.1 string-payload envelope', async () => {
    const world = createWorld('旧式存档');
    const encoded = JSON.stringify({ schemaVersion: 1, payload: serializeWorld(world) });
    const restored = deserializeWorld(await readWorldFile(new File([encoded], 'legacy.json')));
    expect(restored.hash).toBe(world.hash);
  });
});

describe('V1 multi-world collection pure boundaries', () => {
  it('normalizes safe ids and labels while reserving autosave and metadata-like keys', () => {
    expect(normalizeWorldSlot('  branch_01  ')).toBe('branch_01');
    expect(normalizeWorldSaveLabel('  燕海   东征线  ')).toBe('燕海 东征线');
    expect(() => normalizeWorldSlot('autosave')).toThrow(/专用槽位/);
    expect(() => normalizeWorldSlot('meta:watchlist')).toThrow(/只能使用/);
    expect(() => normalizeWorldSlot('../world')).toThrow(/只能使用/);
    expect(() => normalizeWorldSlot(`a${'x'.repeat(64)}`)).toThrow(/不超过 64/);
    expect(() => normalizeWorldSaveLabel(' '.repeat(8))).toThrow(/不能为空/);
  });

  it('creates a V1 envelope and derives collection fields without deserializing the simulation', () => {
    const world = advanceWorldBy(createWorld('收藏摘要'), 3);
    const payload = serializeWorld(world);
    const envelope = createSaveEnvelope(payload, '北海观察线', '2026-08-25T12:00:00.000Z');
    const summary = summarizeWorldSave('branch_01', envelope);

    expect(envelope).toMatchObject({
      schemaVersion: 1,
      savedAt: '2026-08-25T12:00:00.000Z',
      engineVersion: '1.0.0',
      label: '北海观察线',
    });
    expect(summary).toMatchObject({
      slot: 'branch_01',
      label: '北海观察线',
      isAutosave: false,
      status: 'ready',
      seed: world.seed,
      year: world.year,
      season: world.season,
      turn: world.turn,
      hash: world.hash,
      error: null,
    });
    expect(summary.payloadBytes).toBeGreaterThan(1_000);
  });

  it('keeps a damaged slot visible and isolated from valid summaries', () => {
    const goodWorld = createWorld('好档');
    const summaries = [
      summarizeWorldSave('good', createSaveEnvelope(serializeWorld(goodWorld), '好档')),
      summarizeWorldSave('broken', { schemaVersion: 1, payload: '{not json' }),
      summarizeWorldSave('wrong-shape', { metadata: true }),
    ];

    expect(summaries[0]).toMatchObject({ status: 'ready', seed: '好档' });
    expect(summaries[1]).toMatchObject({
      slot: 'broken',
      label: 'broken',
      status: 'corrupt',
      seed: null,
      hash: null,
    });
    expect(summaries[1]?.error).toBeTruthy();
    expect(summaries[2]).toMatchObject({ status: 'corrupt' });
  });

  it('summarizes old local envelopes and marks the legacy engine explicitly', () => {
    const world = createWorld('旧自动续写');
    const summary = summarizeWorldSave('autosave', {
      schemaVersion: 1,
      payload: serializeWorld(world),
    }, true);
    expect(summary).toMatchObject({
      status: 'ready',
      isAutosave: true,
      label: '自动续写',
      engineVersion: '0.1.0',
      seed: world.seed,
      hash: world.hash,
    });
  });
});
