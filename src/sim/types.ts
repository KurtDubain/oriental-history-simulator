export const SEASONS = ['春', '夏', '秋', '冬'] as const;

export type Season = (typeof SEASONS)[number];

export type Terrain =
  | '平原'
  | '丘陵'
  | '山地'
  | '高原'
  | '海岸'
  | '岛屿';

export type Climate = '温带' | '寒温带' | '暖温带' | '湿热' | '干旱';

export type RouteKind = '道路' | '河道' | '山道' | '海峡';

export type MapContentVersion = 'v03-82' | 'legacy-v02-48';

export const COMMODITIES = ['粮食', '木材', '铁器', '马匹', '盐', '纺织品', '奢侈品'] as const;
export type CommodityKind = (typeof COMMODITIES)[number];
export type NonFoodCommodity = Exclude<CommodityKind, '粮食'>;
export type CommodityStock = Record<NonFoodCommodity, number>;
export type CommodityPrices = Record<CommodityKind, number>;

export interface Point {
  x: number;
  y: number;
}

export interface RegionState {
  id: string;
  name: string;
  x: number;
  y: number;
  polygon: Point[];
  terrain: Terrain;
  climate: Climate;
  river: boolean;
  port: boolean;
  neighbors: string[];
  routeIds: string[];
  controllerId: string;
  population: number;
  food: number;
  wealth: number;
  cityLevel: number;
  defense: number;
  strategicValue: number;
  fertility: number;
  devastation: number;
  unrest: number;
  refugeePopulation: number;
  sanitation: number;
  medicalCapacity: number;
  marketLevel: number;
  portLevel: number;
  goods: CommodityStock;
  prices: CommodityPrices;
  resourcePotential: CommodityStock;
}

export interface RouteState {
  id: string;
  fromRegionId: string;
  toRegionId: string;
  kind: RouteKind;
  distance: number;
  supplyCapacity: number;
}

export interface SeaZoneState {
  id: string;
  name: string;
  x: number;
  y: number;
  adjacentSeaZoneIds: string[];
  portRegionIds: string[];
  climate: '北方海' | '季风海' | '内海' | '外洋';
  stormRisk: number;
  piracy: number;
  traffic: number;
  controllerId: string | null;
  contested: boolean;
  powerByPolity: Record<string, number>;
}

export interface SeaLaneState {
  id: string;
  fromSeaZoneId: string;
  toSeaZoneId: string;
  distance: number;
  capacity: number;
  baseRisk: number;
  strait: boolean;
}

export interface PortLinkState {
  id: string;
  regionId: string;
  seaZoneId: string;
  capacity: number;
  distance: number;
}

export interface PortState {
  id: string;
  regionId: string;
  level: number;
  throughput: number;
  shipyard: number;
  repair: number;
  merchantConfidence: number;
  blockadePressure: number;
  customsRevenue: number;
  damage: number;
}

export interface PolityState {
  id: string;
  name: string;
  shortName: string;
  dynastyName: string;
  color: string;
  alive: boolean;
  foundedTurn: number;
  eliminatedTurn: number | null;
  rulerId: string;
  capitalRegionId: string | null;
  controlledRegionIds: string[];
  treasury: number;
  legitimacy: number;
  authority: number;
  administration: number;
  warWeariness: number;
  taxRate: number;
  lastWarTurn: number;
  lastRebellionTurn: number;
  rulingFamilyId: string | null;
  governmentForm: '王朝' | '军府' | '盟约';
  courtInfluence: number;
  lastCourtCrisisTurn: number;
  tradeRevenue: number;
  navalBudget: number;
  maritimeOrientation: number;
  diplomaticReputation: number;
}

export type CharacterRole = '君主' | '地方长官' | '将领' | '廷臣';

export type LifeStage = '幼年' | '成长' | '成年' | '盛年' | '衰老' | '已故';

export type PoliticalClass = '宗室' | '官僚' | '士族' | '地方豪强' | '军门' | '外戚';

export interface BiographyFact {
  id: string;
  turn: number;
  kind: string;
  summary: string;
  importance: 1 | 2 | 3 | 4 | 5;
  eventId: string | null;
}

