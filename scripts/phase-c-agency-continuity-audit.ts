import {
  advanceWorld,
  computeWorldHash,
  createWorld,
  deserializeWorld,
  getDateForTurn,
  serializeWorld,
  stableHash,
  type SimulationFact,
  type WorldState,
} from '../src/sim';
import {
  MAX_PERSONAL_MEMORIES,
  MAX_PERSONAL_MEMORY_SOURCE_FACTS,
  MAX_PERSONAL_MEMORY_SUBJECTS,
  MAX_PINNED_PERSONAL_MEMORIES,
  reducePersonalMemorySystem,
  validateAgencySystemState,
} from '../src/sim/agency';
import {
  MAX_AGENCY_SHADOW_BRANCHES,
  MAX_AGENCY_SHADOW_CHARACTERS,
  MAX_AGENCY_SHADOW_COMPARISONS,
  MAX_AGENCY_SHADOW_RESTORE_CHARACTERS,
  MAX_AGENCY_SHADOW_RESTORE_POINTS,
  MAX_AGENCY_SHADOW_SERIALIZED_CHARS,
  advanceAgencyShadowBranch,
  attachAgencyShadowBranch,
  bindAgencyShadowRestorePoint,
  copyAgencyShadowRestorePoint,
  createAgencyShadowLedger,
  ensureAgencyShadowCharacters,
  forkAgencyShadowIntervention,
  getAgencyShadowProjection,
  parseAgencyShadowLedger,
  prepareAgencyShadowTurn,
  serializeAgencyShadowLedger,
  type AgencyShadowComparison,
  type AgencyShadowLedger,
} from '../src/view/v1-agency-shadow';

const DEFAULT_SEEDS = [
  '军权春秋',
  '春战副将',
  '同源世界',
  '归档校验',
  '副将立功',
  '北境军令',
] as const;

const MAX_REPORTED_FAILURES = 160;

function positiveIntegerFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, received ${raw}`);
  }
  return value;
}

const configuredSeeds = process.env.PHASE_C_AGENCY_CONTINUITY_AUDIT_SEEDS
  ?.split(',')
  .map((seed) => seed.trim())
  .filter(Boolean);
const seeds = configuredSeeds?.length ? configuredSeeds : [...DEFAULT_SEEDS];
const turns = positiveIntegerFromEnv('PHASE_C_AGENCY_CONTINUITY_AUDIT_TURNS', 24);

interface MutableMetrics {
  advancedQuarters: number;
  memoryValidationChecks: number;
  memoryHashChecks: number;
  memorySaveRoundtrips: number;
  memoryContinuationChecks: number;
  memoryTamperRejections: number;
  memoryCapChecks: number;
  shadowPurityChecks: number;
  shadowRoundtrips: number;
  exactRestoreChecks: number;
  rejectedRestoreChecks: number;
  copiedRestoreChecks: number;
  interventionForkChecks: number;
  branchCapChecks: number;
  characterCapChecks: number;
  restorePointCapChecks: number;
  comparisonCapChecks: number;
  maximumMemoriesPerCharacter: number;
  maximumPinnedMemoriesPerCharacter: number;
  maximumShadowBranches: number;
  maximumShadowRestorePoints: number;
  maximumShadowProjectionsPerBranch: number;
  maximumShadowComparisons: number;
  maximumShadowSerializedChars: number;
}

interface SeedSample {
  seed: string;
  finalTurn: number;
  finalHash: string;
  memoryAccounts: number;
  memoryCount: number;
  shadowBranches: number;
  restorePoints: number;
  shadowComparisons: number;
  shadowDigest: string;
}

const metrics: MutableMetrics = {
  advancedQuarters: 0,
  memoryValidationChecks: 0,
  memoryHashChecks: 0,
  memorySaveRoundtrips: 0,
  memoryContinuationChecks: 0,
  memoryTamperRejections: 0,
  memoryCapChecks: 0,
  shadowPurityChecks: 0,
  shadowRoundtrips: 0,
  exactRestoreChecks: 0,
  rejectedRestoreChecks: 0,
  copiedRestoreChecks: 0,
  interventionForkChecks: 0,
  branchCapChecks: 0,
  characterCapChecks: 0,
  restorePointCapChecks: 0,
  comparisonCapChecks: 0,
  maximumMemoriesPerCharacter: 0,
  maximumPinnedMemoriesPerCharacter: 0,
  maximumShadowBranches: 0,
  maximumShadowRestorePoints: 0,
  maximumShadowProjectionsPerBranch: 0,
  maximumShadowComparisons: 0,
  maximumShadowSerializedChars: 0,
};

const failures: string[] = [];
let failureCount = 0;

function fail(seed: string, turn: number, message: string): void {
  failureCount += 1;
  if (failures.length < MAX_REPORTED_FAILURES) failures.push(`${seed}@T${turn}: ${message}`);
}

function check(condition: boolean, seed: string, turn: number, message: string): void {
  if (!condition) fail(seed, turn, message);
}

function totalComparisons(ledger: AgencyShadowLedger): number {
  return ledger.branches.reduce((sum, branch) => sum + branch.comparisons.length, 0);
}

function firstDifference(left: unknown, right: unknown, path = '$'): string | null {
  if (Object.is(left, right)) return null;
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return `${path}.length ${left.length} != ${right.length}`;
    for (let index = 0; index < left.length; index += 1) {
      const difference = firstDifference(left[index], right[index], `${path}[${index}]`);
      if (difference) return difference;
    }
    return null;
  }
  if (typeof left === 'object' && left !== null && typeof right === 'object' && right !== null) {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)])].sort();
    for (const key of keys) {
      if (!(key in leftRecord)) return `${path}.${key} missing on serialized ledger`;
      if (!(key in rightRecord)) return `${path}.${key} missing after parse`;
      const difference = firstDifference(leftRecord[key], rightRecord[key], `${path}.${key}`);
      if (difference) return difference;
    }
    return null;
  }
  return `${path} ${JSON.stringify(left)} != ${JSON.stringify(right)}`;
}

function observeShadowPeaks(ledger: AgencyShadowLedger): void {
  metrics.maximumShadowBranches = Math.max(metrics.maximumShadowBranches, ledger.branches.length);
  metrics.maximumShadowRestorePoints = Math.max(metrics.maximumShadowRestorePoints, ledger.restorePoints.length);
  metrics.maximumShadowProjectionsPerBranch = Math.max(
    metrics.maximumShadowProjectionsPerBranch,
    ...ledger.branches.map((branch) => branch.projections.length),
    0,
  );
  metrics.maximumShadowComparisons = Math.max(metrics.maximumShadowComparisons, totalComparisons(ledger));
}

function trackedCharacterIds(world: WorldState): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const add = (id: string | null | undefined): void => {
    if (!id || seen.has(id) || !world.characters.some((character) => character.id === id)) return;
    seen.add(id);
    ids.push(id);
  };
  [...world.armies].sort((left, right) => left.id.localeCompare(right.id)).forEach((army) => {
    add(army.deputyCommanderId);
    add(army.commanderId);
  });
  [...world.fleets].sort((left, right) => left.id.localeCompare(right.id)).forEach((fleet) => {
    add(fleet.deputyCommanderId);
    add(fleet.commanderId);
  });
  [...world.polities]
    .filter((polity) => polity.alive)
    .sort((left, right) => left.id.localeCompare(right.id))
    .forEach((polity) => add(polity.rulerId));
  [...world.characters]
    .filter((character) => character.alive)
    .sort((left, right) => right.influence - left.influence || left.id.localeCompare(right.id))
    .forEach((character) => add(character.id));
  return ids.slice(0, MAX_AGENCY_SHADOW_CHARACTERS);
}

function auditAuthoritativeMemory(world: WorldState): void {
  metrics.memoryValidationChecks += 1;
  const messages = validateAgencySystemState(world);
  for (const message of messages) fail(world.seed, world.turn, message);
  check(
    world.agencySystem.memoryThroughTurn === world.turn - 1,
    world.seed,
    world.turn,
    `memory cursor ${world.agencySystem.memoryThroughTurn} is not ${world.turn - 1}`,
  );
  for (const account of world.agencySystem.characters) {
    const pinned = account.memories.filter((memory) => memory.pinned).length;
    metrics.maximumMemoriesPerCharacter = Math.max(metrics.maximumMemoriesPerCharacter, account.memories.length);
    metrics.maximumPinnedMemoriesPerCharacter = Math.max(metrics.maximumPinnedMemoriesPerCharacter, pinned);
    check(account.memories.length <= MAX_PERSONAL_MEMORIES, world.seed, world.turn, `${account.characterId} exceeds memory cap`);
    check(pinned <= MAX_PINNED_PERSONAL_MEMORIES, world.seed, world.turn, `${account.characterId} exceeds pinned-memory cap`);
    for (const memory of account.memories) {
      check(
        memory.sourceFactIds.length <= MAX_PERSONAL_MEMORY_SOURCE_FACTS,
        world.seed,
        world.turn,
        `${memory.id} exceeds source Fact cap`,
      );
      check(
        memory.subjectRefs.length <= MAX_PERSONAL_MEMORY_SUBJECTS,
        world.seed,
        world.turn,
        `${memory.id} exceeds subject cap`,
      );
    }
  }
  metrics.memoryHashChecks += 1;
  check(computeWorldHash(world) === world.hash, world.seed, world.turn, 'authoritative PersonalMemory is not authenticated by world hash');
}

function auditShadowPurity(
  world: WorldState,
  beforeSerialization: string,
  beforeHash: string,
  label: string,
): void {
  metrics.shadowPurityChecks += 1;
  check(world.hash === beforeHash, world.seed, world.turn, `${label} changed the WorldState hash field`);
  check(computeWorldHash(world) === beforeHash, world.seed, world.turn, `${label} changed authoritative hash input`);
  check(serializeWorld(world) === beforeSerialization, world.seed, world.turn, `${label} changed serialized WorldState`);
  check(
    !Object.prototype.hasOwnProperty.call(world, 'agencyShadow')
      && !Object.prototype.hasOwnProperty.call(world, 'agencyShadowLedger'),
    world.seed,
    world.turn,
    `${label} attached observer metadata to WorldState`,
  );
}

function roundtripShadow(
  ledger: AgencyShadowLedger,
  branchId: string,
  seed: string,
  turn: number,
): AgencyShadowLedger {
  const serialized = serializeAgencyShadowLedger(ledger);
  metrics.maximumShadowSerializedChars = Math.max(metrics.maximumShadowSerializedChars, serialized.length);
  check(serialized.length <= MAX_AGENCY_SHADOW_SERIALIZED_CHARS, seed, turn, 'shadow ledger exceeds serialized cap');
  const parsed = parseAgencyShadowLedger(serialized);
  const serializedValue = JSON.parse(serialized) as AgencyShadowLedger;
  const missingProjectionIds = serializedValue.branches.flatMap((branch) => {
    const retained = new Set(parsed.branches.find((item) => item.id === branch.id)?.projections.map((item) => item.characterId) ?? []);
    return branch.projections.filter((projection) => !retained.has(projection.characterId)).map((projection) => projection.characterId);
  });
  const missingComparisons = serializedValue.branches.flatMap((branch) => {
    const retained = new Set(parsed.branches.find((item) => item.id === branch.id)?.comparisons.map((item) => item.id) ?? []);
    return branch.comparisons
      .filter((comparison) => !retained.has(comparison.id))
      .map((comparison) => `${comparison.id}:${comparison.status}:${comparison.suggestion?.goalType ?? 'none'}:${comparison.suggestion?.action ?? 'none'}`);
  });
  const semanticDifference = firstDifference(serializedValue, parsed);
  metrics.shadowRoundtrips += 1;
  check(parsed.branches.some((branch) => branch.id === branchId), seed, turn, 'active branch vanished during shadow roundtrip');
  check(
    stableHash(parsed) === stableHash(serializedValue),
    seed,
    turn,
    `shadow ledger changed semantically during serialization roundtrip${semanticDifference ? `: ${semanticDifference}` : ''}${missingProjectionIds.length ? `; dropped projections ${missingProjectionIds.join(',')}` : ''}${missingComparisons.length ? `; dropped comparisons ${missingComparisons.join(',')}` : ''}`,
  );
  observeShadowPeaks(parsed);
  return parsed;
}

function appointmentFactsForMemoryCap(world: WorldState): SimulationFact[] {
  const holder = world.characters[0];
  const polity = world.polities.find((item) => item.id === holder?.polityId);
  if (!holder || !polity || world.regions.length < 20) throw new Error('memory cap audit requires one holder and twenty regions');
  const date = getDateForTurn(0);
  return world.regions.slice(0, 20).map((region, index): SimulationFact => ({
    id: `fact_continuity_cap_${String(index).padStart(3, '0')}`,
    turn: 0,
    year: date.year,
    season: date.season,
    kind: 'appointment_started',
    category: '政治',
    importance: index < 6 ? 5 : 2,
    actorIds: [holder.id],
    polityIds: [polity.id],
    regionIds: [region.id],
    causes: [{ label: '发布审计任命', role: '结果', weight: 1, evidence: '用于核验有界记忆归并' }],
    stateDeltas: [],
    sourceFactIds: [],
    payload: {
      appointmentId: `office_continuity_cap_${index}`,
      action: 'started',
      officeKind: '地方长官',
      holderId: holder.id,
      polityId: polity.id,
      regionId: region.id,
      armyId: null,
      fleetId: null,
      rank: index < 6 ? 100 : 30,
    },
  }));
}

function exerciseMemoryCaps(): void {
  const world = createWorld('C08发布上限审计');
  const beforeSerialization = serializeWorld(world);
  const beforeHash = world.hash;
  const system = reducePersonalMemorySystem(world, 0, appointmentFactsForMemoryCap(world));
  const holderId = world.characters[0]?.id;
  const memories = system.characters.find((entry) => entry.characterId === holderId)?.memories ?? [];
  metrics.maximumMemoriesPerCharacter = Math.max(metrics.maximumMemoriesPerCharacter, memories.length);
  metrics.maximumPinnedMemoriesPerCharacter = Math.max(
    metrics.maximumPinnedMemoriesPerCharacter,
    memories.filter((memory) => memory.pinned).length,
  );
  metrics.memoryCapChecks += 1;
  check(memories.length === MAX_PERSONAL_MEMORIES, world.seed, world.turn, 'memory reducer did not enforce sixteen-item cap');
  check(
    memories.filter((memory) => memory.pinned).length === MAX_PINNED_PERSONAL_MEMORIES,
    world.seed,
    world.turn,
    'memory reducer did not enforce four pinned-item cap',
  );
  check(serializeWorld(world) === beforeSerialization, world.seed, world.turn, 'memory reducer mutated its input world');
  check(world.hash === beforeHash && computeWorldHash(world) === beforeHash, world.seed, world.turn, 'memory reducer changed input hash');
}

function sampleComparison(world: WorldState, branchIndex: number, index: number): AgencyShadowComparison {
  const actor = world.characters[0];
  const former = world.characters[1];
  const army = world.armies[0];
  if (!actor || !former || !army) throw new Error('shadow comparison cap audit requires two characters and an army');
  const eventId = `event_continuity_cap_${branchIndex}_${index}`;
  const factId = `fact_continuity_cap_${branchIndex}_${index}`;
  return {
    id: `comparison_continuity_cap_${branchIndex}_${index}`,
    recordedOrdinal: 10_000 + branchIndex * 100 + index,
    turn: world.turn,
    beforeWorldHash: world.hash,
    afterWorldHash: stableHash(['continuity-cap-after', world.hash]),
    actorId: actor.id,
    actorLabel: actor.name,
    targetId: army.id,
    targetLabel: army.name,
    status: 'legacy-only',
    suggestion: null,
    legacy: {
      turn: world.turn,
      eventId,
      appointmentFactId: factId,
      actorId: actor.id,
      actorLabel: actor.name,
      formerCommanderId: former.id,
      formerCommanderLabel: former.name,
      armyId: army.id,
      armyLabel: army.name,
    },
    sourceFactIds: [factId],
    sourceEventIds: [eventId],
  };
}

function exerciseShadowCaps(world: WorldState): void {
  let ledger = createAgencyShadowLedger();
  let branchId = '';
  for (let index = 0; index < MAX_AGENCY_SHADOW_BRANCHES + 3; index += 1) {
    const opened = attachAgencyShadowBranch(ledger, world, index % 2 === 0 ? 'create' : 'import');
    ledger = opened.ledger;
    branchId = opened.branchId;
  }
  metrics.branchCapChecks += 1;
  check(ledger.branches.length === MAX_AGENCY_SHADOW_BRANCHES, world.seed, world.turn, 'branch cap was not enforced');
  check(ledger.branches.some((branch) => branch.id === branchId), world.seed, world.turn, 'newest branch was evicted');

  ledger = ensureAgencyShadowCharacters(ledger, branchId, world, world.characters.map((character) => character.id));
  metrics.characterCapChecks += 1;
  const active = ledger.branches.find((branch) => branch.id === branchId);
  check(active?.projections.length === MAX_AGENCY_SHADOW_CHARACTERS, world.seed, world.turn, 'tracked-character cap was not enforced');

  for (let index = 0; index < MAX_AGENCY_SHADOW_RESTORE_POINTS + 3; index += 1) {
    ledger = bindAgencyShadowRestorePoint(
      ledger,
      branchId,
      world,
      `collection:cap-${index}`,
      world.characters.slice(0, 10).map((character) => character.id),
    );
  }
  metrics.restorePointCapChecks += 1;
  check(ledger.restorePoints.length === MAX_AGENCY_SHADOW_RESTORE_POINTS, world.seed, world.turn, 'restore-point cap was not enforced');
  check(
    ledger.restorePoints.every((point) => point.projections.length <= MAX_AGENCY_SHADOW_RESTORE_CHARACTERS),
    world.seed,
    world.turn,
    'restore snapshot exceeded its projection cap',
  );
  const boundedSerialization = serializeAgencyShadowLedger(ledger);
  check(
    boundedSerialization.length <= MAX_AGENCY_SHADOW_SERIALIZED_CHARS,
    world.seed,
    world.turn,
    'bounded shadow ledger exceeded serialized cap',
  );

  let comparisonLedger = createAgencyShadowLedger();
  for (let index = 0; index < MAX_AGENCY_SHADOW_BRANCHES; index += 1) {
    const opened = attachAgencyShadowBranch(comparisonLedger, world, 'create');
    comparisonLedger = opened.ledger;
  }
  comparisonLedger = {
    ...comparisonLedger,
    nextOrdinal: 20_000,
    branches: comparisonLedger.branches.map((branch, branchIndex) => ({
      ...branch,
      comparisons: Array.from({ length: 12 }, (_, index) => sampleComparison(world, branchIndex, index)),
    })),
  };
  const parsed = parseAgencyShadowLedger(JSON.stringify(comparisonLedger));
  metrics.comparisonCapChecks += 1;
  check(totalComparisons(parsed) === MAX_AGENCY_SHADOW_COMPARISONS, world.seed, world.turn, 'global comparison cap was not enforced');
  observeShadowPeaks(ledger);
  observeShadowPeaks(parsed);
}

function auditMemoryTamperRejection(world: WorldState): void {
  const memory = world.agencySystem.characters[0]?.memories[0];
  if (!memory) return;
  const tampered = JSON.parse(serializeWorld(world)) as WorldState;
  const target = tampered.agencySystem.characters[0]?.memories[0];
  if (!target) return;
  target.salience = Math.max(0, target.salience - 1);
  let rejected = false;
  try {
    deserializeWorld(JSON.stringify(tampered));
  } catch {
    rejected = true;
  }
  metrics.memoryTamperRejections += 1;
  check(rejected, world.seed, world.turn, 'tampered PersonalMemory was not rejected by save hash');
}

function runSeed(seed: string): SeedSample {
  let world = createWorld(seed);
  auditAuthoritativeMemory(world);
  const opened = attachAgencyShadowBranch(createAgencyShadowLedger(), world, 'create');
  let ledger = opened.ledger;
  let branchId = opened.branchId;
  let tracked = trackedCharacterIds(world);
  ledger = ensureAgencyShadowCharacters(ledger, branchId, world, tracked);
  ledger = bindAgencyShadowRestorePoint(ledger, branchId, world, 'autosave', tracked);
  ledger = roundtripShadow(ledger, branchId, seed, world.turn);
  let checkpointWorld: string | null = null;
  let memoryTamperAudited = false;
  const restoreAt = Math.max(1, Math.min(turns - 1, Math.floor(turns / 2)));
  const saveAt = Math.max(0, Math.min(turns - 1, Math.floor(turns / 3)));

  for (let index = 0; index < turns; index += 1) {
    auditAuthoritativeMemory(world);
    const beforeSerialization = serializeWorld(world);
    const beforeHash = world.hash;
    tracked = trackedCharacterIds(world);
    ledger = ensureAgencyShadowCharacters(ledger, branchId, world, tracked);
    prepareAgencyShadowTurn(ledger, branchId, world, tracked);

    if (index === saveAt) {
      ledger = bindAgencyShadowRestorePoint(ledger, branchId, world, 'collection:audit', tracked);
      ledger = copyAgencyShadowRestorePoint(ledger, 'collection:audit', 'collection:audit-copy');
      checkpointWorld = beforeSerialization;
      metrics.copiedRestoreChecks += 1;
      const source = ledger.restorePoints.find((point) => point.token === 'collection:audit');
      const copy = ledger.restorePoints.find((point) => point.token === 'collection:audit-copy');
      check(
        Boolean(source && copy && JSON.stringify(source.anchor) === JSON.stringify(copy.anchor)
          && JSON.stringify(source.projections) === JSON.stringify(copy.projections)),
        seed,
        world.turn,
        'copied collection token did not preserve its exact snapshot',
      );
    }

    if (index === restoreAt) {
      const restored = attachAgencyShadowBranch(ledger, world, 'restore', 'autosave');
      metrics.exactRestoreChecks += 1;
      check(restored.restored, seed, world.turn, 'exact autosave token did not restore');
      ledger = restored.ledger;
      branchId = restored.branchId;
      const wrongHash = structuredClone(world);
      wrongHash.hash = stableHash(['wrong-shadow-anchor', world.hash]);
      const wrongHashResult = attachAgencyShadowBranch(ledger, wrongHash, 'restore', 'autosave');
      const wrongTurn = structuredClone(world);
      wrongTurn.turn += 1;
      wrongTurn.hash = stableHash(['wrong-shadow-turn', world.hash]);
      const wrongTurnResult = attachAgencyShadowBranch(ledger, wrongTurn, 'restore', 'autosave');
      const wrongTokenResult = attachAgencyShadowBranch(ledger, world, 'restore', 'missing-token');
      metrics.rejectedRestoreChecks += 3;
      check(!wrongHashResult.restored, seed, world.turn, 'restore accepted a different hash');
      check(!wrongTurnResult.restored, seed, world.turn, 'restore accepted a different turn');
      check(!wrongTokenResult.restored, seed, world.turn, 'restore accepted a missing token');

      const freshCreate = attachAgencyShadowBranch(ledger, world, 'create', 'autosave');
      const freshImport = attachAgencyShadowBranch(ledger, world, 'import', 'autosave');
      check(!freshCreate.restored && !freshImport.restored, seed, world.turn, 'create/import reused restore continuity');
      check(
        getAgencyShadowProjection(freshCreate.ledger, freshCreate.branchId, tracked[0] ?? '') === null,
        seed,
        world.turn,
        'create branch inherited a saved projection',
      );

      const intervention = structuredClone(world);
      const actor = intervention.characters.find((character) => character.id === tracked[0]);
      if (actor) actor.caution = actor.caution === 100 ? 99 : actor.caution + 1;
      intervention.hash = computeWorldHash(intervention);
      const forked = forkAgencyShadowIntervention(ledger, branchId, world, intervention);
      metrics.interventionForkChecks += 1;
      const child = forked.ledger.branches.find((branch) => branch.id === forked.branchId);
      check(
        Boolean(child && child.head.seed === world.seed && child.head.turn === world.turn
          && child.head.hash === intervention.hash && child.parent?.branchId === branchId),
        seed,
        world.turn,
        'same-turn intervention did not form an exact child branch',
      );
    }

    ledger = roundtripShadow(ledger, branchId, seed, world.turn);
    auditShadowPurity(world, beforeSerialization, beforeHash, 'shadow prepare/save/restore');

    const restoredWorld = index === restoreAt ? deserializeWorld(beforeSerialization) : null;
    if (restoredWorld) {
      metrics.memorySaveRoundtrips += 1;
      check(restoredWorld.hash === world.hash, seed, world.turn, 'world save roundtrip changed hash');
      check(
        stableHash(restoredWorld.agencySystem) === stableHash(world.agencySystem),
        seed,
        world.turn,
        'world save roundtrip changed authoritative PersonalMemory',
      );
    }

    const after = advanceWorld(world);
    metrics.advancedQuarters += 1;
    if (restoredWorld) {
      const afterRestore = advanceWorld(restoredWorld);
      metrics.memoryContinuationChecks += 1;
      check(afterRestore.hash === after.hash, seed, after.turn, 'continued save produced a different hash');
      check(serializeWorld(afterRestore) === serializeWorld(after), seed, after.turn, 'continued save produced a different world');
    }
    const shadowAdvance = advanceAgencyShadowBranch(ledger, branchId, world, after, tracked);
    auditShadowPurity(world, beforeSerialization, beforeHash, 'shadow adjacent advance');
    ledger = shadowAdvance.ledger;
    branchId = shadowAdvance.branchId;
    world = after;
    auditAuthoritativeMemory(world);
    if (!memoryTamperAudited && world.agencySystem.characters.some((entry) => entry.memories.length > 0)) {
      auditMemoryTamperRejection(world);
      memoryTamperAudited = true;
    }
    tracked = trackedCharacterIds(world);
    ledger = ensureAgencyShadowCharacters(ledger, branchId, world, tracked);
    ledger = bindAgencyShadowRestorePoint(ledger, branchId, world, 'autosave', tracked);
    ledger = roundtripShadow(ledger, branchId, seed, world.turn);
  }

  if (checkpointWorld) {
    const checkpoint = deserializeWorld(checkpointWorld);
    const sourceRestore = attachAgencyShadowBranch(ledger, checkpoint, 'restore', 'collection:audit');
    const copyRestore = attachAgencyShadowBranch(ledger, checkpoint, 'restore', 'collection:audit-copy');
    metrics.exactRestoreChecks += 2;
    check(sourceRestore.restored, seed, checkpoint.turn, 'non-current collection token did not restore exactly');
    check(copyRestore.restored, seed, checkpoint.turn, 'copied non-current collection token did not restore exactly');
  }

  observeShadowPeaks(ledger);
  const memoryCount = world.agencySystem.characters.reduce((sum, entry) => sum + entry.memories.length, 0);
  return {
    seed,
    finalTurn: world.turn,
    finalHash: world.hash,
    memoryAccounts: world.agencySystem.characters.length,
    memoryCount,
    shadowBranches: ledger.branches.length,
    restorePoints: ledger.restorePoints.length,
    shadowComparisons: totalComparisons(ledger),
    shadowDigest: stableHash(JSON.parse(serializeAgencyShadowLedger(ledger))),
  };
}

exerciseMemoryCaps();
exerciseShadowCaps(createWorld('C09发布上限审计'));

const samples: SeedSample[] = [];
for (const seed of seeds) {
  try {
    samples.push(runSeed(seed));
  } catch (error) {
    fail(seed, -1, `audit aborted: ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log(JSON.stringify({
  phase: 'C08-C09',
  scope: {
    seeds: seeds.length,
    quartersPerSeed: turns,
    totalAdvancedQuarters: metrics.advancedQuarters,
  },
  contract: {
    authoritativeMemory: {
      maximumPerCharacter: MAX_PERSONAL_MEMORIES,
      maximumPinnedPerCharacter: MAX_PINNED_PERSONAL_MEMORIES,
      maximumSourceFacts: MAX_PERSONAL_MEMORY_SOURCE_FACTS,
      maximumSubjects: MAX_PERSONAL_MEMORY_SUBJECTS,
      owner: 'WorldState.agencySystem',
    },
    observerShadow: {
      maximumBranches: MAX_AGENCY_SHADOW_BRANCHES,
      maximumTrackedCharacters: MAX_AGENCY_SHADOW_CHARACTERS,
      maximumRestorePoints: MAX_AGENCY_SHADOW_RESTORE_POINTS,
      maximumRestoreCharacters: MAX_AGENCY_SHADOW_RESTORE_CHARACTERS,
      maximumComparisons: MAX_AGENCY_SHADOW_COMPARISONS,
      maximumSerializedChars: MAX_AGENCY_SHADOW_SERIALIZED_CHARS,
      owner: 'local observer ledger outside WorldState/hash',
    },
  },
  metrics,
  samples,
  failureCount,
  failures,
  omittedFailures: Math.max(0, failureCount - failures.length),
}, null, 2));

if (failureCount > 0) process.exitCode = 1;
