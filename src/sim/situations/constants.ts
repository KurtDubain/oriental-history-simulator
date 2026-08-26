import type { SituationLimits, SituationParticipants } from './types';

export const DEFAULT_SITUATION_LIMITS: SituationLimits = Object.freeze({
  maxOpenSituations: 12,
  maxResolvedSituations: 64,
  maxCandidates: 64,
  maxCandidateDormantTurns: 8,
  maxSignals: 12,
  maxSignalRefs: 4,
  maxMilestoneFactIds: 16,
  maxRecentChanges: 8,
  maxPossibleOutcomes: 5,
  maxExecutableActors: 6,
  maxResolutionFactIds: 8,
  maxCoreCharacterIds: 12,
  maxSupportingCharacterIds: 12,
  maxOpposingCharacterIds: 12,
  maxFamilyIds: 8,
  maxFactionIds: 8,
  maxPolityIds: 8,
  maxRegionIds: 12,
  maxArmyIds: 12,
  maxFleetIds: 8,
});

export const EMPTY_SITUATION_PARTICIPANTS: SituationParticipants = Object.freeze({
  coreCharacterIds: Object.freeze([]),
  supportingCharacterIds: Object.freeze([]),
  opposingCharacterIds: Object.freeze([]),
  familyIds: Object.freeze([]),
  factionIds: Object.freeze([]),
  polityIds: Object.freeze([]),
  regionIds: Object.freeze([]),
  armyIds: Object.freeze([]),
  fleetIds: Object.freeze([]),
});
