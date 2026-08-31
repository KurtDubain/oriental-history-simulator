import { describe, expect, it } from 'vitest';

import {
  advanceWorldBy,
  computeWorldHash,
  createWorld,
  deserializeWorld,
  emitSimulationFact,
  serializeWorld,
  validateWorld,
  type CharacterState,
  type HistoryEvent,
  type SimulationFact,
} from '../index';
import type { V03EventInput } from '../v03-context';
import { processV02Society } from '../v02';

describe('schema 4 authoritative fact layer', () => {
  it('records every new war start and ending as an authoritative lifecycle Fact', () => {
    const world = advanceWorldBy(createWorld('春战副将'), 40);
    const startedFacts = world.facts.filter(
      (fact): fact is Extract<SimulationFact, { kind: 'war_started' }> => fact.kind === 'war_started',
    );
    const endedFacts = world.facts.filter(
      (fact): fact is Extract<SimulationFact, { kind: 'war_ended' }> => fact.kind === 'war_ended',
    );

    expect(world.wars.length).toBeGreaterThan(0);
    expect(startedFacts.length).toBe(world.wars.length);
    expect(new Set(startedFacts.map((fact) => fact.payload.warId)).size).toBe(startedFacts.length);
    expect(endedFacts.length).toBe(world.wars.filter((war) => !war.active).length);
    expect(new Set(endedFacts.map((fact) => fact.payload.warId)).size).toBe(endedFacts.length);

    for (const war of world.wars) {
      const start = startedFacts.find((fact) => fact.payload.warId === war.id);
      expect(start?.payload).toMatchObject({
        warId: war.id,
        warKind: war.kind,
        attackerId: war.attackerId,
        defenderId: war.defenderId,
        goal: war.goal,
      });
      expect(start?.stateDeltas).toContainEqual({
        entityType: 'war', entityId: war.id, field: 'active', before: false, after: true,
      });
      const ending = endedFacts.find((fact) => fact.payload.warId === war.id);
      if (war.active) {
        expect(ending).toBeUndefined();
      } else {
        expect(ending?.payload.durationTurns).toBe((war.endedTurn ?? war.startedTurn) - war.startedTurn + 1);
        expect(ending?.payload.attackerScore).toBe(war.attackerScore);
        expect(ending?.payload.defenderScore).toBe(war.defenderScore);
        expect(ending?.stateDeltas).toContainEqual({
          entityType: 'war', entityId: war.id, field: 'active', before: true, after: false,
        });
      }
    }
    expect(validateWorld(world)).toEqual([]);
  }, 15_000);

  it('credits deputies from unpublished battles and retains pre-disband participant snapshots', () => {
    const world = advanceWorldBy(createWorld('春战副将'), 8);
    const battles = world.facts.filter((fact): fact is Extract<SimulationFact, { kind: 'battle' }> => fact.kind === 'battle');
    const projectedFactIds = new Set(world.history.flatMap((event) => event.sourceFactIds));
    const unpublished = battles.filter((fact) => !projectedFactIds.has(fact.id));

    expect(battles.length).toBeGreaterThan(0);
    expect(new Set(battles.map((fact) => fact.id)).size).toBe(battles.length);
    expect(new Set(battles.map((fact) => fact.season))).toEqual(new Set(['春', '夏', '秋', '冬']));
    const battlesByTurn = battles.reduce<Map<number, number>>((counts, fact) => (
      counts.set(fact.turn, (counts.get(fact.turn) ?? 0) + 1)
    ), new Map());
    expect([...battlesByTurn.values()].some((battleCount) => battleCount > 1)).toBe(true);
    expect(unpublished.length).toBeGreaterThan(0);
    expect(battles.every((fact) => (
      fact.payload.attacker.soldiersBefore - fact.payload.attacker.soldiersAfter === fact.payload.attacker.losses
      && fact.payload.defenders.every((force) => force.soldiersBefore - force.soldiersAfter === force.losses)
    ))).toBe(true);
    const survivingArmyIds = new Set(world.armies.map((army) => army.id));
    const disbandedParticipant = battles
      .flatMap((fact) => [fact.payload.attacker, ...fact.payload.defenders])
      .find((force) => !survivingArmyIds.has(force.armyId));
    expect(disbandedParticipant).toMatchObject({
      armyId: expect.any(String),
      polityId: expect.any(String),
      commanderId: expect.any(String),
      soldiersBefore: expect.any(Number),
      soldiersAfter: expect.any(Number),
      losses: expect.any(Number),
    });

    const unpublishedIds = new Set(unpublished.map((fact) => fact.id));
    const creditedDeputy = world.characters.find((character) => character.biography.some((entry) => (
      entry.kind === '首次参战' && entry.factId !== null && unpublishedIds.has(entry.factId)
    )));
    expect(creditedDeputy?.deputyExperience).toBeGreaterThanOrEqual(4);
    const creditedEntry = creditedDeputy?.biography.find((entry) => (
      entry.kind === '首次参战' && entry.factId !== null && unpublishedIds.has(entry.factId)
    ));
    const creditedBattle = unpublished.find((fact) => fact.id === creditedEntry?.factId);
    expect(creditedBattle).toBeDefined();
    expect([
      ...(creditedBattle ? [creditedBattle.payload.attacker] : []),
      ...(creditedBattle?.payload.defenders ?? []),
    ].some((force) => force.deputyCommanderId === creditedDeputy?.id)).toBe(true);
    const factKinds = new Set(world.facts.map((fact) => fact.kind));
    for (const requiredKind of [
      'battle',
      'territory_control_changed',
      'appointment_started',
      'appointment_ended',
      'character_death',
      'marriage',
    ] as const) expect(factKinds.has(requiredKind)).toBe(true);
    const factById = new Map(world.facts.map((fact) => [fact.id, fact]));
    expect(world.history.filter((event) => event.kind === 'battle').every((event) => (
      event.sourceFactIds.length === 1 && factById.get(event.sourceFactIds[0])?.kind === 'battle'
    ))).toBe(true);
    expect(world.facts.filter((fact) => (
      fact.kind === 'territory_control_changed' || fact.kind === 'character_death' || fact.kind === 'marriage'
    )).every((fact) => world.history.some((event) => event.sourceFactIds.includes(fact.id)))).toBe(true);
    // The founding Chronicle may cite opening court appointments as part of the
    // initial world snapshot. Keep checking the runtime publication boundary
    // without coupling this regression to that opening presentation choice.
    const foundingSourceFactIds = new Set(
      world.history.find((event) => event.kind === 'world_created')?.sourceFactIds ?? [],
    );
    const runtimeAppointmentFacts = world.facts.filter((fact) => (
      fact.kind.startsWith('appointment_') && !foundingSourceFactIds.has(fact.id)
    ));
    expect(runtimeAppointmentFacts.length).toBeGreaterThan(0);
    expect(runtimeAppointmentFacts.every((fact) => !projectedFactIds.has(fact.id))).toBe(true);
  });

  it('round-trips JSON facts while Chronicle filtering cannot change the simulation hash', () => {
    const world = advanceWorldBy(createWorld('事实存档往返'), 4);
    const serialized = serializeWorld(world);
    expect(() => JSON.parse(serialized)).not.toThrow();
    const restored = deserializeWorld(serialized);
    expect(restored.hash).toBe(world.hash);
    expect(restored.factDigest).toBe(world.factDigest);
    expect(restored.facts).toEqual(world.facts);

    const tamperedFacts = JSON.parse(serialized) as typeof world;
    const firstBattle = tamperedFacts.facts.find((fact) => fact.kind === 'battle');
    if (firstBattle) firstBattle.payload.attacker.soldiersAfter += 1;
    expect(() => deserializeWorld(JSON.stringify(tamperedFacts))).toThrow(/事实档案摘要校验失败/);

    const presentationVariant = JSON.parse(serialized) as typeof world;
    presentationVariant.history = presentationVariant.history.filter((event) => event.kind !== 'battle');
    presentationVariant.historyDigest = 'presentation-threshold-changed';
    presentationVariant.counters.event += 500;
    if (presentationVariant.lastTurn) presentationVariant.lastTurn.eventIds = [];
    if (presentationVariant.characters[0]?.biography[0]) {
      presentationVariant.characters[0].biography[0].summary = '另一种传记措辞';
      presentationVariant.characters[0].biographyDigest = 'presentation-biography-changed';
    }
    expect(computeWorldHash(presentationVariant)).toBe(world.hash);
  });

  it('settles family inheritance from a DeathFact even when no death Chronicle is emitted', () => {
    const world = advanceWorldBy(createWorld('死亡事实继承'), 3);
    const family = world.families.find((candidate) => candidate.active && candidate.memberIds.filter((id) => (
      world.characters.some((character) => character.id === id && character.alive && character.age >= 16)
    )).length >= 2);
    expect(family).toBeDefined();
    if (!family) return;
    const deceased = world.characters.find((character) => character.id === family.headId) as CharacterState;
    const inheritor = family.memberIds
      .map((id) => world.characters.find((character) => character.id === id))
      .find((character): character is CharacterState => Boolean(character?.alive && character.id !== deceased.id && character.age >= 16));
    expect(inheritor).toBeDefined();
    if (!inheritor) return;

    const context = { turn: 3, year: 1, season: '冬' as const, events: [] as HistoryEvent[], facts: [] as SimulationFact[] };
    deceased.alive = false;
    deceased.deathTurn = context.turn;
    deceased.lifeStage = '已故';
    deceased.personalWealth = 137;
    inheritor.parentIds = [...new Set([...inheritor.parentIds, deceased.id])];
    const inheritorWealthBefore = inheritor.personalWealth;
    const privateWealthBefore = world.characters.reduce((sum, character) => sum + character.personalWealth, 0);
    const deathFact = emitSimulationFact(world, context, {
      kind: 'character_death',
      category: '政治',
      importance: 3,
      actorIds: [deceased.id],
      polityIds: [deceased.polityId],
      regionIds: [deceased.locationRegionId],
      causes: [{ label: '测试死亡', role: '结果', weight: 1, evidence: '权威生命状态已经结算' }],
      stateDeltas: [{ entityType: 'character', entityId: deceased.id, field: 'alive', before: true, after: false }],
      sourceFactIds: [],
      payload: { characterId: deceased.id, age: deceased.age, role: deceased.role, health: deceased.health, diseaseId: null },
    });
    const emit = (input: V03EventInput): HistoryEvent => {
      const event: HistoryEvent = {
        id: `test_event_${context.events.length + 1}`,
        turn: context.turn,
        year: context.year,
        season: context.season,
        category: input.category,
        kind: input.kind,
        title: input.title,
        summary: input.summary,
        importance: input.importance,
        actorIds: input.actorIds ?? [],
        polityIds: input.polityIds ?? [],
        regionIds: input.regionIds ?? [],
        causes: input.causes,
        evidence: input.evidence ?? input.causes.map((cause) => cause.evidence),
        stateDeltas: input.stateDeltas ?? [],
        sourceFactIds: input.sourceFactIds ?? [],
        situationIds: input.situationIds ?? [],
      };
      context.events.push(event);
      return event;
    };

    expect(context.events.some((event) => event.kind === 'character_death')).toBe(false);
    processV02Society(world, context, emit);

    expect(deceased.personalWealth).toBe(0);
    expect(inheritor.personalWealth).toBe(inheritorWealthBefore + 137);
    expect(world.characters.reduce((sum, character) => sum + character.personalWealth, 0)).toBe(privateWealthBefore);
    expect(context.events.find((event) => event.kind === 'family_inheritance')?.sourceFactIds).toContain(deathFact.id);
    expect(deceased.biography.some((entry) => entry.kind === '逝世' && entry.factId === deathFact.id)).toBe(true);
  });
});
