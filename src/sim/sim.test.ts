import { describe, expect, it } from 'vitest';

import {
  advanceWorld,
  advanceWorldBy,
  computeWorldHash,
  createObserverState,
  createWorld,
  deserializeWorld,
  focusObserver,
  serializeWorld,
  stableHash,
  toggleFollow,
  validateWorld,
  type WorldState,
} from './index';

function expectQuarterlyConservation(world: WorldState): void {
  const report = world.lastTurn;
  expect(report).not.toBeNull();
  if (!report) return;
  expect(report.population.end).toBe(
    report.population.start
      + report.population.births
      - report.population.civilianDeaths
      - report.population.militaryDeaths,
  );
  expect(report.food.end).toBe(
    report.food.start
      + report.food.produced
      - report.food.civilianConsumed
      - report.food.armyConsumed
      - report.food.spoiled
      - report.food.warDestroyed,
  );
  expect(report.wealth.end).toBe(
    report.wealth.start
      + report.wealth.produced
      - report.wealth.householdConsumed
      - report.wealth.warDestroyed,
  );
  for (const usage of report.logistics.routeUsage) {
    expect(usage.reserved).toBeGreaterThanOrEqual(0);
    expect(usage.reserved).toBeLessThanOrEqual(usage.capacity);
  }
  for (const usage of report.logistics.seaUsage) {
    expect(usage.reserved).toBeGreaterThanOrEqual(0);
    expect(usage.reserved).toBeLessThanOrEqual(usage.capacity);
  }
  expect(report.migration.departed).toBe(report.migration.arrived + report.migration.travelDeaths);
  for (const shipment of report.trade.shipments) {
    expect(shipment.acceptedAmount).toBe(
      shipment.deliveredAmount + shipment.lostAmount + shipment.raidedAmount,
    );
    expect(shipment.peopleDeparted).toBe(shipment.peopleArrived + shipment.peopleLost);
  }
}

type JsonObject = Record<string, unknown>;

const V02_POLITY_IDS = ['p_yan', 'p_qi', 'p_yong', 'p_xuantu', 'p_canghai'] as const;

function suffixMaximum(values: JsonObject[]): number {
  return values.reduce((maximum, value) => {
    const match = String(value.id).match(/(\d+)$/);
    return Math.max(maximum, match ? Number(match[1]) : 0);
  }, 0);
}

/**
 * Builds an actual schema-2-shaped payload from the deterministic opening state.
 * The fixture deliberately retains the original 48-region/5-polity content and
 * removes every V0.3 field before calculating the V0.2 snapshot hash.
 */
