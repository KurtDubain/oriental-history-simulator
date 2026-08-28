import {
  emitSimulationFact,
  type AgencySupportActionKind,
  type AgencySupportOutcome,
  type AgencySupportTargetKind,
  type FactTurnBuffer,
} from '../facts';
import { stableCompare, stableHash } from '../random';
import { projectCharacterDesires, ROOT_DESIRES, type RootDesire } from './projection';
import {
  createEmbodiedActionCommand,
  EMBODIED_IDENTITY_ACTION_KINDS,
  projectEmbodiedActions,
  resolveEmbodiedAction,
  type EmbodiedActionCommand,
  type EmbodiedActionProjection,
  type EmbodiedActionTurnContext,
} from './embodiment';
import type {
  CharacterState,
  EventCause,
  HistoryEvent,
  RelationshipState,
  SimulationFact,
  StateDelta,
  WorldState,
} from '../types';

export const MAX_AGENCY_DECISION_ACTORS = 64;
export const MAX_AGENCY_INTENTS_PER_TURN = 16;
export const MAX_AGENCY_INTENT_ATTEMPTS = 3;
export const MAX_AGENCY_GOAL_SOURCE_FACTS = 8;
export const AGENCY_DECISION_CLOSED_RETENTION_TURNS = 16;
export const MIN_INDEPENDENT_COMMAND_DEPUTY_TENURE_TURNS = 6;
export const ARMY_COMMAND_CHANGE_COOLDOWN_TURNS = 32;
export const COMMAND_CHANGE_PARTICIPANT_COOLDOWN_TURNS = 40;
export const MAX_AGENCY_SUPPORT_ACTIONS = 8;
export const MAX_AGENCY_SUPPORT_ACTIONS_PER_TURN = 16;

export const INDEPENDENT_COMMAND_PLAN_ACTIONS = [
  'earn_merit',
  'seek_patronage',
  'build_military_support',
  'seek_family_backing',
  'request_independent_command',
] as const;

export type IndependentCommandPlanAction = (typeof INDEPENDENT_COMMAND_PLAN_ACTIONS)[number];
export type AgencyDecisionGoalStatus = 'active' | 'achieved' | 'invalidated';
export type AgencyDecisionPlanStepStatus = 'completed' | 'available' | 'blocked' | 'invalidated';

export interface AgencyDecisionPlanStepState {
  id: string;
  action: IndependentCommandPlanAction;
  order: number;
  status: AgencyDecisionPlanStepStatus;
  evidence: string;
}

export interface AgencyDecisionGoalState {
  id: string;
  type: 'secure_independent_command';
  targetArmyId: string;
  targetPolityId: string;
  createdTurn: number;
  lastReviewedTurn: number;
  status: AgencyDecisionGoalStatus;
  resolvedTurn: number | null;
  closureReason: 'command_obtained' | 'actor_dead' | 'position_lost' | 'target_missing' | 'request_exhausted' | null;
  sourceFactIds: readonly string[];
}

export interface AgencyDecisionPlanState {
  id: string;
  templateVersion: 1;
  goalId: string;
  status: 'active' | 'achieved' | 'invalidated';
  currentStepIndex: number | null;
  steps: readonly AgencyDecisionPlanStepState[];
}

export interface CharacterAgencyDecisionState {
  characterId: string;
  coreDesireKinds: readonly [RootDesire, RootDesire];
  goal: AgencyDecisionGoalState;
  plan: AgencyDecisionPlanState;
  supportActions: readonly AgencySupportActionState[];
  supportAttemptOrdinal: number;
  nextEligibleSupportTurn: number;
  attemptOrdinal: number;
  nextEligibleIntentTurn: number;
  lastResolutionFactId: string | null;
  lastReviewedTurn: number;
}

export interface AgencySupportActionState {
  id: string;
  action: AgencySupportActionKind;
  attemptOrdinal: number;
  targetKind: AgencySupportTargetKind;
  targetId: string;
  performedTurn: number;
  outcome: AgencySupportOutcome;
  strength: number;
  sourceFactId: string;
  sourceEventId: string;
}

export interface AgencyDecisionSystemState {
  version: 1;
  reviewedThroughTurn: number;
  actors: readonly CharacterAgencyDecisionState[];
}

export interface AgencyTurnIntent {
  actorId: string;
  goalId: string;
  goalCreatedTurn: number;
  planId: string;
  planStepId: string;
  action: 'request_independent_command';
  attemptOrdinal: number;
  targetArmyId: string;
  polityId: string;
  currentCommanderId: string;
  appointingAuthorityId: string;
  sourceFactIds: readonly string[];
  submittedFactId: string | null;
  resolvedFactId: string | null;
  embodiedCommand?: EmbodiedActionCommand;
  embodiedSubmissionFactId?: string;
}

export interface AgencyDecisionTurnContext extends FactTurnBuffer, EmbodiedActionTurnContext {
  agencyIntents: AgencyTurnIntent[];
  appointmentSourceFactIdsByArmyId: Record<string, string>;
}

export interface AgencyDecisionEventInput {
  category: HistoryEvent['category'];
  kind: string;
  title: string;
  summary: string;
  importance: HistoryEvent['importance'];
  actorIds?: string[];
  polityIds?: string[];
  regionIds?: string[];
  causes: EventCause[];
  evidence?: string[];
  stateDeltas?: StateDelta[];
  sourceFactIds?: string[];
  situationIds?: string[];
}

export type EmitAgencyDecisionEvent = (input: AgencyDecisionEventInput) => HistoryEvent;

interface PreparationSignals {
  earnMerit: boolean;
  patronage: boolean;
  militarySupport: boolean;
  familyBacking: boolean;
  explicitSupport: boolean;
  permissionReady: boolean;
  permissionEvidence: string;
  commandOpening: boolean;
  commandOpeningEvidence: string;
}

const AGENCY_SUPPORT_THRESHOLD = 40;

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

function uniqueStable(values: readonly string[], maximum = values.length): readonly string[] {
  return [...new Set(values)].sort(stableCompare).slice(-maximum);
}

function goalId(seed: string, characterId: string, armyId: string, createdTurn: number): string {
  return `goal_${stableHash([seed, 'secure-independent-command-v1', characterId, armyId, createdTurn]).slice(0, 14)}`;
}

function planId(goal: AgencyDecisionGoalState): string {
  return `plan_${stableHash([goal.id, 'independent-command-plan-v1']).slice(0, 14)}`;
}

function supportActionId(
  goal: AgencyDecisionGoalState,
  action: AgencySupportActionKind,
  attemptOrdinal: number,
): string {
  return `support_${stableHash([goal.id, action, attemptOrdinal, 'agency-support-v1']).slice(0, 14)}`;
}

function factMentionsDeputy(fact: SimulationFact, characterId: string, armyId: string): boolean {
  if (fact.kind === 'battle') {
    return [fact.payload.attacker, ...fact.payload.defenders].some((force) => (
      force.armyId === armyId && force.deputyCommanderId === characterId
    ));
  }
  if (fact.kind === 'appointment_started' || fact.kind === 'appointment_ended') {
    return fact.payload.holderId === characterId && fact.payload.armyId === armyId;
  }
  return false;
}

function sourceFacts(
  world: WorldState,
  characterId: string,
  armyId: string,
  earliestTurn: number,
): readonly string[] {
  const ids: string[] = [];
  for (let index = world.facts.length - 1; index >= 0; index -= 1) {
    const fact = world.facts[index];
    if (!fact) continue;
    if (fact.turn < earliestTurn) break;
    if (!factMentionsDeputy(fact, characterId, armyId)) continue;
    ids.push(fact.id);
    if (ids.length >= MAX_AGENCY_GOAL_SOURCE_FACTS) break;
  }
  return ids.sort(stableCompare);
}

function directedRelationship(
  world: WorldState,
  sourceId: string,
  targetId: string,
): RelationshipState | undefined {
  return world.relationships.find((relationship) => (
    relationship.sourceId === sourceId && relationship.targetId === targetId
  ));
}

function patronageValue(relationship: RelationshipState | undefined): number {
  return relationship ? clamp(relationship.trust + relationship.gratitude * 0.4) : 0;
}

function familyBackingValue(world: WorldState, familyId: string): number {
  const family = world.families.find((item) => item.id === familyId && item.active);
  if (!family) return 0;
  return clamp(Math.max(
    family.prestige * 1.34,
    family.politicalInfluence * 1.54,
    family.traditions.military * 0.96,
  ));
}

function hasRecentCommandChange(
  world: WorldState,
  armyId: string,
  actorId: string,
  turn: number,
): boolean {
  const earliestRelevantTurn = turn - Math.max(
    ARMY_COMMAND_CHANGE_COOLDOWN_TURNS,
    COMMAND_CHANGE_PARTICIPANT_COOLDOWN_TURNS,
  ) + 1;
  for (let index = world.facts.length - 1; index >= 0; index -= 1) {
    const fact = world.facts[index];
    if (!fact) continue;
    if (fact.turn < earliestRelevantTurn) break;
    if (fact.kind !== 'agency_intent_resolved' || fact.payload.outcome !== 'executed') continue;
    if (fact.payload.targetArmyId === armyId
      && turn - fact.turn < ARMY_COMMAND_CHANGE_COOLDOWN_TURNS) return true;
    if ((fact.payload.actorId === actorId || fact.payload.previousCommanderId === actorId)
      && turn - fact.turn < COMMAND_CHANGE_PARTICIPANT_COOLDOWN_TURNS) return true;
  }
  return false;
}

function activeDeputyOffice(
  world: WorldState,
  characterId: string,
  armyId: string,
) {
  return world.offices.find((office) => (
    office.active
    && office.kind === '军团副将'
    && office.holderId === characterId
    && office.armyId === armyId
  ));
}

