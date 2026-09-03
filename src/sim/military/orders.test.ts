import { describe, expect, it } from 'vitest';

import {
  advanceWorld,
  computeWorldHash,
  createWorld,
  deserializeWorld,
  getDateForTurn,
  serializeWorld,
  validateWorld,
  type WarState,
  type WorldState,
} from '../index';
import { emitSimulationFact, type FactTurnBuffer } from '../facts';
import {
  collectReferencedFactIds,
  compactWorldArchive,
  validateWorldArchiveIntegrity,
} from '../archive';
import { markLawfulCommandTransfer, recordArmyMovement, syncArmyPersonnelLocations } from './authority';
import { armyOrderIsExecutable, issueAmphibiousArmyOrder, planArmyOrders } from './orders';

function factContext(world: WorldState): FactTurnBuffer {
  return {
    turn: world.turn,
    year: world.year,
    season: world.season,
    facts: [],
  };
}

function addReachableBorderWar(world: WorldState): WarState {
  const polityIdsWithArmies = new Set(world.armies.map((army) => army.polityId));
  const border = world.regions
    .flatMap((region) => region.neighbors.map((neighborId) => ({
      attackerRegion: region,
      defenderRegion: world.regions.find((candidate) => candidate.id === neighborId),
    })))
    .find(({ attackerRegion, defenderRegion }) => (
      defenderRegion !== undefined
      && attackerRegion.controllerId !== defenderRegion.controllerId
      && polityIdsWithArmies.has(attackerRegion.controllerId)
      && polityIdsWithArmies.has(defenderRegion.controllerId)
    ));
  if (!border?.defenderRegion) throw new Error('expected an inhabited border shared by two armed polities');

  const war = {
    id: 'war_orders_regression',
    kind: 'interstate',
    attackerId: border.attackerRegion.controllerId,
    defenderId: border.defenderRegion.controllerId,
    startedTurn: world.turn,
    endedTurn: null,
    active: true,
    attackerScore: 0,
    defenderScore: 0,
    reason: '军令回归测试',
    lastBattleTurn: -100,
    goal: '边境',
    targetRegionIds: [border.defenderRegion.id],
    exhaustion: 0,
  } satisfies WarState;
  world.wars.push(war);
  return war;
}

function addRecordedAmphibiousWar(
  world: WorldState,
  attackerId: string,
  defenderId: string,
  targetRegionId: string,
  reason: string,
): WarState {
  world.wars = world.wars.filter((war) => (
    war.attackerId !== attackerId && war.defenderId !== attackerId
    && war.attackerId !== defenderId && war.defenderId !== defenderId
  ));
  if (world.turn < 1) throw new Error('amphibious test wars require one finalized opening quarter');
  const warStartedTurn = world.turn - 1;
  const warStartedDate = getDateForTurn(warStartedTurn);
  world.counters.war += 1;
  const war: WarState = {
    id: `war_${String(world.counters.war).padStart(4, '0')}`,
    kind: 'interstate',
    attackerId,
    defenderId,
    startedTurn: warStartedTurn,
    endedTurn: null,
    active: true,
    attackerScore: 0,
    defenderScore: 0,
    reason,
    lastBattleTurn: -100,
    goal: '霸权',
    targetRegionIds: [targetRegionId],
    exhaustion: 0,
  };
  world.wars.push(war);
  emitSimulationFact(world, {
    turn: warStartedTurn,
    year: warStartedDate.year,
    season: warStartedDate.season,
    facts: [],
  }, {
    kind: 'war_started',
    category: '外交',
    importance: 4,
    actorIds: world.polities
      .filter((polity) => polity.id === attackerId || polity.id === defenderId)
      .map((polity) => polity.rulerId),
    polityIds: [attackerId, defenderId],
    regionIds: [targetRegionId],
    causes: [{ label: '测试战端', role: '触发', weight: 1, evidence: war.reason }],
    stateDeltas: [{ entityType: 'war', entityId: war.id, field: 'active', before: false, after: true }],
    sourceFactIds: [],
    payload: {
      warId: war.id,
      warKind: war.kind,
      attackerId,
      defenderId,
      goal: war.goal,
      targetRegionIds: [targetRegionId],
      reason: war.reason,
    },
  });
  return war;
}

function landingTransportEdgeIds(
  world: WorldState,
  originRegionId: string,
  targetRegionId: string,
  seaZonePath: readonly string[],
): string[] {
  const departureZoneId = seaZonePath[0];
  const arrivalZoneId = seaZonePath.at(-1);
  const departure = world.portLinks.find((link) => (
    link.regionId === originRegionId && link.seaZoneId === departureZoneId
  ));
  const arrival = world.portLinks.find((link) => (
    link.regionId === targetRegionId && link.seaZoneId === arrivalZoneId
  ));
  const lanes = seaZonePath.slice(1).map((rightId, index) => {
    const leftId = seaZonePath[index] as string;
    return world.seaLanes.find((lane) => (
      (lane.fromSeaZoneId === leftId && lane.toSeaZoneId === rightId)
      || (lane.fromSeaZoneId === rightId && lane.toSeaZoneId === leftId)
    ));
  });
  if (!departure || !arrival || lanes.some((lane) => !lane)) {
    throw new Error('expected every amphibious fixture transport edge to exist');
  }
  return [departure.id, ...lanes.map((lane) => lane?.id as string), arrival.id];
}

function stageInFlightLanding(
  world: WorldState,
  targetRegionId: string,
  seaZonePath: string[],
): { armyId: string; fleetId: string; operationId: string; originRegionId: string; warId: string } {
  const attackerId = 'p_minhai';
  const defenderId = 'p_yamato';
  const originRegionId = 'r_fuzhou';
  world.navalOperations = [];
  for (const candidate of world.armies) candidate.embarkedOperationId = null;
  const war = addRecordedAmphibiousWar(
    world,
    attackerId,
    defenderId,
    targetRegionId,
    '航行阶段回归测试',
  );
  const warId = war.id;

  const army = world.armies.find((candidate) => candidate.polityId === attackerId);
  const fleet = world.fleets.find((candidate) => (
    candidate.polityId === attackerId && candidate.homePortRegionId === originRegionId
  ));
  const origin = world.regions.find((region) => region.id === originRegionId);
  if (!army || !fleet || !origin) throw new Error('expected the Minhai amphibious voyage fixture');

  for (const candidate of world.armies) {
    if ((candidate.polityId === attackerId || candidate.polityId === defenderId) && candidate.id !== army.id) {
      candidate.morale = 0;
    }
  }
  army.regionId = origin.id;
  army.morale = 82;
  army.supply = 90;
  army.food = Math.max(army.food, army.soldiers * 2);
  army.lastMovedTurn = world.turn;
  army.order = {
    kind: 'advance',
    warId: war.id,
    issuerId: army.commanderId,
    issuedTurn: world.turn,
    lastReviewedTurn: world.turn,
    targetRegionId,
    targetArmyId: null,
    status: 'active',
    reasonCode: 'amphibious_landing',
    provenance: 'system',
    sourceFactId: null,
  };
  syncArmyPersonnelLocations(world, army);

  for (const candidate of world.fleets) {
    if (candidate.id === fleet.id) continue;
    candidate.lastMovedTurn = world.turn;
  }
  fleet.portRegionId = null;
  fleet.seaZoneId = seaZonePath[0] ?? null;
  fleet.mission = '登陆';
  fleet.targetRegionId = targetRegionId;
  fleet.targetSeaZoneId = seaZonePath.at(-1) ?? null;
  fleet.transports = Math.max(1, Math.ceil(army.soldiers / 1_000));
  fleet.warships = Math.max(fleet.warships, 120);
  fleet.patrolShips = Math.max(fleet.patrolShips, 30);
  fleet.sailors = Math.max(fleet.sailors, 12_000);
  fleet.food = Math.max(fleet.food, fleet.sailors * 2);
  fleet.morale = 95;
  fleet.training = 95;
  fleet.readiness = 100;
  fleet.lastMovedTurn = world.turn - 1;

  const foodLoaded = Math.min(origin.food, Math.max(1_000, army.soldiers));
  if (foodLoaded < 1_000) throw new Error('expected enough food to stage the voyage fixture');
  origin.food -= foodLoaded;
  world.counters.navalOperation += 1;
  const operationId = `navop_${String(world.counters.navalOperation).padStart(5, '0')}`;
  world.navalOperations.push({
    id: operationId,
    warId,
    armyId: army.id,
    fleetIds: [fleet.id],
    originRegionId,
    targetRegionId,
    seaZonePath: [...seaZonePath],
    stage: '航行',
    startedTurn: world.turn,
    progress: 55,
    foodLoaded,
    manifest: {
      loadedTurn: world.turn,
      soldiersDeparted: army.soldiers,
      transportEdgeIds: landingTransportEdgeIds(
        world,
        originRegionId,
        targetRegionId,
        seaZonePath,
      ),
    },
    completedTurn: null,
  });
  army.embarkedOperationId = operationId;
  world.hash = computeWorldHash(world);
  return { armyId: army.id, fleetId: fleet.id, operationId, originRegionId, warId };
}