export interface CharacterState {
  id: string;
  name: string;
  familyName: string;
  givenName: string;
  sex: '男' | '女';
  age: number;
  alive: boolean;
  deathTurn: number | null;
  polityId: string;
  locationRegionId: string;
  role: CharacterRole;
  governedRegionId: string | null;
  commandingArmyId: string | null;
  commandingFleetId: string | null;
  leadership: number;
  governance: number;
  cunning: number;
  ambition: number;
  loyalty: number;
  caution: number;
  rebellionReadiness: number;
  renown: number;
  birthTurn: number;
  adultTurn: number | null;
  lifeStage: LifeStage;
  familyId: string;
  parentIds: string[];
  spouseIds: string[];
  politicalClass: PoliticalClass;
  influence: number;
  personalWealth: number;
  merit: number;
  deputyExperience: number;
  insubordination: number;
  biography: BiographyFact[];
  biographyDigest: string;
  tier: '核心' | '配角' | '背景晋升';
  sourceStubId: string | null;
  health: number;
  activeDiseaseId: string | null;
  protectedUntilTurn: number | null;
}

export interface BackgroundPersonState {
  id: string;
  polityId: string;
  regionId: string;
  familyName: string;
  givenName: string;
  sex: '男' | '女';
  birthTurn: number;
  politicalClass: PoliticalClass;
  potential: {
    leadership: number;
    governance: number;
    cunning: number;
  };
  opportunity: number;
  promotedCharacterId: string | null;
  promotedTurn: number | null;
}

export interface FamilyTraditions {
  political: number;
  military: number;
  commercial: number;
  scholarly: number;
}

export interface FamilyState {
  id: string;
  name: string;
  familyName: string;
  polityId: string;
  founderId: string;
  headId: string;
  parentFamilyId: string | null;
  branchName: string | null;
  foundedTurn: number;
  memberIds: string[];
  prestige: number;
  wealth: number;
  politicalInfluence: number;
  traditions: FamilyTraditions;
  marriageAllianceFamilyIds: string[];
  active: boolean;
  extinctTurn: number | null;
}

export type MemoryKind = '亲情' | '婚盟' | '提携' | '共战' | '背叛' | '羞辱' | '恩义' | '竞争';

export interface RelationshipMemory {
  turn: number;
  kind: MemoryKind;
  impact: number;
  summary: string;
  eventId: string | null;
}

export interface RelationshipState {
  id: string;
  sourceId: string;
  targetId: string;
  kinship: '无' | '父母' | '子女' | '手足' | '配偶' | '宗族';
  affinity: number;
  trust: number;
  fear: number;
  grievance: number;
  gratitude: number;
  lastInteractionTurn: number;
  memories: RelationshipMemory[];
}

export type FactionKind = '宗室' | '官僚' | '士族' | '军门' | '地方';

export interface FactionState {
  id: string;
  polityId: string;
  name: string;
  kind: FactionKind;
  leaderId: string;
  memberIds: string[];
  power: number;
  cohesion: number;
  agenda: '维持秩序' | '扩张权势' | '地方自治' | '对外战争' | '休养生息';
  alliedFactionIds: string[];
  lastActionTurn: number;
  active: boolean;
  endedTurn: number | null;
}

export type DiplomaticStatus = '中立' | '联盟' | '战争' | '朝贡';

export interface DiplomacyState {
  id: string;
  polityAId: string;
  polityBId: string;
  status: DiplomaticStatus;
  threatAtoB: number;
  threatBtoA: number;
  trust: number;
  grievance: number;
  culturalAffinity: number;
  tradeDependency: number;
  allianceUntilTurn: number | null;
  marriageIds: string[];
  lastChangedTurn: number;
  tradeAgreementUntilTurn: number | null;
  tributePayerId: string | null;
  tributePerTurn: number;
  treatyEventIds: string[];
}

export type OfficeKind = '君主' | '宰辅' | '枢密使' | '地方长官' | '军团主帅' | '军团副将' | '水师提督' | '水师副将' | '廷臣';

export interface OfficeAppointment {
  id: string;
  polityId: string;
  kind: OfficeKind;
  holderId: string;
  regionId: string | null;
  armyId: string | null;
  fleetId?: string | null;
  rank: number;
  appointedTurn: number;
  endedTurn: number | null;
  active: boolean;
}