function preparationSignals(
  world: WorldState,
  character: CharacterState,
  commanderId: string,
  armyId: string,
  turn: number,
  supportActions: readonly AgencySupportActionState[] = [],
): PreparationSignals {
  const polity = world.polities.find((item) => item.id === character.polityId);
  const family = world.families.find((item) => item.id === character.familyId && item.active);
  const army = world.armies.find((item) => item.id === armyId);
  const commander = world.characters.find((item) => item.id === commanderId && item.alive);
  const deputyOffice = activeDeputyOffice(world, character.id, armyId);
  const commanderRelation = directedRelationship(world, commanderId, character.id);
  const rulerRelation = polity ? directedRelationship(world, polity.rulerId, character.id) : undefined;
  const actorViewOfCommander = directedRelationship(world, character.id, commanderId);
  const tenure = deputyOffice ? turn - deputyOffice.appointedTurn : 0;
  const claimAdvantage = commander
    ? character.leadership + character.merit * 0.48 + character.deputyExperience * 0.32
      - commander.leadership - commander.merit * 0.22
    : -100;
  const commanderDiscredited = Boolean(commander && army && (
    commander.loyalty <= 34
    || army.morale <= 22
    || (actorViewOfCommander?.grievance ?? 0) >= 58
  ));
  const permissionReady = Boolean(
    army
    && commander
    && polity
    && army.polityId === polity.id
    && army.commanderId === commander.id
    && army.deputyCommanderId === character.id
    && commander.commandingArmyId === army.id
    && character.polityId === polity.id
    && character.age >= 16
    && !character.commandingArmyId
    && !character.commandingFleetId
    && !character.governedRegionId
    && character.id !== polity.rulerId
    && commander.id !== polity.rulerId
    && deputyOffice
  );
  const permissionEvidence = permissionReady
    ? '仍在该军团副将任上，且没有兼领其他军政实权'
    : '当前职位、年龄或兼领职权不允许提出独立军令';
  const cooledDown = !hasRecentCommandChange(world, armyId, character.id, turn);
  const tenureReady = Boolean(deputyOffice && tenure >= MIN_INDEPENDENT_COMMAND_DEPUTY_TENURE_TURNS);
  const commandOpening = tenureReady && cooledDown && (commanderDiscredited || claimAdvantage >= 32);
  const commandOpeningEvidence = !tenureReady
    ? `还需在副将任上履职${Math.max(0, MIN_INDEPENDENT_COMMAND_DEPUTY_TENURE_TURNS - tenure)}季`
    : !cooledDown
      ? '近期刚有军令更替，朝廷尚不受理再次换帅'
      : commanderDiscredited
        ? '现任主帅的军心、忠诚或上下关系已经明显动摇'
        : claimAdvantage >= 32
          ? '申请人的军功与统军履历已明显胜过现任主帅'
          : '现任主帅并未失势，申请人的履历优势也还不够明显';
  const securedActions = supportActions.filter((action) => action.outcome === 'secured');
  const securedMilitarySupport = securedActions.some((action) => action.action === 'cultivate_military_support');
  const securedPatronage = securedActions.some((action) => (
    action.action === 'request_backing'
    && (action.targetKind === 'commander' || action.targetKind === 'ruler')
  ));
  const securedFamilyBacking = securedActions.some((action) => (
    action.action === 'request_backing' && action.targetKind === 'family_head'
  ));
  return {
    earnMerit: (character.deputyExperience >= 28 && character.merit >= 38)
      || character.deputyExperience >= 46
      || character.merit >= 58,
    patronage: securedPatronage || Math.max(
      patronageValue(commanderRelation),
      patronageValue(rulerRelation),
    ) >= AGENCY_SUPPORT_THRESHOLD,
    militarySupport: securedMilitarySupport || character.deputyExperience >= 38
      || character.merit >= 50
      || (character.influence >= 46 && character.renown >= 32),
    familyBacking: securedFamilyBacking || Boolean(family && (
      family.prestige >= 30
      || family.politicalInfluence >= 26
      || family.traditions.military >= 42
    )),
    explicitSupport: securedActions.length > 0,
    permissionReady,
    permissionEvidence,
    commandOpening,
    commandOpeningEvidence,
  };
}

function buildPlan(
  goal: AgencyDecisionGoalState,
  signals: PreparationSignals,
  attemptOrdinal: number,
  nextEligibleIntentTurn: number,
  turn: number,
): AgencyDecisionPlanState {
  const invalid = goal.status === 'invalidated';
  const achieved = goal.status === 'achieved';
  const preparations = [signals.patronage, signals.militarySupport, signals.familyBacking]
    .filter(Boolean).length;
  const requestReady = !invalid
    && !achieved
    && signals.earnMerit
    && signals.explicitSupport
    && preparations >= 2
    && signals.permissionReady
    && signals.commandOpening
    && goal.sourceFactIds.length > 0
    && attemptOrdinal < MAX_AGENCY_INTENT_ATTEMPTS
    && turn >= nextEligibleIntentTurn;
  const conditions = [
    signals.earnMerit,
    signals.patronage,
    signals.militarySupport,
    signals.familyBacking,
    false,
  ];
  const evidences = [
    signals.earnMerit ? '已有可核验的副将经历或战功' : '还需更多副将经历或战功',
    signals.patronage ? '主帅或主君一侧已有可用提携' : '尚未得到主帅或主君的可靠提携',
    signals.militarySupport ? '军中履历、名望或将校支持已形成支点' : '军中的履历与将校支持仍显单薄',
    signals.familyBacking ? '家门声望、朝中影响或家主背书可以相助' : '家门尚不足以替这次请求背书',
    requestReady ? '准备已经足以递交独立军令请求' : !signals.permissionReady
      ? signals.permissionEvidence
      : !signals.commandOpening
      ? signals.commandOpeningEvidence
      : !signals.explicitSupport
      ? '还需亲自争取一项可追溯的军中支持或上位者背书'
      : preparations < 2
      ? '除战功外，至少还需两项支持'
      : attemptOrdinal >= MAX_AGENCY_INTENT_ATTEMPTS
        ? '这项请求已经三次见诸裁决，暂不再递交'
        : turn < nextEligibleIntentTurn
          ? `上次裁决后需等到第${nextEligibleIntentTurn}回合再议`
          : '尚缺可追溯的军旅事实',
  ];
  const steps = INDEPENDENT_COMMAND_PLAN_ACTIONS.map((action, index): AgencyDecisionPlanStepState => ({
    id: `${planId(goal)}:step:${action}`,
    action,
    order: index + 1,
    status: invalid
      ? 'invalidated'
      : achieved
        ? 'completed'
        : index === 4
          ? requestReady ? 'available' : 'blocked'
          : conditions[index] ? 'completed' : 'available',
    evidence: evidences[index] as string,
  }));
  const current = requestReady
    ? steps.find((step) => step.action === 'request_independent_command')
    : steps.find((step) => step.status === 'available');
  return {
    id: planId(goal),
    templateVersion: 1,
    goalId: goal.id,
    status: invalid ? 'invalidated' : achieved ? 'achieved' : 'active',
    currentStepIndex: current ? current.order - 1 : null,
    steps,
  };
}

function createActorState(
  world: WorldState,
  character: CharacterState,
  armyId: string,
  commanderId: string,
  turn: number,
): CharacterAgencyDecisionState {
  const desire = projectCharacterDesires(world, character.id);
  const goal: AgencyDecisionGoalState = {
    id: goalId(world.seed, character.id, armyId, turn),
    type: 'secure_independent_command',
    targetArmyId: armyId,
    targetPolityId: character.polityId,
    createdTurn: turn,
    lastReviewedTurn: turn,
    status: 'active',
    resolvedTurn: null,
    closureReason: null,
    // A migrated save starts at a live boundary. Only facts from this first
    // live quarter may seed its first authoritative goal.
    sourceFactIds: sourceFacts(world, character.id, armyId, turn),
  };
  return {
    characterId: character.id,
    coreDesireKinds: [
      desire.coreDesireKinds[0] ?? 'safety',
      desire.coreDesireKinds[1] ?? (desire.coreDesireKinds[0] === 'power' ? 'renown' : 'power'),
    ],
    goal,
    plan: buildPlan(goal, preparationSignals(world, character, commanderId, armyId, turn), 0, turn, turn),
    supportActions: [],
    supportAttemptOrdinal: 0,
    nextEligibleSupportTurn: turn,
    attemptOrdinal: 0,
    nextEligibleIntentTurn: turn,
    lastResolutionFactId: null,
    lastReviewedTurn: turn,
  };
}

function hasIndependentCommandDrive(world: WorldState, character: CharacterState): boolean {
  const desire = projectCharacterDesires(world, character.id);
  const power = desire.axes.find((axis) => axis.kind === 'power')?.weight ?? 0;
  const renown = desire.axes.find((axis) => axis.kind === 'renown')?.weight ?? 0;
  const family = world.families.find((item) => item.id === character.familyId && item.active);
  const drive = Math.max(power, renown)
    + (character.ambition - 50) * 0.14
    + (character.leadership - 50) * 0.1
    + (character.politicalClass === '军门' ? 7 : 0)
    + ((family?.traditions.military ?? 50) - 50) * 0.06;
  return desire.coreDesireKinds.some((kind) => kind === 'power' || kind === 'renown') && drive >= 58;
}

function reviewActorState(
  world: WorldState,
  previous: CharacterAgencyDecisionState,
  turn: number,
): CharacterAgencyDecisionState {
  const character = world.characters.find((item) => item.id === previous.characterId);
  const target = world.armies.find((army) => army.id === previous.goal.targetArmyId);
  let goal = { ...previous.goal, sourceFactIds: [...previous.goal.sourceFactIds] };
  if (goal.status === 'active') {
    if (!character?.alive) {
      goal = { ...goal, status: 'invalidated', resolvedTurn: turn, closureReason: 'actor_dead' };
    } else if (!target) {
      goal = { ...goal, status: 'invalidated', resolvedTurn: turn, closureReason: 'target_missing' };
    } else if (target.commanderId === character.id && character.commandingArmyId === target.id) {
      goal = { ...goal, status: 'achieved', resolvedTurn: turn, closureReason: 'command_obtained' };
    } else if (target.deputyCommanderId !== character.id) {
      goal = { ...goal, status: 'invalidated', resolvedTurn: turn, closureReason: 'position_lost' };
    } else if (previous.attemptOrdinal >= MAX_AGENCY_INTENT_ATTEMPTS) {
      goal = { ...goal, status: 'invalidated', resolvedTurn: turn, closureReason: 'request_exhausted' };
    } else {
      goal = {
        ...goal,
        lastReviewedTurn: turn,
        sourceFactIds: [...uniqueStable([
          ...goal.sourceFactIds,
          // Appointments run after this system, so include the previous review
          // turn once more. This captures late same-turn Facts while bounding
          // work to a two-quarter suffix instead of rescanning the goal's age.
          ...sourceFacts(world, character.id, target.id, previous.lastReviewedTurn),
        ], MAX_AGENCY_GOAL_SOURCE_FACTS)],
      };
    }
  }
  const commanderId = target?.commanderId ?? '';
  const signals = character && commanderId
    ? preparationSignals(
        world,
        character,
        commanderId,
        target?.id ?? goal.targetArmyId,
        turn,
        previous.supportActions,
      )
    : {
        earnMerit: false,
        patronage: false,
        militarySupport: false,
        familyBacking: false,
        explicitSupport: false,
        permissionReady: false,
        permissionEvidence: '人物或军团状态已经失去核验条件',
        commandOpening: false,
        commandOpeningEvidence: '人物或军团状态已经失去核验条件',
      };
  goal = { ...goal, lastReviewedTurn: turn };
  return {
    ...previous,
    supportActions: previous.supportActions.slice(-MAX_AGENCY_SUPPORT_ACTIONS),
    goal,
    plan: buildPlan(goal, signals, previous.attemptOrdinal, previous.nextEligibleIntentTurn, turn),
    lastReviewedTurn: turn,
  };
}

