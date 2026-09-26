import { describe, expect, it } from 'vitest';

import { createWorld, keyedRandom } from '../index';
import { repairDepletedFormationCommands, resolveVacantRulers } from '../engine';
import type { BattleFact } from '../facts';
import type { HistoryEvent, WorldState } from '../types';
import { createTurnContext, totalWorldPopulation } from '../turn-context-state';
import { processCharacterDeathConsequences } from '../v02';
import { syncOfficeAppointments } from '../v02';
import { settleFactionDeaths } from '../politics/faction-lifecycle';
import { refreshFactionPowerLedgers } from '../politics/power-ledger';
import type { V03EventInput } from '../v03-context';
import { battleRecoveryStatus } from './battle-readiness';
import { syncFormationStrength } from './personal-forces';
import { applyBattleLosses, battleForceSnapshot, battleLossRate, battleFateChances, resolveBattleFates } from './battle-fate';

function emitEvent(world: WorldState, context: ReturnType<typeof createTurnContext>) {
  return (input: V03EventInput): HistoryEvent => {
    world.counters.event += 1;
    const event: HistoryEvent = {
      ...input,
      id: `event_${String(world.counters.event).padStart(6, '0')}`,
      turn: context.turn,
      year: context.year,
      season: context.season,
      actorIds: input.actorIds ?? [],
      polityIds: input.polityIds ?? [],
      regionIds: input.regionIds ?? [],
      evidence: input.causes.map((cause) => cause.evidence),
      stateDeltas: input.stateDeltas ?? [],
      sourceFactIds: input.sourceFactIds ?? [],
      situationIds: [],
    };
    world.history.push(event);
    context.events.push(event);
    return event;
  };
}

function battleForCommander(world: WorldState): { fact: BattleFact; commanderId: string; otherId: string } {
  const army = world.armies.find((item) => item.participantIds.length >= 2)!;
  const commanderId = army.commanderId;
  const otherId = army.participantIds.find((id) => id !== commanderId)!;
  const force = world.personalForces.find((item) => item.ownerId === commanderId)!;
  const before = force.soldiers;
  const losses = Math.max(1, Math.floor(before * 0.36));
  force.soldiers -= losses;
  syncFormationStrength(world, army);
  const participant = {
    characterId: commanderId,
    soldiersBefore: before,
    soldiersAfter: force.soldiers,
    losses,
    factionId: world.characters.find((item) => item.id === commanderId)?.factionId ?? null,
    formationCommanderId: commanderId,
    role: 'commander' as const,
  };
  return {
    commanderId,
    otherId,
    fact: {
      id: 'battle-fate-placeholder',
      turn: world.turn,
      year: world.year,
      season: world.season,
      kind: 'battle',
      category: '军事',
      importance: 3,
      actorIds: [commanderId],
      polityIds: [army.polityId],
      regionIds: [army.regionId],
      causes: [],
      stateDeltas: [],
      sourceFactIds: [],
      payload: {
        warId: 'war-fate-test',
        targetRegionId: army.regionId,
        routeId: world.routes[0]!.id,
        attackerWon: false,
        attackerPower: 1,
        defenderPower: 2,
        militiaLosses: 0,
        attacker: {
          armyId: army.id,
          polityId: army.polityId,
          commanderId,
          deputyCommanderId: army.deputyCommanderId,
          allegianceCharacterId: army.allegiance.characterId,
          allegianceStrength: army.allegiance.strength,
          soldiersBefore: before,
          soldiersAfter: force.soldiers,
          moraleBefore: army.morale,
          moraleAfter: army.morale,
          trainingBefore: army.training,
          supplyBefore: army.supply,
          losses,
          participants: [participant],
        },
        defenders: [],
      },
    },
  };
}

