import { describe, expect, it } from 'vitest';
import type {
  HistoryEvent,
  RegionState,
  ShipmentRecord,
  WorldState,
} from './types';
import type { V03Emit, V03EventInput, V03TurnContext } from './v03-context';
import {
  createV03LifeSystems,
  practiceEffect,
  processV03Disease,
  processV03Knowledge,
  processV03Migration,
} from './v03-life';
import { createAgencySystemState } from './agency/memory';
import { createAgencyDecisionSystemState } from './agency/decision';
import { createSituationSystemState } from './situations';
import { createWorldArchiveState } from './archive';

const goods = () => ({ '木材': 2_000, '铁器': 1_500, '马匹': 800, '盐': 1_500, '纺织品': 1_000, '奢侈品': 500 });
const prices = () => ({ '粮食': 1, '木材': 2, '铁器': 4, '马匹': 5, '盐': 2, '纺织品': 3, '奢侈品': 7 });

function region(id: string, name: string, x: number, overrides: Partial<RegionState> = {}): RegionState {
  return {
    id,
    name,
    x,
    y: 100,
    polygon: [],
    terrain: '平原',
    climate: '暖温带',
    river: true,
    port: false,
    neighbors: [],
    routeIds: [],
    controllerId: 'p_test',
    population: 10_000,
    food: 30_000,
    wealth: 10_000,
    cityLevel: 3,
    defense: 20,
    strategicValue: 5,
    fertility: 90,
    devastation: 0,
    unrest: 5,
    refugeePopulation: 0,
    sanitation: 60,
    medicalCapacity: 30,
    marketLevel: 3,
    portLevel: 0,
    goods: goods(),
    prices: prices(),
    resourcePotential: goods(),
    ...overrides,
  };
}

function testWorld(): WorldState {
  const a = region('r_a', '甲州', 100, { food: 2_000, unrest: 80, devastation: 55, refugeePopulation: 600 });
  const b = region('r_b', '乙州', 200);
  const c = region('r_c', '丙州', 300);
  const d = region('r_d', '孤州', 500, { cityLevel: 0, river: false, goods: { '木材': 0, '铁器': 0, '马匹': 0, '盐': 0, '纺织品': 0, '奢侈品': 0 }, resourcePotential: { '木材': 0, '铁器': 0, '马匹': 0, '盐': 0, '纺织品': 0, '奢侈品': 0 } });
  const routes = [
    { id: 'route_ab', fromRegionId: a.id, toRegionId: b.id, kind: '道路' as const, distance: 100, supplyCapacity: 5_000 },
    { id: 'route_bc', fromRegionId: b.id, toRegionId: c.id, kind: '道路' as const, distance: 100, supplyCapacity: 5_000 },
  ];
  a.neighbors = [b.id]; a.routeIds = ['route_ab'];
  b.neighbors = [a.id, c.id]; b.routeIds = ['route_ab', 'route_bc'];
  c.neighbors = [b.id]; c.routeIds = ['route_bc'];

  return {
    schemaVersion: 4,
    mapContentVersion: 'v03-82',
    seed: 'v03-life-test',
    turn: 0,
    year: 1,
    season: '春',
    regions: [a, b, c, d],
    routes,
    seaZones: [],
    seaLanes: [],
    portLinks: [],
    ports: [],
    polities: [{
      id: 'p_test', name: '试国', shortName: '试', dynastyName: '试氏', color: '#000', alive: true,
      foundedTurn: 0, eliminatedTurn: null, rulerId: 'c_a', capitalRegionId: a.id, controlledRegionIds: [a.id, b.id, c.id, d.id],
      treasury: 10_000, legitimacy: 60, authority: 60, administration: 70, warWeariness: 0, taxRate: 0.1,
      lastWarTurn: -100, lastRebellionTurn: -100, rulingFamilyId: 'f_test', governmentForm: '王朝', courtInfluence: 50,
      lastCourtCrisisTurn: -100, tradeRevenue: 0, navalBudget: 0, maritimeOrientation: 0, diplomaticReputation: 50,
    }],
    characters: [a, b, c].map((home, index) => ({
      id: `c_${index}`, name: `试${index}`, familyName: '试', givenName: String(index), sex: '男' as const,
      age: 30, alive: true, deathTurn: null, polityId: 'p_test', locationRegionId: home.id, role: '廷臣' as const,
      governedRegionId: null, commandingArmyId: null, commandingFleetId: null,
      leadership: 85, governance: 85, cunning: 85, ambition: 40, loyalty: 70, caution: 50, rebellionReadiness: 0,
      renown: 10, birthTurn: -120, adultTurn: -56, lifeStage: '盛年' as const, familyId: 'f_test', parentIds: [], spouseIds: [],
      politicalClass: '官僚' as const, influence: 20, personalWealth: 10, merit: 0, deputyExperience: 0, insubordination: 0,
      biography: [], biographyDigest: '', tier: '核心' as const, sourceStubId: null, health: 100, activeDiseaseId: null, protectedUntilTurn: null,
    })),
    armies: [],
    fleets: [],
    wars: [],
    families: [], relationships: [], factions: [], diplomacy: [], offices: [], backgroundPeople: [], commitments: [],
    tradeCorridors: [], navalOperations: [], shipbuildingProjects: [], pathogens: [], infections: [], practices: [], practiceStates: [],
    history: [], historyDigest: '', facts: [], factDigest: '', legacyArchiveBoundary: null, lastTurn: null,
    archiveSystem: createWorldArchiveState(),
    situationSystem: createSituationSystemState(-1),
    agencySystem: createAgencySystemState(-1),
    agencyDecisionSystem: createAgencyDecisionSystemState(-1),
    counters: { character: 3, army: 0, polity: 1, war: 0, event: 0, family: 0, faction: 0, relationship: 0, office: 0, commitment: 0, fleet: 0, tradeCorridor: 0, navalOperation: 0, shipment: 0, shipProject: 0, fact: 0 },
    hash: '',
  };
}

