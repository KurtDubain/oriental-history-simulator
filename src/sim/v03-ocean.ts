import { getMapProfileForContentVersion } from '../maps';
import type { MapProfile } from '../maps/types';
import { keyedInt, keyedRandom, stableCompare } from './random';
import { emitSimulationFact, projectFactLinks, type BattleFact, type SimulationFact } from './facts';
import { practiceEffect } from './v03-life';
import type { V03Emit, V03TurnContext } from './v03-context';
import {
  COMMODITIES,
  type CommodityKind,
  type CommodityPrices,
  type CommodityStock,
  type FleetState,
  type NavalOperationState,
  type NonFoodCommodity,
  type PortLinkState,
  type PortState,
  type RegionState,
  type SeaLaneState,
  type SeaZoneState,
  type ShipmentLeg,
  type ShipmentRecord,
  type ShipbuildingProjectState,
  type TradeCorridorState,
  type WorldState,
} from './types';

const NON_FOOD_COMMODITIES: readonly NonFoodCommodity[] = [
  '木材', '铁器', '马匹', '盐', '纺织品', '奢侈品',
];

const BASE_PRICES: CommodityPrices = {
  粮食: 10,
  木材: 18,
  铁器: 38,
  马匹: 46,
  盐: 24,
  纺织品: 31,
  奢侈品: 62,
};

const MAX_SHIPMENTS_PER_TURN = 512;
const MAX_TRADE_CORRIDORS = 160;

export interface CreateV03OceanOptions {
  legacy: boolean;
  profile?: MapProfile;
}

interface TransportEdge {
  id: string;
  kind: ShipmentLeg['kind'];
  from: string;
  to: string;
  capacity: number;
  distance: number;
  risk: number;
  portRegionId: string | null;
}

interface TransportPath {
  edges: TransportEdge[];
  cost: number;
  risk: number;
}

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function whole(value: number): number {
  return Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
}

function addLedger(
  target: Partial<Record<CommodityKind, number>>,
  commodity: CommodityKind,
  amount: number,
): void {
  target[commodity] = whole((target[commodity] ?? 0) + amount);
}

function blankStock(): CommodityStock {
  return { 木材: 0, 铁器: 0, 马匹: 0, 盐: 0, 纺织品: 0, 奢侈品: 0 };
}

function resourcePotential(world: WorldState, region: RegionState): CommodityStock {
  const coastal = region.port || region.terrain === '海岸' || region.terrain === '岛屿';
  const mountain = region.terrain === '山地' || region.terrain === '丘陵' || region.terrain === '高原';
  const urban = region.cityLevel >= 3;
  return {
    木材: whole(clamp(keyedInt(world.seed, 28, 72, 'v03', 'resource', region.id, 'timber') + (mountain ? 17 : 0) + (region.climate === '湿热' ? 8 : 0))),
    铁器: whole(clamp(keyedInt(world.seed, 18, 64, 'v03', 'resource', region.id, 'iron') + (mountain ? 21 : 0))),
    马匹: whole(clamp(keyedInt(world.seed, 12, 60, 'v03', 'resource', region.id, 'horses') + (region.terrain === '高原' || region.climate === '干旱' ? 28 : 0))),
    盐: whole(clamp(keyedInt(world.seed, 15, 58, 'v03', 'resource', region.id, 'salt') + (coastal ? 27 : 0))),
    纺织品: whole(clamp(keyedInt(world.seed, 24, 68, 'v03', 'resource', region.id, 'textile') + (urban ? 18 : 0) + (region.climate === '湿热' ? 8 : 0))),
    奢侈品: whole(clamp(keyedInt(world.seed, 10, 55, 'v03', 'resource', region.id, 'luxury') + (urban ? 22 : 0) + (coastal ? 7 : 0))),
  };
}

function initialGoods(region: RegionState, potential: CommodityStock): CommodityStock {
  const goods = blankStock();
  for (const commodity of NON_FOOD_COMMODITIES) {
    const scale = commodity === '铁器' || commodity === '马匹' || commodity === '奢侈品' ? 22_000 : 12_000;
    goods[commodity] = whole(region.population * (0.25 + potential[commodity] / 100) / scale * 100);
  }
  return goods;
}

function initialPrices(world: WorldState, region: RegionState, potential: CommodityStock): CommodityPrices {
  const prices = { ...BASE_PRICES };
  prices.粮食 = whole(BASE_PRICES.粮食 * (1.15 - region.fertility / 300));
  for (const commodity of NON_FOOD_COMMODITIES) {
    const noise = 0.94 + keyedRandom(world.seed, 'v03', 'price', region.id, commodity) * 0.12;
    prices[commodity] = Math.max(1, whole(BASE_PRICES[commodity] * (1.42 - potential[commodity] / 180) * noise));
  }
  return prices;
}

function rebuildLandAdjacency(world: WorldState): void {
  const byId = new Map(world.regions.map((region) => [region.id, region]));
  world.routes = world.routes.filter((route) => (
    route.kind !== '海峡'
    && byId.has(route.fromRegionId)
    && byId.has(route.toRegionId)
  ));
  for (const region of world.regions) {
    region.neighbors = [];
    region.routeIds = [];
  }
  for (const route of world.routes) {
    const from = byId.get(route.fromRegionId);
    const to = byId.get(route.toRegionId);
    if (!from || !to) continue;
    from.neighbors.push(to.id);
    to.neighbors.push(from.id);
    from.routeIds.push(route.id);
    to.routeIds.push(route.id);
  }
  for (const region of world.regions) {
    region.neighbors.sort(stableCompare);
    region.routeIds.sort(stableCompare);
  }
}

function createSeaZones(world: WorldState, profile: MapProfile): SeaZoneState[] {
  const regionIds = new Set(world.regions.map((region) => region.id));
  return profile.simulation.seaZones.map((definition) => ({
    ...definition,
    adjacentSeaZoneIds: profile.simulation.seaLanes
      .filter((lane) => lane.fromSeaZoneId === definition.id || lane.toSeaZoneId === definition.id)
      .map((lane) => lane.fromSeaZoneId === definition.id ? lane.toSeaZoneId : lane.fromSeaZoneId)
      .sort(stableCompare),
    portRegionIds: profile.simulation.portLinks
      .filter((link) => link.seaZoneId === definition.id && regionIds.has(link.regionId))
      .map((link) => link.regionId)
      .sort(stableCompare),
    traffic: 0,
    controllerId: null,
    contested: false,
    powerByPolity: {},
  }));
}

function createSeaLanes(profile: MapProfile): SeaLaneState[] {
  return profile.simulation.seaLanes.map((lane) => ({ ...lane }));
}

function createPortLinks(world: WorldState, profile: MapProfile): PortLinkState[] {
  const ports = new Set(world.regions.filter((region) => region.port).map((region) => region.id));
  return profile.simulation.portLinks.filter((link) => ports.has(link.regionId)).map((link) => ({ ...link }));
}

function createPorts(world: WorldState): PortState[] {
  return world.regions
    .filter((region) => region.port)
    .sort((left, right) => stableCompare(left.id, right.id))
    .map((region) => {
      const level = whole(clamp(region.portLevel || Math.max(1, Math.min(4, region.cityLevel)), 1, 4));
      region.portLevel = level;
      return {
        id: `port_${region.id.slice(2)}`,
        regionId: region.id,
        level,
        throughput: 6_000 + level * 6_000 + region.marketLevel * 800,
        shipyard: level >= 3 ? level - 1 : level === 2 ? 1 : 0,
        repair: 18 + level * 12,
        merchantConfidence: whole(clamp(42 + region.cityLevel * 9 - region.unrest * 0.25)),
        blockadePressure: 0,
        customsRevenue: 0,
        damage: whole(region.devastation * 0.25),
      };
    });
}

function selectFleetCommander(world: WorldState, polityId: string): WorldState['characters'][number] | null {
  const deputyIds = new Set([
    ...world.armies.map((army) => army.deputyCommanderId).filter((id): id is string => Boolean(id)),
    ...world.fleets.map((fleet) => fleet.deputyCommanderId).filter((id): id is string => Boolean(id)),
  ]);
  return world.characters
    .filter((character) => (
      character.alive
      && character.age >= 16
      && character.polityId === polityId
      && character.role !== '君主'
      && !character.commandingArmyId
      && !character.commandingFleetId
      && !character.governedRegionId
      && !deputyIds.has(character.id)
    ))
    .sort((left, right) => (
      (right.leadership + right.cunning * 0.45 + right.loyalty * 0.2)
      - (left.leadership + left.cunning * 0.45 + left.loyalty * 0.2)
      || stableCompare(left.id, right.id)
    ))[0] ?? null;
}

function createFleetAtPort(
  world: WorldState,
  portRegion: RegionState,
  composition?: { warships: number; transports: number; patrolShips: number },
): FleetState | null {
  const polity = world.polities.find((item) => item.id === portRegion.controllerId && item.alive);
  if (!polity) return null;
  const commander = selectFleetCommander(world, polity.id);
  if (!commander) return null;
  const port = world.ports.find((item) => item.regionId === portRegion.id);
  const level = port?.level ?? Math.max(1, portRegion.cityLevel - 1);
  const ships = composition ?? {
    warships: 4 + level * 2,
    transports: 3 + level,
    patrolShips: 3 + level,
  };
  const sailors = Math.min(portRegion.population, whole((ships.warships * 90 + ships.transports * 55 + ships.patrolShips * 42)));
  if (sailors < 300) return null;
  const food = Math.min(portRegion.food, sailors * 2);
  portRegion.population -= sailors;
  portRegion.food -= food;
  world.counters.fleet += 1;
  const fleet: FleetState = {
    id: `fleet_${String(world.counters.fleet).padStart(4, '0')}`,
    name: `${portRegion.name}水师`,
    polityId: polity.id,
    commanderId: commander.id,
    deputyCommanderId: null,
    homePortRegionId: portRegion.id,
    portRegionId: portRegion.id,
    seaZoneId: null,
    // Keep the fleet identity namespace independent from the shipbuilding
    // project that supplied this composition. A completed project is a wider
    // structural object at runtime; spreading it here can overwrite `id` with
    // `shipproject_*` and leave the fleet allocation counter behind its entity.
    warships: ships.warships,
    transports: ships.transports,
    patrolShips: ships.patrolShips,
    sailors,
    morale: 62,
    training: 46 + level * 4,
    experience: 8,
    readiness: food >= sailors ? 76 : 55,
    repairNeed: 0,
    food,
    mission: '护航',
    targetSeaZoneId: world.portLinks.find((link) => link.regionId === portRegion.id)?.seaZoneId ?? null,
    targetRegionId: null,
    lastMovedTurn: -1,
  };
  commander.commandingFleetId = fleet.id;
  commander.locationRegionId = portRegion.id;
  world.fleets.push(fleet);
  return fleet;
}

/**
 * Installs V0.3a state. No history event id is required: this is authoritative
 * schema/bootstrap state, not a narrated action. Legacy worlds receive the ten
 * sea zones and every compatible existing port, but never receive a free fleet.
 */
