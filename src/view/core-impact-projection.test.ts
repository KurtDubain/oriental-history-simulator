import { describe, expect, it } from 'vitest';

import {
  advanceWorld,
  computeWorldHash,
  createWorld,
  deserializeWorld,
  emitSimulationFact,
  serializeWorld,
  type ArmyState,
  type FactTurnBuffer,
  type HistoryEvent,
  type SimulationFact,
  type WarState,
  type WorldState,
} from '../sim';
import { toCountryInspector } from './country-dossier-adapter';
import { projectCoreImpacts } from './core-impact-projection';

interface BorderWarFixture {
  attacker: ArmyState;
  defender: ArmyState;
  war: WarState;
  originRegionId: string;
  targetRegionId: string;
}

function openingWorld(seed: string): WorldState {
  return advanceWorld(createWorld(seed));
}

function stageBorderWar(world: WorldState): BorderWarFixture {
  for (const war of world.wars) war.active = false;
  for (const polity of world.polities) {
    polity.lastWarTurn = world.turn;
    polity.legitimacy = Math.max(70, polity.legitimacy);
    polity.authority = Math.max(70, polity.authority);
  }
  for (const person of world.characters) {
    person.ambition = 0;
    person.loyalty = 100;
    person.caution = 100;
    person.rebellionReadiness = 0;
  }

  const armedPolityIds = new Set(world.armies.map((army) => army.polityId));
  const border = world.routes
    .filter((route) => route.kind !== '海峡')
    .map((route) => ({
      route,
      left: world.regions.find((region) => region.id === route.fromRegionId),
      right: world.regions.find((region) => region.id === route.toRegionId),
    }))
    .find(({ left, right }) => (
      left !== undefined
      && right !== undefined
      && left.controllerId !== right.controllerId
      && armedPolityIds.has(left.controllerId)
      && armedPolityIds.has(right.controllerId)
    ));
  if (!border?.left || !border.right) throw new Error('expected an armed land border');

  const attacker = world.armies.find((army) => army.polityId === border.left?.controllerId);
  const defender = world.armies.find((army) => army.polityId === border.right?.controllerId);
  if (!attacker || !defender) throw new Error('expected both border polities to field armies');

  attacker.regionId = border.left.id;
  defender.regionId = border.right.id;
  // Stay above the replenishment threshold while remaining too small to make
  // the order planner switch from the war goal to an immediate interception.
  attacker.soldiers = 12_000;
  defender.soldiers = 18_000;
  attacker.morale = 95;
  defender.morale = 95;
  attacker.training = 70;
  defender.training = 70;
  attacker.embarkedOperationId = null;
  defender.embarkedOperationId = null;
  for (const army of world.armies) {
    if (army.id === attacker.id || army.id === defender.id) continue;
    army.morale = 0;
    army.food = army.soldiers * 2;
    army.supply = 100;
  }

  const war: WarState = {
    id: `war_core_impact_${world.turn}`,
    kind: 'interstate',
    attackerId: attacker.polityId,
    defenderId: defender.polityId,
    startedTurn: world.turn - 1,
    endedTurn: null,
    active: true,
    attackerScore: 0,
    defenderScore: 0,
    reason: '军政影响投影测试',
    lastBattleTurn: -100,
    goal: '边境',
    targetRegionIds: [border.right.id],
    exhaustion: 0,
  };
  world.wars.push(war);
  attacker.order = {
    kind: 'advance',
    warId: war.id,
    issuerId: attacker.commanderId,
    issuedTurn: world.turn - 1,
    lastReviewedTurn: world.turn - 1,
    targetRegionId: border.right.id,
    targetArmyId: null,
    status: 'active',
    reasonCode: 'war_goal',
    provenance: 'system',
    sourceFactId: null,
  };
  defender.order = {
    kind: 'hold',
    warId: war.id,
    issuerId: defender.commanderId,
    issuedTurn: world.turn - 1,
    lastReviewedTurn: world.turn - 1,
    targetRegionId: border.right.id,
    targetArmyId: null,
    status: 'active',
    reasonCode: 'defend_war_goal',
    provenance: 'system',
    sourceFactId: null,
  };
  for (const character of world.characters) {
    if (character.id === attacker.commanderId || character.id === attacker.deputyCommanderId) {
      character.locationRegionId = border.left.id;
    }
    if (character.id === defender.commanderId || character.id === defender.deputyCommanderId) {
      character.locationRegionId = border.right.id;
    }
  }

  return {
    attacker,
    defender,
    war,
    originRegionId: border.left.id,
    targetRegionId: border.right.id,
  };
}

