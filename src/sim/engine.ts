import {
  FAMILY_NAMES,
  GIVEN_NAMES,
  POLITY_DEFINITIONS,
  REGION_DEFINITIONS,
  ROUTE_DEFINITIONS,
  type PolityDefinition,
} from './data';
import { keyedChance, keyedInt, keyedRandom, stableCompare, stableHash } from './random';
import {
  emitSimulationFact,
  projectFactLinks,
  type BattleFact,
  type SimulationFact,
  type WarEndedFact,
  type WarEndResult,
  type WarStartedFact,
} from './facts';
import {
  type SimulationAdvanceTimings,
} from './advance-timing';
import { createTurnPipelineRunner } from './turn-pipeline';
import type { V03TurnContext } from './v03-context';
import {
  createV03LifeSystems,
  practiceEffect,
  processV03Disease,
  processV03Knowledge,
  processV03Migration,
} from './v03-life';
import {
  createV03OceanSystems,
  processV03EconomyAndTrade,
  processV03Maritime,
} from './v03-ocean';
import { processV03Diplomacy } from './v03-diplomacy';
import {
  createV02WorldSystems,
  establishRulingFamilyBranch,
  getDiplomacy,
  markPeaceDiplomacy,
  markWarDiplomacy,
  processV02Diplomacy,
  processV02MilitaryCareers,
  processV02Politics,
  processV02Society,
  promoteBackgroundPerson,
  recordDiplomaticCommitmentBreach,
  syncOfficeAppointments,
} from './v02';
import { createSituationSystemState, processSituationSystem } from './situations';
import { createAgencySystemState, reducePersonalMemorySystem } from './agency/memory';
import {
  createAgencyDecisionSystemState,
  processAgencyDecisionSystem,
  type AgencyDecisionTurnContext,
} from './agency/decision';
import { refreshFactionPowerLedgers } from './politics/power-ledger';
import {
  SEASONS,
  type ArmyState,
  type CharacterState,
  type EventCause,
  type HistoryEvent,
  type PolityState,
  type RegionState,
  type RouteState,
  type Season,
  type StateDelta,
  type WarState,
  type WorldState,
} from './types';

interface MutableTurnContext extends V03TurnContext, AgencyDecisionTurnContext {}

interface EventInput {
  category: HistoryEvent['category'];
  kind: string;
  title: string;
  summary: string;
  importance: HistoryEvent['importance'];
  actorIds?: string[];
  polityIds?: string[];
  regionIds?: string[];
  causes: EventCause[];
  evidence?: string[];
  stateDeltas?: StateDelta[];
  sourceFactIds?: string[];
  situationIds?: string[];
}

const INITIAL_CHARACTER_COUNT_PER_POLITY = 24;
const MIN_ARMY_SIZE = 250;
const MIN_NEW_ARMY_SIZE = 1_500;

function lifeStageForAge(age: number, alive = true): CharacterState['lifeStage'] {
  if (!alive) return '已故';
  if (age < 8) return '幼年';
  if (age < 16) return '成长';
  if (age < 30) return '成年';
  if (age < 60) return '盛年';
  return '衰老';
}

function armyEquipmentCost(soldiers: number): number {
  return Math.ceil(soldiers / 4);
}

function supportedNewArmySize(availableTreasury: number, population: number): number {
  return Math.min(7_000, integer(population * 0.035), integer(availableTreasury) * 4);
}

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function integer(value: number): number {
  return Math.max(0, Math.floor(value));
}

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

export function getDateForTurn(turn: number): { year: number; season: Season } {
  const safeTurn = Math.max(0, Math.floor(turn));
  return {
    year: Math.floor(safeTurn / SEASONS.length) + 1,
    season: SEASONS[safeTurn % SEASONS.length] as Season,
  };
}

function makePolygon(x: number, y: number, terrain: RegionState['terrain']): RegionState['polygon'] {
  const radius = terrain === '山地' || terrain === '岛屿' ? 24 : 29;
  return Array.from({ length: 6 }, (_, index) => {
    const angle = (Math.PI / 3) * index - Math.PI / 6;
    return {
      x: Math.round(x + Math.cos(angle) * radius),
      y: Math.round(y + Math.sin(angle) * radius),
    };
  });
}

function routeDistance(from: RegionState, to: RegionState): number {
  return Math.max(1, Math.round(Math.hypot(from.x - to.x, from.y - to.y)));
}

function createRegions(seed: string): RegionState[] {
  return REGION_DEFINITIONS.map((definition) => {
    const populationVariance = 0.9 + keyedRandom(seed, 'initial', 'population', definition.id) * 0.2;
    const population = integer(definition.populationBase * populationVariance);
    const reserveVariance = 2.15 + keyedRandom(seed, 'initial', 'food', definition.id) * 0.75;
    return {
      id: definition.id,
      name: definition.name,
      x: definition.x,
      y: definition.y,
      polygon: makePolygon(definition.x, definition.y, definition.terrain),
      terrain: definition.terrain,
      climate: definition.climate,
      river: definition.river,
      port: definition.port,
      neighbors: [],
      routeIds: [],
      controllerId: definition.initialControllerId,
      population,
      food: integer(population * reserveVariance),
      wealth: integer(population * (0.35 + definition.cityLevel * 0.08)),
      cityLevel: definition.cityLevel,
      defense: definition.defense,
      strategicValue: definition.strategicValue,
      fertility: definition.fertility,
      devastation: 0,
      unrest: keyedInt(seed, 2, 12, 'initial', 'unrest', definition.id),
      refugeePopulation: 0,
      sanitation: Math.min(100, 22 + definition.cityLevel * 9),
      medicalCapacity: Math.min(100, 16 + definition.cityLevel * 8),
      marketLevel: Math.min(5, Math.max(1, definition.cityLevel)),
      portLevel: definition.port ? Math.min(4, Math.max(1, definition.cityLevel)) : 0,
      goods: { '木材': 0, '铁器': 0, '马匹': 0, '盐': 0, '纺织品': 0, '奢侈品': 0 },
      prices: { '粮食': 100, '木材': 100, '铁器': 100, '马匹': 100, '盐': 100, '纺织品': 100, '奢侈品': 100 },
      resourcePotential: { '木材': 50, '铁器': 50, '马匹': 50, '盐': 50, '纺织品': 50, '奢侈品': 50 },
    };
  });
}

function createRoutes(regions: RegionState[]): RouteState[] {
  const regionById = new Map(regions.map((region) => [region.id, region]));
  const routes = ROUTE_DEFINITIONS.map((definition, index) => {
    const from = regionById.get(definition.fromRegionId);
    const to = regionById.get(definition.toRegionId);
    if (!from || !to) throw new Error('Map route references an unknown region');
    const route: RouteState = {
      id: definition.id ?? `route_${String(index + 1).padStart(2, '0')}`,
      fromRegionId: from.id,
      toRegionId: to.id,
      kind: definition.kind,
      distance: routeDistance(from, to),
      supplyCapacity: definition.supplyCapacity,
    };
    from.neighbors.push(to.id);
    from.routeIds.push(route.id);
    to.neighbors.push(from.id);
    to.routeIds.push(route.id);
    return route;
  });

  for (const region of regions) {
    region.neighbors.sort(stableCompare);
    region.routeIds.sort(stableCompare);
  }
  return routes;
}

function uniqueName(
  seed: string,
  key: string,
  usedNames: Set<string>,
  forcedFamily?: string,
): { familyName: string; givenName: string; name: string } {
  const familyName = forcedFamily
    ?? FAMILY_NAMES[keyedInt(seed, 0, FAMILY_NAMES.length - 1, 'name', key, 'family')];
  const start = keyedInt(seed, 0, GIVEN_NAMES.length - 1, 'name', key, 'given');
  for (let offset = 0; offset < GIVEN_NAMES.length; offset += 1) {
    const givenName = GIVEN_NAMES[(start + offset) % GIVEN_NAMES.length] as string;
    const name = `${familyName}${givenName}`;
    if (!usedNames.has(name)) {
      usedNames.add(name);
      return { familyName, givenName, name };
    }
  }
  const givenName = GIVEN_NAMES[start] as string;
  const name = `${familyName}${givenName}·${usedNames.size + 1}`;
  usedNames.add(name);
  return { familyName, givenName, name };
}

function createInitialCharacters(
  seed: string,
  polity: PolityDefinition,
  polityRegions: RegionState[],
  globalStart: number,
  usedNames: Set<string>,
): CharacterState[] {
  const capital = polity.capitalRegionId;
  const nonCapitalRegions = polityRegions
    .filter((region) => region.id !== capital)
    .sort((left, right) => stableCompare(left.id, right.id));
  const rulerIdentity = uniqueName(seed, `${polity.id}:0`, usedNames);

  return Array.from({ length: INITIAL_CHARACTER_COUNT_PER_POLITY }, (_, index) => {
    const identity = index === 0
      ? rulerIdentity
      : uniqueName(
        seed,
        `${polity.id}:${index}`,
        usedNames,
        index === 8 || index === 9 ? rulerIdentity.familyName : undefined,
      );
    const governedRegion = index >= 3 && index < 8
      ? nonCapitalRegions[index - 3]?.id ?? null
      : null;
    const locationRegionId = governedRegion ?? capital;
    const role: CharacterState['role'] = index === 0
      ? '君主'
      : governedRegion
        ? '地方长官'
        : index === 1 || index === 2
          ? '将领'
          : '廷臣';
    const ageRange = index === 0
      ? [43, 65]
      : governedRegion
        ? [30, 55]
        : index === 1 || index === 2
          ? [27, 49]
          : [18, 48];

    return {
      id: `c_${String(globalStart + index + 1).padStart(3, '0')}`,
      ...identity,
      sex: keyedChance(seed, 0.28, 'character', polity.id, index, 'sex') ? '女' : '男',
      age: keyedInt(seed, ageRange[0] as number, ageRange[1] as number, 'character', polity.id, index, 'age'),
      alive: true,
      deathTurn: null,
      polityId: polity.id,
      locationRegionId,
      role,
      governedRegionId: governedRegion,
      commandingArmyId: null,
      commandingFleetId: null,
      leadership: keyedInt(seed, 28, 91, 'character', polity.id, index, 'leadership'),
      governance: keyedInt(seed, 28, 91, 'character', polity.id, index, 'governance'),
      cunning: keyedInt(seed, 25, 93, 'character', polity.id, index, 'cunning'),
      ambition: index === 0 ? keyedInt(seed, 55, 90, 'character', polity.id, index, 'ambition') : keyedInt(seed, 18, 94, 'character', polity.id, index, 'ambition'),
      loyalty: index === 0 ? 100 : keyedInt(seed, index === 8 || index === 9 ? 58 : 25, 96, 'character', polity.id, index, 'loyalty'),
      caution: keyedInt(seed, 18, 92, 'character', polity.id, index, 'caution'),
      rebellionReadiness: index === 0 ? 0 : keyedInt(seed, 0, 12, 'character', polity.id, index, 'rebellion-readiness'),
      renown: index === 0 ? 45 : keyedInt(seed, 2, 28, 'character', polity.id, index, 'renown'),
      birthTurn: -keyedInt(seed, ageRange[0] as number, ageRange[1] as number, 'character', polity.id, index, 'age') * 4,
      adultTurn: 0,
      lifeStage: '成年',
      familyId: '',
      parentIds: [],
      spouseIds: [],
      politicalClass: index === 0 || index === 8 || index === 9
        ? '宗室'
        : governedRegion
          ? '地方豪强'
          : index === 1 || index === 2
            ? '军门'
            : index % 3 === 0
              ? '士族'
              : '官僚',
      influence: index === 0 ? 72 : keyedInt(seed, 12, 48, 'character', polity.id, index, 'influence'),
      personalWealth: keyedInt(seed, 8, 42, 'character', polity.id, index, 'wealth'),
      merit: index === 0 ? 35 : keyedInt(seed, 0, 22, 'character', polity.id, index, 'merit'),
      deputyExperience: 0,
      insubordination: 0,
      biography: [],
      biographyDigest: stableHash([]),
      tier: '核心',
      sourceStubId: null,
      health: 100,
      activeDiseaseId: null,
      protectedUntilTurn: null,
    };
  });
}

function createPolity(seed: string, definition: PolityDefinition, ruler: CharacterState, regions: RegionState[]): PolityState {
  const controlledRegionIds = regions
    .filter((region) => region.controllerId === definition.id)
    .map((region) => region.id)
    .sort(stableCompare);
  const regionalWealth = regions
    .filter((region) => region.controllerId === definition.id)
    .reduce((sum, region) => sum + region.wealth, 0);
  return {
    id: definition.id,
    name: definition.name,
    shortName: definition.shortName,
    dynastyName: `${ruler.familyName}氏`,
    color: definition.color,
    alive: true,
    foundedTurn: 0,
    eliminatedTurn: null,
    rulerId: ruler.id,
    capitalRegionId: definition.capitalRegionId,
    controlledRegionIds,
    treasury: integer(regionalWealth * 0.18),
    legitimacy: keyedInt(seed, 58, 82, 'polity', definition.id, 'legitimacy'),
    authority: keyedInt(seed, 56, 80, 'polity', definition.id, 'authority'),
    administration: keyedInt(seed, 48, 77, 'polity', definition.id, 'administration'),
    warWeariness: 0,
    taxRate: keyedInt(seed, 9, 14, 'polity', definition.id, 'tax') / 100,
    lastWarTurn: -20,
    lastRebellionTurn: -100,
    rulingFamilyId: null,
    governmentForm: definition.id === 'p_canghai' ? '盟约' : '王朝',
    courtInfluence: 50,
    lastCourtCrisisTurn: -100,
    tradeRevenue: 0,
    navalBudget: 0,
    maritimeOrientation: definition.id === 'p_canghai' ? 72 : definition.capitalRegionId === 'r_qizhou' ? 42 : 24,
    diplomaticReputation: 60,
  };
}

function borderRegionFor(world: WorldState, polityId: string, ordinal: number): RegionState {
  const owned = world.regions.filter((region) => region.controllerId === polityId);
  const border = owned
    .filter((region) => region.neighbors.some((neighborId) => world.regions.find((item) => item.id === neighborId)?.controllerId !== polityId))
    .sort((left, right) => right.strategicValue - left.strategicValue || stableCompare(left.id, right.id));
  return border[ordinal % Math.max(1, border.length)] ?? owned[ordinal % owned.length] as RegionState;
}

function createInitialArmies(world: WorldState): void {
  for (const polity of world.polities.sort((left, right) => stableCompare(left.id, right.id))) {
    const commanders = world.characters
      .filter((character) => character.polityId === polity.id && character.role === '将领')
      .sort((left, right) => stableCompare(left.id, right.id));
    for (let index = 0; index < 2; index += 1) {
      const commander = commanders[index] as CharacterState;
      const region = index === 0
        ? world.regions.find((item) => item.id === polity.capitalRegionId) as RegionState
        : borderRegionFor(world, polity.id, index);
      const requested = keyedInt(world.seed, 6_500, 9_200, 'initial', 'army', polity.id, index);
      const soldiers = Math.min(requested, integer(region.population * 0.06));
      region.population -= soldiers;
      const food = Math.min(region.food, soldiers * 2);
      region.food -= food;
      world.counters.army += 1;
      const army: ArmyState = {
        id: `a_${String(world.counters.army).padStart(3, '0')}`,
        name: `${region.name}${index === 0 ? '中军' : '行营'}`,
        polityId: polity.id,
        commanderId: commander.id,
        deputyCommanderId: null,
        regionId: region.id,
        originRegionId: region.id,
        soldiers,
        morale: keyedInt(world.seed, 58, 78, 'initial', 'army', polity.id, index, 'morale'),
        training: keyedInt(world.seed, 42, 70, 'initial', 'army', polity.id, index, 'training'),
        experience: keyedInt(world.seed, 10, 35, 'initial', 'army', polity.id, index, 'experience'),
        supply: 100,
        food,
        lastMovedTurn: -1,
        embarkedOperationId: null,
      };
      commander.commandingArmyId = army.id;
      commander.locationRegionId = region.id;
      world.armies.push(army);
    }
  }
}

function initialHistoryEvent(world: WorldState): HistoryEvent {
  return {
    id: 'event_000001',
    turn: 0,
    year: 1,
    season: '春',
    category: '世界',
    kind: 'world_created',
    title: '诸国纪元开启',
    summary: `${world.regions.length}处州域、${world.seaZones.length}片海域、${world.polities.length}方政权与${world.characters.length}名核心人物进入同一条可推演的历史。`,
    importance: 5,
    actorIds: world.characters.map((character) => character.id),
    polityIds: world.polities.map((polity) => polity.id),
    regionIds: world.regions.map((region) => region.id),
    causes: [
      { label: '世界种子', role: '结构', weight: 1, evidence: `本局由字符串种子“${world.seed}”确定` },
    ],
    evidence: [`固定地图含${world.regions.length}个区域与${world.seaZones.length}片海域`, `初始政权${world.polities.length}个`, `初始核心人物${world.characters.length}名`],
    stateDeltas: [],
    sourceFactIds: [],
    situationIds: [],
  };
}