function createSchema2Fixture(seed: string): string {
  const legacy = JSON.parse(serializeWorld(createWorld(seed))) as JsonObject;
  const retainedPolityIds = new Set<string>(V02_POLITY_IDS);
  const regions = (legacy.regions as JsonObject[]).slice(0, 48);
  const retainedRegionIds = new Set(regions.map((region) => String(region.id)));
  const oldController = (id: string): string => (
    id === 'p_minhai' || id === 'p_yamato' ? 'p_canghai'
      : id === 'p_haedong' ? 'p_xuantu'
        : id
  );
  for (const region of regions) {
    region.controllerId = oldController(String(region.controllerId));
    for (const key of [
      'refugeePopulation', 'sanitation', 'medicalCapacity', 'marketLevel',
      'portLevel', 'goods', 'prices', 'resourcePotential',
    ]) delete region[key];
  }
  const routes = (legacy.routes as JsonObject[]).filter((route) => (
    retainedRegionIds.has(String(route.fromRegionId))
    && retainedRegionIds.has(String(route.toRegionId))
  ));
  const retainedRouteIds = new Set(routes.map((route) => String(route.id)));
  for (const region of regions) {
    region.neighbors = (region.neighbors as string[]).filter((id) => retainedRegionIds.has(id));
    region.routeIds = (region.routeIds as string[]).filter((id) => retainedRouteIds.has(id));
  }

  const polities = (legacy.polities as JsonObject[]).filter((polity) => retainedPolityIds.has(String(polity.id)));
  const retainedCharacters = (legacy.characters as JsonObject[])
    .filter((character) => retainedPolityIds.has(String(character.polityId)));
  const retainedCharacterIds = new Set(retainedCharacters.map((character) => String(character.id)));
  for (const character of retainedCharacters) {
    const polity = polities.find((item) => item.id === character.polityId);
    if (!retainedRegionIds.has(String(character.locationRegionId))) character.locationRegionId = polity?.capitalRegionId;
    if (character.governedRegionId && !retainedRegionIds.has(String(character.governedRegionId))) character.governedRegionId = null;
    for (const biography of character.biography as JsonObject[]) delete biography.factId;
    character.biographyDigest = stableHash(character.biography);
    for (const key of ['commandingFleetId', 'health', 'activeDiseaseId', 'protectedUntilTurn']) delete character[key];
  }
  for (const polity of polities) {
    polity.controlledRegionIds = regions
      .filter((region) => region.controllerId === polity.id)
      .map((region) => region.id);
    for (const key of ['tradeRevenue', 'navalBudget', 'maritimeOrientation', 'diplomaticReputation']) delete polity[key];
  }

  const armies = (legacy.armies as JsonObject[])
    .filter((army) => retainedPolityIds.has(String(army.polityId)) && retainedCharacterIds.has(String(army.commanderId)));
  for (const army of armies) {
    const polity = polities.find((item) => item.id === army.polityId);
    if (!retainedRegionIds.has(String(army.regionId))) army.regionId = polity?.capitalRegionId;
    if (!retainedRegionIds.has(String(army.originRegionId))) army.originRegionId = polity?.capitalRegionId;
    delete army.embarkedOperationId;
  }

  const families = (legacy.families as JsonObject[]).filter((family) => retainedPolityIds.has(String(family.polityId)));
  const retainedFamilyIds = new Set(families.map((family) => String(family.id)));
  for (const family of families) {
    family.memberIds = (family.memberIds as string[]).filter((id) => retainedCharacterIds.has(id));
    family.marriageAllianceFamilyIds = (family.marriageAllianceFamilyIds as string[])
      .filter((id) => retainedFamilyIds.has(id));
  }
  const relationships = (legacy.relationships as JsonObject[]).filter((relationship) => (
    retainedCharacterIds.has(String(relationship.sourceId))
    && retainedCharacterIds.has(String(relationship.targetId))
  ));
  const factions = (legacy.factions as JsonObject[]).filter((faction) => retainedPolityIds.has(String(faction.polityId)));
  const retainedFactionIds = new Set(factions.map((faction) => String(faction.id)));
  for (const faction of factions) {
    faction.memberIds = (faction.memberIds as string[]).filter((id) => retainedCharacterIds.has(id));
    faction.alliedFactionIds = (faction.alliedFactionIds as string[]).filter((id) => retainedFactionIds.has(id));
  }
  const diplomacy = (legacy.diplomacy as JsonObject[]).filter((relation) => (
    retainedPolityIds.has(String(relation.polityAId))
    && retainedPolityIds.has(String(relation.polityBId))
  ));
  for (const relation of diplomacy) {
    for (const key of ['tradeAgreementUntilTurn', 'tributePayerId', 'tributePerTurn', 'treatyEventIds']) delete relation[key];
  }
  const offices = (legacy.offices as JsonObject[]).filter((office) => (
    retainedPolityIds.has(String(office.polityId)) && retainedCharacterIds.has(String(office.holderId))
  ));
  const retainedArmyIds = new Set(armies.map((army) => String(army.id)));
  for (const office of offices) {
    if (office.regionId && !retainedRegionIds.has(String(office.regionId))) office.regionId = null;
    if (office.armyId && !retainedArmyIds.has(String(office.armyId))) office.armyId = null;
    delete office.fleetId;
  }
  const backgroundPeople = (legacy.backgroundPeople as JsonObject[])
    .filter((person) => retainedRegionIds.has(String(person.regionId)));
  for (const person of backgroundPeople) person.polityId = oldController(String(person.polityId));
  const commitments = (legacy.commitments as JsonObject[]).filter((commitment) => (
    (commitment.polityIds as string[]).every((id) => retainedPolityIds.has(id))
    && retainedCharacterIds.has(String(commitment.promisorId))
    && retainedCharacterIds.has(String(commitment.promiseeId))
  ));

  const history = legacy.history as JsonObject[];
  for (const event of history) {
    event.actorIds = (event.actorIds as string[]).filter((id) => retainedCharacterIds.has(id));
    event.polityIds = (event.polityIds as string[]).filter((id) => retainedPolityIds.has(id));
    event.regionIds = (event.regionIds as string[]).filter((id) => retainedRegionIds.has(id));
    event.summary = '48处州域、5方政权与120名核心人物进入同一条可推演的历史。';
    event.evidence = ['固定地图含48个区域', '初始政权5个', '初始核心人物120名'];
    delete event.sourceFactIds;
    delete event.situationIds;
    for (const cause of event.causes as JsonObject[]) delete cause.refs;
  }

  legacy.schemaVersion = 2;
  legacy.regions = regions;
  legacy.routes = routes;
  legacy.polities = polities;
  legacy.characters = retainedCharacters;
  legacy.armies = armies;
  legacy.families = families;
  legacy.relationships = relationships;
  legacy.factions = factions;
  legacy.diplomacy = diplomacy;
  legacy.offices = offices;
  legacy.backgroundPeople = backgroundPeople;
  legacy.commitments = commitments;
  legacy.history = history;
  legacy.historyDigest = stableHash(history[0]);
  delete legacy.facts;
  delete legacy.factDigest;
  delete legacy.legacyArchiveBoundary;
  delete legacy.mapContentVersion;
  for (const key of [
    'seaZones', 'seaLanes', 'portLinks', 'ports', 'fleets', 'tradeCorridors',
    'navalOperations', 'shipbuildingProjects', 'pathogens', 'infections',
    'practices', 'practiceStates',
  ]) delete legacy[key];
  const counters = legacy.counters as JsonObject;
  counters.character = retainedCharacters.length;
  counters.army = suffixMaximum(armies);
  counters.polity = polities.length;
  counters.family = suffixMaximum(families);
  counters.faction = suffixMaximum(factions);
  counters.relationship = suffixMaximum(relationships);
  counters.office = suffixMaximum(offices);
  counters.commitment = suffixMaximum(commitments);
  for (const key of ['fleet', 'tradeCorridor', 'navalOperation', 'shipment', 'shipProject', 'fact']) delete counters[key];
  legacy.hash = computeWorldHash(legacy as unknown as WorldState);
  return JSON.stringify(legacy);
}

