import {describe,expect,it} from 'vitest';
import {advanceWorld,createWorld,serializeWorld,validateTurnRuntime,validateWorld} from './index';
import {totalWorldFood,totalWorldPopulation,totalWorldWealth} from './turn-context-state';
import {worldPopulation} from '../view/dossier-adapter-shared';
import type {WorldState} from './types';

describe('shared ledger totals preserve the existing arithmetic contract',()=>{
  it('keeps collection-local reduction and left-to-right addition, including floating point boundaries',()=>{
    const world=createWorld('总账浮点顺序');
    world.regions=world.regions.slice(0,1);world.personalForces=world.personalForces.slice(0,2);
    world.armies=world.armies.slice(0,2);world.fleets=world.fleets.slice(0,1);world.polities=world.polities.slice(0,2);
    world.regions[0].population=world.regions[0].food=world.regions[0].wealth=2**53;
    world.personalForces.forEach(p=>p.soldiers=1);world.armies.forEach(a=>a.food=1);
    world.polities.forEach(p=>p.treasury=1);world.fleets[0].food=world.fleets[0].sailors=0;
    world.navalOperations=[];
    const before=serializeWorld(world),expected=2**53+2;
    expect(totalWorldPopulation(world)).toBe(expected);
    expect(worldPopulation(world)).toBe(expected);
    expect(totalWorldFood(world)).toBe(expected);
    expect(totalWorldWealth(world)).toBe(expected);
    // Flattening these collections into one sum would lose the two units.
    expect([2**53,1,1].reduce((sum,value)=>sum+value,0)).not.toBe(expected);
    expect(serializeWorld(world)).toBe(before);
  });

  it('counts regional people, personal troops and sailors, never the same army twice',()=>{
    const world=createWorld('人口原口径');
    const expected=world.regions.reduce((n,r)=>n+r.population,0)
      +world.personalForces.reduce((n,p)=>n+p.soldiers,0)+world.fleets.reduce((n,f)=>n+f.sailors,0);
    expect(totalWorldPopulation(world)).toBe(expected);expect(worldPopulation(world)).toBe(expected);
    world.armies[0].soldiers+=999;
    expect(totalWorldPopulation(world)).toBe(expected);
  });

  it('includes carried naval food only while the operation is unfinished, without reordering decimals',()=>{
    const world=createWorld('海军载粮口径');
    const base=totalWorldFood(world);
    // Only the fields consumed by this pure sum: not an admissible saved world.
    world.navalOperations=[{stage:'航行',foodLoaded:.1},{stage:'登陆',foodLoaded:.2},
      {stage:'完成',foodLoaded:900},{stage:'失败',foodLoaded:700}] as WorldState['navalOperations'];
    expect(totalWorldFood(world)).toBe(base+(.1+.2));
  });

  it('keeps full/runtime ordered ledger errors and zero-ship rejection',()=>{
    const before=createWorld('总账错误次序'),after=advanceWorld(before),fleet=after.fleets[0];
    fleet.warships=fleet.transports=fleet.patrolShips=0;
    after.personalForces[0].soldiers++;fleet.food++;after.polities[0].treasury++;
    expect(validateWorld(after)).toEqual([
      {code:'fleet.stock',message:`${fleet.name}舰船、水手或军粮无效`,entityId:fleet.id},
      {code:'ledger.population.snapshot',message:'人口账本终值加边界干预差量后与世界快照不一致'},
      {code:'ledger.food.snapshot',message:'粮食账本终值加边界干预差量后与世界快照不一致'},
      {code:'ledger.wealth.snapshot',message:'财富账本终值加边界干预差量后与世界快照不一致'},
      {code:'hash.mismatch',message:'世界哈希与权威状态不一致'},
    ]);
    expect(validateTurnRuntime(before,after)).toEqual([
      {code:'fleet.stock',message:`${fleet.name}舰船、水手或军粮无效`,entityId:fleet.id},
      {code:'runtime.population-ledger',message:'本季人口账与前后世界快照不一致'},
      {code:'runtime.food-ledger',message:'本季粮食账与前后世界快照不一致'},
      {code:'runtime.wealth-ledger',message:'本季财富账与前后世界快照不一致'},
      {code:'runtime.hash',message:'推进后世界哈希与当前权威状态不一致'},
    ]);
  });
});
