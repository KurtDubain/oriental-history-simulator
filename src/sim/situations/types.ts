import type { SimulationFact } from '../facts';

export type SituationStatus = 'open' | 'resolved';
export type SituationPhase = 'emerging' | 'active' | 'critical';
export type SituationSignalRole =
  | 'structural'
  | 'trigger'
  | 'inhibitor'
  | 'capability'
  | 'outcome';

export type SituationIndexValue = string | number | boolean | null;

export type SituationEvidenceRef =
  | {
      kind: 'fact';
      factId: string;
    }
  | {
      kind: 'index';
      entityType: string;
      entityId: string;
      field: string;
      value: SituationIndexValue;
    };

export interface SituationSignal {
  key: string;
  role: SituationSignalRole;
  contribution: number;
  refs: readonly SituationEvidenceRef[];
}

export interface SituationWatchSignal {
  key: string;
  refs: readonly SituationEvidenceRef[];
}

export interface SituationParticipants {
  coreCharacterIds: readonly string[];
  supportingCharacterIds: readonly string[];
  opposingCharacterIds: readonly string[];
  familyIds: readonly string[];
  factionIds: readonly string[];
  polityIds: readonly string[];
  regionIds: readonly string[];
  armyIds: readonly string[];
  fleetIds: readonly string[];
}

export interface SituationOutcomeOption {
  key: string;
  confidence: number;
}

export interface SituationResolutionObservation {
  outcomeKey: string;
  resultFactIds: readonly string[];
}

/**
 * A detector's sole persisted proposal. Detectors receive current-turn Facts and
 * an explicit structural index; Chronicle events/text are intentionally absent.
 */
export interface SituationCandidateObservation {
  type: string;
  scopeKey: string;
  pressure: number;
  participants?: Partial<SituationParticipants>;
  executableActorIds?: readonly string[];
  signals: readonly SituationSignal[];
  nextWatch: SituationWatchSignal;
  possibleOutcomes?: readonly SituationOutcomeOption[];
  resolution?: SituationResolutionObservation | null;
  importance?: number;
  visibility?: number;
}

export interface SituationDetectorContext<Index> {
  turn: number;
  facts: readonly SimulationFact[];
  index: Readonly<Index>;
}

export interface SituationDetector<Index> {
  id: string;
  detect(context: SituationDetectorContext<Index>): readonly SituationCandidateObservation[];
}

export interface SituationTemplate {
  type: string;
  titleKey: string;
  formationThreshold: number;
  activeEnterThreshold: number;
  activeExitThreshold: number;
  criticalEnterThreshold: number;
  criticalExitThreshold: number;
  resolutionThreshold: number;
  formationConfirmTurns: number;
  phaseConfirmTurns: number;
  coolingConfirmTurns: number;
  resolveAfterBelowTurns: number;
  reformationCooldownTurns: number;
  maxTensionRisePerTurn: number;
  maxTensionFallPerTurn: number;
}

export interface SituationLimits {
  maxOpenSituations: number;
  maxResolvedSituations: number;
  maxCandidates: number;
  maxCandidateDormantTurns: number;
  maxSignals: number;
  maxSignalRefs: number;
  maxMilestoneFactIds: number;
  maxRecentChanges: number;
  maxPossibleOutcomes: number;
  maxExecutableActors: number;
  maxResolutionFactIds: number;
  maxCoreCharacterIds: number;
  maxSupportingCharacterIds: number;
  maxOpposingCharacterIds: number;
  maxFamilyIds: number;
  maxFactionIds: number;
  maxPolityIds: number;
  maxRegionIds: number;
  maxArmyIds: number;
  maxFleetIds: number;
}

export interface SituationCandidateState {
  key: string;
  type: string;
  scopeKey: string;
  firstSeenTurn: number;
  lastSeenTurn: number;
  consecutiveQualifyingTurns: number;
  consecutiveBelowTurns: number;
  latestPressure: number;
  peakPressure: number;
  evidenceFactIds: readonly string[];
  linkedSituationId: string | null;
  rearmAfterTurn: number;
  observation: SituationCandidateObservation;
}

export type SituationChangeKind =
  | 'formed'
  | 'phase_changed'
  | 'participants_changed'
  | 'resolved';

export interface SituationRecentChange {
  turn: number;
  kind: SituationChangeKind;
  tension: number;
  fromPhase: SituationPhase | null;
  toPhase: SituationPhase | null;
  sourceFactIds: readonly string[];
}

export interface SituationStartSnapshot {
  turn: number;
  pressure: number;
  participantDigest: string;
  evidenceDigest: string;
}

export interface SituationResolution {
  outcomeKey: string;
  resolvedTurn: number;
  resultFactIds: readonly string[];
  belowThresholdTurns: number;
  finalSnapshotDigest: string;
}

export interface SituationState {
  id: string;
  type: string;
  scopeKey: string;
  titleKey: string;
  status: SituationStatus;
  phase: SituationPhase;
  startedTurn: number;
  phaseSinceTurn: number;
  lastUpdatedTurn: number;
  resolvedTurn: number | null;
  tension: number;
  momentum: number;
  consecutivePhaseRiseTurns: number;
  consecutivePhaseFallTurns: number;
  consecutiveBelowResolutionTurns: number;
  participants: SituationParticipants;
  executableActorIds: readonly string[];
  signals: readonly SituationSignal[];
  causalFactIds: readonly string[];
  milestoneFactIds: readonly string[];
  recentChanges: readonly SituationRecentChange[];
  possibleOutcomes: readonly SituationOutcomeOption[];
  nextWatch: SituationWatchSignal;
  startSnapshot: SituationStartSnapshot;
  resolution: SituationResolution | null;
  importance: number;
  visibility: number;
}

export interface SituationArchiveState {
  resolvedCount: number;
  resolvedDigest: string;
}

export interface SituationSystemState {
  version: 1;
  lastReducedTurn: number;
  nextSituationNumber: number;
  candidates: readonly SituationCandidateState[];
  situations: readonly SituationState[];
  archive: SituationArchiveState;
}

export type SituationTransitionKind = 'formed' | 'phase_changed' | 'resolved';

export interface SituationTransition {
  turn: number;
  kind: SituationTransitionKind;
  situationId: string;
  sourceFactIds: readonly string[];
  fromPhase: SituationPhase | null;
  toPhase: SituationPhase | null;
  outcomeKey: string | null;
}

export interface SituationTurnInput<Index> {
  turn: number;
  facts: readonly SimulationFact[];
  index: Readonly<Index>;
  detectors: readonly SituationDetector<Index>[];
}

export interface SituationReducerOptions {
  templates: readonly SituationTemplate[];
  limits?: Partial<SituationLimits>;
}

export interface SituationTurnResult {
  state: SituationSystemState;
  transitions: readonly SituationTransition[];
}

export interface SituationMilestoneAttachment {
  situationId: string;
  turn: number;
  transitionKind: SituationTransitionKind;
  milestoneFactIds: readonly string[];
}
