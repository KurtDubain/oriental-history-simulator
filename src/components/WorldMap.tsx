import { Minus, Plus, ScanLine } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import "../styles/world-map.css";
import { recordRuntimeMetric, runtimeNow } from "../performance/runtime-profiler";
import {
  MAP_DECORATIVE_ISLETS,
  MAP_LAND_SHAPES,
  MAP_MACRO_LABELS,
  MAP_PRESENTATION_HEIGHT,
  MAP_PRESENTATION_WIDTH,
  MAP_TERRITORY_SHAPES,
  getMapLandShape,
  getRegionDisplaySite,
  getSeaZoneDisplayCenter,
} from "../view/map-geography";
import { buildTerritoryCells } from "../view/map-territories";

export interface MapPoint {
  x: number;
  y: number;
}

export interface MapRegionView {
  id: string;
  name: string;
  polygon: readonly MapPoint[];
  center: MapPoint;
  terrain: string;
  polityId?: string;
  polityName?: string;
  polityColor?: string;
  population: number;
  foodRatio: number;
  unrest?: number;
  warDamage?: number;
  port?: boolean;
  portLevel?: number;
  capital?: boolean;
  cityLevel?: number;
  defense?: number;
  strategicValue?: number;
  diseasePressure?: number;
  knowledgeAdoption?: number;
  refugeePopulation?: number;
  tradeVolume?: number;
}

export interface MapRouteView {
  id?: string;
  from: string;
  to: string;
  type: "land" | "river" | "sea" | string;
  points?: readonly MapPoint[];
}

export interface MapArmyView {
  id: string;
  name: string;
  regionId?: string;
  position?: MapPoint;
  polityId?: string;
  polityColor?: string;
  strength: number;
  morale?: number;
  status?: string;
}

export interface MapSeaZoneView {
  id: string;
  name: string;
  center: MapPoint;
  climate: string;
  controllerName?: string;
  controllerColor?: string;
  contested: boolean;
  traffic: number;
  stormRisk: number;
  piracy: number;
  powerShare: number;
}

export interface MapFleetView {
  id: string;
  name: string;
  seaZoneId?: string | null;
  regionId?: string | null;
  position: MapPoint;
  polityColor?: string;
  strength: number;
  readiness: number;
  mission: string;
}

export type MapFlowKind = "trade" | "migration" | "disease" | "knowledge" | "naval";

export type MapObjectKind = MapFlowView["selectedKind"] | "seaZone" | "fleet" | "army";

export interface MapFlowView {
  id: string;
  kind: MapFlowKind;
  from: MapPoint;
  to: MapPoint;
  magnitude: number;
  label: string;
  selectedKind: "tradeCorridor" | "migration" | "outbreak" | "practice" | "seaZone";
  selectedId: string;
  alert?: boolean;
}

export interface MapMarkerView {
  id: string;
  kind: "outbreak" | "practice";
  position: MapPoint;
  magnitude: number;
  label: string;
  alert?: boolean;
}

export type MapOverlay =
  | "political"
  | "food"
  | "population"
  | "conflict"
  | "war"
  | "trade"
  | "migration"
  | "naval"
  | "disease"
  | "knowledge"
  | "none";

export interface WorldMapProps {
  regions: readonly MapRegionView[];
  routes: readonly MapRouteView[];
  armies: readonly MapArmyView[];
  seaZones?: readonly MapSeaZoneView[];
  fleets?: readonly MapFleetView[];
  flows?: readonly MapFlowView[];
  markers?: readonly MapMarkerView[];
  highlightedRegionIds?: readonly string[];
  selectedRegionId?: string | null;
  selectedObject?: { kind: string; id: string } | null;
  overlay: MapOverlay;
  onSelectRegion: (regionId: string) => void;
  onSelectObject?: (kind: MapObjectKind, id: string) => void;
  cameraKey?: string | number;
  onCameraChange?: (camera: MapCamera) => void;
  className?: string;
}

export interface MapCamera {
  zoom: number;
  panX: number;
  panY: number;
}

export interface MapViewportTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
  renderHeight: number;
  yScale: number;
}

export const MAP_WORLD_WIDTH = MAP_PRESENTATION_WIDTH;
export const MAP_WORLD_HEIGHT = MAP_PRESENTATION_HEIGHT;
export const MAP_MIN_ZOOM = 1;
export const MAP_MAX_ZOOM = 3.6;
export const DEFAULT_MAP_CAMERA: MapCamera = { zoom: MAP_MIN_ZOOM, panX: 0, panY: 0 };

const MAP_PADDING = 8;
const MAP_DESKTOP_RENDER_HEIGHT = MAP_PRESENTATION_HEIGHT;
const MAP_COMPACT_RENDER_HEIGHT = MAP_PRESENTATION_HEIGHT;
const PAPER = "#e7dfca";
const PAPER_LIGHT = "#f4eedf";
const INK = "#292b27";
const INK_SOFT = "#5f5b50";
const VERMILION = "#a33a2e";
const RIVER = "#65757a";
const OLIVE = "#66705b";

interface CanvasSize {
  width: number;
  height: number;
  dpr: number;
}

type HoverState =
  | { kind: "region"; region: MapRegionView; x: number; y: number }
  | { kind: "regionNode"; nodeKind: "city" | "port"; region: MapRegionView; x: number; y: number }
  | { kind: "army"; army: MapArmyView; x: number; y: number }
  | { kind: "fleet"; fleet: MapFleetView; x: number; y: number }
  | { kind: "marker"; marker: MapMarkerView; x: number; y: number }
  | { kind: "flow"; flow: MapFlowView; x: number; y: number };

interface PointerContact {
  pointerType: string;
  current: MapPoint;
}

interface PinchSnapshot {
  camera: MapCamera;
  distance: number;
  midpoint: MapPoint;
}

interface MapGestureState {
  pointerType: string;
  startPoint: MapPoint;
  lastPoint: MapPoint;
  moved: boolean;
  hadMultiple: boolean;
  pinch?: PinchSnapshot;
}

interface TapFeedback {
  id: number;
  x: number;
  y: number;
}

type GeographyAreaId = "heartland" | "northeast" | "lingnan" | "korea" | "japan";

interface GeographicLink {
  from: MapRegionView;
  to: MapRegionView;
}

interface GeographyAreaView {
  id: GeographyAreaId;
  label: string;
  regions: MapRegionView[];
  links: GeographicLink[];
  tint: string;
}

interface GeographyView {
  areas: GeographyAreaView[];
  links: GeographicLink[];
}

const GEOGRAPHY_AREA_STYLE: Record<GeographyAreaId, { label: string; tint: string }> = {
  heartland: { label: "中原山河", tint: "#d8d0b2" },
  northeast: { label: "东北边原", tint: "#c7ccba" },
  lingnan: { label: "岭南海甸", tint: "#ced0aa" },
  korea: { label: "海东半岛", tint: "#d0c9ad" },
  japan: { label: "东瀛列岛", tint: "#cbc3aa" },
};

const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));

const toUnit = (value: number | undefined) => {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return clamp(value > 1 ? value / 100 : value);
};

const hashString = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const polityFallback = (id: string) => {
  const palette = ["#777466", "#7b685e", "#6c746c", "#716c78", "#807258", "#687278"];
  return palette[hashString(id) % palette.length];
};

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
      (a.y > point.y) !== (b.y > point.y) &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
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

  // Preserve the generic component contract for callers supplying custom,
  // non-atlas regions while keeping every illustrated bay and strait as sea.
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

interface MapPresentationView {
  regions: MapRegionView[];
  routes: MapRouteView[];
  armies: MapArmyView[];
  seaZones: MapSeaZoneView[];
  fleets: MapFleetView[];
  flows: MapFlowView[];
  markers: MapMarkerView[];
}

const pointKey = (point: MapPoint) => `${point.x.toFixed(3)}:${point.y.toFixed(3)}`;

/**
 * Reprojects authoritative simulation objects onto a presentation-only atlas.
 * No simulation coordinate, save payload, route distance, or deterministic hash
 * is touched by this layer.
 */
export function buildMapPresentation(
  regions: readonly MapRegionView[],
  routes: readonly MapRouteView[],
  armies: readonly MapArmyView[],
  seaZones: readonly MapSeaZoneView[],
  fleets: readonly MapFleetView[],
  flows: readonly MapFlowView[],
  markers: readonly MapMarkerView[],
): MapPresentationView {
  const knownSites = regions.flatMap((region) => {
    const site = getRegionDisplaySite(region.id);
    return site ? [site] : [];
  });
  const cellByRegionId = new Map(
    buildTerritoryCells(MAP_TERRITORY_SHAPES, knownSites)
      .map((cell) => [cell.siteId, cell] as const),
  );
  const projectedPointByRawPoint = new Map<string, MapPoint>();

  const presentedRegions = regions.map((region) => {
    const site = getRegionDisplaySite(region.id);
    const cell = cellByRegionId.get(region.id);
    if (!site || !cell) return { ...region, center: { ...region.center }, polygon: [...region.polygon] };
    const center = { x: site.x, y: site.y };
    projectedPointByRawPoint.set(pointKey(region.center), center);
    return {
      ...region,
      center,
      polygon: cell.polygon,
    };
  });

  const presentedSeaZones = seaZones.map((zone) => {
    const center = getSeaZoneDisplayCenter(zone.id) ?? zone.center;
    projectedPointByRawPoint.set(pointKey(zone.center), center);
    return { ...zone, center: { ...center } };
  });

  const projectPoint = (point: MapPoint): MapPoint => {
    const exact = projectedPointByRawPoint.get(pointKey(point));
    if (exact) return { ...exact };
    return { ...point };
  };

  return {
    regions: presentedRegions,
    routes: routes.map((route) => ({
      ...route,
      points: route.points?.map(projectPoint),
    })),
    armies: armies.map((army) => ({
      ...army,
      position: army.position ? projectPoint(army.position) : undefined,
    })),
    seaZones: presentedSeaZones,
    fleets: fleets.map((fleet) => ({ ...fleet, position: projectPoint(fleet.position) })),
    flows: flows.map((flow) => ({ ...flow, from: projectPoint(flow.from), to: projectPoint(flow.to) })),
    markers: markers.map((marker) => ({ ...marker, position: projectPoint(marker.position) })),
  };
}

const worldToScreen = (point: MapPoint, transform: MapViewportTransform): MapPoint => ({
  x: transform.offsetX + point.x * transform.scale,
  y: transform.offsetY + point.y * transform.scale * transform.yScale,
});

export interface MapArmyIconLayout {
  army: MapArmyView;
  point: MapPoint;
  radius: number;
}

/**
 * Resolves the exact screen-space position used by both drawing and hit testing.
 * Army badges are intentionally offset from their region label in CSS pixels,
 * so inverse-transforming a tap to the region center is not sufficient.
 */
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
    const base = worldToScreen(anchor, transform);
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

/** Resolves the topmost army badge at a CSS-pixel point, including zoom/pan. */
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
    // Later badges are painted on top, so they win an exact overlap.
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
    const center = worldToScreen(region.center, transform);
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
      const seaPoint = nearestSea ? worldToScreen(nearestSea.center, transform) : { x: center.x + 1, y: center.y + 1 };
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

