import {
  MAP_LAND_SHAPES,
  MAP_PRESENTATION_HEIGHT,
  MAP_PRESENTATION_WIDTH,
  getRegionDisplaySite,
} from './map-geography';
import type {
  MapArmyView,
  MapCamera,
  MapFleetView,
  MapFlowView,
  MapMarkerView,
  MapPoint,
  MapPresentationView,
  MapRegionView,
  MapSeaZoneView,
  MapViewportTransform,
} from './map-contract';

export const MAP_WORLD_WIDTH = MAP_PRESENTATION_WIDTH;
export const MAP_WORLD_HEIGHT = MAP_PRESENTATION_HEIGHT;
export const MAP_MIN_ZOOM = 1;
export const MAP_MAX_ZOOM = 3.6;
export const MAP_PADDING = 8;
export const DEFAULT_MAP_CAMERA: MapCamera = { zoom: MAP_MIN_ZOOM, panX: 0, panY: 0 };

const MAP_DESKTOP_RENDER_HEIGHT = MAP_PRESENTATION_HEIGHT;
const MAP_COMPACT_RENDER_HEIGHT = MAP_PRESENTATION_HEIGHT;

const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));

function createBaseMapViewportTransform(
  width: number,
  height: number,
  padding = MAP_PADDING,
): MapViewportTransform {
  const drawableWidth = Math.max(1, width - padding * 2);
  const drawableHeight = Math.max(1, height - padding * 2);
  const renderHeight = width < 620 ? MAP_COMPACT_RENDER_HEIGHT : MAP_DESKTOP_RENDER_HEIGHT;
  const scale = Math.min(drawableWidth / MAP_WORLD_WIDTH, drawableHeight / renderHeight);
  return {
    scale,
    offsetX: (width - MAP_WORLD_WIDTH * scale) / 2,
    offsetY: (height - renderHeight * scale) / 2,
    renderHeight,
    yScale: renderHeight / MAP_WORLD_HEIGHT,
  };
}

function clampAxisPan(
  baseOffset: number,
  contentSize: number,
  viewportSize: number,
  rawPan: number,
) {
  const gutter = Math.min(32, Math.max(12, viewportSize * 0.08));
  if (contentSize <= viewportSize - gutter * 2) {
    return (viewportSize - contentSize) / 2 - baseOffset;
  }
  const minimum = viewportSize - gutter - contentSize - baseOffset;
  const maximum = gutter - baseOffset;
  return Math.min(maximum, Math.max(minimum, rawPan));
}

/** Keeps a camera finite and prevents the atlas from being panned completely out of view. */
export function clampMapCamera(
  camera: MapCamera,
  width: number,
  height: number,
  padding = MAP_PADDING,
): MapCamera {
  const zoom = Math.min(
    MAP_MAX_ZOOM,
    Math.max(MAP_MIN_ZOOM, Number.isFinite(camera.zoom) ? camera.zoom : MAP_MIN_ZOOM),
  );
  if (zoom <= MAP_MIN_ZOOM + 0.0001) return { ...DEFAULT_MAP_CAMERA };
  const base = createBaseMapViewportTransform(width, height, padding);
  const rawPanX = Number.isFinite(camera.panX) ? camera.panX : 0;
  const rawPanY = Number.isFinite(camera.panY) ? camera.panY : 0;
  return {
    zoom,
    panX: clampAxisPan(base.offsetX, MAP_WORLD_WIDTH * base.scale * zoom, width, rawPanX),
    panY: clampAxisPan(base.offsetY, base.renderHeight * base.scale * zoom, height, rawPanY),
  };
}

/** Returns the illustrated-atlas transform, including the observer's local camera. */
export function createMapViewportTransform(
  width: number,
  height: number,
  padding = MAP_PADDING,
  camera: MapCamera = DEFAULT_MAP_CAMERA,
): MapViewportTransform {
  const base = createBaseMapViewportTransform(width, height, padding);
  const safeCamera = clampMapCamera(camera, width, height, padding);
  return {
    ...base,
    scale: base.scale * safeCamera.zoom,
    offsetX: base.offsetX + safeCamera.panX,
    offsetY: base.offsetY + safeCamera.panY,
  };
}

