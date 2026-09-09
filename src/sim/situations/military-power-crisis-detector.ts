import { makeSituationSignal as makeSignal, situationIndexRef as indexRef } from "./candidate-registry";
import type {
  ArmyState,
  CharacterState,
  CommitmentState,
  FactionState,
  FamilyState,
  OfficeAppointment,
  PolityState,
  RelationshipState,
  WorldState,
} from '../types';
import type { SimulationFact } from '../facts';
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

export const MILITARY_POWER_CRISIS_TYPE = 'military_power_crisis';

export const MILITARY_POWER_CRISIS_TEMPLATE: SituationTemplate = {
  type: MILITARY_POWER_CRISIS_TYPE,
  titleKey: 'situation.military_power_crisis',
  // Eight-seed natural-world calibration keeps routine command pressure in the
  // candidate registry; only sustained upper-tail pressure becomes a crisis.
  formationThreshold: 62,
  activeEnterThreshold: 65,
  activeExitThreshold: 56,
  criticalEnterThreshold: 80,
  criticalExitThreshold: 70,
  resolutionThreshold: 20,
  formationConfirmTurns: 2,
  phaseConfirmTurns: 2,
  coolingConfirmTurns: 2,
  resolveAfterBelowTurns: 3,
  reformationCooldownTurns: 8,
  maxTensionRisePerTurn: 18,
  maxTensionFallPerTurn: 14,
};

const RECENT_COMMITMENT_TURNS = 16;
const MAX_PARTICIPANT_ARMIES = 4;
const MAX_SUPPORTERS = 6;
const MAX_OPPONENTS = 4;
const MAX_SOURCE_FACTS = 6;

type CommandRole = 'commander' | 'deputy';

interface CommandPosition {
  army: ArmyState;
  role: CommandRole;
}

export interface MilitaryPowerCrisisIndex {
  charactersById: ReadonlyMap<string, CharacterState>;
  politiesById: ReadonlyMap<string, PolityState>;
  familiesById: ReadonlyMap<string, FamilyState>;
  relationshipsByPair: ReadonlyMap<string, RelationshipState>;
  factions: readonly FactionState[];
  commitments: readonly CommitmentState[];
  offices: readonly OfficeAppointment[];
  armies: readonly ArmyState[];
  totalSoldiersByPolity: ReadonlyMap<string, number>;
}

export interface MilitaryPowerCrisisSignal extends SituationSignal {
  sourceFactIds: readonly string[];
}

export interface MilitaryPowerCrisisWatchSignal extends SituationWatchSignal {
}

/** Detector observations keep their exact source refs; presentation is projected elsewhere. */
export interface MilitaryPowerCrisisCandidate extends SituationCandidateObservation {
  type: typeof MILITARY_POWER_CRISIS_TYPE;
  candidateKey: string;
  hasExecutableActor: boolean;
  participants: SituationParticipants;
  executableActorIds: readonly string[];
  signals: readonly MilitaryPowerCrisisSignal[];
  sourceFactIds: readonly string[];
  nextWatch: MilitaryPowerCrisisWatchSignal;
  possibleOutcomes: readonly SituationOutcomeOption[];
}

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function stableCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueSorted(values: readonly string[], maximum = Number.POSITIVE_INFINITY): string[] {
  return [...new Set(values)].sort(stableCompare).slice(0, maximum);
}

function relationKey(sourceId: string, targetId: string): string {
  return `${sourceId}->${targetId}`;
}

function factRefs(factIds: readonly string[]): SituationEvidenceRef[] {
  return uniqueSorted(factIds, MAX_SOURCE_FACTS).map((factId) => ({ kind: 'fact', factId }));
}

function sortedMap<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  return new Map([...items].sort((left, right) => stableCompare(left.id, right.id)).map((item) => [item.id, item]));
}

export function buildMilitaryPowerCrisisIndex(world: WorldState): MilitaryPowerCrisisIndex {
  const totalSoldiersByPolity = new Map<string, number>();
  for (const army of [...world.armies].sort((left, right) => stableCompare(left.id, right.id))) {
    totalSoldiersByPolity.set(
      army.polityId,
      (totalSoldiersByPolity.get(army.polityId) ?? 0) + Math.max(0, army.soldiers),
    );
  }
  return {
    charactersById: sortedMap(world.characters),
    politiesById: sortedMap(world.polities),
    familiesById: sortedMap(world.families),
    relationshipsByPair: new Map([...world.relationships]
      .sort((left, right) => stableCompare(left.id, right.id))
      .map((relationship) => [relationKey(relationship.sourceId, relationship.targetId), relationship])),
    factions: [...world.factions].sort((left, right) => stableCompare(left.id, right.id)),
    commitments: [...world.commitments].sort((left, right) => stableCompare(left.id, right.id)),
    offices: [...world.offices].sort((left, right) => stableCompare(left.id, right.id)),
    armies: [...world.armies].sort((left, right) => stableCompare(left.id, right.id)),
    totalSoldiersByPolity,
  };
}