export function computeWorldHash(world: WorldState): string {
  const schemaVersion = (world as unknown as { schemaVersion: number }).schemaVersion;
  if (schemaVersion === 1) {
    const legacy: Record<string, unknown> = { ...world };
    delete legacy.hash;
    delete legacy.history;
    return stableHash(legacy);
  }
  // Unbounded narrative archives are authenticated by historyDigest and compact
  // per-character biographyDigest. Only current/decision-relevant institutional
  // records enter the quarterly snapshot hash, preventing an O(history) tick.
  const legacyCharacters = world.characters.map((character) => {
    const { biography: _biography, ...authoritativeCharacter } = character;
    void _biography;
    return authoritativeCharacter;
  });
  const v02Snapshot = {
    schemaVersion: world.schemaVersion,
    seed: world.seed,
    turn: world.turn,
    year: world.year,
    season: world.season,
    regions: world.regions,
    routes: world.routes,
    polities: world.polities,
    characters: legacyCharacters,
    armies: world.armies,
    wars: world.wars.filter((war) => war.active),
    families: world.families,
    relationships: world.relationships,
    factions: world.factions.filter((faction) => faction.active),
    diplomacy: world.diplomacy,
    offices: world.offices.filter((office) => office.active),
    backgroundPeople: world.backgroundPeople,
    commitments: world.commitments.filter((commitment) => (
      commitment.status === '生效'
      || (commitment.resolvedTurn !== null && world.turn - commitment.resolvedTurn < 16)
    )),
    historyDigest: world.historyDigest,
    lastTurn: world.lastTurn,
    counters: world.counters,
  };
  if (schemaVersion === 2) return stableHash(v02Snapshot);
  const v03Snapshot = {
    ...v02Snapshot,
    mapContentVersion: world.mapContentVersion,
    seaZones: world.seaZones,
    seaLanes: world.seaLanes,
    portLinks: world.portLinks,
    ports: world.ports,
    fleets: world.fleets,
    tradeCorridors: world.tradeCorridors.filter((corridor) => corridor.active || world.turn - corridor.lastActiveTurn < 8),
    navalOperations: world.navalOperations.filter((operation) => operation.completedTurn === null || world.turn - operation.completedTurn < 8),
    shipbuildingProjects: world.shipbuildingProjects.filter((project) => project.status === '建造中' || (project.completedTurn !== null && world.turn - project.completedTurn < 8)),
    pathogens: world.pathogens,
    infections: world.infections,
    practices: world.practices,
    practiceStates: world.practiceStates,
  };
  if (schemaVersion === 3) return stableHash(v03Snapshot);

  // Chronicle prose is a projection in schema 4. Facts and current state are
  // authoritative; changing a display threshold must not alter simulation.
  const characters = world.characters.map((character) => {
    const {
      biography: _biography,
      biographyDigest: _biographyDigest,
      ...authoritativeCharacter
    } = character;
    void _biography;
    void _biographyDigest;
    return authoritativeCharacter;
  });
  const counters = { ...world.counters, event: 0 };
  const lastTurn = world.lastTurn
    ? { ...world.lastTurn, eventIds: [] }
    : null;
  const {
    historyDigest: _historyDigest,
    characters: _legacyCharacterSnapshot,
    counters: _legacyCounters,
    lastTurn: _legacyLastTurn,
    ...schema4Base
  } = v03Snapshot;
  void _historyDigest;
  void _legacyCharacterSnapshot;
  void _legacyCounters;
  void _legacyLastTurn;
  const hasSituationSystem = Object.prototype.hasOwnProperty.call(world, 'situationSystem');
  const hasAgencySystem = Object.prototype.hasOwnProperty.call(world, 'agencySystem');
  const hasAgencyDecisionSystem = Object.prototype.hasOwnProperty.call(world, 'agencyDecisionSystem');
  return stableHash({
    ...schema4Base,
    characters,
    counters,
    lastTurn,
    factDigest: world.factDigest,
    legacyArchiveBoundary: world.legacyArchiveBoundary,
    ...(hasSituationSystem ? { situationSystem: world.situationSystem } : {}),
    ...(hasAgencySystem ? { agencySystem: world.agencySystem } : {}),
    ...(hasAgencyDecisionSystem ? { agencyDecisionSystem: world.agencyDecisionSystem } : {}),
  });
}

export function createWorld(seed: string): WorldState {
  if (typeof seed !== 'string' || seed.length === 0) {
    throw new Error('World seed must be a non-empty string');
  }
  const regions = createRegions(seed);
  const routes = createRoutes(regions);
  const characters: CharacterState[] = [];
  const usedNames = new Set<string>();
  for (const definition of POLITY_DEFINITIONS) {
    const polityRegions = regions.filter((region) => region.controllerId === definition.id);
    characters.push(...createInitialCharacters(seed, definition, polityRegions, characters.length, usedNames));
  }
  const polities = POLITY_DEFINITIONS.map((definition) => {
    const ruler = characters.find((character) => character.polityId === definition.id && character.role === '君主');
    if (!ruler) throw new Error(`Missing initial ruler for ${definition.id}`);
    return createPolity(seed, definition, ruler, regions);
  });
  const world: WorldState = {
    schemaVersion: 4,
    mapContentVersion: 'v03-82',
    seed,
    turn: 0,
    year: 1,
    season: '春',
    regions,
    routes,
    seaZones: [],
    seaLanes: [],
    portLinks: [],
    ports: [],
    polities,
    characters,
    armies: [],
    fleets: [],
    wars: [],
    families: [],
    relationships: [],
    factions: [],
    diplomacy: [],
    offices: [],
    backgroundPeople: [],
    commitments: [],
    tradeCorridors: [],
    navalOperations: [],
    shipbuildingProjects: [],
    pathogens: [],
    infections: [],
    practices: [],
    practiceStates: [],
    history: [],
    historyDigest: '',
    facts: [],
    factDigest: stableHash([]),
    legacyArchiveBoundary: null,
    situationSystem: createSituationSystemState(-1),
    agencySystem: createAgencySystemState(-1),
    agencyDecisionSystem: createAgencyDecisionSystemState(-1),
    lastTurn: null,
    counters: { character: characters.length, army: 0, polity: polities.length, war: 0, event: 1, family: 0, faction: 0, relationship: 0, office: 0, commitment: 0, fleet: 0, tradeCorridor: 0, navalOperation: 0, shipment: 0, shipProject: 0, fact: 0 },
    hash: '',
  };
  createInitialArmies(world);
  const foundingEvent = initialHistoryEvent(world);
  world.history.push(foundingEvent);
  createV02WorldSystems(world, foundingEvent.id);
  createV03OceanSystems(world, { legacy: false });
  createV03LifeSystems(world, { legacy: false });
  foundingEvent.summary = `${world.regions.length}处州域、${world.seaZones.length}片海域、${world.polities.length}方政权与${world.characters.length}名核心人物进入同一条可推演的历史。`;
  foundingEvent.evidence = [`固定地图含${world.regions.length}个区域与${world.seaZones.length}片海域`, `初始政权${world.polities.length}个`, `初始核心人物${world.characters.length}名`];
  world.historyDigest = stableHash(foundingEvent);
  world.hash = computeWorldHash(world);
  return world;
}

function pushEvent(world: WorldState, context: MutableTurnContext, input: EventInput): HistoryEvent {
  world.counters.event += 1;
  const event: HistoryEvent = {
    id: `event_${String(world.counters.event).padStart(6, '0')}`,
    turn: context.turn,
    year: context.year,
    season: context.season,
    category: input.category,
    kind: input.kind,
    title: input.title,
    summary: input.summary,
    importance: input.importance,
    actorIds: [...new Set(input.actorIds ?? [])].sort(stableCompare),
    polityIds: [...new Set(input.polityIds ?? [])].sort(stableCompare),
    regionIds: [...new Set(input.regionIds ?? [])].sort(stableCompare),
    causes: input.causes.map((cause, index) => ({
      ...cause,
      role: cause.role ?? (
        /结果|后果|变化|账本|损失|战果|占领成本|政治后果/.test(cause.label)
          ? '结果'
          : /阈值|判定|误差|触发|时长/.test(cause.label)
            ? '触发'
            : /野心|动机|偏好|选择|判断|意愿|风险/.test(cause.label)
              ? '选择'
              : index === 0
                ? '结构'
                : '条件'
      ),
    })),
    evidence: input.evidence ?? input.causes.map((cause) => cause.evidence),
    stateDeltas: input.stateDeltas ?? [],
    sourceFactIds: [...new Set(input.sourceFactIds ?? [])].sort(stableCompare),
    situationIds: [...new Set(input.situationIds ?? [])].sort(stableCompare),
  };
  context.events.push(event);
  world.history.push(event);
  world.historyDigest = stableHash([world.historyDigest, event]);
  return event;
}

function seasonProductionFactor(season: Season): number {
  if (season === '春') return 0.85;
  if (season === '夏') return 1.25;
  if (season === '秋') return 2.05;
  return 0.35;
}

function climateProductionFactor(region: RegionState, season: Season): number {
  if (region.climate === '寒温带' && season === '冬') return 0.65;
  if (region.climate === '干旱' && season === '夏') return 0.78;
  if (region.climate === '湿热' && season === '夏') return 1.08;
  if (region.climate === '暖温带' && season === '秋') return 1.06;
  return 1;
}

function processRegions(world: WorldState, context: MutableTurnContext): void {
  const orderedRegions = [...world.regions].sort((left, right) => stableCompare(left.id, right.id));
  for (const region of orderedRegions) {
    region.devastation = clamp(region.devastation - 1 - practiceEffect(world, region.id, 'devastation-recovery') * 2);
    const weather = 0.9 + keyedRandom(world.seed, context.turn, 'environment', region.id, 'weather') * 0.2;
    const productivity = seasonProductionFactor(context.season)
      * climateProductionFactor(region, context.season)
      * (region.fertility / 100)
      * (1 - region.devastation / 140)
      * (1 + practiceEffect(world, region.id, 'harvest'))
      * weather;
    const produced = integer(region.population * productivity);
    region.food += produced;
    context.food.produced += produced;

    const need = region.population;
    const consumed = Math.min(region.food, need);
    const shortage = need - consumed;
    region.food -= consumed;
    context.food.civilianConsumed += consumed;

    const foodSecurity = need === 0 ? 1 : consumed / need;
    const births = integer(region.population * 0.0031 * foodSecurity * (1 - region.unrest / 180));
    const naturalDeaths = integer(region.population * (0.0019 + region.devastation / 45_000));
    const starvationDeaths = integer(shortage * (0.065 + region.unrest / 2_500));
    const deaths = Math.min(region.population + births, naturalDeaths + starvationDeaths);
    region.population += births - deaths;
    context.population.births += births;
    context.population.civilianDeaths += deaths;

    if (shortage > 0) {
      const unrestBefore = region.unrest;
      region.unrest = clamp(region.unrest + 2 + (shortage / Math.max(1, need)) * 18);
      if (shortage > need * 0.15 && !context.events.some((event) => event.kind === 'famine')) {
        pushEvent(world, context, {
          category: '人口',
          kind: 'famine',
          title: `${region.name}粮荒`,
          summary: `${region.name}当季缺粮${shortage}石，饥馑造成${starvationDeaths}人死亡。`,
          importance: starvationDeaths > region.population * 0.01 ? 4 : 3,
          polityIds: [region.controllerId],
          regionIds: [region.id],
          causes: [
            { label: '供给缺口', weight: 0.55, evidence: `需求${need}，实际供给${consumed}` },
            { label: '战争破坏', weight: 0.3, evidence: `区域破坏度${Math.round(region.devastation)}` },
            { label: '季节与地力', weight: 0.15, evidence: `${context.season}季生产${produced}，地力${region.fertility}` },
          ],
          stateDeltas: [
            { entityType: 'region', entityId: region.id, field: 'population', before: region.population - births + deaths, after: region.population, delta: births - deaths },
            { entityType: 'region', entityId: region.id, field: 'unrest', before: unrestBefore, after: region.unrest, delta: region.unrest - unrestBefore },
          ],
        });
      }
    } else {
      region.unrest = clamp(region.unrest - 1);
    }

    const protectedReserve = region.population * 2;
    const excess = Math.max(0, region.food - protectedReserve);
    const spoilageRate = context.season === '冬' ? 0.012 : region.climate === '湿热' ? 0.045 : 0.03;
    const spoiled = Math.min(region.food, integer(excess * spoilageRate));
    region.food -= spoiled;
    context.food.spoiled += spoiled;

    const output = integer(
      region.population
      * (0.026 + region.cityLevel * 0.006 + (region.port ? 0.004 : 0))
      * (1 - region.devastation / 150),
    );
    region.wealth += output;
    context.wealth.produced += output;
    const householdConsumed = Math.min(region.wealth, integer(region.population * 0.018));
    region.wealth -= householdConsumed;
    context.wealth.householdConsumed += householdConsumed;

    const polity = world.polities.find((item) => item.id === region.controllerId && item.alive);
    if (polity) {
      const tax = Math.min(
        region.wealth,
        integer(output * polity.taxRate * (0.55 + polity.administration / 200)),
      );
      region.wealth -= tax;
      polity.treasury += tax;
      context.wealth.taxed += tax;
      region.unrest = clamp(region.unrest + polity.taxRate * 1.5 - 0.1);
    }
  }
}

function aliveCharacters(world: WorldState, polityId: string): CharacterState[] {
  return world.characters.filter((character) => character.alive && character.age >= 16 && character.polityId === polityId);
}

function spawnCharacter(world: WorldState, polity: PolityState, purpose: string, forcedFamily?: string): CharacterState | null {
  return promoteBackgroundPerson(world, polity, purpose, forcedFamily);
}

function ensureRoster(world: WorldState, polity: PolityState): void {
  // V0.2具名人物是人口群体中的叙事标记。常规补员来自已记录的出生与成年，
  // 不再为了凑名册而凭空制造成年角色；spawnCharacter仅保留给极端职位断档。
  void world;
  void polity;
}

function characterDeathChance(age: number): number {
  if (age < 45) return 0.002;
  if (age < 55) return 0.008;
  if (age < 65) return 0.025;
  if (age < 75) return 0.075;
  if (age < 85) return 0.19;
  if (age < 94) return 0.42;
  return 1;
}

function refreshCharacterRoles(world: WorldState): void {
  const rulers = new Set(world.polities.filter((polity) => polity.alive).map((polity) => polity.rulerId));
  for (const character of world.characters) {
    if (!character.alive) {
      character.role = '廷臣';
    } else if (rulers.has(character.id)) {
      character.role = '君主';
    } else if (character.governedRegionId) {
      character.role = '地方长官';
    } else if (character.commandingArmyId || character.commandingFleetId) {
      character.role = '将领';
    } else {
      character.role = '廷臣';
    }
  }
}

function dissolveHeirlessPolity(
  world: WorldState,
  polity: PolityState,
  deceasedRuler: CharacterState | undefined,
  context: MutableTurnContext,
): boolean {
  const borderContacts = new Map<string, number>();
  for (const region of world.regions.filter((candidate) => candidate.controllerId === polity.id)) {
    for (const neighborId of region.neighbors) {
      const controllerId = world.regions.find((candidate) => candidate.id === neighborId)?.controllerId;
      if (controllerId && controllerId !== polity.id) {
        borderContacts.set(controllerId, (borderContacts.get(controllerId) ?? 0) + 1);
      }
    }
  }
  const recipient = world.polities
    .filter((candidate) => candidate.alive && candidate.id !== polity.id)
    .sort((left, right) => (
      (borderContacts.get(right.id) ?? 0) - (borderContacts.get(left.id) ?? 0)
      || right.controlledRegionIds.length - left.controlledRegionIds.length
      || right.authority - left.authority
      || stableCompare(left.id, right.id)
    ))[0];
  if (!recipient) return false;

  const transferredRegionIds = world.regions
    .filter((region) => region.controllerId === polity.id)
    .map((region) => region.id)
    .sort(stableCompare);
  const treasuryBefore = polity.treasury;
  const recipientTreasuryBefore = recipient.treasury;
  const territoryFacts: SimulationFact[] = [];
  for (const region of world.regions.filter((candidate) => candidate.controllerId === polity.id)) {
    region.controllerId = recipient.id;
    territoryFacts.push(emitSimulationFact(world, context, {
      kind: 'territory_control_changed',
      category: '政治',
      importance: region.strategicValue >= 9 ? 3 : 2,
      actorIds: [...(deceasedRuler ? [deceasedRuler.id] : []), recipient.rulerId],
      polityIds: [polity.id, recipient.id],
      regionIds: [region.id],
      causes: [
        { label: '统治谱系断绝', role: '触发', weight: 0.6, evidence: `${polity.name}已无可接续的统治者` },
        { label: '行政接管', role: '结果', weight: 0.4, evidence: `${region.name}官署并入${recipient.name}` },
      ],
      stateDeltas: [{ entityType: 'region', entityId: region.id, field: 'controllerId', before: polity.id, after: recipient.id }],
      sourceFactIds: [],
      payload: {
        regionId: region.id,
        previousControllerId: polity.id,
        nextControllerId: recipient.id,
        reason: 'administrative_transfer',
        warId: null,
      },
    }));
  }
  for (const army of [...world.armies].filter((candidate) => candidate.polityId === polity.id)) {
    removeArmy(world, army, context, true);
  }
  for (const character of world.characters.filter((candidate) => candidate.alive && candidate.polityId === polity.id)) {
    character.polityId = recipient.id;
    character.governedRegionId = null;
    character.commandingArmyId = null;
    character.commandingFleetId = null;
    character.locationRegionId = recipient.capitalRegionId ?? transferredRegionIds[0] ?? character.locationRegionId;
  }
  recipient.treasury += polity.treasury;
  polity.treasury = 0;
  polity.alive = false;
  polity.eliminatedTurn = context.turn;
  polity.rulerId = deceasedRuler?.id ?? polity.rulerId;
  polity.capitalRegionId = null;
  polity.controlledRegionIds = [];
  for (const family of world.families.filter((candidate) => candidate.polityId === polity.id)) family.polityId = recipient.id;
  const dissolvedFactions = world.factions.filter((faction) => faction.active && faction.polityId === polity.id);
  const dissolvedFactionIds = new Set(dissolvedFactions.map((faction) => faction.id));
  for (const faction of dissolvedFactions) {
    faction.active = false;
    faction.endedTurn = context.turn;
    faction.alliedFactionIds = [];
  }
  for (const faction of world.factions) {
    faction.alliedFactionIds = faction.alliedFactionIds.filter((id) => !dissolvedFactionIds.has(id));
  }
  for (const relation of world.diplomacy.filter((candidate) => candidate.polityAId === polity.id || candidate.polityBId === polity.id)) {
    relation.status = '中立';
    relation.allianceUntilTurn = null;
    relation.tradeAgreementUntilTurn = null;
    relation.tributePayerId = null;
    relation.tributePerTurn = 0;
    relation.lastChangedTurn = context.turn;
  }
  const warEndedFacts: WarEndedFact[] = [];
  for (const war of world.wars.filter((candidate) => candidate.active && (candidate.attackerId === polity.id || candidate.defenderId === polity.id))) {
    const opponentId = war.attackerId === polity.id ? war.defenderId : war.attackerId;
    const opponent = world.polities.find((candidate) => candidate.id === opponentId);
    const fact = closeWar(world, context, war, {
      result: war.attackerId === polity.id ? 'attacker_dissolved' : 'defender_dissolved',
      winnerId: null,
      loserId: polity.id,
      reason: `${polity.name}统治谱系断绝并行政解体`,
      indemnity: 0,
      category: '政治',
      importance: 5,
      actorIds: [...(deceasedRuler ? [deceasedRuler.id] : []), ...(opponent ? [opponent.rulerId] : [])],
      regionIds: transferredRegionIds,
      causes: [{ label: '参战政权解体', role: '结果', weight: 1, evidence: `${polity.name}因无可接续统治者并入${recipient.name}，${war.id}失去参战主体` }],
      sourceFactIds: territoryFacts.map((item) => item.id),
    });
    if (fact) warEndedFacts.push(fact);
  }
  rebuildTerritories(world);
  pushEvent(world, context, {
    category: '政治',
    kind: 'polity_dissolved',
    title: `${polity.name}因统治谱系断绝而解体`,
    summary: `${deceasedRuler?.name ?? polity.dynastyName}死后，境内没有合法未成年继承人与在世成人摄政，也没有已登记且成年的背景候补；地方官署遂并入${recipient.name}。`,
    importance: 5,
    actorIds: [...(deceasedRuler ? [deceasedRuler.id] : []), recipient.rulerId],
    polityIds: [polity.id, recipient.id],
    regionIds: transferredRegionIds,
    causes: [
      { label: '统治谱系断绝', role: '结构', weight: 0.3, evidence: `${polity.name}已无在世具名继承人` },
      { label: '摄政资源枯竭', role: '条件', weight: 0.25, evidence: '境内没有可承担摄政或继任的在世成人' },
      { label: '候补池断档', role: '条件', weight: 0.2, evidence: '已登记背景候补中没有达到成年者' },
      { label: '君主死亡', role: '触发', weight: 0.1, evidence: `${deceasedRuler?.name ?? '末代统治者'}于本年去世` },
      { label: '地方并入', role: '结果', weight: 0.15, evidence: `${transferredRegionIds.length}处州域与国库${treasuryBefore}并入${recipient.name}` },
    ],
    stateDeltas: [
      { entityType: 'polity', entityId: polity.id, field: 'alive', before: true, after: false },
      { entityType: 'polity', entityId: polity.id, field: 'treasury', before: treasuryBefore, after: 0, delta: -treasuryBefore },
      { entityType: 'polity', entityId: recipient.id, field: 'treasury', before: recipientTreasuryBefore, after: recipient.treasury, delta: treasuryBefore },
      ...transferredRegionIds.map((regionId): StateDelta => ({
        entityType: 'region',
        entityId: regionId,
        field: 'controllerId',
        before: polity.id,
        after: recipient.id,
      })),
    ],
    ...projectFactLinks([...territoryFacts, ...warEndedFacts]),
  });
  return true;
}

