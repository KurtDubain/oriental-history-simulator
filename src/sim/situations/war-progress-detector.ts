import type {
  ArmyState,
  CharacterState,
  FleetState,
  NavalOperationState,
  PolityState,
  RegionState,
  WarState,
  WorldState,
} from '../types';
import type {
  BattleFact,
  SimulationFact,
  TerritoryControlFact,
  WarEndedFact,
  WarEndResult,
  WarStartedFact,
} from '../facts';
import type {
  SituationCandidateObservation,
  SituationDetector,
  SituationEvidenceRef,
  SituationOutcomeOption,
  SituationParticipants,
  SituationSignal,
  SituationSignalRole,
  SituationTemplate,
  SituationWatchSignal,
} from './types';

export const WAR_PROGRESS_TYPE = 'war_progress';

export type WarProgressResolutionOutcomeKey = WarEndResult;

export const WAR_PROGRESS_TEMPLATE: SituationTemplate = {
  type: WAR_PROGRESS_TYPE,
  titleKey: 'situation.war_progress',
  formationThreshold: 55,
  activeEnterThreshold: 68,
  activeExitThreshold: 56,
  criticalEnterThreshold: 83,
  criticalExitThreshold: 72,
  resolutionThreshold: 18,
  formationConfirmTurns: 2,
  phaseConfirmTurns: 2,
  coolingConfirmTurns: 2,
  resolveAfterBelowTurns: 3,
  reformationCooldownTurns: 10,
  maxTensionRisePerTurn: 20,
  maxTensionFallPerTurn: 16,
};

const RECENT_OPERATION_TURNS = 2;
const RECENT_DECLARATION_TURNS = 1;
const MIN_CRITICAL_DURATION = 4;
const MAX_WAR_FACTS_PER_SCOPE = 16;
const MAX_CANDIDATES = 24;
const MAX_SOURCE_FACTS = 8;
const MAX_SIGNAL_REFS = 4;
const MAX_CORE_CHARACTERS = 6;
const MAX_SUPPORTERS = 8;
const MAX_PARTICIPANT_REGIONS = 8;
const MAX_PARTICIPANT_ARMIES = 8;
const MAX_PARTICIPANT_FLEETS = 4;

type WarProgressFact = WarStartedFact | WarEndedFact | BattleFact | TerritoryControlFact;

export interface WarProgressFactHistory {
  factIds: readonly string[];
  hasStartedFact: boolean;
  startedFactTurn: number | null;
  battleCount: number;
  battleTurns: readonly number[];
  lastBattleTurn: number | null;
  territoryChangeCount: number;
  territoryChangeTurns: readonly number[];
  lastTerritoryChangeTurn: number | null;
  armyIds: readonly string[];
  characterIds: readonly string[];
  regionIds: readonly string[];
}

export interface WarProgressIndex {
  warsById: ReadonlyMap<string, WarState>;
  politiesById: ReadonlyMap<string, PolityState>;
  charactersById: ReadonlyMap<string, CharacterState>;
  regionsById: ReadonlyMap<string, RegionState>;
  armies: readonly ArmyState[];
  fleets: readonly FleetState[];
  navalOperations: readonly NavalOperationState[];
  factHistoryByWarId: ReadonlyMap<string, Readonly<WarProgressFactHistory>>;
}

export interface WarProgressSignal extends SituationSignal {
  label: string;
  evidence: string;
  sourceFactIds: readonly string[];
}

export interface WarProgressWatchSignal extends SituationWatchSignal {
  label: string;
}

export interface WarProgressStartSnapshot {
  turn: number;
  warId: string;
  attackerId: string;
  defenderId: string;
  durationTurns: number;
  goal: WarState['goal'];
  attackerScore: number;
  defenderScore: number;
  attackerRegionCount: number;
  defenderRegionCount: number;
  attackerSoldiers: number;
  defenderSoldiers: number;
  averageSupply: number | null;
  recentBattleCount: number;
  recentTerritoryChangeCount: number;
}

export interface WarProgressCandidate extends SituationCandidateObservation {
  type: typeof WAR_PROGRESS_TYPE;
  candidateKey: string;
  title: string;
  hasExecutableActor: boolean;
  participants: SituationParticipants;
  executableActorIds: readonly string[];
  signals: readonly WarProgressSignal[];
  structureSignals: readonly WarProgressSignal[];
  triggerSignals: readonly WarProgressSignal[];
  inhibitorSignals: readonly WarProgressSignal[];
  sourceFactIds: readonly string[];
  nextWatch: WarProgressWatchSignal;
  nextWatchSignal: WarProgressWatchSignal;
  startSnapshot: WarProgressStartSnapshot;
  possibleOutcomes: readonly SituationOutcomeOption[];
}

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function rounded(value: number): number {
  return Math.round(value * 10) / 10;
}

function stableCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueSorted(
  values: readonly (string | null | undefined)[],
  maximum = Number.POSITIVE_INFINITY,
): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
    .sort(stableCompare)
    .slice(0, maximum);
}

function sortedMap<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  return new Map([...items]
    .sort((left, right) => stableCompare(left.id, right.id))
    .map((item) => [item.id, item]));
}

function indexRef(
  entityType: string,
  entityId: string,
  field: string,
  value: string | number | boolean | null,
): SituationEvidenceRef {
  return { kind: 'index', entityType, entityId, field, value };
}

