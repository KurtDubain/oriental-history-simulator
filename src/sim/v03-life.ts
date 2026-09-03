import { keyedRandom, stableCompare } from './random';
import type {
  DiseaseHostState,
  EvidenceRef,
  InfectionSource,
  PathogenState,
  PracticeCategory,
  PracticeState,
  RegionPracticeState,
  RegionState,
  ShipmentLeg,
  ShipmentRecord,
  WorldState,
} from './types';
import type { V03Emit, V03TurnContext } from './v03-context';
import { applyFormationLosses } from './military/personal-forces';

const PATHOGENS: readonly PathogenState[] = [
  {
    id: 'pathogen_cold_flux',
    name: '寒燥时疫',
    transmissibility: 0.31,
    incubationMonths: 2,
    durationMonths: 3,
    fatality: 0.018,
    immunityMonths: 18,
    climateAffinity: ['寒温带', '温带', '暖温带'],
    crowdingSensitivity: 0.42,
    sanitationSensitivity: 0.22,
  },
  {
    id: 'pathogen_river_fever',
    name: '河港痢热',
    transmissibility: 0.24,
    incubationMonths: 1,
    durationMonths: 2,
    fatality: 0.026,
    immunityMonths: 12,
    climateAffinity: ['湿热', '暖温带'],
    crowdingSensitivity: 0.28,
    sanitationSensitivity: 0.58,
  },
] as const;

const PRACTICES: readonly PracticeState[] = [
  { id: 'practice_crop_rotation', name: '當田轮作', category: '农业', description: '以休耕和轮作保持地力。', effectKey: 'harvest', effectStrength: 0.12 },
  { id: 'practice_march_granary', name: '行营分仓', category: '军事', description: '分散辎重与行军粮仓以减少断粮。', effectKey: 'supply-loss', effectStrength: 0.16 },
  { id: 'practice_sluice_dike', name: '分洪堤闸', category: '工程', description: '以河道、堤防和闸口分洪。', effectKey: 'devastation-recovery', effectStrength: 0.2 },
  { id: 'practice_clean_water', name: '净水隔离', category: '医学', description: '分离饮水、病者与密集人群。', effectKey: 'disease', effectStrength: 0.22 },
  { id: 'practice_joint_contract', name: '联号契券', category: '商业', description: '用可追索的合伙契券分担运销风险。', effectKey: 'trade-loss', effectStrength: 0.14 },
  { id: 'practice_monsoon_chart', name: '季风海图', category: '航海', description: '记录季风、洋流、暗礁与避风港。', effectKey: 'sea-risk', effectStrength: 0.2 },
] as const;

type EffectKey = PracticeState['effectKey'];
type CompartmentKey = 'susceptible' | 'exposed' | 'infectious' | 'recovered';
type Compartments = Record<CompartmentKey, number>;

const COMPARTMENT_KEYS: readonly CompartmentKey[] = [
  'susceptible',
  'exposed',
  'infectious',
  'recovered',
] as const;

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function integer(value: number): number {
  return Math.max(0, Math.floor(value));
}

function sumCompartments(value: Compartments | DiseaseHostState): number {
  return value.susceptible + value.exposed + value.infectious + value.recovered;
}

function infectionId(hostKind: DiseaseHostState['hostKind'], hostId: string, pathogenId: string): string {
  return `infection_${hostKind}_${hostId}_${pathogenId}`;
}

function practiceStateId(regionId: string, practiceId: string): string {
  return `region-practice_${regionId}_${practiceId}`;
}

function emptyInfection(
  hostKind: DiseaseHostState['hostKind'],
  hostId: string,
  pathogenId: string,
  population: number,
): DiseaseHostState {
  return {
    id: infectionId(hostKind, hostId, pathogenId),
    hostKind,
    hostId,
    pathogenId,
    susceptible: integer(population),
    exposed: 0,
    infectious: 0,
    recovered: 0,
    peakInfectious: 0,
    startedTurn: null,
    zeroCaseMonths: 0,
    recentSources: [],
  };
}

function proportionalParts(source: Compartments, requested: number): Compartments {
  const total = sumCompartments(source);
  const target = Math.min(total, integer(requested));
  const result: Compartments = { susceptible: 0, exposed: 0, infectious: 0, recovered: 0 };
  if (target <= 0 || total <= 0) return result;
  const fractions = COMPARTMENT_KEYS.map((key, index) => {
    const exact = source[key] * target / total;
    const base = Math.floor(exact);
    result[key] = base;
    return { key, fraction: exact - base, index };
  });
  let remainder = target - sumCompartments(result);
  fractions.sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (let index = 0; remainder > 0; index = (index + 1) % fractions.length) {
    const entry = fractions[index] as (typeof fractions)[number];
    if (result[entry.key] < source[entry.key]) {
      result[entry.key] += 1;
      remainder -= 1;
    }
  }
  return result;
}

function takeCompartments(state: DiseaseHostState, count: number): Compartments {
  const source: Compartments = {
    susceptible: state.susceptible,
    exposed: state.exposed,
    infectious: state.infectious,
    recovered: state.recovered,
  };
  const result = proportionalParts(source, count);
  for (const key of COMPARTMENT_KEYS) state[key] -= result[key];
  return result;
}

function addCompartments(state: DiseaseHostState, value: Compartments): void {
  for (const key of COMPARTMENT_KEYS) state[key] += value[key];
}

function hostPopulation(world: WorldState, state: DiseaseHostState): number {
  if (state.hostKind === 'region') return world.regions.find((item) => item.id === state.hostId)?.population ?? 0;
  if (state.hostKind === 'army') return world.armies.find((item) => item.id === state.hostId)?.soldiers ?? 0;
  return world.fleets.find((item) => item.id === state.hostId)?.sailors ?? 0;
}

function syncHostState(world: WorldState, state: DiseaseHostState): void {
  const expected = integer(hostPopulation(world, state));
  const actual = sumCompartments(state);
  if (actual < expected) state.susceptible += expected - actual;
  else if (actual > expected) takeCompartments(state, actual - expected);
  state.peakInfectious = Math.max(state.peakInfectious, state.infectious);
  state.recentSources = state.recentSources.slice(-4);
}

function ensureHostStates(world: WorldState): void {
  const validHostKeys = new Set<string>();
  const hosts: Array<{ kind: DiseaseHostState['hostKind']; id: string; population: number }> = [
    ...world.regions.map((region) => ({ kind: 'region' as const, id: region.id, population: region.population })),
    ...world.armies.map((army) => ({ kind: 'army' as const, id: army.id, population: army.soldiers })),
    ...world.fleets.map((fleet) => ({ kind: 'fleet' as const, id: fleet.id, population: fleet.sailors })),
  ];
  const byId = new Map(world.infections.map((state) => [state.id, state]));
  for (const host of hosts) {
    for (const pathogen of world.pathogens) {
      const id = infectionId(host.kind, host.id, pathogen.id);
      validHostKeys.add(id);
      const existing = byId.get(id);
      if (existing) syncHostState(world, existing);
      else world.infections.push(emptyInfection(host.kind, host.id, pathogen.id, host.population));
    }
  }
  world.infections = world.infections
    .filter((state) => state.hostKind === 'region' || validHostKeys.has(state.id))
    .sort((left, right) => stableCompare(left.id, right.id));
}