function selectCandidate(
  candidates: CharacterState[],
  score: (character: CharacterState) => number,
): CharacterState | undefined {
  return [...candidates].sort((left, right) => {
    const scoreDifference = score(right) - score(left);
    return scoreDifference || stableCompare(left.id, right.id);
  })[0];
}

function repairAppointments(world: WorldState, context: MutableTurnContext): void {
  for (const character of world.characters) {
    if (!character.alive) {
      character.governedRegionId = null;
      character.commandingArmyId = null;
      character.commandingFleetId = null;
      continue;
    }
    if (character.governedRegionId) {
      const region = world.regions.find((item) => item.id === character.governedRegionId);
      if (!region || region.controllerId !== character.polityId) {
        character.governedRegionId = null;
        const polity = world.polities.find((item) => item.id === character.polityId);
        if (polity?.capitalRegionId) character.locationRegionId = polity.capitalRegionId;
      }
    }
    if (character.commandingArmyId) {
      const army = world.armies.find((item) => item.id === character.commandingArmyId);
      if (!army || army.commanderId !== character.id || army.polityId !== character.polityId) {
        character.commandingArmyId = null;
      }
    }
    if (character.commandingFleetId) {
      const fleet = world.fleets.find((item) => item.id === character.commandingFleetId);
      if (!fleet || fleet.commanderId !== character.id || fleet.polityId !== character.polityId) {
        character.commandingFleetId = null;
      }
    }
  }

  for (const polity of world.polities.filter((item) => item.alive)) {
    ensureRoster(world, polity);
    const ruler = world.characters.find((character) => character.id === polity.rulerId && character.alive);
    if (ruler) ruler.governedRegionId = null;
    const polityArmies = world.armies
      .filter((item) => item.polityId === polity.id)
      .sort((left, right) => stableCompare(left.id, right.id));
    const assignedDeputies = new Set<string>();
    for (const army of polityArmies) {
      const current = world.characters.find((character) => character.id === army.commanderId);
      if (!current?.alive || current.polityId !== polity.id) {
        if (current) current.commandingArmyId = null;
        const replacement = selectCandidate(
          aliveCharacters(world, polity.id).filter((character) => !character.commandingArmyId && !character.commandingFleetId && !character.governedRegionId),
          (character) => character.leadership * 0.55 + character.cunning * 0.2 + character.loyalty * 0.2 + character.renown * 0.05,
        ) ?? spawnCharacter(world, polity, 'emergency-commander');
        if (!replacement) {
          removeArmy(world, army, context, true);
          continue;
        }
        army.commanderId = replacement.id;
        replacement.commandingArmyId = army.id;
        replacement.locationRegionId = army.regionId;
      } else {
        current.commandingArmyId = army.id;
        current.locationRegionId = army.regionId;
        current.governedRegionId = null;
      }

      const deputy = army.deputyCommanderId
        ? world.characters.find((character) => character.id === army.deputyCommanderId)
        : undefined;
      if (
        !deputy?.alive
        || deputy.polityId !== polity.id
        || deputy.id === army.commanderId
        || Boolean(deputy.commandingArmyId)
        || Boolean(deputy.commandingFleetId)
        || Boolean(deputy.governedRegionId)
        || assignedDeputies.has(deputy.id)
      ) {
        army.deputyCommanderId = selectCandidate(
          aliveCharacters(world, polity.id).filter((character) => (
            !character.commandingArmyId
            && !character.commandingFleetId
            && !character.governedRegionId
            && character.id !== army.commanderId
            && character.id !== polity.rulerId
            && !assignedDeputies.has(character.id)
          )),
          (character) => character.leadership * 0.4 + character.loyalty * 0.35 + character.caution * 0.15 + character.cunning * 0.1,
        )?.id ?? null;
      }
      if (army.deputyCommanderId) assignedDeputies.add(army.deputyCommanderId);
    }

    const governed = new Set(
      aliveCharacters(world, polity.id)
        .map((character) => character.governedRegionId)
        .filter((id): id is string => Boolean(id)),
    );
    for (const regionId of polity.controlledRegionIds) {
      if (regionId === polity.capitalRegionId || governed.has(regionId)) continue;
      const governor = selectCandidate(
        aliveCharacters(world, polity.id).filter((character) => (
          character.id !== polity.rulerId
          && !character.governedRegionId
          && !character.commandingArmyId
          && !character.commandingFleetId
          && !assignedDeputies.has(character.id)
        )),
        (character) => character.governance * 0.5 + character.loyalty * 0.3 + character.caution * 0.12 + character.cunning * 0.08,
      );
      if (!governor) break;
      governor.governedRegionId = regionId;
      governor.locationRegionId = regionId;
      governed.add(regionId);
    }
  }
  refreshCharacterRoles(world);
}

function processCharacterLifecycle(world: WorldState, context: MutableTurnContext): void {
  if (context.season !== '冬') return;
  const ordered = [...world.characters]
    .filter((character) => character.alive)
    .sort((left, right) => stableCompare(left.id, right.id));
  for (const character of ordered) {
    character.age += 1;
    character.lifeStage = lifeStageForAge(character.age, true);
    if (character.protectedUntilTurn !== null && character.protectedUntilTurn < context.turn) {
      character.protectedUntilTurn = null;
    }
    const baseDeathChance = characterDeathChance(character.age);
    const healthRisk = 1 + (100 - character.health) / 85;
    const deathChance = clamp(baseDeathChance * healthRisk, 0, 1);
    if (!keyedChance(world.seed, deathChance, context.turn, 'lifecycle', character.id, 'death')) continue;

    if (character.protectedUntilTurn !== null && character.protectedUntilTurn >= context.turn) {
      const healthBefore = character.health;
      character.health = Math.max(20, character.health - 25);
      character.activeDiseaseId = null;
      character.protectedUntilTurn = null;
      pushEvent(world, context, {
        category: '世界',
        kind: 'observer_protection_triggered',
        title: `${character.name}避过死劫`,
        summary: `${character.name}本应在年龄与健康风险共同作用下死亡，但此前施加的一次保护在此刻耗尽；人物幸存，健康降至${character.health}。`,
        importance: character.role === '君主' ? 4 : 3,
        actorIds: [character.id],
        polityIds: [character.polityId],
        regionIds: [character.locationRegionId],
        causes: [
          { label: '死亡风险', role: '结构', weight: 0.34, evidence: `年龄${character.age}岁、健康${healthBefore}，年度风险${(deathChance * 100).toFixed(1)}%`, refs: [{ kind: 'entity', entityType: 'character', entityId: character.id, field: 'health', label: '受保护人物' }] },
          { label: '观察者保护', role: '触发', weight: 0.41, evidence: `保护有效至回合${context.turn}并在本次死劫中耗尽` },
          { label: '带伤幸存', role: '结果', weight: 0.25, evidence: `健康${healthBefore}→${character.health}` },
        ],
        stateDeltas: [
          { entityType: 'character', entityId: character.id, field: 'health', before: healthBefore, after: character.health, delta: character.health - healthBefore },
          { entityType: 'character', entityId: character.id, field: 'protectedUntilTurn', before: context.turn, after: null },
        ],
      });
      continue;
    }

    const oldRole = character.role;
    const diseaseAtDeath = character.activeDiseaseId;
    character.alive = false;
    character.deathTurn = context.turn;
    character.lifeStage = '已故';
    character.activeDiseaseId = null;
    character.governedRegionId = null;
    if (character.commandingArmyId) {
      const army = world.armies.find((item) => item.id === character.commandingArmyId);
      if (army) army.commanderId = '';
      character.commandingArmyId = null;
    }
    if (character.commandingFleetId) {
      const fleet = world.fleets.find((item) => item.id === character.commandingFleetId);
      if (fleet) fleet.commanderId = '';
      character.commandingFleetId = null;
    }
    for (const army of world.armies) {
      if (army.deputyCommanderId === character.id) army.deputyCommanderId = null;
    }
    const polity = world.polities.find((item) => item.id === character.polityId);
    if (polity?.rulerId === character.id) polity.rulerId = '';
    const deathImportance = oldRole === '君主' ? 4 : oldRole === '将领' ? 2 : 1;
    const deathFact = emitSimulationFact(world, context, {
      kind: 'character_death',
      category: '政治',
      importance: deathImportance,
      actorIds: [character.id],
      polityIds: [character.polityId],
      regionIds: [character.locationRegionId],
      causes: [
        { label: '年龄风险', role: '结构', weight: 0.52, evidence: `年龄${character.age}岁，基础年度死亡风险${(baseDeathChance * 100).toFixed(1)}%` },
        { label: '健康状态', role: '条件', weight: 0.3, evidence: `健康${character.health}将综合风险调整为${(deathChance * 100).toFixed(1)}%${diseaseAtDeath ? `，染患${diseaseAtDeath}` : ''}` },
        { label: '死亡裁决', role: '结果', weight: 0.18, evidence: '人物生命状态与所任职位已同步结算' },
      ],
      stateDeltas: [{ entityType: 'character', entityId: character.id, field: 'alive', before: true, after: false }],
      sourceFactIds: [],
      payload: {
        characterId: character.id,
        age: character.age,
        role: oldRole,
        health: character.health,
        diseaseId: diseaseAtDeath,
      },
    });
    pushEvent(world, context, {
      category: '政治',
      kind: 'character_death',
      title: `${character.name}逝世`,
      summary: `${oldRole}${character.name}卒，享年${character.age}岁，其职位与权力来源随之空缺。`,
      importance: deathImportance,
      actorIds: [character.id],
      polityIds: [character.polityId],
      regionIds: [character.locationRegionId],
      causes: [
        { label: '年龄风险', role: '结构', weight: 0.52, evidence: `年龄${character.age}岁，基础年度死亡风险${(baseDeathChance * 100).toFixed(1)}%` },
        { label: '健康状态', role: '条件', weight: 0.3, evidence: `健康${character.health}将综合风险调整为${(deathChance * 100).toFixed(1)}%${diseaseAtDeath ? `，染患${diseaseAtDeath}` : ''}`, refs: [{ kind: 'entity', entityType: 'character', entityId: character.id, field: 'health', label: '死亡时健康' }] },
        { label: '年度裁决', role: '结果', weight: 0.18, evidence: `独立寻址的年度死亡裁决命中` },
      ],
      stateDeltas: [
        { entityType: 'character', entityId: character.id, field: 'alive', before: true, after: false },
      ],
      ...projectFactLinks(deathFact),
    });
  }

  for (const polity of world.polities.filter((item) => item.alive)) ensureRoster(world, polity);
  for (const polity of world.polities.filter((item) => item.alive && !item.rulerId)) {
    const previousDynasty = polity.dynastyName;
    const previousFamilyId = polity.rulingFamilyId;
    const deceasedRuler = world.characters.find((character) => (
      !character.alive
      && character.deathTurn === context.turn
      && character.role === '君主'
      && character.polityId === polity.id
    ));
    const lineageSupport = (character: CharacterState): number => {
      if (!deceasedRuler) return character.familyId === previousFamilyId ? 42 : 0;
      if (character.parentIds.includes(deceasedRuler.id)) return 100;
      if (character.spouseIds.includes(deceasedRuler.id)) return 72;
      if (character.parentIds.some((parentId) => deceasedRuler.parentIds.includes(parentId))) return 64;
      if (character.familyId === previousFamilyId) return 46;
      return 0;
    };
    const institutionalSupport = (character: CharacterState): number => {
      const factionSupport = world.factions
        .filter((faction) => faction.active && faction.polityId === polity.id && faction.memberIds.includes(character.id))
        .reduce((sum, faction) => sum + faction.power * 0.22, 0);
      const officeSupport = world.offices
        .filter((office) => office.active && office.polityId === polity.id && office.holderId === character.id)
        .reduce((sum, office) => sum + office.rank * 0.14, 0);
      const family = world.families.find((item) => item.id === character.familyId);
      return factionSupport + officeSupport + (family?.prestige ?? 0) * 0.18 + (character.commandingArmyId || character.commandingFleetId ? 24 : 0);
    };
    const successionScore = (character: CharacterState): number => lineageSupport(character) * 0.46
      + institutionalSupport(character) * 0.34
      + character.governance * 0.08
      + character.cunning * 0.06
      + character.renown * 0.04
      + character.loyalty * 0.02;
    const occupiedRulerIds = new Set(world.polities.filter((item) => item.alive && item.rulerId).map((item) => item.rulerId));
    const localAdults = aliveCharacters(world, polity.id).filter((character) => !occupiedRulerIds.has(character.id));
    const legalMinor = selectCandidate(
      world.characters.filter((character) => (
        character.alive
        && character.age < 16
        && character.polityId === polity.id
        && !occupiedRulerIds.has(character.id)
        && lineageSupport(character) >= 46
      )),
      (character) => lineageSupport(character) * 2 + character.age + character.influence,
    );
    let regent = legalMinor
      ? selectCandidate(localAdults, (character) => institutionalSupport(character) + character.governance + character.cunning + character.loyalty)
      : undefined;
    let successor = legalMinor && regent
      ? legalMinor
      : selectCandidate(
      aliveCharacters(world, polity.id).filter((character) => !occupiedRulerIds.has(character.id)),
      successionScore,
    );
    if (!successor && legalMinor) {
      regent = spawnCharacter(world, polity, 'background-regent') ?? undefined;
      if (regent) successor = legalMinor;
    }
    successor ??= spawnCharacter(world, polity, 'background-successor') ?? undefined;
    let anonymousCouncilRegency = false;
    if (!successor) {
      if (dissolveHeirlessPolity(world, polity, deceasedRuler, context)) continue;
      successor = promoteBackgroundPerson(world, polity, 'regency-ward');
      anonymousCouncilRegency = true;
    }
    if (successor.polityId !== polity.id) successor.polityId = polity.id;
    const rulerIdBefore = deceasedRuler?.id ?? '';
    const governmentFormBefore = polity.governmentForm;
    polity.rulerId = successor.id;
    successor.governedRegionId = null;
    const sameDynasty = Boolean(previousFamilyId && successor.familyId === previousFamilyId);
    const underRegency = successor.age < 16 && (Boolean(regent) || anonymousCouncilRegency);
    const regentInfluenceBefore = regent?.influence ?? 0;
    if (underRegency && regent) regent.influence = Math.round(clamp(regent.influence + 10));
    if (anonymousCouncilRegency) polity.governmentForm = '盟约';
    if (!sameDynasty) {
      polity.dynastyName = `${successor.familyName}氏`;
      establishRulingFamilyBranch(world, polity, successor);
    }
    polity.rulingFamilyId = successor.familyId;
    const legitimacyBefore = polity.legitimacy;
    const authorityBefore = polity.authority;
    polity.legitimacy = clamp(polity.legitimacy - (sameDynasty ? underRegency ? 5 : 7 : 19) + successor.governance / 12);
    polity.authority = clamp(polity.authority - (underRegency ? 15 : 8) + (regent?.cunning ?? successor.cunning) / 18);
    pushEvent(world, context, {
      category: '政治',
      kind: underRegency ? 'regency' : sameDynasty ? 'succession' : 'usurpation',
      title: underRegency
        ? `${successor.name}幼年继位，${anonymousCouncilRegency ? '摄政议会' : regent?.name ?? '朝臣'}监国`
        : sameDynasty ? `${successor.name}继位` : `${successor.familyName}氏乘继承危机入主${polity.shortName}国`,
      summary: underRegency
        ? anonymousCouncilRegency
          ? `${polity.name}已是天下最后政权且无在世成人可继；${successor.name}来自本年以前已登记的未成年背景候补，匿名摄政议会暂代国政，未凭空生成成年人物。`
          : `${previousDynasty}${successor.name}凭真实谱系成为幼主；${regent?.name ?? '朝廷'}以既有成人官僚与派系资源承担摄政，中央权威因此承压。`
        : sameDynasty
        ? `${previousDynasty}${successor.name}凭真实谱系、家族认可与制度支持继承君位。`
        : `${successor.name}没有旧宗室谱系资格，却凭官职、派系或军队支持夺取君位，${polity.shortName}国改奉${polity.dynastyName}。`,
      importance: underRegency ? 5 : sameDynasty ? 4 : 5,
      actorIds: [successor.id, ...(regent ? [regent.id] : []), ...(deceasedRuler ? [deceasedRuler.id] : [])],
      polityIds: [polity.id],
      regionIds: polity.capitalRegionId ? [polity.capitalRegionId] : [],
      causes: [
        { label: '真实谱系', role: '结构', weight: 0.3, evidence: `谱系支持${lineageSupport(successor)}；${sameDynasty ? `人物familyId与统治家族${previousFamilyId}一致` : '人物不属于旧统治家族'}` },
        { label: '家族认可', role: '条件', weight: 0.18, evidence: `家族声望${world.families.find((family) => family.id === successor.familyId)?.prestige ?? 0}` },
        { label: underRegency ? '摄政安排' : '官职派系支持', role: '条件', weight: 0.22, evidence: anonymousCouncilRegency ? '无具名成人可用，由不具人物能力值的匿名议会监国' : underRegency ? `${regent?.name ?? '朝臣'}成年且制度支持${regent ? institutionalSupport(regent).toFixed(1) : '0'}` : `制度支持${institutionalSupport(successor).toFixed(1)}` },
        { label: '军队支持', role: '条件', weight: 0.14, evidence: successor.commandingArmyId ? `掌握军团${successor.commandingArmyId}` : '未直接掌军，以宫廷网络补足' },
        { label: underRegency ? '摄政选择' : sameDynasty ? '继承选择' : '篡立选择', role: '选择', weight: 0.16, evidence: anonymousCouncilRegency ? '天下无可并入对象，启用已登记未成年候补与匿名议会' : underRegency ? '未成年合法继承人与在世成人摄政同时具备' : `候选总分${successionScore(successor).toFixed(1)}居首` },
      ],
      stateDeltas: [
        { entityType: 'polity', entityId: polity.id, field: 'rulerId', before: rulerIdBefore, after: successor.id },
        ...(governmentFormBefore !== polity.governmentForm ? [{
          entityType: 'polity' as const,
          entityId: polity.id,
          field: 'governmentForm',
          before: governmentFormBefore,
          after: polity.governmentForm,
        }] : []),
        { entityType: 'polity', entityId: polity.id, field: 'dynastyName', before: previousDynasty, after: polity.dynastyName },
        { entityType: 'polity', entityId: polity.id, field: 'legitimacy', before: legitimacyBefore, after: polity.legitimacy, delta: polity.legitimacy - legitimacyBefore },
        { entityType: 'polity', entityId: polity.id, field: 'authority', before: authorityBefore, after: polity.authority, delta: polity.authority - authorityBefore },
        ...(underRegency && regent ? [{
          entityType: 'character' as const,
          entityId: regent.id,
          field: 'influence',
          before: regentInfluenceBefore,
          after: regent.influence,
          delta: regent.influence - regentInfluenceBefore,
        }] : []),
      ],
    });
  }
  repairAppointments(world, context);
}

