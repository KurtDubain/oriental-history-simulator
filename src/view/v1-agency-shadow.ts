import {
  MAX_PLAN_STEPS,
  MAX_RECENTLY_CLOSED_GOALS,
  MAX_SECONDARY_GOALS,
  ROOT_DESIRES,
  projectCharacterAgency,
  type AgencyGoalProjection,
  type AgencyPlanAction,
  type AgencyPlanProjection,
  type CharacterAgencyShadowProjection,
  type CharacterDesireProjection,
} from '../sim/agency';
import { stableCompare, stableHash } from '../sim/random';
import type { SimulationFact, WorldState } from '../sim/types';

/** Local observation metadata only. This key is deliberately unrelated to a world save key. */
export const AGENCY_SHADOW_STORAGE_KEY = 'canghai-agency-shadow-ledger-v1';
export const AGENCY_SHADOW_LEDGER_VERSION = 1 as const;
export const MAX_AGENCY_SHADOW_BRANCHES = 8;
export const MAX_AGENCY_SHADOW_RESTORE_POINTS = 25;
export const MAX_AGENCY_SHADOW_RESTORE_CHARACTERS = 4;
export const MAX_AGENCY_SHADOW_CHARACTERS = 16;
export const MAX_AGENCY_SHADOW_COMPARISONS = 64;
export const MAX_AGENCY_SHADOW_LINEAGE_LINKS = 16;
export const MAX_AGENCY_SHADOW_SOURCE_FACTS = 8;
export const MAX_AGENCY_SHADOW_SOURCE_EVENTS = 4;
export const MAX_AGENCY_SHADOW_LEGACY_PROMOTIONS = 16;
export const MAX_AGENCY_SHADOW_SERIALIZED_CHARS = 2_000_000;

const MAX_IDENTIFIER_LENGTH = 220;
const MAX_RESTORE_TOKEN_LENGTH = 128;
const MAX_PROJECTION_SERIALIZED_CHARS = 96_000;
// C06 projections intentionally retain up to twelve recent typed Facts.
const MAX_PROJECTION_SOURCE_FACTS = 12;

export type AgencyShadowOpenMode = 'create' | 'import' | 'restore';
export type AgencyShadowBranchOrigin = AgencyShadowOpenMode | 'intervention';
export type AgencyShadowComparisonStatus =
  | 'exact'
  | 'goal-aligned'
  | 'shadow-only'
  | 'legacy-only'
  | 'target-conflict';

export interface AgencyShadowWorldAnchor {
  schemaVersion: 4;
  seed: string;
  turn: number;
  hash: string;
}

export interface AgencyShadowLineageLink {
  kind: 'advance' | 'intervention';
  from: AgencyShadowWorldAnchor;
  to: AgencyShadowWorldAnchor;
}

export interface AgencyShadowIntentSuggestion {
  id: string;
  turn: number;
  sourceWorldHash: string;
  actorId: string;
  actorLabel: string;
  goalId: string;
  goalSignature: string;
  goalType: AgencyGoalProjection['type'];
  planId: string;
  stepId: string;
  action: AgencyPlanAction;
  stepLabel: string;
  targetKind: AgencyGoalProjection['target']['kind'];
  targetId: string;
  targetLabel: string;
  readiness: 'preparation' | 'actionable';
  sourceFactIds: readonly string[];
}

export interface AgencyShadowLegacyPromotion {
  turn: number;
  eventId: string;
  appointmentFactId: string;
  actorId: string;
  actorLabel: string;
  formerCommanderId: string;
  formerCommanderLabel: string;
  armyId: string;
  armyLabel: string;
}

export interface AgencyShadowComparison {
  id: string;
  recordedOrdinal: number;
  turn: number;
  beforeWorldHash: string;
  afterWorldHash: string;
  actorId: string;
  actorLabel: string;
  targetId: string;
  targetLabel: string;
  status: AgencyShadowComparisonStatus;
  suggestion: AgencyShadowIntentSuggestion | null;
  legacy: AgencyShadowLegacyPromotion | null;
  sourceFactIds: readonly string[];
  sourceEventIds: readonly string[];
}

export interface AgencyShadowBranchParent {
  branchId: string;
  turn: number;
  hash: string;
}

export interface AgencyShadowBranch {
  id: string;
  origin: AgencyShadowBranchOrigin;
  anchor: AgencyShadowWorldAnchor;
  head: AgencyShadowWorldAnchor;
  parent: AgencyShadowBranchParent | null;
  createdOrdinal: number;
  lastTouchedOrdinal: number;
  lineage: AgencyShadowLineageLink[];
  projections: CharacterAgencyShadowProjection[];
  comparisons: AgencyShadowComparison[];
}

export interface AgencyShadowRestorePoint {
  token: string;
  anchor: AgencyShadowWorldAnchor;
  boundOrdinal: number;
  projections: CharacterAgencyShadowProjection[];
}

export interface AgencyShadowOverflow {
  discardedBranches: number;
  discardedRestorePoints: number;
  discardedComparisons: number;
  digest: string;
}

/**
 * Non-authoritative browser metadata. It must never be attached to WorldState,
 * fed to a resolver, or included in computeWorldHash.
 */
export interface AgencyShadowLedger {
  version: 1;
  authority: 'observer-shadow';
  nextOrdinal: number;
  branches: AgencyShadowBranch[];
  restorePoints: AgencyShadowRestorePoint[];
  overflow: AgencyShadowOverflow;
}

export interface AgencyShadowAttachResult {
  ledger: AgencyShadowLedger;
  branchId: string;
  restored: boolean;
}

export interface AgencyShadowPreparedTurn {
  version: 1;
  authority: 'observer-shadow-preparation';
  branchId: string;
  before: AgencyShadowWorldAnchor;
  projections: CharacterAgencyShadowProjection[];
  suggestions: AgencyShadowIntentSuggestion[];
}

export interface AgencyShadowAdvanceResult {
  ledger: AgencyShadowLedger;
  branchId: string;
  comparisons: AgencyShadowComparison[];
}

export interface AgencyShadowPlayerEntry {
  id: string;
  turn: number;
  actorId: string;
  sourceEventId: string | null;
  conclusion: '相合' | '步调不同' | '仅见盘算' | '仅见旧制' | '所求不同';
  title: string;
  summary: string;
  intended: string | null;
  actual: string | null;
  reason: string;
  evidence: readonly string[];
}

const EMPTY_OVERFLOW: AgencyShadowOverflow = {
  discardedBranches: 0,
  discardedRestorePoints: 0,
  discardedComparisons: 0,
  digest: stableHash([]),
};

const GOAL_TYPES: readonly AgencyGoalProjection['type'][] = [
  'secure_independent_command',
  'retain_command',
  'gain_office',
  'win_renown',
  'protect_family',
  'accumulate_wealth',
  'preserve_safety',
  'defend_ruler',
  'pursue_learning',
  'settle_grievance',
];

const PLAN_ACTIONS: readonly AgencyPlanAction[] = [
  'earn_merit',
  'seek_patronage',
  'build_military_support',
  'seek_family_backing',
  'request_independent_command',
  'retain_command',
  'request_office',
  'govern_well',
  'protect_household',
  'grow_assets',
  'reduce_exposure',
  'serve_ruler',
  'study_practice',
  'gather_evidence',
  'seek_redress',
];

const ENTITY_KINDS: readonly AgencyGoalProjection['target']['kind'][] = [
  'character',
  'polity',
  'family',
  'region',
  'army',
  'fleet',
];

const COMPARISON_STATUSES: readonly AgencyShadowComparisonStatus[] = [
  'exact',
  'goal-aligned',
  'shadow-only',
  'legacy-only',
  'target-conflict',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maximum = MAX_IDENTIFIER_LENGTH): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maximum) : null;
}

function safeInteger(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number | null {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= minimum
    && value <= maximum
    ? value
    : null;
}

function safeFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function uniqueStrings(values: readonly string[], maximum: number): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = boundedString(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= maximum) break;
  }
  return result;
}

