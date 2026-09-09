import { makeSituationSignal as makeSignal, situationIndexRef as indexRef } from "./candidate-registry";
import { isContinuousRulerSeat } from '../facts/projector';
import type {
  ArmyState,
  CharacterState,
  FactionState,
  FamilyState,
  FleetState,
  OfficeAppointment,
  PolityState,
  WorldState,
} from '../types';
import type {
  AppointmentEndedFact,
  AppointmentStartedFact,
  CharacterDeathFact,
  SimulationFact,
} from '../facts';
import type {
  SituationCandidateObservation,
  SituationDetector,
  SituationEvidenceRef,
  SituationOutcomeOption,
  SituationParticipants,
  SituationSignal,
  SituationTemplate,
  SituationWatchSignal,
} from './types';

export const INHERITANCE_CRISIS_TYPE = 'inheritance_crisis';

export type InheritanceResolutionOutcomeKey =
  | 'orderly_succession'
  | 'regency_established'
  | 'dynasty_replaced'
  | 'palace_transfer'
  | 'usurpation'
  | 'lineage_extinguished_and_absorbed'
  | 'polity_destroyed';

export const INHERITANCE_CRISIS_TEMPLATE: SituationTemplate = {
  type: INHERITANCE_CRISIS_TYPE,
  titleKey: 'situation.inheritance_crisis',
  formationThreshold: 58,
  activeEnterThreshold: 66,
  activeExitThreshold: 54,
  criticalEnterThreshold: 82,
  criticalExitThreshold: 70,
  resolutionThreshold: 18,
  formationConfirmTurns: 2,
  phaseConfirmTurns: 2,
  coolingConfirmTurns: 2,
  resolveAfterBelowTurns: 3,
  reformationCooldownTurns: 8,
  maxTensionRisePerTurn: 18,
  maxTensionFallPerTurn: 14,
};

const MAX_CLAIMANTS = 6;
const MAX_CORE_CHARACTERS = 4;
const MAX_SUPPORTERS = 6;
const MAX_OPPONENTS = 4;
const MAX_PARTICIPANT_FAMILIES = 4;
const MAX_PARTICIPANT_FACTIONS = 5;
const MAX_PARTICIPANT_ARMIES = 4;
const MAX_SOURCE_FACTS = 6;

export interface InheritanceClaimAssessment {
  characterId: string;
  age: number;
  lineageLegitimacy: number;
  legalClaim: boolean;
  familySupport: number;
  factionSupport: number;
  officeSupport: number;
  militarySupport: number;
  navalSupport: number;
  institutionalSupport: number;
  claimStrength: number;
  successionScore: number;
  regencyScore: number;
  executable: boolean;
  supportingFactionIds: readonly string[];
  supportingArmyIds: readonly string[];
  supportingFleetIds: readonly string[];
}

export interface InheritanceCrisisIndex {
  charactersById: ReadonlyMap<string, CharacterState>;
  politiesById: ReadonlyMap<string, PolityState>;
  familiesById: ReadonlyMap<string, FamilyState>;
  factions: readonly FactionState[];
  offices: readonly OfficeAppointment[];
  armies: readonly ArmyState[];
  fleets: readonly FleetState[];
  totalSoldiersByPolity: ReadonlyMap<string, number>;
  totalSailorsByPolity: ReadonlyMap<string, number>;
  claimsByPolity: ReadonlyMap<string, readonly InheritanceClaimAssessment[]>;
  expectedSuccessorByPolity: ReadonlyMap<string, string | null>;
  expectedRegentByPolity: ReadonlyMap<string, string | null>;
}

export interface InheritanceCrisisSignal extends SituationSignal {
  sourceFactIds: readonly string[];
}

export interface InheritanceCrisisWatchSignal extends SituationWatchSignal {
}

export interface InheritanceCrisisCandidate extends SituationCandidateObservation {
  type: typeof INHERITANCE_CRISIS_TYPE;
  candidateKey: string;
  hasExecutableActor: boolean;
  participants: SituationParticipants;
  executableActorIds: readonly string[];
  signals: readonly InheritanceCrisisSignal[];
  sourceFactIds: readonly string[];
  nextWatch: InheritanceCrisisWatchSignal;
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

function uniqueSorted(values: readonly string[], maximum = Number.POSITIVE_INFINITY): string[] {
  return [...new Set(values.filter(Boolean))].sort(stableCompare).slice(0, maximum);
}

function factRefs(factIds: readonly string[]): SituationEvidenceRef[] {
  return uniqueSorted(factIds, MAX_SOURCE_FACTS).map((factId) => ({ kind: 'fact', factId }));
}

function sortedMap<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  return new Map([...items]
    .sort((left, right) => stableCompare(left.id, right.id))
    .map((item) => [item.id, item]));
}

function lineageLegitimacy(
  candidate: CharacterState,
  ruler: CharacterState,
  rulingFamilyId: string | null,
): number {
  if (candidate.parentIds.includes(ruler.id)) return 100;
  if (candidate.spouseIds.includes(ruler.id)) return 72;
  if (candidate.parentIds.some((parentId) => ruler.parentIds.includes(parentId))) return 64;
  if (rulingFamilyId && candidate.familyId === rulingFamilyId) return 46;
  return 0;
}