function initialSourceRegion(world: WorldState, pathogen: PathogenState, excluded: ReadonlySet<string>): RegionState | undefined {
  return [...world.regions]
    .filter((region) => !excluded.has(region.id))
    .filter((region) => pathogen.climateAffinity.includes(region.climate))
    .sort((left, right) => {
      const leftScore = left.cityLevel * 10 + (left.port ? 12 : 0) + (left.river ? 6 : 0)
        + keyedRandom(world.seed, 'v03-life-source', pathogen.id, left.id) * 5;
      const rightScore = right.cityLevel * 10 + (right.port ? 12 : 0) + (right.river ? 6 : 0)
        + keyedRandom(world.seed, 'v03-life-source', pathogen.id, right.id) * 5;
      return rightScore - leftScore || stableCompare(left.id, right.id);
    })[0];
}

export function createV03LifeSystems(world: WorldState, options: { legacy: boolean }): void {
  world.pathogens = PATHOGENS.map((pathogen) => ({ ...pathogen, climateAffinity: [...pathogen.climateAffinity] }));
  world.practices = PRACTICES.map((practice) => ({ ...practice }));
  world.infections = [];
  world.practiceStates = world.regions.flatMap((region) => world.practices.map((practice): RegionPracticeState => ({
    id: practiceStateId(region.id, practice.id),
    regionId: region.id,
    practiceId: practice.id,
    innovationProgress: 0,
    mastery: 0,
    adoption: 0,
    carrierStrength: 0,
    carrierCharacterIds: [],
    prototypeTurn: null,
    adoptedTurn: null,
    lostTurn: null,
    lastUsedTurn: world.turn,
    sourceRegionId: null,
    sourceShipmentId: null,
    legacyBaseline: options.legacy,
  })));
  ensureHostStates(world);
  if (options.legacy) return;

  const used = new Set<string>();
  for (const pathogen of world.pathogens) {
    const region = initialSourceRegion(world, pathogen, used);
    if (!region) continue;
    used.add(region.id);
    const infection = world.infections.find((state) => (
      state.hostKind === 'region' && state.hostId === region.id && state.pathogenId === pathogen.id
    ));
    if (!infection) continue;
    const infectious = Math.min(region.population, Math.max(12, integer(region.population * 0.00025)));
    const exposed = Math.min(region.population - infectious, infectious * 2);
    infection.susceptible = region.population - infectious - exposed;
    infection.exposed = exposed;
    infection.infectious = infectious;
    infection.startedTurn = world.turn;
    infection.peakInfectious = infectious;
    infection.recentSources = [{
      turn: world.turn,
      sourceHostId: region.id,
      shipmentId: null,
      routeEvidence: ['建世时已记录的地方性低水平病灶'],
      importedExposures: 0,
    }];
  }
}

function pathCapacity(world: WorldState, context: V03TurnContext, edgeIds: readonly string[]): number {
  if (edgeIds.length === 0) return 0;
  let capacity = Number.POSITIVE_INFINITY;
  for (const edgeId of edgeIds) {
    const route = world.routes.find((item) => item.id === edgeId);
    if (route) {
      capacity = Math.min(capacity, route.supplyCapacity - (context.routeCapacityReserved[edgeId] ?? 0));
      continue;
    }
    const lane = world.seaLanes.find((item) => item.id === edgeId);
    const link = world.portLinks.find((item) => item.id === edgeId);
    const effectiveUsage = context.logistics.seaUsage.find((item) => item.edgeId === edgeId);
    const seaCapacity = effectiveUsage?.capacity ?? lane?.capacity ?? link?.capacity ?? 0;
    capacity = Math.min(capacity, seaCapacity - (context.seaCapacityReserved[edgeId] ?? 0));
  }
  return Math.max(0, integer(capacity));
}

function shipmentLegs(world: WorldState, edgeIds: readonly string[], amount: number): ShipmentLeg[] {
  return edgeIds.map((edgeId, index) => ({
    kind: world.routes.some((route) => route.id === edgeId)
      ? 'route'
      : world.portLinks.some((link) => link.id === edgeId)
        ? 'port-link'
        : 'sea-lane',
    edgeId,
    month: Math.min(2, index) as 0 | 1 | 2,
    capacityUsed: amount,
  }));
}

function reservePath(
  world: WorldState,
  context: V03TurnContext,
  edgeIds: readonly string[],
  amount: number,
  flowId: string,
): void {
  for (const edgeId of edgeIds) {
    const route = world.routes.find((item) => item.id === edgeId);
    if (route) {
      context.routeCapacityReserved[edgeId] = (context.routeCapacityReserved[edgeId] ?? 0) + amount;
      const usage = context.logistics.routeUsage.find((item) => item.routeId === edgeId);
      if (usage) {
        usage.reserved += amount;
        usage.flowIds = [...(usage.flowIds ?? []), flowId];
      } else {
        context.logistics.routeUsage.push({ routeId: edgeId, capacity: route.supplyCapacity, reserved: amount, armyIds: [], flowIds: [flowId] });
      }
    } else {
      context.seaCapacityReserved[edgeId] = (context.seaCapacityReserved[edgeId] ?? 0) + amount;
      const capacity = world.seaLanes.find((item) => item.id === edgeId)?.capacity
        ?? world.portLinks.find((item) => item.id === edgeId)?.capacity
        ?? 0;
      const usage = context.logistics.seaUsage.find((item) => item.edgeId === edgeId);
      if (usage) {
        usage.reserved += amount;
        usage.flowIds.push(flowId);
      } else context.logistics.seaUsage.push({ edgeId, capacity, reserved: amount, flowIds: [flowId] });
    }
  }
}

function moveDiseaseCohorts(
  world: WorldState,
  originRegionId: string,
  destinationRegionId: string,
  departed: number,
  arrived: number,
  turn: number,
  shipmentId: string,
  routeEvidence: readonly string[],
): void {
  for (const pathogen of world.pathogens) {
    const origin = world.infections.find((state) => state.hostKind === 'region' && state.hostId === originRegionId && state.pathogenId === pathogen.id);
    const destination = world.infections.find((state) => state.hostKind === 'region' && state.hostId === destinationRegionId && state.pathogenId === pathogen.id);
    if (!origin || !destination) continue;
    const travelling = takeCompartments(origin, departed);
    const arriving = proportionalParts(travelling, arrived);
    addCompartments(destination, arriving);
    const importedCases = arriving.exposed + arriving.infectious;
    if (importedCases <= 0) continue;
    destination.startedTurn ??= turn;
    destination.peakInfectious = Math.max(destination.peakInfectious, destination.infectious);
    destination.recentSources = [...destination.recentSources, {
      turn,
      sourceHostId: originRegionId,
      shipmentId,
      routeEvidence: [...routeEvidence],
      importedExposures: importedCases,
    }].slice(-4);
  }
}

interface MigrationCandidate {
  destination: RegionState;
  edgeIds: string[];
  utility: number;
}

