import { describe, expect, it } from 'vitest';
import { advanceWorld, createWorld, serializeWorld } from '../sim';
import type { SituationState } from '../sim/situations';
import type { SimulationFact, WorldState } from '../sim/types';
import {
  OBSERVER_LEAD_RESOLUTION_ECHO_TURNS,
  OBSERVER_LEAD_VISIBILITY_THRESHOLD,
  deriveObserverLeadProjection,
  deriveObserverLeads,
} from './observer-leads';
import { projectSituationHistoricalScenes } from './historical-scenes';

function worldAt(turn: number, seed = '春战副将'): WorldState {
  let world = createWorld(seed);
  while (world.turn < turn) world = advanceWorld(world);
  return world;
}

function contestWorldAt(turn: number, seed = '沧衡-甲子'): WorldState {
  let world = createWorld(seed, 'contest-v01');
  while (world.turn < turn) world = advanceWorld(world);
  return world;
}

function targetExists(world: WorldState, kind: string, id: string): boolean {
  if (kind === 'person') return world.characters.some((item) => item.id === id);
  if (kind === 'country') return world.polities.some((item) => item.id === id);
  return world.regions.some((item) => item.id === id);
}

function withSituations(
  world: WorldState,
  situations: readonly SituationState[],
  turn = world.turn,
  lastTurn: WorldState['lastTurn'] = world.lastTurn,
): WorldState {
  return {
    ...world,
    turn,
    lastTurn,
    hash: `observer-leads-controlled-${turn}`,
    situationSystem: { ...world.situationSystem, situations },
  };
}

function openSituation(
  source: SituationState,
  values: Pick<SituationState, 'phase' | 'importance' | 'tension' | 'startedTurn'>,
): SituationState {
  return {
    ...source,
    ...values,
    status: 'open',
    resolvedTurn: null,
    resolution: null,
    visibility: 100,
  };
}

function resolvedSituation(source: SituationState, resolvedTurn: number): SituationState {
  return {
    ...source,
    status: 'resolved',
    resolvedTurn,
    resolution: {
      outcomeKey: source.type === 'war_progress' ? 'negotiated_peace' : 'stabilized',
      resolvedTurn,
      resultFactIds: [],
      belowThresholdTurns: 1,
      finalSnapshotDigest: `observer-echo-${source.id}`,
    },
    visibility: 100,
  };
}

function appointmentFact(
  world: WorldState,
  id: string,
  kind: 'appointment_started' | 'appointment_ended',
  officeKind: '军团主帅' | '军团副将',
  holderId: string,
  armyId: string,
): Extract<SimulationFact, { kind: 'appointment_started' | 'appointment_ended' }> {
  const polityId = world.armies.find((army) => army.id === armyId)?.polityId ?? world.polities[0].id;
  return {
    id,
    turn: world.turn,
    year: world.year,
    season: world.season,
    kind,
    category: '政治',
    importance: 3,
    actorIds: [holderId],
    polityIds: [polityId],
    regionIds: [],
    causes: [],
    stateDeltas: [],
    sourceFactIds: [],
    payload: {
      appointmentId: `${id}:office`,
      action: kind === 'appointment_started' ? 'started' : 'ended',
      officeKind,
      holderId,
      polityId,
      regionId: null,
      armyId,
      fleetId: null,
      rank: officeKind === '军团主帅' ? 90 : 70,
    },
  };
}

function withCurrentFacts(world: WorldState, facts: readonly SimulationFact[]): WorldState {
  if (!world.lastTurn) throw new Error('expected an advanced world');
  return withSituations({
    ...world,
    facts: [...world.facts, ...facts],
  }, [], world.turn, { ...world.lastTurn, factIds: facts.map((fact) => fact.id) });
}

function lowSupplyBattleFact(world: WorldState): Extract<SimulationFact, { kind: 'battle' }> {
  if (!world.lastTurn) throw new Error('expected an advanced world');
  const attacker = world.armies[0];
  const defender = world.armies.find((army) => army.polityId !== attacker.polityId) ?? world.armies[1];
  const region = world.regions.find((item) => item.controllerId === defender.polityId) ?? world.regions[0];
  const snapshot = (army: typeof attacker, supplyBefore: number) => ({
    armyId: army.id, polityId: army.polityId, commanderId: army.commanderId,
    deputyCommanderId: army.deputyCommanderId, soldiersBefore: army.soldiers,
    soldiersAfter: Math.max(0, army.soldiers - 300), moraleBefore: army.morale,
    moraleAfter: Math.max(0, army.morale - 8), trainingBefore: army.training,
    supplyBefore, losses: 300,
  });
  return {
    id: 'fact-test-low-supply-battle', turn: world.lastTurn.turn, year: world.lastTurn.year,
    season: world.lastTurn.season, kind: 'battle', category: '军事', importance: 3,
    actorIds: [attacker.commanderId, defender.commanderId], polityIds: [attacker.polityId, defender.polityId],
    regionIds: [region.id], causes: [{ label: '结算前补给士气', weight: 1, evidence: '攻方补给22已进入战力结算' }],
    stateDeltas: [{ entityType: 'army', entityId: attacker.id, field: 'soldiers', before: attacker.soldiers, after: attacker.soldiers - 300, delta: -300 }],
    sourceFactIds: [],
    payload: {
      warId: world.wars[0]?.id ?? 'war-test', targetRegionId: region.id,
      routeId: world.routes[0].id, attackerWon: false, attackerPower: 1200, defenderPower: 1800,
      militiaLosses: 0, attacker: snapshot(attacker, 22), defenders: [snapshot(defender, 90)],
    },
  };
}

