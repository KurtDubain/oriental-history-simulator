import {
  advanceWorldDetailed,
  computeWorldHash,
  createWorld,
  serializeWorld,
  type CharacterState,
  type WorldState,
} from '../src/sim';
import {
  ROOT_DESIRES,
  projectCharacterDesires,
  type RootDesire,
} from '../src/sim/agency';

const DEFAULT_SEEDS = [
  '军权春秋',
  '春战副将',
  '同源世界',
  '沧海一粟',
  '赤潮',
  '归档校验',
  '副将立功',
  '北境军令',
] as const;
const MAX_REPORTED_FAILURES = 120;
const SOURCE_KINDS = ['origin', 'personality', 'family', 'experience', 'seed'] as const;

function positiveIntegerFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, received ${raw}`);
  }
  return value;
}

const configuredSeeds = process.env.PHASE_C_AGENCY_AUDIT_SEEDS
  ?.split(',')
  .map((seed) => seed.trim())
  .filter(Boolean);
const seeds = configuredSeeds?.length ? configuredSeeds : [...DEFAULT_SEEDS];
const turns = positiveIntegerFromEnv('PHASE_C_AGENCY_AUDIT_TURNS', 80);
const representativeLimit = positiveIntegerFromEnv('PHASE_C_AGENCY_AUDIT_REPRESENTATIVES', 8);

const failures: string[] = [];
let failureCount = 0;
let projectionChecks = 0;
let purityChecks = 0;
const coreDesireCounts = Object.fromEntries(ROOT_DESIRES.map((kind) => [kind, 0])) as Record<RootDesire, number>;

function fail(seed: string, turn: number, message: string): void {
  failureCount += 1;
  if (failures.length < MAX_REPORTED_FAILURES) failures.push(`${seed}@T${turn}: ${message}`);
}

function check(condition: boolean, seed: string, turn: number, message: string): void {
  if (!condition) fail(seed, turn, message);
}

function representatives(world: WorldState): CharacterState[] {
  return world.characters
    .filter((person) => person.alive && person.age >= 16)
    .sort((left, right) => (
      right.influence - left.influence
      || right.renown - left.renown
      || left.id.localeCompare(right.id)
    ))
    .slice(0, representativeLimit);
}

function verifyProjection(world: WorldState, person: CharacterState): void {
  const projection = projectCharacterDesires(world, person.id);
  const repeated = projectCharacterDesires(world, person.id);
  projectionChecks += 1;

  check(JSON.stringify(repeated) === JSON.stringify(projection), world.seed, world.turn,
    `${person.id} repeated projection changed`);
  check(projection.authority === 'projection', world.seed, world.turn,
    `${person.id} authority must remain projection-only`);
  check(projection.axes.length === ROOT_DESIRES.length, world.seed, world.turn,
    `${person.id} must expose all root desires`);
  check(new Set(projection.axes.map((axis) => axis.kind)).size === ROOT_DESIRES.length,
    world.seed, world.turn, `${person.id} has duplicate desire axes`);
  check(projection.coreDesireKinds.length === 2, world.seed, world.turn,
    `${person.id} must expose exactly two core desires`);
  check(projection.axes.filter((axis) => axis.core).length === 2, world.seed, world.turn,
    `${person.id} must mark exactly two axes as core`);
  check(projection.pressures.length <= 4, world.seed, world.turn,
    `${person.id} exposes too many current pressures`);

  for (const kind of projection.coreDesireKinds) coreDesireCounts[kind] += 1;
  for (const [index, axis] of projection.axes.entries()) {
    check(axis.weight >= 0 && axis.weight <= 100, world.seed, world.turn,
      `${person.id}/${axis.kind} weight escaped 0..100`);
    check(axis.rank === index + 1, world.seed, world.turn,
      `${person.id}/${axis.kind} rank does not match stable order`);
    check(axis.sources.map((source) => source.kind).join(',') === SOURCE_KINDS.join(','),
      world.seed, world.turn, `${person.id}/${axis.kind} source contract changed`);
    check(axis.sources.every((source) => source.sourceFactIds.length === new Set(source.sourceFactIds).size),
      world.seed, world.turn, `${person.id}/${axis.kind} contains duplicate source facts`);
  }
}

const seedResults: Array<{ seed: string; finalTurn: number; finalHash: string; sampledPeople: number }> = [];
for (const seed of seeds) {
  let world = createWorld(seed);
  let sampledPeople = 0;
  for (let quarter = 0; quarter <= turns; quarter += 1) {
    const beforeSerialized = serializeWorld(world);
    const beforeHash = computeWorldHash(world);
    const people = representatives(world);
    for (const person of people) verifyProjection(world, person);
    sampledPeople += people.length;
    purityChecks += 1;
    check(serializeWorld(world) === beforeSerialized, seed, world.turn,
      'desire projection mutated serialized world state');
    check(computeWorldHash(world) === beforeHash, seed, world.turn,
      'desire projection mutated authoritative world hash');
    if (quarter < turns) world = advanceWorldDetailed(world).world;
  }
  seedResults.push({ seed, finalTurn: world.turn, finalHash: world.hash, sampledPeople });
}

const result = {
  audit: 'C06-desire-projection',
  seeds: seeds.length,
  turns,
  representativeLimit,
  projectionChecks,
  purityChecks,
  coreDesireCounts,
  seedResults,
  failureCount,
  failures,
};

console.log(JSON.stringify(result, null, 2));
if (failureCount > 0) process.exitCode = 1;