function makePolygonPath(points: readonly MapPoint[], transform: MapViewportTransform) {
  const path = new Path2D();
  points.forEach((point, index) => {
    const screenPoint = worldToScreen(point, transform);
    if (index === 0) path.moveTo(screenPoint.x, screenPoint.y);
    else path.lineTo(screenPoint.x, screenPoint.y);
  });
  path.closePath();
  return path;
}

function makeRegionPath(region: MapRegionView, transform: MapViewportTransform) {
  return makePolygonPath(region.polygon, transform);
}

function clipToRegionCoast(
  context: CanvasRenderingContext2D,
  region: MapRegionView,
  transform: MapViewportTransform,
) {
  const site = getRegionDisplaySite(region.id);
  const coast = site ? getMapLandShape(site.shapeId) : undefined;
  if (coast) context.clip(makePolygonPath(coast.polygon, transform));
}

function applyLinePath(
  context: CanvasRenderingContext2D,
  points: readonly MapPoint[],
  transform: MapViewportTransform,
) {
  points.forEach((point, index) => {
    const screenPoint = worldToScreen(point, transform);
    if (index === 0) context.moveTo(screenPoint.x, screenPoint.y);
    else context.lineTo(screenPoint.x, screenPoint.y);
  });
}

function formatPopulation(population: number) {
  if (population >= 1_000_000) return `${(population / 1_000_000).toFixed(1)}m`;
  if (population >= 10_000) return `${Math.round(population / 10_000)}万`;
  if (population >= 1_000) return `${(population / 1_000).toFixed(1)}k`;
  return Math.max(0, Math.round(population)).toLocaleString("zh-CN");
}

function foodDescription(ratio: number) {
  if (ratio < 0.55) return "断粮边缘";
  if (ratio < 0.85) return "仓廪吃紧";
  if (ratio < 1.15) return "收支相抵";
  return "仓廪充实";
}

function terrainLabel(terrain: string) {
  const labels: Record<string, string> = {
    plain: "平原",
    plains: "平原",
    hill: "丘陵",
    hills: "丘陵",
    mountain: "山地",
    mountains: "山地",
    basin: "盆地",
    coast: "滨海",
    coastal: "滨海",
    island: "岛屿",
    wetland: "泽地",
    forest: "林地",
    desert: "荒漠",
    plateau: "高原",
  };
  return labels[terrain.toLowerCase()] ?? terrain;
}

function overlayTitle(overlay: MapOverlay) {
  if (overlay === "food") return "粮食余裕";
  if (overlay === "population") return "人口密度";
  if (overlay === "conflict" || overlay === "war") return "战乱压力";
  if (overlay === "trade") return "当季商路";
  if (overlay === "migration") return "人口迁徙";
  if (overlay === "naval") return "海权投射";
  if (overlay === "disease") return "疫病传播";
  if (overlay === "knowledge") return "知识流传";
  if (overlay === "none") return "山河地势";
  return "势力疆域 · 地势底图";
}

function isIslandTerrain(terrain: string) {
  const value = terrain.toLowerCase();
  return value.includes("岛") || value.includes("island");
}

function isMountainTerrain(terrain: string) {
  const value = terrain.toLowerCase();
  return value.includes("山")
    || value.includes("丘")
    || value.includes("高原")
    || value.includes("mountain")
    || value.includes("hill")
    || value.includes("plateau");
}

function pairKey(left: string, right: string) {
  return left < right ? `${left}:${right}` : `${right}:${left}`;
}

const VISUAL_CROSS_SEA_LAND_ROUTES = new Set([
  pairKey("r_nanyang", "r_guangzhou"),
  pairKey("r_runan", "r_quanzhou"),
]);

const KOREAN_REGION_IDS = new Set([
  "r_xianjing",
  "r_pyongyang",
  "r_kaesong",
  "r_hanjing",
  "r_jeonju",
  "r_gyeongju",
]);

function shouldDrawRoute(route: MapRouteView, overlay: MapOverlay) {
  const type = route.type.toLowerCase();
  if (type !== "sea" && VISUAL_CROSS_SEA_LAND_ROUTES.has(pairKey(route.from, route.to))) return false;
  if (overlay === "political") return type === "river";
  if (overlay === "naval" || overlay === "trade") return type === "sea" || type === "river";
  if (overlay === "none") return true;
  return type === "river";
}

function deriveGeography(
  regions: readonly MapRegionView[],
  routes: readonly MapRouteView[],
): GeographyView {
  const areaFor = (region: MapRegionView): GeographyAreaId => {
    const site = getRegionDisplaySite(region.id);
    if (!site) return "heartland";
    if (site.shapeId.startsWith("island_") && !site.shapeId.includes("hainan") && !site.shapeId.includes("taiwan")) return "japan";
    if (KOREAN_REGION_IDS.has(region.id)) return "korea";
    if (site.shapeId === "land_lingnan" || site.shapeId === "island_hainan" || site.shapeId === "island_taiwan") return "lingnan";
    if (region.id === "r_chengde" || site.x >= 395 && site.y <= 150) return "northeast";
    return "heartland";
  };

  const regionById = new Map(regions.map((region) => [region.id, region]));
  const areaByRegionId = new Map(regions.map((region) => [region.id, areaFor(region)]));
  const shapeByRegionId = new Map(regions.map((region) => [region.id, getRegionDisplaySite(region.id)?.shapeId]));
  const linkByKey = new Map<string, GeographicLink>();
  const addLink = (from: MapRegionView, to: MapRegionView) => {
    const key = pairKey(from.id, to.id);
    if (!linkByKey.has(key)) linkByKey.set(key, { from, to });
  };

  for (const route of routes) {
    if (route.type.toLowerCase() === "sea") continue;
    const from = regionById.get(route.from);
    const to = regionById.get(route.to);
    if (!from || !to) continue;
    const fromShape = shapeByRegionId.get(from.id);
    const toShape = shapeByRegionId.get(to.id);
    const distance = Math.hypot(from.center.x - to.center.x, from.center.y - to.center.y);
    if (fromShape && fromShape === toShape && distance <= 160) addLink(from, to);
  }

  for (let leftIndex = 0; leftIndex < regions.length; leftIndex += 1) {
    const left = regions[leftIndex];
    if (isIslandTerrain(left.terrain)) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < regions.length; rightIndex += 1) {
      const right = regions[rightIndex];
      if (isIslandTerrain(right.terrain)) continue;
      const leftShape = shapeByRegionId.get(left.id);
      const rightShape = shapeByRegionId.get(right.id);
      if (!leftShape || leftShape !== rightShape) continue;
      const distance = Math.hypot(left.center.x - right.center.x, left.center.y - right.center.y);
      if (distance <= 108) addLink(left, right);
    }
  }

  const links = [...linkByKey.values()];
  const areaIds: GeographyAreaId[] = ["heartland", "northeast", "lingnan", "korea", "japan"];
  const areas = areaIds.map((id) => {
    const style = GEOGRAPHY_AREA_STYLE[id];
    return {
      id,
      ...style,
      regions: regions.filter((region) => areaByRegionId.get(region.id) === id),
      links: links.filter((link) => areaByRegionId.get(link.from.id) === id && areaByRegionId.get(link.to.id) === id),
    };
  }).filter((area) => area.regions.length > 0);
  return { areas, links };
}

function applySmoothOpenPath(
  context: CanvasRenderingContext2D,
  points: readonly MapPoint[],
  transform: MapViewportTransform,
) {
  if (points.length < 2) return;
  const screenPoints = points.map((point) => worldToScreen(point, transform));
  context.moveTo(screenPoints[0].x, screenPoints[0].y);
  for (let index = 1; index < screenPoints.length - 1; index += 1) {
    const current = screenPoints[index];
    const next = screenPoints[index + 1];
    context.quadraticCurveTo(current.x, current.y, (current.x + next.x) / 2, (current.y + next.y) / 2);
  }
  const last = screenPoints[screenPoints.length - 1];
  context.lineTo(last.x, last.y);
}

function drawPaper(context: CanvasRenderingContext2D, width: number, height: number) {
  const glow = context.createRadialGradient(
    width * 0.48,
    height * 0.42,
    Math.min(width, height) * 0.08,
    width * 0.48,
    height * 0.42,
    Math.max(width, height) * 0.72,
  );
  glow.addColorStop(0, PAPER_LIGHT);
  glow.addColorStop(0.64, PAPER);
  glow.addColorStop(1, "#d7cdb6");
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);

  context.save();
  context.globalAlpha = 0.09;
  context.fillStyle = INK_SOFT;
  for (let y = 9; y < height; y += 23) {
    for (let x = 11; x < width; x += 29) {
      const offset = ((x * 17 + y * 31) % 13) - 6;
      context.fillRect(x + offset, y, 0.55, 0.55);
    }
  }
  context.restore();
}

function drawSeaField(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  _transform: MapViewportTransform,
) {
  const sea = context.createLinearGradient(0, 0, width, height);
  sea.addColorStop(0, "rgba(126, 151, 151, 0.28)");
  sea.addColorStop(0.48, "rgba(105, 139, 143, 0.35)");
  sea.addColorStop(1, "rgba(76, 117, 128, 0.43)");
  context.save();
  context.fillStyle = sea;
  context.fillRect(0, 0, width, height);

  const easternDepth = context.createRadialGradient(
    width,
    height * 0.62,
    10,
    width,
    height * 0.62,
    Math.max(width, height) * 0.58,
  );
  easternDepth.addColorStop(0, "rgba(55, 94, 107, 0.24)");
  easternDepth.addColorStop(1, "rgba(73, 111, 121, 0)");
  context.fillStyle = easternDepth;
  context.fillRect(0, 0, width, height);
  context.restore();
}

function drawSeaMarks(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  _transform: MapViewportTransform,
) {
  context.save();
  context.strokeStyle = "rgba(235, 239, 224, 0.2)";
  context.lineWidth = 0.75;
  const spacing = Math.max(43, Math.min(width, height) * 0.095);
  for (let y = spacing * 0.55; y < height; y += spacing) {
    for (let x = spacing * 0.35; x < width; x += spacing) {
      const shift = ((Math.round(y) * 7 + Math.round(x)) % 19) - 9;
      context.beginPath();
      context.arc(x + shift, y, 7, Math.PI * 1.06, Math.PI * 1.93);
      context.arc(x + shift + 13, y, 7, Math.PI * 1.06, Math.PI * 1.93);
      context.stroke();
    }
  }
  context.restore();
}

function drawLandFoundation(
  context: CanvasRenderingContext2D,
  transform: MapViewportTransform,
) {
  context.save();
  context.lineJoin = "round";
  context.shadowColor = "rgba(28, 47, 49, 0.2)";
  context.shadowBlur = Math.min(12, Math.max(3, 8 * transform.scale));
  for (const shape of [...MAP_LAND_SHAPES, ...MAP_DECORATIVE_ISLETS]) {
    context.beginPath();
    applyLinePath(context, shape.polygon, transform);
    context.closePath();
    context.fillStyle = "role" in shape && shape.role === "mainland" ? "#d8d0b4" : "#d4ccb0";
    context.fill();
    context.strokeStyle = "rgba(242, 235, 214, 0.95)";
    context.lineWidth = Math.min(9, Math.max(2.6, 9 * transform.scale));
    context.stroke();
  }
  context.restore();
}

