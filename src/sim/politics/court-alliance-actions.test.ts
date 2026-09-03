import { describe, expect, it } from 'vitest';

import {
  advanceWorldBy,
  createWorld,
  serializeWorld,
  stableHash,
  validateWorld,
} from '../index';
import { stableCompare } from '../random';
import type {
  CommitmentState,
  HistoryEvent,
  MemoryKind,
  WorldState,
} from '../types';
import { politicalAllianceFormationFact } from './faction-commitments';
import { calculateFactionPowerLedger } from './power-ledger';
import {
  COURT_ALLIANCE_COMBINED_COHESION_THRESHOLD,
  COURT_ALLIANCE_DURATION_TURNS,
  COURT_ALLIANCE_TERMS,
  MAX_COURT_ALLIANCE_ACTIONS_PER_POLITY,
  autonomousCourtAllianceCandidateFor,
  buildCourtAllianceActionQueue,
  courtAllianceCandidateFor,
  discoverCourtAllianceCandidates,
  resolveCourtAllianceAction,
  type CourtAllianceCandidate,
  type CourtAllianceTurnContext,
} from './court-alliance-actions';
import type { EmitFactionChronicle } from './faction-lifecycle';

function turnContext(
  world: WorldState,
  season: CourtAllianceTurnContext['season'] = '冬',
): CourtAllianceTurnContext {
  return { turn: world.turn, year: world.year, season, facts: [], events: [] };
}

function threeFactionFixture(): {
  world: WorldState;
  polityId: string;
  dominant: WorldState['factions'][number];
  firstPartner: WorldState['factions'][number];
  laterPartner: WorldState['factions'][number];
} {
  const world = createWorld('v1.20-朝臣结盟候选');
  const polity = world.polities.find((item) => (
    world.factions.filter((faction) => faction.active && faction.polityId === item.id).length >= 3
  ));
  if (!polity) throw new Error('expected a polity with at least three active factions');
  const factions = world.factions
    .filter((faction) => faction.active && faction.polityId === polity.id)
    .sort((left, right) => stableCompare(left.id, right.id));
  const [dominant, firstPartner, laterPartner] = factions;
  if (!dominant || !firstPartner || !laterPartner) throw new Error('expected three ordered factions');
  for (const faction of factions) {
    faction.power = 10;
    faction.cohesion = 47;
    faction.alliedFactionIds = [];
    faction.rivalFactionIds = [];
    faction.relationSinceTurns = {};
  }
  dominant.power = 90;
  dominant.cohesion = 56;
  firstPartner.power = 80;
  firstPartner.cohesion = 48;
  laterPartner.power = 70;
  laterPartner.cohesion = 80;
  return { world, polityId: polity.id, dominant, firstPartner, laterPartner };
}

function eventEmitter(
  world: WorldState,
  context: CourtAllianceTurnContext,
): EmitFactionChronicle {
  return (input) => {
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
      actorIds: [...new Set(input.actorIds ?? [])].sort(stableCompare),
      polityIds: [...new Set(input.polityIds ?? [])].sort(stableCompare),
      regionIds: [...new Set(input.regionIds ?? [])].sort(stableCompare),
      causes: input.causes.map((cause) => ({ ...cause })),
      evidence: input.evidence ?? input.causes.map((cause) => cause.evidence),
      stateDeltas: input.stateDeltas ?? [],
      sourceFactIds: [...new Set(input.sourceFactIds ?? [])].sort(stableCompare),
      situationIds: [...new Set(input.situationIds ?? [])].sort(stableCompare),
    };
    context.events.push(event);
    world.history.push(event);
    world.historyDigest = stableHash([world.historyDigest, event]);
    return event;
  };
}

