import {
  MAP_TERRITORY_SHAPES,
  getRegionDisplaySite,
  getSeaZoneDisplayCenter,
} from './map-geography';
import { buildTerritoryCells } from './map-territories';
import type {
  MapArmyView,
  MapFleetView,
  MapFlowView,
  MapMarkerView,
  MapPoint,
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
