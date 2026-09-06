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

function insideRegion(point: MapPoint, region: MapRegionView) {
  let candidate = point;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (contains(candidate, region.polygon)) return candidate;
    candidate = {
      x: region.center.x + (candidate.x - region.center.x) * 0.48,
      y: region.center.y + (candidate.y - region.center.y) * 0.48,
    };
  }
  return { ...region.center };
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
    const formationIds = [...new Set(ordered.flatMap((person) => person.formationId ? [person.formationId] : []))];
    const formationSlot = new Map(formationIds.map((id, index) => [id, index]));
    const formationMemberIndex = new Map<string, number>();
    let parkedIndex = 0;
    return ordered.map((person) => {
      let offset: MapPoint;
      if (person.formationId) {
        const group = formationSlot.get(person.formationId) ?? 0;
        const member = formationMemberIndex.get(person.formationId) ?? 0;
        formationMemberIndex.set(person.formationId, member + 1);
        offset = {
          x: -18 + group * 17 + (member % 3) * 8,
          y: -18 - Math.floor(member / 3) * 9,
        };
      } else {
        const column = parkedIndex % 5;
        const row = Math.floor(parkedIndex / 5);
        parkedIndex += 1;
        offset = { x: (column - 2) * 10, y: 17 + row * 9 };
      }
      const position = insideRegion({ x: target.center.x + offset.x, y: target.center.y + offset.y }, target);
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
    armies: armies.map((army) => ({
      ...army,
      position: army.position ? projectPoint(army.position) : undefined,
    })),
    persons: presentedPersons,
    personClusters: [],
    seaZones: presentedSeaZones,
    fleets: presentedFleets,
    markers: markers.map((marker) => ({ ...marker, position: projectPoint(marker.position) })),
  };
}
