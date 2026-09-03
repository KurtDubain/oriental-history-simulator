import type { AgencyDecisionTurnContext } from './agency/decision';
import type { EmbodiedActionCommand } from './agency/embodiment';
import type { WorldState } from './types';
import type { V03TurnContext } from './v03-context';

export interface MutableTurnContext extends V03TurnContext, AgencyDecisionTurnContext {}

export function totalWorldPopulation(world: WorldState): number {
  return world.regions.reduce((sum, region) => sum + region.population, 0)
    + world.personalForces.reduce((sum, force) => sum + force.soldiers, 0)
    + world.fleets.reduce((sum, fleet) => sum + fleet.sailors, 0);
}

export function totalWorldFood(world: WorldState): number {
  return world.regions.reduce((sum, region) => sum + region.food, 0)
    + world.armies.reduce((sum, army) => sum + army.food, 0)
    + world.fleets.reduce((sum, fleet) => sum + fleet.food, 0)
    + world.navalOperations
      .filter((operation) => operation.stage !== '完成' && operation.stage !== '失败')
      .reduce((sum, operation) => sum + operation.foodLoaded, 0);
}

export function totalWorldWealth(world: WorldState): number {
  return world.regions.reduce((sum, region) => sum + region.wealth, 0)
    + world.polities.reduce((sum, polity) => sum + polity.treasury, 0);
}

export function createTurnContext(
  world: WorldState,
  embodiedActionCommand: EmbodiedActionCommand | null = null,
): MutableTurnContext {
  const boundaryInterventions = world.history.filter((event) => (
    event.turn === world.turn && event.kind.startsWith('observer_intervention_')
  ));
  return {
    turn: world.turn,
    year: world.year,
    season: world.season,
    // Boundary interventions belong to the following quarterly report without
    // replaying their already-applied mutation.
    events: [...boundaryInterventions],
    facts: [],
    agencyIntents: [],
    appointmentSourceFactIdsByArmyId: {},
    embodiedActionCommand,
    population: {
      start: totalWorldPopulation(world), births: 0, civilianDeaths: 0, militaryDeaths: 0,
      recruited: 0, demobilized: 0, end: 0,
    },
    food: {
      start: totalWorldFood(world), produced: 0, civilianConsumed: 0, armyConsumed: 0,
      spoiled: 0, warDestroyed: 0, transferred: 0, end: 0,
    },
    wealth: {
      start: totalWorldWealth(world), produced: 0, householdConsumed: 0, warDestroyed: 0,
      taxed: 0, militaryPayments: 0, end: 0,
    },
    logistics: { remoteFoodTransferred: 0, routeUsage: [], seaUsage: [] },
    routeCapacityReserved: {},
    seaCapacityReserved: {},
    commodityStart: {},
    trade: {
      shipments: [],
      stockStart: world.regions.reduce((total, region) => ({
        木材: total.木材 + region.goods.木材,
        铁器: total.铁器 + region.goods.铁器,
        马匹: total.马匹 + region.goods.马匹,
        盐: total.盐 + region.goods.盐,
        纺织品: total.纺织品 + region.goods.纺织品,
        奢侈品: total.奢侈品 + region.goods.奢侈品,
      }), { 木材: 0, 铁器: 0, 马匹: 0, 盐: 0, 纺织品: 0, 奢侈品: 0 }),
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
  };
}
