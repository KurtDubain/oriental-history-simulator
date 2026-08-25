import { computeWorldHash } from './engine';
import { stableHash, stableStringify } from './random';
import type { WorldState } from './types';
import { validateWorld } from './invariants';
import { migrateV01SocialState } from './v02';
import { createV03LifeSystems } from './v03-life';
import { createV03OceanSystems } from './v03-ocean';

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
  if (originalVersion !== 1 && originalVersion !== 2 && originalVersion !== 3) throw new Error(`不支持的存档版本 ${String(rawWorld.schemaVersion)}`);
  const world = parsed as unknown as WorldState;
  if (world.hash !== computeWorldHash(world)) throw new Error('存档哈希校验失败，内容可能已损坏或被篡改');
  let migrated = false;
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
    world.historyDigest = world.history.reduce(
      (digest, event, index) => index === 0 ? stableHash(event) : stableHash([digest, event]),
      '',
    );
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
  if (migrated) world.hash = computeWorldHash(world);
  const violations = validateWorld(world);
  if (violations.length > 0) {
    throw new Error(`存档未通过一致性校验：${violations[0]?.message ?? '未知错误'}`);
  }
  return world;
}