describe('observer story leads', () => {
  it('does not manufacture an opening question before a Situation or current Fact exists', () => {
    const world = createWorld('当世三问-如实留空');

    expect(world.lastTurn).toBeNull();
    expect(deriveObserverLeads(world)).toEqual([]);
    expect(deriveObserverLeadProjection(world)).toEqual({ leads: [] });
  });

  it('selects at most three visible open Situations by phase, importance, tension, age and stable id', () => {
    const base = worldAt(8, '当世三问-稳定排序');
    const natural = base.situationSystem.situations.filter((item) => item.status === 'open');
    expect(natural.length).toBeGreaterThanOrEqual(4);
    const [first, second, third, fourth] = natural;
    const candidates = [
      openSituation(first, { phase: 'emerging', importance: 100, tension: 100, startedTurn: 1 }),
      openSituation(second, { phase: 'critical', importance: 70, tension: 60, startedTurn: 3 }),
      openSituation(third, { phase: 'active', importance: 100, tension: 100, startedTurn: 1 }),
      openSituation(fourth, { phase: 'critical', importance: 70, tension: 80, startedTurn: 4 }),
      { ...openSituation(first, { phase: 'critical', importance: 100, tension: 100, startedTurn: 0 }), id: 'situation_hidden', visibility: OBSERVER_LEAD_VISIBILITY_THRESHOLD - 1 },
    ];
    const world = withSituations(base, candidates, base.turn, null);
    const reversed = withSituations(base, [...candidates].reverse(), base.turn, null);
    const expectedIds = [fourth.id, second.id, third.id].map((id) => `lead-situation:${id}`);

    expect(deriveObserverLeads(world).map((item) => item.id)).toEqual(expectedIds);
    expect(deriveObserverLeads(reversed)).toEqual(deriveObserverLeads(world));
    expect(deriveObserverLeads(world)).toHaveLength(3);
  });

  it('never repeats one principal historical scene or Fact across three different Situations', () => {
    const world = contestWorldAt(12);
    const leads = deriveObserverLeads(world);

    expect(leads.length).toBeGreaterThan(1);
    expect(new Set(leads.map((lead) => lead.primarySceneId)).size).toBe(leads.length);
    for (let index = 0; index < leads.length; index += 1) {
      for (let other = index + 1; other < leads.length; other += 1) {
        const otherFacts = new Set(leads[other].primarySourceFactIds);
        expect(leads[index].primarySourceFactIds.some((id) => otherFacts.has(id))).toBe(false);
      }
    }
    expect(leads.filter((lead) => lead.recentChange?.includes('雪塞之战'))).toHaveLength(1);
  });

  it('uses a one-quarter resolved echo only to fill an open-story vacancy', () => {
    const base = worldAt(8, '当世三问-结案回响');
    const natural = base.situationSystem.situations.filter((item) => item.status === 'open');
    expect(natural.length).toBeGreaterThanOrEqual(3);
    const open = openSituation(natural[0], { phase: 'emerging', importance: 1, tension: 1, startedTurn: 8 });
    const echo = resolvedSituation({ ...natural[1], phase: 'critical', importance: 100, tension: 100 }, 9);
    const expired = resolvedSituation({ ...natural[2], phase: 'critical', importance: 100, tension: 100 }, 8);
    const turn10 = withSituations(base, [expired, echo, open], 10, null);

    expect(deriveObserverLeads(turn10).map((item) => [item.id, item.displayMode])).toEqual([
      [`lead-situation:${open.id}`, 'tracking'],
      [`lead-situation:${echo.id}`, 'resolution_echo'],
    ]);
    const turn11 = withSituations(base, [expired, echo, open], 11, null);
    expect(deriveObserverLeads(turn11).map((item) => item.id)).toEqual([`lead-situation:${open.id}`]);
    expect(OBSERVER_LEAD_RESOLUTION_ECHO_TURNS).toBe(1);
  });

  it('fills vacancies from current-quarter war or court Facts without creating another ledger', () => {
    const base = worldAt(3, '当世三问-事实补位');
    const world = withSituations(base, []);
    const currentFactIds = new Set(world.lastTurn?.factIds ?? []);
    const leads = deriveObserverLeads(world);

    expect(leads.length).toBeGreaterThan(0);
    expect(leads.length).toBeLessThanOrEqual(3);
    expect(leads.every((item) => item.source === 'fact' && item.displayMode === 'fact')).toBe(true);
    expect(leads.every((item) => item.factId && currentFactIds.has(item.factId))).toBe(true);
    expect(leads.every((item) => item.situationId === null && item.situationType === null)).toBe(true);
    expect(leads.every((item) => !item.question.includes('结果如何'))).toBe(true);
  });

  it('uses a verified low-supply Battle Fact as the second evidence line without changing its principal scene identity', () => {
    const base = worldAt(3, '当世三问-军政牵动');
    const fact = lowSupplyBattleFact(base);
    const world = withCurrentFacts(base, [fact]);
    const plain = deriveObserverLeads(world)[0];
    const enriched = deriveObserverLeadProjection(world).leads[0];

    expect(enriched.primarySceneId).toBe(plain.primarySceneId);
    expect(enriched.primarySourceFactIds).toEqual([fact.id]);
    expect(enriched.evidence[1]).toContain('军政牵动');
    expect(enriched.evidence[1]).toContain('补给22');
  });

  it('asks what changed after appointments, caps them at one, and omits an isolated ordinary departure', () => {
    const base = worldAt(3, '当世三问-任免补位');
    const armies = base.armies.slice(0, 3);
    const holders = base.characters.slice(0, 3);
    expect(armies).toHaveLength(3);
    expect(holders).toHaveLength(3);
    const majorAppointments = armies.map((army, index) => appointmentFact(
      base,
      `fact-test-major-${index}`,
      'appointment_started',
      '军团主帅',
      holders[index].id,
      army.id,
    ));
    const majorLeads = deriveObserverLeads(withCurrentFacts(base, majorAppointments));
    expect(majorLeads).toHaveLength(1);
    expect(majorLeads[0].question).toContain('兵权或朝局怎样变化');

    const ended = appointmentFact(base, 'fact-test-a-ended', 'appointment_ended', '军团副将', holders[0].id, armies[0].id);
    const isolated = deriveObserverLeads(withCurrentFacts(base, [ended]));
    expect(isolated).toEqual([]);
    const successor = appointmentFact(base, 'fact-test-b-started', 'appointment_started', '军团副将', holders[1].id, armies[0].id);
    const successionLeads = deriveObserverLeads(withCurrentFacts(base, [ended, successor]));
    expect(successionLeads).toHaveLength(1);
    expect(successionLeads[0].question).toContain('谁接掌其权');
    expect(successionLeads[0].question).not.toContain('结果如何');
  });

  it('is deterministic, fact-backed and read-only for the same authoritative world', () => {
    const world = worldAt(8);
    const hash = world.hash;
    const before = serializeWorld(world);
    const first = deriveObserverLeads(world);
    const repeated = deriveObserverLeads(world);
    const shuffled = deriveObserverLeads({
      ...world,
      situationSystem: {
        ...world.situationSystem,
        situations: [...world.situationSystem.situations].reverse(),
      },
    });

    expect(first).toEqual(repeated);
    expect(shuffled).toEqual(first);
    expect(new Set(first.map((item) => item.id)).size).toBe(first.length);
    expect(new Set(first.map((item) => item.primarySceneId)).size).toBe(first.length);
    expect(first.every((item) => item.evidence.length === 2 && item.question.endsWith('？'))).toBe(true);
    expect(first.every((item) => targetExists(world, item.target.kind, item.target.id))).toBe(true);
    for (const lead of first.filter((item) => item.situationId)) {
      const situation = world.situationSystem.situations.find((item) => item.id === lead.situationId);
      expect(situation?.status === 'open'
        || (situation?.resolvedTurn !== null && world.turn - (situation?.resolvedTurn ?? -10) <= 1)).toBe(true);
    }
    expect(world.hash).toBe(hash);
    expect(serializeWorld(world)).toBe(before);
  });

  it('shows a concrete Situation scene headline once and keeps its result as evidence', () => {
    const world = worldAt(8);
    const lead = deriveObserverLeads(world).find((item) => item.situationId && item.recentChange?.includes(' · '));
    if (!lead?.situationId || !lead.recentChange) throw new Error('expected a scene-backed Situation lead');
    const situation = world.situationSystem.situations.find((item) => item.id === lead.situationId);
    if (!situation) throw new Error(`missing Situation ${lead.situationId}`);
    const scene = projectSituationHistoricalScenes(world, situation, 1, null, 'active')[0];
    if (!scene) throw new Error('expected a concrete historical scene');

    expect(lead.recentChange).toBe(`${scene.dateLabel} · ${scene.title}`);
    expect(lead.evidence).not.toContain(lead.recentChange);
    expect(lead.evidence[0]).toBe(scene.summary);
    expect(new Set([lead.recentChange, ...lead.evidence]).size).toBe(3);
  });
});