function assessClaims(
  polity: PolityState,
  ruler: CharacterState,
  charactersById: ReadonlyMap<string, CharacterState>,
  familiesById: ReadonlyMap<string, FamilyState>,
  factions: readonly FactionState[],
  offices: readonly OfficeAppointment[],
  armies: readonly ArmyState[],
  fleets: readonly FleetState[],
  totalSoldiers: number,
  totalSailors: number,
): InheritanceClaimAssessment[] {
  const candidates = [...charactersById.values()]
    .filter((character) => character.alive && character.polityId === polity.id && character.id !== ruler.id)
    .sort((left, right) => stableCompare(left.id, right.id));

  const assessments = candidates.map((candidate): InheritanceClaimAssessment => {
    const lineage = lineageLegitimacy(candidate, ruler, polity.rulingFamilyId);
    const family = familiesById.get(candidate.familyId);
    const familySupport = family?.prestige ?? 0;
    const memberFactions = factions.filter((faction) => (
      faction.active
      && faction.polityId === polity.id
      && faction.memberIds.includes(candidate.id)
    ));
    // Keep the claim score semantically aligned with processCharacterLife's
    // current successor selection: membership contributes faction.power * .22.
    const factionSupport = memberFactions.reduce((sum, faction) => sum + faction.power * 0.22, 0);
    const appointments = offices.filter((office) => (
      office.active && office.polityId === polity.id && office.holderId === candidate.id
    ));
    const officeSupport = appointments.reduce((sum, office) => sum + office.rank * 0.14, 0);
    const commandedArmies = armies.filter((army) => (
      army.polityId === polity.id
      && (army.commanderId === candidate.id || army.deputyCommanderId === candidate.id)
    ));
    const soldiersInReach = commandedArmies.reduce((sum, army) => (
      sum + army.soldiers * (army.commanderId === candidate.id ? 1 : 0.35)
    ), 0);
    const militarySupport = clamp(soldiersInReach / Math.max(1, totalSoldiers) * 100);
    const commandedFleets = fleets.filter((fleet) => (
      fleet.polityId === polity.id
      && (fleet.commanderId === candidate.id || fleet.deputyCommanderId === candidate.id)
    ));
    const sailorsInReach = commandedFleets.reduce((sum, fleet) => (
      sum + fleet.sailors * (fleet.commanderId === candidate.id ? 1 : 0.35)
    ), 0);
    const navalSupport = clamp(sailorsInReach / Math.max(1, totalSailors) * 100);
    const hasDirectCommand = commandedArmies.some((army) => army.commanderId === candidate.id)
      || commandedFleets.some((fleet) => fleet.commanderId === candidate.id);
    // This deliberately mirrors the current engine, including its character
    // command-pointer lookup rather than inferring the +24 from army records.
    const institutionalSupport = factionSupport
      + officeSupport
      + familySupport * 0.18
      + (candidate.commandingArmyId || candidate.commandingFleetId ? 24 : 0);
    // Keep the weights exactly aligned with processCharacterLifecycle's
    // authoritative successor selection.
    const successionScore = lineage * 0.46
      + institutionalSupport * 0.34
      + candidate.governance * 0.08
      + candidate.cunning * 0.06
      + candidate.renown * 0.04
      + candidate.loyalty * 0.02;
    const regencyScore = institutionalSupport
      + candidate.governance
      + candidate.cunning
      + candidate.loyalty;
    const legalClaim = lineage >= 46;
    const hasHighOffice = appointments.some((office) => office.rank >= 70 && (
      office.kind === '宰辅'
      || office.kind === '枢密使'
      || office.kind === '地方长官'
      || office.kind === '军团主帅'
      || office.kind === '水师提督'
    ));
    const leadsStrongFaction = factions.some((faction) => (
      faction.active
      && faction.polityId === polity.id
      && faction.leaderId === candidate.id
      && faction.power >= 60
      && faction.cohesion >= 55
    ));
    const executable = candidate.age >= 16 && (
      hasHighOffice || hasDirectCommand || leadsStrongFaction
    );
    return {
      characterId: candidate.id,
      age: candidate.age,
      lineageLegitimacy: lineage,
      legalClaim,
      familySupport: rounded(familySupport),
      factionSupport: rounded(factionSupport),
      officeSupport: rounded(officeSupport),
      militarySupport: rounded(militarySupport),
      navalSupport: rounded(navalSupport),
      institutionalSupport: rounded(institutionalSupport),
      claimStrength: rounded(successionScore),
      successionScore,
      regencyScore,
      executable,
      supportingFactionIds: uniqueSorted([
        ...memberFactions.map((faction) => faction.id),
        ...factions.filter((faction) => (
          faction.active && faction.polityId === polity.id && faction.leaderId === candidate.id
        )).map((faction) => faction.id),
      ], MAX_PARTICIPANT_FACTIONS),
      supportingArmyIds: uniqueSorted(commandedArmies.map((army) => army.id), MAX_PARTICIPANT_ARMIES),
      supportingFleetIds: uniqueSorted(commandedFleets.map((fleet) => fleet.id), MAX_PARTICIPANT_ARMIES),
    };
  });
  const ranked = [...assessments].sort((left, right) => (
    right.successionScore - left.successionScore
      || stableCompare(left.characterId, right.characterId)
  ));
  const bestLegalMinor = [...assessments]
    .filter((claim) => claim.age < 16 && claim.legalClaim)
    .sort((left, right) => {
      const leftCharacter = charactersById.get(left.characterId);
      const rightCharacter = charactersById.get(right.characterId);
      const leftScore = left.lineageLegitimacy * 2 + left.age + (leftCharacter?.influence ?? 0);
      const rightScore = right.lineageLegitimacy * 2 + right.age + (rightCharacter?.influence ?? 0);
      return rightScore - leftScore || stableCompare(left.characterId, right.characterId);
    })[0];
  const bestAdult = ranked.find((claim) => claim.age >= 16);
  const bestNamedRegent = [...assessments]
    .filter((claim) => claim.age >= 16)
    .sort((left, right) => (
      right.regencyScore - left.regencyScore
      || stableCompare(left.characterId, right.characterId)
    ))[0];
  const selected: InheritanceClaimAssessment[] = [];
  for (const claim of [bestLegalMinor, bestAdult, bestNamedRegent, ...ranked]) {
    if (!claim || selected.some((item) => item.characterId === claim.characterId)) continue;
    selected.push(claim);
    if (selected.length >= MAX_CLAIMANTS) break;
  }
  return selected.sort((left, right) => (
    right.successionScore - left.successionScore
      || stableCompare(left.characterId, right.characterId)
  ));
}

