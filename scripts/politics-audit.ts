import { listMapProfiles, type MapProfile } from '../src/maps';
import {
  advanceWorld,
  createWorld,
  deserializeWorld,
  readWorldFacts,
  serializeWorld,
  stableHash,
  validateWorld,
  type FactionState,
  type SimulationFact,
  type WorldState,
} from '../src/sim';
import {
  calculateFactionPowerLedger,
  recentFactionPowerMovements,
} from '../src/sim/politics/power-ledger';
import { projectCourt, type CourtProjectionView } from '../src/view/court-projection';
import {
  POLITICAL_MAP_PROJECTION_LIMITS,
  projectPoliticalMap,
  type FactionSpatialPowerRootView,
  type PoliticalMapProjectionView,
} from '../src/view/political-map-projection';

const DEFAULT_SEEDS = ['朝局审计-甲', '朝局审计-乙'] as const;
const configuredSeeds = process.env.POLITICS_AUDIT_SEEDS
  ?.split(',')
  .map((seed) => seed.trim())
  .filter(Boolean);
const seeds = configuredSeeds?.length ? configuredSeeds : [...DEFAULT_SEEDS];
const DEFAULT_RELEASE_TURNS = 64;
const DEFAULT_DEEP_TURNS = 192;
const MINIMUM_DEEP_TURNS = 160;
const MAXIMUM_DEEP_TURNS = 256;
const deepArguments = process.argv.slice(2).filter((argument) => argument === '--deep' || argument.startsWith('--deep='));
if (deepArguments.length > 1) throw new Error('POL08 deep 审计只能指定一次 --deep[=160..256]');
const deepArgument = deepArguments[0];
const explicitDeepValue = deepArgument?.startsWith('--deep=')
  ? deepArgument.slice('--deep='.length)
  : null;
if (explicitDeepValue !== null && !/^\d+$/.test(explicitDeepValue)) {
  throw new Error('POL08 deep 审计参数必须是完整整数 --deep=160..256');
}
const requestedDeepTurns = deepArgument === '--deep'
  ? DEFAULT_DEEP_TURNS
  : explicitDeepValue !== null
    ? Number.parseInt(explicitDeepValue, 10)
    : null;
if (requestedDeepTurns !== null && (
  !Number.isSafeInteger(requestedDeepTurns)
  || requestedDeepTurns < MINIMUM_DEEP_TURNS
  || requestedDeepTurns > MAXIMUM_DEEP_TURNS
)) {
  throw new Error(`POL08 deep 审计季数必须在${MINIMUM_DEEP_TURNS}..${MAXIMUM_DEEP_TURNS}之间`);
}
const requestedTurns = requestedDeepTurns
  ?? Number.parseInt(process.env.POLITICS_AUDIT_TURNS ?? String(DEFAULT_RELEASE_TURNS), 10);
const turns = Number.isSafeInteger(requestedTurns) ? Math.max(16, requestedTurns) : 64;
const auditMode = requestedDeepTurns !== null
  ? 'deep'
  : turns === DEFAULT_RELEASE_TURNS
    ? 'release'
    : 'custom';
const splitTurn = Math.max(8, Math.min(turns - 1, Math.floor(turns / 2)));
const VALIDATION_INTERVAL = 8;
const CENTRAL_OFFICES = new Set(['君主', '宰辅', '枢密使', '廷臣']);
const POLITICAL_POWER_CATEGORIES = new Set([
  'central_office',
  'regional_office',
  'military_command',
  'family_backing',
  'member_renown',
  'alliance_support',
  'cohesion',
]);

interface PoliticalFingerprint {
  turn: number;
  hash: string;
  factDigest: string;
  historyDigest: string;
  factionDigest: string;
  politicalSpatialDigest: string;
  distributionDigest: string;
}

interface TransitionCounts {
  formed: number;
  leader_changed: number;
  split: number;
  merged: number;
  ended: number;
}

interface RelationCounts {
  allianceFormed: number;
  allianceEnded: number;
  rivalryFormed: number;
  rivalryEnded: number;
}

interface LeaderTransitionCounts {
  total: number;
  death: number;
  transferred: number;
  otherUnavailable: number;
  invalidFacts: number;
}

interface PowerBands {
  from0To19: number;
  from20To39: number;
  from40To59: number;
  from60To79: number;
  from80To97: number;
  from98To99: number;
  exact100: number;
}

interface LongRunMetrics {
  stateSamples: number;
  power: {
    activeFactionPowerObservations: number;
    ledgerCacheChecks: number;
    total: number;
    minimum: number | null;
    maximum: number | null;
    exact100: number;
    saturated98OrMore: number;
    cacheMismatches: number;
    outOfRange: number;
    bands: PowerBands;
  };
  visibility: {
    livingPolityScreens: number;
    dominantRequired: number;
    dominantMissing: number;
    highPowerRequired: number;
    highPowerMissing: number;
  };
  spatialRoots: {
    projected: number;
    falseRoots: number;
  };
  governorMonopoly: {
    politySamples: number;
    governorAppointments: number;
    factionalAppointments: number;
    largestFactionAppointments: number;
    largestLocalFactionAppointments: number;
    rateTotal: number;
    localFactionRateTotal: number;
    maximumRate: number;
    maximumLocalFactionRate: number;
    fullyMonopolizedSamples: number;
    fullyLocalFactionMonopolizedSamples: number;
  };
  leaders: {
    activeLeaderChecks: number;
    dead: number;
    transferred: number;
    invalid: number;
  };
}

interface FinalLongRunMetrics {
  stateSamples: number;
  power: LongRunMetrics['power'] & {
    average: number | null;
    exact100Rate: number | null;
    saturated98OrMoreRate: number | null;
  };
  visibility: LongRunMetrics['visibility'];
  spatialRoots: LongRunMetrics['spatialRoots'];
  governorMonopoly: LongRunMetrics['governorMonopoly'] & {
    weightedRate: number | null;
    meanRate: number | null;
    weightedLocalFactionRate: number | null;
    meanLocalFactionRate: number | null;
    fullyMonopolizedSampleRate: number | null;
    fullyLocalFactionMonopolizedSampleRate: number | null;
  };
  leaders: LongRunMetrics['leaders'];
}

interface LedgerDistributionRow {
  factionId: string;
  polityId: string;
  total: number;
  cachedPower: number;
  cacheChecked: boolean;
  cacheExact: boolean;
  inRange: boolean;
}

interface CourtVisibilityRow {
  polityId: string;
  activeFactionIds: readonly string[];
  factionPositionIds: readonly string[];
  firstScreenFactionIds: readonly string[];
  dominantFactionId: string | null;
  highPowerFactionIds: readonly string[];
  missingPositionIds: readonly string[];
  missingFirstScreenIds: readonly string[];
}

interface GovernorMonopolyRow {
  polityId: string;
  governorCount: number;
  factionalGovernorCount: number;
  largestFactionId: string | null;
  largestFactionCount: number;
  largestLocalFactionId: string | null;
  largestLocalFactionCount: number;
  rate: number;
  localFactionRate: number;
}

interface ActiveLeaderRow {
  factionId: string;
  leaderId: string;
  dead: boolean;
  transferred: boolean;
  invalid: boolean;
}

interface PoliticalDistributionObservation {
  digest: string;
  ledgerRows: readonly LedgerDistributionRow[];
  visibilityRows: readonly CourtVisibilityRow[];
  governorRows: readonly GovernorMonopolyRow[];
  leaderRows: readonly ActiveLeaderRow[];
  falseRootIds: readonly string[];
  currentAlliances: readonly string[];
  currentRivalries: readonly string[];
  courtsByPolityId: ReadonlyMap<string, CourtProjectionView>;
  politicalMap: PoliticalMapProjectionView;
}

interface AuditRun {
  world: WorldState;
  sequence: PoliticalFingerprint[];
  splitSave: string;
  longRun: FinalLongRunMetrics;
  peakActiveFactions: number;
  peakCourtSeats: number;
  peakSpatialRoots: number;
  validationChecks: number;
  projectionChecks: number;
  capitalPulseChecks: number;
  spatialRootChecks: number;
}

interface AuditSample {
  profileId: string;
  revision: number;
  seed: string;
  finalHash: string;
  factions: number;
  activeFactions: number;
  peakActiveFactions: number;
  peakCourtSeats: number;
  peakSpatialRoots: number;
  lifecycle: TransitionCounts;
  relations: RelationCounts;
  leaderTransitions: LeaderTransitionCounts;
  longRun: FinalLongRunMetrics;
  distributionDigest: string;
  courtActions: number;
  courtSituations: number;
  linkedCourtActions: number;
  ledgerGroundedCourtSituations: number;
  validationChecks: number;
  projectionChecks: number;
  capitalPulseChecks: number;
  spatialRootChecks: number;
  replayExact: boolean;
  resumeExact: boolean;
  replayDistributionExact: boolean;
  resumeDistributionExact: boolean;
}

interface CourtChainCounts {
  actions: number;
  situations: number;
  linkedActions: number;
  ledgerGroundedSituations: number;
}

const failures: string[] = [];

function fail(scope: string, message: string): void {
  if (failures.length >= 160) return;
  failures.push(`${scope}: ${message}`);
}

function scoped(profile: MapProfile, seed: string, turn: number): string {
  return `${profile.id}@${profile.revision}/${seed}@T${turn}`;
}

function stableCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalPair(left: string, right: string): string {
  return [left, right].sort(stableCompare).join(':');
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function roundedRatio(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 10_000) / 10_000 : 0;
}

function emptyPowerBands(): PowerBands {
  return {
    from0To19: 0,
    from20To39: 0,
    from40To59: 0,
    from60To79: 0,
    from80To97: 0,
    from98To99: 0,
    exact100: 0,
  };
}

function emptyLongRunMetrics(): LongRunMetrics {
  return {
    stateSamples: 0,
    power: {
      activeFactionPowerObservations: 0,
      ledgerCacheChecks: 0,
      total: 0,
      minimum: null,
      maximum: null,
      exact100: 0,
      saturated98OrMore: 0,
      cacheMismatches: 0,
      outOfRange: 0,
      bands: emptyPowerBands(),
    },
    visibility: {
      livingPolityScreens: 0,
      dominantRequired: 0,
      dominantMissing: 0,
      highPowerRequired: 0,
      highPowerMissing: 0,
    },
    spatialRoots: { projected: 0, falseRoots: 0 },
    governorMonopoly: {
      politySamples: 0,
      governorAppointments: 0,
      factionalAppointments: 0,
      largestFactionAppointments: 0,
      largestLocalFactionAppointments: 0,
      rateTotal: 0,
      localFactionRateTotal: 0,
      maximumRate: 0,
      maximumLocalFactionRate: 0,
      fullyMonopolizedSamples: 0,
      fullyLocalFactionMonopolizedSamples: 0,
    },
    leaders: { activeLeaderChecks: 0, dead: 0, transferred: 0, invalid: 0 },
  };
}

