import { describe, expect, it } from 'vitest';
import type { MapOverlay } from './map-contract';
import {
  LAYER_PICKER_IDS,
  PRIMARY_LAYER_IDS,
  canonicalLayerPickerId,
  projectLayerPicker,
} from './layer-picker-model';

describe('layer picker progressive disclosure', () => {
  it('keeps the four mobile primary layers in a fixed order', () => {
    expect(PRIMARY_LAYER_IDS).toEqual(['political', 'war', 'food', 'none']);
    expect(projectLayerPicker('political').entries.filter((entry) => entry.tier === 'primary').map((entry) => entry.id))
      .toEqual(PRIMARY_LAYER_IDS);
  });

  it('pins one active secondary layer without duplicating it in more', () => {
    const projection = projectLayerPicker('disease');

    expect(projection.activeId).toBe('disease');
    expect(projection.currentEntry).toEqual({ id: 'disease', tier: 'current' });
    expect(projection.moreEntries.map((entry) => entry.id)).not.toContain('disease');
    expect(projection.entries.map((entry) => entry.id)).toHaveLength(10);
    expect(new Set(projection.entries.map((entry) => entry.id)).size).toBe(10);
  });

  it('does not invent a current tier when a primary layer is active', () => {
    const projection = projectLayerPicker('food');

    expect(projection.currentEntry).toBeNull();
    expect(projection.moreEntries).toHaveLength(6);
  });

  it('projects every accepted overlay onto the same ten unique controls', () => {
    const values: readonly MapOverlay[] = LAYER_PICKER_IDS;

    values.forEach((value) => {
      const projection = projectLayerPicker(value);
      expect(projection.entries.map((entry) => entry.id)).toEqual(LAYER_PICKER_IDS);
      expect(projection.entries.filter((entry) => entry.id === projection.activeId)).toHaveLength(1);
    });
  });

  it('keeps the canonical active id unchanged', () => {
    expect(canonicalLayerPickerId('war')).toBe('war');
    expect(canonicalLayerPickerId('knowledge')).toBe('knowledge');
  });
});
