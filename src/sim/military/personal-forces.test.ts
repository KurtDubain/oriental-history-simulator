import { describe, expect, it } from 'vitest';

import { computeWorldHash, createWorld, serializeWorld, validateWorld } from '../index';
import { toMapPersonForces } from '../../view/map-adapter';
import { applyFormationLosses, formationForces, syncFormationStrength } from './personal-forces';
import { desiredFieldFormationCount } from './formation-bootstrap';

describe('personal military forces', () => {
  it('gives every eligible living person one positive force and never places it in two formations', () => {
    const left = createWorld('人人皆有部曲');
    const right = createWorld('人人皆有部曲');
    const eligibleIds = left.characters
      .filter((character) => character.alive && (character.age >= 16 || left.polities.some((polity) => (
        polity.alive && polity.rulerId === character.id
      ))))
      .map((character) => character.id)
      .sort();

    expect(left.personalForces.map((force) => force.ownerId).sort()).toEqual(eligibleIds);
    expect(left.personalForces.every((force) => force.soldiers > 0)).toBe(true);
    expect(new Set(left.personalForces.map((force) => force.ownerId)).size).toBe(left.personalForces.length);
    expect(left.personalForces).toEqual(right.personalForces);

    const formationOwners = left.armies.flatMap((army) => army.participantIds);
    expect(new Set(formationOwners).size).toBe(formationOwners.length);
    for (const army of left.armies) {
      expect(formationForces(left, army).reduce((sum, force) => sum + force.soldiers, 0)).toBe(army.soldiers);
    }
    expect(validateWorld(left)).toEqual([]);
  });

  it('distributes exact integer casualties to owners and derives the formation cache afterwards', () => {
    const left = createWorld('部曲伤亡归个人');
    const army = left.armies.find((item) => item.participantIds.length >= 2);
    if (!army) throw new Error('expected a formation with several personal forces');
    const right = structuredClone(left);
    const rightArmy = right.armies.find((item) => item.id === army.id);
    if (!rightArmy) throw new Error('expected cloned formation');
    const requested = Math.max(1, Math.floor(army.soldiers * 0.23));

    const first = applyFormationLosses(left, [army], requested);
    const second = applyFormationLosses(right, [rightArmy], requested);

    expect(first).toEqual(second);
    expect(first.reduce((sum, item) => sum + item.losses, 0)).toBe(requested);
    expect(first.every((item) => item.soldiersAfter >= 0
      && item.soldiersBefore - item.soldiersAfter === item.losses)).toBe(true);
    expect(syncFormationStrength(left, army)).toBe(army.soldiers);
    expect(army.soldiers).toBe(first.reduce((sum, item) => sum + item.soldiersAfter, 0));
  });

  it('removes exhausted owners from the temporary formation without deleting their identity', () => {
    const world = createWorld('部曲耗尽退出行营');
    const army = world.armies.find((item) => item.participantIds.length >= 2);
    if (!army) throw new Error('expected a formation with several personal forces');
    const owners = [...army.participantIds];

    const losses = applyFormationLosses(world, [army], army.soldiers);

    expect(losses.reduce((sum, item) => sum + item.losses, 0)).toBe(losses.reduce((sum, item) => sum + item.soldiersBefore, 0));
    expect(army.soldiers).toBe(0);
    expect(army.participantIds).toEqual([]);
    expect(world.personalForces.filter((force) => owners.includes(force.ownerId))).toEqual(
      expect.arrayContaining(owners.map((ownerId) => expect.objectContaining({ ownerId, soldiers: 0, formationId: null }))),
    );
  });

  it('projects one clickable person per force without changing world state or hash', () => {
    const world = createWorld('人物点只读边界');
    const before = serializeWorld(world);
    const hash = computeWorldHash(world);

    const persons = toMapPersonForces(world);

    expect(persons).toHaveLength(world.personalForces.length);
    expect(new Set(persons.map((person) => person.id)).size).toBe(persons.length);
    expect(persons.every((person) => person.regionId && person.polityColor && person.soldiers >= 0)).toBe(true);
    expect(serializeWorld(world)).toBe(before);
    expect(computeWorldHash(world)).toBe(hash);
  });

  it('derives formation demand from concurrent wars without a three-formation ceiling', () => {
    const world = createWorld('多线用兵不封顶');
    const polity = world.polities[0];
    const enemy = world.polities[1];
    if (!polity || !enemy) throw new Error('expected two opening polities');
    for (let index = 0; index < 4; index += 1) {
      world.wars.push({
        id: `war-demand-${index}`,
        kind: 'interstate',
        attackerId: polity.id,
        defenderId: enemy.id,
        startedTurn: 0,
        endedTurn: null,
        active: true,
        attackerScore: 0,
        defenderScore: 0,
        reason: '多线军势测试',
        lastBattleTurn: -1,
        goal: '边境',
        targetRegionIds: [enemy.controlledRegionIds[index % enemy.controlledRegionIds.length]!],
        exhaustion: 0,
      });
    }
    expect(desiredFieldFormationCount(world, polity)).toBeGreaterThan(3);
  });
});