function context(world: WorldState): V03TurnContext {
  const population = world.regions.reduce((sum, item) => sum + item.population, 0);
  return {
    turn: world.turn, year: world.year, season: world.season, events: [], facts: [],
    population: { start: population, births: 0, civilianDeaths: 0, militaryDeaths: 0, recruited: 0, demobilized: 0, end: 0 },
    food: { start: 0, produced: 0, civilianConsumed: 0, armyConsumed: 0, spoiled: 0, warDestroyed: 0, transferred: 0, end: 0 },
    wealth: { start: 0, produced: 0, householdConsumed: 0, warDestroyed: 0, taxed: 0, militaryPayments: 0, end: 0 },
    logistics: { remoteFoodTransferred: 0, routeUsage: [], seaUsage: [] },
    trade: {
      shipments: [],
      stockStart: { 木材: 0, 铁器: 0, 马匹: 0, 盐: 0, 纺织品: 0, 奢侈品: 0 },
      stockEnd: { 木材: 0, 铁器: 0, 马匹: 0, 盐: 0, 纺织品: 0, 奢侈品: 0 },
      produced: {}, consumed: {}, lost: {}, valueTransferred: 0, tariffsTransferred: 0,
    },
    migration: { departed: 0, arrived: 0, travelDeaths: 0, settled: 0, flowIds: [] },
    health: { infectiousStart: 0, newExposures: 0, importedExposures: 0, civilianDeaths: 0, militaryDeaths: 0, infectiousEnd: 0, outbreakRegionIds: [] },
    knowledge: { prototypeIds: [], adoptedIds: [], spreadIds: [], lostIds: [] },
    maritime: { fleetIds: [], blockadedPortIds: [], raidedShipmentIds: [], landingOperationIds: [], shipsLost: 0 },
    routeCapacityReserved: {}, seaCapacityReserved: {}, commodityStart: {},
  };
}