function createSchema1Fixture(seed: string): string {
  const legacy = JSON.parse(createSchema2Fixture(seed)) as JsonObject;
  const regions = (legacy.regions as JsonObject[]).slice(0, 30);
  const retainedRegionIds = new Set(regions.map((region) => String(region.id)));
  const routes = (legacy.routes as JsonObject[]).filter((route) => (
    retainedRegionIds.has(String(route.fromRegionId))
    && retainedRegionIds.has(String(route.toRegionId))
  ));
  const retainedRouteIds = new Set(routes.map((route) => String(route.id)));
  for (const region of regions) {
    region.neighbors = (region.neighbors as string[]).filter((id) => retainedRegionIds.has(id));
    region.routeIds = (region.routeIds as string[]).filter((id) => retainedRouteIds.has(id));
  }
  const polities = legacy.polities as JsonObject[];
  const allCharacters = legacy.characters as JsonObject[];
  const retainedCharacters = polities.flatMap((polity) => (
    allCharacters.filter((character) => character.polityId === polity.id).slice(0, 16)
  ));
  const idMap = new Map(retainedCharacters.map((character, index) => (
    [String(character.id), `c_${String(index + 1).padStart(3, '0')}`]
  )));
  for (const character of retainedCharacters) {
    character.id = idMap.get(String(character.id));
    const polity = polities.find((item) => item.id === character.polityId);
    if (!retainedRegionIds.has(String(character.locationRegionId))) {
      character.locationRegionId = polity?.capitalRegionId;
    }
    if (character.governedRegionId && !retainedRegionIds.has(String(character.governedRegionId))) {
      character.governedRegionId = null;
    }
    for (const key of [
      'birthTurn',
      'adultTurn',
      'lifeStage',
      'familyId',
      'parentIds',
      'spouseIds',
      'politicalClass',
      'influence',
      'personalWealth',
      'merit',
      'deputyExperience',
      'insubordination',
      'biography',
      'biographyDigest',
      'tier',
      'sourceStubId',
      'rebellionReadiness',
    ]) delete character[key];
  }
  for (const polity of polities) {
    polity.rulerId = idMap.get(String(polity.rulerId));
    polity.controlledRegionIds = (polity.controlledRegionIds as string[]).filter((id) => retainedRegionIds.has(id));
    for (const key of ['rulingFamilyId', 'governmentForm', 'courtInfluence', 'lastCourtCrisisTurn']) delete polity[key];
  }
  const armies = (legacy.armies as JsonObject[]).filter((army) => idMap.has(String(army.commanderId)));
  for (const army of armies) {
    army.commanderId = idMap.get(String(army.commanderId));
    if (army.deputyCommanderId) army.deputyCommanderId = idMap.get(String(army.deputyCommanderId)) ?? null;
    const polity = polities.find((item) => item.id === army.polityId);
    if (!retainedRegionIds.has(String(army.regionId))) army.regionId = polity?.capitalRegionId;
    if (!retainedRegionIds.has(String(army.originRegionId))) army.originRegionId = polity?.capitalRegionId;
  }
  const retainedArmyIds = new Set(armies.map((army) => String(army.id)));
  for (const character of retainedCharacters) {
    if (!retainedArmyIds.has(String(character.commandingArmyId))) character.commandingArmyId = null;
  }
  for (const event of legacy.history as JsonObject[]) {
    event.actorIds = (event.actorIds as string[]).flatMap((id) => idMap.get(id) ?? []);
    event.regionIds = (event.regionIds as string[]).filter((id) => retainedRegionIds.has(id));
    for (const cause of event.causes as JsonObject[]) delete cause.role;
  }

  legacy.schemaVersion = 1;
  legacy.regions = regions;
  legacy.routes = routes;
  legacy.characters = retainedCharacters;
  legacy.armies = armies;
  delete legacy.families;
  delete legacy.relationships;
  delete legacy.factions;
  delete legacy.diplomacy;
  delete legacy.offices;
  delete legacy.backgroundPeople;
  delete legacy.commitments;
  delete legacy.historyDigest;
  const counters = legacy.counters as JsonObject;
  counters.character = retainedCharacters.length;
  counters.army = suffixMaximum(armies);
  for (const key of ['family', 'faction', 'relationship', 'office', 'commitment']) delete counters[key];
  legacy.hash = computeWorldHash(legacy as unknown as WorldState);
  return JSON.stringify(legacy);
}

