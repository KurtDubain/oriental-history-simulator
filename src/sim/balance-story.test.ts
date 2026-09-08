import { describe, expect, it } from 'vitest';
import { advanceWorld, computeWorldHash, createWorld, deserializeWorld, serializeWorld, validateWorld } from './index';
import { creditBattleCommandStanding } from './military/authority';
import { canApproachTarget, planArmyOrders } from './military/orders';
import { canReopenWar, peaceReason } from './v03-diplomacy';
import { governingCharacter, selectRegent, syncOfficeAppointments } from './v02';
import { createTurnContext } from './turn-context-state';
import { settleCharacterDeathState } from './character-death';
import { resolveVacantRulers } from './engine';
import { expelFactionMembers } from './politics/faction-lifecycle';
import type { WarState } from './types';

function front() {
  const world = createWorld('军政因果受控');
  const army = world.armies.find(item => world.regions.find(region => region.id === item.regionId)?.neighbors
    .some(id => world.regions.find(region => region.id === id)?.controllerId !== item.polityId))!;
  const origin = world.regions.find(region => region.id === army.regionId)!;
  const target = world.regions.find(region => origin.neighbors.includes(region.id) && region.controllerId !== army.polityId)!;
  const war: WarState = { id: 'war_controlled', kind: 'interstate', attackerId: army.polityId,
    defenderId: target.controllerId, startedTurn: 1, endedTurn: null, active: true, attackerScore: 0,
    defenderScore: 0, reason: '边境', lastBattleTurn: 1, goal: '边境', targetRegionIds: [target.id], exhaustion: 0 };
  world.wars = [war]; world.turn = 12;
  return { world, army, target, war };
}