function militaryOfficeFor(
  index: MilitaryPowerCrisisIndex,
  characterId: string,
  armyId: string,
  role: CommandRole,
): OfficeAppointment | undefined {
  const expectedKind = role === 'commander' ? '军团主帅' : '军团副将';
  return index.offices.find((office) => (
    office.active
    && office.holderId === characterId
    && office.armyId === armyId
    && office.kind === expectedKind
  ));
}

function relevantMilitaryOrders(
  index: Readonly<MilitaryPowerCrisisIndex>,
  actorId: string,
  polityId: string,
  turn: number,
): CommitmentState[] {
  const orderRank = (commitment: CommitmentState): number => {
    const promisor = commitment.promisorId === actorId;
    if (promisor && commitment.status === '背约') return 0;
    if (promisor && commitment.status === '生效') return 1;
    if (promisor && commitment.status === '履约') return 2;
    if (!promisor && commitment.status === '背约') return 3;
    return 4;
  };
  return index.commitments
    .filter((commitment) => (
      commitment.kind === '军令'
      && commitment.polityIds.includes(polityId)
      && (commitment.promisorId === actorId || commitment.promiseeId === actorId)
      && (
        commitment.status === '生效'
        || (
          commitment.resolvedTurn !== null
          && turn - commitment.resolvedTurn <= RECENT_COMMITMENT_TURNS
        )
      )
    ))
    .sort((left, right) => (
      orderRank(left) - orderRank(right)
      || (right.resolvedTurn ?? right.madeTurn) - (left.resolvedTurn ?? left.madeTurn)
      || stableCompare(left.id, right.id)
    ))
    .slice(0, 1);
}

function battleParticipation(fact: SimulationFact, actorId: string): { role: CommandRole; won: boolean } | null {
  if (fact.kind !== 'battle') return null;
  const forces = [fact.payload.attacker, ...fact.payload.defenders];
  const force = forces.find((item) => item.commanderId === actorId
    || item.deputyCommanderId === actorId || item.allegianceCharacterId === actorId);
  if (!force) return null;
  const attackerSide = force.armyId === fact.payload.attacker.armyId;
  return {
    role: force.allegianceCharacterId === actorId || force.commanderId === actorId ? 'commander' : 'deputy',
    won: attackerSide ? fact.payload.attackerWon : !fact.payload.attackerWon,
  };
}

function relationshipContribution(relationship: RelationshipState): number {
  return clamp(
    relationship.grievance * 0.11
      + Math.max(0, 50 - relationship.trust) * 0.12
      - relationship.gratitude * 0.08
      - Math.max(0, relationship.affinity - 55) * 0.05
      - relationship.fear * 0.035,
    -12,
    14,
  );
}

