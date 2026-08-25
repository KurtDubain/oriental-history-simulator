import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import "../styles/world-map.css";

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
  selectedRegionId?: string | null;
  selectedObject?: { kind: string; id: string } | null;
  overlay: MapOverlay;
  onSelectRegion: (regionId: string) => void;
  onSelectObject?: (kind: MapFlowView["selectedKind"] | "seaZone" | "fleet", id: string) => void;
  className?: string;
}

export interface MapViewportTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export const MAP_WORLD_WIDTH = 1000;
export const MAP_WORLD_HEIGHT = 700;

const MAP_PADDING = 22;
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

interface HoverState {
  region: MapRegionView;
  x: number;
  y: number;
}

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

/** Returns the fixed 1000 × 700 world-to-screen transform used by the canvas. */
export function createMapViewportTransform(
  width: number,
  height: number,
  padding = MAP_PADDING,
): MapViewportTransform {
  const drawableWidth = Math.max(1, width - padding * 2);
  const drawableHeight = Math.max(1, height - padding * 2);
  const scale = Math.min(drawableWidth / MAP_WORLD_WIDTH, drawableHeight / MAP_WORLD_HEIGHT);
  return {
    scale,
    offsetX: (width - MAP_WORLD_WIDTH * scale) / 2,
    offsetY: (height - MAP_WORLD_HEIGHT * scale) / 2,
  };
}