export type CommitmentKind = '婚盟' | '政治联盟' | '军令' | '外交盟约' | '贸易条约' | '朝贡';
export type CommitmentStatus = '生效' | '履约' | '背约' | '失效';

export interface CommitmentState {
  id: string;
  kind: CommitmentKind;
  promisorId: string;
  promiseeId: string;
  polityIds: string[];
  terms: string;
  madeTurn: number;
  dueTurn: number | null;
  status: CommitmentStatus;
  resolvedTurn: number | null;
  eventId: string;
  resolutionEventId: string | null;
  trustStake: number;
}

export interface ArmyState {
  id: string;
  name: string;
  polityId: string;
  commanderId: string;
  deputyCommanderId: string | null;
  regionId: string;
  originRegionId: string;
  soldiers: number;
  morale: number;
  training: number;
  experience: number;
  supply: number;
  food: number;
  lastMovedTurn: number;
  embarkedOperationId: string | null;
}

export type FleetMission = '护航' | '巡逻' | '封锁' | '袭商' | '运输' | '登陆' | '寻战' | '避战';

export interface FleetState {
  id: string;
  name: string;
  polityId: string;
  commanderId: string;
  deputyCommanderId: string | null;
  homePortRegionId: string;
  portRegionId: string | null;
  seaZoneId: string | null;
  warships: number;
  transports: number;
  patrolShips: number;
  sailors: number;
  morale: number;
  training: number;
  experience: number;
  readiness: number;
  repairNeed: number;
  food: number;
  mission: FleetMission;
  targetSeaZoneId: string | null;
  targetRegionId: string | null;
  lastMovedTurn: number;
}

export type ShipmentKind = '贸易' | '迁徙' | '军粮' | '舰队补给' | '军团移动' | '海军运输';
export type ShipmentLegKind = 'route' | 'port-link' | 'sea-lane';

export interface ShipmentLeg {
  kind: ShipmentLegKind;
  edgeId: string;
  month: 0 | 1 | 2;
  capacityUsed: number;
}

export interface ShipmentRecord {
  id: string;
  kind: ShipmentKind;
  commodity: CommodityKind | null;
  originRegionId: string;
  destinationRegionId: string;
  acceptedAmount: number;
  deliveredAmount: number;
  lostAmount: number;
  raidedAmount: number;
  peopleDeparted: number;
  peopleArrived: number;
  peopleLost: number;
  contactVolume: number;
  legs: ShipmentLeg[];
  carrierArmyId: string | null;
  carrierFleetId: string | null;
  value: number;
  tariff: number;
  status: '交付' | '受损' | '被拒' | '取消';
}

export interface TradeCorridorState {
  id: string;
  originRegionId: string;
  destinationRegionId: string;
  commodity: CommodityKind;
  pathEdgeIds: string[];
  lastVolume: number;
  rollingVolume: number;
  rollingProfit: number;
  risk: number;
  active: boolean;
  lastActiveTurn: number;
}

export interface NavalOperationState {
  id: string;
  warId: string;
  armyId: string;
  fleetIds: string[];
  originRegionId: string;
  targetRegionId: string;
  seaZonePath: string[];
  stage: '集结' | '装载' | '航行' | '登陆' | '滩头' | '完成' | '失败';
  startedTurn: number;
  progress: number;
  foodLoaded: number;
  completedTurn: number | null;
}

export interface ShipbuildingProjectState {
  id: string;
  polityId: string;
  portRegionId: string;
  targetFleetId: string | null;
  warships: number;
  transports: number;
  patrolShips: number;
  timberCommitted: number;
  ironCommitted: number;
  treasurySpent: number;
  progress: number;
  startedTurn: number;
  completedTurn: number | null;
  status: '建造中' | '完成' | '取消';
}

export interface PathogenState {
  id: string;
  name: string;
  transmissibility: number;
  incubationMonths: number;
  durationMonths: number;
  fatality: number;
  immunityMonths: number;
  climateAffinity: Climate[];
  crowdingSensitivity: number;
  sanitationSensitivity: number;
}

