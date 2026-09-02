import {
  advanceWorld,
  createWorld,
  serializeWorld,
  stableHash,
  type WorldState,
} from '../src/sim';
import {
  OBSERVER_LEAD_RESOLUTION_ECHO_TURNS,
  OBSERVER_LEAD_VISIBILITY_THRESHOLD,
  deriveObserverLeads,
  type ObserverLead,
} from '../src/view/observer-leads';
import {
  MAX_OBSERVER_SITUATION_PAUSE_CANDIDATES,
  createObserverDeskSettings,
  evaluateObserverPause,
  worldToSituationPauseCandidates,
} from '../src/view/v1-observer';

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
const MAX_REPORTED_FAILURES = 200;

function positiveIntegerFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer, received ${raw}`);
  return value;
}

const configuredSeeds = process.env.PHASE_C_AUDIT_SEEDS
  ?.split(',')
  .map((seed) => seed.trim())
  .filter(Boolean);
const seeds = configuredSeeds?.length ? configuredSeeds : [...DEFAULT_SEEDS];
const turns = positiveIntegerFromEnv('PHASE_C_AUDIT_TURNS', 80);
const failures: string[] = [];
let failureCount = 0;

interface Metrics {
  projectionCheckpoints: number;
  projectionPurityChecks: number;
  projectionDeterminismChecks: number;
  primaryEvidencePairChecks: number;
  situationLeadChecks: number;
  factLeadChecks: number;
  sparseCheckpoints: number;
  pauseCheckpoints: number;
  pauseCandidates: number;
  pauseAuthorityChecks: number;
  projectionTimingsMs: number[];
}

interface SequenceEntry {
  turn: number;
  worldHash: string;
  leadDigest: string;
  leadIds: string[];
}

function createMetrics(): Metrics {
  return {
    projectionCheckpoints: 0,
    projectionPurityChecks: 0,
    projectionDeterminismChecks: 0,
    primaryEvidencePairChecks: 0,
    situationLeadChecks: 0,
    factLeadChecks: 0,
    sparseCheckpoints: 0,
    pauseCheckpoints: 0,
    pauseCandidates: 0,
    pauseAuthorityChecks: 0,
    projectionTimingsMs: [],
  };
}

function fail(seed: string, turn: number, message: string): void {
  failureCount += 1;
  if (failures.length < MAX_REPORTED_FAILURES) failures.push(`${seed}@T${turn}: ${message}`);
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function targetExists(world: WorldState, lead: ObserverLead): boolean {
  if (lead.target.kind === 'person') return world.characters.some((item) => item.id === lead.target.id);
  if (lead.target.kind === 'country') return world.polities.some((item) => item.id === lead.target.id);
  return world.regions.some((item) => item.id === lead.target.id);
}

function situationOnlySettings(situationId: string) {
  const defaults = createObserverDeskSettings();
  return {
    ...defaults,
    watchlist: [{ kind: 'situation' as const, id: situationId, label: situationId, detail: 'Phase C audit', alert: false }],
    pauseRules: {
      ...defaults.pauseRules,
      enabled: true,
      majorHistory: false,
      wars: false,
      powerTransfers: false,
      outbreaks: false,
      watchlistHits: false,
      situationChanges: true,
    },
  };
}

function auditPauseCandidates(world: WorldState, metrics: Metrics): void {
  const before = serializeWorld(world);
  const first = worldToSituationPauseCandidates(world);
  const repeated = worldToSituationPauseCandidates(world);
  metrics.pauseCheckpoints += 1;
  if (json(first) !== json(repeated)) fail(world.seed, world.turn, 'Situation pause projection is not deterministic');
  if (serializeWorld(world) !== before) fail(world.seed, world.turn, 'Situation pause projection mutated the world');
  if (first.length > MAX_OBSERVER_SITUATION_PAUSE_CANDIDATES) {
    fail(world.seed, world.turn, `Situation pause candidates exceeded ${MAX_OBSERVER_SITUATION_PAUSE_CANDIDATES}`);
  }
  const reportFactIds = new Set(world.lastTurn?.factIds ?? []);
  for (const candidate of first) {
    metrics.pauseCandidates += 1;
    metrics.pauseAuthorityChecks += 1;
    const fact = world.facts.find((item) => item.id === candidate.sourceFactId);
    const situation = world.situationSystem.situations.find((item) => item.id === candidate.situationId);
    if (!fact || !reportFactIds.has(fact.id) || fact.turn !== world.lastTurn?.turn) {
      fail(world.seed, world.turn, `${candidate.id} is not anchored to a current-quarter Fact`);
    }
    if (!situation
      || candidate.refs.length !== 1
      || candidate.refs[0]?.kind !== 'situation'
      || candidate.refs[0].id !== situation.id) {
      fail(world.seed, world.turn, `${candidate.id} does not retain one exact Situation identity`);
      continue;
    }
    const match = evaluateObserverPause(situationOnlySettings(situation.id), [candidate]);
    if (!match
      || match.rule !== 'situationChanges'
      || match.situationId !== situation.id
      || match.sourceFactId !== fact?.id) {
      fail(world.seed, world.turn, `${candidate.id} lost Situation/Fact identity during pause evaluation`);
    }
    if (evaluateObserverPause(situationOnlySettings(`${situation.id}:wrong`), [candidate]) !== null) {
      fail(world.seed, world.turn, `${candidate.id} matched the wrong watched Situation`);
    }
  }
}

function auditLead(world: WorldState, lead: ObserverLead, metrics: Metrics): void {
  if (!targetExists(world, lead)) fail(world.seed, world.turn, `${lead.id} targets a missing entity`);
  if (!lead.question.endsWith('？') || lead.evidence.length !== 2 || lead.evidence.some((line) => !line.trim())) {
    fail(world.seed, world.turn, `${lead.id} does not contain one concrete question and two evidence lines`);
  }
  if (!lead.primarySceneId || lead.primarySourceFactIds.some((id) => !world.facts.some((fact) => fact.id === id))) {
    fail(world.seed, world.turn, `${lead.id} does not retain valid principal evidence identity`);
  }
  if (lead.source === 'fact') {
    metrics.factLeadChecks += 1;
    const reportFactIds = new Set(world.lastTurn?.factIds ?? []);
    if (!lead.factId || !reportFactIds.has(lead.factId) || !world.facts.some((fact) => fact.id === lead.factId)) {
      fail(world.seed, world.turn, `${lead.id} is not anchored to a current-quarter Fact`);
    }
    if (lead.situationId !== null || lead.displayMode !== 'fact') {
      fail(world.seed, world.turn, `${lead.id} mixes Fact and Situation identities`);
    }
    return;
  }

  metrics.situationLeadChecks += 1;
  const situation = world.situationSystem.situations.find((item) => item.id === lead.situationId);
  if (!situation || lead.id !== `lead-situation:${situation.id}` || lead.situationType !== situation.type) {
    fail(world.seed, world.turn, `${lead.id} does not reference one retained Situation`);
    return;
  }
  if (situation.visibility < OBSERVER_LEAD_VISIBILITY_THRESHOLD) {
    fail(world.seed, world.turn, `${lead.id} exposes a hidden Situation`);
  }
  if (lead.displayMode === 'tracking' && situation.status !== 'open') {
    fail(world.seed, world.turn, `${lead.id} tracks a resolved Situation as open`);
  }
  if (lead.displayMode === 'resolution_echo') {
    const age = situation.resolvedTurn === null ? Number.POSITIVE_INFINITY : world.turn - situation.resolvedTurn;
    if (situation.status !== 'resolved' || age < 0 || age > OBSERVER_LEAD_RESOLUTION_ECHO_TURNS) {
      fail(world.seed, world.turn, `${lead.id} carries an expired resolution echo`);
    }
  }
}

function auditProjection(world: WorldState, metrics: Metrics): ObserverLead[] {
  const beforeHash = world.hash;
  const beforeFactDigest = world.factDigest;
  const beforeHistoryDigest = world.historyDigest;
  const before = serializeWorld(world);
  const startedAt = performance.now();
  const leads = deriveObserverLeads(world);
  metrics.projectionTimingsMs.push(performance.now() - startedAt);
  const repeated = deriveObserverLeads(world);
  metrics.projectionCheckpoints += 1;
  metrics.projectionPurityChecks += 1;
  metrics.projectionDeterminismChecks += 1;
  if (json(leads) !== json(repeated)) fail(world.seed, world.turn, 'lead projection is not deterministic');
  if (leads.length < 3) metrics.sparseCheckpoints += 1;
  if (leads.length > 3 || new Set(leads.map((lead) => lead.id)).size !== leads.length) {
    fail(world.seed, world.turn, 'lead projection must contain at most three unique stories');
  }
  for (let index = 0; index < leads.length; index += 1) {
    for (let other = index + 1; other < leads.length; other += 1) {
      metrics.primaryEvidencePairChecks += 1;
      if (leads[index].primarySceneId === leads[other].primarySceneId) {
        fail(world.seed, world.turn, `${leads[index].id} and ${leads[other].id} repeat one principal scene`);
      }
      const otherFacts = new Set(leads[other].primarySourceFactIds);
      if (leads[index].primarySourceFactIds.some((id) => otherFacts.has(id))) {
        fail(world.seed, world.turn, `${leads[index].id} and ${leads[other].id} repeat one principal Fact`);
      }
    }
  }
  if (world.hash !== beforeHash
    || world.factDigest !== beforeFactDigest
    || world.historyDigest !== beforeHistoryDigest
    || serializeWorld(world) !== before) {
    fail(world.seed, world.turn, 'lead projection mutated authoritative world state');
  }
  leads.forEach((lead) => auditLead(world, lead, metrics));
  return leads;
}

function run(seed: string, audited: boolean): { world: WorldState; sequence: SequenceEntry[]; metrics: Metrics } {
  let world = createWorld(seed);
  const sequence: SequenceEntry[] = [];
  const metrics = createMetrics();
  for (let checkpoint = 0; checkpoint <= turns; checkpoint += 1) {
    if (checkpoint > 0) world = advanceWorld(world);
    if (audited) auditPauseCandidates(world, metrics);
    const leads = audited ? auditProjection(world, metrics) : deriveObserverLeads(world);
    sequence.push({
      turn: world.turn,
      worldHash: world.hash,
      leadDigest: stableHash(leads),
      leadIds: leads.map((lead) => lead.id),
    });
  }
  return { world, sequence, metrics };
}

function percentile(values: readonly number[], fraction: number): number {
  if (!values.length) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)] ?? 0;
}

const aggregate = createMetrics();
const samples = seeds.map((seed) => {
  try {
    const first = run(seed, true);
    const replay = run(seed, false);
    const deterministicReplay = first.world.hash === replay.world.hash && json(first.sequence) === json(replay.sequence);
    if (!deterministicReplay) fail(seed, first.world.turn, 'double run changed world hash or stateless lead sequence');
    for (const key of Object.keys(aggregate) as Array<keyof Metrics>) {
      if (key === 'projectionTimingsMs') aggregate[key].push(...first.metrics[key]);
      else (aggregate[key] as number) += first.metrics[key] as number;
    }
    return {
      seed,
      finalTurn: first.world.turn,
      finalHash: first.world.hash,
      sequenceDigest: stableHash(first.sequence),
      deterministicReplay,
    };
  } catch (error) {
    fail(seed, -1, `audit aborted: ${error instanceof Error ? error.message : String(error)}`);
    return { seed, finalTurn: 0, finalHash: '', sequenceDigest: '', deterministicReplay: false };
  }
});

console.log(JSON.stringify({
  phase: 'COMPACT01-observer-leads',
  scope: {
    seeds: seeds.length,
    quartersPerSeed: turns,
    projectionCheckpoints: aggregate.projectionCheckpoints,
    replayCheckpoints: seeds.length * (turns + 1),
  },
  contract: {
    maximumLeads: 3,
    visibilityThreshold: OBSERVER_LEAD_VISIBILITY_THRESHOLD,
    resolutionEchoQuarters: OBSERVER_LEAD_RESOLUTION_ECHO_TURNS,
    maximumSituationPauseCandidates: MAX_OBSERVER_SITUATION_PAUSE_CANDIDATES,
  },
  metrics: {
    projectionPurityChecks: aggregate.projectionPurityChecks,
    projectionDeterminismChecks: aggregate.projectionDeterminismChecks,
    primaryEvidencePairChecks: aggregate.primaryEvidencePairChecks,
    situationLeadChecks: aggregate.situationLeadChecks,
    factLeadChecks: aggregate.factLeadChecks,
    sparseCheckpoints: aggregate.sparseCheckpoints,
    situationPause: {
      checkpoints: aggregate.pauseCheckpoints,
      candidates: aggregate.pauseCandidates,
      authorityChecks: aggregate.pauseAuthorityChecks,
    },
    projectionTiming: {
      p50Ms: Number(percentile(aggregate.projectionTimingsMs, 0.5).toFixed(3)),
      p95Ms: Number(percentile(aggregate.projectionTimingsMs, 0.95).toFixed(3)),
      maxMs: Number(Math.max(0, ...aggregate.projectionTimingsMs).toFixed(3)),
    },
  },
  samples,
  failureCount,
  failures,
  omittedFailures: Math.max(0, failureCount - failures.length),
}, null, 2));

if (failureCount > 0) process.exitCode = 1;