function factRefs(factIds: readonly string[]): SituationEvidenceRef[] {
  return uniqueSorted(factIds, MAX_SOURCE_FACTS)
    .map((factId) => ({ kind: 'fact' as const, factId }));
}

function makeSignal(
  key: string,
  role: SituationSignalRole,
  contribution: number,
  label: string,
  evidence: string,
  refs: readonly SituationEvidenceRef[],
  sourceFactIds: readonly string[] = [],
): WarProgressSignal {
  return {
    key,
    role,
    contribution: rounded(clamp(contribution, -30, 30)),
    label,
    evidence,
    refs: refs.slice(0, MAX_SIGNAL_REFS),
    sourceFactIds: uniqueSorted(sourceFactIds, MAX_SOURCE_FACTS),
  };
}

function warIdOfFact(fact: SimulationFact): string | null {
  if (fact.kind === 'war_started' || fact.kind === 'war_ended' || fact.kind === 'battle') {
    return fact.payload.warId;
  }
  if (fact.kind === 'territory_control_changed') return fact.payload.warId;
  return null;
}

function isWarProgressFact(fact: SimulationFact): fact is WarProgressFact {
  return warIdOfFact(fact) !== null;
}

function emptyFactHistory(): WarProgressFactHistory {
  return {
    factIds: [],
    hasStartedFact: false,
    startedFactTurn: null,
    battleCount: 0,
    battleTurns: [],
    lastBattleTurn: null,
    territoryChangeCount: 0,
    territoryChangeTurns: [],
    lastTerritoryChangeTurn: null,
    armyIds: [],
    characterIds: [],
    regionIds: [],
  };
}

function mergeCurrentFactHistory(
  indexed: Readonly<WarProgressFactHistory>,
  currentFacts: readonly WarProgressFact[],
): WarProgressFactHistory {
  const known = new Set(indexed.factIds);
  const additions = currentFacts.filter((fact) => !known.has(fact.id));
  if (additions.length === 0) return { ...indexed };
  const added = summarizeWarFacts(additions);
  return {
    factIds: uniqueSorted([...indexed.factIds, ...added.factIds], MAX_WAR_FACTS_PER_SCOPE),
    hasStartedFact: indexed.hasStartedFact || added.hasStartedFact,
    startedFactTurn: indexed.startedFactTurn === null
      ? added.startedFactTurn
      : added.startedFactTurn === null
        ? indexed.startedFactTurn
        : Math.min(indexed.startedFactTurn, added.startedFactTurn),
    battleCount: indexed.battleCount + added.battleCount,
    battleTurns: [...indexed.battleTurns, ...added.battleTurns]
      .sort((left, right) => left - right)
      .slice(-MAX_WAR_FACTS_PER_SCOPE),
    lastBattleTurn: Math.max(indexed.lastBattleTurn ?? -1, added.lastBattleTurn ?? -1) < 0
      ? null
      : Math.max(indexed.lastBattleTurn ?? -1, added.lastBattleTurn ?? -1),
    territoryChangeCount: indexed.territoryChangeCount + added.territoryChangeCount,
    territoryChangeTurns: [...indexed.territoryChangeTurns, ...added.territoryChangeTurns]
      .sort((left, right) => left - right)
      .slice(-MAX_WAR_FACTS_PER_SCOPE),
    lastTerritoryChangeTurn: Math.max(
      indexed.lastTerritoryChangeTurn ?? -1,
      added.lastTerritoryChangeTurn ?? -1,
    ) < 0
      ? null
      : Math.max(indexed.lastTerritoryChangeTurn ?? -1, added.lastTerritoryChangeTurn ?? -1),
    armyIds: uniqueSorted([...indexed.armyIds, ...added.armyIds], MAX_PARTICIPANT_ARMIES * 2),
    characterIds: uniqueSorted([
      ...indexed.characterIds,
      ...added.characterIds,
    ], MAX_CORE_CHARACTERS + MAX_SUPPORTERS),
    regionIds: uniqueSorted([...indexed.regionIds, ...added.regionIds], MAX_PARTICIPANT_REGIONS),
  };
}

function summarizeWarFacts(facts: readonly WarProgressFact[]): WarProgressFactHistory {
  const ordered = [...facts]
    .sort((left, right) => left.turn - right.turn || stableCompare(left.id, right.id))
    .slice(-MAX_WAR_FACTS_PER_SCOPE);
  const starts = ordered.filter((fact): fact is WarStartedFact => fact.kind === 'war_started');
  const battles = ordered.filter((fact): fact is BattleFact => fact.kind === 'battle');
  const territories = ordered.filter((fact): fact is TerritoryControlFact => (
    fact.kind === 'territory_control_changed'
  ));
  return {
    factIds: ordered.map((fact) => fact.id),
    hasStartedFact: starts.length > 0,
    startedFactTurn: starts.length > 0 ? Math.min(...starts.map((fact) => fact.turn)) : null,
    battleCount: battles.length,
    battleTurns: battles.map((fact) => fact.turn).slice(-MAX_WAR_FACTS_PER_SCOPE),
    lastBattleTurn: battles.length > 0 ? Math.max(...battles.map((fact) => fact.turn)) : null,
    territoryChangeCount: territories.length,
    territoryChangeTurns: territories.map((fact) => fact.turn).slice(-MAX_WAR_FACTS_PER_SCOPE),
    lastTerritoryChangeTurn: territories.length > 0
      ? Math.max(...territories.map((fact) => fact.turn))
      : null,
    armyIds: uniqueSorted(battles.flatMap((fact) => [
      fact.payload.attacker.armyId,
      ...fact.payload.defenders.map((force) => force.armyId),
    ]), MAX_PARTICIPANT_ARMIES * 2),
    characterIds: uniqueSorted(battles.flatMap((fact) => [
      fact.payload.attacker.commanderId,
      fact.payload.attacker.deputyCommanderId,
      ...fact.payload.defenders.flatMap((force) => [force.commanderId, force.deputyCommanderId]),
    ]), MAX_CORE_CHARACTERS + MAX_SUPPORTERS),
    regionIds: uniqueSorted([
      ...battles.flatMap((fact) => fact.regionIds),
      ...territories.flatMap((fact) => fact.regionIds),
    ], MAX_PARTICIPANT_REGIONS),
  };
}