export interface InfectionSource {
  turn: number;
  sourceHostId: string;
  shipmentId: string | null;
  routeEvidence: string[];
  importedExposures: number;
}

export interface DiseaseHostState {
  id: string;
  hostKind: 'region' | 'army' | 'fleet';
  hostId: string;
  pathogenId: string;
  susceptible: number;
  exposed: number;
  infectious: number;
  recovered: number;
  peakInfectious: number;
  startedTurn: number | null;
  zeroCaseMonths: number;
  recentSources: InfectionSource[];
}

export type PracticeCategory = '农业' | '军事' | '工程' | '医学' | '商业' | '航海';

export interface PracticeState {
  id: string;
  name: string;
  category: PracticeCategory;
  description: string;
  effectKey: 'harvest' | 'supply-loss' | 'devastation-recovery' | 'disease' | 'trade-loss' | 'sea-risk';
  effectStrength: number;
}

export interface RegionPracticeState {
  id: string;
  regionId: string;
  practiceId: string;
  innovationProgress: number;
  mastery: number;
  adoption: number;
  carrierStrength: number;
  carrierCharacterIds: string[];
  prototypeTurn: number | null;
  adoptedTurn: number | null;
  lostTurn: number | null;
  lastUsedTurn: number;
  sourceRegionId: string | null;
  sourceShipmentId: string | null;
  legacyBaseline: boolean;
}

export interface WarState {
  id: string;
  kind: 'interstate' | 'rebellion';
  attackerId: string;
  defenderId: string;
  startedTurn: number;
  endedTurn: number | null;
  active: boolean;
  attackerScore: number;
  defenderScore: number;
  reason: string;
  lastBattleTurn: number;
  goal: '征服' | '边境' | '独立' | '复仇' | '霸权';
  targetRegionIds: string[];
  exhaustion: number;
}

export type EventCategory =
  | '世界'
  | '人口'
  | '经济'
  | '政治'
  | '军事'
  | '外交'
  | '海洋'
  | '疾病'
  | '知识'
  | '迁徙';

export type EvidenceEntityType =
  | 'world'
  | 'region'
  | 'seaZone'
  | 'port'
  | 'polity'
  | 'character'
  | 'army'
  | 'fleet'
  | 'war'
  | 'tradeCorridor'
  | 'shipment'
  | 'pathogen'
  | 'infection'
  | 'practice'
  | 'migration';

export interface EvidenceRef {
  kind: 'entity' | 'event' | 'ledger' | 'shipment';
  entityType: EvidenceEntityType;
  entityId: string;
  field?: string;
  eventId?: string;
  label: string;
}

export interface EventCause {
  label: string;
  weight: number;
  evidence: string;
  role?: '结构' | '条件' | '触发' | '选择' | '结果';
  refs?: EvidenceRef[];
}

export type DeltaValue = number | string | boolean | null;

export interface StateDelta {
  entityType: 'world' | 'region' | 'seaZone' | 'port' | 'polity' | 'character' | 'army' | 'fleet' | 'war' | 'family' | 'relationship' | 'faction' | 'diplomacy' | 'office' | 'commitment' | 'tradeCorridor' | 'infection' | 'practice' | 'navalOperation';
  entityId: string;
  field: string;
  before: DeltaValue;
  after: DeltaValue;
  delta?: number;
}

export interface HistoryEvent {
  id: string;
  turn: number;
  year: number;
  season: Season;
  category: EventCategory;
  kind: string;
  title: string;
  summary: string;
  importance: 1 | 2 | 3 | 4 | 5;
  actorIds: string[];
  polityIds: string[];
  regionIds: string[];
  causes: EventCause[];
  evidence: string[];
  stateDeltas: StateDelta[];
}

export interface PopulationLedger {
  start: number;
  births: number;
  civilianDeaths: number;
  militaryDeaths: number;
  recruited: number;
  demobilized: number;
  end: number;
}

export interface FoodLedger {
  start: number;
  produced: number;
  civilianConsumed: number;
  armyConsumed: number;
  spoiled: number;
  warDestroyed: number;
  transferred: number;
  end: number;
}