function familyMobilizationScore(
  family: FamilyState | undefined,
  actor: CharacterState,
  index: Readonly<MilitaryPowerCrisisIndex>,
): { score: number; supportingIds: string[]; refs: SituationEvidenceRef[]; explanation: string } {
  if (!family?.active) {
    return {
      score: 0,
      supportingIds: [],
      refs: [indexRef('character', actor.id, 'familyId', actor.familyId || null)],
      explanation: '没有可核验的活跃家族资源',
    };
  }
  const head = index.charactersById.get(family.headId);
  const headRelation = head && head.id !== actor.id
    ? index.relationshipsByPair.get(relationKey(head.id, actor.id))
    : undefined;
  const livingMilitaryMembers = family.memberIds
    .map((id) => index.charactersById.get(id))
    .filter((member): member is CharacterState => Boolean(
      member?.alive
      && member.id !== actor.id
      && (member.commandingArmyId || member.deputyExperience >= 18),
    ))
    .sort((left, right) => stableCompare(left.id, right.id));
  const resourceBase = family.prestige * 0.22
    + family.politicalInfluence * 0.25
    + family.traditions.military * 0.28
    + Math.min(100, family.wealth / 3) * 0.1;
  const controlFactor = family.headId === actor.id
    ? 1
    : headRelation
      ? clamp((headRelation.trust + headRelation.affinity + headRelation.gratitude - headRelation.grievance) / 180, 0, 1)
      : 0.25;
  const score = clamp(resourceBase * controlFactor + livingMilitaryMembers.length * 5, 0, 100);
  const supporters = [
    ...(family.headId !== actor.id && head?.alive && controlFactor >= 0.5 ? [family.headId] : []),
    ...livingMilitaryMembers.map((member) => member.id),
  ];
  const refs: SituationEvidenceRef[] = [
    indexRef('family', family.id, 'headId', family.headId),
    indexRef('family', family.id, 'prestige', family.prestige),
    indexRef('family', family.id, 'politicalInfluence', family.politicalInfluence),
    indexRef('family', family.id, 'traditions.military', family.traditions.military),
    indexRef('family', family.id, 'wealth', family.wealth),
  ];
  if (headRelation) refs.push(indexRef('relationship', headRelation.id, 'trust', headRelation.trust));
  return {
    score,
    supportingIds: uniqueSorted(supporters, MAX_SUPPORTERS),
    refs,
    explanation: family.headId === actor.id
      ? `本人为家主，可直接调动家族资源；可动员度${Math.round(score)}`
      : `家族资源需经家主与亲族关系转化；可动员度${Math.round(score)}`,
  };
}

function possibleOutcomes(
  pressure: number,
  actor: CharacterState,
  polity: PolityState,
  hasExecutableActor: boolean,
  hasBrokenOrder: boolean,
): SituationOutcomeOption[] {
  const normalize = (value: number): number => Math.round(clamp(value));
  return [
    { key: 'appeased_or_promoted', confidence: normalize(actor.loyalty * 0.45 + polity.authority * 0.25 + (100 - pressure) * 0.2) },
    { key: 'recalled_or_reassigned', confidence: normalize(polity.authority * 0.45 + actor.caution * 0.25 + pressure * 0.15) },
    { key: 'order_refused', confidence: normalize((100 - actor.loyalty) * 0.35 + actor.insubordination * 0.3 + (hasBrokenOrder ? 25 : 0)) },
    { key: 'court_purge', confidence: normalize(polity.authority * 0.28 + actor.ambition * 0.2 + pressure * 0.28) },
    { key: 'armed_breakaway', confidence: normalize(hasExecutableActor ? pressure * 0.48 + actor.ambition * 0.25 + (100 - actor.loyalty) * 0.2 : pressure * 0.2) },
  ].sort((left, right) => right.confidence - left.confidence || stableCompare(left.key, right.key));
}

function buildResolutionCandidate(
  fact: SimulationFact,
  actor: CharacterState,
  polity: PolityState,
  outcomeKey: 'actor_died' | 'command_removed',
  primaryArmyId: string | null,
): MilitaryPowerCrisisCandidate {
  const scopeKey = `${polity.id}:${actor.id}`;
  const candidateKey = `${MILITARY_POWER_CRISIS_TYPE}:${scopeKey}`;
  const outcomeSignal = makeSignal(
    outcomeKey,
    'outcome',
    -30,
    [{ kind: 'fact', factId: fact.id }],
    [fact.id],
  );
  const nextWatch: MilitaryPowerCrisisWatchSignal = {
    key: outcomeKey === 'actor_died' ? 'watch_command_succession' : 'watch_post_command_settlement',
    refs: [{ kind: 'fact', factId: fact.id }],
  };
  return {
    type: MILITARY_POWER_CRISIS_TYPE,
    scopeKey,
    candidateKey,
    pressure: 0,
    hasExecutableActor: false,
    participants: {
      coreCharacterIds: [actor.id],
      supportingCharacterIds: [],
      opposingCharacterIds: [],
      familyIds: actor.familyId ? [actor.familyId] : [],
      factionIds: [],
      polityIds: [polity.id],
      regionIds: uniqueSorted(fact.regionIds, 4),
      armyIds: primaryArmyId ? [primaryArmyId] : [],
      fleetIds: [],
    },
    executableActorIds: [],
    signals: [outcomeSignal],
    sourceFactIds: [fact.id],
    nextWatch,
    possibleOutcomes: [],
    resolution: { outcomeKey, resultFactIds: [fact.id] },
    importance: Math.max(40, fact.importance * 20),
    visibility: Math.max(50, fact.importance * 20),
  };
}

