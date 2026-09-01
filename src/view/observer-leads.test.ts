import { describe, expect, it } from 'vitest';
import { advanceWorld, createWorld } from '../sim';
import type { SituationState } from '../sim/situations';
import type { WarState, WorldState } from '../sim/types';
import {
  OBSERVER_LEAD_CHALLENGER_TURNS,
  OBSERVER_LEAD_RESOLUTION_ECHO_TURNS,
  OBSERVER_LEAD_VISIBILITY_THRESHOLD,
  deriveObserverLeadProjection,
  deriveObserverLeads,
  type ObserverLeadContinuityState,
  type ObserverLeadProjection,
  type ObserverLeadSlot,
} from './observer-leads';
import { projectSituationHistoricalScenes } from './historical-scenes';
import { projectSituationSystemSnapshot } from './situation-snapshot';

function targetExists(world: WorldState, kind: string, id: string): boolean {
  if (kind === 'person') return world.characters.some((item) => item.id === id);
  if (kind === 'country') return world.polities.some((item) => item.id === id);
  if (kind === 'region') return world.regions.some((item) => item.id === id);
  if (kind === 'outbreak') return world.infections.some((item) => item.id === id);
  if (kind === 'seaZone') return world.seaZones.some((item) => item.id === id);
  return false;
}

function leadAt(projection: ObserverLeadProjection, slot: ObserverLeadSlot) {
  const lead = projection.leads.find((item) => item.slot === slot);
  if (!lead) throw new Error(`expected ${slot} observer lead`);
  return lead;
}

function fixedWorldsThrough(turn: number, seed = '春战副将'): Map<number, WorldState> {
  const worlds = new Map<number, WorldState>();
  let world = createWorld(seed);
  worlds.set(0, world);
  while (world.turn < turn) {
    world = advanceWorld(world);
    worlds.set(world.turn, world);
  }
  return worlds;
}

function controlledWorld(
  base: WorldState,
  turn: number,
  situations: readonly SituationState[],
  label: string,
): WorldState {
  return {
    ...base,
    turn,
    hash: `observer-leads-${label}-${turn}`,
    situationSystem: {
      ...base.situationSystem,
      lastReducedTurn: turn - 1,
      situations,
    },
  };
}

function tunedWarSituation(
  source: SituationState,
  strength: 'high' | 'low',
  turn: number,
): SituationState {
  const high = strength === 'high';
  return {
    ...source,
    status: 'open',
    phase: high ? 'critical' : 'active',
    phaseSinceTurn: Math.min(source.phaseSinceTurn, turn),
    lastUpdatedTurn: turn,
    resolvedTurn: null,
    tension: high ? 100 : 40,
    momentum: 0,
    resolution: null,
    importance: high ? 100 : 40,
    visibility: 100,
  };
}

function warPair(base: WorldState): [SituationState, SituationState] {
  const wars = base.situationSystem.situations.filter((item) => item.type === 'war_progress');
  if (wars.length < 2) throw new Error('expected two natural war-progress Situations');
  return [wars[0], wars[1]];
}

function matureContinuity(
  projection: ObserverLeadProjection,
  slot: ObserverLeadSlot,
  selectedSinceTurn: number,
): ObserverLeadContinuityState {
  return {
    ...projection.continuity,
    slots: projection.continuity.slots.map((entry) => entry.slot === slot ? {
      ...entry,
      selectedSinceTurn,
      retainThroughTurn: selectedSinceTurn + 2,
      challengerId: null,
      challengerAheadTurns: 0,
    } : { ...entry }),
  };
}