interface ExpectedSuccessionPlan {
  successorId: string | null;
  regentId: string | null;
}

function expectedSuccessionPlan(
  world: Readonly<WorldState>,
  claims: readonly InheritanceClaimAssessment[],
  charactersById: ReadonlyMap<string, CharacterState>,
): ExpectedSuccessionPlan {
  const legalMinor = claims
    .filter((claim) => claim.age < 16 && claim.legalClaim)
    .sort((left, right) => {
      const leftCharacter = charactersById.get(left.characterId);
      const rightCharacter = charactersById.get(right.characterId);
      const leftScore = left.lineageLegitimacy * 2 + left.age + (leftCharacter?.influence ?? 0);
      const rightScore = right.lineageLegitimacy * 2 + right.age + (rightCharacter?.influence ?? 0);
      return rightScore - leftScore || stableCompare(left.characterId, right.characterId);
    })[0];
  const namedRegent = claims
    .filter((claim) => claim.age >= 16)
    .sort((left, right) => (
      right.regencyScore - left.regencyScore
      || stableCompare(left.characterId, right.characterId)
    ))[0];
  const hasBackgroundAdultRegent = world.backgroundPeople.some((person) => {
    const age = Math.floor((world.turn - person.birthTurn) / 4);
    return person.promotedCharacterId === null && age >= 16 && age <= 75;
  });
  if (legalMinor && (namedRegent || hasBackgroundAdultRegent)) {
    return {
      successorId: legalMinor.characterId,
      regentId: namedRegent?.characterId ?? null,
    };
  }
  return {
    successorId: claims.find((claim) => claim.age >= 16)?.characterId ?? null,
    regentId: null,
  };
}

export function buildInheritanceCrisisIndex(world: WorldState): InheritanceCrisisIndex {
  const charactersById = sortedMap(world.characters);
  const politiesById = sortedMap(world.polities);
  const familiesById = sortedMap(world.families);
  const factions = [...world.factions].sort((left, right) => stableCompare(left.id, right.id));
  const offices = [...world.offices].sort((left, right) => stableCompare(left.id, right.id));
  const armies = [...world.armies].sort((left, right) => stableCompare(left.id, right.id));
  const fleets = [...world.fleets].sort((left, right) => stableCompare(left.id, right.id));
  const totalSoldiersByPolity = new Map<string, number>();
  const totalSailorsByPolity = new Map<string, number>();
  for (const army of armies) {
    totalSoldiersByPolity.set(
      army.polityId,
      (totalSoldiersByPolity.get(army.polityId) ?? 0) + Math.max(0, army.soldiers),
    );
  }
  for (const fleet of fleets) {
    totalSailorsByPolity.set(
      fleet.polityId,
      (totalSailorsByPolity.get(fleet.polityId) ?? 0) + Math.max(0, fleet.sailors),
    );
  }
  const claimsByPolity = new Map<string, readonly InheritanceClaimAssessment[]>();
  const expectedSuccessorByPolity = new Map<string, string | null>();
  const expectedRegentByPolity = new Map<string, string | null>();
  for (const polity of [...world.polities].sort((left, right) => stableCompare(left.id, right.id))) {
    const ruler = charactersById.get(polity.rulerId);
    if (!polity.alive || !ruler?.alive) continue;
    const claims = assessClaims(
      polity,
      ruler,
      charactersById,
      familiesById,
      factions,
      offices,
      armies,
      fleets,
      totalSoldiersByPolity.get(polity.id) ?? 0,
      totalSailorsByPolity.get(polity.id) ?? 0,
    );
    claimsByPolity.set(polity.id, claims);
    const expected = expectedSuccessionPlan(world, claims, charactersById);
    expectedSuccessorByPolity.set(polity.id, expected.successorId);
    expectedRegentByPolity.set(polity.id, expected.regentId);
  }
  return {
    charactersById,
    politiesById,
    familiesById,
    factions,
    offices,
    armies,
    fleets,
    totalSoldiersByPolity,
    totalSailorsByPolity,
    claimsByPolity,
    expectedSuccessorByPolity,
    expectedRegentByPolity,
  };
}

function relevantCurrentFacts(
  facts: readonly SimulationFact[],
  turn: number,
  polity: PolityState,
  ruler: CharacterState,
  claims: readonly InheritanceClaimAssessment[],
): SimulationFact[] {
  const actorIds = new Set([ruler.id, ...claims.map((claim) => claim.characterId)]);
  return facts.filter((fact) => {
    if (fact.turn !== turn || fact.kind === 'situation_milestone' || isContinuousRulerSeat(fact, facts)) return false;
    if (fact.kind === 'appointment_started' || fact.kind === 'appointment_ended') {
      return fact.payload.polityId === polity.id && (
        fact.payload.officeKind === '君主' || actorIds.has(fact.payload.holderId)
      );
    }
    if (fact.kind === 'marriage') return (
      actorIds.has(fact.payload.leftCharacterId) || actorIds.has(fact.payload.rightCharacterId)
    );
    if (fact.kind === 'character_death') return (
      actorIds.has(fact.payload.characterId)
      || (fact.payload.role === '君主' && fact.polityIds.includes(polity.id))
    );
    if (fact.kind === 'battle') return [fact.payload.attacker, ...fact.payload.defenders]
      .some((force) => actorIds.has(force.commanderId) || Boolean(
        force.deputyCommanderId && actorIds.has(force.deputyCommanderId)
      ));
    if (fact.kind === 'territory_control_changed') return Boolean(
      polity.capitalRegionId
      && fact.payload.regionId === polity.capitalRegionId
      && (
        fact.payload.previousControllerId === polity.id
        || fact.payload.nextControllerId === polity.id
      )
    );
    return false;
  }).sort((left, right) => stableCompare(left.id, right.id));
}

