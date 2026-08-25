import {
  advanceWorld,
  createWorld,
  validateWorld,
  type WorldState,
} from '../src/sim';

const SEED_COUNT = 100;
const QUARTERS = 200;
const LONG_SEED_COUNT = 12;
const LONG_QUARTERS = 800;
const eventKinds = ['war_declared', 'battle', 'region_captured', 'rebellion', 'succession', 'polity_eliminated'] as const;

function assertQuarterState(world: WorldState, label: string): void {
  const invalidRegion = world.regions.find((region) => (
    !Number.isSafeInteger(region.population)
    || !Number.isSafeInteger(region.food)
    || !Number.isSafeInteger(region.wealth)
    || region.population < 0
    || region.food < 0
    || region.wealth < 0
  ));
  const invalidArmy = world.armies.find((army) => (
    !Number.isSafeInteger(army.soldiers)
    || !Number.isSafeInteger(army.food)
    || army.soldiers <= 0
    || army.food < 0
  ));
  const overCapacity = world.lastTurn?.logistics.routeUsage.find((usage) => usage.reserved > usage.capacity);
  if (invalidRegion || invalidArmy || overCapacity) {
    throw new Error(`${label} 基础守恒失败：${invalidRegion?.id ?? invalidArmy?.id ?? overCapacity?.routeId}`);
  }
}

const startedAt = performance.now();
const seenHashes = new Set<string>();
const occurrence = Object.fromEntries(eventKinds.map((kind) => [kind, 0])) as Record<(typeof eventKinds)[number], number>;
const totals = Object.fromEntries(eventKinds.map((kind) => [kind, 0])) as Record<(typeof eventKinds)[number], number>;
const finalPolityDistribution: Record<number, number> = {};
let unifiedWorlds = 0;
let fragmentedWorlds = 0;
let majorityWorlds = 0;

for (let seedIndex = 0; seedIndex < SEED_COUNT; seedIndex += 1) {
  const seed = `v01-audit-${String(seedIndex).padStart(3, '0')}`;
  let world = createWorld(seed);
  let minimumPolities = world.polities.filter((polity) => polity.alive).length;
  for (let turn = 0; turn < QUARTERS; turn += 1) {
    world = advanceWorld(world);
    assertQuarterState(world, `${seed}@${turn + 1}`);
    minimumPolities = Math.min(minimumPolities, world.polities.filter((polity) => polity.alive).length);
  }
  const violations = validateWorld(world);
  if (violations.length) throw new Error(`${seed}: ${violations.map((item) => item.message).join('；')}`);
  if (seenHashes.has(world.hash)) throw new Error(`${seed}: 最终世界哈希与其他种子重复`);
  seenHashes.add(world.hash);

  for (const event of world.history) {
    if (event.causes.length === 0) throw new Error(`${seed}: ${event.id} 缺少因果凭证`);
  }
  for (const kind of eventKinds) {
    const count = world.history.filter((event) => event.kind === kind).length;
    totals[kind] += count;
    if (count > 0) occurrence[kind] += 1;
  }

  const living = world.polities.filter((polity) => polity.alive);
  const finalCount = living.length;
  finalPolityDistribution[finalCount] = (finalPolityDistribution[finalCount] ?? 0) + 1;
  const largest = Math.max(...living.map((polity) => polity.controlledRegionIds.length));
  if (finalCount === 1 || minimumPolities === 1) unifiedWorlds += 1;
  if (finalCount >= 4) fragmentedWorlds += 1;
  if (largest > world.regions.length / 2) majorityWorlds += 1;
}

if (unifiedWorlds === 0) throw new Error('百种子中没有出现统一样本');
if (fragmentedWorlds === 0) throw new Error('百种子中没有出现长期割据样本');
for (const kind of eventKinds) {
  if (occurrence[kind] === 0) throw new Error(`百种子中未出现 ${kind}`);
}

const longFinalDistribution: Record<number, number> = {};
let longUnifiedWorlds = 0;
let longFragmentedWorlds = 0;

for (let seedIndex = 0; seedIndex < LONG_SEED_COUNT; seedIndex += 1) {
  const seed = `audit-long-${String(seedIndex).padStart(2, '0')}`;
  let world = createWorld(seed);
  let minimumPolities = world.polities.filter((polity) => polity.alive).length;
  for (let turn = 0; turn < LONG_QUARTERS; turn += 1) {
    world = advanceWorld(world);
    assertQuarterState(world, `${seed}@${turn + 1}`);
    minimumPolities = Math.min(minimumPolities, world.polities.filter((polity) => polity.alive).length);
  }
  const violations = validateWorld(world);
  if (violations.length) throw new Error(`${seed}: ${violations.map((item) => item.message).join('；')}`);

  const finalCount = world.polities.filter((polity) => polity.alive).length;
  longFinalDistribution[finalCount] = (longFinalDistribution[finalCount] ?? 0) + 1;
  if (minimumPolities === 1) longUnifiedWorlds += 1;
  if (finalCount >= 2) longFragmentedWorlds += 1;
}

if (longUnifiedWorlds === 0) throw new Error('长期样本中没有出现统一世界');
if (longFragmentedWorlds === 0) throw new Error('长期样本中没有保留割据世界');

process.stdout.write(`${JSON.stringify({
  seeds: SEED_COUNT,
  quartersPerSeed: QUARTERS,
  elapsedSeconds: Number(((performance.now() - startedAt) / 1_000).toFixed(2)),
  uniqueHashes: seenHashes.size,
  occurrence,
  eventTotals: totals,
  finalPolityDistribution,
  unifiedWorlds,
  fragmentedWorlds,
  majorityWorlds,
  longRun: {
    seeds: LONG_SEED_COUNT,
    quartersPerSeed: LONG_QUARTERS,
    finalPolityDistribution: longFinalDistribution,
    unifiedWorlds: longUnifiedWorlds,
    fragmentedWorlds: longFragmentedWorlds,
  },
}, null, 2)}\n`);
