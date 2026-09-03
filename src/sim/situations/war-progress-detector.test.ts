import { describe, expect, it } from 'vitest';

import { advanceWorld, createWorld, serializeWorld } from '../index';
import type {
  ArmyState,
  PolityState,
  WarState,
  WorldState,
} from '../types';
import type {
  BattleFact,
  SimulationFact,
  TerritoryControlFact,
  WarEndedFact,
  WarEndResult,
  WarStartedFact,
} from '../facts';
import { createSituationSystemState, reduceSituationTurn } from './reducer';
import type { SituationSystemState } from './types';
import {
  buildWarProgressIndex,
  detectWarProgressCandidates,
  WAR_PROGRESS_TEMPLATE,
  warProgressDetector,
  type WarProgressCandidate,
} from './war-progress-detector';

interface PreparedWar {
  world: WorldState;
  war: WarState;
  attacker: PolityState;
  defender: PolityState;
  attackerArmy: ArmyState;
  defenderArmy: ArmyState;
}

function prepareWar(seed: string, turn = 4): PreparedWar {
  const world = createWorld(seed);
  const polityIdsWithArmies = [...new Set(world.armies.map((army) => army.polityId))].sort();
  expect(polityIdsWithArmies.length).toBeGreaterThanOrEqual(2);
  const attacker = world.polities.find((polity) => polity.id === polityIdsWithArmies[0]) as PolityState;
  const defender = world.polities.find((polity) => polity.id === polityIdsWithArmies[1]) as PolityState;
  const attackerArmy = world.armies.find((army) => army.polityId === attacker.id) as ArmyState;
  const defenderArmy = world.armies.find((army) => army.polityId === defender.id) as ArmyState;
  expect(attacker).toBeDefined();
  expect(defender).toBeDefined();
  expect(attackerArmy).toBeDefined();
  expect(defenderArmy).toBeDefined();

  world.turn = turn;
  attacker.warWeariness = 35;
  defender.warWeariness = 32;
  for (const army of [attackerArmy, defenderArmy]) {
    army.soldiers = Math.max(8_000, army.soldiers);
    army.morale = 78;
    army.training = 72;
    army.supply = 74;
  }
  const war: WarState = {
    id: 'test-war-progress',
    kind: 'interstate',
    attackerId: attacker.id,
    defenderId: defender.id,
    startedTurn: Math.max(0, turn - 1),
    endedTurn: null,
    active: true,
    attackerScore: 0,
    defenderScore: 0,
    reason: '边境与霸权之争',
    lastBattleTurn: -1,
    goal: '边境',
    targetRegionIds: defender.controlledRegionIds.slice(0, 2),
    exhaustion: 0,
  };
  const frontRegionId = war.targetRegionIds[0] ?? defenderArmy.regionId;
  attackerArmy.regionId = frontRegionId;
  defenderArmy.regionId = frontRegionId;
  world.wars = [war];
  return { world, war, attacker, defender, attackerArmy, defenderArmy };
}

function startedFact(prepared: PreparedWar, turn = prepared.war.startedTurn): WarStartedFact {
  return {
    id: `test-war-started:${prepared.war.id}:${turn}`,
    turn,
    year: prepared.world.year,
    season: prepared.world.season,
    kind: 'war_started',
    category: '外交',
    importance: 4,
    actorIds: [prepared.attacker.rulerId, prepared.defender.rulerId],
    polityIds: [prepared.attacker.id, prepared.defender.id],
    regionIds: [...prepared.war.targetRegionIds],
    causes: [],
    stateDeltas: [{
      entityType: 'war',
      entityId: prepared.war.id,
      field: 'active',
      before: false,
      after: true,
    }],
    sourceFactIds: [],
    payload: {
      warId: prepared.war.id,
      warKind: prepared.war.kind,
      attackerId: prepared.attacker.id,
      defenderId: prepared.defender.id,
      goal: prepared.war.goal,
      targetRegionIds: [...prepared.war.targetRegionIds],
      reason: prepared.war.reason,
    },
  };
}