describe('observer story leads', () => {
  it('switches from legacy fallbacks to matching Situation sources at fixed turns T0/T4/T6/T8', () => {
    const worlds = fixedWorldsThrough(8);
    const at = (turn: number) => {
      const world = worlds.get(turn);
      if (!world) throw new Error(`missing fixed world T${turn}`);
      return deriveObserverLeadProjection(world);
    };

    expect(at(0).leads.map((lead) => [lead.slot, lead.source, lead.situationId])).toEqual([
      ['person', 'fallback', null],
      ['polity', 'fallback', null],
      ['tension', 'fallback', null],
    ]);
    const turn4 = at(4);
    expect(turn4.leads.map((lead) => [lead.slot, lead.source, lead.situationType])).toEqual([
      ['person', 'fallback', null],
      ['polity', 'situation', 'court_power_struggle'],
      ['tension', 'situation', 'war_progress'],
    ]);
    expect(turn4.leads.find((lead) => lead.situationType === 'court_power_struggle')).toMatchObject({
      target: { kind: 'country' },
      overlay: 'political',
    });
    const courtLead = turn4.leads.find((lead) => lead.situationType === 'court_power_struggle');
    const world4 = worlds.get(4) as WorldState;
    const courtSnapshot = projectSituationSystemSnapshot(world4.situationSystem, world4).open
      .find((item) => item.id === courtLead?.situationId);
    const actualRootLabels = courtSnapshot?.evidence
      .filter((entry) => entry.contribution > 0 && [
        'challenger_central_office',
        'challenger_regional_office',
        'challenger_military_command',
        'challenger_family_renown',
        'challenger_alliance_support',
        'challenger_cohesion',
      ].includes(entry.key))
      .map((entry) => entry.label) ?? [];
    expect(actualRootLabels.length).toBeGreaterThan(0);
    expect(actualRootLabels.some((label) => courtLead?.question.includes(label))).toBe(true);
    for (const turn of [6, 8]) {
      const leads = at(turn).leads;
      const polityLead = leads.find((lead) => lead.slot === 'polity');
      expect(polityLead?.source).toBe('situation');
      expect(['inheritance_crisis', 'court_power_struggle']).toContain(polityLead?.situationType);
      expect(leads.find((lead) => lead.slot === 'tension')).toMatchObject({ source: 'situation', situationType: 'war_progress' });
      const personLead = leads.find((lead) => lead.slot === 'person');
      expect(personLead?.source === 'fallback' || personLead?.situationType === 'military_power_crisis').toBe(true);
    }

    const world8 = worlds.get(8) as WorldState;
    for (const lead of at(8).leads) {
      if (lead.situationId) expect(world8.situationSystem.situations.some((item) => item.id === lead.situationId && item.status === 'open')).toBe(true);
      expect(targetExists(world8, lead.target.kind, lead.target.id)).toBe(true);
    }
  });

  it('uses a Situation scene headline once, then keeps its summary and concrete context as evidence', () => {
    const world = fixedWorldsThrough(8).get(8) as WorldState;
    const projection = deriveObserverLeadProjection(world);
    const situationLeads = projection.leads.filter((lead) => lead.situationId);
    let sceneLeadCount = 0;

    expect(situationLeads.length).toBeGreaterThan(0);
    for (const lead of situationLeads) {
      const situation = world.situationSystem.situations.find((item) => item.id === lead.situationId);
      if (!situation) throw new Error(`missing Situation ${lead.situationId}`);
      const scene = projectSituationHistoricalScenes(world, situation, 1, null, 'active')[0];
      if (!scene) continue;
      sceneLeadCount += 1;
      const headline = `${scene.dateLabel} · ${scene.title}`;

      expect(lead.recentChange).toBe(headline);
      expect(lead.evidence).not.toContain(headline);
      expect(lead.evidence[0]).toBe(scene.summary);
      expect(lead.evidence.every((line) => line.trim().length > 0)).toBe(true);
      expect(new Set([lead.recentChange, ...lead.evidence]).size).toBe(3);
    }
    expect(sceneLeadCount).toBeGreaterThan(0);
  });

  it('is idempotent on the same turn and never mutates the authoritative world or hash', () => {
    const world = fixedWorldsThrough(8).get(8) as WorldState;
    const hash = world.hash;
    const serialized = JSON.stringify(world);
    const first = deriveObserverLeadProjection(world);
    const repeated = deriveObserverLeadProjection(world, first.continuity);
    const withoutChronicle = deriveObserverLeadProjection({ ...world, history: [] });
    const withShuffledCandidates = deriveObserverLeadProjection({
      ...world,
      situationSystem: {
        ...world.situationSystem,
        situations: [...world.situationSystem.situations].reverse(),
      },
    });

    expect(repeated).toEqual(first);
    expect(withoutChronicle.leads).toEqual(first.leads);
    expect(withShuffledCandidates.leads).toEqual(first.leads);
    expect(deriveObserverLeads(world)).toEqual(deriveObserverLeads(world));
    expect(first.leads.map((item) => item.slot)).toEqual(['person', 'polity', 'tension']);
    expect(first.leads.every((item) => item.question.endsWith('？'))).toBe(true);
    expect(first.leads.every((item) => item.evidence.length === 2 && item.nextSignal.length > 0)).toBe(true);
    expect(first.leads.every((item) => item.tension >= 0 && item.tension <= 100)).toBe(true);
    expect(first.leads.every((item) => targetExists(world, item.target.kind, item.target.id))).toBe(true);
    expect(first.leads.every((item) => item.overlay !== ('conflict' as string))).toBe(true);
    expect(world.hash).toBe(hash);
    expect(JSON.stringify(world)).toBe(serialized);
  });

  it('keeps a newly selected Situation for its complete three-quarter minimum tenure', () => {
    const worlds = fixedWorldsThrough(6);
    let world = worlds.get(4) as WorldState;
    let projection = deriveObserverLeadProjection(world);
    const initial = leadAt(projection, 'tension');

    expect(initial.source).toBe('situation');
    expect(initial.selectedSinceTurn).toBe(4);
    expect(initial.retainThroughTurn).toBe(6);
    for (const turn of [5, 6]) {
      const nextWorld = worlds.get(turn) as WorldState;
      projection = deriveObserverLeadProjection(nextWorld, projection.continuity, world.hash);
      world = nextWorld;
      const current = leadAt(projection, 'tension');
      expect(current.id).toBe(initial.id);
      expect(current.selectedSinceTurn).toBe(4);
      expect(current.retainThroughTurn).toBe(6);
      expect(current.trackingTurns).toBe(turn - 3);
    }
  });

  it('requires the same critical challenger to lead for two consecutive quarters before replacement', () => {
    const base = fixedWorldsThrough(8).get(8) as WorldState;
    const [firstWar, secondWar] = warPair(base);
    const world8 = controlledWorld(base, 8, [
      tunedWarSituation(firstWar, 'high', 8),
      tunedWarSituation(secondWar, 'low', 8),
    ], 'challenger-a');
    const initial = deriveObserverLeadProjection(world8);
    const incumbent = leadAt(initial, 'tension');
    const continuity = matureContinuity(initial, 'tension', 4);

    const world9 = controlledWorld(base, 9, [
      tunedWarSituation(firstWar, 'low', 9),
      tunedWarSituation(secondWar, 'high', 9),
    ], 'challenger-b');
    const pending = deriveObserverLeadProjection(world9, continuity, world8.hash);
    const pendingLead = leadAt(pending, 'tension');
    const pendingEntry = pending.continuity.slots.find((entry) => entry.slot === 'tension');
    expect(pendingLead.id).toBe(incumbent.id);
    expect(pendingLead.arbitrationReason).toBe('critical_challenger_pending');
    expect(pendingEntry).toMatchObject({
      challengerId: `lead-situation:${secondWar.id}`,
      challengerAheadTurns: 1,
    });

    const world10 = controlledWorld(base, 10, [
      tunedWarSituation(firstWar, 'low', 10),
      tunedWarSituation(secondWar, 'high', 10),
    ], 'challenger-c');
    const replaced = deriveObserverLeadProjection(world10, pending.continuity, world9.hash);
    expect(leadAt(replaced, 'tension')).toMatchObject({
      id: `lead-situation:${secondWar.id}`,
      arbitrationReason: 'critical_challenger',
      selectedSinceTurn: 10,
    });
    expect(OBSERVER_LEAD_CHALLENGER_TURNS).toBe(2);
  });

  it('does not silently replace earlier slots when a later diversity-conflicting slot is retained', () => {
    const base = fixedWorldsThrough(8, '兵权入世').get(8) as WorldState;
    const military = base.situationSystem.situations.filter((item) => item.type === 'military_power_crisis');
    const inheritance = base.situationSystem.situations.find((item) => item.type === 'inheritance_crisis');
    const wars = base.situationSystem.situations.filter((item) => item.type === 'war_progress');
    if (military.length < 1 || !inheritance || wars.length < 2) {
      throw new Error('expected a military, one inheritance, and two war Situations');
    }
    const militarySources = [military[0], military[1] ?? { ...military[0], id: 'situation_cross_slot_military_challenger' }];
    const polityIds = base.polities.filter((item) => item.alive).slice(0, 4).map((item) => item.id);
    const regionIds = base.regions.slice(0, 4).map((item) => item.id);
    const characterIds = base.characters.filter((item) => item.alive).slice(0, 2).map((item) => item.id);
    if (polityIds.length < 4 || regionIds.length < 4 || characterIds.length < 2) {
      throw new Error('expected enough durable participants for diversity fixture');
    }
    const [polityA, polityB, polityC, polityD] = polityIds;
    const [regionR, regionS, regionX, regionY] = regionIds;
    const [characterA, characterB] = characterIds;
    const participants = (
      coreCharacterId: string | null,
      polityId: string,
      regionId: string,
    ): SituationState['participants'] => ({
      coreCharacterIds: coreCharacterId ? [coreCharacterId] : [],
      supportingCharacterIds: [],
      opposingCharacterIds: [],
      familyIds: [],
      factionIds: [],
      polityIds: [polityId],
      regionIds: [regionId],
      armyIds: [],
      fleetIds: [],
    });
    const ranked = (
      source: SituationState,
      id: string,
      tension: number,
      importance: number,
      participantSet: SituationState['participants'],
    ): SituationState => ({
      ...source,
      id,
      status: 'open',
      phase: tension >= 80 ? 'critical' : 'active',
      resolvedTurn: null,
      tension,
      momentum: 0,
      resolution: null,
      importance,
      visibility: 100,
      participants: participantSet,
    });

    // P1/Q1 each overlap the incumbent T1, while P2/Q2 each overlap challenger T2.
    // With all slots free, P1/Q1/T2 is optimal; forcing retained T1 makes P2/Q2/T1
    // optimal. The old one-pass loop therefore changed P1 and Q1 after marking them
    // stable. The two-stage arbiter must freeze their evaluated decisions first.
    const p1Participants = participants(characterA, polityA, regionS);
    const p2Participants = participants(characterB, polityC, regionY);
    const q1Participants = participants(null, polityB, regionR);
    const q2Participants = participants(null, polityD, regionX);
    const t1Participants = participants(null, polityA, regionR);
    const t2Participants = participants(null, polityC, regionX);
    const p1Id = militarySources[0].id;
    const p2Id = militarySources[1].id;
    const q1Id = inheritance.id;
    const q2Id = 'situation_cross_slot_inheritance_challenger';
    const t1Id = wars[0].id;
    const t2Id = wars[1].id;

    const world8 = controlledWorld(base, 8, [
      ranked(militarySources[0], p1Id, 100, 100, p1Participants),
      ranked(militarySources[1], p2Id, 40, 40, p2Participants),
      ranked(inheritance, q1Id, 100, 100, q1Participants),
      ranked({ ...inheritance, scopeKey: polityD }, q2Id, 40, 40, q2Participants),
      ranked(wars[0], t1Id, 100, 100, t1Participants),
      ranked(wars[1], t2Id, 40, 40, t2Participants),
    ], 'cross-slot-a');
    const initial = deriveObserverLeadProjection(world8);
    expect(initial.leads.map((lead) => lead.id)).toEqual([
      `lead-situation:${p1Id}`,
      `lead-situation:${q1Id}`,
      `lead-situation:${t1Id}`,
    ]);

    const world9 = controlledWorld(base, 9, [
      ranked(militarySources[0], p1Id, 90, 90, p1Participants),
      ranked(militarySources[1], p2Id, 88, 88, p2Participants),
      ranked(inheritance, q1Id, 90, 90, q1Participants),
      ranked({ ...inheritance, scopeKey: polityD }, q2Id, 88, 88, q2Participants),
      ranked(wars[0], t1Id, 40, 40, t1Participants),
      ranked(wars[1], t2Id, 100, 100, t2Participants),
    ], 'cross-slot-b');
    const next = deriveObserverLeadProjection(world9, initial.continuity, world8.hash);
    const expected = [
      { slot: 'person', id: `lead-situation:${p1Id}`, decision: 'incumbent_stable' },
      { slot: 'polity', id: `lead-situation:${q1Id}`, decision: 'incumbent_stable' },
      { slot: 'tension', id: `lead-situation:${t1Id}`, decision: 'minimum_tenure' },
    ] as const;

    for (const item of expected) {
      const lead = leadAt(next, item.slot);
      const continuity = next.continuity.slots.find((entry) => entry.slot === item.slot);
      expect(lead).toMatchObject({ id: item.id, arbitrationReason: item.decision });
      expect(continuity).toMatchObject({ leadId: item.id, decision: item.decision });
      expect(lead.id).toBe(continuity?.leadId);
      expect(lead.arbitrationReason).toBe(continuity?.decision);
    }
  });

  it('immediately drops an incumbent that falls below the visibility threshold', () => {
    const base = fixedWorldsThrough(8).get(8) as WorldState;
    const [firstWar, secondWar] = warPair(base);
    const world8 = controlledWorld(base, 8, [
      tunedWarSituation(firstWar, 'high', 8),
      tunedWarSituation(secondWar, 'low', 8),
    ], 'visible-a');
    const initial = deriveObserverLeadProjection(world8);

    const hidden = {
      ...tunedWarSituation(firstWar, 'high', 9),
      visibility: OBSERVER_LEAD_VISIBILITY_THRESHOLD - 1,
    };
    const world9 = controlledWorld(base, 9, [hidden, tunedWarSituation(secondWar, 'low', 9)], 'visible-b');
    const next = deriveObserverLeadProjection(world9, initial.continuity, world8.hash);

    expect(leadAt(next, 'tension')).toMatchObject({
      id: `lead-situation:${secondWar.id}`,
      source: 'situation',
      arbitrationReason: 'situation_priority',
      selectedSinceTurn: 9,
    });
  });

  it('keeps a resolved Situation through its bounded echo, then releases the slot', () => {
    const base = fixedWorldsThrough(8).get(8) as WorldState;
    const [firstWar, secondWar] = warPair(base);
    const world8 = controlledWorld(base, 8, [
      tunedWarSituation(firstWar, 'high', 8),
      tunedWarSituation(secondWar, 'low', 8),
    ], 'echo-a');
    const initial = deriveObserverLeadProjection(world8);
    const incumbent = leadAt(initial, 'tension');
    const resolved: SituationState = {
      ...tunedWarSituation(firstWar, 'high', 9),
      status: 'resolved',
      resolvedTurn: 9,
      resolution: {
        outcomeKey: 'negotiated_peace',
        resolvedTurn: 9,
        resultFactIds: [],
        belowThresholdTurns: 0,
        finalSnapshotDigest: 'observer-echo-final',
      },
    };

    const world9 = controlledWorld(base, 9, [resolved, tunedWarSituation(secondWar, 'low', 9)], 'echo-b');
    const firstEcho = deriveObserverLeadProjection(world9, initial.continuity, world8.hash);
    expect(leadAt(firstEcho, 'tension')).toMatchObject({
      id: incumbent.id,
      displayMode: 'resolution_echo',
      stage: '回响',
      arbitrationReason: 'resolution_echo',
    });
    expect(leadAt(firstEcho, 'tension').question).toContain('双方议和停战');

    const world10 = controlledWorld(base, 10, [resolved, tunedWarSituation(secondWar, 'low', 10)], 'echo-c');
    const secondEcho = deriveObserverLeadProjection(world10, firstEcho.continuity, world9.hash);
    expect(leadAt(secondEcho, 'tension')).toMatchObject({ id: incumbent.id, displayMode: 'resolution_echo' });

    const world11 = controlledWorld(base, 11, [resolved, tunedWarSituation(secondWar, 'low', 11)], 'echo-d');
    const released = deriveObserverLeadProjection(world11, secondEcho.continuity, world10.hash);
    expect(leadAt(released, 'tension')).toMatchObject({
      id: `lead-situation:${secondWar.id}`,
      displayMode: 'tracking',
    });
    expect(OBSERVER_LEAD_RESOLUTION_ECHO_TURNS).toBe(1);
  });

  it('remains deterministic for the legacy active-war fallback when no Situation exists', () => {
    const world = createWorld('今世三问-战争测试');
    const [attacker, defender] = world.polities.filter((item) => item.alive);
    const war: WarState = {
      id: 'war-editorial-test',
      kind: 'interstate',
      attackerId: attacker.id,
      defenderId: defender.id,
      startedTurn: world.turn,
      endedTurn: null,
      active: true,
      attackerScore: 12,
      defenderScore: 9,
      reason: '边境争端',
      lastBattleTurn: world.turn,
      goal: '边境',
      targetRegionIds: defender.controlledRegionIds.slice(0, 1),
      exhaustion: 16,
    };
    const withWar: WorldState = { ...world, wars: [...world.wars, war] };

    expect(deriveObserverLeads(withWar)).toEqual(deriveObserverLeads(withWar));
    expect(deriveObserverLeads(withWar)[2]).toMatchObject({
      slot: 'tension',
      source: 'fallback',
      overlay: 'war',
      target: { kind: 'country', id: attacker.id },
    });
  });
});
