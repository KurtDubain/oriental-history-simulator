import {
  advanceWorld,
  createWorld,
  deserializeWorld,
  serializeWorld,
  validateWorld,
  type BiographyFact,
  type CharacterState,
  type WorldState,
} from '../src/sim';

// Historical regression harness retained for comparing V0.2 social-system
// distributions. It is not the V0.3 release gate; use scripts/v03-audit.ts for
// map, ocean, flow, disease, migration and knowledge acceptance. New worlds
// use the current runtime schema; "V0.2" below names the audited social contract,
// not a serialized schema version.

const SHORT_SEED_COUNT = positiveIntegerFromEnv('V02_AUDIT_SHORT_SEEDS', 64);
const SHORT_QUARTERS = positiveIntegerFromEnv('V02_AUDIT_SHORT_QUARTERS', 200);
const LONG_SEED_COUNT = positiveIntegerFromEnv('V02_AUDIT_LONG_SEEDS', 12);
const LONG_QUARTERS = positiveIntegerFromEnv('V02_AUDIT_LONG_QUARTERS', 800);
const DETERMINISM_SEED_COUNT = Math.min(3, SHORT_SEED_COUNT);
const STRUCTURAL_ONLY = process.env.V02_AUDIT_STRUCTURAL_ONLY === '1';
const MAX_IMPORT_BYTES = 16 * 1024 * 1024;
const RELATION_EDGE_FACTOR_LIMIT = 24;
const MAJOR_POLITICAL_EVENT_KINDS = new Set(['succession', 'usurpation', 'rebellion', 'coup', 'purge']);
const CURRENT_RUNTIME_SCHEMA_VERSION = 4;

type BackgroundCareerStage = 'commander' | 'powerBroker' | 'ruler' | 'rebelLeader';

const POLITICAL_EVIDENCE_PATTERNS = {
  resources: /军|兵|粮|财|税|财富|国库|官职|职位|派系|权力|影响|声望|领地|权限|组织|征调|产业|网络|支持/,
  relationships: /忠诚|信任|积怨|婚|盟|家族|谱系|宗族|恩|怨|君主|领袖|成员|服从|关系|支持/,
  environment: /权威|合法|行政|朝廷|制度|危机|战争|民怨|局势|结构|近期|多政权|首都|领土|地方|统治/,
} as const;

type EventGroup =
  | 'birth'
  | 'adulthood'
  | 'death'
  | 'family'
  | 'politics'
  | 'deputy'
  | 'diplomacy';

const EVENT_GROUP_PATTERNS: Record<EventGroup, readonly RegExp[]> = {
  birth: [/birth/i, /born/i, /child_born/i],
  adulthood: [/adult/i, /coming_of_age/i],
  death: [/character_death/i],
  family: [/^marriage$/i, /^diplomatic_marriage$/i, /^family_/i],
  politics: [/^political_alliance$/i, /^power_broker$/i, /^coup$/i, /^usurpation$/i, /^purge$/i, /^regency$/i, /^independence$/i],
  deputy: [/^deputy_merit$/i, /^deputy_promoted$/i, /^order_refused$/i, /^military_oath$/i, /^army_defected$/i],
  diplomacy: [/^diplomatic_marriage$/i, /^alliance_formed$/i, /^alliance_ended$/i, /^treaty_/i, /^tribute_/i],
};

interface WorldEmergence {
  eventKinds: Record<string, number>;
  groups: Record<EventGroup, number>;
  parentedCharacters: number;
  marriedCharacters: number;
  branchFamilies: number;
  promotedBackgroundCharacters: number;
  experiencedDeputies: number;
  insubordinateCharacters: number;
  activeAlliances: number;
  factionCount: number;
  relationshipCount: number;
  maximumFamilyOfficeShare: number;
  density: {
    battle: number;
    deputyMerit: number;
    deputyPromoted: number;
    powerBroker: number;
    commitmentsCreated: number;
    biographyFacts: number;
  };
  commanderTenureQuarters: number[];
  rapidCommanderReversals: number;
  explainedRapidCommanderReversals: number;
  unexplainedRapidCommanderReversals: number;
  rapidCommanderReversalExamples: Array<{
    armyId: string;
    firstOfficeId: string;
    middleOfficeId: string;
    lastOfficeId: string;
    firstHolderId: string;
    middleHolderId: string;
    firstAppointedTurn: number;
    firstEndedTurn: number | null;
    middleAppointedTurn: number;
    lastAppointedTurn: number;
    middleEndedTurn: number | null;
    lastEndedTurn: number | null;
    middleHolderDeathTurn: number | null;
    middleHolderFinalPolityId: string;
    finalArmyPolityId: string | null;
    explanation: 'middle_holder_died' | 'middle_holder_changed_polity' | 'middle_holder_purged' | 'army_changed_polity' | null;
    relatedEvents: Array<{ turn: number; kind: string; title: string }>;
  }>;
  maximumPromotionsForOneCharacter: number;
  initialCohortMarriageEvents: number;
  descendantMarriageEvents: number;
  backgroundCareerPaths: Record<BackgroundCareerStage | 'anyHighOffice', number>;
  familyInheritanceOccurred: boolean;
  familyBranchOccurred: boolean;
  multigenerationalFamilyOccurred: boolean;
  majorPoliticalEvents: number;
  majorPoliticalEventsWithCompleteRoles: number;
  majorPoliticalEventsWithEvidenceTriad: number;
}

interface RunResult {
  world: WorldState;
  turnDurations: number[];
  minimumLivingPolities: number;
}

function positiveIntegerFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} 必须是正整数，收到 ${raw}`);
  }
  return value;
}

function fail(message: string): never {
  throw new Error(message);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated].sort();
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.min(ordered.length - 1, Math.max(0, Math.ceil(ordered.length * fraction) - 1));
  return ordered[index] ?? 0;
}

function assertMetric(value: number, label: string, minimum = 0, maximum = 100): void {
  assert(Number.isFinite(value) && value >= minimum && value <= maximum, `${label} 越界：${value}`);
}

function assertQuarterState(world: WorldState, label: string): void {
  assert(world.schemaVersion === CURRENT_RUNTIME_SCHEMA_VERSION, `${label} 不是当前 schema ${CURRENT_RUNTIME_SCHEMA_VERSION} 世界`);
  for (const region of world.regions) {
    assert(
      Number.isSafeInteger(region.population) && region.population >= 0
        && Number.isSafeInteger(region.food) && region.food >= 0
        && Number.isSafeInteger(region.wealth) && region.wealth >= 0,
      `${label} 地区账户无效：${region.id}`,
    );
  }
  for (const army of world.armies) {
    assert(
      Number.isSafeInteger(army.soldiers) && army.soldiers > 0
        && Number.isSafeInteger(army.food) && army.food >= 0,
      `${label} 军团账户无效：${army.id}`,
    );
  }
  for (const family of world.families) {
    assert(
      Number.isFinite(family.wealth) && family.wealth >= 0,
      `${label} 家族财富无效：${family.id}`,
    );
  }
  const overCapacity = world.lastTurn?.logistics.routeUsage.find((usage) => (
    usage.reserved < 0 || usage.reserved > usage.capacity
  ));
  assert(!overCapacity, `${label} 路线运力越界：${overCapacity?.routeId ?? 'unknown'}`);
}

function hasAncestorCycle(character: CharacterState, characterById: Map<string, CharacterState>): boolean {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    const current = characterById.get(id);
    if (!current) return false;
    visiting.add(id);
    for (const parentId of current.parentIds) {
      if (visit(parentId)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return visit(character.id);
}

function assertBiographyFact(
  world: WorldState,
  character: CharacterState,
  fact: BiographyFact,
  eventById: Map<string, WorldState['history'][number]>,
  factById: Map<string, WorldState['facts'][number]>,
  previousTurn: number,
  label: string,
): void {
  assert(fact.turn >= previousTurn && fact.turn <= world.turn, `${label} ${character.id} 传记时间逆序：${fact.id}`);
  assert(fact.summary.trim().length > 0, `${label} ${character.id} 传记事实没有摘要：${fact.id}`);
  if (fact.factId !== null) {
    const sourceFact = factById.get(fact.factId);
    assert(sourceFact, `${label} ${character.id} 传记引用不存在模拟事实：${fact.factId}`);
    assert(fact.eventId === null, `${label} ${character.id} 传记不得同时引用事件与模拟事实：${fact.id}`);
    assert(sourceFact.turn === fact.turn, `${label} ${character.id} 传记与模拟事实季度不一致：${fact.id}`);
    assert(
      sourceFact.actorIds.includes(character.id),
      `${label} ${character.id} 的“${fact.kind}”不是模拟事实 ${fact.factId}/${sourceFact.kind} 的参与者`,
    );
    return;
  }
  if (fact.eventId === null) {
    assert(fact.turn <= 0, `${label} ${character.id} 的后天传记事实缺少事件来源：${fact.id}`);
    return;
  }
  const event = eventById.get(fact.eventId);
  assert(event, `${label} ${character.id} 传记引用不存在事件：${fact.eventId}`);
  assert(event.turn === fact.turn, `${label} ${character.id} 传记与来源事件季度不一致：${fact.id}`);
  assert(
    event.actorIds.includes(character.id),
    `${label} ${character.id} 的“${fact.kind}”不是来源事件 ${fact.eventId}/${event.kind} 的参与者；事件人物=${event.actorIds.join(',')}`,
  );
}

function politicalEvidenceKinds(event: WorldState['history'][number]): string[] {
  const evidence = event.causes.map((cause) => `${cause.label}：${cause.evidence}`).join('；');
  return Object.entries(POLITICAL_EVIDENCE_PATTERNS)
    .filter(([, pattern]) => pattern.test(evidence))
    .map(([kind]) => kind);
}

function assertV02References(world: WorldState, label: string): void {
  const characterById = new Map(world.characters.map((item) => [item.id, item]));
  const familyById = new Map(world.families.map((item) => [item.id, item]));
  const polityById = new Map(world.polities.map((item) => [item.id, item]));
  const regionById = new Map(world.regions.map((item) => [item.id, item]));
  const armyById = new Map(world.armies.map((item) => [item.id, item]));
  const factionById = new Map(world.factions.map((item) => [item.id, item]));
  const eventById = new Map(world.history.map((item) => [item.id, item]));
  const factById = new Map(world.facts.map((item) => [item.id, item]));

  for (const event of world.history.filter((item) => MAJOR_POLITICAL_EVENT_KINDS.has(item.kind))) {
    assert(event.causes.length >= 3, `${label} 政治大事 ${event.id}/${event.kind} 少于三项因果证据`);
    assert(
      event.causes.every((cause) => cause.role !== undefined && cause.evidence.trim().length > 0),
      `${label} 政治大事 ${event.id}/${event.kind} 的 cause.role 或证据不完整`,
    );
    const evidenceKinds = politicalEvidenceKinds(event);
    assert(
      evidenceKinds.length === Object.keys(POLITICAL_EVIDENCE_PATTERNS).length,
      `${label} 政治大事 ${event.id}/${event.kind} 缺少资源/关系/环境证据：已有=${evidenceKinds.join(',') || '无'}`,
    );
  }

  const entityIds: Array<[string, string[]]> = [
    ['家族', world.families.map((item) => item.id)],
    ['关系', world.relationships.map((item) => item.id)],
    ['派系', world.factions.map((item) => item.id)],
    ['外交', world.diplomacy.map((item) => item.id)],
    ['官职', world.offices.map((item) => item.id)],
    ['背景人物', world.backgroundPeople.map((item) => item.id)],
    ['承诺', world.commitments.map((item) => item.id)],
  ];
  for (const [kind, ids] of entityIds) {
    const repeated = duplicates(ids);
    assert(repeated.length === 0, `${label} ${kind} ID 重复：${repeated.join('、')}`);
  }

  for (const character of world.characters) {
    assert(familyById.has(character.familyId), `${label} ${character.id} 引用不存在家族 ${character.familyId}`);
    assert(character.birthTurn <= world.turn, `${label} ${character.id} 出生在未来`);
    if (character.adultTurn !== null) {
      assert(character.adultTurn >= character.birthTurn && character.adultTurn <= world.turn, `${label} ${character.id} 成年时间无效`);
    }
    if (character.deathTurn !== null) {
      assert(character.deathTurn >= character.birthTurn && character.deathTurn <= world.turn, `${label} ${character.id} 死亡时间无效`);
      if (character.adultTurn !== null) {
        assert(character.deathTurn >= character.adultTurn, `${label} ${character.id} 死亡早于成年`);
      }
    }
    assert(duplicates(character.parentIds).length === 0, `${label} ${character.id} 重复引用父母`);
    assert(character.parentIds.length <= 2, `${label} ${character.id} 父母超过两人`);
    for (const parentId of character.parentIds) {
      const parent = characterById.get(parentId);
      assert(parent && parent.id !== character.id, `${label} ${character.id} 父母引用无效：${parentId}`);
      assert(parent.birthTurn <= character.birthTurn - 48, `${label} ${character.id} 与父母 ${parentId} 年龄差不足十二年`);
    }
    assert(!hasAncestorCycle(character, characterById), `${label} ${character.id} 谱系成环`);
    assert(duplicates(character.spouseIds).length === 0, `${label} ${character.id} 重复配偶`);
    for (const spouseId of character.spouseIds) {
      const spouse = characterById.get(spouseId);
      assert(spouse && spouse.id !== character.id, `${label} ${character.id} 配偶引用无效：${spouseId}`);
      assert(spouse.spouseIds.includes(character.id), `${label} ${character.id} 与 ${spouseId} 配偶关系不对称`);
    }
    assertMetric(character.influence, `${label} ${character.id}.influence`);
    assertMetric(character.merit, `${label} ${character.id}.merit`);
    assertMetric(character.deputyExperience, `${label} ${character.id}.deputyExperience`);
    assertMetric(character.insubordination, `${label} ${character.id}.insubordination`);
    assert(Number.isFinite(character.personalWealth) && character.personalWealth >= 0, `${label} ${character.id} 私产无效`);
    assert(duplicates(character.biography.map((fact) => fact.id)).length === 0, `${label} ${character.id} 传记事实 ID 重复`);
    let previousTurn = Number.NEGATIVE_INFINITY;
    for (const fact of character.biography) {
      assertBiographyFact(world, character, fact, eventById, factById, previousTurn, label);
      previousTurn = fact.turn;
    }
  }

  for (const family of world.families) {
    const founder = characterById.get(family.founderId);
    const head = characterById.get(family.headId);
    assert(founder, `${label} ${family.id} 始祖不存在`);
    assert(head, `${label} ${family.id} 家主引用无效：${family.headId}`);
    if (family.active) {
      assert(head.familyId === family.id, `${label} ${family.id} 活跃家族的家主已转属 ${head.familyId}`);
      assert(head.alive && family.extinctTurn === null, `${label} ${family.id} 活跃家族的家主已故或有灭绝时间`);
    } else {
      assert(family.extinctTurn !== null && family.extinctTurn <= world.turn, `${label} ${family.id} 灭绝时间无效`);
      assert(!family.memberIds.some((id) => characterById.get(id)?.alive), `${label} ${family.id} 标记灭绝却仍有活人`);
    }
    assert(polityById.has(family.polityId), `${label} ${family.id} 政权引用无效`);
    if (family.parentFamilyId !== null) {
      assert(family.parentFamilyId !== family.id && familyById.has(family.parentFamilyId), `${label} ${family.id} 父支引用无效`);
    }
    const recordedMembers = [...family.memberIds].sort();
    const actualMembers = world.characters.filter((item) => item.familyId === family.id).map((item) => item.id).sort();
    const missingMembers = actualMembers.filter((id) => !recordedMembers.includes(id));
    const staleMembers = recordedMembers.filter((id) => !actualMembers.includes(id));
    assert(
      JSON.stringify(recordedMembers) === JSON.stringify(actualMembers),
      `${label} ${family.id} 成员缓存与人物归属不一致：漏记=${missingMembers.join(',') || '无'}、残留=${staleMembers.join(',') || '无'}`,
    );
    for (const alliedId of family.marriageAllianceFamilyIds) {
      const allied = familyById.get(alliedId);
      assert(allied && allied.id !== family.id, `${label} ${family.id} 婚盟家族引用无效：${alliedId}`);
      assert(allied.marriageAllianceFamilyIds.includes(family.id), `${label} ${family.id} 与 ${alliedId} 婚盟不对称`);
    }
    assertMetric(family.prestige, `${label} ${family.id}.prestige`);
    assertMetric(family.politicalInfluence, `${label} ${family.id}.politicalInfluence`);
    for (const [tradition, value] of Object.entries(family.traditions)) {
      assertMetric(value, `${label} ${family.id}.traditions.${tradition}`);
    }
  }

  for (const family of world.families) {
    const seen = new Set([family.id]);
    let cursor = family.parentFamilyId;
    while (cursor !== null) {
      assert(!seen.has(cursor), `${label} ${family.id} 家族分支成环`);
      seen.add(cursor);
      cursor = familyById.get(cursor)?.parentFamilyId ?? null;
    }
  }

  const directedRelationshipPairs = new Set<string>();
  for (const relationship of world.relationships) {
    assert(
      characterById.has(relationship.sourceId)
        && characterById.has(relationship.targetId)
        && relationship.sourceId !== relationship.targetId,
      `${label} ${relationship.id} 人际关系端点无效：${relationship.sourceId}>${relationship.targetId}`,
    );
    const pair = `${relationship.sourceId}>${relationship.targetId}`;
    assert(!directedRelationshipPairs.has(pair), `${label} ${pair} 存在重复关系边`);
    directedRelationshipPairs.add(pair);
    assertMetric(relationship.affinity, `${label} ${relationship.id}.affinity`, -100, 100);
    assertMetric(relationship.trust, `${label} ${relationship.id}.trust`);
    assertMetric(relationship.fear, `${label} ${relationship.id}.fear`);
    assertMetric(relationship.grievance, `${label} ${relationship.id}.grievance`);
    assertMetric(relationship.gratitude, `${label} ${relationship.id}.gratitude`);
    assert(relationship.lastInteractionTurn <= world.turn, `${label} ${relationship.id} 最后互动在未来`);
    let previousTurn = Number.NEGATIVE_INFINITY;
    for (const memory of relationship.memories) {
      assert(memory.turn >= previousTurn && memory.turn <= world.turn, `${label} ${relationship.id} 记忆时间逆序`);
      previousTurn = memory.turn;
      if (memory.eventId !== null) assert(eventById.has(memory.eventId), `${label} ${relationship.id} 记忆事件不存在：${memory.eventId}`);
      assert(Number.isFinite(memory.impact), `${label} ${relationship.id} 记忆强度无效`);
    }
  }
  assert(
    world.relationships.length <= Math.max(1, world.characters.length * RELATION_EDGE_FACTOR_LIMIT),
    `${label} 关系图过密：${world.relationships.length}/${world.characters.length}`,
  );

  for (const faction of world.factions) {
    const leader = characterById.get(faction.leaderId);
    assert(polityById.has(faction.polityId), `${label} ${faction.id} 政权引用无效`);
    assert(leader, `${label} ${faction.id} 领袖引用无效：${faction.leaderId}`);
    assert(faction.memberIds.includes(faction.leaderId), `${label} ${faction.id} 领袖不在成员中`);
    assert(duplicates(faction.memberIds).length === 0, `${label} ${faction.id} 成员重复`);
    for (const memberId of faction.memberIds) {
      const member = characterById.get(memberId);
      assert(member, `${label} ${faction.id} 成员引用无效：${memberId}`);
      if (faction.active) assert(member.alive && member.polityId === faction.polityId, `${label} ${faction.id} 在籍成员无效：${memberId}`);
    }
    if (faction.active) {
      assert(leader.alive && leader.polityId === faction.polityId, `${label} ${faction.id} 活跃领袖已故或异属`);
      assert(faction.endedTurn === null, `${label} ${faction.id} 活跃派系却有结束季度`);
    } else {
      assert(faction.endedTurn !== null && faction.endedTurn <= world.turn, `${label} ${faction.id} 解散季度无效`);
    }
    for (const alliedId of faction.alliedFactionIds) {
      const allied = factionById.get(alliedId);
      assert(allied && allied.id !== faction.id, `${label} ${faction.id} 盟派引用无效：${alliedId}`);
      assert(allied.alliedFactionIds.includes(faction.id), `${label} ${faction.id} 与 ${alliedId} 派系联盟不对称`);
    }
    assertMetric(faction.power, `${label} ${faction.id}.power`);
    assertMetric(faction.cohesion, `${label} ${faction.id}.cohesion`);
  }

  const diplomacyPairs = new Set<string>();
  for (const diplomacy of world.diplomacy) {
    assert(
      polityById.has(diplomacy.polityAId)
        && polityById.has(diplomacy.polityBId)
        && diplomacy.polityAId !== diplomacy.polityBId,
      `${label} ${diplomacy.id} 外交端点无效`,
    );
    const pair = [diplomacy.polityAId, diplomacy.polityBId].sort().join('|');
    assert(!diplomacyPairs.has(pair), `${label} ${pair} 存在重复外交边`);
    diplomacyPairs.add(pair);
    assertMetric(diplomacy.threatAtoB, `${label} ${diplomacy.id}.threatAtoB`);
    assertMetric(diplomacy.threatBtoA, `${label} ${diplomacy.id}.threatBtoA`);
    assertMetric(diplomacy.trust, `${label} ${diplomacy.id}.trust`);
    assertMetric(diplomacy.grievance, `${label} ${diplomacy.id}.grievance`);
    assertMetric(diplomacy.culturalAffinity, `${label} ${diplomacy.id}.culturalAffinity`);
    assertMetric(diplomacy.tradeDependency, `${label} ${diplomacy.id}.tradeDependency`);
    assert(diplomacy.lastChangedTurn <= world.turn, `${label} ${diplomacy.id} 变更时间在未来`);
    if (diplomacy.allianceUntilTurn !== null) {
      assert(diplomacy.status === '联盟', `${label} ${diplomacy.id} 非联盟却保留联盟期限`);
    }
    for (const eventId of diplomacy.marriageIds) {
      const event = eventById.get(eventId);
      assert(event?.kind === 'diplomatic_marriage', `${label} ${diplomacy.id} 婚盟引用无效：${eventId}`);
    }
    const activeWar = world.wars.some((war) => war.active && (
      (war.attackerId === diplomacy.polityAId && war.defenderId === diplomacy.polityBId)
      || (war.attackerId === diplomacy.polityBId && war.defenderId === diplomacy.polityAId)
    ));
    assert(!activeWar || diplomacy.status === '战争', `${label} ${diplomacy.id} 交战双方外交状态不是战争`);
    assert(diplomacy.status !== '联盟' || !activeWar, `${label} ${diplomacy.id} 同时联盟与交战`);
  }

  const exclusiveOfficeScopes = new Set<string>();
  for (const office of world.offices) {
    assert(polityById.has(office.polityId), `${label} ${office.id} 官职政权无效`);
    const holder = characterById.get(office.holderId);
    assert(holder, `${label} ${office.id} 官职持有人不存在`);
    if (office.regionId !== null) assert(regionById.has(office.regionId), `${label} ${office.id} 官职地区无效`);
    if (office.active && office.armyId !== null) assert(armyById.has(office.armyId), `${label} ${office.id} 在任官职军团无效`);
    assertMetric(office.rank, `${label} ${office.id}.rank`);
    assert(office.appointedTurn <= world.turn, `${label} ${office.id} 任命在未来`);
    if (office.active) {
      assert(
        holder.alive && holder.polityId === office.polityId,
        `${label} ${office.id}/${office.kind} 在任持有人已故或异属：holder=${holder.id}/${holder.name}、alive=${holder.alive}、人物政权=${holder.polityId}、官职政权=${office.polityId}、army=${office.armyId ?? '无'}`,
      );
      assert(office.endedTurn === null, `${label} ${office.id} 在任却有结束时间`);
      if (office.kind !== '廷臣') {
        const scope = `${office.polityId}|${office.kind}|${office.regionId ?? ''}|${office.armyId ?? ''}`;
        assert(!exclusiveOfficeScopes.has(scope), `${label} 重复在任官职：${scope}`);
        exclusiveOfficeScopes.add(scope);
      }
    } else {
      assert(office.endedTurn !== null && office.endedTurn >= office.appointedTurn, `${label} ${office.id} 离任时间无效`);
    }
  }

  const backgroundById = new Map(world.backgroundPeople.map((person) => [person.id, person]));
  for (const person of world.backgroundPeople) {
    assert(polityById.has(person.polityId), `${label} ${person.id} 背景人物政权无效`);
    assert(regionById.has(person.regionId), `${label} ${person.id} 背景人物地区无效`);
    if (person.promotedCharacterId === null) {
      assert(regionById.get(person.regionId)?.controllerId === person.polityId, `${label} ${person.id} 未晋升背景人物仍挂在旧控制者`);
    }
    assert(person.birthTurn <= world.turn, `${label} ${person.id} 背景人物出生在未来`);
    assertMetric(person.potential.leadership, `${label} ${person.id}.potential.leadership`);
    assertMetric(person.potential.governance, `${label} ${person.id}.potential.governance`);
    assertMetric(person.potential.cunning, `${label} ${person.id}.potential.cunning`);
    assertMetric(person.opportunity, `${label} ${person.id}.opportunity`);
    if (person.promotedCharacterId === null) {
      assert(person.promotedTurn === null, `${label} ${person.id} 未晋升却记录晋升季度`);
    } else {
      const promoted = characterById.get(person.promotedCharacterId);
      assert(promoted?.sourceStubId === person.id, `${label} ${person.id} 晋升人物反向引用不一致`);
      assert(person.promotedTurn !== null && person.promotedTurn <= world.turn, `${label} ${person.id} 晋升季度无效`);
      assert(promoted.tier === '背景晋升' || !promoted.alive, `${label} ${person.id} 晋升人物层级无效`);
    }
  }
  for (const character of world.characters.filter((item) => item.sourceStubId !== null)) {
    const source = backgroundById.get(character.sourceStubId as string);
    assert(source?.promotedCharacterId === character.id, `${label} ${character.id} 背景晋升来源不一致`);
  }

  for (const commitment of world.commitments) {
    assert(
      characterById.has(commitment.promisorId)
        && characterById.has(commitment.promiseeId)
        && commitment.promisorId !== commitment.promiseeId,
      `${label} ${commitment.id} 承诺人物端点无效`,
    );
    assert(duplicates(commitment.polityIds).length === 0, `${label} ${commitment.id} 承诺政权重复`);
    assert(commitment.polityIds.every((id) => polityById.has(id)), `${label} ${commitment.id} 承诺政权无效`);
    assert(commitment.terms.trim().length > 0, `${label} ${commitment.id} 承诺没有条款`);
    assert(commitment.madeTurn <= world.turn, `${label} ${commitment.id} 承诺发生在未来`);
    if (commitment.dueTurn !== null) assert(commitment.dueTurn >= commitment.madeTurn, `${label} ${commitment.id} 到期早于作出`);
    const sourceEvent = eventById.get(commitment.eventId);
    assert(sourceEvent && sourceEvent.turn === commitment.madeTurn, `${label} ${commitment.id} 来源事件无效`);
    assertMetric(commitment.trustStake, `${label} ${commitment.id}.trustStake`);
    if (commitment.status === '生效') {
      assert(commitment.resolvedTurn === null && commitment.resolutionEventId === null, `${label} ${commitment.id} 生效中却已有解决记录`);
    } else {
      assert(
        commitment.resolvedTurn !== null
          && commitment.resolvedTurn >= commitment.madeTurn
          && commitment.resolvedTurn <= world.turn,
        `${label} ${commitment.id} 解决季度无效`,
      );
      const resolution = commitment.resolutionEventId ? eventById.get(commitment.resolutionEventId) : undefined;
      assert(resolution && resolution.turn === commitment.resolvedTurn, `${label} ${commitment.id} 解决事件无效`);
    }
  }
}

function classifyEmergence(world: WorldState): WorldEmergence {
  const eventKinds: Record<string, number> = {};
  const groups = Object.fromEntries(
    Object.keys(EVENT_GROUP_PATTERNS).map((group) => [group, 0]),
  ) as Record<EventGroup, number>;
  for (const event of world.history) {
    eventKinds[event.kind] = (eventKinds[event.kind] ?? 0) + 1;
    for (const [group, patterns] of Object.entries(EVENT_GROUP_PATTERNS) as Array<[EventGroup, readonly RegExp[]]>) {
      if (patterns.some((pattern) => pattern.test(event.kind))) groups[group] += 1;
    }
  }

  const familyByCharacter = new Map(world.characters.map((character) => [character.id, character.familyId]));
  const activeOffices = world.offices.filter((office) => office.active && office.kind !== '廷臣');
  const officeCounts = new Map<string, number>();
  for (const office of activeOffices) {
    const familyId = familyByCharacter.get(office.holderId);
    if (familyId) officeCounts.set(familyId, (officeCounts.get(familyId) ?? 0) + 1);
  }
  const maximumOfficeCount = Math.max(0, ...officeCounts.values());
  const commanderAppointments = world.offices
    .filter((office) => office.kind === '军团主帅' && office.armyId !== null)
    .sort((left, right) => (
      String(left.armyId).localeCompare(String(right.armyId))
      || left.appointedTurn - right.appointedTurn
      || left.id.localeCompare(right.id)
    ));
  const commanderTenureQuarters = commanderAppointments.map((office) => (
    Math.max(0, (office.endedTurn ?? world.turn) - office.appointedTurn)
  ));
  let rapidCommanderReversals = 0;
  let explainedRapidCommanderReversals = 0;
  let unexplainedRapidCommanderReversals = 0;
  const rapidCommanderReversalExamples: WorldEmergence['rapidCommanderReversalExamples'] = [];
  const appointmentsByArmy = new Map<string, typeof commanderAppointments>();
  for (const appointment of commanderAppointments) {
    const armyId = appointment.armyId as string;
    const list = appointmentsByArmy.get(armyId) ?? [];
    list.push(appointment);
    appointmentsByArmy.set(armyId, list);
  }
  for (const appointments of appointmentsByArmy.values()) {
    for (let index = 2; index < appointments.length; index += 1) {
      const first = appointments[index - 2];
      const middle = appointments[index - 1];
      const last = appointments[index];
      if (
        first && middle && last
        && first.holderId === last.holderId
        && first.holderId !== middle.holderId
        && last.appointedTurn - middle.appointedTurn <= 4
      ) {
        rapidCommanderReversals += 1;
        const middleHolder = world.characters.find((character) => character.id === middle.holderId);
        const army = world.armies.find((item) => item.id === last.armyId);
        const transitionEvents = world.history.filter((event) => (
          event.turn >= middle.appointedTurn
          && event.turn <= last.appointedTurn
          && (
            event.actorIds.includes(middle.holderId)
            || event.stateDeltas.some((delta) => (
              (delta.entityType === 'army' && delta.entityId === last.armyId)
              || (delta.entityType === 'character' && delta.entityId === middle.holderId)
            ))
          )
        ));
        const explanation = middleHolder?.deathTurn !== null
          && middleHolder?.deathTurn !== undefined
          && middleHolder.deathTurn >= middle.appointedTurn
          && middleHolder.deathTurn <= last.appointedTurn
          ? 'middle_holder_died'
          : transitionEvents.some((event) => event.kind === 'purge' && event.actorIds.includes(middle.holderId))
            ? 'middle_holder_purged'
            : transitionEvents.some((event) => event.stateDeltas.some((delta) => (
              delta.entityType === 'character'
              && delta.entityId === middle.holderId
              && delta.field === 'polityId'
            )))
              ? 'middle_holder_changed_polity'
              : transitionEvents.some((event) => event.stateDeltas.some((delta) => (
                delta.entityType === 'army'
                && delta.entityId === last.armyId
                && delta.field === 'polityId'
              )))
                ? 'army_changed_polity'
                : null;
        if (explanation) explainedRapidCommanderReversals += 1;
        else unexplainedRapidCommanderReversals += 1;
        rapidCommanderReversalExamples.push({
          armyId: last.armyId as string,
          firstOfficeId: first.id,
          middleOfficeId: middle.id,
          lastOfficeId: last.id,
          firstHolderId: first.holderId,
          middleHolderId: middle.holderId,
          firstAppointedTurn: first.appointedTurn,
          firstEndedTurn: first.endedTurn,
          middleAppointedTurn: middle.appointedTurn,
          lastAppointedTurn: last.appointedTurn,
          middleEndedTurn: middle.endedTurn,
          lastEndedTurn: last.endedTurn,
          middleHolderDeathTurn: middleHolder?.deathTurn ?? null,
          middleHolderFinalPolityId: middleHolder?.polityId ?? 'missing',
          finalArmyPolityId: army?.polityId ?? null,
          explanation,
          relatedEvents: world.history
            .filter((event) => (
              (event.turn === first.appointedTurn && event.actorIds.includes(first.holderId))
              || transitionEvents.includes(event)
            ))
            .map((event) => ({ turn: event.turn, kind: event.kind, title: event.title })),
        });
      }
    }
  }
  const promotionsByCharacter = new Map<string, number>();
  for (const event of world.history.filter((item) => item.kind === 'deputy_promoted')) {
    const promotedId = event.actorIds[0];
    if (promotedId) promotionsByCharacter.set(promotedId, (promotionsByCharacter.get(promotedId) ?? 0) + 1);
  }
  const biographyFacts = world.characters.reduce((sum, character) => (
    sum + character.biography.filter((fact) => fact.kind !== 'introduced' && fact.kind !== '旧档人物').length
  ), 0);
  const marriageEvents = world.history.filter((event) => event.kind === 'marriage' || event.kind === 'diplomatic_marriage');
  const backgroundPromotionTurns = new Map(world.backgroundPeople
    .filter((person) => person.promotedCharacterId !== null && person.promotedTurn !== null)
    .map((person) => [person.promotedCharacterId as string, person.promotedTurn as number]));
  const careerStageCharacters: Record<BackgroundCareerStage, Set<string>> = {
    commander: new Set(),
    powerBroker: new Set(),
    ruler: new Set(),
    rebelLeader: new Set(),
  };
  for (const office of world.offices) {
    const promotedTurn = backgroundPromotionTurns.get(office.holderId);
    if (promotedTurn === undefined || office.appointedTurn < promotedTurn) continue;
    if (office.kind === '军团主帅') careerStageCharacters.commander.add(office.holderId);
    if (office.kind === '君主') careerStageCharacters.ruler.add(office.holderId);
  }
  for (const event of world.history) {
    const actorId = event.actorIds[0];
    if (!actorId) continue;
    const promotedTurn = backgroundPromotionTurns.get(actorId);
    if (promotedTurn === undefined || event.turn < promotedTurn) continue;
    if (event.kind === 'power_broker') careerStageCharacters.powerBroker.add(actorId);
    if (event.kind === 'rebellion') careerStageCharacters.rebelLeader.add(actorId);
  }
  const anyHighOffice = new Set(Object.values(careerStageCharacters).flatMap((characters) => [...characters]));
  const characterById = new Map(world.characters.map((character) => [character.id, character]));
  const multigenerationalFamilyOccurred = world.characters.some((character) => character.parentIds.some((parentId) => (
    (characterById.get(parentId)?.parentIds.length ?? 0) > 0
  )));
  const majorPoliticalEvents = world.history.filter((event) => MAJOR_POLITICAL_EVENT_KINDS.has(event.kind));

  return {
    eventKinds,
    groups,
    parentedCharacters: world.characters.filter((character) => character.parentIds.length > 0).length,
    marriedCharacters: world.characters.filter((character) => character.spouseIds.length > 0).length,
    branchFamilies: world.families.filter((family) => family.parentFamilyId !== null).length,
    promotedBackgroundCharacters: world.history.filter((event) => /background.*promot|promot.*background/i.test(event.kind)).length,
    experiencedDeputies: world.characters.filter((character) => character.deputyExperience > 0).length,
    insubordinateCharacters: world.characters.filter((character) => character.insubordination > 0).length,
    activeAlliances: world.diplomacy.filter((item) => item.status === '联盟').length,
    factionCount: world.factions.filter((faction) => faction.active).length,
    relationshipCount: world.relationships.length,
    maximumFamilyOfficeShare: activeOffices.length === 0 ? 0 : maximumOfficeCount / activeOffices.length,
    density: {
      battle: eventKinds.battle ?? 0,
      deputyMerit: eventKinds.deputy_merit ?? 0,
      deputyPromoted: eventKinds.deputy_promoted ?? 0,
      powerBroker: eventKinds.power_broker ?? 0,
      commitmentsCreated: world.commitments.length,
      biographyFacts,
    },
    commanderTenureQuarters,
    rapidCommanderReversals,
    explainedRapidCommanderReversals,
    unexplainedRapidCommanderReversals,
    rapidCommanderReversalExamples,
    maximumPromotionsForOneCharacter: Math.max(0, ...promotionsByCharacter.values()),
    initialCohortMarriageEvents: marriageEvents.filter((event) => (
      event.actorIds.slice(0, 2).every((id) => (world.characters.find((character) => character.id === id)?.birthTurn ?? 0) < 0)
    )).length,
    descendantMarriageEvents: marriageEvents.filter((event) => (
      event.actorIds.slice(0, 2).some((id) => (world.characters.find((character) => character.id === id)?.birthTurn ?? -1) >= 0)
    )).length,
    backgroundCareerPaths: {
      commander: careerStageCharacters.commander.size,
      powerBroker: careerStageCharacters.powerBroker.size,
      ruler: careerStageCharacters.ruler.size,
      rebelLeader: careerStageCharacters.rebelLeader.size,
      anyHighOffice: anyHighOffice.size,
    },
    familyInheritanceOccurred: (eventKinds.family_inheritance ?? 0) > 0,
    familyBranchOccurred: (eventKinds.family_branch ?? 0) > 0,
    multigenerationalFamilyOccurred,
    majorPoliticalEvents: majorPoliticalEvents.length,
    majorPoliticalEventsWithCompleteRoles: majorPoliticalEvents.filter((event) => (
      event.causes.length >= 3 && event.causes.every((cause) => cause.role !== undefined && cause.evidence.trim().length > 0)
    )).length,
    majorPoliticalEventsWithEvidenceTriad: majorPoliticalEvents.filter((event) => (
      politicalEvidenceKinds(event).length === Object.keys(POLITICAL_EVIDENCE_PATTERNS).length
    )).length,
  };
}

function runWorld(seed: string, quarters: number, measure = true): RunResult {
  let world = createWorld(seed);
  const turnDurations: number[] = [];
  let minimumLivingPolities = world.polities.filter((polity) => polity.alive).length;
  for (let turn = 0; turn < quarters; turn += 1) {
    const startedAt = performance.now();
    try {
      world = advanceWorld(world);
    } catch (error) {
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      fail(`${seed}@quarter-${turn + 1} 推演异常：${detail}`);
    }
    if (measure && turn >= 8) turnDurations.push(performance.now() - startedAt);
    assertQuarterState(world, `${seed}@${turn + 1}`);
    minimumLivingPolities = Math.min(minimumLivingPolities, world.polities.filter((polity) => polity.alive).length);
    if ((turn + 1) % 4 === 0 && turn + 1 < quarters) {
      assertV02References(world, `${seed}@year-${(turn + 1) / 4}`);
    }
  }
  assertV02References(world, seed);
  const violations = validateWorld(world);
  assert(violations.length === 0, `${seed} 世界不变量失败：${violations.slice(0, 8).map((item) => `${item.code}:${item.message}`).join('；')}`);
  return { world, turnDurations, minimumLivingPolities };
}

function addRecord(target: Record<string, number>, source: Record<string, number>): void {
  for (const [key, value] of Object.entries(source)) target[key] = (target[key] ?? 0) + value;
}

const auditStartedAt = performance.now();
const allDurations: number[] = [];
const shortHashes = new Map<string, string>();
const groupWorldOccurrence = Object.fromEntries(
  Object.keys(EVENT_GROUP_PATTERNS).map((group) => [group, 0]),
) as Record<EventGroup, number>;
const groupEventTotals = { ...groupWorldOccurrence };
const eventKindTotals: Record<string, number> = {};
const finalPolityDistribution: Record<number, number> = {};
const aggregate = {
  parentedCharacters: 0,
  marriedCharacters: 0,
  branchFamilies: 0,
  promotedBackgroundCharacters: 0,
  experiencedDeputies: 0,
  insubordinateCharacters: 0,
  activeAlliances: 0,
  factionCount: 0,
  relationshipCount: 0,
};
let maximumObservedFamilyOfficeShare = 0;
const densityTotals: WorldEmergence['density'] = {
  battle: 0,
  deputyMerit: 0,
  deputyPromoted: 0,
  powerBroker: 0,
  commitmentsCreated: 0,
  biographyFacts: 0,
};
const commanderTenures: number[] = [];
let rapidCommanderReversals = 0;
let explainedRapidCommanderReversals = 0;
let unexplainedRapidCommanderReversals = 0;
const rapidCommanderReversalEvidence: Array<WorldEmergence['rapidCommanderReversalExamples'][number] & { seed: string }> = [];
let maximumPromotionsForOneCharacter = 0;
let initialCohortMarriageEvents = 0;
let descendantMarriageEvents = 0;
const shortBackgroundCareerPaths: WorldEmergence['backgroundCareerPaths'] = {
  commander: 0,
  powerBroker: 0,
  ruler: 0,
  rebelLeader: 0,
  anyHighOffice: 0,
};
let shortFamilyInheritanceWorlds = 0;
let shortFamilyBranchWorlds = 0;
let shortMultigenerationalFamilyWorlds = 0;
let shortMajorPoliticalEvents = 0;
let shortMajorPoliticalEventsWithCompleteRoles = 0;
let shortMajorPoliticalEventsWithEvidenceTriad = 0;

for (let index = 0; index < SHORT_SEED_COUNT; index += 1) {
  const seed = `v02-audit-${String(index).padStart(3, '0')}`;
  const { world, turnDurations } = runWorld(seed, SHORT_QUARTERS);
  allDurations.push(...turnDurations);
  assert(![...shortHashes.values()].includes(world.hash), `${seed} 与另一短期世界最终哈希重复`);
  shortHashes.set(seed, world.hash);
  const emergence = classifyEmergence(world);
  addRecord(eventKindTotals, emergence.eventKinds);
  for (const group of Object.keys(EVENT_GROUP_PATTERNS) as EventGroup[]) {
    groupEventTotals[group] += emergence.groups[group];
    if (emergence.groups[group] > 0) groupWorldOccurrence[group] += 1;
  }
  for (const key of Object.keys(aggregate) as Array<keyof typeof aggregate>) {
    aggregate[key] += emergence[key];
  }
  maximumObservedFamilyOfficeShare = Math.max(maximumObservedFamilyOfficeShare, emergence.maximumFamilyOfficeShare);
  for (const key of Object.keys(densityTotals) as Array<keyof typeof densityTotals>) {
    densityTotals[key] += emergence.density[key];
  }
  commanderTenures.push(...emergence.commanderTenureQuarters);
  rapidCommanderReversals += emergence.rapidCommanderReversals;
  explainedRapidCommanderReversals += emergence.explainedRapidCommanderReversals;
  unexplainedRapidCommanderReversals += emergence.unexplainedRapidCommanderReversals;
  rapidCommanderReversalEvidence.push(...emergence.rapidCommanderReversalExamples.map((example) => ({ seed, ...example })));
  maximumPromotionsForOneCharacter = Math.max(maximumPromotionsForOneCharacter, emergence.maximumPromotionsForOneCharacter);
  initialCohortMarriageEvents += emergence.initialCohortMarriageEvents;
  descendantMarriageEvents += emergence.descendantMarriageEvents;
  for (const stage of Object.keys(shortBackgroundCareerPaths) as Array<keyof typeof shortBackgroundCareerPaths>) {
    shortBackgroundCareerPaths[stage] += emergence.backgroundCareerPaths[stage];
  }
  if (emergence.familyInheritanceOccurred) shortFamilyInheritanceWorlds += 1;
  if (emergence.familyBranchOccurred) shortFamilyBranchWorlds += 1;
  if (emergence.multigenerationalFamilyOccurred) shortMultigenerationalFamilyWorlds += 1;
  shortMajorPoliticalEvents += emergence.majorPoliticalEvents;
  shortMajorPoliticalEventsWithCompleteRoles += emergence.majorPoliticalEventsWithCompleteRoles;
  shortMajorPoliticalEventsWithEvidenceTriad += emergence.majorPoliticalEventsWithEvidenceTriad;
  const livingPolities = world.polities.filter((polity) => polity.alive).length;
  finalPolityDistribution[livingPolities] = (finalPolityDistribution[livingPolities] ?? 0) + 1;
}

for (let index = 0; index < DETERMINISM_SEED_COUNT; index += 1) {
  const seed = `v02-audit-${String(index).padStart(3, '0')}`;
  const replay = runWorld(seed, SHORT_QUARTERS, false).world;
  assert(replay.hash === shortHashes.get(seed), `${seed} 同种子 ${SHORT_QUARTERS} 季哈希不确定`);
}

const persistenceSeed = 'v02-audit-save-resume';
const splitTurn = Math.max(1, Math.floor(SHORT_QUARTERS * 0.43));
const uninterrupted = runWorld(persistenceSeed, SHORT_QUARTERS, false).world;
const beforeSave = runWorld(persistenceSeed, splitTurn, false).world;
const restored = deserializeWorld(serializeWorld(beforeSave));
let resumed = restored;
for (let turn = splitTurn; turn < SHORT_QUARTERS; turn += 1) resumed = advanceWorld(resumed);
assert(resumed.hash === uninterrupted.hash, '当前 schema 保存续跑与不中断运行哈希不同');
assert(serializeWorld(resumed) === serializeWorld(uninterrupted), '当前 schema 保存续跑与不中断运行序列化不同');

const longFinalPolityDistribution: Record<number, number> = {};
const longSaveBytes: number[] = [];
let longUnifiedWorlds = 0;
let longFragmentedWorlds = 0;
let longFamilySuccessionWorlds = 0;
let longPoliticalWorlds = 0;
let longDeputyWorlds = 0;
let longDiplomacyWorlds = 0;
const longBackgroundCareerPaths: WorldEmergence['backgroundCareerPaths'] = {
  commander: 0,
  powerBroker: 0,
  ruler: 0,
  rebelLeader: 0,
  anyHighOffice: 0,
};
let longFamilyInheritanceWorlds = 0;
let longFamilyBranchWorlds = 0;
let longMultigenerationalFamilyWorlds = 0;
let longMajorPoliticalEvents = 0;
let longMajorPoliticalEventsWithCompleteRoles = 0;
let longMajorPoliticalEventsWithEvidenceTriad = 0;

for (let index = 0; index < LONG_SEED_COUNT; index += 1) {
  const seed = `v02-audit-long-${String(index).padStart(2, '0')}`;
  const result = runWorld(seed, LONG_QUARTERS);
  const world = result.world;
  allDurations.push(...result.turnDurations);
  const livingPolities = world.polities.filter((polity) => polity.alive).length;
  longFinalPolityDistribution[livingPolities] = (longFinalPolityDistribution[livingPolities] ?? 0) + 1;
  if (result.minimumLivingPolities === 1 || livingPolities === 1) longUnifiedWorlds += 1;
  if (livingPolities >= 2) longFragmentedWorlds += 1;
  const emergence = classifyEmergence(world);
  if (emergence.groups.family > 0) longFamilySuccessionWorlds += 1;
  if (emergence.groups.politics > 0) longPoliticalWorlds += 1;
  if (emergence.groups.deputy > 0) longDeputyWorlds += 1;
  if (emergence.groups.diplomacy > 0) longDiplomacyWorlds += 1;
  for (const stage of Object.keys(longBackgroundCareerPaths) as Array<keyof typeof longBackgroundCareerPaths>) {
    longBackgroundCareerPaths[stage] += emergence.backgroundCareerPaths[stage];
  }
  if (emergence.familyInheritanceOccurred) longFamilyInheritanceWorlds += 1;
  if (emergence.familyBranchOccurred) longFamilyBranchWorlds += 1;
  if (emergence.multigenerationalFamilyOccurred) longMultigenerationalFamilyWorlds += 1;
  longMajorPoliticalEvents += emergence.majorPoliticalEvents;
  longMajorPoliticalEventsWithCompleteRoles += emergence.majorPoliticalEventsWithCompleteRoles;
  longMajorPoliticalEventsWithEvidenceTriad += emergence.majorPoliticalEventsWithEvidenceTriad;
  const saveBytes = Buffer.byteLength(serializeWorld(world), 'utf8');
  longSaveBytes.push(saveBytes);
  assert(saveBytes <= MAX_IMPORT_BYTES, `${seed} 的 200 年存档 ${(saveBytes / 1024 / 1024).toFixed(2)}MB 超过浏览器 16MB 导入上限`);
}

const overallBackgroundCareerPaths = Object.fromEntries(
  (Object.keys(shortBackgroundCareerPaths) as Array<keyof typeof shortBackgroundCareerPaths>)
    .map((stage) => [stage, shortBackgroundCareerPaths[stage] + longBackgroundCareerPaths[stage]]),
) as WorldEmergence['backgroundCareerPaths'];

if (!STRUCTURAL_ONLY) {
  const commonMinimum = Math.max(1, Math.floor(SHORT_SEED_COUNT * 0.05));
  const lifecycleMinimum = Math.max(1, Math.floor(SHORT_SEED_COUNT * 0.1));
  assert(groupWorldOccurrence.birth >= lifecycleMinimum, `出生事件只出现在 ${groupWorldOccurrence.birth}/${SHORT_SEED_COUNT} 个短期世界`);
  assert(groupWorldOccurrence.adulthood >= commonMinimum, `成年事件只出现在 ${groupWorldOccurrence.adulthood}/${SHORT_SEED_COUNT} 个短期世界`);
  assert(groupWorldOccurrence.death >= lifecycleMinimum, `死亡事件只出现在 ${groupWorldOccurrence.death}/${SHORT_SEED_COUNT} 个短期世界`);
  assert(groupWorldOccurrence.family >= commonMinimum, `家族演化只出现在 ${groupWorldOccurrence.family}/${SHORT_SEED_COUNT} 个短期世界`);
  assert(groupWorldOccurrence.politics >= commonMinimum, `政治演化只出现在 ${groupWorldOccurrence.politics}/${SHORT_SEED_COUNT} 个短期世界`);
  assert(groupWorldOccurrence.deputy >= commonMinimum, `副将成长只出现在 ${groupWorldOccurrence.deputy}/${SHORT_SEED_COUNT} 个短期世界`);
  assert(groupWorldOccurrence.diplomacy >= commonMinimum, `外交变化只出现在 ${groupWorldOccurrence.diplomacy}/${SHORT_SEED_COUNT} 个短期世界`);
  assert(aggregate.parentedCharacters > 0, '批量世界中没有出现可追溯父母的后代');
  assert(aggregate.marriedCharacters > 0, '批量世界中没有出现婚姻');
  assert(aggregate.experiencedDeputies > 0, '批量世界中没有副将获得经历');
  assert(aggregate.factionCount > 0 && aggregate.relationshipCount > 0, '批量世界中派系或人际关系为空');
  assert(longFamilySuccessionWorlds > 0, '长期样本中没有家族演化');
  assert(longPoliticalWorlds > 0, '长期样本中没有政治行动');
  assert(longDeputyWorlds > 0, '长期样本中没有副将演化');
  assert(longDiplomacyWorlds > 0, '长期样本中没有外交演化');
  assert(overallBackgroundCareerPaths.anyHighOffice > 0, '批量世界中没有背景晋升人物继续成为主帅、权臣、君主或新势力领袖');
  assert(shortFamilyInheritanceWorlds + longFamilyInheritanceWorlds > 0, '批量世界中没有家主继承');
  assert(shortFamilyBranchWorlds + longFamilyBranchWorlds > 0, '批量世界中没有家族支系形成');
  assert(shortMultigenerationalFamilyWorlds + longMultigenerationalFamilyWorlds > 0, '批量世界中没有出现孙辈与多代家庭');
  assert(
    shortMajorPoliticalEvents + longMajorPoliticalEvents
      === shortMajorPoliticalEventsWithCompleteRoles + longMajorPoliticalEventsWithCompleteRoles,
    '政治大事存在缺失 cause.role 或证据的事件',
  );
  assert(
    shortMajorPoliticalEvents + longMajorPoliticalEvents
      === shortMajorPoliticalEventsWithEvidenceTriad + longMajorPoliticalEventsWithEvidenceTriad,
    '政治大事存在缺少资源/关系/环境证据的事件',
  );

  const auditedWorldYears = SHORT_SEED_COUNT * SHORT_QUARTERS / 4;
  const perWorldYear = Object.fromEntries(Object.entries(densityTotals).map(([key, value]) => [key, value / auditedWorldYears])) as WorldEmergence['density'];
  assert(perWorldYear.battle <= 20, `战役史事密度 ${perWorldYear.battle.toFixed(2)}/世界年，超过20的噪声门`);
  assert(perWorldYear.deputyMerit <= 1, `副将显名密度 ${perWorldYear.deputyMerit.toFixed(2)}/世界年，超过1`);
  assert(perWorldYear.deputyPromoted <= 0.5, `副将晋升密度 ${perWorldYear.deputyPromoted.toFixed(2)}/世界年，超过0.5`);
  assert(perWorldYear.powerBroker <= 1.5, `权臣史事密度 ${perWorldYear.powerBroker.toFixed(2)}/世界年，超过1.5`);
  assert(perWorldYear.commitmentsCreated <= 5, `承诺建立密度 ${perWorldYear.commitmentsCreated.toFixed(2)}/世界年，超过5`);
  assert(perWorldYear.biographyFacts <= 50, `传记事实密度 ${perWorldYear.biographyFacts.toFixed(2)}/世界年，超过50`);
  assert(
    unexplainedRapidCommanderReversals === 0,
    `出现 ${unexplainedRapidCommanderReversals} 次无因果的一年内主帅 A→B→A 往返替换：${JSON.stringify(rapidCommanderReversalEvidence.filter((item) => item.explanation === null).slice(0, 3))}`,
  );
  assert(maximumPromotionsForOneCharacter <= 2, `同一人物在50年内最多重复升主帅 ${maximumPromotionsForOneCharacter} 次`);
  assert(percentile(commanderTenures, 0.5) >= 4, `主帅任期中位数只有 ${percentile(commanderTenures, 0.5).toFixed(1)} 季`);
}

const p50 = percentile(allDurations, 0.5);
const p95 = percentile(allDurations, 0.95);
const maximumTurnMs = Math.max(0, ...allDurations);
assert(p95 < 1_000, `季度模拟 P95 ${p95.toFixed(2)}ms，疑似出现性能爆炸`);

const output = {
  audit: 'V0.2 historical social regression (not the V0.3 release gate)',
  auditedContractVersion: 'V0.2',
  runtimeSchemaVersion: CURRENT_RUNTIME_SCHEMA_VERSION,
  structuralOnly: STRUCTURAL_ONLY,
  shortRun: {
    seeds: SHORT_SEED_COUNT,
    quartersPerSeed: SHORT_QUARTERS,
    uniqueHashes: shortHashes.size,
    finalPolityDistribution,
    eventGroupWorldOccurrence: groupWorldOccurrence,
    eventGroupTotals: groupEventTotals,
    eventKindTotals: Object.fromEntries(Object.entries(eventKindTotals).sort(([left], [right]) => left.localeCompare(right))),
    aggregate,
    maximumObservedFamilyOfficeShare: Number(maximumObservedFamilyOfficeShare.toFixed(3)),
    density: {
      perWorldYear: Object.fromEntries(Object.entries(densityTotals).map(([key, value]) => [
        key,
        Number((value / (SHORT_SEED_COUNT * SHORT_QUARTERS / 4)).toFixed(3)),
      ])),
      commanderTenureQuarters: {
        median: Number(percentile(commanderTenures, 0.5).toFixed(2)),
        p25: Number(percentile(commanderTenures, 0.25).toFixed(2)),
      },
      rapidCommanderReversals,
      explainedRapidCommanderReversals,
      unexplainedRapidCommanderReversals,
      rapidCommanderReversalEvidence,
      maximumPromotionsForOneCharacter,
      marriages: {
        initialCohort: initialCohortMarriageEvents,
        descendants: descendantMarriageEvents,
      },
    },
    crossSystemPaths: {
      backgroundPromotedTo: shortBackgroundCareerPaths,
      worldsWithFamilyInheritance: shortFamilyInheritanceWorlds,
      worldsWithFamilyBranch: shortFamilyBranchWorlds,
      worldsWithGrandchildren: shortMultigenerationalFamilyWorlds,
      majorPoliticalCauseAudit: {
        events: shortMajorPoliticalEvents,
        completeRoles: shortMajorPoliticalEventsWithCompleteRoles,
        resourceRelationshipEnvironmentEvidence: shortMajorPoliticalEventsWithEvidenceTriad,
      },
    },
  },
  determinism: {
    replayedSeeds: DETERMINISM_SEED_COUNT,
    quartersPerSeed: SHORT_QUARTERS,
    saveResumeQuarter: splitTurn,
    exact: true,
  },
  longRun: {
    seeds: LONG_SEED_COUNT,
    quartersPerSeed: LONG_QUARTERS,
    finalPolityDistribution: longFinalPolityDistribution,
    unifiedWorlds: longUnifiedWorlds,
    fragmentedWorlds: longFragmentedWorlds,
    worldsWithFamilyEvolution: longFamilySuccessionWorlds,
    worldsWithPoliticalEvolution: longPoliticalWorlds,
    worldsWithDeputyEvolution: longDeputyWorlds,
    worldsWithDiplomaticEvolution: longDiplomacyWorlds,
    crossSystemPaths: {
      backgroundPromotedTo: longBackgroundCareerPaths,
      worldsWithFamilyInheritance: longFamilyInheritanceWorlds,
      worldsWithFamilyBranch: longFamilyBranchWorlds,
      worldsWithGrandchildren: longMultigenerationalFamilyWorlds,
      majorPoliticalCauseAudit: {
        events: longMajorPoliticalEvents,
        completeRoles: longMajorPoliticalEventsWithCompleteRoles,
        resourceRelationshipEnvironmentEvidence: longMajorPoliticalEventsWithEvidenceTriad,
      },
    },
    saveSizeMiB: {
      minimum: Number((Math.min(...longSaveBytes) / 1024 / 1024).toFixed(2)),
      median: Number((percentile(longSaveBytes, 0.5) / 1024 / 1024).toFixed(2)),
      maximum: Number((Math.max(...longSaveBytes) / 1024 / 1024).toFixed(2)),
      browserImportLimit: 16,
    },
  },
  overallCrossSystemPaths: {
    backgroundPromotedTo: overallBackgroundCareerPaths,
    worldsWithFamilyInheritance: shortFamilyInheritanceWorlds + longFamilyInheritanceWorlds,
    worldsWithFamilyBranch: shortFamilyBranchWorlds + longFamilyBranchWorlds,
    worldsWithGrandchildren: shortMultigenerationalFamilyWorlds + longMultigenerationalFamilyWorlds,
  },
  performance: {
    measuredQuarters: allDurations.length,
    p50Ms: Number(p50.toFixed(3)),
    p95Ms: Number(p95.toFixed(3)),
    maximumMs: Number(maximumTurnMs.toFixed(3)),
    targetP95Ms: 150,
    targetMet: p95 < 150,
  },
  elapsedSeconds: Number(((performance.now() - auditStartedAt) / 1_000).toFixed(2)),
};

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