function anchorOf(world: WorldState): AgencyShadowWorldAnchor {
  if (world.schemaVersion !== 4) throw new Error('Agency shadow 只接受 schema 4 世界');
  const seed = boundedString(world.seed);
  const hash = boundedString(world.hash);
  if (!seed || !hash || !Number.isSafeInteger(world.turn) || world.turn < 0) {
    throw new Error('Agency shadow 收到无效的世界锚点');
  }
  return { schemaVersion: 4, seed, turn: world.turn, hash };
}

function parseAnchor(value: unknown): AgencyShadowWorldAnchor | null {
  if (!isRecord(value) || value.schemaVersion !== 4) return null;
  const seed = boundedString(value.seed);
  const hash = boundedString(value.hash);
  const turn = safeInteger(value.turn);
  return seed && hash && turn !== null ? { schemaVersion: 4, seed, turn, hash } : null;
}

function sameAnchor(left: AgencyShadowWorldAnchor, right: AgencyShadowWorldAnchor): boolean {
  return left.schemaVersion === right.schemaVersion
    && left.seed === right.seed
    && left.turn === right.turn
    && left.hash === right.hash;
}

function assertAnchor(label: string, expected: AgencyShadowWorldAnchor, world: WorldState): void {
  if (!sameAnchor(expected, anchorOf(world))) {
    throw new Error(`${label}与 Agency shadow 分支的 seed/turn/hash 不一致`);
  }
}

function assertAdjacent(before: WorldState, after: WorldState): void {
  if (after.seed !== before.seed) throw new Error('Agency shadow 不允许跨 seed 推进');
  if (after.turn !== before.turn + 1) throw new Error('Agency shadow 只接受普通相邻回合推进');
  if (after.hash === before.hash) throw new Error('Agency shadow 相邻回合必须有不同的世界 hash');
  if (!after.lastTurn || after.lastTurn.turn !== before.turn) {
    throw new Error('Agency shadow 无法核验缺少精确结算季的 lastTurn');
  }
}

function targetLabel(world: WorldState, kind: AgencyGoalProjection['target']['kind'], id: string): string {
  if (kind === 'character') return world.characters.find((item) => item.id === id)?.name ?? '未知人物';
  if (kind === 'polity') return world.polities.find((item) => item.id === id)?.name ?? '未知政权';
  if (kind === 'family') return world.families.find((item) => item.id === id)?.name ?? '未知家族';
  if (kind === 'region') return world.regions.find((item) => item.id === id)?.name ?? '未知地区';
  if (kind === 'army') return world.armies.find((item) => item.id === id)?.name ?? '未知军团';
  return world.fleets.find((item) => item.id === id)?.name ?? '未知水师';
}

function projectionMatchesAnchor(
  projection: CharacterAgencyShadowProjection,
  anchor: AgencyShadowWorldAnchor,
): boolean {
  return projection.version === 1
    && projection.authority === 'projection'
    && projection.seed === anchor.seed
    && projection.reviewedTurn === anchor.turn
    && projection.sourceWorldHash === anchor.hash;
}

function projectionFor(
  world: WorldState,
  characterId: string,
  previous: CharacterAgencyShadowProjection | undefined,
): CharacterAgencyShadowProjection {
  const current = anchorOf(world);
  return projectCharacterAgency(
    world,
    characterId,
    previous && projectionMatchesAnchor(previous, current) ? previous : undefined,
  );
}

function suggestionFor(
  world: WorldState,
  projection: CharacterAgencyShadowProjection,
): AgencyShadowIntentSuggestion | null {
  const goal = projection.primaryGoal;
  if (!goal || goal.status !== 'active') return null;
  const plan = projection.plans.find((item) => item.goalId === goal.id && item.status === 'active');
  const step = plan?.steps.find((item) => item.status === 'available');
  const actor = world.characters.find((item) => item.id === projection.characterId);
  if (!plan || !step || !actor) return null;
  const readiness = step.action === 'request_independent_command' ? 'actionable' : 'preparation';
  return {
    id: `shadow-intent_${stableHash([world.seed, world.turn, world.hash, actor.id, goal.id, step.id]).slice(0, 16)}`,
    turn: world.turn,
    sourceWorldHash: world.hash,
    actorId: actor.id,
    actorLabel: actor.name,
    goalId: goal.id,
    goalSignature: goal.signature,
    goalType: goal.type,
    planId: plan.id,
    stepId: step.id,
    action: step.action,
    stepLabel: step.label,
    targetKind: goal.target.kind,
    targetId: goal.target.id,
    targetLabel: targetLabel(world, goal.target.kind, goal.target.id),
    readiness,
    sourceFactIds: uniqueStrings([...goal.sourceFactIds, ...step.sourceFactIds], MAX_AGENCY_SHADOW_SOURCE_FACTS),
  };
}

function chooseCharacterIds(
  requested: readonly string[],
  existing: readonly CharacterAgencyShadowProjection[],
  maximum = MAX_AGENCY_SHADOW_CHARACTERS,
): string[] {
  return uniqueStrings([
    ...requested,
    ...existing.map((projection) => projection.characterId),
  ], maximum);
}

function branchById(ledger: AgencyShadowLedger, branchId: string): AgencyShadowBranch {
  const branch = ledger.branches.find((item) => item.id === branchId);
  if (!branch) throw new Error(`Unknown Agency shadow branch ${branchId}`);
  return branch;
}

function nextOrdinal(value: number): number {
  return value >= Number.MAX_SAFE_INTEGER ? 1 : value + 1;
}

function overflowWith(
  overflow: AgencyShadowOverflow,
  kind: 'branch' | 'restore' | 'comparison',
  payload: unknown,
  count = 1,
): AgencyShadowOverflow {
  return {
    discardedBranches: overflow.discardedBranches + (kind === 'branch' ? count : 0),
    discardedRestorePoints: overflow.discardedRestorePoints + (kind === 'restore' ? count : 0),
    discardedComparisons: overflow.discardedComparisons + (kind === 'comparison' ? count : 0),
    digest: stableHash([overflow.digest, kind, payload]),
  };
}

function boundLedger(ledger: AgencyShadowLedger, preserveBranchId?: string): AgencyShadowLedger {
  let overflow = { ...ledger.overflow };
  let branches = [...ledger.branches];
  if (branches.length > MAX_AGENCY_SHADOW_BRANCHES) {
    const candidates = [...branches]
      .filter((branch) => branch.id !== preserveBranchId)
      .sort((left, right) => left.lastTouchedOrdinal - right.lastTouchedOrdinal || stableCompare(left.id, right.id));
    while (branches.length > MAX_AGENCY_SHADOW_BRANCHES) {
      const discarded = candidates.shift()
        ?? [...branches].sort((left, right) => left.lastTouchedOrdinal - right.lastTouchedOrdinal || stableCompare(left.id, right.id))[0];
      branches = branches.filter((branch) => branch.id !== discarded.id);
      overflow = overflowWith(overflow, 'branch', {
        id: discarded.id,
        head: discarded.head,
        comparisonIds: discarded.comparisons.map((comparison) => comparison.id),
      });
      if (discarded.comparisons.length) {
        overflow = overflowWith(
          overflow,
          'comparison',
          discarded.comparisons.map((comparison) => comparison.id),
          discarded.comparisons.length,
        );
      }
    }
  }

  let restorePoints = [...ledger.restorePoints]
    .sort((left, right) => right.boundOrdinal - left.boundOrdinal || stableCompare(left.token, right.token));
  if (restorePoints.length > MAX_AGENCY_SHADOW_RESTORE_POINTS) {
    const discarded = restorePoints.slice(MAX_AGENCY_SHADOW_RESTORE_POINTS);
    restorePoints = restorePoints.slice(0, MAX_AGENCY_SHADOW_RESTORE_POINTS);
    for (const point of discarded) overflow = overflowWith(overflow, 'restore', { token: point.token, anchor: point.anchor });
  }

  const rankedComparisons = branches
    .flatMap((branch) => branch.comparisons.map((comparison) => ({ branchId: branch.id, comparison })))
    .sort((left, right) => (
      right.comparison.recordedOrdinal - left.comparison.recordedOrdinal
      || stableCompare(left.branchId, right.branchId)
      || stableCompare(left.comparison.id, right.comparison.id)
    ));
  const keep = new Set(rankedComparisons
    .slice(0, MAX_AGENCY_SHADOW_COMPARISONS)
    .map((item) => `${item.branchId}\u0000${item.comparison.id}\u0000${item.comparison.recordedOrdinal}`));
  const discardedComparisons = rankedComparisons.slice(MAX_AGENCY_SHADOW_COMPARISONS);
  if (discardedComparisons.length) {
    overflow = overflowWith(
      overflow,
      'comparison',
      discardedComparisons.map((item) => item.comparison.id),
      discardedComparisons.length,
    );
    branches = branches.map((branch) => ({
      ...branch,
      comparisons: branch.comparisons.filter((comparison) => (
        keep.has(`${branch.id}\u0000${comparison.id}\u0000${comparison.recordedOrdinal}`)
      )),
    }));
  }

  return { ...ledger, branches, restorePoints, overflow };
}