function battleFact(
  prepared: PreparedWar,
  turn = prepared.world.turn,
  attackerWon = true,
): BattleFact {
  const targetRegionId = prepared.war.targetRegionIds[0]
    ?? prepared.defender.controlledRegionIds[0]
    ?? prepared.defenderArmy.regionId;
  return {
    id: `test-war-battle:${prepared.war.id}:${turn}`,
    turn,
    year: prepared.world.year,
    season: prepared.world.season,
    kind: 'battle',
    category: '军事',
    importance: 3,
    actorIds: [prepared.attackerArmy.commanderId, prepared.defenderArmy.commanderId],
    polityIds: [prepared.attacker.id, prepared.defender.id],
    regionIds: [targetRegionId],
    causes: [],
    stateDeltas: [],
    sourceFactIds: [],
    payload: {
      warId: prepared.war.id,
      targetRegionId,
      routeId: 'test-war-route',
      attackerWon,
      attackerPower: 15_000,
      defenderPower: 12_000,
      militiaLosses: 180,
      attacker: {
        armyId: prepared.attackerArmy.id,
        polityId: prepared.attacker.id,
        commanderId: prepared.attackerArmy.commanderId,
        deputyCommanderId: prepared.attackerArmy.deputyCommanderId,
        soldiersBefore: prepared.attackerArmy.soldiers + 900,
        soldiersAfter: prepared.attackerArmy.soldiers,
        moraleBefore: prepared.attackerArmy.morale - 4,
        moraleAfter: prepared.attackerArmy.morale,
        trainingBefore: prepared.attackerArmy.training,
        supplyBefore: prepared.attackerArmy.supply,
        losses: 900,
      },
      defenders: [{
        armyId: prepared.defenderArmy.id,
        polityId: prepared.defender.id,
        commanderId: prepared.defenderArmy.commanderId,
        deputyCommanderId: prepared.defenderArmy.deputyCommanderId,
        soldiersBefore: prepared.defenderArmy.soldiers + 1_400,
        soldiersAfter: prepared.defenderArmy.soldiers,
        moraleBefore: prepared.defenderArmy.morale + 5,
        moraleAfter: prepared.defenderArmy.morale,
        trainingBefore: prepared.defenderArmy.training,
        supplyBefore: prepared.defenderArmy.supply,
        losses: 1_400,
      }],
    },
  };
}

function territoryFact(prepared: PreparedWar, turn = prepared.world.turn): TerritoryControlFact {
  const regionId = prepared.war.targetRegionIds[0]
    ?? prepared.defender.controlledRegionIds[0]
    ?? prepared.defenderArmy.regionId;
  return {
    id: `test-war-territory:${prepared.war.id}:${turn}`,
    turn,
    year: prepared.world.year,
    season: prepared.world.season,
    kind: 'territory_control_changed',
    category: '军事',
    importance: 4,
    actorIds: [prepared.attackerArmy.commanderId],
    polityIds: [prepared.attacker.id, prepared.defender.id],
    regionIds: [regionId],
    causes: [],
    stateDeltas: [{
      entityType: 'region',
      entityId: regionId,
      field: 'controllerId',
      before: prepared.defender.id,
      after: prepared.attacker.id,
    }],
    sourceFactIds: [],
    payload: {
      regionId,
      previousControllerId: prepared.defender.id,
      nextControllerId: prepared.attacker.id,
      reason: 'battle_capture',
      warId: prepared.war.id,
    },
  };
}

function endedFact(
  prepared: PreparedWar,
  result: WarEndResult,
  turn = prepared.world.turn,
  sourceFactIds: readonly string[] = [],
): WarEndedFact {
  const attackerWon = result === 'attacker_advantage' || result === 'defender_destroyed' || result === 'defender_dissolved';
  const defenderWon = result === 'defender_advantage' || result === 'attacker_destroyed' || result === 'attacker_dissolved';
  return {
    id: `test-war-ended:${prepared.war.id}:${result}:${turn}`,
    turn,
    year: prepared.world.year,
    season: prepared.world.season,
    kind: 'war_ended',
    category: result === 'negotiated_peace' ? '外交' : '军事',
    importance: result === 'negotiated_peace' ? 4 : 5,
    actorIds: [prepared.attacker.rulerId, prepared.defender.rulerId],
    polityIds: [prepared.attacker.id, prepared.defender.id],
    regionIds: [],
    causes: [],
    stateDeltas: [{
      entityType: 'war',
      entityId: prepared.war.id,
      field: 'active',
      before: true,
      after: false,
    }],
    sourceFactIds: [...sourceFactIds],
    payload: {
      warId: prepared.war.id,
      attackerId: prepared.attacker.id,
      defenderId: prepared.defender.id,
      result,
      winnerId: attackerWon ? prepared.attacker.id : defenderWon ? prepared.defender.id : null,
      loserId: attackerWon ? prepared.defender.id : defenderWon ? prepared.attacker.id : null,
      reason: result === 'negotiated_peace' ? '双方疲惫不堪' : '一方取得决定性战果',
      durationTurns: Math.max(1, turn - prepared.war.startedTurn + 1),
      attackerScore: prepared.war.attackerScore,
      defenderScore: prepared.war.defenderScore,
      indemnity: result === 'negotiated_peace' ? 0 : 480,
    },
  };
}

