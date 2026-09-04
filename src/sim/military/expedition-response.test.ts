import { describe, expect, it } from 'vitest';

import { advanceWorld, createWorld } from '../index';
import type { CharacterState, RelationshipState, WarState, WorldState } from '../types';
import { isAvailableForExpedition, selectExpeditionResponses } from './expedition-response';

function availablePeople(world: WorldState, polityId: string): CharacterState[] {
  return world.characters.filter((character) => isAvailableForExpedition(world, polityId, character));
}

function setRelation(
  world: WorldState,
  sourceId: string,
  targetId: string,
  values: Partial<RelationshipState>,
): void {
  const current = world.relationships.find((item) => item.sourceId === sourceId && item.targetId === targetId);
  const relation: RelationshipState = current ?? {
    id: `rel:${sourceId}:${targetId}`,
    sourceId,
    targetId,
    kinship: '无',
    affinity: 0,
    trust: 40,
    fear: 0,
    grievance: 0,
    gratitude: 0,
    lastInteractionTurn: world.turn,
    memories: [],
  };
  Object.assign(relation, values);
  if (!current) world.relationships.push(relation);
}

describe('expedition responses', () => {
  it('is deterministic and favors trusted comrades without drafting every member of one faction', () => {
    const world = createWorld('同袍响应不是全员点名');
    const polity = world.polities.find((item) => availablePeople(world, item.id).length >= 6)!;
    const people = availablePeople(world, polity.id).slice(0, 6);
    const commander = people[0]!;
    const region = world.regions.find((item) => item.id === commander.locationRegionId)!;
    const factionId = world.factions.find((item) => item.polityId === polity.id)?.id ?? null;
    for (const candidate of people.slice(1)) {
      candidate.locationRegionId = region.id;
      candidate.factionId = factionId;
      candidate.loyalty = 80;
      setRelation(world, candidate.id, commander.id, { trust: 82, affinity: 55, gratitude: 35 });
    }

    const first = selectExpeditionResponses(world, polity, commander, region);
    const second = selectExpeditionResponses(structuredClone(world), structuredClone(polity), structuredClone(commander), structuredClone(region));

    expect(first).toEqual(second);
    expect(first.participantIds[0]).toBe(commander.id);
    expect(first.participantIds.length).toBeGreaterThan(1);
    expect(first.participantIds.length).toBeLessThan(people.length);
    expect(new Set(first.participantIds).size).toBe(first.participantIds.length);
  });

  it('keeps an unrelated office-holder at home and records open hostility as refusal', () => {
    const world = createWorld('积怨之人拒绝出征');
    const polity = world.polities.find((item) => availablePeople(world, item.id).length >= 3)!;
    const [commander, refuser, officeHolder] = availablePeople(world, polity.id);
    const region = world.regions.find((item) => item.id === commander!.locationRegionId)!;
    refuser!.loyalty = 4;
    refuser!.insubordination = 92;
    refuser!.ambition = 90;
    setRelation(world, refuser!.id, commander!.id, { trust: 2, grievance: 96, affinity: -70 });
    officeHolder!.governedRegionId = officeHolder!.locationRegionId;
    officeHolder!.loyalty = 35;
    setRelation(world, officeHolder!.id, commander!.id, { trust: 18, grievance: 20 });

    const result = selectExpeditionResponses(world, polity, commander!, region);

    expect(result.decisions.find((item) => item.characterId === refuser!.id)).toMatchObject({
      outcome: 'refused',
      publicRefusal: true,
    });
    expect(result.participantIds).not.toContain(refuser!.id);
    expect(result.participantIds).not.toContain(officeHolder!.id);
  });

  it('lets a trusted person from another group respond without mutating those who stay behind', () => {
    const world = createWorld('异派同袍应征');
    const polity = world.polities.find((item) => availablePeople(world, item.id).length >= 4)!;
    const [commander, ally, stayer] = availablePeople(world, polity.id);
    const region = world.regions.find((item) => item.id === commander!.locationRegionId)!;
    ally!.factionId = world.factions.find((item) => item.polityId === polity.id && item.id !== commander!.factionId)?.id ?? null;
    ally!.locationRegionId = region.id;
    ally!.loyalty = 100;
    world.personalForces.find((item) => item.ownerId === ally!.id)!.readiness = 100;
    setRelation(world, ally!.id, commander!.id, { trust: 100, affinity: 80, gratitude: 70 });
    stayer!.governedRegionId = stayer!.locationRegionId;
    stayer!.loyalty = 15;
    stayer!.insubordination = 55;
    setRelation(world, stayer!.id, commander!.id, { trust: 12, grievance: 40 });
    const before = structuredClone({ character: stayer, force: world.personalForces.find((item) => item.ownerId === stayer!.id) });

    const result = selectExpeditionResponses(world, polity, commander!, region);

    expect(result.participantIds).toContain(ally!.id);
    expect(result.participantIds).not.toContain(stayer!.id);
    expect({ character: stayer, force: world.personalForces.find((item) => item.ownerId === stayer!.id) }).toEqual(before);
  });

  it('continues expanding wartime formations when the strongest non-commander is already attached elsewhere', () => {
    const world = createWorld('多线出征不可卡死');
    const polity = world.polities.find((item) => {
      const unformed = availablePeople(world, item.id);
      const attachedMember = world.armies.find((army) => army.polityId === item.id)?.participantIds
        .map((id) => world.characters.find((character) => character.id === id))
        .find((character) => character && !character.commandingArmyId);
      return unformed.length >= 2 && attachedMember;
    })!;
    const army = world.armies.find((item) => item.polityId === polity.id)!;
    const blocker = army.participantIds
      .map((id) => world.characters.find((character) => character.id === id))
      .find((character) => character && !character.commandingArmyId)!;
    blocker.leadership = 100;
    blocker.cunning = 100;
    blocker.loyalty = 100;
    blocker.renown = 100;
    for (const candidate of availablePeople(world, polity.id)) {
      candidate.leadership = 20;
      candidate.cunning = 20;
    }
    const enemy = world.polities.find((item) => item.id !== polity.id && item.alive)!;
    const before = world.armies.filter((item) => item.polityId === polity.id).length;
    for (let index = 0; index < 3; index += 1) {
      const war: WarState = {
        id: `test-war-${index}`,
        kind: 'interstate',
        attackerId: polity.id,
        defenderId: enemy.id,
        startedTurn: world.turn,
        endedTurn: null,
        active: true,
        attackerScore: 0,
        defenderScore: 0,
        reason: '多线调兵测试',
        lastBattleTurn: -1,
        goal: '边境',
        targetRegionIds: [enemy.controlledRegionIds[index % enemy.controlledRegionIds.length]!],
        exhaustion: 0,
      };
      world.wars.push(war);
    }

    const next = advanceWorld(world);
    const added = next.armies.filter((item) => item.polityId === polity.id && !world.armies.some((old) => old.id === item.id));

    expect(next.armies.filter((item) => item.polityId === polity.id).length).toBeGreaterThan(before);
    expect(added.every((item) => item.commanderId !== blocker.id)).toBe(true);
  });
});
