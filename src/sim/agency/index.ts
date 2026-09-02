export {
  AGENCY_DECISION_CLOSED_RETENTION_TURNS,
  ARMY_COMMAND_CHANGE_COOLDOWN_TURNS,
  COMMAND_CHANGE_PARTICIPANT_COOLDOWN_TURNS,
  createAgencyDecisionSystemState,
  INDEPENDENT_COMMAND_PLAN_ACTIONS,
  MAX_AGENCY_DECISION_ACTORS,
  MAX_AGENCY_GOAL_SOURCE_FACTS,
  MAX_AGENCY_INTENT_ATTEMPTS,
  MAX_AGENCY_INTENTS_PER_TURN,
  MAX_AGENCY_SUPPORT_ACTIONS,
  MAX_AGENCY_SUPPORT_ACTIONS_PER_TURN,
  MIN_INDEPENDENT_COMMAND_DEPUTY_TENURE_TURNS,
  processAgencyDecisionSystem,
  projectCharacterEmbodiedActions,
  validateAgencyDecisionSystemState,
} from './decision';

export {
  ROOT_DESIRES,
  ROOT_DESIRE_LABELS,
  projectCharacterDesires,
} from './projection';

export {
  createAgencySystemState,
  MAX_PERSONAL_MEMORIES,
  MAX_PERSONAL_MEMORY_SOURCE_FACTS,
  MAX_PERSONAL_MEMORY_SUBJECTS,
  MAX_PINNED_PERSONAL_MEMORIES,
  PERSONAL_MEMORY_KINDS,
  PERSONAL_MEMORY_SCOPES,
  reducePersonalMemorySystem,
  toPersonalMemoryPlayerViews,
  validateAgencySystemState,
} from './memory';

export {
  EMBODIED_ACTION_KINDS,
  EMBODIED_COURT_ACTION_KINDS,
  EMBODIED_IDENTITY_ACTION_KINDS,
  EMBODIED_LOCAL_GOVERNANCE_ACTION_KINDS,
  EMBODIED_MILITARY_ACTION_KINDS,
  createEmbodiedActionCommand,
  projectEmbodiedActions,
  resolveEmbodiedAction,
} from './embodiment';

export {
  embodiedCommandsMatch,
  isEmbodiedIdentityAction,
  mergeEmbodiedQueueCandidate,
  resolveEmbodiedIdentityEnvelope,
  submitEmbodiedIdentityAction,
} from './embodied-identity';

export {
  LOCAL_GOVERNANCE_ACTION_COOLDOWN_TURNS,
  LOCAL_GOVERNANCE_POLITY_COOLDOWN_TURNS,
  MAX_LOCAL_GOVERNANCE_ACTIONS_PER_TURN,
  isEmbodiedLocalGovernanceAction,
  localGovernanceCandidateFor,
  projectEmbodiedLocalGovernanceActions,
} from './embodied-governance';

export {
  courtAllianceIdentityFromCommand,
  isEmbodiedCourtAction,
  projectEmbodiedCourtAction,
} from './embodied-court';

export type { EmbodiedCourtAllianceRequest } from './embodied-court';

export type {
  EmbodiedActionCommand,
  EmbodiedActionKind,
  EmbodiedActionProjection,
  EmbodiedActionStance,
  EmbodiedActionTurnContext,
  EmitEmbodiedActionEvent,
} from './embodiment';

export type {
  EmbodiedIdentityActionKind,
  EmbodiedIdentityResolutionInput,
  EmbodiedIdentityResolvedFactInput,
  EmbodiedIdentitySubmittedFactInput,
} from './embodied-identity';

export type {
  AgencyDecisionEventInput,
  AgencyDecisionGoalState,
  AgencyDecisionGoalStatus,
  AgencyDecisionPlanState,
  AgencyDecisionPlanStepState,
  AgencyDecisionPlanStepStatus,
  AgencyDecisionSystemState,
  AgencySupportActionState,
  AgencyDecisionTurnContext,
  AgencyTurnIntent,
  CharacterAgencyDecisionState,
  EmitAgencyDecisionEvent,
  IndependentCommandPlanAction,
} from './decision';

export type {
  CharacterDesireProjection,
  DesireAxisProjection,
  DesirePressureProjection,
  DesireSource,
  DesireSourceKind,
  RootDesire,
} from './projection';

export type {
  AgencySystemState,
  CharacterPersonalMemoryState,
  PersonalMemoryKind,
  PersonalMemoryPlayerView,
  PersonalMemoryState,
  PersonalMemoryScope,
  PersonalMemorySubjectKind,
  PersonalMemorySubjectRef,
} from './memory';
