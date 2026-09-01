import { describe, expect, it } from 'vitest';

import { advanceWorld, computeWorldHash, createWorld, serializeWorld } from '../index';
import type {
  AgencyIntentResolvedFact,
  AgencySupportResolvedFact,
  AppointmentEndedFact,
  AppointmentStartedFact,
  CourtActionResolvedFact,
  FactionRelationChangedFact,
  SimulationFact,
} from '../facts';
import type {
  CharacterState,
  FactionState,
  PolityState,
  WorldState,
} from '../types';
import { createSituationSystemState, reduceSituationTurn } from './reducer';
import {
  buildCourtStruggleIndex,
  courtStruggleDetector,
  COURT_STRUGGLE_TEMPLATE,
  detectCourtStruggleCandidates,
  type CourtStruggleCandidate,
} from './court-struggle-detector';

interface PreparedCourt {
  world: WorldState;
  polity: PolityState;
  ruler: CharacterState;
  rulerFaction: FactionState;
  challenger: FactionState;
  leader: CharacterState;
  partner: FactionState;
}

function prepareCourt(seed: string): PreparedCourt {
  const world = advanceWorld(createWorld(seed));
  const selectedPolity = world.polities.find((item) => {
    if (!item.alive) return false;
    const ruler = world.characters.find((character) => character.id === item.rulerId && character.alive);
    const factions = world.factions.filter((faction) => faction.active && faction.polityId === item.id);
    return Boolean(ruler?.factionId && factions.length >= 3);
  });
  expect(selectedPolity).toBeDefined();
  if (!selectedPolity) throw new Error('test fixture requires a living polity with at least three factions');
  const polity = selectedPolity;
  const ruler = world.characters.find((item) => item.id === polity.rulerId) as CharacterState;
  const rulerFaction = world.factions.find((item) => item.id === ruler.factionId) as FactionState;
  const challenger = world.factions.find((item) => (
    item.active
    && item.polityId === polity.id
    && item.id !== rulerFaction.id
    && item.leaderId !== ruler.id
  )) as FactionState;
  const partner = world.factions.find((item) => (
    item.active
    && item.polityId === polity.id
    && item.id !== rulerFaction.id
    && item.id !== challenger.id
  )) as FactionState;
  expect(challenger).toBeDefined();
  expect(partner).toBeDefined();
  const leader = world.characters.find((item) => item.id === challenger.leaderId) as CharacterState;
  const army = world.armies.find((item) => item.polityId === polity.id);
  const regions = world.regions.filter((item) => item.controllerId === polity.id).slice(0, 2);
  expect(leader).toBeDefined();
  expect(army).toBeDefined();
  expect(regions.length).toBeGreaterThanOrEqual(2);

  leader.factionId = challenger.id;
  leader.ambition = 96;
  leader.loyalty = 18;
  leader.influence = 100;
  leader.renown = 100;
  challenger.memberIds = [...new Set([leader.id, ...challenger.memberIds])];
  challenger.coreMemberIds = [...new Set([leader.id, ...challenger.coreMemberIds])];
  challenger.cohesion = 95;
  challenger.alliedFactionIds = [partner.id];
  challenger.rivalFactionIds = [rulerFaction.id];
  partner.alliedFactionIds = [...new Set([...partner.alliedFactionIds, challenger.id])];
  rulerFaction.rivalFactionIds = [...new Set([...rulerFaction.rivalFactionIds, challenger.id])];
  polity.authority = 10;
  polity.courtInfluence = 18;

  const family = world.families.find((item) => item.id === leader.familyId);
  if (family) {
    family.active = true;
    family.headId = leader.id;
    family.prestige = 100;
    family.politicalInfluence = 100;
    family.wealth = 500;
  }
  world.offices.push(
    {
      id: `test-office:${seed}:chief`, polityId: polity.id, kind: '宰辅', holderId: leader.id,
      regionId: null, armyId: null, fleetId: null, rank: 10, appointedTurn: world.turn, endedTurn: null, active: true,
    },
    {
      id: `test-office:${seed}:secretary`, polityId: polity.id, kind: '枢密使', holderId: leader.id,
      regionId: null, armyId: null, fleetId: null, rank: 10, appointedTurn: world.turn, endedTurn: null, active: true,
    },
    ...regions.map((region, index) => ({
      id: `test-office:${seed}:regional:${index}`, polityId: polity.id, kind: '地方长官' as const, holderId: leader.id,
      regionId: region.id, armyId: null, fleetId: null, rank: 10, appointedTurn: world.turn, endedTurn: null, active: true,
    })),
    {
      id: `test-office:${seed}:commander`, polityId: polity.id, kind: '军团主帅', holderId: leader.id,
      regionId: null, armyId: army?.id ?? null, fleetId: null, rank: 10, appointedTurn: world.turn, endedTurn: null, active: true,
    },
    {
      id: `test-office:${seed}:deputy`, polityId: polity.id, kind: '军团副将', holderId: leader.id,
      regionId: null, armyId: army?.id ?? null, fleetId: null, rank: 8, appointedTurn: world.turn, endedTurn: null, active: true,
    },
  );
  return { world, polity, ruler, rulerFaction, challenger, leader, partner };
}

