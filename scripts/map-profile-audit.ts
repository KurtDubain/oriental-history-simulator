import { listMapProfiles, type MapProfile } from '../src/maps';
import {
  advanceWorld,
  advanceWorldBy,
  createWorld,
  deserializeWorld,
  serializeWorld,
  validateWorld,
  type WorldState,
} from '../src/sim';

const AUDIT_SEEDS = ['双图审计-甲', '双图审计-乙'] as const;
const RESUME_SPLIT_TURN = 31;
const RESUME_TOTAL_TURNS = 80;
const requestedTurns = Number.parseInt(process.env.MAP_PROFILE_AUDIT_TURNS ?? '80', 10);
const turns = Number.isSafeInteger(requestedTurns)
  ? Math.max(RESUME_TOTAL_TURNS, requestedTurns)
  : RESUME_TOTAL_TURNS;
const maximumSaveMiB = Math.max(1, Number(process.env.MAP_PROFILE_AUDIT_MAX_SAVE_MIB ?? '16'));

interface WorldFingerprint {
  hash: string;
  factDigest: string;
  historyDigest: string;
}

interface ActivityMetrics {
  tradeShipments: number;
  deliveredTradeVolume: number;
  seaShipments: number;
  seaDeliveredVolume: number;
  fleetAtSeaQuarters: number;
  blockadedPortTurns: number;
  raidedShipments: number;
  landingOperationTurns: number;
  shipsLost: number;
  peakActiveWars: number;
  peakActiveCorridors: number;
  peakOpenSituations: number;
  navalOperationIds: Set<string>;
}

interface AuditSample {
  seed: string;
  finalHash: string;
  livingPolities: number;
  warsStarted: number;
  warsEnded: number;
  battles: number;
  territoryChanges: number;
  situationFormed: number;
  situationPhaseChanges: number;
  situationResolved: number;
  situationTypes: Record<string, number>;
  tradeShipments: number;
  deliveredTradeVolume: number;
  seaShipments: number;
  seaDeliveredVolume: number;
  fleetAtSeaQuarters: number;
  blockadedPortTurns: number;
  raidedShipments: number;
  landingOperationTurns: number;
  shipsLost: number;
  navalOperationsObserved: number;
  peakActiveWars: number;
  peakActiveCorridors: number;
  peakOpenSituations: number;
  finalFleets: number;
  finalActiveCorridors: number;
  finalOpenSituations: number;
  saveMiB: number;
  tickP50Ms: number;
  tickP95Ms: number;
  tickMaxMs: number;
  deterministicReplayExact: boolean;
  resume31Plus49Exact: boolean;
}

interface ProfileAuditResult {
  id: string;
  revision: number;
  name: string;
  contentVersion: string;
  opening: {
    regions: number;
    seaZones: number;
    polities: number;
    ports: number;
  };
  samples: AuditSample[];
  aggregate: {
    warsStarted: number;
    battles: number;
    tradeShipments: number;
    seaShipments: number;
    situationsFormed: number;
    fleetAtSeaQuarters: number;
    navalOperationsObserved: number;
    distinctFinalHashes: number;
  };
}

const failures: string[] = [];
const allTickTimings: number[] = [];
let validationChecks = 0;
const auditStartedAt = performance.now();

function fail(profile: MapProfile, seed: string, turn: number, message: string): void {
  if (failures.length >= 120) return;
  failures.push(`${profile.id}@${profile.revision}/${seed}@${turn}: ${message}`);
}

function fingerprint(world: WorldState): WorldFingerprint {
  return {
    hash: world.hash,
    factDigest: world.factDigest,
    historyDigest: world.historyDigest,
  };
}

function sameFingerprint(left: WorldFingerprint, right: WorldFingerprint): boolean {
  return left.hash === right.hash
    && left.factDigest === right.factDigest
    && left.historyDigest === right.historyDigest;
}

function checkWorld(profile: MapProfile, seed: string, world: WorldState, phase: string): void {
  validationChecks += 1;
  const violations = validateWorld(world);
  if (violations.length === 0) return;
  const first = violations[0];
  fail(
    profile,
    seed,
    world.turn,
    `${phase} validateWorld 失败：${first?.code ?? 'unknown'} ${first?.message ?? '未知错误'}`,
  );
}

