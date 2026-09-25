import { describe, expect, it } from 'vitest';
import { advanceWorldBy, createWorld, serializeWorld } from '../sim';
import type { BattleFact, SimulationFact } from '../sim/facts';
import { projectHistoricalScenes } from './historical-scenes';
import { projectSituationDetail } from './situation-detail';
import { projectWarGroups } from './war-group-projection';

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
  it('names each side’s casualties in encounter order and exposes their own evidence',()=>{
    const {world,battle}=fixture();
    const first=battle('z-first',3),second=battle('a-second',4);second.payload.attackerWon=true;
    const deaths=[first,second].map((b,i):SimulationFact=>{
      const side=i?b.payload.defenders[0]:b.payload.attacker;
      side.participants=[{characterId:side.commanderId,role:'commander',formationCommanderId:side.commanderId,factionId:null,soldiersBefore:1000,soldiersAfter:800,losses:200}];
      return {...b,id:`death-${i}`,kind:'character_death',sourceFactIds:[b.id],payload:{characterId:side.commanderId,age:50,role:'军团主帅',health:60,diseaseId:null,cause:'battle',battleFactId:b.id}};
    });
    world.facts=[first,deaths[0],second,deaths[1]];
    world.history=deaths.map(f=>({...f,id:`event-${f.id}`,kind:'character_battle_death',title:'真实战死',summary:'真实战死',evidence:[],situationIds:[],sourceFactIds:[f.id,...f.sourceFactIds]}));
    world.history.unshift({...world.history[0],id:'earlier-listed-consequence',kind:'family_inheritance',sourceFactIds:[deaths[0].id]});
    const template=advanceWorldBy(createWorld('兵权入世'),8).situationSystem.situations.find(s=>s.type==='war_progress')!;
    const situation={...template,scopeKey:'war-fixture',startedTurn:4,lastUpdatedTurn:4,causalFactIds:[],milestoneFactIds:[],resolution:null};
    world.wars=[{...advanceWorldBy(createWorld('兵权入世'),8).wars[0],id:'war-fixture',startedTurn:2,endedTurn:null,active:true}];
    world.turn=5;world.lastTurn=null;
    const before=serializeWorld(world),scene=projectHistoricalScenes(world,world.facts,10)[0],detail=projectSituationDetail(world,situation);
    const attacking=world.characters.find(c=>c.id===first.payload.attacker.commanderId)!.name;
    const defending=world.characters.find(c=>c.id===second.payload.defenders[0].commanderId)!.name;
    expect(scene.summary).toContain(`主帅${attacking}阵亡`);expect(scene.summary).toContain(`主帅${defending}阵亡`);
    expect(scene.summary.indexOf(`${attacking}阵亡`)).toBeLessThan(scene.summary.indexOf('第2战'));
    expect(scene.summary.indexOf(`${defending}阵亡`)).toBeGreaterThan(scene.summary.indexOf('第2战'));
    for(const d of deaths){expect(detail.evidence.find(e=>e.id===d.id)?.historyEventIds[0]).toBe(`event-${d.id}`);expect(scene.sourceFactIds).toContain(d.id);}
    expect(detail.durationLabel).toBe('3季');expect(projectWarGroups(world,'war-fixture')!.durationLabel).toBe('第3季');
    expect(detail.currentChange).toContain(`${attacking}阵亡`);
    expect(serializeWorld(world)).toBe(before);
    world.wars[0].active=false;world.wars[0].endedTurn=4;world.turn=100;
    expect(projectSituationDetail(world,situation).durationLabel).toBe('3季');
    expect(projectWarGroups(world,'war-fixture')!.durationLabel).toBe('第3季');
  });
  it('does not infer an occupation or retreat from a win or loss alone',()=>{
    const {world,battle}=fixture(),b=battle('victory-without-survivors',3);b.payload.attackerWon=true;
    world.facts=[b];world.wars=[{id:'war-fixture',kind:'interstate',attackerId:b.polityIds[0],defenderId:b.polityIds[1],startedTurn:2,endedTurn:null,active:true,attackerScore:0,defenderScore:0,reason:'边境',lastBattleTurn:3,goal:'边境',targetRegionIds:b.regionIds,exhaustion:0}];
    expect(projectWarGroups(world,'war-fixture')!.latestBattle!.aftermath).toBe('此战未记录领土易手');
    b.payload.attackerWon=false;
    expect(projectWarGroups(world,'war-fixture')!.latestBattle!.aftermath).toBe('此战未记录领土易手');
  });
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