function incrementPowerBand(bands: PowerBands, power: number): void {
  if (power === 100) bands.exact100 += 1;
  else if (power >= 98) bands.from98To99 += 1;
  else if (power >= 80) bands.from80To97 += 1;
  else if (power >= 60) bands.from60To79 += 1;
  else if (power >= 40) bands.from40To59 += 1;
  else if (power >= 20) bands.from20To39 += 1;
  else bands.from0To19 += 1;
}

function currentRelationPairs(
  factions: readonly FactionState[],
  relation: 'alliance' | 'rivalry',
): string[] {
  const activeIds = new Set(factions.map((faction) => faction.id));
  const pairs = new Set<string>();
  for (const faction of factions) {
    const relatedIds = relation === 'alliance' ? faction.alliedFactionIds : faction.rivalFactionIds;
    for (const otherId of relatedIds) {
      if (activeIds.has(otherId)) pairs.add(canonicalPair(faction.id, otherId));
    }
  }
  return [...pairs].sort(stableCompare);
}

function governorMonopolyRows(world: WorldState): GovernorMonopolyRow[] {
  const activeFactionById = new Map(world.factions
    .filter((faction) => faction.active)
    .map((faction) => [faction.id, faction]));
  return world.polities
    .filter((polity) => polity.alive)
    .sort((left, right) => stableCompare(left.id, right.id))
    .map((polity) => {
      const governors = world.offices
        .filter((office) => {
          if (!office.active || office.kind !== '地方长官' || office.polityId !== polity.id || !office.regionId) return false;
          const holder = world.characters.find((character) => character.id === office.holderId);
          const region = world.regions.find((candidate) => candidate.id === office.regionId);
          return Boolean(
            holder?.alive
            && holder.polityId === polity.id
            && holder.governedRegionId === office.regionId
            && region?.controllerId === polity.id
          );
        })
        .sort((left, right) => stableCompare(left.id, right.id));
      const byFaction = new Map<string, number>();
      for (const office of governors) {
        const holder = world.characters.find((character) => character.id === office.holderId);
        const faction = holder?.factionId ? activeFactionById.get(holder.factionId) : null;
        if (!faction || faction.polityId !== polity.id) continue;
        byFaction.set(faction.id, (byFaction.get(faction.id) ?? 0) + 1);
      }
      const ranked = [...byFaction.entries()].sort((left, right) => (
        right[1] - left[1] || stableCompare(left[0], right[0])
      ));
      const rankedLocal = ranked.filter(([factionId]) => activeFactionById.get(factionId)?.kind === '地方');
      const largest = ranked[0] ?? null;
      const largestLocal = rankedLocal[0] ?? null;
      const factionalGovernorCount = [...byFaction.values()].reduce((sum, count) => sum + count, 0);
      return {
        polityId: polity.id,
        governorCount: governors.length,
        factionalGovernorCount,
        largestFactionId: largest?.[0] ?? null,
        largestFactionCount: largest?.[1] ?? 0,
        largestLocalFactionId: largestLocal?.[0] ?? null,
        largestLocalFactionCount: largestLocal?.[1] ?? 0,
        rate: roundedRatio(largest?.[1] ?? 0, governors.length),
        localFactionRate: roundedRatio(largestLocal?.[1] ?? 0, governors.length),
      } satisfies GovernorMonopolyRow;
    });
}

function observePoliticalDistribution(
  world: WorldState,
  includeLedgerAudit = false,
  includeDetailedAudit = false,
): PoliticalDistributionObservation {
  // Retired factions preserve historical fields and are not refreshed. POL08's
  // cache contract therefore applies to every currently active faction ledger.
  const activeFactions = world.factions
    .filter((faction) => faction.active)
    .sort((left, right) => stableCompare(left.id, right.id));
  const ledgerRows = activeFactions.map((faction) => {
    const ledger = includeLedgerAudit ? calculateFactionPowerLedger(world, faction) : null;
    return {
      factionId: faction.id,
      polityId: faction.polityId,
      total: ledger?.total ?? faction.power,
      cachedPower: faction.power,
      cacheChecked: ledger !== null,
      cacheExact: ledger === null || faction.power === ledger.total,
      inRange: Number.isFinite(ledger?.total ?? faction.power)
        && (ledger?.total ?? faction.power) >= 0
        && (ledger?.total ?? faction.power) <= 100,
    } satisfies LedgerDistributionRow;
  });
  const ledgerByFactionId = new Map(ledgerRows.map((row) => [row.factionId, row]));
  const livingPolities = world.polities
    .filter((polity) => polity.alive)
    .sort((left, right) => stableCompare(left.id, right.id));
  const courtsByPolityId = includeDetailedAudit
    ? new Map(livingPolities.map((polity) => [polity.id, projectCourt(world, polity.id)]))
    : new Map<string, CourtProjectionView>();
  const visibilityRows = includeDetailedAudit ? livingPolities.map((polity) => {
    const activeFactionIds = activeFactions
      .filter((faction) => faction.polityId === polity.id)
      .map((faction) => faction.id);
    const court = courtsByPolityId.get(polity.id) as CourtProjectionView;
    const factionPositionIds = court.factionPositions.map((position) => position.factionId);
    const firstScreenFactionIds = [...court.graphFactionIds];
    const dominantFactionId = court.factionPositions.find((position) => position.dominant)?.factionId ?? null;
    const highPowerFactionIds = activeFactionIds
      .filter((factionId) => (ledgerByFactionId.get(factionId)?.total ?? -1) >= 60)
      .sort(stableCompare);
    const requiredIds = [...new Set([
      ...(dominantFactionId ? [dominantFactionId] : []),
      ...highPowerFactionIds,
    ])].sort(stableCompare);
    return {
      polityId: polity.id,
      activeFactionIds,
      factionPositionIds,
      firstScreenFactionIds,
      dominantFactionId,
      highPowerFactionIds,
      missingPositionIds: requiredIds.filter((factionId) => !factionPositionIds.includes(factionId)),
      missingFirstScreenIds: requiredIds.filter((factionId) => !firstScreenFactionIds.includes(factionId)),
    } satisfies CourtVisibilityRow;
  }) : [];
  const politicalMap = projectPoliticalMap(world, 'active');
  const falseRootIds = politicalMap.roots
    .filter((root) => !isTruthfulSpatialRoot(world, root))
    .map((root) => root.id)
    .sort(stableCompare);
  const governorRows = governorMonopolyRows(world);
  const leaderRows = activeFactions.map((faction) => {
    const leader = world.characters.find((character) => character.id === faction.leaderId);
    const dead = !leader?.alive;
    const transferred = Boolean(leader?.alive && leader.polityId !== faction.polityId);
    const invalid = !leader
      || !leader.alive
      || leader.age < 16
      || leader.polityId !== faction.polityId
      || leader.factionId !== faction.id
      || !faction.memberIds.includes(leader.id)
      || !faction.coreMemberIds.includes(leader.id);
    return { factionId: faction.id, leaderId: faction.leaderId, dead, transferred, invalid };
  });
  const currentAlliances = currentRelationPairs(activeFactions, 'alliance');
  const currentRivalries = currentRelationPairs(activeFactions, 'rivalry');
  const digest = stableHash({
    // The every-quarter digest uses the persisted cache. Detailed POL01
    // recalculation below proves that cache exact at each validation checkpoint.
    ledgers: ledgerRows.map((row) => ({
      factionId: row.factionId,
      polityId: row.polityId,
      power: row.cachedPower,
    })),
    governorMonopoly: governorRows,
    leaders: leaderRows,
    currentAlliances,
    currentRivalries,
    spatialRoots: politicalMap.roots.map((root) => ({
      id: root.id,
      factionId: root.factionId,
      kind: root.kind,
      anchor: [root.anchor.kind, root.anchor.id],
      assetCount: root.assetCount,
      assets: root.assets.map((asset) => [asset.kind, asset.id, asset.holderId, asset.ledgerResourceId]),
      truthful: !falseRootIds.includes(root.id),
    })),
  });
  return {
    digest,
    ledgerRows,
    visibilityRows,
    governorRows,
    leaderRows,
    falseRootIds,
    currentAlliances,
    currentRivalries,
    courtsByPolityId,
    politicalMap,
  };
}

function auditDistributionObservation(
  observation: PoliticalDistributionObservation,
  scope: string,
): void {
  for (const row of observation.ledgerRows) {
    if (!row.inRange) fail(scope, `${row.factionId}真实权势总值${row.total}越出0..100`);
    if (row.cacheChecked && !row.cacheExact) {
      fail(scope, `${row.factionId}权势cache ${row.cachedPower}与POL01总账${row.total}不精确一致`);
    }
  }
  for (const row of observation.visibilityRows) {
    if (!unique(row.factionPositionIds) || !unique(row.firstScreenFactionIds)) {
      fail(scope, `${row.polityId}的朝局首屏或派系次序存在重复`);
    }
    if (
      row.activeFactionIds.length !== row.factionPositionIds.length
      || row.activeFactionIds.some((factionId) => !row.factionPositionIds.includes(factionId))
    ) {
      fail(scope, `${row.polityId}的factionPositions没有完整覆盖活动派系`);
    }
    if (row.missingPositionIds.length > 0) {
      fail(scope, `${row.polityId}的factionPositions遗漏主导/高权势派${row.missingPositionIds.join('、')}`);
    }
    if (row.missingFirstScreenIds.length > 0) {
      fail(scope, `${row.polityId}首屏遗漏主导/真实权势>=60派${row.missingFirstScreenIds.join('、')}`);
    }
    if (row.firstScreenFactionIds.some((factionId) => !row.factionPositionIds.includes(factionId))) {
      fail(scope, `${row.polityId}首屏引用了非factionPositions派系`);
    }
  }
  for (const rootId of observation.falseRootIds) fail(scope, `${rootId}没有真实地方长官/军团主帅/舰队提督根基`);
  for (const row of observation.leaderRows) {
    if (!row.invalid) continue;
    const reason = row.dead ? '领袖已死亡' : row.transferred ? '领袖已转籍' : '领袖成员/核心身份失效';
    fail(scope, `${row.factionId}${reason}，仍被记为活动派系领袖`);
  }
  if (observation.politicalMap.roots.length > POLITICAL_MAP_PROJECTION_LIMITS.rootsPerWorld) {
    fail(scope, `空间权势根基${observation.politicalMap.roots.length}个，超过世界上限`);
  }
  if (!unique(observation.politicalMap.roots.map((root) => root.id))) fail(scope, '空间权势根基 ID 重复');
  // Governor monopoly is an observational distribution, not a balance gate.
  // A 100% sample remains visible in the report and is never "fixed" here.
  for (const row of observation.governorRows) {
    if (row.rate < 0 || row.rate > 1 || row.localFactionRate < 0 || row.localFactionRate > 1) {
      fail(scope, `${row.polityId}地方长官派系垄断率越界`);
    }
  }
}

