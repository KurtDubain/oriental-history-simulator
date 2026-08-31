import {
  advanceWorldDetailed,
  createWorld,
  deserializeWorld,
  serializeWorld,
  type WorldState,
} from '../src/sim';
import {
  archiveDecodeCacheEntryCount,
  clearWorldArchiveDecodeCache,
  queryWorldHistory,
  WORLD_ARCHIVE_HOT_TURNS,
  type ArchiveWorldState,
  type WorldArchiveSystemState,
} from '../src/sim/archive';

const AUDIT_SEED = '冷热档案容量门';
const CHECKPOINT_TURNS = [80, 200, 400] as const;
const DEFAULT_TURNS = 400;
const MAX_T400_SAVE_MIB = 12;
const MIN_T400_BLOCKS = 20;
const MAX_COLD_COMPRESSION_RATIO = 0.25;
// Absolute timings include the host's clone/system jitter. Keep enough margin
// to avoid a 0.x ms false red while still rejecting the pre-checkpoint
// 215–258 ms seal spikes measured on this project.
const MAX_SEAL_TICK_P95_MS = 200;
const MAX_SEAL_FINALIZE_P95_MS = 100;
const MAX_HISTORY_FIRST_PAGE_MS = 100;

function configuredTurns(): number {
  const raw = process.env.ARCHIVE_CAPACITY_AUDIT_TURNS;
  if (raw === undefined) return DEFAULT_TURNS;
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value < 80 || value > DEFAULT_TURNS) {
    throw new Error(`ARCHIVE_CAPACITY_AUDIT_TURNS must be an integer from 80 to ${DEFAULT_TURNS}`);
  }
  return value;
}

interface ActiveWindowMetrics {
  count: number;
  pinnedCount: number;
  hotCount: number;
  earliestHotTurn: number | null;
  latestHotTurn: number | null;
  hotTurnSpan: number;
  misplacedColdRecordIds: string[];
}

interface CapacityCheckpoint {
  turn: number;
  year: number;
  hash: string;
  factDigest: string;
  historyDigest: string;
  saveBytes: number;
  saveMiB: number;
  blockCount: number;
  archivedThroughTurn: number;
  archivedFactCount: number;
  archivedHistoryCount: number;
  activeFacts: ActiveWindowMetrics;
  activeHistory: ActiveWindowMetrics;
  coldRawBytes: number;
  coldCompressedBytes: number;
  coldBase64Bytes: number;
  coldCompressionRatio: number;
  tickP95MsThroughCheckpoint: number;
  historyFirstPage: {
    durationMs: number;
    eventCount: number;
    exactActiveOrder: boolean;
    decodedColdBlocks: number;
    decodeCacheEntries: number;
    exhausted: boolean;
  };
  roundTripStable: boolean;
}

interface ResumeResult {
  split: string;
  exact: boolean;
  direct: {
    hash: string;
    factDigest: string;
    historyDigest: string;
    saveBytes: number;
  };
  resumed: {
    hash: string;
    factDigest: string;
    historyDigest: string;
    saveBytes: number;
  };
}

const failures: string[] = [];