/** Zooms around a screen-space focal point so the place under the pointer stays fixed. */
export function zoomMapCameraAtPoint(
  camera: MapCamera,
  nextZoom: number,
  anchor: MapPoint,
  width: number,
  height: number,
  padding = MAP_PADDING,
): MapCamera {
  const base = createBaseMapViewportTransform(width, height, padding);
  const current = clampMapCamera(camera, width, height, padding);
  const zoom = Math.min(MAP_MAX_ZOOM, Math.max(MAP_MIN_ZOOM, nextZoom));
  if (zoom <= MAP_MIN_ZOOM + 0.0001) return { ...DEFAULT_MAP_CAMERA };
  const worldX = (anchor.x - base.offsetX - current.panX) / (base.scale * current.zoom);
  const worldY = (anchor.y - base.offsetY - current.panY)
    / (base.scale * current.zoom * base.yScale);
  return clampMapCamera({
    zoom,
    panX: anchor.x - base.offsetX - worldX * base.scale * zoom,
    panY: anchor.y - base.offsetY - worldY * base.scale * zoom * base.yScale,
  }, width, height, padding);
}

export function panMapCamera(
  camera: MapCamera,
  deltaX: number,
  deltaY: number,
  width: number,
  height: number,
  padding = MAP_PADDING,
): MapCamera {
  return clampMapCamera({
    zoom: camera.zoom,
    panX: camera.panX + deltaX,
    panY: camera.panY + deltaY,
  }, width, height, padding);
}

/** Preserves the world point at screen center when the viewport changes orientation or size. */
export function reframeMapCamera(
  camera: MapCamera,
  previousWidth: number,
  previousHeight: number,
  nextWidth: number,
  nextHeight: number,
  padding = MAP_PADDING,
): MapCamera {
  if (previousWidth <= 1 || previousHeight <= 1) {
    return clampMapCamera(camera, nextWidth, nextHeight, padding);
  }
  const current = clampMapCamera(camera, previousWidth, previousHeight, padding);
  if (current.zoom <= MAP_MIN_ZOOM + 0.0001) return { ...DEFAULT_MAP_CAMERA };
  const focus = screenToWorldPoint(
    { x: previousWidth / 2, y: previousHeight / 2 },
    previousWidth,
    previousHeight,
    padding,
    current,
  );
  const base = createBaseMapViewportTransform(nextWidth, nextHeight, padding);
  return clampMapCamera({
    zoom: current.zoom,
    panX: nextWidth / 2 - base.offsetX - focus.x * base.scale * current.zoom,
    panY: nextHeight / 2 - base.offsetY - focus.y * base.scale * current.zoom * base.yScale,
  }, nextWidth, nextHeight, padding);
}

export function worldToScreenPoint(
  point: MapPoint,
  transform: MapViewportTransform,
): MapPoint {
  return {
    x: transform.offsetX + point.x * transform.scale,
    y: transform.offsetY + point.y * transform.scale * transform.yScale,
  };
}

export function screenToWorldPoint(
  point: MapPoint,
  width: number,
  height: number,
  padding = MAP_PADDING,
  camera: MapCamera = DEFAULT_MAP_CAMERA,
): MapPoint {
  const transform = createMapViewportTransform(width, height, padding, camera);
  return {
    x: (point.x - transform.offsetX) / transform.scale,
    y: (point.y - transform.offsetY) / (transform.scale * transform.yScale),
  };
}