function migrationCandidates(world: WorldState, origin: RegionState): MigrationCandidate[] {
  const candidates = new Map<string, MigrationCandidate>();
  for (const route of world.routes) {
    if (route.kind === '海峡') continue;
    const destinationId = route.fromRegionId === origin.id
      ? route.toRegionId
      : route.toRegionId === origin.id
        ? route.fromRegionId
        : null;
    const destination = destinationId ? world.regions.find((region) => region.id === destinationId) : undefined;
    if (!destination) continue;
    candidates.set(destination.id, { destination, edgeIds: [route.id], utility: 0 });
  }
  for (const corridor of world.tradeCorridors.filter((item) => item.active && item.originRegionId === origin.id)) {
    const destination = world.regions.find((region) => region.id === corridor.destinationRegionId);
    if (!destination || corridor.pathEdgeIds.length === 0) continue;
    if (!candidates.has(destination.id) || corridor.pathEdgeIds.length < (candidates.get(destination.id)?.edgeIds.length ?? Infinity)) {
      candidates.set(destination.id, { destination, edgeIds: [...corridor.pathEdgeIds], utility: 0 });
    }
  }
  return [...candidates.values()];
}

function migrationPush(world: WorldState, region: RegionState): number {
  const foodMonths = region.food / Math.max(1, region.population);
  const shortage = clamp((1.5 - foodMonths) / 1.5, 0, 1);
  const refugeeRatio = region.refugeePopulation / Math.max(1, region.population);
  const atWar = world.wars.some((war) => war.active && (
    war.attackerId === region.controllerId || war.defenderId === region.controllerId
  ));
  return shortage * 46 + region.devastation * 0.34 + region.unrest * 0.18
    + Math.min(24, refugeeRatio * 180) + (atWar ? 8 : 0);
}

function destinationUtility(origin: RegionState, destination: RegionState): number {
  const foodAdvantage = clamp(
    destination.food / Math.max(1, destination.population)
      - origin.food / Math.max(1, origin.population),
    -3,
    3,
  ) * 11;
  const wealthAdvantage = clamp(
    destination.wealth / Math.max(1, destination.population)
      - origin.wealth / Math.max(1, origin.population),
    -1,
    1,
  ) * 8;
  return foodAdvantage + wealthAdvantage
    + (100 - destination.unrest) * 0.16
    + (100 - destination.devastation) * 0.14
    + destination.cityLevel * 2
    + (destination.controllerId === origin.controllerId ? 10 : 0);
}

function settleRefugees(world: WorldState, context: V03TurnContext, emit: V03Emit): void {
  for (const region of [...world.regions].sort((left, right) => stableCompare(left.id, right.id))) {
    if (region.refugeePopulation <= 0) continue;
    const foodMonths = region.food / Math.max(1, region.population);
    if (foodMonths < 1.25 || region.unrest > 65 || region.devastation > 55) continue;
    const rate = clamp(0.02 + region.sanitation / 2_500 + region.cityLevel * 0.006, 0.02, 0.09);
    const settled = Math.min(region.refugeePopulation, integer(region.refugeePopulation * rate));
    if (settled <= 0) continue;
    const before = region.refugeePopulation;
    region.refugeePopulation -= settled;
    context.migration.settled += settled;
    if (settled >= 500) emit({
      category: '迁徙',
      kind: 'refugee_settlement',
      title: `${region.name}安置流民`,
      summary: `${region.name}凭粮食、治安与卫生条件使${settled}名流民落籍，人口总数不变。`,
      polityIds: [region.controllerId],
      regionIds: [region.id],
      importance: 2,
      causes: [
        { label: '接纳条件', role: '条件', weight: 0.55, evidence: `人均存粮${foodMonths.toFixed(2)}，卫生${region.sanitation}，不安${region.unrest.toFixed(0)}` },
        { label: '落籍结果', role: '结果', weight: 0.45, evidence: `流民${before}减至${region.refugeePopulation}` },
      ],
      stateDeltas: [{ entityType: 'region', entityId: region.id, field: 'refugeePopulation', before, after: region.refugeePopulation, delta: -settled }],
    });
  }
}

export function processV03Migration(world: WorldState, context: V03TurnContext, emit: V03Emit): void {
  ensureHostStates(world);
  settleRefugees(world, context, emit);
  const origins = [...world.regions].sort((left, right) => stableCompare(left.id, right.id));
  for (const origin of origins) {
    if (origin.population < 500) continue;
    const push = migrationPush(world, origin);
    if (push < 22 && origin.refugeePopulation === 0) continue;
    const candidates = migrationCandidates(world, origin)
      .map((candidate) => ({ ...candidate, utility: destinationUtility(origin, candidate.destination) }))
      .filter((candidate) => candidate.utility + push * 0.35 >= 32)
      .sort((left, right) => right.utility - left.utility || stableCompare(left.destination.id, right.destination.id));
    const target = candidates[0];
    if (!target) continue;
    const capacity = pathCapacity(world, context, target.edgeIds);
    if (capacity <= 0) continue;

    const acute = origin.refugeePopulation > 0 || origin.devastation >= 40 || origin.unrest >= 66
      || origin.food / Math.max(1, origin.population) < 0.65;
    const availableRefugees = origin.refugeePopulation;
    const desired = acute
      ? Math.max(1, Math.min(
        availableRefugees > 0 ? integer(availableRefugees * 0.22) : integer(origin.population * 0.008),
        integer(origin.population * 0.018),
      ))
      : Math.max(1, integer(origin.population * 0.0015));
    const departed = Math.min(origin.population, desired, capacity);
    if (departed <= 0) continue;

    const pathRisk = target.edgeIds.reduce((risk, edgeId) => (
      risk + (world.seaLanes.find((lane) => lane.id === edgeId)?.baseRisk ?? 0)
    ), 0);
    const lossRate = clamp(0.002 + target.edgeIds.length * 0.0015 + pathRisk * 0.025 + origin.devastation / 6_000, 0, 0.08);
    const peopleLost = Math.min(departed, integer(departed * lossRate));
    const peopleArrived = departed - peopleLost;
    world.counters.shipment += 1;
    const id = `shipment_${String(world.counters.shipment).padStart(6, '0')}`;
    reservePath(world, context, target.edgeIds, departed, id);

    const originPopulationBefore = origin.population;
    const destinationPopulationBefore = target.destination.population;
    const originRefugeesBefore = origin.refugeePopulation;
    const destinationRefugeesBefore = target.destination.refugeePopulation;
    moveDiseaseCohorts(
      world,
      origin.id,
      target.destination.id,
      departed,
      peopleArrived,
      context.turn,
      id,
      target.edgeIds,
    );
    origin.population -= departed;
    target.destination.population += peopleArrived;
    const existingRefugeesDeparted = Math.min(origin.refugeePopulation, departed);
    origin.refugeePopulation -= existingRefugeesDeparted;
    if (acute) target.destination.refugeePopulation += peopleArrived;

    const shipment: ShipmentRecord = {
      id,
      kind: '迁徙',
      commodity: null,
      originRegionId: origin.id,
      destinationRegionId: target.destination.id,
      acceptedAmount: departed,
      deliveredAmount: peopleArrived,
      lostAmount: peopleLost,
      raidedAmount: 0,
      peopleDeparted: departed,
      peopleArrived,
      peopleLost,
      contactVolume: departed,
      legs: shipmentLegs(world, target.edgeIds, departed),
      carrierArmyId: null,
      carrierFleetId: null,
      value: 0,
      tariff: 0,
      status: peopleLost > 0 ? '受损' : '交付',
    };
    context.trade.shipments.push(shipment);
    context.migration.departed += departed;
    context.migration.arrived += peopleArrived;
    context.migration.travelDeaths += peopleLost;
    context.migration.flowIds.push(id);
    context.population.civilianDeaths += peopleLost;

    if (departed >= Math.max(400, integer(originPopulationBefore * 0.004))) {
      const refs: EvidenceRef[] = [
        { kind: 'shipment', entityType: 'shipment', entityId: id, label: '实际迁徙流' },
        ...target.edgeIds.map((edgeId): EvidenceRef => ({ kind: 'entity', entityType: 'migration', entityId: edgeId, label: '已获容量边' })),
      ];
      emit({
        category: '迁徙',
        kind: acute ? 'refugee_exodus' : 'migration_wave',
        title: `${origin.name}人口迁往${target.destination.name}`,
        summary: `${departed}人经已获容量的通道出发，${peopleArrived}人抵达，${peopleLost}人死于途中。`,
        importance: acute ? 3 : 2,
        polityIds: [...new Set([origin.controllerId, target.destination.controllerId])],
        regionIds: [origin.id, target.destination.id],
        causes: [
          { label: '迁出压力', role: '结构', weight: 0.32, evidence: `压力${push.toFixed(1)}；破坏${origin.devastation.toFixed(0)}，不安${origin.unrest.toFixed(0)}，流民${originRefugeesBefore}`, refs: [{ kind: 'entity', entityType: 'region', entityId: origin.id, label: '迁出地' }] },
          { label: '目的地吸引', role: '选择', weight: 0.23, evidence: `${target.destination.name}效用${target.utility.toFixed(1)}`, refs: [{ kind: 'entity', entityType: 'region', entityId: target.destination.id, label: '目的地' }] },
          { label: '运力裁决', role: '条件', weight: 0.2, evidence: `路径剩余容量${capacity}，实际出发${departed}`, refs },
          { label: '迁徙结果', role: '结果', weight: 0.25, evidence: `departed=${departed}=arrived ${peopleArrived}+lost ${peopleLost}`, refs: [{ kind: 'shipment', entityType: 'shipment', entityId: id, label: '人口守恒凭证' }] },
        ],
        stateDeltas: [
          { entityType: 'region', entityId: origin.id, field: 'population', before: originPopulationBefore, after: origin.population, delta: -departed },
          { entityType: 'region', entityId: target.destination.id, field: 'population', before: destinationPopulationBefore, after: target.destination.population, delta: peopleArrived },
          { entityType: 'region', entityId: origin.id, field: 'refugeePopulation', before: originRefugeesBefore, after: origin.refugeePopulation, delta: origin.refugeePopulation - originRefugeesBefore },
          { entityType: 'region', entityId: target.destination.id, field: 'refugeePopulation', before: destinationRefugeesBefore, after: target.destination.refugeePopulation, delta: target.destination.refugeePopulation - destinationRefugeesBefore },
        ],
      });
    }
  }
  ensureHostStates(world);
}

