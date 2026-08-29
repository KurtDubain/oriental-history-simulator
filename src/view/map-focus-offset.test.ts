import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MAP_FOCUS_MARGIN,
  resolveMapFocusOffset,
} from './map-focus-offset';

const portraitViewport = { width: 390, height: 644 };
const bottomQuickLook = { x: 0, y: 448, width: 390, height: 196 };

describe('map focus occlusion offset', () => {
  it('leaves a top anchor unchanged when the quick-look does not cover it', () => {
    expect(resolveMapFocusOffset({
      anchor: { x: 195, y: 180 },
      viewport: portraitViewport,
      occlusion: bottomQuickLook,
    })).toEqual({ x: 0, y: 0 });
  });

  it('moves a covered bottom anchor only the minimum distance upward', () => {
    const anchor = { x: 195, y: 520 };
    const offset = resolveMapFocusOffset({
      anchor,
      viewport: portraitViewport,
      occlusion: bottomQuickLook,
    });

    expect(offset).toEqual({ x: 0, y: -88 });
    expect(anchor.y + offset.y).toBe(bottomQuickLook.y - DEFAULT_MAP_FOCUS_MARGIN);
  });

  it('moves a covered landscape anchor left of a right-side panel', () => {
    const viewport = { width: 844, height: 390 };
    const panel = { x: 600, y: 0, width: 244, height: 390 };
    const anchor = { x: 720, y: 195 };
    const offset = resolveMapFocusOffset({ anchor, viewport, occlusion: panel });

    expect(offset).toEqual({ x: -136, y: 0 });
    expect(anchor.x + offset.x).toBe(panel.x - DEFAULT_MAP_FOCUS_MARGIN);
  });

  it('returns zero on both axes when either axis does not overlap', () => {
    expect(resolveMapFocusOffset({
      anchor: { x: 520, y: 340 },
      viewport: { width: 844, height: 390 },
      occlusion: { x: 600, y: 0, width: 244, height: 390 },
    })).toEqual({ x: 0, y: 0 });
  });

  it('keeps the translated anchor inside sensible viewport bounds', () => {
    const anchor = { x: 30, y: 100 };
    const viewport = { width: 390, height: 200 };
    const offset = resolveMapFocusOffset({
      anchor,
      viewport,
      occlusion: { x: 20, y: 0, width: 80, height: 200 },
    });

    expect(offset).toEqual({ x: 86, y: 0 });
    expect(anchor.x + offset.x).toBeGreaterThanOrEqual(DEFAULT_MAP_FOCUS_MARGIN);
    expect(anchor.x + offset.x).toBeLessThanOrEqual(
      viewport.width - DEFAULT_MAP_FOCUS_MARGIN,
    );
  });

  it.each([
    {
      anchor: { x: Number.NaN, y: 10 },
      viewport: portraitViewport,
      occlusion: bottomQuickLook,
    },
    {
      anchor: { x: 10, y: 10 },
      viewport: { width: 0, height: 644 },
      occlusion: bottomQuickLook,
    },
    {
      anchor: { x: 10, y: 10 },
      viewport: portraitViewport,
      occlusion: { x: 0, y: 0, width: -1, height: 100 },
    },
    {
      anchor: { x: -1, y: 10 },
      viewport: portraitViewport,
      occlusion: bottomQuickLook,
    },
  ])('fails safely for invalid input %#', (input) => {
    expect(resolveMapFocusOffset(input)).toEqual({ x: 0, y: 0 });
  });
});