function accumulateLongRunMetrics(
  metrics: LongRunMetrics,
  observation: PoliticalDistributionObservation,
): void {
  metrics.stateSamples += 1;
  for (const row of observation.ledgerRows) {
    metrics.power.activeFactionPowerObservations += 1;
    metrics.power.total += row.total;
    metrics.power.minimum = metrics.power.minimum === null ? row.total : Math.min(metrics.power.minimum, row.total);
    metrics.power.maximum = metrics.power.maximum === null ? row.total : Math.max(metrics.power.maximum, row.total);
    if (row.total === 100) metrics.power.exact100 += 1;
    if (row.total >= 98) metrics.power.saturated98OrMore += 1;
    if (row.cacheChecked) metrics.power.ledgerCacheChecks += 1;
    if (row.cacheChecked && !row.cacheExact) metrics.power.cacheMismatches += 1;
    if (!row.inRange) metrics.power.outOfRange += 1;
    incrementPowerBand(metrics.power.bands, row.total);
  }
  metrics.visibility.livingPolityScreens += observation.visibilityRows.length;
  for (const row of observation.visibilityRows) {
    metrics.visibility.dominantRequired += Number(row.dominantFactionId !== null);
    metrics.visibility.dominantMissing += Number(
      row.dominantFactionId !== null && row.missingFirstScreenIds.includes(row.dominantFactionId),
    );
    metrics.visibility.highPowerRequired += row.highPowerFactionIds.length;
    metrics.visibility.highPowerMissing += row.highPowerFactionIds.filter((factionId) => (
      row.missingFirstScreenIds.includes(factionId)
    )).length;
  }
  metrics.spatialRoots.projected += observation.politicalMap.roots.length;
  metrics.spatialRoots.falseRoots += observation.falseRootIds.length;
  for (const row of observation.governorRows.filter((item) => item.governorCount > 0)) {
    metrics.governorMonopoly.politySamples += 1;
    metrics.governorMonopoly.governorAppointments += row.governorCount;
    metrics.governorMonopoly.factionalAppointments += row.factionalGovernorCount;
    metrics.governorMonopoly.largestFactionAppointments += row.largestFactionCount;
    metrics.governorMonopoly.largestLocalFactionAppointments += row.largestLocalFactionCount;
    metrics.governorMonopoly.rateTotal += row.rate;
    metrics.governorMonopoly.localFactionRateTotal += row.localFactionRate;
    metrics.governorMonopoly.maximumRate = Math.max(metrics.governorMonopoly.maximumRate, row.rate);
    metrics.governorMonopoly.maximumLocalFactionRate = Math.max(
      metrics.governorMonopoly.maximumLocalFactionRate,
      row.localFactionRate,
    );
    if (row.largestFactionCount === row.governorCount) metrics.governorMonopoly.fullyMonopolizedSamples += 1;
    if (row.largestLocalFactionCount === row.governorCount) {
      metrics.governorMonopoly.fullyLocalFactionMonopolizedSamples += 1;
    }
  }
  metrics.leaders.activeLeaderChecks += observation.leaderRows.length;
  metrics.leaders.dead += observation.leaderRows.filter((row) => row.dead).length;
  metrics.leaders.transferred += observation.leaderRows.filter((row) => row.transferred).length;
  metrics.leaders.invalid += observation.leaderRows.filter((row) => row.invalid).length;
}

function finalizeLongRunMetrics(metrics: LongRunMetrics): FinalLongRunMetrics {
  const governor = metrics.governorMonopoly;
  return {
    stateSamples: metrics.stateSamples,
    power: {
      ...metrics.power,
      average: metrics.power.activeFactionPowerObservations > 0
        ? Math.round((metrics.power.total / metrics.power.activeFactionPowerObservations) * 100) / 100
        : null,
      exact100Rate: metrics.power.activeFactionPowerObservations > 0
        ? roundedRatio(metrics.power.exact100, metrics.power.activeFactionPowerObservations)
        : null,
      saturated98OrMoreRate: metrics.power.activeFactionPowerObservations > 0
        ? roundedRatio(metrics.power.saturated98OrMore, metrics.power.activeFactionPowerObservations)
        : null,
    },
    visibility: { ...metrics.visibility },
    spatialRoots: { ...metrics.spatialRoots },
    governorMonopoly: {
      ...governor,
      rateTotal: Math.round(governor.rateTotal * 10_000) / 10_000,
      localFactionRateTotal: Math.round(governor.localFactionRateTotal * 10_000) / 10_000,
      weightedRate: governor.governorAppointments > 0
        ? roundedRatio(governor.largestFactionAppointments, governor.governorAppointments)
        : null,
      meanRate: governor.politySamples > 0
        ? Math.round((governor.rateTotal / governor.politySamples) * 10_000) / 10_000
        : null,
      weightedLocalFactionRate: governor.governorAppointments > 0
        ? roundedRatio(governor.largestLocalFactionAppointments, governor.governorAppointments)
        : null,
      meanLocalFactionRate: governor.politySamples > 0
        ? Math.round((governor.localFactionRateTotal / governor.politySamples) * 10_000) / 10_000
        : null,
      fullyMonopolizedSampleRate: governor.politySamples > 0
        ? roundedRatio(governor.fullyMonopolizedSamples, governor.politySamples)
        : null,
      fullyLocalFactionMonopolizedSampleRate: governor.politySamples > 0
        ? roundedRatio(governor.fullyLocalFactionMonopolizedSamples, governor.politySamples)
        : null,
    },
    leaders: { ...metrics.leaders },
  };
}

function aggregateLongRunMetrics(runs: readonly FinalLongRunMetrics[]): FinalLongRunMetrics {
  const aggregate = emptyLongRunMetrics();
  for (const run of runs) {
    aggregate.stateSamples += run.stateSamples;
    aggregate.power.activeFactionPowerObservations += run.power.activeFactionPowerObservations;
    aggregate.power.ledgerCacheChecks += run.power.ledgerCacheChecks;
    aggregate.power.total += run.power.total;
    aggregate.power.minimum = run.power.minimum === null
      ? aggregate.power.minimum
      : aggregate.power.minimum === null
        ? run.power.minimum
        : Math.min(aggregate.power.minimum, run.power.minimum);
    aggregate.power.maximum = run.power.maximum === null
      ? aggregate.power.maximum
      : aggregate.power.maximum === null
        ? run.power.maximum
        : Math.max(aggregate.power.maximum, run.power.maximum);
    aggregate.power.exact100 += run.power.exact100;
    aggregate.power.saturated98OrMore += run.power.saturated98OrMore;
    aggregate.power.cacheMismatches += run.power.cacheMismatches;
    aggregate.power.outOfRange += run.power.outOfRange;
    for (const key of Object.keys(aggregate.power.bands) as Array<keyof PowerBands>) {
      aggregate.power.bands[key] += run.power.bands[key];
    }
    for (const key of Object.keys(aggregate.visibility) as Array<keyof LongRunMetrics['visibility']>) {
      aggregate.visibility[key] += run.visibility[key];
    }
    aggregate.spatialRoots.projected += run.spatialRoots.projected;
    aggregate.spatialRoots.falseRoots += run.spatialRoots.falseRoots;
    aggregate.governorMonopoly.politySamples += run.governorMonopoly.politySamples;
    aggregate.governorMonopoly.governorAppointments += run.governorMonopoly.governorAppointments;
    aggregate.governorMonopoly.factionalAppointments += run.governorMonopoly.factionalAppointments;
    aggregate.governorMonopoly.largestFactionAppointments += run.governorMonopoly.largestFactionAppointments;
    aggregate.governorMonopoly.largestLocalFactionAppointments += run.governorMonopoly.largestLocalFactionAppointments;
    aggregate.governorMonopoly.rateTotal += run.governorMonopoly.rateTotal;
    aggregate.governorMonopoly.localFactionRateTotal += run.governorMonopoly.localFactionRateTotal;
    aggregate.governorMonopoly.maximumRate = Math.max(
      aggregate.governorMonopoly.maximumRate,
      run.governorMonopoly.maximumRate,
    );
    aggregate.governorMonopoly.maximumLocalFactionRate = Math.max(
      aggregate.governorMonopoly.maximumLocalFactionRate,
      run.governorMonopoly.maximumLocalFactionRate,
    );
    aggregate.governorMonopoly.fullyMonopolizedSamples += run.governorMonopoly.fullyMonopolizedSamples;
    aggregate.governorMonopoly.fullyLocalFactionMonopolizedSamples += (
      run.governorMonopoly.fullyLocalFactionMonopolizedSamples
    );
    for (const key of Object.keys(aggregate.leaders) as Array<keyof LongRunMetrics['leaders']>) {
      aggregate.leaders[key] += run.leaders[key];
    }
  }
  return finalizeLongRunMetrics(aggregate);
}

function politicalFingerprint(
  world: WorldState,
  observation: PoliticalDistributionObservation = observePoliticalDistribution(world, false, false),
): PoliticalFingerprint {
  const politicalMap = observation.politicalMap;
  return {
    turn: world.turn,
    hash: world.hash,
    factDigest: world.factDigest,
    historyDigest: world.historyDigest,
    // Ended factions are intentionally outside the hot world hash. Keep their
    // identity and lineage in this audit fingerprint so replay checks still
    // catch an unauthenticated lifecycle drift.
    factionDigest: stableHash(world.factions),
    // Keep replay/save-resume checks sensitive to the observer-facing spatial
    // politics without serialising an unbounded presentation tree. Roots and
    // assets are capped by the projection contract; pulses are one per polity.
    politicalSpatialDigest: stableHash({
      capitalPulses: politicalMap.capitalPulses.map((pulse) => ({
        polityId: pulse.polityId,
        capitalRegionId: pulse.capitalRegionId,
        dominantFactionId: pulse.dominantFactionId,
        conflictId: pulse.conflict?.relationId ?? null,
        tone: pulse.tone,
      })),
      roots: politicalMap.roots
        .slice(0, POLITICAL_MAP_PROJECTION_LIMITS.rootsPerWorld)
        .map((root) => ({
          id: root.id,
          factionId: root.factionId,
          regionId: root.regionId,
          anchor: [root.anchor.kind, root.anchor.id],
          kind: root.kind,
          powerContribution: root.powerContribution,
          assets: root.assets
            .slice(0, POLITICAL_MAP_PROJECTION_LIMITS.assetsPerRoot)
            .map((asset) => [asset.kind, asset.id, asset.holderId, asset.ledgerResourceId]),
        })),
    }),
    distributionDigest: observation.digest,
  };
}