export function screenToWorldPoint(
  point: MapPoint,
  width: number,
  height: number,
  padding = MAP_PADDING,
): MapPoint {
  const transform = createMapViewportTransform(width, height, padding);
  return {
    x: (point.x - transform.offsetX) / transform.scale,
    y: (point.y - transform.offsetY) / transform.scale,
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
): MapRegionView | null {
  const worldPoint = screenToWorldPoint(point, width, height, padding);
  for (let index = regions.length - 1; index >= 0; index -= 1) {
    const region = regions[index];
    if (region.polygon.length >= 3 && isPointInPolygon(worldPoint, region.polygon)) {
      return region;
    }
  }
  return null;
}

const worldToScreen = (point: MapPoint, transform: MapViewportTransform): MapPoint => ({
  x: transform.offsetX + point.x * transform.scale,
  y: transform.offsetY + point.y * transform.scale,
});

function makeRegionPath(region: MapRegionView, transform: MapViewportTransform) {
  const path = new Path2D();
  region.polygon.forEach((point, index) => {
    const screenPoint = worldToScreen(point, transform);
    if (index === 0) path.moveTo(screenPoint.x, screenPoint.y);
    else path.lineTo(screenPoint.x, screenPoint.y);
  });
  path.closePath();
  return path;
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
  if (overlay === "none") return "地势地貌";
  return "势力疆域";
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

function drawSeaMarks(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  transform: MapViewportTransform,
) {
  context.save();
  context.strokeStyle = "rgba(80, 88, 84, 0.14)";
  context.lineWidth = 0.7;
  const spacing = Math.max(50, Math.min(width, height) * 0.11);
  for (let y = transform.offsetY + spacing * 0.55; y < height - transform.offsetY; y += spacing) {
    for (let x = transform.offsetX + spacing * 0.35; x < width - transform.offsetX; x += spacing) {
      const shift = ((Math.round(y) * 7 + Math.round(x)) % 19) - 9;
      context.beginPath();
      context.arc(x + shift, y, 8, Math.PI * 1.08, Math.PI * 1.9);
      context.arc(x + shift + 15, y, 8, Math.PI * 1.08, Math.PI * 1.9);
      context.stroke();
    }
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
  return { color, alpha: region.polityId ? 0.42 : 0.16 };
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
    const radiusX = Math.max(17, 48 * transform.scale);
    const radiusY = Math.max(12, 33 * transform.scale);
    const selected = selectedObject?.kind === "seaZone" && selectedObject.id === zone.id;
    const naval = overlay === "naval";
    context.save();
    context.beginPath();
    context.ellipse(center.x, center.y, radiusX, radiusY, -0.08, 0, Math.PI * 2);
    context.fillStyle = zone.contested ? "rgba(116, 89, 79, 0.18)" : "rgba(94, 116, 122, 0.13)";
    context.globalAlpha = naval ? 0.56 + clamp(zone.powerShare) * 0.32 : 0.34;
    context.fill();
    context.globalAlpha = naval ? 0.66 : 0.28;
    context.strokeStyle = selected ? VERMILION : zone.contested ? "#86685f" : RIVER;
    context.lineWidth = selected ? 2 : zone.contested ? 1.2 : 0.8;
    context.setLineDash(zone.contested ? [3, 3] : []);
    context.stroke();
    context.setLineDash([]);
    context.globalAlpha = 1;
    context.fillStyle = selected ? VERMILION : "rgba(76, 91, 95, 0.82)";
    context.font = `${selected ? 650 : 560} ${transform.scale < 0.42 ? 8 : 9}px "Noto Serif SC", serif`;
    context.textAlign = "center";
    context.fillText(zone.name, center.x, center.y + 3);
    context.restore();
  }
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
  }
}

function drawPort(context: CanvasRenderingContext2D, point: MapPoint) {
  context.save();
  context.translate(point.x + 12, point.y + 7);
  context.strokeStyle = INK;
  context.lineWidth = 1.1;
  context.beginPath();
  context.moveTo(0, -5);
  context.lineTo(0, 5);
  context.moveTo(-3, -2);
  context.lineTo(3, -2);
  context.moveTo(-5, 2);
  context.quadraticCurveTo(0, 8, 5, 2);
  context.stroke();
  context.restore();
}

function drawLegend(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  overlay: MapOverlay,
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
  if (overlay === "conflict" || overlay === "war" || overlay === "disease" || overlay === "migration") {
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
  context.fillText("低", swatchX + 64, swatchY);
  context.fillText("高", swatchX + 83, swatchY);

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
  selectedRegionId: string | null | undefined,
  selectedObject: WorldMapProps["selectedObject"],
  hoveredRegionId: string | undefined,
) {
  const { width, height, dpr } = size;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);

  const transform = createMapViewportTransform(width, height);
  const compactMap = width < 420 || transform.scale < 0.42;
  const denseMap = regions.length > 64;
  const regionById = new Map(regions.map((region) => [region.id, region]));
  const maxPopulation = Math.max(1, ...regions.map((region) => region.population));

  drawPaper(context, width, height);
  drawSeaMarks(context, width, height, transform);
  drawSeaZones(context, seaZones, transform, overlay, selectedObject);

  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";

  // A broad under-stroke separates coastlines from the paper sea.
  regions.forEach((region) => {
    if (region.polygon.length < 3) return;
    const path = makeRegionPath(region, transform);
    context.strokeStyle = "rgba(244, 238, 223, 0.74)";
    context.lineWidth = 4.5;
    context.stroke(path);
  });

  regions.forEach((region) => {
    if (region.polygon.length < 3) return;
    const path = makeRegionPath(region, transform);
    const fill = regionFill(region, overlay, maxPopulation);
    context.globalAlpha = fill.alpha;
    context.fillStyle = fill.color;
    context.fill(path);
    context.globalAlpha = 1;
    context.strokeStyle = "rgba(41, 43, 39, 0.47)";
    context.lineWidth = 0.8;
    context.stroke(path);
  });

  routes.forEach((route) => {
    const from = regionById.get(route.from);
    const to = regionById.get(route.to);
    const points = route.points ?? (from && to ? [from.center, to.center] : []);
    if (points.length < 2) return;

    const type = route.type.toLowerCase();
    context.beginPath();
    applyLinePath(context, points, transform);
    if (type === "river") {
      context.strokeStyle = "rgba(244, 238, 223, 0.84)";
      context.lineWidth = 4;
      context.stroke();
      context.beginPath();
      applyLinePath(context, points, transform);
      context.strokeStyle = RIVER;
      context.globalAlpha = 0.74;
      context.lineWidth = 1.45;
      context.stroke();
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

  drawFlows(context, flows, transform, selectedObject);
  drawMarkers(context, markers, transform, selectedObject);

  regions.forEach((region) => {
    const center = worldToScreen(region.center, transform);
    if (!compactMap) {
      drawRegionTerrain(context, region, center);
      if (region.port) drawPort(context, center);
    }

    const selected = region.id === selectedRegionId;
    const hovered = region.id === hoveredRegionId;
    if (selected || hovered) {
      const path = makeRegionPath(region, transform);
      context.save();
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
    if (region.capital) {
      context.beginPath();
      context.fillStyle = selected ? VERMILION : INK;
      context.arc(center.x, center.y - (compactMap ? 7 : 10), compactMap ? 1.7 : 2.3, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  });

  const armyOffsets = new Map<string, number>();
  armies.forEach((army) => {
    const region = army.regionId ? regionById.get(army.regionId) : undefined;
    const anchor = army.position ?? region?.center;
    if (!anchor) return;
    const slotKey = army.regionId ?? `${Math.round(anchor.x)}:${Math.round(anchor.y)}`;
    const slot = armyOffsets.get(slotKey) ?? 0;
    armyOffsets.set(slotKey, slot + 1);
    const base = worldToScreen(anchor, transform);
    const x = base.x + (compactMap ? 6 : 14) + (slot % 3) * (compactMap ? 7 : 17);
    const y = base.y - (compactMap ? 5 : 12) - Math.floor(slot / 3) * (compactMap ? 8 : 19);
    const color = army.polityColor ?? polityFallback(army.polityId ?? army.id);

    context.save();
    if (compactMap) {
      context.fillStyle = PAPER_LIGHT;
      context.beginPath();
      context.arc(x, y, 3.8, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = color;
      context.lineWidth = 1.4;
      context.stroke();
      context.restore();
      return;
    }
    context.shadowColor = "rgba(41, 43, 39, 0.24)";
    context.shadowBlur = 4;
    context.fillStyle = PAPER_LIGHT;
    context.beginPath();
    context.arc(x, y, 9, 0, Math.PI * 2);
    context.fill();
    context.shadowBlur = 0;
    context.strokeStyle = color;
    context.lineWidth = 2;
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
  drawLegend(context, width, height, overlay);
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
  selectedRegionId,
  selectedObject = null,
  overlay,
  onSelectRegion,
  onSelectObject,
  className = "",
}: WorldMapProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<CanvasSize>({ width: 1, height: 1, dpr: 1 });
  const [hover, setHover] = useState<HoverState | null>(null);

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
    drawMap(
      context,
      size,
      regions,
      routes,
      armies,
      seaZones,
      fleets,
      flows,
      markers,
      overlay,
      selectedRegionId,
      selectedObject,
      hover?.region.id,
    );
  }, [armies, fleets, flows, hover?.region.id, markers, overlay, regions, routes, seaZones, selectedObject, selectedRegionId, size]);

  const localPoint = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }, []);

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const point = localPoint(event);
      const region = regionAtScreenPoint(regions, point, size.width, size.height);
      event.currentTarget.style.cursor = region ? "crosshair" : "default";
      setHover(region ? { region, x: point.x, y: point.y } : null);
    },
    [localPoint, regions, size.height, size.width],
  );

  const handleClick = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const point = localPoint(event);
      const worldPoint = screenToWorldPoint(point, size.width, size.height);
      const nearestFleet = fleets
        .map((fleet) => ({ fleet, distance: Math.hypot(fleet.position.x - worldPoint.x, fleet.position.y - worldPoint.y) }))
        .sort((left, right) => left.distance - right.distance)[0];
      if (nearestFleet && nearestFleet.distance <= 18) {
        onSelectObject?.("fleet", nearestFleet.fleet.id);
        return;
      }
      const nearestMarker = markers
        .map((marker) => ({ marker, distance: Math.hypot(marker.position.x - worldPoint.x, marker.position.y - worldPoint.y) }))
        .sort((left, right) => left.distance - right.distance)[0];
      if (nearestMarker && nearestMarker.distance <= 16) {
        onSelectObject?.(nearestMarker.marker.kind, nearestMarker.marker.id);
        return;
      }
      const pointToSegment = (flow: MapFlowView) => {
        const dx = flow.to.x - flow.from.x;
        const dy = flow.to.y - flow.from.y;
        const denominator = dx * dx + dy * dy || 1;
        const ratio = clamp(((worldPoint.x - flow.from.x) * dx + (worldPoint.y - flow.from.y) * dy) / denominator);
        return Math.hypot(worldPoint.x - (flow.from.x + ratio * dx), worldPoint.y - (flow.from.y + ratio * dy));
      };
      const nearestFlow = flows.map((flow) => ({ flow, distance: pointToSegment(flow) })).sort((a, b) => a.distance - b.distance)[0];
      if (nearestFlow && nearestFlow.distance <= 12) {
        onSelectObject?.(nearestFlow.flow.selectedKind, nearestFlow.flow.selectedId);
        return;
      }
      const region = regionAtScreenPoint(regions, point, size.width, size.height);
      if (region) {
        onSelectRegion(region.id);
        return;
      }
      const nearestSea = seaZones
        .map((zone) => ({ zone, distance: Math.hypot(zone.center.x - worldPoint.x, zone.center.y - worldPoint.y) }))
        .sort((left, right) => left.distance - right.distance)[0];
      if (nearestSea && nearestSea.distance <= 52) onSelectObject?.("seaZone", nearestSea.zone.id);
    },
    [fleets, flows, localPoint, markers, onSelectObject, onSelectRegion, regions, seaZones, size.height, size.width],
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLCanvasElement>) => {
      const contextualObjects = overlay === "naval"
        ? [...seaZones.map((item) => ({ kind: "seaZone" as const, id: item.id })), ...fleets.map((item) => ({ kind: "fleet" as const, id: item.id }))]
        : [...markers.map((item) => ({ kind: item.kind, id: item.id })), ...flows.map((item) => ({ kind: item.selectedKind, id: item.selectedId }))];
      if (regions.length === 0 && contextualObjects.length === 0) return;
      if (event.key === "Enter" || event.key === " ") {
        const targetId = hover?.region.id ?? selectedRegionId ?? regions[0]?.id;
        event.preventDefault();
        if (targetId) onSelectRegion(targetId);
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      if (contextualObjects.length && overlay !== "political" && overlay !== "none" && overlay !== "food" && overlay !== "population" && overlay !== "war") {
        const currentIndex = contextualObjects.findIndex((item) => item.id === selectedObject?.id);
        const direction = event.key === "ArrowRight" ? 1 : -1;
        const next = contextualObjects[(currentIndex + direction + contextualObjects.length) % contextualObjects.length];
        if (next) onSelectObject?.(next.kind, next.id);
        return;
      }
      const currentIndex = regions.findIndex((region) => region.id === selectedRegionId);
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const nextIndex = (currentIndex + direction + regions.length) % regions.length;
      onSelectRegion(regions[nextIndex].id);
    },
    [fleets, flows, hover?.region.id, markers, onSelectObject, onSelectRegion, overlay, regions, seaZones, selectedObject?.id, selectedRegionId],
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
    ?? fleets.find((item) => selectedObject?.kind === "fleet" && item.id === selectedObject.id)?.name;

  return (
    <div
      ref={hostRef}
      className={`world-map${className ? ` ${className}` : ""}`}
      data-overlay={overlay}
    >
      <canvas
        ref={canvasRef}
        className="world-map__canvas"
        style={{ width: `${size.width}px`, height: `${size.height}px` }}
        role="application"
        tabIndex={0}
        aria-label={`天下舆图。${selectedName ? `当前选择：${selectedName}。` : "尚未选择区域。"}左右方向键切换区域，回车确认。`}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHover(null)}
        onPointerDown={handleClick}
        onKeyDown={handleKeyDown}
      />

      {hover && tooltipStyle ? (
        <div className="world-map__tooltip" style={tooltipStyle} aria-hidden="true">
          <div className="world-map__tooltip-heading">
            <strong>{hover.region.name}</strong>
            <span>{terrainLabel(hover.region.terrain)}</span>
          </div>
          <div className="world-map__tooltip-rule" />
          <dl>
            <div>
              <dt>辖属</dt>
              <dd>{hover.region.polityName ?? (hover.region.polityId ? "地方政权" : "无主之地")}</dd>
            </div>
            <div>
              <dt>人口</dt>
              <dd>{formatPopulation(hover.region.population)}</dd>
            </div>
            <div>
              <dt>粮况</dt>
              <dd>{foodDescription(hover.region.foodRatio)}</dd>
            </div>
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
