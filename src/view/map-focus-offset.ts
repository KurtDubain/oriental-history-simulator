export interface MapFocusPoint {
  x: number;
  y: number;
}

export interface MapFocusViewport {
  width: number;
  height: number;
}

export interface MapFocusOcclusion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MapFocusOffsetInput {
  anchor: MapFocusPoint;
  viewport: MapFocusViewport;
  occlusion: MapFocusOcclusion;
  margin?: number;
}

export interface MapFocusOffset {
  x: number;
  y: number;
}

export const DEFAULT_MAP_FOCUS_MARGIN = 16;

const ZERO_OFFSET: Readonly<MapFocusOffset> = Object.freeze({ x: 0, y: 0 });

function isFinitePoint(point: MapFocusPoint) {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function isFiniteViewport(viewport: MapFocusViewport) {
  return Number.isFinite(viewport.width)
    && Number.isFinite(viewport.height)
    && viewport.width > 0
    && viewport.height > 0;
}

function isFiniteOcclusion(occlusion: MapFocusOcclusion) {
  return Number.isFinite(occlusion.x)
    && Number.isFinite(occlusion.y)
    && Number.isFinite(occlusion.width)
    && Number.isFinite(occlusion.height)
    && occlusion.width > 0
    && occlusion.height > 0;
}

interface OffsetCandidate extends MapFocusOffset {
  distance: number;
  axisPriority: number;
}

/**
 * Returns a temporary screen-space translation that keeps a selected map
 * anchor clear of an overlay. It never changes the map camera or world point.
 *
 * The occlusion is expanded by `margin`, then the shortest viable one-axis
 * escape is chosen. A candidate is only viable when the translated anchor
 * remains inside the viewport's own margin. This naturally moves anchors up
 * for bottom sheets and left for right-side landscape panels.
 */
export function resolveMapFocusOffset({
  anchor,
  viewport,
  occlusion,
  margin = DEFAULT_MAP_FOCUS_MARGIN,
}: MapFocusOffsetInput): MapFocusOffset {
  if (
    !isFinitePoint(anchor)
    || !isFiniteViewport(viewport)
    || !isFiniteOcclusion(occlusion)
    || !Number.isFinite(margin)
    || margin < 0
    || anchor.x < 0
    || anchor.x > viewport.width
    || anchor.y < 0
    || anchor.y > viewport.height
  ) {
    return { ...ZERO_OFFSET };
  }

  const left = occlusion.x - margin;
  const right = occlusion.x + occlusion.width + margin;
  const top = occlusion.y - margin;
  const bottom = occlusion.y + occlusion.height + margin;
  const overlapsX = anchor.x > left && anchor.x < right;
  const overlapsY = anchor.y > top && anchor.y < bottom;

  if (!overlapsX || !overlapsY) return { ...ZERO_OFFSET };

  const safeMinX = Math.min(margin, viewport.width / 2);
  const safeMaxX = Math.max(safeMinX, viewport.width - margin);
  const safeMinY = Math.min(margin, viewport.height / 2);
  const safeMaxY = Math.max(safeMinY, viewport.height - margin);
  const candidates: OffsetCandidate[] = [];

  if (left >= safeMinX && left <= safeMaxX) {
    candidates.push({
      x: left - anchor.x,
      y: 0,
      distance: Math.abs(left - anchor.x),
      axisPriority: 1,
    });
  }
  if (right >= safeMinX && right <= safeMaxX) {
    candidates.push({
      x: right - anchor.x,
      y: 0,
      distance: Math.abs(right - anchor.x),
      axisPriority: 1,
    });
  }
  if (top >= safeMinY && top <= safeMaxY) {
    candidates.push({
      x: 0,
      y: top - anchor.y,
      distance: Math.abs(top - anchor.y),
      axisPriority: 0,
    });
  }
  if (bottom >= safeMinY && bottom <= safeMaxY) {
    candidates.push({
      x: 0,
      y: bottom - anchor.y,
      distance: Math.abs(bottom - anchor.y),
      axisPriority: 0,
    });
  }

  candidates.sort((first, second) => (
    first.distance - second.distance || first.axisPriority - second.axisPriority
  ));
  const best = candidates[0];

  if (!best) return { ...ZERO_OFFSET };
  return { x: best.x, y: best.y };
}
