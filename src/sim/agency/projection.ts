import { keyedInt, stableCompare, stableHash } from '../random';
import type {
  CharacterRole,
  CharacterState,
  FamilyState,
  OfficeKind,
  RelationshipState,
  SimulationFact,
  WorldState,
} from '../types';

export const ROOT_DESIRES = [
  'power',
  'renown',
  'family',
  'wealth',
  'safety',
  'loyalty',
  'learning',
  'revenge',
] as const;

export type RootDesire = (typeof ROOT_DESIRES)[number];

export const ROOT_DESIRE_LABELS: Readonly<Record<RootDesire, string>> = {
  power: '权力',
  renown: '功名',
  family: '家族',
  wealth: '财富',
  safety: '安全',
  loyalty: '忠义',
  learning: '学问',
  revenge: '复仇',
};

export type DesireSourceKind = 'origin' | 'personality' | 'family' | 'experience' | 'seed';

export interface DesireSource {
  kind: DesireSourceKind;
  contribution: number;
  summary: string;
  sourceFactIds: readonly string[];
}

export interface DesireAxisProjection {
  kind: RootDesire;
  label: string;
  weight: number;
  rank: number;
  core: boolean;
  sources: readonly DesireSource[];
}

export interface DesirePressureProjection {
  kind: RootDesire;
  label: string;
  intensity: number;
  summary: string;
  sourceFactIds: readonly string[];
}

export interface CharacterDesireProjection {
  version: 1;
  authority: 'projection';
  characterId: string;
  projectedTurn: number;
  axes: readonly DesireAxisProjection[];
  coreDesireKinds: readonly RootDesire[];
  pressures: readonly DesirePressureProjection[];
}

export type AgencyEntityKind = 'character' | 'polity' | 'family' | 'region' | 'army' | 'fleet';

export interface AgencyEntityRef {
  kind: AgencyEntityKind;
  id: string;
}

export type AgencyGoalType =
  | 'secure_independent_command'
  | 'retain_command'
  | 'gain_office'
  | 'win_renown'
  | 'protect_family'
  | 'accumulate_wealth'
  | 'preserve_safety'
  | 'defend_ruler'
  | 'pursue_learning'
  | 'settle_grievance';

export type AgencyGoalStatus = 'active' | 'achieved' | 'invalidated' | 'abandoned';

export type AgencyGoalClosureReason =
  | 'actor_dead'
  | 'target_missing'
  | 'target_dead'
  | 'target_polity_extinct'
  | 'target_family_extinct'
  | 'target_role_changed'
  | 'lost_required_position'
  | 'independent_command_obtained'
  | 'superseded_after_inertia';

export interface AgencyGoalContext {
  originRole: CharacterRole;
  baselineOfficeRank: number;
  requiredOfficeKind: OfficeKind | null;
  baselineValue: number;
}

export interface AgencyGoalProjection {
  id: string;
  characterId: string;
  signature: string;
  type: AgencyGoalType;
  label: string;
  target: AgencyEntityRef;
  status: AgencyGoalStatus;
  priority: number;
  progress: number;
  commitment: number;
  /** Projection-record time only; C09 must persist a ledger before this becomes historical. */
  createdTurn: number;
  minimumCommitUntilTurn: number;
  lastReviewedTurn: number;
  resolvedTurn: number | null;
  closureReason: AgencyGoalClosureReason | null;
  sourceFactIds: readonly string[];
  reason: string;
  barrier: string;
  rationale: string;
  context: AgencyGoalContext;
}

export type AgencyPlanAction =
  | 'earn_merit'
  | 'seek_patronage'
  | 'build_military_support'
  | 'seek_family_backing'
  | 'request_independent_command'
  | 'retain_command'
  | 'request_office'
  | 'govern_well'
  | 'protect_household'
  | 'grow_assets'
  | 'reduce_exposure'
  | 'serve_ruler'
  | 'study_practice'
  | 'gather_evidence'
  | 'seek_redress';

export type AgencyPlanStepStatus = 'completed' | 'available' | 'blocked' | 'invalidated';

export interface AgencyPlanStepProjection {
  id: string;
  order: number;
  action: AgencyPlanAction;
  label: string;
  status: AgencyPlanStepStatus;
  reason: string;
  sourceFactIds: readonly string[];
}

export interface AgencyPlanProjection {
  id: string;
  templateVersion: 1;
  goalId: string;
  characterId: string;
  createdTurn: number;
  status: 'active' | 'invalidated';
  currentStepIndex: number | null;
  steps: readonly AgencyPlanStepProjection[];
}

export interface AgencyPrimaryChallenge {
  goalSignature: string;
  firstSeenTurn: number;
  lastSeenTurn: number;
  consecutiveReviews: number;
}

/**
 * C06/C07 deliberately remains outside WorldState. It is serializable so C09
 * can compare suggestions across quarters, but it is not authoritative, does
 * not enter schema migration, and must never be consumed by a domain resolver.
 */
export interface CharacterAgencyShadowProjection {
  version: 1;
  authority: 'projection';
  seed: string;
  characterId: string;
  sourceWorldHash: string;
  reviewedTurn: number;
  availability: 'active' | 'dormant' | 'closed';
  reason: string;
  barrier: string | null;
  desire: CharacterDesireProjection;
  longTermDirection: RootDesire;
  primaryGoal: AgencyGoalProjection | null;
  secondaryGoals: readonly AgencyGoalProjection[];
  plans: readonly AgencyPlanProjection[];
  recentlyClosedGoals: readonly AgencyGoalProjection[];
  pendingPrimaryChallenge: AgencyPrimaryChallenge | null;
}

export interface CharacterAgencyPlayerDesire {
  label: string;
  weight: number;
  core: boolean;
  reason: string;
}

export interface CharacterAgencyPlayerGoal {
  id: string;
  label: string;
  status: AgencyGoalStatus;
  priority: number;
  progress: number;
  commitment: number;
  reason: string;
  barrier: string;
}

export interface CharacterAgencyPlayerPlanStep {
  label: string;
  status: AgencyPlanStepStatus;
  reason: string;
}

export interface CharacterAgencyPlayerDecision {
  label: string;
  status: Exclude<AgencyGoalStatus, 'active'>;
  reason: string;
}