export function buildWarProgressIndex(world: Readonly<WorldState>): WarProgressIndex {
  const factsByWarId = new Map<string, WarProgressFact[]>();
  for (const fact of world.facts) {
    if (!isWarProgressFact(fact)) continue;
    const warId = warIdOfFact(fact);
    if (!warId) continue;
    const facts = factsByWarId.get(warId) ?? [];
    facts.push(fact);
    factsByWarId.set(warId, facts.slice(-MAX_WAR_FACTS_PER_SCOPE));
  }
  const factHistoryByWarId = new Map<string, WarProgressFactHistory>();
  for (const [warId, facts] of factsByWarId) factHistoryByWarId.set(warId, summarizeWarFacts(facts));
  return {
    warsById: sortedMap(world.wars),
    politiesById: sortedMap(world.polities),
    charactersById: sortedMap(world.characters),
    regionsById: sortedMap(world.regions),
    armies: [...world.armies].sort((left, right) => stableCompare(left.id, right.id)),
    fleets: [...world.fleets].sort((left, right) => stableCompare(left.id, right.id)),
    navalOperations: [...world.navalOperations].sort((left, right) => stableCompare(left.id, right.id)),
    factHistoryByWarId,
  };
}

function isFrontLineArmy(
  index: Readonly<WarProgressIndex>,
  war: WarState,
  army: ArmyState,
): boolean {
  if (army.polityId !== war.attackerId && army.polityId !== war.defenderId) return false;
  const enemyId = army.polityId === war.attackerId ? war.defenderId : war.attackerId;
  const region = index.regionsById.get(army.regionId);
  if (!region) return false;
  if (war.targetRegionIds.includes(region.id)) return true;
  return region.neighbors.some((neighborId) => {
    const neighbor = index.regionsById.get(neighborId);
    return Boolean(
      neighbor
      && (neighbor.controllerId === enemyId || war.targetRegionIds.includes(neighbor.id)),
    );
  });
}

interface WarForces {
  armies: ArmyState[];
  fleets: FleetState[];
}

function forcesForWar(
  index: Readonly<WarProgressIndex>,
  war: WarState,
  history: Readonly<WarProgressFactHistory>,
): WarForces {
  const historicalArmyIds = new Set(history.armyIds);
  const armies = index.armies
    .filter((army) => (
      army.soldiers > 0
      && (army.polityId === war.attackerId || army.polityId === war.defenderId)
      && (historicalArmyIds.has(army.id) || isFrontLineArmy(index, war, army))
    ))
    .sort((left, right) => (
      left.polityId === right.polityId
        ? right.soldiers - left.soldiers || stableCompare(left.id, right.id)
        : stableCompare(left.polityId, right.polityId)
    ))
    .slice(0, MAX_PARTICIPANT_ARMIES);
  const operationFleetIds = new Set(index.navalOperations
    .filter((operation) => operation.warId === war.id)
    .flatMap((operation) => operation.fleetIds));
  const fleets = index.fleets
    .filter((fleet) => (
      fleet.sailors > 0
      && (fleet.polityId === war.attackerId || fleet.polityId === war.defenderId)
      && operationFleetIds.has(fleet.id)
    ))
    .sort((left, right) => (
      right.warships - left.warships
      || right.sailors - left.sailors
      || stableCompare(left.id, right.id)
    ))
    .slice(0, MAX_PARTICIPANT_FLEETS);
  return { armies, fleets };
}

function soldierTotal(armies: readonly ArmyState[]): number {
  return armies.reduce((sum, army) => sum + Math.max(0, army.soldiers), 0);
}

function averageSupply(armies: readonly ArmyState[]): number | null {
  const soldiers = soldierTotal(armies);
  if (soldiers <= 0) return null;
  return armies.reduce((sum, army) => sum + army.supply * Math.max(0, army.soldiers), 0) / soldiers;
}