function sameFingerprint(left: PoliticalFingerprint, right: PoliticalFingerprint): boolean {
  return left.turn === right.turn
    && left.hash === right.hash
    && left.factDigest === right.factDigest
    && left.historyDigest === right.historyDigest
    && left.factionDigest === right.factionDigest
    && left.politicalSpatialDigest === right.politicalSpatialDigest
    && left.distributionDigest === right.distributionDigest;
}

function latestRelationFact(
  facts: readonly SimulationFact[],
  leftId: string,
  rightId: string,
  relation: 'alliance' | 'rivalry',
) {
  const pair = canonicalPair(leftId, rightId);
  return facts
    .filter((fact): fact is Extract<SimulationFact, { kind: 'faction_relation_changed' }> => (
      fact.kind === 'faction_relation_changed'
      && fact.payload.relation === relation
      && canonicalPair(fact.payload.leftFactionId, fact.payload.rightFactionId) === pair
    ))
    .sort((left, right) => right.turn - left.turn || stableCompare(right.id, left.id))[0];
}

function auditLifecycleFacts(
  world: WorldState,
  facts: readonly SimulationFact[],
  scope: string,
): void {
  const factionById = new Map(world.factions.map((faction) => [faction.id, faction]));
  const factById = new Map(facts.map((fact) => [fact.id, fact]));
  const lifecycleFacts = facts.filter((fact): fact is Extract<SimulationFact, { kind: 'faction_lifecycle' }> => (
    fact.kind === 'faction_lifecycle'
  ));
  const relationFacts = facts.filter((fact): fact is Extract<SimulationFact, { kind: 'faction_relation_changed' }> => (
    fact.kind === 'faction_relation_changed'
  ));

  for (const faction of world.factions) {
    let previousTurn = -1;
    for (const record of faction.lifecycle) {
      if (record.turn < previousTurn) fail(scope, `${faction.id}近史时间逆序`);
      previousTurn = record.turn;
      if (record.factId === null) {
        if (faction.origin !== 'legacy' && record.reasonCode !== 'opening_order') {
          fail(scope, `${faction.id}/${record.transition}缺少权威 Fact`);
        }
        continue;
      }
      const fact = factById.get(record.factId);
      if (
        fact?.kind !== 'faction_lifecycle'
        || fact.payload.transition !== record.transition
        || !fact.payload.affectedFactionIds.includes(faction.id)
      ) {
        fail(scope, `${faction.id}近史引用${record.factId}与派系生命周期不符`);
      }
    }
    if (faction.origin !== 'legacy') {
      const origin = faction.originFactId ? factById.get(faction.originFactId) : null;
      if (
        origin?.kind !== 'faction_lifecycle'
        || !origin.payload.createdFactionIds.includes(faction.id)
      ) {
        fail(scope, `${faction.id}缺少可核验建立 Fact`);
      }
    }
    if (!faction.active && faction.endedReason !== 'legacy') {
      const ended = faction.endedFactId ? factById.get(faction.endedFactId) : null;
      if (
        ended?.kind !== 'faction_lifecycle'
        || !ended.payload.endedFactionIds.includes(faction.id)
      ) {
        fail(scope, `${faction.id}缺少可核验结束 Fact`);
      }
    }
  }

  for (const fact of lifecycleFacts) {
    const referencedIds = [
      ...fact.payload.affectedFactionIds,
      ...fact.payload.createdFactionIds,
      ...fact.payload.endedFactionIds,
    ];
    if (!unique(fact.payload.affectedFactionIds)
      || !unique(fact.payload.createdFactionIds)
      || !unique(fact.payload.endedFactionIds)) {
      fail(scope, `${fact.id}包含重复派系引用`);
    }
    for (const factionId of referencedIds) {
      const faction = factionById.get(factionId);
      if (!faction || faction.polityId !== fact.payload.polityId) {
        fail(scope, `${fact.id}引用未知或异国派系${factionId}`);
      }
    }
    if (fact.causes.length === 0 || fact.stateDeltas.length === 0) {
      fail(scope, `${fact.id}缺少因果或状态差量`);
    }
    for (const sourceFactId of fact.sourceFactIds) {
      const source = factById.get(sourceFactId);
      if (!source || source.turn > fact.turn || source.id === fact.id) {
        fail(scope, `${fact.id}引用无效来源 Fact ${sourceFactId}`);
      }
    }
  }

  for (const fact of relationFacts) {
    const left = factionById.get(fact.payload.leftFactionId);
    const right = factionById.get(fact.payload.rightFactionId);
    if (
      !left
      || !right
      || left.id === right.id
      || left.polityId !== fact.payload.polityId
      || right.polityId !== fact.payload.polityId
    ) {
      fail(scope, `${fact.id}关系端点无效`);
    }
    if (fact.causes.length === 0 || fact.stateDeltas.length !== 2) {
      fail(scope, `${fact.id}关系变化缺少完整因果或双向差量`);
    }
    for (const sourceFactId of fact.sourceFactIds) {
      const source = factById.get(sourceFactId);
      if (!source || source.turn > fact.turn || source.id === fact.id) {
        fail(scope, `${fact.id}引用无效来源 Fact ${sourceFactId}`);
      }
    }
  }
}

function auditCourtPowerChains(
  world: WorldState,
  facts: readonly SimulationFact[],
  scope: string,
): CourtChainCounts {
  const factById = new Map(facts.map((fact) => [fact.id, fact]));
  const actions = facts.filter((fact) => fact.kind === 'court_action_resolved');
  const situations = world.situationSystem.situations.filter((situation) => (
    situation.type === 'court_power_struggle'
  ));
  const linkedActionIds = new Set<string>();
  let ledgerGroundedSituations = 0;

  for (const situation of situations) {
    const polity = world.polities.find((item) => item.id === situation.scopeKey);
    if (!polity
      || situation.participants.polityIds.length !== 1
      || situation.participants.polityIds[0] !== situation.scopeKey) {
      fail(scope, `${situation.id}没有严格落在一个真实政权范围`);
    }

    const referencedFactIds = new Set([
      ...situation.causalFactIds,
      ...situation.milestoneFactIds,
      ...situation.recentChanges.flatMap((change) => change.sourceFactIds),
      ...situation.signals.flatMap((signal) => signal.refs
        .filter((ref) => ref.kind === 'fact')
        .map((ref) => ref.kind === 'fact' ? ref.factId : '')),
      ...(situation.resolution?.resultFactIds ?? []),
    ]);
    for (const factId of referencedFactIds) {
      const fact = factById.get(factId);
      if (!fact || !fact.polityIds.includes(situation.scopeKey)) {
        fail(scope, `${situation.id}引用异国或未知Fact ${factId}`);
      }
      if (fact?.kind === 'court_action_resolved') linkedActionIds.add(fact.id);
    }

    const allLedgerRefs = [...situation.signals, situation.nextWatch]
      .flatMap((signal) => signal.refs)
      .filter((ref) => ref.kind === 'index' && ref.entityType === 'faction_power_ledger');
    if (allLedgerRefs.some((ref) => ref.kind === 'index' && ref.field === 'power')) {
      fail(scope, `${situation.id}读取了旧FactionState.power`);
    }
    const categoryRefs = allLedgerRefs.filter((ref) => (
      ref.kind === 'index' && POLITICAL_POWER_CATEGORIES.has(ref.field)
    ));
    const groundedCategories = new Set<string>();
    for (const ref of categoryRefs) {
      if (ref.kind !== 'index') continue;
      const faction = world.factions.find((item) => item.id === ref.entityId);
      if (!faction || faction.polityId !== situation.scopeKey) {
        fail(scope, `${situation.id}引用未知、异国或非POL01分类账${ref.entityId}/${ref.field}`);
        continue;
      }
      if (typeof ref.value !== 'number' || !Number.isFinite(ref.value)) {
        fail(scope, `${situation.id}的分类账证据不是有限数值`);
        continue;
      }
      groundedCategories.add(ref.field);
    }
    if (groundedCategories.size < 2) {
      fail(scope, `${situation.id}不足两类可核验POL01权势账`);
    } else {
      ledgerGroundedSituations += 1;
    }

    const candidate = world.situationSystem.candidates.find((item) => (
      item.key === `court_power_struggle:${situation.scopeKey}`
      && item.lastSeenTurn === world.turn - 1
    ));
    if (candidate) {
      const detectorWorld = {
        ...world,
        turn: candidate.lastSeenTurn,
        facts: world.facts.filter((fact) => fact.turn <= candidate.lastSeenTurn),
      };
      const currentRefs = [...candidate.observation.signals, candidate.observation.nextWatch]
        .flatMap((signal) => signal.refs)
        .filter((ref) => (
          ref.kind === 'index'
          && ref.entityType === 'faction_power_ledger'
          && POLITICAL_POWER_CATEGORIES.has(ref.field)
        ));
      for (const ref of currentRefs) {
        if (ref.kind !== 'index') continue;
        const faction = world.factions.find((item) => item.id === ref.entityId);
        const account = faction && faction.polityId === situation.scopeKey
          ? calculateFactionPowerLedger(detectorWorld, faction).categories
            .find((item) => item.category === ref.field)
          : null;
        if (typeof ref.value !== 'number'
          || !Number.isFinite(ref.value)
          || Math.abs(ref.value - (account?.value ?? Number.NaN)) > 0.11) {
          fail(scope, `${situation.id}当前候选的${ref.entityId}/${ref.field}不是检测时POL01值`);
        }
      }
    }
  }

  return {
    actions: actions.length,
    situations: situations.length,
    linkedActions: linkedActionIds.size,
    ledgerGroundedSituations,
  };
}