export interface CharacterAgencyPlayerProjection {
  availability: CharacterAgencyShadowProjection['availability'];
  reason: string;
  barrier: string | null;
  longTermDirectionLabel: string;
  desires: readonly CharacterAgencyPlayerDesire[];
  primaryGoal: CharacterAgencyPlayerGoal | null;
  secondaryGoals: readonly CharacterAgencyPlayerGoal[];
  currentPlanSteps: readonly CharacterAgencyPlayerPlanStep[];
  recentDecision: CharacterAgencyPlayerDecision | null;
}

export const PRIMARY_GOAL_MINIMUM_TURNS = 4;
export const SECONDARY_GOAL_MINIMUM_TURNS = 2;
export const PRIMARY_REPLACEMENT_MARGIN = 15;
export const PRIMARY_REPLACEMENT_CONFIRMATIONS = 2;
export const MAX_SECONDARY_GOALS = 2;
export const MAX_PLAN_STEPS = 5;
export const MAX_RECENTLY_CLOSED_GOALS = 4;

interface ExperienceSummary {
  battleCount: number;
  appointmentCount: number;
  marriageCount: number;
  situationCount: number;
  practiceCount: number;
  atWar: boolean;
  maxGrievance: number;
  trustInRuler: number;
  factIds: readonly string[];
  battleFactIds: readonly string[];
  appointmentFactIds: readonly string[];
  marriageFactIds: readonly string[];
  situationFactIds: readonly string[];
}

interface GoalCandidate {
  signature: string;
  type: AgencyGoalType;
  label: string;
  target: AgencyEntityRef;
  priority: number;
  progress: number;
  sourceFactIds: readonly string[];
  rationale: string;
  barrier: string;
  identityAnchorTurn: number;
  context: AgencyGoalContext;
}

const ORIGIN_MODIFIERS: Readonly<Record<CharacterState['politicalClass'], Partial<Record<RootDesire, number>>>> = {
  '宗室': { power: 12, family: 10, loyalty: 6, safety: 2 },
  '官僚': { renown: 8, loyalty: 6, learning: 8, power: 3 },
  '士族': { family: 8, wealth: 4, learning: 12, renown: 3 },
  '地方豪强': { power: 5, family: 10, wealth: 8, safety: 4 },
  '军门': { power: 8, renown: 12, loyalty: 4, safety: -2 },
  '外戚': { power: 10, family: 12, safety: 6, loyalty: 2 },
};

const GOAL_LABELS: Readonly<Record<AgencyGoalType, string>> = {
  secure_independent_command: '争取独立统军',
  retain_command: '保住手中军令',
  gain_office: '谋求更高官职',
  win_renown: '建立功名',
  protect_family: '保全并扶持家族',
  accumulate_wealth: '扩充家业',
  preserve_safety: '远离迫近的危险',
  defend_ruler: '守护主君与正统',
  pursue_learning: '钻研并传播学问',
  settle_grievance: '追究旧怨',
};

const PLAN_LABELS: Readonly<Record<AgencyPlanAction, string>> = {
  earn_merit: '积累可查证的功绩',
  seek_patronage: '寻找愿意提携自己的上位者',
  build_military_support: '在军中建立支持',
  seek_family_backing: '争取家族背书',
  request_independent_command: '正式请求独立军令',
  retain_command: '巩固现有军令',
  request_office: '递交任职请求',
  govern_well: '以治理或军务证明能力',
  protect_household: '安排家人和家产的退路',
  grow_assets: '经营可持续的家业',
  reduce_exposure: '降低眼下风险',
  serve_ruler: '履行对主君的职责',
  study_practice: '学习并实际运用一门技艺',
  gather_evidence: '查明隐患，争取同道',
  seek_redress: '寻求申诉或追责',
};

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

function centered(value: number, scale: number): number {
  return (value - 50) * scale;
}

function uniqueStable(values: readonly string[], limit = values.length): readonly string[] {
  return [...new Set(values)].sort(stableCompare).slice(0, limit);
}

function factMentionsCharacter(fact: SimulationFact, characterId: string): boolean {
  if (fact.kind === 'battle') {
    const forces = [fact.payload.attacker, ...fact.payload.defenders];
    return forces.some((force) => force.commanderId === characterId
      || force.deputyCommanderId === characterId || force.allegianceCharacterId === characterId);
  }
  if (fact.kind === 'appointment_started' || fact.kind === 'appointment_ended') {
    return fact.payload.holderId === characterId;
  }
  if (fact.kind === 'character_death') return fact.payload.characterId === characterId;
  if (fact.kind === 'marriage') {
    return fact.payload.leftCharacterId === characterId || fact.payload.rightCharacterId === characterId;
  }
  return fact.actorIds.includes(characterId);
}

function summarizeExperience(world: WorldState, character: CharacterState): ExperienceSummary {
  const recentFacts: SimulationFact[] = [];
  const oldestTurn = Math.max(0, world.turn - 16);
  for (let index = world.facts.length - 1; index >= 0 && recentFacts.length < 12; index -= 1) {
    const fact = world.facts[index] as SimulationFact;
    if (fact.turn < oldestTurn) break;
    if (factMentionsCharacter(fact, character.id)) recentFacts.push(fact);
  }
  recentFacts.reverse();
  const rulerId = world.polities.find((polity) => polity.id === character.polityId)?.rulerId ?? '';
  const rulerRelation = world.relationships.find((relationship) => (
    relationship.sourceId === character.id && relationship.targetId === rulerId
  ));
  const outgoing = world.relationships.filter((relationship) => relationship.sourceId === character.id);
  return {
    battleCount: recentFacts.filter((fact) => fact.kind === 'battle').length,
    appointmentCount: recentFacts.filter((fact) => fact.kind === 'appointment_started' || fact.kind === 'appointment_ended').length,
    marriageCount: recentFacts.filter((fact) => fact.kind === 'marriage').length,
    situationCount: recentFacts.filter((fact) => fact.kind === 'situation_milestone').length,
    practiceCount: world.practiceStates.filter((state) => state.carrierCharacterIds.includes(character.id)).length,
    atWar: world.wars.some((war) => war.active && (war.attackerId === character.polityId || war.defenderId === character.polityId)),
    maxGrievance: outgoing.reduce((maximum, relationship) => Math.max(maximum, relationship.grievance), 0),
    trustInRuler: rulerRelation?.trust ?? Math.round(character.loyalty * 0.7),
    factIds: uniqueStable(recentFacts.map((fact) => fact.id), 12),
    battleFactIds: uniqueStable(recentFacts.filter((fact) => fact.kind === 'battle').map((fact) => fact.id), 6),
    appointmentFactIds: uniqueStable(recentFacts.filter((fact) => fact.kind === 'appointment_started' || fact.kind === 'appointment_ended').map((fact) => fact.id), 6),
    marriageFactIds: uniqueStable(recentFacts.filter((fact) => fact.kind === 'marriage').map((fact) => fact.id), 4),
    situationFactIds: uniqueStable(recentFacts.filter((fact) => fact.kind === 'situation_milestone').map((fact) => fact.id), 4),
  };
}