function relevantCharacters(
  index: Readonly<WarProgressIndex>,
  war: WarState,
  armies: readonly ArmyState[],
  fleets: readonly FleetState[],
  history: Readonly<WarProgressFactHistory>,
): {
  coreCharacterIds: string[];
  supportingCharacterIds: string[];
  executableActorIds: string[];
} {
  const attacker = index.politiesById.get(war.attackerId);
  const defender = index.politiesById.get(war.defenderId);
  const leadingArmies = [
    armies.find((army) => army.polityId === war.attackerId),
    armies.find((army) => army.polityId === war.defenderId),
  ].filter((army): army is ArmyState => Boolean(army));
  const leadingFleets = [
    fleets.find((fleet) => fleet.polityId === war.attackerId),
    fleets.find((fleet) => fleet.polityId === war.defenderId),
  ].filter((fleet): fleet is FleetState => Boolean(fleet));
  const coreCharacterIds = uniqueSorted([
    attacker?.rulerId,
    defender?.rulerId,
    ...leadingArmies.map((army) => army.commanderId),
    ...leadingFleets.map((fleet) => fleet.commanderId),
    ...history.characterIds,
  ], MAX_CORE_CHARACTERS);
  const supportingCharacterIds = uniqueSorted([
    ...armies.map((army) => army.deputyCommanderId),
    ...fleets.map((fleet) => fleet.deputyCommanderId),
  ].filter((id) => !id || !coreCharacterIds.includes(id)), MAX_SUPPORTERS);
  const armyActors = armies
    .filter((army) => army.soldiers >= 300 && army.morale >= 12 && army.supply >= 8)
    .map((army) => army.commanderId);
  const fleetActors = fleets
    .filter((fleet) => (
      fleet.sailors >= 100
      && fleet.morale >= 12
      && fleet.readiness >= 20
      && (fleet.mission === '封锁' || fleet.mission === '袭商' || fleet.mission === '登陆' || fleet.mission === '寻战')
    ))
    .map((fleet) => fleet.commanderId);
  const executableActorIds = uniqueSorted([...armyActors, ...fleetActors], 6)
    .filter((id) => index.charactersById.get(id)?.alive);
  return { coreCharacterIds, supportingCharacterIds, executableActorIds };
}

function participantSet(
  index: Readonly<WarProgressIndex>,
  war: WarState,
  history: Readonly<WarProgressFactHistory>,
): SituationParticipants {
  const { armies, fleets } = forcesForWar(index, war, history);
  const characters = relevantCharacters(index, war, armies, fleets, history);
  const familyIds = uniqueSorted(characters.coreCharacterIds.map((id) => (
    index.charactersById.get(id)?.familyId
  )), 4);
  return {
    coreCharacterIds: characters.coreCharacterIds,
    supportingCharacterIds: characters.supportingCharacterIds,
    opposingCharacterIds: [],
    familyIds,
    factionIds: [],
    polityIds: uniqueSorted([war.attackerId, war.defenderId], 2),
    regionIds: uniqueSorted([
      ...war.targetRegionIds,
      ...history.regionIds,
    ], MAX_PARTICIPANT_REGIONS),
    armyIds: uniqueSorted(armies.map((army) => army.id), MAX_PARTICIPANT_ARMIES),
    fleetIds: uniqueSorted(fleets.map((fleet) => fleet.id), MAX_PARTICIPANT_FLEETS),
  };
}

function likelyOutcomes(
  war: WarState,
  attacker: PolityState,
  defender: PolityState,
  duration: number,
): SituationOutcomeOption[] {
  const gap = war.attackerScore - war.defenderScore;
  const weariness = attacker.warWeariness + defender.warWeariness;
  const attackerFragility = clamp(35 - attacker.controlledRegionIds.length * 6 + (100 - attacker.authority) * 0.15);
  const defenderFragility = clamp(35 - defender.controlledRegionIds.length * 6 + (100 - defender.authority) * 0.15);
  const candidates: SituationOutcomeOption[] = [
    { key: 'attacker_advantage', confidence: Math.round(clamp(35 + gap * 1.8 + war.attackerScore * 0.3)) },
    { key: 'defender_advantage', confidence: Math.round(clamp(35 - gap * 1.8 + war.defenderScore * 0.3)) },
    { key: 'negotiated_peace', confidence: Math.round(clamp(18 + duration * 1.8 + weariness * 0.38 - Math.abs(gap) * 0.35)) },
    { key: 'attacker_destroyed', confidence: Math.round(attackerFragility) },
    { key: 'defender_destroyed', confidence: Math.round(defenderFragility) },
    { key: 'attacker_dissolved', confidence: Math.round(attackerFragility * 0.45) },
    { key: 'defender_dissolved', confidence: Math.round(defenderFragility * 0.45) },
  ];
  return candidates
    .sort((left, right) => right.confidence - left.confidence || stableCompare(left.key, right.key))
    .slice(0, 5);
}

