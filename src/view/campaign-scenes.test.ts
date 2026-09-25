import { describe, expect, it } from 'vitest';
import { createWorld, serializeWorld } from '../sim';
import type { BattleFact, SimulationFact } from '../sim/facts';
import { projectHistoricalScenes } from './historical-scenes';

function fixture() {
  const world=createWorld('交战阶段夹具');
  const [a,b,c]=world.regions; a.neighbors=[b.id];b.neighbors=[a.id];c.neighbors=[];
  const [army,foe]=world.armies;
  const side=(x:typeof army)=>({armyId:x.id,polityId:x.polityId,commanderId:x.commanderId,deputyCommanderId:null,
    soldiersBefore:1000,soldiersAfter:800,losses:200,moraleBefore:60,moraleAfter:55,trainingBefore:60,supplyBefore:90,participants:[]});
  const battle=(id:string,turn:number,regionId=a.id,warId='war-fixture'):BattleFact=>({
    id,turn,year:Math.floor(turn/4)+1,season:(['春','夏','秋','冬'] as const)[turn%4],kind:'battle',category:'军事',importance:3,
    actorIds:[army.commanderId,foe.commanderId],regionIds:[regionId],polityIds:[army.polityId,foe.polityId],sourceFactIds:[],causes:[],stateDeltas:[],
    payload:{warId,targetRegionId:regionId,routeId:'route-fixture',attackerWon:false,attackerPower:10,defenderPower:11,militiaLosses:20,attacker:side(army),defenders:[side(foe)]}});
  return {world,a,b,c,battle};
}
describe('read-only campaign scenes',()=>{
  it('keeps a continuous multi-season campaign, true order, final control, distinct losses and unique people',()=>{
    const {world,a,b,battle}=fixture();
    const first=battle('z-first',3),second=battle('a-second',4,b.id);second.payload.attackerWon=true;
    const transfer:SimulationFact={...second,id:'transfer',kind:'territory_control_changed',importance:4,sourceFactIds:[second.id],
      payload:{warId:'war-fixture',regionId:b.id,previousControllerId:second.payload.defenders[0].polityId,nextControllerId:second.payload.attacker.polityId,reason:'battle_capture'}};
    const death:SimulationFact={...second,id:'dead',kind:'character_death',sourceFactIds:[second.id],payload:{characterId:world.characters[0].id,age:50,role:'军团主帅',health:30,diseaseId:null,cause:'battle',battleFactId:second.id}};
    world.facts=[first,second,transfer,death];world.history=[];
    const before=serializeWorld(world),scenes=projectHistoricalScenes(world,[first,second,transfer,death,death],10);
    expect(scenes).toHaveLength(1);const s=scenes[0];
    expect(s.title).toContain('战役');expect(s.dateLabel).toContain('至');
    expect(s.summary.indexOf(a.name)).toBeLessThan(s.summary.indexOf(b.name));
    expect(s.summary).toContain('峰值');expect(s.summary).toContain('2000');
    expect(s.summary).toContain('常备军2支');expect(s.summary).toContain('累计损失800');expect(s.summary).toContain('民兵损失40');expect(s.summary).toContain('1人阵亡');
    expect(s.summary).toContain('守方守住');expect(s.summary).toContain('攻方取胜');expect(s.summary).toContain('此后归');
    expect(s.sourceFactIds).toEqual(expect.arrayContaining([first.id,second.id,transfer.id,death.id]));
    expect(serializeWorld(world)).toBe(before);
  });
  it.each(['years','war','front','formation','withdrawal','peace'] as const)('does not join an unsupported continuous campaign: %s',boundary=>{
    const {world,a,c,battle}=fixture(),first=battle('first',10),next=battle('next',11);
    const facts:SimulationFact[]=[first];
    if(boundary==='years')next.turn=50;
    if(boundary==='war')next.payload.warId='other-war';
    if(boundary==='front')next.payload.targetRegionId=c.id;
    if(boundary==='formation'){next.payload.attacker.armyId='other-army';next.payload.defenders=[];}
    if(boundary==='peace')facts.push({...first,id:'end',kind:'war_ended',payload:{warId:'war-fixture',attackerId:first.polityIds[0],defenderId:first.polityIds[1],result:'negotiated_peace',winnerId:null,loserId:null,reason:'议和',durationTurns:3,attackerScore:0,defenderScore:0,indemnity:0}});
    if(boundary==='withdrawal'){
      const order={...world.armies[0].order,warId:'war-fixture',targetRegionId:a.id};
      facts.push({...first,id:'order',kind:'army_order_changed',payload:{armyId:first.payload.attacker.armyId,polityId:first.payload.attacker.polityId,previous:order,next:{...order,kind:'retreat'}}});
    }
    facts.push(next);world.facts=facts;world.history=[];
    const scenes=projectHistoricalScenes(world,facts,10);
    expect(scenes.find(s=>s.sourceFactIds.includes(first.id))!.sourceFactIds).not.toContain(next.id);
  });
  it('uses fact stream order instead of lexical ids for encounters in one quarter',()=>{
    const {world,battle}=fixture(),first=battle('z',10),second=battle('a',10);second.payload.attackerWon=true;
    world.facts=[first,second];world.history=[];
    const s=projectHistoricalScenes(world,[second,first],10)[0];
    expect(s.summary.indexOf('守方守住')).toBeLessThan(s.summary.indexOf('攻方取胜'));
    expect(s.sourceFactIds).toContain(first.id);expect(s.sourceFactIds).toContain(second.id);
  });
});
