import { describe, expect, it } from 'vitest';
import {
  PORT_LINK_DEFINITIONS,
  POLITY_DEFINITIONS,
  REGION_DEFINITIONS,
  REGION_GROUPS,
  SEA_LANE_DEFINITIONS,
  SEA_ZONE_DEFINITIONS,
} from './data';
import { computeWorldHash, createWorld } from './engine';
import { validateWorld } from './invariants';
import type { V03Emit, V03TurnContext } from './v03-context';
import {
  createV03OceanSystems,
  processV03EconomyAndTrade,
  processV03Maritime,
  totalCommodity,
} from './v03-ocean';
import type { CommodityKind, CommodityStock, HistoryEvent, WorldState } from './types';

const blankStock = (): CommodityStock => ({ 木材: 0, 铁器: 0, 马匹: 0, 盐: 0, 纺织品: 0, 奢侈品: 0 });

function totalPopulation(world: WorldState): number {
  return world.regions.reduce((sum, region) => sum + region.population, 0)
    + world.personalForces.reduce((sum, force) => sum + force.soldiers, 0)
    + world.fleets.reduce((sum, fleet) => sum + fleet.sailors, 0);
}

function totalWealth(world: WorldState): number {
  return world.regions.reduce((sum, region) => sum + region.wealth, 0)
    + world.polities.reduce((sum, polity) => sum + polity.treasury, 0);
}

function contextFor(world: WorldState): V03TurnContext {
  const stockStart = world.regions.reduce((total, region) => ({
    木材: total.木材 + region.goods.木材,
    铁器: total.铁器 + region.goods.铁器,
    马匹: total.马匹 + region.goods.马匹,
    盐: total.盐 + region.goods.盐,
    纺织品: total.纺织品 + region.goods.纺织品,
    奢侈品: total.奢侈品 + region.goods.奢侈品,
  }), blankStock());
  return {
    turn: world.turn,
    year: world.year,
    season: world.season,
    events: [],
    facts: [],
    population: { start: totalPopulation(world), births: 0, civilianDeaths: 0, militaryDeaths: 0, recruited: 0, demobilized: 0, end: 0 },
    food: { start: totalCommodity(world, '粮食'), produced: 0, civilianConsumed: 0, armyConsumed: 0, spoiled: 0, warDestroyed: 0, transferred: 0, end: 0 },
    wealth: { start: totalWealth(world), produced: 0, householdConsumed: 0, warDestroyed: 0, taxed: 0, militaryPayments: 0, end: 0 },
    logistics: { remoteFoodTransferred: 0, routeUsage: [], seaUsage: [] },
    trade: { shipments: [], stockStart, stockEnd: blankStock(), produced: {}, consumed: {}, lost: {}, valueTransferred: 0, tariffsTransferred: 0 },
    migration: { departed: 0, arrived: 0, travelDeaths: 0, settled: 0, flowIds: [] },
    health: { infectiousStart: 0, newExposures: 0, importedExposures: 0, civilianDeaths: 0, militaryDeaths: 0, infectiousEnd: 0, outbreakRegionIds: [] },
    knowledge: { prototypeIds: [], adoptedIds: [], spreadIds: [], lostIds: [] },
    maritime: { fleetIds: [], blockadedPortIds: [], raidedShipmentIds: [], landingOperationIds: [], shipsLost: 0 },
    routeCapacityReserved: {},
    seaCapacityReserved: {},
    commodityStart: {},
  };
}

function emitterFor(world: WorldState, context: V03TurnContext): V03Emit {
  return (input): HistoryEvent => {
    world.counters.event += 1;
    const event: HistoryEvent = {
      id: `test_event_${world.counters.event}`,
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
      evidence: input.evidence ?? input.causes.map((cause) => cause.evidence),
      stateDeltas: input.stateDeltas ?? [],
      sourceFactIds: input.sourceFactIds ?? [],
      situationIds: input.situationIds ?? [],
    };
    context.events.push(event);
    return event;
  };
}

function rejectUnexpectedLanding(): never {
  throw new Error('this isolated maritime test must not resolve a landing');
}

function demobilizeAllFleets(world: WorldState): void {
  for (const fleet of world.fleets) {
    const home = world.regions.find((region) => region.id === fleet.homePortRegionId);
    if (home) {
      home.population += fleet.sailors;
      home.food += fleet.food;
    }
    const commander = world.characters.find((character) => character.id === fleet.commanderId);
    if (commander) commander.commandingFleetId = null;
  }
  world.fleets = [];
  world.counters.fleet = 0;
}

