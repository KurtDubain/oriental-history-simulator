import {
  advanceWorld,
  createWorld,
  serializeWorld,
  stableHash,
  type WorldState,
} from '../src/sim';
import {
  OBSERVER_LEAD_CHALLENGER_TURNS,
  OBSERVER_LEAD_MIN_TENURE_TURNS,
  OBSERVER_LEAD_RESOLUTION_ECHO_TURNS,
  OBSERVER_LEAD_VISIBILITY_THRESHOLD,
  deriveObserverLeadProjection,
  normalizeObserverLeadContinuity,
  type ObserverLead,
  type ObserverLeadContinuityState,
  type ObserverLeadProjection,
  type ObserverLeadSlot,
} from '../src/view/observer-leads';
import {
  createObserverDeskSettings,
  parseObserverDeskSettings,
  serializeObserverDeskSettings,
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

const LEAD_SLOTS: readonly ObserverLeadSlot[] = ['person', 'polity', 'tension'];
const SITUATION_TYPE_BY_SLOT: Readonly<Record<ObserverLeadSlot, string>> = {
  person: 'military_power_crisis',
  polity: 'inheritance_crisis',
  tension: 'war_progress',
};
const MAX_CONTINUITY_BYTES = 4 * 1024;
const MAX_REPORTED_FAILURES = 200;

function positiveIntegerFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, received ${raw}`);
  }
  return value;
}

const configuredSeeds = process.env.PHASE_C_AUDIT_SEEDS
  ?.split(',')
  .map((seed) => seed.trim())
  .filter(Boolean);
const seeds = configuredSeeds?.length ? configuredSeeds : [...DEFAULT_SEEDS];
const turns = positiveIntegerFromEnv('PHASE_C_AUDIT_TURNS', 80);

interface SlotMetrics {
  checkpoints: number;
  fallback: number;
  situationTracking: number;
  resolutionEcho: number;
  replacements: number;
  fallbackTenureRetentions: number;
  uniqueLeadIds: Set<string>;
}

interface MutableMetrics {
  projectionCheckpoints: number;
  idempotenceChecks: number;
  purityChecks: number;
  jsonRoundtripChecks: number;
  situationSourceChecks: number;
  fallbackChecks: number;
  continuityChecks: number;
  maximumContinuityBytes: number;
  projectionTimingsMs: number[];
  slots: Record<ObserverLeadSlot, SlotMetrics>;
}

interface SequenceEntry {
  turn: number;
  worldHash: string;
  projectionDigest: string;
  leads: Array<{
    slot: ObserverLeadSlot;
    id: string;
    source: NonNullable<ObserverLead['source']>;
    situationId: string | null;
    displayMode: NonNullable<ObserverLead['displayMode']>;
    selectedSinceTurn: number;
    retainThroughTurn: number;
    arbitrationReason: NonNullable<ObserverLead['arbitrationReason']>;
  }>;
  continuity: Array<{
    slot: ObserverLeadSlot;
    challengerId: string | null;
    challengerAheadTurns: number;
    decision: string;
  }>;
}

interface AuditRun {
  world: WorldState;
  sequence: SequenceEntry[];
  continuity: ObserverLeadContinuityState;
  metrics: MutableMetrics;
}

interface SeedSample {
  seed: string;
  completedQuarters: number;
  finalTurn: number;
  finalHash: string;
  sequenceDigest: string;
  replaySequenceDigest: string | null;
  deterministicReplay: boolean;
  maximumContinuityBytes: number;
  sourcesBySlot: Record<ObserverLeadSlot, {
    fallback: number;
    situationTracking: number;
    resolutionEcho: number;
    replacements: number;
    fallbackTenureRetentions: number;
    uniqueLeads: number;
  }>;
}

const failures: string[] = [];
let failureCount = 0;

function fail(seed: string, turn: number, message: string): void {
  failureCount += 1;
  if (failures.length < MAX_REPORTED_FAILURES) failures.push(`${seed}@T${turn}: ${message}`);
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return json(left) === json(right);
}

function createMetrics(): MutableMetrics {
  const slot = (): SlotMetrics => ({
    checkpoints: 0,
    fallback: 0,
    situationTracking: 0,
    resolutionEcho: 0,
    replacements: 0,
    fallbackTenureRetentions: 0,
    uniqueLeadIds: new Set<string>(),
  });
  return {
    projectionCheckpoints: 0,
    idempotenceChecks: 0,
    purityChecks: 0,
    jsonRoundtripChecks: 0,
    situationSourceChecks: 0,
    fallbackChecks: 0,
    continuityChecks: 0,
    maximumContinuityBytes: 0,
    projectionTimingsMs: [],
    slots: { person: slot(), polity: slot(), tension: slot() },
  };
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.min(ordered.length - 1, Math.max(0, Math.ceil(ordered.length * fraction) - 1));
  return ordered[index] ?? 0;
}

function timingSummary(values: readonly number[]) {
  return {
    samples: values.length,
    p50Ms: Number(percentile(values, 0.5).toFixed(3)),
    p95Ms: Number(percentile(values, 0.95).toFixed(3)),
    maxMs: Number(Math.max(0, ...values).toFixed(3)),
  };
}

function targetExists(world: WorldState, lead: ObserverLead): boolean {
  if (lead.target.kind === 'person') return world.characters.some((item) => item.id === lead.target.id);
  if (lead.target.kind === 'country') return world.polities.some((item) => item.id === lead.target.id);
  if (lead.target.kind === 'region') return world.regions.some((item) => item.id === lead.target.id);
  if (lead.target.kind === 'outbreak') return world.infections.some((item) => item.id === lead.target.id);
  return world.seaZones.some((item) => item.id === lead.target.id);
}

function persistedContinuity(
  world: WorldState,
  continuity: ObserverLeadContinuityState,
): ObserverLeadContinuityState {
  const settings = {
    ...createObserverDeskSettings(),
    leadContinuity: continuity,
  };
  const restored = parseObserverDeskSettings(serializeObserverDeskSettings(settings)).leadContinuity;
  if (!restored) {
    fail(world.seed, world.turn, 'ObserverDesk JSON roundtrip discarded valid continuity');
    return continuity;
  }
  return restored;
}

function auditContinuity(
  world: WorldState,
  projection: ObserverLeadProjection,
  metrics: MutableMetrics,
): void {
  const continuity = projection.continuity;
  const serialized = json(continuity);
  const bytes = new TextEncoder().encode(serialized).byteLength;
  metrics.maximumContinuityBytes = Math.max(metrics.maximumContinuityBytes, bytes);
  metrics.continuityChecks += 1;
  if (bytes > MAX_CONTINUITY_BYTES) {
    fail(world.seed, world.turn, `continuity grew to ${bytes} bytes (limit ${MAX_CONTINUITY_BYTES})`);
  }
  if (continuity.version !== 1
    || continuity.worldSeed !== world.seed
    || continuity.lastTurn !== world.turn
    || continuity.lastWorldHash !== world.hash) {
    fail(world.seed, world.turn, 'continuity anchor does not match seed/turn/world hash');
  }
  if (continuity.slots.length !== LEAD_SLOTS.length
    || new Set(continuity.slots.map((entry) => entry.slot)).size !== LEAD_SLOTS.length
    || LEAD_SLOTS.some((slot) => !continuity.slots.some((entry) => entry.slot === slot))) {
    fail(world.seed, world.turn, 'continuity must contain exactly one entry for each of the three slots');
  }
  const normalized = normalizeObserverLeadContinuity(JSON.parse(serialized) as unknown);
  if (!normalized || !jsonEqual(normalized, continuity)) {
    fail(world.seed, world.turn, 'continuity is not stable under bounded JSON normalization');
  }
  for (const entry of continuity.slots) {
    const lead = projection.leads.find((item) => item.slot === entry.slot);
    if (!lead || lead.id !== entry.leadId || (lead.situationId ?? null) !== entry.situationId) {
      fail(world.seed, world.turn, `${entry.slot} lead and continuity entry disagree`);
    }
    if (entry.selectedSinceTurn > world.turn
      || entry.retainThroughTurn !== entry.selectedSinceTurn + OBSERVER_LEAD_MIN_TENURE_TURNS - 1) {
      fail(world.seed, world.turn, `${entry.slot} has an invalid minimum-tenure window`);
    }
    if (entry.challengerAheadTurns < 0
      || entry.challengerAheadTurns > OBSERVER_LEAD_CHALLENGER_TURNS
      || (!entry.challengerId && entry.challengerAheadTurns !== 0)) {
      fail(world.seed, world.turn, `${entry.slot} has an unbounded challenger streak`);
    }
  }
}

function auditSituationLead(world: WorldState, lead: ObserverLead, metrics: MutableMetrics): void {
  metrics.situationSourceChecks += 1;
  if (!lead.situationId || lead.id !== `lead-situation:${lead.situationId}`) {
    fail(world.seed, world.turn, `${lead.slot} Situation lead has no stable Situation identity`);
    return;
  }
  const situation = world.situationSystem.situations.find((item) => item.id === lead.situationId);
  if (!situation) {
    fail(world.seed, world.turn, `${lead.slot} references missing Situation ${lead.situationId}`);
    return;
  }
  if (lead.situationType !== situation.type || SITUATION_TYPE_BY_SLOT[lead.slot] !== situation.type) {
    fail(world.seed, world.turn, `${lead.slot} references incompatible Situation type ${situation.type}`);
  }
  if (!targetExists(world, lead)) {
    fail(world.seed, world.turn, `${lead.slot} references missing target ${lead.target.kind}:${lead.target.id}`);
  }
  if (lead.displayMode === 'tracking') {
    metrics.slots[lead.slot].situationTracking += 1;
    if (situation.status !== 'open' || situation.visibility < OBSERVER_LEAD_VISIBILITY_THRESHOLD) {
      fail(world.seed, world.turn, `${lead.slot} tracks a closed or hidden Situation ${situation.id}`);
    }
    return;
  }
  if (lead.displayMode !== 'resolution_echo') {
    fail(world.seed, world.turn, `${lead.slot} Situation has invalid display mode ${lead.displayMode}`);
    return;
  }
  metrics.slots[lead.slot].resolutionEcho += 1;
  const echoAge = situation.resolvedTurn === null ? Number.POSITIVE_INFINITY : world.turn - situation.resolvedTurn;
  if (situation.status !== 'resolved'
    || situation.visibility < OBSERVER_LEAD_VISIBILITY_THRESHOLD
    || echoAge < 0
    || echoAge > OBSERVER_LEAD_RESOLUTION_ECHO_TURNS) {
    fail(world.seed, world.turn, `${lead.slot} carries an expired or invalid resolution echo ${situation.id}`);
  }
}

function auditFallbackLead(
  world: WorldState,
  lead: ObserverLead,
  stateless: ObserverLeadProjection,
  previous: ObserverLeadContinuityState | null,
  metrics: MutableMetrics,
): void {
  metrics.fallbackChecks += 1;
  metrics.slots[lead.slot].fallback += 1;
  if (lead.situationId !== null || lead.situationType !== null || lead.displayMode !== 'fallback') {
    fail(world.seed, world.turn, `${lead.slot} fallback carries Situation-only metadata`);
  }
  const statelessLead = stateless.leads.find((item) => item.slot === lead.slot);
  if (!statelessLead) {
    fail(world.seed, world.turn, `${lead.slot} is missing from stateless projection`);
    return;
  }
  if (statelessLead.source !== 'situation') return;

  const previousEntry = previous?.slots.find((entry) => entry.slot === lead.slot);
  const retainedWithinTenure = previousEntry?.situationId === null
    && previousEntry.leadId === lead.id
    && world.turn <= previousEntry.retainThroughTurn;
  if (!retainedWithinTenure) {
    fail(
      world.seed,
      world.turn,
      `${lead.slot} used fallback despite an eligible Situation outside a retained fallback tenure`,
    );
    return;
  }
  metrics.slots[lead.slot].fallbackTenureRetentions += 1;
  if (lead.arbitrationReason !== 'minimum_tenure') {
    fail(world.seed, world.turn, `${lead.slot} retained fallback without minimum_tenure reason`);
  }
}

function auditProjection(
  world: WorldState,
  previous: ObserverLeadContinuityState | null,
  previousWorldHash: string | null,
  priorLeadIds: Readonly<Record<ObserverLeadSlot, string | null>>,
  metrics: MutableMetrics,
): ObserverLeadProjection {
  const beforeHash = world.hash;
  const beforeSerialization = serializeWorld(world);
  const startedAt = performance.now();
  const projection = deriveObserverLeadProjection(world, previous, previousWorldHash);
  metrics.projectionTimingsMs.push(performance.now() - startedAt);
  const repeatedFromSameInput = deriveObserverLeadProjection(world, previous, previousWorldHash);
  const repeatedFromResult = deriveObserverLeadProjection(world, projection.continuity);
  const stateless = deriveObserverLeadProjection(world);
  const restoredContinuity = persistedContinuity(world, projection.continuity);
  const restoredProjection = deriveObserverLeadProjection(world, restoredContinuity);
  const afterSerialization = serializeWorld(world);

  metrics.projectionCheckpoints += 1;
  metrics.idempotenceChecks += 2;
  metrics.jsonRoundtripChecks += 1;
  metrics.purityChecks += 1;
  if (!jsonEqual(repeatedFromSameInput, projection) || !jsonEqual(repeatedFromResult, projection)) {
    fail(world.seed, world.turn, 'same-turn projection is not idempotent');
  }
  if (!jsonEqual(restoredContinuity, projection.continuity)
    || !jsonEqual(restoredProjection, projection)) {
    fail(world.seed, world.turn, 'ObserverDesk JSON roundtrip did not restore the same projection');
  }
  if (world.hash !== beforeHash || afterSerialization !== beforeSerialization) {
    fail(world.seed, world.turn, 'lead projection mutated the world, hash, or serialized save');
  }
  if (projection.leads.length !== LEAD_SLOTS.length
    || projection.leads.some((lead, index) => lead.slot !== LEAD_SLOTS[index])) {
    fail(world.seed, world.turn, 'projection must return person/polity/tension in stable order');
  }

  auditContinuity(world, projection, metrics);
  for (const slot of LEAD_SLOTS) {
    const lead = projection.leads.find((item) => item.slot === slot);
    if (!lead) continue;
    const slotMetrics = metrics.slots[slot];
    slotMetrics.checkpoints += 1;
    slotMetrics.uniqueLeadIds.add(lead.id);
    if (priorLeadIds[slot] !== null && priorLeadIds[slot] !== lead.id) slotMetrics.replacements += 1;
    if (lead.source === 'situation') auditSituationLead(world, lead, metrics);
    else auditFallbackLead(world, lead, stateless, previous, metrics);
  }
  return projection;
}

function sequenceEntry(world: WorldState, projection: ObserverLeadProjection): SequenceEntry {
  return {
    turn: world.turn,
    worldHash: world.hash,
    projectionDigest: stableHash(projection),
    leads: projection.leads.map((lead) => ({
      slot: lead.slot,
      id: lead.id,
      source: lead.source ?? 'fallback',
      situationId: lead.situationId ?? null,
      displayMode: lead.displayMode ?? 'fallback',
      selectedSinceTurn: lead.selectedSinceTurn ?? world.turn,
      retainThroughTurn: lead.retainThroughTurn ?? world.turn,
      arbitrationReason: lead.arbitrationReason ?? 'legacy_fallback',
    })),
    continuity: projection.continuity.slots.map((entry) => ({
      slot: entry.slot,
      challengerId: entry.challengerId,
      challengerAheadTurns: entry.challengerAheadTurns,
      decision: entry.decision,
    })),
  };
}

function runAudited(seed: string): AuditRun {
  let world = createWorld(seed);
  let continuity: ObserverLeadContinuityState | null = null;
  let previousWorldHash: string | null = null;
  const sequence: SequenceEntry[] = [];
  const metrics = createMetrics();
  const priorLeadIds: Record<ObserverLeadSlot, string | null> = {
    person: null,
    polity: null,
    tension: null,
  };

  for (let checkpoint = 0; checkpoint <= turns; checkpoint += 1) {
    if (checkpoint > 0) {
      previousWorldHash = world.hash;
      world = advanceWorld(world);
    }
    const projection = auditProjection(world, continuity, previousWorldHash, priorLeadIds, metrics);
    continuity = persistedContinuity(world, projection.continuity);
    for (const lead of projection.leads) priorLeadIds[lead.slot] = lead.id;
    sequence.push(sequenceEntry(world, projection));
  }
  return { world, sequence, continuity: continuity as ObserverLeadContinuityState, metrics };
}

function runReplay(seed: string): { world: WorldState; sequence: SequenceEntry[] } {
  let world = createWorld(seed);
  let continuity: ObserverLeadContinuityState | null = null;
  let previousWorldHash: string | null = null;
  const sequence: SequenceEntry[] = [];
  for (let checkpoint = 0; checkpoint <= turns; checkpoint += 1) {
    if (checkpoint > 0) {
      previousWorldHash = world.hash;
      world = advanceWorld(world);
    }
    const projection = deriveObserverLeadProjection(world, continuity, previousWorldHash);
    continuity = persistedContinuity(world, projection.continuity);
    sequence.push(sequenceEntry(world, projection));
  }
  return { world, sequence };
}

function publicSlotMetrics(metrics: MutableMetrics): SeedSample['sourcesBySlot'] {
  return Object.fromEntries(LEAD_SLOTS.map((slot) => {
    const item = metrics.slots[slot];
    return [slot, {
      fallback: item.fallback,
      situationTracking: item.situationTracking,
      resolutionEcho: item.resolutionEcho,
      replacements: item.replacements,
      fallbackTenureRetentions: item.fallbackTenureRetentions,
      uniqueLeads: item.uniqueLeadIds.size,
    }];
  })) as SeedSample['sourcesBySlot'];
}

const samples: SeedSample[] = [];
const aggregate = createMetrics();

function mergeMetrics(target: MutableMetrics, source: MutableMetrics): void {
  target.projectionCheckpoints += source.projectionCheckpoints;
  target.idempotenceChecks += source.idempotenceChecks;
  target.purityChecks += source.purityChecks;
  target.jsonRoundtripChecks += source.jsonRoundtripChecks;
  target.situationSourceChecks += source.situationSourceChecks;
  target.fallbackChecks += source.fallbackChecks;
  target.continuityChecks += source.continuityChecks;
  target.maximumContinuityBytes = Math.max(target.maximumContinuityBytes, source.maximumContinuityBytes);
  target.projectionTimingsMs.push(...source.projectionTimingsMs);
  for (const slot of LEAD_SLOTS) {
    const targetSlot = target.slots[slot];
    const sourceSlot = source.slots[slot];
    targetSlot.checkpoints += sourceSlot.checkpoints;
    targetSlot.fallback += sourceSlot.fallback;
    targetSlot.situationTracking += sourceSlot.situationTracking;
    targetSlot.resolutionEcho += sourceSlot.resolutionEcho;
    targetSlot.replacements += sourceSlot.replacements;
    targetSlot.fallbackTenureRetentions += sourceSlot.fallbackTenureRetentions;
    sourceSlot.uniqueLeadIds.forEach((id) => targetSlot.uniqueLeadIds.add(id));
  }
}

for (const seed of seeds) {
  try {
    const first = runAudited(seed);
    const replay = runReplay(seed);
    const deterministicReplay = first.world.hash === replay.world.hash
      && jsonEqual(first.sequence, replay.sequence);
    if (!deterministicReplay) {
      fail(seed, first.world.turn, 'double run produced a different world hash or lead sequence');
    }
    mergeMetrics(aggregate, first.metrics);
    samples.push({
      seed,
      completedQuarters: first.world.turn,
      finalTurn: first.world.turn,
      finalHash: first.world.hash,
      sequenceDigest: stableHash(first.sequence),
      replaySequenceDigest: stableHash(replay.sequence),
      deterministicReplay,
      maximumContinuityBytes: first.metrics.maximumContinuityBytes,
      sourcesBySlot: publicSlotMetrics(first.metrics),
    });
  } catch (error) {
    fail(seed, -1, `audit aborted: ${error instanceof Error ? error.message : String(error)}`);
    samples.push({
      seed,
      completedQuarters: 0,
      finalTurn: 0,
      finalHash: '',
      sequenceDigest: '',
      replaySequenceDigest: null,
      deterministicReplay: false,
      maximumContinuityBytes: 0,
      sourcesBySlot: publicSlotMetrics(createMetrics()),
    });
  }
}

const omittedFailures = Math.max(0, failureCount - failures.length);
console.log(JSON.stringify({
  phase: 'C01/C02',
  scope: {
    seeds: seeds.length,
    quartersPerSeed: turns,
    totalAdvancedQuarters: seeds.length * turns,
    projectionCheckpoints: aggregate.projectionCheckpoints,
    replayCheckpoints: seeds.length * (turns + 1),
  },
  contract: {
    slots: LEAD_SLOTS,
    minimumTenureQuarters: OBSERVER_LEAD_MIN_TENURE_TURNS,
    challengerQuarters: OBSERVER_LEAD_CHALLENGER_TURNS,
    visibilityThreshold: OBSERVER_LEAD_VISIBILITY_THRESHOLD,
    resolutionEchoQuarters: OBSERVER_LEAD_RESOLUTION_ECHO_TURNS,
    maximumContinuityBytes: MAX_CONTINUITY_BYTES,
  },
  metrics: {
    idempotenceChecks: aggregate.idempotenceChecks,
    projectionPurityChecks: aggregate.purityChecks,
    jsonRoundtripChecks: aggregate.jsonRoundtripChecks,
    situationSourceChecks: aggregate.situationSourceChecks,
    fallbackChecks: aggregate.fallbackChecks,
    continuityChecks: aggregate.continuityChecks,
    maximumObservedContinuityBytes: aggregate.maximumContinuityBytes,
    projectionTiming: timingSummary(aggregate.projectionTimingsMs),
    sourcesBySlot: publicSlotMetrics(aggregate),
  },
  samples,
  failureCount,
  failures,
  omittedFailures,
}, null, 2));

if (failureCount > 0) process.exitCode = 1;