function idForOutcome(
  world: WorldState,
  fact: BattleFact,
  characterId: string,
  outcome: 'death' | 'wound',
): string {
  const character = world.characters.find((item) => item.id === characterId)!;
  const participant = fact.payload.attacker.participants![0]!;
  const chances = battleFateChances(participant, false, character.health, character.caution, character.leadership);
  for (let index = 0; index < 20_000; index += 1) {
    const id = `battle-fate-${outcome}-${index}`;
    const roll = keyedRandom(world.seed, world.turn, 'battle-fate', id, characterId);
    if (outcome === 'death' ? roll < chances.death : roll >= chances.death && roll < chances.death + chances.wound) return id;
  }
  throw new Error(`unable to find deterministic ${outcome} id`);
}

describe('battle participant fate', () => {
  it.each([true,false])('independently settles several real participants once, including victors (%s)',won=>{
    const world=createWorld('独立抽样与余部'),{fact}=battleForCommander(world);
    const army=world.armies.find(a=>a.participantIds.length>=3)!,ctx=createTurnContext(world);
    const before=battleForceSnapshot(world,army);
    applyBattleLosses(world,[army],Math.round(army.soldiers*.4),ctx);
    fact.payload.attacker=battleForceSnapshot(world,army,before);fact.payload.attackerWon=won;
    fact.payload.targetRegionId=army.regionId;fact.polityIds=[army.polityId];fact.regionIds=[army.regionId];
    const people=fact.payload.attacker.participants!.map(p=>world.characters.find(c=>c.id===p.characterId)!);
    for(const c of people){c.health=100;c.protectedUntilTurn=null;}
    const probabilities=fact.payload.attacker.participants!.map((p,i)=>battleFateChances(p,won,100,people[i].caution,people[i].leadership).death);
    let found=false;
    for(let i=0;i<20000;i++){
      fact.id=`independent-fate-${i}`;
      if(people.every((p,j)=>keyedRandom(world.seed,world.turn,'battle-fate',fact.id,p.id)<probabilities[j])){found=true;break;}
    }
    expect(found).toBe(true);
    expect(new Set(people.map(p=>keyedRandom(world.seed,world.turn,'battle-fate',fact.id,p.id))).size).toBe(people.length);
    resolveBattleFates(world,ctx,fact,emitEvent(world,ctx));
    expect(ctx.facts.filter(f=>f.kind==='character_death').map(f=>f.payload.characterId).sort()).toEqual(people.map(p=>p.id).sort());
    expect(ctx.facts.filter(f=>f.kind==='character_death').every(f=>f.sourceFactIds.includes(fact.id))).toBe(true);
    const settled=JSON.stringify(world);resolveBattleFates(world,ctx,fact,emitEvent(world,ctx));expect(JSON.stringify(world)).toBe(settled);
  });
  it('makes a close fight costly on both sides without a win/loss cliff or costly walkovers',()=>{
    expect(battleLossRate(10000,10000)).toBeCloseTo(.28);
    expect(battleLossRate(10001,10000)-battleLossRate(9999,10000)).toBeCloseTo(0,3);
    expect(battleLossRate(10001,10000)).toBeGreaterThan(.25);
    expect(battleLossRate(10000,1000)).toBeLessThan(.04);
    expect(battleLossRate(1000,10000)).toBe(.48);
  });
  it.each([true,false])('accounts for standing losses independently of later personal demobilization (attackerWon=%s)',won=>{
    const world=createWorld('常备军战损账本'),armies=world.armies.slice(0,2),context=createTurnContext(world);
    const before=armies.map(a=>battleForceSnapshot(world,a)),population=totalWorldPopulation(world);
    const rate=battleLossRate(10000,won?12000:8000);
    const requested=Math.round(before.reduce((n,s)=>n+s.soldiersBefore,0)*rate);
    expect(rate).toBeGreaterThan(0);
    const actual=applyBattleLosses(world,armies,requested,context);
    const after=armies.map((a,i)=>battleForceSnapshot(world,a,before[i]));
    expect(context.population.militaryDeaths).toBe(actual);
    expect(population-totalWorldPopulation(world)).toBe(actual);
    expect(after.reduce((n,s)=>n+s.losses,0)).toBe(actual);
    for(const side of after){
      expect(side.losses).toBeGreaterThan(0);
      expect(side.participants!.reduce((n,p)=>n+p.losses,0)).toBe(side.losses);
      expect(side.participants!.reduce((n,p)=>n+p.soldiersAfter,0)).toBe(side.soldiersAfter);
    }
  });
  it('does not expose a sovereign merely named in the battle actors', () => {
    const world = createWorld('不在阵中的君主');
    const { fact } = battleForCommander(world);
    const ruler = world.characters.find(c => c.id === world.polities.find(p => p.id === fact.payload.attacker.polityId)!.rulerId)!;
    fact.payload.attacker.participants = fact.payload.attacker.participants!.filter(p => p.characterId !== ruler.id);
    fact.actorIds.push(ruler.id);
    const before = structuredClone(ruler);
    const context = createTurnContext(world);
    resolveBattleFates(world, context, fact, emitEvent(world, context));
    expect(ruler).toEqual(before);
    expect(context.facts.filter(f => (f.kind === 'character_wounded' || f.kind === 'character_death') && f.payload.characterId === ruler.id)).toEqual([]);
  });
  it('gives actual mid/high losses substantial risk on either side, without conserving the old casualty envelope', () => {
    for (const role of ['commander', 'deputy', 'member'] as const) for (const lost of [0, .01, .1, .2, .25, .3, .4, 1])
      for (const won of [true, false]) for (const health of [35, 80, 100]) {
        const p = { characterId: 'exposed', factionId: null, formationCommanderId: 'commander', role,
          soldiersBefore: 1000, soldiersAfter: 1000 * (1-lost), losses: 1000 * lost };
        const current = battleFateChances(p, won, health, 50, 50);
        if(lost<=.01)expect(current.death+current.wound).toBeLessThan(.003);
        if(lost>=.2)expect(current.death).toBeGreaterThan(.06);
        if(lost>=.3)expect(current.death).toBeGreaterThan(.12);
        const winner=battleFateChances(p,true,health,50,50);
        expect(current.death).toBeLessThanOrEqual(winner.death*1.2+1e-12);
        expect(current.death+current.wound).toBeLessThan(1);
      }
  });
  it('turns an exposed wound into immediate withdrawal and fact-derived recovery', () => {
    const world = createWorld('参战者负伤');
    const { fact, commanderId, otherId } = battleForCommander(world);
    fact.id = idForOutcome(world, fact, commanderId, 'wound');
    const context = createTurnContext(world);
    const healthBefore = world.characters.find((item) => item.id === commanderId)!.health;
    const otherHealth = world.characters.find((item) => item.id === otherId)!.health;
    const soldiersBefore = world.personalForces.find((item) => item.ownerId === commanderId)!.soldiers;
    const populationBefore = totalWorldPopulation(world);

    resolveBattleFates(world, context, fact, emitEvent(world, context));
    const wound = context.facts.find((item) => item.kind === 'character_wounded');

    expect(wound?.payload.characterId).toBe(commanderId);
    expect(world.characters.find((item) => item.id === commanderId)!.health).toBeLessThan(healthBefore);
    expect(world.characters.find((item) => item.id === otherId)!.health).toBe(otherHealth);
    expect(world.personalForces.find((item) => item.ownerId === commanderId)!.soldiers).toBe(soldiersBefore);
    expect(world.personalForces.find((item) => item.ownerId === commanderId)!.formationId).toBeNull();
    expect(battleRecoveryStatus(world, commanderId).recovering).toBe(true);
    expect(totalWorldPopulation(world)).toBe(populationBefore);
    expect(wound?.sourceFactIds).toEqual([fact.id]);
    expect(wound?.stateDeltas).toContainEqual(expect.objectContaining({ entityId: commanderId, field: 'health' }));
    expect(wound?.payload.recoveryUntilTurn).toBeGreaterThan(context.turn);
    const settled=JSON.stringify(world),count=context.facts.length;
    resolveBattleFates(world,context,fact,emitEvent(world,context));
    expect(JSON.stringify(world)).toBe(settled);expect(context.facts).toHaveLength(count);
  });

  it('is deterministic and keeps high-loss defeats riskier than ordinary victories', () => {
    const world = createWorld('战后命运确定性');
    const { fact, commanderId } = battleForCommander(world);
    fact.id = idForOutcome(world, fact, commanderId, 'wound');
    const copy = structuredClone(world);
    const firstContext = createTurnContext(world);
    const secondContext = createTurnContext(copy);
    resolveBattleFates(world, firstContext, fact, emitEvent(world, firstContext));
    resolveBattleFates(copy, secondContext, structuredClone(fact), emitEvent(copy, secondContext));
    const participant = fact.payload.attacker.participants![0]!;
    const safe = battleFateChances({ ...participant, losses: 1, soldiersAfter: participant.soldiersBefore - 1 }, true, 100, 90, 90);
    const dangerous = battleFateChances({ ...participant, losses: participant.soldiersBefore, soldiersAfter: 0 }, false, 30, 10, 20);

    expect(firstContext.facts).toEqual(secondContext.facts);
    expect(dangerous.death).toBeGreaterThan(safe.death);
    expect(dangerous.wound).toBeGreaterThan(safe.wound);
    expect(safe.severity).toBeLessThan(.24);
    expect(safe.death+safe.wound).toBeLessThan(.001);
    expect(dangerous.death).toBeLessThanOrEqual(.38);
    expect(dangerous.wound).toBeLessThanOrEqual(.38);
  });

  it('keeps continuous risk monotonic across loss, defeat, health, and protection', () => {
    const participant = {
      characterId: 'person-risk', soldiersBefore: 1_000, soldiersAfter: 800, losses: 200,
      factionId: null, formationCommanderId: 'person-risk', role: 'commander' as const,
    };
    const lowLoss = battleFateChances({ ...participant, soldiersAfter: 900, losses: 100 }, true, 80, 40, 50);
    const highLoss = battleFateChances({ ...participant, soldiersAfter: 600, losses: 400 }, true, 80, 40, 50);
    const defeated = battleFateChances(participant, false, 80, 40, 50);
    const woundedHealth = battleFateChances(participant, false, 35, 40, 50);
    const protectedRisk = battleFateChances(participant, false, 35, 90, 90);

    expect(highLoss.severity).toBeGreaterThan(lowLoss.severity);
    expect(defeated.severity).toBeGreaterThan(battleFateChances(participant, true, 80, 40, 50).severity);
    expect(woundedHealth.severity).toBeGreaterThan(defeated.severity);
    expect(protectedRisk.severity).toBeLessThan(woundedHealth.severity);
    expect(highLoss.wound).toBeGreaterThan(lowLoss.wound);
    expect(woundedHealth.death).toBeGreaterThan(defeated.death);
  });

  it('expresses meaningful conditional exposure in the observed twenty-to-forty percent loss range, without a death floor', () => {
    const p = { characterId: 'risk', soldiersBefore: 1000, soldiersAfter: 800, losses: 200,
      factionId: null, formationCommanderId: 'risk', role: 'commander' as const };
    const moderate = battleFateChances(p, false, 80, 50, 50);
    const severe = battleFateChances({ ...p, soldiersAfter: 600, losses: 400 }, false, 80, 50, 50);
    expect(moderate.death).toBeGreaterThan(.004);
    expect(severe.death).toBeGreaterThan(moderate.death);
    expect(moderate.wound).toBeGreaterThan(.04);
    expect(battleFateChances({ ...p, losses: 0, soldiersAfter: 1000 }, false, 80, 50, 50).death).toBe(0);
    expect(battleFateChances(p, true, 80, 50, 50).death).toBeGreaterThan(0);
  });

  it('does not draw another wound while the previous injury is still being rested', () => {
    const world = createWorld('带伤不反复抽签');
    const { fact, commanderId } = battleForCommander(world);
    fact.id = idForOutcome(world, fact, commanderId, 'wound');
    const firstContext = createTurnContext(world);
    resolveBattleFates(world, firstContext, fact, emitEvent(world, firstContext));
    const nextFact = structuredClone(fact);
    nextFact.id = `${fact.id}-again`;
    const nextContext = createTurnContext(world);

    resolveBattleFates(world, nextContext, nextFact, emitEvent(world, nextContext));

    expect(nextContext.facts.filter((item) => item.kind === 'character_wounded')).toHaveLength(0);
  });

  it('turns a protected battlefield death into one wound and consumes protection', () => {
    const world = createWorld('护住战阵死劫');
    const { fact, commanderId } = battleForCommander(world);
    fact.id = idForOutcome(world, fact, commanderId, 'death');
    const character = world.characters.find((item) => item.id === commanderId)!;
    character.protectedUntilTurn = world.turn;
    const context = createTurnContext(world);

    resolveBattleFates(world, context, fact, emitEvent(world, context));

    expect(character.alive).toBe(true);
    expect(character.protectedUntilTurn).toBeNull();
    expect(context.facts).toHaveLength(1);
    expect(context.facts[0]?.kind).toBe('character_wounded');
  });

  it('settles a commander death, inheritance and command replacement in the same turn', () => {
    const world = createWorld('主将阵亡当季善后');
    const { fact, commanderId, otherId } = battleForCommander(world);
    fact.id = idForOutcome(world, fact, commanderId, 'death');
    const army = world.armies.find((item) => item.id === fact.payload.attacker.armyId)!;
    const deceased = world.characters.find((item) => item.id === commanderId)!;
    const heir = world.characters.find((item) => item.id === otherId)!;
    const family = world.families.find((item) => item.id === deceased.familyId)!;
    const factionId = deceased.factionId;
    expect(world.offices.some((office) => office.active && office.holderId === commanderId)).toBe(true);
    if (!family.memberIds.includes(heir.id)) family.memberIds.push(heir.id);
    heir.familyId = family.id;
    heir.parentIds.push(deceased.id);
    deceased.personalWealth = 41;
    const inheritorWealthBefore = heir.personalWealth;
    const totalBefore = totalWorldPopulation(world);
    const context = createTurnContext(world);

    resolveBattleFates(world, context, fact, emitEvent(world, context));
    const deaths = context.facts.filter((item): item is Extract<typeof item, { kind: 'character_death' }> => item.kind === 'character_death');
    processCharacterDeathConsequences(world, context, emitEvent(world, context), deaths);
    repairDepletedFormationCommands(world, context);
    settleFactionDeaths(world, context, deaths.map((fact) => fact.id), emitEvent(world, context));
    syncOfficeAppointments(world, context.turn, context);
    refreshFactionPowerLedgers(world);

    expect(deceased).toMatchObject({ alive: false, deathTurn: world.turn, personalWealth: 0, commandingArmyId: null });
    expect(world.personalForces.some((force) => force.ownerId === commanderId)).toBe(false);
    expect(army.participantIds).not.toContain(commanderId);
    expect(army.commanderId).toBe(otherId);
    expect(world.offices.some((office) => office.active && office.holderId === commanderId)).toBe(false);
    expect(deceased.factionId).toBeNull();
    expect(world.factions.find((faction) => faction.id === factionId)?.memberIds).not.toContain(commanderId);
    expect(heir.personalWealth).toBe(inheritorWealthBefore + 41);
    expect(totalWorldPopulation(world)).toBe(totalBefore);
    expect(context.facts.find((item) => item.kind === 'character_death')).toMatchObject({
      payload: { cause: 'battle', battleFactId: fact.id },
      sourceFactIds: [fact.id],
    });
  });

  it('fills a ruler vacancy during the same turn as a recorded death', () => {
    const world = createWorld('君主阵亡同季继承');
    const polity = world.polities[0]!;
    const ruler = world.characters.find((item) => item.id === polity.rulerId)!;
    ruler.alive = false;
    ruler.deathTurn = world.turn;
    polity.rulerId = '';
    const context = createTurnContext(world);

    resolveVacantRulers(world, context);

    expect(polity.rulerId).not.toBe('');
    expect(polity.rulerId).not.toBe(ruler.id);
    expect(world.characters.find((item) => item.id === polity.rulerId)?.alive).toBe(true);
  });
});