function auditFactionIdentity(
  world: WorldState,
  facts: readonly SimulationFact[],
  scope: string,
): number {
  if (!unique(world.factions.map((faction) => faction.id))) fail(scope, '派系 ID 重复');
  const factionById = new Map(world.factions.map((faction) => [faction.id, faction]));
  const active = world.factions.filter((faction) => faction.active);
  const owners = new Map<string, string>();
  const activeByPolity = new Map<string, number>();

  for (const faction of active) {
    activeByPolity.set(faction.polityId, (activeByPolity.get(faction.polityId) ?? 0) + 1);
    if (!unique(faction.memberIds) || !unique(faction.coreMemberIds)) {
      fail(scope, `${faction.id}成员或核心名单重复`);
    }
    const leader = world.characters.find((character) => character.id === faction.leaderId);
    if (
      !leader?.alive
      || leader.age < 16
      || leader.polityId !== faction.polityId
      || leader.factionId !== faction.id
      || !faction.memberIds.includes(leader.id)
      || !faction.coreMemberIds.includes(leader.id)
    ) {
      fail(scope, `${faction.id}领袖不是本派有效核心成员`);
    }
    for (const memberId of faction.memberIds) {
      const previousOwner = owners.get(memberId);
      if (previousOwner && previousOwner !== faction.id) {
        fail(scope, `${memberId}同时属于${previousOwner}与${faction.id}`);
      }
      owners.set(memberId, faction.id);
      const member = world.characters.find((character) => character.id === memberId);
      if (
        !member?.alive
        || member.age < 16
        || member.polityId !== faction.polityId
        || member.factionId !== faction.id
      ) {
        fail(scope, `${faction.id}包含无效当前成员${memberId}`);
      }
    }
    const overlap = faction.alliedFactionIds.filter((id) => faction.rivalFactionIds.includes(id));
    if (overlap.length > 0) fail(scope, `${faction.id}与${overlap.join('、')}同时结盟和相争`);

    for (const [relation, ids] of [
      ['alliance', faction.alliedFactionIds],
      ['rivalry', faction.rivalFactionIds],
    ] as const) {
      if (!unique(ids)) fail(scope, `${faction.id}的${relation}引用重复`);
      for (const otherId of ids) {
        const other = factionById.get(otherId);
        const reverse = relation === 'alliance' ? other?.alliedFactionIds : other?.rivalFactionIds;
        if (!other?.active || other.polityId !== faction.polityId || !reverse?.includes(faction.id)) {
          fail(scope, `${faction.id}与${otherId}的${relation}关系不对称或跨国`);
          continue;
        }
        const relationFact = latestRelationFact(facts, faction.id, otherId, relation);
        if (relationFact?.payload.action !== 'formed') {
          fail(scope, `${faction.id}与${otherId}的当前${relation}关系没有形成 Fact`);
        }
        const sinceTurn = faction.relationSinceTurns[otherId];
        if (!Number.isSafeInteger(sinceTurn) || sinceTurn < 0 || sinceTurn > world.turn) {
          fail(scope, `${faction.id}与${otherId}的关系起始季度无效`);
        } else if (relationFact && relationFact.turn !== sinceTurn) {
          fail(scope, `${faction.id}与${otherId}的关系季度与${relationFact.id}不一致`);
        }
      }
    }
  }

  for (const character of world.characters) {
    if (!character.factionId) continue;
    if (owners.get(character.id) !== character.factionId) {
      fail(scope, `${character.id}的人物归属与派系成员账不一致`);
    }
  }
  for (const [polityId, count] of activeByPolity) {
    if (count > 6) fail(scope, `${polityId}活动派系${count}超过6席`);
  }

  auditLifecycleFacts(world, facts, scope);
  return Math.max(0, ...activeByPolity.values());
}

function expectedCourtRelationIds(factions: readonly FactionState[]): Set<string> {
  const activeIds = new Set(factions.map((faction) => faction.id));
  const result = new Set<string>();
  for (const faction of factions) {
    for (const otherId of faction.alliedFactionIds) {
      if (activeIds.has(otherId)) result.add(`allied:${canonicalPair(faction.id, otherId)}`);
    }
    for (const otherId of faction.rivalFactionIds) {
      if (activeIds.has(otherId)) result.add(`opposed:${canonicalPair(faction.id, otherId)}`);
    }
  }
  return result;
}

function auditCourtProjection(
  world: WorldState,
  polityId: string,
  court: CourtProjectionView,
  facts: readonly SimulationFact[],
  scope: string,
): void {
  const activeFactions = world.factions.filter((faction) => faction.active && faction.polityId === polityId);
  const activeFactionById = new Map(activeFactions.map((faction) => [faction.id, faction]));
  const expectedOffices = world.offices
    .filter((office) => office.active && office.polityId === polityId && CENTRAL_OFFICES.has(office.kind));
  const expectedOfficeIds = new Set(expectedOffices.map((office) => office.id));
  const projectedOfficeIds = new Set(court.seats.map((seat) => seat.officeId));
  if (expectedOfficeIds.size !== projectedOfficeIds.size
    || [...expectedOfficeIds].some((id) => !projectedOfficeIds.has(id))) {
    fail(scope, `${polityId}朝堂席位没有与在任中枢官职逐席对应`);
  }
  if (!unique(court.seats.map((seat) => seat.officeId))) fail(scope, `${polityId}朝堂席位重复`);

  for (const seat of court.seats) {
    const office = expectedOffices.find((candidate) => candidate.id === seat.officeId);
    if (
      !office
      || office.holderId !== seat.holderId
      || office.kind !== seat.office
      || office.rank !== seat.rank
    ) {
      fail(scope, `${seat.id}不是权威在任官职的真实投影`);
      continue;
    }
    const holder = world.characters.find((character) => character.id === office.holderId);
    const expectedFactionId = holder?.factionId && activeFactionById.has(holder.factionId)
      ? holder.factionId
      : null;
    if (seat.factionId !== expectedFactionId) {
      fail(scope, `${seat.id}席位被归入错误派系${seat.factionId ?? '无派'}`);
    }
  }

  const monarchOffice = expectedOffices.find((office) => office.kind === '君主');
  if ((court.ruler?.officeId ?? null) !== (monarchOffice?.id ?? null)) {
    fail(scope, `${polityId}君位没有对应真实君主任命`);
  }
  const projectedFactionIds = new Set(court.factionPositions.map((position) => position.factionId));
  if (projectedFactionIds.size !== activeFactionById.size
    || [...activeFactionById.keys()].some((id) => !projectedFactionIds.has(id))) {
    fail(scope, `${polityId}朝堂没有完整投影活动派系`);
  }
  if (court.factionPositions.filter((position) => position.dominant).length !== (activeFactions.length > 0 ? 1 : 0)) {
    fail(scope, `${polityId}主导派系标记不是唯一的`);
  }
  for (const position of court.factionPositions) {
    const faction = activeFactionById.get(position.factionId);
    if (!faction) continue;
    const expectedSeatIds = court.seats
      .filter((seat) => seat.factionId === faction.id)
      .map((seat) => seat.id)
      .sort(stableCompare);
    if (JSON.stringify([...position.seatIds].sort(stableCompare)) !== JSON.stringify(expectedSeatIds)) {
      fail(scope, `${faction.id}席位归集与逐席投影不一致`);
    }
    const ledger = calculateFactionPowerLedger(world, faction);
    if (position.power !== ledger.total) fail(scope, `${faction.id}朝堂权势没有复用POL01资源账`);
    for (const movement of recentFactionPowerMovements(world, faction, 3)) {
      if (!facts.some((fact) => fact.id === movement.factId)) {
        fail(scope, `${faction.id}近期得失${movement.id}没有来源 Fact`);
      }
    }
  }

  const expectedRelations = expectedCourtRelationIds(activeFactions);
  const projectedRelations = new Set(court.relations.map((relation) => relation.id));
  if (
    expectedRelations.size !== projectedRelations.size
    || [...expectedRelations].some((id) => !projectedRelations.has(id))
  ) {
    fail(scope, `${polityId}朝堂联盟/对立线与权威派系关系不一致`);
  }
}

function preferredCurrentOpposition(
  court: CourtProjectionView,
): CourtProjectionView['relations'][number] | null {
  const dominantFactionId = court.factionPositions.find((position) => position.dominant)?.factionId ?? null;
  return court.relations
    .filter((relation) => relation.kind === 'opposed')
    .sort((left, right) => (
      Number(!(dominantFactionId && [left.leftFactionId, left.rightFactionId].includes(dominantFactionId)))
      - Number(!(dominantFactionId && [right.leftFactionId, right.rightFactionId].includes(dominantFactionId)))
      || stableCompare(left.id, right.id)
    ))[0] ?? null;
}

function auditCapitalPoliticalPulses(
  world: WorldState,
  projection: PoliticalMapProjectionView,
  courtsByPolityId: ReadonlyMap<string, CourtProjectionView>,
  scope: string,
): number {
  const livingPolities = world.polities
    .filter((polity) => polity.alive)
    .sort((left, right) => stableCompare(left.id, right.id));
  const pulses = projection.capitalPulses;
  if (pulses.length !== livingPolities.length) {
    fail(scope, `首都朝局脉搏${pulses.length}个，与存续势力${livingPolities.length}个不符`);
  }
  if (!unique(pulses.map((pulse) => pulse.id)) || !unique(pulses.map((pulse) => pulse.polityId))) {
    fail(scope, '首都朝局脉搏 ID 或势力引用重复');
  }

  for (const polity of livingPolities) {
    const pulse = pulses.find((candidate) => candidate.polityId === polity.id);
    const court = courtsByPolityId.get(polity.id);
    if (!pulse || !court) {
      fail(scope, `${polity.id}缺少当季首都朝局脉搏`);
      continue;
    }
    const capital = world.regions.find((region) => region.id === polity.capitalRegionId);
    const ruler = world.characters.find((character) => character.id === polity.rulerId);
    if (
      !capital
      || pulse.id !== `capital-politics:${polity.id}`
      || pulse.capitalRegionId !== capital.id
      || pulse.capitalName !== capital.name
      || pulse.polityName !== polity.name
    ) {
      fail(scope, `${polity.id}首都脉搏没有落在真实首都`);
    }
    if (
      !ruler
      || pulse.rulerId !== ruler.id
      || pulse.ruler !== ruler.name
      || pulse.authority !== polity.authority
    ) {
      fail(scope, `${polity.id}首都脉搏的君主或权威不是当前状态`);
    }

    const dominant = court.factionPositions.find((position) => position.dominant) ?? null;
    if (
      pulse.dominantFactionId !== (dominant?.factionId ?? null)
      || pulse.dominantFactionName !== (dominant?.name ?? null)
      || pulse.dominantFactionLeaderId !== (dominant?.leaderId ?? null)
      || pulse.dominantFactionPower !== (dominant?.power ?? 0)
    ) {
      fail(scope, `${polity.id}首都脉搏的主导派系与当季活动朝堂不一致`);
    }
    if (pulse.dominantFactionId) {
      const dominantState = world.factions.find((faction) => faction.id === pulse.dominantFactionId);
      if (!dominantState?.active || dominantState.polityId !== polity.id) {
        fail(scope, `${polity.id}首都脉搏引用了非活动或异国主导派系`);
      }
    }

    const expectedOpposition = preferredCurrentOpposition(court);
    if ((pulse.conflict?.relationId ?? null) !== (expectedOpposition?.id ?? null)) {
      fail(scope, `${polity.id}首都脉搏没有采用当季朝堂的优先公开相争`);
    }
    if (pulse.conflict && expectedOpposition) {
      if (
        pulse.conflict.leftFactionId !== expectedOpposition.leftFactionId
        || pulse.conflict.leftFactionName !== expectedOpposition.leftName
        || pulse.conflict.rightFactionId !== expectedOpposition.rightFactionId
        || pulse.conflict.rightFactionName !== expectedOpposition.rightName
        || pulse.conflict.sourceEventId !== expectedOpposition.sourceEventId
        || pulse.conflict.sinceLabel !== expectedOpposition.sinceLabel
      ) {
        fail(scope, `${polity.id}首都脉搏的公开相争详情与活动朝堂关系不一致`);
      }
      const currentFactionIds = new Set(court.factionPositions.map((position) => position.factionId));
      if (
        !currentFactionIds.has(pulse.conflict.leftFactionId)
        || !currentFactionIds.has(pulse.conflict.rightFactionId)
      ) {
        fail(scope, `${polity.id}首都脉搏的相争端点不是当季活动派系`);
      }
    }
  }
  return pulses.length;
}

