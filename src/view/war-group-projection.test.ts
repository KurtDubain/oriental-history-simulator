import { describe, expect, it } from 'vitest';

import { armyOrderPath } from '../sim/military/orders';
import { syncFormationStrength } from '../sim/military/personal-forces';
import { computeWorldHash, createWorld, serializeWorld, type WarState } from '../sim';
import { toMapArmies } from './map-adapter';
import { factionForArmy, projectWarGroups } from './war-group-projection';

function stageBorderWar() {
  const world = createWorld('战局集团只读投影');
  const border = world.regions.flatMap((region) => region.neighbors.map((neighborId) => ({
    left: region,
    right: world.regions.find((candidate) => candidate.id === neighborId),
  }))).find(({ left, right }) => right && left.controllerId !== right.controllerId
    && world.armies.some((army) => army.polityId === left.controllerId)
    && world.armies.some((army) => army.polityId === right.controllerId));
  if (!border?.right) throw new Error('expected a shared armed border');
  const attacker = world.armies.find((army) => army.polityId === border.left.controllerId);
  const defender = world.armies.find((army) => army.polityId === border.right?.controllerId);
  if (!attacker || !defender) throw new Error('expected opposing armies');
  const war: WarState = {
    id: 'war_group_projection', kind: 'interstate', attackerId: attacker.polityId,
    defenderId: defender.polityId, startedTurn: world.turn, endedTurn: null, active: true,
    attackerScore: 0, defenderScore: 0, reason: '边境军争', lastBattleTurn: -100,
    goal: '边境', targetRegionIds: [border.right.id], exhaustion: 0,
  };
  world.wars = [war];
  attacker.regionId = border.left.id;
  defender.regionId = border.right.id;
  attacker.order = { ...attacker.order, kind: 'advance', warId: war.id, targetRegionId: defender.regionId, targetArmyId: defender.id };
  defender.order = { ...defender.order, kind: 'hold', warId: war.id, targetRegionId: defender.regionId, targetArmyId: null };
  for (const army of world.armies) {
    if (army.id !== attacker.id && army.id !== defender.id) army.order = { ...army.order, warId: null };
  }
  return { world, war, attacker, defender };
}

describe('war group projection', () => {
  it('counts every personal force once while assigning each formation to one actual command group', () => {
    const { world, war, attacker, defender } = stageBorderWar();
    const lawful = world.characters.find((character) => character.id === attacker.commanderId);
    const actual = world.characters.find((character) => (
      character.factionId
      && character.factionId !== lawful?.factionId
      && character.polityId === attacker.polityId
      && world.personalForces.some((force) => force.ownerId === character.id && force.formationId === null)
    ));
    const actualFaction = world.factions.find((faction) => faction.id === actual?.factionId);
    const actualForce = world.personalForces.find((force) => force.ownerId === actual?.id);
    if (!lawful || !actualFaction || !actual || !actualForce) throw new Error('expected two groups in the attacking polity');
    attacker.deputyCommanderId = actual.id;
    attacker.allegiance = { ...attacker.allegiance, characterId: actual.id, strength: 78 };
    actualForce.formationId = attacker.id;
    actualForce.status = '出征';
    attacker.participantIds.push(actual.id);
    syncFormationStrength(world, attacker);
    world.hash = computeWorldHash(world);
    const before = serializeWorld(world);

    const first = projectWarGroups(world, war.id);
    const second = projectWarGroups(world, war.id);
    if (!first) throw new Error('expected a war projection');
    const armyRows = first.sides.flatMap((side) => side.groups.flatMap((group) => group.armies));
    const projected = first.sides.flatMap((side) => side.groups).find((group) => group.factionId === actualFaction.id);

    expect(second).toEqual(first);
    expect(new Set(armyRows.map((army) => army.id)).size).toBe(armyRows.length);
    expect(armyRows.map((army) => army.id).sort()).toEqual([attacker.id, defender.id].sort());
    expect(first.sides.flatMap((side) => side.groups).reduce((sum, group) => sum + group.soldiers, 0))
      .toBe(attacker.soldiers + defender.soldiers);
    expect(projected?.soldiers).toBe(actualForce.soldiers);
    expect(projected?.armies[0]).toMatchObject({ commandDiverged: true });
    expect(projected?.armies[0]?.authorityNote).toContain(`${lawful.name}掌令，但军中更听${actual.name}`);
    expect(factionForArmy(world, attacker)?.id).toBe(actualFaction.id);
    expect(serializeWorld(world)).toBe(before);
    expect(world.hash).toBe(computeWorldHash(world));
  });

  it('uses the exact order path for map movement and one-step contact', () => {
    const { world, war, attacker, defender } = stageBorderWar();
    const path = armyOrderPath(world, attacker);
    const mapArmy = toMapArmies(world).find((army) => army.id === attacker.id);
    const projection = projectWarGroups(world, war.id);

    expect(path).toEqual([attacker.regionId, defender.regionId]);
    expect(mapArmy?.orderPathRegionIds).toEqual(path);
    expect(mapArmy?.nextRegionId).toBe(defender.regionId);
    expect(mapArmy?.expectedContact).toMatchObject({ armyId: defender.id, regionId: defender.regionId, steps: 1 });
    expect(projection?.contacts[0]).toMatchObject({
      attackerArmyId: attacker.id,
      defenderArmyIds: [defender.id],
      regionId: defender.regionId,
      steps: 1,
    });
  });
});