function reviewDecisionState(world: WorldState, turn: number): CharacterAgencyDecisionState[] {
  const previousByCharacter = new Map(world.agencyDecisionSystem.actors.map((actor) => [actor.characterId, actor]));
  const reviewed = world.agencyDecisionSystem.actors.map((actor) => reviewActorState(world, actor, turn));
  const currentDeputies = [...world.armies]
    .sort((left, right) => stableCompare(left.id, right.id))
    .flatMap((army) => {
      if (!army.deputyCommanderId) return [];
      const character = world.characters.find((item) => item.id === army.deputyCommanderId && item.alive);
      if (!character || !hasIndependentCommandDrive(world, character)) return [];
      const deputyOffice = activeDeputyOffice(world, character.id, army.id);
      if (!deputyOffice
        || turn - deputyOffice.appointedTurn < MIN_INDEPENDENT_COMMAND_DEPUTY_TENURE_TURNS
        || hasRecentCommandChange(world, army.id, character.id, turn)) return [];
      const previous = previousByCharacter.get(character.id);
      if (previous?.goal.status === 'active' && previous.goal.targetArmyId === army.id) return [];
      if (previous?.goal.targetArmyId === army.id
        && previous.goal.status !== 'active'
        && previous.goal.resolvedTurn !== null
        && turn - previous.goal.resolvedTurn < AGENCY_DECISION_CLOSED_RETENTION_TURNS) return [];
      const existingIndex = reviewed.findIndex((actor) => actor.characterId === character.id);
      const next = createActorState(world, character, army.id, army.commanderId, turn);
      if (existingIndex >= 0) reviewed.splice(existingIndex, 1, next);
      else reviewed.push(next);
      return [character.id];
    });
  void currentDeputies;
  return reviewed
    .filter((actor) => actor.goal.status === 'active'
      || actor.goal.resolvedTurn === null
      || turn - actor.goal.resolvedTurn < AGENCY_DECISION_CLOSED_RETENTION_TURNS)
    .sort((left, right) => (
      Number(right.goal.status === 'active') - Number(left.goal.status === 'active')
      || right.lastReviewedTurn - left.lastReviewedTurn
      || stableCompare(left.characterId, right.characterId)
    ))
    .slice(0, MAX_AGENCY_DECISION_ACTORS)
    .sort((left, right) => stableCompare(left.characterId, right.characterId));
}

interface AgencySupportTurnAction {
  actorId: string;
  goalId: string;
  planId: string;
  planStepId: string;
  action: AgencySupportActionKind;
  attemptOrdinal: number;
  targetKind: AgencySupportTargetKind;
  targetId: string;
  targetArmyId: string;
  polityId: string;
  embodiedCommand?: EmbodiedActionCommand;
  embodiedSubmissionFactId?: string;
}

interface AgencySupportResolution {
  actorState: CharacterAgencyDecisionState;
  fact: Extract<SimulationFact, { kind: 'agency_support_resolved' }>;
  event: HistoryEvent;
}

function hashRange(minimum: number, maximum: number, ...parts: readonly unknown[]): number {
  const span = maximum - minimum + 1;
  return minimum + (Number.parseInt(stableHash(parts).slice(0, 8), 16) % span);
}

function ensureAgencyRelationship(
  world: WorldState,
  sourceId: string,
  targetId: string,
): { relationship: RelationshipState; created: boolean } {
  const existing = directedRelationship(world, sourceId, targetId);
  if (existing) return { relationship: existing, created: false };
  world.counters.relationship += 1;
  const relationship: RelationshipState = {
    id: `rel_${String(world.counters.relationship).padStart(5, '0')}`,
    sourceId,
    targetId,
    kinship: '无',
    affinity: hashRange(34, 52, world.seed, 'agency-support-affinity', sourceId, targetId),
    trust: hashRange(30, 44, world.seed, 'agency-support-trust', sourceId, targetId),
    fear: 0,
    grievance: 0,
    gratitude: 0,
    lastInteractionTurn: world.turn,
    memories: [],
  };
  world.relationships.push(relationship);
  return { relationship, created: true };
}

function rememberAgencyInteraction(
  world: WorldState,
  relationship: RelationshipState,
  turn: number,
  kind: RelationshipState['memories'][number]['kind'],
  impact: number,
  summary: string,
  eventId: string,
): void {
  relationship.lastInteractionTurn = turn;
  relationship.memories.push({ turn, kind, impact, summary, eventId });
  const protectedCommitmentEvents = new Set(world.commitments
    .filter((commitment) => (
      (commitment.status === '履约' || commitment.status === '背约')
      && commitment.resolvedTurn !== null
      && turn - commitment.resolvedTurn < 32
      && commitment.resolutionEventId
    ))
    .map((commitment) => commitment.resolutionEventId as string));
  while (relationship.memories.length > 8) {
    const expendableIndex = relationship.memories.findIndex((memory) => (
      (memory.eventId === null || !protectedCommitmentEvents.has(memory.eventId)) && memory.eventId !== eventId
    ));
    relationship.memories.splice(expendableIndex >= 0 ? expendableIndex : relationship.memories.length - 1, 1);
  }
}

function supportActionFor(
  world: WorldState,
  actor: CharacterAgencyDecisionState,
  turn: number,
): AgencySupportTurnAction | null {
  if (actor.goal.status !== 'active'
    || actor.plan.status !== 'active'
    || turn < actor.nextEligibleSupportTurn
    || actor.supportActions.some((action) => action.outcome === 'secured')) return null;
  const character = world.characters.find((item) => item.id === actor.characterId && item.alive);
  const army = world.armies.find((item) => item.id === actor.goal.targetArmyId);
  const polity = world.polities.find((item) => item.id === actor.goal.targetPolityId && item.alive);
  if (!character || !army || !polity || army.deputyCommanderId !== character.id) return null;
  const signals = preparationSignals(world, character, army.commanderId, army.id, turn, actor.supportActions);
  let action: AgencySupportActionKind;
  let targetKind: AgencySupportTargetKind;
  let targetId: string;
  let planAction: IndependentCommandPlanAction;
  if (!signals.patronage || (signals.militarySupport && signals.familyBacking)) {
    action = 'request_backing';
    const commanderSupport = patronageValue(directedRelationship(world, army.commanderId, character.id));
    const rulerSupport = patronageValue(directedRelationship(world, polity.rulerId, character.id));
    if (commanderSupport >= rulerSupport || army.commanderId === polity.rulerId) {
      targetKind = army.commanderId === polity.rulerId ? 'ruler' : 'commander';
      targetId = army.commanderId;
    } else {
      targetKind = 'ruler';
      targetId = polity.rulerId;
    }
    planAction = 'seek_patronage';
  } else if (!signals.militarySupport) {
    action = 'cultivate_military_support';
    targetKind = 'army_officers';
    targetId = army.id;
    planAction = 'build_military_support';
  } else {
    const family = world.families.find((item) => item.id === character.familyId && item.active);
    action = 'request_backing';
    targetKind = 'family_head';
    targetId = family?.headId ?? polity.rulerId;
    planAction = 'seek_family_backing';
  }
  return {
    actorId: character.id,
    goalId: actor.goal.id,
    planId: actor.plan.id,
    planStepId: actor.plan.steps.find((step) => step.action === planAction)?.id
      ?? `${actor.plan.id}:step:${planAction}`,
    action,
    attemptOrdinal: actor.supportAttemptOrdinal + 1,
    targetKind,
    targetId,
    targetArmyId: army.id,
    polityId: polity.id,
  };
}

