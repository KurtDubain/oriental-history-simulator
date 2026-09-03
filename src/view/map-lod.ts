import type {
  MapArmyView,
  MapFleetView,
  MapLodLevel,
  MapLodScene,
  MapPersonForceClusterView,
  MapPersonForceView,
  MapPresentationView,
  MapRegionView,
  MapSelectedObject,
} from './map-contract';

export const MAP_LOD_THRESHOLDS = Object.freeze({
  overviewToRegional: 1.3,
  regionalToOverview: 1.2,
  regionalToLocal: 2,
  localToRegional: 1.85,
});

export interface BuildMapLodSceneOptions {
  selectedRegionId?: string | null;
  selectedObject?: MapSelectedObject;
  focusedArmyIds?: readonly string[];
}

function safeZoom(zoom: number) {
  return Number.isFinite(zoom) ? Math.max(1, zoom) : 1;
}

/**
 * Resolves zoom to one of three stable levels. Entry and exit thresholds are
 * deliberately different so wheel and pinch noise cannot make labels flicker.
 * Large jumps (notably reset-to-1x) may cross two levels in one update.
 */
export function resolveMapLodLevel(
  zoom: number,
  previous?: MapLodLevel,
): MapLodLevel {
  const value = safeZoom(zoom);
  if (!previous) {
    if (value >= MAP_LOD_THRESHOLDS.regionalToLocal) return 'local';
    if (value >= MAP_LOD_THRESHOLDS.overviewToRegional) return 'regional';
    return 'overview';
  }

  if (previous === 'overview') {
    if (value >= MAP_LOD_THRESHOLDS.regionalToLocal) return 'local';
    if (value >= MAP_LOD_THRESHOLDS.overviewToRegional) return 'regional';
    return 'overview';
  }

  if (previous === 'regional') {
    if (value >= MAP_LOD_THRESHOLDS.regionalToLocal) return 'local';
    if (value < MAP_LOD_THRESHOLDS.regionalToOverview) return 'overview';
    return 'regional';
  }

  if (value < MAP_LOD_THRESHOLDS.regionalToOverview) return 'overview';
  if (value < MAP_LOD_THRESHOLDS.localToRegional) return 'regional';
  return 'local';
}

const stableIdCompare = (left: string, right: string) => (
  left < right ? -1 : left > right ? 1 : 0
);

function strongestPerPolity<T extends { id: string; polityId?: string; strength: number }>(
  values: readonly T[],
) {
  const strongest = new Map<string, T>();
  for (const value of values) {
    if (!value.polityId) continue;
    const current = strongest.get(value.polityId);
    if (
      !current
      || value.strength > current.strength
      || (value.strength === current.strength && stableIdCompare(value.id, current.id) < 0)
    ) {
      strongest.set(value.polityId, value);
    }
  }
  return new Set([...strongest.values()].map((value) => value.id));
}

function visibleForOverview<T extends { id: string; polityId?: string; strength: number }>(
  values: readonly T[],
  selectedId: string | undefined,
) {
  const visibleIds = strongestPerPolity(values);
  if (selectedId) visibleIds.add(selectedId);
  return values.filter((value) => visibleIds.has(value.id));
}

function keyRegionIds(regions: readonly MapRegionView[]) {
  const result = new Set(regions.filter((region) => region.capital).map((region) => region.id));
  const bestByPolity = new Map<string, MapRegionView>();

  for (const region of regions) {
    if (!region.polityId || region.capital || (region.cityLevel ?? 0) <= 0) continue;
    const current = bestByPolity.get(region.polityId);
    const cityLevel = region.cityLevel ?? 0;
    const currentCityLevel = current?.cityLevel ?? 0;
    const strategicValue = region.strategicValue ?? 0;
    const currentStrategicValue = current?.strategicValue ?? 0;
    if (
      !current
      || cityLevel > currentCityLevel
      || (cityLevel === currentCityLevel && strategicValue > currentStrategicValue)
      || (
        cityLevel === currentCityLevel
        && strategicValue === currentStrategicValue
        && region.population > current.population
      )
      || (
        cityLevel === currentCityLevel
        && strategicValue === currentStrategicValue
        && region.population === current.population
        && stableIdCompare(region.id, current.id) < 0
      )
    ) {
      bestByPolity.set(region.polityId, region);
    }
  }

  for (const region of bestByPolity.values()) result.add(region.id);
  return result;
}

function selectedArmyId(selectedObject: MapSelectedObject) {
  return selectedObject?.kind === 'army' ? selectedObject.id : undefined;
}

function selectedFleetId(selectedObject: MapSelectedObject) {
  return selectedObject?.kind === 'fleet' ? selectedObject.id : undefined;
}