describe('military authority and persistent army orders', () => {
  it('creates complete authority fields and keeps every retinue inside its parent army', () => {
    const world = createWorld('军权字段开局');

    expect(world.armies.length).toBeGreaterThan(0);
    for (const army of world.armies) {
      expect(army.allegiance).toMatchObject({
        characterId: army.commanderId,
        provenance: 'opening',
        sourceFactId: null,
      });
      expect(army.order).toMatchObject({
        kind: 'hold',
        issuerId: army.commanderId,
        targetRegionId: army.regionId,
        issuedTurn: world.turn,
        provenance: 'opening',
        sourceFactId: null,
      });
      expect(army.retinues.length).toBeLessThanOrEqual(2);
      expect(new Set(army.retinues.map((retinue) => retinue.ownerId)).size).toBe(army.retinues.length);
      expect(army.retinues.every((retinue) => (
        retinue.ownerId === army.commanderId || retinue.ownerId === army.deputyCommanderId
      ))).toBe(true);
      expect(army.retinues.every((retinue) => retinue.soldiers > 0 && retinue.soldiers <= army.soldiers)).toBe(true);
      expect(army.retinues.reduce((sum, retinue) => sum + retinue.soldiers, 0)).toBeLessThanOrEqual(army.soldiers);
      expect(army.recentMovement).toBeNull();
    }
  });

  it('keeps exactly one latest movement step and overwrites it deterministically', () => {
    const world = createWorld('军团最近一步');
    const army = world.armies[0];
    const [first, second] = world.regions.filter((region) => region.id !== army.regionId).slice(0, 2);
    if (!army || !first || !second) throw new Error('expected an army and two destinations');

    recordArmyMovement(army, army.regionId, first.id, 1, 'advance', 'war_a');
    recordArmyMovement(army, first.id, second.id, 2, 'retreat', 'war_b');

    expect(army.recentMovement).toEqual({
      fromRegionId: first.id,
      toRegionId: second.id,
      turn: 2,
      orderKind: 'retreat',
      warId: 'war_b',
    });
    expect(army.lastMovedTurn).toBe(2);
    expect(Array.isArray(army.recentMovement)).toBe(false);
  });

  it('emits one Fact for a meaningful order change and makes that order executable next turn', () => {
    const world = createWorld('军令延迟执行');
    const war = addReachableBorderWar(world);
    const context = factContext(world);
    const factCountBefore = world.facts.length;

    planArmyOrders(world, context);

    const issuedFacts = world.facts.slice(factCountBefore).filter((fact) => fact.kind === 'army_order_changed');
    expect(issuedFacts.length).toBeGreaterThan(0);
    expect(context.facts).toEqual(issuedFacts);
    const advancingFact = issuedFacts.find((fact) => (
      fact.kind === 'army_order_changed'
      && fact.payload.next.warId === war.id
      && fact.payload.next.kind !== 'hold'
    ));
    if (advancingFact?.kind !== 'army_order_changed') throw new Error('expected a non-hold order on the new front');
    const army = world.armies.find((candidate) => candidate.id === advancingFact.payload.armyId);
    if (!army) throw new Error('expected the ordered army to remain active');

    expect(army.order.sourceFactId).toBe(advancingFact.id);
    expect(army.order.issuedTurn).toBe(world.turn);
    expect(armyOrderIsExecutable(army, war.id, world.turn)).toBe(false);
    expect(armyOrderIsExecutable(army, war.id, world.turn + 1)).toBe(true);

    const factCountAfterFirstPlan = world.facts.length;
    planArmyOrders(world, context);
    expect(world.facts).toHaveLength(factCountAfterFirstPlan);
    expect(context.facts).toHaveLength(issuedFacts.length);
  });

  it('naturally stages a disconnected army at port and opens an amphibious operation from its blocked order', () => {
    let world = createWorld('跨海军令自然链');
    world.wars = world.wars.filter((war) => (
      war.attackerId !== 'p_minhai' && war.defenderId !== 'p_minhai'
      && war.attackerId !== 'p_yamato' && war.defenderId !== 'p_yamato'
    ));
    world.counters.war += 1;
    const warId = `war_${String(world.counters.war).padStart(4, '0')}`;
    const war: WarState = {
      id: warId,
      kind: 'interstate',
      attackerId: 'p_minhai',
      defenderId: 'p_yamato',
      startedTurn: world.turn,
      endedTurn: null,
      active: true,
      attackerScore: 0,
      defenderScore: 0,
      reason: '跨海军令回归测试',
      lastBattleTurn: -100,
      goal: '霸权',
      targetRegionIds: ['r_yamato'],
      exhaustion: 0,
    };
    world.wars.push(war);
    emitSimulationFact(world, factContext(world), {
      kind: 'war_started',
      category: '外交',
      importance: 4,
      actorIds: world.polities
        .filter((polity) => polity.id === war.attackerId || polity.id === war.defenderId)
        .map((polity) => polity.rulerId),
      polityIds: [war.attackerId, war.defenderId],
      regionIds: [...war.targetRegionIds],
      causes: [{ label: '测试战端', role: '触发', weight: 1, evidence: war.reason }],
      stateDeltas: [{ entityType: 'war', entityId: war.id, field: 'active', before: false, after: true }],
      sourceFactIds: [],
      payload: {
        warId: war.id,
        warKind: war.kind,
        attackerId: war.attackerId,
        defenderId: war.defenderId,
        goal: war.goal,
        targetRegionIds: [...war.targetRegionIds],
        reason: war.reason,
      },
    });
    const army = world.armies.find((candidate) => (
      candidate.polityId === 'p_minhai' && candidate.regionId === 'r_quanzhou'
    ));
    const fleet = world.fleets.find((candidate) => (
      candidate.polityId === 'p_minhai' && candidate.homePortRegionId === 'r_fuzhou'
    ));
    if (!army || !fleet) throw new Error('expected the Minhai army and Fuzhou fleet fixture');
    // Give the defender one ordinary land-reachable province as a tempting
    // fallback. The explicit island war goal must still drive the operation.
    const landReachableEnemy = world.regions.find((region) => region.id === 'r_zhangzhou');
    const attacker = world.polities.find((polity) => polity.id === 'p_minhai');
    const defender = world.polities.find((polity) => polity.id === 'p_yamato');
    if (!landReachableEnemy || !attacker || !defender) throw new Error('expected the mixed-front fixture');
    landReachableEnemy.controllerId = defender.id;
    attacker.controlledRegionIds = attacker.controlledRegionIds.filter((id) => id !== landReachableEnemy.id);
    if (!defender.controlledRegionIds.includes(landReachableEnemy.id)) {
      defender.controlledRegionIds.push(landReachableEnemy.id);
    }
    army.morale = Math.max(army.morale, 70);
    army.supply = Math.max(army.supply, 70);
    const originalSoldiers = army.soldiers;
    fleet.transports = Math.max(fleet.transports, Math.ceil(army.soldiers / 1_000));
    fleet.warships = Math.max(fleet.warships, 30);
    fleet.morale = Math.max(fleet.morale, 85);
    fleet.readiness = Math.max(fleet.readiness, 90);
    fleet.portRegionId = null;
    fleet.seaZoneId = 'sea_japan_inland';
    fleet.lastMovedTurn = -1;
    world.hash = computeWorldHash(world);

    const orderFacts: Array<{ kind: string; status: string; targetRegionId: string | null }> = [];
    for (let quarter = 0; quarter < 12 && !world.navalOperations.some((operation) => (
      operation.warId === warId && operation.armyId === army.id
    )); quarter += 1) {
      world = advanceWorld(world);
      orderFacts.push(...world.facts.filter((fact) => (
        fact.kind === 'army_order_changed'
        && fact.turn === world.turn - 1
        && fact.payload.armyId === army.id
        && fact.payload.next.warId === warId
      )).map((fact) => ({
        kind: fact.kind === 'army_order_changed' ? fact.payload.next.kind : 'unknown',
        status: fact.kind === 'army_order_changed' ? fact.payload.next.status : 'unknown',
        targetRegionId: fact.kind === 'army_order_changed' ? fact.payload.next.targetRegionId : null,
      })));
    }

    const stagedArmy = world.armies.find((candidate) => candidate.id === army.id);
    const operation = world.navalOperations.find((candidate) => (
      candidate.warId === warId && candidate.armyId === army.id
    ));
    expect(orderFacts).toContainEqual({ kind: 'advance', status: 'active', targetRegionId: 'r_fuzhou' });
    expect(orderFacts.some((order) => (
      order.kind === 'advance' && order.status === 'blocked' && order.targetRegionId === operation?.targetRegionId
    ))).toBe(true);
    expect(operation).toMatchObject({
      warId,
      armyId: army.id,
      originRegionId: 'r_fuzhou',
      targetRegionId: 'r_yamato',
      stage: '集结',
    });
    expect(stagedArmy?.embarkedOperationId).toBe(operation?.id);
    expect(world.fleets.find((candidate) => candidate.id === fleet.id)).toMatchObject({
      portRegionId: operation?.originRegionId,
      seaZoneId: null,
      mission: '登陆',
      targetRegionId: operation?.targetRegionId,
    });
    expect(stagedArmy?.order).toMatchObject({
      kind: 'advance',
      warId,
      targetRegionId: 'r_yamato',
      status: 'active',
      reasonCode: 'amphibious_landing',
    });
    expect(validateWorld(world)).toEqual([]);

    if (!operation) throw new Error('expected the natural landing operation');
    let loadingReport: NonNullable<WorldState['lastTurn']> | undefined;
    const laterStages: string[] = [];
    for (let quarter = 0; quarter < 5 && !loadingReport; quarter += 1) {
      world = advanceWorld(world);
      const currentOperation = world.navalOperations.find((candidate) => candidate.id === operation.id);
      if (!currentOperation) throw new Error('expected the landing operation to remain recorded');
      laterStages.push(currentOperation.stage);
      if (currentOperation.stage === '航行' || currentOperation.stage === '登陆') {
        loadingReport = world.lastTurn ?? undefined;
      }
    }

    expect(laterStages).toContain('装载');
    expect(loadingReport?.logistics.seaUsage.some((usage) => (
      usage.flowIds.includes(`navload:${operation.id}:${loadingReport?.turn}`)
    ))).toBe(true);
    expect(loadingReport?.trade.shipments.some((shipment) => (
      shipment.kind === '海军运输' && shipment.carrierArmyId === army.id
    ))).toBe(false);
    const loadedArmy = world.armies.find((candidate) => candidate.id === army.id);
    expect(loadedArmy?.soldiers).toBeGreaterThanOrEqual(Math.max(1_000, Math.floor(originalSoldiers * 0.35)));
    expect(loadedArmy?.soldiers).toBeLessThanOrEqual(originalSoldiers);
    expect(['航行', '登陆']).toContain(world.navalOperations.find((candidate) => candidate.id === operation.id)?.stage);
    // This is the first finalized world after the navload reservation. The
    // capacity ledger must already be self-contained rather than relying on a
    // later landing Shipment to make the flow reference valid.
    expect(validateWorld(world)).toEqual([]);

    let arrivalShipment: NonNullable<WorldState['lastTurn']>['trade']['shipments'][number] | undefined;
    for (let quarter = 0; quarter < 10 && !arrivalShipment; quarter += 1) {
      world = advanceWorld(world);
      arrivalShipment = world.lastTurn?.trade.shipments.find((shipment) => (
        shipment.kind === '海军运输'
        && shipment.carrierArmyId === army.id
        && shipment.carrierFleetId === fleet.id
        && shipment.originRegionId === 'r_fuzhou'
        && shipment.destinationRegionId === 'r_yamato'
      ));
    }

    expect(arrivalShipment).toMatchObject({
      kind: '海军运输',
      originRegionId: 'r_fuzhou',
      destinationRegionId: 'r_yamato',
      carrierArmyId: army.id,
      carrierFleetId: fleet.id,
      status: '交付',
    });
    expect(arrivalShipment?.peopleDeparted).toBeGreaterThanOrEqual(1_000);
    expect(arrivalShipment?.peopleDeparted).toBe(arrivalShipment?.peopleArrived);
    expect(arrivalShipment?.acceptedAmount).toBe(arrivalShipment?.peopleArrived);
    expect(arrivalShipment?.contactVolume).toBe(arrivalShipment?.peopleArrived);
    expect(arrivalShipment?.legs.length).toBeGreaterThanOrEqual(3);
    expect(arrivalShipment?.legs[0]?.kind).toBe('port-link');
    expect(arrivalShipment?.legs.at(-1)?.kind).toBe('port-link');
    expect(arrivalShipment?.legs.slice(1, -1).some((leg) => leg.kind === 'sea-lane')).toBe(true);
    const resolvedOperation = world.navalOperations.find((candidate) => candidate.id === operation.id);
    expect(['滩头', '失败']).toContain(resolvedOperation?.stage);
    expect(resolvedOperation?.targetRegionId).toBe('r_yamato');
    expect(world.facts.some((fact) => (
      fact.kind === 'battle'
      && fact.turn === world.turn - 1
      && fact.payload.routeId === `naval-operation:${operation.id}`
    ))).toBe(true);
    expect(validateWorld(world)).toEqual([]);
  }, 20_000);

  it('builds a reverse Japan-to-Minhai voyage from its real departure sea and does not land before sailing', () => {
    let world = advanceWorld(createWorld('反向渡海航路朝向'));
    const attackerId = 'p_yamato';
    const defenderId = 'p_minhai';
    const originRegionId = 'r_kanto';
    const targetRegionId = 'r_fuzhou';
    world.navalOperations = [];
    for (const candidate of world.armies) candidate.embarkedOperationId = null;
    const war = addRecordedAmphibiousWar(
      world,
      attackerId,
      defenderId,
      targetRegionId,
      '反向渡海航路回归测试',
    );
    const army = world.armies.find((candidate) => candidate.polityId === attackerId);
    const fleet = world.fleets.find((candidate) => candidate.polityId === attackerId);
    const origin = world.regions.find((region) => region.id === originRegionId);
    if (!army || !fleet || !origin) throw new Error('expected the Yamato reverse-landing fixture');

    for (const candidate of world.armies) {
      if ((candidate.polityId === attackerId || candidate.polityId === defenderId) && candidate.id !== army.id) {
        candidate.morale = 0;
      }
    }
    army.regionId = origin.id;
    army.morale = 84;
    army.supply = 92;
    army.food = Math.max(army.food, army.soldiers * 2);
    army.lastMovedTurn = world.turn - 1;
    army.order = {
      kind: 'advance',
      warId: war.id,
      issuerId: army.commanderId,
      issuedTurn: world.turn - 1,
      lastReviewedTurn: world.turn - 1,
      targetRegionId,
      targetArmyId: null,
      status: 'blocked',
      reasonCode: 'amphibious_landing',
      provenance: 'system',
      sourceFactId: null,
    };
    syncArmyPersonnelLocations(world, army);

    for (const candidate of world.fleets) candidate.lastMovedTurn = world.turn;
    fleet.homePortRegionId = origin.id;
    fleet.portRegionId = origin.id;
    fleet.seaZoneId = null;
    fleet.mission = '运输';
    fleet.targetRegionId = origin.id;
    fleet.targetSeaZoneId = null;
    fleet.transports = Math.max(fleet.transports, Math.ceil(army.soldiers / 1_000));
    fleet.warships = Math.max(fleet.warships, 100);
    fleet.patrolShips = Math.max(fleet.patrolShips, 24);
    fleet.sailors = Math.max(fleet.sailors, 10_000);
    fleet.food = Math.max(fleet.food, fleet.sailors * 2);
    fleet.morale = 94;
    fleet.training = 94;
    fleet.readiness = 100;
    fleet.lastMovedTurn = world.turn - 1;
    const fleetCommander = world.characters.find((character) => character.id === fleet.commanderId);
    if (fleetCommander) fleetCommander.locationRegionId = origin.id;
    origin.food = Math.max(origin.food, army.soldiers * 3);
    world.hash = computeWorldHash(world);

    world = advanceWorld(world);
    const operation = world.navalOperations.find((candidate) => (
      candidate.warId === war.id && candidate.armyId === army.id
    ));
    expect(operation).toMatchObject({
      originRegionId,
      targetRegionId,
      stage: '集结',
      seaZonePath: ['sea_east_ocean', 'sea_fujian'],
    });
    expect(world.fleets.find((candidate) => candidate.id === fleet.id)).toMatchObject({
      portRegionId: originRegionId,
      seaZoneId: null,
    });
    if (!operation) throw new Error('expected the reverse landing operation');

    let firstSailingWorld: WorldState | null = null;
    for (let quarter = 0; quarter < 4 && !firstSailingWorld; quarter += 1) {
      world = advanceWorld(world);
      const current = world.navalOperations.find((candidate) => candidate.id === operation.id);
      if (current?.stage === '航行' || current?.stage === '登陆') firstSailingWorld = world;
    }
    if (!firstSailingWorld) throw new Error('expected the reverse operation to begin sailing');
    const firstSailingOperation = firstSailingWorld.navalOperations.find(
      (candidate) => candidate.id === operation.id,
    );
    expect(firstSailingOperation?.stage).toBe('航行');
    expect(firstSailingWorld.fleets.find((candidate) => candidate.id === fleet.id)).toMatchObject({
      portRegionId: null,
      seaZoneId: 'sea_east_ocean',
      targetSeaZoneId: 'sea_fujian',
    });
    expect(firstSailingWorld.lastTurn?.trade.shipments.some((shipment) => (
      shipment.kind === '海军运输' && shipment.carrierArmyId === army.id
    ))).toBe(false);
    expect(firstSailingWorld.facts.some((fact) => (
      fact.kind === 'battle'
      && fact.turn === firstSailingWorld.turn - 1
      && fact.payload.routeId === `naval-operation:${operation.id}`
    ))).toBe(false);
    expect(validateWorld(firstSailingWorld)).toEqual([]);
  }, 20_000);

  it('fails an in-flight landing when the remaining transports can no longer carry its army and orders the fleet home', () => {
    let world = advanceWorld(createWorld('登陆航行运力跌破'));
    const fixture = stageInFlightLanding(world, 'r_yamato', ['sea_fujian', 'sea_east_ocean']);
    const armyBefore = world.armies.find((army) => army.id === fixture.armyId);
    const fleetBefore = world.fleets.find((fleet) => fleet.id === fixture.fleetId);
    if (!armyBefore || !fleetBefore) throw new Error('expected the in-flight landing force');

    const loadedSoldiers = armyBefore.soldiers;
    const capacityBeforeLoss = fleetBefore.transports * 1_000;
    expect(capacityBeforeLoss).toBeGreaterThanOrEqual(loadedSoldiers);
    // Model a storm loss after the manifest has closed. The next voyage tick
    // must not let soldiers in excess of the remaining hulls travel for free.
    fleetBefore.transports = Math.max(0, Math.ceil(loadedSoldiers / 1_000) - 1);
    expect(fleetBefore.transports * 1_000).toBeLessThan(loadedSoldiers);
    world.hash = computeWorldHash(world);

    world = advanceWorld(world);

    const failedOperation = world.navalOperations.find((operation) => operation.id === fixture.operationId);
    const returnedArmy = world.armies.find((army) => army.id === fixture.armyId);
    const returningFleet = world.fleets.find((fleet) => fleet.id === fixture.fleetId);
    expect(failedOperation).toMatchObject({ stage: '失败', foodLoaded: 0 });
    expect(failedOperation?.completedTurn).toBe(world.turn - 1);
    expect(returnedArmy).toMatchObject({
      regionId: fixture.originRegionId,
      embarkedOperationId: null,
    });
    expect(returningFleet).toMatchObject({
      mission: '避战',
      targetRegionId: fixture.originRegionId,
      targetSeaZoneId: 'sea_fujian',
    });
    expect(world.history.some((event) => (
      event.turn === world.turn - 1
      && event.kind === 'amphibious_voyage_failed'
      && (event.summary.includes('运力') || event.summary.includes('运输'))
    ))).toBe(true);
    expect(validateWorld(world)).toEqual([]);
  }, 20_000);

  it('records the four-percent voyage loss against the frozen manifest when an in-flight landing turns back', () => {
    let world = advanceWorld(createWorld('登陆航行受阻返程账'));
    const fixture = stageInFlightLanding(world, 'r_yamato', ['sea_fujian', 'sea_east_ocean']);
    const operationBeforeFailure = world.navalOperations.find(
      (operation) => operation.id === fixture.operationId,
    );
    const armyBeforeFailure = world.armies.find((army) => army.id === fixture.armyId);
    const fleetBeforeFailure = world.fleets.find((fleet) => fleet.id === fixture.fleetId);
    if (!operationBeforeFailure?.manifest || !armyBeforeFailure || !fleetBeforeFailure) {
      throw new Error('expected a manifested landing force already at sea');
    }

    const manifest = structuredClone(operationBeforeFailure.manifest);
    const soldiersAtFailure = armyBeforeFailure.soldiers;
    const expectedTurnbackLoss = Math.min(
      Math.max(0, soldiersAtFailure - 1),
      Math.floor(soldiersAtFailure * 0.04),
    );
    fleetBeforeFailure.transports = Math.max(0, Math.ceil(soldiersAtFailure / 1_000) - 1);
    expect(fleetBeforeFailure.transports * 1_000).toBeLessThan(soldiersAtFailure);
    world.hash = computeWorldHash(world);

    world = advanceWorld(world);

    const failedOperation = world.navalOperations.find(
      (operation) => operation.id === fixture.operationId,
    );
    const turnbackShipment = world.lastTurn?.trade.shipments.find((shipment) => (
      shipment.kind === '海军运输'
      && shipment.carrierArmyId === fixture.armyId
    ));
    expect(failedOperation).toMatchObject({
      stage: '失败',
      manifest,
    });
    expect(turnbackShipment).toBeDefined();
    const arrived = turnbackShipment?.peopleArrived ?? 0;
    const lost = turnbackShipment?.peopleLost ?? 0;
    expect(lost).toBe(expectedTurnbackLoss);
    expect(manifest.soldiersDeparted).toBe(arrived + lost);
    expect(turnbackShipment).toMatchObject({
      acceptedAmount: manifest.soldiersDeparted,
      deliveredAmount: arrived,
      lostAmount: expectedTurnbackLoss,
      raidedAmount: 0,
      peopleDeparted: manifest.soldiersDeparted,
      peopleArrived: arrived,
      peopleLost: expectedTurnbackLoss,
      status: '受损',
    });
    expect(turnbackShipment?.legs.map((leg) => leg.edgeId)).toEqual(manifest.transportEdgeIds);
    expect(world.history.some((event) => (
      event.turn === world.turn - 1
      && event.kind === 'amphibious_voyage_failed'
    ))).toBe(true);
    expect(validateWorld(world)).toEqual([]);
  }, 20_000);

  it('orders every surviving carrier home after a partial-fleet abort and eventually docks it at the origin', () => {
    let world = advanceWorld(createWorld('登陆承运舰队缺失返港'));
    const fixture = stageInFlightLanding(
      world,
      'r_naniwa',
      ['sea_fujian', 'sea_east_ocean', 'sea_japan_inland'],
    );
    const operationBeforeAbort = world.navalOperations.find(
      (operation) => operation.id === fixture.operationId,
    );
    if (!operationBeforeAbort) throw new Error('expected an in-flight landing operation');

    // One carrier has disappeared from the authoritative fleet collection while
    // another still survives at sea. This must take the common abort path, then
    // preserve a concrete return order for every carrier that still exists.
    operationBeforeAbort.fleetIds.push('fleet_missing_abort_regression');
    world.hash = computeWorldHash(world);

    world = advanceWorld(world);

    const abortedOperation = world.navalOperations.find(
      (operation) => operation.id === fixture.operationId,
    );
    expect(abortedOperation).toMatchObject({
      stage: '失败',
      completedTurn: world.turn - 1,
    });
    expect(world.history.some((event) => (
      event.turn === world.turn - 1
      && event.kind === 'naval_operation_aborted'
    ))).toBe(true);
    expect(world.history.some((event) => (
      event.turn === world.turn - 1
      && event.kind === 'amphibious_voyage_failed'
    ))).toBe(false);

    const survivingCarriers = (abortedOperation?.fleetIds ?? [])
      .map((fleetId) => world.fleets.find((fleet) => fleet.id === fleetId))
      .filter((fleet): fleet is WorldState['fleets'][number] => Boolean(fleet));
    expect(survivingCarriers).toHaveLength(1);
    for (const fleet of survivingCarriers) {
      expect(fleet).toMatchObject({
        mission: '避战',
        targetRegionId: fixture.originRegionId,
        targetSeaZoneId: 'sea_fujian',
      });
    }

    for (let quarter = 0; quarter < 6; quarter += 1) {
      const allDocked = survivingCarriers.every((carrier) => (
        world.fleets.find((fleet) => fleet.id === carrier.id)?.portRegionId === fixture.originRegionId
      ));
      if (allDocked) break;
      world = advanceWorld(world);
    }
    for (const carrier of survivingCarriers) {
      expect(world.fleets.find((fleet) => fleet.id === carrier.id)).toMatchObject({
        portRegionId: fixture.originRegionId,
        seaZoneId: null,
      });
    }
    expect(validateWorld(world)).toEqual([]);
  }, 20_000);

  it('moves an amphibious carrier through the declared sea-zone path one zone per quarter', () => {
    let world = advanceWorld(createWorld('登陆既定航路逐段推进'));
    const fixture = stageInFlightLanding(
      world,
      'r_naniwa',
      ['sea_fujian', 'sea_east_ocean', 'sea_japan_inland'],
    );
    const foodLoadedBeforeSailing = world.navalOperations.find(
      (operation) => operation.id === fixture.operationId,
    )?.foodLoaded;
    expect(foodLoadedBeforeSailing).toBeGreaterThan(0);

    world = advanceWorld(world);
    expect(world.fleets.find((fleet) => fleet.id === fixture.fleetId)?.seaZoneId).toBe('sea_east_ocean');
    expect(world.navalOperations.find((operation) => operation.id === fixture.operationId)).toMatchObject({
      stage: '航行',
      targetRegionId: 'r_naniwa',
    });
    expect(world.navalOperations.find(
      (operation) => operation.id === fixture.operationId,
    )?.foodLoaded).toBeLessThan(foodLoadedBeforeSailing as number);

    world = advanceWorld(world);
    expect(world.fleets.find((fleet) => fleet.id === fixture.fleetId)?.seaZoneId).toBe('sea_japan_inland');
    expect(world.navalOperations.find((operation) => operation.id === fixture.operationId)).toMatchObject({
      stage: '登陆',
      targetRegionId: 'r_naniwa',
    });
    expect(validateWorld(world)).toEqual([]);
  }, 20_000);

  it('moves the defender capital through canonical conquest settlement after a landing', () => {
    let world = advanceWorld(createWorld('登陆攻陷首府迁都'));
    const targetRegionId = 'r_yamato';
    const fixture = stageInFlightLanding(world, targetRegionId, ['sea_fujian', 'sea_east_ocean']);
    const fleet = world.fleets.find((candidate) => candidate.id === fixture.fleetId);
    const defender = world.polities.find((polity) => polity.id === 'p_yamato');
    if (!fleet || !defender) throw new Error('expected the capital-landing fixture');
    fleet.warships = Math.max(fleet.warships, 5_000);
    world.hash = computeWorldHash(world);

    for (let quarter = 0; quarter < 4 && world.regions.find((region) => region.id === targetRegionId)?.controllerId !== 'p_minhai'; quarter += 1) {
      world = advanceWorld(world);
    }

    const settledDefender = world.polities.find((polity) => polity.id === defender.id);
    expect(world.regions.find((region) => region.id === targetRegionId)?.controllerId).toBe('p_minhai');
    expect(settledDefender?.alive).toBe(true);
    expect(settledDefender?.capitalRegionId).not.toBe(targetRegionId);
    expect(settledDefender?.controlledRegionIds).toContain(settledDefender?.capitalRegionId);
    expect(world.history.some((event) => (
      event.kind === 'capital_fall'
      && event.polityIds.includes(defender.id)
      && event.regionIds.includes(targetRegionId)
    ))).toBe(true);
    expect(world.facts.some((fact) => (
      fact.kind === 'territory_control_changed'
      && fact.payload.regionId === targetRegionId
      && fact.payload.reason === 'amphibious_landing'
    ))).toBe(true);
    expect(validateWorld(world)).toEqual([]);
  }, 20_000);

  it('eliminates a defender whose last territory falls to a landing', () => {
    let world = advanceWorld(createWorld('登陆攻陷末区灭国'));
    const targetRegionId = 'r_yamato';
    const defender = world.polities.find((polity) => polity.id === 'p_yamato');
    const attacker = world.polities.find((polity) => polity.id === 'p_minhai');
    if (!defender || !attacker) throw new Error('expected the final-territory landing fixture');
    for (const region of world.regions.filter((candidate) => (
      candidate.controllerId === defender.id && candidate.id !== targetRegionId
    ))) region.controllerId = attacker.id;
    defender.controlledRegionIds = [targetRegionId];
    attacker.controlledRegionIds = world.regions
      .filter((region) => region.controllerId === attacker.id)
      .map((region) => region.id)
      .sort();
    const fixture = stageInFlightLanding(world, targetRegionId, ['sea_fujian', 'sea_east_ocean']);
    const fleet = world.fleets.find((candidate) => candidate.id === fixture.fleetId);
    if (!fleet) throw new Error('expected the final-territory carrier');
    fleet.warships = Math.max(fleet.warships, 5_000);
    world.hash = computeWorldHash(world);

    for (let quarter = 0; quarter < 4 && world.polities.find((polity) => polity.id === defender.id)?.alive; quarter += 1) {
      world = advanceWorld(world);
    }

    const settledDefender = world.polities.find((polity) => polity.id === defender.id);
    expect(settledDefender).toMatchObject({ alive: false, capitalRegionId: null, controlledRegionIds: [] });
    expect(settledDefender?.eliminatedTurn).not.toBeNull();
    expect(world.regions.some((region) => region.controllerId === defender.id)).toBe(false);
    expect(world.armies.some((army) => army.polityId === defender.id)).toBe(false);
    expect(world.fleets.some((candidate) => candidate.polityId === defender.id)).toBe(false);
    expect(world.wars.find((war) => war.id === fixture.warId)?.active).toBe(false);
    expect(world.navalOperations.find((operation) => operation.id === fixture.operationId)).toMatchObject({
      stage: '完成',
      completedTurn: settledDefender?.eliminatedTurn,
    });
    expect(world.history.some((event) => event.kind === 'polity_eliminated' && event.polityIds.includes(defender.id))).toBe(true);
    expect(validateWorld(world)).toEqual([]);
  }, 20_000);

  it('records voyage attrition against the frozen loading manifest when the surviving army lands', () => {
    let world = advanceWorld(createWorld('登陆途中减员运输账'));
    const fixture = stageInFlightLanding(
      world,
      'r_naniwa',
      ['sea_fujian', 'sea_east_ocean', 'sea_japan_inland'],
    );
    const operationBeforeLoss = world.navalOperations.find(
      (operation) => operation.id === fixture.operationId,
    );
    const armyBeforeLoss = world.armies.find((army) => army.id === fixture.armyId);
    const landingDefender = world.armies.find((army) => army.polityId === 'p_yamato');
    if (!operationBeforeLoss?.manifest || !armyBeforeLoss) {
      throw new Error('expected a frozen loading manifest and its embarked army');
    }
    if (!landingDefender) throw new Error('expected a defending Yamato army');
    landingDefender.regionId = 'r_naniwa';
    landingDefender.soldiers = Math.max(landingDefender.soldiers, 60_000);
    landingDefender.food = Math.max(landingDefender.food, landingDefender.soldiers * 2);
    landingDefender.morale = 5;
    syncArmyPersonnelLocations(world, landingDefender);
    const loadedTurn = operationBeforeLoss.manifest.loadedTurn;
    const soldiersDeparted = operationBeforeLoss.manifest.soldiersDeparted;
    const transportEdgeIds = [...operationBeforeLoss.manifest.transportEdgeIds];
    const recordedTransitLoss = Math.min(173, Math.max(1, soldiersDeparted - 1_000));
    armyBeforeLoss.soldiers -= recordedTransitLoss;

    // This deterministic fixture represents disease/attrition already settled
    // during the voyage. Keep every pathogen host synchronized with the army
    // snapshot while leaving the loading manifest immutable.
    for (const infection of world.infections.filter((state) => (
      state.hostKind === 'army' && state.hostId === armyBeforeLoss.id
    ))) {
      let remaining = recordedTransitLoss;
      for (const field of ['infectious', 'exposed', 'susceptible', 'recovered'] as const) {
        const removed = Math.min(infection[field], remaining);
        infection[field] -= removed;
        remaining -= removed;
      }
      expect(remaining).toBe(0);
    }
    expect(armyBeforeLoss.soldiers).toBe(soldiersDeparted - recordedTransitLoss);
    expect(operationBeforeLoss.manifest).toEqual({
      loadedTurn,
      soldiersDeparted,
      transportEdgeIds,
    });
    world.hash = computeWorldHash(world);

    let arrivalShipment: NonNullable<WorldState['lastTurn']>['trade']['shipments'][number] | undefined;
    for (let quarter = 0; quarter < 5 && !arrivalShipment; quarter += 1) {
      world = advanceWorld(world);
      arrivalShipment = world.lastTurn?.trade.shipments.find((shipment) => (
        shipment.kind === '海军运输'
        && shipment.carrierArmyId === fixture.armyId
        && shipment.originRegionId === fixture.originRegionId
        && shipment.destinationRegionId === 'r_naniwa'
      ));
    }

    expect(arrivalShipment).toBeDefined();
    const arrived = arrivalShipment?.peopleArrived ?? 0;
    const voyageLosses = soldiersDeparted - arrived;
    expect(arrived).toBeLessThan(soldiersDeparted);
    expect(voyageLosses).toBeGreaterThanOrEqual(recordedTransitLoss);
    expect(arrivalShipment).toMatchObject({
      acceptedAmount: soldiersDeparted,
      deliveredAmount: arrived,
      lostAmount: voyageLosses,
      raidedAmount: 0,
      peopleDeparted: soldiersDeparted,
      peopleArrived: arrived,
      peopleLost: voyageLosses,
      status: '受损',
    });
    expect(arrivalShipment?.legs.map((leg) => leg.edgeId)).toEqual(transportEdgeIds);
    expect(world.navalOperations.find(
      (operation) => operation.id === fixture.operationId,
    )?.manifest).toEqual({ loadedTurn, soldiersDeparted, transportEdgeIds });
    expect(validateWorld(world)).toEqual([]);
  }, 20_000);

  it('ends an under-capacity loading attempt with a concrete failure and frees the army', () => {
    let world = createWorld('登陆运力不足');
    world.navalOperations = [];
    for (const candidate of world.armies) candidate.embarkedOperationId = null;
    world.wars = world.wars.filter((war) => (
      war.attackerId !== 'p_minhai' && war.defenderId !== 'p_minhai'
      && war.attackerId !== 'p_yamato' && war.defenderId !== 'p_yamato'
    ));
    world.counters.war += 1;
    const warId = `war_${String(world.counters.war).padStart(4, '0')}`;
    const war: WarState = {
      id: warId,
      kind: 'interstate',
      attackerId: 'p_minhai',
      defenderId: 'p_yamato',
      startedTurn: world.turn,
      endedTurn: null,
      active: true,
      attackerScore: 0,
      defenderScore: 0,
      reason: '运力不足回归测试',
      lastBattleTurn: -100,
      goal: '霸权',
      targetRegionIds: ['r_yamato'],
      exhaustion: 0,
    };
    world.wars.push(war);
    emitSimulationFact(world, factContext(world), {
      kind: 'war_started',
      category: '外交',
      importance: 4,
      actorIds: world.polities
        .filter((polity) => polity.id === war.attackerId || polity.id === war.defenderId)
        .map((polity) => polity.rulerId),
      polityIds: [war.attackerId, war.defenderId],
      regionIds: [...war.targetRegionIds],
      causes: [{ label: '测试战端', role: '触发', weight: 1, evidence: war.reason }],
      stateDeltas: [{ entityType: 'war', entityId: war.id, field: 'active', before: false, after: true }],
      sourceFactIds: [],
      payload: {
        warId: war.id,
        warKind: war.kind,
        attackerId: war.attackerId,
        defenderId: war.defenderId,
        goal: war.goal,
        targetRegionIds: [...war.targetRegionIds],
        reason: war.reason,
      },
    });
    const army = world.armies.find((candidate) => candidate.polityId === 'p_minhai');
    const fleet = world.fleets.find((candidate) => candidate.polityId === 'p_minhai' && candidate.homePortRegionId === 'r_fuzhou');
    const origin = world.regions.find((region) => region.id === 'r_fuzhou');
    if (!army || !fleet || !origin) throw new Error('expected the Minhai loading fixture');
    army.regionId = origin.id;
    army.lastMovedTurn = world.turn - 1;
    army.order = {
      kind: 'advance',
      warId,
      issuerId: army.commanderId,
      issuedTurn: world.turn - 1,
      lastReviewedTurn: world.turn - 1,
      targetRegionId: 'r_yamato',
      targetArmyId: null,
      status: 'active',
      reasonCode: 'amphibious_landing',
      provenance: 'system',
      sourceFactId: null,
    };
    syncArmyPersonnelLocations(world, army);
    fleet.portRegionId = origin.id;
    fleet.seaZoneId = null;
    fleet.transports = 0;
    const foodLoaded = 2_000;
    origin.food = Math.max(origin.food, foodLoaded);
    origin.food -= foodLoaded;
    world.counters.navalOperation += 1;
    const operationId = `navop_${String(world.counters.navalOperation).padStart(5, '0')}`;
    world.navalOperations.push({
      id: operationId,
      warId,
      armyId: army.id,
      fleetIds: [fleet.id],
      originRegionId: origin.id,
      targetRegionId: 'r_yamato',
      seaZonePath: ['sea_fujian', 'sea_east_ocean'],
      stage: '装载',
      startedTurn: world.turn,
      progress: 45,
      foodLoaded,
      manifest: null,
      completedTurn: null,
    });
    army.embarkedOperationId = operationId;
    world.hash = computeWorldHash(world);

    let next = world;
    for (let quarter = 0; quarter < 7; quarter += 1) {
      const currentOperation = next.navalOperations.find((operation) => operation.id === operationId);
      if (currentOperation?.stage === '失败') break;
      next = advanceWorld(next);
    }
    const failedOperation = next.navalOperations.find((operation) => operation.id === operationId);
    expect(failedOperation).toMatchObject({
      stage: '失败',
      foodLoaded: 0,
    });
    expect(failedOperation?.completedTurn).toBeGreaterThanOrEqual(5);
    expect(next.armies.find((candidate) => candidate.id === army.id)?.embarkedOperationId).toBeNull();
    expect(next.navalOperations.some((operation) => (
      operation.id !== operationId
      && operation.armyId === army.id
      && operation.stage !== '完成'
      && operation.stage !== '失败'
    ))).toBe(false);
    expect(next.history.some((event) => (
      event.turn === failedOperation?.completedTurn
      && event.kind === 'amphibious_loading_failed'
      && event.summary.includes('实际可用运力仅')
    ))).toBe(true);
    expect(validateWorld(next)).toEqual([]);
  }, 20_000);

  it('migrates schema-4 armies missing the new fields without fabricating facts or history', () => {
    const source = createWorld('旧档军权迁移');
    const legacy = JSON.parse(serializeWorld(source)) as Record<string, unknown>;
    const armies = legacy.armies as Array<Record<string, unknown>>;
    for (const army of armies) {
      delete army.allegiance;
      delete army.retinues;
      delete army.order;
      delete army.recentMovement;
    }
    legacy.hash = computeWorldHash(legacy as unknown as WorldState);

    const restored = deserializeWorld(JSON.stringify(legacy));

    expect(restored.facts).toEqual(source.facts);
    expect(restored.history).toEqual(source.history);
    expect(restored.factDigest).toBe(source.factDigest);
    expect(restored.historyDigest).toBe(source.historyDigest);
    expect(restored.counters.fact).toBe(source.counters.fact);
    expect(restored.armies.every((army) => (
      army.allegiance.provenance === 'legacy'
      && army.order.provenance === 'legacy'
      && army.order.sourceFactId === null
      && army.retinues.every((retinue) => retinue.sourceFactId === null)
      && army.recentMovement === null
    ))).toBe(true);
  });

  it('keeps prior actual allegiance through repeated lawful commander swaps', () => {
    const world = createWorld('军权不随印信往返');
    const army = world.armies[0];
    if (!army) throw new Error('expected an opening army');
    const firstCommanderId = army.commanderId;
    const secondCommander = world.characters.find((character) => (
      character.alive && character.polityId === army.polityId && character.id !== firstCommanderId
    ));
    if (!secondCommander) throw new Error('expected a second eligible officer');
    const originalSinceTurn = army.allegiance.sinceTurn;

    army.commanderId = secondCommander.id;
    army.deputyCommanderId = firstCommanderId;
    markLawfulCommandTransfer(world, army, firstCommanderId, 'fact_command_swap_1');
    expect(army.allegiance).toMatchObject({
      characterId: firstCommanderId,
      provenance: 'fact',
      sourceFactId: 'fact_command_swap_1',
      sinceTurn: originalSinceTurn,
    });

    army.commanderId = firstCommanderId;
    army.deputyCommanderId = secondCommander.id;
    markLawfulCommandTransfer(world, army, secondCommander.id, 'fact_command_swap_2');
    expect(army.allegiance).toMatchObject({
      characterId: firstCommanderId,
      provenance: 'fact',
      sourceFactId: 'fact_command_swap_2',
      sinceTurn: originalSinceTurn,
    });
  });

  it('reissues one unchanged-front order under the new lawful commander while embarked', () => {
    const world = createWorld('登陆军令重署');
    const war = addReachableBorderWar(world);
    const context = factContext(world);
    const army = world.armies.find((candidate) => candidate.polityId === war.attackerId);
    if (!army) throw new Error('expected an attacking army on the new front');
    issueAmphibiousArmyOrder(world, context, army, war.id, war.targetRegionIds[0] as string);
    army.embarkedOperationId = 'navop_order_resign_regression';
    planArmyOrders(world, context);
    expect(army.order.warId).toBe(war.id);
    expect(army.order.kind).not.toBe('hold');
    const replacement = world.characters.find((character) => (
      character.alive && character.polityId === army.polityId && character.id !== army.commanderId
    ));
    if (!replacement) throw new Error('expected a replacement lawful commander');
    const previousCommanderId = army.commanderId;
    const previousOrder = { ...army.order };
    army.commanderId = replacement.id;
    army.deputyCommanderId = previousCommanderId;
    markLawfulCommandTransfer(world, army, previousCommanderId, 'fact_embarked_command_transfer');
    const factCountBeforeResign = world.facts.length;

    planArmyOrders(world, context);

    const resignFacts = world.facts.slice(factCountBeforeResign).filter((fact) => fact.kind === 'army_order_changed');
    expect(resignFacts).toHaveLength(1);
    expect(resignFacts[0]).toMatchObject({
      kind: 'army_order_changed',
      payload: {
        armyId: army.id,
        previous: {
          issuerId: previousCommanderId,
          warId: previousOrder.warId,
          kind: previousOrder.kind,
          targetRegionId: previousOrder.targetRegionId,
          targetArmyId: previousOrder.targetArmyId,
        },
        next: {
          issuerId: replacement.id,
          warId: previousOrder.warId,
          kind: previousOrder.kind,
          targetRegionId: previousOrder.targetRegionId,
          targetArmyId: previousOrder.targetArmyId,
        },
      },
    });
    expect(army.embarkedOperationId).toBe('navop_order_resign_regression');
    expect(army.order.sourceFactId).toBe(resignFacts[0]?.id);
  });

  it('restores a legacy amphibious order from an unfinished naval operation without inventing records', () => {
    let source = createWorld('旧档登陆军令迁移');
    for (let quarter = 0; quarter < 16 && !source.wars.some((war) => war.active); quarter += 1) {
      source = advanceWorld(source);
    }
    const war = source.wars.find((candidate) => candidate.active);
    if (!war) throw new Error('expected a live war for the legacy landing fixture');
    const army = source.armies.find((candidate) => (
      !candidate.embarkedOperationId
      && (candidate.polityId === war.attackerId || candidate.polityId === war.defenderId)
    ));
    if (!army) throw new Error('expected an available belligerent army');
    const enemyId = army.polityId === war.attackerId ? war.defenderId : war.attackerId;
    const target = source.regions.find((region) => region.controllerId === enemyId && region.port)
      ?? source.regions.find((region) => region.controllerId === enemyId);
    if (!target) throw new Error('expected an enemy landing target');
    source.counters.navalOperation += 1;
    const operationId = `navop_${String(source.counters.navalOperation).padStart(5, '0')}`;
    source.navalOperations.push({
      id: operationId,
      warId: war.id,
      armyId: army.id,
      fleetIds: [],
      originRegionId: army.regionId,
      targetRegionId: target.id,
      seaZonePath: [],
      stage: '集结',
      startedTurn: source.turn,
      progress: 0,
      foodLoaded: 0,
      manifest: null,
      completedTurn: null,
    });
    army.embarkedOperationId = operationId;
    const sourceFacts = structuredClone(source.facts);
    const sourceHistory = structuredClone(source.history);
    const sourceCounters = { ...source.counters };
    const legacy = JSON.parse(serializeWorld(source)) as Record<string, unknown>;
    const rawArmy = (legacy.armies as Array<Record<string, unknown>>)
      .find((candidate) => candidate.id === army.id);
    const rawOperation = (legacy.navalOperations as Array<Record<string, unknown>>)
      .find((candidate) => candidate.id === operationId);
    if (!rawArmy || !rawOperation) throw new Error('expected the embarked army and operation in the serialized fixture');
    delete rawArmy.allegiance;
    delete rawArmy.retinues;
    delete rawArmy.order;
    delete rawOperation.manifest;
    legacy.hash = computeWorldHash(legacy as unknown as WorldState);

    const restored = deserializeWorld(JSON.stringify(legacy));
    const restoredArmy = restored.armies.find((candidate) => candidate.id === army.id);

    expect(restoredArmy?.allegiance.provenance).toBe('legacy');
    expect(restoredArmy?.retinues.every((retinue) => retinue.sourceFactId === null)).toBe(true);
    expect(restoredArmy?.order).toMatchObject({
      kind: 'advance',
      warId: war.id,
      targetRegionId: target.id,
      targetArmyId: null,
      status: 'active',
      reasonCode: 'amphibious_landing',
      provenance: 'legacy',
      sourceFactId: null,
    });
    expect(restored.navalOperations.find((operation) => operation.id === operationId)?.manifest).toBeNull();
    expect(restored.facts).toEqual(sourceFacts);
    expect(restored.history).toEqual(sourceHistory);
    expect(restored.counters).toEqual(sourceCounters);
    expect(validateWorld(restored)).toEqual([]);
  }, 15_000);

  it('executes an unchanged advance order in a later quarter without reissuing it', () => {
    let world = createWorld('军令跨季行军');
    let witnessed: {
      armyId: string;
      fromRegionId: string;
      toRegionId: string;
      sourceFactId: string;
      movementTurn: number;
      movementWarId: string | null;
    } | null = null;

    for (let quarter = 0; quarter < 48 && !witnessed; quarter += 1) {
      const previous = world;
      const next = advanceWorld(previous);
      const orderFactsThisQuarter = next.facts.filter((fact) => (
        fact.turn === previous.turn && fact.kind === 'army_order_changed'
      ));
      for (const before of previous.armies) {
        const after = next.armies.find((candidate) => candidate.id === before.id);
        if (!after
          || before.regionId === after.regionId
          || before.order.kind === 'hold'
          || before.order.status !== 'active'
          || !before.order.sourceFactId
          || before.order.issuedTurn >= previous.turn
          || after.order.sourceFactId !== before.order.sourceFactId
          || orderFactsThisQuarter.some((fact) => (
            fact.kind === 'army_order_changed' && fact.payload.armyId === before.id
          ))) continue;
        witnessed = {
          armyId: before.id,
          fromRegionId: before.regionId,
          toRegionId: after.regionId,
          sourceFactId: before.order.sourceFactId,
          movementTurn: after.recentMovement?.turn ?? -1,
          movementWarId: after.recentMovement?.warId ?? null,
        };
        expect(after.recentMovement).toMatchObject({
          fromRegionId: before.regionId,
          toRegionId: after.regionId,
          turn: previous.turn,
          orderKind: before.order.kind,
          warId: before.order.warId,
        });
        break;
      }
      world = next;
    }

    expect(witnessed).toMatchObject({
      armyId: expect.any(String),
      fromRegionId: expect.any(String),
      toRegionId: expect.any(String),
      sourceFactId: expect.stringMatching(/^fact_/),
      movementTurn: expect.any(Number),
      movementWarId: expect.any(String),
    });
    expect(witnessed?.fromRegionId).not.toBe(witnessed?.toRegionId);
  }, 20_000);

  it('withdraws surviving armies to hold orders in the same quarter their sole war ends', () => {
    let world = createWorld('停战当季收令');
    let endedWarId: string | null = null;

    for (let quarter = 0; quarter < 48 && !endedWarId; quarter += 1) {
      const candidate = world.wars.find((war) => (
        war.active
        && world.turn - war.startedTurn >= 11
        && world.wars.filter((other) => other.active && other.id !== war.id && (
          other.attackerId === war.attackerId || other.defenderId === war.attackerId
          || other.attackerId === war.defenderId || other.defenderId === war.defenderId
        )).length === 0
      ));
      if (!candidate) {
        world = advanceWorld(world);
        continue;
      }
      const relevantArmyIds = world.armies.filter((army) => (
        !army.embarkedOperationId && army.order.warId === candidate.id
      )).map((army) => army.id);
      const attacker = world.polities.find((polity) => polity.id === candidate.attackerId);
      const defender = world.polities.find((polity) => polity.id === candidate.defenderId);
      if (attacker) attacker.warWeariness = 100;
      if (defender) defender.warWeariness = 100;
      const next = advanceWorld(world);
      const ended = next.wars.find((war) => war.id === candidate.id);
      if (!ended || ended.active || relevantArmyIds.length === 0) {
        world = next;
        continue;
      }
      const survivors = relevantArmyIds.flatMap((armyId) => {
        const army = next.armies.find((item) => item.id === armyId);
        return army ? [army] : [];
      });
      expect(survivors.length).toBeGreaterThan(0);
      for (const army of survivors) {
        expect(army.order).toMatchObject({
          kind: 'hold',
          warId: null,
          targetRegionId: army.regionId,
          issuedTurn: ended.endedTurn,
        });
        const orderFact = next.facts.find((fact) => (
          fact.kind === 'army_order_changed'
          && fact.turn === ended.endedTurn
          && fact.payload.armyId === army.id
          && fact.payload.next.kind === 'hold'
        ));
        expect(orderFact?.id).toBe(army.order.sourceFactId);
      }
      expect(next.facts.some((fact) => (
        fact.kind === 'war_ended' && fact.payload.warId === candidate.id && fact.turn === ended.endedTurn
      ))).toBe(true);
      expect(validateWorld(next)).toEqual([]);
      endedWarId = candidate.id;
      world = next;
    }

    expect(endedWarId).toMatch(/^war_/);
  }, 30_000);

  it('keeps only bounded live order references after long-running order churn and archive compaction', () => {
    const world = createWorld('军令冷档案上界');
    const army = world.armies[0];
    const alternateRegion = world.regions.find((region) => region.id !== army?.regionId);
    if (!army || !alternateRegion) throw new Error('expected an army and an alternate valid region');
    const generatedOrderFactIds: string[] = [];

    for (let turn = 1; turn <= 128; turn += 1) {
      const date = getDateForTurn(turn);
      world.turn = turn;
      world.year = date.year;
      world.season = date.season;
      army.order.targetRegionId = alternateRegion.id;
      const context = factContext(world);
      planArmyOrders(world, context);
      const issued = context.facts.filter((fact) => fact.kind === 'army_order_changed');
      expect(issued).toHaveLength(1);
      generatedOrderFactIds.push(issued[0]?.id as string);
    }
    const finalDate = getDateForTurn(129);
    world.turn = 129;
    world.year = finalDate.year;
    world.season = finalDate.season;
    const currentOrderSources = world.armies.flatMap((candidate) => (
      candidate.order.sourceFactId ? [candidate.order.sourceFactId] : []
    ));
    expect(currentOrderSources.length).toBeLessThanOrEqual(world.armies.length);
    expect(currentOrderSources).toContain(generatedOrderFactIds.at(-1));
    expect(collectReferencedFactIds(world)).toContain(generatedOrderFactIds.at(-1) as string);

    compactWorldArchive(world);

    const residentOrderFacts = world.facts.filter((fact) => fact.kind === 'army_order_changed');
    expect(generatedOrderFactIds).toHaveLength(128);
    expect(residentOrderFacts.length).toBeLessThan(generatedOrderFactIds.length);
    expect(residentOrderFacts.length).toBeLessThanOrEqual(65);
    expect(world.archiveSystem?.pinnedFactIds.filter((id) => generatedOrderFactIds.includes(id))).toHaveLength(0);
    expect(validateWorldArchiveIntegrity(world)).toEqual([]);
  }, 15_000);
});