function fail(scope: string, message: string): void {
  failures.push(`${scope}: ${message}`);
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function toMiB(bytes: number): number {
  return Number((bytes / 1024 / 1024).toFixed(3));
}

function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.min(ordered.length - 1, Math.max(0, Math.ceil(ordered.length * ratio) - 1));
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

function archiveOf(world: WorldState): WorldArchiveSystemState | null {
  return (world as ArchiveWorldState).archiveSystem ?? null;
}

function activeWindowMetrics(
  records: readonly { id: string; turn: number }[],
  pinnedIds: readonly string[],
  archivedThroughTurn: number,
  permanentPrefixIds: ReadonlySet<string> = new Set<string>(),
): ActiveWindowMetrics {
  const pins = new Set(pinnedIds);
  const hot = records.filter((record) => !pins.has(record.id) && !permanentPrefixIds.has(record.id));
  const hotTurns = hot.map((record) => record.turn);
  const earliestHotTurn = hotTurns.length > 0 ? Math.min(...hotTurns) : null;
  const latestHotTurn = hotTurns.length > 0 ? Math.max(...hotTurns) : null;
  const misplacedColdRecordIds = hot
    .filter((record) => record.turn <= archivedThroughTurn)
    .map((record) => record.id);
  return {
    count: records.length,
    pinnedCount: records.filter((record) => pins.has(record.id)).length,
    hotCount: hot.length,
    earliestHotTurn,
    latestHotTurn,
    hotTurnSpan: earliestHotTurn === null || latestHotTurn === null
      ? 0
      : latestHotTurn - earliestHotTurn + 1,
    misplacedColdRecordIds,
  };
}

function checkActiveWindow(
  scope: string,
  metrics: ActiveWindowMetrics,
  worldTurn: number,
  maximumResidentTurns: number,
): void {
  if (metrics.hotTurnSpan > maximumResidentTurns) {
    fail(scope, `active turn span ${metrics.hotTurnSpan} exceeds ${maximumResidentTurns}`);
  }
  const earliestAllowedTurn = Math.max(0, worldTurn - maximumResidentTurns);
  if (metrics.earliestHotTurn !== null && metrics.earliestHotTurn < earliestAllowedTurn) {
    fail(scope, `unpinned record at T${metrics.earliestHotTurn} predates hot boundary T${earliestAllowedTurn}`);
  }
  if (metrics.misplacedColdRecordIds.length > 0) {
    fail(scope, `unpinned cold records remain active: ${metrics.misplacedColdRecordIds.slice(0, 6).join(', ')}`);
  }
}

function captureCheckpoint(
  world: WorldState,
  tickTimings: readonly number[],
): { checkpoint: CapacityCheckpoint; serialized: string } {
  const scope = `T${world.turn}`;
  const archive = archiveOf(world);
  if (!archive) throw new Error(`${scope} is missing archiveSystem`);

  const serialized = serializeWorld(world);
  const saveBytes = byteLength(serialized);
  const coldRawBytes = archive.blocks.reduce((sum, block) => sum + block.payloadRawBytes, 0);
  const coldCompressedBytes = archive.blocks.reduce(
    (sum, block) => sum + block.payloadCompressedBytes,
    0,
  );
  const coldBase64Bytes = archive.blocks.reduce((sum, block) => sum + byteLength(block.payloadBase64), 0);
  const coldCompressionRatio = coldRawBytes === 0 ? 0 : coldCompressedBytes / coldRawBytes;
  const legacyCount = world.legacyArchiveBoundary?.historyEventCount ?? 0;
  const legacyEventIds = new Set(world.history.slice(0, legacyCount).map((event) => event.id));
  const activeFacts = activeWindowMetrics(
    world.facts,
    archive.pinnedFactIds,
    archive.archivedThroughTurn,
  );
  const activeHistory = activeWindowMetrics(
    world.history,
    archive.pinnedEventIds,
    archive.archivedThroughTurn,
    legacyEventIds,
  );
  // A partially elapsed sixteen-turn chunk remains active until it can be
  // sealed whole. At aligned checkpoints (including T80/T400) this allowance
  // collapses to the exact sixty-four-turn hot window.
  const maximumResidentTurns = archive.hotTurns + archive.chunkTurns - 1;
  checkActiveWindow(`${scope} facts`, activeFacts, world.turn, maximumResidentTurns);
  checkActiveWindow(`${scope} history`, activeHistory, world.turn, maximumResidentTurns);

  clearWorldArchiveDecodeCache();
  const firstPageStartedAt = performance.now();
  const firstPage = queryWorldHistory(world, { limit: 72, maxColdBlocks: 0 });
  const legacyCountForQuery = world.legacyArchiveBoundary?.historyEventCount ?? 0;
  const expectedFirstPageIds = world.history
    .slice(legacyCountForQuery)
    .filter((event) => event.turn > archive.archivedThroughTurn)
    .slice()
    .reverse()
    .slice(0, 72)
    .map((event) => event.id);
  const exactActiveOrder = firstPage.events.map((event) => event.id).join('\n')
    === expectedFirstPageIds.join('\n');
  const historyFirstPage = {
    durationMs: Number((performance.now() - firstPageStartedAt).toFixed(3)),
    eventCount: firstPage.events.length,
    exactActiveOrder,
    decodedColdBlocks: firstPage.decodedColdBlocks,
    decodeCacheEntries: archiveDecodeCacheEntryCount(),
    exhausted: firstPage.exhausted,
  };
  if (historyFirstPage.decodedColdBlocks !== 0 || historyFirstPage.decodeCacheEntries !== 0) {
    fail(scope, 'current-history first page decoded a cold archive block');
  }
  if (!historyFirstPage.exactActiveOrder) {
    fail(scope, 'current-history first page omitted or reordered active Chronicle records');
  }

  let roundTripStable = false;
  try {
    const restored = deserializeWorld(serialized);
    roundTripStable = serializeWorld(restored) === serialized;
    if (!roundTripStable) fail(scope, 'serialize→deserialize changed the canonical body');
    if (restored.hash !== world.hash) fail(scope, 'round trip changed world hash');
    if (restored.factDigest !== world.factDigest) fail(scope, 'round trip changed factDigest');
    if (restored.historyDigest !== world.historyDigest) fail(scope, 'round trip changed historyDigest');
  } catch (error) {
    fail(scope, `round trip failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    serialized,
    checkpoint: {
      turn: world.turn,
      year: world.year,
      hash: world.hash,
      factDigest: world.factDigest,
      historyDigest: world.historyDigest,
      saveBytes,
      saveMiB: toMiB(saveBytes),
      blockCount: archive.blocks.length,
      archivedThroughTurn: archive.archivedThroughTurn,
      archivedFactCount: archive.archivedFactCount,
      archivedHistoryCount: archive.archivedHistoryCount,
      activeFacts,
      activeHistory,
      coldRawBytes,
      coldCompressedBytes,
      coldBase64Bytes,
      coldCompressionRatio: Number(coldCompressionRatio.toFixed(4)),
      tickP95MsThroughCheckpoint: Number(percentile(tickTimings, 0.95).toFixed(3)),
      historyFirstPage,
      roundTripStable,
    },
  };
}

function advanceBy(world: WorldState, turns: number): WorldState {
  let next = world;
  for (let index = 0; index < turns; index += 1) next = advanceWorldDetailed(next).world;
  return next;
}

function auditResume(direct: WorldState, directSerialized: string): ResumeResult {
  let resumed = advanceBy(createWorld(AUDIT_SEED), 31);
  resumed = deserializeWorld(serializeWorld(resumed));
  resumed = advanceBy(resumed, 49);
  const resumedSerialized = serializeWorld(resumed);
  const exact = resumed.hash === direct.hash
    && resumed.factDigest === direct.factDigest
    && resumed.historyDigest === direct.historyDigest
    && resumedSerialized === directSerialized;
  if (!exact) fail('31+49 resume', 'resumed T80 differs from uninterrupted T80');
  return {
    split: '31+49',
    exact,
    direct: {
      hash: direct.hash,
      factDigest: direct.factDigest,
      historyDigest: direct.historyDigest,
      saveBytes: byteLength(directSerialized),
    },
    resumed: {
      hash: resumed.hash,
      factDigest: resumed.factDigest,
      historyDigest: resumed.historyDigest,
      saveBytes: byteLength(resumedSerialized),
    },
  };
}

function enforceT400(checkpoint: CapacityCheckpoint): void {
  if (checkpoint.saveBytes > MAX_T400_SAVE_MIB * 1024 * 1024) {
    fail('T400 capacity', `save ${checkpoint.saveMiB}MiB exceeds ${MAX_T400_SAVE_MIB}MiB`);
  }
  if (checkpoint.blockCount < MIN_T400_BLOCKS) {
    fail('T400 capacity', `only ${checkpoint.blockCount} cold blocks, expected at least ${MIN_T400_BLOCKS}`);
  }
  if (checkpoint.activeFacts.hotTurnSpan > WORLD_ARCHIVE_HOT_TURNS) {
    fail(
      'T400 capacity',
      `active Fact span ${checkpoint.activeFacts.hotTurnSpan} exceeds ${WORLD_ARCHIVE_HOT_TURNS}`,
    );
  }
  if (checkpoint.activeHistory.hotTurnSpan > WORLD_ARCHIVE_HOT_TURNS) {
    fail(
      'T400 capacity',
      `active Chronicle span ${checkpoint.activeHistory.hotTurnSpan} exceeds ${WORLD_ARCHIVE_HOT_TURNS}`,
    );
  }
  if (checkpoint.coldRawBytes <= 0) fail('T400 capacity', 'cold archive has no raw payload bytes');
  if (checkpoint.coldCompressionRatio > MAX_COLD_COMPRESSION_RATIO) {
    fail(
      'T400 capacity',
      `cold compression ratio ${checkpoint.coldCompressionRatio} exceeds ${MAX_COLD_COMPRESSION_RATIO}`,
    );
  }
  if (checkpoint.historyFirstPage.durationMs > MAX_HISTORY_FIRST_PAGE_MS) {
    fail(
      'T400 history first page',
      `${checkpoint.historyFirstPage.durationMs}ms exceeds ${MAX_HISTORY_FIRST_PAGE_MS}ms`,
    );
  }
}

async function main(): Promise<void> {
  const turns = configuredTurns();
  const checkpoints: CapacityCheckpoint[] = [];
  const timings: number[] = [];
  const ordinaryTimings: number[] = [];
  const sealTimings: number[] = [];
  const sealFinalizeTimings: number[] = [];
  let direct80: WorldState | null = null;
  let direct80Serialized: string | null = null;
  let world = createWorld(AUDIT_SEED);

  for (let index = 0; index < turns; index += 1) {
    const blockCountBefore = archiveOf(world)?.blocks.length ?? 0;
    const detailed = advanceWorldDetailed(world);
    world = detailed.world;
    timings.push(detailed.timings.totalMs);
    if ((archiveOf(world)?.blocks.length ?? 0) > blockCountBefore) {
      sealTimings.push(detailed.timings.totalMs);
      sealFinalizeTimings.push(detailed.timings.systems.quarter_finalize);
    } else {
      ordinaryTimings.push(detailed.timings.totalMs);
    }
    if (!CHECKPOINT_TURNS.includes(world.turn as (typeof CHECKPOINT_TURNS)[number])) continue;
    const captured = captureCheckpoint(world, timings);
    checkpoints.push(captured.checkpoint);
    if (world.turn === 80) {
      direct80 = world;
      direct80Serialized = captured.serialized;
    }
  }

  if (!direct80 || !direct80Serialized) throw new Error('audit did not reach the T80 resume baseline');
  const resume = auditResume(direct80, direct80Serialized);
  const t400 = checkpoints.find((checkpoint) => checkpoint.turn === 400);
  if (turns === DEFAULT_TURNS) {
    if (!t400) fail('T400 capacity', 'missing required T400 checkpoint');
    else enforceT400(t400);
    const sealTickP95 = percentile(sealTimings, 0.95);
    const sealFinalizeP95 = percentile(sealFinalizeTimings, 0.95);
    if (sealTickP95 > MAX_SEAL_TICK_P95_MS) {
      fail('seal performance', `tick P95 ${sealTickP95.toFixed(3)}ms exceeds ${MAX_SEAL_TICK_P95_MS}ms`);
    }
    if (sealFinalizeP95 > MAX_SEAL_FINALIZE_P95_MS) {
      fail(
        'seal performance',
        `quarter_finalize P95 ${sealFinalizeP95.toFixed(3)}ms exceeds ${MAX_SEAL_FINALIZE_P95_MS}ms`,
      );
    }
  }

  console.log(JSON.stringify({
    audit: 'TRIM01.5 active/cold archive capacity gate',
    seed: AUDIT_SEED,
    config: {
      turns,
      completeGate: turns === DEFAULT_TURNS,
      checkpoints: CHECKPOINT_TURNS.filter((turn) => turn <= turns),
      chunkTurns: archiveOf(world)?.chunkTurns ?? null,
      hotTurns: WORLD_ARCHIVE_HOT_TURNS,
      limits: {
        t400SaveMiB: MAX_T400_SAVE_MIB,
        t400MinimumBlocks: MIN_T400_BLOCKS,
        maximumColdCompressionRatio: MAX_COLD_COMPRESSION_RATIO,
        sealTickP95Ms: MAX_SEAL_TICK_P95_MS,
        sealFinalizeP95Ms: MAX_SEAL_FINALIZE_P95_MS,
        historyFirstPageMs: MAX_HISTORY_FIRST_PAGE_MS,
      },
    },
    performance: {
      all: timingSummary(timings),
      ordinary: timingSummary(ordinaryTimings),
      seal: timingSummary(sealTimings),
      sealFinalize: timingSummary(sealFinalizeTimings),
    },
    checkpoints,
    resume,
    failures,
  }, null, 2));
}

main().catch((error) => {
  fail('fatal', error instanceof Error ? error.stack ?? error.message : String(error));
  console.error(JSON.stringify({
    audit: 'TRIM01.5 active/cold archive capacity gate',
    failures,
  }, null, 2));
}).finally(() => {
  if (failures.length > 0) process.exitCode = 1;
});