function regionForHost(world: WorldState, state: DiseaseHostState): RegionState | undefined {
  if (state.hostKind === 'region') return world.regions.find((region) => region.id === state.hostId);
  if (state.hostKind === 'army') {
    const army = world.armies.find((item) => item.id === state.hostId);
    return army ? world.regions.find((region) => region.id === army.regionId) : undefined;
  }
  const fleet = world.fleets.find((item) => item.id === state.hostId);
  return fleet?.portRegionId ? world.regions.find((region) => region.id === fleet.portRegionId) : undefined;
}

function sourceStateForShipment(
  states: ReadonlyMap<string, DiseaseHostState>,
  shipment: ShipmentRecord,
  pathogenId: string,
): DiseaseHostState | undefined {
  if (shipment.carrierArmyId) return states.get(infectionId('army', shipment.carrierArmyId, pathogenId));
  if (shipment.carrierFleetId) return states.get(infectionId('fleet', shipment.carrierFleetId, pathogenId));
  return states.get(infectionId('region', shipment.originRegionId, pathogenId));
}

function diseaseClimateFactor(pathogen: PathogenState, region: RegionState | undefined, context: V03TurnContext): number {
  if (!region) return 1;
  const climate = pathogen.climateAffinity.includes(region.climate) ? 1.16 : 0.76;
  const season = pathogen.id === 'pathogen_cold_flux'
    ? context.season === '冬' ? 1.25 : context.season === '夏' ? 0.76 : 1
    : context.season === '夏' ? 1.22 : context.season === '冬' ? 0.78 : 1;
  return climate * season;
}

function validShipment(shipment: ShipmentRecord): boolean {
  return (shipment.status === '交付' || shipment.status === '受损')
    && (shipment.deliveredAmount > 0 || shipment.peopleArrived > 0 || shipment.contactVolume > 0);
}

function arrivalMonth(shipment: ShipmentRecord): 0 | 1 | 2 {
  return shipment.legs.reduce<0 | 1 | 2>((maximum, leg) => Math.max(maximum, leg.month) as 0 | 1 | 2, 0);
}

function applyHostDeaths(world: WorldState, hostKey: string, deaths: number, context: V03TurnContext): number {
  if (deaths <= 0) return 0;
  const [kind, ...idParts] = hostKey.split(':');
  const id = idParts.join(':');
  if (kind === 'region') {
    const region = world.regions.find((item) => item.id === id);
    if (!region) return 0;
    const actual = Math.min(region.population, deaths);
    const refugeeDeaths = Math.min(region.refugeePopulation, integer(actual * region.refugeePopulation / Math.max(1, region.population)));
    region.population -= actual;
    region.refugeePopulation -= refugeeDeaths;
    context.population.civilianDeaths += actual;
    context.health.civilianDeaths += actual;
    return actual;
  }
  if (kind === 'army') {
    const army = world.armies.find((item) => item.id === id);
    if (!army) return 0;
    const actual = applyFormationLosses(world, [army], deaths).reduce((sum, loss) => sum + loss.losses, 0);
    context.population.militaryDeaths += actual;
    context.health.militaryDeaths += actual;
    return actual;
  }
  const fleet = world.fleets.find((item) => item.id === id);
  if (!fleet) return 0;
  const actual = Math.min(fleet.sailors, deaths);
  fleet.sailors -= actual;
  context.population.militaryDeaths += actual;
  context.health.militaryDeaths += actual;
  return actual;
}