function buildCandidate(
  context: { turn: number; facts: readonly SimulationFact[]; index: Readonly<MilitaryPowerCrisisIndex> },
  actor: CharacterState,
  polity: PolityState,
  positions: readonly CommandPosition[],
): MilitaryPowerCrisisCandidate | null {
  const { index } = context;
  const orderedPositions = [...positions].sort((left, right) => (
    (left.role === 'commander' ? 0 : 1) - (right.role === 'commander' ? 0 : 1)
    || right.army.soldiers - left.army.soldiers
    || stableCompare(left.army.id, right.army.id)
  ));
  const primary = orderedPositions[0];
  const ruler = index.charactersById.get(polity.rulerId);
  if (!primary || !ruler || actor.id === ruler.id) return null;

  const structureSignals: MilitaryPowerCrisisSignal[] = [];
  const triggerSignals: MilitaryPowerCrisisSignal[] = [];
  const inhibitorSignals: MilitaryPowerCrisisSignal[] = [];
  const add = (signal: MilitaryPowerCrisisSignal): void => {
    if (signal.role === 'trigger') triggerSignals.push(signal);
    else if (signal.role === 'inhibitor') inhibitorSignals.push(signal);
    else structureSignals.push(signal);
  };

  const mainPositions = orderedPositions.filter((position) => position.role === 'commander');
  const deputyPositions = orderedPositions.filter((position) => position.role === 'deputy');
  const soldiersInReach = mainPositions.reduce((sum, position) => sum + position.army.soldiers, 0);
  const politySoldiers = index.totalSoldiersByPolity.get(polity.id) ?? 0;
  const armyShare = soldiersInReach / Math.max(1, politySoldiers);
  const office = militaryOfficeFor(index, actor.id, primary.army.id, primary.role);
  const deputyFooting = actor.deputyExperience * 0.4 + actor.merit * 0.35 + actor.renown * 0.25;
  const commandContribution = primary.role === 'commander'
    ? 10 + clamp(armyShare * 16, 2, 16) + (office ? 2 : 0)
    : 4 + clamp((deputyFooting - 25) * 0.12, 0, 9) + (office ? 2 : 0);
  add(makeSignal(
    primary.role === 'commander' ? 'actual_army_command' : 'deputy_command_position',
    'capability',
    commandContribution,
    primary.role === 'commander'
      ? [
        indexRef('army', primary.army.id, 'allegiance.characterId', actor.id),
        indexRef('army', primary.army.id, 'allegiance.strength', primary.army.allegiance.strength),
        indexRef('character', actor.id, 'directSoldiers', soldiersInReach),
        indexRef('polity', polity.id, 'totalArmySoldiers', politySoldiers),
      ]
      : [
        indexRef('army', primary.army.id, 'deputyCommanderId', actor.id),
        indexRef('office', office?.id ?? `missing:${actor.id}:${primary.army.id}`, 'active', Boolean(office)),
        indexRef('character', actor.id, 'deputyExperience', actor.deputyExperience),
        indexRef('character', actor.id, 'merit', actor.merit),
      ],
  ));

  if (actor.ambition >= 50) {
    add(makeSignal(
      'high_ambition', 'structural', clamp((actor.ambition - 45) * 0.28, 0, 15),
      [indexRef('character', actor.id, 'ambition', actor.ambition)],
    ));
  } else {
    add(makeSignal(
      'low_ambition', 'inhibitor', -clamp((50 - actor.ambition) * 0.16, 1, 8),
      [indexRef('character', actor.id, 'ambition', actor.ambition)],
    ));
  }

  if (actor.loyalty <= 62) {
    add(makeSignal(
      'weak_loyalty', 'structural', clamp((68 - actor.loyalty) * 0.3, 1, 18),
      [indexRef('character', actor.id, 'loyalty', actor.loyalty)],
    ));
  } else {
    add(makeSignal(
      'strong_loyalty', 'inhibitor', -clamp((actor.loyalty - 58) * 0.22, 1, 10),
      [indexRef('character', actor.id, 'loyalty', actor.loyalty)],
    ));
  }

  if (polity.authority <= 60) {
    add(makeSignal(
      'weak_central_authority', 'structural', clamp((66 - polity.authority) * 0.32, 1, 20),
      [indexRef('polity', polity.id, 'authority', polity.authority)],
    ));
  } else {
    add(makeSignal(
      'strong_central_authority', 'inhibitor', -clamp((polity.authority - 56) * 0.22, 1, 11),
      [indexRef('polity', polity.id, 'authority', polity.authority)],
    ));
  }

  const actorToRuler = index.relationshipsByPair.get(relationKey(actor.id, ruler.id));
  const rulerToActor = index.relationshipsByPair.get(relationKey(ruler.id, actor.id));
  const ministerPressure = actorToRuler ? relationshipContribution(actorToRuler) : 0;
  const courtSuspicion = rulerToActor
    ? clamp(
      rulerToActor.grievance * 0.09 + rulerToActor.fear * 0.07
        + Math.max(0, 48 - rulerToActor.trust) * 0.1 - rulerToActor.gratitude * 0.06,
      -8,
      13,
    )
    : 0;
  const courtRelationshipContribution = clamp(ministerPressure + courtSuspicion, -18, 22);
  const courtRelationshipRole: SituationSignalRole = courtRelationshipContribution < 0
    ? 'inhibitor'
    : courtSuspicion >= 5
      ? 'trigger'
      : 'structural';
  add(makeSignal(
    actorToRuler || rulerToActor ? 'ruler_court_relationship' : 'ruler_court_relationship_unrecorded',
    courtRelationshipRole,
    courtRelationshipContribution,
    [
      ...(actorToRuler ? [
        indexRef('relationship', actorToRuler.id, 'trust', actorToRuler.trust),
        indexRef('relationship', actorToRuler.id, 'grievance', actorToRuler.grievance),
      ] : [indexRef('character', actor.id, 'polityId', actor.polityId)]),
      ...(rulerToActor ? [
        indexRef('relationship', rulerToActor.id, 'trust', rulerToActor.trust),
        indexRef('relationship', rulerToActor.id, 'fear', rulerToActor.fear),
      ] : [indexRef('polity', polity.id, 'rulerId', ruler.id)]),
    ],
  ));

  const directCommander = primary.role === 'deputy'
    ? index.charactersById.get(primary.army.commanderId)
    : undefined;
  const chainRelation = directCommander
    ? index.relationshipsByPair.get(relationKey(actor.id, directCommander.id))
    : undefined;
  if (chainRelation) {
    const contribution = relationshipContribution(chainRelation) * 0.9;
    add(makeSignal(
      'chain_of_command_relationship', contribution > 0 ? 'trigger' : 'inhibitor', contribution,
      [
        indexRef('relationship', chainRelation.id, 'trust', chainRelation.trust),
        indexRef('relationship', chainRelation.id, 'grievance', chainRelation.grievance),
      ],
    ));
  }

  const orders = relevantMilitaryOrders(index, actor.id, polity.id, context.turn);
  let activeExecutableOrder: CommitmentState | undefined;
  let hasBrokenOrder = false;
  for (const order of orders) {
    const isPromisor = order.promisorId === actor.id;
    const recentResolution = order.resolvedTurn !== null
      && context.turn - order.resolvedTurn <= RECENT_COMMITMENT_TURNS;
    if (isPromisor && order.status === '生效') {
      activeExecutableOrder = order;
      const duePressure = order.dueTurn !== null && order.dueTurn <= context.turn + 4 ? 3 : 0;
      add(makeSignal(
        'active_military_order', 'structural', 3 + duePressure,
        [
          indexRef('commitment', order.id, 'status', order.status),
          indexRef('commitment', order.id, 'promiseeId', order.promiseeId),
          indexRef('commitment', order.id, 'dueTurn', order.dueTurn),
        ],
      ));
    } else if (isPromisor && order.status === '背约' && recentResolution) {
      hasBrokenOrder = true;
      add(makeSignal(
        'military_order_breached', 'trigger', clamp(17 - Math.max(0, context.turn - (order.resolvedTurn ?? context.turn)) * 0.7, 6, 17),
        [
          indexRef('commitment', order.id, 'status', order.status),
          indexRef('commitment', order.id, 'resolvedTurn', order.resolvedTurn),
        ],
      ));
    } else if (isPromisor && order.status === '履约' && recentResolution) {
      add(makeSignal(
        'military_order_fulfilled', 'inhibitor', -clamp(9 - Math.max(0, context.turn - (order.resolvedTurn ?? context.turn)) * 0.4, 2, 9),
        [
          indexRef('commitment', order.id, 'status', order.status),
          indexRef('commitment', order.id, 'resolvedTurn', order.resolvedTurn),
        ],
      ));
    } else if (!isPromisor && order.status === '背约' && recentResolution) {
      add(makeSignal(
        'subordinate_order_breached', 'trigger', 5,
        [
          indexRef('commitment', order.id, 'status', order.status),
          indexRef('commitment', order.id, 'promisorId', order.promisorId),
        ],
      ));
    }
  }

  // The detector contract receives the current turn buffer. Rechecking turn here
  // prevents an accidental archive input from turning an old battle into a new trigger.
  const currentFacts = context.facts.filter((fact) => fact.turn === context.turn);
  const battleFacts = currentFacts
    .map((fact) => ({ fact, participation: battleParticipation(fact, actor.id) }))
    .filter((item): item is { fact: SimulationFact & { kind: 'battle' }; participation: { role: CommandRole; won: boolean } } => (
      item.fact.kind === 'battle' && item.participation !== null
    ));
  if (battleFacts.length > 0) {
    const wins = battleFacts.filter((item) => item.participation.won).length;
    const losses = battleFacts.length - wins;
    const contribution = clamp(battleFacts.length * 1.5 + (wins - losses) * 2.5, -6, 13);
    add(makeSignal(
      'recent_battle_record', contribution >= 0 ? 'trigger' : 'inhibitor', contribution,
      factRefs(battleFacts.map((item) => item.fact.id)),
      battleFacts.map((item) => item.fact.id),
    ));
  }

  const appointmentFacts = currentFacts.filter((fact) => (
    (fact.kind === 'appointment_started' || fact.kind === 'appointment_ended')
    && fact.payload.holderId === actor.id
    && (fact.payload.officeKind === '军团主帅' || fact.payload.officeKind === '军团副将')
  ));
  const endedAppointments = appointmentFacts.filter((fact) => fact.kind === 'appointment_ended');
  const startedAppointments = appointmentFacts.filter((fact) => fact.kind === 'appointment_started');
  if (endedAppointments.length > 0) {
    add(makeSignal(
      'recent_command_removed', 'trigger', 8,
      factRefs(endedAppointments.map((fact) => fact.id)),
      endedAppointments.map((fact) => fact.id),
    ));
  } else if (startedAppointments.length > 0) {
    add(makeSignal(
      'recent_command_granted', 'trigger', 4,
      factRefs(startedAppointments.map((fact) => fact.id)),
      startedAppointments.map((fact) => fact.id),
    ));
  }

  const currentArmies = orderedPositions.map((position) => position.army);
  const readiness = currentArmies.reduce((sum, army) => (
    sum + army.morale * 0.35 + army.training * 0.28 + army.supply * 0.22 + army.experience * 0.15
  ), 0) / Math.max(1, currentArmies.length);
  const readinessContribution = clamp((readiness - 42) * 0.12, -6, 8);
  add(makeSignal(
    'army_operational_readiness', readinessContribution >= 0 ? 'capability' : 'inhibitor', readinessContribution,
    [
      indexRef('army', primary.army.id, 'morale', primary.army.morale),
      indexRef('army', primary.army.id, 'training', primary.army.training),
      indexRef('army', primary.army.id, 'supply', primary.army.supply),
      indexRef('army', primary.army.id, 'experience', primary.army.experience),
    ],
  ));

  const actorFactions = index.factions.filter((faction) => (
    faction.active
    && faction.polityId === polity.id
    && (faction.id === actor.factionId || faction.leaderId === actor.id || faction.memberIds.includes(actor.id))
  ));
  const bestPoliticalFaction = [...actorFactions].sort((left, right) => (
    right.power * right.cohesion - left.power * left.cohesion || stableCompare(left.id, right.id)
  ))[0];
  if (bestPoliticalFaction) {
    const factionSupport = bestPoliticalFaction.power * bestPoliticalFaction.cohesion / 100;
    add(makeSignal(
      'military_network_support', 'capability', clamp(factionSupport * 0.13, 1, 13),
      [
        indexRef('faction', bestPoliticalFaction.id, 'power', bestPoliticalFaction.power),
        indexRef('faction', bestPoliticalFaction.id, 'cohesion', bestPoliticalFaction.cohesion),
        indexRef('faction', bestPoliticalFaction.id, 'leaderId', bestPoliticalFaction.leaderId),
      ],
    ));
  }

  const family = index.familiesById.get(actor.familyId);
  const familySupport = familyMobilizationScore(family, actor, index);
  if (familySupport.score >= 20) {
    add(makeSignal(
      'family_mobilization_capacity', 'capability', clamp((familySupport.score - 12) * 0.12, 1, 11),
      familySupport.refs,
    ));
  } else {
    add(makeSignal(
      'weak_family_base', 'inhibitor', -clamp((25 - familySupport.score) * 0.16, 1, 6),
      familySupport.refs,
    ));
  }

  const signals = [...structureSignals, ...triggerSignals, ...inhibitorSignals];
  const pressure = Math.round(clamp(8 + signals.reduce((sum, signal) => sum + signal.contribution, 0)));
  const hasMainCommand = mainPositions.some((position) => position.army.soldiers > 0);
  const hasExecutableActor = hasMainCommand || Boolean(activeExecutableOrder && deputyPositions.length > 0);
  const supporters = uniqueSorted([
    ...familySupport.supportingIds,
    ...(bestPoliticalFaction
      ? bestPoliticalFaction.memberIds.filter((id) => id !== actor.id && index.charactersById.get(id)?.alive)
      : []),
    ...mainPositions.flatMap((position) => {
      const deputyId = position.army.deputyCommanderId;
      if (!deputyId) return [];
      const deputyRelation = index.relationshipsByPair.get(relationKey(deputyId, actor.id));
      return deputyRelation && deputyRelation.trust + deputyRelation.gratitude >= 90 && deputyRelation.grievance < 35
        ? [deputyId]
        : [];
    }),
  ], MAX_SUPPORTERS);
  const opponents = uniqueSorted([
    ruler.id,
    ...(directCommander ? [directCommander.id] : []),
  ].filter((id) => id !== actor.id), MAX_OPPONENTS);
  const participants: SituationParticipants = {
    coreCharacterIds: [actor.id],
    supportingCharacterIds: supporters,
    opposingCharacterIds: opponents,
    familyIds: family?.active ? [family.id] : [],
    factionIds: bestPoliticalFaction ? [bestPoliticalFaction.id] : [],
    polityIds: [polity.id],
    regionIds: uniqueSorted(orderedPositions.map((position) => position.army.regionId), 4),
    armyIds: uniqueSorted(orderedPositions.map((position) => position.army.id), MAX_PARTICIPANT_ARMIES),
    fleetIds: [],
  };
  const sourceFactIds = uniqueSorted(signals.flatMap((signal) => signal.sourceFactIds), MAX_SOURCE_FACTS);
  const nextWatch = (() => {
    if (activeExecutableOrder) {
      return {
        key: 'watch_military_order_resolution',
        refs: [indexRef('commitment', activeExecutableOrder.id, 'status', activeExecutableOrder.status)],
      } satisfies MilitaryPowerCrisisWatchSignal;
    }
    if (primary.role === 'deputy') {
      return {
        key: 'watch_independent_command',
        refs: [
          indexRef('army', primary.army.id, 'commanderId', primary.army.commanderId),
          indexRef('army', primary.army.id, 'deputyCommanderId', primary.army.deputyCommanderId),
          indexRef('character', actor.id, 'merit', actor.merit),
        ],
      } satisfies MilitaryPowerCrisisWatchSignal;
    }
    if (polity.authority <= 60 || rulerToActor) {
      return {
        key: 'watch_recall_or_refusal',
        refs: [
          indexRef('polity', polity.id, 'authority', polity.authority),
          indexRef('army', primary.army.id, 'commanderId', primary.army.commanderId),
          ...(rulerToActor ? [indexRef('relationship', rulerToActor.id, 'trust', rulerToActor.trust)] : []),
        ],
      } satisfies MilitaryPowerCrisisWatchSignal;
    }
    return {
      key: 'watch_command_and_army_support',
      refs: [
        indexRef('army', primary.army.id, 'commanderId', primary.army.commanderId),
        indexRef('character', actor.id, 'merit', actor.merit),
        indexRef('polity', polity.id, 'authority', polity.authority),
      ],
    } satisfies MilitaryPowerCrisisWatchSignal;
  })();
  const scopeKey = `${polity.id}:${actor.id}`;
  const candidateKey = `${MILITARY_POWER_CRISIS_TYPE}:${scopeKey}`;
  return {
    type: MILITARY_POWER_CRISIS_TYPE,
    scopeKey,
    candidateKey,
    pressure,
    hasExecutableActor,
    participants,
    executableActorIds: hasExecutableActor ? [actor.id] : [],
    signals,
    sourceFactIds,
    nextWatch,
    possibleOutcomes: possibleOutcomes(pressure, actor, polity, hasExecutableActor, hasBrokenOrder),
    importance: Math.round(clamp(35 + pressure * 0.65)),
    visibility: Math.round(clamp(30 + pressure * 0.55 + (sourceFactIds.length > 0 ? 8 : 0))),
    resolution: null,
  };
}