export function createV03OceanSystems(world: WorldState, options: CreateV03OceanOptions): void {
  const profile = options.profile ?? getMapProfileForContentVersion(world.mapContentVersion);
  world.mapContentVersion = options.legacy ? 'legacy-v02-48' : profile.contentVersion;
  world.counters.fleet ??= 0;
  world.counters.tradeCorridor ??= 0;
  world.counters.navalOperation ??= 0;
  world.counters.shipment ??= 0;
  world.counters.shipProject ??= 0;
  world.fleets ??= [];
  world.tradeCorridors ??= [];
  world.navalOperations ??= [];
  world.shipbuildingProjects ??= [];

  for (const polity of world.polities) {
    polity.tradeRevenue ??= 0;
    polity.navalBudget ??= 0;
    polity.maritimeOrientation ??= 0;
    polity.diplomaticReputation ??= 50;
  }
  for (const character of world.characters) {
    character.commandingFleetId ??= null;
    character.health ??= 100;
    character.activeDiseaseId ??= null;
    character.protectedUntilTurn ??= null;
  }
  for (const army of world.armies) army.embarkedOperationId ??= null;
  for (const relation of world.diplomacy) {
    relation.tradeAgreementUntilTurn ??= null;
    relation.tributePayerId ??= null;
    relation.tributePerTurn ??= 0;
    relation.treatyEventIds ??= [];
  }
  for (const region of world.regions) {
    region.refugeePopulation ??= 0;
    region.sanitation ??= whole(clamp(28 + region.cityLevel * 8 - (region.climate === '湿热' ? 4 : 0)));
    region.medicalCapacity ??= whole(clamp(16 + region.cityLevel * 7));
    region.marketLevel ??= Math.max(1, Math.min(5, region.cityLevel + (region.port ? 1 : 0)));
    region.portLevel ??= region.port ? Math.max(1, Math.min(4, region.cityLevel)) : 0;
    const hasPotential = region.resourcePotential && NON_FOOD_COMMODITIES.every((commodity) => Number.isFinite(region.resourcePotential[commodity]));
    const potential = !options.legacy || !hasPotential ? resourcePotential(world, region) : region.resourcePotential;
    region.resourcePotential = { ...potential };
    const hasGoods = region.goods && NON_FOOD_COMMODITIES.every((commodity) => Number.isFinite(region.goods[commodity]));
    const hasPrices = region.prices && COMMODITIES.every((commodity) => Number.isFinite(region.prices[commodity]));
    // New worlds replace engine placeholders with the seeded opening inventory.
    // Migration only fills absent fields, so an existing V0.3 inventory is never
    // duplicated. Opening inventory is a bootstrap balance, not quarterly output.
    region.goods = !options.legacy || !hasGoods ? initialGoods(region, potential) : { ...region.goods };
    region.prices = !options.legacy || !hasPrices ? initialPrices(world, region, potential) : { ...region.prices };
  }

  rebuildLandAdjacency(world);
  world.seaLanes = createSeaLanes(profile);
  world.portLinks = createPortLinks(world, profile);
  world.seaZones = createSeaZones(world, profile);
  world.ports = createPorts(world);

  if (!options.legacy && world.fleets.length === 0) {
    for (const polity of world.polities.filter((item) => item.alive).sort((a, b) => stableCompare(a.id, b.id))) {
      const portRegion = world.regions
        .filter((region) => region.controllerId === polity.id && region.port)
        .sort((left, right) => right.portLevel - left.portLevel || right.cityLevel - left.cityLevel || stableCompare(left.id, right.id))[0];
      if (portRegion) createFleetAtPort(world, portRegion);
    }
  }
}

export function commodityAmount(region: RegionState, commodity: CommodityKind): number {
  return commodity === '粮食' ? region.food : region.goods[commodity];
}

function setCommodityAmount(region: RegionState, commodity: CommodityKind, amount: number): void {
  if (commodity === '粮食') region.food = whole(amount);
  else region.goods[commodity] = whole(amount);
}

export function totalCommodity(world: WorldState, commodity: CommodityKind): number {
  const regional = world.regions.reduce((sum, region) => sum + commodityAmount(region, commodity), 0);
  if (commodity !== '粮食') return regional;
  return regional
    + world.armies.reduce((sum, army) => sum + army.food, 0)
    + world.fleets.reduce((sum, fleet) => sum + fleet.food, 0)
    + world.navalOperations
      .filter((operation) => operation.stage !== '完成' && operation.stage !== '失败')
      .reduce((sum, operation) => sum + operation.foodLoaded, 0);
}

function transportEdges(world: WorldState): TransportEdge[] {
  const edges: TransportEdge[] = [];
  for (const route of world.routes.filter((item) => item.kind !== '海峡')) {
    edges.push({
      id: route.id,
      kind: 'route',
      from: route.fromRegionId,
      to: route.toRegionId,
      capacity: route.supplyCapacity,
      distance: Math.max(1, route.distance / 60),
      risk: route.kind === '山道' ? 10 : route.kind === '河道' ? 4 : 6,
      portRegionId: null,
    });
  }
  for (const link of world.portLinks) {
    const port = world.ports.find((item) => item.regionId === link.regionId);
    const effective = whole(link.capacity * (1 - (port?.blockadePressure ?? 0) / 125) * (1 - (port?.damage ?? 0) / 150));
    edges.push({
      id: link.id,
      kind: 'port-link',
      from: link.regionId,
      to: link.seaZoneId,
      capacity: effective,
      distance: link.distance,
      risk: 3 + (port?.blockadePressure ?? 0) * 0.18,
      portRegionId: link.regionId,
    });
  }
  for (const lane of world.seaLanes) {
    const from = world.seaZones.find((zone) => zone.id === lane.fromSeaZoneId);
    const to = world.seaZones.find((zone) => zone.id === lane.toSeaZoneId);
    const weather = ((from?.stormRisk ?? 0) + (to?.stormRisk ?? 0)) / 2;
    edges.push({
      id: lane.id,
      kind: 'sea-lane',
      from: lane.fromSeaZoneId,
      to: lane.toSeaZoneId,
      capacity: whole(lane.capacity * clamp(1.12 - weather / 180, 0.45, 1.05)),
      distance: lane.distance,
      risk: lane.baseRisk + weather * 0.28 + ((from?.piracy ?? 0) + (to?.piracy ?? 0)) * 0.12,
      portRegionId: null,
    });
  }
  return edges;
}

