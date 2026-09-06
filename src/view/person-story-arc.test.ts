import { describe, expect, it } from 'vitest';

import { computeWorldHash, createWorld, serializeWorld } from '../sim';
import type { BattleFact } from '../sim/facts';
import type { WorldState } from '../sim/types';
import { projectPersonStoryArc } from './person-story-arc';

function battleFact(
  world: WorldState,
  characterId: string,
  id: string,
  turn: number,
  losses: number,
): BattleFact {
  const army = world.armies.find((item) => item.participantIds.includes(characterId))!;
  const force = world.personalForces.find((item) => item.ownerId === characterId)!;
  const before = Math.max(force.soldiers, losses + 120);
  const participant = {
    characterId,
    soldiersBefore: before,
    soldiersAfter: before - losses,
    losses,
    factionId: world.characters.find((item) => item.id === characterId)?.factionId ?? null,
    formationCommanderId: army.commanderId,
    role: characterId === army.commanderId ? 'commander' as const : 'member' as const,
  };
  return {
    id,
    turn,
    year: 1 + Math.floor(turn / 4),
    season: ['春', '夏', '秋', '冬'][turn % 4] as BattleFact['season'],
    kind: 'battle',
    category: '军事',
    importance: 5,
    actorIds: [characterId],
    polityIds: [army.polityId],
    regionIds: [army.regionId],
    causes: [],
    stateDeltas: [],
    sourceFactIds: [],
    payload: {
      warId: 'war-story-test',
      targetRegionId: army.regionId,
      routeId: world.routes[0]!.id,
      attackerWon: true,
      attackerPower: 2,
      defenderPower: 1,
      militiaLosses: 0,
      attacker: {
        armyId: army.id,
        polityId: army.polityId,
        commanderId: army.commanderId,
        deputyCommanderId: army.deputyCommanderId,
        soldiersBefore: before,
        soldiersAfter: before - losses,
        moraleBefore: army.morale,
        moraleAfter: army.morale,
        trainingBefore: army.training,
        supplyBefore: army.supply,
        losses,
        participants: [participant],
      },
      defenders: [],
    },
  };
}

describe('person story arc', () => {
  it('compresses repeated battles, keeps first/costliest/latest sources and deduplicates the Chronicle telling', () => {
    const world = createWorld('人物故事压缩');
    const person = world.characters.find((item) => world.armies.some((army) => army.participantIds.includes(item.id)))!;
    const battles = [
      battleFact(world, person.id, 'fact_story_b1', 4, 20),
      battleFact(world, person.id, 'fact_story_b2', 8, 80),
      battleFact(world, person.id, 'fact_story_b3', 12, 30),
      battleFact(world, person.id, 'fact_story_b4', 16, 40),
    ];
    world.facts.push(...battles);
    const before = serializeWorld(world);
    const hash = computeWorldHash(world);

    const first = projectPersonStoryArc(world, person);
    const second = projectPersonStoryArc(world, person);
    const compressed = first.find((beat) => beat.sourceFactIds.includes('fact_story_b1'));

    expect(first).toEqual(second);
    expect(first.length).toBeLessThanOrEqual(3);
    expect(compressed?.sourceFactIds).toEqual(['fact_story_b1', 'fact_story_b2', 'fact_story_b3', 'fact_story_b4']);
    expect(compressed?.summary).toContain('记录战损累计170人；最近一战战前');
    expect(compressed?.summary).not.toContain('本部由');
    expect(first.every((beat) => beat.sourceFactIds.length > 0)).toBe(true);
    expect(serializeWorld(world)).toBe(before);
    expect(computeWorldHash(world)).toBe(hash);
  });

  it('uses battle-linked wounds and deaths as concrete turning points', () => {
    const world = createWorld('人物命运转折');
    const person = world.characters.find((item) => world.armies.some((army) => army.participantIds.includes(item.id)))!;
    const battle = battleFact(world, person.id, 'fact_story_turn_battle', 4, 90);
    world.facts.push(battle, {
      id: 'fact_story_wound',
      turn: 4,
      year: 2,
      season: '春',
      kind: 'character_wounded',
      category: '军事',
      importance: 4,
      actorIds: [person.id],
      polityIds: [person.polityId],
      regionIds: [battle.payload.targetRegionId],
      causes: [],
      stateDeltas: [{ entityType: 'character', entityId: person.id, field: 'health', before: 100, after: 67, delta: -33 }],
      sourceFactIds: [battle.id],
      payload: {
        characterId: person.id,
        battleFactId: battle.id,
        warId: battle.payload.warId,
        regionId: battle.payload.targetRegionId,
        role: 'commander',
        sideWon: true,
        soldiersBefore: 500,
        soldiersAfter: 410,
        losses: 90,
        healthBefore: 100,
        healthAfter: 67,
        observerProtectionConsumed: false,
      },
    });

    const story = projectPersonStoryArc(world, person);

    const beat = story.find((item) => item.phase === 'setback' && item.sourceFactIds.includes('fact_story_wound'));
    expect(beat?.title).toContain('负伤退营');
    expect(beat?.sourceFactIds).toEqual(['fact_story_turn_battle', 'fact_story_wound']);
    expect(beat?.primaryFactId).toBe('fact_story_turn_battle');
    expect(beat?.summary).toContain('此役战前');
    expect(beat?.summary).toContain('退出行营');
    expect(story.length).toBeLessThanOrEqual(3);
  });

  it('keeps a battle death and its same-seat cleanup in one evidence-owned ending', () => {
    const world = createWorld('人物结局同源归并');
    const person = world.characters.find((item) => world.armies.some((army) => army.commanderId === item.id))!;
    const battle = battleFact(world, person.id, 'fact_story_death_battle', 8, 240);
    const army = world.armies.find((item) => item.commanderId === person.id)!;
    const office = world.offices.find((item) => item.active && item.holderId === person.id)!;
    const deathId = 'fact_story_death';
    world.facts.push(battle, {
      id: deathId, turn: 8, year: 3, season: '春', kind: 'character_death', category: '军事', importance: 5,
      actorIds: [person.id], polityIds: [person.polityId], regionIds: [army.regionId], causes: [], stateDeltas: [],
      sourceFactIds: [battle.id], payload: { characterId: person.id, age: person.age, role: person.role,
        health: person.health, diseaseId: null, cause: 'battle', battleFactId: battle.id },
    }, {
      id: 'fact_story_cleanup', turn: 8, year: 3, season: '春', kind: 'appointment_ended', category: '政治', importance: 3,
      actorIds: [person.id], polityIds: [person.polityId], regionIds: [army.regionId], causes: [], stateDeltas: [],
      sourceFactIds: [deathId], payload: { appointmentId: office.id, action: 'ended', officeKind: office.kind,
        holderId: person.id, polityId: person.polityId, regionId: office.regionId, armyId: office.armyId,
        fleetId: office.fleetId ?? null, rank: office.rank },
    });
    person.alive = false;

    const story = projectPersonStoryArc(world, person);
    const ending = story.find((beat) => beat.phase === 'ending');

    expect(story).toHaveLength(1);
    expect(ending?.sourceFactIds).toEqual([
      'fact_story_cleanup',
      'fact_story_death',
      'fact_story_death_battle',
    ]);
    expect(ending?.summary).toContain(`同季卸下${office.kind}`);
    expect(ending?.primaryFactId).toBe(battle.id);
  });
});