describe('v1.20 court alliance domain action', () => {
  it('purely discovers the dominant faction and its first eligible partner only in winter', () => {
    const { world, polityId, dominant, firstPartner, laterPartner } = threeFactionFixture();
    const winter = turnContext(world);
    const before = serializeWorld(world);

    const candidates = discoverCourtAllianceCandidates(world, winter, [polityId]);
    expect(candidates).toEqual([expect.objectContaining({
      polityId,
      actorId: dominant.leaderId,
      actorFactionId: dominant.id,
      targetId: firstPartner.leaderId,
      targetFactionId: firstPartner.id,
      actorPower: 90,
      targetPower: 80,
      actorCohesion: 56,
      targetCohesion: 48,
    })]);
    expect(autonomousCourtAllianceCandidateFor(world, winter, polityId)).toEqual(candidates[0]);
    expect(courtAllianceCandidateFor(world, winter, dominant.id, laterPartner.id)).toMatchObject({
      actorFactionId: dominant.id,
      targetFactionId: laterPartner.id,
    });
    expect(courtAllianceCandidateFor(world, winter, firstPartner.id, laterPartner.id)).toMatchObject({
      actorFactionId: firstPartner.id,
      targetFactionId: laterPartner.id,
    });
    expect(discoverCourtAllianceCandidates(world, turnContext(world, '秋'), [polityId])).toEqual([]);
    expect(serializeWorld(world)).toBe(before);

    // The old inline loop chose the first partner at cohesion 48 before testing
    // the combined threshold. A failed sum did not fall through to a later,
    // more cohesive faction.
    dominant.cohesion = 55;
    expect(dominant.cohesion + firstPartner.cohesion).toBe(
      COURT_ALLIANCE_COMBINED_COHESION_THRESHOLD - 1,
    );
    expect(autonomousCourtAllianceCandidateFor(world, winter, polityId)).toBeNull();
    expect(courtAllianceCandidateFor(world, winter, dominant.id, laterPartner.id)).not.toBeNull();

    dominant.cohesion = 56;
    firstPartner.cohesion = 47;
    expect(autonomousCourtAllianceCandidateFor(world, winter, polityId)).toMatchObject({
      targetFactionId: laterPartner.id,
    });
  });

  it('sorts without mutating inputs and admits only one candidate per polity', () => {
    const { world, polityId } = threeFactionFixture();
    const candidate = autonomousCourtAllianceCandidateFor(world, turnContext(world), polityId);
    if (!candidate) throw new Error('expected an autonomous alliance candidate');
    const weakerSamePolity: CourtAllianceCandidate = {
      ...candidate,
      candidateId: `${candidate.candidateId}:weaker`,
      actorFactionId: 'fac_weaker',
      actorPower: candidate.actorPower - 1,
    };
    const otherPolity: CourtAllianceCandidate = {
      ...candidate,
      candidateId: `${candidate.candidateId}:other`,
      polityId: 'p_zzzz',
      actorFactionId: 'fac_other',
    };
    const input = [weakerSamePolity, otherPolity, candidate];
    const inputOrder = input.map((item) => item.candidateId);

    const queue = buildCourtAllianceActionQueue(input);

    expect(MAX_COURT_ALLIANCE_ACTIONS_PER_POLITY).toBe(1);
    expect(queue.map((item) => item.candidateId)).toEqual([
      candidate.candidateId,
      otherPolity.candidateId,
    ]);
    expect(new Set(queue.map((item) => item.polityId)).size).toBe(queue.length);
    expect(input.map((item) => item.candidateId)).toEqual(inputOrder);
  });

  it('resolves one exact candidate through the existing relation, commitment, memory and ledger effects', () => {
    const { world, polityId, dominant, firstPartner } = threeFactionFixture();
    const context = turnContext(world);
    const candidate = autonomousCourtAllianceCandidateFor(world, context, polityId);
    if (!candidate) throw new Error('expected an alliance candidate');
    const memoryCalls: Array<{
      sourceId: string;
      targetId: string;
      kind: MemoryKind;
      impact: number;
      summary: string;
      eventId: string;
    }> = [];

    const resolution = resolveCourtAllianceAction(
      world,
      context,
      candidate,
      eventEmitter(world, context),
      {
        createCommitment: (
          targetWorld,
          kind,
          promisorId,
          promiseeId,
          polityIds,
          terms,
          eventId,
          dueTurn,
          trustStake,
        ) => {
          targetWorld.counters.commitment += 1;
          const commitment: CommitmentState = {
            id: `commit_${String(targetWorld.counters.commitment).padStart(5, '0')}`,
            kind,
            promisorId,
            promiseeId,
            polityIds: [...polityIds].sort(stableCompare),
            terms,
            madeTurn: targetWorld.turn,
            dueTurn,
            status: '生效',
            resolvedTurn: null,
            eventId,
            resolutionEventId: null,
            trustStake,
          };
          targetWorld.commitments.push(commitment);
          return commitment;
        },
        remember: (_targetWorld, sourceId, targetId, kind, impact, summary, eventId) => {
          memoryCalls.push({ sourceId, targetId, kind, impact, summary, eventId });
        },
      },
    );

    expect(resolution).toMatchObject({
      outcome: 'formed',
      reasonCode: 'alliance_formed',
      score: 104,
      threshold: 104,
      candidate: {
        actorFactionId: dominant.id,
        targetFactionId: firstPartner.id,
      },
      fact: {
        kind: 'faction_relation_changed',
        payload: {
          polityId,
          leftFactionId: dominant.id,
          rightFactionId: firstPartner.id,
          relation: 'alliance',
          action: 'formed',
          reasonCode: 'court_support_exchange',
        },
      },
      event: { kind: 'faction_alliance_formed' },
      commitment: {
        kind: '政治联盟',
        promisorId: dominant.leaderId,
        promiseeId: firstPartner.leaderId,
        polityIds: [polityId],
        terms: COURT_ALLIANCE_TERMS,
        madeTurn: context.turn,
        dueTurn: context.turn + COURT_ALLIANCE_DURATION_TURNS,
        trustStake: 18,
      },
    });
    expect(dominant.alliedFactionIds).toContain(firstPartner.id);
    expect(firstPartner.alliedFactionIds).toContain(dominant.id);
    expect(dominant.relationSinceTurns[firstPartner.id]).toBe(context.turn);
    expect(firstPartner.relationSinceTurns[dominant.id]).toBe(context.turn);
    expect(memoryCalls).toEqual([
      expect.objectContaining({ sourceId: dominant.leaderId, targetId: firstPartner.leaderId, kind: '恩义', impact: 10 }),
      expect.objectContaining({ sourceId: firstPartner.leaderId, targetId: dominant.leaderId, kind: '恩义', impact: 10 }),
    ]);
    expect(memoryCalls.every((item) => item.eventId === resolution.event?.id)).toBe(true);
    expect(memoryCalls.every((item) => item.summary === resolution.event?.summary)).toBe(true);
    expect(resolution.fact && resolution.event?.sourceFactIds).toEqual([resolution.fact?.id]);
    for (const faction of world.factions.filter((item) => item.active && item.polityId === polityId)) {
      expect(faction.power).toBe(calculateFactionPowerLedger(world, faction).total);
    }
    for (const leaderId of [dominant.leaderId, firstPartner.leaderId]) {
      expect(world.characters.find((item) => item.id === leaderId)?.biography).toContainEqual(
        expect.objectContaining({ factId: resolution.fact?.id, kind: '结成政治联盟' }),
      );
    }
  });

  it('invalidates a stale candidate without a Fact, Event or domain mutation', () => {
    const { world, polityId, firstPartner } = threeFactionFixture();
    const context = turnContext(world);
    const candidate = autonomousCourtAllianceCandidateFor(world, context, polityId);
    if (!candidate) throw new Error('expected an alliance candidate');
    firstPartner.cohesion = 47;
    const before = serializeWorld(world);
    let effectCalls = 0;

    const resolution = resolveCourtAllianceAction(
      world,
      context,
      candidate,
      eventEmitter(world, context),
      {
        createCommitment: () => {
          effectCalls += 1;
          throw new Error('stale candidate must not create a commitment');
        },
        remember: () => {
          effectCalls += 1;
        },
      },
    );

    expect(resolution).toMatchObject({
      outcome: 'invalidated',
      reasonCode: 'conditions_changed',
      fact: null,
      event: null,
      commitment: null,
    });
    expect(effectCalls).toBe(0);
    expect(context.facts).toEqual([]);
    expect(context.events).toEqual([]);
    expect(serializeWorld(world)).toBe(before);
  });

  it('preserves a fixed-seed winter Fact, commitment, two memories and refreshed ledgers', () => {
    const world = advanceWorldBy(createWorld('军权春秋'), 12);
    const replay = advanceWorldBy(createWorld('军权春秋'), 12);
    const formation = world.facts.find((fact) => (
      fact.kind === 'faction_relation_changed'
      && fact.turn === 11
      && fact.payload.relation === 'alliance'
      && fact.payload.action === 'formed'
      && fact.payload.reasonCode === 'court_support_exchange'
    ));
    if (!formation || formation.kind !== 'faction_relation_changed') {
      throw new Error('expected the pre-extraction fixed-seed alliance Fact');
    }
    expect(formation.payload).toMatchObject({
      relation: 'alliance',
      action: 'formed',
      reasonCode: 'court_support_exchange',
    });
    const event = world.history.find((item) => item.sourceFactIds.includes(formation.id));
    expect(event).toMatchObject({
      turn: 11,
      kind: 'faction_alliance_formed',
      sourceFactIds: [formation.id],
    });
    const commitment = world.commitments.find((item) => item.eventId === event?.id);
    expect(commitment).toMatchObject({
      kind: '政治联盟',
      promisorId: formation.payload.leftLeaderId,
      promiseeId: formation.payload.rightLeaderId,
      polityIds: [formation.payload.polityId],
      terms: COURT_ALLIANCE_TERMS,
      madeTurn: 11,
      dueTurn: 27,
      status: '生效',
      trustStake: 18,
    });
    if (!commitment) throw new Error('expected the fixed-seed political commitment');
    expect(politicalAllianceFormationFact(world, commitment)).toEqual(formation);
    for (const [sourceId, targetId] of [
      [formation.payload.leftLeaderId, formation.payload.rightLeaderId],
      [formation.payload.rightLeaderId, formation.payload.leftLeaderId],
    ] as const) {
      expect(world.relationships.find((relation) => (
        relation.sourceId === sourceId && relation.targetId === targetId
      ))?.memories).toContainEqual(expect.objectContaining({
        turn: 11,
        kind: '恩义',
        impact: 10,
        summary: event?.summary,
        eventId: event?.id,
      }));
    }
    for (const factionId of [formation.payload.leftFactionId, formation.payload.rightFactionId]) {
      const faction = world.factions.find((item) => item.id === factionId);
      if (!faction) throw new Error(`missing fixed-seed faction ${factionId}`);
      const ledger = calculateFactionPowerLedger(world, faction);
      expect(faction.power).toBe(ledger.total);
      expect(ledger.categories.find((category) => category.category === 'alliance_support')?.value)
        .toBeGreaterThan(0);
    }
    expect(replay.hash).toBe(world.hash);
    expect(serializeWorld(replay)).toBe(serializeWorld(world));
    expect(validateWorld(world)).toEqual([]);
  });
});
