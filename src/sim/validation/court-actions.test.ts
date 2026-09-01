import { describe, expect, it } from 'vitest';

import { createWorld } from '../index';
import type { CourtActionResolvedFact } from '../facts';
import type { CharacterState, FactionState, PolityState, WorldState } from '../types';
import { validateCourtActionFacts } from './court-actions';

function actors(world: WorldState): {
  polity: PolityState;
  ruler: CharacterState;
  challenger: FactionState;
  leader: CharacterState;
} {
  for (const polity of world.polities) {
    const ruler = world.characters.find((character) => character.id === polity.rulerId);
    const challenger = world.factions.find((faction) => (
      faction.polityId === polity.id && faction.leaderId !== ruler?.id
    ));
    const leader = world.characters.find((character) => character.id === challenger?.leaderId);
    if (ruler && challenger && leader) return { polity, ruler, challenger, leader };
  }
  throw new Error('court invariant fixture requires a ruler and challenger');
}

function formedFact(world: WorldState): CourtActionResolvedFact {
  const { polity, ruler, challenger, leader } = actors(world);
  const fact: CourtActionResolvedFact = {
    id: `fact_test_court_${world.history.length}`,
    turn: 0,
    year: 1,
    season: '春',
    kind: 'court_action_resolved',
    category: '政治',
    importance: 3,
    actorIds: [leader.id, ruler.id],
    polityIds: [polity.id],
    regionIds: polity.capitalRegionId ? [polity.capitalRegionId] : [],
    causes: [{ label: '权势形成', role: '结果', weight: 1, evidence: '多项真实资源汇聚' }],
    stateDeltas: [{
      entityType: 'character', entityId: leader.id, field: 'influence', before: 30, after: 33, delta: 3,
    }],
    sourceFactIds: [],
    payload: {
      action: 'power_broker_formed',
      polityId: polity.id,
      actorFactionId: challenger.id,
      targetFactionId: ruler.factionId,
      initiatorId: leader.id,
      targetId: ruler.id,
      reasonCode: 'multi_resource_dominance',
      score: 72,
      threshold: 66,
      rulerBeforeId: ruler.id,
      rulerAfterId: ruler.id,
      affectedFactionIds: [challenger.id, ...(ruler.factionId ? [ruler.factionId] : [])],
      removedMemberIds: [],
    },
  };
  world.history.push({
    id: `event_test_court_${world.history.length}`,
    turn: fact.turn,
    year: fact.year,
    season: fact.season,
    category: fact.category,
    kind: 'power_broker',
    title: '权臣形成测试纪事',
    summary: '权臣形成事实已经反投影为纪事。',
    importance: fact.importance,
    actorIds: [...fact.actorIds],
    polityIds: [...fact.polityIds],
    regionIds: [...fact.regionIds],
    causes: fact.causes.map((cause) => ({ ...cause })),
    evidence: [],
    stateDeltas: fact.stateDeltas.map((delta) => ({ ...delta })),
    sourceFactIds: [fact.id],
    situationIds: [],
  });
  return fact;
}

function syncProjection(world: WorldState, fact: CourtActionResolvedFact): void {
  const event = world.history.find((item) => item.sourceFactIds.includes(fact.id));
  if (!event) throw new Error('missing court projection fixture');
  event.turn = fact.turn;
  event.category = fact.category;
  event.actorIds = [...fact.actorIds];
  event.polityIds = [...fact.polityIds];
  event.causes = fact.causes.map((cause) => ({ ...cause }));
  event.stateDeltas = fact.stateDeltas.map((delta) => ({ ...delta }));
}

