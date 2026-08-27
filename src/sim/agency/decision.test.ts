import { describe, expect, it } from 'vitest';

import {
  advanceWorld,
  advanceWorldBy,
  computeWorldHash,
  createWorld,
  deserializeWorld,
  emitSimulationFact,
  getDateForTurn,
  reducePersonalMemorySystem,
  serializeWorld,
  stableHash,
  type HistoryEvent,
  type RelationshipState,
  type SimulationFact,
  type WorldState,
} from '../index';
import { syncOfficeAppointments } from '../v02';
import {
  AGENCY_DECISION_CLOSED_RETENTION_TURNS,
  createAgencyDecisionSystemState,
  validateAgencyDecisionSystemState,
  processAgencyDecisionSystem,
  type AgencyDecisionEventInput,
  type AgencyDecisionTurnContext,
} from './decision';

function emptyDecisionContext(turn: number): AgencyDecisionTurnContext & { events: HistoryEvent[] } {
  const date = getDateForTurn(turn);
  return {
    turn,
    year: date.year,
    season: date.season,
    facts: [],
    events: [],
    agencyIntents: [],
    appointmentSourceFactIdsByArmyId: {},
  };
}

function eventEmitter(world: WorldState, context: AgencyDecisionTurnContext & { events: HistoryEvent[] }) {
  return (input: AgencyDecisionEventInput): HistoryEvent => {
    world.counters.event += 1;
    const event: HistoryEvent = {
      id: `event_${String(world.counters.event).padStart(6, '0')}`,
      turn: context.turn,
      year: context.year,
      season: context.season,
      category: input.category,
      kind: input.kind,
      title: input.title,
      summary: input.summary,
      importance: input.importance,
      actorIds: [...new Set(input.actorIds ?? [])].sort(),
      polityIds: [...new Set(input.polityIds ?? [])].sort(),
      regionIds: [...new Set(input.regionIds ?? [])].sort(),
      causes: input.causes,
      evidence: input.evidence ?? input.causes.map((cause) => cause.evidence),
      stateDeltas: input.stateDeltas ?? [],
      sourceFactIds: [...new Set(input.sourceFactIds ?? [])].sort(),
      situationIds: [...new Set(input.situationIds ?? [])].sort(),
    };
    context.events.push(event);
    world.history.push(event);
    world.historyDigest = stableHash([world.historyDigest, event]);
    return event;
  };
}

interface DecisionFixture {
  world: WorldState;
  context: AgencyDecisionTurnContext & { events: HistoryEvent[] };
  armyId: string;
  deputyId: string;
  commanderId: string;
}

function ensureInboundSupport(world: WorldState, sourceId: string, targetId: string): void {
  let relationship = world.relationships.find((item) => item.sourceId === sourceId && item.targetId === targetId);
  if (!relationship) {
    world.counters.relationship += 1;
    relationship = {
      id: `rel_${String(world.counters.relationship).padStart(5, '0')}`,
      sourceId,
      targetId,
      kinship: '无',
      affinity: 70,
      trust: 82,
      fear: 0,
      grievance: 0,
      gratitude: 30,
      lastInteractionTurn: world.turn,
      memories: [],
    } satisfies RelationshipState;
    world.relationships.push(relationship);
  }
  relationship.trust = 82;
  relationship.gratitude = 30;
  relationship.grievance = 0;
}