function familyAndFactionSupporters(
  index: Readonly<InheritanceCrisisIndex>,
  claims: readonly InheritanceClaimAssessment[],
): string[] {
  const claimantIds = new Set(claims.map((claim) => claim.characterId));
  const familyHeads = claims.flatMap((claim) => {
    const character = index.charactersById.get(claim.characterId);
    const family = character ? index.familiesById.get(character.familyId) : undefined;
    return family?.active && family.headId !== character?.id && index.charactersById.get(family.headId)?.alive
      ? [family.headId]
      : [];
  });
  const factionLeaders = claims.flatMap((claim) => claim.supportingFactionIds)
    .map((id) => index.factions.find((faction) => faction.id === id)?.leaderId)
    .filter((id): id is string => Boolean(id && !claimantIds.has(id)));
  return uniqueSorted(
    [...familyHeads, ...factionLeaders].filter((id) => !claimantIds.has(id)),
    MAX_SUPPORTERS,
  );
}

function possibleOutcomes(
  pressure: number,
  polity: PolityState,
  ruler: CharacterState,
  legalCount: number,
  leading: InheritanceClaimAssessment | undefined,
): SituationOutcomeOption[] {
  const normalize = (value: number): number => Math.round(clamp(value));
  return [
    {
      key: 'orderly_succession',
      confidence: normalize((leading?.lineageLegitimacy ?? 0) * 0.5 + polity.legitimacy * 0.28 + (legalCount === 1 ? 16 : 0)),
    },
    {
      key: 'regency_established',
      confidence: normalize(legalCount > 0 && leading && leading.age < 16 ? 72 : (100 - ruler.health) * 0.28),
    },
    {
      key: 'dynasty_replaced',
      confidence: normalize(pressure * 0.24 + (leading?.lineageLegitimacy ?? 0) * 0.25 + (100 - polity.legitimacy) * 0.18),
    },
    {
      key: 'palace_transfer',
      confidence: normalize(polity.authority * 0.26 + (leading?.lineageLegitimacy ?? 0) * 0.25 + (100 - pressure) * 0.18),
    },
    {
      key: 'usurpation',
      confidence: normalize(pressure * 0.38 + (100 - polity.legitimacy) * 0.28 + (legalCount === 0 ? 22 : 0)),
    },
    {
      key: 'lineage_extinguished_and_absorbed',
      confidence: normalize((100 - polity.authority) * 0.18 + (legalCount === 0 ? 25 : 0)),
    },
    {
      key: 'polity_destroyed',
      confidence: normalize((100 - polity.authority) * 0.22 + (100 - polity.legitimacy) * 0.18 + pressure * 0.16),
    },
  ].sort((left, right) => right.confidence - left.confidence || stableCompare(left.key, right.key));
}