function personalityContribution(character: CharacterState, kind: RootDesire): number {
  if (kind === 'power') return centered(character.ambition, 0.42) + centered(character.cunning, 0.08);
  if (kind === 'renown') return centered(character.ambition, 0.18) + centered(Math.max(character.leadership, character.governance), 0.16);
  if (kind === 'family') return centered(character.loyalty, 0.12) + (character.spouseIds.length > 0 ? 3 : 0);
  if (kind === 'wealth') return centered(character.ambition, 0.08) + centered(character.cunning, 0.08);
  if (kind === 'safety') return centered(character.caution, 0.42) + centered(100 - character.health, 0.12);
  if (kind === 'loyalty') return centered(character.loyalty, 0.48) - centered(character.ambition, 0.08);
  if (kind === 'learning') return centered((character.governance + character.cunning) / 2, 0.28) + centered(character.caution, 0.06);
  return centered(character.cunning, 0.08) + centered(100 - character.loyalty, 0.08);
}

function familyContribution(family: FamilyState | undefined, kind: RootDesire): number {
  if (!family) return kind === 'family' ? -10 : 0;
  if (kind === 'power') return centered(family.traditions.political, 0.13) + centered(family.politicalInfluence, 0.06);
  if (kind === 'renown') return centered(family.traditions.military, 0.12) + centered(family.prestige, 0.05);
  if (kind === 'family') return Math.min(14, 3 + family.memberIds.length * 1.5 + family.marriageAllianceFamilyIds.length * 2);
  if (kind === 'wealth') return centered(family.traditions.commercial, 0.14) + centered(family.wealth, 0.05);
  if (kind === 'safety') return Math.min(8, family.memberIds.length * 0.8);
  if (kind === 'loyalty') return centered(family.traditions.political, 0.05);
  if (kind === 'learning') return centered(family.traditions.scholarly, 0.16);
  return 0;
}

function experienceContribution(
  character: CharacterState,
  experience: ExperienceSummary,
  kind: RootDesire,
): number {
  if (kind === 'power') return centered(character.influence, 0.1) + Math.min(8, experience.appointmentCount * 2);
  if (kind === 'renown') return centered(character.renown, 0.1) + Math.min(14, character.merit * 0.12 + character.deputyExperience * 0.16 + experience.battleCount * 3);
  if (kind === 'family') return Math.min(8, character.parentIds.length + character.spouseIds.length * 2 + experience.marriageCount * 2);
  if (kind === 'wealth') return centered(character.personalWealth, 0.12);
  if (kind === 'safety') return (experience.atWar ? 8 : 0) + (character.activeDiseaseId ? 12 : 0) + centered(100 - character.health, 0.18);
  if (kind === 'loyalty') return centered(experience.trustInRuler, 0.12) - Math.min(10, character.insubordination * 0.18);
  if (kind === 'learning') return Math.min(12, experience.practiceCount * 4 + experience.situationCount);
  return Math.min(24, experience.maxGrievance * 0.24);
}

function experienceSummary(kind: RootDesire, experience: ExperienceSummary): string {
  if (kind === 'renown') return `近四年参战${experience.battleCount}次，任免${experience.appointmentCount}次`;
  if (kind === 'revenge') return `当前最深怨隙为${Math.round(experience.maxGrievance)}`;
  if (kind === 'safety') return experience.atWar ? '所属政权正在交战' : '所属政权眼下无战事';
  if (kind === 'learning') return `正在承载${experience.practiceCount}项地方实践`;
  if (kind === 'family') return `近四年婚姻事实${experience.marriageCount}条`;
  return `近四年有${experience.factIds.length}条相关事实`;
}

function personalitySummary(kind: RootDesire): string {
  if (kind === 'power') return '性情偏向主动争取';
  if (kind === 'renown') return '看重才干被人承认';
  if (kind === 'family') return '重视亲近之人的归属';
  if (kind === 'wealth') return '习惯为自己积攒余地';
  if (kind === 'safety') return '行事谨慎，也看重退路';
  if (kind === 'loyalty') return '忠诚与责任感';
  if (kind === 'learning') return '善于思量，也肯下功夫';
  return '不轻易忘记受过的亏欠';
}

export function projectCharacterDesires(world: WorldState, characterId: string): CharacterDesireProjection {
  const character = world.characters.find((item) => item.id === characterId);
  if (!character) throw new Error(`Unknown character ${characterId}`);
  const family = world.families.find((item) => item.id === character.familyId);
  const experience = summarizeExperience(world, character);
  const axes = ROOT_DESIRES.map((kind) => {
    const origin = ORIGIN_MODIFIERS[character.politicalClass][kind] ?? 0;
    const personality = personalityContribution(character, kind);
    const familyValue = familyContribution(family, kind);
    const experienceValue = experienceContribution(character, experience, kind);
    const seeded = keyedInt(world.seed, -7, 7, 'agency', 'desire-v1', character.id, kind);
    const sources: DesireSource[] = [
      { kind: 'origin', contribution: Math.round(origin), summary: `${character.politicalClass}出身`, sourceFactIds: [] },
      { kind: 'personality', contribution: Math.round(personality), summary: personalitySummary(kind), sourceFactIds: [] },
      { kind: 'family', contribution: Math.round(familyValue), summary: family ? `${family.name}的传统与处境` : '没有可用家族支持', sourceFactIds: [] },
      { kind: 'experience', contribution: Math.round(experienceValue), summary: experienceSummary(kind, experience), sourceFactIds: experience.factIds },
      { kind: 'seed', contribution: seeded, summary: '成年前形成的个人倾向', sourceFactIds: [] },
    ];
    return {
      kind,
      label: ROOT_DESIRE_LABELS[kind],
      weight: clamp(50 + sources.reduce((sum, source) => sum + source.contribution, 0)),
      rank: 0,
      core: false,
      sources,
    } satisfies DesireAxisProjection;
  }).sort((left, right) => right.weight - left.weight || stableCompare(left.kind, right.kind));
  const ranked = axes.map((axis, index): DesireAxisProjection => ({ ...axis, rank: index + 1, core: index < 2 }));
  const pressures = ranked
    .map((axis): DesirePressureProjection => {
      const source = axis.sources.find((item) => item.kind === 'experience') as DesireSource;
      return {
        kind: axis.kind,
        label: axis.label,
        intensity: Math.max(0, source.contribution),
        summary: source.summary,
        sourceFactIds: source.sourceFactIds,
      };
    })
    .filter((pressure) => pressure.intensity >= 4)
    .sort((left, right) => right.intensity - left.intensity || stableCompare(left.kind, right.kind))
    .slice(0, 4);
  return {
    version: 1,
    authority: 'projection',
    characterId: character.id,
    projectedTurn: world.turn,
    axes: ranked,
    coreDesireKinds: ranked.slice(0, 2).map((axis) => axis.kind),
    pressures,
  };
}