function makeBranch(
  ledger: AgencyShadowLedger,
  world: WorldState,
  origin: AgencyShadowBranchOrigin,
  projections: readonly CharacterAgencyShadowProjection[] = [],
  parent: AgencyShadowBranchParent | null = null,
  lineage: readonly AgencyShadowLineageLink[] = [],
): AgencyShadowAttachResult {
  const anchor = anchorOf(world);
  const ordinal = ledger.nextOrdinal;
  const id = `agency-branch_${stableHash([
    'agency-shadow-branch-v1',
    origin,
    anchor.seed,
    anchor.turn,
    anchor.hash,
    ordinal,
    ledger.overflow.digest,
  ]).slice(0, 16)}`;
  const branch: AgencyShadowBranch = {
    id,
    origin,
    anchor,
    head: anchor,
    parent,
    createdOrdinal: ordinal,
    lastTouchedOrdinal: ordinal,
    lineage: [...lineage].slice(-MAX_AGENCY_SHADOW_LINEAGE_LINKS),
    projections: projections
      .filter((projection) => projectionMatchesAnchor(projection, anchor))
      .slice(0, MAX_AGENCY_SHADOW_CHARACTERS),
    comparisons: [],
  };
  const next = boundLedger({
    ...ledger,
    nextOrdinal: nextOrdinal(ordinal),
    branches: [...ledger.branches, branch],
  }, id);
  return { ledger: next, branchId: id, restored: false };
}

export function createAgencyShadowLedger(): AgencyShadowLedger {
  return {
    version: AGENCY_SHADOW_LEDGER_VERSION,
    authority: 'observer-shadow',
    nextOrdinal: 1,
    branches: [],
    restorePoints: [],
    overflow: { ...EMPTY_OVERFLOW },
  };
}

/**
 * Opens an observation branch. Creation and import always start fresh. Restore
 * accepts continuity only when both the token and its seed/turn/hash snapshot
 * exactly match the authenticated world supplied by the caller.
 */
export function attachAgencyShadowBranch(
  ledger: AgencyShadowLedger,
  world: WorldState,
  mode: AgencyShadowOpenMode,
  restoreToken: string | null = null,
): AgencyShadowAttachResult {
  if (mode !== 'create' && mode !== 'import' && mode !== 'restore') {
    throw new Error(`Unknown Agency shadow open mode ${String(mode)}`);
  }
  if (mode !== 'restore') return makeBranch(ledger, world, mode);
  const token = boundedString(restoreToken, MAX_RESTORE_TOKEN_LENGTH);
  const anchor = anchorOf(world);
  const restorePoint = token
    ? ledger.restorePoints.find((point) => point.token === token && sameAnchor(point.anchor, anchor))
    : undefined;
  const result = makeBranch(ledger, world, 'restore', restorePoint?.projections ?? []);
  return { ...result, restored: Boolean(restorePoint) };
}

/** Binds or replaces one save-slot token without mutating the active branch. */
export function bindAgencyShadowRestorePoint(
  ledger: AgencyShadowLedger,
  branchId: string,
  world: WorldState,
  restoreToken: string,
  characterIds: readonly string[] = [],
): AgencyShadowLedger {
  const token = boundedString(restoreToken, MAX_RESTORE_TOKEN_LENGTH);
  if (!token) throw new Error('Agency shadow restoreToken 不能为空');
  const branch = branchById(ledger, branchId);
  assertAnchor('保存世界', branch.head, world);
  const preferred = chooseCharacterIds(characterIds, branch.projections, MAX_AGENCY_SHADOW_RESTORE_CHARACTERS);
  const projectionById = new Map(branch.projections.map((projection) => [projection.characterId, projection]));
  const projections = preferred
    .map((id) => projectionById.get(id))
    .filter((projection): projection is CharacterAgencyShadowProjection => (
      Boolean(projection) && projectionMatchesAnchor(projection as CharacterAgencyShadowProjection, branch.head)
    ));
  const ordinal = ledger.nextOrdinal;
  const point: AgencyShadowRestorePoint = {
    token,
    anchor: branch.head,
    boundOrdinal: ordinal,
    projections,
  };
  return boundLedger({
    ...ledger,
    nextOrdinal: nextOrdinal(ordinal),
    restorePoints: [...ledger.restorePoints.filter((item) => item.token !== token), point],
  }, branchId);
}

export function removeAgencyShadowRestorePoint(
  ledger: AgencyShadowLedger,
  restoreToken: string,
): AgencyShadowLedger {
  const token = boundedString(restoreToken, MAX_RESTORE_TOKEN_LENGTH);
  return token
    ? { ...ledger, restorePoints: ledger.restorePoints.filter((point) => point.token !== token) }
    : ledger;
}

/** Copies a named save's exact continuity snapshot even when it is not the active world. */
export function copyAgencyShadowRestorePoint(
  ledger: AgencyShadowLedger,
  sourceToken: string,
  targetToken: string,
): AgencyShadowLedger {
  const source = boundedString(sourceToken, MAX_RESTORE_TOKEN_LENGTH);
  const target = boundedString(targetToken, MAX_RESTORE_TOKEN_LENGTH);
  if (!source || !target) throw new Error('Agency shadow restoreToken 不能为空');
  const point = ledger.restorePoints.find((item) => item.token === source);
  if (!point) return ledger;
  const ordinal = ledger.nextOrdinal;
  return boundLedger({
    ...ledger,
    nextOrdinal: nextOrdinal(ordinal),
    restorePoints: [
      ...ledger.restorePoints.filter((item) => item.token !== target),
      {
        token: target,
        anchor: { ...point.anchor },
        boundOrdinal: ordinal,
        projections: [...point.projections],
      },
    ],
  });
}

export function ensureAgencyShadowCharacters(
  ledger: AgencyShadowLedger,
  branchId: string,
  world: WorldState,
  characterIds: readonly string[],
): AgencyShadowLedger {
  const branch = branchById(ledger, branchId);
  assertAnchor('观察世界', branch.head, world);
  const ids = chooseCharacterIds(characterIds, branch.projections);
  const existing = new Map(branch.projections.map((projection) => [projection.characterId, projection]));
  const projections = ids
    .filter((id) => world.characters.some((character) => character.id === id))
    .map((id) => projectionFor(world, id, existing.get(id)));
  const ordinal = ledger.nextOrdinal;
  return boundLedger({
    ...ledger,
    nextOrdinal: nextOrdinal(ordinal),
    branches: ledger.branches.map((item) => item.id === branchId
      ? { ...item, projections, lastTouchedOrdinal: ordinal }
      : item),
  }, branchId);
}