function decisionFixture(seed: string, expected: 'executed' | 'rejected'): DecisionFixture {
  const world = advanceWorld(createWorld(seed));
  const army = world.armies.find((item) => item.deputyCommanderId !== null);
  if (!army?.deputyCommanderId) throw new Error('Decision fixture requires a land deputy');
  const deputy = world.characters.find((item) => item.id === army.deputyCommanderId);
  const commander = world.characters.find((item) => item.id === army.commanderId);
  const polity = world.polities.find((item) => item.id === army.polityId);
  const family = world.families.find((item) => item.id === deputy?.familyId);
  if (!deputy || !commander || !polity || !family) throw new Error('Decision fixture references are incomplete');
  deputy.age = 30;
  deputy.lifeStage = '盛年';
  deputy.ambition = 88;
  deputy.loyalty = 88;
  deputy.caution = 64;
  deputy.insubordination = 0;
  deputy.merit = expected === 'executed' ? 58 : 40;
  deputy.deputyExperience = expected === 'executed' ? 52 : 30;
  deputy.leadership = expected === 'executed' ? 92 : 50;
  deputy.renown = 48;
  deputy.influence = 46;
  family.prestige = 58;
  family.politicalInfluence = 52;
  family.traditions.military = 72;
  polity.authority = 78;
  commander.leadership = expected === 'executed' ? 48 : 100;
  commander.merit = expected === 'executed' ? 12 : 100;
  // A formal request requires either an unmistakable candidate advantage or
  // a visibly weakened incumbent. Keep the latter true in both fixtures so
  // the rejected case exercises adjudication rather than plan preparation.
  commander.loyalty = 28;
  ensureInboundSupport(world, commander.id, deputy.id);
  ensureInboundSupport(world, polity.rulerId, deputy.id);
  if (!world.offices.some((office) => (
    office.active && office.kind === '军团副将' && office.holderId === deputy.id && office.armyId === army.id
  ))) syncOfficeAppointments(world, world.turn);
  const deputyOffice = world.offices.find((office) => (
    office.active && office.kind === '军团副将' && office.holderId === deputy.id && office.armyId === army.id
  ));
  if (!deputyOffice) throw new Error('Decision fixture requires a deputy appointment');
  deputyOffice.appointedTurn = world.turn - 6;
  world.agencyDecisionSystem = createAgencyDecisionSystemState(world.turn - 1);
  const date = getDateForTurn(world.turn);
  const context: AgencyDecisionTurnContext & { events: HistoryEvent[] } = {
    turn: world.turn,
    year: date.year,
    season: date.season,
    facts: [],
    events: [],
    agencyIntents: [],
    appointmentSourceFactIdsByArmyId: {},
  };
  const opponent = world.armies.find((item) => item.polityId !== army.polityId) ?? world.armies[1];
  const region = world.regions.find((item) => item.id === army.regionId) ?? world.regions[0];
  const route = world.routes[0];
  if (!opponent || !region || !route) throw new Error('Decision fixture needs an opposing army, region and route');
  emitSimulationFact(world, context, {
    kind: 'battle',
    category: '军事',
    importance: 3,
    actorIds: [deputy.id, commander.id],
    polityIds: [army.polityId, opponent.polityId],
    regionIds: [region.id],
    causes: [{ label: '军旅凭证', role: '结果', weight: 1, evidence: '副将随军完成一场可核验会战' }],
    stateDeltas: [],
    sourceFactIds: [],
    payload: {
      warId: world.wars[0]?.id ?? 'war_decision_fixture',
      targetRegionId: region.id,
      routeId: route.id,
      attackerWon: true,
      attackerPower: 12_000,
      defenderPower: 9_000,
      militiaLosses: 0,
      attacker: {
        armyId: army.id,
        polityId: army.polityId,
        commanderId: commander.id,
        deputyCommanderId: deputy.id,
        soldiersBefore: army.soldiers,
        soldiersAfter: Math.max(1, army.soldiers - 100),
        moraleBefore: army.morale,
        moraleAfter: army.morale,
        trainingBefore: army.training,
        supplyBefore: army.supply,
        losses: 100,
      },
      defenders: [{
        armyId: opponent.id,
        polityId: opponent.polityId,
        commanderId: opponent.commanderId,
        deputyCommanderId: opponent.deputyCommanderId,
        soldiersBefore: opponent.soldiers,
        soldiersAfter: Math.max(1, opponent.soldiers - 150),
        moraleBefore: opponent.morale,
        moraleAfter: opponent.morale,
        trainingBefore: opponent.training,
        supplyBefore: opponent.supply,
        losses: 150,
      }],
    },
  });
  return { world, context, armyId: army.id, deputyId: deputy.id, commanderId: commander.id };
}

