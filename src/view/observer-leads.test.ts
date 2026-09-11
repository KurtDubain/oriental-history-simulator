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
import { playerHistoryText, projectHistoricalScenes, projectSituationHistoricalScenes } from './historical-scenes';
import { projectQuarterPulse } from './quarter-pulse-stories';

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
  function turningWorld() {
    const world = worldAt(12), report = world.lastTurn!, actor = world.characters[0];
    const [parent, next] = world.polities, region = world.regions[0];
    const transfer: Extract<SimulationFact, { kind: 'territory_control_changed' }> = {
      id: 'turning-transfer', turn: report.turn, year: report.year, season: report.season,
      kind: 'territory_control_changed', category: '政治', importance: 5, actorIds: [actor.id],
      polityIds: [parent.id, next.id], regionIds: [region.id], causes: [], sourceFactIds: [],
      stateDeltas: [{ entityType: 'region', entityId: region.id, field: 'controllerId', before: parent.id, after: next.id }],
      payload: { regionId: region.id, previousControllerId: parent.id, nextControllerId: next.id, reason: 'rebellion', warId: 'turning-war' },
    };
    const declaration: Extract<SimulationFact, { kind: 'war_started' }> = { ...transfer, id: 'turning-declaration', kind: 'war_started',
      payload: { warId: 'turning-war', warKind: 'rebellion', attackerId: next.id, defenderId: parent.id,
        goal: '独立', targetRegionIds: [region.id], reason: '地方脱离' } };
    const event = { id: 'turning-event', turn: report.turn, year: report.year, season: report.season,
      kind: 'rebellion', category: '政治' as const, importance: 5 as const,
      title: `${actor.name}据${region.name}起兵`, summary: `${actor.name}建立${next.name}。`,
      sourceFactIds: [declaration.id, transfer.id], actorIds: [actor.id], polityIds: [parent.id, next.id],
      regionIds: [region.id], causes: [], evidence: [], stateDeltas: transfer.stateDeltas, situationIds: [] };
    world.facts = [declaration, transfer]; world.history = [event];
    world.lastTurn = { ...report, factIds: world.facts.map(f => f.id), eventIds: [event.id] };
    world.situationSystem.situations = world.situationSystem.situations.filter(s => s.status === 'open').slice(0, 3);
    return { world, transfer, declaration, event };
  }

  it('lets a directly recorded founding outrank full ongoing slots, once, with matching quarter evidence', () => {
    const { world, transfer, declaration, event } = turningWorld();
    const before = serializeWorld(world), hash = world.hash;
    const ongoing = deriveObserverLeads({ ...world, lastTurn: null });
    expect(ongoing).toHaveLength(3);
    const leads = deriveObserverLeads(world), quarter = projectQuarterPulse(world);
    expect(leads[0].question).toBe(event.title);
    expect(leads[0].target).toEqual({ kind: 'person', id: event.actorIds[0] });
    expect(leads[0].primarySourceFactIds).toEqual(expect.arrayContaining([transfer.id, declaration.id]));
    expect(leads.filter(l => l.primarySourceFactIds.includes(transfer.id))).toHaveLength(1);
    expect(leads.slice(1).some(l => ongoing.some(o => o.situationId === l.situationId))).toBe(true);
    expect(quarter.stories[0]).toMatchObject({ title: event.title, eventId: event.id });
    expect(quarter.stories.filter(s => s.sourceFactIds.includes(transfer.id))).toHaveLength(1);
    expect(serializeWorld(world)).toBe(before); expect(world.hash).toBe(hash);
    expect(deriveObserverLeads({ ...world, facts: [...world.facts].reverse() })).toEqual(leads);
  });

  it('does not infer founding from a shared quarter or region, nor swallow an independent occupation', () => {
    const { world, transfer, event } = turningWorld();
    const unrelated = { ...transfer, id: 'independent-transfer', payload: { ...transfer.payload, reason: 'battle_capture' as const, warId: 'other-war' } };
    world.facts.push(unrelated);
    const scenes = projectHistoricalScenes(world, world.facts, 10, 'active');
    expect(scenes.find(s => s.title === event.title)?.sourceFactIds).not.toContain(unrelated.id);
    expect(scenes.find(s => s.sourceFactIds.includes(unrelated.id))?.title).toContain('易手');
    world.history = [{ ...event, sourceFactIds: [unrelated.id] }];
    expect(projectHistoricalScenes(world, [unrelated], 10, 'active').every(s => !s.title.includes('起兵'))).toBe(true);
  });

  it('retains the stable ongoing selection in an ordinary quarter, while meaningful military orders still compete', () => {
    const { world } = turningWorld(), army = world.armies[0];
    const ordinary = deriveObserverLeads({ ...world, lastTurn: null });
    const order: Extract<SimulationFact, { kind: 'army_order_changed' }> = { ...world.facts[0], id: 'actual-retreat', kind: 'army_order_changed',
      importance: 4, payload: { armyId: army.id, polityId: army.polityId, previous: { ...army.order, kind: 'advance' },
        next: { ...army.order, kind: 'retreat', targetRegionId: army.regionId, reasonCode: 'low_readiness' } },
      stateDeltas: [{ entityType: 'army', entityId: army.id, field: 'order', before: 'advance', after: 'retreat' }] };
    world.history = []; world.facts = [order]; world.lastTurn = { ...world.lastTurn!, factIds: [order.id], eventIds: [] };
    expect(deriveObserverLeads(world).some(l => l.primarySourceFactIds.includes(order.id))).toBe(true);
    world.facts = [{ ...order, importance: 2, stateDeltas: [] }];
    expect(deriveObserverLeads(world).map(l => l.situationId)).toEqual(ordinary.map(l => l.situationId));
  });

  it('does not consume an independent death, accession or dissolution just because founding happens nearby', () => {
    const { world, event } = turningWorld();
    const person = world.characters[2], army = world.armies[0];
    const death: Extract<SimulationFact, { kind: 'character_death' }> = { ...world.facts[0], id: 'independent-death', kind: 'character_death',
      payload: { characterId: person.id, age: person.age, role: '君主', health: 0, diseaseId: null, cause: 'natural' } };
    const appointment = { ...appointmentFact(world, 'independent-accession', 'appointment_started', '军团主帅', person.id, army.id),
      turn: world.lastTurn!.turn, importance: 5 as const, payload: { ...appointmentFact(world, 'seat', 'appointment_started', '军团主帅', person.id, army.id).payload, officeKind: '君主' as const },
      stateDeltas: [{ entityType: 'office' as const, entityId: 'seat', field: 'active', before: false, after: true }] };
    for (const fact of [death, appointment]) {
      const input = { ...world, facts: [...world.facts, fact], lastTurn: { ...world.lastTurn!, factIds: [...world.lastTurn!.factIds, fact.id] } };
      expect(deriveObserverLeads(input).some(l => l.primarySourceFactIds.includes(fact.id))).toBe(true);
    }
    world.history.push({ ...event, id: 'independent-dissolution', kind: 'polity_eliminated', title: '旧国灭亡', sourceFactIds: [] });
    world.lastTurn!.eventIds.push('independent-dissolution');
    expect(projectQuarterPulse(world).stories.some(s => s.title === '旧国灭亡')).toBe(true);
  });

  it('distinguishes participants from soldiers without rewriting the stored army-raised event', () => {
    const { world } = turningWorld();
    const text = '甲在乙集结1人部曲，共7000人。';
    expect(playerHistoryText(world, text)).toBe('甲在乙集结1名军政人物的部曲，共7000名士兵。');
    expect(playerHistoryText(world, '甲集结3人部曲，共9100人。')).toContain('3名军政人物的部曲，共9100名士兵');
    expect(text).toBe('甲在乙集结1人部曲，共7000人。');
  });
  it('does not answer one general’s military story with a supporting character’s unrelated throne appointment', () => {
    const world = worldAt(12), army = world.armies[0], core = army.commanderId;
    const other = world.characters.find(c => c.id !== core && c.polityId === army.polityId)!;
    const situation = { ...world.situationSystem.situations[0], id: 'situation-bound-subject', type: 'military_power_crisis' as const,
      status: 'open' as const, phase: 'critical' as const, visibility: 100, startedTurn: world.turn, lastUpdatedTurn: world.turn,
      participants: { ...world.situationSystem.situations[0].participants, coreCharacterIds: [core],
        supportingCharacterIds: [other.id], opposingCharacterIds: [], armyIds: [army.id], polityIds: [army.polityId] } };
    const proper = appointmentFact(world, 'fact_subject_1', 'appointment_started', '军团主帅', core, army.id);
    const unrelated = { ...proper, id: 'fact_subject_2', importance: 5 as const,
      payload: { ...proper.payload, officeKind: '君主' as const, holderId: other.id, armyId: null } };
    world.facts = [proper, unrelated];
    world.situationSystem.situations = [situation];
    const scenes = projectSituationHistoricalScenes(world, situation);
    expect(scenes.some(s => s.sourceFactIds.includes(unrelated.id))).toBe(false);
    const lead = deriveObserverLeads(world).find(l => l.situationId === situation.id)!;
    expect(lead.question).toContain(world.characters.find(c => c.id === core)!.name);
    expect(lead.primarySourceFactIds).toContain(proper.id);
    expect(lead.evidence.join('')).not.toContain('出任于洛阳君主');
  });
  it('does not manufacture an opening question before a Situation or current Fact exists', () => {
    const world = createWorld('当世三问-如实留空');

    expect(world.lastTurn).toBeNull();
    expect(deriveObserverLeads(world)).toEqual([]);
    expect(deriveObserverLeadProjection(world)).toEqual({ leads: [] });
  });

  it('selects at most three visible open Situations by phase, importance, tension, age and stable id', () => {
    const base = worldAt(16, '当世三问-稳定排序');
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

  it('never repeats one principal historical scene or Fact across Situations and appointment fallbacks', () => {
    let world = createWorld('沧衡-甲子', 'contest-v01');
    for (let turn = 1; turn <= 12; turn += 1) {
      world = advanceWorld(world);
      const leads = deriveObserverLeads(world);
      expect(new Set(leads.map((lead) => lead.primarySceneId)).size).toBe(leads.length);
      for (let index = 0; index < leads.length; index += 1) {
        for (let other = index + 1; other < leads.length; other += 1) {
          const otherFacts = new Set(leads[other].primarySourceFactIds);
          expect(leads[index].primarySourceFactIds.some((id) => otherFacts.has(id))).toBe(false);
        }
      }
    }
    const leads = deriveObserverLeads(world);
    expect(leads.length).toBeGreaterThan(1);
    expect(new Set(leads.map((lead) => lead.primarySceneId)).size).toBe(leads.length);
  });

  it('leads with the latest scene from the same war, never an indirect Agency scene', () => {
    const base = contestWorldAt(12);
    const situation = base.situationSystem.situations.find((item) => {
      if (item.status !== 'open' || item.type !== 'war_progress') return false;
      const scenes = projectSituationHistoricalScenes(base, item, 24, null, 'active');
      return scenes.some((scene) => scene.id.startsWith('scene:war:'));
    });
    expect(situation).toBeDefined();
    const world = withSituations(base, [situation as SituationState]);
    const lead = deriveObserverLeads(world)[0];
    const sourceKinds = new Set(base.facts
      .filter((fact) => lead.primarySourceFactIds.includes(fact.id))
      .map((fact) => fact.kind));

    expect(lead.question).not.toMatch(/目前打到哪里|为何|进程|？/u);
    expect(lead.primarySceneId).toMatch(/^scene:war:/u);
    expect([...sourceKinds].every((kind) => ['battle', 'territory_control_changed', 'war_started', 'war_ended'].includes(kind))).toBe(true);
    expect(lead.evidence.join('')).not.toMatch(/请令|未准|未应允/u);
  });

  it('never uses an unrelated battle as inheritance evidence even when it is listed as causal', () => {
    const base = contestWorldAt(12);
    const battle = base.facts.find((fact) => fact.kind === 'battle');
    const source = base.situationSystem.situations[0];
    if (!battle || !source) throw new Error('expected a battle and a Situation');
    const polityId = battle.polityIds[0] ?? base.polities[0].id;
    const actorId = battle.actorIds[0] ?? base.polities.find((item) => item.id === polityId)?.rulerId ?? base.characters[0].id;
    const inheritance: SituationState = {
      ...source,
      id: 'situation-test-inheritance-no-battle',
      type: 'inheritance_crisis',
      scopeKey: polityId,
      titleKey: 'situation.inheritance_crisis',
      participants: {
        ...source.participants,
        coreCharacterIds: [actorId],
        polityIds: [polityId],
        armyIds: [],
        fleetIds: [],
      },
      causalFactIds: [battle.id],
      milestoneFactIds: [battle.id],
      recentChanges: [{
        turn: battle.turn,
        kind: 'phase_changed',
        tension: source.tension,
        fromPhase: 'emerging',
        toPhase: source.phase,
        sourceFactIds: [battle.id],
      }],
    };

    const scenes = projectSituationHistoricalScenes(base, inheritance, 24, null, 'active');
    expect(scenes.flatMap((scene) => scene.sourceFactIds)).not.toContain(battle.id);
    const lead = deriveObserverLeads(withSituations(base, [inheritance]))[0];
    expect(lead?.primarySourceFactIds).not.toContain(battle.id);
    expect(lead?.evidence.join('')).not.toContain('之战');
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

  it('merges a same-seat appointment transfer, names both holders and stays deterministic', () => {
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
    expect(majorLeads[0].question).toContain('受任');

    const ended = appointmentFact(base, 'fact-test-a-ended', 'appointment_ended', '军团副将', holders[0].id, armies[0].id);
    const isolated = deriveObserverLeads(withCurrentFacts(base, [ended]));
    expect(isolated).toEqual([]);
    const successor = appointmentFact(base, 'fact-test-b-started', 'appointment_started', '军团副将', holders[1].id, armies[0].id);
    const successionLeads = deriveObserverLeads(withCurrentFacts(base, [ended, successor]));
    const reversed = deriveObserverLeads(withCurrentFacts(base, [successor, ended]));
    expect(successionLeads).toHaveLength(1);
    expect(reversed).toEqual(successionLeads);
    expect(successionLeads[0].question).toContain('军团副将');
    expect(successionLeads[0].evidence[0]).toContain(holders[0].name);
    expect(successionLeads[0].evidence[0]).toContain(holders[1].name);
    expect(successionLeads[0].evidence[0]).toContain('兵权已完成交接');
    expect(successionLeads[0].primarySourceFactIds).toEqual([ended.id, successor.id]);
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
    expect(first.every((item) => item.evidence.length === 2 && !item.question.endsWith('？'))).toBe(true);
    expect(first.every((item) => !/为何|进程|卡在哪里/u.test(item.question))).toBe(true);
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
    const lead = deriveObserverLeads(world).find((item) => item.situationId && item.primarySceneId?.startsWith('scene:') && item.recentChange?.includes(' · '));
    if (!lead?.situationId || !lead.recentChange) throw new Error('expected a scene-backed Situation lead');
    const situation = world.situationSystem.situations.find((item) => item.id === lead.situationId);
    if (!situation) throw new Error(`missing Situation ${lead.situationId}`);
    const scene = projectSituationHistoricalScenes(world, situation, 24, null, 'active').find(item => item.id === lead.primarySceneId);
    if (!scene) throw new Error('expected a concrete historical scene');

    expect(lead.recentChange).toBe(`${scene.dateLabel} · ${scene.title}`);
    expect(lead.evidence).not.toContain(lead.recentChange);
    expect(lead.evidence[0]).toBe(scene.summary);
    expect(new Set([lead.recentChange, ...lead.evidence]).size).toBe(3);
  });
});