export function getAgencyShadowProjection(
  ledger: AgencyShadowLedger,
  branchId: string,
  characterId: string,
): CharacterAgencyShadowProjection | null {
  return ledger.branches
    .find((branch) => branch.id === branchId)
    ?.projections.find((projection) => projection.characterId === characterId) ?? null;
}

export function prepareAgencyShadowTurn(
  ledger: AgencyShadowLedger,
  branchId: string,
  before: WorldState,
  characterIds: readonly string[] = [],
): AgencyShadowPreparedTurn {
  const branch = branchById(ledger, branchId);
  assertAnchor('推进前世界', branch.head, before);
  const ids = chooseCharacterIds(characterIds, branch.projections);
  const existing = new Map(branch.projections.map((projection) => [projection.characterId, projection]));
  const projections = ids
    .filter((id) => before.characters.some((character) => character.id === id))
    .map((id) => projectionFor(before, id, existing.get(id)));
  return {
    version: 1,
    authority: 'observer-shadow-preparation',
    branchId,
    before: anchorOf(before),
    projections,
    suggestions: projections
      .map((projection) => suggestionFor(before, projection))
      .filter((suggestion): suggestion is AgencyShadowIntentSuggestion => Boolean(suggestion)),
  };
}

function exactIds<T extends { id: string; turn: number }>(
  items: readonly T[],
  ids: readonly string[],
  turn: number,
): T[] {
  const requested = new Set(ids);
  const counts = new Map<string, number>();
  for (const item of items) {
    if (requested.has(item.id) && item.turn === turn) counts.set(item.id, (counts.get(item.id) ?? 0) + 1);
  }
  return items.filter((item) => requested.has(item.id) && item.turn === turn && counts.get(item.id) === 1);
}

type AppointmentStartedFact = Extract<SimulationFact, { kind: 'appointment_started' }>;

function matchingAppointmentFacts(
  facts: readonly SimulationFact[],
  actorId: string,
  armyId: string,
  polityId: string,
): AppointmentStartedFact[] {
  return facts.filter((fact): fact is AppointmentStartedFact => (
    fact.kind === 'appointment_started'
    && fact.payload.action === 'started'
    && fact.payload.officeKind === '军团主帅'
    && fact.payload.holderId === actorId
    && fact.payload.armyId === armyId
    && fact.payload.fleetId === null
    && fact.payload.polityId === polityId
    && fact.actorIds.includes(actorId)
  ));
}

/**
 * Recognizes only the one legacy action C09 can prove exactly. A Chronicle
 * label alone is insufficient: the old and new army roles, the command delta,
 * and one same-quarter appointment_started Fact must all agree.
 */
