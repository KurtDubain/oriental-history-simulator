import type { WorldState } from '../sim/types';
import type {
  MapArmyView,
  MapFleetView,
  MapFlowView,
  MapMarkerView,
  MapOverlay,
  MapRegionView,
  MapRouteView,
  MapSeaZoneView,
} from './map-contract';

const compact = new Intl.NumberFormat('zh-CN', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

function polity(world: WorldState, id: string | null | undefined) {
  if (!id) return undefined;
  return world.polities.find((candidate) => candidate.id === id);
}

function region(world: WorldState, id: string | null | undefined) {
  if (!id) return undefined;
  return world.regions.find((candidate) => candidate.id === id);
}

function foodSafetyRatio(population: number, food: number) {
  return food / Math.max(1, population);
}

export function toMapRegions(world: WorldState): MapRegionView[] {
  const polities = new Map(world.polities.map((item) => [item.id, item]));
  return world.regions.map((item) => {
    const owner = polities.get(item.controllerId);
    const infection = world.infections.find((entry) => entry.hostKind === 'region' && entry.hostId === item.id);
    const practiceStates = world.practiceStates.filter((entry) => entry.regionId === item.id && entry.lostTurn === null);
    const tradeVolume = world.tradeCorridors
      .filter((entry) => entry.active && (entry.originRegionId === item.id || entry.destinationRegionId === item.id))
      .reduce((sum, entry) => sum + entry.lastVolume, 0);
    return {
      id: item.id,
      name: item.name,
      polygon: item.polygon,
      center: { x: item.x, y: item.y },
      terrain: item.terrain,
      polityId: owner?.id,
      polityName: owner?.name ?? '无主之地',
      polityColor: owner?.color ?? '#777267',
      population: item.population,
      foodRatio: foodSafetyRatio(item.population, item.food),
      unrest: item.unrest,
      warDamage: item.devastation,
      port: item.port,
      portLevel: item.portLevel,
      capital: owner?.capitalRegionId === item.id,
      cityLevel: item.cityLevel,
      defense: item.defense,
      strategicValue: item.strategicValue,
      diseasePressure: infection
        ? (infection.infectious + infection.exposed) / Math.max(1, item.population) * 100
        : 0,
      knowledgeAdoption: practiceStates.length
        ? practiceStates.reduce((sum, entry) => sum + entry.adoption, 0) / practiceStates.length
        : 0,
      refugeePopulation: item.refugeePopulation,
      tradeVolume: Math.min(100, Math.log1p(tradeVolume) * 8),
    };
  });
}

export function toMapRoutes(world: WorldState): MapRouteView[] {
  return world.routes.map((item) => ({
    id: item.id,
    from: item.fromRegionId,
    to: item.toRegionId,
    type: item.kind === '河道' ? 'river' : item.kind === '海峡' ? 'sea' : 'land',
  }));
}

export function toMapArmies(world: WorldState): MapArmyView[] {
  const polities = new Map(world.polities.map((item) => [item.id, item]));
  return world.armies
    .filter((army) => army.soldiers > 0)
    .map((army) => ({
      id: army.id,
      name: army.name,
      regionId: army.regionId,
      polityId: army.polityId,
      polityColor: polities.get(army.polityId)?.color,
      strength: army.soldiers,
      morale: army.morale,
      status: army.supply < 45 ? '补给吃紧' : '在营',
    }));
}

export function toMapSeaZones(world: WorldState): MapSeaZoneView[] {
  return world.seaZones.map((item) => {
    const controller = polity(world, item.controllerId);
    const totalPower = Object.values(item.powerByPolity)
      .reduce((sum, value) => sum + Math.max(0, value), 0);
    const controllerPower = item.controllerId
      ? Math.max(0, item.powerByPolity[item.controllerId] ?? 0)
      : 0;
    return {
      id: item.id,
      name: item.name,
      center: { x: item.x, y: item.y },
      climate: item.climate,
      controllerName: controller?.name,
      controllerColor: controller?.color,
      contested: item.contested,
      traffic: item.traffic,
      stormRisk: item.stormRisk,
      piracy: item.piracy,
      powerShare: totalPower > 0 ? controllerPower / totalPower : 0,
    };
  });
}

function fleetPoint(world: WorldState, fleetId: string) {
  const fleet = world.fleets.find((item) => item.id === fleetId);
  if (!fleet) return undefined;
  const zone = world.seaZones.find((item) => item.id === fleet.seaZoneId);
  const portRegion = region(world, fleet.portRegionId ?? fleet.homePortRegionId);
  return zone
    ? { x: zone.x, y: zone.y }
    : portRegion
      ? { x: portRegion.x, y: portRegion.y }
      : undefined;
}

export function toMapFleets(world: WorldState): MapFleetView[] {
  return world.fleets.flatMap((item) => {
    const position = fleetPoint(world, item.id);
    if (!position) return [];
    return [{
      id: item.id,
      name: item.name,
      seaZoneId: item.seaZoneId,
      regionId: item.portRegionId,
      position,
      polityColor: polity(world, item.polityId)?.color,
      strength: item.warships * 3 + item.patrolShips + item.transports * 0.4,
      readiness: item.readiness,
      mission: item.mission,
    }];
  });
}

function hostPoint(world: WorldState, hostId: string) {
  const hostRegion = region(world, hostId);
  if (hostRegion) return { x: hostRegion.x, y: hostRegion.y };
  const army = world.armies.find((item) => item.id === hostId);
  const armyRegion = region(world, army?.regionId);
  if (armyRegion) return { x: armyRegion.x, y: armyRegion.y };
  return fleetPoint(world, hostId);
}

export function toMapFlows(world: WorldState, overlay: MapOverlay): MapFlowView[] {
  const flows: MapFlowView[] = [];
  if (overlay === 'trade') {
    for (const corridor of world.tradeCorridors.filter((item) => item.active)) {
      const from = region(world, corridor.originRegionId);
      const to = region(world, corridor.destinationRegionId);
      if (!from || !to) continue;
      flows.push({
        id: corridor.id,
        kind: 'trade',
        from,
        to,
        magnitude: corridor.lastVolume,
        label: `${corridor.commodity} · ${compact.format(corridor.lastVolume)}`,
        selectedKind: 'tradeCorridor',
        selectedId: corridor.id,
        alert: corridor.risk >= 65,
      });
    }
  }
  if (overlay === 'migration') {
    for (const shipment of world.lastTurn?.trade.shipments.filter((item) => item.kind === '迁徙') ?? []) {
      const from = region(world, shipment.originRegionId);
      const to = region(world, shipment.destinationRegionId);
      if (!from || !to) continue;
      flows.push({
        id: shipment.id,
        kind: 'migration',
        from,
        to,
        magnitude: shipment.peopleDeparted,
        label: `${compact.format(shipment.peopleArrived)}人落籍`,
        selectedKind: 'migration',
        selectedId: shipment.id,
        alert: shipment.peopleLost > 0,
      });
    }
  }
  if (overlay === 'disease') {
    for (const infection of world.infections) {
      const destination = hostPoint(world, infection.hostId);
      if (!destination) continue;
      for (const source of infection.recentSources) {
        const origin = hostPoint(world, source.sourceHostId);
        if (!origin || source.importedExposures <= 0) continue;
        flows.push({
          id: `${infection.id}-${source.turn}-${source.shipmentId ?? source.sourceHostId}`,
          kind: 'disease',
          from: origin,
          to: destination,
          magnitude: source.importedExposures,
          label: `输入暴露 ${source.importedExposures}`,
          selectedKind: 'outbreak',
          selectedId: infection.id,
          alert: true,
        });
      }
    }
  }
  if (overlay === 'knowledge') {
    for (const state of world.practiceStates.filter((item) => item.sourceRegionId && item.mastery > 0)) {
      const from = region(world, state.sourceRegionId);
      const to = region(world, state.regionId);
      const practice = world.practices.find((item) => item.id === state.practiceId);
      if (!from || !to || !practice) continue;
      flows.push({
        id: state.id,
        kind: 'knowledge',
        from,
        to,
        magnitude: Math.max(state.adoption, state.mastery),
        label: `${practice.name} · 采用${Math.round(state.adoption)}`,
        selectedKind: 'practice',
        selectedId: practice.id,
      });
    }
  }
  if (overlay === 'naval') {
    for (const lane of world.seaLanes) {
      const from = world.seaZones.find((item) => item.id === lane.fromSeaZoneId);
      const to = world.seaZones.find((item) => item.id === lane.toSeaZoneId);
      if (!from || !to) continue;
      flows.push({
        id: lane.id,
        kind: 'naval',
        from,
        to,
        magnitude: lane.capacity,
        label: lane.strait ? '海峡航道' : '海上航道',
        selectedKind: 'seaZone',
        selectedId: to.id,
        alert: lane.baseRisk >= 65,
      });
    }
  }
  return flows
    .sort((left, right) => right.magnitude - left.magnitude || left.id.localeCompare(right.id))
    .slice(0, 16);
}

export function toMapMarkers(world: WorldState, overlay: MapOverlay): MapMarkerView[] {
  if (overlay === 'disease') {
    return world.infections
      .filter((item) => item.infectious > 0 || item.exposed > 0)
      .flatMap((item) => {
        const position = hostPoint(world, item.hostId);
        const pathogen = world.pathogens.find((candidate) => candidate.id === item.pathogenId);
        const total = item.susceptible + item.exposed + item.infectious + item.recovered;
        return position ? [{
          id: item.id,
          kind: 'outbreak' as const,
          position,
          magnitude: Math.min(100, (item.exposed + item.infectious) / Math.max(1, total) * 1_000),
          label: pathogen?.name ?? '疫病',
          alert: item.infectious > 0,
        }] : [];
      })
      .sort((left, right) => right.magnitude - left.magnitude)
      .slice(0, 20);
  }
  if (overlay === 'knowledge') {
    return world.practiceStates
      .filter((item) => item.innovationProgress > 0 || item.mastery > 0)
      .sort((left, right) => (
        Math.max(right.adoption, right.mastery, right.innovationProgress)
        - Math.max(left.adoption, left.mastery, left.innovationProgress)
      ))
      .flatMap((item) => {
        const practice = world.practices.find((candidate) => candidate.id === item.practiceId);
        const practiceRegion = region(world, item.regionId);
        return practice && practiceRegion ? [{
          id: practice.id,
          kind: 'practice' as const,
          position: { x: practiceRegion.x, y: practiceRegion.y },
          magnitude: Math.max(item.adoption, item.mastery, item.innovationProgress),
          label: practice.name,
        }] : [];
      })
      .filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index)
      .slice(0, 20);
  }
  return [];
}
