import { describe, expect, it } from 'vitest';

import { shouldCloseMapSelectionForOverlay } from './map-selection-policy';

describe('map layer selection policy', () => {
  it.each([
    ['tradeCorridor', 'trade'],
    ['migration', 'migration'],
    ['outbreak', 'disease'],
    ['practice', 'knowledge'],
  ] as const)('keeps %s while its owning %s layer remains active', (kind, overlay) => {
    expect(shouldCloseMapSelectionForOverlay(kind, overlay)).toBe(false);
  });

  it.each(['tradeCorridor', 'migration', 'outbreak', 'practice']) (
    'closes %s when switching to another layer',
    (kind) => {
      expect(shouldCloseMapSelectionForOverlay(kind, 'political')).toBe(true);
    },
  );

  it.each(['region', 'army', 'fleet', 'seaZone', 'person']) (
    'keeps persistent %s selections across layer changes',
    (kind) => {
      expect(shouldCloseMapSelectionForOverlay(kind, 'food')).toBe(false);
    },
  );
});