export function observeLegacyDeputyPromotions(
  before: WorldState,
  after: WorldState,
): AgencyShadowLegacyPromotion[] {
  assertAdjacent(before, after);
  const report = after.lastTurn as NonNullable<WorldState['lastTurn']>;
  const events = exactIds(after.history, report.eventIds, before.turn)
    .filter((event) => event.kind === 'deputy_promoted')
    .sort((left, right) => stableCompare(left.id, right.id));
  const facts = exactIds(after.facts, report.factIds, before.turn);
  const agencyResolutions = new Map(facts
    .filter((fact): fact is Extract<SimulationFact, { kind: 'agency_intent_resolved' }> => (
      fact.kind === 'agency_intent_resolved'
    ))
    .map((fact) => [fact.id, fact]));
  const candidates: AgencyShadowLegacyPromotion[] = [];

  for (const event of events) {
    const commandDeltas = event.stateDeltas.filter((delta) => (
      delta.entityType === 'army'
      && delta.field === 'commanderId'
      && typeof delta.before === 'string'
      && typeof delta.after === 'string'
    ));
    if (commandDeltas.length !== 1) continue;
    const delta = commandDeltas[0];
    const actorId = delta.after as string;
    const formerCommanderId = delta.before as string;
    const ownedByAgencyDecision = event.sourceFactIds.some((factId) => {
      const resolution = agencyResolutions.get(factId);
      return resolution?.payload.outcome === 'executed'
        && resolution.payload.actorId === actorId
        && resolution.payload.targetArmyId === delta.entityId;
    });
    if (ownedByAgencyDecision) continue;
    if (
      actorId === formerCommanderId
      || !event.actorIds.includes(actorId)
      || !event.actorIds.includes(formerCommanderId)
    ) continue;

    const beforeArmy = before.armies.find((army) => army.id === delta.entityId);
    const afterArmy = after.armies.find((army) => army.id === delta.entityId);
    if (
      !beforeArmy
      || !afterArmy
      || beforeArmy.polityId !== afterArmy.polityId
      || beforeArmy.commanderId !== formerCommanderId
      || beforeArmy.deputyCommanderId !== actorId
      || afterArmy.commanderId !== actorId
      || afterArmy.deputyCommanderId !== formerCommanderId
    ) continue;

    const beforeActor = before.characters.find((character) => character.id === actorId);
    const afterActor = after.characters.find((character) => character.id === actorId);
    const beforeCommander = before.characters.find((character) => character.id === formerCommanderId);
    const afterCommander = after.characters.find((character) => character.id === formerCommanderId);
    if (
      !beforeActor
      || !afterActor
      || !beforeCommander
      || !afterCommander
      || beforeActor.commandingArmyId === beforeArmy.id
      || beforeCommander.commandingArmyId !== beforeArmy.id
      || afterActor.commandingArmyId !== afterArmy.id
      || afterCommander.commandingArmyId === afterArmy.id
    ) continue;

    const appointments = matchingAppointmentFacts(facts, actorId, afterArmy.id, afterArmy.polityId);
    if (appointments.length !== 1) continue;
    candidates.push({
      turn: before.turn,
      eventId: event.id,
      appointmentFactId: appointments[0].id,
      actorId,
      actorLabel: afterActor.name,
      formerCommanderId,
      formerCommanderLabel: afterCommander.name,
      armyId: afterArmy.id,
      armyLabel: afterArmy.name,
    });
  }

  const counts = new Map<string, number>();
  for (const item of candidates) {
    const key = `${item.actorId}\u0000${item.armyId}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return candidates
    .filter((item) => counts.get(`${item.actorId}\u0000${item.armyId}`) === 1)
    .slice(0, MAX_AGENCY_SHADOW_LEGACY_PROMOTIONS);
}

function comparisonDrafts(
  prepared: AgencyShadowPreparedTurn,
  actuals: readonly AgencyShadowLegacyPromotion[],
): Array<Omit<AgencyShadowComparison, 'id' | 'recordedOrdinal' | 'afterWorldHash'>> {
  const suggestionsByActor = new Map(prepared.suggestions.map((suggestion) => [suggestion.actorId, suggestion]));
  const consumedSuggestions = new Set<string>();
  const drafts: Array<Omit<AgencyShadowComparison, 'id' | 'recordedOrdinal' | 'afterWorldHash'>> = [];

  for (const actual of actuals) {
    const suggestion = suggestionsByActor.get(actual.actorId) ?? null;
    let status: AgencyShadowComparisonStatus = 'legacy-only';
    if (
      suggestion
      && suggestion.goalType === 'secure_independent_command'
      && suggestion.targetKind === 'army'
      && suggestion.targetId === actual.armyId
    ) {
      status = suggestion.action === 'request_independent_command' && suggestion.readiness === 'actionable'
        ? 'exact'
        : 'goal-aligned';
      consumedSuggestions.add(suggestion.id);
    } else if (suggestion?.readiness === 'actionable') {
      status = suggestion.targetId === actual.armyId ? 'legacy-only' : 'target-conflict';
      consumedSuggestions.add(suggestion.id);
    }
    drafts.push({
      turn: prepared.before.turn,
      beforeWorldHash: prepared.before.hash,
      actorId: actual.actorId,
      actorLabel: actual.actorLabel,
      targetId: actual.armyId,
      targetLabel: actual.armyLabel,
      status,
      suggestion: status === 'legacy-only' ? null : suggestion,
      legacy: actual,
      sourceFactIds: uniqueStrings([
        actual.appointmentFactId,
        ...(suggestion?.sourceFactIds ?? []),
      ], MAX_AGENCY_SHADOW_SOURCE_FACTS),
      sourceEventIds: [actual.eventId],
    });
  }

  for (const suggestion of prepared.suggestions) {
    if (suggestion.readiness !== 'actionable' || consumedSuggestions.has(suggestion.id)) continue;
    drafts.push({
      turn: prepared.before.turn,
      beforeWorldHash: prepared.before.hash,
      actorId: suggestion.actorId,
      actorLabel: suggestion.actorLabel,
      targetId: suggestion.targetId,
      targetLabel: suggestion.targetLabel,
      status: 'shadow-only',
      suggestion,
      legacy: null,
      sourceFactIds: suggestion.sourceFactIds,
      sourceEventIds: [],
    });
  }
  return drafts;
}

export function reconcileAgencyShadowTurn(
  ledger: AgencyShadowLedger,
  prepared: AgencyShadowPreparedTurn,
  before: WorldState,
  after: WorldState,
): AgencyShadowAdvanceResult {
  if (prepared.version !== 1 || prepared.authority !== 'observer-shadow-preparation') {
    throw new Error('Agency shadow 推进准备格式无效');
  }
  const branch = branchById(ledger, prepared.branchId);
  assertAnchor('推进前世界', branch.head, before);
  assertAnchor('推进准备', prepared.before, before);
  assertAdjacent(before, after);

  const beforeProjectionById = new Map(prepared.projections
    .filter((projection) => projectionMatchesAnchor(projection, prepared.before))
    .map((projection) => [projection.characterId, projection]));
  const actuals = observeLegacyDeputyPromotions(before, after);
  for (const actual of actuals) {
    if (!beforeProjectionById.has(actual.actorId) && before.characters.some((item) => item.id === actual.actorId)) {
      beforeProjectionById.set(actual.actorId, projectCharacterAgency(before, actual.actorId));
    }
  }
  const completePrepared: AgencyShadowPreparedTurn = {
    ...prepared,
    projections: [...beforeProjectionById.values()].slice(0, MAX_AGENCY_SHADOW_CHARACTERS),
    suggestions: [...beforeProjectionById.values()]
      .map((projection) => suggestionFor(before, projection))
      .filter((suggestion): suggestion is AgencyShadowIntentSuggestion => Boolean(suggestion)),
  };

  let ordinal = ledger.nextOrdinal;
  const report = after.lastTurn as NonNullable<WorldState['lastTurn']>;
  const authoritativeActorIds = new Set(exactIds(after.facts, report.factIds, before.turn)
    .filter((fact): fact is Extract<SimulationFact, { kind: 'agency_intent_resolved' }> => (
      fact.kind === 'agency_intent_resolved'
    ))
    .map((fact) => fact.payload.actorId));
  const drafts = comparisonDrafts(completePrepared, actuals)
    .filter((draft) => !authoritativeActorIds.has(draft.actorId));
  const comparisons = drafts.map((draft): AgencyShadowComparison => {
    const recordedOrdinal = ordinal;
    ordinal = nextOrdinal(ordinal);
    return {
      ...draft,
      id: `agency-comparison_${stableHash([
        prepared.branchId,
        draft.turn,
        draft.actorId,
        draft.targetId,
        draft.status,
        draft.suggestion?.id ?? null,
        draft.legacy?.eventId ?? null,
        recordedOrdinal,
      ]).slice(0, 16)}`,
      recordedOrdinal,
      afterWorldHash: after.hash,
    };
  });

  const retainedIds = chooseCharacterIds(
    actuals.map((actual) => actual.actorId),
    completePrepared.projections,
  );
  const afterProjections = retainedIds
    .filter((id) => after.characters.some((character) => character.id === id))
    .map((id) => projectCharacterAgency(after, id, beforeProjectionById.get(id)));
  const touchedOrdinal = ordinal;
  ordinal = nextOrdinal(ordinal);
  const nextAnchor = anchorOf(after);
  const lineage: AgencyShadowLineageLink[] = [
    ...branch.lineage,
    { kind: 'advance' as const, from: branch.head, to: nextAnchor },
  ].slice(-MAX_AGENCY_SHADOW_LINEAGE_LINKS);
  const updated: AgencyShadowBranch = {
    ...branch,
    head: nextAnchor,
    lastTouchedOrdinal: touchedOrdinal,
    lineage,
    projections: afterProjections,
    comparisons: [...branch.comparisons, ...comparisons],
  };
  const nextLedger = boundLedger({
    ...ledger,
    nextOrdinal: ordinal,
    branches: ledger.branches.map((item) => item.id === branch.id ? updated : item),
  }, branch.id);
  const retainedComparisonIds = new Set(
    nextLedger.branches.find((item) => item.id === branch.id)?.comparisons.map((item) => item.id) ?? [],
  );
  return {
    ledger: nextLedger,
    branchId: branch.id,
    comparisons: comparisons.filter((comparison) => retainedComparisonIds.has(comparison.id)),
  };
}

export function advanceAgencyShadowBranch(
  ledger: AgencyShadowLedger,
  branchId: string,
  before: WorldState,
  after: WorldState,
  characterIds: readonly string[] = [],
): AgencyShadowAdvanceResult {
  return reconcileAgencyShadowTurn(
    ledger,
    prepareAgencyShadowTurn(ledger, branchId, before, characterIds),
    before,
    after,
  );
}

export function forkAgencyShadowIntervention(
  ledger: AgencyShadowLedger,
  branchId: string,
  before: WorldState,
  intervention: WorldState,
): AgencyShadowAttachResult {
  const branch = branchById(ledger, branchId);
  assertAnchor('干预前世界', branch.head, before);
  const beforeAnchor = anchorOf(before);
  const interventionAnchor = anchorOf(intervention);
  if (interventionAnchor.seed !== beforeAnchor.seed || interventionAnchor.turn !== beforeAnchor.turn) {
    throw new Error('Agency shadow 同回合干预必须保持 seed 与 turn');
  }
  if (interventionAnchor.hash === beforeAnchor.hash) {
    throw new Error('Agency shadow 同回合干预必须形成不同的世界 hash');
  }
  const prior = new Map(branch.projections.map((projection) => [projection.characterId, projection]));
  const projections = branch.projections
    .filter((projection) => intervention.characters.some((character) => character.id === projection.characterId))
    .map((projection) => projectCharacterAgency(intervention, projection.characterId, prior.get(projection.characterId)));
  return makeBranch(
    ledger,
    intervention,
    'intervention',
    projections,
    { branchId: branch.id, turn: branch.head.turn, hash: branch.head.hash },
    [{ kind: 'intervention', from: branch.head, to: interventionAnchor }],
  );
}

export function getAgencyShadowQuarterComparisons(
  ledger: AgencyShadowLedger,
  branchId: string,
  turn?: number,
): AgencyShadowComparison[] {
  const branch = ledger.branches.find((item) => item.id === branchId);
  if (!branch) return [];
  const selectedTurn = turn ?? branch.comparisons.reduce((latest, item) => Math.max(latest, item.turn), -1);
  if (selectedTurn < 0) return [];
  return branch.comparisons
    .filter((comparison) => comparison.turn === selectedTurn)
    .sort((left, right) => right.recordedOrdinal - left.recordedOrdinal || stableCompare(left.id, right.id));
}

function playerEntry(comparison: AgencyShadowComparison): AgencyShadowPlayerEntry {
  if (comparison.status === 'exact') {
    return {
      id: comparison.id,
      turn: comparison.turn,
      actorId: comparison.actorId,
      sourceEventId: comparison.legacy?.eventId ?? null,
      conclusion: '相合',
      title: `${comparison.actorLabel}的盘算与任命相合`,
      summary: `${comparison.actorLabel}原已准备向${comparison.targetLabel}请领独立军令，本季确实由副将升任主帅。`,
      intended: `向${comparison.targetLabel}请领独立军令`,
      actual: `升任${comparison.targetLabel}主帅`,
      reason: '原先计划与季末军职、任命事实完全相合',
      evidence: ['季初计划已走到正式请领军令', '季末军职变更与主帅任命同时成立'],
    };
  }
  if (comparison.status === 'goal-aligned') {
    return {
      id: comparison.id,
      turn: comparison.turn,
      actorId: comparison.actorId,
      sourceEventId: comparison.legacy?.eventId ?? null,
      conclusion: '步调不同',
      title: `${comparison.actorLabel}获任早于原先盘算`,
      summary: `${comparison.actorLabel}虽有争取${comparison.targetLabel}军令的长期目标，季初仍在准备；旧制却已在本季将其升为主帅。`,
      intended: `继续准备争取${comparison.targetLabel}军令`,
      actual: `升任${comparison.targetLabel}主帅`,
      reason: '原先计划尚未走到正式请令，实际任命已经发生',
      evidence: ['原先计划尚未走到正式请令', '季末军职与任命事实已精确相合'],
    };
  }
  if (comparison.status === 'shadow-only') {
    return {
      id: comparison.id,
      turn: comparison.turn,
      actorId: comparison.actorId,
      sourceEventId: null,
      conclusion: '仅见盘算',
      title: `${comparison.actorLabel}的请令尚未成事`,
      summary: `${comparison.actorLabel}已准备向${comparison.targetLabel}请领独立军令，但本季没有发生对应的副将升任。这只是观察对照，不代表行动已经发生。`,
      intended: `向${comparison.targetLabel}请领独立军令`,
      actual: null,
      reason: '季初记载已可行动，季末没有对应任命事实',
      evidence: ['季初计划已可行动', '季末没有对应的主帅任命事实'],
    };
  }
  if (comparison.status === 'target-conflict') {
    return {
      id: comparison.id,
      turn: comparison.turn,
      actorId: comparison.actorId,
      sourceEventId: comparison.legacy?.eventId ?? null,
      conclusion: '所求不同',
      title: `${comparison.actorLabel}所求与所得不是同一军令`,
      summary: `${comparison.actorLabel}季初所盘算的军令，与本季旧制实际授予的${comparison.targetLabel}主帅之位并不相同。`,
      intended: comparison.suggestion ? `向${comparison.suggestion.targetLabel}请领独立军令` : null,
      actual: `升任${comparison.targetLabel}主帅`,
      reason: '季初记载与实际任命指向不同军团',
      evidence: ['原先计划与实际任命指向不同军团', '实际任命已由军职变更与任命事实共同核验'],
    };
  }
  return {
    id: comparison.id,
    turn: comparison.turn,
    actorId: comparison.actorId,
    sourceEventId: comparison.legacy?.eventId ?? null,
    conclusion: '仅见旧制',
    title: `${comparison.actorLabel}由旧制直接升任主帅`,
    summary: `${comparison.actorLabel}本季升任${comparison.targetLabel}主帅；季初记载没有与此精确对应的请令盘算。`,
    intended: null,
    actual: `升任${comparison.targetLabel}主帅`,
    reason: '实际任命已经发生，季初没有相合的行动建议',
    evidence: ['季末军职变更与主帅任命同时成立', '季初没有相合的行动建议'],
  };
}

export function toAgencyShadowPlayerEntries(
  source: AgencyShadowBranch | readonly AgencyShadowComparison[],
  limit = 8,
): AgencyShadowPlayerEntry[] {
  const comparisons = 'comparisons' in source ? source.comparisons : source;
  const boundedLimit = Math.max(0, Math.min(MAX_AGENCY_SHADOW_COMPARISONS, Math.floor(limit)));
  return [...comparisons]
    .sort((left, right) => right.turn - left.turn || right.recordedOrdinal - left.recordedOrdinal || stableCompare(left.id, right.id))
    .slice(0, boundedLimit)
    .map(playerEntry);
}

export function getAgencyShadowPlayerQuarterComparisons(
  ledger: AgencyShadowLedger,
  branchId: string,
  turn?: number,
  limit = 8,
): AgencyShadowPlayerEntry[] {
  return toAgencyShadowPlayerEntries(getAgencyShadowQuarterComparisons(ledger, branchId, turn), limit);
}

function clonePlain<T>(value: T): T | null {
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length > MAX_PROJECTION_SERIALIZED_CHARS) return null;
    return JSON.parse(serialized) as T;
  } catch {
    return null;
  }
}

function validStringArray(value: unknown, maximum: number): value is string[] {
  return Array.isArray(value)
    && value.length <= maximum
    && value.every((item) => typeof item === 'string' && item.length <= MAX_IDENTIFIER_LENGTH);
}

function validDesire(value: unknown, characterId: string, reviewedTurn: number): value is CharacterDesireProjection {
  if (!isRecord(value) || value.version !== 1 || value.authority !== 'projection') return false;
  if (value.characterId !== characterId || value.projectedTurn !== reviewedTurn) return false;
  if (!Array.isArray(value.axes) || value.axes.length > ROOT_DESIRES.length) return false;
  if (!validStringArray(value.coreDesireKinds, 2) || !value.coreDesireKinds.every((kind) => ROOT_DESIRES.includes(kind as never))) return false;
  if (!Array.isArray(value.pressures) || value.pressures.length > 4) return false;
  for (const axis of value.axes) {
    if (!isRecord(axis) || !ROOT_DESIRES.includes(axis.kind as never)) return false;
    if (!safeFinite(axis.weight) || !safeFinite(axis.rank) || typeof axis.core !== 'boolean' || !Array.isArray(axis.sources) || axis.sources.length > 5) return false;
    for (const source of axis.sources) {
      if (!isRecord(source) || !safeFinite(source.contribution) || !validStringArray(source.sourceFactIds, MAX_PROJECTION_SOURCE_FACTS)) return false;
    }
  }
  return value.pressures.every((pressure) => (
    isRecord(pressure)
    && ROOT_DESIRES.includes(pressure.kind as never)
    && safeFinite(pressure.intensity)
    && validStringArray(pressure.sourceFactIds, MAX_PROJECTION_SOURCE_FACTS)
  ));
}

function validGoal(value: unknown, characterId: string): value is AgencyGoalProjection {
  if (!isRecord(value) || value.characterId !== characterId || !GOAL_TYPES.includes(value.type as never)) return false;
  if (!boundedString(value.id) || !boundedString(value.signature) || !isRecord(value.target)) return false;
  if (!ENTITY_KINDS.includes(value.target.kind as never) || !boundedString(value.target.id)) return false;
  if (!['active', 'achieved', 'invalidated', 'abandoned'].includes(String(value.status))) return false;
  if (![value.priority, value.progress, value.commitment].every(safeFinite)) return false;
  if ([value.createdTurn, value.minimumCommitUntilTurn, value.lastReviewedTurn].some((item) => safeInteger(item) === null)) return false;
  if (value.resolvedTurn !== null && safeInteger(value.resolvedTurn) === null) return false;
  if (!validStringArray(value.sourceFactIds, MAX_PROJECTION_SOURCE_FACTS) || !isRecord(value.context)) return false;
  return typeof value.context.originRole === 'string'
    && safeFinite(value.context.baselineOfficeRank)
    && safeFinite(value.context.baselineValue)
    && (value.context.requiredOfficeKind === null || typeof value.context.requiredOfficeKind === 'string');
}

function validPlan(value: unknown, characterId: string, goalIds: ReadonlySet<string>): value is AgencyPlanProjection {
  if (!isRecord(value) || value.templateVersion !== 1 || value.characterId !== characterId) return false;
  if (!boundedString(value.id) || !boundedString(value.goalId) || !goalIds.has(value.goalId as string)) return false;
  if (!['active', 'invalidated'].includes(String(value.status)) || safeInteger(value.createdTurn) === null) return false;
  if (value.currentStepIndex !== null && safeInteger(value.currentStepIndex, 0, MAX_PLAN_STEPS - 1) === null) return false;
  if (!Array.isArray(value.steps) || value.steps.length > MAX_PLAN_STEPS) return false;
  return value.steps.every((step) => (
    isRecord(step)
    && Boolean(boundedString(step.id))
    && safeInteger(step.order, 1, MAX_PLAN_STEPS) !== null
    && PLAN_ACTIONS.includes(step.action as never)
    && ['completed', 'available', 'blocked', 'invalidated'].includes(String(step.status))
    && validStringArray(step.sourceFactIds, MAX_PROJECTION_SOURCE_FACTS)
  ));
}

function normalizeProjection(value: unknown, anchor: AgencyShadowWorldAnchor): CharacterAgencyShadowProjection | null {
  const projection = clonePlain(value);
  if (!isRecord(projection) || projection.version !== 1 || projection.authority !== 'projection') return null;
  const characterId = boundedString(projection.characterId);
  if (!characterId || projection.seed !== anchor.seed || projection.reviewedTurn !== anchor.turn || projection.sourceWorldHash !== anchor.hash) return null;
  if (!['active', 'dormant', 'closed'].includes(String(projection.availability))) return null;
  if (!validDesire(projection.desire, characterId, anchor.turn) || !ROOT_DESIRES.includes(projection.longTermDirection as never)) return null;
  if (!Array.isArray(projection.secondaryGoals) || projection.secondaryGoals.length > MAX_SECONDARY_GOALS) return null;
  if (!Array.isArray(projection.recentlyClosedGoals) || projection.recentlyClosedGoals.length > MAX_RECENTLY_CLOSED_GOALS) return null;
  const goals = [
    ...(projection.primaryGoal ? [projection.primaryGoal] : []),
    ...projection.secondaryGoals,
    ...projection.recentlyClosedGoals,
  ];
  if (!goals.every((goal) => validGoal(goal, characterId))) return null;
  const activeGoalIds = new Set(goals.map((goal) => goal.id));
  if (!Array.isArray(projection.plans) || projection.plans.length > 1 + MAX_SECONDARY_GOALS + MAX_RECENTLY_CLOSED_GOALS) return null;
  if (!projection.plans.every((plan) => validPlan(plan, characterId, activeGoalIds))) return null;
  if (projection.pendingPrimaryChallenge !== null) {
    const pending = projection.pendingPrimaryChallenge;
    if (!isRecord(pending) || !boundedString(pending.goalSignature)) return null;
    if ([pending.firstSeenTurn, pending.lastSeenTurn, pending.consecutiveReviews].some((item) => safeInteger(item) === null)) return null;
  }
  return projection as unknown as CharacterAgencyShadowProjection;
}

function normalizeSuggestion(value: unknown, anchor: AgencyShadowWorldAnchor): AgencyShadowIntentSuggestion | null {
  if (!isRecord(value) || value.turn !== anchor.turn || value.sourceWorldHash !== anchor.hash) return null;
  if (!GOAL_TYPES.includes(value.goalType as never) || !PLAN_ACTIONS.includes(value.action as never)) return null;
  if (!ENTITY_KINDS.includes(value.targetKind as never) || !['preparation', 'actionable'].includes(String(value.readiness))) return null;
  const required = ['id', 'actorId', 'actorLabel', 'goalId', 'goalSignature', 'planId', 'stepId', 'stepLabel', 'targetId', 'targetLabel'] as const;
  if (required.some((key) => !boundedString(value[key]))) return null;
  if (!validStringArray(value.sourceFactIds, MAX_AGENCY_SHADOW_SOURCE_FACTS)) return null;
  return clonePlain(value) as AgencyShadowIntentSuggestion | null;
}

function normalizeLegacy(value: unknown, turn: number): AgencyShadowLegacyPromotion | null {
  if (!isRecord(value) || value.turn !== turn) return null;
  const required = ['eventId', 'appointmentFactId', 'actorId', 'actorLabel', 'formerCommanderId', 'formerCommanderLabel', 'armyId', 'armyLabel'] as const;
  if (required.some((key) => !boundedString(value[key]))) return null;
  return clonePlain(value) as AgencyShadowLegacyPromotion | null;
}

function normalizeComparison(value: unknown, seed: string): AgencyShadowComparison | null {
  if (!isRecord(value) || !COMPARISON_STATUSES.includes(value.status as never)) return null;
  const turn = safeInteger(value.turn);
  const recordedOrdinal = safeInteger(value.recordedOrdinal, 1);
  const beforeWorldHash = boundedString(value.beforeWorldHash);
  const afterWorldHash = boundedString(value.afterWorldHash);
  const id = boundedString(value.id);
  const actorId = boundedString(value.actorId);
  const actorLabel = boundedString(value.actorLabel);
  const targetId = boundedString(value.targetId);
  const targetLabelValue = boundedString(value.targetLabel);
  if (turn === null || recordedOrdinal === null || !beforeWorldHash || !afterWorldHash || !id || !actorId || !actorLabel || !targetId || !targetLabelValue) return null;
  const suggestion = value.suggestion === null
    ? null
    : normalizeSuggestion(value.suggestion, { schemaVersion: 4, seed, turn, hash: beforeWorldHash });
  const legacy = value.legacy === null ? null : normalizeLegacy(value.legacy, turn);
  if (value.suggestion !== null && !suggestion) return null;
  if (value.legacy !== null && !legacy) return null;
  if (!validStringArray(value.sourceFactIds, MAX_AGENCY_SHADOW_SOURCE_FACTS)) return null;
  if (!validStringArray(value.sourceEventIds, MAX_AGENCY_SHADOW_SOURCE_EVENTS)) return null;
  const status = value.status as AgencyShadowComparisonStatus;
  const actualStatus = status === 'exact'
    || status === 'goal-aligned'
    || status === 'legacy-only'
    || status === 'target-conflict';
  if (actualStatus && !legacy) return null;
  if (status === 'shadow-only' && (!suggestion || legacy)) return null;
  if (status === 'legacy-only' && suggestion) return null;
  if ((status === 'exact' || status === 'goal-aligned' || status === 'target-conflict') && !suggestion) return null;
  if (legacy && (
    legacy.actorId !== actorId
    || legacy.armyId !== targetId
    || !value.sourceFactIds.includes(legacy.appointmentFactId)
    || !value.sourceEventIds.includes(legacy.eventId)
  )) return null;
  if (suggestion && (
    suggestion.actorId !== actorId
    || (status === 'shadow-only' && suggestion.targetId !== targetId)
  )) return null;
  if ((status === 'exact' || status === 'goal-aligned') && suggestion?.targetId !== targetId) return null;
  if (status === 'target-conflict' && suggestion?.targetId === targetId) return null;
  return {
    id,
    recordedOrdinal,
    turn,
    beforeWorldHash,
    afterWorldHash,
    actorId,
    actorLabel,
    targetId,
    targetLabel: targetLabelValue,
    status,
    suggestion,
    legacy,
    sourceFactIds: [...value.sourceFactIds],
    sourceEventIds: [...value.sourceEventIds],
  };
}

function normalizeLineage(value: unknown, seed: string, head: AgencyShadowWorldAnchor): AgencyShadowLineageLink[] {
  if (!Array.isArray(value)) return [];
  const links: AgencyShadowLineageLink[] = [];
  for (const raw of value.slice(-MAX_AGENCY_SHADOW_LINEAGE_LINKS)) {
    if (!isRecord(raw) || (raw.kind !== 'advance' && raw.kind !== 'intervention')) continue;
    const from = parseAnchor(raw.from);
    const to = parseAnchor(raw.to);
    if (!from || !to || from.seed !== seed || to.seed !== seed || from.hash === to.hash) continue;
    if (raw.kind === 'advance' && to.turn !== from.turn + 1) continue;
    if (raw.kind === 'intervention' && to.turn !== from.turn) continue;
    if (links.length && !sameAnchor(links[links.length - 1].to, from)) continue;
    links.push({ kind: raw.kind, from, to });
  }
  return links.length && sameAnchor(links[links.length - 1].to, head) ? links : [];
}

function normalizeBranch(value: unknown): AgencyShadowBranch | null {
  if (!isRecord(value)) return null;
  const id = boundedString(value.id);
  const anchor = parseAnchor(value.anchor);
  const head = parseAnchor(value.head);
  const createdOrdinal = safeInteger(value.createdOrdinal, 1);
  const lastTouchedOrdinal = safeInteger(value.lastTouchedOrdinal, 1);
  if (!id || !anchor || !head || anchor.seed !== head.seed || head.turn < anchor.turn || createdOrdinal === null || lastTouchedOrdinal === null) return null;
  if (!['create', 'import', 'restore', 'intervention'].includes(String(value.origin))) return null;
  let parent: AgencyShadowBranchParent | null = null;
  if (value.parent !== null) {
    if (!isRecord(value.parent)) return null;
    const branchId = boundedString(value.parent.branchId);
    const hash = boundedString(value.parent.hash);
    const turn = safeInteger(value.parent.turn);
    if (!branchId || !hash || turn === null) return null;
    parent = { branchId, hash, turn };
  }
  const rawProjections = Array.isArray(value.projections) ? value.projections : [];
  const projections: CharacterAgencyShadowProjection[] = [];
  const seenCharacters = new Set<string>();
  for (const raw of rawProjections) {
    const projection = normalizeProjection(raw, head);
    if (!projection || seenCharacters.has(projection.characterId)) continue;
    seenCharacters.add(projection.characterId);
    projections.push(projection);
    if (projections.length >= MAX_AGENCY_SHADOW_CHARACTERS) break;
  }
  const comparisons = (Array.isArray(value.comparisons) ? value.comparisons : [])
    .map((comparison) => normalizeComparison(comparison, head.seed))
    .filter((comparison): comparison is AgencyShadowComparison => Boolean(comparison));
  return {
    id,
    origin: value.origin as AgencyShadowBranchOrigin,
    anchor,
    head,
    parent,
    createdOrdinal,
    lastTouchedOrdinal,
    lineage: normalizeLineage(value.lineage, head.seed, head),
    projections,
    comparisons,
  };
}

function normalizeRestorePoint(value: unknown): AgencyShadowRestorePoint | null {
  if (!isRecord(value)) return null;
  const token = boundedString(value.token, MAX_RESTORE_TOKEN_LENGTH);
  const anchor = parseAnchor(value.anchor);
  const boundOrdinal = safeInteger(value.boundOrdinal, 1);
  if (!token || !anchor || boundOrdinal === null) return null;
  const projections: CharacterAgencyShadowProjection[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(value.projections) ? value.projections : []) {
    const projection = normalizeProjection(raw, anchor);
    if (!projection || seen.has(projection.characterId)) continue;
    seen.add(projection.characterId);
    projections.push(projection);
    if (projections.length >= MAX_AGENCY_SHADOW_RESTORE_CHARACTERS) break;
  }
  return { token, anchor, boundOrdinal, projections };
}

function normalizeOverflow(value: unknown): AgencyShadowOverflow {
  if (!isRecord(value)) return { ...EMPTY_OVERFLOW };
  return {
    discardedBranches: safeInteger(value.discardedBranches) ?? 0,
    discardedRestorePoints: safeInteger(value.discardedRestorePoints) ?? 0,
    discardedComparisons: safeInteger(value.discardedComparisons) ?? 0,
    digest: boundedString(value.digest) ?? EMPTY_OVERFLOW.digest,
  };
}

/** Non-throwing localStorage/import boundary. Invalid or oversized data becomes an empty ledger. */
export function parseAgencyShadowLedger(raw: unknown): AgencyShadowLedger {
  let value = raw;
  try {
    if (typeof raw === 'string') {
      if (raw.length > MAX_AGENCY_SHADOW_SERIALIZED_CHARS) return createAgencyShadowLedger();
      value = JSON.parse(raw);
    } else if (JSON.stringify(raw).length > MAX_AGENCY_SHADOW_SERIALIZED_CHARS) {
      return createAgencyShadowLedger();
    }
  } catch {
    return createAgencyShadowLedger();
  }
  if (!isRecord(value) || value.version !== 1 || value.authority !== 'observer-shadow') return createAgencyShadowLedger();
  const branches: AgencyShadowBranch[] = [];
  const seenBranches = new Set<string>();
  for (const rawBranch of Array.isArray(value.branches) ? value.branches : []) {
    const branch = normalizeBranch(rawBranch);
    if (!branch || seenBranches.has(branch.id)) continue;
    seenBranches.add(branch.id);
    branches.push(branch);
  }
  const restoreByToken = new Map<string, AgencyShadowRestorePoint>();
  for (const rawPoint of Array.isArray(value.restorePoints) ? value.restorePoints : []) {
    const point = normalizeRestorePoint(rawPoint);
    const previous = point ? restoreByToken.get(point.token) : undefined;
    if (point && (!previous || point.boundOrdinal > previous.boundOrdinal)) restoreByToken.set(point.token, point);
  }
  const maximumOrdinal = Math.max(
    0,
    ...branches.map((branch) => Math.max(
      branch.createdOrdinal,
      branch.lastTouchedOrdinal,
      ...branch.comparisons.map((comparison) => comparison.recordedOrdinal),
    )),
    ...[...restoreByToken.values()].map((point) => point.boundOrdinal),
  );
  const parsedNext = safeInteger(value.nextOrdinal, 1) ?? 1;
  return boundLedger({
    version: 1,
    authority: 'observer-shadow',
    nextOrdinal: Math.max(parsedNext, nextOrdinal(maximumOrdinal)),
    branches,
    restorePoints: [...restoreByToken.values()],
    overflow: normalizeOverflow(value.overflow),
  });
}

/** Serializes only bounded observer metadata; no WorldState object is accepted or embedded. */
export function serializeAgencyShadowLedger(ledger: AgencyShadowLedger): string {
  let compact = boundLedger(ledger);
  let serialized = JSON.stringify(compact);
  if (serialized.length <= MAX_AGENCY_SHADOW_SERIALIZED_CHARS) return serialized;

  compact = {
    ...compact,
    branches: compact.branches.map((branch) => ({ ...branch, comparisons: [] })),
    overflow: overflowWith(
      compact.overflow,
      'comparison',
      compact.branches.flatMap((branch) => branch.comparisons.map((comparison) => comparison.id)),
      compact.branches.reduce((sum, branch) => sum + branch.comparisons.length, 0),
    ),
  };
  serialized = JSON.stringify(compact);
  if (serialized.length <= MAX_AGENCY_SHADOW_SERIALIZED_CHARS) return serialized;

  compact = {
    ...compact,
    restorePoints: compact.restorePoints.map((point) => ({ ...point, projections: point.projections.slice(0, 1) })),
  };
  serialized = JSON.stringify(compact);
  if (serialized.length <= MAX_AGENCY_SHADOW_SERIALIZED_CHARS) return serialized;

  while (compact.restorePoints.length && serialized.length > MAX_AGENCY_SHADOW_SERIALIZED_CHARS) {
    const discarded = compact.restorePoints[compact.restorePoints.length - 1];
    compact = {
      ...compact,
      restorePoints: compact.restorePoints.slice(0, -1),
      overflow: overflowWith(compact.overflow, 'restore', { token: discarded.token, anchor: discarded.anchor }),
    };
    serialized = JSON.stringify(compact);
  }
  return serialized.length <= MAX_AGENCY_SHADOW_SERIALIZED_CHARS
    ? serialized
    : JSON.stringify(createAgencyShadowLedger());
}