function resolveSupportAction(
  world: WorldState,
  context: AgencyDecisionTurnContext,
  actorState: CharacterAgencyDecisionState,
  action: AgencySupportTurnAction,
  emit: EmitAgencyDecisionEvent,
): AgencySupportResolution | null {
  const actor = world.characters.find((item) => item.id === action.actorId && item.alive);
  const army = world.armies.find((item) => item.id === action.targetArmyId);
  const polity = world.polities.find((item) => item.id === action.polityId && item.alive);
  if (!actor || !army || !polity) return null;
  const targetCharacter = action.targetKind === 'army_officers'
    ? undefined
    : world.characters.find((item) => item.id === action.targetId && item.alive);
  let relationship: RelationshipState | undefined;
  let relationshipCreated = false;
  if (targetCharacter && targetCharacter.id !== actor.id) {
    const ensured = ensureAgencyRelationship(world, targetCharacter.id, actor.id);
    relationship = ensured.relationship;
    relationshipCreated = ensured.created;
  }
  const family = world.families.find((item) => item.id === actor.familyId && item.active);
  const relationTrust = relationship?.trust ?? 0;
  const familyWeight = action.targetKind === 'family_head'
    ? (family?.prestige ?? 0) * 0.18 + (family?.politicalInfluence ?? 0) * 0.16
    : 0;
  const score = action.action === 'cultivate_military_support'
    ? actor.leadership * 0.22 + actor.merit * 0.24 + actor.deputyExperience * 0.24
      + actor.renown * 0.16 + army.morale * 0.14 - actor.insubordination * 0.08
    : actor.loyalty * 0.2 + actor.influence * 0.2 + actor.merit * 0.12
      + actor.cunning * 0.1 + relationTrust * 0.24 + familyWeight - actor.ambition * 0.08;
  const outcome: AgencySupportOutcome = score >= 42 ? 'secured' : score >= 33 ? 'deferred' : 'refused';
  const strength = clamp(score);
  const deltas: StateDelta[] = [];
  if (relationshipCreated && relationship) {
    deltas.push({ entityType: 'relationship', entityId: relationship.id, field: 'created', before: false, after: true });
  }
  if (action.action === 'cultivate_military_support') {
    const wealthBefore = actor.personalWealth;
    actor.personalWealth = Math.max(0, actor.personalWealth - 1);
    if (actor.personalWealth !== wealthBefore) deltas.push({
      entityType: 'character', entityId: actor.id, field: 'personalWealth',
      before: wealthBefore, after: actor.personalWealth, delta: actor.personalWealth - wealthBefore,
    });
    if (outcome === 'secured') {
      const influenceBefore = actor.influence;
      actor.influence = clamp(actor.influence + 3);
      deltas.push({
        entityType: 'character', entityId: actor.id, field: 'influence',
        before: influenceBefore, after: actor.influence, delta: actor.influence - influenceBefore,
      });
    }
  } else if (relationship) {
    const trustBefore = relationship.trust;
    const affinityBefore = relationship.affinity;
    const grievanceBefore = relationship.grievance;
    relationship.trust = outcome === 'secured'
      ? Math.max(AGENCY_SUPPORT_THRESHOLD + 2, clamp(relationship.trust + 8))
      : clamp(relationship.trust + (outcome === 'deferred' ? -1 : -5));
    relationship.affinity = clamp(relationship.affinity + (outcome === 'secured' ? 4 : outcome === 'refused' ? -3 : 0));
    relationship.grievance = clamp(relationship.grievance + (outcome === 'refused' ? 5 : 0));
    for (const [field, before, after] of [
      ['trust', trustBefore, relationship.trust],
      ['affinity', affinityBefore, relationship.affinity],
      ['grievance', grievanceBefore, relationship.grievance],
    ] as const) {
      if (before !== after) deltas.push({ entityType: 'relationship', entityId: relationship.id, field, before, after, delta: after - before });
    }
    if (outcome === 'secured' && action.targetKind === 'family_head' && family) {
      const before = family.politicalInfluence;
      family.politicalInfluence = clamp(family.politicalInfluence + 2);
      if (before !== family.politicalInfluence) deltas.push({
        entityType: 'family', entityId: family.id, field: 'politicalInfluence',
        before, after: family.politicalInfluence, delta: family.politicalInfluence - before,
      });
    }
  }
  const targetLabel = action.targetKind === 'army_officers'
    ? `${army.name}将校`
    : targetCharacter?.name ?? (action.targetKind === 'family_head' ? '家主' : '上位者');
  const resultCopy = outcome === 'secured' ? '答应相助' : outcome === 'deferred' ? '留待后议' : '没有应允';
  const fact = emitSimulationFact(world, context, {
    kind: 'agency_support_resolved',
    category: action.targetKind === 'army_officers' ? '军事' : '政治',
    importance: outcome === 'secured' ? 2 : 1,
    actorIds: [actor.id, ...(targetCharacter && targetCharacter.id !== actor.id ? [targetCharacter.id] : [])],
    polityIds: [polity.id],
    regionIds: [army.regionId],
    causes: [
      { label: '独立统军之志', role: '结构', weight: 0.28, evidence: `${actor.name}正在为请领${army.name}军令作准备` },
      { label: '人物选择', role: '选择', weight: 0.26, evidence: action.action === 'cultivate_military_support' ? `${actor.name}拿出时间与资财联络本军将校` : `${actor.name}亲自向${targetLabel}请求明确背书` },
      { label: '回应条件', role: '条件', weight: 0.22, evidence: `履历、信任与处境合计为${Math.round(score)}` },
      { label: '本次结果', role: '结果', weight: 0.24, evidence: `${targetLabel}${resultCopy}` },
    ],
    stateDeltas: deltas,
    sourceFactIds: [...actorState.goal.sourceFactIds],
    payload: {
      actorId: actor.id,
      goalId: actorState.goal.id,
      planId: actorState.plan.id,
      planStepId: action.planStepId,
      action: action.action,
      attemptOrdinal: action.attemptOrdinal,
      targetKind: action.targetKind,
      targetId: action.targetId,
      targetArmyId: army.id,
      targetArmyName: army.name,
      polityId: polity.id,
      outcome,
      strength,
      retryAfterTurn: outcome === 'secured' ? null : context.turn + (outcome === 'deferred' ? 2 : 4),
    },
  }) as Extract<SimulationFact, { kind: 'agency_support_resolved' }>;
  const eventKind = action.action === 'cultivate_military_support'
    ? outcome === 'secured' ? 'military_support_secured' : 'military_support_attempted'
    : outcome === 'secured' ? 'backing_secured' : 'backing_request_unsuccessful';
  const event = emit({
    category: action.targetKind === 'army_officers' ? '军事' : '政治',
    kind: eventKind,
    title: action.action === 'cultivate_military_support'
      ? outcome === 'secured' ? `${actor.name}赢得${army.name}将校支持` : `${actor.name}联络${army.name}将校未成`
      : outcome === 'secured' ? `${targetLabel}答应为${actor.name}背书` : `${targetLabel}未替${actor.name}背书`,
    summary: action.action === 'cultivate_military_support'
      ? `${actor.name}为独立统军联络${army.name}将校，付出一季心力与少量资财；${outcome === 'secured' ? '军中已有一批人愿意响应。' : outcome === 'deferred' ? '将校仍在观望。' : '将校没有形成可用支持。'}`
      : `${actor.name}为请领${army.name}军令向${targetLabel}开口，${resultCopy}；这次回应已经进入双方关系与军令审查。`,
    importance: outcome === 'secured' ? 2 : 1,
    actorIds: [actor.id, ...(targetCharacter && targetCharacter.id !== actor.id ? [targetCharacter.id] : [])],
    polityIds: [polity.id],
    regionIds: [army.regionId],
    causes: fact.causes,
    stateDeltas: deltas,
    sourceFactIds: [fact.id],
  });
  if (relationship) {
    rememberAgencyInteraction(
      world,
      relationship,
      context.turn,
      outcome === 'secured' ? '提携' : outcome === 'refused' ? '竞争' : '恩义',
      outcome === 'secured' ? 12 : outcome === 'refused' ? -8 : 2,
      `${targetLabel}${resultCopy}，所涉为${actor.name}请领${army.name}军令之事。`,
      event.id,
    );
  }
  appendBiography(actor, event, action.action === 'cultivate_military_support'
    ? outcome === 'secured' ? '赢得将校支持' : '联络将校未成'
    : outcome === 'secured' ? '获人背书' : '求取背书未果');
  const supportState: AgencySupportActionState = {
    id: supportActionId(actorState.goal, action.action, action.attemptOrdinal),
    action: action.action,
    attemptOrdinal: action.attemptOrdinal,
    targetKind: action.targetKind,
    targetId: action.targetId,
    performedTurn: context.turn,
    outcome,
    strength,
    sourceFactId: fact.id,
    sourceEventId: event.id,
  };
  const supportActions = [...actorState.supportActions, supportState].slice(-MAX_AGENCY_SUPPORT_ACTIONS);
  const nextEligibleSupportTurn = fact.payload.retryAfterTurn ?? context.turn + 4;
  const signals = preparationSignals(world, actor, army.commanderId, army.id, context.turn, supportActions);
  return {
    actorState: {
      ...actorState,
      supportActions,
      supportAttemptOrdinal: action.attemptOrdinal,
      nextEligibleSupportTurn,
      plan: buildPlan(actorState.goal, signals, actorState.attemptOrdinal, actorState.nextEligibleIntentTurn, context.turn),
    },
    fact,
    event,
  };
}

function intentFor(
  world: WorldState,
  actor: CharacterAgencyDecisionState,
): AgencyTurnIntent | null {
  if (actor.goal.status !== 'active' || actor.plan.status !== 'active') return null;
  const request = actor.plan.steps.find((step) => (
    step.action === 'request_independent_command' && step.status === 'available'
  ));
  const army = world.armies.find((item) => item.id === actor.goal.targetArmyId);
  const polity = world.polities.find((item) => item.id === actor.goal.targetPolityId && item.alive);
  if (!request || !army || !polity || army.deputyCommanderId !== actor.characterId) return null;
  const securedSupportFactId = actor.supportActions
    .filter((action) => action.outcome === 'secured')
    .at(-1)?.sourceFactId;
  const historicalSources = uniqueStable(
    actor.goal.sourceFactIds,
    MAX_AGENCY_GOAL_SOURCE_FACTS - (securedSupportFactId ? 1 : 0),
  );
  return {
    actorId: actor.characterId,
    goalId: actor.goal.id,
    goalCreatedTurn: actor.goal.createdTurn,
    planId: actor.plan.id,
    planStepId: request.id,
    action: 'request_independent_command',
    attemptOrdinal: actor.attemptOrdinal + 1,
    targetArmyId: army.id,
    polityId: army.polityId,
    currentCommanderId: army.commanderId,
    appointingAuthorityId: polity.rulerId,
    sourceFactIds: securedSupportFactId
      ? [...historicalSources, securedSupportFactId].sort(stableCompare)
      : historicalSources,
    submittedFactId: null,
    resolvedFactId: null,
  };
}

interface EmbodiedMilitaryActionCandidate {
  projection: EmbodiedActionProjection;
  supportAction: AgencySupportTurnAction | null;
  intent: AgencyTurnIntent | null;
}

function identityActionLabel(
  world: WorldState,
  action: AgencySupportTurnAction,
): { label: string; targetLabel: string; intent: string; cost: string; obstacle: string; nextSignal: string } {
  const army = world.armies.find((item) => item.id === action.targetArmyId);
  const target = world.characters.find((item) => item.id === action.targetId);
  const armyLabel = army?.name ?? '本军';
  if (action.action === 'cultivate_military_support') {
    return {
      label: '联络本军将校',
      targetLabel: `${armyLabel}将校`,
      intent: `亲自巡营联络${armyLabel}将校，为日后独当一面争取军中支持。`,
      cost: '本季心力与至多 1 点私产',
      obstacle: `将校会衡量其战功、统率、名望与${armyLabel}当前军心`,
      nextSignal: `观察${armyLabel}将校是响应、观望还是拒绝`,
    };
  }
  const relation = target ? directedRelationship(world, target.id, action.actorId) : undefined;
  const relationLabel = action.targetKind === 'family_head'
    ? '家主'
    : action.targetKind === 'ruler'
      ? '主君'
      : '主帅';
  return {
    label: `请${relationLabel}背书`,
    targetLabel: target?.name ?? relationLabel,
    intent: `向${target?.name ?? relationLabel}说明独立统军之志，请其为日后的军令请求明确背书。`,
    cost: '本季人情与双方关系',
    obstacle: `${target?.name ?? relationLabel}目前对其信任为${relation?.trust ?? 0}，也会衡量忠诚与军功`,
    nextSignal: `观察${target?.name ?? relationLabel}是答应相助、留待后议还是拒绝`,
  };
}

function embodiedMilitaryActionFor(
  world: WorldState,
  actorState: CharacterAgencyDecisionState,
): EmbodiedMilitaryActionCandidate | null {
  if (actorState.goal.status !== 'active' || actorState.plan.status !== 'active') return null;
  const actor = world.characters.find((item) => item.id === actorState.characterId && item.alive);
  const army = world.armies.find((item) => item.id === actorState.goal.targetArmyId);
  if (!actor || !army || army.deputyCommanderId !== actor.id) return null;
  const intent = intentFor(world, actorState);
  if (intent) {
    return {
      projection: {
        command: createEmbodiedActionCommand(
          world,
          actor.id,
          'request_independent_command',
          'army',
          army.id,
        ),
        label: '请领独立军令',
        targetLabel: army.name,
        intent: `正式向朝廷请求接掌${army.name}，由军令审查决定是否换帅。`,
        cost: '押上本季军中声望与朝廷信任',
        obstacle: `朝廷将同时审查职位、履历、明确支持、风险，并与本季其他军令请求一并裁定`,
        nextSignal: `观察朝廷是授下${army.name}军令、暂缓、安抚还是削权`,
        available: true,
        unavailableReason: null,
      },
      supportAction: null,
      intent,
    };
  }
  const supportAction = supportActionFor(world, actorState, world.turn);
  if (supportAction) {
    const copy = identityActionLabel(world, supportAction);
    return {
      projection: {
        command: createEmbodiedActionCommand(
          world,
          actor.id,
          supportAction.action,
          supportAction.targetKind === 'army_officers' ? 'army' : 'character',
          supportAction.targetId,
        ),
        ...copy,
        available: true,
        unavailableReason: null,
      },
      supportAction,
      intent: null,
    };
  }
  const request = actorState.plan.steps.find((step) => step.action === 'request_independent_command');
  const retry = actorState.nextEligibleSupportTurn > world.turn
    ? `上一次争取支持后，需等到第${actorState.nextEligibleSupportTurn}回合再行动`
    : request?.evidence ?? '军功、支持或职位条件仍不足';
  return {
    projection: {
      command: createEmbodiedActionCommand(
        world,
        actor.id,
        'request_independent_command',
        'army',
        army.id,
      ),
      label: '筹措独立军令',
      targetLabel: army.name,
      intent: `继续为接掌${army.name}准备履历、军中支持与上位者背书。`,
      cost: '本季尚无可提交的具体行动',
      obstacle: retry,
      nextSignal: `观察${army.name}军功、支持与朝廷受理条件是否出现缺口`,
      available: false,
      unavailableReason: retry,
    },
    supportAction: null,
    intent: null,
  };
}

