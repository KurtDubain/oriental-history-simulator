import { describe, expect, it } from 'vitest';

import {
  advanceWorld,
  computeWorldHash,
  createWorld,
  deserializeWorld,
  getDateForTurn,
  serializeWorld,
  stableHash,
  validateTurnRuntime,
  type SimulationFact,
  type WorldState,
} from '../index';
import {
  createAgencySystemState,
  MAX_PERSONAL_MEMORIES,
  MAX_PERSONAL_MEMORY_SOURCE_FACTS,
  MAX_PINNED_PERSONAL_MEMORIES,
  reducePersonalMemorySystem,
} from './memory';

type BattleFact = Extract<SimulationFact, { kind: 'battle' }>;
type AppointmentFact = Extract<SimulationFact, { kind: 'appointment_started' | 'appointment_ended' }>;

function factId(index: number): string {
  return `fact_${String(index).padStart(7, '0')}`;
}

function battleFact(
  world: WorldState,
  index: number,
  turn: number,
  warId = 'war_personal_memory',
): BattleFact {
  const date = getDateForTurn(turn);
  const attacker = world.characters[0];
  const defender = world.characters[1];
  const attackerArmy = world.armies[0];
  const defenderArmy = world.armies.find((army) => army.polityId !== attackerArmy?.polityId) ?? world.armies[1];
  const region = world.regions[0];
  const route = world.routes[0];
  if (!attacker || !defender || !attackerArmy || !defenderArmy || !region || !route) {
    throw new Error('PersonalMemory fixture requires two characters, two armies, a region and a route');
  }
  return {
    id: factId(index),
    turn,
    year: date.year,
    season: date.season,
    kind: 'battle',
    category: '军事',
    importance: 3,
    actorIds: [attacker.id, defender.id],
    polityIds: [attacker.polityId, defender.polityId],
    regionIds: [region.id],
    causes: [{ label: '测试会战', role: '结果', weight: 1, evidence: '双方完成一次有据可查的交战' }],
    stateDeltas: [],
    sourceFactIds: [],
    payload: {
      warId,
      targetRegionId: region.id,
      routeId: route.id,
      attackerWon: true,
      attackerPower: 12_000,
      defenderPower: 9_000,
      militiaLosses: 0,
      attacker: {
        armyId: attackerArmy.id,
        polityId: attacker.polityId,
        commanderId: attacker.id,
        deputyCommanderId: null,
        soldiersBefore: 10_000,
        soldiersAfter: 9_000,
        moraleBefore: 70,
        moraleAfter: 74,
        trainingBefore: 60,
        supplyBefore: 72,
        losses: 1_000,
      },
      defenders: [{
        armyId: defenderArmy.id,
        polityId: defender.polityId,
        commanderId: defender.id,
        deputyCommanderId: null,
        soldiersBefore: 9_000,
        soldiersAfter: 7_500,
        moraleBefore: 68,
        moraleAfter: 55,
        trainingBefore: 56,
        supplyBefore: 66,
        losses: 1_500,
      }],
    },
  };
}

function appointmentFact(
  world: WorldState,
  index: number,
  turn: number,
  regionIndex: number,
  rank: number,
  holderIndex = 0,
): AppointmentFact {
  const date = getDateForTurn(turn);
  const holder = world.characters[holderIndex];
  const polity = world.polities.find((item) => item.id === holder?.polityId);
  const region = world.regions[regionIndex];
  if (!holder || !polity || !region) throw new Error('PersonalMemory fixture requires a holder, polity and region');
  return {
    id: factId(index),
    turn,
    year: date.year,
    season: date.season,
    kind: 'appointment_started',
    category: '政治',
    importance: rank >= 80 ? 4 : 2,
    actorIds: [holder.id],
    polityIds: [polity.id],
    regionIds: [region.id],
    causes: [{ label: '测试任命', role: '结果', weight: 1, evidence: '人物获得一项有明确辖地的官职' }],
    stateDeltas: [],
    sourceFactIds: [],
    payload: {
      appointmentId: `office_personal_memory_${index}`,
      action: 'started',
      officeKind: '地方长官',
      holderId: holder.id,
      polityId: polity.id,
      regionId: region.id,
      armyId: null,
      fleetId: null,
      rank,
    },
  };
}

function memoriesFor(world: WorldState, characterId: string) {
  return world.agencySystem.characters.find((entry) => entry.characterId === characterId)?.memories ?? [];
}