function buildLiveCandidate(
  context: { turn: number; facts: readonly SimulationFact[]; index: Readonly<InheritanceCrisisIndex> },
  polity: PolityState,
  ruler: CharacterState,
): InheritanceCrisisCandidate {
  const { index } = context;
  const claims = index.claimsByPolity.get(polity.id) ?? [];
  const legalClaims = claims.filter((claim) => claim.legalClaim);
  const credibleClaims = claims.filter((claim) => claim.claimStrength >= 38 || claim.institutionalSupport >= 28);
  const expectedId = index.expectedSuccessorByPolity.get(polity.id) ?? null;
  const expectedRegentId = index.expectedRegentByPolity.get(polity.id) ?? null;
  const leading = claims.find((claim) => claim.characterId === expectedId) ?? claims[0];
  const runnerUp = claims.find((claim) => claim.characterId !== leading?.characterId);
  const claimGap = leading
    ? Math.max(0, leading.claimStrength - (runnerUp?.claimStrength ?? 0))
    : 0;
  const signals: InheritanceCrisisSignal[] = [];
  const add = (signal: InheritanceCrisisSignal): void => { signals.push(signal); };

  const mortalityExposure = clamp(
    Math.max(0, ruler.age - 47) * 1.15 + Math.max(0, 72 - ruler.health) * 0.52,
  );
  if (mortalityExposure >= 10) {
    add(makeSignal(
      'ruler_mortality_exposure', 'structural', clamp(mortalityExposure * 0.48, 2, 24),
      [
        indexRef('character', ruler.id, 'age', ruler.age),
        indexRef('character', ruler.id, 'health', ruler.health),
      ],
    ));
  } else {
    add(makeSignal(
      'ruler_health_stable', 'inhibitor', -clamp((18 - mortalityExposure) * 0.45, 2, 8),
      [
        indexRef('character', ruler.id, 'age', ruler.age),
        indexRef('character', ruler.id, 'health', ruler.health),
      ],
    ));
  }

  const poolRefs: SituationEvidenceRef[] = [
    indexRef('succession_pool', polity.id, 'legalCandidateCount', legalClaims.length),
    indexRef('succession_pool', polity.id, 'credibleCandidateCount', credibleClaims.length),
    indexRef('succession_pool', polity.id, 'leadingCandidateId', leading?.characterId ?? null),
    indexRef('succession_pool', polity.id, 'claimStrengthGap', rounded(claimGap)),
  ];
  if (legalClaims.length === 0) {
    add(makeSignal(
      'no_legal_successor', 'structural', 24,
      poolRefs,
    ));
  } else if (legalClaims.length >= 2 && claimGap < 22) {
    add(makeSignal(
      'competing_legal_claims', 'structural', clamp(8 + legalClaims.length * 3 + (22 - claimGap) * 0.22, 10, 21),
      poolRefs,
    ));
  } else {
    add(makeSignal(
      'clear_legal_successor', 'inhibitor', -clamp(7 + claimGap * 0.18, 7, 15),
      poolRefs,
    ));
  }

  if (polity.legitimacy < 58) {
    add(makeSignal(
      'weak_dynastic_legitimacy', 'structural', clamp((62 - polity.legitimacy) * 0.38, 2, 20),
      [indexRef('polity', polity.id, 'legitimacy', polity.legitimacy)],
    ));
  } else {
    add(makeSignal(
      'strong_dynastic_legitimacy', 'inhibitor', -clamp((polity.legitimacy - 52) * 0.18, 2, 9),
      [indexRef('polity', polity.id, 'legitimacy', polity.legitimacy)],
    ));
  }
  if (polity.authority < 55) {
    add(makeSignal(
      'weak_succession_enforcement', 'structural', clamp((60 - polity.authority) * 0.3, 2, 18),
      [indexRef('polity', polity.id, 'authority', polity.authority)],
    ));
  } else {
    add(makeSignal(
      'strong_succession_enforcement', 'inhibitor', -clamp((polity.authority - 50) * 0.16, 2, 8),
      [indexRef('polity', polity.id, 'authority', polity.authority)],
    ));
  }

  const rulingFamily = polity.rulingFamilyId ? index.familiesById.get(polity.rulingFamilyId) : undefined;
  const dynastyCapacity = rulingFamily?.active
    ? clamp(rulingFamily.prestige * 0.52 + rulingFamily.politicalInfluence * 0.48)
    : 0;
  if (dynastyCapacity < 48) {
    add(makeSignal(
      'weak_ruling_family_capacity', 'structural', clamp((54 - dynastyCapacity) * 0.22, 2, 12),
      rulingFamily ? [
        indexRef('family', rulingFamily.id, 'prestige', rulingFamily.prestige),
        indexRef('family', rulingFamily.id, 'politicalInfluence', rulingFamily.politicalInfluence),
      ] : [indexRef('polity', polity.id, 'rulingFamilyId', polity.rulingFamilyId)],
    ));
  } else {
    add(makeSignal(
      'strong_ruling_family_capacity', 'inhibitor', -clamp((dynastyCapacity - 42) * 0.12, 2, 8),
      [
        indexRef('family', rulingFamily?.id ?? polity.id, 'dynasticCapacity', Math.round(dynastyCapacity)),
      ],
    ));
  }

  const factionBacked = claims.filter((claim) => claim.factionSupport >= 20);
  const factionLeaders = new Set(factionBacked.flatMap((claim) => claim.supportingFactionIds));
  if (factionBacked.length >= 2) {
    add(makeSignal(
      'factional_succession_split', 'structural', clamp(6 + factionBacked.length * 3, 8, 16),
      [
        indexRef('succession_pool', polity.id, 'factionBackedCandidateCount', factionBacked.length),
        ...[...factionLeaders].sort(stableCompare).slice(0, 3).map((id) => {
          const faction = index.factions.find((item) => item.id === id);
          return indexRef('faction', id, 'power', faction?.power ?? 0);
        }),
      ],
    ));
  }

  const externalClaims = claims.filter((claim) => {
    const character = index.charactersById.get(claim.characterId);
    return Boolean(character && (
      character.politicalClass === '外戚'
      || (polity.rulingFamilyId && character.familyId !== polity.rulingFamilyId && character.spouseIds.includes(ruler.id))
    ));
  });
  const strongestExternal = externalClaims[0];
  if (strongestExternal && strongestExternal.familySupport + strongestExternal.institutionalSupport >= 65) {
    const character = index.charactersById.get(strongestExternal.characterId);
    add(makeSignal(
      'consort_clan_pressure', 'capability', clamp(
        (strongestExternal.familySupport + strongestExternal.institutionalSupport - 55) * 0.16,
        3,
        14,
      ),
      [
        indexRef('character', strongestExternal.characterId, 'politicalClass', character?.politicalClass ?? null),
        indexRef('succession_claim', strongestExternal.characterId, 'familySupport', strongestExternal.familySupport),
        indexRef('succession_claim', strongestExternal.characterId, 'institutionalSupport', strongestExternal.institutionalSupport),
      ],
    ));
  }

  const militarizedClaims = claims.filter((claim) => (
    Math.max(claim.militarySupport, claim.navalSupport) >= 15
  ));
  if (militarizedClaims.length > 0) {
    const strongest = [...militarizedClaims].sort((left, right) => (
      Math.max(right.militarySupport, right.navalSupport)
        - Math.max(left.militarySupport, left.navalSupport)
      || stableCompare(left.characterId, right.characterId)
    ))[0] as InheritanceClaimAssessment;
    const armedSupport = Math.max(strongest.militarySupport, strongest.navalSupport);
    add(makeSignal(
      'claimant_military_support', 'capability', clamp(armedSupport * 0.18, 3, 15),
      [
        indexRef('succession_claim', strongest.characterId, 'militarySupport', strongest.militarySupport),
        indexRef('succession_claim', strongest.characterId, 'navalSupport', strongest.navalSupport),
        ...strongest.supportingArmyIds.slice(0, 3).map((id) => {
          const army = index.armies.find((item) => item.id === id);
          return indexRef('army', id, 'commanderId', army?.commanderId ?? null);
        }),
        ...strongest.supportingFleetIds.slice(0, 2).map((id) => {
          const fleet = index.fleets.find((item) => item.id === id);
          return indexRef('fleet', id, 'commanderId', fleet?.commanderId ?? null);
        }),
      ],
    ));
  }

  const currentFacts = relevantCurrentFacts(context.facts, context.turn, polity, ruler, claims);
  const predecessorDeath = currentFacts.find((fact): fact is CharacterDeathFact => (
    fact.kind === 'character_death' && fact.payload.role === '君主' && fact.payload.characterId !== ruler.id
  ));
  if (predecessorDeath) {
    add(makeSignal(
      'ruler_death_without_lawful_settlement', 'trigger', 24,
      [{ kind: 'fact', factId: predecessorDeath.id }], [predecessorDeath.id],
    ));
  }
  const nonDeathFacts = currentFacts.filter((fact) => fact !== predecessorDeath).slice(0, MAX_SOURCE_FACTS);
  if (nonDeathFacts.length > 0) {
    add(makeSignal(
      'current_succession_evidence', 'trigger', clamp(2 + nonDeathFacts.length * 1.2, 2, 9),
      factRefs(nonDeathFacts.map((fact) => fact.id)), nonDeathFacts.map((fact) => fact.id),
    ));
  }

  const pressure = Math.round(clamp(9 + signals.reduce((sum, signal) => sum + signal.contribution, 0)));
  const executableActorIds = uniqueSorted(
    claims.filter((claim) => claim.executable).map((claim) => claim.characterId),
    MAX_CORE_CHARACTERS,
  );
  const selectedClaims = [
    ...(leading ? [leading] : []),
    ...claims.filter((claim) => claim.characterId === expectedRegentId),
    ...claims.filter((claim) => (
      claim.characterId !== leading?.characterId && claim.characterId !== expectedRegentId
    )),
  ].slice(0, MAX_CORE_CHARACTERS - 1);
  const coreCharacterIds = uniqueSorted(
    [ruler.id, ...(leading ? [leading.characterId] : [])],
    MAX_CORE_CHARACTERS,
  );
  const participantFamilies = uniqueSorted([
    ...(polity.rulingFamilyId ? [polity.rulingFamilyId] : []),
    ...selectedClaims.map((claim) => index.charactersById.get(claim.characterId)?.familyId ?? ''),
  ], MAX_PARTICIPANT_FAMILIES);
  const participantFactionIds = uniqueSorted(
    selectedClaims.flatMap((claim) => claim.supportingFactionIds),
    MAX_PARTICIPANT_FACTIONS,
  );
  const participantArmyIds = uniqueSorted(
    selectedClaims.flatMap((claim) => claim.supportingArmyIds),
    MAX_PARTICIPANT_ARMIES,
  );
  const participantFleetIds = uniqueSorted(
    selectedClaims.flatMap((claim) => claim.supportingFleetIds),
    MAX_PARTICIPANT_ARMIES,
  );
  const supporters = [...new Set([
    ...(expectedRegentId ? [expectedRegentId] : []),
    ...familyAndFactionSupporters(index, selectedClaims),
  ].filter((id) => !coreCharacterIds.includes(id)))]
    .slice(0, MAX_SUPPORTERS)
    .sort(stableCompare);
  const opponents = uniqueSorted(
    claims
      .filter((claim) => (
        claim.characterId !== leading?.characterId
        && claim.characterId !== expectedRegentId
        && !supporters.includes(claim.characterId)
      ))
      .map((claim) => claim.characterId),
    MAX_OPPONENTS,
  );
  const participants: SituationParticipants = {
    coreCharacterIds,
    supportingCharacterIds: supporters,
    opposingCharacterIds: opponents,
    familyIds: participantFamilies,
    factionIds: participantFactionIds,
    polityIds: [polity.id],
    regionIds: polity.capitalRegionId ? [polity.capitalRegionId] : [],
    armyIds: participantArmyIds,
    fleetIds: participantFleetIds,
  };
  const nextWatch = (() => {
    if (mortalityExposure >= 35) {
      return {
        key: 'watch_ruler_health_and_succession',
        refs: [
          indexRef('character', ruler.id, 'health', ruler.health),
          indexRef('polity', polity.id, 'rulerId', polity.rulerId),
          indexRef('succession_pool', polity.id, 'leadingCandidateId', leading?.characterId ?? null),
        ],
      } satisfies InheritanceCrisisWatchSignal;
    }
    if (legalClaims.length === 0) {
      return {
        key: 'watch_heir_designation',
        refs: [
          indexRef('succession_pool', polity.id, 'legalCandidateCount', 0),
          indexRef('polity', polity.id, 'rulingFamilyId', polity.rulingFamilyId),
        ],
      } satisfies InheritanceCrisisWatchSignal;
    }
    return {
      key: 'watch_claimant_support_balance',
      refs: [
        indexRef('succession_pool', polity.id, 'leadingCandidateId', leading?.characterId ?? null),
        indexRef('succession_pool', polity.id, 'claimStrengthGap', rounded(claimGap)),
        indexRef('polity', polity.id, 'legitimacy', polity.legitimacy),
      ],
    } satisfies InheritanceCrisisWatchSignal;
  })();
  const sourceFactIds = uniqueSorted(signals.flatMap((signal) => signal.sourceFactIds), MAX_SOURCE_FACTS);
  return {
    type: INHERITANCE_CRISIS_TYPE,
    scopeKey: polity.id,
    candidateKey: `${INHERITANCE_CRISIS_TYPE}:${polity.id}`,
    pressure,
    hasExecutableActor: executableActorIds.length > 0,
    participants,
    executableActorIds,
    signals,
    sourceFactIds,
    nextWatch,
    possibleOutcomes: possibleOutcomes(pressure, polity, ruler, legalClaims.length, leading),
    importance: Math.round(clamp(35 + pressure * 0.65)),
    visibility: Math.round(clamp(32 + pressure * 0.54 + (sourceFactIds.length > 0 ? 8 : 0))),
    resolution: null,
  };
}

