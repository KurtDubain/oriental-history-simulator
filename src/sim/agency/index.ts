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
  MAX_PLAN_STEPS,
  MAX_RECENTLY_CLOSED_GOALS,
  MAX_SECONDARY_GOALS,
  PRIMARY_GOAL_MINIMUM_TURNS,
  PRIMARY_REPLACEMENT_CONFIRMATIONS,
  PRIMARY_REPLACEMENT_MARGIN,
  ROOT_DESIRES,
  ROOT_DESIRE_LABELS,
  SECONDARY_GOAL_MINIMUM_TURNS,
  evaluateGoalTerminalState,
  projectCharacterAgency,
  projectCharacterDesires,
  toCharacterAgencyPlayerProjection,
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
  EMBODIED_IDENTITY_ACTION_KINDS,
  EMBODIED_LOCAL_GOVERNANCE_ACTION_KINDS,
  EMBODIED_MILITARY_ACTION_KINDS,
  createEmbodiedActionCommand,
  projectEmbodiedActions,
  resolveEmbodiedAction,
} from './embodiment';

export {
  LOCAL_GOVERNANCE_ACTION_COOLDOWN_TURNS,
  LOCAL_GOVERNANCE_POLITY_COOLDOWN_TURNS,
  MAX_LOCAL_GOVERNANCE_ACTIONS_PER_TURN,
  isEmbodiedLocalGovernanceAction,
  localGovernanceCandidateFor,
  projectEmbodiedLocalGovernanceActions,
} from './embodied-governance';

export type {
  EmbodiedActionCommand,
  EmbodiedActionKind,
  EmbodiedActionProjection,
  EmbodiedActionStance,
  EmbodiedActionTurnContext,
  EmitEmbodiedActionEvent,
} from './embodiment';

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
  AgencyEntityKind,
  AgencyEntityRef,
  AgencyGoalClosureReason,
  AgencyGoalContext,
  AgencyGoalProjection,
  AgencyGoalStatus,
  AgencyGoalType,
  AgencyPlanAction,
  AgencyPlanProjection,
  AgencyPlanStepProjection,
  AgencyPlanStepStatus,
  AgencyPrimaryChallenge,
  CharacterAgencyShadowProjection,
  CharacterAgencyPlayerDesire,
  CharacterAgencyPlayerDecision,
  CharacterAgencyPlayerGoal,
  CharacterAgencyPlayerPlanStep,
  CharacterAgencyPlayerProjection,
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