describe('C10/C11 authoritative agency decision core', () => {
  it('submits, executes and institutionally records an independent-command request', () => {
    const { world, context, armyId, deputyId, commanderId } = decisionFixture('agency-command-executed', 'executed');
    const evidenceId = context.facts[0]?.id;
    const relationshipsBefore = stableHash(world.relationships);
    const relationshipCounterBefore = world.counters.relationship;

    processAgencyDecisionSystem(world, context, eventEmitter(world, context));

    const submitted = context.facts.find((fact): fact is Extract<SimulationFact, { kind: 'agency_intent_submitted' }> => fact.kind === 'agency_intent_submitted');
    const resolved = context.facts.find((fact): fact is Extract<SimulationFact, { kind: 'agency_intent_resolved' }> => fact.kind === 'agency_intent_resolved');
    expect(submitted?.sourceFactIds).toContain(evidenceId);
    expect(submitted?.sourceFactIds).toContain(context.facts.find((fact) => fact.kind === 'agency_support_resolved')?.id);
    expect(resolved?.sourceFactIds).toEqual([submitted?.id]);
    expect(resolved?.payload.outcome).toBe('executed');
    expect(resolved?.stateDeltas).toHaveLength(4);
    expect(world.armies.find((army) => army.id === armyId)).toMatchObject({ commanderId: deputyId, deputyCommanderId: commanderId });
    expect(world.characters.find((character) => character.id === deputyId)?.commandingArmyId).toBe(armyId);
    expect(context.agencyIntents).toHaveLength(1);
    expect(context.agencyIntents[0]).toMatchObject({ submittedFactId: submitted?.id, resolvedFactId: resolved?.id });
    expect(context.events.find((event) => event.kind === 'deputy_promoted')?.sourceFactIds).toEqual([submitted?.id, resolved?.id].sort());
    expect(stableHash(world.relationships)).not.toBe(relationshipsBefore);
    expect(world.counters.relationship).toBe(relationshipCounterBefore);

    syncOfficeAppointments(world, context.turn, context);
    const linkedAppointments = context.facts.filter((fact) => (
      (fact.kind === 'appointment_started' || fact.kind === 'appointment_ended')
      && fact.payload.armyId === armyId
      && fact.sourceFactIds.includes(resolved?.id ?? '')
    ));
    expect(linkedAppointments.length).toBeGreaterThanOrEqual(2);
    expect(linkedAppointments.some((fact) => (
      fact.kind === 'appointment_started'
      && fact.payload.officeKind === '军团主帅'
      && fact.payload.holderId === deputyId
    ))).toBe(true);
  });

  it('records a rejected request without mutating command and opens a later retry window', () => {
    const { world, context, armyId, deputyId, commanderId } = decisionFixture('agency-command-rejected', 'rejected');

    processAgencyDecisionSystem(world, context, eventEmitter(world, context));

    const submitted = context.facts.find((fact) => fact.kind === 'agency_intent_submitted');
    const resolved = context.facts.find((fact): fact is Extract<SimulationFact, { kind: 'agency_intent_resolved' }> => fact.kind === 'agency_intent_resolved');
    expect(submitted).toBeDefined();
    expect(resolved?.payload.outcome).toBe('rejected');
    expect(resolved?.payload.reasonCode).toBe('claim_weaker');
    expect(resolved?.payload.institutionResponse).toBe('appeased');
    expect(resolved?.stateDeltas.map((delta) => delta.field)).toEqual(['influence', 'loyalty']);
    expect(world.armies.find((army) => army.id === armyId)).toMatchObject({ commanderId, deputyCommanderId: deputyId });
    expect(context.events.find((event) => event.kind === 'command_request_appeased')?.sourceFactIds).toEqual([submitted?.id, resolved?.id].sort());
    const actor = world.agencyDecisionSystem.actors.find((item) => item.characterId === deputyId);
    expect(actor?.attemptOrdinal).toBe(1);
    expect(actor?.nextEligibleIntentTurn).toBe(context.turn + 8);

    world.agencySystem = reducePersonalMemorySystem(world, context.turn, context.facts);
    const memoryKinds = world.agencySystem.characters
      .find((entry) => entry.characterId === deputyId)?.memories.map((memory) => memory.kind) ?? [];
    expect(memoryKinds).toEqual(expect.arrayContaining(['support_secured', 'command_appeased']));
  });

  it('removes a high-risk deputy from command access instead of recording an empty rejection', () => {
    const { world, context, armyId, deputyId } = decisionFixture('agency-command-curbed', 'executed');
    const deputy = world.characters.find((character) => character.id === deputyId);
    if (!deputy) throw new Error('Expected deputy for curbing fixture');
    deputy.loyalty = 0;
    deputy.caution = 0;
    deputy.insubordination = 100;
    deputy.influence = 100;
    deputy.merit = 100;
    deputy.cunning = 100;
    const influenceBefore = deputy.influence;

    processAgencyDecisionSystem(world, context, eventEmitter(world, context));

    const resolution = context.facts.find((fact): fact is Extract<SimulationFact, { kind: 'agency_intent_resolved' }> => (
      fact.kind === 'agency_intent_resolved'
    ));
    expect(resolution).toMatchObject({
      payload: { outcome: 'rejected', reasonCode: 'court_risk', institutionResponse: 'curbed', retryAfterTurn: null },
    });
    expect(world.armies.find((army) => army.id === armyId)?.deputyCommanderId).toBeNull();
    expect(deputy.influence).toBeLessThan(influenceBefore);
    expect(world.agencyDecisionSystem.actors.find((actor) => actor.characterId === deputyId)).toMatchObject({
      goal: { status: 'invalidated', closureReason: 'position_lost' },
    });
    expect(context.events.some((event) => event.kind === 'command_request_curbed' && event.title.includes('遭削权'))).toBe(true);
  });

  it('closes a three-times-denied goal, frees the actor slot, and permits a later fresh goal', () => {
    const { world, context, deputyId } = decisionFixture('agency-command-exhausted', 'rejected');
    processAgencyDecisionSystem(world, context, eventEmitter(world, context));
    const firstGoalId = world.agencyDecisionSystem.actors.find((item) => item.characterId === deputyId)?.goal.id;
    const actorAfterFirst = world.agencyDecisionSystem.actors.find((item) => item.characterId === deputyId);
    if (!actorAfterFirst || !firstGoalId) throw new Error('Expected a retained rejected goal');

    const thirdTurn = context.turn + 8;
    actorAfterFirst.attemptOrdinal = 2;
    actorAfterFirst.nextEligibleIntentTurn = thirdTurn;
    world.agencyDecisionSystem.reviewedThroughTurn = thirdTurn - 1;
    world.turn = thirdTurn;
    const thirdContext = emptyDecisionContext(thirdTurn);
    processAgencyDecisionSystem(world, thirdContext, eventEmitter(world, thirdContext));

    const afterThird = world.agencyDecisionSystem.actors.find((item) => item.characterId === deputyId);
    expect(afterThird).toMatchObject({
      attemptOrdinal: 3,
      goal: { status: 'invalidated', closureReason: 'request_exhausted', resolvedTurn: thirdTurn },
      plan: { status: 'invalidated', currentStepIndex: null },
    });
    expect(thirdContext.events.some((event) => event.title.includes('暂搁独立统军之请'))).toBe(true);
    world.turn = thirdTurn + 1;
    expect(validateAgencyDecisionSystemState(world)).toEqual([]);

    const freshTurn = thirdTurn + AGENCY_DECISION_CLOSED_RETENTION_TURNS;
    world.turn = freshTurn;
    world.agencyDecisionSystem.reviewedThroughTurn = freshTurn - 1;
    const freshContext = emptyDecisionContext(freshTurn);
    processAgencyDecisionSystem(world, freshContext, eventEmitter(world, freshContext));
    const fresh = world.agencyDecisionSystem.actors.find((item) => item.characterId === deputyId);
    expect(fresh?.goal.id).not.toBe(firstGoalId);
    expect(fresh).toMatchObject({ attemptOrdinal: 0, goal: { status: 'active', createdTurn: freshTurn } });
  });

  it('requires explicit inbound relations for patronage and audits family backing separately', () => {
    const { world, context, deputyId, commanderId } = decisionFixture('agency-explicit-patronage', 'rejected');
    const polity = world.polities.find((item) => item.id === world.characters.find((character) => character.id === deputyId)?.polityId);
    if (!polity) throw new Error('Expected polity for patronage fixture');
    world.relationships = world.relationships.filter((relationship) => !(
      relationship.targetId === deputyId
      && (relationship.sourceId === commanderId || relationship.sourceId === polity.rulerId)
    ));
    const deputy = world.characters.find((character) => character.id === deputyId);
    if (!deputy) throw new Error('Expected deputy for patronage fixture');
    deputy.loyalty = 100;

    processAgencyDecisionSystem(world, context, eventEmitter(world, context));

    const actor = world.agencyDecisionSystem.actors.find((item) => item.characterId === deputyId);
    expect(actor?.plan.steps.find((step) => step.action === 'seek_patronage')?.status).toBe('available');
    const supportAction = context.facts.find((fact): fact is Extract<SimulationFact, { kind: 'agency_support_resolved' }> => (
      fact.kind === 'agency_support_resolved'
    ));
    expect(supportAction).toMatchObject({
      payload: { action: 'request_backing', targetKind: 'commander' },
    });
    expect(context.facts.some((fact) => fact.kind === 'agency_intent_resolved')).toBe(false);
    expect(actor?.plan.steps.find((step) => step.action === 'seek_family_backing')?.status).toBe('completed');
    expect(context.events.every((event) => !event.summary.includes('已经明确背书'))).toBe(true);
  });

  it('does not invent gratitude or fulfilled duty when the former commander opposed replacement', () => {
    const { world, context, deputyId, commanderId } = decisionFixture('agency-hostile-predecessor', 'executed');
    const polityId = world.characters.find((character) => character.id === deputyId)?.polityId;
    if (!polityId) throw new Error('Expected polity for predecessor fixture');
    world.relationships = world.relationships.filter((relationship) => !(
      (relationship.sourceId === commanderId && relationship.targetId === deputyId)
      || (relationship.sourceId === deputyId && relationship.targetId === commanderId)
    ));
    world.counters.commitment += 1;
    const dutyId = `commit_${String(world.counters.commitment).padStart(5, '0')}`;
    world.commitments.push({
      id: dutyId,
      kind: '军令',
      promisorId: deputyId,
      promiseeId: commanderId,
      polityIds: [polityId],
      terms: '继续担任副将并服从合法军令',
      madeTurn: context.turn,
      dueTurn: context.turn + 12,
      status: '生效',
      resolvedTurn: null,
      eventId: 'event_test_oath',
      resolutionEventId: null,
      trustStake: 20,
    });
    const relationshipsBefore = stableHash(world.relationships);
    const relationshipCounterBefore = world.counters.relationship;

    processAgencyDecisionSystem(world, context, eventEmitter(world, context));

    const resolution = context.facts.find((fact) => fact.kind === 'agency_intent_resolved');
    expect(resolution?.payload.outcome).toBe('executed');
    expect(resolution?.stateDeltas).toHaveLength(4);
    const promotion = context.events.find((event) => event.kind === 'deputy_promoted');
    expect(promotion?.stateDeltas).toContainEqual({
      entityType: 'commitment',
      entityId: dutyId,
      field: 'status',
      before: '生效',
      after: '失效',
    });
    expect(world.relationships.some((relationship) => (
      relationship.sourceId === deputyId && relationship.targetId === commanderId
    ))).toBe(false);
    expect(stableHash(world.relationships)).not.toBe(relationshipsBefore);
    expect(world.counters.relationship).toBe(relationshipCounterBefore);
    expect(world.commitments.find((commitment) => commitment.id === dutyId)).toMatchObject({
      status: '失效',
      resolvedTurn: context.turn,
    });
  });

  it('reviews only the recent Fact suffix instead of traversing an old goal-wide archive', () => {
    const { world, context, deputyId } = decisionFixture('agency-incremental-facts', 'rejected');
    processAgencyDecisionSystem(world, context, eventEmitter(world, context));
    const actor = world.agencyDecisionSystem.actors.find((item) => item.characterId === deputyId);
    const template = context.facts.find((fact) => fact.kind === 'battle');
    if (!actor || !template) throw new Error('Expected actor and battle Fact for suffix fixture');

    const poison = { ...template, id: 'fact_archive_prefix_poison', turn: context.turn + 1 } as SimulationFact;
    Object.defineProperty(poison, 'payload', {
      enumerable: true,
      get: () => { throw new Error('old archive payload was traversed'); },
    });
    world.facts.push(poison);
    const nextTurn = 100;
    actor.lastReviewedTurn = nextTurn - 1;
    actor.goal.lastReviewedTurn = nextTurn - 1;
    world.agencyDecisionSystem.reviewedThroughTurn = nextTurn - 1;
    world.turn = nextTurn;
    const nextContext = emptyDecisionContext(nextTurn);

    expect(() => processAgencyDecisionSystem(world, nextContext, eventEmitter(world, nextContext))).not.toThrow();
  });

  it('persists the authoritative decision owner and resumes deterministically', () => {
    const world = advanceWorldBy(createWorld('agency-decision-save'), 12);
    const restored = deserializeWorld(serializeWorld(world));
    expect(restored.agencyDecisionSystem).toEqual(world.agencyDecisionSystem);
    expect(restored.hash).toBe(world.hash);

    const direct = advanceWorld(world);
    const afterLoad = advanceWorld(restored);
    expect(afterLoad.hash).toBe(direct.hash);
    expect(serializeWorld(afterLoad)).toBe(serializeWorld(direct));
    expect(computeWorldHash(afterLoad)).toBe(afterLoad.hash);
  });

  it('authenticates an early schema-4 save before starting decisions at the live boundary', () => {
    const early = advanceWorldBy(createWorld('agency-decision-early-schema4'), 4);
    Reflect.deleteProperty(early as unknown as Record<string, unknown>, 'agencyDecisionSystem');
    early.hash = computeWorldHash(early);

    const restored = deserializeWorld(JSON.stringify(early));

    expect(restored.agencyDecisionSystem).toEqual(createAgencyDecisionSystemState(restored.turn - 1));
    expect(restored.agencySystem).toEqual(early.agencySystem);
    expect(advanceWorld(restored).agencyDecisionSystem.reviewedThroughTurn).toBe(restored.turn);
  });

  it('opens a v1.0 schema-4 save without inventing historical support actions', () => {
    let legacy = createWorld('agency-v10-support-migration');
    for (let index = 0; index < 80; index += 1) {
      legacy = advanceWorld(legacy);
      if (legacy.agencyDecisionSystem.actors.length > 0
        && legacy.facts.some((fact) => fact.kind === 'agency_intent_resolved' && fact.payload.outcome === 'executed')) break;
    }
    expect(legacy.agencyDecisionSystem.actors.length).toBeGreaterThan(0);
    const legacyResolution = legacy.facts.find((fact) => (
      fact.kind === 'agency_intent_resolved' && fact.payload.outcome === 'executed'
    ));
    expect(legacyResolution).toBeDefined();
    for (const actor of legacy.agencyDecisionSystem.actors) {
      const raw = actor as unknown as Record<string, unknown>;
      delete raw.supportActions;
      delete raw.supportAttemptOrdinal;
      delete raw.nextEligibleSupportTurn;
    }
    if (legacyResolution?.kind === 'agency_intent_resolved') {
      delete (legacyResolution.payload as unknown as Record<string, unknown>).institutionResponse;
    }
    legacy.factDigest = legacy.facts.reduce((digest, fact) => stableHash([digest, fact]), stableHash([]));
    legacy.hash = computeWorldHash(legacy);

    const restored = deserializeWorld(JSON.stringify(legacy));

    expect(restored.agencyDecisionSystem.actors.every((actor) => (
      actor.supportActions.length === 0
      && actor.supportAttemptOrdinal === 0
      && actor.nextEligibleSupportTurn === restored.turn
    ))).toBe(true);
    expect(restored.facts.find((fact) => fact.id === legacyResolution?.id)).toMatchObject({
      payload: { institutionResponse: 'command_granted' },
    });
    expect(validateAgencyDecisionSystemState(restored)).toEqual([]);
  });
});
