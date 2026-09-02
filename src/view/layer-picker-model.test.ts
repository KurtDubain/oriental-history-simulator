import { describe, expect, it } from 'vitest';
import type { MapOverlay } from './map-contract';
import {
  LAYER_PICKER_IDS,
  canonicalLayerPickerId,
  projectLayerPicker,
} from './layer-picker-model';

describe('layer picker compact contract', () => {
  it('exposes exactly four layers in their stable player-facing order', () => {
    expect(LAYER_PICKER_IDS).toEqual(['political', 'war', 'food', 'none']);
    expect(projectLayerPicker('political').entries.map((entry) => entry.id))
      .toEqual(LAYER_PICKER_IDS);
  });

  it('projects every accepted overlay onto the same four unique controls', () => {
    const values: readonly MapOverlay[] = LAYER_PICKER_IDS;

    values.forEach((value) => {
      const projection = projectLayerPicker(value);
      expect(projection.entries.map((entry) => entry.id)).toEqual(LAYER_PICKER_IDS);
      expect(projection.entries.filter((entry) => entry.id === projection.activeId)).toHaveLength(1);
      expect(new Set(projection.entries.map((entry) => entry.id)).size).toBe(4);
    });
  });

  it('keeps the canonical active id unchanged', () => {
    expect(canonicalLayerPickerId('war')).toBe('war');
    expect(canonicalLayerPickerId('food')).toBe('food');
  });
});