describe('C08 authoritative PersonalMemory', () => {
  it('aggregates repeated typed Facts deterministically without losing their semantic subject', () => {
    const world = createWorld('personal-memory-typed-fact-aggregation');
    const characterId = world.characters[0]?.id as string;
    const facts = [battleFact(world, 1, 0), battleFact(world, 2, 0)];

    const first = reducePersonalMemorySystem(world, 0, facts);
    const reordered = reducePersonalMemorySystem(world, 0, [...facts].reverse());
    world.agencySystem = first;
    const memories = memoriesFor(world, characterId);

    expect(reordered).toEqual(first);
    expect(memories).toHaveLength(1);
    expect(memories[0]).toMatchObject({
      characterId,
      scope: 'military',
      kind: 'battle_victory',
      occurrenceCount: 2,
      firstTurn: 0,
      lastTurn: 0,
      pinned: false,
      sourceFactIds: [factId(1), factId(2)],
    });
    expect(memories[0]?.subjectRefs.filter((ref) => ref.primary)).toEqual([
      { kind: 'war', id: 'war_personal_memory', primary: true },
    ]);
    expect(memories[0]?.valence).toBeGreaterThan(0);

    const repeatedSameTurn = reducePersonalMemorySystem(world, 0, facts);
    expect(repeatedSameTurn).toBe(first);
    expect(repeatedSameTurn.characters[0]?.memories[0]?.occurrenceCount).toBe(2);
  });

  it('keeps at most sixteen memories per person and admits at most four permanent memories', () => {
    const world = createWorld('personal-memory-hard-bounds');
    const characterIds = world.characters.slice(0, 2).map((character) => character.id);
    if (characterIds.length !== 2) throw new Error('PersonalMemory fixture requires two characters');
    const firstCharacterFacts = Array.from({ length: 20 }, (_, index) => (
      appointmentFact(world, index + 1, 0, index, index < 6 ? 90 : 20)
    ));
    const secondCharacterFacts = Array.from({ length: 20 }, (_, index) => (
      appointmentFact(world, index + 101, 0, index, index < 6 ? 90 : 20, 1)
    ));

    world.agencySystem = reducePersonalMemorySystem(world, 0, [
      ...secondCharacterFacts.reverse(),
      ...firstCharacterFacts.reverse(),
    ]);
    const expectedPinnedSubjects = world.regions
      .slice(0, MAX_PINNED_PERSONAL_MEMORIES)
      .map((region) => region.id)
      .sort();

    for (const characterId of characterIds) {
      const memories = memoriesFor(world, characterId);
      const pinned = memories.filter((memory) => memory.pinned);
      expect(memories).toHaveLength(MAX_PERSONAL_MEMORIES);
      expect(new Set(memories.map((memory) => memory.id)).size).toBe(MAX_PERSONAL_MEMORIES);
      expect(pinned).toHaveLength(MAX_PINNED_PERSONAL_MEMORIES);
      expect(pinned.map((memory) => memory.subjectRefs.find((ref) => ref.primary)?.id).sort()).toEqual(
        expectedPinnedSubjects,
      );
    }
  });

  it('never displaces an existing permanent memory when later stronger candidates arrive', () => {
    const world = createWorld('personal-memory-permanent-pins');
    const characterId = world.characters[0]?.id as string;
    const opening = Array.from({ length: 16 }, (_, index) => (
      appointmentFact(world, index + 1, 0, index, index < 4 ? 80 : 15)
    ));
    world.agencySystem = reducePersonalMemorySystem(world, 0, opening);
    const pinnedIds = memoriesFor(world, characterId).filter((memory) => memory.pinned).map((memory) => memory.id);

    const challengers = Array.from({ length: 12 }, (_, index) => (
      appointmentFact(world, 100 + index, 1, 30 + index, 100)
    ));
    world.agencySystem = reducePersonalMemorySystem(world, 1, challengers);
    const after = memoriesFor(world, characterId);

    expect(after).toHaveLength(MAX_PERSONAL_MEMORIES);
    expect(after.filter((memory) => memory.pinned).map((memory) => memory.id)).toEqual(pinnedIds);
    expect(after.some((memory) => (
      memory.subjectRefs.find((ref) => ref.primary)?.id === world.regions[30]?.id && !memory.pinned
    ))).toBe(true);
  });

  it('retains the first and three latest Fact references while digesting every aggregate occurrence', () => {
    const world = createWorld('personal-memory-source-fact-bound');
    const characterId = world.characters[0]?.id as string;
    const openingFacts = Array.from({ length: 4 }, (_, index) => battleFact(world, index + 1, 0));
    const laterFacts = Array.from({ length: 3 }, (_, index) => battleFact(world, index + 5, 1));
    const facts = [...openingFacts, ...laterFacts];

    world.agencySystem = reducePersonalMemorySystem(world, 0, openingFacts);
    world.agencySystem = reducePersonalMemorySystem(world, 1, [...laterFacts].reverse());
    const memory = memoriesFor(world, characterId)[0];
    const expectedDigest = facts.reduce(
      (digest, fact, index) => index === 0 ? stableHash([fact.id]) : stableHash([digest, fact.id]),
      '',
    );

    expect(memory?.occurrenceCount).toBe(7);
    expect(memory?.lastTurn).toBe(1);
    expect(memory?.sourceFactIds).toHaveLength(MAX_PERSONAL_MEMORY_SOURCE_FACTS);
    expect(memory?.sourceFactIds).toEqual([factId(1), factId(5), factId(6), factId(7)]);
    expect(memory?.evidenceDigest).toBe(expectedDigest);
  });

  it('does not read Chronicle wording and produces the same state from the same typed Facts', () => {
    const world = createWorld('personal-memory-chronicle-purity');
    const facts = [battleFact(world, 1, 0), appointmentFact(world, 2, 0, 3, 72)];
    const rewritten = structuredClone(world);
    rewritten.history = rewritten.history.map((event) => ({
      ...event,
      title: `另一种标题：${event.title}`,
      summary: `另一种叙述：${event.summary}`,
      evidence: event.evidence.map((item) => `另一种证词：${item}`),
    }));

    const baseline = reducePersonalMemorySystem(world, 0, facts);
    const fromRewrittenChronicle = reducePersonalMemorySystem(rewritten, 0, [...facts].reverse());

    expect(fromRewrittenChronicle).toEqual(baseline);
    expect(world.history[0]?.title).not.toBe(rewritten.history[0]?.title);
  });

  it('round-trips authoritative memories and continues with the same save and hash', () => {
    const world = advanceWorld(createWorld('personal-memory-save-continuity'));
    const memoryCount = world.agencySystem.characters.reduce((sum, entry) => sum + entry.memories.length, 0);

    expect(world.agencySystem.version).toBe(1);
    expect(world.agencySystem.memoryThroughTurn).toBe(world.turn - 1);
    expect(memoryCount).toBeGreaterThan(0);
    expect(computeWorldHash(world)).toBe(world.hash);

    const restored = deserializeWorld(serializeWorld(world));
    expect(restored.agencySystem).toEqual(world.agencySystem);
    expect(restored.hash).toBe(world.hash);

    const continued = advanceWorld(world);
    const continuedAfterLoad = advanceWorld(restored);
    expect(continuedAfterLoad.hash).toBe(continued.hash);
    expect(serializeWorld(continuedAfterLoad)).toBe(serializeWorld(continued));

    const tampered = JSON.parse(serializeWorld(world)) as WorldState;
    const firstMemory = tampered.agencySystem.characters[0]?.memories[0];
    if (!firstMemory) throw new Error('Expected a memory to authenticate in the world hash');
    firstMemory.salience = Math.max(0, firstMemory.salience - 1);
    expect(() => deserializeWorld(JSON.stringify(tampered))).toThrow(/存档哈希校验失败/);
  });

  it('makes runtime validation reject a rehashed memory result that did not come from this quarter Facts', () => {
    const before = createWorld('personal-memory-runtime-reducer');
    const tampered = advanceWorld(before);
    const firstMemory = tampered.agencySystem.characters[0]?.memories[0];
    if (!firstMemory) throw new Error('Expected the opening quarter to create a memory');
    firstMemory.salience = Math.max(0, firstMemory.salience - 1);
    tampered.hash = computeWorldHash(tampered);

    expect(validateTurnRuntime(before, tampered).map((item) => item.code)).toContain(
      'runtime.personal-memory-reducer',
    );
  });

  it('starts from the explicit genesis cursor used by new worlds', () => {
    expect(createAgencySystemState()).toEqual({ version: 1, memoryThroughTurn: -1, characters: [] });
  });

  it('opens early schema-4 saves at the live boundary without inventing memories from old prose', () => {
    const early = advanceWorld(createWorld('personal-memory-early-schema-four'));
    Reflect.deleteProperty(early as unknown as Record<string, unknown>, 'agencySystem');
    early.hash = computeWorldHash(early as WorldState);

    const restored = deserializeWorld(JSON.stringify(early));

    expect(restored.agencySystem).toEqual(createAgencySystemState(restored.turn - 1));
    expect(restored.hash).toBe(computeWorldHash(restored));
    expect(advanceWorld(restored).agencySystem.memoryThroughTurn).toBe(restored.turn);
  });
});
