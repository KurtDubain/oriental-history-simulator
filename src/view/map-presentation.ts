import { getMapProfile } from '../maps';
import type { MapPresentationDefinition } from '../maps/types';
import { buildTerritoryCells } from './map-territories';
import type {
  MapArmyView,
  MapFleetView,
  MapMarkerView,
  MapPoint,
  MapPersonForceView,
  MapPresentationView,
  MapRegionView,
  MapRouteView,
  MapSeaZoneView,
} from './map-contract';

const pointKey = (point: MapPoint) => `${point.x.toFixed(3)}:${point.y.toFixed(3)}`;

function contains(point: MapPoint, polygon: readonly MapPoint[]) {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const a = polygon[current]!;
    const b = polygon[previous]!;
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function pointOutsideLand(point: MapPoint, profile: MapPresentationDefinition) {
  return profile.landShapes.every((shape) => !contains(point, shape.polygon));
}

function insideRegion(point: MapPoint, region: MapRegionView, profile: MapPresentationDefinition) {
  const coast = profile.landShapes.find((shape) => shape.id === profile.regionDisplaySites[region.id]?.shapeId)?.polygon;
  const boundaries = coast ? [region.polygon, coast] : [region.polygon];
  const fits = (candidate: MapPoint) => boundaries.every((polygon) => contains(candidate, polygon));
  const distanceToEdge = (candidate: MapPoint) => Math.min(...(coast ?? region.polygon).map((start, index, polygon) => {
    const end = polygon[(index + 1) % polygon.length]!;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const t = Math.max(0, Math.min(1, ((candidate.x - start.x) * dx + (candidate.y - start.y) * dy) / Math.max(1, dx * dx + dy * dy)));
    return Math.hypot(candidate.x - (start.x + dx * t), candidate.y - (start.y + dy * t));
  }));
  let candidate = point;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (fits(candidate) && distanceToEdge(candidate) >= 17) return candidate;
    candidate = {
      x: region.center.x + (candidate.x - region.center.x) * 0.48,
      y: region.center.y + (candidate.y - region.center.y) * 0.48,
    };
  }
  const xs = region.polygon.map((vertex) => vertex.x);
  const ys = region.polygon.map((vertex) => vertex.y);
  const bounds = {
    left: Math.min(...xs), right: Math.max(...xs),
    top: Math.min(...ys), bottom: Math.max(...ys),
  };
  let safest = fits(region.center) ? region.center : region.polygon[0]!;
  let clearance = fits(safest) ? distanceToEdge(safest) : -1;
  for (let pass = 0; pass < 3; pass += 1) {
    const stepX = (bounds.right - bounds.left) / 10, stepY = (bounds.bottom - bounds.top) / 10;
    for (let row = 1; row < 10; row += 1) {
      for (let column = 1; column < 10; column += 1) {
        const sample = { x: bounds.left + stepX * column, y: bounds.top + stepY * row };
        if (!fits(sample)) continue;
        const distance = distanceToEdge(sample);
        if (distance > clearance) { safest = sample; clearance = distance; }
      }
    }
    bounds.left = safest.x - stepX; bounds.right = safest.x + stepX;
    bounds.top = safest.y - stepY; bounds.bottom = safest.y + stepY;
  }
  return { ...safest };
}

function fleetBerth(
  port: MapRegionView,
  sea: MapPoint,
  profile: MapPresentationDefinition,
  slot: number,
  count: number,
) {
  const dx = sea.x - port.center.x;
  const dy = sea.y - port.center.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const ux = dx / length;
  const uy = dy / length;
  let coast = { ...sea };
  for (let step = 1; step <= 40; step += 1) {
    const ratio = step / 40;
    const candidate = { x: port.center.x + dx * ratio, y: port.center.y + dy * ratio };
    if (pointOutsideLand(candidate, profile)) { coast = candidate; break; }
  }
  const fan = (slot - (count - 1) / 2) * 14;
  let position = {
    x: coast.x + ux * 14 - uy * fan,
    y: coast.y + uy * 14 + ux * fan,
  };
  for (let push = 0; push < 6 && !pointOutsideLand(position, profile); push += 1) {
    position = { x: position.x + ux * 8, y: position.y + uy * 8 };
  }
  return position;
}

/**
 * Reprojects authoritative simulation objects onto the presentation-only atlas.
 * Simulation coordinates, save payloads, route distances and deterministic
 * hashes remain owned by the simulation layer.
 */