function currentFleetAnchor(
  world: WorldState,
  fleet: WorldState['fleets'][number],
): FactionSpatialPowerRootView['anchor'] | null {
  if (fleet.seaZoneId) {
    const seaZone = world.seaZones.find((candidate) => candidate.id === fleet.seaZoneId);
    if (seaZone) return { kind: 'seaZone', id: seaZone.id, name: seaZone.name };
  }
  const port = world.regions.find((candidate) => (
    candidate.id === (fleet.portRegionId ?? fleet.homePortRegionId)
  ));
  return port ? { kind: 'region', id: port.id, name: port.name } : null;
}

function currentArmyFactionHolder(world: WorldState, army: WorldState['armies'][number]) {
  const actual = world.characters.find((character) => (
    character.id === army.allegiance.characterId && character.alive && character.polityId === army.polityId
  ));
  if (actual?.factionId && world.factions.some((faction) => (
    faction.id === actual.factionId && faction.active && faction.polityId === army.polityId
  ))) return actual;
  return world.characters.find((character) => (
    character.id === army.commanderId && character.alive && character.polityId === army.polityId
  )) ?? null;
}

function isAuthoritativeSpatialAsset(
  world: WorldState,
  root: FactionSpatialPowerRootView,
  asset: FactionSpatialPowerRootView['assets'][number],
): boolean {
  const holder = world.characters.find((character) => character.id === asset.holderId);
  if (
    !holder?.alive
    || holder.polityId !== root.polityId
    || holder.factionId !== root.factionId
    || holder.name !== asset.holder
  ) return false;
  if (asset.kind === 'governorship') {
    return root.kind === 'regional_governance'
      && root.anchor.kind === 'region'
      && root.anchor.id === root.regionId
      && asset.id === holder.id
      && holder.governedRegionId === root.regionId
      && world.regions.some((region) => (
        region.id === root.regionId && region.controllerId === root.polityId
      ))
      && world.offices.some((office) => (
        office.active
        && office.kind === '地方长官'
        && office.polityId === root.polityId
        && office.holderId === holder.id
        && office.regionId === root.regionId
      ));
  }
  if (asset.kind === 'army') {
    const army = world.armies.find((candidate) => candidate.id === asset.id);
    const currentHolder = army ? currentArmyFactionHolder(world, army) : null;
    return root.kind === 'army_command'
      && root.anchor.kind === 'region'
      && Boolean(army)
      && army?.polityId === root.polityId
      && army.regionId === root.regionId
      && root.anchor.id === army.regionId
      && army.soldiers > 0
      && currentHolder?.id === holder.id
      && (holder.id !== army.commanderId || holder.commandingArmyId === army.id);
  }
  const fleet = world.fleets.find((candidate) => candidate.id === asset.id);
  const anchor = fleet ? currentFleetAnchor(world, fleet) : null;
  return root.kind === 'fleet_command'
    && Boolean(fleet)
    && fleet?.polityId === root.polityId
    && fleet.homePortRegionId === root.regionId
    && fleet.warships + fleet.transports + fleet.patrolShips > 0
    && fleet.commanderId === holder.id
    && holder.commandingFleetId === fleet.id
    && Boolean(anchor)
    && anchor?.kind === root.anchor.kind
    && anchor.id === root.anchor.id
    && anchor.name === root.anchor.name;
}

function matchingRootAssetCount(world: WorldState, root: FactionSpatialPowerRootView): number {
  if (root.kind === 'regional_governance') {
    return world.characters.filter((holder) => (
      holder.alive
      && holder.polityId === root.polityId
      && holder.factionId === root.factionId
      && holder.governedRegionId === root.regionId
      && world.regions.some((region) => region.id === root.regionId && region.controllerId === root.polityId)
      && world.offices.some((office) => (
        office.active
        && office.kind === '地方长官'
        && office.polityId === root.polityId
        && office.holderId === holder.id
        && office.regionId === root.regionId
      ))
    )).length;
  }
  if (root.kind === 'army_command') {
    return world.armies.filter((army) => {
      const holder = currentArmyFactionHolder(world, army);
      return army.polityId === root.polityId
        && army.regionId === root.regionId
        && army.soldiers > 0
        && holder?.factionId === root.factionId
        && (holder.id !== army.commanderId || holder.commandingArmyId === army.id);
    }).length;
  }
  // Fleet roots are deliberately one-per-fleet: fleets sharing a home port
  // may currently be in different ports or sea zones and must never collapse
  // into a marker that follows only the first asset.
  if (root.assets.length !== 1 || root.assets[0]?.kind !== 'fleet') return 0;
  const fleet = world.fleets.find((candidate) => candidate.id === root.assets[0]?.id);
  const commander = world.characters.find((character) => character.id === fleet?.commanderId);
  const anchor = fleet ? currentFleetAnchor(world, fleet) : null;
  return fleet
    && fleet.polityId === root.polityId
    && fleet.homePortRegionId === root.regionId
    && fleet.warships + fleet.transports + fleet.patrolShips > 0
    && Boolean(commander?.alive)
    && commander?.polityId === root.polityId
    && commander.factionId === root.factionId
    && commander.commandingFleetId === fleet.id
    && anchor?.kind === root.anchor.kind
    && anchor.id === root.anchor.id
    ? 1
    : 0;
}

function isTruthfulSpatialRoot(world: WorldState, root: FactionSpatialPowerRootView): boolean {
  const faction = world.factions.find((candidate) => candidate.id === root.factionId);
  const polity = world.polities.find((candidate) => candidate.id === root.polityId);
  const region = world.regions.find((candidate) => candidate.id === root.regionId);
  const anchor = root.anchor.kind === 'region'
    ? world.regions.find((candidate) => candidate.id === root.anchor.id)
    : world.seaZones.find((candidate) => candidate.id === root.anchor.id);
  if (
    !faction?.active
    || !polity?.alive
    || faction.polityId !== polity.id
    || !region
    || !anchor
    || root.assets.length === 0
  ) return false;
  const currentAssetCount = matchingRootAssetCount(world, root);
  return root.assetCount === currentAssetCount
    && root.assetCount >= root.assets.length
    && root.assets.every((asset) => isAuthoritativeSpatialAsset(world, root, asset));
}

function auditSpatialPowerRoot(
  world: WorldState,
  root: FactionSpatialPowerRootView,
  scope: string,
): void {
  const faction = world.factions.find((candidate) => candidate.id === root.factionId);
  const polity = world.polities.find((candidate) => candidate.id === root.polityId);
  const region = world.regions.find((candidate) => candidate.id === root.regionId);
  const anchor = root.anchor.kind === 'region'
    ? world.regions.find((candidate) => candidate.id === root.anchor.id)
    : world.seaZones.find((candidate) => candidate.id === root.anchor.id);
  if (!faction?.active || !polity?.alive || faction.polityId !== polity.id || !region) {
    fail(scope, `${root.id}引用非活动派系、亡国或未知区域`);
    return;
  }
  if (root.polityName !== polity.name || root.factionName !== faction.name || root.regionName !== region.name) {
    fail(scope, `${root.id}的势力、派系或区域名称不是当前状态`);
  }
  if (!anchor || root.anchor.name !== anchor.name) {
    fail(scope, `${root.id}引用未知或失真的当前空间锚点${root.anchor.kind}:${root.anchor.id}`);
  }
  if (root.kind !== 'fleet_command' && (root.anchor.kind !== 'region' || root.anchor.id !== region.id)) {
    fail(scope, `${root.id}州治/军团根基没有落在其当前区域`);
  }
  if (!['regional_governance', 'army_command', 'fleet_command'].includes(root.kind)) {
    fail(scope, `${root.id}把无空间坐标的权势画成了根基`);
    return;
  }
  if (root.assets.length === 0 || root.assets.length > POLITICAL_MAP_PROJECTION_LIMITS.assetsPerRoot) {
    fail(scope, `${root.id}实权资产为空或超过展示上限`);
  }
  if (!unique(root.assets.map((asset) => `${asset.kind}:${asset.id}`))) {
    fail(scope, `${root.id}包含重复实权资产`);
  }
  const currentAssetCount = matchingRootAssetCount(world, root);
  if (root.assetCount !== currentAssetCount || root.assetCount < root.assets.length) {
    fail(scope, `${root.id}资产计数${root.assetCount}与当前实权${currentAssetCount}不一致`);
  }

  const ledger = calculateFactionPowerLedger(world, faction);
  let retainedPower = 0;
  for (const asset of root.assets) {
    const holder = world.characters.find((character) => character.id === asset.holderId);
    if (
      !holder?.alive
      || holder.polityId !== polity.id
      || holder.factionId !== faction.id
      || holder.name !== asset.holder
    ) {
      fail(scope, `${root.id}/${asset.id}持有人不是同国同派的在世人物`);
      continue;
    }
    if (asset.kind === 'governorship') {
      const office = world.offices.find((candidate) => (
        candidate.active
        && candidate.kind === '地方长官'
        && candidate.polityId === polity.id
        && candidate.holderId === holder.id
        && candidate.regionId === region.id
      ));
      if (root.kind !== 'regional_governance' || asset.id !== holder.id || holder.governedRegionId !== region.id || !office) {
        fail(scope, `${root.id}/${asset.id}无法反查当前地方任官`);
      }
    } else if (asset.kind === 'army') {
      const army = world.armies.find((candidate) => candidate.id === asset.id);
      const currentHolder = army ? currentArmyFactionHolder(world, army) : null;
      if (
        root.kind !== 'army_command'
        || !army
        || army.polityId !== polity.id
        || army.regionId !== region.id
        || army.soldiers <= 0
        || currentHolder?.id !== holder.id
        || (holder.id === army.commanderId && holder.commandingArmyId !== army.id)
      ) {
        fail(scope, `${root.id}/${asset.id}无法反查现役军团与双向主将关系`);
      }
    } else {
      const fleet = world.fleets.find((candidate) => candidate.id === asset.id);
      const currentAnchor = fleet ? currentFleetAnchor(world, fleet) : null;
      if (
        root.kind !== 'fleet_command'
        || !fleet
        || fleet.polityId !== polity.id
        || fleet.homePortRegionId !== region.id
        || fleet.warships + fleet.transports + fleet.patrolShips <= 0
        || fleet.commanderId !== holder.id
        || holder.commandingFleetId !== fleet.id
        || !currentAnchor
        || currentAnchor.kind !== root.anchor.kind
        || currentAnchor.id !== root.anchor.id
        || currentAnchor.name !== root.anchor.name
        || root.assetCount !== 1
        || root.assets.length !== 1
      ) {
        fail(scope, `${root.id}/${asset.id}无法反查现役舰队、双向主将或当前舰位锚点`);
      }
    }

    const resource = asset.ledgerResourceId
      ? ledger.resources.find((candidate) => candidate.id === asset.ledgerResourceId)
      : null;
    if (resource) {
      retainedPower += resource.value;
      const allowedCategory = asset.kind === 'governorship' ? 'regional_office' : 'military_command';
      const hasConcreteEvidence = asset.kind === 'governorship'
        ? resource.evidence.some((reference) => (
          reference.entityType === 'office'
          && world.offices.some((office) => (
            office.id === reference.entityId
            && office.active
            && office.kind === '地方长官'
            && office.holderId === holder.id
            && office.regionId === region.id
          ))
        ))
        : resource.evidence.some((reference) => (
          reference.entityType === asset.kind
          && reference.entityId === asset.id
          && (reference.field === 'commanderId' || (asset.kind === 'army' && reference.field === 'allegiance.characterId'))
        ));
      // Fleet roots retain homePortRegionId as asset provenance, but their map
      // anchor follows the current port/sea zone. FleetState is authoritative
      // for that moving anchor; governance/armies must still match ledger
      // regionIds directly.
      const ledgerRegionMatches = asset.kind === 'fleet' || resource.regionIds.includes(region.id);
      if (
        resource.category !== allowedCategory
        || !resource.characterIds.includes(holder.id)
        || !ledgerRegionMatches
        || !hasConcreteEvidence
      ) {
        fail(scope, `${root.id}/${asset.id}引用了非空间权势资源${resource.category}`);
      }
    } else if (asset.ledgerResourceId !== null) {
      fail(scope, `${root.id}/${asset.id}引用不存在的POL01资源${asset.ledgerResourceId}`);
    }
  }
  if (Math.round(retainedPower * 10) / 10 !== root.powerContribution) {
    fail(scope, `${root.id}权势贡献没有复用可追溯的POL01资源`);
  }
}