function isAtWar(world: WorldState, polityId: string): boolean {
  return world.wars.some((war) => war.active && (war.attackerId === polityId || war.defenderId === polityId));
}

function processPolitics(world: WorldState, context: MutableTurnContext): void {
  for (const polity of world.polities.filter((item) => item.alive).sort((left, right) => stableCompare(left.id, right.id))) {
    const ruler = world.characters.find((character) => character.id === polity.rulerId && character.alive);
    if (!ruler) continue;
    const regions = world.regions.filter((region) => region.controllerId === polity.id);
    const governors = aliveCharacters(world, polity.id).filter((character) => character.governedRegionId);
    const averageGovernance = governors.length === 0
      ? ruler.governance
      : governors.reduce((sum, governor) => sum + governor.governance, 0) / governors.length;
    const averageFoodSecurity = regions.length === 0
      ? 0
      : regions.reduce((sum, region) => sum + Math.min(1, region.food / Math.max(1, region.population * 1.5)), 0) / regions.length;
    const averageUnrest = regions.length === 0
      ? 100
      : regions.reduce((sum, region) => sum + region.unrest, 0) / regions.length;
    const atWar = isAtWar(world, polity.id);
    polity.warWeariness = clamp(polity.warWeariness + (atWar ? 1 : -2));

    const oldLegitimacy = polity.legitimacy;
    const oldAuthority = polity.authority;
    const oldAdministration = polity.administration;
    const administrationTarget = clamp(
      ruler.governance * 0.48 + averageGovernance * 0.37 + 18 - regions.length * 1.2 - averageUnrest * 0.12,
    );
    const legitimacyTarget = clamp(
      30 + ruler.governance * 0.22 + averageFoodSecurity * 24 + (polity.capitalRegionId ? 8 : 0)
      - polity.warWeariness * 0.26 - averageUnrest * 0.16,
    );
    const authorityTarget = clamp(
      26 + ruler.cunning * 0.3 + polity.administration * 0.28 - regions.length * 1.15
      - polity.warWeariness * 0.2 - averageUnrest * 0.14,
    );
    polity.administration = Math.round(clamp(polity.administration + clamp(administrationTarget - polity.administration, -2, 2)));
    polity.legitimacy = Math.round(clamp(polity.legitimacy + clamp(legitimacyTarget - polity.legitimacy, -2, 2)));
    polity.authority = Math.round(clamp(polity.authority + clamp(authorityTarget - polity.authority, -2, 2)));

    for (const governor of governors) {
      const institutionalPull = (polity.authority - 52) / 45;
      const ambitionFriction = governor.ambition > 68 ? (governor.ambition - 68) / 45 : 0;
      governor.loyalty = Math.round(clamp(governor.loyalty + institutionalPull - ambitionFriction));
    }

    if (oldLegitimacy >= 30 && polity.legitimacy < 30) {
      pushEvent(world, context, {
        category: '政治',
        kind: 'legitimacy_crisis',
        title: `${polity.name}国统动摇`,
        summary: `${polity.name}合法性跌破危机线，地方服从与继承秩序开始松动。`,
        importance: 3,
        actorIds: [ruler.id],
        polityIds: [polity.id],
        regionIds: polity.controlledRegionIds,
        causes: [
          { label: '粮食安全', weight: 0.35, evidence: `平均粮食安全${Math.round(averageFoodSecurity * 100)}%` },
          { label: '民间不安', weight: 0.3, evidence: `平均不安${Math.round(averageUnrest)}` },
          { label: '战争疲劳', weight: 0.2, evidence: `战争疲劳${Math.round(polity.warWeariness)}` },
          { label: '统治能力', weight: 0.15, evidence: `君主政略${ruler.governance}` },
        ],
        stateDeltas: [
          { entityType: 'polity', entityId: polity.id, field: 'legitimacy', before: oldLegitimacy, after: polity.legitimacy, delta: polity.legitimacy - oldLegitimacy },
          { entityType: 'polity', entityId: polity.id, field: 'authority', before: oldAuthority, after: polity.authority, delta: polity.authority - oldAuthority },
          { entityType: 'polity', entityId: polity.id, field: 'administration', before: oldAdministration, after: polity.administration, delta: polity.administration - oldAdministration },
        ],
      });
    }
  }
}

function rebuildTerritories(world: WorldState): void {
  for (const polity of world.polities) polity.controlledRegionIds = [];
  for (const region of world.regions) {
    const polity = world.polities.find((item) => item.id === region.controllerId);
    if (polity) polity.controlledRegionIds.push(region.id);
  }
  for (const polity of world.polities) polity.controlledRegionIds.sort(stableCompare);
}

function routeBetween(world: WorldState, leftId: string, rightId: string): RouteState | undefined {
  return world.routes.find((route) => (
    (route.fromRegionId === leftId && route.toRegionId === rightId)
    || (route.fromRegionId === rightId && route.toRegionId === leftId)
  ));
}

function pathBetween(
  world: WorldState,
  startId: string,
  goalId: string,
  allowedControllers?: ReadonlySet<string>,
): string[] | null {
  if (startId === goalId) return [startId];
  const queue = [startId];
  const parent = new Map<string, string | null>([[startId, null]]);
  while (queue.length > 0) {
    const currentId = queue.shift() as string;
    const current = world.regions.find((region) => region.id === currentId);
    if (!current) continue;
    for (const neighborId of [...current.neighbors].sort(stableCompare)) {
      if (parent.has(neighborId)) continue;
      const neighbor = world.regions.find((region) => region.id === neighborId);
      if (!neighbor || (allowedControllers && !allowedControllers.has(neighbor.controllerId))) continue;
      parent.set(neighborId, currentId);
      if (neighborId === goalId) {
        const path: string[] = [goalId];
        let cursor: string | null = currentId;
        while (cursor) {
          path.push(cursor);
          cursor = parent.get(cursor) ?? null;
        }
        return path.reverse();
      }
      queue.push(neighborId);
    }
  }
  return null;
}

function selectArmyCommander(world: WorldState, polity: PolityState): CharacterState | null {
  let candidate: CharacterState | null | undefined = selectCandidate(
    aliveCharacters(world, polity.id).filter((character) => !character.commandingArmyId && !character.commandingFleetId && !character.governedRegionId),
    (character) => character.leadership * 0.52
      + character.cunning * 0.18
      + character.loyalty * 0.2
      + character.renown * 0.1,
  );
  if (!candidate) candidate = spawnCharacter(world, polity, 'new-commander');
  return candidate ?? null;
}

function createArmy(
  world: WorldState,
  polity: PolityState,
  region: RegionState,
  context: MutableTurnContext,
  preferredCommander?: CharacterState,
): ArmyState | null {
  const recruitable = supportedNewArmySize(polity.treasury, region.population);
  if (recruitable < MIN_NEW_ARMY_SIZE) return null;
  const commander = preferredCommander ?? selectArmyCommander(world, polity);
  if (!commander) return null;
  const equipmentPayment = armyEquipmentCost(recruitable);
  const treasuryBefore = polity.treasury;
  const wealthBefore = region.wealth;
  polity.treasury -= equipmentPayment;
  region.wealth += equipmentPayment;
  context.wealth.militaryPayments += equipmentPayment;
  region.population -= recruitable;
  context.population.recruited += recruitable;
  const initialFood = Math.min(region.food, recruitable * 2);
  region.food -= initialFood;
  context.food.transferred += initialFood;

  if (commander.commandingArmyId) {
    const previous = world.armies.find((army) => army.id === commander.commandingArmyId);
    if (previous) previous.commanderId = '';
  }
  world.counters.army += 1;
  const army: ArmyState = {
    id: `a_${String(world.counters.army).padStart(3, '0')}`,
    name: `${region.name}新军`,
    polityId: polity.id,
    commanderId: commander.id,
    deputyCommanderId: null,
    regionId: region.id,
    originRegionId: region.id,
    soldiers: recruitable,
    morale: 56,
    training: 36,
    experience: 4,
    supply: initialFood >= recruitable ? 100 : integer(initialFood / Math.max(1, recruitable) * 100),
    food: initialFood,
    lastMovedTurn: -1,
    embarkedOperationId: null,
  };
  commander.commandingArmyId = army.id;
  commander.locationRegionId = region.id;
  world.armies.push(army);
  pushEvent(world, context, {
    category: '军事',
    kind: 'army_raised',
    title: `${polity.name}编成${army.name}`,
    summary: `${polity.name}从${region.name}征募${recruitable}人，由${commander.name}统领。`,
    importance: 2,
    actorIds: [commander.id],
    polityIds: [polity.id],
    regionIds: [region.id],
    causes: [
      { label: '兵员来源', weight: 0.45, evidence: `${region.name}征募前拥有${region.population + recruitable}名居民` },
      { label: '财政支撑', weight: 0.3, evidence: `装备支出${equipmentPayment}` },
      { label: '指挥权限', weight: 0.25, evidence: `${commander.name}获得该军兵权` },
    ],
    stateDeltas: [
      { entityType: 'region', entityId: region.id, field: 'population', before: region.population + recruitable, after: region.population, delta: -recruitable },
      { entityType: 'army', entityId: army.id, field: 'soldiers', before: 0, after: recruitable, delta: recruitable },
      { entityType: 'polity', entityId: polity.id, field: 'treasury', before: treasuryBefore, after: polity.treasury, delta: -equipmentPayment },
      { entityType: 'region', entityId: region.id, field: 'wealth', before: wealthBefore, after: region.wealth, delta: equipmentPayment },
    ],
  });
  return army;
}

function removeArmy(
  world: WorldState,
  army: ArmyState,
  context: MutableTurnContext,
  demobilizeSurvivors: boolean,
): void {
  const region = world.regions.find((item) => item.id === army.regionId)
    ?? world.regions.find((item) => item.id === army.originRegionId);
  if (region) {
    if (demobilizeSurvivors && army.soldiers > 0) {
      region.population += army.soldiers;
      context.population.demobilized += army.soldiers;
    }
    region.food += army.food;
    context.food.transferred += army.food;
  } else if (army.soldiers > 0 || army.food > 0) {
    throw new Error(`Cannot settle removed army ${army.id}`);
  }
  const commander = world.characters.find((character) => character.id === army.commanderId);
  if (commander?.commandingArmyId === army.id) commander.commandingArmyId = null;
  world.armies = world.armies.filter((item) => item.id !== army.id);
}

function replenishArmy(
  polity: PolityState,
  army: ArmyState,
  region: RegionState,
  context: MutableTurnContext,
): void {
  const target = Math.min(14_000, 8_000 + polity.controlledRegionIds.length * 450);
  if (army.soldiers >= target * 0.68 || region.controllerId !== polity.id) return;
  const affordable = integer(polity.treasury / 0.18);
  const recruits = Math.min(
    target - army.soldiers,
    integer(region.population * 0.012),
    affordable,
  );
  if (recruits <= 0) return;
  const payment = Math.min(polity.treasury, integer(recruits * 0.18));
  polity.treasury -= payment;
  region.wealth += payment;
  context.wealth.militaryPayments += payment;
  region.population -= recruits;
  army.soldiers += recruits;
  context.population.recruited += recruits;
  army.training = Math.round(clamp(army.training - recruits / Math.max(1, army.soldiers) * 8));
}

function supplyArmy(
  world: WorldState,
  polity: PolityState,
  army: ArmyState,
  context: MutableTurnContext,
): void {
  const region = world.regions.find((item) => item.id === army.regionId);
  if (!region) return;
  replenishArmy(polity, army, region, context);
  const targetFood = army.soldiers * 2;
  let missing = Math.max(0, targetFood - army.food);
  if (region.controllerId === polity.id && missing > 0) {
    const localTransfer = Math.min(region.food, missing);
    region.food -= localTransfer;
    army.food += localTransfer;
    missing -= localTransfer;
    context.food.transferred += localTransfer;
  }

  if (missing > 0 && polity.capitalRegionId && polity.capitalRegionId !== region.id) {
    const allowed = new Set([polity.id]);
    const path = pathBetween(world, polity.capitalRegionId, region.id, allowed);
    if (path) {
      const routes = path
        .slice(1)
        .map((nodeId, index) => routeBetween(world, path[index] as string, nodeId))
        .filter((route): route is RouteState => route !== undefined);
      const completePath = routes.length === path.length - 1;
      const remainingCapacity = completePath
        ? Math.min(...routes.map((route) => (
          route.supplyCapacity - (context.routeCapacityReserved[route.id] ?? 0)
        )))
        : 0;
      const source = world.regions.find((item) => item.id === polity.capitalRegionId);
      if (source) {
        const remoteTransfer = Math.max(0, Math.min(source.food, missing, remainingCapacity));
        source.food -= remoteTransfer;
        army.food += remoteTransfer;
        context.food.transferred += remoteTransfer;
        context.logistics.remoteFoodTransferred += remoteTransfer;
        if (remoteTransfer > 0) {
          for (const route of routes) {
            context.routeCapacityReserved[route.id] = (context.routeCapacityReserved[route.id] ?? 0) + remoteTransfer;
            const usage = context.logistics.routeUsage.find((item) => item.routeId === route.id);
            if (usage) {
              usage.reserved += remoteTransfer;
              if (!usage.armyIds.includes(army.id)) usage.armyIds.push(army.id);
            } else {
              context.logistics.routeUsage.push({
                routeId: route.id,
                capacity: route.supplyCapacity,
                reserved: remoteTransfer,
                armyIds: [army.id],
              });
            }
          }
        }
      }
    }
  }

  const need = army.soldiers;
  const consumed = Math.min(army.food, need);
  army.food -= consumed;
  context.food.armyConsumed += consumed;
  army.supply = Math.round(clamp(consumed / Math.max(1, need) * 100));
  if (consumed < need) {
    const deserters = Math.min(army.soldiers, integer((need - consumed) * 0.045));
    army.soldiers -= deserters;
    region.population += deserters;
    context.population.demobilized += deserters;
    army.morale = Math.round(clamp(army.morale - 7 - (need - consumed) / Math.max(1, need) * 18));
  } else {
    army.morale = Math.round(clamp(army.morale + (army.lastMovedTurn === context.turn - 1 ? 0 : 1)));
  }

  const wage = integer(army.soldiers * 0.11);
  const paid = Math.min(polity.treasury, wage);
  polity.treasury -= paid;
  region.wealth += paid;
  context.wealth.militaryPayments += paid;
  if (paid < wage) army.morale = Math.round(clamp(army.morale - 3 * (1 - paid / Math.max(1, wage))));
  army.training = Math.round(clamp(army.training + (army.lastMovedTurn === context.turn - 1 ? 0 : 1)));
}