describe('court action Fact invariants', () => {
  it('accepts a concrete power-broker transition', () => {
    const world = createWorld('POL06-court-invariant-valid');
    expect(validateCourtActionFacts(world, [formedFact(world)])).toEqual([]);
  });

  it('uses the formation Fact at the influence cap and rejects no-op or inconsistent deltas', () => {
    const world = createWorld('POL06-court-invariant-bounds');
    const formed = formedFact(world);
    formed.stateDeltas = [];
    syncProjection(world, formed);
    expect(validateCourtActionFacts(world, [formed])).toEqual([]);

    const purge = formedFact(world);
    purge.payload.action = 'purge';
    purge.payload.actorFactionId = purge.payload.targetFactionId;
    purge.payload.targetFactionId = purge.payload.affectedFactionIds[0] ?? null;
    purge.stateDeltas = [
      {
        entityType: 'faction', entityId: purge.payload.targetFactionId ?? '',
        field: 'power', before: 64, after: 64, delta: 0,
      },
      {
        entityType: 'character', entityId: purge.payload.targetId,
        field: 'influence', before: 0, after: 0, delta: 0,
      },
    ];
    syncProjection(world, purge);
    const purgeCodes = validateCourtActionFacts(world, [purge]).map((item) => item.code);
    expect(purgeCodes).toEqual(expect.arrayContaining(['fact.court-noop-delta', 'fact.court-purge-delta']));

    const loyaltyOnly = formedFact(world);
    loyaltyOnly.payload.action = 'purge';
    loyaltyOnly.payload.actorFactionId = loyaltyOnly.payload.targetFactionId;
    loyaltyOnly.payload.targetFactionId = loyaltyOnly.payload.affectedFactionIds[0] ?? null;
    loyaltyOnly.stateDeltas = [{
      entityType: 'character', entityId: loyaltyOnly.payload.targetId,
      field: 'loyalty', before: 80, after: 62, delta: -18,
    }];
    syncProjection(world, loyaltyOnly);
    expect(validateCourtActionFacts(world, [loyaltyOnly]).map((item) => item.code))
      .toContain('fact.court-purge-delta');

    formed.stateDeltas = [{
      entityType: 'character', entityId: formed.payload.initiatorId,
      field: 'influence', before: 99, after: 100, delta: 2,
    }];
    syncProjection(world, formed);
    expect(validateCourtActionFacts(world, [formed]).map((item) => item.code))
      .toContain('fact.court-delta-consistency');
  });

  it('rejects unknown scopes, non-finite checks and a missing primary delta', () => {
    const world = createWorld('POL06-court-invariant-invalid');
    const fact = formedFact(world);
    fact.payload.polityId = 'polity_unknown';
    fact.category = '军事';
    fact.payload.score = Number.POSITIVE_INFINITY;
    fact.stateDeltas = [];
    const codes = validateCourtActionFacts(world, [fact]).map((violation) => violation.code);
    expect(codes).toEqual(expect.arrayContaining([
      'fact.court-polity',
      'fact.court-category',
      'fact.court-faction',
      'fact.court-check',
    ]));
  });

  it('rejects a successful active action below its check and a forged formation threshold', () => {
    const world = createWorld('POL06-court-invariant-score');
    const fact = formedFact(world);
    fact.payload.score = 65;
    fact.payload.threshold = 67;
    const codes = validateCourtActionFacts(world, [fact]).map((item) => item.code);
    expect(codes).toEqual(expect.arrayContaining([
      'fact.court-threshold',
      'fact.court-outcome-check',
    ]));
  });

  it('requires an exact ruler transition and every recorded purge expulsion', () => {
    const world = createWorld('POL06-court-invariant-deltas');
    const coup = formedFact(world);
    coup.payload.action = 'coup';
    coup.payload.rulerAfterId = coup.payload.initiatorId;
    coup.stateDeltas = [];

    const purge = formedFact(world);
    purge.payload.action = 'purge';
    purge.payload.actorFactionId = purge.payload.targetFactionId;
    purge.payload.targetFactionId = purge.payload.affectedFactionIds[0] ?? null;
    purge.payload.removedMemberIds = [purge.payload.initiatorId];
    purge.stateDeltas = [{
      entityType: 'character',
      entityId: purge.payload.targetId,
      field: 'influence',
      before: 60,
      after: 40,
      delta: -20,
    }];

    const coupCodes = validateCourtActionFacts(world, [coup]).map((violation) => violation.code);
    const purgeCodes = validateCourtActionFacts(world, [purge]).map((violation) => violation.code);
    expect(coupCodes).toContain('fact.court-ruler-delta');
    expect(purgeCodes).toContain('fact.court-purge-delta');
  });

  it('rejects a missing or tampered Chronicle projection', () => {
    const missingWorld = createWorld('POL06-court-projection-missing');
    const missing = formedFact(missingWorld);
    missingWorld.history = missingWorld.history.filter((event) => !event.sourceFactIds.includes(missing.id));
    expect(validateCourtActionFacts(missingWorld, [missing]).map((item) => item.code))
      .toContain('fact.court-projection-count');

    const tamperedWorld = createWorld('POL06-court-projection-tampered');
    const tampered = formedFact(tamperedWorld);
    const projection = tamperedWorld.history.find((event) => event.sourceFactIds.includes(tampered.id));
    if (!projection) throw new Error('missing projection fixture');
    projection.causes = [];
    projection.stateDeltas = [];
    expect(validateCourtActionFacts(tamperedWorld, [tampered]).map((item) => item.code))
      .toContain('fact.court-projection-content');
  });
});