export interface WealthLedger {
  start: number;
  produced: number;
  householdConsumed: number;
  warDestroyed: number;
  taxed: number;
  militaryPayments: number;
  end: number;
}

export interface RouteCapacityUsage {
  routeId: string;
  capacity: number;
  reserved: number;
  armyIds: string[];
  flowIds?: string[];
}

export interface SeaCapacityUsage {
  edgeId: string;
  capacity: number;
  reserved: number;
  flowIds: string[];
}

export interface LogisticsLedger {
  remoteFoodTransferred: number;
  routeUsage: RouteCapacityUsage[];
  seaUsage: SeaCapacityUsage[];
}

export interface TradeLedger {
  shipments: ShipmentRecord[];
  stockStart: CommodityStock;
  stockEnd: CommodityStock;
  produced: Partial<Record<CommodityKind, number>>;
  consumed: Partial<Record<CommodityKind, number>>;
  lost: Partial<Record<CommodityKind, number>>;
  valueTransferred: number;
  tariffsTransferred: number;
}

export interface MigrationLedger {
  departed: number;
  arrived: number;
  travelDeaths: number;
  settled: number;
  flowIds: string[];
}

export interface HealthLedger {
  infectiousStart: number;
  newExposures: number;
  importedExposures: number;
  civilianDeaths: number;
  militaryDeaths: number;
  infectiousEnd: number;
  outbreakRegionIds: string[];
}

export interface KnowledgeLedger {
  prototypeIds: string[];
  adoptedIds: string[];
  spreadIds: string[];
  lostIds: string[];
}

export interface MaritimeLedger {
  fleetIds: string[];
  blockadedPortIds: string[];
  raidedShipmentIds: string[];
  landingOperationIds: string[];
  shipsLost: number;
}

export interface TurnReport {
  turn: number;
  year: number;
  season: Season;
  population: PopulationLedger;
  food: FoodLedger;
  wealth: WealthLedger;
  logistics: LogisticsLedger;
  trade: TradeLedger;
  migration: MigrationLedger;
  health: HealthLedger;
  knowledge: KnowledgeLedger;
  maritime: MaritimeLedger;
  eventIds: string[];
}

export interface WorldCounters {
  character: number;
  army: number;
  polity: number;
  war: number;
  event: number;
  family: number;
  faction: number;
  relationship: number;
  office: number;
  commitment: number;
  fleet: number;
  tradeCorridor: number;
  navalOperation: number;
  shipment: number;
  shipProject: number;
}

export interface WorldState {
  schemaVersion: 3;
  mapContentVersion: MapContentVersion;
  seed: string;
  turn: number;
  year: number;
  season: Season;
  regions: RegionState[];
  routes: RouteState[];
  seaZones: SeaZoneState[];
  seaLanes: SeaLaneState[];
  portLinks: PortLinkState[];
  ports: PortState[];
  polities: PolityState[];
  characters: CharacterState[];
  armies: ArmyState[];
  fleets: FleetState[];
  wars: WarState[];
  families: FamilyState[];
  relationships: RelationshipState[];
  factions: FactionState[];
  diplomacy: DiplomacyState[];
  offices: OfficeAppointment[];
  backgroundPeople: BackgroundPersonState[];
  commitments: CommitmentState[];
  tradeCorridors: TradeCorridorState[];
  navalOperations: NavalOperationState[];
  shipbuildingProjects: ShipbuildingProjectState[];
  pathogens: PathogenState[];
  infections: DiseaseHostState[];
  practices: PracticeState[];
  practiceStates: RegionPracticeState[];
  history: HistoryEvent[];
  historyDigest: string;
  lastTurn: TurnReport | null;
  counters: WorldCounters;
  hash: string;
}

export type ObserverEntityKind = 'region' | 'seaZone' | 'polity' | 'character' | 'army' | 'fleet' | 'war' | 'tradeCorridor' | 'pathogen' | 'practice' | 'migration';

export interface ObserverFocus {
  kind: ObserverEntityKind;
  id: string;
}

export interface ObserverState {
  focused: ObserverFocus | null;
  followed: ObserverFocus[];
}

export interface InvariantViolation {
  code: string;
  message: string;
  entityId?: string;
}