function drawGeographicContours(
  context: CanvasRenderingContext2D,
  transform: MapViewportTransform,
  compactMap: boolean,
) {
  context.save();
  context.lineJoin = "round";
  for (const shape of [...MAP_LAND_SHAPES, ...MAP_DECORATIVE_ISLETS]) {
    context.beginPath();
    applyLinePath(context, shape.polygon, transform);
    context.closePath();
    context.strokeStyle = "rgba(249, 243, 224, 0.78)";
    context.lineWidth = Math.min(4.5, Math.max(2.2, 4.5 * transform.scale));
    context.stroke();
    context.strokeStyle = "rgba(36, 48, 45, 0.72)";
    context.lineWidth = Math.min(1.8, Math.max(0.85, 1.5 * transform.scale));
    context.stroke();
  }

  context.textAlign = "center";
  context.textBaseline = "middle";
  for (const label of MAP_MACRO_LABELS) {
    if (compactMap && label.kind === "province" && label.priority < 3) continue;
    const point = worldToScreen(label.center, transform);
    const geographical = label.kind !== "province";
    context.font = `${geographical ? 620 : 560} ${compactMap ? 7 : geographical ? 10 : 9}px "Noto Serif SC", "Songti SC", serif`;
    context.lineWidth = compactMap ? 2.4 : 3.4;
    context.strokeStyle = "rgba(231, 224, 201, 0.76)";
    context.strokeText(label.label, point.x, point.y);
    context.fillStyle = geographical ? "rgba(37, 49, 47, 0.58)" : "rgba(47, 49, 42, 0.42)";
    context.fillText(label.label, point.x, point.y);
  }
  context.restore();
}

function regionFill(
  region: MapRegionView,
  overlay: MapOverlay,
  maxPopulation: number,
): { color: string; alpha: number } {
  if (overlay === "none") {
    const terrain = region.terrain.toLowerCase();
    if (terrain.includes("山") || terrain.includes("mountain")) return { color: "#746f62", alpha: 0.34 };
    if (terrain.includes("高原") || terrain.includes("plateau")) return { color: "#8d7b5e", alpha: 0.29 };
    if (terrain.includes("丘陵") || terrain.includes("hill")) return { color: "#7d826a", alpha: 0.27 };
    if (terrain.includes("海岸") || terrain.includes("岛") || terrain.includes("coast") || terrain.includes("island")) {
      return { color: "#728184", alpha: 0.25 };
    }
    return { color: "#89906e", alpha: 0.23 };
  }
  if (overlay === "food") {
    const value = clamp(region.foodRatio / 1.35);
    return { color: value < 0.46 ? VERMILION : OLIVE, alpha: 0.1 + Math.abs(value - 0.46) * 0.45 };
  }
  if (overlay === "population") {
    const value = Math.log1p(Math.max(0, region.population)) / Math.log1p(maxPopulation);
    return { color: INK, alpha: 0.06 + value * 0.42 };
  }
  if (overlay === "disease") {
    const pressure = toUnit(region.diseasePressure);
    return { color: VERMILION, alpha: 0.02 + pressure * 0.48 };
  }
  if (overlay === "knowledge") {
    return { color: OLIVE, alpha: 0.05 + toUnit(region.knowledgeAdoption) * 0.42 };
  }
  if (overlay === "trade") {
    return { color: region.port ? RIVER : INK, alpha: 0.05 + toUnit(region.tradeVolume) * 0.3 };
  }
  if (overlay === "migration") {
    const ratio = (region.refugeePopulation ?? 0) / Math.max(1, region.population);
    return { color: VERMILION, alpha: 0.03 + clamp(ratio * 6) * 0.4 };
  }
  if (overlay === "naval") {
    return { color: region.port ? RIVER : INK, alpha: region.port ? 0.19 : 0.05 };
  }
  if (overlay === "conflict" || overlay === "war") {
    const value = Math.max(toUnit(region.unrest), toUnit(region.warDamage));
    return { color: VERMILION, alpha: 0.04 + value * 0.55 };
  }
  const color = region.polityColor ?? polityFallback(region.polityId ?? region.id);
  return { color, alpha: region.polityId ? 0.32 : 0.12 };
}

function drawSeaZones(
  context: CanvasRenderingContext2D,
  zones: readonly MapSeaZoneView[],
  transform: MapViewportTransform,
  overlay: MapOverlay,
  selectedObject: WorldMapProps["selectedObject"],
) {
  for (const zone of zones) {
    const center = worldToScreen(zone.center, transform);
    const strait = zone.name.includes("海峡") || zone.climate.includes("内海");
    const ocean = zone.name.includes("外洋") || zone.climate.includes("外洋");
    const radiusX = Math.max(17, (strait ? 39 : ocean ? 62 : 50) * transform.scale);
    const radiusY = Math.max(11, (strait ? 23 : ocean ? 42 : 32) * transform.scale);
    const selected = selectedObject?.kind === "seaZone" && selectedObject.id === zone.id;
    const naval = overlay === "naval";
    const contextual = naval || overlay === "trade" || selected;
    context.save();
    if (contextual) {
      context.beginPath();
      context.ellipse(center.x, center.y, radiusX, radiusY, -0.08, 0, Math.PI * 2);
      context.fillStyle = zone.contested ? "rgba(116, 89, 79, 0.18)" : ocean ? "rgba(74, 111, 120, 0.16)" : "rgba(94, 116, 122, 0.13)";
      context.globalAlpha = naval ? 0.56 + clamp(zone.powerShare) * 0.32 : 0.32;
      context.fill();
      context.globalAlpha = naval ? 0.66 : 0.38;
      context.strokeStyle = selected ? VERMILION : zone.contested ? "#86685f" : RIVER;
      context.lineWidth = selected ? 2 : zone.contested ? 1.2 : 0.8;
      context.setLineDash(zone.contested ? [3, 3] : ocean ? [7, 5] : strait ? [2, 3] : []);
      context.stroke();
      context.setLineDash([]);
    }

    context.globalAlpha = 1;
    context.fillStyle = selected ? VERMILION : contextual ? "rgba(61, 82, 88, 0.86)" : "rgba(239, 241, 226, 0.62)";
    context.font = `${selected ? 650 : 560} ${transform.scale < 0.42 ? 8 : 9}px "Noto Serif SC", serif`;
    context.textAlign = "center";
    if (contextual || strait || ocean) context.fillText(zone.name, center.x, center.y + 3);
    context.restore();
  }
}

function drawSeaGeography(
  context: CanvasRenderingContext2D,
  zones: readonly MapSeaZoneView[],
  routes: readonly MapRouteView[],
  regions: readonly MapRegionView[],
  transform: MapViewportTransform,
  compactMap: boolean,
) {
  const regionById = new Map(regions.map((region) => [region.id, region]));
  context.save();
  for (const zone of zones) {
    if (!zone.name.includes("海峡") && !zone.climate.includes("内海") && !zone.name.includes("外洋")) continue;
    const center = worldToScreen(zone.center, transform);
    if (zone.name.includes("外洋")) {
      context.strokeStyle = "rgba(64, 96, 104, 0.34)";
      context.lineWidth = 0.85;
      for (let index = 0; index < 3; index += 1) {
        context.beginPath();
        context.arc(center.x + index * 5 - 5, center.y + 13 + index * 3, 8 + index * 5, Math.PI * 1.1, Math.PI * 1.84);
        context.stroke();
      }
      continue;
    }
    context.strokeStyle = "rgba(68, 93, 97, 0.44)";
    context.lineWidth = 0.8;
    for (let index = -1; index <= 1; index += 1) {
      context.beginPath();
      context.moveTo(center.x - 7, center.y + 13 + index * 3);
      context.quadraticCurveTo(center.x, center.y + 10 + index * 3, center.x + 7, center.y + 13 + index * 3);
      context.stroke();
    }
  }

  for (const route of routes) {
    if (route.type.toLowerCase() !== "sea") continue;
    const from = regionById.get(route.from);
    const to = regionById.get(route.to);
    if (!from || !to) continue;
    const midpoint = worldToScreen({
      x: (from.center.x + to.center.x) / 2,
      y: (from.center.y + to.center.y) / 2,
    }, transform);
    context.strokeStyle = "rgba(56, 83, 88, 0.48)";
    context.lineWidth = 0.8;
    context.beginPath();
    context.moveTo(midpoint.x - 6, midpoint.y - 3);
    context.lineTo(midpoint.x + 6, midpoint.y - 3);
    context.moveTo(midpoint.x - 6, midpoint.y + 1);
    context.lineTo(midpoint.x + 6, midpoint.y + 1);
    context.stroke();
  }
  context.restore();

  if (compactMap || zones.length === 0) return;
  const outer = zones
    .filter((zone) => zone.name.includes("外洋") || zone.climate.includes("外洋"))
    .sort((left, right) => right.center.x - left.center.x)[0];
  if (!outer) return;
  const label = worldToScreen({ x: outer.center.x - 4, y: outer.center.y + 72 }, transform);
  context.save();
  context.fillStyle = "rgba(54, 79, 84, 0.46)";
  context.font = '500 9px "Noto Serif SC", serif';
  context.textAlign = "center";
  context.fillText("外洋潮路", label.x, label.y);
  context.restore();
}

function drawFlows(
  context: CanvasRenderingContext2D,
  flows: readonly MapFlowView[],
  transform: MapViewportTransform,
  selectedObject: WorldMapProps["selectedObject"],
) {
  const maximum = Math.max(1, ...flows.map((flow) => flow.magnitude));
  for (const flow of flows) {
    const from = worldToScreen(flow.from, transform);
    const to = worldToScreen(flow.to, transform);
    const selected = selectedObject?.kind === flow.selectedKind && selectedObject.id === flow.selectedId;
    context.save();
    context.beginPath();
    context.moveTo(from.x, from.y);
    const bend = Math.min(24, Math.hypot(to.x - from.x, to.y - from.y) * 0.16);
    context.quadraticCurveTo((from.x + to.x) / 2, (from.y + to.y) / 2 - bend, to.x, to.y);
    context.strokeStyle = flow.alert || flow.kind === "disease" ? VERMILION : flow.kind === "knowledge" ? OLIVE : RIVER;
    context.globalAlpha = selected ? 0.95 : 0.38 + clamp(flow.magnitude / maximum) * 0.38;
    context.lineWidth = selected ? 2.7 : 0.9 + clamp(flow.magnitude / maximum) * 2.1;
    if (flow.kind === "migration" || flow.kind === "disease") context.setLineDash([5, 4]);
    context.stroke();
    context.setLineDash([]);
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    context.translate(to.x, to.y);
    context.rotate(angle);
    context.beginPath();
    context.moveTo(-7, -3);
    context.lineTo(0, 0);
    context.lineTo(-7, 3);
    context.stroke();
    context.restore();
  }
}