/** Pure player projection: generic actions plus at most one role-specific military action. */
export function projectCharacterEmbodiedActions(
  world: WorldState,
  actorId: string,
): readonly EmbodiedActionProjection[] {
  const generic = projectEmbodiedActions(world, actorId);
  const actorState = world.agencyDecisionSystem.actors.find((item) => item.characterId === actorId);
  const military = actorState ? embodiedMilitaryActionFor(world, actorState) : null;
  return military ? [...generic, military.projection] : generic;
}

function embodiedCommandsMatch(left: EmbodiedActionCommand, right: EmbodiedActionCommand): boolean {
  return left.actionId === right.actionId
    && left.issuedTurn === right.issuedTurn
    && left.actorId === right.actorId
    && left.kind === right.kind
    && left.targetKind === right.targetKind
    && left.targetId === right.targetId
    && left.stance === right.stance;
}

function isEmbodiedIdentityAction(command: EmbodiedActionCommand | null | undefined): command is EmbodiedActionCommand {
  return Boolean(command && EMBODIED_IDENTITY_ACTION_KINDS.includes(
    command.kind as (typeof EMBODIED_IDENTITY_ACTION_KINDS)[number],
  ));
}

function submitEmbodiedIdentityAction(
  world: WorldState,
  context: AgencyDecisionTurnContext,
  command: EmbodiedActionCommand,
  option: EmbodiedActionProjection | null,
): Extract<SimulationFact, { kind: 'embodied_action_submitted' }> {
  const actor = world.characters.find((item) => item.id === command.actorId);
  const army = world.armies.find((item) => item.id === command.targetId);
  return emitSimulationFact(world, context, {
    kind: 'embodied_action_submitted',
    category: '军事',
    importance: 1,
    actorIds: actor ? [actor.id] : [],
    polityIds: actor?.polityId ? [actor.polityId] : [],
    regionIds: army?.regionId ? [army.regionId] : actor?.locationRegionId ? [actor.locationRegionId] : [],
    causes: [
      { label: '军中身份', role: '结构', weight: 0.3, evidence: actor ? `${actor.name}正处在独立统军的军职链上` : '原定人物已经失去军职载体' },
      { label: '人物所求', role: '选择', weight: 0.45, evidence: option?.intent ?? '原定军中行动已经失去可核验条件' },
      { label: '同一裁决', role: '条件', weight: 0.25, evidence: '此事与其他人物使用相同的军职、关系、资源、风险与冷却规则' },
    ],
    stateDeltas: [],
    sourceFactIds: [],
    payload: {
      actionId: command.actionId,
      issuedTurn: command.issuedTurn,
      source: 'player_embodied',
      actorId: command.actorId,
      action: command.kind,
      targetKind: command.targetKind,
      targetId: command.targetId,
      stance: command.stance,
    },
  }) as Extract<SimulationFact, { kind: 'embodied_action_submitted' }>;
}

function resolveEmbodiedIdentityEnvelope(
  world: WorldState,
  context: AgencyDecisionTurnContext,
  command: EmbodiedActionCommand,
  option: EmbodiedActionProjection | null,
  submission: Extract<SimulationFact, { kind: 'embodied_action_submitted' }>,
  result: {
    outcome: 'succeeded' | 'deferred' | 'refused' | 'invalidated';
    reasonCode: 'conditions_changed' | 'accepted' | 'insufficient_support' | 'target_refused';
    score: number;
    threshold: number;
    summary: string;
    domainFact: SimulationFact | null;
  },
): Extract<SimulationFact, { kind: 'embodied_action_resolved' }> {
  const actor = world.characters.find((item) => item.id === command.actorId);
  const domainFact = result.domainFact;
  return emitSimulationFact(world, context, {
    kind: 'embodied_action_resolved',
    category: domainFact?.category ?? '军事',
    importance: domainFact?.importance ?? 1,
    actorIds: domainFact?.actorIds ?? (actor ? [actor.id] : []),
    polityIds: domainFact?.polityIds ?? (actor?.polityId ? [actor.polityId] : []),
    regionIds: domainFact?.regionIds ?? (actor?.locationRegionId ? [actor.locationRegionId] : []),
    causes: [
      { label: '入世决定', role: '触发', weight: 0.25, evidence: option?.intent ?? '原定军中行动已经失去条件' },
      { label: '军中裁决', role: '选择', weight: 0.45, evidence: domainFact ? '沿用人物原本的支持或军令裁决，没有玩家加成与优先权' : '行动条件或本季受理名额已经变化' },
      { label: '实际结果', role: '结果', weight: 0.3, evidence: result.summary },
    ],
    // The domain Fact owns the mutation. This envelope only ties the observer
    // choice to that authoritative result and must not claim the delta twice.
    stateDeltas: [],
    sourceFactIds: [submission.id, ...(domainFact ? [domainFact.id] : [])],
    payload: {
      actionId: command.actionId,
      issuedTurn: command.issuedTurn,
      source: 'player_embodied',
      actorId: command.actorId,
      action: command.kind,
      targetKind: command.targetKind,
      targetId: command.targetId,
      stance: command.stance,
      submissionFactId: submission.id,
      domainFactId: domainFact?.id ?? null,
      targetLabel: option?.targetLabel ?? command.targetId,
      outcome: result.outcome,
      reasonCode: result.reasonCode,
      score: result.score,
      threshold: result.threshold,
      cost: option?.cost ?? '没有实际支出',
      resultSummary: result.summary,
      nextSignal: option?.nextSignal ?? '观察此人的军职与支持条件是否重新出现',
    },
  }) as Extract<SimulationFact, { kind: 'embodied_action_resolved' }>;
}

function check(
  kind: 'permission' | 'resource' | 'relationship' | 'risk',
  value: number,
  threshold: number,
  comparison: 'at_least' | 'at_most',
) {
  const roundedValue = clamp(value);
  return {
    kind,
    passed: comparison === 'at_least' ? roundedValue >= threshold : roundedValue <= threshold,
    value: roundedValue,
    threshold,
    comparison,
  } as const;
}

function appendBiography(character: CharacterState, event: HistoryEvent, kind: string): void {
  if (character.biography.some((fact) => fact.eventId === event.id && fact.kind === kind)) return;
  character.biography.push({
    id: `${character.id}:bio:${event.id}:${kind}`,
    turn: event.turn,
    kind,
    summary: event.summary,
    importance: event.importance,
    eventId: event.id,
    factId: null,
  });
  if (character.biography.length > 80) character.biography.splice(0, character.biography.length - 80);
  character.biographyDigest = stableHash(character.biography);
}

function recordExecutedCommandConsequences(
  world: WorldState,
  actor: CharacterState,
  formerCommander: CharacterState,
  event: HistoryEvent,
  endedDeputyDuties: readonly WorldState['commitments'][number][],
): void {
  appendBiography(actor, event, '升任主帅');
  appendBiography(formerCommander, event, '退居副将');
  for (const duty of endedDeputyDuties) {
    // The promise was to keep serving as deputy. Promotion ends that position,
    // but is neither proof of obedience nor proof of betrayal.
    duty.status = '失效';
    duty.resolvedTurn = world.turn;
    duty.resolutionEventId = event.id;
  }
}