function auditPoliticalMapProjection(
  world: WorldState,
  projection: PoliticalMapProjectionView,
  courtsByPolityId: ReadonlyMap<string, CourtProjectionView>,
  scope: string,
): { capitalPulseChecks: number; spatialRootChecks: number } {
  if (projection.roots.length > POLITICAL_MAP_PROJECTION_LIMITS.rootsPerWorld) {
    fail(scope, `空间权势根基${projection.roots.length}个，超过世界上限${POLITICAL_MAP_PROJECTION_LIMITS.rootsPerWorld}`);
  }
  if (!unique(projection.roots.map((root) => root.id))) fail(scope, '空间权势根基 ID 重复');
  for (const root of projection.roots) auditSpatialPowerRoot(world, root, scope);
  return {
    capitalPulseChecks: auditCapitalPoliticalPulses(world, projection, courtsByPolityId, scope),
    spatialRootChecks: projection.roots.length,
  };
}

function auditWorld(
  profile: MapProfile,
  seed: string,
  world: WorldState,
  observation: PoliticalDistributionObservation,
  beforeProjection: string,
  beforeProjectionHash: string,
): {
  activePeak: number;
  courtSeatPeak: number;
  spatialRootCount: number;
  projectionChecks: number;
  capitalPulseChecks: number;
} {
  const scope = scoped(profile, seed, world.turn);
  const violations = validateWorld(world);
  if (violations.length > 0) {
    const first = violations[0];
    fail(scope, `validateWorld失败：${first?.code ?? 'unknown'} ${first?.message ?? '未知错误'}`);
  }
  let facts: SimulationFact[];
  try {
    facts = readWorldFacts(world);
  } catch (error) {
    fail(scope, `无法读取完整 Fact：${error instanceof Error ? error.message : String(error)}`);
    facts = [...world.facts];
  }
  const activePeak = auditFactionIdentity(world, facts, scope);
  auditCourtPowerChains(world, facts, scope);
  let courtSeatPeak = 0;
  let projectionChecks = 0;
  const courtsByPolityId = observation.courtsByPolityId;
  for (const polity of world.polities.filter((item) => item.alive).sort((left, right) => stableCompare(left.id, right.id))) {
    const court = courtsByPolityId.get(polity.id);
    if (!court) {
      fail(scope, `${polity.id}缺少POL08当季朝堂投影`);
      continue;
    }
    projectionChecks += 1;
    courtSeatPeak = Math.max(courtSeatPeak, court.seats.length);
    auditCourtProjection(world, polity.id, court, facts, scope);
  }
  const politicalMap = observation.politicalMap;
  projectionChecks += 1;
  const politicalChecks = auditPoliticalMapProjection(world, politicalMap, courtsByPolityId, scope);
  if (serializeWorld(world) !== beforeProjection || world.hash !== beforeProjectionHash) {
    fail(scope, '朝堂或政治地图投影改写了权威世界/hash');
  }
  return {
    activePeak,
    courtSeatPeak,
    spatialRootCount: politicalChecks.spatialRootChecks,
    projectionChecks,
    capitalPulseChecks: politicalChecks.capitalPulseChecks,
  };
}

function run(profile: MapProfile, seed: string, withAudit: boolean): AuditRun {
  let world = createWorld(seed, profile.id);
  const sequence: PoliticalFingerprint[] = [];
  const longRun = emptyLongRunMetrics();
  let splitSave = '';
  let peakActiveFactions = 0;
  let peakCourtSeats = 0;
  let peakSpatialRoots = 0;
  let validationChecks = 0;
  let projectionChecks = 0;
  let capitalPulseChecks = 0;
  let spatialRootChecks = 0;
  for (let step = 0; step <= turns; step += 1) {
    const detailedAuditDue = withAudit && (world.turn % VALIDATION_INTERVAL === 0 || world.turn === turns);
    const beforeProjection = detailedAuditDue ? serializeWorld(world) : '';
    const beforeProjectionHash = world.hash;
    const observation = observePoliticalDistribution(world, withAudit, detailedAuditDue);
    sequence.push(politicalFingerprint(world, observation));
    if (withAudit) {
      const scope = scoped(profile, seed, world.turn);
      auditDistributionObservation(observation, scope);
      accumulateLongRunMetrics(longRun, observation);
      peakSpatialRoots = Math.max(peakSpatialRoots, observation.politicalMap.roots.length);
    }
    if (world.turn === splitTurn) splitSave = serializeWorld(world);
    if (detailedAuditDue) {
      const result = auditWorld(
        profile,
        seed,
        world,
        observation,
        beforeProjection,
        beforeProjectionHash,
      );
      validationChecks += 1;
      projectionChecks += result.projectionChecks;
      peakActiveFactions = Math.max(peakActiveFactions, result.activePeak);
      peakCourtSeats = Math.max(peakCourtSeats, result.courtSeatPeak);
      peakSpatialRoots = Math.max(peakSpatialRoots, result.spatialRootCount);
      capitalPulseChecks += result.capitalPulseChecks;
      spatialRootChecks += result.spatialRootCount;
    }
    if (step < turns) world = advanceWorld(world);
  }
  if (!splitSave) throw new Error(`未取得T${splitTurn}政治审计存档`);
  return {
    world,
    sequence,
    splitSave,
    longRun: finalizeLongRunMetrics(longRun),
    peakActiveFactions,
    peakCourtSeats,
    peakSpatialRoots,
    validationChecks,
    projectionChecks,
    capitalPulseChecks,
    spatialRootChecks,
  };
}

function transitionCounts(facts: readonly SimulationFact[]): TransitionCounts {
  const result: TransitionCounts = { formed: 0, leader_changed: 0, split: 0, merged: 0, ended: 0 };
  for (const fact of facts) {
    if (fact.kind === 'faction_lifecycle') result[fact.payload.transition] += 1;
  }
  return result;
}

function relationCounts(facts: readonly SimulationFact[]): RelationCounts {
  const result: RelationCounts = { allianceFormed: 0, allianceEnded: 0, rivalryFormed: 0, rivalryEnded: 0 };
  for (const fact of facts) {
    if (fact.kind !== 'faction_relation_changed') continue;
    if (fact.payload.relation === 'alliance' && fact.payload.action === 'formed') result.allianceFormed += 1;
    else if (fact.payload.relation === 'alliance') result.allianceEnded += 1;
    else if (fact.payload.action === 'formed') result.rivalryFormed += 1;
    else result.rivalryEnded += 1;
  }
  return result;
}

function leaderTransitionCounts(
  facts: readonly SimulationFact[],
  scope?: string,
): LeaderTransitionCounts {
  const result: LeaderTransitionCounts = {
    total: 0,
    death: 0,
    transferred: 0,
    otherUnavailable: 0,
    invalidFacts: 0,
  };
  const factById = new Map(facts.map((fact) => [fact.id, fact]));
  for (const fact of facts) {
    if (fact.kind !== 'faction_lifecycle' || fact.payload.transition !== 'leader_changed') continue;
    result.total += 1;
    const previousLeaderId = fact.payload.previousLeaderId;
    const nextLeaderId = fact.payload.nextLeaderId;
    const beforeMatches = previousLeaderId !== null && fact.payload.before.some((snapshot) => (
      fact.payload.affectedFactionIds.includes(snapshot.factionId)
      && snapshot.leaderId === previousLeaderId
    ));
    const afterMatches = nextLeaderId !== null && fact.payload.after.some((snapshot) => (
      fact.payload.affectedFactionIds.includes(snapshot.factionId)
      && snapshot.leaderId === nextLeaderId
    ));
    const structurallyValid = previousLeaderId !== null
      && nextLeaderId !== null
      && previousLeaderId !== nextLeaderId
      && beforeMatches
      && afterMatches;
    if (!structurallyValid) {
      result.invalidFacts += 1;
      if (scope) fail(scope, `${fact.id}领袖更替缺少可核对的前任/后任快照`);
    }
    const sources = fact.sourceFactIds
      .map((factId) => factById.get(factId))
      .filter((source): source is SimulationFact => Boolean(source));
    const death = Boolean(previousLeaderId && sources.some((source) => (
      source.kind === 'character_death' && source.payload.characterId === previousLeaderId
    )));
    const transferred = Boolean(previousLeaderId && sources.some((source) => source.stateDeltas.some((delta) => (
      delta.entityType === 'character'
      && delta.entityId === previousLeaderId
      && delta.field === 'factionId'
      && fact.payload.affectedFactionIds.includes(String(delta.before))
      && delta.after === null
    ))));
    if (death) result.death += 1;
    else if (transferred || fact.payload.reasonCode === 'leader_departed') result.transferred += 1;
    else result.otherUnavailable += 1;
    if (scope && fact.payload.reasonCode === 'leader_departed' && !transferred) {
      fail(scope, `${fact.id}转籍领袖更替没有人物离派来源差量`);
    }
    if (scope && fact.payload.reasonCode === 'leader_unavailable' && !death && fact.sourceFactIds.length === 0) {
      fail(scope, `${fact.id}失效领袖更替没有任何来源 Fact`);
    }
  }
  return result;
}

