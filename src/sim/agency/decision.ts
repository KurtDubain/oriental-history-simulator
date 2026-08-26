import { emitSimulationFact, type FactTurnBuffer } from '../facts';
import { stableCompare, stableHash } from '../random';
import { projectCharacterDesires, ROOT_DESIRES, type RootDesire } from './projection';
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
  attemptOrdinal: number;
  nextEligibleIntentTurn: number;
  lastResolutionFactId: string | null;
  lastReviewedTurn: number;
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
}

export interface AgencyDecisionTurnContext extends FactTurnBuffer {
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
  return {
    earnMerit: (character.deputyExperience >= 28 && character.merit >= 38)
      || character.deputyExperience >= 46
      || character.merit >= 58,
    patronage: Math.max(
      patronageValue(commanderRelation),
      patronageValue(rulerRelation),
    ) >= AGENCY_SUPPORT_THRESHOLD,
    militarySupport: character.deputyExperience >= 38
      || character.merit >= 50
      || (character.influence >= 46 && character.renown >= 32),
    familyBacking: Boolean(family && (
      family.prestige >= 30
      || family.politicalInfluence >= 26
      || family.traditions.military >= 42
    )),
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
    signals.patronage ? '主帅或主君一侧已有可用信任' : '尚未得到主帅或主君的可靠提携',
    signals.militarySupport ? '军中履历、名望或影响已形成支点' : '军中的履历与影响仍显单薄',
    signals.familyBacking ? '家门声望、朝中影响或军门传统可以背书' : '家门尚不足以替这次请求背书',
    requestReady ? '准备已经足以递交独立军令请求' : !signals.permissionReady
      ? signals.permissionEvidence
      : !signals.commandOpening
      ? signals.commandOpeningEvidence
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
    ? preparationSignals(world, character, commanderId, target?.id ?? goal.targetArmyId, turn)
    : {
        earnMerit: false,
        patronage: false,
        militarySupport: false,
        familyBacking: false,
        permissionReady: false,
        permissionEvidence: '人物或军团状态已经失去核验条件',
        commandOpening: false,
        commandOpeningEvidence: '人物或军团状态已经失去核验条件',
      };
  goal = { ...goal, lastReviewedTurn: turn };
  return {
    ...previous,
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
    sourceFactIds: actor.goal.sourceFactIds,
    submittedFactId: null,
    resolvedFactId: null,
  };
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
  }
  const submittedFactId = intent.submittedFactId;
  if (!submittedFactId) throw new Error('Agency intent must be submitted before resolution');
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
      polityId: intent.polityId,
      previousCommanderId: intent.currentCommanderId,
      appointingAuthorityId: intent.appointingAuthorityId,
      outcome,
      reasonCode,
      retryAfterTurn: outcome === 'executed' || outcome === 'invalidated'
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
          : `${labelActor?.name ?? '该副将'}所请独立军令${outcomeCopy}`,
      summary: outcome === 'executed' && actor && commander && army
        ? `${actor.name}循军中履历递交独立军令请求，经职位、支持与风险审查后获准；${commander.name}退居副将。`
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
            : eventOutcomeCopy,
        },
      ],
      stateDeltas: chronicleDeltas,
      sourceFactIds: [submittedFactId, resolution.id],
    });
  if (outcome === 'executed' && actor && commander && army) {
    context.appointmentSourceFactIdsByArmyId[army.id] = resolution.id;
    recordExecutedCommandConsequences(world, actor, commander, event, endedDeputyDuties);
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
    || requestExhausted;
  const goal: AgencyDecisionGoalState = terminal
    ? {
        ...actor.goal,
        status: resolution.payload.outcome === 'executed' ? 'achieved' : 'invalidated',
        resolvedTurn: turn,
        closureReason: resolution.payload.outcome === 'executed'
          ? 'command_obtained'
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
  const polityCommandGranted = new Set<string>();
  const intents = actors
    .map((actor) => intentFor(world, actor))
    .filter((intent): intent is AgencyTurnIntent => Boolean(intent))
    .sort((left, right) => {
      const leftActor = world.characters.find((character) => character.id === left.actorId);
      const rightActor = world.characters.find((character) => character.id === right.actorId);
      const leftClaim = (leftActor?.merit ?? 0) + (leftActor?.deputyExperience ?? 0) + (leftActor?.leadership ?? 0);
      const rightClaim = (rightActor?.merit ?? 0) + (rightActor?.deputyExperience ?? 0) + (rightActor?.leadership ?? 0);
      return rightClaim - leftClaim || stableCompare(left.actorId, right.actorId);
    })
    .slice(0, MAX_AGENCY_INTENTS_PER_TURN);
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
        { label: '准备进展', role: '条件', weight: 0.28, evidence: '战功之外的提携、军中支持与家门背书至少已有两项' },
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