function drawFleets(
  context: CanvasRenderingContext2D,
  fleets: readonly MapFleetView[],
  transform: MapViewportTransform,
  selectedObject: WorldMapProps["selectedObject"],
) {
  for (const fleet of fleets) {
    const point = worldToScreen(fleet.position, transform);
    const selected = selectedObject?.kind === "fleet" && selectedObject.id === fleet.id;
    context.save();
    context.translate(point.x, point.y);
    context.fillStyle = PAPER_LIGHT;
    context.strokeStyle = selected ? VERMILION : fleet.polityColor ?? RIVER;
    context.lineWidth = selected ? 2.1 : 1.4;
    context.beginPath();
    context.moveTo(-8, -2);
    context.lineTo(8, -2);
    context.lineTo(4, 5);
    context.lineTo(-5, 5);
    context.closePath();
    context.fill();
    context.stroke();
    context.beginPath();
    context.moveTo(0, -2);
    context.lineTo(0, -9);
    context.lineTo(5, -5);
    context.closePath();
    context.stroke();
    context.restore();
  }
}

function drawMarkers(
  context: CanvasRenderingContext2D,
  markers: readonly MapMarkerView[],
  transform: MapViewportTransform,
  selectedObject: WorldMapProps["selectedObject"],
) {
  for (const marker of markers) {
    const point = worldToScreen(marker.position, transform);
    const selected = selectedObject?.kind === marker.kind && selectedObject.id === marker.id;
    const radius = selected ? 8 : 5 + clamp(marker.magnitude / 100) * 3;
    context.save();
    context.translate(point.x, point.y);
    context.strokeStyle = marker.kind === "outbreak" ? VERMILION : OLIVE;
    context.fillStyle = marker.kind === "outbreak" ? "rgba(163, 58, 46, 0.12)" : "rgba(102, 112, 91, 0.13)";
    context.lineWidth = selected ? 2.1 : 1.2;
    context.beginPath();
    if (marker.kind === "practice") {
      context.moveTo(0, -radius);
      context.lineTo(radius, 0);
      context.lineTo(0, radius);
      context.lineTo(-radius, 0);
      context.closePath();
    } else {
      context.arc(0, 0, radius, 0, Math.PI * 2);
    }
    context.fill();
    context.stroke();
    context.restore();
  }
}

function nearestRiverCourse(
  candidates: readonly MapRegionView[],
  waypoints: readonly MapPoint[],
) {
  const used = new Set<string>();
  const result: MapPoint[] = [];
  let lastX = -Infinity;
  for (const waypoint of waypoints) {
    const nearest = candidates
      .filter((region) => (
        !used.has(region.id)
        && region.center.x > lastX + 12
        && Math.abs(region.center.x - waypoint.x) <= 105
        && Math.abs(region.center.y - waypoint.y) <= 92
      ))
      .map((region) => ({
        region,
        distance: Math.hypot(
          (region.center.x - waypoint.x) * 1.1,
          (region.center.y - waypoint.y) * 1.45,
        ),
      }))
      .filter((entry) => entry.distance < 150)
      .sort((left, right) => left.distance - right.distance)[0]?.region;
    if (!nearest) continue;
    used.add(nearest.id);
    result.push(nearest.center);
    lastX = nearest.center.x;
  }
  return result;
}

function drawMajorRiverSystems(
  context: CanvasRenderingContext2D,
  regions: readonly MapRegionView[],
  routes: readonly MapRouteView[],
  transform: MapViewportTransform,
  compactMap: boolean,
) {
  const candidateIds = new Set<string>();
  routes.forEach((route) => {
    if (route.type.toLowerCase() !== "river") return;
    candidateIds.add(route.from);
    candidateIds.add(route.to);
  });
  const candidates = regions.filter((region) => candidateIds.has(region.id));
  const northern = nearestRiverCourse(candidates, [
    { x: 105, y: 245 },
    { x: 190, y: 250 },
    { x: 285, y: 318 },
    { x: 365, y: 308 },
    { x: 445, y: 300 },
    { x: 530, y: 245 },
    { x: 615, y: 210 },
    { x: 700, y: 225 },
  ]);
  const southern = nearestRiverCourse(candidates, [
    { x: 255, y: 455 },
    { x: 345, y: 430 },
    { x: 435, y: 438 },
    { x: 520, y: 452 },
    { x: 600, y: 445 },
    { x: 665, y: 470 },
    { x: 720, y: 510 },
  ]);

  const courses = [
    { points: northern, label: "苍河" },
    { points: southern, label: "澜江" },
  ].filter((course) => course.points.length >= 4);
  for (const course of courses) {
    context.save();
    context.beginPath();
    for (const shape of MAP_LAND_SHAPES) {
      applyLinePath(context, shape.polygon, transform);
      context.closePath();
    }
    context.clip();
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    applySmoothOpenPath(context, course.points, transform);
    context.strokeStyle = "rgba(47, 87, 96, 0.17)";
    context.lineWidth = compactMap ? 2.2 : 3.2;
    context.stroke();
    context.beginPath();
    applySmoothOpenPath(context, course.points, transform);
    context.strokeStyle = "rgba(66, 110, 119, 0.78)";
    context.lineWidth = compactMap ? 0.8 : 1.25;
    context.stroke();
    context.restore();

    if (compactMap) continue;
    const labelPoint = worldToScreen(course.points[Math.floor(course.points.length * 0.58)], transform);
    context.save();
    context.fillStyle = "rgba(54, 83, 89, 0.88)";
    context.font = '600 8px "Noto Serif SC", serif';
    context.textAlign = "center";
    context.shadowColor = "rgba(242, 236, 218, 0.98)";
    context.shadowBlur = 3;
    context.fillText(course.label, labelPoint.x, labelPoint.y - 5);
    context.restore();
  }
}

function clusterMountainRegions(regions: readonly MapRegionView[]) {
  const mountainous = regions.filter((region) => isMountainTerrain(region.terrain) && !isIslandTerrain(region.terrain));
  const visited = new Set<string>();
  const clusters: MapRegionView[][] = [];
  for (const region of mountainous) {
    if (visited.has(region.id)) continue;
    const pending = [region];
    const cluster: MapRegionView[] = [];
    visited.add(region.id);
    while (pending.length > 0) {
      const current = pending.pop();
      if (!current) continue;
      cluster.push(current);
      mountainous.forEach((candidate) => {
        if (visited.has(candidate.id)) return;
        if (Math.hypot(current.center.x - candidate.center.x, current.center.y - candidate.center.y) > 148) return;
        visited.add(candidate.id);
        pending.push(candidate);
      });
    }
    if (cluster.length >= 2) clusters.push(cluster);
  }
  return clusters;
}

function orderAlongPrincipalAxis(regions: readonly MapRegionView[]) {
  const meanX = regions.reduce((sum, region) => sum + region.center.x, 0) / regions.length;
  const meanY = regions.reduce((sum, region) => sum + region.center.y, 0) / regions.length;
  let xx = 0;
  let xy = 0;
  let yy = 0;
  regions.forEach((region) => {
    const dx = region.center.x - meanX;
    const dy = region.center.y - meanY;
    xx += dx * dx;
    xy += dx * dy;
    yy += dy * dy;
  });
  const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
  const axis = { x: Math.cos(angle), y: Math.sin(angle) };
  const ordered = [...regions]
    .sort((left, right) => (
      (left.center.x - meanX) * axis.x + (left.center.y - meanY) * axis.y
      - ((right.center.x - meanX) * axis.x + (right.center.y - meanY) * axis.y)
    ));
  if (ordered.length <= 3) return ordered.map((region) => region.center);
  const binCount = Math.min(5, Math.max(3, Math.ceil(ordered.length / 3)));
  return Array.from({ length: binCount }, (_, binIndex) => {
    const start = Math.floor(binIndex * ordered.length / binCount);
    const end = Math.max(start + 1, Math.floor((binIndex + 1) * ordered.length / binCount));
    const bin = ordered.slice(start, end);
    return {
      x: bin.reduce((sum, region) => sum + region.center.x, 0) / bin.length,
      y: bin.reduce((sum, region) => sum + region.center.y, 0) / bin.length,
    };
  });
}

function drawMountainRanges(
  context: CanvasRenderingContext2D,
  geography: GeographyView,
  transform: MapViewportTransform,
  compactMap: boolean,
) {
  const ridges = geography.areas
    .flatMap((area) => clusterMountainRegions(area.regions).sort((left, right) => right.length - left.length).slice(0, 2))
    .filter((cluster) => cluster.length >= 2)
    .slice(0, compactMap ? 4 : 8)
    .map(orderAlongPrincipalAxis);

  for (const ridge of ridges) {
    context.save();
    context.beginPath();
    applySmoothOpenPath(context, ridge, transform);
    context.strokeStyle = "rgba(239, 232, 213, 0.45)";
    context.lineWidth = compactMap ? 1.5 : 2;
    context.stroke();
    context.beginPath();
    applySmoothOpenPath(context, ridge, transform);
    context.strokeStyle = "rgba(49, 51, 44, 0.31)";
    context.lineWidth = compactMap ? 0.65 : 0.85;
    context.stroke();

    if (!compactMap) {
      ridge.forEach((point, index) => {
        if (index === 0 || index === ridge.length - 1) return;
        const center = worldToScreen(point, transform);
        context.beginPath();
        context.moveTo(center.x - 4, center.y + 2);
        context.lineTo(center.x, center.y - 5);
        context.lineTo(center.x + 4, center.y + 2);
        context.stroke();
      });
    }
    context.restore();
  }
}

function drawRegionTerrain(
  context: CanvasRenderingContext2D,
  region: MapRegionView,
  center: MapPoint,
) {
  const terrain = region.terrain.toLowerCase();
  if (terrain.includes("mountain") || terrain.includes("hill") || terrain.includes("山")) {
    context.save();
    context.strokeStyle = "rgba(41, 43, 39, 0.34)";
    context.lineWidth = 0.85;
    const peaks = terrain.includes("mountain") || terrain.includes("山地") ? 3 : 2;
    for (let index = 0; index < peaks; index += 1) {
      const x = center.x - (peaks - 1) * 4.5 + index * 9;
      const y = center.y - 13 - (index % 2) * 2;
      context.beginPath();
      context.moveTo(x - 5, y + 5);
      context.lineTo(x, y - 3.5);
      context.lineTo(x + 5, y + 5);
      context.stroke();
    }
    context.restore();
  } else if (terrain.includes("高原") || terrain.includes("plateau")) {
    context.save();
    context.strokeStyle = "rgba(69, 66, 54, 0.26)";
    context.lineWidth = 0.7;
    for (let index = -1; index <= 1; index += 1) {
      context.beginPath();
      context.moveTo(center.x - 8, center.y - 11 + index * 4);
      context.lineTo(center.x - 2, center.y - 13 + index * 4);
      context.lineTo(center.x + 8, center.y - 11 + index * 4);
      context.stroke();
    }
    context.restore();
  }
}

