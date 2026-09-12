import {describe,it,expect} from 'vitest';
import {createWorld} from '../index';
import {maintainArmies,processMilitary} from '../engine';
import {createTurnContext,totalWorldFood,totalWorldPopulation,totalWorldWealth} from '../turn-context-state';
import {planArmyOrders} from './orders';

function fixture() {
  const w=createWorld('困境撤离边界');w.turn=10;
  const [camp,rest,other,enemy]=w.regions,own=w.polities[0],foe=w.polities[1];
  const army=w.armies.find(a=>a.polityId===own.id)!;w.armies=[army];
  w.regions=[camp,rest,other,enemy];
  for(const r of w.regions){r.controllerId=r===enemy?foe.id:own.id;r.food=0;r.neighbors=[];}
  camp.neighbors=[rest.id];rest.neighbors=[camp.id,other.id];other.neighbors=[rest.id];
  rest.food=1_000_000;other.food=1_000_000;own.capitalRegionId=other.id;
  w.routes=[[camp,rest],[rest,other]].map(([a,b],i)=>({...w.routes[0],id:`withdrawal-${i}`,fromRegionId:a.id,toRegionId:b.id,kind:'道路' as const}));
  army.regionId=camp.id;army.morale=2;army.supply=0;army.food=0;army.embarkedOperationId=null;army.lastMovedTurn=8;
  army.order={...army.order,kind:'retreat',warId:'exhausted-front',issuerId:army.commanderId,targetRegionId:rest.id,targetArmyId:null,
    issuedTurn:8,lastReviewedTurn:9,status:'active',reasonCode:'low_readiness'};
  w.wars=[{id:'exhausted-front',kind:'interstate',attackerId:own.id,defenderId:foe.id,active:true,startedTurn:7,endedTurn:null,
    attackerScore:0,defenderScore:0,reason:'战线',goal:'边境',targetRegionIds:[enemy.id],exhaustion:0,lastBattleTurn:9}];
  return {w,army,camp,rest,other,enemy};
}

describe('low-readiness recovery without extra resources or attacks',()=>{
  it('uses one mature safe retreat step, not attack readiness, and keeps the destination as a recovery post',()=>{
    const {w,army,camp,rest}=fixture(),ctx=createTurnContext(w),food=totalWorldFood(w),population=totalWorldPopulation(w),wealth=totalWorldWealth(w);
    w.wars.push({...w.wars[0],id:'zz-another-front'});
    processMilitary(w,ctx);
    expect(army.regionId).toBe(rest.id);expect(army.recentMovement).toMatchObject({fromRegionId:camp.id,toRegionId:rest.id,turn:10,orderKind:'retreat'});
    expect(army.morale).toBe(2);expect(army.supply).toBe(0);expect(army.food).toBe(0);
    expect(army.order).toMatchObject({kind:'hold',reasonCode:'low_readiness',targetRegionId:rest.id,issuedTurn:10});
    expect(ctx.facts.filter(f=>f.kind==='battle')).toHaveLength(0);
    expect([totalWorldFood(w),totalWorldPopulation(w),totalWorldWealth(w)]).toEqual([food,population,wealth]);
    processMilitary(w,ctx);expect(army.regionId).toBe(rest.id); // No second step, even with another war.
    const ration=army.soldiers;w.turn++;
    const maintenance=createTurnContext(w);maintainArmies(w,maintenance);
    expect(army.food).toBeGreaterThanOrEqual(0);expect(maintenance.food.armyConsumed).toBeGreaterThanOrEqual(ration);
    expect(army.morale).toBeLessThan(12);processMilitary(w,maintenance);expect(army.order.kind).toBe('hold');
  });
  it('peace keeps an unresolved retreat, with a real new peace order and its normal delay',()=>{
    const {w,army,camp,rest}=fixture();w.wars[0].active=false;w.wars[0].endedTurn=10;
    const ctx=createTurnContext(w);processMilitary(w,ctx);
    expect(army.regionId).toBe(camp.id);expect(army.order).toMatchObject({kind:'retreat',warId:null,issuedTurn:10});
    expect(ctx.facts.some(f=>f.kind==='army_order_changed'&&f.payload.next.warId===null)).toBe(true);
    w.turn++;processMilitary(w,createTurnContext(w));expect(army.regionId).toBe(rest.id);
    expect(army.recentMovement?.warId).toBeNull();expect(army.order.kind).toBe('hold');
  });
  it('short low morale with real local rations rests instead of fleeing to a more prestigious capital',()=>{
    const {w,army,camp}=fixture();camp.food=army.soldiers*3;
    processMilitary(w,createTurnContext(w));expect(army.regionId).toBe(camp.id);expect(army.order.kind).toBe('hold');
  });
  it('keeps a mature retreat between equally near safe posts despite a food-score fluctuation',()=>{
    const {w,army,camp,rest,other}=fixture();
    w.polities[0].capitalRegionId=camp.id;camp.neighbors.push(other.id);other.neighbors.push(camp.id);
    w.routes.push({...w.routes[0],id:'direct-rest',fromRegionId:camp.id,toRegionId:other.id});
    rest.population=other.population=100_000;rest.defense=other.defense=10;
    rest.food=100_000;other.food=army.soldiers*2;army.order.targetRegionId=other.id;
    const ctx=createTurnContext(w);processMilitary(w,ctx);
    expect(army.regionId).toBe(other.id);
    expect(ctx.facts.some(f=>f.kind==='army_order_changed'&&f.payload.next.kind==='retreat')).toBe(false);
  });
  it.each(['new','blocked','no-route','starved','occupied','threatened','lost','landing','strait','commander'] as const)(
    'does not grant an escape when %s',mode=>{
      const {w,army,camp,rest,other,enemy}=fixture();
      if(mode==='new')army.order.issuedTurn=w.turn;
      if(mode==='blocked')camp.neighbors=[];
      if(mode==='no-route')w.routes=[];
      if(mode==='starved')rest.food=other.food=0;
      if(mode==='lost')rest.controllerId=enemy.controllerId;
      if(mode==='occupied'||mode==='threatened'){
        w.armies.push({...army,id:'enemy-on-road',polityId:enemy.controllerId,regionId:mode==='occupied'?rest.id:enemy.id,order:{...army.order,kind:'hold'}});
        if(mode==='threatened')rest.neighbors.push(enemy.id);
      }
      if(mode==='landing')army.embarkedOperationId='voyage';
      if(mode==='strait')w.routes[0].kind='海峡';
      if(mode==='commander')army.order.issuerId='old-commander';
      processMilitary(w,createTurnContext(w));expect(army.regionId).toBe(camp.id);
    });
  it('a changed task or new war cannot use a previous retreat authorization',()=>{
    const {w,army,camp}=fixture();army.order.kind='advance';
    processMilitary(w,createTurnContext(w));expect(army.regionId).toBe(camp.id);expect(army.order.issuedTurn).toBe(10);
    w.turn++;w.wars[0].id='new-front';processMilitary(w,createTurnContext(w));expect(army.regionId).toBe(camp.id);expect(army.order.issuedTurn).toBe(11);
  });
  it('retreat planning remains read-only with respect to position and never invents supplies',()=>{
    const {w,army,camp}=fixture(),before=[army.food,army.soldiers,totalWorldFood(w)];
    planArmyOrders(w,createTurnContext(w));expect(army.regionId).toBe(camp.id);expect([army.food,army.soldiers,totalWorldFood(w)]).toEqual(before);
  });
});
