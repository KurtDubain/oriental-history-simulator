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

const DEFAULT_SEEDS = ['朝局审计-甲', '朝局审计-乙'] as const;
const configuredSeeds = process.env.POLITICS_AUDIT_SEEDS
  ?.split(',')
  .map((seed) => seed.trim())
  .filter(Boolean);
const seeds = configuredSeeds?.length ? configuredSeeds : [...DEFAULT_SEEDS];
const requestedTurns = Number.parseInt(process.env.POLITICS_AUDIT_TURNS ?? '64', 10);
const turns = Number.isSafeInteger(requestedTurns) ? Math.max(16, requestedTurns) : 64;
const splitTurn = Math.max(8, Math.min(turns - 1, Math.floor(turns / 2)));
const VALIDATION_INTERVAL = 8;
const CENTRAL_OFFICES = new Set(['君主', '宰辅', '枢密使', '廷臣']);

interface PoliticalFingerprint {
  turn: number;
  hash: string;
  factDigest: string;
  historyDigest: string;
  factionDigest: string;
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

interface AuditRun {
  world: WorldState;
  sequence: PoliticalFingerprint[];
  splitSave: string;
  peakActiveFactions: number;
  peakCourtSeats: number;
  validationChecks: number;
  projectionChecks: number;
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
  lifecycle: TransitionCounts;
  relations: RelationCounts;
  validationChecks: number;
  projectionChecks: number;
  replayExact: boolean;
  resumeExact: boolean;
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

function politicalFingerprint(world: WorldState): PoliticalFingerprint {
  return {
    turn: world.turn,
    hash: world.hash,
    factDigest: world.factDigest,
    historyDigest: world.historyDigest,
    // Ended factions are intentionally outside the hot world hash. Keep their
    // identity and lineage in this audit fingerprint so replay checks still
    // catch an unauthenticated lifecycle drift.
    factionDigest: stableHash(world.factions),
  };
}

function sameFingerprint(left: PoliticalFingerprint, right: PoliticalFingerprint): boolean {
  return left.turn === right.turn
    && left.hash === right.hash
    && left.factDigest === right.factDigest
    && left.historyDigest === right.historyDigest
    && left.factionDigest === right.factionDigest;
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

function auditWorld(profile: MapProfile, seed: string, world: WorldState): { activePeak: number; courtSeatPeak: number; projectionChecks: number } {
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
  const beforeProjection = serializeWorld(world);
  let courtSeatPeak = 0;
  let projectionChecks = 0;
  for (const polity of world.polities.filter((item) => item.alive).sort((left, right) => stableCompare(left.id, right.id))) {
    const court = projectCourt(world, polity.id);
    projectionChecks += 1;
    courtSeatPeak = Math.max(courtSeatPeak, court.seats.length);
    auditCourtProjection(world, polity.id, court, facts, scope);
  }
  if (serializeWorld(world) !== beforeProjection) fail(scope, 'projectCourt改写了权威世界');
  return { activePeak, courtSeatPeak, projectionChecks };
}

function run(profile: MapProfile, seed: string, withAudit: boolean): AuditRun {
  let world = createWorld(seed, profile.id);
  const sequence: PoliticalFingerprint[] = [];
  let splitSave = '';
  let peakActiveFactions = 0;
  let peakCourtSeats = 0;
  let validationChecks = 0;
  let projectionChecks = 0;
  for (let step = 0; step <= turns; step += 1) {
    sequence.push(politicalFingerprint(world));
    if (world.turn === splitTurn) splitSave = serializeWorld(world);
    if (withAudit && (world.turn % VALIDATION_INTERVAL === 0 || world.turn === turns)) {
      const result = auditWorld(profile, seed, world);
      validationChecks += 1;
      projectionChecks += result.projectionChecks;
      peakActiveFactions = Math.max(peakActiveFactions, result.activePeak);
      peakCourtSeats = Math.max(peakCourtSeats, result.courtSeatPeak);
    }
    if (step < turns) world = advanceWorld(world);
  }
  if (!splitSave) throw new Error(`未取得T${splitTurn}政治审计存档`);
  return { world, sequence, splitSave, peakActiveFactions, peakCourtSeats, validationChecks, projectionChecks };
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

const profiles = listMapProfiles();
if (profiles.length < 2) {
  throw new Error(`POL02/POL03审计需要两张地图，当前只发现${profiles.length}张`);
}

const samples: AuditSample[] = [];
for (const profile of profiles) {
  for (const seed of seeds) {
    const first = run(profile, seed, true);
    const replay = run(profile, seed, false);
    const replayExact = first.sequence.length === replay.sequence.length
      && first.sequence.every((entry, index) => sameFingerprint(entry, replay.sequence[index] as PoliticalFingerprint))
      && serializeWorld(first.world) === serializeWorld(replay.world);
    if (!replayExact) fail(scoped(profile, seed, turns), '同地图同种子直推的派系序列不确定');

    let resumed: WorldState | null = null;
    let resumeExact = false;
    try {
      resumed = deserializeWorld(first.splitSave);
      resumeExact = sameFingerprint(
        politicalFingerprint(resumed),
        first.sequence[splitTurn] as PoliticalFingerprint,
      );
      for (let turn = splitTurn + 1; turn <= turns; turn += 1) {
        resumed = advanceWorld(resumed);
        if (!sameFingerprint(politicalFingerprint(resumed), first.sequence[turn] as PoliticalFingerprint)) {
          resumeExact = false;
          break;
        }
      }
      resumeExact = resumeExact && serializeWorld(resumed) === serializeWorld(first.world);
    } catch (error) {
      fail(
        scoped(profile, seed, splitTurn),
        `政治存档无法恢复：${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!resumeExact) fail(scoped(profile, seed, turns), `T${splitTurn}存读档后的派系演化分叉`);

    const facts = readWorldFacts(first.world);
    samples.push({
      profileId: profile.id,
      revision: profile.revision,
      seed,
      finalHash: first.world.hash,
      factions: first.world.factions.length,
      activeFactions: first.world.factions.filter((faction) => faction.active).length,
      peakActiveFactions: first.peakActiveFactions,
      peakCourtSeats: first.peakCourtSeats,
      lifecycle: transitionCounts(facts),
      relations: relationCounts(facts),
      validationChecks: first.validationChecks,
      projectionChecks: first.projectionChecks,
      replayExact,
      resumeExact,
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
  relationsFormed: sum.relationsFormed + sample.relations.allianceFormed + sample.relations.rivalryFormed,
  projectionChecks: sum.projectionChecks + sample.projectionChecks,
}), {
  worlds: 0,
  factions: 0,
  activeFactions: 0,
  formed: 0,
  leaderChanged: 0,
  split: 0,
  merged: 0,
  ended: 0,
  relationsFormed: 0,
  projectionChecks: 0,
});

if (aggregate.formed === 0) fail('aggregate', '固定样本没有建立任何权威派系');
if (aggregate.relationsFormed === 0) fail('aggregate', '固定样本没有形成任何有 Fact 的派系关系');
if (aggregate.projectionChecks === 0) fail('aggregate', '没有执行任何朝堂投影真实性检查');

console.log(JSON.stringify({
  phase: 'POL02/POL03 political identity and court gate',
  scope: {
    profiles: profiles.map((profile) => `${profile.id}@${profile.revision}`),
    seeds,
    turnsPerWorld: turns,
    resume: `${splitTurn}+${turns - splitTurn}`,
    validationInterval: VALIDATION_INTERVAL,
  },
  aggregate,
  samples,
  failures,
}, null, 2));

if (failures.length > 0) process.exitCode = 1;
