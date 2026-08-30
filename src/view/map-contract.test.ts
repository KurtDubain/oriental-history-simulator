import { describe, expect, it } from 'vitest';
import type { MapOverlay } from './map-contract';

const conflictIsNotAMapOverlay: 'conflict' extends MapOverlay ? false : true = true;

describe('map overlay contract', () => {
  it('uses war as the only public armed-conflict overlay name', () => {
    expect(conflictIsNotAMapOverlay).toBe(true);
  });
});