function isPointInPolygon(point: MapPoint, polygon: readonly MapPoint[]) {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const a = polygon[current];
    const b = polygon[previous];
    const crosses =
      (a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** Resolves a CSS-pixel canvas coordinate to the topmost map region. */
export function regionAtScreenPoint(
  regions: readonly MapRegionView[],
  point: MapPoint,
  width: number,
  height: number,
  padding = MAP_PADDING,
  camera: MapCamera = DEFAULT_MAP_CAMERA,
): MapRegionView | null {
  const worldPoint = screenToWorldPoint(point, width, height, padding, camera);
  const containingShapeIds = new Set(
    MAP_LAND_SHAPES
      .filter((shape) => isPointInPolygon(worldPoint, shape.polygon))
      .map((shape) => shape.id),
  );
  const geographicCandidates = regions
    .filter((region) => {
      const site = getRegionDisplaySite(region.id);
      return site ? containingShapeIds.has(site.shapeId) : false;
    })
    .sort((left, right) => {
      const leftDistance = (left.center.x - worldPoint.x) ** 2 + (left.center.y - worldPoint.y) ** 2;
      const rightDistance = (right.center.x - worldPoint.x) ** 2 + (right.center.y - worldPoint.y) ** 2;
      return leftDistance - rightDistance || left.id.localeCompare(right.id);
    });
  if (geographicCandidates[0]) return geographicCandidates[0];

  for (let index = regions.length - 1; index >= 0; index -= 1) {
    const region = regions[index];
    if (!getRegionDisplaySite(region.id)
      && region.polygon.length >= 3
      && isPointInPolygon(worldPoint, region.polygon)) {
      return region;
    }
  }
  return null;
}

export interface MapArmyIconLayout {
  army: MapArmyView;
  point: MapPoint;
  radius: number;
}

/** Exact screen-space positions shared by army drawing and hit testing. */
export function layoutMapArmyIcons(
  armies: readonly MapArmyView[],
  regions: readonly MapRegionView[],
  transform: MapViewportTransform,
): MapArmyIconLayout[] {
  const compactMap = transform.scale < 0.42;
  const regionById = new Map(regions.map((region) => [region.id, region]));
  const armyOffsets = new Map<string, number>();
  return armies.flatMap((army) => {
    const region = army.regionId ? regionById.get(army.regionId) : undefined;
    const anchor = army.position ?? region?.center;
    if (!anchor) return [];
    const slotKey = army.regionId ?? `${Math.round(anchor.x)}:${Math.round(anchor.y)}`;
    const slot = armyOffsets.get(slotKey) ?? 0;
    armyOffsets.set(slotKey, slot + 1);
    const base = worldToScreenPoint(anchor, transform);
    return [{
      army,
      point: {
        x: base.x + (compactMap ? 6 : 14) + (slot % 3) * (compactMap ? 7 : 17),
        y: base.y - (compactMap ? 5 : 12) - Math.floor(slot / 3) * (compactMap ? 8 : 19),
      },
      radius: compactMap ? 3.8 : 9,
    }];
  });
}

export function armyAtScreenPoint(
  armies: readonly MapArmyView[],
  regions: readonly MapRegionView[],
  point: MapPoint,
  width: number,
  height: number,
  padding = MAP_PADDING,
  camera: MapCamera = DEFAULT_MAP_CAMERA,
  coarsePointer = false,
): MapArmyView | null {
  const transform = createMapViewportTransform(width, height, padding, camera);
  const layouts = layoutMapArmyIcons(armies, regions, transform);
  const maximumDistance = coarsePointer ? 22 : 12;
  const nearest = layouts
    .map((layout, index) => ({
      layout,
      index,
      distance: Math.hypot(layout.point.x - point.x, layout.point.y - point.y),
    }))
    .filter(({ layout, distance }) => distance <= Math.max(maximumDistance, layout.radius + 3))
    .sort((left, right) => left.distance - right.distance || right.index - left.index)[0];
  return nearest?.layout.army ?? null;
}

export interface MapRegionNodeLayout {
  kind: "city" | "port";
  region: MapRegionView;
  point: MapPoint;
  radius: number;
}

/** Shared city/port anchors ensure decorative symbols and their hit areas agree. */
export function layoutMapRegionNodes(
  regions: readonly MapRegionView[],
  seaZones: readonly MapSeaZoneView[],
  transform: MapViewportTransform,
): MapRegionNodeLayout[] {
  const compactMap = transform.scale < 0.42;
  return regions.flatMap((region) => {
    const center = worldToScreenPoint(region.center, transform);
    const layouts: MapRegionNodeLayout[] = [];
    const showCity = Boolean(region.capital)
      || (!compactMap && (region.cityLevel ?? 0) >= 3)
      || (region.cityLevel ?? 0) >= 4;
    if (showCity) {
      layouts.push({
        kind: "city",
        region,
        point: { x: center.x, y: center.y - (compactMap ? 7 : 10) },
        radius: compactMap ? 4 : 7,
      });
    }
    if (region.port) {
      const nearestSea = seaZones
        .map((zone) => ({ zone, distance: Math.hypot(zone.center.x - region.center.x, zone.center.y - region.center.y) }))
        .sort((left, right) => left.distance - right.distance)[0]?.zone;
      const seaPoint = nearestSea
        ? worldToScreenPoint(nearestSea.center, transform)
        : { x: center.x + 1, y: center.y + 1 };
      const dx = seaPoint.x - center.x;
      const dy = seaPoint.y - center.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const offset = compactMap ? 5 : 11;
      layouts.push({
        kind: "port",
        region,
        point: { x: center.x + dx / distance * offset, y: center.y + dy / distance * offset },
        radius: compactMap ? 5 : 8,
      });
    }
    return layouts;
  });
}

export function regionNodeAtScreenPoint(
  regions: readonly MapRegionView[],
  seaZones: readonly MapSeaZoneView[],
  point: MapPoint,
  width: number,
  height: number,
  padding = MAP_PADDING,
  camera: MapCamera = DEFAULT_MAP_CAMERA,
  coarsePointer = false,
): MapRegionNodeLayout | null {
  const transform = createMapViewportTransform(width, height, padding, camera);
  return layoutMapRegionNodes(regions, seaZones, transform)
    .map((layout, index) => ({ layout, index, distance: Math.hypot(layout.point.x - point.x, layout.point.y - point.y) }))
    .filter(({ layout, distance }) => distance <= Math.max(coarsePointer ? 22 : 11, layout.radius + 3))
    .sort((left, right) => left.distance - right.distance || right.index - left.index)[0]?.layout ?? null;
}

export type MapSceneHit =
  | { kind: 'fleet'; fleet: MapFleetView }
  | { kind: 'army'; army: MapArmyView }
  | { kind: 'marker'; marker: MapMarkerView }
  | { kind: 'regionNode'; node: MapRegionNodeLayout }
  | { kind: 'flow'; flow: MapFlowView }
  | { kind: 'region'; region: MapRegionView }
  | { kind: 'seaZone'; seaZone: MapSeaZoneView };

export interface ResolveMapSceneHitOptions {
  coarsePointer?: boolean;
  includeSeaZones?: boolean;
  tolerateRegionEdge?: boolean;
}

function nearestByDistance<T>(
  values: readonly T[],
  distance: (value: T) => number,
): { value: T; distance: number } | null {
  return values
    .map((value) => ({ value, distance: distance(value) }))
    .sort((left, right) => left.distance - right.distance)[0] ?? null;
}

function regionNearScreenPoint(
  regions: readonly MapRegionView[],
  point: MapPoint,
  width: number,
  height: number,
  padding: number,
  camera: MapCamera,
  tolerance: number,
) {
  const direct = regionAtScreenPoint(regions, point, width, height, padding, camera);
  if (direct || tolerance <= 0) return direct;
  for (const radius of [tolerance * 0.55, tolerance]) {
    for (let index = 0; index < 8; index += 1) {
      const angle = index * Math.PI / 4;
      const candidate = regionAtScreenPoint(
        regions,
        { x: point.x + Math.cos(angle) * radius, y: point.y + Math.sin(angle) * radius },
        width,
        height,
        padding,
        camera,
      );
      if (candidate) return candidate;
    }
  }
  return null;
}

/**
 * Single priority-ordered owner for hover and tap hit resolution. Drawing uses
 * the same army and region-node layouts, avoiding separate invisible targets.
 */
export function resolveMapSceneHit(
  presentation: MapPresentationView,
  point: MapPoint,
  width: number,
  height: number,
  camera: MapCamera = DEFAULT_MAP_CAMERA,
  options: ResolveMapSceneHitOptions = {},
): MapSceneHit | null {
  const coarse = options.coarsePointer ?? false;
  const transform = createMapViewportTransform(width, height, MAP_PADDING, camera);
  const worldPoint = screenToWorldPoint(point, width, height, MAP_PADDING, camera);
  const worldRadius = (screenPixels: number) => screenPixels
    / Math.max(0.001, transform.scale * Math.min(1, transform.yScale));

  const nearestFleet = nearestByDistance(
    presentation.fleets,
    (fleet) => Math.hypot(fleet.position.x - worldPoint.x, fleet.position.y - worldPoint.y),
  );
  if (nearestFleet && nearestFleet.distance <= worldRadius(coarse ? 22 : 12)) {
    return { kind: 'fleet', fleet: nearestFleet.value };
  }

  const army = armyAtScreenPoint(
    presentation.armies,
    presentation.regions,
    point,
    width,
    height,
    MAP_PADDING,
    camera,
    coarse,
  );
  if (army) return { kind: 'army', army };

  const nearestMarker = nearestByDistance(
    presentation.markers,
    (marker) => Math.hypot(marker.position.x - worldPoint.x, marker.position.y - worldPoint.y),
  );
  if (nearestMarker && nearestMarker.distance <= worldRadius(coarse ? 22 : 12)) {
    return { kind: 'marker', marker: nearestMarker.value };
  }

  const directRegion = regionNearScreenPoint(
    presentation.regions,
    point,
    width,
    height,
    MAP_PADDING,
    camera,
    0,
  );
  const regionNode = regionNodeAtScreenPoint(
    presentation.regions,
    presentation.seaZones,
    point,
    width,
    height,
    MAP_PADDING,
    camera,
    coarse,
  );
  if (regionNode && (!directRegion || regionNode.region.id === directRegion.id)) {
    return { kind: 'regionNode', node: regionNode };
  }

  const nearestFlow = nearestByDistance(presentation.flows, (flow) => {
    const dx = flow.to.x - flow.from.x;
    const dy = flow.to.y - flow.from.y;
    const denominator = dx * dx + dy * dy || 1;
    const ratio = clamp(
      ((worldPoint.x - flow.from.x) * dx + (worldPoint.y - flow.from.y) * dy) / denominator,
    );
    return Math.hypot(
      worldPoint.x - (flow.from.x + ratio * dx),
      worldPoint.y - (flow.from.y + ratio * dy),
    );
  });
  if (nearestFlow && nearestFlow.distance <= worldRadius(coarse ? 18 : 9)) {
    return { kind: 'flow', flow: nearestFlow.value };
  }

  const region = directRegion ?? regionNearScreenPoint(
    presentation.regions,
    point,
    width,
    height,
    MAP_PADDING,
    camera,
    options.tolerateRegionEdge && coarse ? 8 : 0,
  );
  if (region) return { kind: 'region', region };

  if (!options.includeSeaZones) return null;
  const nearestSea = nearestByDistance(
    presentation.seaZones,
    (zone) => Math.hypot(zone.center.x - worldPoint.x, zone.center.y - worldPoint.y),
  );
  if (nearestSea && nearestSea.distance <= worldRadius(coarse ? 30 : 24)) {
    return { kind: 'seaZone', seaZone: nearestSea.value };
  }
  return null;
}