function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * ratio) - 1);
  return sorted[index] ?? 0;
}

function createActivityMetrics(): ActivityMetrics {
  return {
    tradeShipments: 0,
    deliveredTradeVolume: 0,
    seaShipments: 0,
    seaDeliveredVolume: 0,
    fleetAtSeaQuarters: 0,
    blockadedPortTurns: 0,
    raidedShipments: 0,
    landingOperationTurns: 0,
    shipsLost: 0,
    peakActiveWars: 0,
    peakActiveCorridors: 0,
    peakOpenSituations: 0,
    navalOperationIds: new Set<string>(),
  };
}

function recordQuarterActivity(world: WorldState, metrics: ActivityMetrics): void {
  const report = world.lastTurn;
  if (!report) return;
  const tradeShipments = report.trade.shipments.filter((shipment) => shipment.kind === '贸易');
  const seaShipments = report.trade.shipments.filter((shipment) => (
    shipment.legs.some((leg) => leg.kind === 'sea-lane')
  ));
  metrics.tradeShipments += tradeShipments.length;
  metrics.deliveredTradeVolume += tradeShipments.reduce(
    (total, shipment) => total + shipment.deliveredAmount,
    0,
  );
  metrics.seaShipments += seaShipments.length;
  metrics.seaDeliveredVolume += seaShipments.reduce(
    (total, shipment) => total + shipment.deliveredAmount,
    0,
  );
  metrics.fleetAtSeaQuarters += world.fleets.filter((fleet) => fleet.seaZoneId !== null).length;
  metrics.blockadedPortTurns += report.maritime.blockadedPortIds.length;
  metrics.raidedShipments += report.maritime.raidedShipmentIds.length;
  metrics.landingOperationTurns += report.maritime.landingOperationIds.length;
  metrics.shipsLost += report.maritime.shipsLost;
  metrics.peakActiveWars = Math.max(metrics.peakActiveWars, world.wars.filter((war) => war.active).length);
  metrics.peakActiveCorridors = Math.max(
    metrics.peakActiveCorridors,
    world.tradeCorridors.filter((corridor) => corridor.active).length,
  );
  metrics.peakOpenSituations = Math.max(
    metrics.peakOpenSituations,
    world.situationSystem.situations.filter((situation) => situation.status === 'open').length,
  );
  for (const operation of world.navalOperations) metrics.navalOperationIds.add(operation.id);
}

