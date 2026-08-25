import { describe, expect, it } from 'vitest';

import {
  COMMODITIES,
  advanceWorld,
  advanceWorldBy,
  createWorld,
  serializeWorld,
  validateWorld,
  type CommodityKind,
  type HistoryEvent,
  type ShipmentRecord,
  type WorldState,
} from './index';
import { processV03Disease, processV03Knowledge } from './v03-life';
import type { V03Emit, V03TurnContext } from './v03-context';

function totalPopulation(world: WorldState): number {
  return world.regions.reduce((sum, region) => sum + region.population, 0)
    + world.armies.reduce((sum, army) => sum + army.soldiers, 0)
    + world.fleets.reduce((sum, fleet) => sum + fleet.sailors, 0);
}

function totalFood(world: WorldState): number {
  return world.regions.reduce((sum, region) => sum + region.food, 0)
    + world.armies.reduce((sum, army) => sum + army.food, 0)
    + world.fleets.reduce((sum, fleet) => sum + fleet.food, 0)
    + world.navalOperations
      .filter((operation) => operation.stage !== '完成' && operation.stage !== '失败')
      .reduce((sum, operation) => sum + operation.foodLoaded, 0);
}

function totalWealth(world: WorldState): number {
  return world.regions.reduce((sum, region) => sum + region.wealth, 0)
    + world.polities.reduce((sum, polity) => sum + polity.treasury, 0);
}

function totalCommodity(world: WorldState, commodity: CommodityKind): number {
  if (commodity === '粮食') return totalFood(world);
  return world.regions.reduce((sum, region) => sum + region.goods[commodity], 0);
}

function emptyContext(world: WorldState): V03TurnContext {
  return {
    turn: world.turn,
    year: world.year,
    season: world.season,
    events: [],
    population: {
      start: totalPopulation(world), births: 0, civilianDeaths: 0, militaryDeaths: 0,
      recruited: 0, demobilized: 0, end: 0,
    },
    food: {
      start: totalFood(world), produced: 0, civilianConsumed: 0, armyConsumed: 0,
      spoiled: 0, warDestroyed: 0, transferred: 0, end: 0,
    },
    wealth: {
      start: totalWealth(world), produced: 0, householdConsumed: 0, warDestroyed: 0,
      taxed: 0, militaryPayments: 0, end: 0,
    },
    logistics: { remoteFoodTransferred: 0, routeUsage: [], seaUsage: [] },
    trade: {
      shipments: [],
      stockStart: { 木材: 0, 铁器: 0, 马匹: 0, 盐: 0, 纺织品: 0, 奢侈品: 0 },
      stockEnd: { 木材: 0, 铁器: 0, 马匹: 0, 盐: 0, 纺织品: 0, 奢侈品: 0 },
      produced: {}, consumed: {}, lost: {}, valueTransferred: 0, tariffsTransferred: 0,
    },
    migration: { departed: 0, arrived: 0, travelDeaths: 0, settled: 0, flowIds: [] },
    health: {
      infectiousStart: 0, newExposures: 0, importedExposures: 0, civilianDeaths: 0,
      militaryDeaths: 0, infectiousEnd: 0, outbreakRegionIds: [],
    },
    knowledge: { prototypeIds: [], adoptedIds: [], spreadIds: [], lostIds: [] },
    maritime: { fleetIds: [], blockadedPortIds: [], raidedShipmentIds: [], landingOperationIds: [], shipsLost: 0 },
    routeCapacityReserved: {},
    seaCapacityReserved: {},
    commodityStart: Object.fromEntries(COMMODITIES.map((commodity) => [commodity, totalCommodity(world, commodity)])),
  };
}

function testEmitter(context: V03TurnContext): V03Emit {
  return (input): HistoryEvent => {
    const event: HistoryEvent = {
      id: `test_event_${context.events.length + 1}`,
      turn: context.turn,
      year: context.year,
      season: context.season,
      category: input.category,
      kind: input.kind,
      title: input.title,
      summary: input.summary,
      importance: input.importance,
      actorIds: input.actorIds ?? [],
      polityIds: input.polityIds ?? [],
      regionIds: input.regionIds ?? [],
      causes: input.causes,
      evidence: input.evidence ?? [],
      stateDeltas: input.stateDeltas ?? [],
    };
    context.events.push(event);
    return event;
  };
}

