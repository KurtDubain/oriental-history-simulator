import type { MapPresentationDefinition } from '../maps/types';
import type {
  MapCamera,
  MapFleetView,
  MapFlowView,
  MapLodLevel,
  MapMarkerView,
  MapLodScene,
  MapOverlay,
  MapPoint,
  MapRegionView,
  MapRouteView,
  MapSeaZoneView,
  MapSelectedObject,
  MapVisualSettings,
  MapViewportTransform,
} from './map-contract';
import {
  MAP_PADDING,
  createMapViewportTransform,
  layoutMapArmyIcons,
  layoutMapRegionNodes,
  worldToScreenPoint as worldToScreen,
  type MapRegionNodeLayout,
} from './map-scene-geometry';

export interface MapCanvasSize {
  width: number;
  height: number;
  dpr: number;
}

const PAPER = "#e7dfca";
const PAPER_LIGHT = "#f4eedf";
const INK = "#292b27";
const INK_SOFT = "#5f5b50";
const VERMILION = "#a33a2e";
const RIVER = "#65757a";
const OLIVE = "#66705b";

const DEFAULT_VISUAL_SETTINGS: Readonly<MapVisualSettings> = Object.freeze({
  season: '春',
  atmosphere: false,
  highlightStrength: 1,
});

const SEASON_PALETTE: Readonly<Record<MapVisualSettings['season'], {
  paperLight: string;
  paper: string;
  paperDeep: string;
  seaLight: string;
  seaMid: string;
  seaDeep: string;
}>> = {
  春: {
    paperLight: '#f2eddb', paper: '#e5dfca', paperDeep: '#d3cbb2',
    seaLight: 'rgba(124, 154, 148, 0.28)', seaMid: 'rgba(103, 140, 140, 0.36)', seaDeep: 'rgba(76, 116, 125, 0.43)',
  },
  夏: {
    paperLight: '#f2ead2', paper: '#e4d9bd', paperDeep: '#d1c3a5',
    seaLight: 'rgba(111, 148, 146, 0.31)', seaMid: 'rgba(83, 132, 139, 0.40)', seaDeep: 'rgba(58, 104, 119, 0.48)',
  },
  秋: {
    paperLight: '#f3e7cf', paper: '#e6d7b9', paperDeep: '#d2bd98',
    seaLight: 'rgba(128, 149, 143, 0.28)', seaMid: 'rgba(103, 132, 134, 0.37)', seaDeep: 'rgba(76, 108, 117, 0.44)',
  },
  冬: {
    paperLight: '#efede2', paper: '#dfe0d5', paperDeep: '#c9cec8',
    seaLight: 'rgba(127, 151, 153, 0.28)', seaMid: 'rgba(100, 133, 141, 0.37)', seaDeep: 'rgba(69, 105, 121, 0.46)',
  },
};

interface GeographicLink {
  from: MapRegionView;
  to: MapRegionView;
}

interface GeographyAreaView {
  id: string;
  label: string;
  regions: MapRegionView[];
  links: GeographicLink[];
  tint: string;
}