function drawPort(context: CanvasRenderingContext2D, point: MapPoint, compact = false, selected = false) {
  context.save();
  context.translate(point.x, point.y);
  context.strokeStyle = selected ? VERMILION : "rgba(36, 52, 53, 0.9)";
  context.lineWidth = selected ? (compact ? 1.5 : 1.8) : compact ? 0.9 : 1.15;
  context.beginPath();
  context.moveTo(0, compact ? -3 : -5);
  context.lineTo(0, compact ? 3 : 5);
  context.moveTo(compact ? -2 : -3, compact ? -1 : -2);
  context.lineTo(compact ? 2 : 3, compact ? -1 : -2);
  context.moveTo(compact ? -3 : -5, compact ? 1 : 2);
  context.quadraticCurveTo(0, compact ? 5 : 8, compact ? 3 : 5, compact ? 1 : 2);
  context.stroke();
  context.restore();
}

function drawCity(
  context: CanvasRenderingContext2D,
  point: MapPoint,
  compact: boolean,
  capital: boolean,
  selected: boolean,
) {
  const radius = compact ? 2.2 : 3.1;
  context.save();
  context.fillStyle = PAPER_LIGHT;
  context.strokeStyle = selected ? VERMILION : INK;
  context.lineWidth = selected ? 1.6 : 1;
  context.fillRect(point.x - radius, point.y - radius, radius * 2, radius * 2);
  context.strokeRect(point.x - radius, point.y - radius, radius * 2, radius * 2);
  if (capital) {
    const outer = radius + (compact ? 1.8 : 2.4);
    context.globalAlpha = selected ? 0.96 : 0.72;
    context.strokeRect(point.x - outer, point.y - outer, outer * 2, outer * 2);
  }
  context.restore();
}

function drawPolityLabels(
  context: CanvasRenderingContext2D,
  regions: readonly MapRegionView[],
  transform: MapViewportTransform,
  overlay: MapOverlay,
  compactMap: boolean,
) {
  if (overlay !== "political" || compactMap) return;
  const groups = new Map<string, MapRegionView[]>();
  for (const region of regions) {
    if (!region.polityId || !region.polityName) continue;
    const group = groups.get(region.polityId) ?? [];
    group.push(region);
    groups.set(region.polityId, group);
  }

  context.save();
  context.textAlign = "center";
  context.textBaseline = "middle";
  for (const group of groups.values()) {
    const capital = group.find((region) => region.capital);
    const anchor = capital?.center ?? {
      x: group.reduce((sum, region) => sum + region.center.x, 0) / group.length,
      y: group.reduce((sum, region) => sum + region.center.y, 0) / group.length,
    };
    const point = worldToScreen(anchor, transform);
    const label = group[0]?.polityName;
    if (!label) continue;
    const y = point.y + 18;
    context.font = '650 12px "Noto Serif SC", "Songti SC", STSong, serif';
    context.lineWidth = 4;
    context.strokeStyle = "rgba(241, 235, 218, 0.84)";
    context.strokeText(label, point.x, y);
    context.globalAlpha = 0.72;
    context.fillStyle = INK;
    context.fillText(label, point.x, y);
    context.globalAlpha = 1;
  }
  context.restore();
}

function drawLegend(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  overlay: MapOverlay,
  regions: readonly MapRegionView[],
) {
  const narrow = width < 620;
  const legendWidth = narrow ? Math.min(218, width - 24) : 278;
  const x = 14;
  const y = height - (narrow ? 52 : 58);

  context.save();
  context.fillStyle = "rgba(239, 232, 213, 0.88)";
  context.fillRect(x, y, legendWidth, narrow ? 38 : 44);
  context.strokeStyle = "rgba(41, 43, 39, 0.26)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(x, y);
  context.lineTo(x + legendWidth, y);
  context.stroke();

  context.fillStyle = INK;
  context.font = '600 10px "Noto Serif SC", "Songti SC", serif';
  context.textBaseline = "middle";
  context.fillText(overlayTitle(overlay), x + 9, y + 12);

  const swatchX = x + 9;
  const swatchY = y + (narrow ? 27 : 30);
  const gradient = context.createLinearGradient(swatchX, 0, swatchX + 58, 0);
  if (overlay === "political") {
    const colors = [...new Set(regions.map((region) => region.polityColor).filter((color): color is string => Boolean(color)))];
    const visibleColors = colors.length ? colors : ["#9e7d70", "#7f9286", "#878395", "#a49b78"];
    visibleColors.slice(0, 8).forEach((color, index, items) => {
      gradient.addColorStop(items.length === 1 ? 0 : index / (items.length - 1), color);
    });
  } else if (overlay === "conflict" || overlay === "war" || overlay === "disease" || overlay === "migration") {
    gradient.addColorStop(0, "rgba(163, 58, 46, 0.06)");
    gradient.addColorStop(1, "rgba(163, 58, 46, 0.62)");
  } else if (overlay === "population") {
    gradient.addColorStop(0, "rgba(41, 43, 39, 0.05)");
    gradient.addColorStop(1, "rgba(41, 43, 39, 0.52)");
  } else if (overlay === "food") {
    gradient.addColorStop(0, "rgba(163, 58, 46, 0.48)");
    gradient.addColorStop(1, "rgba(102, 112, 91, 0.58)");
  } else if (overlay === "knowledge") {
    gradient.addColorStop(0, "rgba(102, 112, 91, 0.06)");
    gradient.addColorStop(1, "rgba(102, 112, 91, 0.62)");
  } else if (overlay === "trade" || overlay === "naval") {
    gradient.addColorStop(0, "rgba(101, 117, 122, 0.06)");
    gradient.addColorStop(1, "rgba(101, 117, 122, 0.64)");
  } else {
    gradient.addColorStop(0, "rgba(80, 80, 72, 0.12)");
    gradient.addColorStop(1, "rgba(80, 80, 72, 0.54)");
  }
  context.fillStyle = gradient;
  context.fillRect(swatchX, swatchY - 3, 58, 6);
  context.font = '9px Inter, "Noto Sans SC", sans-serif';
  context.fillStyle = INK_SOFT;
  if (overlay === "political") {
    context.fillText("各色政权", swatchX + 64, swatchY);
  } else if (overlay === "none") {
    context.fillText("平野", swatchX + 64, swatchY);
    context.fillText("山地", swatchX + 90, swatchY);
  } else {
    context.fillText("低", swatchX + 64, swatchY);
    context.fillText("高", swatchX + 83, swatchY);
  }

  if (!narrow) {
    const routeX = x + 122;
    context.strokeStyle = RIVER;
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(routeX, swatchY);
    context.lineTo(routeX + 20, swatchY);
    context.stroke();
    context.fillText("河运", routeX + 25, swatchY);

    context.strokeStyle = INK_SOFT;
    context.setLineDash([3, 3]);
    context.beginPath();
    context.moveTo(routeX + 65, swatchY);
    context.lineTo(routeX + 85, swatchY);
    context.stroke();
    context.setLineDash([]);
    context.fillText("陆路", routeX + 90, swatchY);
  }
  context.restore();
}

function drawCompass(context: CanvasRenderingContext2D, width: number) {
  const x = width - 28;
  const y = 30;
  context.save();
  context.strokeStyle = "rgba(41, 43, 39, 0.55)";
  context.fillStyle = INK;
  context.lineWidth = 1;
  context.font = '600 9px "Noto Serif SC", serif';
  context.textAlign = "center";
  context.fillText("北", x, y - 13);
  context.beginPath();
  context.moveTo(x, y - 8);
  context.lineTo(x - 4, y + 4);
  context.lineTo(x, y + 1);
  context.lineTo(x + 4, y + 4);
  context.closePath();
  context.stroke();
  context.restore();
}