function maintainArmies(world: WorldState, context: MutableTurnContext): void {
  for (const polity of world.polities.filter((item) => item.alive).sort((left, right) => stableCompare(left.id, right.id))) {
    const desired = Math.min(3, Math.max(1, Math.ceil(polity.controlledRegionIds.length / 5)));
    let armies = world.armies.filter((army) => army.polityId === polity.id);
    while (armies.length < desired) {
      const region = world.regions
        .filter((item) => item.controllerId === polity.id)
        .sort((left, right) => right.population - left.population || stableCompare(left.id, right.id))[0];
      if (!region || !createArmy(world, polity, region, context)) break;
      armies = world.armies.filter((army) => army.polityId === polity.id);
    }
    for (const army of [...armies].sort((left, right) => stableCompare(left.id, right.id))) {
      supplyArmy(world, polity, army, context);
      if (army.soldiers < MIN_ARMY_SIZE) removeArmy(world, army, context, true);
    }
  }
  repairAppointments(world, context);
}

function militaryPower(world: WorldState, polityId: string): number {
  return world.armies
    .filter((army) => army.polityId === polityId)
    .reduce((sum, army) => sum + army.soldiers * (0.45 + army.morale / 250 + army.training / 350), 0);
}

function borderEnemyIds(world: WorldState, polityId: string): string[] {
  const enemies = new Set<string>();
  for (const region of world.regions.filter((item) => item.controllerId === polityId)) {
    for (const neighborId of region.neighbors) {
      const neighbor = world.regions.find((item) => item.id === neighborId);
      if (neighbor && neighbor.controllerId !== polityId) enemies.add(neighbor.controllerId);
    }
  }
  return [...enemies]
    .filter((id) => world.polities.some((polity) => polity.id === id && polity.alive))
    .sort(stableCompare);
}

function startWar(
  world: WorldState,
  context: MutableTurnContext,
  attacker: PolityState,
  defender: PolityState,
  reason: string,
  causes: EventCause[],
  emitDeclaration = true,
  kind: WarState['kind'] = 'interstate',
  goal: WarState['goal'] = kind === 'rebellion' ? '独立' : '边境',
): { war: WarState; fact: WarStartedFact } {
  world.counters.war += 1;
  const war: WarState = {
    id: `war_${String(world.counters.war).padStart(4, '0')}`,
    kind,
    attackerId: attacker.id,
    defenderId: defender.id,
    startedTurn: context.turn,
    endedTurn: null,
    active: true,
    attackerScore: 0,
    defenderScore: 0,
    reason,
    lastBattleTurn: -1,
    goal,
    targetRegionIds: world.regions
      .filter((region) => region.controllerId === defender.id && region.neighbors.some((neighborId) => (
        world.regions.find((neighbor) => neighbor.id === neighborId)?.controllerId === attacker.id
      )))
      .sort((left, right) => right.strategicValue - left.strategicValue || stableCompare(left.id, right.id))
      .slice(0, 3)
      .map((region) => region.id),
    exhaustion: 0,
  };
  world.wars.push(war);
  markWarDiplomacy(world, attacker.id, defender.id, context.turn);
  attacker.lastWarTurn = context.turn;
  defender.lastWarTurn = context.turn;
  const warStartedFact = emitSimulationFact(world, context, {
    kind: 'war_started',
    category: kind === 'rebellion' ? '政治' : '外交',
    importance: kind === 'rebellion' ? 5 : 4,
    actorIds: [attacker.rulerId, defender.rulerId],
    polityIds: [attacker.id, defender.id],
    regionIds: [...war.targetRegionIds],
    causes,
    stateDeltas: [{ entityType: 'war', entityId: war.id, field: 'active', before: false, after: true }],
    sourceFactIds: [],
    payload: {
      warId: war.id,
      warKind: war.kind,
      attackerId: war.attackerId,
      defenderId: war.defenderId,
      goal: war.goal,
      targetRegionIds: [...war.targetRegionIds],
      reason: war.reason,
    },
  }) as WarStartedFact;
  if (emitDeclaration) {
    const brokenCommitments = world.commitments.filter((item) => (
      item.status === '生效'
      && item.kind === '外交盟约'
      && item.polityIds.includes(attacker.id)
      && item.polityIds.includes(defender.id)
    ));
    const declarationEvent = pushEvent(world, context, {
      category: '外交',
      kind: 'war_declared',
      title: `${attacker.name}向${defender.name}开战`,
      summary: `${attacker.name}以“${reason}”为名发动战争；这项决定来自实力判断与君主欲望，而非无条件随机事件。`,
      importance: 4,
      actorIds: [attacker.rulerId, defender.rulerId],
      polityIds: [attacker.id, defender.id],
      regionIds: [],
      causes,
      stateDeltas: [
        { entityType: 'war', entityId: war.id, field: 'active', before: false, after: true },
        ...brokenCommitments.map((commitment): StateDelta => ({
          entityType: 'commitment',
          entityId: commitment.id,
          field: 'status',
          before: '生效',
          after: '背约',
        })),
      ],
      ...projectFactLinks(warStartedFact),
    });
    recordDiplomaticCommitmentBreach(
      world,
      brokenCommitments.map((commitment) => commitment.id),
      attacker.rulerId,
      defender.rulerId,
      declarationEvent,
    );
  }
  return { war, fact: warStartedFact };
}

interface WarClosureInput {
  result: WarEndResult;
  winnerId: string | null;
  loserId: string | null;
  reason: string;
  indemnity: number;
  category: HistoryEvent['category'];
  importance: 3 | 4 | 5;
  actorIds: string[];
  regionIds?: string[];
  causes: EventCause[];
  stateDeltas?: StateDelta[];
  sourceFactIds?: string[];
}

function factWarId(fact: SimulationFact): string | null {
  if (fact.kind === 'war_started' || fact.kind === 'war_ended' || fact.kind === 'battle') {
    return fact.payload.warId;
  }
  return fact.kind === 'territory_control_changed' ? fact.payload.warId : null;
}

/**
 * The only authoritative path that closes a war in new schema-4 turns. Keeping
 * the state mutation and `war_ended` Fact together prevents Situation detectors
 * from having to infer peace or destruction from Chronicle text.
 */
function closeWar(
  world: WorldState,
  context: MutableTurnContext,
  war: WarState,
  input: WarClosureInput,
): WarEndedFact | null {
  if (!war.active) return null;
  war.active = false;
  war.endedTurn = context.turn;
  const inferredSourceFactIds = context.facts
    .filter((fact) => fact.turn === context.turn && fact.kind !== 'war_ended' && factWarId(fact) === war.id)
    .map((fact) => fact.id);
  const sourceFactIds = [...new Set([
    ...inferredSourceFactIds,
    ...(input.sourceFactIds ?? []),
  ])].slice(-8);
  return emitSimulationFact(world, context, {
    kind: 'war_ended',
    category: input.category,
    importance: input.importance,
    actorIds: input.actorIds,
    polityIds: [war.attackerId, war.defenderId],
    regionIds: input.regionIds ?? [],
    causes: input.causes,
    stateDeltas: [
      { entityType: 'war', entityId: war.id, field: 'active', before: true, after: false },
      ...(input.stateDeltas ?? []),
    ],
    sourceFactIds,
    payload: {
      warId: war.id,
      attackerId: war.attackerId,
      defenderId: war.defenderId,
      result: input.result,
      winnerId: input.winnerId,
      loserId: input.loserId,
      reason: input.reason,
      durationTurns: Math.max(1, context.turn - war.startedTurn + 1),
      attackerScore: war.attackerScore,
      defenderScore: war.defenderScore,
      indemnity: input.indemnity,
    },
  }) as WarEndedFact;
}

function processRebellions(world: WorldState, context: MutableTurnContext): void {
  const livingPolityCount = world.polities.filter((polity) => polity.alive).length;
  const lastGlobalRebellionTurn = Math.max(
    -100,
    ...world.polities.map((polity) => polity.lastRebellionTurn),
  );
  const turnsSinceGlobalRebellion = context.turn - lastGlobalRebellionTurn;
  for (const character of world.characters.filter((item) => item.alive)) {
    const polity = world.polities.find((item) => item.id === character.polityId && item.alive);
    const retainsLocalNetwork = Boolean(
      polity
      && character.governedRegionId
      && character.id !== polity.rulerId
      && polity.controlledRegionIds.length >= 4
      && character.governedRegionId !== polity.capitalRegionId,
    );
    if (!retainsLocalNetwork) {
      character.rebellionReadiness = Math.round(clamp((character.rebellionReadiness ?? 0) - 6));
    }
  }
  const candidates = world.characters
    .filter((character) => {
      const polity = world.polities.find((item) => item.id === character.polityId);
      return character.alive
        && Boolean(character.governedRegionId)
        && Boolean(polity?.alive)
        && character.id !== polity?.rulerId
        && (polity?.controlledRegionIds.length ?? 0) >= 4
        && character.governedRegionId !== polity?.capitalRegionId;
    })
    .map((character) => {
      const polity = world.polities.find((item) => item.id === character.polityId) as PolityState;
      const region = world.regions.find((item) => item.id === character.governedRegionId) as RegionState;
      const authorityCrisis = polity.authority <= 44;
      const legitimacyCrisis = polity.legitimacy <= 46;
      const warCrisis = isAtWar(world, polity.id) && polity.warWeariness >= 38;
      const unrestCrisis = region.unrest >= 62;
      const administrativeCrisis = polity.controlledRegionIds.length >= 8 && polity.administration <= 48;
      const crisisSignals = [
        authorityCrisis ? `中央权威${polity.authority}≤44` : null,
        legitimacyCrisis ? `合法性${polity.legitimacy}≤46` : null,
        warCrisis ? `战争疲劳${polity.warWeariness}≥38` : null,
        unrestCrisis ? `${region.name}不安${Math.round(region.unrest)}≥62` : null,
        administrativeCrisis ? `辖${polity.controlledRegionIds.length}区而行政${polity.administration}≤48` : null,
      ].filter((signal): signal is string => signal !== null);
      const structuralCrisis = (
        crisisSignals.length >= 3 && (authorityCrisis || legitimacyCrisis)
      ) || (polity.authority <= 28 && polity.legitimacy <= 38);
      const preparationPressure = Math.max(0, 44 - polity.authority) * 0.08
        + Math.max(0, 46 - polity.legitimacy) * 0.07
        + polity.warWeariness * 0.025
        + region.unrest * 0.025;
      const motivePressure = character.ambition * 0.025
        + (100 - character.loyalty) * 0.02
        - character.caution * 0.018;
      const preparationDelta = structuralCrisis
        ? clamp(preparationPressure + motivePressure - 2, 1, 7)
        : -4;
      character.rebellionReadiness = Math.round(clamp(character.rebellionReadiness + preparationDelta));

      const localArmies = world.armies
        .filter((army) => army.polityId === polity.id && army.regionId === region.id)
        .sort((left, right) => stableCompare(left.id, right.id));
      const defectingArmy = localArmies.find((army) => {
        if (army.commanderId === polity.rulerId) return false;
        if (army.commanderId === character.id || army.deputyCommanderId === character.id) return true;
        const commander = world.characters.find((item) => item.id === army.commanderId && item.alive);
        if (!commander) return false;
        const persuasion = character.cunning + character.ambition * 0.45;
        const resistance = commander.loyalty + commander.caution * 0.55;
        return commander.loyalty <= 42 && persuasion >= resistance + 18;
      });
      const localSeizure = integer(region.wealth * 0.1);
      const divertedTaxes = authorityCrisis ? integer(polity.treasury * 0.06) : 0;
      const mobilizationBudget = localSeizure + divertedTaxes;
      const levySize = supportedNewArmySize(mobilizationBudget, region.population);
      const resourceReady = Boolean(defectingArmy) || levySize >= MIN_NEW_ARMY_SIZE;
      const fragmentationPenalty = Math.max(0, livingPolityCount - 4) * 8;
      const recentRebellionPenalty = Math.max(0, 40 - turnsSinceGlobalRebellion) * 3;
      const parentCooldownReady = context.turn - polity.lastRebellionTurn >= 16;
      const score = character.ambition * 0.38
        + (100 - character.loyalty) * 0.3
        + (100 - polity.authority) * 0.24
        + (100 - polity.legitimacy) * 0.14
        + polity.warWeariness * 0.1
        + region.unrest * 0.1
        + crisisSignals.length * 4
        + character.rebellionReadiness * 0.22
        - character.caution * 0.2
        - fragmentationPenalty
        - recentRebellionPenalty
        + (keyedRandom(world.seed, context.turn, 'politics', character.id, 'rebellion-readiness') - 0.5) * 6;
      return {
        character,
        polity,
        region,
        score,
        crisisSignals,
        structuralCrisis,
        defectingArmy,
        localSeizure,
        divertedTaxes,
        mobilizationBudget,
        levySize,
        resourceReady,
        fragmentationPenalty,
        recentRebellionPenalty,
        parentCooldownReady,
      };
    })
    .filter((candidate) => (
      candidate.structuralCrisis
      && candidate.resourceReady
      && candidate.parentCooldownReady
      && candidate.character.rebellionReadiness >= 68
    ))
    .sort((left, right) => right.score - left.score || stableCompare(left.character.id, right.character.id));
  const candidate = candidates[0];
  if (!candidate || candidate.score < 98) return;

  const { character, polity: parent, region } = candidate;
  const loyaltyBefore = character.loyalty;
  const readinessBefore = character.rebellionReadiness;
  const oldController = region.controllerId;
  const parentTreasuryBefore = parent.treasury;
  const regionWealthBefore = region.wealth;
  world.counters.polity += 1;
  const rebelId = `p_rebel_${String(world.counters.polity).padStart(3, '0')}`;
  parent.treasury -= candidate.divertedTaxes;
  region.wealth -= candidate.localSeizure;
  const newPolity: PolityState = {
    id: rebelId,
    name: `${character.familyName}氏${region.name}政权`,
    shortName: character.familyName,
    dynastyName: `${character.familyName}氏`,
    color: `hsl(${keyedInt(world.seed, 0, 359, context.turn, 'rebellion', character.id, 'color')} 38% 42%)`,
    alive: true,
    foundedTurn: context.turn,
    eliminatedTurn: null,
    rulerId: character.id,
    capitalRegionId: region.id,
    controlledRegionIds: [region.id],
    treasury: candidate.mobilizationBudget,
    legitimacy: Math.round(clamp(32 + character.renown * 0.25 + character.governance * 0.18)),
    authority: Math.round(clamp(28 + character.cunning * 0.28)),
    administration: Math.round(clamp(28 + character.governance * 0.35)),
    warWeariness: 8,
    taxRate: parent.taxRate,
    lastWarTurn: context.turn,
    lastRebellionTurn: context.turn,
    rulingFamilyId: character.familyId || null,
    governmentForm: '军府',
    courtInfluence: Math.round(clamp(character.influence)),
    lastCourtCrisisTurn: -100,
    tradeRevenue: 0,
    navalBudget: 0,
    maritimeOrientation: region.port ? 55 : 18,
    diplomaticReputation: 42,
  };
  world.polities.push(newPolity);
  parent.lastRebellionTurn = context.turn;
  region.controllerId = rebelId;
  region.unrest = clamp(region.unrest - 18);
  character.polityId = rebelId;
  character.governedRegionId = null;
  character.loyalty = 100;
  character.rebellionReadiness = 0;
  character.locationRegionId = region.id;
  establishRulingFamilyBranch(world, newPolity, character);
  rebuildTerritories(world);
  parent.authority = Math.round(clamp(parent.authority - 10));
  parent.legitimacy = Math.round(clamp(parent.legitimacy - 6));

  const defectingArmy = candidate.defectingArmy;
  const armyPreviousPolityId = defectingArmy?.polityId ?? null;
  if (defectingArmy) {
    defectingArmy.polityId = rebelId;
    for (const defectorId of [defectingArmy.commanderId, defectingArmy.deputyCommanderId]) {
      if (!defectorId) continue;
      if (defectorId === parent.rulerId) continue;
      const defector = world.characters.find((item) => item.id === defectorId && item.alive);
      if (!defector) continue;
      defector.polityId = rebelId;
      defector.locationRegionId = region.id;
      defector.governedRegionId = null;
      defector.loyalty = Math.round(clamp(defector.loyalty + 18));
    }
  }
  ensureRoster(world, newPolity);
  const mobilizedArmy = defectingArmy ?? createArmy(world, newPolity, region, context, character);
  if (!mobilizedArmy) throw new Error('Rebellion passed its resource gate but could not mobilize an army');
  const { war: rebellionWar, fact: rebellionWarStartedFact } = startWar(
    world,
    context,
    newPolity,
    parent,
    `${region.name}独立`,
    [{ label: '分裂状态', weight: 1, evidence: '新政权与原宗主国立即进入战争' }],
    false,
    'rebellion',
  );
  const territoryFact = emitSimulationFact(world, context, {
    kind: 'territory_control_changed',
    category: '政治',
    importance: 5,
    actorIds: [character.id, parent.rulerId],
    polityIds: [parent.id, newPolity.id],
    regionIds: [region.id],
    causes: [
      { label: '地方起兵', role: '触发', weight: 0.62, evidence: `${character.name}已完成财源、军力与政治准备` },
      { label: '脱离宗主', role: '结果', weight: 0.38, evidence: `${region.name}转入${newPolity.name}实际控制` },
    ],
    stateDeltas: [{ entityType: 'region', entityId: region.id, field: 'controllerId', before: oldController, after: rebelId }],
    sourceFactIds: [],
    payload: {
      regionId: region.id,
      previousControllerId: oldController,
      nextControllerId: rebelId,
      reason: 'rebellion',
      warId: rebellionWar.id,
    },
  });
  const crackdownDeltas: StateDelta[] = [];
  for (const governor of world.characters.filter((item) => (
    item.alive
    && item.polityId === parent.id
    && Boolean(item.governedRegionId)
    && item.rebellionReadiness > 0
  ))) {
    const before = governor.rebellionReadiness;
    governor.rebellionReadiness = Math.round(before * 0.45);
    crackdownDeltas.push({
      entityType: 'character',
      entityId: governor.id,
      field: 'rebellionReadiness',
      before,
      after: governor.rebellionReadiness,
      delta: governor.rebellionReadiness - before,
    });
  }
  pushEvent(world, context, {
    category: '政治',
    kind: 'rebellion',
    title: `${character.name}据${region.name}起兵`,
    summary: `${character.name}凭地方官职，在中央结构危机中动用${defectingArmy ? '倒戈驻军' : '可核验的地方财源'}建立${newPolity.name}，${region.name}脱离${parent.name}。`,
    importance: 5,
    actorIds: [character.id, parent.rulerId],
    polityIds: [parent.id, newPolity.id],
    regionIds: [region.id],
    causes: [
      { label: '地方权限', weight: 0.14, evidence: `${character.name}是${region.name}在任地方长官，拥有组织与征调入口` },
      { label: '结构危机', weight: 0.24, evidence: candidate.crisisSignals.join('；') },
      { label: '军事与财政前置', weight: 0.23, evidence: defectingArmy
        ? `${defectingArmy.name}（${defectingArmy.soldiers}人）在当地倒戈`
        : `截留地方财富${candidate.localSeizure}、税款${candidate.divertedTaxes}，可征${candidate.levySize}人` },
      { label: '个人动机', weight: 0.16, evidence: `野心${character.ambition}、旧忠诚${loyaltyBefore}、谨慎${character.caution}` },
      { label: '起事准备', weight: 0.13, evidence: `准备度连续积累至${readinessBefore}，行动后归零` },
      { label: '风险权衡', weight: 0.1, evidence: `综合起兵分数${candidate.score.toFixed(1)}高于98；多政权惩罚${candidate.fragmentationPenalty}、近期起事惩罚${candidate.recentRebellionPenalty.toFixed(1)}` },
    ],
    stateDeltas: [
      { entityType: 'region', entityId: region.id, field: 'controllerId', before: oldController, after: rebelId },
      { entityType: 'character', entityId: character.id, field: 'polityId', before: parent.id, after: rebelId },
      { entityType: 'character', entityId: character.id, field: 'loyalty', before: loyaltyBefore, after: 100, delta: 100 - loyaltyBefore },
      { entityType: 'character', entityId: character.id, field: 'rebellionReadiness', before: readinessBefore, after: 0, delta: -readinessBefore },
      { entityType: 'polity', entityId: newPolity.id, field: 'alive', before: false, after: true },
      { entityType: 'polity', entityId: parent.id, field: 'treasury', before: parentTreasuryBefore, after: parent.treasury, delta: parent.treasury - parentTreasuryBefore },
      { entityType: 'region', entityId: region.id, field: 'wealth', before: regionWealthBefore, after: region.wealth, delta: region.wealth - regionWealthBefore },
      { entityType: 'polity', entityId: newPolity.id, field: 'treasury', before: 0, after: newPolity.treasury, delta: newPolity.treasury },
      { entityType: 'war', entityId: rebellionWar.id, field: 'active', before: false, after: true },
      ...(defectingArmy
        ? [{ entityType: 'army' as const, entityId: mobilizedArmy.id, field: 'polityId', before: armyPreviousPolityId, after: rebelId }]
        : [{ entityType: 'army' as const, entityId: mobilizedArmy.id, field: 'soldiers', before: 0, after: mobilizedArmy.soldiers, delta: mobilizedArmy.soldiers }]),
      ...crackdownDeltas,
    ],
    ...projectFactLinks([rebellionWarStartedFact, territoryFact]),
  });
  repairAppointments(world, context);
}