function desireWeight(desire: CharacterDesireProjection, kind: RootDesire): number {
  return desire.axes.find((axis) => axis.kind === kind)?.weight ?? 0;
}

function activeOfficeRank(world: WorldState, characterId: string): number {
  return world.offices
    .filter((office) => office.active && office.holderId === characterId)
    .reduce((maximum, office) => Math.max(maximum, office.rank), 0);
}

function goalIdentityAnchorTurn(character: CharacterState): number {
  // C06/C07 has no ledger capable of distinguishing two separate incarnations
  // of the same wish. Anchor the read-only identity to adulthood so ordinary
  // reappointments never rename it; C09 may introduce incarnation IDs once it
  // can persist an explicit open/close boundary.
  return character.adultTurn ?? 0;
}

function strongestGrievance(world: WorldState, character: CharacterState): RelationshipState | null {
  return world.relationships
    .filter((relationship) => (
      relationship.sourceId === character.id
      && relationship.grievance >= 25
      && world.characters.some((target) => target.id === relationship.targetId && target.alive)
    ))
    .sort((left, right) => right.grievance - left.grievance || stableCompare(left.targetId, right.targetId))[0] ?? null;
}

function deputyUnit(world: WorldState, characterId: string): AgencyEntityRef | null {
  const army = world.armies.find((item) => item.deputyCommanderId === characterId);
  if (army) return { kind: 'army', id: army.id };
  const fleet = world.fleets.find((item) => item.deputyCommanderId === characterId);
  return fleet ? { kind: 'fleet', id: fleet.id } : null;
}

function commandedUnit(world: WorldState, character: CharacterState): AgencyEntityRef | null {
  if (character.commandingArmyId && world.armies.some((army) => army.id === character.commandingArmyId && army.commanderId === character.id)) {
    return { kind: 'army', id: character.commandingArmyId };
  }
  if (character.commandingFleetId && world.fleets.some((fleet) => fleet.id === character.commandingFleetId && fleet.commanderId === character.id)) {
    return { kind: 'fleet', id: character.commandingFleetId };
  }
  return null;
}

function goalSignature(type: AgencyGoalType, target: AgencyEntityRef): string {
  return `${type}:${target.kind}:${target.id}`;
}

function relevantFacts(type: AgencyGoalType, experience: ExperienceSummary): readonly string[] {
  if (type === 'secure_independent_command' || type === 'retain_command' || type === 'win_renown') {
    return uniqueStable([...experience.battleFactIds, ...experience.appointmentFactIds], 8);
  }
  if (type === 'gain_office') return experience.appointmentFactIds;
  if (type === 'protect_family') return experience.marriageFactIds;
  if (type === 'defend_ruler') return uniqueStable([...experience.appointmentFactIds, ...experience.situationFactIds], 8);
  return experience.factIds;
}