function appointmentFact(prepared: PreparedCourt, turn: number, suffix = ''): AppointmentStartedFact {
  const appointment = prepared.world.offices.find((item) => (
    item.active && item.holderId === prepared.leader.id && item.kind === '宰辅'
  ));
  return {
    id: `test-appointment:${turn}:${prepared.leader.id}${suffix}`,
    turn,
    year: prepared.world.year,
    season: prepared.world.season,
    kind: 'appointment_started',
    category: '政治',
    importance: 3,
    actorIds: [prepared.leader.id],
    polityIds: [prepared.polity.id],
    regionIds: [],
    causes: [],
    stateDeltas: [],
    sourceFactIds: [],
    payload: {
      appointmentId: appointment?.id ?? 'test-office',
      action: 'started',
      officeKind: '宰辅',
      holderId: prepared.leader.id,
      polityId: prepared.polity.id,
      regionId: null,
      armyId: null,
      fleetId: null,
      rank: 10,
    },
  };
}

function appointmentEndedFact(prepared: PreparedCourt): AppointmentEndedFact {
  const started = appointmentFact(prepared, prepared.world.turn, ':ended');
  return {
    ...started,
    id: `test-appointment-ended:${prepared.world.turn}:${prepared.leader.id}`,
    kind: 'appointment_ended',
    payload: { ...started.payload, action: 'ended' },
  };
}

function relationFact(prepared: PreparedCourt): FactionRelationChangedFact {
  return {
    id: `test-relation:${prepared.world.turn}:${prepared.challenger.id}`,
    turn: prepared.world.turn,
    year: prepared.world.year,
    season: prepared.world.season,
    kind: 'faction_relation_changed',
    category: '政治',
    importance: 3,
    actorIds: [prepared.leader.id, prepared.partner.leaderId],
    polityIds: [prepared.polity.id],
    regionIds: [],
    causes: [],
    stateDeltas: [],
    sourceFactIds: [],
    payload: {
      polityId: prepared.polity.id,
      leftFactionId: prepared.challenger.id,
      rightFactionId: prepared.partner.id,
      relation: 'alliance',
      action: 'formed',
      reasonCode: 'test_alliance',
      leftLeaderId: prepared.leader.id,
      rightLeaderId: prepared.partner.leaderId,
    },
  };
}