function resolveIntent(
  world: WorldState,
  context: AgencyDecisionTurnContext,
  intent: AgencyTurnIntent,
  emit: EmitAgencyDecisionEvent,
  polityAlreadyGrantedCommand: boolean,
): Extract<SimulationFact, { kind: 'agency_intent_resolved' }> {
  const labelActor = world.characters.find((item) => item.id === intent.actorId);
  const actor = labelActor?.alive ? labelActor : undefined;
  const army = world.armies.find((item) => item.id === intent.targetArmyId);
  const labelCommander = world.characters.find((item) => item.id === intent.currentCommanderId);
  const commander = labelCommander?.alive ? labelCommander : undefined;
  const polity = world.polities.find((item) => item.id === intent.polityId && item.alive);
  const deputyOffice = world.offices.find((office) => (
    office.active
    && office.kind === '军团副将'
    && office.holderId === intent.actorId
    && office.armyId === intent.targetArmyId
  ));
  const exactPermission = Boolean(
    actor
    && army
    && commander
    && polity
    && army.polityId === polity.id
    && army.commanderId === commander.id
    && army.deputyCommanderId === actor.id
    && commander.commandingArmyId === army.id
    && actor.polityId === polity.id
    && polity.rulerId === intent.appointingAuthorityId
    && actor.age >= 16
    && !actor.commandingArmyId
    && !actor.commandingFleetId
    && !actor.governedRegionId
    && actor.id !== polity.rulerId
    && commander.id !== polity.rulerId
    && deputyOffice
  );
  const resourceValue = actor
    ? actor.merit * 0.48 + actor.deputyExperience * 0.42 + actor.leadership * 0.1
    : 0;
  const commanderSupport = actor && commander ? directedRelationship(world, commander.id, actor.id) : undefined;
  const rulerSupport = actor && polity ? directedRelationship(world, polity.rulerId, actor.id) : undefined;
  const actorViewOfCommander = actor && commander ? directedRelationship(world, actor.id, commander.id) : undefined;
  const commanderPatronage = patronageValue(commanderSupport);
  const rulerPatronage = patronageValue(rulerSupport);
  const familyBacking = actor ? familyBackingValue(world, actor.familyId) : 0;
  const relationshipValue = Math.max(commanderPatronage, rulerPatronage, familyBacking);
  const riskValue = actor && polity ? (
    actor.ambition * 0.14
    + (100 - actor.loyalty) * 0.24
    + actor.insubordination * 0.25
    + (100 - polity.authority) * 0.19
    + (actorViewOfCommander?.grievance ?? 0) * 0.12
    - actor.caution * 0.08
    + 8
  ) : 100;
  const permission = check('permission', exactPermission ? 100 : 0, 100, 'at_least');
  const resource = check('resource', resourceValue, 34, 'at_least');
  const relationship = {
    ...check('relationship', relationshipValue, AGENCY_SUPPORT_THRESHOLD, 'at_least'),
    components: [
      { source: 'commander_patronage' as const, value: commanderPatronage, passed: commanderPatronage >= AGENCY_SUPPORT_THRESHOLD },
      { source: 'ruler_patronage' as const, value: rulerPatronage, passed: rulerPatronage >= AGENCY_SUPPORT_THRESHOLD },
      { source: 'family_backing' as const, value: familyBacking, passed: familyBacking >= AGENCY_SUPPORT_THRESHOLD },
    ],
  };
  const risk = check('risk', riskValue, 55, 'at_most');
  const checks = [permission, resource, relationship, risk];
  const commanderDiscredited = Boolean(commander && army && (
    commander.loyalty <= 38
    || army.morale <= 24
    || (actorViewOfCommander?.grievance ?? 0) >= 52
  ));
  const decisionScore = Math.round(actor && commander && polity
    ? actor.leadership + actor.merit * 0.55 + actor.deputyExperience * 0.35
      - commander.leadership - commander.merit * 0.2 + actor.loyalty * 0.12
      + (polity.authority - 50) * 0.16 + (commanderDiscredited ? 22 : 0)
    : -100);
  const decisionThreshold = commanderDiscredited ? 52 : 72;
  let outcome: 'executed' | 'rejected' | 'deferred' | 'invalidated';
  let reasonCode: 'permission_lost' | 'insufficient_record' | 'insufficient_support' | 'competing_request' | 'court_risk' | 'claim_weaker' | 'command_granted';
  if (!permission.passed) {
    outcome = 'invalidated';
    reasonCode = 'permission_lost';
  } else if (!resource.passed) {
    outcome = 'deferred';
    reasonCode = 'insufficient_record';
  } else if (!relationship.passed) {
    outcome = 'deferred';
    reasonCode = 'insufficient_support';
  } else if (polityAlreadyGrantedCommand) {
    outcome = 'deferred';
    reasonCode = 'competing_request';
  } else if (!risk.passed) {
    outcome = 'rejected';
    reasonCode = 'court_risk';
  } else if (decisionScore < decisionThreshold) {
    outcome = 'rejected';
    reasonCode = 'claim_weaker';
  } else {
    outcome = 'executed';
    reasonCode = 'command_granted';
  }
  const institutionResponse: Extract<SimulationFact, { kind: 'agency_intent_resolved' }>['payload']['institutionResponse'] = outcome === 'executed'
    ? 'command_granted'
    : outcome === 'rejected' && reasonCode === 'court_risk'
      ? 'curbed'
      : outcome === 'rejected' && reasonCode === 'claim_weaker'
        ? 'appeased'
        : 'none';
  const deltas: StateDelta[] = [];
  if (outcome === 'executed' && actor && commander && army) {
    deltas.push(
      { entityType: 'army', entityId: army.id, field: 'commanderId', before: commander.id, after: actor.id },
      { entityType: 'army', entityId: army.id, field: 'deputyCommanderId', before: actor.id, after: commander.id },
      { entityType: 'character', entityId: actor.id, field: 'commandingArmyId', before: actor.commandingArmyId, after: army.id },
      { entityType: 'character', entityId: commander.id, field: 'commandingArmyId', before: army.id, after: null },
    );
    army.commanderId = actor.id;
    army.deputyCommanderId = commander.id;
    actor.commandingArmyId = army.id;
    actor.locationRegionId = army.regionId;
    commander.commandingArmyId = null;
    commander.locationRegionId = army.regionId;
  } else if (institutionResponse === 'appeased' && actor) {
    const influenceBefore = actor.influence;
    const loyaltyBefore = actor.loyalty;
    actor.influence = clamp(actor.influence + 4);
    actor.loyalty = clamp(actor.loyalty + 3);
    deltas.push(
      {
        entityType: 'character', entityId: actor.id, field: 'influence',
        before: influenceBefore, after: actor.influence, delta: actor.influence - influenceBefore,
      },
      {
        entityType: 'character', entityId: actor.id, field: 'loyalty',
        before: loyaltyBefore, after: actor.loyalty, delta: actor.loyalty - loyaltyBefore,
      },
    );
  } else if (institutionResponse === 'curbed' && actor && army) {
    const influenceBefore = actor.influence;
    const insubordinationBefore = actor.insubordination;
    army.deputyCommanderId = null;
    actor.influence = clamp(actor.influence - 8);
    actor.insubordination = clamp(actor.insubordination + 10);
    deltas.push(
      { entityType: 'army', entityId: army.id, field: 'deputyCommanderId', before: actor.id, after: null },
      {
        entityType: 'character', entityId: actor.id, field: 'influence',
        before: influenceBefore, after: actor.influence, delta: actor.influence - influenceBefore,
      },
      {
        entityType: 'character', entityId: actor.id, field: 'insubordination',
        before: insubordinationBefore, after: actor.insubordination, delta: actor.insubordination - insubordinationBefore,
      },
    );
  }
  const submittedFactId = intent.submittedFactId;
  if (!submittedFactId) throw new Error('Agency intent must be submitted before resolution');
  const submittedRecord = world.facts.find((fact) => fact.id === submittedFactId);
  const submittedArmyName = submittedRecord?.kind === 'agency_intent_submitted'
    ? submittedRecord.payload.targetArmyName
    : undefined;
  const reasonCopy: Readonly<Record<typeof reasonCode, string>> = {
    permission_lost: '请求资格已经失去',
    insufficient_record: '军中履历仍显不足',
    insufficient_support: '上位者支持与家门背书均显不足',
    competing_request: '同一朝廷本季已经处理另一项军令更替',
    court_risk: '朝廷认为眼下授予军令风险过高',
    claim_weaker: '其资历尚不足以取代现任主帅',
    command_granted: '各项审查通过，军令准予更替',
  };
  const resolution = emitSimulationFact(world, context, {
    kind: 'agency_intent_resolved',
    category: '军事',
    importance: outcome === 'executed' ? 4 : outcome === 'rejected' ? 2 : 1,
    actorIds: [intent.actorId, intent.currentCommanderId, intent.appointingAuthorityId],
    polityIds: [intent.polityId],
    regionIds: army ? [army.regionId] : [],
    causes: [
      { label: '正式请求', role: '触发', weight: 0.2, evidence: `${labelActor?.name ?? '该副将'}已经将独立统军之请递交朝廷` },
      { label: '履历与资源', role: '条件', weight: 0.23, evidence: `履历审查${resource.value}/${resource.threshold}` },
      {
        label: '支持与背书',
        role: '条件',
        weight: 0.2,
        evidence: `主帅支持${commanderPatronage}、主君支持${rulerPatronage}、家门背书${familyBacking}；采用最高一项${relationship.value}/${relationship.threshold}`,
      },
      { label: '朝廷风险', role: '选择', weight: 0.17, evidence: `风险审查${risk.value}/${risk.threshold}` },
      { label: '裁决结果', role: '结果', weight: 0.2, evidence: `${reasonCopy[reasonCode]}；任命判断为${decisionScore}/${decisionThreshold}` },
    ],
    stateDeltas: deltas,
    sourceFactIds: [submittedFactId],
    payload: {
      submissionFactId: submittedFactId,
      actorId: intent.actorId,
      goalId: intent.goalId,
      planId: intent.planId,
      planStepId: intent.planStepId,
      action: intent.action,
      attemptOrdinal: intent.attemptOrdinal,
      targetArmyId: intent.targetArmyId,
      targetArmyName: army?.name ?? submittedArmyName,
      polityId: intent.polityId,
      previousCommanderId: intent.currentCommanderId,
      appointingAuthorityId: intent.appointingAuthorityId,
      outcome,
      reasonCode,
      institutionResponse,
      retryAfterTurn: outcome === 'executed' || outcome === 'invalidated' || institutionResponse === 'curbed'
        ? null
        : context.turn + (outcome === 'deferred' ? 4 : 8),
      checks,
      decisionScore,
      decisionThreshold,
    },
  }) as Extract<SimulationFact, { kind: 'agency_intent_resolved' }>;
  intent.resolvedFactId = resolution.id;
  const eventKind = outcome === 'executed'
    ? 'deputy_promoted'
    : institutionResponse === 'curbed'
      ? 'command_request_curbed'
      : institutionResponse === 'appeased'
        ? 'command_request_appeased'
    : outcome === 'deferred'
      ? 'command_request_deferred'
      : outcome === 'rejected'
        ? 'command_request_rejected'
        : 'command_request_invalidated';
  const requestExhausted = intent.attemptOrdinal >= MAX_AGENCY_INTENT_ATTEMPTS
    && outcome !== 'executed'
    && outcome !== 'invalidated';
  const outcomeCopy = outcome === 'executed'
    ? '获准并已生效'
    : outcome === 'deferred'
      ? '暂缓再议'
      : outcome === 'rejected'
        ? '未获准许'
        : '因资格变化而作罢';
  const eventOutcomeCopy = requestExhausted ? '第三次仍未获准，遂暂且搁置此议' : outcomeCopy;
  const endedDeputyDuties = outcome === 'executed' && actor && commander
    ? world.commitments.filter((commitment) => (
        commitment.kind === '军令'
        && commitment.status === '生效'
        && commitment.promisorId === actor.id
        && commitment.promiseeId === commander.id
      )).sort((left, right) => stableCompare(left.id, right.id))
    : [];
  const chronicleDeltas: StateDelta[] = [
    ...deltas,
    ...endedDeputyDuties.map((duty): StateDelta => ({
      entityType: 'commitment',
      entityId: duty.id,
      field: 'status',
      before: '生效',
      after: '失效',
    })),
  ];
  const event = emit({
      category: '军事',
      kind: eventKind,
      title: outcome === 'executed' && actor && army
        ? `${actor.name}升任${army.name}主帅`
        : requestExhausted
          ? `${labelActor?.name ?? '该副将'}暂搁独立统军之请`
        : institutionResponse === 'curbed'
          ? `${labelActor?.name ?? '该副将'}请令未准并遭削权`
          : institutionResponse === 'appeased'
            ? `${labelActor?.name ?? '该副将'}请令未准，朝廷另作安抚`
          : `${labelActor?.name ?? '该副将'}所请独立军令${outcomeCopy}`,
      summary: outcome === 'executed' && actor && commander && army
        ? `${actor.name}循军中履历递交独立军令请求，经职位、支持与风险审查后获准；${commander.name}退居副将。`
        : institutionResponse === 'curbed'
          ? `${labelActor?.name ?? '该副将'}的请令被朝廷视为军权风险，军令未予授下，其${army?.name ?? '本军'}副将之职也被撤去。`
          : institutionResponse === 'appeased'
            ? `${labelActor?.name ?? '该副将'}尚不足以取代现任主帅；朝廷未授军令，但以名位与礼遇安抚，避免此议立即转为离心。`
        : `${labelActor?.name ?? '该副将'}提出独立统军请求，经军中履历、上位者支持或家门背书、朝廷风险审查后${eventOutcomeCopy}。`,
      importance: outcome === 'executed' ? 4 : outcome === 'rejected' ? 2 : 1,
      actorIds: [intent.actorId, intent.currentCommanderId, intent.appointingAuthorityId],
      polityIds: [intent.polityId],
      regionIds: army ? [army.regionId] : [],
      causes: [
        { label: '长期打算', role: '结构', weight: 0.24, evidence: `${labelActor?.name ?? '该副将'}为独立统军已筹划${Math.max(1, context.turn - intent.goalCreatedTurn + 1)}季` },
        { label: '正式请求', role: '触发', weight: 0.2, evidence: `${labelActor?.name ?? '该副将'}本季正式递交军令请求` },
        { label: '军令审查', role: '选择', weight: 0.28, evidence: reasonCopy[reasonCode] },
        {
          label: '裁决结果',
          role: '结果',
          weight: 0.28,
          evidence: outcome === 'executed'
            ? `${labelCommander?.name ?? '前任主帅'}退居副将，${labelActor?.name ?? '申请人'}接掌${army?.name ?? '该军团'}`
            : institutionResponse === 'curbed'
              ? `${labelActor?.name ?? '申请人'}失去${army?.name ?? '该军团'}副将之职，影响下降而抗命心上升`
              : institutionResponse === 'appeased'
                ? `${labelActor?.name ?? '申请人'}未得军令，但获得礼遇与名位安抚`
            : eventOutcomeCopy,
        },
      ],
      stateDeltas: chronicleDeltas,
      sourceFactIds: [submittedFactId, resolution.id],
    });
  if (outcome === 'executed' && actor && commander && army) {
    context.appointmentSourceFactIdsByArmyId[army.id] = resolution.id;
    recordExecutedCommandConsequences(world, actor, commander, event, endedDeputyDuties);
  } else if (institutionResponse === 'curbed' && actor && army) {
    context.appointmentSourceFactIdsByArmyId[army.id] = resolution.id;
    appendBiography(actor, event, '请令未准并遭削权');
  } else if (institutionResponse === 'appeased' && actor) {
    appendBiography(actor, event, '请令未准后受安抚');
  }
  return resolution;
}