export function processV03Disease(world: WorldState, context: V03TurnContext, emit: V03Emit): void {
  ensureHostStates(world);
  const startStates = new Map(world.infections.map((state) => [state.id, { ...state, recentSources: state.recentSources.map((source) => ({ ...source, routeEvidence: [...source.routeEvidence] })) }]));
  context.health.infectiousStart += world.infections.reduce((sum, state) => sum + state.infectious, 0);
  const validShipments = context.trade.shipments.filter(validShipment);
  const importedByState = new Map<string, number>();

  for (let month = 0 as 0 | 1 | 2; month <= 2; month = (month + 1) as 0 | 1 | 2) {
    const snapshots = new Map(world.infections.map((state) => [state.id, { ...state, recentSources: state.recentSources }]));
    const proposed = new Map<string, DiseaseHostState>();
    const ownDeaths = new Map<string, number>();
    const hostDeaths = new Map<string, number>();

    for (const state of [...world.infections].sort((left, right) => stableCompare(left.id, right.id))) {
      const snapshot = snapshots.get(state.id) as DiseaseHostState;
      const pathogen = world.pathogens.find((item) => item.id === state.pathogenId);
      if (!pathogen) continue;
      const region = regionForHost(world, snapshot);
      const population = sumCompartments(snapshot);
      const medicine = region ? practiceEffect(world, region.id, 'disease') : 0;
      const sanitation = region?.sanitation ?? 45;
      const refugeeRatio = region ? region.refugeePopulation / Math.max(1, region.population) : 0;
      const crowding = 1 + (region?.cityLevel ?? 2) * pathogen.crowdingSensitivity * 0.055 + refugeeRatio * 1.8;
      const sanitationFactor = 1 + (50 - sanitation) / 100 * pathogen.sanitationSensitivity;
      const localPressure = population <= 0
        ? 0
        : pathogen.transmissibility * snapshot.infectious / population
          * crowding * sanitationFactor * diseaseClimateFactor(pathogen, region, context) * (1 - medicine);

      let imported = 0;
      const sources: InfectionSource[] = [];
      if (state.hostKind === 'region') {
        for (const shipment of validShipments.filter((item) => item.destinationRegionId === state.hostId && arrivalMonth(item) === month)) {
          const source = sourceStateForShipment(snapshots, shipment, pathogen.id);
          if (!source) continue;
          const sourceTotal = sumCompartments(source);
          if (sourceTotal <= 0 || source.infectious <= 0) continue;
          const contact = Math.max(shipment.contactVolume, shipment.peopleArrived);
          const expected = contact * source.infectious / sourceTotal * pathogen.transmissibility * 0.65;
          const wholeExposures = Math.floor(expected);
          const fractionalExposure = expected - wholeExposures;
          const exposures = wholeExposures + (
            keyedRandom(
              world.seed,
              context.turn,
              'disease-import',
              month,
              shipment.id,
              pathogen.id,
            ) < fractionalExposure ? 1 : 0
          );
          if (exposures <= 0) continue;
          imported += exposures;
          sources.push({
            turn: context.turn,
            sourceHostId: source.hostId,
            shipmentId: shipment.id,
            routeEvidence: shipment.legs.map((leg) => leg.edgeId),
            importedExposures: exposures,
          });
        }
      }
      const localExposures = Math.min(snapshot.susceptible, integer(snapshot.susceptible * localPressure));
      const newExposures = Math.min(snapshot.susceptible, localExposures + imported);
      const toInfectious = Math.min(snapshot.exposed, snapshot.exposed > 0
        ? Math.max(1, integer(snapshot.exposed / pathogen.incubationMonths))
        : 0);
      const exits = Math.min(snapshot.infectious, snapshot.infectious > 0
        ? Math.max(1, integer(snapshot.infectious / pathogen.durationMonths))
        : 0);
      const deaths = Math.min(exits, integer(exits * pathogen.fatality * (1 - medicine * 0.7)));
      const recovered = exits - deaths;
      const waned = Math.min(snapshot.recovered, integer(snapshot.recovered / pathogen.immunityMonths));
      const next: DiseaseHostState = {
        ...snapshot,
        susceptible: snapshot.susceptible - newExposures + waned,
        exposed: snapshot.exposed + newExposures - toInfectious,
        infectious: snapshot.infectious + toInfectious - exits,
        recovered: snapshot.recovered + recovered - waned,
        peakInfectious: Math.max(snapshot.peakInfectious, snapshot.infectious + toInfectious - exits),
        startedTurn: snapshot.startedTurn ?? (newExposures + toInfectious > 0 ? context.turn : null),
        recentSources: [...snapshot.recentSources, ...sources].slice(-4),
      };
      proposed.set(state.id, next);
      ownDeaths.set(state.id, deaths);
      const hostKey = `${state.hostKind}:${state.hostId}`;
      hostDeaths.set(hostKey, (hostDeaths.get(hostKey) ?? 0) + deaths);
      context.health.newExposures += newExposures;
      context.health.importedExposures += Math.min(imported, newExposures);
      if (imported > 0) importedByState.set(state.id, (importedByState.get(state.id) ?? 0) + imported);
    }

    const actualHostDeaths = new Map<string, number>();
    for (const [hostKey, requested] of hostDeaths) actualHostDeaths.set(hostKey, applyHostDeaths(world, hostKey, requested, context));
    for (const state of world.infections) {
      const next = proposed.get(state.id);
      if (!next) continue;
      const hostKey = `${state.hostKind}:${state.hostId}`;
      const extraDeaths = Math.max(0, (actualHostDeaths.get(hostKey) ?? 0) - (ownDeaths.get(state.id) ?? 0));
      const adjusted = proportionalParts({
        susceptible: next.susceptible,
        exposed: next.exposed,
        infectious: next.infectious,
        recovered: next.recovered,
      }, Math.max(0, sumCompartments(next) - extraDeaths));
      state.susceptible = adjusted.susceptible;
      state.exposed = adjusted.exposed;
      state.infectious = adjusted.infectious;
      state.recovered = adjusted.recovered;
      state.peakInfectious = next.peakInfectious;
      state.startedTurn = next.startedTurn;
      state.recentSources = next.recentSources;
    }
  }

  for (const state of world.infections) {
    state.zeroCaseMonths = state.exposed + state.infectious === 0 ? state.zeroCaseMonths + 3 : 0;
    syncHostState(world, state);
  }
  context.health.infectiousEnd += world.infections.reduce((sum, state) => sum + state.infectious, 0);

  for (const state of world.infections.filter((item) => item.hostKind === 'region')) {
    const before = startStates.get(state.id);
    const region = world.regions.find((item) => item.id === state.hostId);
    const pathogen = world.pathogens.find((item) => item.id === state.pathogenId);
    if (!before || !region || !pathogen) continue;
    const threshold = Math.max(12, integer(region.population * 0.0005));
    const contactExposures = importedByState.get(state.id) ?? 0;
    const currentMovementSources = before.recentSources.filter((source) => (
      source.shipmentId !== null && source.turn === context.turn
    ));
    const migratedCases = currentMovementSources.reduce((sum, source) => sum + source.importedExposures, 0);
    const imported = migratedCases + contactExposures;
    const previouslyTracedToShipment = before.recentSources.some((source) => (
      source.shipmentId !== null && source.turn < context.turn
    ));
    if (imported > 0 && !previouslyTracedToShipment) {
      const source = [...state.recentSources].reverse().find((item) => item.shipmentId !== null);
      emit({
        category: '疾病',
        kind: 'disease_imported',
        title: `${region.name}记录${pathogen.name}外来输入`,
        summary: `${region.name}首次记录到${pathogen.name}的外来输入：迁入潜伏或病者${migratedCases}人，沿途接触暴露${contactExposures}人；季末E=${state.exposed}、I=${state.infectious}。`,
        importance: 2,
        polityIds: [region.controllerId],
        regionIds: [region.id],
        causes: [
          { label: '传染源', role: '结构', weight: 0.35, evidence: `源宿主${source?.sourceHostId ?? '不明'}`, refs: [{ kind: 'entity', entityType: 'infection', entityId: source?.sourceHostId ?? state.id, label: '源感染宿主' }] },
          { label: '实际通行', role: '触发', weight: 0.4, evidence: `Shipment ${source?.shipmentId ?? '无'}，路径${source?.routeEvidence.join('>') ?? '无'}`, refs: source?.shipmentId ? [{ kind: 'shipment', entityType: 'shipment', entityId: source.shipmentId, label: '传入流量' }] : [] },
          { label: '外来负担', role: '结果', weight: 0.25, evidence: `迁入E/I=${migratedCases}，接触暴露=${contactExposures}，季末E=${state.exposed}，I=${state.infectious}`, refs: [{ kind: 'entity', entityType: 'infection', entityId: state.id, label: '目的地分舱' }] },
        ],
        stateDeltas: [{ entityType: 'infection', entityId: state.id, field: 'exposed', before: before.exposed, after: state.exposed, delta: state.exposed - before.exposed }],
      });
    }
    if (before.infectious < threshold && state.infectious >= threshold) {
      if (!context.health.outbreakRegionIds.includes(region.id)) context.health.outbreakRegionIds.push(region.id);
      emit({
        category: '疾病',
        kind: 'outbreak_detected',
        title: `${region.name}${pathogen.name}成疫`,
        summary: `${region.name}${pathogen.name}感染者由${before.infectious}增至${state.infectious}，越过成疫阈值${threshold}。`,
        importance: state.infectious >= threshold * 4 ? 4 : 3,
        polityIds: [region.controllerId],
        regionIds: [region.id],
        causes: [
          { label: '本地传播', role: '结构', weight: 0.38, evidence: `期初I=${before.infectious}，城市等级${region.cityLevel}` },
          { label: '卫生与流民', role: '条件', weight: 0.27, evidence: `卫生${region.sanitation}，流民${region.refugeePopulation}` },
          { label: '外来暴露', role: '触发', weight: 0.2, evidence: `当季实际输入${imported}` },
          { label: '阈值裁决', role: '结果', weight: 0.15, evidence: `I=${state.infectious}≥${threshold}`, refs: [{ kind: 'entity', entityType: 'infection', entityId: state.id, label: '疫情分舱' }] },
        ],
        stateDeltas: [{ entityType: 'infection', entityId: state.id, field: 'infectious', before: before.infectious, after: state.infectious, delta: state.infectious - before.infectious }],
      });
    }
  }

  for (const character of world.characters.filter((item) => item.alive)) {
    const regionalStates = world.infections.filter((state) => (
      state.hostKind === 'region' && state.hostId === character.locationRegionId
    ));
    const previousHealth = character.health;
    if (character.activeDiseaseId) {
      const active = regionalStates.find((state) => state.pathogenId === character.activeDiseaseId);
      const pathogen = world.pathogens.find((item) => item.id === character.activeDiseaseId);
      const recoveryChance = active && active.infectious > 0 ? 0.2 + character.health / 500 : 0.72;
      if (keyedRandom(world.seed, context.turn, 'named-health', character.id, 'recovery') < recoveryChance) {
        character.activeDiseaseId = null;
        character.health = Math.round(clamp(character.health + 7));
      } else {
        const severity = 2 + Math.round((pathogen?.fatality ?? 0.02) * 140)
          + Math.floor(keyedRandom(world.seed, context.turn, 'named-health', character.id, 'severity') * 5);
        character.health = Math.round(clamp(character.health - severity));
      }
    } else {
      const exposure = [...regionalStates]
        .filter((state) => state.infectious > 0)
        .sort((left, right) => (
          right.infectious / Math.max(1, sumCompartments(right))
          - left.infectious / Math.max(1, sumCompartments(left))
          || stableCompare(left.pathogenId, right.pathogenId)
        ))[0];
      const prevalence = exposure ? exposure.infectious / Math.max(1, sumCompartments(exposure)) : 0;
      const illnessChance = Math.min(0.32, prevalence * 18);
      if (exposure && keyedRandom(world.seed, context.turn, 'named-health', character.id, 'exposure') < illnessChance) {
        character.activeDiseaseId = exposure.pathogenId;
        character.health = Math.round(clamp(character.health - 4 - Math.floor(prevalence * 80)));
      } else {
        character.health = Math.round(clamp(character.health + 1));
      }
    }
    if (previousHealth >= 45 && character.health < 45 && character.activeDiseaseId) {
      const pathogen = world.pathogens.find((item) => item.id === character.activeDiseaseId);
      const region = world.regions.find((item) => item.id === character.locationRegionId);
      emit({
        category: '疾病',
        kind: 'notable_person_ill',
        title: `${character.name}染患${pathogen?.name ?? '时疫'}`,
        summary: `${character.name}身处${region?.name ?? '疫区'}并因当地实际感染压力患病，健康降至${character.health}；具名人物是群体人口中的叙事标记，不重复扣减人口。`,
        importance: character.role === '君主' ? 3 : 2,
        actorIds: [character.id],
        polityIds: [character.polityId],
        regionIds: region ? [region.id] : [],
        causes: [
          { label: '当地疫情', role: '结构', weight: 0.42, evidence: `${region?.name ?? character.locationRegionId}存在${pathogen?.name ?? character.activeDiseaseId}感染宿主`, refs: region ? [{ kind: 'entity', entityType: 'region', entityId: region.id, label: '人物所在疫区' }] : [] },
          { label: '个体健康', role: '条件', weight: 0.28, evidence: `健康${previousHealth}→${character.health}` },
          { label: '染病结果', role: '结果', weight: 0.3, evidence: `activeDiseaseId=${character.activeDiseaseId}`, refs: [{ kind: 'entity', entityType: 'character', entityId: character.id, field: 'health', label: '人物健康' }] },
        ],
        stateDeltas: [
          { entityType: 'character', entityId: character.id, field: 'health', before: previousHealth, after: character.health, delta: character.health - previousHealth },
          { entityType: 'character', entityId: character.id, field: 'activeDiseaseId', before: null, after: character.activeDiseaseId },
        ],
      });
    }
  }
}