const profiles = listMapProfiles();
if (profiles.length < 2) {
  throw new Error(`POL02/POL03审计需要两张地图，当前只发现${profiles.length}张`);
}

const samples: AuditSample[] = [];
for (const profile of profiles) {
  for (const seed of seeds) {
    const first = run(profile, seed, true);
    const replay = run(profile, seed, false);
    const replayDistributionExact = first.sequence.length === replay.sequence.length
      && first.sequence.every((entry, index) => (
        entry.distributionDigest === replay.sequence[index]?.distributionDigest
      ));
    const replayExact = first.sequence.length === replay.sequence.length
      && first.sequence.every((entry, index) => sameFingerprint(entry, replay.sequence[index] as PoliticalFingerprint))
      && serializeWorld(first.world) === serializeWorld(replay.world);
    if (!replayExact) fail(scoped(profile, seed, turns), '同地图同种子直推的派系序列不确定');
    if (!replayDistributionExact) fail(scoped(profile, seed, turns), '直推/重放的POL08分布digest不一致');

    let resumed: WorldState | null = null;
    let resumeExact = false;
    let resumeDistributionExact = false;
    try {
      resumed = deserializeWorld(first.splitSave);
      const restoredFingerprint = politicalFingerprint(resumed);
      const splitFingerprint = first.sequence[splitTurn] as PoliticalFingerprint;
      resumeExact = sameFingerprint(restoredFingerprint, splitFingerprint);
      resumeDistributionExact = restoredFingerprint.distributionDigest === splitFingerprint.distributionDigest;
      for (let turn = splitTurn + 1; turn <= turns; turn += 1) {
        resumed = advanceWorld(resumed);
        const resumedFingerprint = politicalFingerprint(resumed);
        const directFingerprint = first.sequence[turn] as PoliticalFingerprint;
        if (resumedFingerprint.distributionDigest !== directFingerprint.distributionDigest) {
          resumeDistributionExact = false;
        }
        if (!sameFingerprint(resumedFingerprint, directFingerprint)) {
          resumeExact = false;
        }
      }
      resumeExact = resumeExact && serializeWorld(resumed) === serializeWorld(first.world);
    } catch (error) {
      resumeExact = false;
      resumeDistributionExact = false;
      fail(
        scoped(profile, seed, splitTurn),
        `政治存档无法恢复：${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!resumeExact) fail(scoped(profile, seed, turns), `T${splitTurn}存读档后的派系演化分叉`);
    if (!resumeDistributionExact) {
      fail(scoped(profile, seed, turns), `${splitTurn}+${turns - splitTurn}续推的POL08分布digest不一致`);
    }

    const facts = readWorldFacts(first.world);
    const finalScope = scoped(profile, seed, turns);
    const courtChains = auditCourtPowerChains(first.world, facts, finalScope);
    const leaderTransitions = leaderTransitionCounts(facts, finalScope);
    samples.push({
      profileId: profile.id,
      revision: profile.revision,
      seed,
      finalHash: first.world.hash,
      factions: first.world.factions.length,
      activeFactions: first.world.factions.filter((faction) => faction.active).length,
      peakActiveFactions: first.peakActiveFactions,
      peakCourtSeats: first.peakCourtSeats,
      peakSpatialRoots: first.peakSpatialRoots,
      lifecycle: transitionCounts(facts),
      relations: relationCounts(facts),
      leaderTransitions,
      longRun: first.longRun,
      distributionDigest: first.sequence.at(-1)?.distributionDigest ?? '',
      courtActions: courtChains.actions,
      courtSituations: courtChains.situations,
      linkedCourtActions: courtChains.linkedActions,
      ledgerGroundedCourtSituations: courtChains.ledgerGroundedSituations,
      validationChecks: first.validationChecks,
      projectionChecks: first.projectionChecks,
      capitalPulseChecks: first.capitalPulseChecks,
      spatialRootChecks: first.spatialRootChecks,
      replayExact,
      resumeExact,
      replayDistributionExact,
      resumeDistributionExact,
    });
  }
}

const aggregate = samples.reduce((sum, sample) => ({
  worlds: sum.worlds + 1,
  factions: sum.factions + sample.factions,
  activeFactions: sum.activeFactions + sample.activeFactions,
  formed: sum.formed + sample.lifecycle.formed,
  leaderChanged: sum.leaderChanged + sample.lifecycle.leader_changed,
  split: sum.split + sample.lifecycle.split,
  merged: sum.merged + sample.lifecycle.merged,
  ended: sum.ended + sample.lifecycle.ended,
  allianceFormed: sum.allianceFormed + sample.relations.allianceFormed,
  allianceEnded: sum.allianceEnded + sample.relations.allianceEnded,
  rivalryFormed: sum.rivalryFormed + sample.relations.rivalryFormed,
  rivalryEnded: sum.rivalryEnded + sample.relations.rivalryEnded,
  leaderTransitionDeath: sum.leaderTransitionDeath + sample.leaderTransitions.death,
  leaderTransitionTransferred: sum.leaderTransitionTransferred + sample.leaderTransitions.transferred,
  leaderTransitionOtherUnavailable: sum.leaderTransitionOtherUnavailable + sample.leaderTransitions.otherUnavailable,
  invalidLeaderTransitionFacts: sum.invalidLeaderTransitionFacts + sample.leaderTransitions.invalidFacts,
  replayDistributionExact: sum.replayDistributionExact + Number(sample.replayDistributionExact),
  resumeDistributionExact: sum.resumeDistributionExact + Number(sample.resumeDistributionExact),
  projectionChecks: sum.projectionChecks + sample.projectionChecks,
  capitalPulseChecks: sum.capitalPulseChecks + sample.capitalPulseChecks,
  spatialRootChecks: sum.spatialRootChecks + sample.spatialRootChecks,
  courtActions: sum.courtActions + sample.courtActions,
  courtSituations: sum.courtSituations + sample.courtSituations,
  linkedCourtActions: sum.linkedCourtActions + sample.linkedCourtActions,
  ledgerGroundedCourtSituations: sum.ledgerGroundedCourtSituations + sample.ledgerGroundedCourtSituations,
}), {
  worlds: 0,
  factions: 0,
  activeFactions: 0,
  formed: 0,
  leaderChanged: 0,
  split: 0,
  merged: 0,
  ended: 0,
  allianceFormed: 0,
  allianceEnded: 0,
  rivalryFormed: 0,
  rivalryEnded: 0,
  leaderTransitionDeath: 0,
  leaderTransitionTransferred: 0,
  leaderTransitionOtherUnavailable: 0,
  invalidLeaderTransitionFacts: 0,
  replayDistributionExact: 0,
  resumeDistributionExact: 0,
  projectionChecks: 0,
  capitalPulseChecks: 0,
  spatialRootChecks: 0,
  courtActions: 0,
  courtSituations: 0,
  linkedCourtActions: 0,
  ledgerGroundedCourtSituations: 0,
});

const longRun = aggregateLongRunMetrics(samples.map((sample) => sample.longRun));

if (aggregate.formed === 0) fail('aggregate', '固定样本没有建立任何权威派系');
if (aggregate.allianceFormed + aggregate.rivalryFormed === 0) {
  fail('aggregate', '固定样本没有形成任何有 Fact 的派系关系');
}
if (aggregate.projectionChecks === 0) fail('aggregate', '没有执行任何朝堂投影真实性检查');
if (aggregate.capitalPulseChecks === 0) fail('aggregate', '没有核验任何首都朝局脉搏');
if (aggregate.spatialRootChecks === 0) fail('aggregate', '固定样本没有形成任何可核验的空间权势根基');
if (aggregate.courtActions === 0) fail('aggregate', '固定样本没有形成任何权威朝堂行动Fact');
if (aggregate.courtSituations === 0) fail('aggregate', '固定样本没有形成任何朝堂权斗Situation');
if (aggregate.ledgerGroundedCourtSituations === 0) fail('aggregate', '没有朝堂Situation由至少两类POL01权势根基支撑');
if (longRun.power.outOfRange > 0) fail('aggregate', `权势账有${longRun.power.outOfRange}次越出0..100`);
if (longRun.power.cacheMismatches > 0) fail('aggregate', `权势cache有${longRun.power.cacheMismatches}次不精确`);
if (longRun.visibility.dominantMissing > 0 || longRun.visibility.highPowerMissing > 0) {
  fail('aggregate', `首屏遗漏主导派${longRun.visibility.dominantMissing}次、>=60派${longRun.visibility.highPowerMissing}次`);
}
if (longRun.spatialRoots.falseRoots > 0) fail('aggregate', `存在${longRun.spatialRoots.falseRoots}个伪空间根基观测`);
if (longRun.leaders.invalid > 0) fail('aggregate', `存在${longRun.leaders.invalid}次死亡/转籍/失效活动领袖观测`);
if (aggregate.invalidLeaderTransitionFacts > 0) {
  fail('aggregate', `存在${aggregate.invalidLeaderTransitionFacts}条不完整领袖更替 Fact`);
}
// Split, merge and rivalry are sparse emergent outcomes. POL08 reports their
// exact distribution below but deliberately sets no minimum occurrence gate.

console.log(JSON.stringify({
  phase: 'POL02-POL08 political identity, visibility and long-run truthfulness gate',
  policy: {
    hardTruthfulness: [
      'POL01 ledger total outside 0..100 or active FactionState.power cache mismatch',
      'dominant or real power >=60 active faction absent from first-screen court projection',
      'spatial root without authoritative governor/legal commander/actual army allegiance/fleet commander backing',
      'dead, transferred or otherwise invalid leader retained by an active faction',
      'malformed lifecycle/relation evidence or direct/replay/resume distribution digest drift',
    ],
    observationalOnly: [
      'power=100 and power>=98 saturation counts',
      'single-faction and local-faction governor monopoly rates',
      'leader-change cause counts',
      'court-action Facts linked into a same-polity Situation (natural occurrence, no minimum)',
      'formed/leader_changed/split/merged/ended and alliance/rivalry distributions',
    ],
  },
  scope: {
    profiles: profiles.map((profile) => `${profile.id}@${profile.revision}`),
    seeds,
    mode: auditMode,
    turnsPerWorld: turns,
    resume: `${splitTurn}+${turns - splitTurn}`,
    validationInterval: VALIDATION_INTERVAL,
    optionalDeep: `--deep[=${MINIMUM_DEEP_TURNS}..${MAXIMUM_DEEP_TURNS}] (default ${DEFAULT_DEEP_TURNS})`,
  },
  aggregate,
  longRun,
  samples,
  failures,
}, null, 2));

if (failures.length > 0) process.exitCode = 1;
