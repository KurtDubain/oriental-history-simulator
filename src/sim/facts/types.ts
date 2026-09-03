import type {
  ArmyOrderDirective,
  EventCategory,
  EventCause,
  OfficeKind,
  Season,
  StateDelta,
} from '../types';

export type SimulationFactKind =
  | 'war_started'
  | 'war_ended'
  | 'battle'
  | 'territory_control_changed'
  | 'appointment_started'
  | 'appointment_ended'
  | 'character_death'
  | 'marriage'
  | 'agency_support_resolved'
  | 'agency_intent_submitted'
  | 'agency_intent_resolved'
  | 'local_governance_resolved'
  | 'embodied_action_submitted'
  | 'embodied_action_resolved'
  | 'faction_lifecycle'
  | 'faction_relation_changed'
  | 'court_action_resolved'
  | 'army_order_changed'
  | 'situation_milestone';

export interface BattleForceFact {
  armyId: string;
  polityId: string;
  commanderId: string;
  deputyCommanderId: string | null;
  /** Snapshot of who the soldiers actually obeyed; absent only in legacy Facts. */
  allegianceCharacterId?: string;
  allegianceStrength?: number;
  soldiersBefore: number;
  soldiersAfter: number;
  moraleBefore: number;
  moraleAfter: number;
  trainingBefore: number;
  supplyBefore: number;
  losses: number;
  /** Immutable per-person ownership snapshot at the moment of battle. */
  participants?: BattlePersonalForceFact[];
}

export interface BattlePersonalForceFact {
  characterId: string;
  soldiersBefore: number;
  soldiersAfter: number;
  losses: number;
  factionId: string | null;
  formationCommanderId: string;
  role: 'commander' | 'deputy' | 'member';
}

export interface WarStartedFactPayload {
  warId: string;
  warKind: 'interstate' | 'rebellion';
  attackerId: string;
  defenderId: string;
  goal: '征服' | '边境' | '独立' | '复仇' | '霸权';
  targetRegionIds: string[];
  reason: string;
}

export type WarEndResult =
  | 'attacker_advantage'
  | 'defender_advantage'
  | 'negotiated_peace'
  | 'attacker_destroyed'
  | 'defender_destroyed'
  | 'attacker_dissolved'
  | 'defender_dissolved';

export interface WarEndedFactPayload {
  warId: string;
  attackerId: string;
  defenderId: string;
  result: WarEndResult;
  winnerId: string | null;
  loserId: string | null;
  reason: string;
  durationTurns: number;
  attackerScore: number;
  defenderScore: number;
  indemnity: number;
}

export interface BattleFactPayload {
  warId: string;
  targetRegionId: string;
  routeId: string;
  attackerWon: boolean;
  attackerPower: number;
  defenderPower: number;
  militiaLosses: number;
  attacker: BattleForceFact;
  defenders: BattleForceFact[];
}

export interface ArmyOrderChangedFactPayload {
  armyId: string;
  polityId: string;
  previous: ArmyOrderDirective;
  next: ArmyOrderDirective;
}

export interface TerritoryControlFactPayload {
  regionId: string;
  previousControllerId: string;
  nextControllerId: string;
  reason: 'battle_capture' | 'rebellion' | 'administrative_transfer' | 'amphibious_landing';
  warId: string | null;
}

export interface AppointmentFactPayload {
  appointmentId: string;
  action: 'started' | 'ended';
  officeKind: OfficeKind;
  holderId: string;
  polityId: string;
  regionId: string | null;
  armyId: string | null;
  fleetId: string | null;
  rank: number;
}

export interface CharacterDeathFactPayload {
  characterId: string;
  age: number;
  role: string;
  health: number;
  diseaseId: string | null;
}

export interface MarriageFactPayload {
  leftCharacterId: string;
  rightCharacterId: string;
  leftFamilyId: string;
  rightFamilyId: string;
  diplomatic: boolean;
}

export type AgencySupportActionKind = 'cultivate_military_support' | 'request_backing';
export type AgencySupportTargetKind = 'army_officers' | 'commander' | 'ruler' | 'family_head';
export type AgencySupportOutcome = 'secured' | 'deferred' | 'refused';

export interface AgencySupportResolvedFactPayload {
  actorId: string;
  goalId: string;
  planId: string;
  planStepId: string;
  action: AgencySupportActionKind;
  attemptOrdinal: number;
  targetKind: AgencySupportTargetKind;
  targetId: string;
  targetArmyId: string;
  targetArmyName?: string;
  polityId: string;
  outcome: AgencySupportOutcome;
  strength: number;
  retryAfterTurn: number | null;
}

export interface AgencyIntentSubmittedFactPayload {
  actorId: string;
  goalId: string;
  goalType: 'secure_independent_command';
  goalCreatedTurn: number;
  planId: string;
  planStepId: string;
  action: 'request_independent_command';
  attemptOrdinal: number;
  targetArmyId: string;
  targetArmyName?: string;
  polityId: string;
  currentCommanderId: string;
  appointingAuthorityId: string;
}