describe('balance and causal continuity', () => {
  it('counts visible co-located defenders but does not inspect their private abilities', () => {
    const { world, army, target } = front();
    const enemy = world.armies.find(item => item.polityId === target.controllerId)!;
    enemy.regionId = target.id; enemy.soldiers = army.soldiers * 4;
    const before = JSON.stringify(world);
    expect(canApproachTarget(world, army, target.id)).toBe(false);
    expect(JSON.stringify(world)).toBe(before);
    world.characters.filter(person => person.polityId === enemy.polityId).forEach(person => { person.leadership = 0; person.health = 1; });
    expect(canApproachTarget(world, army, target.id)).toBe(false);
    world.armies = world.armies.filter(item => item.polityId !== enemy.polityId);
    expect(canApproachTarget(world, army, target.id)).toBe(true);
    world.armies.push({ ...enemy, id: 'extra_visible', soldiers: army.soldiers * 2 });
    expect(canApproachTarget(world, army, target.id)).toBe(false);
    const context = createTurnContext(world);
    planArmyOrders(world, context);
    expect(army.order.kind).not.toBe('intercept');
  });

  it('requires a real peace interval and recovery, without preventing first wars', () => {
    const { world, army, war } = front();
    const polity = world.polities.find(item => item.id === army.polityId)!;
    war.active = false; war.endedTurn = 11; war.lastBattleTurn = 10;
    polity.treasury = 1000; polity.warWeariness = 10; army.supply = 90;
    expect(canReopenWar(world, polity, war.defenderId)).toBe(false);
    world.turn = 15;
    expect(canReopenWar(world, polity, war.defenderId)).toBe(true);
    polity.warWeariness = 70;
    expect(canReopenWar(world, polity, war.defenderId)).toBe(false);
    world.wars = [];
    expect(canReopenWar(world, polity, war.defenderId)).toBe(true);
  });

  it('does not mistake an army moving to its front for a stalemate', () => {
    const { world, army, war } = front();
    army.order.warId = war.id; army.lastMovedTurn = world.turn;
    expect(peaceReason(world, war, world.turn)).toBeNull();
    army.lastMovedTurn = 1;
    expect(peaceReason(world, war, world.turn)).toContain('久无进展');
    army.order.reasonCode = 'amphibious_landing';
    expect(peaceReason(world, war, world.turn)).toContain('久无进展');
  });

  it('does not repeat an unexecuted war on the same deployment just because peace has elapsed', () => {
    const { world, army, war } = front();
    const polity = world.polities.find(p => p.id === army.polityId)!;
    war.active = false; war.endedTurn = 10; war.lastBattleTurn = -1;
    world.turn = 16; polity.treasury = 10000; polity.warWeariness = 0;
    for (const unit of world.armies.filter(a => a.polityId === polity.id)) {
      unit.lastMovedTurn = 0; unit.order.issuedTurn = 0; unit.supply = 100;
    }
    expect(canReopenWar(world, polity, war.defenderId)).toBe(false);
    army.lastMovedTurn = 15;
    expect(canReopenWar(world, polity, war.defenderId)).toBe(true);
  });

  it('gives experience for defeat but merit only for victory and records command responsibility', () => {
    const { world, army } = front();
    const commander = world.characters.find(person => person.id === army.commanderId)!;
    const deputy = world.characters.find(person => person.id === army.deputyCommanderId)!;
    const before = { merit: deputy.merit, experience: deputy.deputyExperience, renown: commander.renown, influence: commander.influence };
    const defeated = creditBattleCommandStanding(world, army, false, .38);
    expect(deputy.merit).toBe(before.merit);
    expect(deputy.deputyExperience).toBeGreaterThan(before.experience);
    expect(commander.renown).toBeLessThan(before.renown);
    expect(commander.influence).toBeLessThan(before.influence);
    expect(defeated.some(delta => delta.field === 'merit')).toBe(false);
    const won = creditBattleCommandStanding(world, army, true, .1);
    expect(deputy.merit).toBe(before.merit + 2);
    expect(won.find(delta => delta.entityId === deputy.id && delta.field === 'merit')?.delta).toBe(2);
  });

  it('keeps regency in the existing chancellorship, replaces a dead regent and returns government at adulthood', () => {
    let world = createWorld('监国交接受控');
    const polity = world.polities[0]!;
    const ruler = world.characters.find(person => person.id === polity.rulerId)!;
    if (ruler.factionId) expelFactionMembers(world, ruler.factionId, [ruler.id]);
    ruler.age = 15; ruler.adultTurn = null; ruler.lifeStage = '成长';
    syncOfficeAppointments(world, world.turn);
    const regent = selectRegent(world, polity)!;
    expect(governingCharacter(world, polity)?.id).toBe(regent.id);
    world.hash = computeWorldHash(world);
    const serialized = serializeWorld(world);
    expect(governingCharacter(deserializeWorld(serialized), polity)?.id).toBe(regent.id);
    for (let turn = 0; turn < 3; turn++) world = advanceWorld(world);
    expect(governingCharacter(world, world.polities[0]!)?.id).toBe(regent.id);
    world = advanceWorld(world);
    expect(governingCharacter(world, world.polities[0]!)?.id).toBe(ruler.id);
    expect(world.history.some(event => event.title.includes('成年亲政') && event.actorIds.includes(ruler.id))).toBe(true);
    expect(validateWorld(world)).toEqual([]);
    const replacement = deserializeWorld(serialized);
    settleCharacterDeathState(replacement, regent.id, replacement.turn);
    syncOfficeAppointments(replacement, replacement.turn);
    expect(governingCharacter(replacement, replacement.polities[0]!)?.id).not.toBe(regent.id);
    expect(governingCharacter(replacement, replacement.polities[0]!)?.alive).toBe(true);
  });

  it('does not call a vacant-throne succession the overthrow of a living ruler', () => {
    const world = createWorld('异姓继位受控');
    const polity = world.polities[0]!;
    settleCharacterDeathState(world, polity.rulerId, world.turn);
    polity.rulingFamilyId = null;
    const context = createTurnContext(world);
    resolveVacantRulers(world, context);
    expect(context.events.some(event => event.kind === 'succession' && event.polityIds.includes(polity.id))).toBe(true);
    expect(context.events.some(event => event.kind === 'usurpation')).toBe(false);
  });
});