function supportFact(prepared: PreparedCourt): AgencySupportResolvedFact {
  const army = prepared.world.armies.find((item) => item.polityId === prepared.polity.id);
  return {
    id: `test-support:${prepared.world.turn}:${prepared.leader.id}`,
    turn: prepared.world.turn,
    year: prepared.world.year,
    season: prepared.world.season,
    kind: 'agency_support_resolved',
    category: '政治',
    importance: 3,
    actorIds: [prepared.leader.id],
    polityIds: [prepared.polity.id],
    regionIds: army ? [army.regionId] : [],
    causes: [],
    stateDeltas: [],
    sourceFactIds: [],
    payload: {
      actorId: prepared.leader.id,
      goalId: 'test-goal',
      planId: 'test-plan',
      planStepId: 'test-step',
      action: 'cultivate_military_support',
      attemptOrdinal: 1,
      targetKind: 'army_officers',
      targetId: prepared.leader.id,
      targetArmyId: army?.id ?? 'test-army',
      polityId: prepared.polity.id,
      outcome: 'secured',
      strength: 80,
      retryAfterTurn: null,
    },
  };
}

function intentFact(prepared: PreparedCourt): AgencyIntentResolvedFact {
  const army = prepared.world.armies.find((item) => item.polityId === prepared.polity.id);
  return {
    id: `test-intent:${prepared.world.turn}:${prepared.leader.id}`,
    turn: prepared.world.turn,
    year: prepared.world.year,
    season: prepared.world.season,
    kind: 'agency_intent_resolved',
    category: '政治',
    importance: 4,
    actorIds: [prepared.leader.id, prepared.ruler.id],
    polityIds: [prepared.polity.id],
    regionIds: army ? [army.regionId] : [],
    causes: [],
    stateDeltas: [],
    sourceFactIds: [],
    payload: {
      submissionFactId: 'test-submission',
      actorId: prepared.leader.id,
      goalId: 'test-goal',
      planId: 'test-plan',
      planStepId: 'test-step',
      action: 'request_independent_command',
      attemptOrdinal: 1,
      targetArmyId: army?.id ?? 'test-army',
      polityId: prepared.polity.id,
      previousCommanderId: prepared.leader.id,
      appointingAuthorityId: prepared.ruler.id,
      outcome: 'executed',
      reasonCode: 'command_granted',
      institutionResponse: 'command_granted',
      retryAfterTurn: null,
      checks: [],
      decisionScore: 90,
      decisionThreshold: 60,
    },
  };
}

function courtFact(
  prepared: PreparedCourt,
  action: CourtActionResolvedFact['payload']['action'],
  turn: number,
  nullableFactions = false,
): CourtActionResolvedFact {
  const coup = action === 'coup' || action === 'usurpation';
  return {
    id: `test-court:${turn}:${action}:${prepared.leader.id}`,
    turn,
    year: prepared.world.year,
    season: prepared.world.season,
    kind: 'court_action_resolved',
    category: '政治',
    importance: coup ? 5 : 3,
    actorIds: [prepared.leader.id, prepared.ruler.id],
    polityIds: [prepared.polity.id],
    regionIds: prepared.polity.capitalRegionId ? [prepared.polity.capitalRegionId] : [],
    causes: [],
    stateDeltas: [],
    sourceFactIds: [],
    payload: {
      action,
      polityId: prepared.polity.id,
      actorFactionId: nullableFactions ? null : prepared.challenger.id,
      targetFactionId: nullableFactions ? null : action === 'power_broker_fell' || action === 'purge'
        ? prepared.challenger.id
        : prepared.rulerFaction.id,
      initiatorId: coup ? prepared.leader.id : prepared.ruler.id,
      targetId: coup ? prepared.ruler.id : prepared.leader.id,
      reasonCode: action,
      score: action === 'power_broker_fell' ? 20 : 96,
      threshold: action === 'power_broker_fell' ? 54 : 92,
      rulerBeforeId: prepared.ruler.id,
      rulerAfterId: coup ? prepared.leader.id : prepared.ruler.id,
      affectedFactionIds: nullableFactions ? [] : [prepared.challenger.id, prepared.rulerFaction.id],
      removedMemberIds: [],
    },
  };
}