function buildGoalCandidates(
  world: WorldState,
  character: CharacterState,
  desire: CharacterDesireProjection,
): readonly GoalCandidate[] {
  if (!character.alive) return [];
  const family = world.families.find((item) => item.id === character.familyId);
  const polity = world.polities.find((item) => item.id === character.polityId);
  const ruler = world.characters.find((item) => item.id === polity?.rulerId && item.alive);
  const grievance = strongestGrievance(world, character);
  const deputy = deputyUnit(world, character.id);
  const command = commandedUnit(world, character);
  const experience = summarizeExperience(world, character);
  const baselineRank = activeOfficeRank(world, character.id);
  const context = (requiredOfficeKind: OfficeKind | null, baselineValue: number): AgencyGoalContext => ({
    originRole: character.role,
    baselineOfficeRank: baselineRank,
    requiredOfficeKind,
    baselineValue,
  });
  const candidates: GoalCandidate[] = [];
  const add = (
    type: AgencyGoalType,
    target: AgencyEntityRef,
    priority: number,
    progress: number,
    rationale: string,
    barrier: string,
    goalContext = context(null, 0),
  ): void => {
    candidates.push({
      signature: goalSignature(type, target),
      type,
      label: GOAL_LABELS[type],
      target,
      priority: clamp(priority),
      progress: clamp(progress),
      sourceFactIds: relevantFacts(type, experience),
      rationale,
      barrier,
      identityAnchorTurn: goalIdentityAnchorTurn(character),
      context: goalContext,
    });
  };

  if (deputy) {
    add(
      'secure_independent_command',
      deputy,
      desireWeight(desire, 'power') * 0.52 + desireWeight(desire, 'renown') * 0.34 + character.deputyExperience * 0.18,
      character.deputyExperience * 1.8 + character.merit * 0.35,
      '已有副将位置，权力与功名欲使独立军令成为可行方向',
      '尚未获得可以自行调度的军令',
      context(deputy.kind === 'army' ? '军团副将' : '水师副将', character.deputyExperience),
    );
  }
  if (command) {
    add(
      'retain_command',
      command,
      desireWeight(desire, 'power') * 0.42 + desireWeight(desire, 'safety') * 0.28 + desireWeight(desire, 'renown') * 0.2,
      character.influence * 0.45 + character.renown * 0.45,
      '现有军令既是权势来源，也是必须守住的安全基础',
      '军中支持与朝廷信任仍可能动摇',
      context(command.kind === 'army' ? '军团主帅' : '水师提督', character.influence),
    );
  }
  if (polity && character.role !== '君主') {
    add(
      'gain_office',
      { kind: 'polity', id: polity.id },
      desireWeight(desire, 'power') * 0.48 + desireWeight(desire, 'renown') * 0.3 + character.governance * 0.12,
      character.influence * 0.55 + character.merit * 0.35,
      '在现有政权内还有更高职权可以争取',
      '功绩、提携或政治支持尚不足',
      context(null, baselineRank),
    );
  }
  add(
    'win_renown',
    { kind: 'character', id: character.id },
    desireWeight(desire, 'renown') * 0.72 + Math.max(character.leadership, character.governance) * 0.16,
    character.renown,
    '能力与功名欲共同指向一项能被史册记录的成绩',
    '还缺少足以被广泛承认的成果',
    context(null, character.renown),
  );
  if (family?.active) {
    add(
      'protect_family',
      { kind: 'family', id: family.id },
      desireWeight(desire, 'family') * 0.68 + desireWeight(desire, 'safety') * 0.18,
      family.prestige * 0.45 + family.politicalInfluence * 0.25,
      '家族仍在世，个人选择会影响门第的延续',
      '家族声望、资产或政治席位仍有薄弱处',
      context(null, family.prestige),
    );
    add(
      'accumulate_wealth',
      { kind: 'family', id: family.id },
      desireWeight(desire, 'wealth') * 0.72 + desireWeight(desire, 'family') * 0.12,
      character.personalWealth * 0.55 + family.wealth * 0.25,
      '个人财富与家业可以共同积累',
      '眼下家业还不足以抵御长期风险',
      context(null, character.personalWealth),
    );
  }
  add(
    'preserve_safety',
    { kind: 'character', id: character.id },
    desireWeight(desire, 'safety') * 0.76 + (experience.atWar ? 12 : 0) + (character.activeDiseaseId ? 14 : 0),
    character.health * 0.65 - (experience.atWar ? 12 : 0),
    experience.atWar || character.activeDiseaseId ? '战争或疾病让自保成为眼前压力' : '谨慎性格使其为风险预留退路',
    experience.atWar || character.activeDiseaseId ? '迫近的战争或疾病尚未解除' : '仍缺少可靠的退路',
    context(null, character.health),
  );
  if (ruler && ruler.id !== character.id) {
    add(
      'defend_ruler',
      { kind: 'character', id: ruler.id },
      desireWeight(desire, 'loyalty') * 0.76 + character.loyalty * 0.14,
      character.loyalty * 0.6 + (polity?.authority ?? 0) * 0.25,
      '对现任主君与政权秩序仍有明确忠义投入',
      '主君的安全与政权秩序仍受外部压力影响',
      context(null, character.loyalty),
    );
  }
  add(
    'pursue_learning',
    { kind: 'region', id: character.locationRegionId },
    desireWeight(desire, 'learning') * 0.78 + character.governance * 0.1,
    experience.practiceCount * 20 + character.governance * 0.3,
    '学识倾向可以通过地方实践与治理经验落地',
    '还没有形成足够成熟、可传播的实践',
    context(null, experience.practiceCount),
  );
  if (grievance) {
    add(
      'settle_grievance',
      { kind: 'character', id: grievance.targetId },
      desireWeight(desire, 'revenge') * 0.76 + grievance.grievance * 0.22,
      character.influence * 0.3 + character.cunning * 0.25,
      `对目标的怨隙已达${Math.round(grievance.grievance)}`,
      '证据、支持或正当名分仍不足以追责',
      context(null, grievance.grievance),
    );
  }
  return candidates.sort((left, right) => right.priority - left.priority || stableCompare(left.signature, right.signature));
}

function createGoal(
  candidate: GoalCandidate,
  characterId: string,
  identityAnchorTurn: number,
  createdTurn: number,
  reviewedTurn: number,
  primary: boolean,
): AgencyGoalProjection {
  const id = `goal_${stableHash([characterId, candidate.signature, identityAnchorTurn]).slice(0, 12)}`;
  return {
    id,
    characterId,
    signature: candidate.signature,
    type: candidate.type,
    label: candidate.label,
    target: candidate.target,
    status: 'active',
    priority: candidate.priority,
    progress: candidate.progress,
    commitment: clamp(45 + candidate.priority * 0.48),
    createdTurn,
    minimumCommitUntilTurn: createdTurn + (primary ? PRIMARY_GOAL_MINIMUM_TURNS : SECONDARY_GOAL_MINIMUM_TURNS),
    lastReviewedTurn: reviewedTurn,
    resolvedTurn: null,
    closureReason: null,
    sourceFactIds: candidate.sourceFactIds,
    reason: candidate.rationale,
    barrier: candidate.barrier,
    rationale: candidate.rationale,
    context: candidate.context,
  };
}

function refreshGoal(goal: AgencyGoalProjection, candidate: GoalCandidate | undefined, turn: number): AgencyGoalProjection {
  if (!candidate) return { ...goal, lastReviewedTurn: turn };
  return {
    ...goal,
    priority: candidate.priority,
    progress: candidate.progress,
    commitment: clamp((goal.commitment * 3 + 45 + candidate.priority * 0.48) / 4),
    lastReviewedTurn: turn,
    sourceFactIds: candidate.sourceFactIds,
    reason: candidate.rationale,
    barrier: candidate.barrier,
    rationale: candidate.rationale,
  };
}

function targetExists(world: WorldState, target: AgencyEntityRef): AgencyGoalClosureReason | null {
  if (target.kind === 'character') {
    const character = world.characters.find((item) => item.id === target.id);
    if (!character) return 'target_missing';
    return character.alive ? null : 'target_dead';
  }
  if (target.kind === 'polity') {
    const polity = world.polities.find((item) => item.id === target.id);
    if (!polity) return 'target_missing';
    return polity.alive ? null : 'target_polity_extinct';
  }
  if (target.kind === 'family') {
    const family = world.families.find((item) => item.id === target.id);
    if (!family) return 'target_missing';
    return family.active ? null : 'target_family_extinct';
  }
  if (target.kind === 'region') return world.regions.some((item) => item.id === target.id) ? null : 'target_missing';
  if (target.kind === 'army') return world.armies.some((item) => item.id === target.id && item.soldiers > 0) ? null : 'target_missing';
  return world.fleets.some((item) => item.id === target.id && item.sailors > 0) ? null : 'target_missing';
}

export function evaluateGoalTerminalState(
  world: WorldState,
  goal: AgencyGoalProjection,
): { status: 'active' | 'achieved' | 'invalidated'; reason: AgencyGoalClosureReason | null } {
  const character = world.characters.find((item) => item.id === goal.characterId);
  if (!character?.alive) return { status: 'invalidated', reason: 'actor_dead' };
  return evaluateOwnedGoalTerminalState(world, character, goal);
}

