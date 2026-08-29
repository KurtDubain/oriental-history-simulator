import { stableHash, stableStringify } from './random';
import { computeWorldHash } from './world-hash';
import type { WorldState } from './types';
import { validateWorld } from './invariants';
import { migrateV01SocialState } from './v02';
import { createV03LifeSystems } from './v03-life';
import { createV03OceanSystems } from './v03-ocean';
import type { LegacyArchiveBoundary, SimulationFact } from './facts';
import { createSituationSystemState } from './situations';
import { createAgencySystemState } from './agency/memory';
import { createAgencyDecisionSystemState } from './agency/decision';
import { findMapProfileForContentVersion } from '../maps';

function migrateV02Systems(world: WorldState): void {
  (world as unknown as { schemaVersion: number }).schemaVersion = 3;
  world.mapContentVersion = 'legacy-v02-48';
  world.seaZones ??= [];
  world.seaLanes ??= [];
  world.portLinks ??= [];
  world.ports ??= [];
  world.fleets ??= [];
  world.tradeCorridors ??= [];
  world.navalOperations ??= [];
  world.shipbuildingProjects ??= [];
  world.pathogens ??= [];
  world.infections ??= [];
  world.practices ??= [];
  world.practiceStates ??= [];
  world.counters.fleet ??= 0;
  world.counters.tradeCorridor ??= 0;
  world.counters.navalOperation ??= 0;
  world.counters.shipment ??= 0;
  world.counters.shipProject ??= 0;
  createV03OceanSystems(world, { legacy: true });
  createV03LifeSystems(world, { legacy: true });
  if (world.lastTurn) {
    world.lastTurn.logistics.seaUsage ??= [];
    world.lastTurn.trade ??= {
      shipments: [],
      stockStart: world.regions.reduce((total, region) => ({
        木材: total.木材 + region.goods.木材,
        铁器: total.铁器 + region.goods.铁器,
        马匹: total.马匹 + region.goods.马匹,
        盐: total.盐 + region.goods.盐,
        纺织品: total.纺织品 + region.goods.纺织品,
        奢侈品: total.奢侈品 + region.goods.奢侈品,
      }), { 木材: 0, 铁器: 0, 马匹: 0, 盐: 0, 纺织品: 0, 奢侈品: 0 }),
      stockEnd: world.regions.reduce((total, region) => ({
        木材: total.木材 + region.goods.木材,
        铁器: total.铁器 + region.goods.铁器,
        马匹: total.马匹 + region.goods.马匹,
        盐: total.盐 + region.goods.盐,
        纺织品: total.纺织品 + region.goods.纺织品,
        奢侈品: total.奢侈品 + region.goods.奢侈品,
      }), { 木材: 0, 铁器: 0, 马匹: 0, 盐: 0, 纺织品: 0, 奢侈品: 0 }),
      produced: {},
      consumed: {},
      lost: {},
      valueTransferred: 0,
      tariffsTransferred: 0,
    };
    world.lastTurn.migration ??= { departed: 0, arrived: 0, travelDeaths: 0, settled: 0, flowIds: [] };
    world.lastTurn.health ??= {
      infectiousStart: 0,
      newExposures: 0,
      importedExposures: 0,
      civilianDeaths: 0,
      militaryDeaths: 0,
      infectiousEnd: 0,
      outbreakRegionIds: [],
    };
    world.lastTurn.knowledge ??= { prototypeIds: [], adoptedIds: [], spreadIds: [], lostIds: [] };
    world.lastTurn.maritime ??= { fleetIds: [], blockadedPortIds: [], raidedShipmentIds: [], landingOperationIds: [], shipsLost: 0 };
  }
}

function historyDigestOf(world: Pick<WorldState, 'history'>): string {
  return world.history.reduce(
    (digest, event, index) => index === 0 ? stableHash(event) : stableHash([digest, event]),
    '',
  );
}

function factDigestOf(facts: readonly SimulationFact[]): string {
  return facts.reduce((digest, fact) => stableHash([digest, fact]), stableHash([]));
}