function candidateFor(
  prepared: PreparedCourt,
  facts: readonly SimulationFact[] = [],
): CourtStruggleCandidate {
  const candidate = detectCourtStruggleCandidates(prepared.world, facts)
    .find((item) => item.scopeKey === prepared.polity.id);
  expect(candidate).toBeDefined();
  return candidate as CourtStruggleCandidate;
}

describe('court struggle detector', () => {
  it('reads every POL01 category, ignores legacy faction.power and never mutates the world', () => {
    const prepared = prepareCourt('POL06-court-ledger-purity');
    prepared.world.factions.reverse();
    const factionOrder = prepared.world.factions.map((faction) => faction.id);
    const hashBeforeIndex = computeWorldHash(prepared.world);
    buildCourtStruggleIndex(prepared.world);
    expect(prepared.world.factions.map((faction) => faction.id)).toEqual(factionOrder);
    expect(computeWorldHash(prepared.world)).toBe(hashBeforeIndex);
    const fact = appointmentFact(prepared, prepared.world.turn);
    prepared.challenger.power = 0;
    const beforeLow = serializeWorld(prepared.world);
    const low = candidateFor(prepared, [fact]);
    expect(serializeWorld(prepared.world)).toBe(beforeLow);
    prepared.challenger.power = 100;
    const beforeHigh = serializeWorld(prepared.world);
    const high = candidateFor(prepared, [fact]);
    expect(serializeWorld(prepared.world)).toBe(beforeHigh);
    expect(high).toEqual(low);

    const indexed = buildCourtStruggleIndex(prepared.world).factionsById.get(prepared.challenger.id);
    expect(indexed).toBeDefined();
    expect(Object.entries(indexed?.categoryValues ?? {}).every(([, value]) => value > 0)).toBe(true);
    expect(high.pressure).toBeGreaterThanOrEqual(COURT_STRUGGLE_TEMPLATE.formationThreshold);
    expect(high.signals.flatMap((signal) => signal.refs).some((ref) => (
      ref.kind === 'index' && ref.entityType === 'faction' && ref.field === 'power'
    ))).toBe(false);
  });

  it('consumes relation, support, intent and appointment Facts with concrete actors and routes', () => {
    const prepared = prepareCourt('POL06-court-fact-consumption');
    const facts: SimulationFact[] = [
      relationFact(prepared),
      supportFact(prepared),
      intentFact(prepared),
      appointmentFact(prepared, prepared.world.turn),
      appointmentEndedFact(prepared),
    ];
    const candidate = candidateFor(prepared, facts);
    expect(candidate.sourceFactIds).toEqual(expect.arrayContaining(facts.map((fact) => fact.id)));
    expect(candidate.signals.map((signal) => signal.key)).toEqual(expect.arrayContaining([
      'challenger_central_office',
      'challenger_regional_office',
      'challenger_military_command',
      'challenger_family_renown',
      'challenger_alliance_support',
      'challenger_cohesion',
      'recent_faction_relation',
      'recent_power_resource_change',
    ]));
    expect(candidate.participants.coreCharacterIds).toEqual(expect.arrayContaining([
      prepared.ruler.id,
      prepared.leader.id,
    ]));
    expect(candidate.executableActorIds).toEqual(expect.arrayContaining([
      prepared.ruler.id,
      prepared.leader.id,
    ]));
    expect(candidate.possibleOutcomes.map((outcome) => outcome.key)).toEqual(expect.arrayContaining([
      'ruler_reasserted_control',
      'factional_compromise',
      'power_broker_fell',
      'palace_coup_succeeded',
    ]));
    expect(candidate.possibleOutcomes.map((outcome) => outcome.key)).not.toContain('purge_backfired');
  });

  it('closes as a factional compromise when the challenger and ruler faction form an alliance', () => {
    const prepared = prepareCourt('POL06-court-compromise');
    const compromise: FactionRelationChangedFact = {
      ...relationFact(prepared),
      id: `test-compromise:${prepared.world.turn}:${prepared.challenger.id}`,
      actorIds: [prepared.leader.id, prepared.ruler.id],
      payload: {
        ...relationFact(prepared).payload,
        rightFactionId: prepared.rulerFaction.id,
        rightLeaderId: prepared.ruler.id,
        reasonCode: 'court_compromise',
      },
    };
    const candidate = candidateFor(prepared, [compromise]);
    expect(candidate.challengerFactionId).toBe(prepared.challenger.id);
    expect(candidate.resolution).toEqual({
      outcomeKey: 'factional_compromise',
      resultFactIds: [compromise.id],
    });
  });

  it('keeps an ended broker faction as the explicit carrier of its fall resolution', () => {
    const prepared = prepareCourt('POL06-court-ended-carrier');
    prepared.challenger.active = false;
    prepared.challenger.endedTurn = prepared.world.turn;
    prepared.challenger.endedReason = 'core_exhausted';
    prepared.leader.factionId = null;
    const fell = courtFact(prepared, 'power_broker_fell', prepared.world.turn);
    const candidate = candidateFor(prepared, [fell]);
    expect(candidate.challengerFactionId).toBe(prepared.challenger.id);
    expect(candidate.resolution).toEqual({
      outcomeKey: 'power_broker_fell',
      resultFactIds: [fell.id],
    });
    expect(candidate.participants.factionIds).toContain(prepared.challenger.id);
  });

  it('forms only after two quarters with Fact evidence, then closes on a nullable-carrier fall Fact', () => {
    const prepared = prepareCourt('POL06-court-reducer');
    const startTurn = prepared.world.turn;
    let state = createSituationSystemState(startTurn - 1);
    const firstFact = appointmentFact(prepared, startTurn, ':first');
    let result = reduceSituationTurn(
      state,
      { turn: startTurn, facts: [firstFact], index: buildCourtStruggleIndex(prepared.world), detectors: [courtStruggleDetector] },
      { templates: [COURT_STRUGGLE_TEMPLATE] },
    );
    expect(result.state.situations).toEqual([]);
    const secondFact = appointmentFact(prepared, startTurn + 1, ':second');
    result = reduceSituationTurn(
      result.state,
      { turn: startTurn + 1, facts: [secondFact], index: buildCourtStruggleIndex(prepared.world), detectors: [courtStruggleDetector] },
      { templates: [COURT_STRUGGLE_TEMPLATE] },
    );
    expect(result.state.situations).toHaveLength(1);
    state = result.state;

    const fell = courtFact(prepared, 'power_broker_fell', startTurn + 2, true);
    result = reduceSituationTurn(
      state,
      { turn: startTurn + 2, facts: [fell], index: buildCourtStruggleIndex(prepared.world), detectors: [courtStruggleDetector] },
      { templates: [COURT_STRUGGLE_TEMPLATE] },
    );
    expect(result.state.situations[0]?.status).toBe('resolved');
    expect(result.state.situations[0]?.resolution).toMatchObject({
      outcomeKey: 'power_broker_fell',
      resultFactIds: [fell.id],
    });
    expect(result.state.situations[0]?.participants.coreCharacterIds).toContain(prepared.leader.id);
  });

  it('still emits a coup resolution after the challenger has become the current ruler', () => {
    const prepared = prepareCourt('POL06-court-post-coup');
    prepared.polity.rulerId = prepared.leader.id;
    const coup = courtFact(prepared, 'coup', prepared.world.turn);
    const candidate = candidateFor(prepared, [coup]);
    expect(candidate.resolution).toEqual({
      outcomeKey: 'palace_coup_succeeded',
      resultFactIds: [coup.id],
    });
    expect(candidate.participants.coreCharacterIds).toEqual(expect.arrayContaining([
      prepared.ruler.id,
      prepared.leader.id,
    ]));
  });
});