function buildActiveCandidate(
  context: { turn: number; facts: readonly SimulationFact[]; index: Readonly<WarProgressIndex> },
  war: WarState,
): WarProgressCandidate | null {
  const attacker = context.index.politiesById.get(war.attackerId);
  const defender = context.index.politiesById.get(war.defenderId);
  if (!war.active || !attacker?.alive || !defender?.alive) return null;

  const currentWarFacts = context.facts.filter((fact): fact is WarProgressFact => (
    fact.turn === context.turn && isWarProgressFact(fact) && warIdOfFact(fact) === war.id
  ));
  const history = mergeCurrentFactHistory(
    context.index.factHistoryByWarId.get(war.id) ?? emptyFactHistory(),
    currentWarFacts,
  );
  const currentDeclaration = currentWarFacts.find((fact): fact is WarStartedFact => (
    fact.kind === 'war_started'
  ));
  const currentBattles = currentWarFacts.filter((fact): fact is BattleFact => fact.kind === 'battle');
  const currentTerritoryChanges = currentWarFacts.filter((fact): fact is TerritoryControlFact => (
    fact.kind === 'territory_control_changed'
  ));
  const duration = Math.max(1, context.turn - war.startedTurn + 1);
  const { armies, fleets } = forcesForWar(context.index, war, history);
  const attackerArmies = armies.filter((army) => army.polityId === war.attackerId);
  const defenderArmies = armies.filter((army) => army.polityId === war.defenderId);
  const attackerSoldiers = soldierTotal(attackerArmies);
  const defenderSoldiers = soldierTotal(defenderArmies);
  const combinedSoldiers = attackerSoldiers + defenderSoldiers;
  const supply = averageSupply(armies);
  const characters = relevantCharacters(context.index, war, armies, fleets, history);
  const recentBattleTurns = history.battleTurns.filter((turn) => (
    context.turn - turn >= 0 && context.turn - turn <= RECENT_OPERATION_TURNS
  ));
  const recentTerritoryTurns = history.territoryChangeTurns.filter((turn) => (
    context.turn - turn >= 0 && context.turn - turn <= RECENT_OPERATION_TURNS
  ));
  const recentBattleCount = recentBattleTurns.length;
  const recentTerritoryChangeCount = recentTerritoryTurns.length;
  const lastOperationalTurn = Math.max(
    history.lastBattleTurn ?? -1,
    history.lastTerritoryChangeTurn ?? -1,
  );
  const hasRecentOperation = lastOperationalTurn >= 0
    && context.turn - lastOperationalTurn <= RECENT_OPERATION_TURNS;
  const criticalEligible = duration >= MIN_CRITICAL_DURATION
    && hasRecentOperation
    && supply !== null
    && characters.executableActorIds.length > 0;

  const signals: WarProgressSignal[] = [];
  const add = (signal: WarProgressSignal): void => { signals.push(signal); };
  add(makeSignal(
    'ongoing_war', 'structural', 18,
    '战争仍在持续', `${attacker.name}与${defender.name}的战争自第${war.startedTurn}季起仍处于进行状态`, [
      indexRef('war', war.id, 'active', war.active),
      indexRef('war', war.id, 'startedTurn', war.startedTurn),
      indexRef('war_fact_history', war.id, 'hasStartedFact', history.hasStartedFact),
      ...(currentDeclaration ? [{ kind: 'fact' as const, factId: currentDeclaration.id }] : []),
    ], currentDeclaration ? [currentDeclaration.id] : [],
  ));
  add(makeSignal(
    'opposing_belligerents', 'structural', 8,
    '交战双方仍有国家载体', `${attacker.shortName}与${defender.shortName}均仍存续，并各自保有领土`, [
      indexRef('polity', attacker.id, 'alive', attacker.alive),
      indexRef('polity', defender.id, 'alive', defender.alive),
      indexRef('polity', attacker.id, 'controlledRegionCount', attacker.controlledRegionIds.length),
      indexRef('polity', defender.id, 'controlledRegionCount', defender.controlledRegionIds.length),
    ],
  ));
  add(makeSignal(
    'war_goal_and_duration', 'structural', clamp(5 + duration * 1.35, 6, 19),
    '战争目标与持续时间', `目标为“${war.goal}”，已经持续${duration}季；目标州域${war.targetRegionIds.length}处`, [
      indexRef('war', war.id, 'goal', war.goal),
      indexRef('war', war.id, 'durationTurns', duration),
      indexRef('war', war.id, 'targetRegionCount', war.targetRegionIds.length),
    ],
  ));
  const scoreVolume = Math.abs(war.attackerScore) + Math.abs(war.defenderScore);
  add(makeSignal(
    'recorded_war_score', 'structural', clamp(scoreVolume * 0.12, 0, 9),
    '战果正在累积', `当前战果为攻方${war.attackerScore}、守方${war.defenderScore}`, [
      indexRef('war', war.id, 'attackerScore', war.attackerScore),
      indexRef('war', war.id, 'defenderScore', war.defenderScore),
    ],
  ));

  if (
    history.startedFactTurn !== null
    && context.turn - history.startedFactTurn <= RECENT_DECLARATION_TURNS
  ) {
    const age = Math.max(0, context.turn - history.startedFactTurn);
    add(makeSignal(
      'recent_war_declaration', 'trigger', age === 0 ? 8 : 5,
      '战争刚刚爆发', `开战事实确认双方、目标和战争理由；距今${age}季`, [
        ...(currentDeclaration ? [{ kind: 'fact' as const, factId: currentDeclaration.id }] : [
          indexRef('war_fact_history', war.id, 'startedFactTurn', history.startedFactTurn),
        ]),
        indexRef('war', war.id, 'reason', war.reason),
      ], currentDeclaration ? [currentDeclaration.id] : [],
    ));
  }
  if (recentBattleCount > 0) {
    const currentLosses = currentBattles.reduce((sum, fact) => (
      sum + fact.payload.attacker.losses
      + fact.payload.defenders.reduce((inner, force) => inner + force.losses, 0)
      + fact.payload.militiaLosses
    ), 0);
    add(makeSignal(
      'recent_battles', 'trigger', clamp(10 + recentBattleCount * 3 + currentLosses / 2_500, 11, 20),
      '近期发生实战', currentBattles.length > 0
        ? `本季有${currentBattles.length}场战役，近${RECENT_OPERATION_TURNS + 1}季共${recentBattleCount}场；本季军民损失${currentLosses}`
        : `战争事实索引确认近${RECENT_OPERATION_TURNS + 1}季有${recentBattleCount}场战役`, [
        ...(currentBattles.length > 0
          ? factRefs(currentBattles.map((fact) => fact.id))
          : [
            indexRef('war_fact_history', war.id, 'lastBattleTurn', history.lastBattleTurn),
            indexRef('war_fact_history', war.id, 'battleCount', history.battleCount),
          ]),
      ], currentBattles.map((fact) => fact.id),
    ));
  }
  if (recentTerritoryChangeCount > 0) {
    add(makeSignal(
      'recent_territory_changes', 'trigger', clamp(10 + recentTerritoryChangeCount * 4, 10, 20),
      '战线改变了控制权', `近${RECENT_OPERATION_TURNS + 1}季有${recentTerritoryChangeCount}处州域因本战争转手`, [
        ...(currentTerritoryChanges.length > 0
          ? factRefs(currentTerritoryChanges.map((fact) => fact.id))
          : [
            indexRef('war_fact_history', war.id, 'lastTerritoryChangeTurn', history.lastTerritoryChangeTurn),
            indexRef('war_fact_history', war.id, 'territoryChangeCount', history.territoryChangeCount),
          ]),
      ], currentTerritoryChanges.map((fact) => fact.id),
    ));
  }
  if (
    !hasRecentOperation
    && (history.startedFactTurn === null || context.turn - history.startedFactTurn > RECENT_DECLARATION_TURNS)
  ) {
    add(makeSignal(
      'quiet_front', 'inhibitor', -12,
      '近期没有可核验的战线变化', `近${RECENT_OPERATION_TURNS + 1}季没有本战争的战役或领土控制 Fact`, [
        indexRef('war_fact_history', war.id, 'lastBattleTurn', history.lastBattleTurn),
        indexRef('war_fact_history', war.id, 'lastTerritoryChangeTurn', history.lastTerritoryChangeTurn),
        indexRef('war', war.id, 'active', war.active),
      ],
    ));
  }

  const averageWeariness = (attacker.warWeariness + defender.warWeariness) / 2;
  if (averageWeariness >= 20) {
    add(makeSignal(
      'war_weariness', 'structural', clamp((averageWeariness - 15) * 0.2, 1, 14),
      '战争疲劳正在积累', `双方平均战争疲劳${Math.round(averageWeariness)}`, [
        indexRef('polity', attacker.id, 'warWeariness', attacker.warWeariness),
        indexRef('polity', defender.id, 'warWeariness', defender.warWeariness),
      ],
    ));
  }
  if (supply === null) {
    add(makeSignal(
      'no_field_army', 'inhibitor', -12,
      '缺少可持续作战军团', '双方当前都没有仍保有兵力的陆军，战争无法进入持续高强度阶段', [
        indexRef('war', war.id, 'combinedSoldiers', 0),
      ],
    ));
  } else if (supply < 58) {
    add(makeSignal(
      'frontline_supply_strain', 'structural', clamp((62 - supply) * 0.22, 1, 12),
      '前线补给承压', `参战双方现有军团按兵力加权的平均补给为${Math.round(supply)}`, armies.slice(0, 4).map((army) => (
        indexRef('army', army.id, 'supply', army.supply)
      )),
    ));
  } else {
    add(makeSignal(
      'frontline_supply_ready', 'capability', clamp((supply - 52) * 0.1, 1, 6),
      '前线仍有补给能力', `参战双方现有军团按兵力加权的平均补给为${Math.round(supply)}`, armies.slice(0, 4).map((army) => (
        indexRef('army', army.id, 'supply', army.supply)
      )),
    ));
  }
  if (combinedSoldiers > 0) {
    add(makeSignal(
      'field_army_capacity', 'capability', clamp(3 + combinedSoldiers / 12_000, 3, 10),
      '双方仍有野战能力', `攻方现有${attackerSoldiers}人、守方现有${defenderSoldiers}人`, [
        indexRef('polity', attacker.id, 'fieldSoldiers', attackerSoldiers),
        indexRef('polity', defender.id, 'fieldSoldiers', defenderSoldiers),
        ...armies.slice(0, 2).map((army) => indexRef('army', army.id, 'morale', army.morale)),
      ],
    ));
  }
  if (criticalEligible) {
    const currentOperationalFact = [...currentBattles, ...currentTerritoryChanges]
      .sort((left, right) => stableCompare(left.id, right.id))
      .slice(-1)[0];
    add(makeSignal(
      'critical_operational_evidence', 'capability', 7,
      '持续战争具备升级条件', `战争已持续${duration}季，近期战线 Fact、当前补给和可行动主帅同时存在`, [
        ...(currentOperationalFact
          ? [{ kind: 'fact' as const, factId: currentOperationalFact.id }]
          : [indexRef('war_fact_history', war.id, 'lastOperationalTurn', lastOperationalTurn)]),
        indexRef('war', war.id, 'durationTurns', duration),
        indexRef('war', war.id, 'averageArmySupply', rounded(supply)),
        indexRef('war', war.id, 'executableCommanderCount', characters.executableActorIds.length),
      ], currentOperationalFact ? [currentOperationalFact.id] : [],
    ));
  }

  const rawPressure = 12 + signals.reduce((sum, signal) => sum + signal.contribution, 0);
  const pressure = Math.round(clamp(
    criticalEligible
      ? rawPressure
      : Math.min(rawPressure, WAR_PROGRESS_TEMPLATE.criticalEnterThreshold - 1),
  ));
  const executableActorIds = criticalEligible ? characters.executableActorIds : [];
  const participants = participantSet(context.index, war, history);
  const nextWatch: WarProgressWatchSignal = (() => {
    if (!hasRecentOperation) {
      return {
        key: 'watch_next_engagement',
        label: '观察双方是否发生下一场战役，或有州域控制权转移',
        refs: [
          indexRef('war_fact_history', war.id, 'lastBattleTurn', history.lastBattleTurn),
          indexRef('war', war.id, 'active', war.active),
        ],
      };
    }
    if (supply !== null && supply < 58) {
      return {
        key: 'watch_frontline_supply',
        label: '观察低补给军团会撤退、溃散，还是仍能改变战线',
        refs: armies.slice(0, 3).map((army) => indexRef('army', army.id, 'supply', army.supply)),
      };
    }
    const currentOperationalFact = [...currentBattles, ...currentTerritoryChanges]
      .sort((left, right) => stableCompare(left.id, right.id))
      .slice(-1)[0];
    return {
      key: 'watch_war_score_and_control',
      label: '观察下一场战役是否扩大战果差距并改变目标州域控制权',
      refs: [
        indexRef('war', war.id, 'attackerScore', war.attackerScore),
        indexRef('war', war.id, 'defenderScore', war.defenderScore),
        ...(currentOperationalFact
          ? [{ kind: 'fact' as const, factId: currentOperationalFact.id }]
          : [indexRef('war_fact_history', war.id, 'lastOperationalTurn', lastOperationalTurn)]),
      ],
    };
  })();
  const sourceFactIds = uniqueSorted(
    signals.flatMap((signal) => signal.sourceFactIds),
    MAX_SOURCE_FACTS,
  );
  return {
    type: WAR_PROGRESS_TYPE,
    scopeKey: war.id,
    candidateKey: `${WAR_PROGRESS_TYPE}:${war.id}`,
    title: `${attacker.shortName}与${defender.shortName}战事`,
    pressure,
    hasExecutableActor: executableActorIds.length > 0,
    participants,
    executableActorIds,
    signals,
    structureSignals: signals.filter((signal) => signal.role === 'structural' || signal.role === 'capability'),
    triggerSignals: signals.filter((signal) => signal.role === 'trigger'),
    inhibitorSignals: signals.filter((signal) => signal.role === 'inhibitor'),
    sourceFactIds,
    nextWatch,
    nextWatchSignal: nextWatch,
    startSnapshot: {
      turn: context.turn,
      warId: war.id,
      attackerId: war.attackerId,
      defenderId: war.defenderId,
      durationTurns: duration,
      goal: war.goal,
      attackerScore: war.attackerScore,
      defenderScore: war.defenderScore,
      attackerRegionCount: attacker.controlledRegionIds.length,
      defenderRegionCount: defender.controlledRegionIds.length,
      attackerSoldiers,
      defenderSoldiers,
      averageSupply: supply === null ? null : rounded(supply),
      recentBattleCount,
      recentTerritoryChangeCount,
    },
    possibleOutcomes: likelyOutcomes(war, attacker, defender, duration),
    importance: Math.round(clamp(38 + pressure * 0.62)),
    visibility: Math.round(clamp(36 + pressure * 0.55 + (sourceFactIds.length > 0 ? 8 : 0))),
    resolution: null,
  };
}