function candidateFor(
  prepared: PreparedWar,
  facts: readonly SimulationFact[] = [],
): WarProgressCandidate {
  const candidate = detectWarProgressCandidates(prepared.world, facts)
    .find((item) => item.scopeKey === prepared.war.id);
  expect(candidate).toBeDefined();
  return candidate as WarProgressCandidate;
}

function reducePreparedTurn(
  state: SituationSystemState,
  prepared: PreparedWar,
  facts: readonly SimulationFact[],
): SituationSystemState {
  return reduceSituationTurn(state, {
    turn: prepared.world.turn,
    facts,
    index: buildWarProgressIndex(prepared.world),
    detectors: [warProgressDetector],
  }, {
    templates: [WAR_PROGRESS_TEMPLATE],
  }).state;
}

describe('war progress detector', () => {
  it('is deterministic, read-only, bounded and keeps war.id as the stable scope', () => {
    const prepared = prepareWar('B06-determinism');
    const declaration = startedFact(prepared);
    prepared.world.facts.push(declaration);
    const before = serializeWorld(prepared.world);
    const left = detectWarProgressCandidates(prepared.world, []);
    const right = detectWarProgressCandidates(prepared.world, []);

    expect(left).toEqual(right);
    expect(serializeWorld(prepared.world)).toBe(before);
    expect(left).toHaveLength(1);
    const candidate = left[0] as WarProgressCandidate;
    expect(candidate.scopeKey).toBe(prepared.war.id);
    expect(candidate.candidateKey).toBe(`war_progress:${prepared.war.id}`);
    expect(candidate.signals.length).toBeLessThanOrEqual(12);
    expect(candidate.sourceFactIds).toEqual([]);
    expect(candidate.signals.flatMap((signal) => signal.refs)).toContainEqual({
      kind: 'index',
      entityType: 'war_fact_history',
      entityId: prepared.war.id,
      field: 'hasStartedFact',
      value: true,
    });
    expect(candidate.signals.flatMap((signal) => signal.refs)).not.toContainEqual({
      kind: 'fact',
      factId: declaration.id,
    });
    expect(candidate.participants.polityIds).toEqual([prepared.attacker.id, prepared.defender.id].sort());
    expect(candidate.participants.armyIds.length).toBeLessThanOrEqual(8);
    expect(candidate.possibleOutcomes.length).toBeLessThanOrEqual(5);
    expect(candidate.signals.flatMap((signal) => signal.refs).every((ref) => (
      ref.kind === 'fact' || ref.kind === 'index'
    ))).toBe(true);
    expect(candidate.structureSignals.map((signal) => signal.key)).toEqual(expect.arrayContaining([
      'ongoing_war',
      'opposing_belligerents',
      'war_goal_and_duration',
    ]));
  });

  it('does not read Chronicle history or accept an unrelated Fact as war evidence', () => {
    const evidenced = prepareWar('B06-chronicle-independence');
    const declaration = startedFact(evidenced);
    evidenced.world.facts.push(declaration);
    const expected = detectWarProgressCandidates(evidenced.world, []);
    const withoutChronicle = structuredClone(evidenced.world);
    withoutChronicle.history = [];
    withoutChronicle.historyDigest = 'presentation-only-change';
    expect(detectWarProgressCandidates(withoutChronicle, [])).toEqual(expected);

    const unsupported = prepareWar('B06-unrelated-fact', 8);
    unsupported.war.startedTurn = 1;
    const unrelated = unsupported.world.facts.find((fact) => warProgressDetector.id !== fact.kind);
    const candidate = candidateFor(unsupported, unrelated ? [unrelated] : []);
    expect(candidate.sourceFactIds).toEqual([]);
    expect(candidate.pressure).toBeLessThan(WAR_PROGRESS_TEMPLATE.formationThreshold);
  });

  it('does not mix armies or fleets from another simultaneous war', () => {
    const first = prepareWar('B06-parallel-war-scope', 6);
    const thirdPolityId = [...new Set(first.world.armies.map((army) => army.polityId))]
      .sort()
      .find((id) => id !== first.attacker.id && id !== first.defender.id);
    expect(thirdPolityId).toBeDefined();
    const third = first.world.polities.find((polity) => polity.id === thirdPolityId) as PolityState;
    const thirdArmy = first.world.armies.find((army) => army.polityId === third.id) as ArmyState;
    const secondTarget = third.controlledRegionIds[0] ?? thirdArmy.regionId;
    const secondAttackerArmy: ArmyState = {
      ...first.attackerArmy,
      id: 'test-parallel-attacker-army',
      name: '另一战线军',
      regionId: secondTarget,
      originRegionId: secondTarget,
    };
    first.world.armies.push(secondAttackerArmy);
    thirdArmy.regionId = secondTarget;
    const firstTarget = first.war.targetRegionIds[0] as string;
    const firstRegion = first.world.regions.find((region) => region.id === firstTarget);
    const secondRegion = first.world.regions.find((region) => region.id === secondTarget);
    if (firstRegion) firstRegion.neighbors = [];
    if (secondRegion) secondRegion.neighbors = [];
    const secondWar: WarState = {
      ...first.war,
      id: 'test-parallel-war',
      defenderId: third.id,
      targetRegionIds: [secondTarget],
    };
    first.world.wars.push(secondWar);
    const second: PreparedWar = {
      world: first.world,
      war: secondWar,
      attacker: first.attacker,
      defender: third,
      attackerArmy: secondAttackerArmy,
      defenderArmy: thirdArmy,
    };
    const firstBattle = battleFact(first, 6);
    const secondBattle = battleFact(second, 6);
    first.world.facts.push(startedFact(first, 5), startedFact(second, 5), firstBattle, secondBattle);

    const fleetA = first.world.fleets[0];
    const fleetB = first.world.fleets[1];
    expect(fleetA).toBeDefined();
    expect(fleetB).toBeDefined();
    if (fleetA && fleetB) {
      fleetA.polityId = first.attacker.id;
      fleetB.polityId = first.attacker.id;
      first.world.navalOperations.push({
        id: 'test-operation-first-war',
        warId: first.war.id,
        armyId: first.attackerArmy.id,
        fleetIds: [fleetA.id],
        originRegionId: firstTarget,
        targetRegionId: firstTarget,
        seaZonePath: [],
        stage: '集结',
        startedTurn: 5,
        progress: 10,
        foodLoaded: 0,
        manifest: null,
        completedTurn: null,
      }, {
        id: 'test-operation-second-war',
        warId: secondWar.id,
        armyId: secondAttackerArmy.id,
        fleetIds: [fleetB.id],
        originRegionId: secondTarget,
        targetRegionId: secondTarget,
        seaZonePath: [],
        stage: '集结',
        startedTurn: 5,
        progress: 10,
        foodLoaded: 0,
        manifest: null,
        completedTurn: null,
      });
    }

    const firstCandidate = candidateFor(first, []);
    expect(firstCandidate.participants.armyIds).toContain(first.attackerArmy.id);
    expect(firstCandidate.participants.armyIds).toContain(first.defenderArmy.id);
    expect(firstCandidate.participants.armyIds).not.toContain(secondAttackerArmy.id);
    expect(firstCandidate.participants.armyIds).not.toContain(thirdArmy.id);
    if (fleetA && fleetB) {
      expect(firstCandidate.participants.fleetIds).toContain(fleetA.id);
      expect(firstCandidate.participants.fleetIds).not.toContain(fleetB.id);
    }
  });

  it('retains a declaration-backed candidate into the quiet confirmation quarter and then forms', () => {
    const prepared = prepareWar('B06-formation', 3);
    prepared.war.startedTurn = 3;
    const declaration = startedFact(prepared, 3);
    prepared.world.facts.push(declaration);
    let state = createSituationSystemState(2);

    state = reducePreparedTurn(state, prepared, [declaration]);
    expect(state.situations).toHaveLength(0);
    expect(state.candidates[0]?.consecutiveQualifyingTurns).toBe(1);

    prepared.world.turn = 4;
    state = reducePreparedTurn(state, prepared, []);
    const formed = state.situations.find((situation) => situation.scopeKey === prepared.war.id);
    expect(formed?.status).toBe('open');
    expect(formed?.phase).toBe('emerging');
    expect(formed?.causalFactIds).toContain(declaration.id);
  });

  it('requires sustained war, recent operational Facts, supply evidence and a live commander for critical pressure', () => {
    const prepared = prepareWar('B06-critical-proof', 10);
    prepared.war.startedTurn = 1;
    prepared.war.attackerScore = 95;
    prepared.war.defenderScore = 70;
    prepared.attacker.warWeariness = 92;
    prepared.defender.warWeariness = 88;
    prepared.attackerArmy.supply = 40;
    prepared.defenderArmy.supply = 36;
    const declaration = startedFact(prepared, 1);
    prepared.world.facts.push(declaration);

    const withoutOperationalFact = candidateFor(prepared, []);
    expect(withoutOperationalFact.pressure).toBeLessThan(WAR_PROGRESS_TEMPLATE.criticalEnterThreshold);
    expect(withoutOperationalFact.executableActorIds).toEqual([]);
    expect(withoutOperationalFact.signals.some((signal) => signal.key === 'critical_operational_evidence')).toBe(false);

    const battle = battleFact(prepared, 10);
    const capture = territoryFact(prepared, 10);
    const withOperationalFacts = candidateFor(prepared, [battle, capture]);
    expect(withOperationalFacts.pressure).toBeGreaterThanOrEqual(WAR_PROGRESS_TEMPLATE.criticalEnterThreshold);
    expect(withOperationalFacts.executableActorIds.length).toBeGreaterThan(0);
    expect(withOperationalFacts.signals).toContainEqual(expect.objectContaining({
      key: 'critical_operational_evidence',
      role: 'capability',
    }));
    const criticalSignal = withOperationalFacts.signals.find((signal) => signal.key === 'critical_operational_evidence');
    expect(criticalSignal?.refs).toContainEqual({ kind: 'fact', factId: capture.id });
    expect(criticalSignal?.refs.some((ref) => ref.kind === 'index' && ref.field === 'averageArmySupply')).toBe(true);
  });

  it('moves emerging to active to critical, then immediately leaves critical when recent operations expire', () => {
    const prepared = prepareWar('B06-phase-lifecycle', 1);
    prepared.war.startedTurn = 1;
    prepared.attacker.warWeariness = 90;
    prepared.defender.warWeariness = 90;
    prepared.attackerArmy.supply = 44;
    prepared.defenderArmy.supply = 42;
    const declaration = startedFact(prepared, 1);
    let state = createSituationSystemState(0);

    for (let turn = 1; turn <= 6; turn += 1) {
      prepared.world.turn = turn;
      prepared.war.attackerScore = turn * 18;
      prepared.war.defenderScore = turn * 11;
      const battle = battleFact(prepared, turn, turn % 2 === 1);
      const facts: SimulationFact[] = turn === 1 ? [declaration, battle] : [battle];
      prepared.world.facts.push(...facts);
      state = reducePreparedTurn(state, prepared, facts);
    }
    const critical = state.situations.find((situation) => situation.scopeKey === prepared.war.id);
    expect(critical?.phase).toBe('critical');
    expect(critical?.executableActorIds.length).toBeGreaterThan(0);

    for (let turn = 7; turn <= 9; turn += 1) {
      prepared.world.turn = turn;
      state = reducePreparedTurn(state, prepared, []);
    }
    const cooled = state.situations.find((situation) => situation.scopeKey === prepared.war.id);
    expect(cooled?.status).toBe('open');
    expect(cooled?.phase).toBe('active');
    expect(cooled?.executableActorIds).toEqual([]);
  });

  it('maps every authoritative war_ended result directly and preserves its causal Fact links', () => {
    const results: WarEndResult[] = [
      'attacker_advantage',
      'defender_advantage',
      'negotiated_peace',
      'attacker_destroyed',
      'defender_destroyed',
      'attacker_dissolved',
      'defender_dissolved',
    ];
    for (const result of results) {
      const prepared = prepareWar(`B06-resolution-${result}`, 12);
      prepared.war.startedTurn = 4;
      prepared.war.active = false;
      prepared.war.endedTurn = 12;
      prepared.war.attackerScore = 58;
      prepared.war.defenderScore = 34;
      const battle = battleFact(prepared, 12);
      const ended = endedFact(prepared, result, 12, [battle.id]);
      const resolution = candidateFor(prepared, [battle, ended]);
      expect(resolution.pressure).toBe(0);
      expect(resolution.executableActorIds).toEqual([]);
      expect(resolution.resolution).toEqual({
        outcomeKey: result,
        resultFactIds: [ended.id],
      });
      expect(resolution.signals[0]).toEqual(expect.objectContaining({ key: result, role: 'outcome' }));
      expect(resolution.signals[0]?.refs).toContainEqual({ kind: 'fact', factId: ended.id });
    }
  });

  it('atomically resolves an open Situation but rejects stale or state-inconsistent end Facts', () => {
    const prepared = prepareWar('B06-atomic-resolution', 1);
    prepared.war.startedTurn = 1;
    const declaration = startedFact(prepared, 1);
    prepared.world.facts.push(declaration);
    let state = createSituationSystemState(0);
    state = reducePreparedTurn(state, prepared, [declaration]);
    prepared.world.turn = 2;
    state = reducePreparedTurn(state, prepared, []);
    expect(state.situations[0]?.status).toBe('open');

    prepared.world.turn = 3;
    prepared.war.active = false;
    prepared.war.endedTurn = 3;
    const ended = endedFact(prepared, 'negotiated_peace', 3);
    state = reducePreparedTurn(state, prepared, [ended]);
    expect(state.situations[0]?.status).toBe('resolved');
    expect(state.situations[0]?.resolution?.outcomeKey).toBe('negotiated_peace');
    expect(state.situations[0]?.resolution?.resultFactIds).toEqual([ended.id]);

    const stale = prepareWar('B06-stale-resolution', 9);
    stale.war.active = false;
    stale.war.endedTurn = 8;
    const staleEnd = endedFact(stale, 'attacker_advantage', 8);
    expect(detectWarProgressCandidates(stale.world, [staleEnd])).toEqual([]);

    const inconsistent = prepareWar('B06-inconsistent-resolution', 9);
    inconsistent.war.endedTurn = 9;
    const inconsistentEnd = endedFact(inconsistent, 'attacker_advantage', 9);
    expect(detectWarProgressCandidates(inconsistent.world, [inconsistentEnd])).toEqual([]);
  });

  it('remains bounded and authority-backed across natural multi-seed evolution', () => {
    const seeds = ['春战副将', 'B06-natural-east', 'B06-natural-sea'];
    let observations = 0;
    let formalEvidence = 0;
    for (const seed of seeds) {
      let world = createWorld(seed);
      for (let quarter = 0; quarter < 24; quarter += 1) {
        world = advanceWorld(world);
        const turn = world.turn - 1;
        const facts = world.facts.filter((fact) => fact.turn === turn);
        const candidates = warProgressDetector.detect({
          turn,
          facts,
          index: buildWarProgressIndex(world),
        }) as readonly WarProgressCandidate[];
        const currentEndCount = facts.filter((fact) => fact.kind === 'war_ended').length;
        const activeWarCount = world.wars.filter((war) => war.active).length;
        expect(candidates.length).toBeLessThanOrEqual(Math.min(24, activeWarCount + currentEndCount));
        expect(candidates.every((candidate) => candidate.pressure >= 0 && candidate.pressure <= 100)).toBe(true);
        const currentFactIds = new Set(facts.map((fact) => fact.id));
        expect(candidates.every((candidate) => candidate.sourceFactIds.every((id) => (
          currentFactIds.has(id)
        )))).toBe(true);
        for (const candidate of candidates.filter((item) => (
          item.pressure >= WAR_PROGRESS_TEMPLATE.criticalEnterThreshold
        ))) {
          expect(candidate.executableActorIds.length).toBeGreaterThan(0);
          expect(candidate.signals.some((signal) => signal.key === 'critical_operational_evidence')).toBe(true);
        }
        observations += candidates.length;
        formalEvidence += candidates.reduce((sum, candidate) => sum + candidate.sourceFactIds.length, 0);
      }
    }
    expect(observations).toBeGreaterThan(0);
    expect(formalEvidence).toBeGreaterThan(0);
  });
});
