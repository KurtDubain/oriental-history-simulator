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

  const contains = (point: MapPoint, polygon: readonly MapPoint[]) => {
    let inside = false;
    for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
      const a = polygon[current]!;
      const b = polygon[previous]!;
      if ((a.y > point.y) !== (b.y > point.y)
        && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  };
  const hash = (value: string) => {
    let result = 2166136261;
    for (const character of value) result = Math.imul(result ^ character.charCodeAt(0), 16777619);
    return result >>> 0;
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
    return [...values].sort((left, right) => left.id.localeCompare(right.id)).map((person, index) => {
      const angle = ((hash(person.id) % 360) / 180) * Math.PI;
      const ring = 14 + Math.floor(index / 6) * 9;
      let radius = ring;
      let position = target.center;
      while (radius >= 1) {
        const candidate = {
          x: target.center.x + Math.cos(angle + index * 1.7) * radius,
          y: target.center.y + Math.sin(angle + index * 1.7) * radius,
        };
        if (contains(candidate, target.polygon)) { position = candidate; break; }
        radius *= 0.55;
      }
      return { ...person, position: { ...position } };
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
    fleets: fleets.map((fleet) => ({ ...fleet, position: projectPoint(fleet.position) })),
    markers: markers.map((marker) => ({ ...marker, position: projectPoint(marker.position) })),
  };
}
