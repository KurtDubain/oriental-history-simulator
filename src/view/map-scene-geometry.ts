import { getMapProfile } from '../maps';
import type { MapPresentationDefinition } from '../maps/types';
import type {
  MapArmyView,
  MapCamera,
  MapFleetView,
  MapMarkerView,
  MapLodScene,
  MapPoint,
  MapPersonForceClusterView,
  MapPersonForceView,
  MapPresentationView,
  MapRegionView,
  MapSeaZoneView,
  MapViewportTransform,
} from './map-contract';
import { layoutMapMarkers } from './map-marker-layout';

// Every current MapProfile uses this stable scene-space contract. Individual
// coastlines and display sites stay inside the selected profile; camera math
// must not import a particular content package.
export const MAP_WORLD_WIDTH = 1_000;
export const MAP_WORLD_HEIGHT = 700;
export const MAP_MIN_ZOOM = 1;
export const MAP_MAX_ZOOM = 3.6;
export const MAP_PADDING = 8;
export const DEFAULT_MAP_CAMERA: MapCamera = { zoom: MAP_MIN_ZOOM, panX: 0, panY: 0 };

const MAP_DESKTOP_RENDER_HEIGHT = MAP_WORLD_HEIGHT;
const MAP_COMPACT_RENDER_HEIGHT = MAP_WORLD_HEIGHT;

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
  profile: MapPresentationDefinition = getMapProfile().presentation,
): MapRegionView | null {
  const worldPoint = screenToWorldPoint(point, width, height, padding, camera);
  const containingShapeIds = new Set(
    profile.landShapes
      .filter((shape) => isPointInPolygon(worldPoint, shape.polygon))
      .map((shape) => shape.id),
  );
  const geographicCandidates = regions
    .filter((region) => {
      const site = profile.regionDisplaySites[region.id];
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
    if (!profile.regionDisplaySites[region.id]
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
}

export interface MapPersonForceLayout {
  person: MapPersonForceView;
  point: MapPoint;
  radius: number;
}

export function layoutMapPersonForces(
  persons: readonly MapPersonForceView[],
  transform: MapViewportTransform,
): MapPersonForceLayout[] {
  return persons.flatMap((person) => person.position ? [{
    person,
    point: worldToScreenPoint(person.position, transform),
    radius: Math.max(3.6, Math.min(8.5, 3.4 + Math.sqrt(Math.max(0, person.soldiers)) / 17)),
  }] : []);
}

export interface MapPersonClusterLayout {
  cluster: MapPersonForceClusterView;
  point: MapPoint;
  radius: number;
}

export function layoutMapPersonClusters(
  clusters: readonly MapPersonForceClusterView[],
  transform: MapViewportTransform,
): MapPersonClusterLayout[] {
  return clusters.map((cluster) => ({
    cluster,
    point: worldToScreenPoint(cluster.position, transform),
    radius: Math.max(6, Math.min(11, 5 + Math.sqrt(cluster.count))),
  }));
}

/** Formation anchors are retained only for their shared route and movement marks. */
export function layoutMapArmyIcons(
  armies: readonly MapArmyView[],
  regions: readonly MapRegionView[],
  transform: MapViewportTransform,
): MapArmyIconLayout[] {
  const regionById = new Map(regions.map((region) => [region.id, region]));
  return armies.flatMap((army) => {
    const region = army.regionId ? regionById.get(army.regionId) : undefined;
    const anchor = army.position ?? region?.center;
    return anchor ? [{ army, point: worldToScreenPoint(anchor, transform) }] : [];
  });
}

export interface MapRegionNodeLayout {
  kind: "city" | "port";
  region: MapRegionView;
  point: MapPoint;
  radius: number;
}

export interface MapRegionNodeVisibility {
  cityRegionIds?: ReadonlySet<string>;
  portRegionIds?: ReadonlySet<string>;
}

/** Shared city/port anchors ensure decorative symbols and their hit areas agree. */
export function layoutMapRegionNodes(
  regions: readonly MapRegionView[],
  seaZones: readonly MapSeaZoneView[],
  transform: MapViewportTransform,
  visibility?: MapRegionNodeVisibility,
): MapRegionNodeLayout[] {
  const compactMap = transform.scale < 0.42;
  return regions.flatMap((region) => {
    const center = worldToScreenPoint(region.center, transform);
    const layouts: MapRegionNodeLayout[] = [];
    const showCity = visibility?.cityRegionIds
      ? visibility.cityRegionIds.has(region.id)
      : Boolean(region.capital)
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
    if (region.port && (!visibility?.portRegionIds || visibility.portRegionIds.has(region.id))) {
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
  visibility?: MapRegionNodeVisibility,
): MapRegionNodeLayout | null {
  const transform = createMapViewportTransform(width, height, padding, camera);
  return layoutMapRegionNodes(regions, seaZones, transform, visibility)
    .map((layout, index) => ({ layout, index, distance: Math.hypot(layout.point.x - point.x, layout.point.y - point.y) }))
    .filter(({ layout, distance }) => distance <= Math.max(coarsePointer ? 22 : 11, layout.radius + 3))
    .sort((left, right) => left.distance - right.distance || right.index - left.index)[0]?.layout ?? null;
}

export type MapSceneHit =
  | { kind: 'person'; person: MapPersonForceView }
  | { kind: 'personCluster'; cluster: MapPersonForceClusterView }
  | { kind: 'fleet'; fleet: MapFleetView }
  | { kind: 'marker'; marker: MapMarkerView }
  | { kind: 'regionNode'; node: MapRegionNodeLayout }
  | { kind: 'region'; region: MapRegionView }
  | { kind: 'seaZone'; seaZone: MapSeaZoneView };

export interface ResolveMapSceneHitOptions {
  coarsePointer?: boolean;
  includeSeaZones?: boolean;
  tolerateRegionEdge?: boolean;
  focusOffset?: MapPoint;
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
  profile: MapPresentationDefinition,
) {
  const direct = regionAtScreenPoint(regions, point, width, height, padding, camera, profile);
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
        profile,
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
  presentation: MapPresentationView | MapLodScene,
  point: MapPoint,
  width: number,
  height: number,
  camera: MapCamera = DEFAULT_MAP_CAMERA,
  options: ResolveMapSceneHitOptions = {},
): MapSceneHit | null {
  const coarse = options.coarsePointer ?? false;
  const lodScene = 'level' in presentation ? presentation : null;
  const focusOffset = options.focusOffset ?? { x: 0, y: 0 };
  const scenePoint = {
    x: point.x - focusOffset.x,
    y: point.y - focusOffset.y,
  };
  const transform = createMapViewportTransform(width, height, MAP_PADDING, camera);
  const worldPoint = screenToWorldPoint(scenePoint, width, height, MAP_PADDING, camera);
  const worldRadius = (screenPixels: number) => screenPixels
    / Math.max(0.001, transform.scale * Math.min(1, transform.yScale));

  const markerLayouts = layoutMapMarkers(presentation.markers, transform);
  const nearestPoliticalMarker = nearestByDistance(
    markerLayouts,
    (layout) => Math.hypot(layout.point.x - scenePoint.x, layout.point.y - scenePoint.y),
  );
  const politicalMarkerHit = nearestPoliticalMarker
    && nearestPoliticalMarker.distance <= Math.max(coarse ? 22 : 12, nearestPoliticalMarker.value.radius + 3)
    ? nearestPoliticalMarker
    : null;
  const nearestFleet = nearestByDistance(
    presentation.fleets,
    (fleet) => {
      const fleetPoint = worldToScreenPoint(fleet.position, transform);
      return Math.hypot(fleetPoint.x - scenePoint.x, fleetPoint.y - scenePoint.y);
    },
  );
  const nearestPerson = nearestByDistance(
    layoutMapPersonForces(presentation.persons ?? [], transform),
    (layout) => Math.hypot(layout.point.x - scenePoint.x, layout.point.y - scenePoint.y),
  );
  const nearestPersonCluster = nearestByDistance(
    layoutMapPersonClusters(presentation.personClusters ?? [], transform),
    (layout) => Math.hypot(layout.point.x - scenePoint.x, layout.point.y - scenePoint.y),
  );
  const foregroundHits: Array<{ distance: number; priority: number; hit: MapSceneHit }> = [];
  if (nearestPerson && nearestPerson.distance <= Math.max(coarse ? 23 : 12, nearestPerson.value.radius + 4)) {
    foregroundHits.push({ distance: nearestPerson.distance, priority: 0, hit: { kind: 'person', person: nearestPerson.value.person } });
  }
  if (nearestPersonCluster && nearestPersonCluster.distance <= Math.max(coarse ? 24 : 13, nearestPersonCluster.value.radius + 4)) {
    foregroundHits.push({ distance: nearestPersonCluster.distance, priority: 1, hit: { kind: 'personCluster', cluster: nearestPersonCluster.value.cluster } });
  }
  if (nearestFleet && nearestFleet.distance <= (coarse ? 22 : 12)) {
    foregroundHits.push({ distance: nearestFleet.distance, priority: 2, hit: { kind: 'fleet', fleet: nearestFleet.value } });
  }
  if (politicalMarkerHit && foregroundHits.length) {
    foregroundHits.push({ distance: politicalMarkerHit.distance, priority: 3, hit: { kind: 'marker', marker: politicalMarkerHit.value.marker } });
  }
  const foregroundHit = foregroundHits
    .sort((left, right) => {
      const distanceDelta = left.distance - right.distance;
      return Math.abs(distanceDelta) <= 1e-6 ? left.priority - right.priority : distanceDelta;
    })[0];
  if (foregroundHit) return foregroundHit.hit;

  const directRegion = regionNearScreenPoint(
    presentation.regions,
    scenePoint,
    width,
    height,
    MAP_PADDING,
    camera,
    0,
    presentation.profile,
  );
  const regionNode = regionNodeAtScreenPoint(
    presentation.regions,
    presentation.seaZones,
    scenePoint,
    width,
    height,
    MAP_PADDING,
    camera,
    coarse,
    lodScene ? {
      cityRegionIds: lodScene.cityRegionIds,
      portRegionIds: lodScene.portRegionIds,
    } : undefined,
  );
  if (regionNode && (!directRegion || regionNode.region.id === directRegion.id)) {
    const nodeDistance = Math.hypot(regionNode.point.x - scenePoint.x, regionNode.point.y - scenePoint.y);
    if (politicalMarkerHit && politicalMarkerHit.distance + 1e-6 < nodeDistance) {
      return { kind: 'marker', marker: politicalMarkerHit.value.marker };
    }
    return { kind: 'regionNode', node: regionNode };
  }

  if (politicalMarkerHit) return { kind: 'marker', marker: politicalMarkerHit.value.marker };

  const region = directRegion ?? regionNearScreenPoint(
    presentation.regions,
    scenePoint,
    width,
    height,
    MAP_PADDING,
    camera,
    options.tolerateRegionEdge && coarse ? 8 : 0,
    presentation.profile,
  );
  if (region) return { kind: 'region', region };

  if (!options.includeSeaZones) return null;
  const nearestSea = nearestByDistance(
    lodScene
      ? presentation.seaZones.filter((zone) => lodScene.interactiveSeaZoneIds.has(zone.id))
      : presentation.seaZones,
    (zone) => Math.hypot(zone.center.x - worldPoint.x, zone.center.y - worldPoint.y),
  );
  if (nearestSea && nearestSea.distance <= worldRadius(coarse ? 30 : 24)) {
    return { kind: 'seaZone', seaZone: nearestSea.value };
  }
  return null;
}
