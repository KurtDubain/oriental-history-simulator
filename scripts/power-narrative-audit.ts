import { advanceWorld, createWorld, serializeWorld, type SimulationFact } from '../src/sim';
import { calculateFactionPowerLedger } from '../src/sim/politics/power-ledger';
import { projectHistoricalScenes, projectSituationHistoricalScenes } from '../src/view/historical-scenes';

const DEFAULT_SEEDS = ['权势资源账', '军权春秋', '关河旧梦', '东海风云'] as const;
const turns = Number(process.env.POWER_NARRATIVE_AUDIT_TURNS ?? 64);
const configuredSeeds = process.env.POWER_NARRATIVE_AUDIT_SEEDS
  ?.split(',')
  .map((seed) => seed.trim())
  .filter(Boolean);
const seeds = configuredSeeds?.length ? configuredSeeds : [...DEFAULT_SEEDS];

if (!Number.isSafeInteger(turns) || turns <= 0) {
  throw new Error(`POWER_NARRATIVE_AUDIT_TURNS must be a positive integer, received ${turns}`);
}

interface AuditRow {
  seed: string;
  factions: number;
  saturatedFactions: number;
  resources: number;
  agencyResolutions: number;
  agencyScenes: number;
  situationScenes: number;
}

const failures: string[] = [];
const rows: AuditRow[] = [];

function fail(seed: string, message: string): void {
  if (failures.length < 100) failures.push(`${seed}: ${message}`);
}

function hasConcreteAction(text: string): boolean {
  return /开战|交战|取胜|守住|停战|议和|占得上风|易手|接管|争取|答应|观望|请领|请掌|应允|安抚|削权|撤去|受任|出任|去职|去世|成婚|暂缓|未准|推举|推为|继任|离任|离开领袖位置|更换领袖/u.test(text);
}

for (const seed of seeds) {
  let world = createWorld(seed);
  for (let turn = 0; turn < turns; turn += 1) world = advanceWorld(world);
  const beforeProjection = serializeWorld(world);
  const factions = world.factions.filter((faction) => faction.active);
  let saturatedFactions = 0;
  let resourceCount = 0;
  for (const faction of factions) {
    const ledger = calculateFactionPowerLedger(world, faction);
    if (ledger.total !== faction.power) fail(seed, `${faction.id} stored power ${faction.power} != ledger ${ledger.total}`);
    if (ledger.total >= 98) saturatedFactions += 1;
    resourceCount += ledger.resources.length;
    if (ledger.resources.length > 48) fail(seed, `${faction.id} exceeds resource bound`);
    if (ledger.resources.some((resource) => resource.evidence.length === 0)) fail(seed, `${faction.id} has an asset without evidence`);
    if (ledger.categories.length !== 7) fail(seed, `${faction.id} does not expose all seven accounts`);
    for (const category of ledger.categories) {
      if (category.value > category.maximum + 0.1) fail(seed, `${faction.id}/${category.category} exceeds its cap`);
    }
  }
  if (factions.length > 0 && saturatedFactions / factions.length > 0.35) {
    fail(seed, `${saturatedFactions}/${factions.length} factions saturate near 100`);
  }

  const resolutions = world.facts.filter((fact): fact is Extract<SimulationFact, { kind: 'agency_intent_resolved' }> => (
    fact.kind === 'agency_intent_resolved'
  ));
  let agencyScenes = 0;
  for (const resolution of resolutions) {
    const scene = projectHistoricalScenes(world, [resolution], 1)[0];
    const actor = world.characters.find((character) => character.id === resolution.payload.actorId)?.name;
    const army = world.armies.find((item) => item.id === resolution.payload.targetArmyId)?.name
      ?? resolution.payload.targetArmyName;
    if (!scene || !actor || !army) {
      fail(seed, `${resolution.id} cannot project its named scene`);
      continue;
    }
    agencyScenes += 1;
    if (!scene.shortText.includes(actor) || !scene.shortText.includes(army) || !hasConcreteAction(scene.shortText)) {
      fail(seed, `${resolution.id} scene omits actor, army or concrete action`);
    }
    if (!scene.sourceFactIds.includes(resolution.id) || !scene.sourceFactIds.includes(resolution.payload.submissionFactId)) {
      fail(seed, `${resolution.id} scene loses request/resolution provenance`);
    }
    if (/起源|进入发展|阶段转折|结构信号/u.test(scene.shortText)) {
      fail(seed, `${resolution.id} scene leads with structural meta language`);
    }
  }

  let situationScenes = 0;
  for (const situation of world.situationSystem.situations) {
    const scene = projectSituationHistoricalScenes(world, situation, 1)[0];
    if (!scene) continue;
    situationScenes += 1;
    if (!hasConcreteAction(scene.shortText)) fail(seed, `${situation.id} first scene has no concrete action: ${scene.shortText}`);
    if (scene.sourceFactIds.length === 0) fail(seed, `${situation.id} scene has no Fact provenance`);
  }
  if (serializeWorld(world) !== beforeProjection) fail(seed, 'read-only projections mutated WorldState');
  rows.push({
    seed,
    factions: factions.length,
    saturatedFactions,
    resources: resourceCount,
    agencyResolutions: resolutions.length,
    agencyScenes,
    situationScenes,
  });
}

const totals = rows.reduce((sum, row) => ({
  factions: sum.factions + row.factions,
  saturatedFactions: sum.saturatedFactions + row.saturatedFactions,
  resources: sum.resources + row.resources,
  agencyResolutions: sum.agencyResolutions + row.agencyResolutions,
  agencyScenes: sum.agencyScenes + row.agencyScenes,
  situationScenes: sum.situationScenes + row.situationScenes,
}), { factions: 0, saturatedFactions: 0, resources: 0, agencyResolutions: 0, agencyScenes: 0, situationScenes: 0 });

if (totals.factions === 0) fail('aggregate', 'no active political faction was audited');
if (totals.resources === 0) fail('aggregate', 'no concrete political asset was audited');
if (totals.agencyResolutions === 0 || totals.agencyScenes !== totals.agencyResolutions) {
  fail('aggregate', 'natural request resolutions did not all become concrete scenes');
}
if (totals.situationScenes === 0) fail('aggregate', 'no Situation exposed a concrete scene');

console.log(JSON.stringify({
  phase: 'NAR01-NAR04/POL01',
  scope: { seeds: seeds.length, quartersPerSeed: turns },
  totals,
  rows,
  failures,
}, null, 2));

if (failures.length > 0) process.exitCode = 1;