function evaluateOwnedGoalTerminalState(
  world: WorldState,
  character: CharacterState,
  goal: AgencyGoalProjection,
): { status: 'active' | 'achieved' | 'invalidated'; reason: AgencyGoalClosureReason | null } {
  if (!character.alive) return { status: 'invalidated', reason: 'actor_dead' };
  const targetFailure = targetExists(world, goal.target);
  if (targetFailure) return { status: 'invalidated', reason: targetFailure };
  if (goal.type === 'secure_independent_command') {
    if (commandedUnit(world, character)) return { status: 'achieved', reason: 'independent_command_obtained' };
    if (goal.target.kind === 'army') {
      const army = world.armies.find((item) => item.id === goal.target.id);
      if (army?.deputyCommanderId !== character.id) return { status: 'invalidated', reason: 'lost_required_position' };
    } else if (goal.target.kind === 'fleet') {
      const fleet = world.fleets.find((item) => item.id === goal.target.id);
      if (fleet?.deputyCommanderId !== character.id) return { status: 'invalidated', reason: 'lost_required_position' };
    }
  }
  if (goal.type === 'retain_command') {
    const command = commandedUnit(world, character);
    if (!command || command.kind !== goal.target.kind || command.id !== goal.target.id) {
      return { status: 'invalidated', reason: 'lost_required_position' };
    }
  }
  if (goal.type === 'defend_ruler') {
    const polity = world.polities.find((item) => item.id === character.polityId);
    if (polity?.rulerId !== goal.target.id) return { status: 'invalidated', reason: 'target_role_changed' };
  }
  return { status: 'active', reason: null };
}

function closeGoal(
  goal: AgencyGoalProjection,
  turn: number,
  status: Exclude<AgencyGoalStatus, 'active'>,
  reason: AgencyGoalClosureReason,
): AgencyGoalProjection {
  return { ...goal, status, resolvedTurn: turn, lastReviewedTurn: turn, closureReason: reason };
}

function stepActions(type: AgencyGoalType): readonly AgencyPlanAction[] {
  if (type === 'secure_independent_command') return ['earn_merit', 'seek_patronage', 'build_military_support', 'seek_family_backing', 'request_independent_command'];
  if (type === 'retain_command') return ['build_military_support', 'seek_family_backing', 'retain_command'];
  if (type === 'gain_office') return ['govern_well', 'seek_patronage', 'seek_family_backing', 'request_office'];
  if (type === 'win_renown') return ['govern_well', 'earn_merit'];
  if (type === 'protect_family') return ['protect_household', 'seek_family_backing'];
  if (type === 'accumulate_wealth') return ['grow_assets', 'protect_household'];
  if (type === 'preserve_safety') return ['reduce_exposure', 'protect_household'];
  if (type === 'defend_ruler') return ['serve_ruler', 'gather_evidence'];
  if (type === 'pursue_learning') return ['study_practice', 'govern_well'];
  return ['gather_evidence', 'seek_patronage', 'seek_redress'];
}

function actionCompleted(
  world: WorldState,
  character: CharacterState,
  goal: AgencyGoalProjection,
  action: AgencyPlanAction,
): boolean {
  const family = world.families.find((item) => item.id === character.familyId);
  if (action === 'earn_merit') return character.deputyExperience >= 12 || character.merit >= 35;
  if (action === 'seek_patronage') {
    return world.relationships.some((relationship) => (
      relationship.sourceId === character.id && (relationship.trust >= 64 || relationship.gratitude >= 45)
    ));
  }
  if (action === 'build_military_support') return character.influence >= 52 && character.renown >= 28;
  if (action === 'seek_family_backing') return Boolean(family && family.active && (family.prestige >= 52 || family.politicalInfluence >= 48));
  if (action === 'retain_command') return goal.type === 'retain_command' && Boolean(commandedUnit(world, character));
  if (action === 'govern_well') return character.merit >= 42 || character.governance >= 78;
  if (action === 'protect_household') return Boolean(family?.active && family.wealth >= 45);
  if (action === 'grow_assets') return character.personalWealth >= goal.context.baselineValue + 15;
  if (action === 'reduce_exposure') return character.health >= 75 && !character.activeDiseaseId;
  if (action === 'serve_ruler') return character.loyalty >= 75 && character.insubordination < 20;
  if (action === 'study_practice') return world.practiceStates.some((state) => state.carrierCharacterIds.includes(character.id));
  if (action === 'gather_evidence') return strongestGrievance(world, character)?.grievance !== undefined;
  return false;
}

function projectPlan(world: WorldState, character: CharacterState, goal: AgencyGoalProjection): AgencyPlanProjection {
  const planId = `plan_${stableHash([goal.id, 'template-v1']).slice(0, 12)}`;
  let openStepFound = false;
  const invalid = goal.status !== 'active';
  const steps = stepActions(goal.type).slice(0, MAX_PLAN_STEPS).map((action, index): AgencyPlanStepProjection => {
    const completed = !invalid && actionCompleted(world, character, goal, action);
    let status: AgencyPlanStepStatus;
    if (invalid) status = 'invalidated';
    else if (completed) status = 'completed';
    else if (!openStepFound) {
      status = 'available';
      openStepFound = true;
    } else status = 'blocked';
    return {
      id: `${planId}:step:${action}`,
      order: index + 1,
      action,
      label: PLAN_LABELS[action],
      status,
      reason: status === 'completed'
        ? '这一步所需的条件已经具备'
        : status === 'available'
          ? '这是眼下最先要做的准备'
          : status === 'blocked'
            ? '要等前面的准备完成'
            : '原来的打算已经结束',
      sourceFactIds: goal.sourceFactIds,
    };
  });
  const currentStep = steps.find((step) => step.status === 'available');
  return {
    id: planId,
    templateVersion: 1,
    goalId: goal.id,
    characterId: character.id,
    createdTurn: goal.createdTurn,
    status: invalid ? 'invalidated' : 'active',
    currentStepIndex: currentStep ? currentStep.order - 1 : null,
    steps,
  };
}

function boundedClosed(goals: readonly AgencyGoalProjection[]): readonly AgencyGoalProjection[] {
  return [...goals]
    .sort((left, right) => (right.resolvedTurn ?? -1) - (left.resolvedTurn ?? -1) || stableCompare(left.id, right.id))
    .slice(0, MAX_RECENTLY_CLOSED_GOALS);
}