function detectMilitaryPowerCrisis(
  context: { turn: number; facts: readonly SimulationFact[]; index: Readonly<MilitaryPowerCrisisIndex> },
): readonly MilitaryPowerCrisisCandidate[] {
  const positionsByActor = new Map<string, CommandPosition[]>();
  for (const army of context.index.armies) {
    const polity = context.index.politiesById.get(army.polityId);
    if (!polity?.alive) continue;
    const addPosition = (characterId: string | null, role: CommandRole): void => {
      if (!characterId) return;
      const character = context.index.charactersById.get(characterId);
      if (!character?.alive || character.polityId !== polity.id || character.id === polity.rulerId) return;
      const key = `${polity.id}:${character.id}`;
      const positions = positionsByActor.get(key) ?? [];
      if (positions.some((position) => position.army.id === army.id)) return;
      positions.push({ army, role });
      positionsByActor.set(key, positions);
    };
    addPosition(army.allegiance.characterId, 'commander');
    addPosition(army.deputyCommanderId, 'deputy');
  }

  const candidates: MilitaryPowerCrisisCandidate[] = [];
  for (const key of [...positionsByActor.keys()].sort(stableCompare)) {
    const positions = positionsByActor.get(key) ?? [];
    const actor = context.index.charactersById.get(key.slice(key.indexOf(':') + 1));
    const polity = context.index.politiesById.get(key.slice(0, key.indexOf(':')));
    if (!actor || !polity) continue;
    const candidate = buildCandidate(context, actor, polity, positions);
    if (candidate) candidates.push(candidate);
  }

  const observedScopes = new Set(candidates.map((candidate) => candidate.scopeKey));
  const currentFacts = context.facts
    .filter((fact) => fact.turn === context.turn)
    .sort((left, right) => stableCompare(left.id, right.id));
  for (const fact of currentFacts) {
    if (fact.kind !== 'character_death') continue;
    const actor = context.index.charactersById.get(fact.payload.characterId);
    const hasMilitaryRecord = fact.payload.role === '将领' || context.index.offices.some((office) => (
      office.holderId === fact.payload.characterId
      && (office.kind === '军团主帅' || office.kind === '军团副将')
    ));
    if (!actor || !hasMilitaryRecord) continue;
    const polityId = fact.polityIds[0] ?? actor.polityId;
    const polity = context.index.politiesById.get(polityId);
    if (!polity) continue;
    const scopeKey = `${polity.id}:${actor.id}`;
    if (observedScopes.has(scopeKey)) continue;
    const lastMilitaryOffice = [...context.index.offices]
      .filter((office) => (
        office.holderId === actor.id
        && (office.kind === '军团主帅' || office.kind === '军团副将')
      ))
      .sort((left, right) => right.appointedTurn - left.appointedTurn || stableCompare(left.id, right.id))[0];
    candidates.push(buildResolutionCandidate(
      fact,
      actor,
      polity,
      'actor_died',
      lastMilitaryOffice?.armyId ?? null,
    ));
    observedScopes.add(scopeKey);
  }
  for (const fact of currentFacts) {
    if (
      fact.kind !== 'appointment_ended'
      || (fact.payload.officeKind !== '军团主帅' && fact.payload.officeKind !== '军团副将')
    ) continue;
    const actor = context.index.charactersById.get(fact.payload.holderId);
    const polity = context.index.politiesById.get(fact.payload.polityId);
    if (!actor || !polity) continue;
    const scopeKey = `${polity.id}:${actor.id}`;
    if (observedScopes.has(scopeKey) || positionsByActor.has(scopeKey)) continue;
    candidates.push(buildResolutionCandidate(
      fact,
      actor,
      polity,
      'command_removed',
      fact.payload.armyId,
    ));
    observedScopes.add(scopeKey);
  }
  return candidates.sort((left, right) => (
    right.pressure - left.pressure || stableCompare(left.candidateKey, right.candidateKey)
  ));
}

export const militaryPowerCrisisDetector: SituationDetector<MilitaryPowerCrisisIndex> = {
  id: MILITARY_POWER_CRISIS_TYPE,
  detect: detectMilitaryPowerCrisis,
};

export function detectMilitaryPowerCrisisCandidates(
  world: WorldState,
  facts: readonly SimulationFact[] = [],
): readonly MilitaryPowerCrisisCandidate[] {
  return detectMilitaryPowerCrisis({
    turn: world.turn,
    facts,
    index: buildMilitaryPowerCrisisIndex(world),
  });
}