function findPath(
  world: WorldState,
  startId: string,
  goalId: string,
  cache: Map<string, TransportPath | null>,
): TransportPath | null {
  const cacheKey = `${startId}>${goalId}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey) ?? null;
  if (startId === goalId) {
    const result = { edges: [], cost: 0, risk: 0 };
    cache.set(cacheKey, result);
    return result;
  }
  const edges = transportEdges(world);
  const adjacency = new Map<string, Array<{ next: string; edge: TransportEdge }>>();
  for (const edge of edges) {
    const forward = adjacency.get(edge.from) ?? [];
    forward.push({ next: edge.to, edge });
    adjacency.set(edge.from, forward);
    const backward = adjacency.get(edge.to) ?? [];
    backward.push({ next: edge.from, edge });
    adjacency.set(edge.to, backward);
  }
  for (const values of adjacency.values()) values.sort((a, b) => stableCompare(a.edge.id, b.edge.id));

  const distances = new Map<string, number>([[startId, 0]]);
  const previous = new Map<string, { node: string; edge: TransportEdge }>();
  const open = new Set<string>([startId]);
  while (open.size > 0) {
    const current = [...open].sort((left, right) => (
      (distances.get(left) ?? Number.POSITIVE_INFINITY) - (distances.get(right) ?? Number.POSITIVE_INFINITY)
      || stableCompare(left, right)
    ))[0] as string;
    open.delete(current);
    if (current === goalId) break;
    for (const candidate of adjacency.get(current) ?? []) {
      if (candidate.edge.capacity <= 0) continue;
      const edgeCost = candidate.edge.distance + candidate.edge.risk * 0.08 + 1;
      const nextDistance = (distances.get(current) ?? 0) + edgeCost;
      const known = distances.get(candidate.next);
      if (known === undefined || nextDistance < known - 1e-9) {
        distances.set(candidate.next, nextDistance);
        previous.set(candidate.next, { node: current, edge: candidate.edge });
        open.add(candidate.next);
      }
    }
  }
  if (!previous.has(goalId)) {
    cache.set(cacheKey, null);
    return null;
  }
  const path: TransportEdge[] = [];
  let cursor = goalId;
  while (cursor !== startId) {
    const step = previous.get(cursor);
    if (!step) {
      cache.set(cacheKey, null);
      return null;
    }
    path.push(step.edge);
    cursor = step.node;
  }
  path.reverse();
  const result = {
    edges: path,
    cost: distances.get(goalId) ?? 0,
    risk: path.length === 0 ? 0 : path.reduce((sum, edge) => sum + edge.risk, 0) / path.length,
  };
  cache.set(cacheKey, result);
  return result;
}

function reservePath(
  world: WorldState,
  context: V03TurnContext,
  path: TransportPath,
  requested: number,
  flowId: string,
  portUsage: Map<string, number>,
): number {
  if (requested <= 0) return 0;
  let accepted = whole(requested);
  const uniquePorts = new Set(path.edges.map((edge) => edge.portRegionId).filter((id): id is string => Boolean(id)));
  for (const edge of path.edges) {
    const reservations = edge.kind === 'route' ? context.routeCapacityReserved : context.seaCapacityReserved;
    accepted = Math.min(accepted, Math.max(0, edge.capacity - (reservations[edge.id] ?? 0)));
  }
  for (const portRegionId of uniquePorts) {
    const port = world.ports.find((item) => item.regionId === portRegionId);
    accepted = Math.min(accepted, Math.max(0, (port?.throughput ?? 0) - (portUsage.get(portRegionId) ?? 0)));
  }
  accepted = whole(accepted);
  if (accepted <= 0) return 0;
  for (const edge of path.edges) {
    const reservations = edge.kind === 'route' ? context.routeCapacityReserved : context.seaCapacityReserved;
    reservations[edge.id] = whole((reservations[edge.id] ?? 0) + accepted);
    if (edge.kind === 'route') {
      let usage = context.logistics.routeUsage.find((item) => item.routeId === edge.id);
      if (!usage) {
        usage = { routeId: edge.id, capacity: edge.capacity, reserved: 0, armyIds: [], flowIds: [] };
        context.logistics.routeUsage.push(usage);
      }
      usage.reserved += accepted;
      usage.flowIds ??= [];
      if (!usage.flowIds.includes(flowId)) usage.flowIds.push(flowId);
    } else {
      let usage = context.logistics.seaUsage.find((item) => item.edgeId === edge.id);
      if (!usage) {
        usage = { edgeId: edge.id, capacity: edge.capacity, reserved: 0, flowIds: [] };
        context.logistics.seaUsage.push(usage);
      }
      usage.reserved += accepted;
      if (!usage.flowIds.includes(flowId)) usage.flowIds.push(flowId);
    }
  }
  for (const portRegionId of uniquePorts) portUsage.set(portRegionId, (portUsage.get(portRegionId) ?? 0) + accepted);
  return accepted;
}

function releasePath(
  context: V03TurnContext,
  path: TransportPath,
  amount: number,
  flowId: string,
  portUsage: Map<string, number>,
): void {
  if (amount <= 0) return;
  const uniquePorts = new Set(path.edges.map((edge) => edge.portRegionId).filter((id): id is string => Boolean(id)));
  for (const edge of path.edges) {
    const reservations = edge.kind === 'route' ? context.routeCapacityReserved : context.seaCapacityReserved;
    reservations[edge.id] = Math.max(0, (reservations[edge.id] ?? 0) - amount);
    if (edge.kind === 'route') {
      const usage = context.logistics.routeUsage.find((item) => item.routeId === edge.id);
      if (usage) {
        usage.reserved = Math.max(0, usage.reserved - amount);
        usage.flowIds = (usage.flowIds ?? []).filter((id) => id !== flowId);
      }
    } else {
      const usage = context.logistics.seaUsage.find((item) => item.edgeId === edge.id);
      if (usage) {
        usage.reserved = Math.max(0, usage.reserved - amount);
        usage.flowIds = usage.flowIds.filter((id) => id !== flowId);
      }
    }
  }
  for (const portRegionId of uniquePorts) {
    portUsage.set(portRegionId, Math.max(0, (portUsage.get(portRegionId) ?? 0) - amount));
  }
}

function targetStock(region: RegionState, commodity: CommodityKind): number {
  switch (commodity) {
    case '粮食': return Math.max(1, whole(region.population * 1.75));
    case '木材': return Math.max(20, whole(region.population / 250 + region.portLevel * 100));
    case '铁器': return Math.max(15, whole(region.population / 520 + region.cityLevel * 35));
    case '马匹': return Math.max(10, whole(region.population / 850 + (region.terrain === '高原' ? 80 : 0)));
    case '盐': return Math.max(20, whole(region.population / 310));
    case '纺织品': return Math.max(20, whole(region.population / 280 + region.cityLevel * 30));
    case '奢侈品': return Math.max(8, whole(region.population / 1_350 + region.cityLevel * 25));
  }
}

function priceFor(region: RegionState, commodity: CommodityKind): number {
  return Math.max(1, whole(region.prices[commodity]));
}

function updatePrices(world: WorldState): void {
  for (const region of world.regions) {
    for (const commodity of COMMODITIES) {
      const stock = commodityAmount(region, commodity);
      const target = targetStock(region, commodity);
      const scarcity = clamp((target - stock) / Math.max(1, target), -0.7, 1.4);
      const anchor = BASE_PRICES[commodity] * (1 + scarcity * 0.75);
      const previous = priceFor(region, commodity);
      const proposed = previous * 0.76 + anchor * 0.24;
      region.prices[commodity] = Math.max(1, whole(clamp(proposed, previous * 0.85, previous * 1.15)));
    }
  }
}

function produceAndConsumeGoods(world: WorldState, context: V03TurnContext): void {
  const seasonFactor = context.season === '夏' ? 1.12 : context.season === '秋' ? 1.18 : context.season === '冬' ? 0.72 : 0.94;
  const productionScales: Record<NonFoodCommodity, number> = {
    木材: 9_500,
    铁器: 17_000,
    马匹: 21_000,
    盐: 13_000,
    纺织品: 11_000,
    奢侈品: 25_000,
  };
  const consumptionScales: Record<NonFoodCommodity, number> = {
    木材: 5_500,
    铁器: 8_500,
    马匹: 16_000,
    盐: 680,
    纺织品: 820,
    奢侈品: 4_200,
  };
  for (const region of [...world.regions].sort((a, b) => stableCompare(a.id, b.id))) {
    for (const commodity of NON_FOOD_COMMODITIES) {
      const potential = region.resourcePotential[commodity] / 100;
      const produced = whole(
        region.population / productionScales[commodity]
        * potential
        * seasonFactor
        * (1 - region.devastation / 130)
        * (0.82 + region.marketLevel * 0.05),
      );
      region.goods[commodity] += produced;
      addLedger(context.trade.produced, commodity, produced);
      const need = whole(
        region.population / consumptionScales[commodity]
        * (commodity === '奢侈品' ? Math.max(0.25, region.cityLevel / 4) : 1),
      );
      const consumed = Math.min(region.goods[commodity], need);
      region.goods[commodity] -= consumed;
      addLedger(context.trade.consumed, commodity, consumed);
    }
  }
}

function legRecords(path: TransportPath, amount: number, month: 0 | 1 | 2): ShipmentLeg[] {
  return path.edges.map((edge) => ({ kind: edge.kind, edgeId: edge.id, month, capacityUsed: amount }));
}

function createShipmentId(world: WorldState): string {
  world.counters.shipment += 1;
  return `shipment_${String(world.counters.shipment).padStart(7, '0')}`;
}

function hostileRaidFleet(world: WorldState, originPolityId: string, path: TransportPath): FleetState | null {
  const seaIds = new Set(path.edges.filter((edge) => edge.kind === 'sea-lane').flatMap((edge) => [edge.from, edge.to]));
  return world.fleets
    .filter((fleet) => {
      if (fleet.polityId === originPolityId || fleet.mission !== '袭商' || !fleet.seaZoneId || !seaIds.has(fleet.seaZoneId)) return false;
      return world.wars.some((war) => war.active && (
        (war.attackerId === fleet.polityId && war.defenderId === originPolityId)
        || (war.defenderId === fleet.polityId && war.attackerId === originPolityId)
      ));
    })
    .sort((left, right) => (
      (right.warships * right.readiness) - (left.warships * left.readiness)
      || stableCompare(left.id, right.id)
    ))[0] ?? null;
}

function escortStrength(world: WorldState, ownerPolityId: string, path: TransportPath): number {
  const seaIds = new Set(path.edges.filter((edge) => edge.kind === 'sea-lane').flatMap((edge) => [edge.from, edge.to]));
  return world.fleets
    .filter((fleet) => fleet.polityId === ownerPolityId && fleet.mission === '护航' && Boolean(fleet.seaZoneId && seaIds.has(fleet.seaZoneId)))
    .reduce((sum, fleet) => sum + fleet.warships * fleet.readiness / 100 + fleet.patrolShips * 0.65, 0);
}

function recordShipment(world: WorldState, context: V03TurnContext, shipment: ShipmentRecord): void {
  if (context.trade.shipments.length >= MAX_SHIPMENTS_PER_TURN) return;
  context.trade.shipments.push(shipment);
  if (shipment.kind === '军粮') context.logistics.remoteFoodTransferred += shipment.deliveredAmount;
  for (const leg of shipment.legs.filter((item) => item.kind === 'sea-lane')) {
    const lane = world.seaLanes.find((item) => item.id === leg.edgeId);
    if (!lane) continue;
    for (const zoneId of [lane.fromSeaZoneId, lane.toSeaZoneId]) {
      const zone = world.seaZones.find((item) => item.id === zoneId);
      if (zone) zone.traffic += shipment.acceptedAmount;
    }
  }
}

function processMilitarySupply(
  world: WorldState,
  context: V03TurnContext,
  cache: Map<string, TransportPath | null>,
  portUsage: Map<string, number>,
): void {
  const supplyOne = (
    kind: ShipmentRecord['kind'],
    carrier: FleetState | WorldState['armies'][number],
    destinationNodeId: string,
    destinationRegionId: string,
    missing: number,
  ): void => {
    if (missing <= 0 || context.trade.shipments.length >= MAX_SHIPMENTS_PER_TURN) return;
    const sources = world.regions
      .filter((region) => region.controllerId === carrier.polityId && region.food > targetStock(region, '粮食') * 1.08)
      .sort((left, right) => (right.food - targetStock(right, '粮食')) - (left.food - targetStock(left, '粮食')) || stableCompare(left.id, right.id));
    for (const source of sources.slice(0, 6)) {
      const path = findPath(world, source.id, destinationNodeId, cache);
      if (!path) continue;
      const hostileLand = path.edges
        .filter((edge) => edge.kind === 'route')
        .flatMap((edge) => [edge.from, edge.to])
        .some((regionId) => {
          const region = world.regions.find((item) => item.id === regionId);
          return region && region.id !== destinationRegionId && region.controllerId !== carrier.polityId;
        });
      if (hostileLand) continue;
      const seaZoneIds = new Set(path.edges
        .filter((edge) => edge.kind === 'sea-lane')
        .flatMap((edge) => [edge.from, edge.to]));
      const supportFleet = seaZoneIds.size > 0
        ? world.fleets
          .filter((fleet) => (
            fleet.polityId === carrier.polityId
            && fleet.readiness >= 25
            && (fleet.transports > 0 || fleet.mission === '护航')
            && Boolean(
              (fleet.seaZoneId && seaZoneIds.has(fleet.seaZoneId))
              || fleet.portRegionId === source.id
              || fleet.homePortRegionId === source.id,
            )
          ))
          .sort((left, right) => right.transports - left.transports || stableCompare(left.id, right.id))[0]
        : undefined;
      if (seaZoneIds.size > 0 && !supportFleet && !('warships' in carrier)) continue;
      const id = createShipmentId(world);
      const shippingLimit = seaZoneIds.size > 0
        ? ('warships' in carrier ? carrier.transports * 1_200 : (supportFleet?.transports ?? 0) * 1_200)
        : 7_500;
      const request = Math.min(missing, source.food - targetStock(source, '粮食'), 7_500, shippingLimit);
      const accepted = reservePath(world, context, path, request, id, portUsage);
      if (accepted <= 0) continue;
      const risk = path.edges.some((edge) => edge.kind === 'sea-lane') ? clamp(path.risk * 0.12, 0, 9) : clamp(path.risk * 0.05, 0, 4);
      const supplyPractice = Math.max(
        practiceEffect(world, source.id, 'supply-loss'),
        practiceEffect(world, destinationRegionId, 'supply-loss'),
      );
      const lost = whole(accepted * risk / 100 * (1 - supplyPractice) * (0.65 + keyedRandom(world.seed, context.turn, id, 'supply-loss') * 0.7));
      const delivered = accepted - lost;
      source.food -= accepted;
      carrier.food += delivered;
      context.food.transferred += accepted;
      context.food.warDestroyed += lost;
      addLedger(context.trade.lost, '粮食', lost);
      const month = (world.counters.shipment % 3) as 0 | 1 | 2;
      recordShipment(world, context, {
        id,
        kind,
        commodity: '粮食',
        originRegionId: source.id,
        destinationRegionId,
        acceptedAmount: accepted,
        deliveredAmount: delivered,
        lostAmount: lost,
        raidedAmount: 0,
        peopleDeparted: 0,
        peopleArrived: 0,
        peopleLost: 0,
        contactVolume: whole(accepted / 30),
        legs: legRecords(path, accepted, month),
        carrierArmyId: 'soldiers' in carrier ? carrier.id : null,
        carrierFleetId: 'warships' in carrier ? carrier.id : supportFleet?.id ?? null,
        value: 0,
        tariff: 0,
        status: lost > 0 ? '受损' : '交付',
      });
      return;
    }
  };

  for (const army of [...world.armies].sort((a, b) => stableCompare(a.id, b.id))) {
    if (army.embarkedOperationId) continue;
    supplyOne('军粮', army, army.regionId, army.regionId, Math.max(0, army.soldiers * 2 - army.food));
  }
  for (const fleet of [...world.fleets].sort((a, b) => stableCompare(a.id, b.id))) {
    if (!fleet.seaZoneId) continue;
    supplyOne('舰队补给', fleet, fleet.seaZoneId, fleet.homePortRegionId, Math.max(0, fleet.sailors * 2 - fleet.food));
  }
}

function updateTradeCorridor(
  world: WorldState,
  origin: RegionState,
  destination: RegionState,
  commodity: CommodityKind,
  path: TransportPath,
  volume: number,
  profit: number,
): { corridor: TradeCorridorState; created: boolean } {
  const id = `corridor:${origin.id}:${destination.id}:${commodity}`;
  let corridor = world.tradeCorridors.find((item) => item.id === id);
  const created = !corridor;
  if (!corridor) {
    world.counters.tradeCorridor += 1;
    corridor = {
      id,
      originRegionId: origin.id,
      destinationRegionId: destination.id,
      commodity,
      pathEdgeIds: path.edges.map((edge) => edge.id),
      lastVolume: 0,
      rollingVolume: 0,
      rollingProfit: 0,
      risk: 0,
      active: true,
      lastActiveTurn: world.turn,
    };
    world.tradeCorridors.push(corridor);
  }
  corridor.pathEdgeIds = path.edges.map((edge) => edge.id);
  corridor.lastVolume += volume;
  corridor.rollingVolume = whole(corridor.rollingVolume * 0.78 + volume * 0.22);
  corridor.rollingProfit = whole(Math.max(0, corridor.rollingProfit * 0.78 + profit * 0.22));
  corridor.risk = Math.round(clamp(corridor.risk * 0.7 + path.risk * 0.3));
  corridor.active = volume > 0;
  corridor.lastActiveTurn = world.turn;
  return { corridor, created };
}

function processTrades(
  world: WorldState,
  context: V03TurnContext,
  emit: V03Emit,
  cache: Map<string, TransportPath | null>,
  portUsage: Map<string, number>,
): void {
  const bilateralValue = new Map<string, number>();
  let narrated = 0;
  for (const commodity of COMMODITIES) {
    if (context.trade.shipments.length >= MAX_SHIPMENTS_PER_TURN) break;
    const exporters = world.regions
      .filter((region) => commodityAmount(region, commodity) > targetStock(region, commodity) * 1.05)
      .sort((left, right) => (
        (commodityAmount(right, commodity) - targetStock(right, commodity))
        - (commodityAmount(left, commodity) - targetStock(left, commodity))
        || stableCompare(left.id, right.id)
      ))
      .slice(0, 10);
    const importers = world.regions
      .filter((region) => commodityAmount(region, commodity) < targetStock(region, commodity) * 1.35)
      .sort((left, right) => priceFor(right, commodity) - priceFor(left, commodity) || stableCompare(left.id, right.id))
      .slice(0, 12);
    const candidates: Array<{ origin: RegionState; destination: RegionState; margin: number }> = [];
    for (const origin of exporters) {
      for (const destination of importers) {
        if (origin.id === destination.id) continue;
        const atWar = world.wars.some((war) => war.active && (
          (war.attackerId === origin.controllerId && war.defenderId === destination.controllerId)
          || (war.defenderId === origin.controllerId && war.attackerId === destination.controllerId)
        ));
        if (atWar) continue;
        candidates.push({ origin, destination, margin: priceFor(destination, commodity) - priceFor(origin, commodity) });
      }
    }
    candidates.sort((left, right) => right.margin - left.margin
      || stableCompare(`${left.origin.id}:${left.destination.id}`, `${right.origin.id}:${right.destination.id}`));

    for (const candidate of candidates.slice(0, 36)) {
      if (context.trade.shipments.length >= MAX_SHIPMENTS_PER_TURN) break;
      const { origin, destination } = candidate;
      const path = findPath(world, origin.id, destination.id, cache);
      if (!path || path.edges.length === 0) continue;
      const protectedTrade = activeTradeAgreement(world, origin.controllerId, destination.controllerId);
      const transportCost = path.cost * (commodity === '粮食' ? 0.045 : 0.07) * (protectedTrade ? 0.9 : 1);
      if (candidate.margin <= Math.max(1.5, transportCost)) continue;
      const surplus = whole(commodityAmount(origin, commodity) - targetStock(origin, commodity));
      const shortage = whole(targetStock(destination, commodity) * 1.2 - commodityAmount(destination, commodity));
      const unitPrice = (priceFor(origin, commodity) + priceFor(destination, commodity)) / 200;
      const affordable = whole(destination.wealth / Math.max(0.01, unitPrice * 1.05));
      const treatyCapacity = protectedTrade ? 1.15 : 1;
      const request = Math.min(surplus, shortage, affordable, whole((commodity === '粮食' ? 6_000 : 1_800) * treatyCapacity));
      if (request <= 0) continue;
      const id = createShipmentId(world);
      const accepted = reservePath(world, context, path, request, id, portUsage);
      if (accepted <= 0) continue;

      const escort = escortStrength(world, origin.controllerId, path);
      const raider = hostileRaidFleet(world, origin.controllerId, path);
      const commercialPractice = Math.max(
        practiceEffect(world, origin.id, 'trade-loss'),
        practiceEffect(world, destination.id, 'trade-loss'),
      );
      const navigationPractice = path.edges.some((edge) => edge.kind === 'sea-lane')
        ? Math.max(practiceEffect(world, origin.id, 'sea-risk'), practiceEffect(world, destination.id, 'sea-risk'))
        : 0;
      const rawLossRate = clamp(
        (path.risk * 0.16 - Math.min(8, escort * 0.08))
          * (1 - commercialPractice)
          * (1 - navigationPractice)
          * (protectedTrade ? 0.88 : 1),
        0,
        18,
      );
      const lost = whole(accepted * rawLossRate / 100 * (0.55 + keyedRandom(world.seed, context.turn, id, 'loss') * 0.9));
      const remaining = accepted - lost;
      const raidRate = raider ? clamp((raider.warships * 3 + raider.patrolShips * 1.5) * raider.readiness / 2_500 - escort * 0.08, 0, 22) : 0;
      const raided = whole(remaining * raidRate / 100 * (0.65 + keyedRandom(world.seed, context.turn, id, 'raid') * 0.7));
      const delivered = remaining - raided;
      setCommodityAmount(origin, commodity, commodityAmount(origin, commodity) - accepted);
      setCommodityAmount(destination, commodity, commodityAmount(destination, commodity) + delivered);
      if (raided > 0 && raider) {
        const prizePort = world.regions.find((region) => region.id === raider.homePortRegionId);
        if (prizePort) setCommodityAmount(prizePort, commodity, commodityAmount(prizePort, commodity) + raided);
        else addLedger(context.trade.lost, commodity, raided);
        context.maritime.raidedShipmentIds.push(id);
      }
      addLedger(context.trade.lost, commodity, lost);
      if (commodity === '粮食') context.food.warDestroyed += lost + (raided > 0 && !raider ? raided : 0);

      const value = Math.min(destination.wealth, whole(delivered * unitPrice));
      const destinationPolity = world.polities.find((polity) => polity.id === destination.controllerId && polity.alive);
      const tariff = Math.min(
        destination.wealth - value,
        whole(value * (destinationPolity?.taxRate ?? 0) * 0.12 * (protectedTrade ? 0.72 : 1)),
      );
      destination.wealth -= value + tariff;
      origin.wealth += value;
      if (destinationPolity) {
        destinationPolity.treasury += tariff;
        destinationPolity.tradeRevenue = whole(destinationPolity.tradeRevenue * 0.9 + tariff);
      } else destination.wealth += tariff;
      const destinationPort = path.edges
        .filter((edge) => edge.kind === 'port-link')
        .map((edge) => world.ports.find((port) => port.regionId === edge.portRegionId))
        .filter((port): port is PortState => Boolean(port))
        .at(-1);
      if (destinationPort) destinationPort.customsRevenue += tariff;
      context.trade.valueTransferred += value;
      context.trade.tariffsTransferred += tariff;
      const month = (world.counters.shipment % 3) as 0 | 1 | 2;
      const shipment: ShipmentRecord = {
        id,
        kind: '贸易',
        commodity,
        originRegionId: origin.id,
        destinationRegionId: destination.id,
        acceptedAmount: accepted,
        deliveredAmount: delivered,
        lostAmount: lost,
        raidedAmount: raided,
        peopleDeparted: 0,
        peopleArrived: 0,
        peopleLost: 0,
        contactVolume: whole(accepted / 24 + path.edges.length * 3),
        legs: legRecords(path, accepted, month),
        carrierArmyId: null,
        carrierFleetId: null,
        value,
        tariff,
        status: lost + raided > 0 ? '受损' : '交付',
      };
      recordShipment(world, context, shipment);
      const profit = whole(Math.max(0, candidate.margin * delivered / 100 - lost * unitPrice));
      const { corridor, created } = updateTradeCorridor(world, origin, destination, commodity, path, delivered, profit);
      const pair = [origin.controllerId, destination.controllerId].sort(stableCompare).join(':');
      bilateralValue.set(pair, (bilateralValue.get(pair) ?? 0) + value);

      if ((created || raided > 0) && narrated < 3 && delivered >= (commodity === '粮食' ? 800 : 120)) {
        narrated += 1;
        emit({
          category: raided > 0 ? '海洋' : '经济',
          kind: raided > 0 ? 'commerce_raided' : 'trade_corridor_opened',
          title: raided > 0 ? `${origin.name}商货在海上遇袭` : `${origin.name}—${destination.name}${commodity}商路形成`,
          summary: raided > 0
            ? `${accepted}${commodity}启运，${raided}被${raider?.name ?? '敌方水师'}劫取，实际到货${delivered}。`
            : `${origin.name}与${destination.name}的实际价差促成${delivered}${commodity}成交，货物沿${path.edges.length}段运输到达。`,
          importance: raided > 0 ? 3 : 2,
          actorIds: raider ? [raider.commanderId] : [],
          polityIds: [...new Set([origin.controllerId, destination.controllerId, ...(raider ? [raider.polityId] : [])])],
          regionIds: [origin.id, destination.id],
          causes: [
            {
              label: '实际价差', role: '结构', weight: 0.34,
              evidence: `${origin.name}${priceFor(origin, commodity)}，${destination.name}${priceFor(destination, commodity)}`,
              refs: [
                { kind: 'entity', entityType: 'region', entityId: origin.id, field: `prices.${commodity}`, label: '起运价' },
                { kind: 'entity', entityType: 'region', entityId: destination.id, field: `prices.${commodity}`, label: '到岸价' },
              ],
            },
            {
              label: '容量仲裁', role: '条件', weight: 0.28, evidence: `申请${request}，实际接受${accepted}`,
              refs: [{ kind: 'shipment', entityType: 'shipment', entityId: id, label: '实际运输记录' }],
            },
            {
              label: raided > 0 ? '敌方袭商投射' : '交付结果', role: '结果', weight: 0.38,
              evidence: raided > 0 ? `${raider?.name ?? '敌舰'}劫取${raided}` : `交付${delivered}，货值${value}`,
              refs: [{ kind: 'entity', entityType: 'tradeCorridor', entityId: corridor.id, label: '商路状态' }],
            },
          ],
          stateDeltas: [{ entityType: 'tradeCorridor', entityId: corridor.id, field: 'rollingVolume', before: Math.max(0, corridor.rollingVolume - whole(delivered * 0.22)), after: corridor.rollingVolume }],
        });
      }
    }
  }

  for (const relation of world.diplomacy) {
    const pair = [relation.polityAId, relation.polityBId].sort(stableCompare).join(':');
    const actualValue = bilateralValue.get(pair) ?? 0;
    const dependency = clamp(actualValue / 800, 0, 100);
    relation.tradeDependency = Math.round(clamp(relation.tradeDependency * 0.84 + dependency * 0.16));
  }
}

/** Production, real price-gap trade and shared land/sea capacity settlement. */
export function processV03EconomyAndTrade(world: WorldState, context: V03TurnContext, emit: V03Emit): void {
  context.logistics.seaUsage ??= [];
  context.trade.shipments ??= [];
  for (const corridor of world.tradeCorridors) {
    corridor.lastVolume = 0;
    if (world.turn - corridor.lastActiveTurn > 12) corridor.active = false;
  }
  for (const zone of world.seaZones) zone.traffic = 0;
  for (const port of world.ports) port.customsRevenue = 0;
  produceAndConsumeGoods(world, context);
  updatePrices(world);
  const pathCache = new Map<string, TransportPath | null>();
  const portUsage = new Map<string, number>();
  processMilitarySupply(world, context, pathCache, portUsage);
  processTrades(world, context, emit, pathCache, portUsage);
  updatePrices(world);
  world.tradeCorridors = [...world.tradeCorridors]
    .sort((left, right) => Number(right.active) - Number(left.active)
      || right.rollingVolume - left.rollingVolume
      || stableCompare(left.id, right.id))
    .slice(0, MAX_TRADE_CORRIDORS);
}

function seaZonePath(world: WorldState, startId: string, goalId: string): string[] | null {
  if (startId === goalId) return [startId];
  const queue = [startId];
  const parent = new Map<string, string | null>([[startId, null]]);
  while (queue.length > 0) {
    const current = queue.shift() as string;
    const zone = world.seaZones.find((item) => item.id === current);
    if (!zone) continue;
    for (const next of [...zone.adjacentSeaZoneIds].sort(stableCompare)) {
      if (parent.has(next)) continue;
      parent.set(next, current);
      if (next === goalId) {
        const path = [goalId];
        let cursor: string | null = current;
        while (cursor) {
          path.push(cursor);
          cursor = parent.get(cursor) ?? null;
        }
        return path.reverse();
      }
      queue.push(next);
    }
  }
  return null;
}

function maritimePathBetweenPorts(world: WorldState, originRegionId: string, destinationRegionId: string): TransportPath | null {
  const originLinks = world.portLinks.filter((link) => link.regionId === originRegionId).sort((a, b) => stableCompare(a.id, b.id));
  const destinationLinks = world.portLinks.filter((link) => link.regionId === destinationRegionId).sort((a, b) => stableCompare(a.id, b.id));
  let best: TransportPath | null = null;
  const edges = transportEdges(world);
  for (const originLink of originLinks) {
    for (const destinationLink of destinationLinks) {
      const zones = seaZonePath(world, originLink.seaZoneId, destinationLink.seaZoneId);
      if (!zones) continue;
      const selected: TransportEdge[] = [];
      const first = edges.find((edge) => edge.id === originLink.id);
      const last = edges.find((edge) => edge.id === destinationLink.id);
      if (!first || !last) continue;
      selected.push(first);
      let complete = true;
      for (let index = 1; index < zones.length; index += 1) {
        const left = zones[index - 1] as string;
        const right = zones[index] as string;
        const lane = world.seaLanes.find((item) => (
          (item.fromSeaZoneId === left && item.toSeaZoneId === right)
          || (item.fromSeaZoneId === right && item.toSeaZoneId === left)
        ));
        const edge = lane ? edges.find((item) => item.id === lane.id) : undefined;
        if (!edge) {
          complete = false;
          break;
        }
        selected.push(edge);
      }
      if (!complete) continue;
      selected.push(last);
      const result = {
        edges: selected,
        cost: selected.reduce((sum, edge) => sum + edge.distance + edge.risk * 0.08, 0),
        risk: selected.reduce((sum, edge) => sum + edge.risk, 0) / Math.max(1, selected.length),
      };
      if (!best || result.cost < best.cost) best = result;
    }
  }
  return best;
}

function atWar(world: WorldState, leftId: string, rightId: string): boolean {
  return world.wars.some((war) => war.active && (
    (war.attackerId === leftId && war.defenderId === rightId)
    || (war.attackerId === rightId && war.defenderId === leftId)
  ));
}

function activeTradeAgreement(world: WorldState, leftId: string, rightId: string): boolean {
  if (leftId === rightId) return false;
  const relation = world.diplomacy.find((item) => (
    (item.polityAId === leftId && item.polityBId === rightId)
    || (item.polityAId === rightId && item.polityBId === leftId)
  ));
  return Boolean(
    relation
    && relation.status !== '战争'
    && relation.tradeAgreementUntilTurn !== null
    && relation.tradeAgreementUntilTurn > world.turn,
  );
}

function dissolveFleet(world: WorldState, fleet: FleetState, context: V03TurnContext): void {
  const settlement = world.regions.find((region) => region.id === fleet.portRegionId)
    ?? world.regions.find((region) => region.id === fleet.homePortRegionId);
  if (settlement) {
    settlement.population += fleet.sailors;
    settlement.food += fleet.food;
    context.population.demobilized += fleet.sailors;
    context.food.transferred += fleet.food;
  } else {
    context.population.militaryDeaths += fleet.sailors;
    context.food.warDestroyed += fleet.food;
  }
  const commander = world.characters.find((character) => character.id === fleet.commanderId);
  if (commander?.commandingFleetId === fleet.id) commander.commandingFleetId = null;
  world.fleets = world.fleets.filter((item) => item.id !== fleet.id);
}

function fleetOfficerCandidate(
  world: WorldState,
  polityId: string,
  excluded: ReadonlySet<string>,
  commander: boolean,
): WorldState['characters'][number] | null {
  const armyOfficers = new Set(world.armies.flatMap((army) => [army.commanderId, ...(army.deputyCommanderId ? [army.deputyCommanderId] : [])]));
  const fleetDeputies = new Set(world.fleets.map((fleet) => fleet.deputyCommanderId).filter((id): id is string => Boolean(id)));
  return world.characters
    .filter((character) => (
      character.alive
      && character.age >= 16
      && character.polityId === polityId
      && character.role !== '君主'
      && !character.governedRegionId
      && !character.commandingArmyId
      && !character.commandingFleetId
      && !armyOfficers.has(character.id)
      && !fleetDeputies.has(character.id)
      && !excluded.has(character.id)
      && (commander || character.role === '廷臣' || character.role === '将领')
    ))
    .sort((left, right) => (
      (right.leadership * 0.58 + right.cunning * 0.24 + right.loyalty * 0.18)
      - (left.leadership * 0.58 + left.cunning * 0.24 + left.loyalty * 0.18)
      || stableCompare(left.id, right.id)
    ))[0] ?? null;
}

function repairFleets(world: WorldState, context: V03TurnContext, emit: V03Emit): void {
  const alivePolities = new Map(world.polities.filter((polity) => polity.alive).map((polity) => [polity.id, polity]));
  for (const character of world.characters) {
    if (character.commandingFleetId && !world.fleets.some((fleet) => fleet.id === character.commandingFleetId && fleet.commanderId === character.id)) {
      character.commandingFleetId = null;
    }
  }
  for (const fleet of [...world.fleets].sort((a, b) => stableCompare(a.id, b.id))) {
    const home = world.regions.find((region) => region.id === fleet.homePortRegionId);
    if (!alivePolities.has(fleet.polityId)) {
      const receiver = home ? alivePolities.get(home.controllerId) : undefined;
      if (!receiver) {
        dissolveFleet(world, fleet, context);
        continue;
      }
      const previousPolityId = fleet.polityId;
      const previousCommander = world.characters.find((character) => character.id === fleet.commanderId);
      if (previousCommander?.commandingFleetId === fleet.id) previousCommander.commandingFleetId = null;
      fleet.polityId = receiver.id;
      fleet.portRegionId = home?.id ?? null;
      fleet.seaZoneId = null;
      const replacement = fleetOfficerCandidate(world, receiver.id, new Set(), true);
      if (!replacement) {
        dissolveFleet(world, fleet, context);
        continue;
      }
      fleet.commanderId = replacement.id;
      fleet.deputyCommanderId = null;
      replacement.commandingFleetId = fleet.id;
      emit({
        category: '海洋',
        kind: 'fleet_received_after_collapse',
        title: `${receiver.name}接收${fleet.name}`,
        summary: `${previousPolityId}灭亡后，${fleet.name}因母港已由${receiver.name}掌握而被接收，水手与军粮均保留在实体账内。`,
        importance: 3,
        actorIds: [replacement.id],
        polityIds: [previousPolityId, receiver.id],
        regionIds: home ? [home.id] : [],
        causes: [
          { label: '原政权灭亡', role: '触发', weight: 0.35, evidence: `${previousPolityId}已不再存续` },
          { label: '母港归属', role: '结构', weight: 0.35, evidence: `${home?.name ?? fleet.homePortRegionId}现由${receiver.name}控制`, refs: home ? [{ kind: 'entity', entityType: 'region', entityId: home.id, field: 'controllerId', label: '母港控制者' }] : [] },
          { label: '舰队接收', role: '结果', weight: 0.3, evidence: `${fleet.sailors}名水手及${fleet.food}军粮未被复制或销毁`, refs: [{ kind: 'entity', entityType: 'fleet', entityId: fleet.id, field: 'polityId', label: '舰队归属' }] },
        ],
        stateDeltas: [{ entityType: 'fleet', entityId: fleet.id, field: 'polityId', before: previousPolityId, after: receiver.id }],
      });
    }
  }

  const used = new Set<string>();
  for (const fleet of [...world.fleets].sort((a, b) => stableCompare(a.id, b.id))) {
    const home = world.regions.find((region) => region.id === fleet.homePortRegionId);
    if (!home || home.controllerId !== fleet.polityId) {
      const replacementHome = world.regions
        .filter((region) => region.port && region.controllerId === fleet.polityId)
        .sort((left, right) => right.portLevel - left.portLevel || stableCompare(left.id, right.id))[0];
      if (!replacementHome) {
        dissolveFleet(world, fleet, context);
        continue;
      }
      if (fleet.portRegionId === fleet.homePortRegionId) {
        fleet.portRegionId = null;
        fleet.seaZoneId = world.portLinks.find((link) => link.regionId === fleet.homePortRegionId)?.seaZoneId ?? null;
      }
      fleet.homePortRegionId = replacementHome.id;
    }
    const current = world.characters.find((character) => character.id === fleet.commanderId);
    const valid = Boolean(
      current?.alive
      && current.polityId === fleet.polityId
      && current.commandingFleetId === fleet.id
      && !current.commandingArmyId
      && !current.governedRegionId
      && !world.armies.some((army) => army.deputyCommanderId === current.id)
      && !used.has(current.id),
    );
    if (!valid) {
      if (current?.commandingFleetId === fleet.id) current.commandingFleetId = null;
      const replacement = fleetOfficerCandidate(world, fleet.polityId, used, true);
      if (!replacement) {
        dissolveFleet(world, fleet, context);
        continue;
      }
      fleet.commanderId = replacement.id;
      replacement.commandingFleetId = fleet.id;
    }
    used.add(fleet.commanderId);
    const deputy = fleet.deputyCommanderId ? world.characters.find((character) => character.id === fleet.deputyCommanderId) : undefined;
    const validDeputy = Boolean(
      deputy?.alive
      && deputy.polityId === fleet.polityId
      && !deputy.commandingArmyId
      && !deputy.commandingFleetId
      && !deputy.governedRegionId
      && !world.armies.some((army) => army.deputyCommanderId === deputy.id)
      && !used.has(deputy.id),
    );
    if (!validDeputy) {
      const candidate = fleetOfficerCandidate(world, fleet.polityId, used, false);
      fleet.deputyCommanderId = candidate?.id ?? null;
    }
    if (fleet.deputyCommanderId) used.add(fleet.deputyCommanderId);
  }
}

function chooseFleetMissions(world: WorldState): void {
  for (const fleet of [...world.fleets].sort((a, b) => stableCompare(a.id, b.id))) {
    const enemyIds = world.wars
      .filter((war) => war.active && (war.attackerId === fleet.polityId || war.defenderId === fleet.polityId))
      .map((war) => war.attackerId === fleet.polityId ? war.defenderId : war.attackerId);
    const enemyPort = world.regions
      .filter((region) => region.port && enemyIds.includes(region.controllerId))
      .map((region) => ({
        region,
        link: world.portLinks.find((link) => link.regionId === region.id),
        value: region.cityLevel * 8 + region.portLevel * 12 + region.wealth / 20_000,
      }))
      .filter((item): item is { region: RegionState; link: PortLinkState; value: number } => Boolean(item.link))
      .sort((left, right) => right.value - left.value || stableCompare(left.region.id, right.region.id))[0];
    if (enemyPort) {
      fleet.mission = fleet.warships >= 7 ? '封锁' : '袭商';
      fleet.targetRegionId = enemyPort.region.id;
      fleet.targetSeaZoneId = enemyPort.link.seaZoneId;
      continue;
    }
    const ownCorridor = world.tradeCorridors
      .filter((corridor) => corridor.active && (
        world.regions.find((region) => region.id === corridor.originRegionId)?.controllerId === fleet.polityId
        || world.regions.find((region) => region.id === corridor.destinationRegionId)?.controllerId === fleet.polityId
      ))
      .sort((left, right) => right.rollingVolume - left.rollingVolume || stableCompare(left.id, right.id))[0];
    const lane = ownCorridor?.pathEdgeIds
      .map((id) => world.seaLanes.find((item) => item.id === id))
      .find((item): item is SeaLaneState => Boolean(item));
    fleet.mission = ownCorridor ? '护航' : '巡逻';
    fleet.targetRegionId = null;
    fleet.targetSeaZoneId = lane?.fromSeaZoneId
      ?? world.portLinks.find((link) => link.regionId === fleet.homePortRegionId)?.seaZoneId
      ?? null;
  }
}

function moveFleets(world: WorldState): void {
  for (const fleet of [...world.fleets].sort((a, b) => stableCompare(a.id, b.id))) {
    if (!fleet.targetSeaZoneId || fleet.lastMovedTurn === world.turn) continue;
    if (fleet.portRegionId) {
      const links = world.portLinks.filter((link) => link.regionId === fleet.portRegionId);
      const direct = links.find((link) => link.seaZoneId === fleet.targetSeaZoneId);
      const launch = direct ?? links
        .map((link) => ({ link, path: seaZonePath(world, link.seaZoneId, fleet.targetSeaZoneId as string) }))
        .filter((item): item is { link: PortLinkState; path: string[] } => Boolean(item.path))
        .sort((left, right) => left.path.length - right.path.length || stableCompare(left.link.id, right.link.id))[0]?.link;
      if (!launch) continue;
      fleet.portRegionId = null;
      fleet.seaZoneId = launch.seaZoneId;
      fleet.lastMovedTurn = world.turn;
      continue;
    }
    if (!fleet.seaZoneId || fleet.seaZoneId === fleet.targetSeaZoneId) continue;
    const path = seaZonePath(world, fleet.seaZoneId, fleet.targetSeaZoneId);
    if (path && path.length >= 2) {
      fleet.seaZoneId = path[1] as string;
      fleet.lastMovedTurn = world.turn;
      fleet.readiness = Math.round(clamp(fleet.readiness - 2));
    }
  }
}

function maintainFleets(world: WorldState, context: V03TurnContext, emit: V03Emit): void {
  for (const fleet of [...world.fleets].sort((a, b) => stableCompare(a.id, b.id))) {
    const polity = world.polities.find((item) => item.id === fleet.polityId && item.alive);
    if (!polity) continue;
    if (fleet.portRegionId) {
      const portRegion = world.regions.find((region) => region.id === fleet.portRegionId && region.controllerId === fleet.polityId);
      if (portRegion) {
        const transfer = Math.min(portRegion.food, Math.max(0, fleet.sailors * 2 - fleet.food));
        portRegion.food -= transfer;
        fleet.food += transfer;
        context.food.transferred += transfer;
        const port = world.ports.find((item) => item.regionId === portRegion.id);
        const repair = Math.min(fleet.repairNeed, port?.repair ?? 0);
        fleet.repairNeed = whole(fleet.repairNeed - repair);
        fleet.readiness = Math.round(clamp(fleet.readiness + 3 + repair * 0.08));
      }
    }
    const foodNeed = fleet.sailors;
    const consumed = Math.min(fleet.food, foodNeed);
    fleet.food -= consumed;
    context.food.armyConsumed += consumed;
    if (consumed < foodNeed) {
      fleet.readiness = Math.round(clamp(fleet.readiness - 8 - (foodNeed - consumed) / Math.max(1, foodNeed) * 20));
      fleet.morale = Math.round(clamp(fleet.morale - 7));
    } else {
      fleet.readiness = Math.round(clamp(fleet.readiness + (fleet.portRegionId ? 2 : -1)));
      fleet.morale = Math.round(clamp(fleet.morale + 1));
    }
    const wage = whole(fleet.sailors * 0.08);
    const paid = Math.min(polity.treasury, wage);
    polity.treasury -= paid;
    const home = world.regions.find((region) => region.id === fleet.homePortRegionId);
    if (home) home.wealth += paid;
    context.wealth.militaryPayments += paid;
    polity.navalBudget = whole(polity.navalBudget * 0.88 + paid);

    if (fleet.seaZoneId) {
      const zone = world.seaZones.find((item) => item.id === fleet.seaZoneId);
      if (zone) {
        const stormExposure = zone.stormRisk * (1 - fleet.readiness / 180)
          * (1 - practiceEffect(world, fleet.homePortRegionId, 'sea-risk'));
        if (keyedRandom(world.seed, world.turn, 'fleet-storm', fleet.id, zone.id) * 100 < stormExposure * 0.06) {
          const shipPool: Array<'patrolShips' | 'transports' | 'warships'> = ['patrolShips', 'transports', 'warships'];
          const shipField = shipPool.find((field) => fleet[field] > 0);
          if (shipField) {
            fleet[shipField] -= 1;
            const deaths = Math.min(fleet.sailors, shipField === 'warships' ? 45 : shipField === 'transports' ? 28 : 20);
            fleet.sailors -= deaths;
            context.population.militaryDeaths += deaths;
            context.maritime.shipsLost += 1;
            fleet.repairNeed = Math.round(clamp(fleet.repairNeed + 12));
            emit({
              category: '海洋',
              kind: 'fleet_storm_loss',
              title: `${fleet.name}遭遇风浪`,
              summary: `${fleet.name}在${zone.name}因海况与战备不足损失一艘船、${deaths}名水手。`,
              importance: 2,
              actorIds: [fleet.commanderId],
              polityIds: [fleet.polityId],
              regionIds: [],
              causes: [
                { label: '海域风浪', role: '结构', weight: 0.45, evidence: `${zone.name}风暴风险${zone.stormRisk}`, refs: [{ kind: 'entity', entityType: 'seaZone', entityId: zone.id, field: 'stormRisk', label: '海况' }] },
                { label: '舰队战备', role: '条件', weight: 0.3, evidence: `战备${fleet.readiness}`, refs: [{ kind: 'entity', entityType: 'fleet', entityId: fleet.id, field: 'readiness', label: '舰队战备' }] },
                { label: '实际损失', role: '结果', weight: 0.25, evidence: `损失1船、${deaths}名水手` },
              ],
              stateDeltas: [{ entityType: 'fleet', entityId: fleet.id, field: shipField, before: fleet[shipField] + 1, after: fleet[shipField], delta: -1 }],
            });
          }
        }
      }
    }
  }
}

function updateSeaPower(world: WorldState, context: V03TurnContext): void {
  const profile = getMapProfileForContentVersion(world.mapContentVersion);
  for (const zone of world.seaZones) {
    const definition = profile.simulation.seaZones.find((item) => item.id === zone.id);
    const seasonal = context.season === '夏' && zone.climate === '季风海' ? 10
      : context.season === '冬' && zone.climate === '北方海' ? 7
        : context.season === '秋' && zone.climate === '外洋' ? 8 : 0;
    const noise = (keyedRandom(world.seed, context.turn, 'sea-weather', zone.id) - 0.5) * 14;
    zone.stormRisk = Math.round(clamp((definition?.stormRisk ?? zone.stormRisk) + seasonal + noise));
    zone.piracy = Math.round(clamp(zone.piracy * 0.94 + Math.min(10, zone.traffic / 8_000) - (zone.controllerId ? 1.5 : 0)));
    const power: Record<string, number> = {};
    for (const fleet of world.fleets.filter((item) => item.seaZoneId === zone.id)) {
      const raw = (fleet.warships * 90 + fleet.patrolShips * 48 + fleet.transports * 18)
        * (0.35 + fleet.readiness / 160 + fleet.training / 260);
      power[fleet.polityId] = Math.round((power[fleet.polityId] ?? 0) + raw);
    }
    zone.powerByPolity = power;
    const ranked = Object.entries(power).sort((left, right) => right[1] - left[1] || stableCompare(left[0], right[0]));
    const total = ranked.reduce((sum, item) => sum + item[1], 0);
    const topShare = total > 0 ? (ranked[0]?.[1] ?? 0) / total * 100 : 0;
    const secondShare = total > 0 ? (ranked[1]?.[1] ?? 0) / total * 100 : 0;
    zone.controllerId = topShare >= 55 ? ranked[0]?.[0] ?? null : null;
    zone.contested = ranked.length > 1 && (topShare < 55 || topShare - secondShare < 20);
  }
}

function updateBlockades(world: WorldState, context: V03TurnContext, emit: V03Emit): void {
  for (const port of world.ports) {
    const region = world.regions.find((item) => item.id === port.regionId);
    if (!region) continue;
    const before = port.blockadePressure;
    let qualifying: FleetState | null = null;
    for (const link of world.portLinks.filter((item) => item.regionId === port.regionId)) {
      const zone = world.seaZones.find((item) => item.id === link.seaZoneId);
      if (!zone) continue;
      const total = Object.values(zone.powerByPolity).reduce((sum, value) => sum + value, 0);
      const fleets = world.fleets
        .filter((fleet) => fleet.seaZoneId === zone.id && fleet.mission === '封锁' && atWar(world, fleet.polityId, region.controllerId))
        .sort((left, right) => right.warships - left.warships || stableCompare(left.id, right.id));
      qualifying = fleets.find((fleet) => ((zone.powerByPolity[fleet.polityId] ?? 0) / Math.max(1, total) * 100) >= 65) ?? qualifying;
    }
    port.blockadePressure = qualifying
      ? Math.round(clamp(before * 0.35 + 72))
      : Math.round(clamp(before - 24));
    if (port.blockadePressure >= 55) context.maritime.blockadedPortIds.push(port.id);
    if (qualifying && before < 55 && port.blockadePressure >= 55) {
      emit({
        category: '海洋',
        kind: 'port_blockaded',
        title: `${region.name}遭到封锁`,
        summary: `${qualifying.name}凭相邻海域的实际优势持续压迫${region.name}港口，下一季吞吐将受限。`,
        importance: 4,
        actorIds: [qualifying.commanderId],
        polityIds: [qualifying.polityId, region.controllerId],
        regionIds: [region.id],
        causes: [
          { label: '敌对关系', role: '结构', weight: 0.22, evidence: `${qualifying.polityId}与${region.controllerId}处于战争`, refs: [{ kind: 'entity', entityType: 'fleet', entityId: qualifying.id, field: 'mission', label: '封锁任务' }] },
          { label: '真实海权投射', role: '条件', weight: 0.43, evidence: `${qualifying.name}所在海域控制份额不低于65%`, refs: [{ kind: 'entity', entityType: 'seaZone', entityId: qualifying.seaZoneId as string, field: 'powerByPolity', label: '海权投射' }] },
          { label: '港口压力', role: '结果', weight: 0.35, evidence: `${before}→${port.blockadePressure}`, refs: [{ kind: 'entity', entityType: 'port', entityId: port.id, field: 'blockadePressure', label: '封锁压力' }] },
        ],
        stateDeltas: [{ entityType: 'port', entityId: port.id, field: 'blockadePressure', before, after: port.blockadePressure, delta: port.blockadePressure - before }],
      });
    }
  }
}

function completeShipProject(world: WorldState, project: ShipbuildingProjectState, context: V03TurnContext, emit: V03Emit): void {
  const target = project.targetFleetId ? world.fleets.find((fleet) => fleet.id === project.targetFleetId) : undefined;
  if (target) {
    target.warships += project.warships;
    target.transports += project.transports;
    target.patrolShips += project.patrolShips;
    target.repairNeed = Math.round(clamp(target.repairNeed + 4));
  } else {
    const region = world.regions.find((item) => item.id === project.portRegionId && item.controllerId === project.polityId);
    if (region) createFleetAtPort(world, region, project);
  }
  project.status = '完成';
  project.completedTurn = world.turn;
  emit({
    category: '海洋',
    kind: 'shipbuilding_completed',
    title: `${world.regions.find((item) => item.id === project.portRegionId)?.name ?? '港口'}新舰下水`,
    summary: `船厂以已承诺的${project.timberCommitted}木材、${project.ironCommitted}铁器完成${project.warships + project.transports + project.patrolShips}艘船。`,
    importance: 3,
    actorIds: target ? [target.commanderId] : [],
    polityIds: [project.polityId],
    regionIds: [project.portRegionId],
    causes: [
      { label: '船厂能力', role: '结构', weight: 0.25, evidence: `${project.portRegionId}具备持续造船能力`, refs: [{ kind: 'entity', entityType: 'port', entityId: `port_${project.portRegionId.slice(2)}`, field: 'shipyard', label: '船厂' }] },
      { label: '实物投入', role: '条件', weight: 0.4, evidence: `木材${project.timberCommitted}、铁器${project.ironCommitted}、财政${project.treasurySpent}` },
      { label: '跨季进度', role: '触发', weight: 0.15, evidence: `进度${project.progress}` },
      { label: '船只批次', role: '结果', weight: 0.2, evidence: `战船${project.warships}、运输船${project.transports}、巡逻船${project.patrolShips}` },
    ],
    stateDeltas: target ? [
      { entityType: 'fleet', entityId: target.id, field: 'warships', before: target.warships - project.warships, after: target.warships, delta: project.warships },
    ] : [],
  });
  context.maritime.fleetIds = world.fleets.map((fleet) => fleet.id).sort(stableCompare);
}

function processShipbuilding(world: WorldState, context: V03TurnContext, emit: V03Emit): void {
  for (const project of world.shipbuildingProjects.filter((item) => item.status === '建造中')) {
    const polity = world.polities.find((item) => item.id === project.polityId);
    const portRegion = world.regions.find((item) => item.id === project.portRegionId);
    const targetFleet = project.targetFleetId
      ? world.fleets.find((fleet) => fleet.id === project.targetFleetId && fleet.polityId === project.polityId)
      : null;
    const lostAuthority = !polity?.alive || portRegion?.controllerId !== project.polityId;
    const lostTarget = Boolean(project.targetFleetId && !targetFleet);
    if (lostAuthority || lostTarget) {
      project.status = '取消';
      project.completedTurn = context.turn;
      emit({
        category: '海洋',
        kind: 'shipbuilding_cancelled',
        title: `${portRegion?.name ?? project.portRegionId}造船工程中止`,
        summary: `${lostAuthority ? '原政权已失去存续或船厂控制' : '承接扩编的舰队已经不存在'}，已投入的木材、铁器与工钱视为沉没成本，工程不再产生船只。`,
        importance: 2,
        polityIds: [project.polityId],
        regionIds: portRegion ? [portRegion.id] : [],
        causes: [
          { label: '既有工程', role: '结构', weight: 0.28, evidence: `工程${project.id}进度${project.progress}%`, refs: portRegion ? [{ kind: 'entity', entityType: 'region', entityId: portRegion.id, field: `shipbuilding:${project.id}`, label: '工程所在港区' }] : [] },
          { label: lostAuthority ? '统治中断' : '编制消失', role: '触发', weight: 0.42, evidence: lostAuthority ? `政权存续=${polity?.alive ?? false}，港口控制=${portRegion?.controllerId ?? '无'}` : `目标舰队${project.targetFleetId}已不存在` },
          { label: '工程中止', role: '结果', weight: 0.3, evidence: `状态建造中→取消；既有实物投入不返还` },
        ],
        stateDeltas: [{ entityType: 'region', entityId: project.portRegionId, field: `shipbuilding:${project.id}:status`, before: '建造中', after: '取消' }],
      });
      continue;
    }
    const port = world.ports.find((item) => item.regionId === project.portRegionId);
    project.progress = Math.round(clamp(project.progress + 21 + (port?.shipyard ?? 0) * 6));
    if (project.progress >= 100) completeShipProject(world, project, context, emit);
  }
  for (const polity of world.polities.filter((item) => item.alive).sort((a, b) => stableCompare(a.id, b.id))) {
    if (world.shipbuildingProjects.some((item) => item.polityId === polity.id && item.status === '建造中')) continue;
    const ports = world.ports
      .map((port) => ({ port, region: world.regions.find((region) => region.id === port.regionId && region.controllerId === polity.id) }))
      .filter((item): item is { port: PortState; region: RegionState } => Boolean(item.region && item.port.shipyard > 0))
      .sort((left, right) => right.port.shipyard - left.port.shipyard || stableCompare(left.port.id, right.port.id));
    const selected = ports[0];
    if (!selected) continue;
    const fleetShips = world.fleets.filter((fleet) => fleet.polityId === polity.id)
      .reduce((sum, fleet) => sum + fleet.warships + fleet.transports + fleet.patrolShips, 0);
    const desired = ports.length * 10 + selected.port.level * 5;
    if (fleetShips >= desired) continue;
    const warships = selected.port.shipyard >= 2 ? 2 : 1;
    const transports = 2;
    const patrolShips = 2;
    const timber = warships * 70 + transports * 45 + patrolShips * 30;
    const iron = warships * 34 + transports * 14 + patrolShips * 10;
    const cost = warships * 150 + transports * 85 + patrolShips * 65;
    if (selected.region.goods.木材 < timber || selected.region.goods.铁器 < iron || polity.treasury < cost) continue;
    selected.region.goods.木材 -= timber;
    selected.region.goods.铁器 -= iron;
    polity.treasury -= cost;
    selected.region.wealth += cost;
    addLedger(context.trade.consumed, '木材', timber);
    addLedger(context.trade.consumed, '铁器', iron);
    context.wealth.militaryPayments += cost;
    world.counters.shipProject += 1;
    world.shipbuildingProjects.push({
      id: `shipproject_${String(world.counters.shipProject).padStart(5, '0')}`,
      polityId: polity.id,
      portRegionId: selected.region.id,
      targetFleetId: world.fleets.filter((fleet) => fleet.polityId === polity.id)
        .sort((a, b) => (a.warships + a.transports + a.patrolShips) - (b.warships + b.transports + b.patrolShips) || stableCompare(a.id, b.id))[0]?.id ?? null,
      warships,
      transports,
      patrolShips,
      timberCommitted: timber,
      ironCommitted: iron,
      treasurySpent: cost,
      progress: 0,
      startedTurn: world.turn,
      completedTurn: null,
      status: '建造中',
    });
  }
}

function resolveLanding(world: WorldState, operation: NavalOperationState, context: V03TurnContext, emit: V03Emit): void {
  const army = world.armies.find((item) => item.id === operation.armyId);
  const target = world.regions.find((item) => item.id === operation.targetRegionId);
  const war = world.wars.find((item) => item.id === operation.warId && item.active);
  if (!army || !target || !war) {
    operation.stage = '失败';
    operation.completedTurn = world.turn;
    if (army) army.embarkedOperationId = null;
    return;
  }
  const fleetPower = operation.fleetIds
    .map((id) => world.fleets.find((fleet) => fleet.id === id))
    .filter((fleet): fleet is FleetState => Boolean(fleet))
    .reduce((sum, fleet) => sum + fleet.warships * 85 + fleet.transports * 24, 0);
  const defenders = world.armies.filter((item) => item.polityId === target.controllerId && item.regionId === target.id);
  const attackPower = army.soldiers * (0.55 + army.morale / 240 + army.training / 360) + fleetPower;
  const defensePower = defenders.reduce((sum, item) => sum + item.soldiers * (0.6 + item.morale / 230 + item.training / 340), 0)
    + Math.min(7_000, target.population * 0.012) * (0.65 + target.defense / 160);
  const variance = 0.9 + keyedRandom(world.seed, world.turn, 'landing', operation.id) * 0.2;
  const won = attackPower * variance > defensePower;
  const soldiersBefore = army.soldiers;
  const moraleBefore = army.morale;
  const defenderSnapshots = defenders.map((defender) => ({
    armyId: defender.id,
    polityId: defender.polityId,
    commanderId: defender.commanderId,
    deputyCommanderId: defender.deputyCommanderId,
    soldiersBefore: defender.soldiers,
    soldiersAfter: defender.soldiers,
    moraleBefore: defender.morale,
    moraleAfter: defender.morale,
    trainingBefore: defender.training,
    supplyBefore: defender.supply,
    losses: 0,
  }));
  const losses = Math.min(army.soldiers - 1, whole(army.soldiers * (won ? 0.08 : 0.27)));
  army.soldiers -= losses;
  context.population.militaryDeaths += losses;
  const militiaLoss = Math.min(target.population, whole(Math.min(7_000, target.population * 0.012) * (won ? 0.18 : 0.08)));
  target.population -= militiaLoss;
  context.population.civilianDeaths += militiaLoss;
  const previousController = target.controllerId;
  const battleFact = emitSimulationFact(world, context, {
    kind: 'battle',
    category: '海洋',
    importance: 4,
    actorIds: [
      army.commanderId,
      ...(army.deputyCommanderId ? [army.deputyCommanderId] : []),
      ...defenders.flatMap((defender) => [defender.commanderId, ...(defender.deputyCommanderId ? [defender.deputyCommanderId] : [])]),
    ],
    polityIds: [army.polityId, previousController],
    regionIds: [operation.originRegionId, target.id],
    causes: [
      { label: '舰队运输', role: '结构', weight: 0.2, evidence: `参与舰队${operation.fleetIds.length}支` },
      { label: '沿途海权', role: '条件', weight: 0.24, evidence: `航路${operation.seaZonePath.join('→')}` },
      { label: '攻防实力', role: '条件', weight: 0.31, evidence: `攻方${Math.round(attackPower * variance)}、守方${Math.round(defensePower)}` },
      { label: '登陆结算', role: '结果', weight: 0.25, evidence: `攻方损失${losses}，民兵损失${militiaLoss}` },
    ],
    stateDeltas: [{ entityType: 'army', entityId: army.id, field: 'soldiers', before: soldiersBefore, after: army.soldiers, delta: -losses }],
    sourceFactIds: [],
    payload: {
      warId: war.id,
      targetRegionId: target.id,
      routeId: `naval-operation:${operation.id}`,
      attackerWon: won,
      attackerPower: attackPower * variance,
      defenderPower: defensePower,
      militiaLosses: militiaLoss,
      attacker: {
        armyId: army.id,
        polityId: army.polityId,
        commanderId: army.commanderId,
        deputyCommanderId: army.deputyCommanderId,
        soldiersBefore,
        soldiersAfter: army.soldiers,
        moraleBefore,
        moraleAfter: army.morale,
        trainingBefore: army.training,
        supplyBefore: army.supply,
        losses,
      },
      defenders: defenderSnapshots,
    },
  }) as BattleFact;
  let territoryFact: SimulationFact | null = null;
  if (won) {
    target.controllerId = army.polityId;
    territoryFact = emitSimulationFact(world, context, {
      kind: 'territory_control_changed',
      category: '海洋',
      importance: 4,
      actorIds: [army.commanderId],
      polityIds: [army.polityId, previousController],
      regionIds: [target.id],
      causes: [
        { label: '登陆胜利', role: '触发', weight: 0.68, evidence: `${battleFact.id}确认登陆军建立滩头` },
        { label: '港岸接管', role: '结果', weight: 0.32, evidence: `${target.name}控制权转入${army.polityId}` },
      ],
      stateDeltas: [{ entityType: 'region', entityId: target.id, field: 'controllerId', before: previousController, after: army.polityId }],
      sourceFactIds: [battleFact.id],
      payload: {
        regionId: target.id,
        previousControllerId: previousController,
        nextControllerId: army.polityId,
        reason: 'amphibious_landing',
        warId: war.id,
      },
    });
    army.regionId = target.id;
    army.food += operation.foodLoaded;
    operation.foodLoaded = 0;
    operation.stage = '滩头';
    const attacker = world.polities.find((polity) => polity.id === army.polityId);
    const defender = world.polities.find((polity) => polity.id === previousController);
    if (attacker && !attacker.controlledRegionIds.includes(target.id)) attacker.controlledRegionIds.push(target.id);
    if (defender) defender.controlledRegionIds = defender.controlledRegionIds.filter((id) => id !== target.id);
  } else {
    army.regionId = operation.originRegionId;
    const returnedFood = whole(operation.foodLoaded * 0.55);
    army.food += returnedFood;
    context.food.warDestroyed += operation.foodLoaded - returnedFood;
    operation.foodLoaded = 0;
    operation.stage = '失败';
    operation.completedTurn = world.turn;
    army.embarkedOperationId = null;
  }
  emit({
    category: '海洋',
    kind: won ? 'amphibious_landing_succeeded' : 'amphibious_landing_failed',
    title: `${target.name}登陆${won ? '成功' : '受挫'}`,
    summary: `${army.name}在舰队运输与海权掩护下投入${soldiersBefore}人，损失${losses}，${won ? '建立滩头并夺取区域控制' : '未能突破守备而撤回'}。`,
    importance: 4,
    actorIds: [army.commanderId, ...operation.fleetIds.map((id) => world.fleets.find((fleet) => fleet.id === id)?.commanderId).filter((id): id is string => Boolean(id))],
    polityIds: [army.polityId, previousController],
    regionIds: [operation.originRegionId, target.id],
    causes: [
      { label: '运输吨位', role: '结构', weight: 0.2, evidence: `参与舰队${operation.fleetIds.length}支`, refs: operation.fleetIds.map((id) => ({ kind: 'entity' as const, entityType: 'fleet' as const, entityId: id, label: '参战舰队' })) },
      { label: '沿途海权', role: '条件', weight: 0.24, evidence: `航路${operation.seaZonePath.join('→')}`, refs: operation.seaZonePath.map((id) => ({ kind: 'entity' as const, entityType: 'seaZone' as const, entityId: id, label: '登陆航路' })) },
      { label: '攻防实力', role: '条件', weight: 0.31, evidence: `攻方${Math.round(attackPower)}、守方${Math.round(defensePower)}` },
      { label: '登陆结果', role: '结果', weight: 0.25, evidence: `攻方损失${losses}，民兵损失${militiaLoss}` },
    ],
    stateDeltas: [
      { entityType: 'army', entityId: army.id, field: 'soldiers', before: soldiersBefore, after: army.soldiers, delta: -losses },
      ...(won ? [{ entityType: 'region' as const, entityId: target.id, field: 'controllerId', before: previousController, after: army.polityId }] : []),
      { entityType: 'navalOperation', entityId: operation.id, field: 'stage', before: '登陆', after: operation.stage },
    ],
    ...projectFactLinks(territoryFact ? [battleFact, territoryFact] : battleFact),
  });
}

function advanceNavalOperations(world: WorldState, context: V03TurnContext, emit: V03Emit): void {
  for (const operation of world.navalOperations.filter((item) => item.stage !== '完成' && item.stage !== '失败')) {
    const army = world.armies.find((item) => item.id === operation.armyId);
    const war = world.wars.find((item) => item.id === operation.warId);
    const assignedFleets = operation.fleetIds
      .map((id) => world.fleets.find((fleet) => fleet.id === id))
      .filter((fleet): fleet is FleetState => Boolean(fleet));
    const validFleets = army
      ? assignedFleets.length === operation.fleetIds.length
        && assignedFleets.every((fleet) => fleet.polityId === army.polityId)
      : false;
    const validWar = Boolean(war?.active && army
      && (war.attackerId === army.polityId || war.defenderId === army.polityId));
    if (!army || !validFleets || !validWar) {
      const origin = world.regions.find((item) => item.id === operation.originRegionId);
      const foodBefore = operation.foodLoaded;
      const stageBefore = operation.stage;
      if (origin) {
        origin.food += operation.foodLoaded;
        context.food.transferred += operation.foodLoaded;
      } else {
        context.food.warDestroyed += operation.foodLoaded;
      }
      operation.foodLoaded = 0;
      operation.stage = '失败';
      operation.completedTurn = world.turn;
      if (army) army.embarkedOperationId = null;
      emit({
        category: '海洋',
        kind: 'naval_operation_aborted',
        title: `${origin?.name ?? operation.originRegionId}远征中止`,
        summary: `登陆行动${operation.id}因${!army ? '陆军编制消失' : !validWar ? '战争依据终止' : '承担运输或护航的舰队失效'}而中止，装载粮${foodBefore}已${origin ? '退回出发地' : '计入毁损'}。`,
        importance: 2,
        actorIds: army?.commanderId ? [army.commanderId] : [],
        polityIds: army ? [army.polityId] : [],
        regionIds: origin ? [origin.id] : [],
        causes: [
          { label: '跨季行动', role: '结构', weight: 0.28, evidence: `${operation.id}原阶段${stageBefore}`, refs: origin ? [{ kind: 'entity', entityType: 'region', entityId: origin.id, field: `naval-operation:${operation.id}`, label: '远征出发地' }] : [] },
          { label: '必要条件失效', role: '触发', weight: 0.43, evidence: `陆军=${Boolean(army)}、战争有效=${validWar}、舰队完整=${validFleets}` },
          { label: '取消结算', role: '结果', weight: 0.29, evidence: `行动失败，粮食${foodBefore}${origin ? '退回' : '毁损'}` },
        ],
        stateDeltas: [{ entityType: 'navalOperation', entityId: operation.id, field: 'stage', before: stageBefore, after: '失败' }],
      });
      continue;
    }
    if (operation.stage === '集结') {
      operation.progress = Math.min(100, operation.progress + 45);
      if (operation.progress >= 40) operation.stage = '装载';
    } else if (operation.stage === '装载') {
      const path = maritimePathBetweenPorts(world, operation.originRegionId, operation.targetRegionId);
      const fleet = operation.fleetIds.map((id) => world.fleets.find((item) => item.id === id)).find((item): item is FleetState => Boolean(item));
      if (!path || !fleet) {
        const origin = world.regions.find((item) => item.id === operation.originRegionId);
        if (origin) {
          origin.food += operation.foodLoaded;
          context.food.transferred += operation.foodLoaded;
        } else {
          context.food.warDestroyed += operation.foodLoaded;
        }
        operation.foodLoaded = 0;
        operation.stage = '失败';
        operation.completedTurn = world.turn;
        army.embarkedOperationId = null;
        continue;
      }
      const portUsage = new Map<string, number>();
      for (const usage of context.logistics.seaUsage) {
        const link = world.portLinks.find((item) => item.id === usage.edgeId);
        if (link) portUsage.set(link.regionId, (portUsage.get(link.regionId) ?? 0) + usage.reserved);
      }
      const flowId = createShipmentId(world);
      const capacityNeed = whole(army.soldiers);
      const accepted = reservePath(world, context, path, capacityNeed, flowId, portUsage);
      if (accepted < capacityNeed) {
        releasePath(context, path, accepted, flowId, portUsage);
        continue;
      }
      const month = (world.counters.shipment % 3) as 0 | 1 | 2;
      recordShipment(world, context, {
        id: flowId,
        kind: '海军运输',
        commodity: null,
        originRegionId: operation.originRegionId,
        destinationRegionId: operation.targetRegionId,
        acceptedAmount: accepted,
        deliveredAmount: accepted,
        lostAmount: 0,
        raidedAmount: 0,
        peopleDeparted: army.soldiers,
        peopleArrived: army.soldiers,
        peopleLost: 0,
        contactVolume: army.soldiers,
        legs: legRecords(path, accepted, month),
        carrierArmyId: army.id,
        carrierFleetId: fleet.id,
        value: 0,
        tariff: 0,
        status: '交付',
      });
      operation.stage = '航行';
      operation.progress = 55;
    } else if (operation.stage === '航行') {
      const shares = operation.seaZonePath.map((zoneId) => {
        const zone = world.seaZones.find((item) => item.id === zoneId);
        const total = Object.values(zone?.powerByPolity ?? {}).reduce((sum, value) => sum + value, 0);
        return (zone?.powerByPolity[army.polityId] ?? 0) / Math.max(1, total) * 100;
      });
      if (shares.every((share) => share >= 45)) {
        operation.stage = '登陆';
        operation.progress = 85;
      } else if (world.turn - operation.startedTurn >= 8) {
        operation.stage = '失败';
        operation.completedTurn = world.turn;
        army.embarkedOperationId = null;
        const origin = world.regions.find((item) => item.id === operation.originRegionId);
        if (origin) origin.food += operation.foodLoaded;
        context.food.transferred += operation.foodLoaded;
        operation.foodLoaded = 0;
      }
    } else if (operation.stage === '登陆') {
      resolveLanding(world, operation, context, emit);
    } else if (operation.stage === '滩头') {
      operation.stage = '完成';
      operation.progress = 100;
      operation.completedTurn = world.turn;
      army.embarkedOperationId = null;
    }
  }
}

function maybeCreateLandingOperation(world: WorldState, context: V03TurnContext, emit: V03Emit): void {
  if (world.navalOperations.some((operation) => operation.stage !== '完成' && operation.stage !== '失败')) return;
  for (const war of world.wars.filter((item) => item.active).sort((a, b) => stableCompare(a.id, b.id))) {
    for (const attackerId of [war.attackerId, war.defenderId]) {
      const defenderId = attackerId === war.attackerId ? war.defenderId : war.attackerId;
      const originArmies = world.armies
        .filter((army) => army.polityId === attackerId && !army.embarkedOperationId && world.regions.some((region) => region.id === army.regionId && region.port && region.controllerId === attackerId))
        .sort((left, right) => right.soldiers - left.soldiers || stableCompare(left.id, right.id));
      for (const army of originArmies) {
        const fleet = world.fleets
          .filter((item) => item.polityId === attackerId && item.homePortRegionId === army.regionId && item.transports * 1_000 >= army.soldiers)
          .sort((left, right) => right.transports - left.transports || stableCompare(left.id, right.id))[0];
        if (!fleet) continue;
        const targets = world.regions
          .filter((region) => region.controllerId === defenderId && region.port)
          .map((region) => ({ region, path: maritimePathBetweenPorts(world, army.regionId, region.id) }))
          .filter((item): item is { region: RegionState; path: TransportPath } => Boolean(item.path && item.path.edges.some((edge) => edge.kind === 'sea-lane')))
          .sort((left, right) => right.region.strategicValue - left.region.strategicValue || stableCompare(left.region.id, right.region.id));
        const target = targets[0];
        if (!target) continue;
        const seaIds: string[] = [];
        for (const edge of target.path.edges.filter((item) => item.kind === 'sea-lane')) {
          if (!seaIds.includes(edge.from)) seaIds.push(edge.from);
          if (!seaIds.includes(edge.to)) seaIds.push(edge.to);
        }
        const origin = world.regions.find((region) => region.id === army.regionId) as RegionState;
        const foodLoaded = Math.min(origin.food, army.soldiers);
        if (foodLoaded < army.soldiers * 0.65) continue;
        origin.food -= foodLoaded;
        context.food.transferred += foodLoaded;
        world.counters.navalOperation += 1;
        const operation: NavalOperationState = {
          id: `navop_${String(world.counters.navalOperation).padStart(5, '0')}`,
          warId: war.id,
          armyId: army.id,
          fleetIds: [fleet.id],
          originRegionId: origin.id,
          targetRegionId: target.region.id,
          seaZonePath: seaIds,
          stage: '集结',
          startedTurn: world.turn,
          progress: 0,
          foodLoaded,
          completedTurn: null,
        };
        army.embarkedOperationId = operation.id;
        fleet.mission = '登陆';
        fleet.targetRegionId = target.region.id;
        fleet.targetSeaZoneId = seaIds.at(-1) ?? null;
        world.navalOperations.push(operation);
        context.maritime.landingOperationIds.push(operation.id);
        emit({
          category: '海洋',
          kind: 'amphibious_operation_prepared',
          title: `${army.name}筹备渡海`,
          summary: `${army.name}在${origin.name}集结，${fleet.name}提供运输吨位，并预装${foodLoaded}军粮准备进攻${target.region.name}。`,
          importance: 3,
          actorIds: [army.commanderId, fleet.commanderId],
          polityIds: [attackerId, defenderId],
          regionIds: [origin.id, target.region.id],
          causes: [
            { label: '战争目标', role: '结构', weight: 0.2, evidence: `${war.reason}使${target.region.name}成为跨海目标`, refs: [{ kind: 'entity', entityType: 'war', entityId: war.id, label: '活动战争' }] },
            { label: '运输吨位', role: '条件', weight: 0.3, evidence: `${fleet.transports}艘运输船可承载${fleet.transports * 1_000}人`, refs: [{ kind: 'entity', entityType: 'fleet', entityId: fleet.id, field: 'transports', label: '运输船' }] },
            { label: '军粮预装', role: '条件', weight: 0.25, evidence: `${foodLoaded}军粮已从${origin.name}转入行动账户` },
            { label: '行动建立', role: '结果', weight: 0.25, evidence: `${operation.id}进入集结阶段` },
          ],
          stateDeltas: [{ entityType: 'navalOperation', entityId: operation.id, field: 'stage', before: null, after: '集结' }],
        });
        return;
      }
    }
  }
}

/** Fleet upkeep, sea power, blockade, shipbuilding and bounded landings. */
export function processV03Maritime(world: WorldState, context: V03TurnContext, emit: V03Emit): void {
  repairFleets(world, context, emit);
  context.maritime.fleetIds = world.fleets.map((fleet) => fleet.id).sort(stableCompare);
  chooseFleetMissions(world);
  moveFleets(world);
  maintainFleets(world, context, emit);
  updateSeaPower(world, context);
  updateBlockades(world, context, emit);
  processShipbuilding(world, context, emit);
  advanceNavalOperations(world, context, emit);
  maybeCreateLandingOperation(world, context, emit);
}