function resolutionLabel(result: WarEndResult): string {
  const labels: Record<WarEndResult, string> = {
    attacker_advantage: '攻方以优势结束战争',
    defender_advantage: '守方以优势结束战争',
    negotiated_peace: '双方议和停战',
    attacker_destroyed: '攻方政权在战争中覆灭',
    defender_destroyed: '守方政权在战争中覆灭',
    attacker_dissolved: '攻方因继承断绝而解体',
    defender_dissolved: '守方因继承断绝而解体',
  };
  return labels[result];
}

function buildResolutionCandidate(
  context: { turn: number; facts: readonly SimulationFact[]; index: Readonly<WarProgressIndex> },
  war: WarState,
  ended: WarEndedFact,
): WarProgressCandidate {
  const attacker = context.index.politiesById.get(war.attackerId);
  const defender = context.index.politiesById.get(war.defenderId);
  const currentWarFacts = context.facts.filter((fact): fact is WarProgressFact => (
    fact.turn === context.turn && isWarProgressFact(fact) && warIdOfFact(fact) === war.id
  ));
  const history = mergeCurrentFactHistory(
    context.index.factHistoryByWarId.get(war.id) ?? emptyFactHistory(),
    currentWarFacts,
  );
  const participants = participantSet(context.index, war, history);
  // war_ended is the atomic proof. Its own sourceFactIds retain the deeper
  // battle/territory chain without violating the current-turn-ref contract.
  const resultFactIds = [ended.id];
  const outcomeSignal = makeSignal(
    ended.payload.result,
    'outcome',
    -30,
    resolutionLabel(ended.payload.result),
    `${ended.payload.reason}；最终战果为攻方${ended.payload.attackerScore}、守方${ended.payload.defenderScore}，战争持续${ended.payload.durationTurns}季${ended.payload.indemnity > 0 ? `，赔款${ended.payload.indemnity}` : ''}`,
    [
      { kind: 'fact', factId: ended.id },
      indexRef('war', war.id, 'active', war.active),
      indexRef('war', war.id, 'endedTurn', war.endedTurn),
      indexRef('war', war.id, 'scoreGap', ended.payload.attackerScore - ended.payload.defenderScore),
    ],
    resultFactIds,
  );
  const nextWatch: WarProgressWatchSignal = {
    key: ended.payload.result === 'attacker_destroyed'
      || ended.payload.result === 'defender_destroyed'
      || ended.payload.result === 'attacker_dissolved'
      || ended.payload.result === 'defender_dissolved'
      ? 'watch_postwar_absorption'
      : 'watch_postwar_settlement',
    label: ended.payload.result === 'attacker_destroyed'
      || ended.payload.result === 'defender_destroyed'
      || ended.payload.result === 'attacker_dissolved'
      || ended.payload.result === 'defender_dissolved'
      ? '观察故国领土、军队、人物与家族如何进入新的政治秩序'
      : '观察停战边界、赔款与双方战争疲劳是否真正稳定下来',
    refs: [
      { kind: 'fact', factId: ended.id },
      indexRef('war', war.id, 'active', war.active),
    ],
  };
  const { armies } = forcesForWar(context.index, war, history);
  const attackerArmies = armies.filter((army) => army.polityId === war.attackerId);
  const defenderArmies = armies.filter((army) => army.polityId === war.defenderId);
  const recentBattleCount = history.battleTurns.filter((turn) => (
    context.turn - turn >= 0 && context.turn - turn <= RECENT_OPERATION_TURNS
  )).length;
  const recentTerritoryChangeCount = history.territoryChangeTurns.filter((turn) => (
    context.turn - turn >= 0 && context.turn - turn <= RECENT_OPERATION_TURNS
  )).length;
  return {
    type: WAR_PROGRESS_TYPE,
    scopeKey: war.id,
    candidateKey: `${WAR_PROGRESS_TYPE}:${war.id}`,
    title: `${attacker?.shortName ?? war.attackerId}与${defender?.shortName ?? war.defenderId}战事`,
    pressure: 0,
    hasExecutableActor: false,
    participants,
    executableActorIds: [],
    signals: [outcomeSignal],
    structureSignals: [],
    triggerSignals: [],
    inhibitorSignals: [],
    sourceFactIds: resultFactIds,
    nextWatch,
    nextWatchSignal: nextWatch,
    startSnapshot: {
      turn: context.turn,
      warId: war.id,
      attackerId: war.attackerId,
      defenderId: war.defenderId,
      durationTurns: ended.payload.durationTurns,
      goal: war.goal,
      attackerScore: ended.payload.attackerScore,
      defenderScore: ended.payload.defenderScore,
      attackerRegionCount: attacker?.controlledRegionIds.length ?? 0,
      defenderRegionCount: defender?.controlledRegionIds.length ?? 0,
      attackerSoldiers: soldierTotal(attackerArmies),
      defenderSoldiers: soldierTotal(defenderArmies),
      averageSupply: averageSupply(armies) === null ? null : rounded(averageSupply(armies) as number),
      recentBattleCount,
      recentTerritoryChangeCount,
    },
    possibleOutcomes: [],
    resolution: { outcomeKey: ended.payload.result, resultFactIds },
    importance: Math.max(60, ended.importance * 20),
    visibility: Math.max(65, ended.importance * 20),
  };
}