function eventSink(target: HistoryEvent[]): V03Emit {
  return (input: V03EventInput): HistoryEvent => {
    const event: HistoryEvent = {
      id: `event_${target.length + 1}`, turn: 0, year: 1, season: '春', category: input.category, kind: input.kind,
      title: input.title, summary: input.summary, importance: input.importance, actorIds: input.actorIds ?? [], polityIds: input.polityIds ?? [],
      regionIds: input.regionIds ?? [], causes: input.causes, evidence: input.evidence ?? input.causes.map((cause) => cause.evidence), stateDeltas: input.stateDeltas ?? [],
      sourceFactIds: input.sourceFactIds ?? [], situationIds: input.situationIds ?? [],
    };
    target.push(event);
    return event;
  };
}

function shipment(id: string, origin: string, destination: string, status: ShipmentRecord['status'] = '交付'): ShipmentRecord {
  return {
    id, kind: '贸易', commodity: '盐', originRegionId: origin, destinationRegionId: destination,
    acceptedAmount: 1_000, deliveredAmount: status === '被拒' ? 0 : 1_000, lostAmount: 0, raidedAmount: 0,
    peopleDeparted: 0, peopleArrived: 0, peopleLost: 0, contactVolume: status === '被拒' ? 0 : 10_000,
    legs: [{ kind: 'route', edgeId: origin === 'r_a' ? 'route_ab' : 'route_bc', month: 0, capacityUsed: 1_000 }],
    carrierArmyId: null, carrierFleetId: null, value: 1_000, tariff: 0, status,
  };
}

