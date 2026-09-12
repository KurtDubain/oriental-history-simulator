import {describe,expect,it} from 'vitest';
import {createWorld} from '../index';
import {maintainArmies,repairDepletedFormationCommands} from '../engine';
import {createTurnContext,totalWorldFood,totalWorldPopulation,totalWorldWealth} from '../turn-context-state';
import {detachFormation,formationForces,personalForce,syncFormationStrength} from './personal-forces';
import {settleCharacterDeathState} from '../character-death';

function fixture() {
  const world=createWorld('和平军府恢复');
  for(const army of world.armies){world.regions.find(r=>r.id===army.regionId)!.food+=army.food;detachFormation(world,army);}
  world.armies=[];world.wars=[];
  for(const c of world.characters)c.commandingArmyId=null;
  for(const p of world.polities)p.treasury=100_000;
  for(const r of world.regions){r.food=1_000_000;r.population=200_000;}
  return world;
}

describe('peacetime field-command recovery',()=>{
  it('assembles one paid formation, preserves population/wealth and does not fill a quota',()=>{
    const world=fixture(),context=createTurnContext(world);
    const population=totalWorldPopulation(world),wealth=totalWorldWealth(world),food=totalWorldFood(world);
    maintainArmies(world,context);
    expect(world.armies.length).toBeGreaterThan(0);expect(context.population.recruited).toBeGreaterThan(0);
    expect(context.wealth.militaryPayments).toBeGreaterThan(0);
    expect(totalWorldPopulation(world)).toBe(population);expect(totalWorldWealth(world)).toBe(wealth);
    expect(totalWorldFood(world)).toBe(food-context.food.armyConsumed);
    for(const p of world.polities)expect(world.armies.filter(a=>a.polityId===p.id).length).toBeLessThanOrEqual(1);
    for(const a of world.armies){
      expect(a.soldiers).toBe(formationForces(world,a).reduce((sum,f)=>sum+f.soldiers,0));
      expect(a.participantIds.filter(id=>id===world.polities.find(p=>p.id===a.polityId)!.rulerId)).toEqual(a.commanderId===world.polities.find(p=>p.id===a.polityId)!.rulerId?[a.commanderId]:[]);
      const event=context.events.find(e=>e.kind==='army_raised'&&e.stateDeltas.some(d=>d.entityId===a.id))!;
      expect(event).toBeDefined();expect([...event.actorIds].sort()).toEqual([...a.participantIds].sort());
      expect(event.stateDeltas.find(d=>d.field==='treasury')!.delta).toBeLessThan(0);
    }
    const ids=world.armies.map(a=>a.id),counter=world.counters.army;
    for(let turn=1;turn<=12;turn++){world.turn=turn;world.season=['春','夏','秋','冬'][turn%4] as typeof world.season;maintainArmies(world,createTurnContext(world));}
    expect(world.armies.map(a=>a.id)).toEqual(ids);expect(world.counters.army).toBe(counter);
  });
  it.each(['money','population','food','personnel','summer'] as const)('does not bypass %s limits or manufacture a new commander',mode=>{
    const world=fixture(),count=world.characters.length;
    if(mode==='money')world.polities.forEach(p=>p.treasury=0);
    if(mode==='population')world.regions.forEach(r=>r.population=0);
    if(mode==='food')world.regions.forEach(r=>r.food=0);
    if(mode==='personnel')world.characters.forEach(c=>c.health=1);
    if(mode==='summer')world.season='夏';
    const context=createTurnContext(world);maintainArmies(world,context);
    expect(world.armies).toEqual([]);expect(world.characters).toHaveLength(count);
    expect(context.events.some(e=>e.kind==='army_raised')).toBe(false);expect(context.population.recruited).toBe(0);
  });
  it('demobilizes a dead deputy once, removes a depleted formation, and only recovers at a later spring review',()=>{
    const world=fixture();maintainArmies(world,createTurnContext(world));
    const army=world.armies.find(a=>a.participantIds.length>=2)!;
    const dead=army.participantIds.find(id=>id!==army.commanderId)!,polityId=army.polityId;
    for(const f of formationForces(world,army))f.soldiers=f.ownerId===dead?8_000:10;
    syncFormationStrength(world,army);const population=totalWorldPopulation(world);
    const settlement=settleCharacterDeathState(world,dead,1)!;
    expect(settlement.demobilized).toBe(8_000);expect(totalWorldPopulation(world)).toBe(population);
    expect(settleCharacterDeathState(world,dead,1)).toBeNull();expect(personalForce(world,dead)).toBeUndefined();
    world.turn=1;world.season='夏';const context=createTurnContext(world);
    repairDepletedFormationCommands(world,context);maintainArmies(world,context);
    expect(world.armies.some(a=>a.id===army.id)).toBe(false);
    expect(world.personalForces.every(f=>f.formationId!==army.id)).toBe(true);
    expect(world.armies.every(a=>!a.participantIds.includes(dead))).toBe(true);
    for(let t=2;t<=3;t++){world.turn=t;world.season=t===2?'秋':'冬';maintainArmies(world,createTurnContext(world));expect(world.armies.some(a=>a.polityId===polityId)).toBe(false);}
    world.turn=4;world.season='春';maintainArmies(world,createTurnContext(world));
    expect(world.armies.filter(a=>a.polityId===polityId)).toHaveLength(1);
    expect(world.armies.every(a=>!a.participantIds.includes(dead))).toBe(true);
  });
  it('keeps an existing army when its commander dies and an actual participant can take over',()=>{
    const world=fixture();maintainArmies(world,createTurnContext(world));
    const army=world.armies.find(a=>a.participantIds.length>=2)!,old=army.commanderId;
    const members=army.participantIds.filter(id=>id!==old);const counter=world.counters.army;
    settleCharacterDeathState(world,old,world.turn);repairDepletedFormationCommands(world,createTurnContext(world));
    expect(members).toContain(army.commanderId);expect(world.counters.army).toBe(counter);
    expect(army.soldiers).toBe(formationForces(world,army).reduce((sum,f)=>sum+f.soldiers,0));
  });
});