function practiceState(world: WorldState, regionId: string, practiceId: string): RegionPracticeState | undefined {
  return world.practiceStates.find((state) => state.regionId === regionId && state.practiceId === practiceId);
}

export function practiceEffect(world: WorldState, regionId: string, effectKey: EffectKey): number {
  let total = 0;
  for (const definition of world.practices.filter((practice) => practice.effectKey === effectKey)) {
    const state = practiceState(world, regionId, definition.id);
    if (!state || state.lostTurn !== null || state.adoption <= 0 || state.mastery <= 0) continue;
    if (!state.legacyBaseline && (state.adoptedTurn === null || world.turn <= state.adoptedTurn)) continue;
    total += definition.effectStrength * clamp(state.mastery) / 100 * clamp(state.adoption) / 100;
  }
  return clamp(total, 0, 0.8);
}

function relevantTalent(world: WorldState, regionId: string, category: PracticeCategory): { factor: number; ids: string[] } {
  const people = world.characters.filter((character) => character.alive && character.locationRegionId === regionId);
  const scored = people.map((character) => {
    const score = category === '军事' || category === '航海'
      ? character.leadership * 0.65 + character.cunning * 0.35
      : category === '商业'
        ? character.cunning * 0.65 + character.governance * 0.35
        : character.governance * 0.68 + character.cunning * 0.32;
    return { id: character.id, score };
  }).sort((left, right) => right.score - left.score || stableCompare(left.id, right.id));
  const region = world.regions.find((item) => item.id === regionId);
  const anonymousCraft = (region?.cityLevel ?? 0) * 0.06;
  return { factor: clamp((scored[0]?.score ?? 0) / 100 + anonymousCraft, 0, 1), ids: scored.slice(0, 3).map((item) => item.id) };
}