function resolutionCandidate(
  polity: PolityState,
  facts: readonly SimulationFact[],
  outcomeKey: InheritanceResolutionOutcomeKey,
  predecessor: CharacterState | undefined,
  successor: CharacterState | undefined,
): InheritanceCrisisCandidate {
  const resultFactIds = uniqueSorted(facts.map((fact) => fact.id), MAX_SOURCE_FACTS);
  const leadingFact = [...facts].sort((left, right) => (
    right.importance - left.importance || stableCompare(left.id, right.id)
  ))[0];
  if (!leadingFact) throw new Error('Inheritance resolution requires at least one current-turn Fact');
  const coreCharacterIds = uniqueSorted([
    predecessor?.id ?? '',
    successor?.id ?? '',
  ], MAX_CORE_CHARACTERS);
  const participants: SituationParticipants = {
    coreCharacterIds,
    supportingCharacterIds: [],
    opposingCharacterIds: [],
    familyIds: uniqueSorted([
      predecessor?.familyId ?? '',
      successor?.familyId ?? '',
    ], MAX_PARTICIPANT_FAMILIES),
    factionIds: [],
    polityIds: [polity.id],
    regionIds: uniqueSorted([
      ...facts.flatMap((fact) => fact.regionIds),
      polity.capitalRegionId ?? '',
    ], 2),
    armyIds: [],
    fleetIds: [],
  };
  const signal = makeSignal(
    outcomeKey,
    'outcome',
    -30,
    [
      ...factRefs(resultFactIds),
      indexRef(
        'polity',
        polity.id,
        outcomeKey === 'lineage_extinguished_and_absorbed' || outcomeKey === 'polity_destroyed'
          ? 'alive'
          : 'rulerId',
        outcomeKey === 'lineage_extinguished_and_absorbed' || outcomeKey === 'polity_destroyed'
          ? false
          : successor?.id ?? null,
      ),
      ...(successor && predecessor ? [indexRef(
        'succession_claim',
        successor.id,
        'lineageLegitimacy',
        lineageLegitimacy(successor, predecessor, predecessor.familyId),
      )] : []),
    ],
    resultFactIds,
  );
  const nextWatch: InheritanceCrisisWatchSignal = {
    key: outcomeKey === 'lineage_extinguished_and_absorbed' || outcomeKey === 'polity_destroyed'
      ? 'watch_successor_states'
      : 'watch_new_reign_consolidation',
    refs: signal.refs,
  };
  return {
    type: INHERITANCE_CRISIS_TYPE,
    scopeKey: polity.id,
    candidateKey: `${INHERITANCE_CRISIS_TYPE}:${polity.id}`,
    pressure: 0,
    hasExecutableActor: false,
    participants,
    executableActorIds: [],
    signals: [signal],
    sourceFactIds: resultFactIds,
    nextWatch,
    possibleOutcomes: [],
    resolution: { outcomeKey, resultFactIds },
    importance: Math.max(60, leadingFact.importance * 20),
    visibility: Math.max(65, leadingFact.importance * 20),
  };
}