function detectWarProgress(
  context: { turn: number; facts: readonly SimulationFact[]; index: Readonly<WarProgressIndex> },
): readonly WarProgressCandidate[] {
  const results: WarProgressCandidate[] = [];
  const currentFacts = context.facts
    .filter((fact) => fact.turn === context.turn)
    .sort((left, right) => stableCompare(left.id, right.id));
  const endFactsByWar = new Map<string, WarEndedFact>();
  for (const fact of currentFacts) {
    if (fact.kind === 'war_ended') endFactsByWar.set(fact.payload.warId, fact);
  }

  for (const war of [...context.index.warsById.values()].sort((left, right) => stableCompare(left.id, right.id))) {
    const ended = endFactsByWar.get(war.id);
    if (ended) {
      if (
        !war.active
        && war.endedTurn === context.turn
        && ended.payload.attackerId === war.attackerId
        && ended.payload.defenderId === war.defenderId
      ) {
        results.push(buildResolutionCandidate(context, war, ended));
      }
      continue;
    }
    const candidate = buildActiveCandidate(context, war);
    if (candidate) results.push(candidate);
  }
  return results
    .sort((left, right) => right.pressure - left.pressure || stableCompare(left.candidateKey, right.candidateKey))
    .slice(0, MAX_CANDIDATES);
}

export const warProgressDetector: SituationDetector<WarProgressIndex> = {
  id: WAR_PROGRESS_TYPE,
  detect: detectWarProgress,
};

export function detectWarProgressCandidates(
  world: WorldState,
  facts: readonly SimulationFact[] = [],
): readonly WarProgressCandidate[] {
  return detectWarProgress({
    turn: world.turn,
    facts,
    index: buildWarProgressIndex(world),
  });
}