export type AgencyIntentResolutionOutcome = 'executed' | 'rejected' | 'deferred' | 'invalidated';
export type AgencyIntentResolutionReason =
  | 'permission_lost'
  | 'insufficient_record'
  | 'insufficient_support'
  | 'competing_request'
  | 'court_risk'
  | 'claim_weaker'
  | 'command_granted';

export interface AgencyIntentResolutionSupportComponent {
  source: 'commander_patronage' | 'ruler_patronage' | 'family_backing';
  value: number;
  passed: boolean;
}

export interface AgencyIntentResolutionCheck {
  kind: 'permission' | 'resource' | 'relationship' | 'risk';
  passed: boolean;
  value: number;
  threshold: number;
  comparison: 'at_least' | 'at_most';
  components?: AgencyIntentResolutionSupportComponent[];
}

export interface AgencyIntentResolvedFactPayload {
  submissionFactId: string;
  actorId: string;
  goalId: string;
  planId: string;
  planStepId: string;
  action: 'request_independent_command';
  attemptOrdinal: number;
  targetArmyId: string;
  targetArmyName?: string;
  polityId: string;
  previousCommanderId: string;
  appointingAuthorityId: string;
  outcome: AgencyIntentResolutionOutcome;
  reasonCode: AgencyIntentResolutionReason;
  institutionResponse: 'command_granted' | 'appeased' | 'curbed' | 'none';
  retryAfterTurn: number | null;
  checks: AgencyIntentResolutionCheck[];
  decisionScore: number;
  decisionThreshold: number;
}

export type LocalGovernanceActionKind = 'open_granary' | 'reduce_levy';
export type LocalGovernanceOutcome = 'enacted' | 'deferred' | 'refused' | 'invalidated';
export type LocalGovernanceReason =
  | 'measure_enacted'
  | 'permission_lost'
  | 'pressure_eased'
  | 'insufficient_grain'
  | 'insufficient_treasury'
  | 'institution_deferred'
  | 'institution_refused';

export interface LocalGovernanceResolvedFactPayload {
  actorId: string;
  polityId: string;
  regionId: string;
  authorityId: string;
  action: LocalGovernanceActionKind;
  outcome: LocalGovernanceOutcome;
  reasonCode: LocalGovernanceReason;
  score: number;
  threshold: number;
  pressure: number;
  foodSeasonsBefore: number;
  unrestBefore: number;
  unrestAfter: number;
  foodSpent: number;
  treasurySpent: number;
}

export interface SituationMilestoneFactPayload {
  situationId: string;
  situationType: string;
  transition: 'formed' | 'phase_changed' | 'resolved';
  fromPhase: 'emerging' | 'active' | 'critical' | null;
  toPhase: 'emerging' | 'active' | 'critical' | null;
  tension: number;
  momentum: number;
  outcomeKey: string | null;
}

export interface FactionLifecycleSnapshot {
  factionId: string;
  name: string;
  leaderId: string;
  coreMemberIds: string[];
  memberCount: number;
  agenda: string;
  active: boolean;
}

export interface FactionLifecycleFactPayload {
  transition: 'formed' | 'leader_changed' | 'split' | 'merged' | 'ended';
  reasonCode: string;
  polityId: string;
  affectedFactionIds: string[];
  createdFactionIds: string[];
  endedFactionIds: string[];
  previousLeaderId: string | null;
  nextLeaderId: string | null;
  before: FactionLifecycleSnapshot[];
  after: FactionLifecycleSnapshot[];
}

export interface FactionRelationChangedFactPayload {
  polityId: string;
  leftFactionId: string;
  rightFactionId: string;
  relation: 'alliance' | 'rivalry';
  action: 'formed' | 'ended';
  reasonCode: string;
  leftLeaderId: string;
  rightLeaderId: string;
}

export type CourtActionKind =
  | 'power_broker_formed'
  | 'power_broker_fell'
  | 'purge'
  | 'coup'
  | 'usurpation';

export interface CourtActionResolvedFactPayload {
  action: CourtActionKind;
  polityId: string;
  actorFactionId: string | null;
  targetFactionId: string | null;
  initiatorId: string;
  targetId: string;
  reasonCode: string;
  score: number;
  threshold: number;
  rulerBeforeId: string;
  rulerAfterId: string;
  affectedFactionIds: string[];
  removedMemberIds: string[];
}

export type EmbodiedActionFactKind =
  | 'strengthen_relationship'
  | 'seek_opportunity'
  | 'declare_stance'
  | 'cultivate_military_support'
  | 'request_backing'
  | 'request_independent_command'
  | 'open_granary'
  | 'reduce_levy'
  | 'form_court_alliance';