function materialFactor(region: RegionState, category: PracticeCategory): number {
  const goods = region.goods;
  const potential = region.resourcePotential;
  const stock = (key: keyof typeof goods): number => goods[key] + potential[key] * 0.25;
  if (category === '农业') return clamp((stock('铁器') + stock('木材')) / 1_500, 0, 1);
  if (category === '军事') return clamp((stock('铁器') + stock('马匹') * 0.4) / 1_200, 0, 1);
  if (category === '工程') return clamp((stock('木材') + stock('铁器')) / 1_800, 0, 1);
  if (category === '医学') return clamp((stock('盐') + region.sanitation * 8) / 1_200, 0, 1);
  if (category === '商业') return clamp((region.marketLevel + region.cityLevel) / 8, 0, 1);
  return region.port ? clamp((stock('木材') + region.portLevel * 500) / 2_000, 0, 1) : 0;
}

function practiceSignals(
  world: WorldState,
  context: V03TurnContext,
  region: RegionState,
  category: PracticeCategory,
): { pressure: number; experiment: number } {
  const shipments = context.trade.shipments.filter((shipment) => validShipment(shipment)
    && (shipment.originRegionId === region.id || shipment.destinationRegionId === region.id));
  const atWar = world.wars.some((war) => war.active && (war.attackerId === region.controllerId || war.defenderId === region.controllerId));
  if (category === '农业') {
    const reserve = region.food / Math.max(1, region.population);
    return { pressure: clamp((1.8 - reserve) * 35 + (100 - region.fertility) * 0.25, 0, 100), experiment: region.population > 0 ? 0.8 : 0 };
  }
  if (category === '军事') {
    const armies = world.armies.filter((army) => army.regionId === region.id);
    const supplyPressure = armies.reduce((sum, army) => sum + Math.max(0, 60 - army.supply), 0);
    return { pressure: clamp((atWar ? 58 : 5) + supplyPressure * 0.25, 0, 100), experiment: armies.length > 0 ? (atWar ? 1 : 0.45) : 0 };
  }
  if (category === '工程') return { pressure: clamp(region.devastation * 0.8 + (region.river ? 18 : 0), 0, 100), experiment: region.river || region.devastation > 15 ? 0.75 : 0.15 };
  if (category === '医学') {
    const infected = world.infections.filter((state) => state.hostKind === 'region' && state.hostId === region.id)
      .reduce((sum, state) => sum + state.infectious, 0);
    return { pressure: clamp(infected / Math.max(1, region.population) * 4_000 + (60 - region.sanitation) * 0.7, 0, 100), experiment: infected > 0 ? 1 : 0.12 };
  }
  if (category === '商业') return { pressure: clamp(shipments.length * 16 + (5 - region.marketLevel) * 5, 0, 100), experiment: shipments.length > 0 ? 1 : 0 };
  const seaShipments = shipments.filter((shipment) => shipment.legs.some((leg) => leg.kind !== 'route'));
  const localFleet = world.fleets.some((fleet) => fleet.portRegionId === region.id || fleet.homePortRegionId === region.id);
  return { pressure: clamp(seaShipments.length * 22 + (region.port ? 12 : 0), 0, 100), experiment: seaShipments.length > 0 ? 1 : localFleet ? 0.45 : 0 };
}

function institutionFactor(world: WorldState, region: RegionState): number {
  const polity = world.polities.find((item) => item.id === region.controllerId);
  return clamp(region.cityLevel * 0.11 + region.marketLevel * 0.06 + (polity?.administration ?? 30) / 250, 0, 1);
}

function shipmentSpreadGain(source: RegionPracticeState, shipment: ShipmentRecord): number {
  const contact = Math.max(shipment.contactVolume, shipment.peopleArrived, shipment.deliveredAmount);
  if (contact <= 0) return 0;
  const signal = source.mastery / 100 * source.adoption / 100;
  return Math.min(12, signal * Math.log10(1 + contact) * 4);
}

function knowledgeRef(shipment: ShipmentRecord): EvidenceRef {
  return { kind: 'shipment', entityType: 'shipment', entityId: shipment.id, label: '知识传播所依的实际流量' };
}