function initializeProjection(
  world: WorldState,
  character: CharacterState,
  desire: CharacterDesireProjection,
): CharacterAgencyShadowProjection {
  const availability = !character.alive
    ? 'closed'
    : character.age < 16 || character.lifeStage === '幼年' || character.lifeStage === '成长'
      ? 'dormant'
      : 'active';
  const candidates = availability === 'active' ? buildGoalCandidates(world, character, desire) : [];
  const primaryGoal = candidates[0]
    ? createGoal(candidates[0], character.id, candidates[0].identityAnchorTurn, world.turn, world.turn, true)
    : null;
  const secondaryGoals = candidates.slice(1, 1 + MAX_SECONDARY_GOALS)
    .map((candidate) => createGoal(candidate, character.id, candidate.identityAnchorTurn, world.turn, world.turn, false));
  const activeGoals = primaryGoal ? [primaryGoal, ...secondaryGoals] : secondaryGoals;
  return {
    version: 1,
    authority: 'projection',
    seed: world.seed,
    characterId: character.id,
    sourceWorldHash: world.hash,
    reviewedTurn: world.turn,
    availability,
    reason: availability === 'closed'
      ? '人物已经去世，不再形成新的目标'
      : availability === 'dormant'
        ? '尚未成年，欲望已可观察，但目标与计划暂不启动'
        : '根据出身、性情、家族与经历形成的只读判断',
    barrier: availability === 'active' ? primaryGoal?.barrier ?? null : availability === 'dormant' ? '等待成年' : '人物已故',
    desire,
    longTermDirection: desire.coreDesireKinds[0] ?? 'safety',
    primaryGoal,
    secondaryGoals,
    plans: activeGoals.map((goal) => projectPlan(world, character, goal)),
    recentlyClosedGoals: [],
    pendingPrimaryChallenge: null,
  };
}

function retainCoreDesires(
  next: CharacterDesireProjection,
  previous: CharacterDesireProjection,
): CharacterDesireProjection {
  const retained = previous.coreDesireKinds.filter((kind): kind is RootDesire => ROOT_DESIRES.includes(kind));
  if (retained.length !== 2) return next;
  const coreSet = new Set(retained);
  const byKind = new Map(next.axes.map((axis) => [axis.kind, axis]));
  const axes = [
    ...retained.map((kind) => byKind.get(kind)).filter((axis): axis is DesireAxisProjection => Boolean(axis)),
    ...next.axes.filter((axis) => !coreSet.has(axis.kind)),
  ].map((axis, index): DesireAxisProjection => ({
    ...axis,
    rank: index + 1,
    core: coreSet.has(axis.kind),
  }));
  return { ...next, axes, coreDesireKinds: retained };
}

export function projectCharacterAgency(
  world: WorldState,
  characterId: string,
  previous?: CharacterAgencyShadowProjection | null,
): CharacterAgencyShadowProjection {
  const character = world.characters.find((item) => item.id === characterId);
  if (!character) throw new Error(`Unknown character ${characterId}`);
  if (
    !previous
    || previous.version !== 1
    || previous.authority !== 'projection'
    || previous.seed !== world.seed
    || previous.characterId !== characterId
    || previous.reviewedTurn > world.turn
  ) {
    return initializeProjection(world, character, projectCharacterDesires(world, characterId));
  }
  if (previous.reviewedTurn === world.turn && previous.sourceWorldHash === world.hash) return previous;

  const desire = retainCoreDesires(projectCharacterDesires(world, characterId), previous.desire);
  if (!character.alive) {
    const activeGoals = [
      ...(previous.primaryGoal ? [previous.primaryGoal] : []),
      ...previous.secondaryGoals,
    ];
    const closed = activeGoals.map((goal) => closeGoal(goal, world.turn, 'invalidated', 'actor_dead'));
    return {
      version: 1,
      authority: 'projection',
      seed: world.seed,
      characterId,
      sourceWorldHash: world.hash,
      reviewedTurn: world.turn,
      availability: 'closed',
      reason: '人物已经去世，原有目标依硬失效规则终止',
      barrier: '人物已故',
      desire,
      longTermDirection: previous.longTermDirection,
      primaryGoal: null,
      secondaryGoals: [],
      plans: closed.map((goal) => projectPlan(world, character, goal)),
      recentlyClosedGoals: boundedClosed([...closed, ...previous.recentlyClosedGoals]),
      pendingPrimaryChallenge: null,
    };
  }
  if (character.age < 16 || character.lifeStage === '幼年' || character.lifeStage === '成长') {
    const dormant = initializeProjection(world, character, desire);
    return { ...dormant, recentlyClosedGoals: previous.recentlyClosedGoals };
  }
  const candidates = buildGoalCandidates(world, character, desire);
  const candidateBySignature = new Map(candidates.map((candidate) => [candidate.signature, candidate]));
  const newlyClosed: AgencyGoalProjection[] = [];
  let primary = previous.primaryGoal ? refreshGoal(
    previous.primaryGoal,
    candidateBySignature.get(previous.primaryGoal.signature),
    world.turn,
  ) : null;
  let pending = previous.pendingPrimaryChallenge;

  if (primary) {
    const terminal = evaluateOwnedGoalTerminalState(world, character, primary);
    if (terminal.status !== 'active' && terminal.reason) {
      primary = closeGoal(primary, world.turn, terminal.status, terminal.reason);
      newlyClosed.push(primary);
      primary = null;
      pending = null;
    }
  }

  if (!primary && character.alive && candidates[0]) {
    const promoted = previous.secondaryGoals.find((goal) => goal.signature === candidates[0]?.signature);
    primary = promoted
      ? {
          ...refreshGoal(promoted, candidates[0], world.turn),
          minimumCommitUntilTurn: world.turn + PRIMARY_GOAL_MINIMUM_TURNS,
        }
      : createGoal(candidates[0], character.id, candidates[0].identityAnchorTurn, world.turn, world.turn, true);
  } else if (primary && world.turn >= primary.minimumCommitUntilTurn) {
    const challenger = candidates.find((candidate) => candidate.signature !== primary?.signature);
    if (challenger && challenger.priority >= primary.priority + PRIMARY_REPLACEMENT_MARGIN) {
      pending = pending?.goalSignature === challenger.signature && pending.lastSeenTurn === world.turn - 1
        ? { ...pending, lastSeenTurn: world.turn, consecutiveReviews: pending.consecutiveReviews + 1 }
        : { goalSignature: challenger.signature, firstSeenTurn: world.turn, lastSeenTurn: world.turn, consecutiveReviews: 1 };
      if (pending.consecutiveReviews >= PRIMARY_REPLACEMENT_CONFIRMATIONS) {
        newlyClosed.push(closeGoal(primary, world.turn, 'abandoned', 'superseded_after_inertia'));
        const promoted = previous.secondaryGoals.find((goal) => goal.signature === challenger.signature);
        primary = promoted
          ? {
              ...refreshGoal(promoted, challenger, world.turn),
              minimumCommitUntilTurn: world.turn + PRIMARY_GOAL_MINIMUM_TURNS,
            }
          : createGoal(challenger, character.id, challenger.identityAnchorTurn, world.turn, world.turn, true);
        pending = null;
      }
    } else {
      pending = null;
    }
  } else {
    pending = null;
  }

  const previousSecondary = previous.secondaryGoals.map((goal) => refreshGoal(
    goal,
    candidateBySignature.get(goal.signature),
    world.turn,
  ));
  const retainedSecondary: AgencyGoalProjection[] = [];
  const retainedIds = new Set(primary ? [primary.id] : []);
  const retainedSignatures = new Set(primary ? [primary.signature] : []);
  for (const goal of previousSecondary) {
    if (retainedIds.has(goal.id) || retainedSignatures.has(goal.signature)) continue;
    const terminal = evaluateOwnedGoalTerminalState(world, character, goal);
    if (terminal.status !== 'active' && terminal.reason) {
      newlyClosed.push(closeGoal(goal, world.turn, terminal.status, terminal.reason));
      continue;
    }
    if (world.turn < goal.minimumCommitUntilTurn || candidateBySignature.has(goal.signature)) {
      retainedSecondary.push(goal);
      retainedIds.add(goal.id);
      retainedSignatures.add(goal.signature);
    } else {
      newlyClosed.push(closeGoal(goal, world.turn, 'abandoned', 'superseded_after_inertia'));
    }
  }
  const occupied = new Set([
    ...retainedSignatures,
  ]);
  for (const candidate of candidates) {
    if (retainedSecondary.length >= MAX_SECONDARY_GOALS) break;
    if (occupied.has(candidate.signature)) continue;
    const created = createGoal(candidate, character.id, candidate.identityAnchorTurn, world.turn, world.turn, false);
    if (retainedIds.has(created.id)) continue;
    retainedSecondary.push(created);
    retainedIds.add(created.id);
    occupied.add(candidate.signature);
  }
  const secondaryGoals = retainedSecondary.slice(0, MAX_SECONDARY_GOALS);
  const activeGoals = primary ? [primary, ...secondaryGoals] : secondaryGoals;
  return {
    version: 1,
    authority: 'projection',
    seed: world.seed,
    characterId: character.id,
    sourceWorldHash: world.hash,
    reviewedTurn: world.turn,
    availability: 'active',
    reason: '根据出身、性情、家族与经历形成的只读判断',
    barrier: primary?.barrier ?? null,
    desire,
    longTermDirection: previous.longTermDirection,
    primaryGoal: primary,
    secondaryGoals,
    plans: activeGoals.map((goal) => projectPlan(world, character, goal)),
    recentlyClosedGoals: boundedClosed([...newlyClosed, ...previous.recentlyClosedGoals]),
    pendingPrimaryChallenge: pending,
  };
}

