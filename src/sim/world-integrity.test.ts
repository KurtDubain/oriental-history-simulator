import { describe, expect, it } from 'vitest';
import {
  computeWorldHash as computeWorldHashFromEngine,
  createWorld,
  getDateForTurn as getDateForTurnFromEngine,
} from './engine';
import { getDateForTurn } from './calendar';
import { computeWorldHash } from './world-hash';

describe('world integrity module boundaries', () => {
  it('keeps the canonical quarterly calendar and the engine compatibility export', () => {
    expect(getDateForTurnFromEngine).toBe(getDateForTurn);
    expect(getDateForTurn(-12)).toEqual({ year: 1, season: '春' });
    expect(getDateForTurn(0)).toEqual({ year: 1, season: '春' });
    expect(getDateForTurn(3)).toEqual({ year: 1, season: '冬' });
    expect(getDateForTurn(4)).toEqual({ year: 2, season: '春' });
    expect(getDateForTurn(7.9)).toEqual({ year: 2, season: '冬' });
  });

  it('keeps the fixed-seed schema-5 hash and the engine compatibility export', () => {
    expect(computeWorldHashFromEngine).toBe(computeWorldHash);
    const world = createWorld('架构边界-入世');
    expect(world.hash).toBe('e0104f5df15f458d');
    expect(computeWorldHash(world)).toBe(world.hash);
  });
});