describe('V0.3b life systems', () => {
  it('initializes two explicit endemic sources, while legacy worlds remain wholly susceptible', () => {
    const fresh = testWorld();
    createV03LifeSystems(fresh, { legacy: false });
    expect(fresh.pathogens).toHaveLength(2);
    expect(fresh.practices).toHaveLength(6);
    expect(fresh.practiceStates).toHaveLength(fresh.regions.length * 6);
    expect(fresh.infections.filter((state) => state.infectious > 0)).toHaveLength(2);

    const legacy = testWorld();
    createV03LifeSystems(legacy, { legacy: true });
    expect(legacy.infections.every((state) => state.exposed === 0 && state.infectious === 0 && state.susceptible > 0)).toBe(true);
    expect(legacy.practiceStates.every((state) => state.legacyBaseline && state.prototypeTurn === null && state.mastery === 0)).toBe(true);
  });

  it('does not spread disease through rejected shipments or without an actual path', () => {
    const world = testWorld();
    createV03LifeSystems(world, { legacy: true });
    const source = world.infections.find((state) => state.hostId === 'r_a' && state.pathogenId === world.pathogens[0]?.id) as NonNullable<typeof world.infections[number]>;
    source.infectious = 300;
    source.susceptible -= 300;
    const ctx = context(world);
    ctx.trade.shipments.push(shipment('rejected', 'r_a', 'r_b', '被拒'));
    processV03Disease(world, ctx, eventSink([]));
    const b = world.infections.find((state) => state.hostId === 'r_b' && state.pathogenId === source.pathogenId) as NonNullable<typeof source>;
    const isolated = world.infections.find((state) => state.hostId === 'r_d' && state.pathogenId === source.pathogenId) as NonNullable<typeof source>;
    expect(b.exposed + b.infectious).toBe(0);
    expect(isolated.exposed + isolated.infectious).toBe(0);
    expect(ctx.health.importedExposures).toBe(0);
  });

  it('keeps every SEIR host aligned after actual contact and mortality', () => {
    const world = testWorld();
    createV03LifeSystems(world, { legacy: true });
    const source = world.infections.find((state) => state.hostId === 'r_a' && state.pathogenId === world.pathogens[0]?.id) as NonNullable<typeof world.infections[number]>;
    source.infectious = 800;
    source.susceptible -= 800;
    const ctx = context(world);
    ctx.trade.shipments.push(shipment('accepted', 'r_a', 'r_b'));
    processV03Disease(world, ctx, eventSink([]));
    expect(ctx.health.importedExposures).toBeGreaterThan(0);
    for (const state of world.infections) {
      const host = world.regions.find((item) => item.id === state.hostId);
      expect(state.susceptible + state.exposed + state.infectious + state.recovered).toBe(host?.population);
    }
    expect(ctx.population.civilianDeaths).toBe(ctx.health.civilianDeaths);
  });

  it('resolves sub-unit shipment exposure without a hard probability cutoff', () => {
    const world = testWorld();
    createV03LifeSystems(world, { legacy: true });
    const source = world.infections.find((state) => state.hostId === 'r_a' && state.pathogenId === world.pathogens[0]?.id) as NonNullable<typeof world.infections[number]>;
    source.infectious = 300;
    source.susceptible -= 300;
    const lowContact = shipment('fractional_566', 'r_a', 'r_b');
    lowContact.acceptedAmount = 1;
    lowContact.deliveredAmount = 1;
    lowContact.contactVolume = 1;
    lowContact.legs[0] = { ...lowContact.legs[0], capacityUsed: 1 };
    const ctx = context(world);
    const events: HistoryEvent[] = [];
    ctx.trade.shipments.push(lowContact);

    processV03Disease(world, ctx, eventSink(events));

    expect(ctx.health.importedExposures).toBe(1);
    expect(events.some((event) => event.kind === 'disease_imported')).toBe(true);

    world.turn = 1;
    const repeated = context(world);
    repeated.trade.shipments.push(shipment('accepted-after-trace', 'r_a', 'r_b'));
    processV03Disease(world, repeated, eventSink(events));
    expect(events.filter((event) => event.kind === 'disease_imported')).toHaveLength(1);
  });

  it('settles at most one migration flow per origin with exact population conservation', () => {
    const world = testWorld();
    createV03LifeSystems(world, { legacy: true });
    const ctx = context(world);
    const totalBefore = world.regions.reduce((sum, item) => sum + item.population, 0);
    processV03Migration(world, ctx, eventSink([]));
    const flowsFromA = ctx.trade.shipments.filter((item) => item.kind === '迁徙' && item.originRegionId === 'r_a');
    expect(flowsFromA).toHaveLength(1);
    const flow = flowsFromA[0] as ShipmentRecord;
    expect(flow.peopleDeparted).toBe(flow.peopleArrived + flow.peopleLost);
    const totalAfter = world.regions.reduce((sum, item) => sum + item.population, 0);
    expect(totalBefore - totalAfter).toBe(ctx.migration.travelDeaths);
    expect(ctx.migration.departed).toBe(ctx.migration.arrived + ctx.migration.travelDeaths);
    expect(world.regions.every((item) => item.refugeePopulation >= 0 && item.refugeePopulation <= item.population)).toBe(true);
    for (const state of world.infections) {
      const host = world.regions.find((item) => item.id === state.hostId);
      expect(state.susceptible + state.exposed + state.infectious + state.recovered).toBe(host?.population);
    }
  });

  it('traces infected migration cohorts to their physical Shipment even if the quarter later clears them', () => {
    const world = testWorld();
    createV03LifeSystems(world, { legacy: true });
    const pathogen = world.pathogens[0];
    const source = world.infections.find((state) => state.hostId === 'r_a' && state.pathogenId === pathogen?.id);
    expect(pathogen).toBeDefined();
    expect(source).toBeDefined();
    if (!pathogen || !source) return;
    source.infectious = 3_000;
    source.susceptible -= 3_000;
    source.startedTurn = 0;
    const ctx = context(world);
    const events: HistoryEvent[] = [];

    processV03Migration(world, ctx, eventSink(events));

    const flow = ctx.trade.shipments.find((item) => item.kind === '迁徙' && item.originRegionId === 'r_a');
    expect(flow).toBeDefined();
    if (!flow) return;
    const destination = world.infections.find((state) => (
      state.hostId === flow.destinationRegionId && state.pathogenId === pathogen.id
    ));
    expect(destination?.recentSources.some((item) => item.shipmentId === flow.id && item.importedExposures > 0)).toBe(true);

    processV03Disease(world, ctx, eventSink(events));

    const imported = events.find((event) => event.kind === 'disease_imported' && event.regionIds.includes(flow.destinationRegionId));
    expect(imported).toBeDefined();
    expect(imported?.causes.some((cause) => cause.refs?.some((ref) => ref.entityId === flow.id))).toBe(true);
  });

  it('uses a frozen knowledge snapshot, so A-B-C cannot chain in one quarter', () => {
    const world = testWorld();
    createV03LifeSystems(world, { legacy: true });
    const definition = world.practices.find((item) => item.effectKey === 'trade-loss') as NonNullable<typeof world.practices[number]>;
    const a = world.practiceStates.find((state) => state.regionId === 'r_a' && state.practiceId === definition.id) as NonNullable<typeof world.practiceStates[number]>;
    a.prototypeTurn = 0; a.adoptedTurn = 0; a.legacyBaseline = false; a.mastery = 80; a.adoption = 80;
    const ctx = context(world);
    ctx.trade.shipments.push(shipment('ab', 'r_a', 'r_b'), shipment('bc', 'r_b', 'r_c'), shipment('rejected-ad', 'r_a', 'r_d', '被拒'));
    processV03Knowledge(world, ctx, eventSink([]));
    const b = world.practiceStates.find((state) => state.regionId === 'r_b' && state.practiceId === definition.id) as NonNullable<typeof a>;
    const c = world.practiceStates.find((state) => state.regionId === 'r_c' && state.practiceId === definition.id) as NonNullable<typeof a>;
    const d = world.practiceStates.find((state) => state.regionId === 'r_d' && state.practiceId === definition.id) as NonNullable<typeof a>;
    expect(b.mastery).toBeGreaterThan(0);
    expect(c.mastery).toBe(0);
    expect(d.mastery).toBe(0);
  });

  it('delays newly adopted effects until the next quarter and permits genuine loss', () => {
    const world = testWorld();
    createV03LifeSystems(world, { legacy: true });
    const harvest = world.practices.find((item) => item.effectKey === 'harvest') as NonNullable<typeof world.practices[number]>;
    const local = world.practiceStates.find((state) => state.regionId === 'r_a' && state.practiceId === harvest.id) as NonNullable<typeof world.practiceStates[number]>;
    local.prototypeTurn = 0; local.adoptedTurn = world.turn; local.legacyBaseline = false; local.mastery = 80; local.adoption = 50;
    expect(practiceEffect(world, 'r_a', 'harvest')).toBe(0);
    world.turn += 1;
    expect(practiceEffect(world, 'r_a', 'harvest')).toBeGreaterThan(0);

    const navigation = world.practices.find((item) => item.effectKey === 'sea-risk') as NonNullable<typeof harvest>;
    const forgotten = world.practiceStates.find((state) => state.regionId === 'r_d' && state.practiceId === navigation.id) as NonNullable<typeof local>;
    forgotten.prototypeTurn = 0; forgotten.adoptedTurn = 0; forgotten.legacyBaseline = false;
    forgotten.mastery = 4; forgotten.adoption = 1; forgotten.carrierStrength = 0; forgotten.lastUsedTurn = 0;
    world.turn = 25;
    const ctx = context(world);
    ctx.turn = world.turn;
    processV03Knowledge(world, ctx, eventSink([]));
    expect(forgotten.lostTurn).toBe(world.turn);
    expect(ctx.knowledge.lostIds).toContain(forgotten.id);
    expect(practiceEffect(world, 'r_d', 'sea-risk')).toBe(0);
  });
});
