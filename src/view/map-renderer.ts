import type { MapPresentationDefinition } from '../maps/types';
import type {
  MapCamera,
  MapFleetView,
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
  layoutMapPersonClusters,
  layoutMapPersonForces,
  layoutMapRegionNodes,
  worldToScreenPoint as worldToScreen,
  type MapArmyIconLayout,
  type MapRegionNodeLayout,
} from './map-scene-geometry';
import { layoutMapMarkers, mapMarkerMatchesSelection } from './map-marker-layout';

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
  if (population >= 10_000) return `${Math.round(population / 10_000)}万`;
  if (population >= 1_000) return `${(population / 1_000).toFixed(1)}千`;
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
  if (overlay === "food") return "地方供养";
  if (overlay === "war") return "军争态势";
  if (overlay === "none") return "山河地势";
  return "势力疆域 · 地势底图";
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
  if (overlay === "war") return type === "sea" || type === "river";
  if (overlay === "none") return true;
  return type === "river";
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
  if (overlay === "war") {
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
    const military = overlay === "war";
    const contextual = military || selected;
    context.save();
    if (contextual) {
      context.beginPath();
      context.ellipse(center.x, center.y, radiusX, radiusY, -0.08, 0, Math.PI * 2);
      context.fillStyle = zone.contested ? "rgba(116, 89, 79, 0.18)" : ocean ? "rgba(74, 111, 120, 0.16)" : "rgba(94, 116, 122, 0.13)";
      context.globalAlpha = military ? 0.56 + clamp(zone.powerShare) * 0.32 : 0.32;
      context.fill();
      context.globalAlpha = military ? 0.66 : 0.38;
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

function drawFleets(
  context: CanvasRenderingContext2D,
  fleets: readonly MapFleetView[],
  transform: MapViewportTransform,
  selectedObject: MapSelectedObject,
  focusedWarId: string | null,
) {
  for (const fleet of fleets) {
    const point = worldToScreen(fleet.position, transform);
    const selected = selectedObject?.kind === "fleet" && selectedObject.id === fleet.id;
    context.save();
    if (focusedWarId && fleet.warId !== focusedWarId) context.globalAlpha = 0.2;
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
  for (const { marker, point, radius: baseRadius } of layoutMapMarkers(markers, transform)) {
    const selected = mapMarkerMatchesSelection(marker, selectedObject);
    const radius = selected ? baseRadius + 1.5 : baseRadius;
    context.save();
    context.translate(point.x, point.y);
    if (selected) drawSelectionHalo(context, radius + 3);
    const politicalColor = marker.tone === 'alert'
      ? VERMILION
      : marker.tone === 'watch'
        ? '#8a6535'
        : marker.color ?? OLIVE;
    context.strokeStyle = politicalColor;
    context.fillStyle = 'rgba(244, 238, 223, 0.9)';
    context.lineWidth = selected ? 2.1 : 1.2;
    context.beginPath();
    if (marker.kind === 'capitalPulse') {
      context.rotate(Math.PI / 4);
      context.rect(-radius * 0.72, -radius * 0.72, radius * 1.44, radius * 1.44);
    } else if (marker.kind === 'powerRoot' && marker.rootKind === 'army_command') {
      context.moveTo(-radius * 0.72, radius);
      context.lineTo(-radius * 0.72, -radius);
      context.lineTo(radius, -radius * 0.35);
      context.lineTo(-radius * 0.72, radius * 0.1);
      context.closePath();
    } else if (marker.kind === 'powerRoot' && marker.rootKind === 'fleet_command') {
      context.moveTo(-radius, -radius * 0.25);
      context.lineTo(radius, -radius * 0.25);
      context.lineTo(radius * 0.55, radius * 0.65);
      context.lineTo(-radius * 0.55, radius * 0.65);
      context.closePath();
    } else if (marker.kind === 'powerRoot') {
      context.rect(-radius * 0.7, -radius * 0.7, radius * 1.4, radius * 1.4);
    } else {
      context.arc(0, 0, radius, 0, Math.PI * 2);
    }
    context.fill();
    context.stroke();
    if (marker.kind === 'capitalPulse') {
      context.beginPath();
      context.arc(0, 0, Math.max(1.5, radius * 0.24), 0, Math.PI * 2);
      context.fillStyle = politicalColor;
      context.fill();
    } else if (marker.kind === 'powerRoot' && marker.rootKind === 'fleet_command') {
      context.beginPath();
      context.moveTo(-radius * 0.75, radius);
      context.quadraticCurveTo(0, radius * 0.45, radius * 0.75, radius);
      context.stroke();
    } else if (marker.kind === 'powerRoot') {
      context.beginPath();
      context.arc(0, 0, Math.max(1.2, radius * 0.22), 0, Math.PI * 2);
      context.fillStyle = politicalColor;
      context.fill();
    }
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

function drawArmyOrders(
  context: CanvasRenderingContext2D,
  layouts: readonly MapArmyIconLayout[],
  regions: readonly MapRegionView[],
  transform: MapViewportTransform,
  overlay: MapOverlay,
  selectedObject: MapSelectedObject,
  focusedWarId: string | null,
  movementProgress: number,
) {
  const regionById = new Map(regions.map((region) => [region.id, region]));
  const arrow = (from: MapPoint, to: MapPoint, color: string, alpha: number, width: number, dashed: boolean) => {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    context.save();
    context.strokeStyle = color; context.fillStyle = color; context.globalAlpha = alpha; context.lineWidth = width;
    context.setLineDash(dashed ? [5, 5] : []);
    context.beginPath(); context.moveTo(from.x, from.y); context.lineTo(to.x, to.y); context.stroke();
    context.setLineDash([]); context.beginPath(); context.moveTo(to.x, to.y);
    context.lineTo(to.x - Math.cos(angle - 0.55) * 7, to.y - Math.sin(angle - 0.55) * 7);
    context.lineTo(to.x - Math.cos(angle + 0.55) * 7, to.y - Math.sin(angle + 0.55) * 7);
    context.closePath(); context.fill(); context.restore();
  };
  for (const { army, point } of layouts) {
    const selected = selectedObject?.kind === 'army' && selectedObject.id === army.id;
    const color = army.orderKind === 'retreat' ? VERMILION : army.polityColor ?? polityFallback(army.polityId ?? army.id);
    if (overlay === 'war' && army.recentMovement) {
      const from = regionById.get(army.recentMovement.fromRegionId);
      const to = regionById.get(army.recentMovement.toRegionId);
      if (from && to) {
        const start = worldToScreen(from.center, transform);
        const finish = worldToScreen(to.center, transform);
        const actualEnd = army.recentMovement.current
          ? { x: start.x + (finish.x - start.x) * movementProgress, y: start.y + (finish.y - start.y) * movementProgress }
          : finish;
        arrow(start, actualEnd, INK_SOFT, army.recentMovement.current ? 0.72 : 0.28, army.recentMovement.current ? 2.6 : 1.3, false);
      }
    }
    if (army.orderKind === 'hold' || (overlay !== 'war' && !selected) || (focusedWarId && army.warId !== focusedWarId)) continue;
    const path = army.orderPathRegionIds ?? [];
    for (let index = 0; index < path.length - 1; index += 1) {
      const fromRegion = regionById.get(path[index] as string);
      const toRegion = regionById.get(path[index + 1] as string);
      if (!fromRegion || !toRegion) continue;
      const from = index === 0 ? point : worldToScreen(fromRegion.center, transform);
      const to = worldToScreen(toRegion.center, transform);
      arrow(from, to, color, army.orderBlocked ? 0.28 : index === 0 ? (selected ? 0.96 : 0.78) : 0.34, index === 0 ? (selected ? 3 : 2.2) : 1.25, index > 0 || Boolean(army.orderBlocked));
    }
  }
  if (overlay !== 'war') return;
  const shownContacts = new Set<string>();
  for (const { army } of layouts) {
    const contact = army.expectedContact;
    if (!contact) continue;
    if (focusedWarId && army.warId !== focusedWarId) continue;
    const contactKey = contact.regionId;
    if (shownContacts.has(contactKey)) continue;
    const contactRegion = regionById.get(contact.regionId);
    if (!contactRegion) continue;
    shownContacts.add(contactKey);
    const point = worldToScreen(contactRegion.center, transform);
    const label = `${army.lawfulCommanderName ?? army.name}·${army.factionShortName ?? '无系'} → ${contact.commanderName ?? contact.armyName}·${(contact.factionName ?? '无系').replace(/一系$|旧部$/, '').slice(0, 5)} · ${contact.steps ?? 1}步`;
    context.save();
    context.strokeStyle = PAPER_LIGHT;
    context.fillStyle = VERMILION;
    context.lineWidth = 3;
    context.font = '600 9px "Noto Serif SC", "Songti SC", STSong, serif';
    context.textAlign = 'center';
    context.textBaseline = 'bottom';
    context.strokeText(label, point.x, point.y - 15);
    context.fillText(label, point.x, point.y - 15);
    context.translate(point.x, point.y - 10);
    context.lineWidth = 1.4;
    context.strokeStyle = VERMILION;
    context.beginPath();
    context.moveTo(-4, -3);
    context.lineTo(4, 3);
    context.moveTo(4, -3);
    context.lineTo(-4, 3);
    context.stroke();
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
  } else if (overlay === "war") {
    gradient.addColorStop(0, "rgba(163, 58, 46, 0.06)");
    gradient.addColorStop(1, "rgba(163, 58, 46, 0.62)");
  } else if (overlay === "food") {
    gradient.addColorStop(0, "rgba(163, 58, 46, 0.48)");
    gradient.addColorStop(1, "rgba(102, 112, 91, 0.58)");
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
  focusedWarId: string | null = null,
  movementProgress = 1,
) {
  const {
    regions,
    routes,
    armies,
    seaZones,
    fleets,
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
  const renderedSeaZones = seaZones;
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
  drawPaper(context, width, height, visualSettings);
  drawSeaField(context, width, height, transform, visualSettings);
  drawSeaZones(context, renderedSeaZones, transform, overlay, selectedObject);
  drawLandFoundation(context, transform, profile);

  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";

  regions.forEach((region) => {
    if (region.polygon.length < 3) return;
    const path = makeRegionPath(region, transform);
    const fill = regionFill(region, overlay);
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

  regions.forEach((region) => {
    const center = worldToScreen(region.center, transform);
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
  drawMarkers(context, markers, transform, selectedObject);

  const staticPersonLayouts = layoutMapPersonForces(scene.persons ?? [], transform);
  const commanderPointByFormation = new Map(staticPersonLayouts
    .filter((layout) => layout.person.isCommander && layout.person.formationId)
    .map((layout) => [layout.person.formationId as string, layout.point]));
  const staticArmyLayouts = layoutMapArmyIcons(armies, regions, transform).map((layout) => ({
    ...layout,
    point: commanderPointByFormation.get(layout.army.id) ?? layout.point,
  }));
  const armyLayouts = movementProgress >= 1 ? staticArmyLayouts : staticArmyLayouts.map((layout) => {
    const movement = layout.army.recentMovement;
    const from = movement?.current ? regionById.get(movement.fromRegionId) : null;
    const to = movement?.current ? regionById.get(movement.toRegionId) : null;
    if (!from || !to) return layout;
    const fromPoint = worldToScreen(from.center, transform);
    const toPoint = worldToScreen(to.center, transform);
    const offset = { x: layout.point.x - toPoint.x, y: layout.point.y - toPoint.y };
    return { ...layout, point: {
      x: fromPoint.x + (toPoint.x - fromPoint.x) * movementProgress + offset.x,
      y: fromPoint.y + (toPoint.y - fromPoint.y) * movementProgress + offset.y,
    } };
  });
  drawArmyOrders(context, armyLayouts, regions, transform, overlay, selectedObject, focusedWarId, movementProgress);

  const personLayouts = staticPersonLayouts.map((layout) => {
    const army = layout.person.formationId ? armies.find((item) => item.id === layout.person.formationId) : undefined;
    const movement = army?.recentMovement;
    const from = movement?.current ? regionById.get(movement.fromRegionId) : null;
    const to = movement?.current ? regionById.get(movement.toRegionId) : null;
    if (!from || !to || movementProgress >= 1) return layout;
    const fromPoint = worldToScreen(from.center, transform);
    const toPoint = worldToScreen(to.center, transform);
    return { ...layout, point: {
      x: fromPoint.x + (toPoint.x - fromPoint.x) * movementProgress + layout.point.x - toPoint.x,
      y: fromPoint.y + (toPoint.y - fromPoint.y) * movementProgress + layout.point.y - toPoint.y,
    } };
  });
  if (overlay === 'war') {
    const byFormation = new Map<string, typeof personLayouts>();
    for (const layout of personLayouts) {
      if (!layout.person.formationId) continue;
      const group = byFormation.get(layout.person.formationId) ?? [];
      group.push(layout);
      byFormation.set(layout.person.formationId, group);
    }
    context.save();
    context.strokeStyle = 'rgba(67, 75, 64, 0.38)';
    context.lineWidth = 1.2;
    for (const group of byFormation.values()) {
      const commander = group.find((layout) => layout.person.isCommander) ?? group[0];
      if (!commander) continue;
      for (const member of group) {
        if (member === commander) continue;
        context.beginPath();
        context.moveTo(commander.point.x, commander.point.y);
        context.lineTo(member.point.x, member.point.y);
        context.stroke();
      }
    }
    context.restore();
  }
  for (const { person, point, radius } of personLayouts) {
    const selected = selectedObject?.kind === 'person' && selectedObject.id === person.id;
    const relevant = !focusedWarId || person.warId === focusedWarId;
    const strength = person.soldiers >= 10_000 ? `${(person.soldiers / 10_000).toFixed(1)}万`
      : person.soldiers >= 1_000 ? `${(person.soldiers / 1_000).toFixed(1)}千` : `${person.soldiers}`;
    context.save();
    if (!relevant) context.globalAlpha = 0.16;
    if (selected) { context.translate(point.x, point.y); drawSelectionHalo(context, radius + 3); context.translate(-point.x, -point.y); }
    context.fillStyle = person.isCommander ? INK : PAPER_LIGHT;
    context.strokeStyle = selected ? VERMILION : person.polityColor;
    context.lineWidth = selected ? 2.5 : person.isCommander ? 2.2 : 1.6;
    context.beginPath(); context.arc(point.x, point.y, radius, 0, Math.PI * 2); context.fill(); context.stroke();
    if (person.commandDiverged) {
      context.fillStyle = VERMILION; context.beginPath(); context.arc(point.x + radius, point.y - radius, 2.3, 0, Math.PI * 2); context.fill();
    }
    if (person.status !== '驻留' && person.targetRegionId) {
      const target = regionById.get(person.targetRegionId);
      if (target) {
        const targetPoint = worldToScreen(target.center, transform);
        const angle = Math.atan2(targetPoint.y - point.y, targetPoint.x - point.x);
        context.fillStyle = selected ? VERMILION : person.polityColor;
        context.beginPath();
        context.moveTo(point.x + Math.cos(angle) * (radius + 5), point.y + Math.sin(angle) * (radius + 5));
        context.lineTo(point.x + Math.cos(angle + 2.5) * 4, point.y + Math.sin(angle + 2.5) * 4);
        context.lineTo(point.x + Math.cos(angle - 2.5) * 4, point.y + Math.sin(angle - 2.5) * 4);
        context.closePath(); context.fill();
      }
    }
    if (person.showLabel && (relevant || selected)) {
      context.font = `${person.isCommander ? 700 : 600} ${compactMap ? 8 : 9}px "Noto Serif SC", serif`;
      context.textAlign = 'center'; context.textBaseline = 'top'; context.lineWidth = 3;
      context.strokeStyle = PAPER_LIGHT; context.fillStyle = INK;
      const label = `${person.personName} · ${strength}`;
      context.strokeText(label, point.x, point.y + radius + 3); context.fillText(label, point.x, point.y + radius + 3);
    }
    context.restore();
  }
  for (const { cluster, point, radius } of layoutMapPersonClusters(scene.personClusters ?? [], transform)) {
    const strength = cluster.soldiers >= 10_000 ? `${(cluster.soldiers / 10_000).toFixed(1)}万`
      : cluster.soldiers >= 1_000 ? `${(cluster.soldiers / 1_000).toFixed(1)}千` : `${cluster.soldiers}`;
    context.save();
    context.fillStyle = PAPER_LIGHT; context.strokeStyle = cluster.polityColor; context.lineWidth = 1.8;
    context.beginPath(); context.arc(point.x, point.y, radius, 0, Math.PI * 2); context.fill(); context.stroke();
    if (cluster.count > 1 || cluster.soldiers >= 2_000) {
      context.font = '650 8px "Noto Serif SC", serif'; context.textAlign = 'center'; context.textBaseline = 'top';
      context.lineWidth = 3; context.strokeStyle = PAPER_LIGHT; context.fillStyle = INK;
      const label = `${cluster.leaderName}等${cluster.count}人 · ${strength}`;
      context.strokeText(label, point.x, point.y + radius + 3); context.fillText(label, point.x, point.y + radius + 3);
    }
    context.restore();
  }

  drawFleets(context, fleets, transform, selectedObject, focusedWarId);

  context.restore();
  if (width >= 720) drawLegend(context, width, height, overlay, regions);
}