function processWarDeclarations(world: WorldState, context: MutableTurnContext): void {
  if (context.turn < 2) return;
  const ordered = world.polities.filter((polity) => polity.alive).sort((left, right) => stableCompare(left.id, right.id));
  for (const attacker of ordered) {
    if (isAtWar(world, attacker.id) || context.turn - attacker.lastWarTurn < 8) continue;
    const ruler = world.characters.find((character) => character.id === attacker.rulerId && character.alive);
    if (!ruler) continue;
    const targets = borderEnemyIds(world, attacker.id)
      .map((id) => world.polities.find((polity) => polity.id === id && polity.alive))
      .filter((polity): polity is PolityState => polity !== undefined && !isAtWar(world, polity.id))
      .filter((defender) => getDiplomacy(world, attacker.id, defender.id)?.status !== '联盟')
      .map((defender) => {
        const ownPower = militaryPower(world, attacker.id);
        const enemyPower = militaryPower(world, defender.id);
        const relativeOpportunity = clamp((ownPower / Math.max(1, enemyPower) - 0.72) * 30, -12, 27);
        const borderValue = world.regions
          .filter((region) => region.controllerId === defender.id && region.neighbors.some((id) => world.regions.find((item) => item.id === id)?.controllerId === attacker.id))
          .reduce((sum, region) => sum + region.strategicValue, 0);
        const uncertainty = (keyedRandom(world.seed, context.turn, 'diplomacy', attacker.id, defender.id, 'assessment') - 0.5) * 10;
        const relation = getDiplomacy(world, attacker.id, defender.id);
        const score = ruler.ambition * 0.42
          + (100 - ruler.caution) * 0.22
          + relativeOpportunity
          + (100 - defender.authority) * 0.09
          + Math.min(10, borderValue * 0.8)
          - attacker.warWeariness * 0.32
          + (relation?.grievance ?? 0) * 0.14
          - (relation?.trust ?? 0) * 0.12
          + uncertainty;
        return { defender, score, ownPower, enemyPower, relativeOpportunity, borderValue };
      })
      .sort((left, right) => right.score - left.score || stableCompare(left.defender.id, right.defender.id));
    const target = targets[0];
    if (!target || target.score < 58) continue;
    startWar(world, context, attacker, target.defender, '边境与霸权之争', [
      { label: '君主野心', weight: 0.28, evidence: `${ruler.name}野心${ruler.ambition}` },
      { label: '风险偏好', weight: 0.16, evidence: `谨慎${ruler.caution}` },
      { label: '军力判断', weight: 0.3, evidence: `估计己方军力${Math.round(target.ownPower)}，对方${Math.round(target.enemyPower)}` },
      { label: '边境利益', weight: 0.16, evidence: `接壤战略价值${target.borderValue}` },
      { label: '决策阈值', weight: 0.1, evidence: `开战效用${target.score.toFixed(1)}高于58` },
    ]);
  }
}

function baseArmyPower(world: WorldState, army: ArmyState): number {
  const commander = world.characters.find((character) => character.id === army.commanderId && character.alive);
  const deputy = army.deputyCommanderId
    ? world.characters.find((character) => character.id === army.deputyCommanderId && character.alive)
    : undefined;
  const commandFactor = commander
    ? 0.74 + commander.leadership / 190 + commander.cunning / 520
    : 0.72;
  const deputyFactor = deputy ? 1 + (deputy.leadership + deputy.cunning) / 1_200 : 1;
  const readiness = 0.36
    + army.morale / 260
    + army.training / 360
    + army.experience / 650
    + army.supply / 300;
  return army.soldiers * commandFactor * deputyFactor * readiness;
}

function targetPath(world: WorldState, army: ArmyState, enemyId: string): string[] | null {
  const allowed = new Set([army.polityId, enemyId]);
  const targets = world.regions
    .filter((region) => region.controllerId === enemyId)
    .map((region) => {
      const path = pathBetween(world, army.regionId, region.id, allowed);
      const enemy = world.polities.find((polity) => polity.id === enemyId);
      const score = path
        ? region.strategicValue * 8 + region.cityLevel * 4 + (region.id === enemy?.capitalRegionId ? 32 : 0) - path.length * 3
        : Number.NEGATIVE_INFINITY;
      return { path, score, id: region.id };
    })
    .filter((candidate): candidate is { path: string[]; score: number; id: string } => Boolean(candidate.path))
    .sort((left, right) => right.score - left.score || stableCompare(left.id, right.id));
  return targets[0]?.path ?? null;
}

function applyCasualties(
  armies: ArmyState[],
  requestedCasualties: number,
  context: MutableTurnContext,
): number {
  const ordered = [...armies].sort((left, right) => stableCompare(left.id, right.id));
  const total = ordered.reduce((sum, army) => sum + army.soldiers, 0);
  let remaining = Math.min(total, integer(requestedCasualties));
  let actual = 0;
  for (let index = 0; index < ordered.length; index += 1) {
    const army = ordered[index] as ArmyState;
    const casualties = index === ordered.length - 1
      ? Math.min(army.soldiers, remaining)
      : Math.min(army.soldiers, integer(requestedCasualties * army.soldiers / Math.max(1, total)));
    army.soldiers -= casualties;
    remaining -= casualties;
    actual += casualties;
  }
  context.population.militaryDeaths += actual;
  return actual;
}

function settleDefendersAfterCapture(
  world: WorldState,
  defenders: ArmyState[],
  capturedRegion: RegionState,
  defenderId: string,
  context: MutableTurnContext,
): void {
  const retreat = capturedRegion.neighbors
    .map((id) => world.regions.find((region) => region.id === id))
    .filter((region): region is RegionState => region !== undefined && region.controllerId === defenderId)
    .sort((left, right) => right.defense - left.defense || stableCompare(left.id, right.id))[0];
  for (const defender of [...defenders]) {
    if (defender.soldiers < MIN_ARMY_SIZE || !retreat) {
      removeArmy(world, defender, context, true);
    } else {
      defender.regionId = retreat.id;
      defender.lastMovedTurn = context.turn;
      defender.morale = Math.round(clamp(defender.morale - 12));
      const commander = world.characters.find((character) => character.id === defender.commanderId);
      if (commander) commander.locationRegionId = retreat.id;
    }
  }
}

function eliminatePolity(
  world: WorldState,
  loser: PolityState,
  victor: PolityState,
  region: RegionState,
  context: MutableTurnContext,
  territoryFact: SimulationFact,
): void {
  if (!loser.alive) return;
  const treasuryBefore = loser.treasury;
  loser.alive = false;
  loser.eliminatedTurn = context.turn;
  loser.capitalRegionId = null;
  loser.controlledRegionIds = [];
  victor.treasury += loser.treasury;
  loser.treasury = 0;
  for (const army of [...world.armies].filter((item) => item.polityId === loser.id)) {
    removeArmy(world, army, context, true);
  }
  const victorCapital = victor.capitalRegionId ?? region.id;
  for (const character of world.characters.filter((item) => item.alive && item.polityId === loser.id)) {
    character.polityId = victor.id;
    character.locationRegionId = victorCapital;
    character.governedRegionId = null;
    character.commandingArmyId = null;
    character.loyalty = Math.round(clamp(character.loyalty * 0.55));
  }
  const losingFactions = world.factions.filter((faction) => faction.active && faction.polityId === loser.id);
  const losingFactionIds = new Set(losingFactions.map((faction) => faction.id));
  for (const faction of losingFactions) {
    faction.active = false;
    faction.endedTurn = context.turn;
    faction.alliedFactionIds = [];
  }
  for (const faction of world.factions) {
    faction.alliedFactionIds = faction.alliedFactionIds.filter((id) => !losingFactionIds.has(id));
  }
  for (const family of world.families.filter((item) => item.polityId === loser.id)) family.polityId = victor.id;
  for (const background of world.backgroundPeople.filter((item) => item.polityId === loser.id && item.promotedCharacterId === null)) {
    background.polityId = world.regions.find((item) => item.id === background.regionId)?.controllerId ?? victor.id;
  }
  for (const relation of world.diplomacy.filter((item) => item.polityAId === loser.id || item.polityBId === loser.id)) {
    relation.status = '中立';
    relation.allianceUntilTurn = null;
    relation.tradeAgreementUntilTurn = null;
    relation.tributePayerId = null;
    relation.tributePerTurn = 0;
    relation.lastChangedTurn = context.turn;
  }
  const warEndedFacts: WarEndedFact[] = [];
  for (const war of world.wars.filter((item) => item.active && (item.attackerId === loser.id || item.defenderId === loser.id))) {
    const opponentId = war.attackerId === loser.id ? war.defenderId : war.attackerId;
    const opponent = world.polities.find((polity) => polity.id === opponentId);
    const fact = closeWar(world, context, war, {
      result: war.attackerId === loser.id ? 'attacker_destroyed' : 'defender_destroyed',
      // Another war may have delivered the final blow. Record the extinct side
      // without falsely crediting every concurrent opponent as the conqueror.
      winnerId: null,
      loserId: loser.id,
      reason: `${loser.name}政权灭亡`,
      indemnity: 0,
      category: '军事',
      importance: 5,
      actorIds: [loser.rulerId, ...(opponent ? [opponent.rulerId] : [])],
      regionIds: [region.id],
      causes: [{ label: '参战政权灭亡', role: '结果', weight: 1, evidence: `${loser.name}已无任何受控州域，${war.id}随之终止` }],
      sourceFactIds: [territoryFact.id],
    });
    if (fact) warEndedFacts.push(fact);
  }
  pushEvent(world, context, {
    category: '政治',
    kind: 'polity_eliminated',
    title: `${loser.name}灭亡`,
    summary: `${loser.name}失去最后一处州域，国库与残余军政人员由${victor.name}接收。`,
    importance: 5,
    actorIds: [loser.rulerId, victor.rulerId],
    polityIds: [loser.id, victor.id],
    regionIds: [region.id],
    causes: [
      { label: '领土归零', weight: 0.55, evidence: `${loser.name}已无控制区域` },
      { label: '军事失败', weight: 0.3, evidence: `最后据点${region.name}被占领` },
      { label: '政权接管', weight: 0.15, evidence: `${victor.name}取得其国库${treasuryBefore}` },
    ],
    stateDeltas: [
      { entityType: 'polity', entityId: loser.id, field: 'alive', before: true, after: false },
      { entityType: 'polity', entityId: loser.id, field: 'treasury', before: treasuryBefore, after: 0, delta: -treasuryBefore },
      { entityType: 'polity', entityId: victor.id, field: 'treasury', before: victor.treasury - treasuryBefore, after: victor.treasury, delta: treasuryBefore },
    ],
    ...projectFactLinks([territoryFact, ...warEndedFacts]),
  });
}

function captureRegion(
  world: WorldState,
  context: MutableTurnContext,
  war: WarState,
  army: ArmyState,
  region: RegionState,
  previousControllerId: string,
  battleFact: BattleFact,
): void {
  const attacker = world.polities.find((polity) => polity.id === army.polityId) as PolityState;
  const defender = world.polities.find((polity) => polity.id === previousControllerId) as PolityState;
  const oldPopulation = region.population;
  const civilianDeaths = Math.min(
    region.population,
    integer(region.population * (0.001 + keyedRandom(world.seed, context.turn, 'battle', war.id, region.id, 'civilian-loss') * 0.003)),
  );
  region.population -= civilianDeaths;
  context.population.civilianDeaths += civilianDeaths;

  const supplyCapacity = Math.max(0, army.soldiers * 2 - army.food);
  const foodPlunder = Math.min(integer(region.food * 0.05), supplyCapacity);
  region.food -= foodPlunder;
  army.food += foodPlunder;
  context.food.transferred += foodPlunder;
  const foodDestroyed = Math.min(region.food, integer(region.food * 0.03));
  region.food -= foodDestroyed;
  context.food.warDestroyed += foodDestroyed;

  const wealthPlunder = Math.min(region.wealth, integer(region.wealth * 0.045));
  region.wealth -= wealthPlunder;
  attacker.treasury += wealthPlunder;
  const wealthDestroyed = Math.min(region.wealth, integer(region.wealth * 0.025));
  region.wealth -= wealthDestroyed;
  context.wealth.warDestroyed += wealthDestroyed;

  const devastationBefore = region.devastation;
  region.devastation = Math.round(clamp(region.devastation + 9 + region.cityLevel * 2));
  region.unrest = Math.round(clamp(region.unrest + 14));
  region.controllerId = attacker.id;
  const territoryFact = emitSimulationFact(world, context, {
    kind: 'territory_control_changed',
    category: '军事',
    importance: region.strategicValue >= 9 ? 4 : 3,
    actorIds: [army.commanderId, attacker.rulerId, defender.rulerId],
    polityIds: [attacker.id, defender.id],
    regionIds: [region.id],
    causes: [
      { label: '战役胜利', role: '触发', weight: 0.65, evidence: `${battleFact.id}确认${army.name}保持战场控制` },
      { label: '区域接管', role: '结果', weight: 0.35, evidence: `${region.name}由${defender.name}转入${attacker.name}` },
    ],
    stateDeltas: [{ entityType: 'region', entityId: region.id, field: 'controllerId', before: previousControllerId, after: attacker.id }],
    sourceFactIds: [battleFact.id],
    payload: {
      regionId: region.id,
      previousControllerId,
      nextControllerId: attacker.id,
      reason: 'battle_capture',
      warId: war.id,
    },
  });
  const formerGovernor = world.characters.find((character) => character.governedRegionId === region.id);
  if (formerGovernor) formerGovernor.governedRegionId = null;
  rebuildTerritories(world);

  const defenderLegitimacyBefore = defender.legitimacy;
  const attackerLegitimacyBefore = attacker.legitimacy;
  defender.legitimacy = Math.round(clamp(defender.legitimacy - 3 - region.strategicValue / 5));
  defender.authority = Math.round(clamp(defender.authority - 3));
  attacker.legitimacy = Math.round(clamp(attacker.legitimacy + 2));
  attacker.authority = Math.round(clamp(attacker.authority + 2));
  attacker.warWeariness = Math.round(clamp(attacker.warWeariness + 1));
  defender.warWeariness = Math.round(clamp(defender.warWeariness + 4));
  if (war.attackerId === attacker.id) war.attackerScore += 8 + region.strategicValue;
  else war.defenderScore += 8 + region.strategicValue;

  if (defender.capitalRegionId === region.id && defender.controlledRegionIds.length > 0) {
    const oldCapital = defender.capitalRegionId;
    const newCapital = world.regions
      .filter((item) => item.controllerId === defender.id)
      .sort((left, right) => (
        right.cityLevel - left.cityLevel
        || right.strategicValue - left.strategicValue
        || stableCompare(left.id, right.id)
      ))[0] as RegionState;
    defender.capitalRegionId = newCapital.id;
    defender.legitimacy = Math.round(clamp(defender.legitimacy - 10));
    defender.authority = Math.round(clamp(defender.authority - 12));
    pushEvent(world, context, {
      category: '政治',
      kind: 'capital_fall',
      title: `${defender.name}失守${region.name}`,
      summary: `${region.name}陷落后，${defender.name}将中枢迁往${newCapital.name}，合法性与中央权威遭受重创。`,
      importance: 5,
      actorIds: [attacker.rulerId, defender.rulerId],
      polityIds: [attacker.id, defender.id],
      regionIds: [region.id, newCapital.id],
      causes: [
        { label: '首都失守', weight: 0.65, evidence: `${oldCapital}的控制权转移给${attacker.name}` },
        { label: '替代中枢', weight: 0.35, evidence: `${newCapital.name}是剩余领土中城市与战略价值最高者` },
      ],
      stateDeltas: [
        { entityType: 'polity', entityId: defender.id, field: 'capitalRegionId', before: oldCapital, after: newCapital.id },
      ],
      ...projectFactLinks(territoryFact),
    });
  }

  if (defender.controlledRegionIds.length === 0) {
    eliminatePolity(world, defender, attacker, region, context, territoryFact);
  }

  pushEvent(world, context, {
    category: '军事',
    kind: defender.alive ? 'region_captured' : 'annexation',
    title: `${attacker.name}夺取${region.name}`,
    summary: `${army.name}攻占${region.name}；战损、掠取与占领破坏均已计入人口、粮食和财富账本。`,
    importance: defender.alive ? (region.strategicValue >= 9 ? 4 : 3) : 5,
    actorIds: [army.commanderId, attacker.rulerId, defender.rulerId],
    polityIds: [attacker.id, defender.id],
    regionIds: [region.id],
    causes: [
      { label: '战役胜利', weight: 0.5, evidence: `${army.name}在当季战役中保持战场控制` },
      { label: '战略价值', weight: 0.18, evidence: `${region.name}战略价值${region.strategicValue}` },
      { label: '占领成本', weight: 0.17, evidence: `平民死亡${civilianDeaths}，粮食毁损${foodDestroyed}` },
      { label: '政治后果', weight: 0.15, evidence: `${defender.name}合法性${defenderLegitimacyBefore}→${defender.legitimacy}` },
    ],
    stateDeltas: [
      { entityType: 'region', entityId: region.id, field: 'controllerId', before: previousControllerId, after: attacker.id },
      { entityType: 'region', entityId: region.id, field: 'population', before: oldPopulation, after: region.population, delta: -civilianDeaths },
      { entityType: 'region', entityId: region.id, field: 'devastation', before: devastationBefore, after: region.devastation, delta: region.devastation - devastationBefore },
      { entityType: 'polity', entityId: attacker.id, field: 'legitimacy', before: attackerLegitimacyBefore, after: attacker.legitimacy, delta: attacker.legitimacy - attackerLegitimacyBefore },
      { entityType: 'polity', entityId: defender.id, field: 'legitimacy', before: defenderLegitimacyBefore, after: defender.legitimacy, delta: defender.legitimacy - defenderLegitimacyBefore },
    ],
    ...projectFactLinks(territoryFact),
  });
}