export type EmbodiedActionTargetKind = 'character' | 'faction' | 'army' | 'region';
export type EmbodiedActionOutcome = 'succeeded' | 'deferred' | 'refused' | 'invalidated';

export interface EmbodiedActionSubmittedFactPayload {
  actionId: string;
  issuedTurn: number;
  source: 'player_embodied';
  actorId: string;
  action: EmbodiedActionFactKind;
  targetKind: EmbodiedActionTargetKind;
  targetId: string;
  stance: 'support' | 'oppose' | null;
}

export interface EmbodiedActionResolvedFactPayload extends EmbodiedActionSubmittedFactPayload {
  submissionFactId: string;
  /** Missing on v1.3.0 schema-4 archives; absence means a legacy generic action. */
  domainFactId?: string | null;
  targetLabel: string;
  outcome: EmbodiedActionOutcome;
  reasonCode: 'conditions_changed' | 'accepted' | 'insufficient_support' | 'target_refused';
  score: number;
  threshold: number;
  cost: string;
  resultSummary: string;
  nextSignal: string;
}

interface SimulationFactBase<K extends SimulationFactKind, P> {
  id: string;
  turn: number;
  year: number;
  season: Season;
  kind: K;
  category: EventCategory;
  importance: 1 | 2 | 3 | 4 | 5;
  actorIds: string[];
  polityIds: string[];
  regionIds: string[];
  causes: EventCause[];
  stateDeltas: StateDelta[];
  sourceFactIds: string[];
  payload: P;
}

export type BattleFact = SimulationFactBase<'battle', BattleFactPayload>;
export type WarStartedFact = SimulationFactBase<'war_started', WarStartedFactPayload>;
export type WarEndedFact = SimulationFactBase<'war_ended', WarEndedFactPayload>;
export type TerritoryControlFact = SimulationFactBase<'territory_control_changed', TerritoryControlFactPayload>;
export type AppointmentStartedFact = SimulationFactBase<'appointment_started', AppointmentFactPayload>;
export type AppointmentEndedFact = SimulationFactBase<'appointment_ended', AppointmentFactPayload>;
export type CharacterDeathFact = SimulationFactBase<'character_death', CharacterDeathFactPayload>;
export type MarriageFact = SimulationFactBase<'marriage', MarriageFactPayload>;
export type AgencySupportResolvedFact = SimulationFactBase<'agency_support_resolved', AgencySupportResolvedFactPayload>;
export type AgencyIntentSubmittedFact = SimulationFactBase<'agency_intent_submitted', AgencyIntentSubmittedFactPayload>;
export type AgencyIntentResolvedFact = SimulationFactBase<'agency_intent_resolved', AgencyIntentResolvedFactPayload>;
export type LocalGovernanceResolvedFact = SimulationFactBase<'local_governance_resolved', LocalGovernanceResolvedFactPayload>;
export type SituationMilestoneFact = SimulationFactBase<'situation_milestone', SituationMilestoneFactPayload>;
export type EmbodiedActionSubmittedFact = SimulationFactBase<'embodied_action_submitted', EmbodiedActionSubmittedFactPayload>;
export type EmbodiedActionResolvedFact = SimulationFactBase<'embodied_action_resolved', EmbodiedActionResolvedFactPayload>;
export type FactionLifecycleFact = SimulationFactBase<'faction_lifecycle', FactionLifecycleFactPayload>;
export type FactionRelationChangedFact = SimulationFactBase<'faction_relation_changed', FactionRelationChangedFactPayload>;
export type CourtActionResolvedFact = SimulationFactBase<'court_action_resolved', CourtActionResolvedFactPayload>;
export type ArmyOrderChangedFact = SimulationFactBase<'army_order_changed', ArmyOrderChangedFactPayload>;

export type SimulationFact =
  | WarStartedFact
  | WarEndedFact
  | BattleFact
  | TerritoryControlFact
  | AppointmentStartedFact
  | AppointmentEndedFact
  | CharacterDeathFact
  | MarriageFact
  | AgencySupportResolvedFact
  | AgencyIntentSubmittedFact
  | AgencyIntentResolvedFact
  | LocalGovernanceResolvedFact
  | EmbodiedActionSubmittedFact
  | EmbodiedActionResolvedFact
  | FactionLifecycleFact
  | FactionRelationChangedFact
  | CourtActionResolvedFact
  | ArmyOrderChangedFact
  | SituationMilestoneFact;

export type SimulationFactInput = SimulationFact extends infer Fact
  ? Fact extends SimulationFact
    ? Omit<Fact, 'id' | 'turn' | 'year' | 'season'>
    : never
  : never;

export interface LegacyArchiveBoundary {
  sourceSchemaVersion: 1 | 2 | 3;
  turn: number;
  historyEventCount: number;
  historyDigest: string;
}