function migrateLegacyFacts(world: WorldState, boundary: LegacyArchiveBoundary): void {
  // Schema 1-3 had Chronicle records but no authoritative fact archive. Keep an
  // explicit boundary so readers can use old event deltas without pretending
  // those narrative records were facts that the old simulation never emitted.
  (world as unknown as { schemaVersion: number }).schemaVersion = 4;
  world.facts = [];
  world.factDigest = stableHash([]);
  world.legacyArchiveBoundary = boundary;
  world.counters.fact = 0;
  for (const event of world.history) {
    event.sourceFactIds = [];
    event.situationIds = [];
  }
  // The migrated archive continues from the authenticated legacy chain tail.
  // Empty schema-4 link arrays do not force an O(legacy history) rewrite.
  world.historyDigest = boundary.historyDigest;
  for (const character of world.characters) {
    for (const biography of character.biography ?? []) biography.factId = null;
    character.biographyDigest = stableHash(character.biography ?? []);
  }
  if (world.lastTurn) world.lastTurn.factIds = [];
}

export function serializeWorld(world: WorldState): string {
  return stableStringify(world);
}

export function deserializeWorld(serialized: string): WorldState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error('存档不是有效的 JSON');
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('存档缺少世界对象');
  const rawWorld = parsed as Record<string, unknown>;
  const originalVersion = Number(rawWorld.schemaVersion);
  if (originalVersion !== 1 && originalVersion !== 2 && originalVersion !== 3 && originalVersion !== 4) throw new Error(`不支持的存档版本 ${String(rawWorld.schemaVersion)}`);
  const world = parsed as unknown as WorldState;
  if (world.hash !== computeWorldHash(world)) throw new Error('存档哈希校验失败，内容可能已损坏或被篡改');
  if (originalVersion === 4) {
    if (!Array.isArray(world.facts) || world.factDigest !== factDigestOf(world.facts)) {
      throw new Error('事实档案摘要校验失败，内容可能已损坏或被篡改');
    }
  }
  const authenticatedMapContentVersion = typeof world.mapContentVersion === 'string'
    ? world.mapContentVersion
    : originalVersion < 3
      ? 'legacy-v02-48'
      : null;
  if (!authenticatedMapContentVersion || !findMapProfileForContentVersion(authenticatedMapContentVersion)) {
    throw new Error(
      `存档需要地图内容“${authenticatedMapContentVersion ?? '未标注'}”，当前版本未包含；原存档未被修改。`,
    );
  }
  const legacyBoundary: LegacyArchiveBoundary | null = originalVersion < 4
    ? {
        sourceSchemaVersion: originalVersion as 1 | 2 | 3,
        turn: world.turn,
        historyEventCount: world.history.length,
        historyDigest: typeof world.historyDigest === 'string' ? world.historyDigest : historyDigestOf(world),
      }
    : null;
  let migrated = false;
  let factsMigrated = false;
  for (const character of world.characters) {
    if (!Number.isFinite(character.rebellionReadiness)) {
      character.rebellionReadiness = 0;
      migrated = true;
    }
  }
  for (const war of world.wars) {
    if (war.kind !== 'interstate' && war.kind !== 'rebellion') {
      war.kind = war.reason.endsWith('独立') ? 'rebellion' : 'interstate';
      migrated = true;
    }
  }
  if (world.lastTurn && !world.lastTurn.logistics) {
    world.lastTurn.logistics = { remoteFoodTransferred: 0, routeUsage: [], seaUsage: [] };
    migrated = true;
  }
  if (typeof world.historyDigest !== 'string') {
    world.historyDigest = historyDigestOf(world);
    migrated = true;
  }
  if (originalVersion === 1 || !Array.isArray(world.families)) {
    (world as unknown as { schemaVersion: number }).schemaVersion = 2;
    world.counters.family ??= 0;
    world.counters.faction ??= 0;
    world.counters.relationship ??= 0;
    world.counters.office ??= 0;
    world.counters.commitment ??= 0;
    migrateV01SocialState(world);
    migrated = true;
  } else {
    world.backgroundPeople ??= [];
    world.commitments ??= [];
    world.offices ??= [];
    world.counters.family ??= world.families.length;
    world.counters.faction ??= world.factions.length;
    world.counters.relationship ??= world.relationships.length;
    world.counters.office ??= world.offices.length;
    world.counters.commitment ??= world.commitments.length;
    for (const character of world.characters) {
      character.tier ??= character.alive ? '核心' : '配角';
      character.sourceStubId ??= null;
      character.biographyDigest ??= stableHash(character.biography ?? []);
    }
    for (const family of world.families) {
      family.active ??= family.memberIds.some((id) => world.characters.some((character) => character.id === id && character.alive));
      family.extinctTurn ??= family.active ? null : world.turn;
    }
    for (const faction of world.factions) {
      faction.active ??= world.polities.some((polity) => polity.id === faction.polityId && polity.alive);
      faction.endedTurn ??= faction.active ? null : world.turn;
    }
    for (const polity of world.polities) polity.lastCourtCrisisTurn ??= -100;
  }
  if (originalVersion < 3) {
    migrateV02Systems(world);
    migrated = true;
  }
  if (legacyBoundary) {
    migrateLegacyFacts(world, legacyBoundary);
    migrated = true;
  }
  if (!world.situationSystem || typeof world.situationSystem !== 'object') {
    // Phase-A schema-4 saves predate authoritative Situations. Authenticate the
    // original hash first, then start observation at the next live quarter; do
    // not fabricate retrospective candidates or milestones.
    world.situationSystem = createSituationSystemState(world.turn - 1);
    migrated = true;
  }
  if (!world.agencySystem || typeof world.agencySystem !== 'object') {
    // Early schema-4 saves predate PersonalMemory. Start at the live boundary;
    // Chronicle and earlier Facts are not replayed into memories retroactively.
    world.agencySystem = createAgencySystemState(world.turn - 1);
    migrated = true;
  }
  if (!world.agencyDecisionSystem || typeof world.agencyDecisionSystem !== 'object') {
    // C08-era schema-4 saves had memories but no authoritative Goal/Plan owner.
    // Authenticate first, then begin at the live boundary. Never import the
    // observer-only shadow ledger or replay earlier Facts into invented intent.
    world.agencyDecisionSystem = createAgencyDecisionSystemState(world.turn - 1);
    migrated = true;
  } else {
    // v1.1 adds bounded, authoritative support actions without changing the
    // public schema number. Authenticate the old save first, then start this
    // new account empty at the live boundary; never infer past backing from
    // Chronicle prose or current relationship values.
    for (const actor of world.agencyDecisionSystem.actors) {
      const legacyActor = actor as typeof actor & {
        supportActions?: typeof actor.supportActions;
        supportAttemptOrdinal?: number;
        nextEligibleSupportTurn?: number;
      };
      if (!Array.isArray(legacyActor.supportActions)) {
        legacyActor.supportActions = [];
        legacyActor.supportAttemptOrdinal = 0;
        legacyActor.nextEligibleSupportTurn = world.turn;
        migrated = true;
      }
      if (!Number.isSafeInteger(legacyActor.supportAttemptOrdinal)) {
        legacyActor.supportAttemptOrdinal = legacyActor.supportActions.length;
        migrated = true;
      }
      if (!Number.isSafeInteger(legacyActor.nextEligibleSupportTurn)) {
        legacyActor.nextEligibleSupportTurn = world.turn;
        migrated = true;
      }
    }
  }
  for (const fact of world.facts ?? []) {
    if (fact.kind !== 'agency_intent_resolved' || fact.payload.institutionResponse) continue;
    fact.payload.institutionResponse = fact.payload.outcome === 'executed' ? 'command_granted' : 'none';
    migrated = true;
    factsMigrated = true;
  }
  if (factsMigrated) world.factDigest = factDigestOf(world.facts);
  if (migrated) world.hash = computeWorldHash(world);
  const violations = validateWorld(world);
  if (violations.length > 0) {
    throw new Error(`存档未通过一致性校验：${violations[0]?.message ?? '未知错误'}`);
  }
  return world;
}