function applyResolutionToActor(
  actor: CharacterAgencyDecisionState,
  resolution: Extract<SimulationFact, { kind: 'agency_intent_resolved' }>,
  turn: number,
): CharacterAgencyDecisionState {
  const requestExhausted = resolution.payload.attemptOrdinal >= MAX_AGENCY_INTENT_ATTEMPTS
    && resolution.payload.outcome !== 'executed'
    && resolution.payload.outcome !== 'invalidated';
  const terminal = resolution.payload.outcome === 'executed'
    || resolution.payload.outcome === 'invalidated'
    || resolution.payload.institutionResponse === 'curbed'
    || requestExhausted;
  const goal: AgencyDecisionGoalState = terminal
    ? {
        ...actor.goal,
        status: resolution.payload.outcome === 'executed' ? 'achieved' : 'invalidated',
        resolvedTurn: turn,
        closureReason: resolution.payload.outcome === 'executed'
          ? 'command_obtained'
          : resolution.payload.institutionResponse === 'curbed'
            ? 'position_lost'
          : requestExhausted
            ? 'request_exhausted'
            : 'position_lost',
        lastReviewedTurn: turn,
      }
    : { ...actor.goal, lastReviewedTurn: turn };
  const nextEligible = resolution.payload.retryAfterTurn ?? turn;
  const target = actor.plan.steps.map((step) => terminal
    ? {
        ...step,
        status: resolution.payload.outcome === 'executed' ? 'completed' as const : 'invalidated' as const,
        evidence: step.action === 'request_independent_command'
          ? resolution.payload.outcome === 'executed'
            ? '独立军令已经获准并实际生效'
            : resolution.payload.institutionResponse === 'curbed'
              ? '请令未准且副将之职被撤，这项打算已经失去职位基础'
            : requestExhausted
              ? '三次正式请求均未获准，这项打算暂且搁置'
            : '原有请求资格已经消失'
          : step.evidence,
      }
    : step.action === 'request_independent_command'
      ? {
          ...step,
          status: 'blocked' as const,
          evidence: `本次未获准，第${nextEligible}回合后方可再议`,
        }
      : step);
  return {
    ...actor,
    goal,
    plan: {
      ...actor.plan,
      status: resolution.payload.outcome === 'executed'
        ? 'achieved'
        : resolution.payload.outcome === 'invalidated' || requestExhausted
          ? 'invalidated'
          : 'active',
      currentStepIndex: terminal ? null : actor.plan.currentStepIndex,
      steps: target,
    },
    attemptOrdinal: resolution.payload.attemptOrdinal,
    nextEligibleIntentTurn: nextEligible,
    lastResolutionFactId: resolution.id,
    lastReviewedTurn: turn,
  };
}

export function createAgencyDecisionSystemState(reviewedThroughTurn = -1): AgencyDecisionSystemState {
  return { version: 1, reviewedThroughTurn, actors: [] };
}

/**
 * Reviews persistent goals, fills a turn-local intent buffer, and resolves every
 * intent before returning. It never reads Chronicle or observer state.
 */
export function processAgencyDecisionSystem(
  world: WorldState,
  context: AgencyDecisionTurnContext,
  emit: EmitAgencyDecisionEvent,
): void {
  const current = world.agencyDecisionSystem;
  if (current.reviewedThroughTurn >= context.turn) return;
  if (current.reviewedThroughTurn !== context.turn - 1) {
    throw new Error(`AgencyDecision expected turn ${current.reviewedThroughTurn + 1}, received ${context.turn}`);
  }
  let actors = reviewDecisionState(world, context.turn);
  const actorById = new Map(actors.map((actor) => [actor.characterId, actor]));
  const requested = context.embodiedActionCommand;
  const identityRequested = isEmbodiedIdentityAction(requested);
  let embodiedActorId: string | null = null;
  let identityOption: EmbodiedActionProjection | null = null;
  let identitySubmission: Extract<SimulationFact, { kind: 'embodied_action_submitted' }> | null = null;
  let playerSupportAction: AgencySupportTurnAction | null = null;
  let playerIntent: AgencyTurnIntent | null = null;
  if (identityRequested) {
    embodiedActorId = world.characters.some((item) => item.id === requested.actorId) ? requested.actorId : null;
    const actorState = actorById.get(requested.actorId);
    const candidate = actorState ? embodiedMilitaryActionFor(world, actorState) : null;
    identityOption = candidate && embodiedCommandsMatch(candidate.projection.command, requested)
      ? candidate.projection
      : null;
    identitySubmission = submitEmbodiedIdentityAction(world, context, requested, identityOption);
    const valid = requested.issuedTurn === context.turn && identityOption?.available === true;
    if (valid && candidate?.supportAction) {
      playerSupportAction = {
        ...candidate.supportAction,
        embodiedCommand: requested,
        embodiedSubmissionFactId: identitySubmission.id,
      };
    } else if (valid && candidate?.intent) {
      playerIntent = {
        ...candidate.intent,
        embodiedCommand: requested,
        embodiedSubmissionFactId: identitySubmission.id,
      };
    } else {
      resolveEmbodiedIdentityEnvelope(world, context, requested, identityOption, identitySubmission, {
        outcome: 'invalidated',
        reasonCode: 'conditions_changed',
        score: 0,
        threshold: 0,
        summary: world.characters.some((item) => item.id === requested.actorId && item.alive)
          ? '原定军中行动因职位、对象或进度变化，未能进入实际裁决。'
          : '原定人物已经失去行动载体，军中行动未能进行。',
        domainFact: null,
      });
    }
  } else {
    embodiedActorId = resolveEmbodiedAction(world, context, emit);
  }
  const supportCandidates = [
    ...actors
    .filter((actor) => actor.characterId !== embodiedActorId)
    .map((actor) => supportActionFor(world, actor, context.turn))
    .filter((action): action is AgencySupportTurnAction => Boolean(action)),
    ...(playerSupportAction ? [playerSupportAction] : []),
  ];
  const supportActions = supportCandidates
    .sort((left, right) => stableCompare(left.actorId, right.actorId))
    .slice(0, MAX_AGENCY_SUPPORT_ACTIONS_PER_TURN);
  if (playerSupportAction && identitySubmission && identityOption && !supportActions.includes(playerSupportAction)) {
    resolveEmbodiedIdentityEnvelope(world, context, requested as EmbodiedActionCommand, identityOption, identitySubmission, {
      outcome: 'deferred',
      reasonCode: 'insufficient_support',
      score: 0,
      threshold: 1,
      summary: '本季军中联络事项过多，这件事未获排入实际处置，需待下一季再看。',
      domainFact: null,
    });
  }
  for (const action of supportActions) {
    const actorState = actorById.get(action.actorId);
    if (!actorState) continue;
    const resolved = resolveSupportAction(world, context, actorState, action, emit);
    if (!resolved) continue;
    actorById.set(action.actorId, resolved.actorState);
    if (action.embodiedCommand && identitySubmission && identityOption) {
      const outcome = resolved.fact.payload.outcome === 'secured'
        ? 'succeeded'
        : resolved.fact.payload.outcome;
      resolveEmbodiedIdentityEnvelope(
        world,
        context,
        action.embodiedCommand,
        identityOption,
        identitySubmission,
        {
          outcome,
          reasonCode: outcome === 'succeeded' ? 'accepted' : outcome === 'deferred' ? 'insufficient_support' : 'target_refused',
          score: resolved.fact.payload.strength,
          threshold: 42,
          summary: resolved.event.summary,
          domainFact: resolved.fact,
        },
      );
    }
  }
  actors = actors.map((actor) => actorById.get(actor.characterId) ?? actor);
  const polityCommandGranted = new Set<string>();
  const intentCandidates = [
    ...actors
    .filter((actor) => actor.characterId !== embodiedActorId)
    .map((actor) => intentFor(world, actor))
    .filter((intent): intent is AgencyTurnIntent => Boolean(intent)),
    ...(playerIntent ? [playerIntent] : []),
  ];
  const intents = intentCandidates
    .sort((left, right) => {
      const leftActor = world.characters.find((character) => character.id === left.actorId);
      const rightActor = world.characters.find((character) => character.id === right.actorId);
      const leftClaim = (leftActor?.merit ?? 0) + (leftActor?.deputyExperience ?? 0) + (leftActor?.leadership ?? 0);
      const rightClaim = (rightActor?.merit ?? 0) + (rightActor?.deputyExperience ?? 0) + (rightActor?.leadership ?? 0);
      return rightClaim - leftClaim || stableCompare(left.actorId, right.actorId);
    })
    .slice(0, MAX_AGENCY_INTENTS_PER_TURN);
  if (playerIntent && identitySubmission && identityOption && !intents.includes(playerIntent)) {
    resolveEmbodiedIdentityEnvelope(world, context, requested as EmbodiedActionCommand, identityOption, identitySubmission, {
      outcome: 'deferred',
      reasonCode: 'insufficient_support',
      score: 0,
      threshold: 1,
      summary: '本季朝廷收到的军令请求过多，这一请未获排入实际裁决，需待下一季再议。',
      domainFact: null,
    });
  }
  context.agencyIntents.push(...intents);
  for (const intent of intents) {
    const submitted = emitSimulationFact(world, context, {
      kind: 'agency_intent_submitted',
      category: '军事',
      importance: 1,
      actorIds: [intent.actorId, intent.currentCommanderId, intent.appointingAuthorityId],
      polityIds: [intent.polityId],
      regionIds: world.armies.find((army) => army.id === intent.targetArmyId)?.regionId
        ? [world.armies.find((army) => army.id === intent.targetArmyId)?.regionId as string]
        : [],
      causes: [
        { label: '独立统军目标', role: '结构', weight: 0.32, evidence: `这项打算已经持续${Math.max(1, context.turn - intent.goalCreatedTurn + 1)}季` },
        { label: '准备进展', role: '条件', weight: 0.28, evidence: '战功之外至少已有两项支持，且其中一项来自本次目标下的实际联络或背书' },
        { label: '人物选择', role: '选择', weight: 0.22, evidence: `第${intent.attemptOrdinal}次正式提出请求` },
        { label: '请求入册', role: '结果', weight: 0.18, evidence: '请求进入本季军令裁决队列' },
      ],
      stateDeltas: [],
      sourceFactIds: [...intent.sourceFactIds],
      payload: {
        actorId: intent.actorId,
        goalId: intent.goalId,
        goalType: 'secure_independent_command',
        goalCreatedTurn: intent.goalCreatedTurn,
        planId: intent.planId,
        planStepId: intent.planStepId,
        action: intent.action,
        attemptOrdinal: intent.attemptOrdinal,
        targetArmyId: intent.targetArmyId,
        targetArmyName: world.armies.find((army) => army.id === intent.targetArmyId)?.name,
        polityId: intent.polityId,
        currentCommanderId: intent.currentCommanderId,
        appointingAuthorityId: intent.appointingAuthorityId,
      },
    }) as Extract<SimulationFact, { kind: 'agency_intent_submitted' }>;
    intent.submittedFactId = submitted.id;
    const resolution = resolveIntent(world, context, intent, emit, polityCommandGranted.has(intent.polityId));
    if (resolution.payload.outcome === 'executed') polityCommandGranted.add(intent.polityId);
    const actorState = actorById.get(intent.actorId);
    if (actorState) actorById.set(intent.actorId, applyResolutionToActor(actorState, resolution, context.turn));
    if (intent.embodiedCommand && identitySubmission && identityOption) {
      const event = [...world.history].reverse().find((item) => item.sourceFactIds.includes(resolution.id));
      const outcome = resolution.payload.outcome === 'executed'
        ? 'succeeded'
        : resolution.payload.outcome === 'rejected'
          ? 'refused'
          : resolution.payload.outcome;
      resolveEmbodiedIdentityEnvelope(world, context, intent.embodiedCommand, identityOption, identitySubmission, {
        outcome,
        reasonCode: outcome === 'succeeded' ? 'accepted' : outcome === 'deferred' ? 'insufficient_support' : outcome === 'refused' ? 'target_refused' : 'conditions_changed',
        score: resolution.payload.decisionScore,
        threshold: resolution.payload.decisionThreshold,
        summary: event?.summary ?? '朝廷已经完成军令审查，结果已记入军职与人物经历。',
        domainFact: resolution,
      });
    }
  }
  actors = actors.map((actor) => actorById.get(actor.characterId) ?? actor);
  world.agencyDecisionSystem = {
    version: 1,
    reviewedThroughTurn: context.turn,
    actors: actors.sort((left, right) => stableCompare(left.characterId, right.characterId)),
  };
  if (context.agencyIntents.some((intent) => !intent.submittedFactId || !intent.resolvedFactId)) {
    throw new Error('AgencyDecision left an unresolved intent in the turn-local buffer');
  }
}