function drawMap(
  context: CanvasRenderingContext2D,
  size: CanvasSize,
  regions: readonly MapRegionView[],
  routes: readonly MapRouteView[],
  armies: readonly MapArmyView[],
  seaZones: readonly MapSeaZoneView[],
  fleets: readonly MapFleetView[],
  flows: readonly MapFlowView[],
  markers: readonly MapMarkerView[],
  overlay: MapOverlay,
  highlightedRegionIds: readonly string[],
  selectedRegionId: string | null | undefined,
  selectedObject: WorldMapProps["selectedObject"],
  hoveredRegionId: string | undefined,
  camera: MapCamera,
) {
  const { width, height, dpr } = size;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);

  const transform = createMapViewportTransform(width, height, MAP_PADDING, camera);
  const compactMap = transform.scale < 0.42;
  const denseMap = regions.length > 64;
  const regionById = new Map(regions.map((region) => [region.id, region]));
  const regionNodesByRegion = new Map<string, MapRegionNodeLayout[]>();
  for (const node of layoutMapRegionNodes(regions, seaZones, transform)) {
    const nodes = regionNodesByRegion.get(node.region.id) ?? [];
    nodes.push(node);
    regionNodesByRegion.set(node.region.id, nodes);
  }
  const highlightedRegions = new Set(highlightedRegionIds);
  const maxPopulation = Math.max(1, ...regions.map((region) => region.population));
  const geography = deriveGeography(regions, routes);

  drawPaper(context, width, height);
  drawSeaField(context, width, height, transform);
  drawSeaMarks(context, width, height, transform);
  drawSeaZones(context, seaZones, transform, overlay, selectedObject);
  drawLandFoundation(context, transform);

  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";

  regions.forEach((region) => {
    if (region.polygon.length < 3) return;
    const path = makeRegionPath(region, transform);
    const fill = regionFill(region, overlay, maxPopulation);
    context.save();
    clipToRegionCoast(context, region, transform);
    context.globalAlpha = fill.alpha;
    context.fillStyle = fill.color;
    context.fill(path);
    context.globalAlpha = 1;
    context.strokeStyle = "rgba(41, 43, 39, 0.34)";
    context.lineWidth = 0.65;
    context.stroke(path);
    context.restore();
  });

  drawGeographicContours(context, transform, compactMap);
  drawMountainRanges(context, geography, transform, compactMap);

  routes.forEach((route) => {
    if (!shouldDrawRoute(route, overlay)) return;
    const from = regionById.get(route.from);
    const to = regionById.get(route.to);
    const points = route.points ?? (from && to ? [from.center, to.center] : []);
    if (points.length < 2) return;

    const type = route.type.toLowerCase();
    context.beginPath();
    applyLinePath(context, points, transform);
    if (type === "river") {
      // River routes are a transport graph, not literal cartography. The two
      // smoothed, land-clipped river systems below carry the visible geography.
      return;
    } else if (type === "sea") {
      context.strokeStyle = RIVER;
      context.globalAlpha = 0.54;
      context.lineWidth = 1;
      context.setLineDash([3, 5]);
      context.stroke();
      context.setLineDash([]);
    } else {
      context.strokeStyle = INK_SOFT;
      context.globalAlpha = 0.38;
      context.lineWidth = 0.8;
      context.setLineDash([2, 3]);
      context.stroke();
      context.setLineDash([]);
    }
    context.globalAlpha = 1;
  });

  drawMajorRiverSystems(context, regions, routes, transform, compactMap);
  drawSeaGeography(context, seaZones, routes, regions, transform, compactMap);

  drawFlows(context, flows, transform, selectedObject);
  drawMarkers(context, markers, transform, selectedObject);

  regions.forEach((region) => {
    const center = worldToScreen(region.center, transform);
    if (!compactMap && overlay === "none") {
      drawRegionTerrain(context, region, center);
    }
    const regionNodes = regionNodesByRegion.get(region.id) ?? [];
    const portNode = regionNodes.find((node) => node.kind === "port");
    if (portNode) drawPort(context, portNode.point, compactMap, region.id === selectedRegionId);

    const selected = region.id === selectedRegionId;
    const hovered = region.id === hoveredRegionId;
    const highlighted = highlightedRegions.has(region.id);
    if (highlighted && !selected && !hovered) {
      const path = makeRegionPath(region, transform);
      context.save();
      clipToRegionCoast(context, region, transform);
      context.strokeStyle = VERMILION;
      context.globalAlpha = 0.72;
      context.lineWidth = 1.45;
      context.setLineDash([4, 3]);
      context.shadowColor = "rgba(163, 58, 46, 0.25)";
      context.shadowBlur = 5;
      context.stroke(path);
      context.restore();
    }
    if (selected || hovered) {
      const path = makeRegionPath(region, transform);
      context.save();
      clipToRegionCoast(context, region, transform);
      context.strokeStyle = VERMILION;
      context.lineWidth = selected ? 2.2 : 1.35;
      context.shadowColor = "rgba(163, 58, 46, 0.34)";
      context.shadowBlur = selected ? 8 : 4;
      context.stroke(path);
      context.restore();
    }

    context.save();
    const showLabel = (!compactMap && (!denseMap || region.capital || (region.strategicValue ?? 0) >= 78))
      || region.capital || (region.strategicValue ?? 0) >= 88 || selected || hovered;
    if (showLabel) {
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillStyle = selected ? VERMILION : INK;
      context.font = `${selected ? 650 : 560} ${compactMap ? 9 : selected ? 12 : 11}px "Noto Serif SC", "Songti SC", STSong, serif`;
      context.shadowColor = "rgba(244, 238, 223, 0.92)";
      context.shadowBlur = 3;
      context.fillText(region.name, center.x, center.y + 2);
    }
    const cityNode = regionNodes.find((node) => node.kind === "city");
    if (cityNode) drawCity(context, cityNode.point, compactMap, Boolean(region.capital), selected || hovered);
    context.restore();
  });

  drawPolityLabels(context, regions, transform, overlay, compactMap);

  layoutMapArmyIcons(armies, regions, transform).forEach(({ army, point, radius }) => {
    const { x, y } = point;
    const color = army.polityColor ?? polityFallback(army.polityId ?? army.id);
    const selected = selectedObject?.kind === "army" && selectedObject.id === army.id;

    context.save();
    if (compactMap) {
      context.fillStyle = PAPER_LIGHT;
      context.beginPath();
      context.arc(x, y, selected ? radius + 1.5 : radius, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = selected ? VERMILION : color;
      context.lineWidth = selected ? 2.2 : 1.4;
      if (selected) {
        context.shadowColor = "rgba(163, 58, 46, 0.34)";
        context.shadowBlur = 5;
      }
      context.stroke();
      context.restore();
      return;
    }
    context.shadowColor = selected ? "rgba(163, 58, 46, 0.34)" : "rgba(41, 43, 39, 0.24)";
    context.shadowBlur = selected ? 7 : 4;
    context.fillStyle = PAPER_LIGHT;
    context.beginPath();
    context.arc(x, y, selected ? radius + 1.5 : radius, 0, Math.PI * 2);
    context.fill();
    context.shadowBlur = 0;
    context.strokeStyle = selected ? VERMILION : color;
    context.lineWidth = selected ? 2.6 : 2;
    context.stroke();
    context.fillStyle = INK;
    context.font = '700 7px Inter, "Noto Sans SC", sans-serif';
    context.textAlign = "center";
    context.textBaseline = "middle";
    const compactStrength =
      army.strength >= 10_000 ? `${Math.round(army.strength / 10_000)}万` : `${Math.max(1, Math.round(army.strength / 1000))}k`;
    context.fillText(compactStrength, x, y + 0.5);
    context.restore();
  });

  drawFleets(context, fleets, transform, selectedObject);

  context.restore();
  drawLegend(context, width, height, overlay, regions);
  drawCompass(context, width);
}