function removeAllRegionalFood(world: WorldState): void {
  for (const region of world.regions) {
    region.food = 0;
    region.fertility = 0;
  }
  world.tradeCorridors = [];
}

function currentFacts(world: WorldState): SimulationFact[] {
  const turn = world.lastTurn?.turn;
  const factIds = new Set(world.lastTurn?.factIds ?? []);
  return world.facts.filter((fact) => fact.turn === turn && factIds.has(fact.id));
}

function factBufferForLastTurn(world: WorldState): FactTurnBuffer {
  if (!world.lastTurn) throw new Error('expected a finalized quarter');
  return {
    turn: world.lastTurn.turn,
    year: world.lastTurn.year,
    season: world.lastTurn.season,
    facts: [],
  };
}

function scopedBattleFact(
  world: WorldState,
  polityId: string,
  ordinal: number,
): Extract<SimulationFact, { kind: 'battle' }> {
  if (!world.lastTurn) throw new Error('expected a finalized quarter');
  const commander = world.characters.find((person) => person.polityId === polityId) ?? world.characters[0];
  const opponent = world.polities.find((polity) => polity.id !== polityId) ?? world.polities[0];
  const defender = world.characters.find((person) => person.polityId === opponent.id) ?? world.characters[1];
  const battlefield = world.regions.find((region) => region.controllerId === opponent.id) ?? world.regions[0];
  const force = (armyId: string, forcePolityId: string, commanderId: string, supplyBefore: number) => ({
    armyId,
    polityId: forcePolityId,
    commanderId,
    deputyCommanderId: null,
    soldiersBefore: 10_000,
    soldiersAfter: 9_000,
    moraleBefore: 70,
    moraleAfter: 62,
    trainingBefore: 60,
    supplyBefore,
    losses: 1_000,
  });
  return {
    id: `fact_scope_battle_${ordinal}`,
    turn: world.lastTurn.turn,
    year: world.lastTurn.year,
    season: world.lastTurn.season,
    kind: 'battle',
    category: '军事',
    importance: 3,
    actorIds: [commander.id, defender.id],
    polityIds: [polityId, opponent.id],
    regionIds: [battlefield.id],
    causes: [{ label: '结算前补给士气', weight: 1, evidence: '攻方补给已进入战力结算' }],
    stateDeltas: [],
    sourceFactIds: [],
    payload: {
      warId: `war_scope_${ordinal}`,
      targetRegionId: battlefield.id,
      routeId: world.routes[0].id,
      attackerWon: false,
      attackerPower: 800,
      defenderPower: 1_200,
      militiaLosses: 0,
      attacker: force(`army_scope_${ordinal}`, polityId, commander.id, 25),
      defenders: [force(`army_scope_defender_${ordinal}`, opponent.id, defender.id, 90)],
    },
  };
}

