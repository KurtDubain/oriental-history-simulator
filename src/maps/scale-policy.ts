import type { MapScalePolicy } from './types';

/** Shared scale policy derived from content size rather than a map identity. */
export function deriveMapScalePolicy(regionCount: number, polityCount: number): MapScalePolicy {
  const safeRegions = Math.max(0, Math.floor(regionCount));
  const safePolities = Math.max(0, Math.floor(polityCount));
  if (safeRegions > 64 || safePolities > 8) {
    return Object.freeze({ tier: 'large', denseRegionThreshold: 64, strategicLabelThreshold: 82 });
  }
  if (safeRegions > 40 || safePolities > 5) {
    return Object.freeze({ tier: 'standard', denseRegionThreshold: 48, strategicLabelThreshold: 78 });
  }
  return Object.freeze({ tier: 'compact', denseRegionThreshold: 36, strategicLabelThreshold: 72 });
}