function resolveBattle(
  world: WorldState,
  context: MutableTurnContext,
  war: WarState,
  attackerArmy: ArmyState,
  target: RegionState,
  route: RouteState,
): void {
  const defenderId = target.controllerId;
  const defenders = world.armies.filter((army) => army.polityId === defenderId && army.regionId === target.id);
  const defenderSoldiersBefore = new Map(defenders.map((army) => [army.id, army.soldiers]));
  const defenderMoraleBefore = new Map(defenders.map((army) => [army.id, army.morale]));
  const defenderSupplyBefore = new Map(defenders.map((army) => [army.id, army.supply]));
  const defenderTrainingBefore = new Map(defenders.map((army) => [army.id, army.training]));
  const attackerMoraleBefore = attackerArmy.morale;
  const attackerSupplyBefore = attackerArmy.supply;
  const attackerTrainingBefore = attackerArmy.training;
  const defenderReadinessBefore = defenders.length === 0
    ? '无常备军，仅有地方守备'
    : defenders
      .map((army) => `${army.name}补给${army.supply}/士气${army.morale}/训练${army.training}`)
      .join('；');
  const attackerCommander = world.characters.find((character) => character.id === attackerArmy.commanderId);
  const defenderCommanders = defenders
    .map((army) => world.characters.find((character) => character.id === army.commanderId))
    .filter((character): character is CharacterState => Boolean(character));
  const terrainMultiplier = 1 + target.defense / 180 + (target.terrain === '山地' ? 0.18 : target.terrain === '丘陵' ? 0.09 : 0);
  const crossingMultiplier = route.kind === '海峡' ? 0.76 : route.kind === '山道' ? 0.88 : 1;
  const attackerVariance = 0.9 + keyedRandom(world.seed, context.turn, 'battle', war.id, attackerArmy.id, target.id, 'attacker') * 0.2;
  const defenderVariance = 0.9 + keyedRandom(world.seed, context.turn, 'battle', war.id, attackerArmy.id, target.id, 'defender') * 0.2;
  const militia = Math.min(6_000, integer(target.population * 0.012));
  const attackerPower = baseArmyPower(world, attackerArmy) * crossingMultiplier * attackerVariance;
  const fieldDefense = defenders.reduce((sum, army) => sum + baseArmyPower(world, army), 0);
  const defenderPower = (fieldDefense + militia * (0.48 + target.cityLevel * 0.07)) * terrainMultiplier * defenderVariance;
  const attackerWon = attackerPower > defenderPower;

  const attackerBefore = attackerArmy.soldiers;
  const defenderBefore = defenders.reduce((sum, army) => sum + army.soldiers, 0);
  const attackerLossRate = attackerWon
    ? clamp(0.035 + defenderPower / Math.max(1, attackerPower) * 0.085, 0.035, 0.2)
    : clamp(0.14 + defenderPower / Math.max(1, attackerPower) * 0.08, 0.14, 0.38);
  const defenderLossRate = attackerWon
    ? clamp(0.16 + attackerPower / Math.max(1, defenderPower) * 0.12, 0.16, 0.48)
    : clamp(0.035 + attackerPower / Math.max(1, defenderPower) * 0.07, 0.035, 0.2);
  const attackerLosses = applyCasualties([attackerArmy], integer(attackerBefore * attackerLossRate), context);
  const defenderLosses = applyCasualties(defenders, integer(defenderBefore * defenderLossRate), context);
  const militiaLosses = Math.min(
    target.population,
    integer(militia * (attackerWon ? 0.2 : 0.08)),
  );
  target.population -= militiaLosses;
  context.population.civilianDeaths += militiaLosses;
  const chronicleBattle = context.season === '冬' && war.lastBattleTurn !== context.turn;
  war.lastBattleTurn = context.turn;

  attackerArmy.experience = Math.round(clamp(attackerArmy.experience + (attackerWon ? 5 : 2)));
  attackerArmy.morale = Math.round(clamp(attackerArmy.morale + (attackerWon ? 8 : -13)));
  if (attackerCommander) attackerCommander.renown = Math.round(clamp(attackerCommander.renown + (attackerWon ? 5 : 1)));
  for (const defender of defenders) {
    defender.experience = Math.round(clamp(defender.experience + (attackerWon ? 2 : 5)));
    defender.morale = Math.round(clamp(defender.morale + (attackerWon ? -12 : 7)));
  }
  for (const commander of defenderCommanders) {
    commander.renown = Math.round(clamp(commander.renown + (attackerWon ? 1 : 4)));
  }

  const battleCauses: EventCause[] = [
    { label: '兵力与素质', weight: 0.34, evidence: `攻方战力${Math.round(attackerPower)}，守方战力${Math.round(defenderPower)}` },
    { label: '指挥能力', weight: 0.22, evidence: `攻方主帅统率${attackerCommander?.leadership ?? 0}，守方参战主帅${defenderCommanders.map((item) => item.leadership).join('/') || '无常备军'}` },
    { label: '地形城防', weight: 0.2, evidence: `${target.terrain}、防御${target.defense}，守方倍率${terrainMultiplier.toFixed(2)}` },
    { label: '结算前补给士气', weight: 0.16, evidence: `结算前攻方补给${attackerSupplyBefore}、士气${attackerMoraleBefore}、训练${attackerTrainingBefore}；守方：${defenderReadinessBefore}` },
    { label: '有限战场误差', weight: 0.08, evidence: `攻方${attackerVariance.toFixed(2)}，守方${defenderVariance.toFixed(2)}` },
  ];
  const battleDeltas: StateDelta[] = [
    { entityType: 'army', entityId: attackerArmy.id, field: 'soldiers', before: attackerBefore, after: attackerArmy.soldiers, delta: -attackerLosses },
    { entityType: 'army', entityId: attackerArmy.id, field: 'morale', before: attackerMoraleBefore, after: attackerArmy.morale, delta: attackerArmy.morale - attackerMoraleBefore },
    ...defenders.map((army) => ({
      entityType: 'army' as const,
      entityId: army.id,
      field: 'soldiers',
      before: defenderSoldiersBefore.get(army.id) ?? army.soldiers,
      after: army.soldiers,
      delta: army.soldiers - (defenderSoldiersBefore.get(army.id) ?? army.soldiers),
    })),
    ...defenders.map((army) => ({
      entityType: 'army' as const,
      entityId: army.id,
      field: 'morale',
      before: defenderMoraleBefore.get(army.id) ?? army.morale,
      after: army.morale,
      delta: army.morale - (defenderMoraleBefore.get(army.id) ?? army.morale),
    })),
  ];
  // Emit before retreat/disband/capture so destroyed armies and their deputy
  // assignments remain available to career and Chronicle projectors.
  const battleFact = emitSimulationFact(world, context, {
    kind: 'battle',
    category: '军事',
    importance: 3,
    actorIds: [
      attackerArmy.commanderId,
      ...(attackerArmy.deputyCommanderId ? [attackerArmy.deputyCommanderId] : []),
      ...defenders.flatMap((army) => [army.commanderId, ...(army.deputyCommanderId ? [army.deputyCommanderId] : [])]),
    ],
    polityIds: [attackerArmy.polityId, defenderId],
    regionIds: [target.id, attackerArmy.regionId],
    causes: battleCauses,
    stateDeltas: battleDeltas,
    sourceFactIds: [],
    payload: {
      warId: war.id,
      targetRegionId: target.id,
      routeId: route.id,
      attackerWon,
      attackerPower,
      defenderPower,
      militiaLosses,
      attacker: {
        armyId: attackerArmy.id,
        polityId: attackerArmy.polityId,
        commanderId: attackerArmy.commanderId,
        deputyCommanderId: attackerArmy.deputyCommanderId,
        soldiersBefore: attackerBefore,
        soldiersAfter: attackerArmy.soldiers,
        moraleBefore: attackerMoraleBefore,
        moraleAfter: attackerArmy.morale,
        trainingBefore: attackerTrainingBefore,
        supplyBefore: attackerSupplyBefore,
        losses: attackerLosses,
      },
      defenders: defenders.map((army) => ({
        armyId: army.id,
        polityId: army.polityId,
        commanderId: army.commanderId,
        deputyCommanderId: army.deputyCommanderId,
        soldiersBefore: defenderSoldiersBefore.get(army.id) ?? army.soldiers,
        soldiersAfter: army.soldiers,
        moraleBefore: defenderMoraleBefore.get(army.id) ?? army.morale,
        moraleAfter: army.morale,
        trainingBefore: defenderTrainingBefore.get(army.id) ?? army.training,
        supplyBefore: defenderSupplyBefore.get(army.id) ?? army.supply,
        losses: (defenderSoldiersBefore.get(army.id) ?? army.soldiers) - army.soldiers,
      })),
    },
  }) as BattleFact;

  if (chronicleBattle) pushEvent(world, context, {
    category: '军事',
    kind: 'battle',
    title: `${target.name}之战：${attackerWon ? '攻方得势' : '守方获胜'}`,
    summary: `${attackerArmy.name}以${attackerBefore}人进攻${target.name}，攻方战损${attackerLosses}、守军战损${defenderLosses}，${attackerWon ? '突破防线' : '被迫退回'}。`,
    importance: 3,
    actorIds: [
      attackerArmy.commanderId,
      ...(attackerArmy.deputyCommanderId ? [attackerArmy.deputyCommanderId] : []),
      ...defenders.flatMap((army) => [army.commanderId, ...(army.deputyCommanderId ? [army.deputyCommanderId] : [])]),
    ],
    polityIds: [attackerArmy.polityId, defenderId],
    regionIds: [target.id, attackerArmy.regionId],
    causes: battleCauses,
    stateDeltas: battleDeltas,
    ...projectFactLinks(battleFact),
  });

  if (attackerWon && attackerArmy.soldiers > 0) {
    settleDefendersAfterCapture(world, defenders, target, defenderId, context);
    attackerArmy.regionId = target.id;
    attackerArmy.lastMovedTurn = context.turn;
    if (attackerCommander) attackerCommander.locationRegionId = target.id;
    captureRegion(world, context, war, attackerArmy, target, defenderId, battleFact);
  } else {
    for (const defender of [...defenders]) {
      if (defender.soldiers < MIN_ARMY_SIZE) removeArmy(world, defender, context, true);
    }
    if (attackerArmy.soldiers < MIN_ARMY_SIZE) removeArmy(world, attackerArmy, context, true);
    if (war.attackerId === attackerArmy.polityId) war.defenderScore += 4;
    else war.attackerScore += 4;
  }
}

function endWar(
  world: WorldState,
  context: MutableTurnContext,
  war: WarState,
  reason: string,
): void {
  if (!war.active) return;
  const attacker = world.polities.find((polity) => polity.id === war.attackerId);
  const defender = world.polities.find((polity) => polity.id === war.defenderId);
  markPeaceDiplomacy(world, war.attackerId, war.defenderId, context.turn);
  if (!attacker || !defender) {
    closeWar(world, context, war, {
      result: 'negotiated_peace',
      winnerId: null,
      loserId: null,
      reason,
      indemnity: 0,
      category: '外交',
      importance: 3,
      actorIds: [],
      causes: [{ label: '参战方记录中止', role: '结果', weight: 1, evidence: `${war.id}不再处于进行中` }],
    });
    return;
  }
  const scoreGap = war.attackerScore - war.defenderScore;
  const winner = Math.abs(scoreGap) >= 6 ? (scoreGap > 0 ? attacker : defender) : null;
  const loser = winner ? (winner.id === attacker.id ? defender : attacker) : null;
  const indemnity = loser
    ? Math.min(loser.treasury, integer(clamp(Math.abs(scoreGap) * 28 + loser.treasury * 0.025, 0, 5_000)))
    : 0;
  const winnerTreasuryBefore = winner?.treasury ?? 0;
  const loserTreasuryBefore = loser?.treasury ?? 0;
  if (winner && loser && indemnity > 0) {
    loser.treasury -= indemnity;
    winner.treasury += indemnity;
  }
  attacker.warWeariness = Math.round(clamp(attacker.warWeariness - 8));
  defender.warWeariness = Math.round(clamp(defender.warWeariness - 8));
  const peaceCauses: EventCause[] = [
    { label: '战争时长', role: '结构', weight: 0.26, evidence: `战争持续${context.turn - war.startedTurn + 1}季` },
    { label: '战争疲劳', role: '条件', weight: 0.26, evidence: `双方疲劳${attacker.warWeariness + 8}/${defender.warWeariness + 8}` },
    { label: '战果差距', role: '条件', weight: 0.27, evidence: `战果${war.attackerScore}:${war.defenderScore}，差${scoreGap}`, refs: [{ kind: 'entity', entityType: 'war', entityId: war.id, label: '战争战果' }] },
    { label: '和约结果', role: '结果', weight: 0.21, evidence: winner && loser ? `${loser.name}实际支付${indemnity}，不凭空创造财富` : '维持控制线且无赔款' },
  ];
  const treasuryDeltas: StateDelta[] = winner && loser && indemnity > 0 ? [
    { entityType: 'polity', entityId: loser.id, field: 'treasury', before: loserTreasuryBefore, after: loser.treasury, delta: -indemnity },
    { entityType: 'polity', entityId: winner.id, field: 'treasury', before: winnerTreasuryBefore, after: winner.treasury, delta: indemnity },
  ] : [];
  const warEndedFact = closeWar(world, context, war, {
    result: winner?.id === attacker.id
      ? 'attacker_advantage'
      : winner?.id === defender.id
        ? 'defender_advantage'
        : 'negotiated_peace',
    winnerId: winner?.id ?? null,
    loserId: loser?.id ?? null,
    reason,
    indemnity,
    category: '外交',
    importance: winner ? 4 : 3,
    actorIds: [attacker.rulerId, defender.rulerId],
    causes: peaceCauses,
    stateDeltas: treasuryDeltas,
  });
  if (!warEndedFact) throw new Error(`Active war ${war.id} could not emit its ending Fact`);
  const peaceEvent = pushEvent(world, context, {
    category: '外交',
    kind: 'peace',
    title: `${attacker.name}与${defender.name}停战`,
    summary: `双方因${reason}结束战争，既有控制线成为暂时边界；${winner && loser ? `${loser.name}依据战果从国库向${winner.name}支付${indemnity}赔款` : '战果不足以支持额外赔款'}。`,
    importance: winner ? 4 : 3,
    actorIds: [attacker.rulerId, defender.rulerId],
    polityIds: [attacker.id, defender.id],
    regionIds: [],
    causes: peaceCauses,
    stateDeltas: [
      { entityType: 'war', entityId: war.id, field: 'active', before: true, after: false },
      ...treasuryDeltas,
    ],
    ...projectFactLinks(warEndedFact),
  });
  const relation = getDiplomacy(world, attacker.id, defender.id);
  if (relation) {
    relation.treatyEventIds.push(peaceEvent.id);
    relation.treatyEventIds = relation.treatyEventIds.slice(-12);
  }
}