function classifyRulerTransfer(
  predecessor: CharacterState,
  successor: CharacterState,
  predecessorDied: boolean,
): InheritanceResolutionOutcomeKey {
  if (predecessorDied) {
    if (successor.age < 16) return 'regency_established';
    return successor.familyId === predecessor.familyId
      ? 'orderly_succession'
      : 'dynasty_replaced';
  }
  return successor.familyId === predecessor.familyId
    ? 'palace_transfer'
    : 'usurpation';
}

function selectTransferFacts(
  currentFacts: readonly SimulationFact[],
  polityId: string,
  predecessorId: string,
  successorId: string,
  deathFact?: CharacterDeathFact,
): SimulationFact[] {
  const ended = currentFacts.find((fact) => (
    fact.kind === 'appointment_ended'
    && fact.payload.polityId === polityId
    && fact.payload.officeKind === '君主'
    && fact.payload.holderId === predecessorId
  ));
  const started = currentFacts.find((fact) => (
    fact.kind === 'appointment_started'
    && fact.payload.polityId === polityId
    && fact.payload.officeKind === '君主'
    && fact.payload.holderId === successorId
  ));
  return [...new Map(
    [deathFact, ended, started]
      .filter((fact): fact is SimulationFact => Boolean(fact))
      .map((fact) => [fact.id, fact]),
  ).values()];
}