function deliveredShipment(
  id: string,
  originRegionId: string,
  destinationRegionId: string,
  edgeId: string,
  amount = 2_000,
): ShipmentRecord {
  return {
    id,
    kind: '贸易',
    commodity: '盐',
    originRegionId,
    destinationRegionId,
    acceptedAmount: amount,
    deliveredAmount: amount,
    lostAmount: 0,
    raidedAmount: 0,
    peopleDeparted: 0,
    peopleArrived: 0,
    peopleLost: 0,
    contactVolume: amount,
    legs: [{ kind: 'route', edgeId, month: 0, capacityUsed: amount }],
    carrierArmyId: null,
    carrierFleetId: null,
    value: 100,
    tariff: 2,
    status: '交付',
  };
}

function expectCompositeReachability(world: WorldState): void {
  const adjacency = new Map<string, Set<string>>();
  const link = (left: string, right: string): void => {
    if (!adjacency.has(left)) adjacency.set(left, new Set());
    if (!adjacency.has(right)) adjacency.set(right, new Set());
    adjacency.get(left)?.add(right);
    adjacency.get(right)?.add(left);
  };
  for (const region of world.regions) adjacency.set(region.id, new Set());
  for (const zone of world.seaZones) adjacency.set(zone.id, new Set());
  for (const route of world.routes) link(route.fromRegionId, route.toRegionId);
  for (const lane of world.seaLanes) link(lane.fromSeaZoneId, lane.toSeaZoneId);
  for (const portLink of world.portLinks) link(portLink.regionId, portLink.seaZoneId);

  const visited = new Set<string>();
  const queue = [world.regions[0]?.id ?? ''];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (!id || visited.has(id)) continue;
    visited.add(id);
    for (const neighbor of adjacency.get(id) ?? []) if (!visited.has(neighbor)) queue.push(neighbor);
  }
  expect(visited.size).toBe(world.regions.length + world.seaZones.length);
}