/**
 * The default player surface intentionally removes seed/hash, authority tags,
 * raw target IDs, source classifications, plan action codes and goal context.
 * Audit UI may read the full projection only after an explicit disclosure.
 */
export function toCharacterAgencyPlayerProjection(
  agency: CharacterAgencyShadowProjection,
): CharacterAgencyPlayerProjection {
  const playerGoal = (goal: AgencyGoalProjection): CharacterAgencyPlayerGoal => ({
    id: goal.id,
    label: goal.label,
    status: goal.status,
    priority: goal.priority,
    progress: goal.progress,
    commitment: goal.commitment,
    reason: goal.reason,
    barrier: goal.barrier,
  });
  const primaryPlan = agency.primaryGoal
    ? agency.plans.find((plan) => plan.goalId === agency.primaryGoal?.id)
    : null;
  const closureReason = (reason: AgencyGoalClosureReason | null): string => {
    if (reason === 'actor_dead') return '人物去世，原先打算就此终止';
    if (reason === 'target_missing') return '所指对象已经不复存在';
    if (reason === 'target_dead') return '所指人物已经去世';
    if (reason === 'target_polity_extinct') return '所指政权已经灭亡';
    if (reason === 'target_family_extinct') return '所指家族已经断绝';
    if (reason === 'target_role_changed') return '原先依赖的身份与局面已经改变';
    if (reason === 'lost_required_position') return '失去了继续推进此事所需的职位';
    if (reason === 'independent_command_obtained') return '已经获得独立统军权';
    if (reason === 'superseded_after_inertia') return '另一件事持续两季更为迫切，因此暂时搁下';
    return '这件事已经结束';
  };
  const recentClosed = agency.recentlyClosedGoals[0];
  return {
    availability: agency.availability,
    reason: agency.availability === 'active'
      ? '从出身、性情、家族与经历中，可以看出此人眼下正有自己的盘算'
      : agency.reason,
    barrier: agency.barrier,
    longTermDirectionLabel: ROOT_DESIRE_LABELS[agency.longTermDirection],
    desires: agency.desire.axes
      .filter((axis) => axis.core)
      .slice(0, 2)
      .map((axis) => {
        const readableSources = axis.sources
          .filter((source) => source.kind !== 'seed' && source.contribution > 0)
          .sort((left, right) => right.contribution - left.contribution)
          .slice(0, 2)
          .map((source) => source.summary);
        return {
          label: axis.label,
          weight: axis.weight,
          core: axis.core,
          reason: readableSources.length > 0
            ? readableSources.length === 1
              ? `源于${readableSources[0]}`
              : `源于${readableSources[0]}，也受到${readableSources[1]}影响`
            : '眼下没有特别强烈的外部推力',
        };
      }),
    primaryGoal: agency.primaryGoal ? playerGoal(agency.primaryGoal) : null,
    secondaryGoals: agency.secondaryGoals.map(playerGoal),
    currentPlanSteps: primaryPlan?.steps.map((step) => ({
      label: step.label,
      status: step.status,
      reason: step.reason,
    })) ?? [],
    recentDecision: recentClosed && recentClosed.status !== 'active'
      ? {
          label: recentClosed.label,
          status: recentClosed.status,
          reason: closureReason(recentClosed.closureReason),
        }
      : null,
  };
}