function createSchema3Fixture(seed: string): string {
  const legacy = JSON.parse(serializeWorld(createWorld(seed))) as JsonObject;
  legacy.schemaVersion = 3;
  delete legacy.facts;
  delete legacy.factDigest;
  delete legacy.legacyArchiveBoundary;
  const counters = legacy.counters as JsonObject;
  delete counters.fact;
  for (const event of legacy.history as JsonObject[]) {
    delete event.sourceFactIds;
    delete event.situationIds;
  }
  for (const character of legacy.characters as JsonObject[]) {
    for (const biography of character.biography as JsonObject[]) delete biography.factId;
    character.biographyDigest = stableHash(character.biography);
  }
  legacy.historyDigest = (legacy.history as JsonObject[]).reduce(
    (digest, event, index) => index === 0 ? stableHash(event) : stableHash([digest, event]),
    '',
  );
  legacy.hash = computeWorldHash(legacy as unknown as WorldState);
  return JSON.stringify(legacy);
}

describe('V0.3 deterministic history simulation', () => {
  it('creates the fixed 82-region, 10-sea, 8-polity and 192-character starting world', () => {
    const world = createWorld('沧海一粟');
    expect(world.schemaVersion).toBe(4);
    expect(world.mapContentVersion).toBe('v03-82');
    expect(world.regions).toHaveLength(82);
    expect(world.seaZones).toHaveLength(10);
    expect(world.polities).toHaveLength(8);
    expect(world.polities.filter((polity) => polity.alive)).toHaveLength(8);
    expect(world.characters).toHaveLength(192);
    expect(world.armies).toHaveLength(16);
    expect(world.fleets.length).toBeGreaterThan(0);
    expect(world.regions.every((region) => region.x >= 0 && region.x <= 1_000)).toBe(true);
    expect(world.regions.every((region) => region.y >= 0 && region.y <= 700)).toBe(true);
    expect(validateWorld(world)).toEqual([]);
  });

  it('is pure and exactly deterministic for the same seed', () => {
    const initial = createWorld('同源世界');
    const initialSave = serializeWorld(initial);
    const oneTurn = advanceWorld(initial);
    expect(oneTurn).not.toBe(initial);
    expect(serializeWorld(initial)).toBe(initialSave);

    const left = advanceWorldBy(initial, 64);
    const right = advanceWorldBy(createWorld('同源世界'), 64);
    expect(left.hash).toBe(right.hash);
    expect(serializeWorld(left)).toBe(serializeWorld(right));
    expect(left.hash).toBe(computeWorldHash(left));
  }, 30_000);

  it('uses the seed to produce genuinely different histories', () => {
    const left = advanceWorldBy(createWorld('赤潮'), 48);
    const right = advanceWorldBy(createWorld('青岚'), 48);
    expect(left.hash).not.toBe(right.hash);
    expect(left.characters.map((character) => character.name)).not.toEqual(
      right.characters.map((character) => character.name),
    );
  });

  it('continues identically after a save and load boundary', () => {
    const uninterrupted = advanceWorldBy(createWorld('归档校验'), 72);
    const beforeSave = advanceWorldBy(createWorld('归档校验'), 31);
    const restored = deserializeWorld(serializeWorld(beforeSave));
    const resumed = advanceWorldBy(restored, 41);
    expect(resumed.hash).toBe(uninterrupted.hash);
    expect(validateWorld(resumed)).toEqual([]);
  });

  it('migrates a true schema-1 save without rewriting history or granting new land and fleets', () => {
    const schema1 = JSON.parse(createSchema1Fixture('旧档迁移一')) as JsonObject;
    const restored = deserializeWorld(JSON.stringify(schema1));
    expect(restored.schemaVersion).toBe(4);
    expect(restored.mapContentVersion).toBe('legacy-v02-48');
    expect(restored.regions).toHaveLength(30);
    expect(restored.characters).toHaveLength(80);
    expect(restored.backgroundPeople).toHaveLength(120);
    expect(restored.families.length).toBeGreaterThan(0);
    expect(restored.factions.length).toBeGreaterThan(0);
    expect(restored.diplomacy).toHaveLength(10);
    expect(restored.fleets).toHaveLength(0);
    expect(restored.characters.every((character) => character.rebellionReadiness === 0)).toBe(true);
    expect(restored.history.map(({ sourceFactIds: _sourceFactIds, situationIds: _situationIds, ...event }) => event)).toEqual(schema1.history);
    expect(restored.facts).toEqual([]);
    expect(restored.legacyArchiveBoundary).toMatchObject({ sourceSchemaVersion: 1, turn: Number(schema1.turn), historyEventCount: restored.history.length });
    expect(restored.hash).toBe(computeWorldHash(restored));
    expect(validateWorld(restored)).toEqual([]);
  });

  it('migrates a true schema-2 save with an authenticated legacy boundary and no free fleets', () => {
    const schema2 = JSON.parse(createSchema2Fixture('旧档迁移二')) as JsonObject;
    const retainedBackground = schema2.backgroundPeople as JsonObject[];
    const unpromotedByRegion = retainedBackground.reduce<Record<string, number>>((counts, person) => {
      if (person.promotedCharacterId === null) {
        const regionId = String(person.regionId);
        counts[regionId] = (counts[regionId] ?? 0) + 1;
      }
      return counts;
    }, {});
    expect(Math.max(...Object.values(unpromotedByRegion))).toBe(4);
    expect(retainedBackground
      .filter((person) => person.regionId === 'r_hedong')
      .map((person) => person.id)
      .sort()).toEqual([
        'bg:r_hedong:1', 'bg:r_hedong:2', 'bg:r_hedong:3', 'bg:r_hedong:4',
      ]);
    const restoredV2 = deserializeWorld(JSON.stringify(schema2));
    expect(restoredV2.schemaVersion).toBe(4);
    expect(restoredV2.mapContentVersion).toBe('legacy-v02-48');
    expect(restoredV2.regions).toHaveLength(48);
    expect(restoredV2.characters).toHaveLength(120);
    expect(restoredV2.fleets).toHaveLength(0);
    expect(restoredV2.history.map(({ sourceFactIds: _sourceFactIds, situationIds: _situationIds, ...event }) => event)).toEqual(schema2.history);
    expect(restoredV2.facts).toEqual([]);
    expect(restoredV2.legacyArchiveBoundary).toMatchObject({ sourceSchemaVersion: 2, turn: Number(schema2.turn), historyEventCount: restoredV2.history.length });
    expect(restoredV2.legacyArchiveBoundary?.historyDigest).toBe(schema2.historyDigest);
    expect(restoredV2.hash).toBe(computeWorldHash(restoredV2));
    expect(validateWorld(restoredV2)).toEqual([]);
  });

  it('migrates a schema-3 archive without fabricating historical facts', () => {
    const schema3 = JSON.parse(createSchema3Fixture('旧档迁移三')) as JsonObject;
    const restored = deserializeWorld(JSON.stringify(schema3));
    expect(restored.schemaVersion).toBe(4);
    expect(restored.facts).toEqual([]);
    expect(restored.counters.fact).toBe(0);
    expect(restored.legacyArchiveBoundary).toMatchObject({
      sourceSchemaVersion: 3,
      turn: Number(schema3.turn),
      historyEventCount: (schema3.history as JsonObject[]).length,
      historyDigest: schema3.historyDigest,
    });
    expect(restored.history.map(({ sourceFactIds: _sourceFactIds, situationIds: _situationIds, ...event }) => event)).toEqual(schema3.history);
    expect(restored.hash).toBe(computeWorldHash(restored));
    expect(validateWorld(restored)).toEqual([]);
    const continued = advanceWorld(restored);
    expect(continued.facts.length).toBeGreaterThan(0);
    expect(continued.facts.every((fact) => fact.turn >= (continued.legacyArchiveBoundary?.turn ?? -1))).toBe(true);
    expect(continued.historyDigest).not.toBe(continued.legacyArchiveBoundary?.historyDigest);
    expect(validateWorld(continued)).toEqual([]);
  });

  it('keeps observer focus outside authoritative world state', () => {
    const world = advanceWorldBy(createWorld('观史者'), 12);
    const originalHash = world.hash;
    let observer = createObserverState();
    observer = focusObserver(observer, { kind: 'character', id: world.characters[0]?.id ?? '' });
    observer = toggleFollow(observer, { kind: 'polity', id: world.polities[0]?.id ?? '' });
    observer = focusObserver(observer, { kind: 'region', id: world.regions[0]?.id ?? '' });
    expect(observer.focused?.kind).toBe('region');
    expect(observer.followed).toHaveLength(1);
    expect(world.hash).toBe(originalHash);
    expect(computeWorldHash(world)).toBe(originalHash);
  });

  it('shares route capacity across military supply, trade and migration flows in a quarter', () => {
    const world = createWorld('共用粮道');
    const polity = world.polities.find((item) => item.id === 'p_yong');
    const destination = world.regions.find((item) => item.id === 'r_yanan');
    const capital = world.regions.find((item) => item.id === 'r_changan');
    const armies = world.armies.filter((army) => army.polityId === polity?.id).slice(0, 2);
    expect(polity).toBeDefined();
    expect(destination).toBeDefined();
    expect(capital).toBeDefined();
    expect(armies).toHaveLength(2);
    if (!polity || !destination || !capital || armies.length !== 2) return;

    destination.population = 0;
    destination.food = 0;
    capital.food = 100_000;
    for (const army of armies) {
      army.regionId = destination.id;
      army.soldiers = 3_000;
      army.food = 0;
      army.supply = 0;
    }
    const sharedRoute = world.routes.find((route) => (
      [route.fromRegionId, route.toRegionId].includes('r_changan')
      && [route.fromRegionId, route.toRegionId].includes('r_yanan')
    ));
    expect(sharedRoute).toBeDefined();
    if (!sharedRoute) return;

    const next = advanceWorld(world);
    const usage = next.lastTurn?.logistics.routeUsage.find((item) => item.routeId === sharedRoute.id);
    const shipments = next.lastTurn?.trade.shipments ?? [];
    const flowsOnRoute = shipments.filter((shipment) => (
      usage?.flowIds?.includes(shipment.id)
      && shipment.legs.some((leg) => leg.edgeId === sharedRoute.id)
    ));
    const armySupplyFlows = flowsOnRoute.filter((shipment) => (
      shipment.kind === '军粮' && armies.some((army) => army.id === shipment.carrierArmyId)
    ));
    expect(usage).toBeDefined();
    expect(usage?.reserved).toBeGreaterThan(0);
    expect(usage?.reserved).toBeLessThanOrEqual(sharedRoute.supplyCapacity);
    expect(usage?.flowIds?.length).toBeGreaterThan(0);
    expect(flowsOnRoute.length).toBe(usage?.flowIds?.length);
    expect(armySupplyFlows.length).toBeGreaterThan(0);
    expect(armySupplyFlows.every((shipment) => shipment.acceptedAmount > 0)).toBe(true);
    expect(flowsOnRoute.reduce((sum, shipment) => (
      sum + (shipment.legs.find((leg) => leg.edgeId === sharedRoute.id)?.capacityUsed ?? 0)
    ), 0)).toBeLessThanOrEqual(usage?.reserved ?? 0);
    expect(next.lastTurn?.logistics.routeUsage.every((item) => item.reserved <= item.capacity)).toBe(true);
  });

  it('cannot form a new army without a treasury-backed equipment budget', () => {
    const world = createWorld('空库不可募兵');
    const polity = world.polities.find((item) => item.id === 'p_canghai');
    expect(polity).toBeDefined();
    if (!polity) return;
    polity.treasury = 0;
    polity.taxRate = 0;
    const removed = world.armies.filter((army) => army.polityId === polity.id);
    for (const army of removed) {
      const region = world.regions.find((item) => item.id === army.regionId);
      if (region) {
        region.population += army.soldiers;
        region.food += army.food;
      }
      const commander = world.characters.find((character) => character.id === army.commanderId);
      if (commander) commander.commandingArmyId = null;
    }
    world.armies = world.armies.filter((army) => army.polityId !== polity.id);

    const next = advanceWorld(world);
    expect(next.polities.find((item) => item.id === polity.id)?.treasury).toBe(0);
    expect(next.armies.some((army) => army.polityId === polity.id)).toBe(false);
    expect(next.history.slice(-8).some((event) => event.kind === 'army_raised' && event.polityIds.includes(polity.id))).toBe(false);
  });

  it('pays new-army equipment from treasury into regional wealth', () => {
    const world = createWorld('募兵财政内转');
    const polity = world.polities.find((item) => item.id === 'p_canghai');
    expect(polity).toBeDefined();
    if (!polity) return;
    polity.treasury = 500;
    polity.taxRate = 0;
    for (const army of world.armies.filter((item) => item.polityId === polity.id)) {
      const region = world.regions.find((item) => item.id === army.regionId);
      if (region) {
        region.population += army.soldiers;
        region.food += army.food;
      }
      const commander = world.characters.find((character) => character.id === army.commanderId);
      if (commander) commander.commandingArmyId = null;
    }
    world.armies = world.armies.filter((army) => army.polityId !== polity.id);

    const next = advanceWorld(world);
    const raised = next.history.find((event) => event.kind === 'army_raised' && event.polityIds.includes(polity.id));
    const treasuryDelta = raised?.stateDeltas.find((delta) => delta.entityType === 'polity' && delta.field === 'treasury');
    const wealthDelta = raised?.stateDeltas.find((delta) => delta.entityType === 'region' && delta.field === 'wealth');
    expect(raised).toBeDefined();
    expect(Number(treasuryDelta?.delta)).toBeLessThan(0);
    expect(Number(wealthDelta?.delta)).toBe(-Number(treasuryDelta?.delta));
    expectQuarterlyConservation(next);
  });

  it('requires structural crisis and a real local mobilization resource before rebellion', () => {
    const stable = createWorld('仅凭野心不可反');
    const stablePolity = stable.polities.find((item) => item.id === 'p_yan');
    const stableGovernor = stable.characters.find((character) => (
      character.polityId === stablePolity?.id && Boolean(character.governedRegionId)
    ));
    expect(stablePolity).toBeDefined();
    expect(stableGovernor).toBeDefined();
    if (!stablePolity || !stableGovernor) return;
    stablePolity.authority = 100;
    stablePolity.legitimacy = 100;
    stablePolity.administration = 100;
    stablePolity.warWeariness = 0;
    stableGovernor.ambition = 100;
    stableGovernor.loyalty = 0;
    stableGovernor.caution = 0;
    const stableNext = advanceWorld(stable);
    expect(stableNext.history.some((event) => event.kind === 'rebellion' && event.actorIds.includes(stableGovernor.id))).toBe(false);

    const poor = createWorld('无兵无财不可反');
    const poorPolity = poor.polities.find((item) => item.id === 'p_yan');
    const poorGovernor = poor.characters.find((character) => (
      character.polityId === poorPolity?.id && Boolean(character.governedRegionId)
    ));
    expect(poorPolity).toBeDefined();
    expect(poorGovernor).toBeDefined();
    if (!poorPolity || !poorGovernor) return;
    poorPolity.authority = 0;
    poorPolity.legitimacy = 0;
    poorPolity.administration = 0;
    poorPolity.treasury = 0;
    poorPolity.taxRate = 0;
    poorGovernor.ambition = 100;
    poorGovernor.loyalty = 0;
    poorGovernor.caution = 0;
    for (const character of poor.characters.filter((item) => item.polityId === poorPolity.id && item.id !== poorGovernor.id)) {
      character.ambition = 0;
      character.loyalty = 100;
      character.caution = 100;
    }
    for (const region of poor.regions.filter((item) => item.controllerId === poorPolity.id && item.id !== poorPolity.capitalRegionId)) {
      region.population = 1_000;
      region.wealth = 0;
      region.unrest = 100;
    }
    for (const army of poor.armies.filter((item) => item.polityId === poorPolity.id)) {
      army.regionId = poorPolity.capitalRegionId ?? army.regionId;
    }
    const poorNext = advanceWorld(poor);
    expect(poorNext.history.some((event) => event.kind === 'rebellion' && event.actorIds.includes(poorGovernor.id))).toBe(false);
  });

  it('assigns each deputy to at most one army and keeps civil and military offices separate', () => {
    const world = advanceWorld(createWorld('职权互斥'));
    const deputyIds = world.armies
      .map((army) => army.deputyCommanderId)
      .filter((id): id is string => Boolean(id));
    expect(new Set(deputyIds).size).toBe(deputyIds.length);
    const militaryIds = new Set([
      ...world.armies.map((army) => army.commanderId),
      ...deputyIds,
    ]);
    expect(world.characters.some((character) => character.governedRegionId && militaryIds.has(character.id))).toBe(false);
    expect(validateWorld(world)).toEqual([]);
  });

  it('survives 50 years without negative accounts or dangling live references', () => {
    let world = createWorld('五十年长跑');
    for (let turn = 0; turn < 200; turn += 1) {
      world = advanceWorld(world);
      expectQuarterlyConservation(world);
      expect(world.regions.every((region) => (
        Number.isSafeInteger(region.population)
        && Number.isSafeInteger(region.food)
        && Number.isSafeInteger(region.wealth)
        && region.population >= 0
        && region.food >= 0
        && region.wealth >= 0
      ))).toBe(true);
      expect(world.armies.every((army) => (
        Number.isSafeInteger(army.soldiers)
        && Number.isSafeInteger(army.food)
        && army.soldiers > 0
        && army.food >= 0
      ))).toBe(true);
      expect(world.polities.every((polity) => Number.isSafeInteger(polity.treasury) && polity.treasury >= 0)).toBe(true);
      const polityIds = new Set(world.polities.map((polity) => polity.id));
      const regionIds = new Set(world.regions.map((region) => region.id));
      const characterIds = new Set(world.characters.map((character) => character.id));
      expect(world.regions.every((region) => polityIds.has(region.controllerId))).toBe(true);
      expect(world.armies.every((army) => (
        polityIds.has(army.polityId)
        && regionIds.has(army.regionId)
        && characterIds.has(army.commanderId)
      ))).toBe(true);
      expect(world.lastTurn?.eventIds.length).toBeGreaterThan(0);
    }
    expect(world.turn).toBe(200);
    expect(validateWorld(world)).toEqual([]);
    const eventKinds = world.history.reduce<Record<string, number>>((counts, event) => {
      counts[event.kind] = (counts[event.kind] ?? 0) + 1;
      return counts;
    }, {});
    expect(eventKinds.war_declared).toBeGreaterThan(0);
    expect(eventKinds.battle).toBeGreaterThan(0);
    expect(eventKinds.region_captured).toBeGreaterThan(0);
    expect(eventKinds.succession).toBeGreaterThan(0);
    expect(eventKinds.rebellion).toBeGreaterThan(0);
    expect(eventKinds.polity_eliminated).toBeGreaterThan(0);
    const rebellion = world.history.find((event) => event.kind === 'rebellion');
    expect(rebellion?.causes.map((cause) => cause.label)).toEqual(expect.arrayContaining([
      '地方权限',
      '结构危机',
      '军事与财政前置',
    ]));
    expect(rebellion?.stateDeltas.some((delta) => delta.entityType === 'war' && delta.field === 'active')).toBe(true);
    expect(rebellion?.stateDeltas.some((delta) => delta.entityType === 'army')).toBe(true);
    expect(rebellion?.stateDeltas.filter((delta) => delta.field === 'treasury').length).toBeGreaterThanOrEqual(2);
    expect(world.polities
      .filter((polity) => polity.id.startsWith('p_rebel_') && polity.eliminatedTurn !== null)
      .every((polity) => Number(polity.eliminatedTurn) > polity.foundedTurn)).toBe(true);
    const battle = world.history.find((event) => event.kind === 'battle');
    expect(battle?.causes.find((cause) => cause.label === '结算前补给士气')?.evidence).toContain('结算前攻方补给');
    expect(world.history.filter((event) => event.kind === 'quarter_summary')).toHaveLength(200);
    expect(world.history.every((event) => event.causes.length > 0)).toBe(true);
  }, 45_000);
});