function visibleArmies(
  armies: readonly MapArmyView[],
  level: MapLodLevel,
  selectedObject: MapSelectedObject,
  focusedArmyIds: readonly string[],
) {
  if (level !== 'overview') return [...armies];
  const visible = visibleForOverview(armies, selectedArmyId(selectedObject));
  const ids = new Set([...visible.map((item) => item.id), ...focusedArmyIds]);
  return armies.filter((item) => ids.has(item.id));
}

function visibleFleets(
  fleets: readonly MapFleetView[],
  level: MapLodLevel,
  selectedObject: MapSelectedObject,
) {
  return level === 'overview'
    ? visibleForOverview(fleets, selectedFleetId(selectedObject))
    : [...fleets];
}

function visiblePersonForces(
  presentation: MapPresentationView,
  level: MapLodLevel,
  selectedObject: MapSelectedObject,
  focusedArmyIds: readonly string[],
): { persons: MapPersonForceView[]; clusters: MapPersonForceClusterView[] } {
  const source = presentation.persons ?? [];
  const selectedId = selectedObject?.kind === 'person' ? selectedObject.id : null;
  const focused = new Set(focusedArmyIds);
  if (level !== 'overview') {
    return {
      persons: source.map((person) => ({
        ...person,
        showLabel: level === 'local' || person.id === selectedId || person.isFactionLeader || person.status !== '驻留',
      })),
      clusters: [],
    };
  }
  const visibleIds = new Set(source
    .filter((person) => person.id === selectedId || (person.formationId && focused.has(person.formationId)))
    .map((person) => person.id));
  const persons = source
    .filter((person) => visibleIds.has(person.id))
    .map((person) => ({ ...person, showLabel: true }));
  const grouped = new Map<string, MapPersonForceView[]>();
  for (const person of source.filter((item) => !visibleIds.has(item.id))) {
    const key = `${person.regionId}:${person.polityId}`;
    const values = grouped.get(key) ?? [];
    values.push(person);
    grouped.set(key, values);
  }
  const regionById = new Map(presentation.regions.map((region) => [region.id, region]));
  const clusters = [...grouped.entries()].flatMap(([key, values]) => {
    const region = regionById.get(values[0]!.regionId);
    if (!region) return [];
    const ordered = [...values].sort((left, right) => (
      Number(right.isFactionLeader || right.isCommander) - Number(left.isFactionLeader || left.isCommander)
      || right.soldiers - left.soldiers
      || stableIdCompare(left.id, right.id)
    ));
    const leader = ordered[0]!;
    return [{
      id: `person-cluster:${key}`,
      regionId: leader.regionId,
      position: region.center,
      leaderName: leader.personName,
      personIds: ordered.map((person) => person.id),
      count: ordered.length,
      soldiers: ordered.reduce((sum, person) => sum + person.soldiers, 0),
      polityId: leader.polityId,
      polityColor: leader.polityColor,
    }];
  });
  return { persons, clusters };
}

/**
 * Creates the deterministic, observer-only visibility slice for a map frame.
 * The input projection and its objects are never changed.
 */
export function buildMapLodScene(
  presentation: MapPresentationView,
  level: MapLodLevel,
  options: BuildMapLodSceneOptions = {},
): MapLodScene {
  const selectedObject = options.selectedObject ?? null;
  const capitals = new Set(
    presentation.regions.filter((region) => region.capital).map((region) => region.id),
  );
  const keyRegions = keyRegionIds(presentation.regions);
  const regionLabelIds = level === 'local'
    ? new Set(presentation.regions.map((region) => region.id))
    : level === 'regional'
      ? new Set(keyRegions)
      : new Set(capitals);
  if (options.selectedRegionId) regionLabelIds.add(options.selectedRegionId);

  const cityRegionIds = level === 'local'
    ? new Set(
      presentation.regions
        .filter((region) => region.capital || (region.cityLevel ?? 0) > 0)
        .map((region) => region.id),
    )
    : level === 'regional'
      ? new Set(keyRegions)
      : capitals;
  const portRegionIds = level === 'overview'
    ? new Set<string>()
    : new Set(
      presentation.regions.filter((region) => region.port).map((region) => region.id),
    );
  const interactiveSeaZoneIds = new Set(presentation.seaZones.map((zone) => zone.id));
  const personForces = visiblePersonForces(presentation, level, selectedObject, options.focusedArmyIds ?? []);

  return {
    ...presentation,
    level,
    regionLabelIds,
    cityRegionIds,
    portRegionIds,
    interactiveSeaZoneIds,
    armies: visibleArmies(presentation.armies, level, selectedObject, options.focusedArmyIds ?? []),
    persons: personForces.persons,
    personClusters: personForces.clusters,
    fleets: visibleFleets(presentation.fleets, level, selectedObject),
    markers: [...presentation.markers],
  };
}