function processMilitary(world: WorldState, context: MutableTurnContext): void {
  const acted = new Set<string>();
  const wars = [...world.wars].filter((war) => war.active).sort((left, right) => stableCompare(left.id, right.id));
  for (const war of wars) {
    const attacker = world.polities.find((polity) => polity.id === war.attackerId);
    const defender = world.polities.find((polity) => polity.id === war.defenderId);
    if (!attacker?.alive || !defender?.alive) {
      const attackerMissing = !attacker?.alive;
      const defenderMissing = !defender?.alive;
      closeWar(world, context, war, {
        result: attackerMissing && !defenderMissing
          ? 'attacker_destroyed'
          : defenderMissing && !attackerMissing
            ? 'defender_destroyed'
            : 'negotiated_peace',
        winnerId: null,
        loserId: attackerMissing === defenderMissing ? null : attackerMissing ? war.attackerId : war.defenderId,
        reason: '参战政权已不复存续',
        indemnity: 0,
        category: '军事',
        importance: 5,
        actorIds: [attacker?.rulerId, defender?.rulerId].filter((id): id is string => Boolean(id)),
        causes: [{ label: '参战主体消失', role: '结果', weight: 1, evidence: `${war.id}的一方或双方已失去政权载体` }],
      });
      continue;
    }
    // A newly declared regional rebellion spends its first quarter organizing and
    // being contained; this prevents creation and annihilation in the same tick.
    if (war.startedTurn === context.turn && war.kind === 'rebellion') continue;
    const sideIds = [war.attackerId, war.defenderId];
    for (const sideId of sideIds) {
      const enemyId = sideId === war.attackerId ? war.defenderId : war.attackerId;
      const armies = world.armies
        .filter((army) => army.polityId === sideId && !acted.has(army.id))
        .sort((left, right) => stableCompare(left.id, right.id));
      for (const listedArmy of armies) {
        const army = world.armies.find((item) => item.id === listedArmy.id);
        if (!army || army.embarkedOperationId || acted.has(army.id) || army.morale < 12) continue;
        const path = targetPath(world, army, enemyId);
        if (!path || path.length < 2) continue;
        const nextRegion = world.regions.find((region) => region.id === path[1]);
        const route = nextRegion ? routeBetween(world, army.regionId, nextRegion.id) : undefined;
        if (!nextRegion || !route) continue;
        acted.add(army.id);
        if (nextRegion.controllerId === enemyId) {
          resolveBattle(world, context, war, army, nextRegion, route);
        } else {
          army.regionId = nextRegion.id;
          army.lastMovedTurn = context.turn;
          if (route.kind === '海峡') {
            army.morale = Math.round(clamp(army.morale - 3));
            army.supply = Math.round(clamp(army.supply - 6));
          }
          const commander = world.characters.find((character) => character.id === army.commanderId);
          if (commander) commander.locationRegionId = nextRegion.id;
        }
      }
    }

    if (!war.active) continue;
    const duration = context.turn - war.startedTurn + 1;
    const stillConnected = borderEnemyIds(world, war.attackerId).includes(war.defenderId);
    const attackerNow = world.polities.find((polity) => polity.id === war.attackerId);
    const defenderNow = world.polities.find((polity) => polity.id === war.defenderId);
    if (!attackerNow?.alive || !defenderNow?.alive) {
      const attackerMissing = !attackerNow?.alive;
      const defenderMissing = !defenderNow?.alive;
      closeWar(world, context, war, {
        result: attackerMissing && !defenderMissing
          ? 'attacker_destroyed'
          : defenderMissing && !attackerMissing
            ? 'defender_destroyed'
            : 'negotiated_peace',
        winnerId: null,
        loserId: attackerMissing === defenderMissing ? null : attackerMissing ? war.attackerId : war.defenderId,
        reason: '参战政权已不复存续',
        indemnity: 0,
        category: '军事',
        importance: 5,
        actorIds: [attackerNow?.rulerId, defenderNow?.rulerId].filter((id): id is string => Boolean(id)),
        causes: [{ label: '参战主体消失', role: '结果', weight: 1, evidence: `${war.id}的一方或双方已失去政权载体` }],
      });
    } else if (
      duration >= 24
      || (duration >= 12 && attackerNow.warWeariness + defenderNow.warWeariness >= 95)
      || (duration >= 16 && !stillConnected)
    ) {
      endWar(world, context, war, duration >= 24 ? '战事旷日持久' : !stillConnected ? '战线已经分离' : '双方疲惫不堪');
    }
  }
  repairAppointments(world, context);
}

function createTurnContext(world: WorldState): MutableTurnContext {
  const boundaryInterventions = world.history.filter((event) => (
    event.turn === world.turn && event.kind.startsWith('observer_intervention_')
  ));
  return {
    turn: world.turn,
    year: world.year,
    season: world.season,
    // Interventions happen at the completed-quarter boundary. Carry them into
    // the following quarter's report so eventIds remains the exact ordered set
    // for that historical turn without replaying the mutation.
    events: [...boundaryInterventions],
    facts: [],
    agencyIntents: [],
    appointmentSourceFactIdsByArmyId: {},
    population: {
      start: totalPopulation(world),
      births: 0,
      civilianDeaths: 0,
      militaryDeaths: 0,
      recruited: 0,
      demobilized: 0,
      end: 0,
    },
    food: {
      start: totalFood(world),
      produced: 0,
      civilianConsumed: 0,
      armyConsumed: 0,
      spoiled: 0,
      warDestroyed: 0,
      transferred: 0,
      end: 0,
    },
    wealth: {
      start: totalWealth(world),
      produced: 0,
      householdConsumed: 0,
      warDestroyed: 0,
      taxed: 0,
      militaryPayments: 0,
      end: 0,
    },
    logistics: {
      remoteFoodTransferred: 0,
      routeUsage: [],
      seaUsage: [],
    },
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
      produced: {},
      consumed: {},
      lost: {},
      valueTransferred: 0,
      tariffsTransferred: 0,
    },
    migration: { departed: 0, arrived: 0, travelDeaths: 0, settled: 0, flowIds: [] },
    health: {
      infectiousStart: 0,
      newExposures: 0,
      importedExposures: 0,
      civilianDeaths: 0,
      militaryDeaths: 0,
      infectiousEnd: 0,
      outbreakRegionIds: [],
    },
    knowledge: { prototypeIds: [], adoptedIds: [], spreadIds: [], lostIds: [] },
    maritime: { fleetIds: [], blockadedPortIds: [], raidedShipmentIds: [], landingOperationIds: [], shipsLost: 0 },
  };
}

function cloneWorld(world: WorldState): WorldState {
  return {
    ...world,
    regions: world.regions.map((region) => ({
      ...region,
      polygon: region.polygon.map((point) => ({ ...point })),
      neighbors: [...region.neighbors],
      routeIds: [...region.routeIds],
      goods: { ...region.goods },
      prices: { ...region.prices },
      resourcePotential: { ...region.resourcePotential },
    })),
    seaZones: world.seaZones.map((zone) => ({
      ...zone,
      adjacentSeaZoneIds: [...zone.adjacentSeaZoneIds],
      portRegionIds: [...zone.portRegionIds],
      powerByPolity: { ...zone.powerByPolity },
    })),
    seaLanes: world.seaLanes.map((lane) => ({ ...lane })),
    portLinks: world.portLinks.map((link) => ({ ...link })),
    ports: world.ports.map((port) => ({ ...port })),
    polities: world.polities.map((polity) => ({
      ...polity,
      controlledRegionIds: [...polity.controlledRegionIds],
    })),
    characters: world.characters.map((character) => ({
      ...character,
      parentIds: [...character.parentIds],
      spouseIds: [...character.spouseIds],
      biography: character.biography.map((fact) => ({ ...fact })),
    })),
    armies: world.armies.map((army) => ({ ...army })),
    fleets: world.fleets.map((fleet) => ({ ...fleet })),
    wars: world.wars.map((war) => ({ ...war, targetRegionIds: [...war.targetRegionIds] })),
    families: world.families.map((family) => ({
      ...family,
      memberIds: [...family.memberIds],
      traditions: { ...family.traditions },
      marriageAllianceFamilyIds: [...family.marriageAllianceFamilyIds],
    })),
    relationships: world.relationships.map((relationship) => ({
      ...relationship,
      memories: relationship.memories.map((memory) => ({ ...memory })),
    })),
    factions: world.factions.map((faction) => ({
      ...faction,
      memberIds: [...faction.memberIds],
      alliedFactionIds: [...faction.alliedFactionIds],
    })),
    diplomacy: world.diplomacy.map((relation) => ({
      ...relation,
      marriageIds: [...relation.marriageIds],
      treatyEventIds: [...relation.treatyEventIds],
    })),
    offices: world.offices.map((office) => ({ ...office })),
    backgroundPeople: world.backgroundPeople.map((person) => ({ ...person, potential: { ...person.potential } })),
    commitments: world.commitments.map((commitment) => ({ ...commitment, polityIds: [...commitment.polityIds] })),
    tradeCorridors: world.tradeCorridors.map((corridor) => ({ ...corridor, pathEdgeIds: [...corridor.pathEdgeIds] })),
    navalOperations: world.navalOperations.map((operation) => ({
      ...operation,
      fleetIds: [...operation.fleetIds],
      seaZonePath: [...operation.seaZonePath],
    })),
    shipbuildingProjects: world.shipbuildingProjects.map((project) => ({ ...project })),
    pathogens: world.pathogens.map((pathogen) => ({ ...pathogen, climateAffinity: [...pathogen.climateAffinity] })),
    infections: world.infections.map((infection) => ({
      ...infection,
      recentSources: infection.recentSources.map((source) => ({ ...source, routeEvidence: [...source.routeEvidence] })),
    })),
    practices: world.practices.map((practice) => ({ ...practice })),
    practiceStates: world.practiceStates.map((state) => ({
      ...state,
      carrierCharacterIds: [...state.carrierCharacterIds],
    })),
    history: [...world.history],
    facts: [...world.facts],
    situationSystem: structuredClone(world.situationSystem),
    agencySystem: structuredClone(world.agencySystem),
    agencyDecisionSystem: structuredClone(world.agencyDecisionSystem),
    counters: { ...world.counters },
  };
}

function finalizeTurn(world: WorldState, context: MutableTurnContext): void {
  for (const region of world.regions) {
    // Refugees are a status subset of regional population. Civilian mortality
    // has already been charged by its originating system, so this only keeps
    // the subset cache coherent after famine, battle or disease losses.
    region.refugeePopulation = Math.min(region.population, region.refugeePopulation);
  }
  context.population.end = totalPopulation(world);
  context.food.end = totalFood(world);
  context.wealth.end = totalWealth(world);
  context.trade.stockEnd = world.regions.reduce((total, region) => ({
    木材: total.木材 + region.goods.木材,
    铁器: total.铁器 + region.goods.铁器,
    马匹: total.马匹 + region.goods.马匹,
    盐: total.盐 + region.goods.盐,
    纺织品: total.纺织品 + region.goods.纺织品,
    奢侈品: total.奢侈品 + region.goods.奢侈品,
  }), { 木材: 0, 铁器: 0, 马匹: 0, 盐: 0, 纺织品: 0, 奢侈品: 0 });
  const populationDelta = context.population.end - context.population.start;
  const foodDelta = context.food.end - context.food.start;
  const wealthDelta = context.wealth.end - context.wealth.start;
  const majorEvents = context.events.filter((event) => event.importance >= 4).length;
  const alivePolities = world.polities.filter((polity) => polity.alive).length;
  const activeWars = world.wars.filter((war) => war.active).length;
  pushEvent(world, context, {
    category: '世界',
    kind: 'quarter_summary',
    title: `${context.year}年${context.season}季记`,
    summary: `天下现有${alivePolities}个政权、${activeWars}场战争；人口净变动${populationDelta}，粮食净变动${foodDelta}。`,
    importance: majorEvents > 0 ? 2 : 1,
    polityIds: world.polities.filter((polity) => polity.alive).map((polity) => polity.id),
    regionIds: [],
    causes: [
      { label: '人口账本', weight: 0.34, evidence: `出生${context.population.births}，平民死亡${context.population.civilianDeaths}，军人死亡${context.population.militaryDeaths}` },
      { label: '粮食账本', weight: 0.33, evidence: `生产${context.food.produced}，消费${context.food.civilianConsumed + context.food.armyConsumed}，毁损腐坏${context.food.spoiled + context.food.warDestroyed}` },
      { label: '财政账本', weight: 0.33, evidence: `产出${context.wealth.produced}，生活消耗${context.wealth.householdConsumed}，战争毁损${context.wealth.warDestroyed}` },
    ],
    stateDeltas: [
      { entityType: 'world', entityId: 'world', field: 'population', before: context.population.start, after: context.population.end, delta: populationDelta },
      { entityType: 'world', entityId: 'world', field: 'food', before: context.food.start, after: context.food.end, delta: foodDelta },
      { entityType: 'world', entityId: 'world', field: 'wealth', before: context.wealth.start, after: context.wealth.end, delta: wealthDelta },
    ],
  });
  world.lastTurn = {
    turn: context.turn,
    year: context.year,
    season: context.season,
    population: context.population,
    food: context.food,
    wealth: context.wealth,
    logistics: {
      remoteFoodTransferred: context.logistics.remoteFoodTransferred,
      routeUsage: context.logistics.routeUsage
        .map((usage) => ({
          ...usage,
          armyIds: [...usage.armyIds].sort(stableCompare),
          flowIds: [...(usage.flowIds ?? [])].sort(stableCompare),
        }))
        .sort((left, right) => stableCompare(left.routeId, right.routeId)),
      seaUsage: context.logistics.seaUsage
        .map((usage) => ({ ...usage, flowIds: [...usage.flowIds].sort(stableCompare) }))
        .sort((left, right) => stableCompare(left.edgeId, right.edgeId)),
    },
    trade: context.trade,
    migration: context.migration,
    health: context.health,
    knowledge: context.knowledge,
    maritime: context.maritime,
    eventIds: context.events.map((event) => event.id),
    factIds: context.facts.map((fact) => fact.id),
  };
}

export interface DetailedAdvanceResult {
  world: WorldState;
  timings: SimulationAdvanceTimings;
}

type SimulationClock = () => number;

function simulationClock(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

export function advanceWorldDetailed(
  currentWorld: WorldState,
  now: SimulationClock = simulationClock,
): DetailedAdvanceResult {
  const totalStartedAt = now();
  const cloneStartedAt = now();
  const world = cloneWorld(currentWorld);
  const cloneMs = Math.max(0, now() - cloneStartedAt);
  const context = createTurnContext(world);
  const pipeline = createTurnPipelineRunner(now);
  const runSystem = pipeline.run;
  runSystem('environment', () => processRegions(world, context));
  runSystem('economy_trade', () => processV03EconomyAndTrade(world, context, (input) => pushEvent(world, context, input)));
  runSystem('migration', () => processV03Migration(world, context, (input) => pushEvent(world, context, input)));
  runSystem('character_lifecycle', () => processCharacterLifecycle(world, context));
  runSystem('society', () => processV02Society(world, context, (input) => pushEvent(world, context, input)));
  runSystem('core_politics', () => processPolitics(world, context));
  runSystem('social_politics', () => processV02Politics(world, context, (input) => pushEvent(world, context, input)));
  runSystem('rebellions', () => processRebellions(world, context));
  runSystem('army_maintenance', () => maintainArmies(world, context));
  runSystem('social_diplomacy', () => processV02Diplomacy(world, context, (input) => pushEvent(world, context, input)));
  runSystem('war_declarations', () => processWarDeclarations(world, context));
  runSystem('diplomacy', () => processV03Diplomacy(world, context, (input) => pushEvent(world, context, input)));
  runSystem('military', () => processMilitary(world, context));
  runSystem('maritime', () => processV03Maritime(world, context, (input) => pushEvent(world, context, input)));
  runSystem('disease', () => processV03Disease(world, context, (input) => pushEvent(world, context, input)));
  runSystem('knowledge', () => processV03Knowledge(world, context, (input) => pushEvent(world, context, input)));
  runSystem('military_careers', () => processV02MilitaryCareers(world, context, (input) => pushEvent(world, context, input)));
  runSystem('agency_decisions', () => processAgencyDecisionSystem(world, context, (input) => pushEvent(world, context, input)));
  runSystem('appointments', () => {
    syncOfficeAppointments(world, context.turn, context);
    refreshFactionPowerLedgers(world);
  });
  runSystem('situations', () => processSituationSystem(world, context, (input) => pushEvent(world, context, input)));
  runSystem('personal_memory', () => {
    world.agencySystem = reducePersonalMemorySystem(world, context.turn, context.facts);
  });
  runSystem('quarter_finalize', () => {
    finalizeTurn(world, context);
    world.turn += 1;
    const nextDate = getDateForTurn(world.turn);
    world.year = nextDate.year;
    world.season = nextDate.season;
  });
  const { systems, elapsedMs: systemsMs } = pipeline.finish();
  const hashStartedAt = now();
  world.hash = computeWorldHash(world);
  const hashMs = Math.max(0, now() - hashStartedAt);
  return {
    world,
    timings: {
      cloneMs,
      systemsMs,
      hashMs,
      totalMs: Math.max(0, now() - totalStartedAt),
      systems,
    },
  };
}

export function advanceWorld(currentWorld: WorldState): WorldState {
  return advanceWorldDetailed(currentWorld).world;
}

export function advanceWorldBy(currentWorld: WorldState, turns: number): WorldState {
  if (!Number.isInteger(turns) || turns < 0) throw new Error('Turn count must be a non-negative integer');
  let world = currentWorld;
  for (let index = 0; index < turns; index += 1) world = advanceWorld(world);
  return world;
}