describe('V0.3 maritime, flow, disease and knowledge contracts', () => {
  it('connects the whole map through land routes, ports, sea lanes and sea zones', () => {
    const world = createWorld('山海综合可达');
    expect(world.routes.every((route) => route.kind !== '海峡')).toBe(true);
    expectCompositeReachability(world);
    expect(validateWorld(world)).toEqual([]);
  });

  it('stays exactly deterministic across ocean, disease, migration and knowledge ticks', () => {
    const left = advanceWorldBy(createWorld('山海同源'), 32);
    const right = advanceWorldBy(createWorld('山海同源'), 32);
    expect(left.hash).toBe(right.hash);
    expect(serializeWorld(left)).toBe(serializeWorld(right));
    expect(validateWorld(left)).toEqual([]);
  }, 30_000);

  it('balances population, food, wealth, goods, migration and shared transport capacity every quarter', () => {
    let world = createWorld('季度六账');
    for (let quarter = 0; quarter < 16; quarter += 1) {
      const commodityBefore = Object.fromEntries(
        COMMODITIES.map((commodity) => [commodity, totalCommodity(world, commodity)]),
      ) as Record<CommodityKind, number>;
      const next = advanceWorld(world);
      const report = next.lastTurn;
      expect(report).not.toBeNull();
      if (!report) return;

      expect(report.population.end).toBe(
        report.population.start + report.population.births
          - report.population.civilianDeaths - report.population.militaryDeaths,
      );
      expect(report.food.end).toBe(
        report.food.start + report.food.produced - report.food.civilianConsumed
          - report.food.armyConsumed - report.food.spoiled - report.food.warDestroyed,
      );
      expect(report.wealth.end).toBe(
        report.wealth.start + report.wealth.produced
          - report.wealth.householdConsumed - report.wealth.warDestroyed,
      );
      expect(report.migration.departed).toBe(report.migration.arrived + report.migration.travelDeaths);
      expect(report.migration.flowIds).toEqual(
        report.trade.shipments.filter((shipment) => shipment.kind === '迁徙').map((shipment) => shipment.id),
      );

      for (const commodity of COMMODITIES.filter((item) => item !== '粮食')) {
        expect(report.trade.stockStart[commodity]).toBe(commodityBefore[commodity]);
        expect(report.trade.stockEnd[commodity]).toBe(totalCommodity(next, commodity));
        expect(totalCommodity(next, commodity)).toBe(
          commodityBefore[commodity]
            + (report.trade.produced[commodity] ?? 0)
            - (report.trade.consumed[commodity] ?? 0)
            - (report.trade.lost[commodity] ?? 0),
        );
      }
      for (const shipment of report.trade.shipments) {
        expect(shipment.acceptedAmount).toBe(
          shipment.deliveredAmount + shipment.lostAmount + shipment.raidedAmount,
        );
        expect(shipment.peopleDeparted).toBe(shipment.peopleArrived + shipment.peopleLost);
      }
      for (const usage of report.logistics.routeUsage) {
        expect(usage.reserved).toBeGreaterThanOrEqual(0);
        expect(usage.reserved).toBeLessThanOrEqual(usage.capacity);
      }
      for (const usage of report.logistics.seaUsage) {
        expect(usage.reserved).toBeGreaterThanOrEqual(0);
        expect(usage.reserved).toBeLessThanOrEqual(usage.capacity);
      }
      expect(validateWorld(next)).toEqual([]);
      world = next;
    }
  }, 30_000);

  it('does not transmit disease to a remote susceptible host without a delivered shipment', () => {
    const world = createWorld('无流不远传');
    const pathogen = world.pathogens[0];
    const sourceRegion = world.regions[0];
    const remoteRegion = world.regions.at(-1);
    expect(pathogen).toBeDefined();
    expect(sourceRegion).toBeDefined();
    expect(remoteRegion).toBeDefined();
    if (!pathogen || !sourceRegion || !remoteRegion) return;

    for (const infection of world.infections) {
      const hostSize = infection.hostKind === 'region'
        ? world.regions.find((region) => region.id === infection.hostId)?.population ?? 0
        : infection.hostKind === 'army'
          ? world.armies.find((army) => army.id === infection.hostId)?.soldiers ?? 0
          : world.fleets.find((fleet) => fleet.id === infection.hostId)?.sailors ?? 0;
      infection.susceptible = hostSize;
      infection.exposed = 0;
      infection.infectious = 0;
      infection.recovered = 0;
      infection.recentSources = [];
    }
    const source = world.infections.find((infection) => (
      infection.hostKind === 'region'
      && infection.hostId === sourceRegion.id
      && infection.pathogenId === pathogen.id
    ));
    const remote = world.infections.find((infection) => (
      infection.hostKind === 'region'
      && infection.hostId === remoteRegion.id
      && infection.pathogenId === pathogen.id
    ));
    expect(source).toBeDefined();
    expect(remote).toBeDefined();
    if (!source || !remote) return;
    source.infectious = Math.min(30_000, source.susceptible);
    source.susceptible -= source.infectious;

    const context = emptyContext(world);
    processV03Disease(world, context, testEmitter(context));
    expect(context.trade.shipments).toHaveLength(0);
    expect(context.health.importedExposures).toBe(0);
    expect(remote.exposed + remote.infectious).toBe(0);
    expect(remote.recentSources.some((item) => item.shipmentId !== null)).toBe(false);
  });

  it('uses a start-of-quarter practice snapshot, preventing same-quarter A-to-B-to-C knowledge hops', () => {
    const world = createWorld('知识逐季');
    const routeAB = world.routes.find((route) => route.fromRegionId === 'r_changan' && route.toRegionId === 'r_hedong'
      || route.toRegionId === 'r_changan' && route.fromRegionId === 'r_hedong');
    const routeBC = world.routes.find((route) => route.fromRegionId === 'r_hedong' && route.toRegionId === 'r_luoyang'
      || route.toRegionId === 'r_hedong' && route.fromRegionId === 'r_luoyang');
    const practice = world.practices.find((item) => item.category === '商业');
    expect(routeAB).toBeDefined();
    expect(routeBC).toBeDefined();
    expect(practice).toBeDefined();
    if (!routeAB || !routeBC || !practice) return;

    const source = world.practiceStates.find((state) => state.regionId === 'r_changan' && state.practiceId === practice.id);
    const middle = world.practiceStates.find((state) => state.regionId === 'r_hedong' && state.practiceId === practice.id);
    const destination = world.practiceStates.find((state) => state.regionId === 'r_luoyang' && state.practiceId === practice.id);
    expect(source).toBeDefined();
    expect(middle).toBeDefined();
    expect(destination).toBeDefined();
    if (!source || !middle || !destination) return;
    source.prototypeTurn = -1;
    source.adoptedTurn = -1;
    source.mastery = 80;
    source.adoption = 70;
    source.carrierStrength = 70;
    for (const state of [middle, destination]) {
      state.prototypeTurn = null;
      state.adoptedTurn = null;
      state.mastery = 0;
      state.adoption = 0;
      state.innovationProgress = 0;
      state.carrierStrength = 0;
      state.sourceRegionId = null;
      state.sourceShipmentId = null;
    }

    const context = emptyContext(world);
    context.trade.shipments.push(
      deliveredShipment('test_flow_ab', 'r_changan', 'r_hedong', routeAB.id),
      deliveredShipment('test_flow_bc', 'r_hedong', 'r_luoyang', routeBC.id),
    );
    processV03Knowledge(world, context, testEmitter(context));
    expect(middle.mastery).toBeGreaterThan(0);
    expect(middle.sourceShipmentId).toBe('test_flow_ab');
    expect(destination.mastery).toBe(0);
    expect(destination.sourceShipmentId).toBeNull();
  });

  it('produces real fleets, sea-power projection and paid trade rather than decorative maritime state', () => {
    let world = createWorld('海贸涌现');
    const initialFleetIds = world.fleets.map((fleet) => fleet.id);
    let tradeShipments = 0;
    let seaShipments = 0;
    let tariffValue = 0;
    for (let quarter = 0; quarter < 16; quarter += 1) {
      world = advanceWorld(world);
      tradeShipments += world.lastTurn?.trade.shipments.filter((shipment) => shipment.kind === '贸易').length ?? 0;
      seaShipments += world.lastTurn?.trade.shipments.filter((shipment) => shipment.legs.some((leg) => leg.kind === 'sea-lane')).length ?? 0;
      tariffValue += world.lastTurn?.trade.tariffsTransferred ?? 0;
    }
    expect(initialFleetIds.length).toBeGreaterThan(0);
    expect(world.fleets.some((fleet) => initialFleetIds.includes(fleet.id) && Boolean(fleet.seaZoneId))).toBe(true);
    expect(world.seaZones.some((zone) => Object.keys(zone.powerByPolity).length > 0)).toBe(true);
    expect(tradeShipments).toBeGreaterThan(0);
    expect(seaShipments).toBeGreaterThan(0);
    expect(tariffValue).toBeGreaterThan(0);
    expect(world.tradeCorridors.some((corridor) => corridor.rollingVolume > 0)).toBe(true);
    expect(validateWorld(world)).toEqual([]);
  }, 30_000);

  it('closes a landing operation in the same quarter when its carrier fleet disappears', () => {
    const world = advanceWorldBy(createWorld('北辰海图'), 36);
    for (const operation of world.navalOperations.filter((item) => item.stage !== '完成' && item.stage !== '失败')) {
      expect(world.armies.some((army) => army.id === operation.armyId)).toBe(true);
      expect(operation.fleetIds.every((id) => world.fleets.some((fleet) => fleet.id === id))).toBe(true);
    }
    expect(validateWorld(world)).toEqual([]);
  }, 30_000);
});
