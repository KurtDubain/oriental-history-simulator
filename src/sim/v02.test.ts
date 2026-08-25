import { describe, expect, it } from 'vitest';

import {
  advanceWorld,
  advanceWorldBy,
  computeWorldHash,
  createWorld,
  keyedInt,
  serializeWorld,
  validateWorld,
  type CharacterState,
  type WorldState,
} from './index';

function relationTrust(world: WorldState, sourceId: string, targetId: string): number {
  return world.relationships.find((relation) => (
    relation.sourceId === sourceId && relation.targetId === targetId
  ))?.trust ?? keyedInt(world.seed, 30, 62, 'relationship', sourceId, targetId, 'trust');
}

function expectConnectedMap(world: WorldState): void {
  const adjacency = new Map<string, Set<string>>();
  const link = (left: string, right: string): void => {
    if (!adjacency.has(left)) adjacency.set(left, new Set());
    if (!adjacency.has(right)) adjacency.set(right, new Set());
    adjacency.get(left)?.add(right);
    adjacency.get(right)?.add(left);
  };
  for (const region of world.regions) adjacency.set(region.id, new Set());
  for (const zone of world.seaZones) adjacency.set(zone.id, new Set());
  for (const route of world.routes) link(route.fromRegionId, route.toRegionId);
  for (const lane of world.seaLanes) link(lane.fromSeaZoneId, lane.toSeaZoneId);
  for (const portLink of world.portLinks) link(portLink.regionId, portLink.seaZoneId);
  const visited = new Set<string>();
  const queue = [world.regions[0]?.id ?? ''];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (!id || visited.has(id)) continue;
    visited.add(id);
    for (const neighborId of adjacency.get(id) ?? []) if (!visited.has(neighborId)) queue.push(neighborId);
  }
  expect(visited.size).toBe(world.regions.length + world.seaZones.length);
}