function detectInheritanceCrisis(
  context: { turn: number; facts: readonly SimulationFact[]; index: Readonly<InheritanceCrisisIndex> },
): readonly InheritanceCrisisCandidate[] {
  const currentFacts = context.facts
    .filter((fact) => fact.turn === context.turn && fact.kind !== 'situation_milestone')
    .sort((left, right) => stableCompare(left.id, right.id));
  const resolvedPolities = new Set<string>();
  const results: InheritanceCrisisCandidate[] = [];

  for (const polity of [...context.index.politiesById.values()].sort((left, right) => stableCompare(left.id, right.id))) {
    if (polity.alive) continue;
    const territoryFact = currentFacts.find((fact) => (
      fact.kind === 'territory_control_changed'
      && fact.payload.previousControllerId === polity.id
    ));
    const rulerDeath = currentFacts.find((fact): fact is CharacterDeathFact => (
      fact.kind === 'character_death'
      && fact.payload.role === '君主'
      && fact.polityIds.includes(polity.id)
    ));
    if (!territoryFact) continue;
    const monarchEnd = currentFacts.find((fact): fact is AppointmentEndedFact => (
      fact.kind === 'appointment_ended'
      && fact.payload.polityId === polity.id
      && fact.payload.officeKind === '君主'
    ));
    const intermediateMonarchStart = currentFacts.find((fact): fact is AppointmentStartedFact => (
      fact.kind === 'appointment_started'
      && fact.payload.polityId === polity.id
      && fact.payload.officeKind === '君主'
    ));
    const predecessorId = rulerDeath?.payload.characterId ?? monarchEnd?.payload.holderId ?? polity.rulerId;
    const ended = monarchEnd?.payload.holderId === predecessorId ? monarchEnd : undefined;
    // A destroyed/absorbed polity needs both the decisive territory transfer
    // and the old ruler office ending. A death Fact, when present, joins the
    // same atomic settlement proof rather than standing alone.
    if (!ended) continue;
    const resolutionFacts = [territoryFact, rulerDeath, ended, intermediateMonarchStart]
      .filter((fact): fact is SimulationFact => Boolean(fact));
    const predecessor = context.index.charactersById.get(
      predecessorId,
    );
    const intermediateSuccessor = intermediateMonarchStart
      ? context.index.charactersById.get(intermediateMonarchStart.payload.holderId)
      : undefined;
    const outcomeKey: InheritanceResolutionOutcomeKey = territoryFact?.kind === 'territory_control_changed'
      && territoryFact.payload.reason === 'administrative_transfer'
      ? 'lineage_extinguished_and_absorbed'
      : 'polity_destroyed';
    results.push(resolutionCandidate(
      polity,
      resolutionFacts,
      outcomeKey,
      predecessor,
      intermediateSuccessor,
    ));
    resolvedPolities.add(polity.id);
  }

  for (const fact of currentFacts) {
    if (fact.kind !== 'character_death' || fact.payload.role !== '君主') continue;
    const polityId = fact.polityIds[0]
      ?? context.index.charactersById.get(fact.payload.characterId)?.polityId;
    const polity = polityId ? context.index.politiesById.get(polityId) : undefined;
    const predecessor = context.index.charactersById.get(fact.payload.characterId);
    const successor = polity ? context.index.charactersById.get(polity.rulerId) : undefined;
    if (
      !polity?.alive
      || resolvedPolities.has(polity.id)
      || !predecessor
      || !successor?.alive
      || successor.id === predecessor.id
    ) continue;
    const outcomeKey = classifyRulerTransfer(predecessor, successor, true);
    const resolutionFacts = selectTransferFacts(
      currentFacts,
      polity.id,
      predecessor.id,
      successor.id,
      fact,
    );
    // Death creates the crisis but does not by itself prove its settlement.
    // Require old-office end and new-office start in the same turn.
    if (resolutionFacts.length !== 3) continue;
    results.push(resolutionCandidate(polity, resolutionFacts, outcomeKey, predecessor, successor));
    resolvedPolities.add(polity.id);
  }

  // A ruler can be replaced without dying (abdication, deposition, a coup).
  // The paired authoritative office Facts are the atomic proof; Chronicle text
  // is deliberately insufficient.
  for (const polity of [...context.index.politiesById.values()].sort((left, right) => stableCompare(left.id, right.id))) {
    if (!polity.alive || resolvedPolities.has(polity.id)) continue;
    const ended = currentFacts.filter((fact): fact is AppointmentEndedFact => (
      fact.kind === 'appointment_ended'
      && fact.payload.polityId === polity.id
      && fact.payload.officeKind === '君主'
    ));
    const started = currentFacts.filter((fact): fact is AppointmentStartedFact => (
      fact.kind === 'appointment_started'
      && fact.payload.polityId === polity.id
      && fact.payload.officeKind === '君主'
      && fact.payload.holderId === polity.rulerId
    ));
    const endedFact = ended[0];
    const startedFact = started[0];
    if (!endedFact || !startedFact || endedFact.payload.holderId === startedFact.payload.holderId) continue;
    const predecessor = context.index.charactersById.get(endedFact.payload.holderId);
    const successor = context.index.charactersById.get(startedFact.payload.holderId);
    if (!predecessor || !successor?.alive) continue;
    const outcomeKey = classifyRulerTransfer(predecessor, successor, false);
    results.push(resolutionCandidate(
      polity,
      [endedFact, startedFact],
      outcomeKey,
      predecessor,
      successor,
    ));
    resolvedPolities.add(polity.id);
  }

  for (const polity of [...context.index.politiesById.values()].sort((left, right) => stableCompare(left.id, right.id))) {
    if (!polity.alive || resolvedPolities.has(polity.id)) continue;
    const ruler = context.index.charactersById.get(polity.rulerId);
    if (!ruler?.alive) continue;
    results.push(buildLiveCandidate(context, polity, ruler));
  }

  return results.sort((left, right) => (
    right.pressure - left.pressure || stableCompare(left.candidateKey, right.candidateKey)
  ));
}

export const inheritanceCrisisDetector: SituationDetector<InheritanceCrisisIndex> = {
  id: INHERITANCE_CRISIS_TYPE,
  detect: detectInheritanceCrisis,
};

export function detectInheritanceCrisisCandidates(
  world: WorldState,
  facts: readonly SimulationFact[] = [],
): readonly InheritanceCrisisCandidate[] {
  return detectInheritanceCrisis({
    turn: world.turn,
    facts,
    index: buildInheritanceCrisisIndex(world),
  });
}
