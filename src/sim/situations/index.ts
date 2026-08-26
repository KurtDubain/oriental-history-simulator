export {
  advanceCandidateRegistry,
  candidateQualifies,
  collectSituationCandidateObservations,
  normalizeSituationParticipants,
  observationsByCandidateKey,
  resolveSituationLimits,
  situationCandidateKey,
} from './candidate-registry';
export { DEFAULT_SITUATION_LIMITS, EMPTY_SITUATION_PARTICIPANTS } from './constants';
export {
  attachSituationMilestoneFacts,
  createSituationSystemState,
  reduceSituationTurn,
  validateSituationSystemState,
} from './reducer';
export { processSituationSystem } from './runtime';
export {
  buildMilitaryPowerCrisisIndex,
  detectMilitaryPowerCrisisCandidates,
  MILITARY_POWER_CRISIS_TEMPLATE,
  MILITARY_POWER_CRISIS_TYPE,
  militaryPowerCrisisDetector,
} from './military-power-crisis-detector';
export {
  buildInheritanceCrisisIndex,
  detectInheritanceCrisisCandidates,
  INHERITANCE_CRISIS_TEMPLATE,
  INHERITANCE_CRISIS_TYPE,
  inheritanceCrisisDetector,
} from './inheritance-crisis-detector';
export type {
  SituationArchiveState,
  SituationCandidateObservation,
  SituationCandidateState,
  SituationChangeKind,
  SituationDetector,
  SituationDetectorContext,
  SituationEvidenceRef,
  SituationIndexValue,
  SituationLimits,
  SituationMilestoneAttachment,
  SituationOutcomeOption,
  SituationParticipants,
  SituationPhase,
  SituationRecentChange,
  SituationReducerOptions,
  SituationResolution,
  SituationResolutionObservation,
  SituationSignal,
  SituationSignalRole,
  SituationStartSnapshot,
  SituationState,
  SituationStatus,
  SituationSystemState,
  SituationTemplate,
  SituationTransition,
  SituationTransitionKind,
  SituationTurnInput,
  SituationTurnResult,
  SituationWatchSignal,
} from './types';