describe('V0.2 coupled social simulation', () => {
  it('keeps the input snapshot pure and deeply clones every mutable nested system', () => {
    const initial = createWorld('深拷贝审计');
    const serialized = serializeWorld(initial);
    const next = advanceWorld(initial);

    expect(serializeWorld(initial)).toBe(serialized);
    expect(next.regions[0]).not.toBe(initial.regions[0]);
    expect(next.regions[0]?.polygon).not.toBe(initial.regions[0]?.polygon);
    expect(next.regions[0]?.polygon[0]).not.toBe(initial.regions[0]?.polygon[0]);
    expect(next.regions[0]?.neighbors).not.toBe(initial.regions[0]?.neighbors);
    expect(next.regions[0]?.goods).not.toBe(initial.regions[0]?.goods);
    expect(next.regions[0]?.prices).not.toBe(initial.regions[0]?.prices);
    expect(next.polities[0]?.controlledRegionIds).not.toBe(initial.polities[0]?.controlledRegionIds);
    expect(next.characters[0]?.biography).not.toBe(initial.characters[0]?.biography);
    expect(next.characters[0]?.parentIds).not.toBe(initial.characters[0]?.parentIds);
    expect(next.families[0]?.traditions).not.toBe(initial.families[0]?.traditions);
    expect(next.families[0]?.memberIds).not.toBe(initial.families[0]?.memberIds);
    expect(next.relationships[0]?.memories).not.toBe(initial.relationships[0]?.memories);
    expect(next.factions[0]?.memberIds).not.toBe(initial.factions[0]?.memberIds);
    expect(next.diplomacy[0]?.marriageIds).not.toBe(initial.diplomacy[0]?.marriageIds);
    expect(next.backgroundPeople[0]?.potential).not.toBe(initial.backgroundPeople[0]?.potential);
    expect(next.seaZones[0]?.powerByPolity).not.toBe(initial.seaZones[0]?.powerByPolity);
    expect(next.infections[0]?.recentSources).not.toBe(initial.infections[0]?.recentSources);
    expect(next.practiceStates[0]?.carrierCharacterIds).not.toBe(initial.practiceStates[0]?.carrierCharacterIds);
    expectConnectedMap(next);
    expect(validateWorld(next)).toEqual([]);
  });

  it('transfers a deceased family head estate without creating or losing private wealth', () => {
    const world = advanceWorldBy(createWorld('家产守恒'), 3);
    const family = world.families.find((candidate) => (
      candidate.active
      && candidate.memberIds.filter((id) => world.characters.some((character) => character.id === id && character.alive && character.age >= 16)).length >= 2
    ));
    expect(family).toBeDefined();
    if (!family) return;
    const deceased = world.characters.find((character) => character.id === family.headId) as CharacterState;
    const inheritor = family.memberIds
      .map((id) => world.characters.find((character) => character.id === id))
      .find((character): character is CharacterState => Boolean(character?.alive && character.id !== deceased.id && character.age >= 16));
    expect(inheritor).toBeDefined();
    if (!inheritor) return;

    deceased.age = 93;
    deceased.birthTurn = world.turn + 1 - 94 * 4;
    deceased.adultTurn = deceased.birthTurn + 16 * 4;
    deceased.personalWealth = 137;
    inheritor.parentIds = [...new Set([...inheritor.parentIds, deceased.id])];
    const privateWealthBefore = world.characters.reduce((sum, character) => sum + character.personalWealth, 0);
    const inheritorWealthBefore = inheritor.personalWealth;
    world.hash = computeWorldHash(world);

    const next = advanceWorld(world);
    const deceasedAfter = next.characters.find((character) => character.id === deceased.id) as CharacterState;
    const inheritorAfter = next.characters.find((character) => character.id === inheritor.id) as CharacterState;
    const inheritance = next.history.find((event) => (
      event.turn === 3 && event.kind === 'family_inheritance' && event.actorIds.includes(deceased.id)
    ));
    expect(deceasedAfter.alive).toBe(false);
    expect(deceasedAfter.personalWealth).toBe(0);
    expect(inheritorAfter.personalWealth).toBe(inheritorWealthBefore + 137);
    expect(next.characters.reduce((sum, character) => sum + character.personalWealth, 0)).toBe(privateWealthBefore);
    expect(inheritance?.stateDeltas
      .filter((delta) => delta.field === 'personalWealth' || delta.field === 'wealth')
      .reduce((sum, delta) => sum + (delta.delta ?? 0), 0)).toBe(0);
    expect(validateWorld(next)).toEqual([]);
  });

  it('makes military promises measurably increase trust when kept and decrease it when broken', () => {
    let world = advanceWorld(createWorld('军令承诺单调'));
    for (const polity of world.polities) {
      polity.authority = 100;
      polity.legitimacy = 100;
      polity.lastWarTurn = world.turn;
      const ruler = world.characters.find((character) => character.id === polity.rulerId);
      if (ruler) {
        ruler.ambition = 0;
        ruler.caution = 100;
      }
    }
    const pairedArmies = world.armies.filter((army) => army.deputyCommanderId).slice(0, 2);
    expect(pairedArmies).toHaveLength(2);
    const breaker = world.characters.find((character) => character.id === pairedArmies[0]?.deputyCommanderId) as CharacterState;
    const keeper = world.characters.find((character) => character.id === pairedArmies[1]?.deputyCommanderId) as CharacterState;
    const breakerCommanderId = pairedArmies[0]?.commanderId as string;
    const keeperCommanderId = pairedArmies[1]?.commanderId as string;
    for (const character of [breaker, keeper]) {
      character.age = 20;
      character.birthTurn = world.turn - 20 * 4;
      character.adultTurn = character.birthTurn + 16 * 4;
    }
    breaker.ambition = 100;
    breaker.loyalty = 0;
    breaker.caution = 0;
    breaker.insubordination = 100;
    keeper.ambition = 0;
    keeper.loyalty = 100;
    keeper.caution = 100;
    keeper.insubordination = 0;
    world.hash = computeWorldHash(world);

    world = advanceWorldBy(world, 3);
    const brokenPromise = world.commitments.find((commitment) => commitment.kind === '军令' && commitment.promisorId === breaker.id);
    const keptPromise = world.commitments.find((commitment) => commitment.kind === '军令' && commitment.promisorId === keeper.id);
    expect(brokenPromise?.status).toBe('生效');
    expect(keptPromise?.status).toBe('生效');
    const breakerTrustBefore = relationTrust(world, breakerCommanderId, breaker.id);
    const keeperTrustBefore = relationTrust(world, keeperCommanderId, keeper.id);

    world = advanceWorldBy(world, 4);
    const brokenAfter = world.commitments.find((commitment) => commitment.id === brokenPromise?.id);
    expect(brokenAfter?.status).toBe('背约');
    expect(relationTrust(world, breakerCommanderId, breaker.id)).toBeLessThan(breakerTrustBefore);
    expect(world.relationships.some((relationship) => relationship.memories.some((memory) => (
      memory.eventId === brokenAfter?.resolutionEventId && memory.kind === '背叛'
    )))).toBe(true);

    world = advanceWorldBy(world, 12);
    const keptAfter = world.commitments.find((commitment) => commitment.id === keptPromise?.id);
    expect(keptAfter?.status).toBe('履约');
    expect(relationTrust(world, keeperCommanderId, keeper.id)).toBeGreaterThan(keeperTrustBefore);
    expect(world.relationships.some((relationship) => relationship.memories.some((memory) => (
      memory.eventId === keptAfter?.resolutionEventId && memory.kind === '恩义'
    )))).toBe(true);
    expect(validateWorld(world)).toEqual([]);
  });

  it('dissolves a polity with no heir, regent or adult background candidate instead of fabricating an adult', () => {
    const world = advanceWorldBy(createWorld('无嗣断档'), 3);
    const polity = world.polities.find((candidate) => candidate.id === 'p_yan');
    const ruler = world.characters.find((character) => character.id === polity?.rulerId);
    expect(polity).toBeDefined();
    expect(ruler).toBeDefined();
    if (!polity || !ruler) return;
    for (const character of world.characters.filter((candidate) => candidate.polityId === polity.id && candidate.id !== ruler.id)) {
      character.alive = false;
      character.deathTurn = 2;
      character.lifeStage = '已故';
      character.governedRegionId = null;
      character.commandingArmyId = null;
    }
    for (const candidate of world.backgroundPeople) candidate.birthTurn = world.turn;
    ruler.age = 93;
    ruler.birthTurn = world.turn + 1 - 94 * 4;
    ruler.adultTurn = ruler.birthTurn + 16 * 4;
    world.hash = computeWorldHash(world);

    const next = advanceWorld(world);
    const dissolved = next.history.find((event) => event.turn === 3 && event.kind === 'polity_dissolved');
    expect(next.polities.find((candidate) => candidate.id === polity.id)?.alive).toBe(false);
    expect(dissolved?.causes.map((cause) => cause.role)).toEqual(expect.arrayContaining(['结构', '条件', '触发', '结果']));
    expect(dissolved?.causes.map((cause) => cause.label)).toEqual(expect.arrayContaining([
      '统治谱系断绝',
      '摄政资源枯竭',
      '候补池断档',
      '地方并入',
    ]));
    const priorIds = new Set(world.characters.map((character) => character.id));
    expect(next.characters.filter((character) => !priorIds.has(character.id) && character.age >= 16)).toHaveLength(0);
    expect(validateWorld(next)).toEqual([]);
  });

  it('uses a registered minor ward and anonymous council when the last polity has no adult successor', () => {
    const world = advanceWorldBy(createWorld('末国无人'), 3);
    const polity = world.polities.find((candidate) => candidate.id === 'p_yan');
    const ruler = world.characters.find((character) => character.id === polity?.rulerId);
    expect(polity).toBeDefined();
    expect(ruler).toBeDefined();
    if (!polity || !ruler) return;

    for (const army of world.armies) {
      const region = world.regions.find((candidate) => candidate.id === army.regionId);
      if (region) {
        region.population += army.soldiers;
        region.food += army.food;
      }
    }
    world.armies = [];
    for (const character of world.characters) {
      character.governedRegionId = null;
      character.commandingArmyId = null;
      if (character.id === ruler.id) continue;
      character.alive = false;
      character.deathTurn = 2;
      character.lifeStage = '已故';
    }
    for (const region of world.regions) region.controllerId = polity.id;
    for (const candidate of world.polities) {
      if (candidate.id === polity.id) continue;
      candidate.alive = false;
      candidate.eliminatedTurn = 2;
      candidate.capitalRegionId = null;
      candidate.controlledRegionIds = [];
      candidate.treasury = 0;
    }
    polity.controlledRegionIds = world.regions.map((region) => region.id).sort();
    for (const faction of world.factions) {
      faction.active = false;
      faction.endedTurn = 2;
      faction.alliedFactionIds = [];
    }
    for (const relation of world.diplomacy) {
      relation.status = '中立';
      relation.allianceUntilTurn = null;
    }
    world.wars = [];
    for (const candidate of world.backgroundPeople) {
      candidate.polityId = polity.id;
      candidate.birthTurn = world.turn;
    }
    ruler.age = 93;
    ruler.birthTurn = world.turn + 1 - 94 * 4;
    ruler.adultTurn = ruler.birthTurn + 16 * 4;
    world.hash = computeWorldHash(world);

    const next = advanceWorld(world);
    const lastPolity = next.polities.find((candidate) => candidate.id === polity.id);
    const ward = next.characters.find((character) => character.id === lastPolity?.rulerId);
    const regency = next.history.find((event) => event.turn === 3 && event.kind === 'regency');
    expect(lastPolity?.alive).toBe(true);
    expect(lastPolity?.governmentForm).toBe('盟约');
    expect(ward?.age).toBeLessThan(16);
    expect(ward?.sourceStubId).not.toBeNull();
    expect(regency?.summary).toContain('匿名摄政议会');
    expect(next.history.some((event) => event.kind === 'polity_dissolved' && event.polityIds.includes(polity.id))).toBe(false);
    expect(validateWorld(next)).toEqual([]);
  });

  it('keeps lineage, deputy evidence, rulers and conquered-population ownership coherent for fifty years', () => {
    const initial = createWorld('五十年社会审计');
    const potentialById = new Map(initial.backgroundPeople.map((person) => [person.id, { ...person.potential }]));
    let world = initial;
    for (let turn = 0; turn < 200; turn += 1) {
      world = advanceWorld(world);
      for (const person of world.backgroundPeople) {
        const recorded = potentialById.get(person.id);
        if (recorded) expect(person.potential).toEqual(recorded);
        else potentialById.set(person.id, { ...person.potential });
      }
    }
    const polityById = new Map(world.polities.map((polity) => [polity.id, polity]));
    const regionById = new Map(world.regions.map((region) => [region.id, region]));

    expect(validateWorld(world)).toEqual([]);
    expectConnectedMap(world);
    expect(new Set(world.polities.filter((polity) => polity.alive).map((polity) => polity.rulerId)).size)
      .toBe(world.polities.filter((polity) => polity.alive).length);
    expect(world.characters.filter((character) => character.alive).every((character) => polityById.get(character.polityId)?.alive)).toBe(true);
    expect(world.backgroundPeople.filter((person) => person.promotedCharacterId === null).every((person) => (
      regionById.get(person.regionId)?.controllerId === person.polityId
    ))).toBe(true);
    expect(world.history.filter((event) => event.kind === 'deputy_promoted').every((promotion) => {
      const promotedId = promotion.stateDeltas.find((delta) => delta.field === 'commanderId')?.after;
      return typeof promotedId === 'string' && world.facts.some((fact) => (
        fact.kind === 'battle'
        && fact.turn <= promotion.turn
        && [fact.payload.attacker, ...fact.payload.defenders].some((force) => force.deputyCommanderId === promotedId)
      ));
    })).toBe(true);
    expect(world.characters.filter((character) => character.alive && character.tier !== '配角').length).toBeLessThanOrEqual(240);
  }, 15_000);
});