describe('V0.3a ocean and trade kernel', () => {
  it('defines the strict 82 + 10 map and eight starting polities', () => {
    expect(REGION_DEFINITIONS).toHaveLength(82);
    expect(POLITY_DEFINITIONS).toHaveLength(8);
    expect(SEA_ZONE_DEFINITIONS).toHaveLength(10);
    expect(SEA_LANE_DEFINITIONS.length).toBeGreaterThanOrEqual(10);
    expect(PORT_LINK_DEFINITIONS.length).toBeGreaterThanOrEqual(30);
    expect(REGION_GROUPS.中原大陆).toHaveLength(40);
    expect(REGION_GROUPS.东北边疆).toHaveLength(11);
    expect(REGION_GROUPS.南方海洋).toHaveLength(17);
    expect(REGION_GROUPS.朝鲜半岛).toHaveLength(6);
    expect(REGION_GROUPS.日本列岛).toHaveLength(8);
    expect(new Set(Object.values(REGION_GROUPS).flat()).size).toBe(82);

    const world = createWorld('v03-map-contract');
    expect(world.regions).toHaveLength(82);
    expect(world.seaZones).toHaveLength(10);
    expect(world.routes.every((route) => route.kind !== '海峡')).toBe(true);
    expect(world.regions.find((region) => region.id === 'r_yamato')?.controllerId).toBe('p_yamato');
    expect(world.regions.find((region) => region.id === 'r_quanzhou')?.controllerId).toBe('p_minhai');
    expect(world.regions.find((region) => region.id === 'r_hanjing')?.controllerId).toBe('p_haedong');
  });

  it('creates initial fleets by transferring, never creating, sailors and food', () => {
    const world = structuredClone(createWorld('v03-fleet-ledger'));
    demobilizeAllFleets(world);
    const populationBefore = totalPopulation(world);
    const foodBefore = totalCommodity(world, '粮食');

    createV03OceanSystems(world, { legacy: false });

    expect(world.fleets.length).toBeGreaterThan(0);
    expect(totalPopulation(world)).toBe(populationBefore);
    expect(totalCommodity(world, '粮食')).toBe(foodBefore);
    expect(world.fleets.every((fleet) => fleet.sailors > 0 && fleet.food >= 0)).toBe(true);
    expect(new Set(world.fleets.map((fleet) => fleet.commanderId)).size).toBe(world.fleets.length);
    expect(world.fleets.every((fleet) => !world.armies.some((army) => army.commanderId === fleet.commanderId || army.deputyCommanderId === fleet.commanderId))).toBe(true);
  });

  it('keeps a newly commissioned fleet in the fleet id namespace when its project has a higher ordinal', () => {
    const world = createWorld('v03-ship-project-fleet-counter');
    const portRegion = world.regions.find((region) => region.port && world.polities.some((polity) => (
      polity.id === region.controllerId && polity.alive
    )));
    expect(portRegion).toBeTruthy();
    if (!portRegion) return;

    const fleetIdsBefore = new Set(world.fleets.map((fleet) => fleet.id));
    const fleetCounterBefore = world.counters.fleet;
    world.shipbuildingProjects = [{
      id: 'shipproject_00025',
      polityId: portRegion.controllerId,
      portRegionId: portRegion.id,
      targetFleetId: null,
      warships: 2,
      transports: 2,
      patrolShips: 2,
      timberCommitted: 320,
      ironCommitted: 116,
      treasurySpent: 600,
      progress: 99,
      startedTurn: world.turn - 3,
      completedTurn: null,
      status: '建造中',
    }];
    world.counters.shipProject = 25;
    portRegion.population = Math.max(portRegion.population, 10_000);
    portRegion.food = Math.max(portRegion.food, 10_000);

    const context = contextFor(world);
    processV03Maritime(world, context, emitterFor(world, context), rejectUnexpectedLanding);

    const commissioned = world.fleets.find((fleet) => !fleetIdsBefore.has(fleet.id));
    expect(commissioned?.id).toBe(`fleet_${String(fleetCounterBefore + 1).padStart(4, '0')}`);
    expect(world.counters.fleet).toBe(fleetCounterBefore + 1);
    world.hash = computeWorldHash(world);
    expect(validateWorld(world).filter((issue) => (
      issue.code === 'counter.invalid' && issue.message.startsWith('fleet')
    ))).toEqual([]);
  });

  it('settles price-driven trade with commodity, wealth and capacity conservation', () => {
    const world = createWorld('v03-trade-ledger');
    const origin = world.regions.find((region) => region.id === 'r_quanzhou') as WorldState['regions'][number];
    const destination = world.regions.find((region) => region.id === 'r_guangzhou') as WorldState['regions'][number];
    origin.goods.木材 = 20_000;
    destination.goods.木材 = 0;
    origin.prices.木材 = 4;
    destination.prices.木材 = 120;
    destination.wealth = Math.max(destination.wealth, 250_000);
    const before: Partial<Record<CommodityKind, number>> = {};
    for (const commodity of ['木材', '铁器', '马匹', '盐', '纺织品', '奢侈品'] as const) before[commodity] = totalCommodity(world, commodity);
    const wealthBefore = totalWealth(world);
    const context = contextFor(world);

    processV03EconomyAndTrade(world, context, emitterFor(world, context));

    expect(context.trade.shipments.some((shipment) => shipment.kind === '贸易' && shipment.commodity === '木材' && shipment.deliveredAmount > 0)).toBe(true);
    for (const shipment of context.trade.shipments) {
      expect(shipment.acceptedAmount).toBe(shipment.deliveredAmount + shipment.lostAmount + shipment.raidedAmount);
    }
    for (const commodity of ['木材', '铁器', '马匹', '盐', '纺织品', '奢侈品'] as const) {
      const expected = (before[commodity] ?? 0)
        + (context.trade.produced[commodity] ?? 0)
        - (context.trade.consumed[commodity] ?? 0)
        - (context.trade.lost[commodity] ?? 0);
      expect(totalCommodity(world, commodity)).toBe(expected);
    }
    expect(totalWealth(world)).toBe(wealthBefore);
    expect(context.trade.shipments.length).toBeLessThanOrEqual(512);
    expect(world.tradeCorridors.length).toBeLessThanOrEqual(160);
    expect(context.logistics.routeUsage.every((usage) => usage.reserved <= usage.capacity)).toBe(true);
    expect(context.logistics.seaUsage.every((usage) => usage.reserved <= usage.capacity)).toBe(true);
  });

  it('requires a hostile fleet with real majority projection before blocking a port', () => {
    const withoutProjection = createWorld('v03-blockade-none');
    withoutProjection.counters.war += 1;
    withoutProjection.wars.push({
      id: 'war_blockade_none', kind: 'interstate', attackerId: 'p_minhai', defenderId: 'p_yamato', startedTurn: 0,
      endedTurn: null, active: true, attackerScore: 0, defenderScore: 0, reason: '海峡争夺', lastBattleTurn: -1,
      goal: '霸权', targetRegionIds: ['r_yamato'], exhaustion: 0,
    });
    const negativeFleet = withoutProjection.fleets.find((fleet) => fleet.polityId === 'p_minhai');
    if (negativeFleet) {
      negativeFleet.portRegionId = negativeFleet.homePortRegionId;
      negativeFleet.seaZoneId = null;
    }
    const negativeContext = contextFor(withoutProjection);
    processV03Maritime(withoutProjection, negativeContext, emitterFor(withoutProjection, negativeContext), rejectUnexpectedLanding);
    expect(negativeContext.maritime.blockadedPortIds).toHaveLength(0);

    const withProjection = createWorld('v03-blockade-real');
    withProjection.counters.war += 1;
    withProjection.wars.push({
      id: 'war_blockade_real', kind: 'interstate', attackerId: 'p_minhai', defenderId: 'p_yamato', startedTurn: 0,
      endedTurn: null, active: true, attackerScore: 0, defenderScore: 0, reason: '海峡争夺', lastBattleTurn: -1,
      goal: '霸权', targetRegionIds: ['r_yamato'], exhaustion: 0,
    });
    for (const fleet of withProjection.fleets) {
      fleet.portRegionId = fleet.homePortRegionId;
      fleet.seaZoneId = null;
    }
    const blockader = withProjection.fleets.find((fleet) => fleet.polityId === 'p_minhai');
    expect(blockader).toBeTruthy();
    if (blockader) {
      blockader.portRegionId = null;
      blockader.seaZoneId = 'sea_japan_inland';
      blockader.mission = '封锁';
      blockader.targetSeaZoneId = 'sea_japan_inland';
      blockader.targetRegionId = 'r_yamato';
    }
    const positiveContext = contextFor(withProjection);
    processV03Maritime(withProjection, positiveContext, emitterFor(withProjection, positiveContext), rejectUnexpectedLanding);
    expect(positiveContext.maritime.blockadedPortIds.length).toBeGreaterThan(0);
    expect(withProjection.ports.some((port) => port.blockadePressure >= 55)).toBe(true);
  });

  it('adds compatible seas and ports to a legacy 48-region world without a free fleet', () => {
    const world = structuredClone(createWorld('v03-legacy-ocean'));
    demobilizeAllFleets(world);
    const retainedIds = new Set(REGION_DEFINITIONS.slice(0, 48).map((region) => region.id));
    world.regions = world.regions.filter((region) => retainedIds.has(region.id));
    world.routes = world.routes.filter((route) => retainedIds.has(route.fromRegionId) && retainedIds.has(route.toRegionId));
    const populationBefore = totalPopulation(world);
    const foodBefore = totalCommodity(world, '粮食');

    createV03OceanSystems(world, { legacy: true });

    expect(world.mapContentVersion).toBe('legacy-v02-48');
    expect(world.regions).toHaveLength(48);
    expect(world.seaZones).toHaveLength(10);
    expect(world.ports.length).toBe(world.regions.filter((region) => region.port).length);
    expect(world.portLinks.every((link) => retainedIds.has(link.regionId))).toBe(true);
    expect(world.fleets).toHaveLength(0);
    expect(totalPopulation(world)).toBe(populationBefore);
    expect(totalCommodity(world, '粮食')).toBe(foodBefore);
  });
});