function situationTypeCounts(world: WorldState): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const fact of world.facts) {
    if (fact.kind !== 'situation_milestone' || fact.payload.transition !== 'formed') continue;
    counts[fact.payload.situationType] = (counts[fact.payload.situationType] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function summarizeSample(
  world: WorldState,
  seed: string,
  activity: ActivityMetrics,
  tickTimings: readonly number[],
  deterministicReplayExact: boolean,
  resume31Plus49Exact: boolean,
): AuditSample {
  const milestones = world.facts.filter((fact) => fact.kind === 'situation_milestone');
  const saveMiB = Buffer.byteLength(serializeWorld(world), 'utf8') / 1024 / 1024;
  return {
    seed,
    finalHash: world.hash,
    livingPolities: world.polities.filter((polity) => polity.alive).length,
    warsStarted: world.facts.filter((fact) => fact.kind === 'war_started').length,
    warsEnded: world.facts.filter((fact) => fact.kind === 'war_ended').length,
    battles: world.facts.filter((fact) => fact.kind === 'battle').length,
    territoryChanges: world.facts.filter((fact) => fact.kind === 'territory_control_changed').length,
    situationFormed: milestones.filter((fact) => fact.payload.transition === 'formed').length,
    situationPhaseChanges: milestones.filter((fact) => fact.payload.transition === 'phase_changed').length,
    situationResolved: milestones.filter((fact) => fact.payload.transition === 'resolved').length,
    situationTypes: situationTypeCounts(world),
    tradeShipments: activity.tradeShipments,
    deliveredTradeVolume: activity.deliveredTradeVolume,
    seaShipments: activity.seaShipments,
    seaDeliveredVolume: activity.seaDeliveredVolume,
    fleetAtSeaQuarters: activity.fleetAtSeaQuarters,
    blockadedPortTurns: activity.blockadedPortTurns,
    raidedShipments: activity.raidedShipments,
    landingOperationTurns: activity.landingOperationTurns,
    shipsLost: activity.shipsLost,
    navalOperationsObserved: activity.navalOperationIds.size,
    peakActiveWars: activity.peakActiveWars,
    peakActiveCorridors: activity.peakActiveCorridors,
    peakOpenSituations: activity.peakOpenSituations,
    finalFleets: world.fleets.length,
    finalActiveCorridors: world.tradeCorridors.filter((corridor) => corridor.active).length,
    finalOpenSituations: world.situationSystem.situations.filter((situation) => situation.status === 'open').length,
    saveMiB: Number(saveMiB.toFixed(3)),
    tickP50Ms: Number(percentile(tickTimings, 0.5).toFixed(3)),
    tickP95Ms: Number(percentile(tickTimings, 0.95).toFixed(3)),
    tickMaxMs: Number(Math.max(0, ...tickTimings).toFixed(3)),
    deterministicReplayExact,
    resume31Plus49Exact,
  };
}

function runSample(profile: MapProfile, seed: string): AuditSample {
  let world = createWorld(seed, profile.id);
  if (world.mapContentVersion !== profile.contentVersion) {
    fail(profile, seed, 0, `创建得到地图 ${world.mapContentVersion}，预期 ${profile.contentVersion}`);
  }
  if (world.regions.length !== profile.simulation.regions.length
    || world.seaZones.length !== profile.simulation.seaZones.length
    || world.polities.length !== profile.simulation.polities.length) {
    fail(
      profile,
      seed,
      0,
      `开局规模不符：${world.regions.length}/${world.seaZones.length}/${world.polities.length}`,
    );
  }
  checkWorld(profile, seed, world, '开局');

  const checkpoints: WorldFingerprint[] = [fingerprint(world)];
  const activity = createActivityMetrics();
  const tickTimings: number[] = [];
  let turn80Serialization = '';
  for (let index = 1; index <= turns; index += 1) {
    const startedAt = performance.now();
    world = advanceWorld(world);
    const elapsed = performance.now() - startedAt;
    tickTimings.push(elapsed);
    allTickTimings.push(elapsed);
    checkWorld(profile, seed, world, '连续推进');
    checkpoints.push(fingerprint(world));
    recordQuarterActivity(world, activity);
    if (index === RESUME_TOTAL_TURNS) turn80Serialization = serializeWorld(world);
  }
  checkWorld(profile, seed, world, '连续推进终态');
  const finalSerialization = serializeWorld(world);

  const pureReplay = advanceWorldBy(createWorld(seed, profile.id), turns);
  checkWorld(profile, seed, pureReplay, '同种子重放终态');
  const deterministicReplayExact = pureReplay.hash === world.hash
    && serializeWorld(pureReplay) === finalSerialization;
  if (!deterministicReplayExact) fail(profile, seed, turns, '同种子完整重放与基准世界不一致');

  let resumed = createWorld(seed, profile.id);
  checkWorld(profile, seed, resumed, '续推分支开局');
  for (let index = 1; index <= RESUME_TOTAL_TURNS; index += 1) {
    resumed = advanceWorld(resumed);
    checkWorld(profile, seed, resumed, index <= RESUME_SPLIT_TURN ? '断点前推进' : '读档后推进');
    const expected = checkpoints[index];
    if (expected && !sameFingerprint(fingerprint(resumed), expected)) {
      fail(profile, seed, resumed.turn, '31+49 分支与不中断世界指纹不一致');
    }
    if (index === RESUME_SPLIT_TURN) {
      const checkpoint = serializeWorld(resumed);
      const restored = deserializeWorld(checkpoint);
      checkWorld(profile, seed, restored, '第31季读档');
      if (serializeWorld(restored) !== checkpoint) {
        fail(profile, seed, restored.turn, '第31季当前 schema 存读档没有逐字节往返');
      }
      resumed = restored;
    }
  }
  checkWorld(profile, seed, resumed, '31+49 终态');
  const resume31Plus49Exact = resumed.hash === checkpoints[RESUME_TOTAL_TURNS]?.hash
    && serializeWorld(resumed) === turn80Serialization;
  if (!resume31Plus49Exact) {
    fail(profile, seed, RESUME_TOTAL_TURNS, '第31季保存后续推49季与不中断80季不一致');
  }

  const sample = summarizeSample(
    world,
    seed,
    activity,
    tickTimings,
    deterministicReplayExact,
    resume31Plus49Exact,
  );
  if (sample.saveMiB > maximumSaveMiB) {
    fail(profile, seed, world.turn, `存档 ${sample.saveMiB}MiB 超过 ${maximumSaveMiB}MiB`);
  }
  return sample;
}

function aggregateProfile(profile: MapProfile, samples: readonly AuditSample[]): ProfileAuditResult {
  const aggregate = {
    warsStarted: samples.reduce((sum, sample) => sum + sample.warsStarted, 0),
    battles: samples.reduce((sum, sample) => sum + sample.battles, 0),
    tradeShipments: samples.reduce((sum, sample) => sum + sample.tradeShipments, 0),
    seaShipments: samples.reduce((sum, sample) => sum + sample.seaShipments, 0),
    situationsFormed: samples.reduce((sum, sample) => sum + sample.situationFormed, 0),
    fleetAtSeaQuarters: samples.reduce((sum, sample) => sum + sample.fleetAtSeaQuarters, 0),
    navalOperationsObserved: samples.reduce((sum, sample) => sum + sample.navalOperationsObserved, 0),
    distinctFinalHashes: new Set(samples.map((sample) => sample.finalHash)).size,
  };
  if (aggregate.warsStarted === 0 || aggregate.battles === 0) {
    fail(profile, '全样本', turns, '两种子80季内没有形成可观察的战争与会战');
  }
  if (aggregate.tradeShipments === 0) fail(profile, '全样本', turns, '两种子没有实际贸易 Shipment');
  if (aggregate.seaShipments === 0) fail(profile, '全样本', turns, '两种子没有使用海路的 Shipment');
  if (aggregate.situationsFormed === 0) fail(profile, '全样本', turns, '两种子没有形成权威 Situation');
  if (aggregate.fleetAtSeaQuarters === 0) fail(profile, '全样本', turns, '两种子没有舰队进入海域');
  if (aggregate.distinctFinalHashes !== samples.length) fail(profile, '全样本', turns, '不同种子终态 hash 没有区分');
  return {
    id: profile.id,
    revision: profile.revision,
    name: profile.name,
    contentVersion: profile.contentVersion,
    opening: {
      regions: profile.simulation.regions.length,
      seaZones: profile.simulation.seaZones.length,
      polities: profile.simulation.polities.length,
      ports: profile.simulation.regions.filter((region) => region.port).length,
    },
    samples: [...samples],
    aggregate,
  };
}

const profileResults: ProfileAuditResult[] = [];
for (const profile of listMapProfiles()) {
  const samples: AuditSample[] = [];
  for (const seed of AUDIT_SEEDS) {
    try {
      samples.push(runSample(profile, seed));
    } catch (error) {
      fail(profile, seed, -1, error instanceof Error ? error.message : '审计运行发生未知错误');
    }
  }
  profileResults.push(aggregateProfile(profile, samples));
}

const totalElapsedMs = performance.now() - auditStartedAt;
console.log(JSON.stringify({
  audit: 'MAP05 multi-profile deterministic save/resume gate',
  config: {
    profiles: profileResults.length,
    seedsPerProfile: AUDIT_SEEDS.length,
    turns,
    resume: `${RESUME_SPLIT_TURN}+${RESUME_TOTAL_TURNS - RESUME_SPLIT_TURN}`,
    maximumSaveMiB,
  },
  performance: {
    measuredBaselineTicks: allTickTimings.length,
    validationChecks,
    p50Ms: Number(percentile(allTickTimings, 0.5).toFixed(3)),
    p95Ms: Number(percentile(allTickTimings, 0.95).toFixed(3)),
    maxMs: Number(Math.max(0, ...allTickTimings).toFixed(3)),
    totalElapsedSeconds: Number((totalElapsedMs / 1_000).toFixed(2)),
  },
  profiles: profileResults,
  failures,
}, null, 2));

if (failures.length > 0) process.exitCode = 1;
