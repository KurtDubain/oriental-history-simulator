import { describe, expect, it } from 'vitest';
import { createWorld, advanceWorld, validateWorld, serializeWorld, deserializeWorld, computeWorldHash } from './index';
import { processRegions } from './engine';
import { createTurnContext, totalWorldFood, totalWorldWealth } from './turn-context-state';
import { processV03EconomyAndTrade } from './v03-ocean';
import { localGovernanceCandidateFor, resolveLocalGovernanceAction } from './agency/embodied-governance';
import { promoteBackgroundPerson, trustedForOffice } from './v02';
import { canApproachTarget, executableWarTarget } from './military/orders';
import { creditBattleCommandStanding } from './military/authority';
import type { HistoryEvent } from './types';

describe('historical conditions and consequences', () => {
  it('keeps land when population falls, without grain from absent labour', () => {
    const opening = createWorld('农田与劳力');
    const harvest = (share: number) => {
      const world = structuredClone(opening);
      world.regions = [world.regions[0]!];
      const r = world.regions[0]!;
      r.population = Math.floor(r.population * share);
      const population = r.population;
      const context = createTurnContext(world);
      processRegions(world, context);
      expect(totalWorldFood(world)).toBe(context.food.start + context.food.produced - context.food.civilianConsumed - context.food.spoiled);
      return { population, produced: context.food.produced };
    };
    const full = harvest(1), half = harvest(.5), empty = harvest(0);
    expect(half.produced / half.population).toBeGreaterThan(full.produced / full.population);
    expect(half.produced).toBeLessThan(full.produced);
    expect(empty.produced).toBe(0);
  });

  function grainMarket() {
    const world = createWorld('邻州粮市');
    const route = world.routes.find(r => r.kind !== '海峡')!;
    world.regions = world.regions.filter(r => [route.fromRegionId,route.toRegionId].includes(r.id));
    const [source, destination] = world.regions;
    source!.food = 1_000_000; source!.population = 100_000; source!.prices.粮食 = 20;
    destination!.food = 0; destination!.population = 50_000; destination!.wealth = 1_000_000; destination!.prices.粮食 = 450;
    destination!.controllerId = source!.controllerId;
    world.routes = [{ ...route, supplyCapacity: 30_000 }];
    world.portLinks = []; world.seaLanes = []; world.armies = []; world.fleets = [];
    world.wars = [];
    return { world, source: source!, destination: destination! };
  }

  it('buys grain with real wealth and finite route capacity, not a six-thousand artificial ceiling', () => {
    const { world, destination } = grainMarket();
    const context = createTurnContext(world), food = totalWorldFood(world), wealth = totalWorldWealth(world);
    processV03EconomyAndTrade(world, context, input => ({ ...input, id:'test', turn:world.turn } as HistoryEvent));
    const shipment = context.trade.shipments.find(s => s.commodity === '粮食' && s.destinationRegionId === destination.id)!;
    expect(shipment.deliveredAmount).toBeGreaterThan(6000);
    expect(shipment.acceptedAmount).toBeLessThanOrEqual(30000);
    expect(shipment.value).toBeGreaterThan(0);
    expect(destination.wealth).toBeLessThan(1_000_000);
    expect(totalWorldFood(world)).toBe(food - context.food.warDestroyed);
    expect(totalWorldWealth(world)).toBe(wealth);
    for (const usage of context.logistics.routeUsage) expect(usage.reserved).toBeLessThanOrEqual(usage.capacity);
  });

  it.each(['no route','no purchasing power'] as const)('does not invent relief with %s', obstacle => {
    const { world, destination } = grainMarket();
    if (obstacle === 'no route') world.routes = [];
    else destination.wealth = 0;
    processV03EconomyAndTrade(world, createTurnContext(world), input => ({ ...input, id:'test' } as HistoryEvent));
    expect(destination.food).toBe(0);
  });

  it('lets low grain prices respond to scarcity instead of flooring every small increase away', () => {
    const { world, source, destination } = grainMarket();
    source.prices.粮食 = 4; destination.prices.粮食 = 6;
    let imported = 0;
    for (let turn = 0; turn < 12; turn++) {
      world.turn = turn;
      const context = createTurnContext(world);
      processV03EconomyAndTrade(world, context, input => ({ ...input, id:`price${turn}` } as HistoryEvent));
      imported += context.trade.shipments.filter(s => s.commodity === '粮食' && s.destinationRegionId === destination.id)
        .reduce((sum,s) => sum+s.deliveredAmount,0);
    }
    expect(imported).toBeGreaterThan(6000);
    expect(destination.wealth).toBeLessThan(1_000_000);
  });

  it('does not substitute tax refunds for grain or reward the same unresolved unrest repeatedly', () => {
    const world = createWorld('施政不是刷功');
    const actor = world.characters.find(p => p.governedRegionId)!;
    const region = world.regions.find(r => r.id === actor.governedRegionId)!;
    const polity = world.polities.find(p => p.id === actor.polityId)!;
    actor.governance = 100; actor.loyalty = 100; actor.merit = 0; actor.influence = 0;
    polity.administration = 100; polity.authority = 100; polity.treasury = 1_000_000;
    region.unrest = 100; region.food = 0;
    expect(localGovernanceCandidateFor(world, actor.id)).toBeNull();
    region.food = region.population * 2;
    const resolve = () => resolveLocalGovernanceAction(world, createTurnContext(world), localGovernanceCandidateFor(world, actor.id)!,
      input => ({ ...input, id:`gov${world.turn}`, turn:world.turn } as HistoryEvent));
    const first = resolve();
    expect(first.fact.payload.outcome).toBe('enacted');
    expect(actor.merit).toBeGreaterThan(0);
    const merit = actor.merit;
    world.turn += 4; region.unrest = 100;
    const repeated = resolve();
    expect(repeated.fact.payload.outcome).toBe('enacted');
    expect(actor.merit).toBe(merit);
    world.turn += 4; region.unrest = 70;
    resolve();
    expect(actor.merit).toBeGreaterThan(merit);
  });

  it('does not declare against an unreachable or overwhelmingly defended border just because soldiers exist elsewhere', () => {
    const world = createWorld('战略可执行');
    const army = world.armies[0]!;
    const target = world.regions.find(r => r.controllerId !== army.polityId && r.neighbors.some(id => world.regions.find(n => n.id === id)?.controllerId === army.polityId))!;
    const own = target.neighbors.map(id => world.regions.find(r => r.id === id)!).find(r => r.controllerId === army.polityId)!;
    world.armies = [army]; army.regionId = own.id; army.supply = 100; army.morale = 100; own.food = 1_000_000;
    expect(executableWarTarget(world, army.polityId, target.controllerId)).not.toBeNull();
    world.regions.forEach(r => { r.neighbors = []; });
    expect(executableWarTarget(world, army.polityId, target.controllerId)).toBeNull();
    own.neighbors = [target.id]; target.neighbors = [own.id];
    world.armies.push({ ...army, id:'enemy', polityId:target.controllerId, regionId:target.id, soldiers:army.soldiers * 10 });
    expect(canApproachTarget(world, army, target.id)).toBe(false);
    expect(executableWarTarget(world, army.polityId, target.controllerId)).toBeNull();
  });

  it('lets younger relevant talent compete without forbidding an exceptional older recruit', () => {
    const world = createWorld('人才任用');
    const polity = world.polities[0]!;
    const candidates = world.backgroundPeople.filter(p => p.polityId === polity.id).slice(0,2);
    world.backgroundPeople = candidates;
    const [elder, younger] = candidates;
    elder!.birthTurn = -74*4; elder!.opportunity = 100;
    younger!.birthTurn = -28*4; younger!.opportunity = 40;
    elder!.potential = younger!.potential = { leadership:70, governance:60, cunning:60 };
    const young = promoteBackgroundPerson(world, polity, 'new-commander')!;
    expect(young.sourceStubId).toBe(younger!.id);
    expect(young.merit).toBe(0);
    const old = promoteBackgroundPerson(world, polity, 'new-commander')!;
    expect(old.sourceStubId).toBe(elder!.id);
    expect(old.age).toBe(74);
    expect(old.health).toBeLessThan(100);
  });

  it('requires real acceptance conditions before restoring a conquered ruler to office', () => {
    const world = createWorld('亡国任用');
    const [loser, victor] = world.polities;
    const person = world.characters.find(p => p.id === loser!.rulerId)!;
    loser!.alive = false; loser!.eliminatedTurn = 0; person.polityId = victor!.id; person.loyalty = 30;
    expect(trustedForOffice(world, victor!, person)).toBe(false);
    world.turn = 16;
    expect(trustedForOffice(world, victor!, person)).toBe(false);
    person.loyalty = 60;
    expect(trustedForOffice(world, victor!, person)).toBe(true);
  });

  it('distinguishes defeating a field army from occupying a locally defended place', () => {
    const world = createWorld('战功含金量');
    const army = world.armies[0]!;
    const commander = world.characters.find(p => p.id === army.commanderId)!;
    const before = commander.merit;
    const occupation = creditBattleCommandStanding(world, army, true, .01, army.participantIds, false);
    expect(commander.merit - before).toBe(1);
    expect(occupation.some(d => d.field === 'renown')).toBe(false);
    creditBattleCommandStanding(world, army, true, .2);
    expect(commander.merit - before).toBe(4);
  });

  it('continues old schema-5 worlds deterministically without observation state', () => {
    let world = createWorld('长期链条受控');
    for (let turn = 0; turn < 16; turn++) world = advanceWorld(world);
    expect(validateWorld(world)).toEqual([]);
    expect(world.hash).toBe(computeWorldHash(world));
    expect(advanceWorld(deserializeWorld(serializeWorld(world))).hash).toBe(advanceWorld(world).hash);
  }, 30000);
});