describe('core military-political impact projection', () => {
  it('projects a real food collapse only after maintenance lowers readiness and the order resolver changes the command', () => {
    const staged = openingWorld('军政影响-断粮改令');
    const fixture = stageBorderWar(staged);
    removeAllRegionalFood(staged);
    fixture.attacker.food = 0;
    const soldiersBefore = fixture.attacker.soldiers;
    const moraleBefore = fixture.attacker.morale;

    const world = advanceWorld(staged);
    const army = world.armies.find((candidate) => candidate.id === fixture.attacker.id);
    const orderFact = currentFacts(world).find((fact) => (
      fact.kind === 'army_order_changed'
      && fact.payload.armyId === fixture.attacker.id
      && fact.payload.next.reasonCode === 'low_readiness'
    ));

    expect(army).toBeDefined();
    expect(army?.supply).toBeLessThan(30);
    expect(army?.soldiers).toBeLessThan(soldiersBefore);
    expect(army?.morale).toBeLessThan(moraleBefore);
    expect(orderFact?.kind).toBe('army_order_changed');
    if (!orderFact || orderFact.kind !== 'army_order_changed') return;
    expect(['hold', 'retreat']).toContain(orderFact.payload.next.kind);

    const impact = projectCoreImpacts(world, {
      target: { kind: 'army', id: fixture.attacker.id },
    }).find((item) => item.impact === '军令');
    expect(impact).toMatchObject({
      source: '粮食',
      target: { kind: 'army', id: fixture.attacker.id },
      beforeAfter: {
        label: '军令',
        before: orderFact.payload.previous.kind === 'advance' ? '进军' : expect.any(String),
        after: orderFact.payload.next.kind === 'retreat' ? '撤退' : '驻守',
      },
    });
    expect(impact?.sourceFactIds).toContain(orderFact.id);
    expect(impact?.summary).toContain(`补给仅${Math.round(army?.supply ?? 0)}`);
  });

  it('uses the real Battle Fact readiness snapshot and casualty delta when low supply enters battle power', () => {
    const staged = openingWorld('军政影响-低补给交战');
    const fixture = stageBorderWar(staged);
    removeAllRegionalFood(staged);
    fixture.attacker.food = fixture.attacker.soldiers * 0.5;
    fixture.defender.food = fixture.defender.soldiers * 2;

    const world = advanceWorld(staged);
    const battle = currentFacts(world).find((fact) => (
      fact.kind === 'battle'
      && fact.payload.warId === fixture.war.id
      && fact.payload.attacker.armyId === fixture.attacker.id
    ));
    expect(battle?.kind).toBe('battle');
    if (!battle || battle.kind !== 'battle') return;
    expect(battle.payload.attacker.supplyBefore).toBeLessThan(60);
    expect(battle.causes.some((cause) => (
      cause.label === '结算前补给士气'
      && cause.evidence.includes(`攻方补给${battle.payload.attacker.supplyBefore}`)
    ))).toBe(true);

    const impact = projectCoreImpacts(world, {
      target: { kind: 'army', id: fixture.attacker.id },
    }).find((item) => item.sourceFactIds.includes(battle.id));
    expect(impact).toMatchObject({
      source: '粮食',
      impact: '兵力',
      target: { kind: 'army', id: fixture.attacker.id },
      beforeAfter: {
        label: '兵力',
        before: battle.payload.attacker.soldiersBefore,
        after: battle.payload.attacker.soldiersAfter,
      },
    });
    expect(impact?.summary).toContain(`补给${Math.round(battle.payload.attacker.supplyBefore)}`);
    expect(impact?.summary).toContain('进入实际战力结算');
  });

  it('stays silent about a specific formation after the real disease resolver records only aggregate military deaths', () => {
    const staged = openingWorld('军政影响-军中疾病不可猜测');
    for (const war of staged.wars) war.active = false;
    for (const polity of staged.polities) polity.lastWarTurn = staged.turn;
    const army = staged.armies[0];
    const pathogen = staged.pathogens[0];
    if (!army || !pathogen) throw new Error('expected an army and pathogen');
    army.food = army.soldiers * 2;
    const soldiersBefore = army.soldiers;
    pathogen.transmissibility = 0;
    pathogen.durationMonths = 1;
    pathogen.fatality = 0.2;
    for (const practice of staged.practiceStates) {
      practice.mastery = 0;
      practice.adoption = 0;
    }
    const infection = staged.infections.find((state) => (
      state.hostKind === 'army'
      && state.hostId === army.id
      && state.pathogenId === pathogen.id
    ));
    if (!infection) throw new Error('expected an army infection state');
    infection.susceptible = 0;
    infection.exposed = 0;
    infection.infectious = soldiersBefore;
    infection.recovered = 0;
    infection.startedTurn = staged.turn;

    const world = advanceWorld(staged);
    const survivingArmy = world.armies.find((candidate) => candidate.id === army.id);
    expect(world.lastTurn?.health.militaryDeaths).toBeGreaterThan(0);
    expect(survivingArmy?.soldiers).toBeLessThan(soldiersBefore);
    expect(currentFacts(world).some((fact) => (
      fact.stateDeltas.some((delta) => (
        delta.entityType === 'army'
        && delta.entityId === army.id
        && delta.field === 'soldiers'
      ))
    ))).toBe(false);
    expect(projectCoreImpacts(world).some((impact) => (
      impact.source === '疾病'
      && (
        (impact.target.kind === 'army' && impact.target.id === army.id)
        || impact.relatedTargets.some((target) => target.kind === 'army' && target.id === army.id)
      )
    ))).toBe(false);
  });

  it('projects the exact before-to-after legitimacy change emitted by real politics under food and unrest pressure', () => {
    const staged = openingWorld('军政影响-地方压力入朝局');
    for (const war of staged.wars) war.active = false;
    for (const person of staged.characters) {
      person.ambition = 0;
      person.loyalty = 100;
      person.caution = 100;
      person.rebellionReadiness = 0;
      person.governance = 0;
    }
    const polity = staged.polities[0];
    if (!polity) throw new Error('expected a polity');
    polity.legitimacy = 30;
    polity.authority = 50;
    polity.administration = 50;
    polity.lastWarTurn = staged.turn;
    for (const region of staged.regions.filter((item) => item.controllerId === polity.id)) {
      region.food = 0;
      region.fertility = 0;
      region.unrest = 100;
      region.devastation = 100;
    }

    const world = advanceWorld(staged);
    const crisis = world.history.find((event) => (
      event.turn === world.lastTurn?.turn
      && world.lastTurn?.eventIds.includes(event.id)
      && event.kind === 'legitimacy_crisis'
      && event.polityIds.includes(polity.id)
    ));
    const legitimacyDelta = crisis?.stateDeltas.find((delta) => (
      delta.entityType === 'polity'
      && delta.entityId === polity.id
      && delta.field === 'legitimacy'
    ));
    expect(crisis).toBeDefined();
    expect(legitimacyDelta).toMatchObject({ before: 30, after: 28, delta: -2 });

    const impact = projectCoreImpacts(world, {
      target: { kind: 'polity', id: polity.id },
    }).find((item) => item.sourceEventIds.includes(crisis?.id ?? ''));
    expect(impact).toMatchObject({
      source: '地方压力',
      impact: '合法性',
      target: { kind: 'polity', id: polity.id },
      beforeAfter: {
        label: '合法性',
        before: legitimacyDelta?.before,
        after: legitimacyDelta?.after,
      },
    });
    expect(impact?.summary).toContain(`合法性${String(legitimacyDelta?.before)}→${String(legitimacyDelta?.after)}`);
  });

  it('links a disease death, the vacated command and its same-seat successor without losing Fact provenance', () => {
    const world = openingWorld('军政影响-病故换帅引用');
    const army = world.armies[0];
    const pathogen = world.pathogens[0];
    if (!army || !pathogen || !world.lastTurn) throw new Error('expected a current military world');
    const deceased = world.characters.find((person) => person.id === army.commanderId);
    const successor = world.characters.find((person) => (
      person.alive && person.polityId === army.polityId && person.id !== deceased?.id
    ));
    if (!deceased || !successor) throw new Error('expected a commander and successor');
    const buffer = factBufferForLastTurn(world);

    const ended = emitSimulationFact(world, buffer, {
      kind: 'appointment_ended',
      category: '政治',
      importance: 3,
      actorIds: [deceased.id],
      polityIds: [army.polityId],
      regionIds: [army.regionId],
      causes: [{ label: '病故去职', role: '结果', weight: 1, evidence: `${deceased.name}病故` }],
      stateDeltas: [{ entityType: 'office', entityId: 'office_test_command', field: 'active', before: true, after: false }],
      sourceFactIds: [],
      payload: {
        appointmentId: 'office_test_command',
        action: 'ended',
        officeKind: '军团主帅',
        holderId: deceased.id,
        polityId: army.polityId,
        regionId: null,
        armyId: army.id,
        fleetId: null,
        rank: 4,
      },
    });
    const started = emitSimulationFact(world, buffer, {
      kind: 'appointment_started',
      category: '政治',
      importance: 3,
      actorIds: [successor.id],
      polityIds: [army.polityId],
      regionIds: [army.regionId],
      causes: [{ label: '同席接任', role: '结果', weight: 1, evidence: `${successor.name}接掌军团` }],
      stateDeltas: [{ entityType: 'office', entityId: 'office_test_successor', field: 'active', before: false, after: true }],
      sourceFactIds: [ended.id],
      payload: {
        appointmentId: 'office_test_successor',
        action: 'started',
        officeKind: '军团主帅',
        holderId: successor.id,
        polityId: army.polityId,
        regionId: null,
        armyId: army.id,
        fleetId: null,
        rank: 4,
      },
    });
    const death = emitSimulationFact(world, buffer, {
      kind: 'character_death',
      category: '政治',
      importance: 3,
      actorIds: [deceased.id],
      polityIds: [army.polityId],
      regionIds: [army.regionId],
      causes: [{ label: '健康状态', role: '条件', weight: 1, evidence: `染患${pathogen.name}` }],
      stateDeltas: [{ entityType: 'character', entityId: deceased.id, field: 'alive', before: true, after: false }],
      sourceFactIds: [],
      payload: {
        characterId: deceased.id,
        age: deceased.age,
        role: '将领',
        health: 12,
        diseaseId: pathogen.id,
      },
    });
    world.lastTurn.factIds.push(...buffer.facts.map((fact) => fact.id));
    world.hash = computeWorldHash(world);

    const impact = projectCoreImpacts(world, {
      target: { kind: 'person', id: deceased.id },
    }).find((item) => item.source === '疾病');
    expect(impact).toMatchObject({
      target: { kind: 'person', id: deceased.id },
      impact: '兵权',
      beforeAfter: { label: '生命状态', before: true, after: false },
    });
    expect(new Set(impact?.sourceFactIds)).toEqual(new Set([death.id, ended.id, started.id]));
    expect(impact?.summary).toContain(`由${successor.name}接掌`);
    expect(impact?.relatedTargets).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'army', id: army.id }),
      expect.objectContaining({ kind: 'person', id: successor.id }),
    ]));
  });

  it('does not promote ordinary trade, migration or outbreak ledgers without a proven military-political result', () => {
    const world = openingWorld('军政影响-普通周边保持后台');
    if (!world.lastTurn) throw new Error('expected a finalized quarter');
    const [origin, destination] = world.regions;
    if (!origin || !destination) throw new Error('expected two regions');
    world.lastTurn.factIds = [];
    world.lastTurn.eventIds = [];
    world.lastTurn.trade.shipments = [{
      id: 'shipment_ordinary_salt',
      kind: '贸易',
      commodity: '盐',
      originRegionId: origin.id,
      destinationRegionId: destination.id,
      acceptedAmount: 800,
      deliveredAmount: 790,
      lostAmount: 10,
      raidedAmount: 0,
      peopleDeparted: 0,
      peopleArrived: 0,
      peopleLost: 0,
      contactVolume: 26,
      legs: [],
      carrierArmyId: null,
      carrierFleetId: null,
      value: 1_580,
      tariff: 79,
      status: '受损',
    }];
    world.lastTurn.migration = {
      departed: 500,
      arrived: 490,
      travelDeaths: 10,
      settled: 490,
      flowIds: ['shipment_ordinary_migration'],
    };
    world.lastTurn.health = {
      infectiousStart: 2_000,
      newExposures: 300,
      importedExposures: 40,
      civilianDeaths: 12,
      militaryDeaths: 0,
      infectiousEnd: 2_288,
      outbreakRegionIds: [destination.id],
    };

    expect(projectCoreImpacts(world)).toEqual([]);
  });

  it('does not treat routine army food delivery to a fully supplied formation as a military-political result', () => {
    const world = openingWorld('军政影响-例行军粮保持后台');
    if (!world.lastTurn) throw new Error('expected a finalized quarter');
    const army = world.armies[0];
    const [origin, destination] = world.regions;
    if (!army || !origin || !destination) throw new Error('expected an army and two regions');
    army.supply = 100;
    world.lastTurn.factIds = [];
    world.lastTurn.eventIds = [];
    world.lastTurn.trade.shipments = [{
      id: 'shipment_routine_army_food',
      kind: '军粮',
      commodity: '粮食',
      originRegionId: origin.id,
      destinationRegionId: destination.id,
      acceptedAmount: 8_000,
      deliveredAmount: 8_000,
      lostAmount: 0,
      raidedAmount: 0,
      peopleDeparted: 0,
      peopleArrived: 0,
      peopleLost: 0,
      contactVolume: 0,
      legs: [],
      carrierArmyId: army.id,
      carrierFleetId: null,
      value: 0,
      tariff: 0,
      status: '交付',
    }];

    expect(projectCoreImpacts(world, { target: { kind: 'army', id: army.id } })).toEqual([]);
    expect(projectCoreImpacts(world).some((impact) => impact.summary.includes('补给为100'))).toBe(false);
  });

  it('filters court sources before the global result limit hides a real local legitimacy impact', () => {
    const world = openingWorld('军政影响-朝堂来源先筛选');
    if (!world.lastTurn) throw new Error('expected a finalized quarter');
    const polity = world.polities[0];
    world.lastTurn.factIds = [];
    world.lastTurn.eventIds = [];
    const battles = [1, 2, 3].map((ordinal) => scopedBattleFact(world, polity.id, ordinal));
    world.facts.push(...battles);
    world.lastTurn.factIds.push(...battles.map((fact) => fact.id));
    const crisis: HistoryEvent = {
      id: 'event_scope_legitimacy',
      turn: world.lastTurn.turn,
      year: world.lastTurn.year,
      season: world.lastTurn.season,
      category: '政治',
      kind: 'legitimacy_crisis',
      title: `${polity.name}粮荒入朝`,
      summary: `${polity.name}的地方压力已伤及合法性。`,
      importance: 4,
      actorIds: [],
      polityIds: [polity.id],
      regionIds: [],
      causes: [
        { label: '粮食安全', weight: 1, evidence: '属地粮仓见底' },
        { label: '民间不安', weight: 1, evidence: '流民与民怨累积' },
      ],
      evidence: [],
      stateDeltas: [{
        entityType: 'polity',
        entityId: polity.id,
        field: 'legitimacy',
        before: 70,
        after: 68,
        delta: -2,
      }],
      sourceFactIds: [],
      situationIds: [],
    };
    world.history.push(crisis);
    world.lastTurn.eventIds.push(crisis.id);

    expect(projectCoreImpacts(world, {
      target: { kind: 'polity', id: polity.id },
      limit: 3,
    }).map((impact) => impact.source)).toEqual(['粮食', '粮食', '粮食']);

    const courtImpact = projectCoreImpacts(world, {
      target: { kind: 'polity', id: polity.id },
      sources: ['地方压力', '疾病'],
      limit: 1,
    });
    expect(courtImpact).toHaveLength(1);
    expect(courtImpact[0]).toMatchObject({
      source: '地方压力',
      sourceEventIds: [crisis.id],
      beforeAfter: { label: '合法性', before: 70, after: 68 },
    });
    expect(toCountryInspector(world, polity).coreImpact).toEqual({
      summary: courtImpact[0].summary,
      sourceEventId: crisis.id,
    });
  });

  it('is deterministic and read-only, including the authenticated save and the next seeded quarter', () => {
    const world = openingWorld('军政影响-只读确定性');
    const serializedBefore = serializeWorld(world);
    const hashBefore = world.hash;
    const computedHashBefore = computeWorldHash(world);
    const factsBefore = JSON.stringify(world.facts);
    const historyBefore = JSON.stringify(world.history);
    const baseline = deserializeWorld(serializedBefore);

    const first = projectCoreImpacts(world);
    const second = projectCoreImpacts(world);

    expect(first).toEqual(second);
    expect(first.length).toBeLessThanOrEqual(3);
    expect(world.hash).toBe(hashBefore);
    expect(computeWorldHash(world)).toBe(computedHashBefore);
    expect(serializeWorld(world)).toBe(serializedBefore);
    expect(JSON.stringify(world.facts)).toBe(factsBefore);
    expect(JSON.stringify(world.history)).toBe(historyBefore);
    expect(serializeWorld(advanceWorld(world))).toBe(serializeWorld(advanceWorld(baseline)));
  });
});