export function validateAgencyDecisionSystemState(world: WorldState): readonly string[] {
  const messages: string[] = [];
  const state = world.agencyDecisionSystem;
  if (!state || state.version !== 1) return ['AgencyDecisionSystem版本无效'];
  if (state.reviewedThroughTurn !== world.turn - 1) {
    messages.push(`AgencyDecision游标应为${world.turn - 1}，实际${state.reviewedThroughTurn}`);
  }
  if (state.actors.length > MAX_AGENCY_DECISION_ACTORS) messages.push('AgencyDecision人物超过上限');
  const characters = new Set<string>();
  const facts = new Map(world.facts.map((fact) => [fact.id, fact]));
  for (const actor of state.actors) {
    if (characters.has(actor.characterId)) messages.push(`${actor.characterId}存在重复AgencyDecision账户`);
    characters.add(actor.characterId);
    if (!world.characters.some((character) => character.id === actor.characterId)) messages.push(`${actor.characterId}没有人物载体`);
    if (!Array.isArray(actor.coreDesireKinds)
      || actor.coreDesireKinds.length !== 2
      || actor.coreDesireKinds[0] === actor.coreDesireKinds[1]
      || actor.coreDesireKinds.some((kind) => !ROOT_DESIRES.includes(kind))) {
      messages.push(`${actor.characterId}的核心欲望身份无效`);
    }
    if (!Number.isSafeInteger(actor.attemptOrdinal) || actor.attemptOrdinal < 0 || actor.attemptOrdinal > MAX_AGENCY_INTENT_ATTEMPTS) {
      messages.push(`${actor.characterId}的意图尝试次数无效`);
    }
    if (!Array.isArray(actor.supportActions)
      || actor.supportActions.length > MAX_AGENCY_SUPPORT_ACTIONS
      || !Number.isSafeInteger(actor.supportAttemptOrdinal)
      || actor.supportAttemptOrdinal < 0
      || !Number.isSafeInteger(actor.nextEligibleSupportTurn)
      || actor.nextEligibleSupportTurn < actor.goal.createdTurn) {
      messages.push(`${actor.characterId}的支持行动账户无效`);
    } else {
      const supportIds = new Set<string>();
      for (const [index, action] of actor.supportActions.entries()) {
        const fact = facts.get(action.sourceFactId);
        if (supportIds.has(action.id)
          || action.id !== supportActionId(actor.goal, action.action, action.attemptOrdinal)
          || action.attemptOrdinal <= 0
          || action.attemptOrdinal > actor.supportAttemptOrdinal
          || (index > 0 && action.attemptOrdinal <= (actor.supportActions[index - 1]?.attemptOrdinal ?? 0))
          || action.performedTurn < actor.goal.createdTurn
          || action.performedTurn > actor.lastReviewedTurn
          || action.strength < 0
          || action.strength > 100
          || fact?.kind !== 'agency_support_resolved'
          || fact.payload.actorId !== actor.characterId
          || fact.payload.goalId !== actor.goal.id
          || fact.payload.planId !== actor.plan.id
          || fact.payload.action !== action.action
          || fact.payload.attemptOrdinal !== action.attemptOrdinal
          || fact.payload.targetKind !== action.targetKind
          || fact.payload.targetId !== action.targetId
          || fact.payload.outcome !== action.outcome
          || fact.payload.strength !== action.strength
          || fact.turn !== action.performedTurn) {
          messages.push(`${actor.characterId}的支持行动${action.id}引用无效`);
        }
        supportIds.add(action.id);
      }
      const latestSupport = actor.supportActions.at(-1);
      if (latestSupport && latestSupport.attemptOrdinal !== actor.supportAttemptOrdinal) {
        messages.push(`${actor.characterId}的支持行动序号不连续`);
      }
    }
    if (!Number.isSafeInteger(actor.nextEligibleIntentTurn) || actor.nextEligibleIntentTurn < actor.goal.createdTurn) {
      messages.push(`${actor.characterId}的再议时间无效`);
    }
    const expectedPlanStatus = actor.goal.status === 'achieved'
      ? 'achieved'
      : actor.goal.status === 'invalidated'
        ? 'invalidated'
        : 'active';
    const cursor = actor.plan.currentStepIndex;
    const cursorValid = cursor === null
      ? actor.plan.status !== 'active' || !actor.plan.steps.some((step) => step.status === 'available')
      : Number.isSafeInteger(cursor)
        && cursor >= 0
        && cursor < INDEPENDENT_COMMAND_PLAN_ACTIONS.length
        && (actor.plan.steps[cursor]?.status === 'available'
          || (actor.plan.steps[cursor]?.action === 'request_independent_command'
            && actor.plan.steps[cursor]?.status === 'blocked'));
    if (actor.goal.id !== goalId(world.seed, actor.characterId, actor.goal.targetArmyId, actor.goal.createdTurn)
      || actor.plan.id !== planId(actor.goal)
      || actor.plan.goalId !== actor.goal.id
      || actor.plan.templateVersion !== 1
      || actor.plan.status !== expectedPlanStatus
      || !cursorValid
      || (actor.plan.status !== 'active' && cursor !== null)
      || actor.plan.steps.length !== INDEPENDENT_COMMAND_PLAN_ACTIONS.length
      || actor.plan.steps.some((step, index) => (
        step.action !== INDEPENDENT_COMMAND_PLAN_ACTIONS[index]
        || step.order !== index + 1
        || step.id !== `${actor.plan.id}:step:${step.action}`
        || !['completed', 'available', 'blocked', 'invalidated'].includes(step.status)
      ))) {
      messages.push(`${actor.characterId}的目标或计划身份无效`);
    }
    if (actor.goal.sourceFactIds.length > MAX_AGENCY_GOAL_SOURCE_FACTS
      || new Set(actor.goal.sourceFactIds).size !== actor.goal.sourceFactIds.length
      || actor.goal.sourceFactIds.some((id) => {
        const fact = facts.get(id);
        return !fact
          || fact.turn < actor.goal.createdTurn
          || fact.turn > actor.goal.lastReviewedTurn
          || !factMentionsDeputy(fact, actor.characterId, actor.goal.targetArmyId);
      })) {
      messages.push(`${actor.characterId}的目标事实来源无效`);
    }
    if (!Number.isSafeInteger(actor.goal.createdTurn)
      || !Number.isSafeInteger(actor.goal.lastReviewedTurn)
      || actor.goal.createdTurn < 0
      || actor.goal.createdTurn > actor.goal.lastReviewedTurn
      || actor.goal.lastReviewedTurn > state.reviewedThroughTurn
      || actor.lastReviewedTurn !== actor.goal.lastReviewedTurn
      || (actor.goal.status === 'active' && (actor.goal.resolvedTurn !== null || actor.goal.closureReason !== null))
      || (actor.goal.status !== 'active' && (actor.goal.resolvedTurn === null || actor.goal.closureReason === null))) {
      messages.push(`${actor.characterId}的目标游标或结案状态无效`);
    }
    if (actor.lastResolutionFactId) {
      const resolution = facts.get(actor.lastResolutionFactId);
      if (resolution?.kind !== 'agency_intent_resolved'
        || resolution.payload.actorId !== actor.characterId
        || resolution.payload.goalId !== actor.goal.id
        || resolution.payload.planId !== actor.plan.id
        || resolution.payload.attemptOrdinal !== actor.attemptOrdinal
        || resolution.turn > actor.lastReviewedTurn
        || (resolution.payload.retryAfterTurn ?? resolution.turn) !== actor.nextEligibleIntentTurn
        || ((resolution.payload.outcome === 'executed' || resolution.payload.outcome === 'invalidated')
          && (actor.goal.resolvedTurn !== resolution.turn || actor.goal.status === 'active'))) {
        messages.push(`${actor.characterId}的最近裁决引用无效`);
      }
      if (resolution?.kind === 'agency_intent_resolved'
        && actor.goal.closureReason === 'request_exhausted'
        && (actor.attemptOrdinal !== MAX_AGENCY_INTENT_ATTEMPTS
          || resolution.payload.outcome === 'executed'
          || resolution.payload.outcome === 'invalidated'
          || actor.goal.resolvedTurn !== resolution.turn)) {
        messages.push(`${actor.characterId}的三请未准结案无效`);
      }
      if (actor.goal.status === 'active' && actor.attemptOrdinal >= MAX_AGENCY_INTENT_ATTEMPTS) {
        messages.push(`${actor.characterId}的已尽请求未及时结案`);
      }
    } else if (actor.goal.closureReason === 'request_exhausted') {
      messages.push(`${actor.characterId}的三请未准结案缺少裁决`);
    }
  }
  return messages;
}