export function buildMapPresentation(
  regions: readonly MapRegionView[],
  routes: readonly MapRouteView[],
  armies: readonly MapArmyView[],
  seaZones: readonly MapSeaZoneView[],
  fleets: readonly MapFleetView[],
  markers: readonly MapMarkerView[],
  profile: MapPresentationDefinition = getMapProfile().presentation,
  persons: readonly MapPersonForceView[] = [],
): MapPresentationView {
  const knownSites = regions.flatMap((region) => {
    const site = profile.regionDisplaySites[region.id];
    return site ? [site] : [];
  });
  const cellByRegionId = new Map(
    buildTerritoryCells(profile.territoryShapes, knownSites)
      .map((cell) => [cell.siteId, cell] as const),
  );
  const projectedPointByRawPoint = new Map<string, MapPoint>();

  const presentedRegions = regions.map((region) => {
    const site = profile.regionDisplaySites[region.id];
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
    const center = profile.seaZoneDisplayCenters[zone.id] ?? zone.center;
    projectedPointByRawPoint.set(pointKey(zone.center), center);
    return { ...zone, center: { ...center } };
  });

  const projectPoint = (point: MapPoint): MapPoint => {
    const exact = projectedPointByRawPoint.get(pointKey(point));
    if (exact) return { ...exact };
    return { ...point };
  };

  const regionById = new Map(presentedRegions.map((region) => [region.id, region]));
  const armiesByRegion = new Map<string, MapArmyView[]>();
  for (const army of armies) {
    if (!army.regionId) continue;
    const values = armiesByRegion.get(army.regionId) ?? [];
    values.push(army);
    armiesByRegion.set(army.regionId, values);
  }
  const armyOffsets = [{ x: -15, y: -16 }, { x: 15, y: -16 }, { x: -21, y: 10 }, { x: 21, y: 10 }, { x: 0, y: 21 }];
  const presentedArmies = [...armiesByRegion.entries()].flatMap(([regionId, values]) => {
    const target = regionById.get(regionId);
    if (!target) return [];
    return [...values].sort((left, right) => left.id.localeCompare(right.id)).map((army, index) => {
      const offset = armyOffsets[index % armyOffsets.length]!;
      return { ...army, position: insideRegion({ x: target.center.x + offset.x, y: target.center.y + offset.y }, target, profile) };
    });
  });
  const armyPosition = new Map(presentedArmies.map((army) => [army.id, army.position!]));
  const personsByRegion = new Map<string, MapPersonForceView[]>();
  for (const person of persons) {
    const values = personsByRegion.get(person.regionId) ?? [];
    values.push(person);
    personsByRegion.set(person.regionId, values);
  }
  const presentedPersons = [...personsByRegion.entries()].flatMap(([regionId, values]) => {
    const target = regionById.get(regionId);
    if (!target) return [];
    const ordered = [...values].sort((left, right) => (
      Number(Boolean(right.formationId)) - Number(Boolean(left.formationId))
      || Number(right.isCommander) - Number(left.isCommander)
      || Number(right.isFactionLeader) - Number(left.isFactionLeader)
      || right.soldiers - left.soldiers
      || left.id.localeCompare(right.id)
    ));
    const formationMemberIndex = new Map<string, number>();
    let parkedIndex = 0;
    return ordered.map((person) => {
      let offset: MapPoint;
      if (person.formationId) {
        const member = formationMemberIndex.get(person.formationId) ?? 0;
        formationMemberIndex.set(person.formationId, member + 1);
        const camp = armyPosition.get(person.formationId) ?? target.center;
        const angle = Math.max(0, member - 1) * 2.4;
        const radius = member === 0 ? 0 : 11 + Math.floor((member - 1) / 3) * 5;
        const position = insideRegion({ x: camp.x + Math.cos(angle) * radius, y: camp.y + Math.sin(angle) * radius }, target, profile);
        return { ...person, position };
      } else {
        const column = parkedIndex % 5;
        const row = Math.floor(parkedIndex / 5);
        parkedIndex += 1;
        offset = { x: (column - 2) * 10, y: 17 + row * 9 };
      }
      const position = insideRegion({ x: target.center.x + offset.x, y: target.center.y + offset.y }, target, profile);
      return { ...person, position };
    });
  });

  const seaById = new Map(presentedSeaZones.map((zone) => [zone.id, zone]));
  const fleetGroups = new Map<string, MapFleetView[]>();
  for (const fleet of fleets) {
    const key = fleet.regionId ? `port:${fleet.regionId}` : `sea:${fleet.seaZoneId ?? fleet.anchorSeaZoneId ?? fleet.id}`;
    const group = fleetGroups.get(key) ?? [];
    group.push(fleet);
    fleetGroups.set(key, group);
  }
  const presentedFleets = [...fleetGroups.values()].flatMap((group) => {
    const ordered = [...group].sort((left, right) => left.id.localeCompare(right.id));
    return ordered.map((fleet, index) => {
      const sea = seaById.get(fleet.seaZoneId ?? fleet.anchorSeaZoneId ?? '');
      const port = fleet.regionId ? regionById.get(fleet.regionId) : undefined;
      if (port && sea) return { ...fleet, position: fleetBerth(port, sea.center, profile, index, ordered.length) };
      if (sea) {
        const fan = (index - (ordered.length - 1) / 2) * 15;
        const row = index % 2 === 0 ? -7 : 7;
        return { ...fleet, position: { x: sea.center.x + fan, y: sea.center.y + row } };
      }
      return { ...fleet, position: projectPoint(fleet.position) };
    });
  });

  return {
    profile,
    regions: presentedRegions,
    routes: routes.map((route) => ({
      ...route,
      points: route.points?.map(projectPoint),
    })),
    armies: presentedArmies,
    persons: presentedPersons,
    personClusters: [],
    seaZones: presentedSeaZones,
    fleets: presentedFleets,
    markers: markers.map((marker) => ({ ...marker, position: projectPoint(marker.position) })),
  };
}