export function processV03Knowledge(world: WorldState, context: V03TurnContext, emit: V03Emit): void {
  const snapshots = new Map(world.practiceStates.map((state) => [state.id, { ...state, carrierCharacterIds: [...state.carrierCharacterIds] }]));
  const spreadInto = new Set<string>();

  for (const region of [...world.regions].sort((left, right) => stableCompare(left.id, right.id))) {
    for (const definition of world.practices) {
      const state = practiceState(world, region.id, definition.id);
      const before = state ? snapshots.get(state.id) : undefined;
      if (!state || !before) continue;
      const talent = relevantTalent(world, region.id, definition.category);
      const material = materialFactor(region, definition.category);
      const signals = practiceSignals(world, context, region, definition.category);
      const institution = institutionFactor(world, region);
      const diversity = clamp(0.35 + region.cityLevel * 0.09 + context.trade.shipments.filter((shipment) => validShipment(shipment)
        && shipment.destinationRegionId === region.id).length * 0.06, 0, 1);
      const delta = signals.pressure * talent.factor * diversity * institution * material * signals.experiment * 0.018;
      if (state.lostTurn !== null && delta > 0) state.innovationProgress = Math.min(100, state.innovationProgress + delta * 0.6);
      else if (state.prototypeTurn === null) state.innovationProgress = Math.min(100, state.innovationProgress + delta);

      if (state.prototypeTurn === null && state.innovationProgress >= 100) {
        state.prototypeTurn = context.turn;
        state.lostTurn = null;
        state.legacyBaseline = false;
        state.mastery = Math.max(state.mastery, 14);
        state.carrierStrength = Math.max(state.carrierStrength, 12);
        state.carrierCharacterIds = talent.ids;
        state.lastUsedTurn = context.turn;
        context.knowledge.prototypeIds.push(state.id);
        emit({
          category: '知识',
          kind: 'practice_prototype',
          title: `${region.name}形成${definition.name}原型`,
          summary: `${definition.name}由当地问题、人才、材料与实际试用共同推至原型，并非按年代解锁。`,
          importance: 3,
          actorIds: talent.ids,
          polityIds: [region.controllerId],
          regionIds: [region.id],
          causes: [
            { label: '未解决问题', role: '结构', weight: 0.3, evidence: `问题压力${signals.pressure.toFixed(1)}`, refs: [{ kind: 'entity', entityType: 'region', entityId: region.id, label: '实践产生地' }] },
            { label: '人才与机构', role: '条件', weight: 0.25, evidence: `人才${talent.factor.toFixed(2)}，机构${institution.toFixed(2)}` },
            { label: '材料与试用', role: '条件', weight: 0.25, evidence: `材料${material.toFixed(2)}，试用${signals.experiment.toFixed(2)}` },
            { label: '累积结果', role: '结果', weight: 0.2, evidence: `创新进度${before.innovationProgress.toFixed(1)}→100`, refs: [{ kind: 'entity', entityType: 'practice', entityId: state.id, label: '地方实践状态' }] },
          ],
          stateDeltas: [{ entityType: 'practice', entityId: state.id, field: 'prototypeTurn', before: null, after: context.turn }],
        });
      }

      const actuallyUsed = signals.experiment >= 0.4 && material > 0.15;
      if (state.prototypeTurn !== null && state.lostTurn === null && actuallyUsed) {
        state.lastUsedTurn = context.turn;
        state.mastery = clamp(state.mastery + 0.35 + signals.experiment * 0.45);
        state.carrierStrength = clamp(state.carrierStrength + 0.25 + talent.factor * 0.4);
        const adoptionBefore = state.adoption;
        const adoptionGain = state.mastery / 100 * institution * material * (0.6 + signals.pressure / 100) * 3.2;
        state.adoption = clamp(state.adoption + adoptionGain);
        if (adoptionBefore < 25 && state.adoption >= 25) {
          state.adoptedTurn = context.turn;
          context.knowledge.adoptedIds.push(state.id);
          emit({
            category: '知识', kind: 'practice_adopted', title: `${region.name}开始普及${definition.name}`,
            summary: `${definition.name}在掌握、材料、机构支持与反复使用后越过采用阈值；效果从下季开始。`,
            importance: 2, actorIds: talent.ids, polityIds: [region.controllerId], regionIds: [region.id],
            causes: [
              { label: '已掌握实践', role: '结构', weight: 0.35, evidence: `掌握度${state.mastery.toFixed(1)}` },
              { label: '采用条件', role: '条件', weight: 0.35, evidence: `机构${institution.toFixed(2)}，材料${material.toFixed(2)}` },
              { label: '采用阈值', role: '结果', weight: 0.3, evidence: `${adoptionBefore.toFixed(1)}→${state.adoption.toFixed(1)}`, refs: [{ kind: 'entity', entityType: 'practice', entityId: state.id, label: '地方实践状态' }] },
            ],
            stateDeltas: [{ entityType: 'practice', entityId: state.id, field: 'adoption', before: adoptionBefore, after: state.adoption, delta: state.adoption - adoptionBefore }],
          });
        }
      }
    }
  }

  for (const shipment of context.trade.shipments.filter(validShipment)) {
    for (const definition of world.practices) {
      const sourceId = practiceStateId(shipment.originRegionId, definition.id);
      const source = snapshots.get(sourceId);
      const destination = practiceState(world, shipment.destinationRegionId, definition.id);
      if (!source || !destination || source.mastery < 20 || source.adoption < 10 || source.lostTurn !== null) continue;
      const gain = shipmentSpreadGain(source, shipment);
      if (gain <= 0) continue;
      const beforeMastery = destination.mastery;
      destination.mastery = clamp(destination.mastery + gain);
      destination.carrierStrength = clamp(destination.carrierStrength + gain * 0.7);
      destination.sourceRegionId = shipment.originRegionId;
      destination.sourceShipmentId = shipment.id;
      destination.lostTurn = null;
      spreadInto.add(destination.id);
      if (beforeMastery < 10 && destination.mastery >= 10) {
        destination.prototypeTurn ??= context.turn;
        destination.lastUsedTurn = context.turn;
        destination.legacyBaseline = false;
        context.knowledge.spreadIds.push(destination.id);
        const destinationRegion = world.regions.find((region) => region.id === shipment.destinationRegionId);
        emit({
          category: '知识', kind: 'practice_spread', title: `${definition.name}传入${destinationRegion?.name ?? shipment.destinationRegionId}`,
          summary: `${definition.name}仅由Shipment ${shipment.id}的实际交付传入，本季新掌握地不能继续外传。`,
          importance: 2,
          polityIds: destinationRegion ? [destinationRegion.controllerId] : [],
          regionIds: [shipment.originRegionId, shipment.destinationRegionId],
          causes: [
            { label: '源地掌握', role: '结构', weight: 0.35, evidence: `源地掌握${source.mastery.toFixed(1)}，采用${source.adoption.toFixed(1)}`, refs: [{ kind: 'entity', entityType: 'practice', entityId: source.id, label: '源地实践' }] },
            { label: '实际流量', role: '触发', weight: 0.4, evidence: `Shipment ${shipment.id}，接触量${shipment.contactVolume}`, refs: [knowledgeRef(shipment)] },
            { label: '传播结果', role: '结果', weight: 0.25, evidence: `目的地掌握${beforeMastery.toFixed(1)}→${destination.mastery.toFixed(1)}` },
          ],
          stateDeltas: [{ entityType: 'practice', entityId: destination.id, field: 'mastery', before: beforeMastery, after: destination.mastery, delta: destination.mastery - beforeMastery }],
        });
      }
    }
  }

  for (const state of world.practiceStates) {
    if (state.prototypeTurn === null || state.lostTurn !== null || spreadInto.has(state.id)) continue;
    if (context.turn - state.lastUsedTurn < 12) continue;
    const beforeMastery = state.mastery;
    state.carrierStrength = clamp(state.carrierStrength - 2.5);
    state.mastery = clamp(state.mastery - (state.carrierStrength < 10 ? 3 : 1));
    state.adoption = clamp(state.adoption - 2);
    if (state.mastery >= 5 || state.adoption >= 3 || context.turn - state.lastUsedTurn < 20) continue;
    state.lostTurn = context.turn;
    context.knowledge.lostIds.push(state.id);
    const region = world.regions.find((item) => item.id === state.regionId);
    const definition = world.practices.find((item) => item.id === state.practiceId);
    emit({
      category: '知识', kind: 'practice_lost', title: `${region?.name ?? state.regionId}${definition?.name ?? '实践'}失传`,
      summary: `长期无实际使用且载体衰退，${definition?.name ?? '实践'}在当地失传，但可经重新试验或交流恢复。`,
      importance: 2, polityIds: region ? [region.controllerId] : [], regionIds: region ? [region.id] : [],
      causes: [
        { label: '长期无使用', role: '结构', weight: 0.45, evidence: `上次使用回合${state.lastUsedTurn}，当前${context.turn}` },
        { label: '载体衰退', role: '条件', weight: 0.3, evidence: `载体强度${state.carrierStrength.toFixed(1)}` },
        { label: '失传阈值', role: '结果', weight: 0.25, evidence: `掌握${beforeMastery.toFixed(1)}→${state.mastery.toFixed(1)}，采用${state.adoption.toFixed(1)}`, refs: [{ kind: 'entity', entityType: 'practice', entityId: state.id, label: '失传实践' }] },
      ],
      stateDeltas: [{ entityType: 'practice', entityId: state.id, field: 'lostTurn', before: null, after: context.turn }],
    });
  }
}