export function WorldMap({
  regions,
  routes,
  armies,
  seaZones = [],
  fleets = [],
  flows = [],
  markers = [],
  highlightedRegionIds = [],
  selectedRegionId,
  selectedObject = null,
  overlay,
  onSelectRegion,
  onSelectObject,
  cameraKey,
  onCameraChange,
  className = "",
}: WorldMapProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<CanvasSize>({ width: 1, height: 1, dpr: 1 });
  const [hover, setHover] = useState<HoverState | null>(null);
  const [camera, setCameraState] = useState<MapCamera>(() => ({ ...DEFAULT_MAP_CAMERA }));
  const [dragging, setDragging] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [tapFeedback, setTapFeedback] = useState<TapFeedback | null>(null);
  const cameraRef = useRef<MapCamera>({ ...DEFAULT_MAP_CAMERA });
  const cameraKeyRef = useRef(cameraKey);
  const viewportSizeRef = useRef({ width: 1, height: 1 });
  const pointersRef = useRef(new Map<number, PointerContact>());
  const gestureRef = useRef<MapGestureState | null>(null);
  const tapSequenceRef = useRef(0);
  const tapTimerRef = useRef<number | null>(null);
  const presentation = useMemo(
    () => buildMapPresentation(regions, routes, armies, seaZones, fleets, flows, markers),
    [armies, fleets, flows, markers, regions, routes, seaZones],
  );
  const hoveredRegionId = hover?.kind === "region" || hover?.kind === "regionNode"
    ? hover.region.id
    : undefined;

  const applyCamera = useCallback((candidate: MapCamera) => {
    const next = clampMapCamera(candidate, size.width, size.height);
    const current = cameraRef.current;
    if (
      Math.abs(current.zoom - next.zoom) < 0.0001
      && Math.abs(current.panX - next.panX) < 0.05
      && Math.abs(current.panY - next.panY) < 0.05
    ) return current;
    cameraRef.current = next;
    setCameraState(next);
    return next;
  }, [size.height, size.width]);

  const commitCamera = useCallback((next = cameraRef.current) => {
    onCameraChange?.({ ...next });
  }, [onCameraChange]);

  useEffect(() => {
    if (cameraKeyRef.current === cameraKey) return;
    cameraKeyRef.current = cameraKey;
    cameraRef.current = { ...DEFAULT_MAP_CAMERA };
    setCameraState({ ...DEFAULT_MAP_CAMERA });
    setHasInteracted(false);
    commitCamera(DEFAULT_MAP_CAMERA);
  }, [cameraKey, commitCamera]);

  useEffect(() => {
    const previous = viewportSizeRef.current;
    const next = reframeMapCamera(
      cameraRef.current,
      previous.width,
      previous.height,
      size.width,
      size.height,
    );
    viewportSizeRef.current = { width: size.width, height: size.height };
    const current = cameraRef.current;
    if (
      Math.abs(current.zoom - next.zoom) < 0.0001
      && Math.abs(current.panX - next.panX) < 0.05
      && Math.abs(current.panY - next.panY) < 0.05
    ) return;
    cameraRef.current = next;
    setCameraState(next);
    commitCamera(next);
  }, [commitCamera, size.height, size.width]);

  useEffect(() => () => {
    if (tapTimerRef.current !== null) window.clearTimeout(tapTimerRef.current);
  }, []);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const updateSize = (width: number, height: number) => {
      const nextWidth = Math.max(1, Math.round(width));
      const nextHeight = Math.max(1, Math.round(height));
      const nextDpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
      setSize((current) =>
        current.width === nextWidth && current.height === nextHeight && current.dpr === nextDpr
          ? current
          : { width: nextWidth, height: nextHeight, dpr: nextDpr },
      );
    };

    const rect = host.getBoundingClientRect();
    updateSize(rect.width, rect.height);
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      updateSize(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = Math.max(1, Math.round(size.width * size.dpr));
    canvas.height = Math.max(1, Math.round(size.height * size.dpr));
    const context = canvas.getContext("2d");
    if (!context) return;
    const drawStartedAt = runtimeNow();
    drawMap(
      context,
      size,
      presentation.regions,
      presentation.routes,
      presentation.armies,
      presentation.seaZones,
      presentation.fleets,
      presentation.flows,
      presentation.markers,
      overlay,
      highlightedRegionIds,
      selectedRegionId,
      selectedObject,
      hoveredRegionId,
      camera,
    );
    recordRuntimeMetric('canvas.draw', runtimeNow() - drawStartedAt);
  }, [camera, highlightedRegionIds, hoveredRegionId, overlay, presentation, selectedObject, selectedRegionId, size]);

  const localPoint = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (size.width / Math.max(1, rect.width)),
      y: (event.clientY - rect.top) * (size.height / Math.max(1, rect.height)),
    };
  }, [size.height, size.width]);

  const localClientPoint = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: size.width / 2, y: size.height / 2 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (size.width / Math.max(1, rect.width)),
      y: (clientY - rect.top) * (size.height / Math.max(1, rect.height)),
    };
  }, [size.height, size.width]);

  const showTapFeedback = useCallback((point: MapPoint) => {
    tapSequenceRef.current += 1;
    setTapFeedback({ id: tapSequenceRef.current, x: point.x, y: point.y });
    if (tapTimerRef.current !== null) window.clearTimeout(tapTimerRef.current);
    tapTimerRef.current = window.setTimeout(() => setTapFeedback(null), 420);
  }, []);

  const regionNearScreenPoint = useCallback((point: MapPoint, tolerance: number) => {
    const direct = regionAtScreenPoint(
      presentation.regions,
      point,
      size.width,
      size.height,
      MAP_PADDING,
      cameraRef.current,
    );
    if (direct || tolerance <= 0) return direct;
    for (const radius of [tolerance * 0.55, tolerance]) {
      for (let index = 0; index < 8; index += 1) {
        const angle = index * Math.PI / 4;
        const candidate = regionAtScreenPoint(
          presentation.regions,
          { x: point.x + Math.cos(angle) * radius, y: point.y + Math.sin(angle) * radius },
          size.width,
          size.height,
          MAP_PADDING,
          cameraRef.current,
        );
        if (candidate) return candidate;
      }
    }
    return null;
  }, [presentation.regions, size.height, size.width]);

  const selectAtPoint = useCallback((point: MapPoint, pointerType: string) => {
    const coarse = pointerType === "touch" || pointerType === "pen";
    const transform = createMapViewportTransform(
      size.width,
      size.height,
      MAP_PADDING,
      cameraRef.current,
    );
    const worldPoint = screenToWorldPoint(
      point,
      size.width,
      size.height,
      MAP_PADDING,
      cameraRef.current,
    );
    const worldRadius = (screenPixels: number) => screenPixels
      / Math.max(0.001, transform.scale * Math.min(1, transform.yScale));
    const nearestFleet = presentation.fleets
      .map((fleet) => ({ fleet, distance: Math.hypot(fleet.position.x - worldPoint.x, fleet.position.y - worldPoint.y) }))
      .sort((left, right) => left.distance - right.distance)[0];
    if (onSelectObject && nearestFleet && nearestFleet.distance <= worldRadius(coarse ? 22 : 12)) {
      onSelectObject("fleet", nearestFleet.fleet.id);
      showTapFeedback(point);
      return;
    }
    const army = armyAtScreenPoint(
      presentation.armies,
      presentation.regions,
      point,
      size.width,
      size.height,
      MAP_PADDING,
      cameraRef.current,
      coarse,
    );
    if (onSelectObject && army) {
      onSelectObject("army", army.id);
      showTapFeedback(point);
      return;
    }
    const nearestMarker = presentation.markers
      .map((marker) => ({ marker, distance: Math.hypot(marker.position.x - worldPoint.x, marker.position.y - worldPoint.y) }))
      .sort((left, right) => left.distance - right.distance)[0];
    if (onSelectObject && nearestMarker && nearestMarker.distance <= worldRadius(coarse ? 22 : 12)) {
      onSelectObject(nearestMarker.marker.kind, nearestMarker.marker.id);
      showTapFeedback(point);
      return;
    }
    const directRegion = regionNearScreenPoint(point, 0);
    const regionNode = regionNodeAtScreenPoint(
      presentation.regions,
      presentation.seaZones,
      point,
      size.width,
      size.height,
      MAP_PADDING,
      cameraRef.current,
      coarse,
    );
    if (regionNode && (!directRegion || regionNode.region.id === directRegion.id)) {
      onSelectRegion(regionNode.region.id);
      showTapFeedback(point);
      return;
    }
    const pointToSegment = (flow: MapFlowView) => {
      const dx = flow.to.x - flow.from.x;
      const dy = flow.to.y - flow.from.y;
      const denominator = dx * dx + dy * dy || 1;
      const ratio = clamp(((worldPoint.x - flow.from.x) * dx + (worldPoint.y - flow.from.y) * dy) / denominator);
      return Math.hypot(worldPoint.x - (flow.from.x + ratio * dx), worldPoint.y - (flow.from.y + ratio * dy));
    };
    const nearestFlow = presentation.flows
      .map((flow) => ({ flow, distance: pointToSegment(flow) }))
      .sort((left, right) => left.distance - right.distance)[0];
    if (onSelectObject && nearestFlow && nearestFlow.distance <= worldRadius(coarse ? 18 : 9)) {
      onSelectObject(nearestFlow.flow.selectedKind, nearestFlow.flow.selectedId);
      showTapFeedback(point);
      return;
    }
    const region = directRegion ?? regionNearScreenPoint(point, coarse ? 8 : 0);
    if (region) {
      onSelectRegion(region.id);
      showTapFeedback(point);
      return;
    }
    const nearestSea = presentation.seaZones
      .map((zone) => ({ zone, distance: Math.hypot(zone.center.x - worldPoint.x, zone.center.y - worldPoint.y) }))
      .sort((left, right) => left.distance - right.distance)[0];
    if (onSelectObject && nearestSea && nearestSea.distance <= worldRadius(coarse ? 30 : 24)) {
      onSelectObject("seaZone", nearestSea.zone.id);
      showTapFeedback(point);
    }
  }, [onSelectObject, onSelectRegion, presentation, regionNearScreenPoint, showTapFeedback, size.height, size.width]);

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const point = localPoint(event);
      const contact = pointersRef.current.get(event.pointerId);
      if (contact) {
        event.preventDefault();
        contact.current = point;
        const gesture = gestureRef.current;
        if (!gesture) return;
        const active = [...pointersRef.current.values()];
        if (active.length >= 2) {
          const first = active[0].current;
          const second = active[1].current;
          const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
          const distance = Math.max(1, Math.hypot(first.x - second.x, first.y - second.y));
          if (!gesture.pinch) {
            gesture.pinch = { camera: { ...cameraRef.current }, distance, midpoint };
          }
          const pinch = gesture.pinch;
          const zoomed = zoomMapCameraAtPoint(
            pinch.camera,
            pinch.camera.zoom * (distance / Math.max(1, pinch.distance)),
            pinch.midpoint,
            size.width,
            size.height,
          );
          applyCamera(panMapCamera(
            zoomed,
            midpoint.x - pinch.midpoint.x,
            midpoint.y - pinch.midpoint.y,
            size.width,
            size.height,
          ));
          gesture.moved = true;
          gesture.hadMultiple = true;
          setDragging(true);
          setHasInteracted(true);
          setHover(null);
          return;
        }
        const canPan = cameraRef.current.zoom > MAP_MIN_ZOOM + 0.0001;
        const threshold = gesture.pointerType === "touch" ? (canPan ? 10 : 14) : 5;
        const totalDistance = Math.hypot(point.x - gesture.startPoint.x, point.y - gesture.startPoint.y);
        if (gesture.moved || totalDistance >= threshold) {
          const before = cameraRef.current;
          const next = applyCamera(panMapCamera(
            cameraRef.current,
            point.x - gesture.lastPoint.x,
            point.y - gesture.lastPoint.y,
            size.width,
            size.height,
          ));
          const cameraMoved = Math.abs(next.panX - before.panX) > 0.05
            || Math.abs(next.panY - before.panY) > 0.05;
          const shouldCancelTap = gesture.moved
            || cameraMoved
            || canPan
            || gesture.pointerType !== "touch"
            || totalDistance >= 28;
          gesture.moved = shouldCancelTap;
          if (cameraMoved) {
            setDragging(true);
            setHasInteracted(true);
          }
          if (shouldCancelTap) setHover(null);
        }
        gesture.lastPoint = point;
        return;
      }
      if (event.pointerType !== "mouse" || event.buttons !== 0) return;
      const transform = createMapViewportTransform(size.width, size.height, MAP_PADDING, cameraRef.current);
      const worldPoint = screenToWorldPoint(point, size.width, size.height, MAP_PADDING, cameraRef.current);
      const worldRadius = (pixels: number) => pixels / Math.max(0.001, transform.scale * Math.min(1, transform.yScale));
      const nearestFleet = presentation.fleets
        .map((fleet) => ({ fleet, distance: Math.hypot(fleet.position.x - worldPoint.x, fleet.position.y - worldPoint.y) }))
        .sort((left, right) => left.distance - right.distance)[0];
      if (nearestFleet && nearestFleet.distance <= worldRadius(12)) {
        setHover({ kind: "fleet", fleet: nearestFleet.fleet, x: point.x, y: point.y });
        return;
      }
      const army = armyAtScreenPoint(
        presentation.armies,
        presentation.regions,
        point,
        size.width,
        size.height,
        MAP_PADDING,
        cameraRef.current,
      );
      if (army) {
        setHover({ kind: "army", army, x: point.x, y: point.y });
        return;
      }
      const nearestMarker = presentation.markers
        .map((marker) => ({ marker, distance: Math.hypot(marker.position.x - worldPoint.x, marker.position.y - worldPoint.y) }))
        .sort((left, right) => left.distance - right.distance)[0];
      if (nearestMarker && nearestMarker.distance <= worldRadius(12)) {
        setHover({ kind: "marker", marker: nearestMarker.marker, x: point.x, y: point.y });
        return;
      }
      const directRegion = regionNearScreenPoint(point, 0);
      const regionNode = regionNodeAtScreenPoint(
        presentation.regions,
        presentation.seaZones,
        point,
        size.width,
        size.height,
        MAP_PADDING,
        cameraRef.current,
      );
      if (regionNode && (!directRegion || regionNode.region.id === directRegion.id)) {
        setHover({ kind: "regionNode", nodeKind: regionNode.kind, region: regionNode.region, x: point.x, y: point.y });
        return;
      }
      const nearestFlow = presentation.flows
        .map((flow) => {
          const dx = flow.to.x - flow.from.x;
          const dy = flow.to.y - flow.from.y;
          const denominator = dx * dx + dy * dy || 1;
          const ratio = clamp(((worldPoint.x - flow.from.x) * dx + (worldPoint.y - flow.from.y) * dy) / denominator);
          return { flow, distance: Math.hypot(worldPoint.x - (flow.from.x + ratio * dx), worldPoint.y - (flow.from.y + ratio * dy)) };
        })
        .sort((left, right) => left.distance - right.distance)[0];
      if (nearestFlow && nearestFlow.distance <= worldRadius(9)) {
        setHover({ kind: "flow", flow: nearestFlow.flow, x: point.x, y: point.y });
        return;
      }
      setHover(directRegion ? { kind: "region", region: directRegion, x: point.x, y: point.y } : null);
    },
    [applyCamera, localPoint, presentation, regionNearScreenPoint, size.height, size.width],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      const point = localPoint(event);
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture can fail when a browser cancels a touch during handoff.
      }
      pointersRef.current.set(event.pointerId, {
        pointerType: event.pointerType,
        current: point,
      });
      const active = [...pointersRef.current.values()];
      if (active.length === 1) {
        gestureRef.current = {
          pointerType: event.pointerType,
          startPoint: point,
          lastPoint: point,
          moved: false,
          hadMultiple: false,
        };
      } else {
        const first = active[0].current;
        const second = active[1].current;
        const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
        gestureRef.current = {
          pointerType: event.pointerType,
          startPoint: gestureRef.current?.startPoint ?? point,
          lastPoint: point,
          moved: true,
          hadMultiple: true,
          pinch: {
            camera: { ...cameraRef.current },
            distance: Math.max(1, Math.hypot(first.x - second.x, first.y - second.y)),
            midpoint,
          },
        };
        setDragging(true);
        setHasInteracted(true);
      }
      setHover(null);
    },
    [localPoint],
  );

  const finishPointer = useCallback((event: ReactPointerEvent<HTMLCanvasElement>, cancelled: boolean) => {
    const contact = pointersRef.current.get(event.pointerId);
    if (!contact) return;
    const point = localPoint(event);
    contact.current = point;
    const gesture = gestureRef.current;
    const shouldSelect = !cancelled
      && pointersRef.current.size === 1
      && !gesture?.moved
      && !gesture?.hadMultiple;
    const selectionPoint = shouldSelect && gesture ? gesture.startPoint : point;
    pointersRef.current.delete(event.pointerId);
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // The browser may already have released capture after a touch cancellation.
    }
    const remaining = [...pointersRef.current.values()];
    if (remaining.length > 0) {
      const next = remaining[0].current;
      gestureRef.current = {
        pointerType: remaining[0].pointerType,
        startPoint: next,
        lastPoint: next,
        moved: true,
        hadMultiple: true,
      };
      setDragging(cameraRef.current.zoom > MAP_MIN_ZOOM + 0.0001);
      return;
    }
    gestureRef.current = null;
    setDragging(false);
    if (shouldSelect) selectAtPoint(selectionPoint, contact.pointerType);
    commitCamera();
  }, [commitCamera, localPoint, selectAtPoint]);

  const handleWheel = useCallback((event: WheelEvent) => {
    event.preventDefault();
    const point = localClientPoint(event.clientX, event.clientY);
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1;
    const factor = Math.exp(-event.deltaY * unit * 0.00135);
    const next = applyCamera(zoomMapCameraAtPoint(
      cameraRef.current,
      cameraRef.current.zoom * factor,
      point,
      size.width,
      size.height,
    ));
    setHasInteracted(true);
    setHover(null);
    commitCamera(next);
  }, [applyCamera, commitCamera, localClientPoint, size.height, size.width]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const listener = (event: WheelEvent) => handleWheel(event);
    canvas.addEventListener("wheel", listener, { passive: false });
    return () => canvas.removeEventListener("wheel", listener);
  }, [handleWheel]);

  const zoomAtCenter = useCallback((nextZoom: number) => {
    const next = applyCamera(zoomMapCameraAtPoint(
      cameraRef.current,
      nextZoom,
      { x: size.width / 2, y: size.height / 2 },
      size.width,
      size.height,
    ));
    setHasInteracted(true);
    setHover(null);
    commitCamera(next);
  }, [applyCamera, commitCamera, size.height, size.width]);

  const resetCamera = useCallback(() => {
    const next = applyCamera(DEFAULT_MAP_CAMERA);
    setHasInteracted(true);
    setHover(null);
    commitCamera(next);
  }, [applyCamera, commitCamera]);

  const handleDoubleClick = useCallback((event: ReactMouseEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const point = localClientPoint(event.clientX, event.clientY);
    const next = applyCamera(zoomMapCameraAtPoint(
      cameraRef.current,
      cameraRef.current.zoom * 1.45,
      point,
      size.width,
      size.height,
    ));
    setHasInteracted(true);
    setHover(null);
    commitCamera(next);
  }, [applyCamera, commitCamera, localClientPoint, size.height, size.width]);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLCanvasElement>) => {
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomAtCenter(cameraRef.current.zoom * 1.35);
        return;
      }
      if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        zoomAtCenter(cameraRef.current.zoom / 1.35);
        return;
      }
      if (event.key === "0") {
        event.preventDefault();
        resetCamera();
        return;
      }
      const contextualObjects = overlay === "naval"
        ? [...presentation.seaZones.map((item) => ({ kind: "seaZone" as const, id: item.id })), ...presentation.fleets.map((item) => ({ kind: "fleet" as const, id: item.id }))]
        : overlay === "war" || overlay === "conflict"
          ? presentation.armies.map((item) => ({ kind: "army" as const, id: item.id }))
        : [...presentation.markers.map((item) => ({ kind: item.kind, id: item.id })), ...presentation.flows.map((item) => ({ kind: item.selectedKind, id: item.selectedId }))];
      if (presentation.regions.length === 0 && contextualObjects.length === 0) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (hover?.kind === "army") {
          onSelectObject?.("army", hover.army.id);
          return;
        }
        if (hover?.kind === "fleet") {
          onSelectObject?.("fleet", hover.fleet.id);
          return;
        }
        if (hover?.kind === "marker") {
          onSelectObject?.(hover.marker.kind, hover.marker.id);
          return;
        }
        if (hover?.kind === "flow") {
          onSelectObject?.(hover.flow.selectedKind, hover.flow.selectedId);
          return;
        }
        const selectedContext = contextualObjects.find((item) => (
          item.id === selectedObject?.id && item.kind === selectedObject.kind
        ));
        if (selectedContext) {
          onSelectObject?.(selectedContext.kind, selectedContext.id);
          return;
        }
        const targetId = hover?.kind === "region" || hover?.kind === "regionNode"
          ? hover.region.id
          : selectedRegionId ?? presentation.regions[0]?.id;
        if (targetId) onSelectRegion(targetId);
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      if (contextualObjects.length && overlay !== "political" && overlay !== "none" && overlay !== "food" && overlay !== "population") {
        const currentIndex = contextualObjects.findIndex((item) => item.id === selectedObject?.id);
        const direction = event.key === "ArrowRight" ? 1 : -1;
        const next = contextualObjects[(currentIndex + direction + contextualObjects.length) % contextualObjects.length];
        if (next) onSelectObject?.(next.kind, next.id);
        return;
      }
      const currentIndex = presentation.regions.findIndex((region) => region.id === selectedRegionId);
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const nextIndex = (currentIndex + direction + presentation.regions.length) % presentation.regions.length;
      onSelectRegion(presentation.regions[nextIndex].id);
    },
    [hover, onSelectObject, onSelectRegion, overlay, presentation, resetCamera, selectedObject?.id, selectedRegionId, zoomAtCenter],
  );

  const tooltipStyle = useMemo(() => {
    if (!hover) return undefined;
    const tooltipWidth = 172;
    const left = Math.min(size.width - tooltipWidth - 10, Math.max(10, hover.x + 16));
    const top = Math.min(size.height - 116, Math.max(10, hover.y + 14));
    return { left, top };
  }, [hover, size.height, size.width]);

  const selectedName = regions.find((region) => region.id === selectedRegionId)?.name
    ?? seaZones.find((item) => selectedObject?.kind === "seaZone" && item.id === selectedObject.id)?.name
    ?? fleets.find((item) => selectedObject?.kind === "fleet" && item.id === selectedObject.id)?.name
    ?? armies.find((item) => selectedObject?.kind === "army" && item.id === selectedObject.id)?.name;

  const hoverTooltip = useMemo(() => {
    if (!hover) return null;
    if (hover.kind === "region") return {
      name: hover.region.name,
      type: hover.region.port ? `${terrainLabel(hover.region.terrain)} · 港区` : terrainLabel(hover.region.terrain),
      rows: [
        ["辖属", hover.region.polityName ?? (hover.region.polityId ? "地方政权" : "无主之地")],
        ["人口", formatPopulation(hover.region.population)],
        ["粮况", foodDescription(hover.region.foodRatio)],
      ],
    };
    if (hover.kind === "regionNode") return {
      name: hover.region.name,
      type: hover.nodeKind === "port" ? "港口 · 可点击" : hover.region.capital ? "都城 · 可点击" : "城邑 · 可点击",
      rows: [
        ["辖属", hover.region.polityName ?? (hover.region.polityId ? "地方政权" : "无主之地")],
        [hover.nodeKind === "port" ? "港级" : "城级", `${hover.nodeKind === "port" ? hover.region.portLevel ?? 1 : hover.region.cityLevel ?? 0}`],
        ["人口", formatPopulation(hover.region.population)],
      ],
    };
    if (hover.kind === "army") return {
      name: hover.army.name,
      type: "军团 · 可点击",
      rows: [["兵力", formatPopulation(hover.army.strength)], ["士气", `${Math.round(hover.army.morale ?? 0)}`], ["状态", hover.army.status ?? "驻军"]],
    };
    if (hover.kind === "fleet") return {
      name: hover.fleet.name,
      type: "水师 · 可点击",
      rows: [["舰力", formatPopulation(hover.fleet.strength)], ["战备", `${Math.round(hover.fleet.readiness)}`], ["任务", hover.fleet.mission]],
    };
    if (hover.kind === "marker") return {
      name: hover.marker.label,
      type: hover.marker.kind === "outbreak" ? "疫病 · 可点击" : "技艺 · 可点击",
      rows: [["强度", `${Math.round(hover.marker.magnitude)}`]],
    };
    const flowNames: Record<MapFlowKind, string> = { trade: "商路", migration: "迁徙", disease: "传播", knowledge: "知识", naval: "航路" };
    return {
      name: hover.flow.label,
      type: `${flowNames[hover.flow.kind]} · 可点击`,
      rows: [["规模", formatPopulation(hover.flow.magnitude)]],
    };
  }, [hover]);

  return (
    <div
      ref={hostRef}
      className={`world-map${className ? ` ${className}` : ""}`}
      data-overlay={overlay}
      data-map-layout="reference-topology-v3"
      data-major-landform-count="3"
      data-landmass-count="2"
      data-island-shape-count="6"
      data-highlighted-region-count={highlightedRegionIds.length}
      data-map-zoom={camera.zoom.toFixed(3)}
      data-map-pan-x={camera.panX.toFixed(1)}
      data-map-pan-y={camera.panY.toFixed(1)}
      data-pannable={camera.zoom > MAP_MIN_ZOOM + 0.0001 || undefined}
      data-dragging={dragging || undefined}
      data-hover-object={Boolean(hover) || undefined}
    >
      <canvas
        ref={canvasRef}
        className="world-map__canvas"
        style={{ width: `${size.width}px`, height: `${size.height}px` }}
        role="application"
        tabIndex={0}
        aria-label={`天下舆图。${selectedName ? `当前选择：${selectedName}。` : "尚未选择区域。"}点按选择，拖动浏览，滚轮或双指缩放。左右方向键切换区域，加减号缩放，数字零归位，回车确认。`}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => {
          if (pointersRef.current.size === 0) setHover(null);
        }}
        onPointerDown={handlePointerDown}
        onPointerUp={(event) => finishPointer(event, false)}
        onPointerCancel={(event) => finishPointer(event, true)}
        onLostPointerCapture={(event) => finishPointer(event, true)}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
      />

      <div className="world-map__viewport-controls" role="group" aria-label="舆图缩放">
        <button
          type="button"
          data-map-zoom-out="true"
          onClick={() => zoomAtCenter(camera.zoom / 1.35)}
          disabled={camera.zoom <= MAP_MIN_ZOOM + 0.001}
          aria-label={`缩小舆图，当前${Math.round(camera.zoom * 100)}%`}
        >
          <Minus size={16} aria-hidden="true" />
        </button>
        <output aria-label={`当前舆图缩放${Math.round(camera.zoom * 100)}%`}>
          {Math.round(camera.zoom * 100)}%
        </output>
        <button
          type="button"
          data-map-zoom-in="true"
          onClick={() => zoomAtCenter(camera.zoom * 1.35)}
          disabled={camera.zoom >= MAP_MAX_ZOOM - 0.001}
          aria-label={`放大舆图，当前${Math.round(camera.zoom * 100)}%`}
        >
          <Plus size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          data-map-reset="true"
          onClick={resetCamera}
          disabled={camera.zoom <= MAP_MIN_ZOOM + 0.001 && Math.abs(camera.panX) < 0.1 && Math.abs(camera.panY) < 0.1}
          aria-label="归位舆图"
          title="归位舆图（0）"
        >
          <ScanLine size={16} aria-hidden="true" />
        </button>
      </div>

      {!hasInteracted && regions.length > 0 ? (
        <p className="world-map__gesture-hint" aria-hidden="true">
          <span className="world-map__gesture-hint-desktop">点州域、军团或水师查看 · 滚轮缩放</span>
          <span className="world-map__gesture-hint-touch">轻点州域、军团或水师速览 · 双指缩放</span>
        </p>
      ) : null}

      {tapFeedback ? (
        <span
          key={tapFeedback.id}
          className="world-map__tap-feedback"
          style={{ left: tapFeedback.x, top: tapFeedback.y }}
          aria-hidden="true"
        />
      ) : null}

      {hover && hoverTooltip && tooltipStyle ? (
        <div className="world-map__tooltip" style={tooltipStyle} aria-hidden="true">
          <div className="world-map__tooltip-heading">
            <strong>{hoverTooltip.name}</strong>
            <span>{hoverTooltip.type}</span>
          </div>
          <div className="world-map__tooltip-rule" />
          <dl>
            {hoverTooltip.rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
          </dl>
        </div>
      ) : null}

      {regions.length === 0 ? (
        <div className="world-map__empty" role="status">
          <span>舆图待绘</span>
          <small>世界生成后，山河与疆界将在此显现</small>
        </div>
      ) : null}
    </div>
  );
}

export default WorldMap;
