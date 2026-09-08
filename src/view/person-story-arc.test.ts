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
  it('keeps accession and a sourced capital capture above repeated late victories, without crediting the absent ruler', () => {
    const world = createWorld('重要转折非固定人生');
    const person = world.characters.find(p => world.armies.some(a => a.commanderId === p.id))!;
    const battle = battleFact(world, person.id, 'career_battle', 30, 100);
    const ruler = world.characters.find(p => p.id !== person.id)!;
    const capital = battle.payload.targetRegionId;
    world.facts.push(battle, { ...battle, id: 'late_battle', turn: 100 }, {
      ...battle, id: 'career_capture', kind: 'territory_control_changed', sourceFactIds: [battle.id],
      payload: { regionId: capital, previousControllerId: 'old_polity', nextControllerId: person.polityId, reason: 'battle_capture', warId: battle.payload.warId },
    });
    const event = { id: 'career_accession', turn: 20, year: 6, season: '春' as const, category: '政治' as const,
      kind: 'succession', title: `${person.name}登位`, summary: `${person.name}获拥立继位。`, importance: 5 as const,
      actorIds: [person.id], polityIds: [person.polityId], regionIds: [], causes: [], evidence: [], sourceFactIds: [], situationIds: [],
      stateDeltas: [{ entityType: 'polity' as const, entityId: person.polityId, field: 'rulerId', before: ruler.id, after: person.id }],
    };
    world.history.push(event, { ...event, id: 'capital_event', kind: 'capital_fall', turn: 30,
      title: '旧国失都', summary: '旧国迁都，权威下降。', actorIds: [person.id, ruler.id],
      regionIds: ['unrelated_first_sorted_region', capital], sourceFactIds: ['career_capture'],
      stateDeltas: [{ entityType: 'polity', entityId: 'old_polity', field: 'capitalRegionId', before: capital, after: 'elsewhere' }],
    });
    const before = serializeWorld(world);
    const arc = projectPersonStoryArc(world, person);
    expect(arc.some(b => b.title === `${person.name}登位`)).toBe(true);
    expect(arc.find(b => b.sourceEventIds.includes('capital_event'))?.title).toContain('参战，攻克');
    expect(projectPersonStoryArc(world, ruler).find(b => b.sourceEventIds.includes('capital_event'))?.title).toBe('任内国事：旧国失都');
    expect(serializeWorld(world)).toBe(before);
    world.facts.reverse(); world.history.reverse();
    expect(projectPersonStoryArc(world, person)).toEqual(arc);
  });

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
    expect(beat?.primaryFactId).toBe('fact_story_wound');
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
    expect(ending?.primaryFactId).toBe(deathId);
  });

  it('does not merge a past wound into a later battle chapter or send its link to unrelated battle evidence', () => {
    const world = createWorld('人物经历时间边界');
    const person = world.characters.find((item) => world.armies.some((army) => army.participantIds.includes(item.id)))!;
    const early = battleFact(world, person.id, 'fact_story_early_battle', 5, 120);
    const later = battleFact(world, person.id, 'fact_story_later_battle', 25, 90);
    const woundId = 'fact_story_early_wound';
    world.facts.push(early, {
      id: woundId,
      turn: 5,
      year: 2,
      season: '夏',
      kind: 'character_wounded',
      category: '军事',
      importance: 4,
      actorIds: [person.id],
      polityIds: [person.polityId],
      regionIds: [early.payload.targetRegionId],
      causes: [],
      stateDeltas: [{ entityType: 'character', entityId: person.id, field: 'health', before: 100, after: 72, delta: -28 }],
      sourceFactIds: [early.id],
      payload: {
        characterId: person.id,
        battleFactId: early.id,
        warId: early.payload.warId,
        regionId: early.payload.targetRegionId,
        role: 'member',
        sideWon: true,
        soldiersBefore: 600,
        soldiersAfter: 480,
        losses: 120,
        healthBefore: 100,
        healthAfter: 72,
        recoveryUntilTurn: 8,
        observerProtectionConsumed: false,
      },
    }, later);
    world.history.push({
      id: 'history_story_early_wound',
      turn: 5,
      year: 2,
      season: '夏',
      category: '军事',
      kind: '人物负伤',
      title: `${person.name}负伤退营`,
      summary: `${person.name}退出行营休养。`,
      importance: 4,
      actorIds: [person.id],
      polityIds: [person.polityId],
      regionIds: [early.payload.targetRegionId],
      causes: [],
      evidence: [],
      stateDeltas: [],
      sourceFactIds: [woundId],
      situationIds: [],
    });

    const story = projectPersonStoryArc(world, person);
    const wound = story.find((beat) => beat.sourceFactIds.includes(woundId));

    expect(wound?.dateLabel).toContain('第 2 年');
    expect(wound?.sourceFactIds).toEqual(['fact_story_early_battle', woundId]);
    expect(wound?.sourceFactIds).not.toContain(later.id);
    expect(wound?.primaryFactId).toBe(woundId);
    expect(wound?.primaryEventId).toBe('history_story_early_wound');
    expect(wound?.summary).toContain('休养至第8季');
  });
});
