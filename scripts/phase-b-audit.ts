import {
  advanceWorldDetailed,
  createWorld,
  deserializeWorld,
  measureFullValidation,
  measureRuntimeValidation,
  serializeWorld,
  stableHash,
  type SimulationFact,
  type WorldState,
} from '../src/sim';

const seeds = process.env.PHASE_B_AUDIT_SEEDS?.split(',').map((seed) => seed.trim()).filter(Boolean)
  ?? ['军权春秋', '春战副将', '同源世界', '沧海一粟', '赤潮', '归档校验', '副将立功', '北境军令'];
const turns = Math.max(8, Number.parseInt(process.env.PHASE_B_AUDIT_TURNS ?? '80', 10));

interface SituationSequenceEntry {
  turn: number;
  ids: string[];
  digest: string;
}

interface AuditRun {
  world: WorldState;
  sequence: SituationSequenceEntry[];
  maxOpen: number;
  maxCandidates: number;
  failures: string[];
}

function auditMilestoneFact(world: WorldState, fact: Extract<SimulationFact, { kind: 'situation_milestone' }>): string[] {
  const failures: string[] = [];
  const factById = new Map(world.facts.map((item) => [item.id, item]));
  if (fact.sourceFactIds.length === 0) failures.push(`${fact.id}没有来源事实`);
  for (const sourceFactId of fact.sourceFactIds) {
    const source = factById.get(sourceFactId);
    if (!source || source.turn > fact.turn || source.id === fact.id) {
      failures.push(`${fact.id}引用无效来源${sourceFactId}`);
    }
  }
  return failures;
}

function run(seed: string): AuditRun {
  let world = createWorld(seed);
  let maxOpen = 0;
  let maxCandidates = 0;
  const sequence: SituationSequenceEntry[] = [];
  const failures: string[] = [];
  for (let index = 0; index < turns; index += 1) {
    const previous = world;
    world = advanceWorldDetailed(world).world;
    const runtime = measureRuntimeValidation(previous, world);
    if (runtime.violations.length > 0) {
      failures.push(`T${world.turn} ${runtime.violations[0]?.code}: ${runtime.violations[0]?.message}`);
    }
    const open = world.situationSystem.situations.filter((situation) => situation.status === 'open');
    maxOpen = Math.max(maxOpen, open.length);
    maxCandidates = Math.max(maxCandidates, world.situationSystem.candidates.length);
    if (open.length > 12) failures.push(`T${world.turn}开放局势超过12`);
    if (world.situationSystem.candidates.length > 64) failures.push(`T${world.turn}候选局势超过64`);
    sequence.push({
      turn: world.turn,
      ids: open.map((situation) => situation.id),
      digest: stableHash(world.situationSystem),
    });
    if (world.turn % 20 === 0 || index === turns - 1) {
      const full = measureFullValidation(world);
      if (full.violations.length > 0) {
        failures.push(`T${world.turn} ${full.violations[0]?.code}: ${full.violations[0]?.message}`);
      }
    }
  }
  for (const fact of world.facts) {
    if (fact.kind === 'situation_milestone') failures.push(...auditMilestoneFact(world, fact));
  }
  return { world, sequence, maxOpen, maxCandidates, failures };
}

const failures: string[] = [];
const samples = seeds.map((seed) => {
  const first = run(seed);
  const second = run(seed);
  if (first.world.hash !== second.world.hash
    || serializeWorld(first.world) !== serializeWorld(second.world)
    || JSON.stringify(first.sequence) !== JSON.stringify(second.sequence)) {
    failures.push(`${seed}: 同种子局势序列不确定`);
  }
  failures.push(...first.failures.map((failure) => `${seed}: ${failure}`));

  const splitTurn = Math.floor(turns / 2);
  let resumed = createWorld(seed);
  for (let index = 0; index < splitTurn; index += 1) resumed = advanceWorldDetailed(resumed).world;
  resumed = deserializeWorld(serializeWorld(resumed));
  for (let index = splitTurn; index < turns; index += 1) resumed = advanceWorldDetailed(resumed).world;
  if (resumed.hash !== first.world.hash || serializeWorld(resumed) !== serializeWorld(first.world)) {
    failures.push(`${seed}: 存档边界后局势演化分叉`);
  }

  const milestoneFacts = first.world.facts.filter((fact) => fact.kind === 'situation_milestone');
  const transitions = {
    formed: milestoneFacts.filter((fact) => fact.payload.transition === 'formed').length,
    phaseChanged: milestoneFacts.filter((fact) => fact.payload.transition === 'phase_changed').length,
    resolved: milestoneFacts.filter((fact) => fact.payload.transition === 'resolved').length,
  };
  const firstSituation = first.world.situationSystem.situations[0];
  return {
    seed,
    finalHash: first.world.hash,
    candidatesPeak: first.maxCandidates,
    openPeak: first.maxOpen,
    retainedSituations: first.world.situationSystem.situations.length,
    archivedResolved: first.world.situationSystem.archive.resolvedCount,
    transitions,
    firstSituation: firstSituation ? {
      id: firstSituation.id,
      phase: firstSituation.phase,
      status: firstSituation.status,
      actorId: firstSituation.participants.coreCharacterIds[0] ?? null,
      polityId: firstSituation.participants.polityIds[0] ?? null,
      causalFacts: firstSituation.causalFactIds.length,
      milestoneFacts: firstSituation.milestoneFactIds.length,
      nextWatch: firstSituation.nextWatch.key,
    } : null,
  };
});

if (!samples.some((sample) => sample.transitions.formed > 0)) {
  failures.push('样本中没有自然形成任何军权危机');
}

console.log(JSON.stringify({
  phase: 'B01/B03',
  seeds: seeds.length,
  turnsPerSeed: turns,
  samples,
  failures,
}, null, 2));

if (failures.length > 0) process.exitCode = 1;