interface GeographyView {
  areas: GeographyAreaView[];
  links: GeographicLink[];
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
  profile: MapPresentationDefinition,
) {
  const site = profile.regionDisplaySites[region.id];
  const coast = site ? profile.landShapes.find((shape) => shape.id === site.shapeId) : undefined;
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

export function formatPopulation(population: number) {
  if (population >= 1_000_000) return `${(population / 1_000_000).toFixed(1)}m`;
  if (population >= 10_000) return `${Math.round(population / 10_000)}万`;
  if (population >= 1_000) return `${(population / 1_000).toFixed(1)}k`;
  return Math.max(0, Math.round(population)).toLocaleString("zh-CN");
}

export function foodDescription(ratio: number) {
  if (ratio < 0.55) return "断粮边缘";
  if (ratio < 0.85) return "仓廪吃紧";
  if (ratio < 1.15) return "收支相抵";
  return "仓廪充实";
}

export function terrainLabel(terrain: string) {
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

function shouldDrawRoute(
  route: MapRouteView,
  overlay: MapOverlay,
  profile: MapPresentationDefinition,
) {
  const type = route.type.toLowerCase();
  const hiddenRoutes = new Set(profile.hiddenRoutePairs.map(([left, right]) => pairKey(left, right)));
  if (type !== "sea" && hiddenRoutes.has(pairKey(route.from, route.to))) return false;
  if (overlay === "political") return type === "river";
  if (overlay === "naval" || overlay === "trade") return type === "sea" || type === "river";
  if (overlay === "none") return true;
  return type === "river";
}

function deriveGeography(
  regions: readonly MapRegionView[],
  routes: readonly MapRouteView[],
  profile: MapPresentationDefinition,
): GeographyView {
  const regionById = new Map(regions.map((region) => [region.id, region]));
  const areaByRegionId = new Map(profile.geographyAreas.flatMap((area) => (
    area.regionIds.map((regionId) => [regionId, area.id] as const)
  )));
  const shapeByRegionId = new Map(regions.map((region) => [region.id, profile.regionDisplaySites[region.id]?.shapeId]));
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
  const areas = profile.geographyAreas.map((area) => {
    return {
      id: area.id,
      label: area.label,
      tint: area.tint,
      regions: regions.filter((region) => areaByRegionId.get(region.id) === area.id),
      links: links.filter((link) => areaByRegionId.get(link.from.id) === area.id && areaByRegionId.get(link.to.id) === area.id),
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

function drawPaper(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  visuals: MapVisualSettings,
) {
  const palette = visuals.atmosphere ? SEASON_PALETTE[visuals.season] : {
    paperLight: PAPER_LIGHT,
    paper: PAPER,
    paperDeep: '#d7cdb6',
  };
  const glow = context.createRadialGradient(
    width * 0.48,
    height * 0.42,
    Math.min(width, height) * 0.08,
    width * 0.48,
    height * 0.42,
    Math.max(width, height) * 0.72,
  );
  glow.addColorStop(0, palette.paperLight);
  glow.addColorStop(0.64, palette.paper);
  glow.addColorStop(1, palette.paperDeep);
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
  visuals: MapVisualSettings,
) {
  const palette = visuals.atmosphere ? SEASON_PALETTE[visuals.season] : {
    seaLight: 'rgba(126, 151, 151, 0.28)',
    seaMid: 'rgba(105, 139, 143, 0.35)',
    seaDeep: 'rgba(76, 117, 128, 0.43)',
  };
  const sea = context.createLinearGradient(0, 0, width, height);
  sea.addColorStop(0, palette.seaLight);
  sea.addColorStop(0.48, palette.seaMid);
  sea.addColorStop(1, palette.seaDeep);
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
  context.lineWidth = 0.7;
  const spacing = Math.max(51, Math.min(width, height) * 0.112);
  let row = 0;
  for (let y = spacing * 0.48; y < height; y += spacing, row += 1) {
    let column = 0;
    for (let x = spacing * 0.32; x < width; x += spacing, column += 1) {
      const pattern = hashString(`${row}:${column}`);
      if (pattern % 100 >= 58) continue;
      const shift = ((pattern >>> 8) % 23) - 11;
      const lift = ((pattern >>> 14) % 11) - 5;
      const radius = 5.5 + ((pattern >>> 19) % 5);
      context.strokeStyle = `rgba(235, 239, 224, ${0.12 + ((pattern >>> 23) % 8) / 100})`;
      context.beginPath();
      context.arc(x + shift, y + lift, radius, Math.PI * 1.08, Math.PI * 1.9);
      context.arc(x + shift + radius * 1.72, y + lift, radius, Math.PI * 1.08, Math.PI * 1.9);
      context.stroke();
    }
  }
  context.restore();
}

function drawLandFoundation(
  context: CanvasRenderingContext2D,
  transform: MapViewportTransform,
  profile: MapPresentationDefinition,
) {
  context.save();
  context.lineJoin = "round";
  context.shadowColor = "rgba(28, 47, 49, 0.14)";
  context.shadowBlur = Math.min(7, Math.max(2, 4.5 * transform.scale));
  for (const shape of [...profile.landShapes, ...profile.decorativeIslets]) {
    context.beginPath();
    applyLinePath(context, shape.polygon, transform);
    context.closePath();
    context.fillStyle = "role" in shape && shape.role === "mainland" ? "#d8d0b4" : "#d4ccb0";
    context.fill();
    context.strokeStyle = "rgba(242, 235, 214, 0.95)";
    context.lineWidth = Math.min(5.8, Math.max(2.2, 5.4 * transform.scale));
    context.stroke();
  }
  context.restore();
}

function drawGeographicContours(
  context: CanvasRenderingContext2D,
  transform: MapViewportTransform,
  compactMap: boolean,
  profile: MapPresentationDefinition,
) {
  context.save();
  context.lineJoin = "round";
  for (const shape of [...profile.landShapes, ...profile.decorativeIslets]) {
    context.beginPath();
    applyLinePath(context, shape.polygon, transform);
    context.closePath();
    context.strokeStyle = "rgba(249, 243, 224, 0.78)";
    context.lineWidth = Math.min(3, Math.max(1.8, 2.8 * transform.scale));
    context.stroke();
    context.strokeStyle = "rgba(36, 48, 45, 0.72)";
    context.lineWidth = Math.min(1.25, Math.max(0.75, 1.08 * transform.scale));
    context.stroke();
  }

  context.textAlign = "center";
  context.textBaseline = "middle";
  for (const label of profile.macroLabels) {
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
  selectedObject: MapSelectedObject,
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
  selectedObject: MapSelectedObject,
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
  selectedObject: MapSelectedObject,
) {
  for (const fleet of fleets) {
    const point = worldToScreen(fleet.position, transform);
    const selected = selectedObject?.kind === "fleet" && selectedObject.id === fleet.id;
    context.save();
    context.translate(point.x, point.y);
    if (selected) drawSelectionHalo(context, 11);
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
  selectedObject: MapSelectedObject,
) {
  for (const marker of markers) {
    const point = worldToScreen(marker.position, transform);
    const selected = selectedObject?.kind === marker.kind && selectedObject.id === marker.id;
    const radius = selected ? 8 : 5 + clamp(marker.magnitude / 100) * 3;
    context.save();
    context.translate(point.x, point.y);
    if (selected) drawSelectionHalo(context, radius + 3);
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

function drawMajorRiverSystems(
  context: CanvasRenderingContext2D,
  transform: MapViewportTransform,
  compactMap: boolean,
  profile: MapPresentationDefinition,
) {
  const courses = profile.riverGuides
    .map((guide) => ({ points: [...guide.waypoints], label: guide.label }))
    .filter((course) => course.points.length >= 4);
  for (const course of courses) {
    context.save();
    context.beginPath();
    for (const shape of profile.landShapes) {
      applyLinePath(context, shape.polygon, transform);
      context.closePath();
    }
    context.clip();
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    applySmoothOpenPath(context, course.points, transform);
    context.strokeStyle = "rgba(239, 233, 216, 0.72)";
    context.lineWidth = compactMap ? 2.2 : 3;
    context.stroke();
    context.beginPath();
    applySmoothOpenPath(context, course.points, transform);
    context.strokeStyle = "rgba(61, 105, 114, 0.82)";
    context.lineWidth = compactMap ? 0.78 : 1.18;
    context.stroke();
    if (!compactMap) {
      context.beginPath();
      applySmoothOpenPath(context, course.points, transform);
      context.strokeStyle = "rgba(218, 235, 228, 0.68)";
      context.lineWidth = 0.42;
      context.stroke();
    }
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

function drawSelectionHalo(context: CanvasRenderingContext2D, radius: number) {
  context.save();
  context.beginPath();
  context.arc(0, 0, radius + 2.6, 0, Math.PI * 2);
  context.strokeStyle = 'rgba(247, 241, 224, 0.92)';
  context.lineWidth = 3.4;
  context.stroke();
  context.beginPath();
  context.arc(0, 0, radius + 1.5, 0, Math.PI * 2);
  context.strokeStyle = VERMILION;
  context.lineWidth = 1.7;
  context.shadowColor = 'rgba(163, 58, 46, 0.25)';
  context.shadowBlur = 5;
  context.stroke();
  context.restore();
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
  lodLevel: MapLodLevel,
) {
  if (overlay !== "political" || (compactMap && lodLevel !== "overview")) return;
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
    const y = point.y + (compactMap ? 15 : 18);
    context.font = `${compactMap ? 700 : 650} ${compactMap ? 10 : 12}px "Noto Serif SC", "Songti SC", STSong, serif`;
    context.lineWidth = compactMap ? 3 : 4;
    context.strokeStyle = "rgba(241, 235, 218, 0.84)";
    context.strokeText(label, point.x, y);
    context.globalAlpha = compactMap ? 0.84 : 0.72;
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

export function drawWorldMap(
  context: CanvasRenderingContext2D,
  size: MapCanvasSize,
  scene: MapLodScene,
  overlay: MapOverlay,
  highlightedRegionIds: readonly string[],
  selectedRegionId: string | null | undefined,
  selectedObject: MapSelectedObject,
  hoveredRegionId: string | undefined,
  camera: MapCamera,
  focusOffset: MapPoint = { x: 0, y: 0 },
  visualSettings: MapVisualSettings = DEFAULT_VISUAL_SETTINGS,
) {
  const {
    regions,
    routes,
    armies,
    seaZones,
    fleets,
    flows,
    markers,
    profile,
  } = scene;
  const { width, height, dpr } = size;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);

  const baseTransform = createMapViewportTransform(width, height, MAP_PADDING, camera);
  const transform = {
    ...baseTransform,
    offsetX: baseTransform.offsetX + focusOffset.x,
    offsetY: baseTransform.offsetY + focusOffset.y,
  };
  const compactMap = transform.scale < 0.42;
  const renderedSeaZones = seaZones.filter((zone) => scene.interactiveSeaZoneIds.has(zone.id));
  const regionById = new Map(regions.map((region) => [region.id, region]));
  const regionNodesByRegion = new Map<string, MapRegionNodeLayout[]>();
  for (const node of layoutMapRegionNodes(regions, seaZones, transform, {
    cityRegionIds: scene.cityRegionIds,
    portRegionIds: scene.portRegionIds,
  })) {
    const nodes = regionNodesByRegion.get(node.region.id) ?? [];
    nodes.push(node);
    regionNodesByRegion.set(node.region.id, nodes);
  }
  const highlightedRegions = new Set(highlightedRegionIds);
  const highlightStrength = clamp(visualSettings.highlightStrength ?? 1);
  const maxPopulation = Math.max(1, ...regions.map((region) => region.population));
  const geography = deriveGeography(regions, routes, profile);

  drawPaper(context, width, height, visualSettings);
  drawSeaField(context, width, height, transform, visualSettings);
  drawSeaMarks(context, width, height, transform);
  drawSeaZones(context, renderedSeaZones, transform, overlay, selectedObject);
  drawLandFoundation(context, transform, profile);

  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";

  regions.forEach((region) => {
    if (region.polygon.length < 3) return;
    const path = makeRegionPath(region, transform);
    const fill = regionFill(region, overlay, maxPopulation);
    context.save();
    clipToRegionCoast(context, region, transform, profile);
    context.globalAlpha = fill.alpha;
    context.fillStyle = fill.color;
    context.fill(path);
    context.globalAlpha = 1;
    context.strokeStyle = "rgba(41, 43, 39, 0.34)";
    context.lineWidth = scene.level === 'overview' ? 0.38 : scene.level === 'regional' ? 0.55 : 0.7;
    context.stroke(path);
    context.restore();
  });

  drawGeographicContours(context, transform, compactMap, profile);
  drawMountainRanges(context, geography, transform, compactMap);

  routes.forEach((route) => {
    if (scene.level !== "local") return;
    if (!shouldDrawRoute(route, overlay, profile)) return;
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

  drawMajorRiverSystems(context, transform, compactMap, profile);
  drawSeaGeography(context, renderedSeaZones, routes, regions, transform, compactMap);

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
    if (highlighted && !selected && !hovered && highlightStrength > 0.015) {
      const path = makeRegionPath(region, transform);
      context.save();
      clipToRegionCoast(context, region, transform, profile);
      context.strokeStyle = VERMILION;
      context.globalAlpha = 0.16 + highlightStrength * 0.48;
      context.lineWidth = 0.8 + highlightStrength * 0.85;
      context.setLineDash([4, 3]);
      context.shadowColor = `rgba(163, 58, 46, ${0.08 + highlightStrength * 0.18})`;
      context.shadowBlur = 2 + highlightStrength * 4;
      context.stroke(path);
      context.restore();
    }
    if (selected || hovered) {
      const path = makeRegionPath(region, transform);
      context.save();
      clipToRegionCoast(context, region, transform, profile);
      if (selected) {
        context.fillStyle = 'rgba(163, 58, 46, 0.055)';
        context.fill(path);
        context.strokeStyle = 'rgba(247, 241, 224, 0.94)';
        context.lineWidth = 4.2;
        context.stroke(path);
      }
      context.strokeStyle = selected ? VERMILION : 'rgba(43, 48, 43, 0.72)';
      context.lineWidth = selected ? 2 : 1.2;
      context.shadowColor = selected ? "rgba(163, 58, 46, 0.28)" : 'rgba(244, 238, 223, 0.42)';
      context.shadowBlur = selected ? 6 : 3;
      context.stroke(path);
      context.restore();
    }

    context.save();
    const showLabel = scene.regionLabelIds.has(region.id) || selected || hovered;
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

  drawPolityLabels(context, regions, transform, overlay, compactMap, scene.level);

  layoutMapArmyIcons(armies, regions, transform).forEach(({ army, point, radius }) => {
    const { x, y } = point;
    const color = army.polityColor ?? polityFallback(army.polityId ?? army.id);
    const selected = selectedObject?.kind === "army" && selectedObject.id === army.id;

    context.save();
    if (selected) {
      context.save();
      context.translate(x, y);
      drawSelectionHalo(context, radius + 2);
      context.restore();
    }
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
  if (width >= 720) drawLegend(context, width, height, overlay, regions);
  if (width >= 1080) drawCompass(context, width);
}
