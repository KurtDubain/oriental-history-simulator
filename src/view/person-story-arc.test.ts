import { describe, expect, it } from 'vitest';

import { computeWorldHash, createWorld, serializeWorld } from '../sim';
import type { BattleFact, SimulationFact } from '../sim/facts';
import type { WorldState } from '../sim/types';
import { projectPersonStoryArc } from './person-story-arc';
import { toPersonInspector } from './person-dossier-adapter';
import { projectRosterCollection } from './roster-adapter';

function battleFact(
  world: WorldState,
  characterId: string,
  id: string,
  turn: number,
  losses: number,
): BattleFact {
  const army = world.armies.find((item) => item.participantIds.includes(characterId))!;
  const force = world.personalForces.find((item) => item.ownerId === characterId)!;
  const before = Math.max(force.soldiers, losses + 120);
  const participant = {
    characterId,
    soldiersBefore: before,
    soldiersAfter: before - losses,
    losses,
    factionId: world.characters.find((item) => item.id === characterId)?.factionId ?? null,
    formationCommanderId: army.commanderId,
    role: characterId === army.commanderId ? 'commander' as const : 'member' as const,
  };
  return {
    id,
    turn,
    year: 1 + Math.floor(turn / 4),
    season: ['春', '夏', '秋', '冬'][turn % 4] as BattleFact['season'],
    kind: 'battle',
    category: '军事',
    importance: 5,
    actorIds: [characterId],
    polityIds: [army.polityId],
    regionIds: [army.regionId],
    causes: [],
    stateDeltas: [],
    sourceFactIds: [],
    payload: {
      warId: 'war-story-test',
      targetRegionId: army.regionId,
      routeId: world.routes[0]!.id,
      attackerWon: true,
      attackerPower: 2,
      defenderPower: 1,
      militiaLosses: 0,
      attacker: {
        armyId: army.id,
        polityId: army.polityId,
        commanderId: army.commanderId,
        deputyCommanderId: army.deputyCommanderId,
        soldiersBefore: before,
        soldiersAfter: before - losses,
        moraleBefore: army.morale,
        moraleAfter: army.morale,
        trainingBefore: army.training,
        supplyBefore: army.supply,
        losses,
        participants: [participant],
      },
      defenders: [],
    },
  };
}

describe('person story arc', () => {
  it.each(['winner', 'loser', 'received', 'late-accession', 'early-death', 'unknown'] as const)(
    'attributes elimination to the historical seat (%s), never final nationality', stance => {
      const w=createWorld('灭国的立场来自任期');
      const p=w.characters.find(p=>w.armies.some(a=>a.commanderId===p.id))!;
      const winner=p.polityId, loser=w.polities.find(x=>x.id!==winner)!.id;
      const base=battleFact(w,p.id,'base',20,10), regionId=base.regionIds[0];
      const losing=stance==='loser'||stance==='received';
      const seat={id:'seat',holderId:p.id,polityId:losing?loser:winner,kind:'君主' as const,rank:100,
        regionId,armyId:null,appointedTurn:stance==='late-accession'?20:10,endedTurn:null,active:true};
      w.offices=stance==='unknown'?[]:[seat]; w.history=[];
      const capture:SimulationFact={...base,id:'z-first',kind:'territory_control_changed',actorIds:[],
        payload:{regionId,previousControllerId:loser,nextControllerId:winner,reason:'battle_capture',warId:'war'}};
      const start:SimulationFact={...base,id:'a-later',kind:'appointment_started',payload:{appointmentId:'seat',action:'started',
        holderId:p.id,polityId:winner,officeKind:'君主',rank:100,regionId,armyId:null,fleetId:null}};
      const death:SimulationFact={...base,id:'not-a-number',kind:'character_death',payload:{characterId:p.id,
        cause:'natural',age:70,health:0,diseaseId:null,role:'君主'}};
      w.facts=stance==='late-accession'?[capture,start]:stance==='early-death'?[death,capture]:[capture];
      if(stance==='received')w.offices.push({...seat,id:'later-seat',polityId:winner,appointedTurn:21});
      w.history.push({...base,id:'elimination',kind:'polity_eliminated',title:'故国灭亡',summary:'故国失去最后领土，胜方接收人员。',
        actorIds:[p.id],evidence:[],situationIds:[],sourceFactIds:[capture.id],stateDeltas:[
          {entityType:'polity',entityId:winner,field:'capitalRegionId',before:'old',after:regionId},
          {entityType:'polity',entityId:loser,field:'alive',before:true,after:false},
          {entityType:'character',entityId:p.id,field:'polityId',before:loser,after:winner}]});
      const body=serializeWorld(w),hash=computeWorldHash(w);
      const arc=projectPersonStoryArc(w,p), beat=arc.find(b=>b.sourceEventIds.includes('elimination'));
      if(['late-accession','early-death','unknown'].includes(stance))expect(beat).toBeUndefined();
      else {
        expect(beat?.phase).toBe(losing?'setback':'battle');
        expect(beat?.title).toContain(losing?'任内亡国':'任内灭敌');
        expect(beat?.primaryFactId).toBe(capture.id);
        expect(beat?.primaryEventId).toBe('elimination');
      }
      if(stance==='late-accession') {
        w.facts=[start,capture];
        expect(projectPersonStoryArc(w,p).find(b=>b.sourceEventIds.includes('elimination'))?.phase).toBe('battle');
        w.facts=[capture,start];
      }
      expect(computeWorldHash(w)).toBe(hash);expect(serializeWorld(w)).toBe(body);
    });

  it('discovers sustained careers and tragic reversals ahead of a lone death or isolated founding, with visible reasons', () => {
    const w=createWorld('事业不是单条重要度');
    const people=w.armies.slice(0,5).map(a=>w.characters.find(p=>p.id===a.commanderId)!);
    const [career,tragic,founder,lone,governor]=people;
    w.history=[]; w.facts=[]; w.offices=[]; w.turn=100;
    const regions=w.regions.slice(0,4);
    regions.forEach(r=>{r.neighbors=regions.filter(x=>x!==r).map(x=>x.id);});
    for(const p of people) {
      p.alive=false;p.influence=0;
      const base=battleFact(w,p.id,`battle-${p.id}`,50,100);
      base.payload.attackerWon=false;
      if(p===governor) {
        w.facts.push(...[20,30].map((turn):SimulationFact=>({...base,id:`relief-${turn}`,turn,importance:3,
          kind:'local_governance_resolved',payload:{actorId:p.id,polityId:p.polityId,regionId:regions[0].id,
            authorityId:p.id,action:'open_granary',outcome:'enacted',reasonCode:'measure_enacted',score:60,threshold:50,
            pressure:80,foodSeasonsBefore:0.5,unrestBefore:80,unrestAfter:50,foodSpent:500,treasurySpent:100}})));
        continue;
      }
      const death:SimulationFact={...base,id:`death-${p.id}`,kind:'character_death',sourceFactIds:[base.id],payload:{
        characterId:p.id,cause:'battle',battleFactId:base.id,age:60,health:0,diseaseId:null,role:'主帅'}};
      w.facts.push(base,death);
      if(p===lone)continue;
      w.offices.push({id:`seat-${p.id}`,holderId:p.id,polityId:p.polityId,kind:'君主',rank:100,armyId:null,
        regionId:regions[0].id,appointedTurn:10,endedTurn:50,active:false});
      w.history.push({...base,id:`founding-${p.id}`,turn:10,kind:'rebellion',title:'据地起兵',summary:'据地建立政权。',
        evidence:[],situationIds:[],sourceFactIds:[],stateDeltas:[{entityType:'polity',entityId:p.polityId,field:'alive',before:false,after:true}]});
      if(p===founder)continue;
      w.facts.push(...regions.map((r,i):SimulationFact=>({...base,id:`gain-${p.id}-${i}`,turn:20+i,kind:'territory_control_changed',
        actorIds:[],regionIds:[r.id],payload:{regionId:r.id,previousControllerId:'enemy',nextControllerId:p.polityId,reason:'battle_capture',warId:'war'}})));
      if(p===tragic)w.history.push({...base,id:'lost-capital',turn:40,kind:'capital_fall',title:'失去旧都',summary:'旧都失守。',evidence:[],
        situationIds:[],sourceFactIds:[],stateDeltas:[{entityType:'polity',entityId:p.polityId,field:'capitalRegionId',before:regions[0].id,after:regions[1].id}]});
    }
    const body=serializeWorld(w),hash=computeWorldHash(w);
    const rows=projectRosterCollection(w,'people',{query:'',quickView:'deceased',filters:{},sort:'attention'}).items;
    const index=(id:string)=>rows.findIndex(r=>r.id===id);
    for(const p of [career,tragic])for(const smaller of [lone,founder])expect(index(p.id)).toBeLessThan(index(smaller.id));
    expect(index(lone.id)).toBeGreaterThanOrEqual(0);
    expect(index(governor.id)).toBeLessThan(index(lone.id));
    expect(projectPersonStoryArc(w,lone).find(b=>b.title===rows[index(lone.id)].reason?.label)?.phase).toBe('ending');
    for(const p of people) {
      const arc=projectPersonStoryArc(w,p),reason=rows.find(r=>r.id===p.id)!.reason!;
      expect(arc.length).toBeLessThanOrEqual(5);
      expect(arc.some(b=>b.title===reason.label)).toBe(true);
      for(const b of arc) {
        expect(b.sourceFactIds.every(id=>w.facts.some(f=>f.id===id))).toBe(true);
        expect(b.sourceEventIds.every(id=>w.history.some(e=>e.id===id))).toBe(true);
        expect(new Set(b.sourceEventIds).size).toBe(b.sourceEventIds.length);
      }
    }
    expect(computeWorldHash(w)).toBe(hash);expect(serializeWorld(w)).toBe(body);
  });

  it.each(['character_death', 'appointment_ended'] as const)('uses stream order, not IDs, for same-quarter %s and later gains', kind => {
    const world = createWorld('同季先后不是编号');
    const person = world.characters.find(p => world.armies.some(a => a.commanderId === p.id))!;
    const base = battleFact(world, person.id, 'battle-source', 20, 100);
    world.offices = [{ id:'reign', holderId:person.id, polityId:person.polityId, kind:'君主', rank:100,
      armyId:null, regionId:base.regionIds[0], appointedTurn:10, endedTurn:20, active:false }];
    const places = world.regions.slice(0,3);
    places.forEach(r => { r.neighbors = places.filter(p => p !== r).map(p => p.id); });
    const gains = places.map((r,i): SimulationFact => ({ ...base, id:`z-capture-${i}`, turn:i<2?19:20,
      kind:'territory_control_changed', actorIds:[], regionIds:[r.id], sourceFactIds:[],
      payload:{regionId:r.id,previousControllerId:'enemy',nextControllerId:person.polityId,reason:'battle_capture',warId:'campaign'} }));
    const exit: SimulationFact = kind === 'character_death' ? { ...base,id:'a-exit',kind,
      regionIds:[places[2].id], payload:{characterId:person.id,cause:'battle',battleFactId:base.id,age:70,health:0,diseaseId:null,role:'君主'} }
      : { ...base,id:'a-exit',kind,payload:{appointmentId:'reign',action:'ended',holderId:person.id,
        polityId:person.polityId,officeKind:'君主',rank:100,regionId:base.regionIds[0],armyId:null,fleetId:null} };
    world.facts = [...gains.slice(0,2),exit,gains[2]];
    person.alive = kind !== 'character_death';
    const before = serializeWorld(world), hash = computeWorldHash(world);
    const arc = projectPersonStoryArc(world,person);
    expect(arc.flatMap(b=>b.sourceFactIds)).not.toContain(gains[2].id);
    expect(arc.flatMap(b=>b.sourceFactIds)).toEqual(expect.arrayContaining(gains.slice(0,2).map(f=>f.id)));
    if (!person.alive) {
      person.locationRegionId = places[0].id;
      const view = toPersonInspector(world,person);
      expect(view.origin).toBe(places[2].name);
      expect(view.originLabel).toBe('阵亡地');
      person.locationRegionId = world.armies.find(a=>a.commanderId===person.id)!.regionId;
    }
    expect(computeWorldHash(world)).toBe(hash);
    expect(serializeWorld(world)).toBe(before);
    world.facts = [...gains,exit];
    expect(projectPersonStoryArc(world,person).flatMap(b=>b.sourceFactIds)).toContain(gains[2].id);
  });

  it('preserves the largest career phase across truces before an ordinary beginning', () => {
    const world=createWorld('事业峰值不按姓名');
    const p=world.characters.find(p=>world.armies.some(a=>a.commanderId===p.id))!;
    const base=battleFact(world,p.id,'base',20,10);
    world.offices=[{id:'reign',holderId:p.id,polityId:p.polityId,kind:'君主',rank:100,armyId:null,
      regionId:base.regionIds[0],appointedTurn:20,endedTurn:null,active:true}];
    const regions=world.regions.slice(0,7);
    regions.forEach((r,i)=>{r.neighbors=regions.filter((_,j)=>Math.abs(i-j)===1).map(r=>r.id);});
    const captures=regions.map((r,i):SimulationFact=>({...base,id:`peak-${i}`,turn:i?80+i:60,actorIds:[],regionIds:[r.id],
      kind:'territory_control_changed',sourceFactIds:[],payload:{regionId:r.id,previousControllerId:'enemy',
        nextControllerId:p.polityId,warId:i?'second-war':'first-war',reason:'battle_capture'}}));
    world.facts.push(...captures);
    for(let i=0;i<8;i++) {
      const b=battleFact(world,p.id,`late-${i}`,100+i*10,100);
      b.payload.warId=`unrelated-${i}`;
      world.facts.push(b);
    }
    const arc=projectPersonStoryArc(world,p), peak=arc.find(b=>b.sourceFactIds.includes('peak-0'))!;
    expect(arc.length).toBeLessThanOrEqual(5);
    expect(peak.sourceFactIds).toEqual(expect.arrayContaining(captures.map(f=>f.id)));
    expect(peak.title).toContain('任内');
    expect(peak.title).not.toContain('亲自');
    expect(arc.some(b=>b.sourceFactIds.includes('late-7'))).toBe(true);
  });

  it('joins accession and destroyed-state dismissal without consuming a later independent dismissal', () => {
    const world = createWorld('同一人生结算链');
    const person = world.characters.find(p => world.armies.some(a => a.commanderId === p.id))!;
    const base = battleFact(world, person.id, 'source', 20, 10);
    const office = { ...base, id: 'accession-seat', kind: 'appointment_started' as const,
      payload: { action: 'started' as const, appointmentId: 'reign', holderId: person.id, polityId: person.polityId,
        officeKind: '君主' as const, rank: 100, regionId: base.regionIds[0], armyId: null, fleetId: null } };
    const end = { ...office, id: 'kingdom-end', turn: 40, kind: 'appointment_ended' as const, payload: { ...office.payload, action: 'ended' as const } };
    world.offices.push({ id:'reign', holderId:person.id, polityId:person.polityId, kind:'君主',rank:100,
      regionId:base.regionIds[0],armyId:null,appointedTurn:20,endedTurn:40,active:false });
    world.facts.push(office,end);
    const former = { ...office,id:'former-office-end',kind:'appointment_ended' as const,
      payload:{...office.payload,action:'ended' as const,officeKind:'宰辅' as const,appointmentId:'old-post'} };
    world.facts.push(former);
    world.history.push({ ...base, id:'accession',kind:'succession',title:`${person.name}获拥立`,summary:'承接君位',evidence:[],situationIds:[],sourceFactIds:[office.id] },
      { ...base,id:'extinction',turn:40,kind:'polity_eliminated',title:'故国灭亡',summary:'故国退出，君位结束',evidence:[],situationIds:[],sourceFactIds:[],
        stateDeltas:[{entityType:'polity',entityId:person.polityId,field:'alive',before:true,after:false}] });
    const arc=projectPersonStoryArc(world,person);
    const accession=arc.find(b=>b.sourceEventIds.includes('accession'))!;
    expect(accession.title).toContain('登位');
    expect(accession.primaryFactId).toBe(office.id);
    expect(accession.sourceFactIds).toContain(former.id);
    expect(arc.filter(b=>b.sourceFactIds.includes(former.id))).toHaveLength(1);
    expect(arc.filter(b=>b.sourceFactIds.includes(office.id))).toHaveLength(1);
    const exit=arc.find(b=>b.sourceEventIds.includes('extinction'))!;
    expect(exit.sourceFactIds).toContain(end.id);
    expect(exit.primaryEventId).toBe('extinction');
    expect(arc.filter(b=>b.sourceFactIds.includes(end.id))).toHaveLength(1);
  });

  it('retains a late military change after several early capital victories without inventing a new role', () => {
    const world = createWorld('长军旅不是四场早战');
    const person=world.characters.find(p=>world.armies.some(a=>a.commanderId===p.id))!;
    for(let i=0;i<7;i++) {
      const battle=battleFact(world,person.id,`career-battle-${i}`,12+i*16,200+i*100);
      battle.payload.warId=`career-war-${i}`;
      battle.payload.targetRegionId=world.regions[i].id;
      battle.regionIds=[world.regions[i].id];
      world.facts.push(battle);
    }
    const arc=projectPersonStoryArc(world,person);
    expect(arc.length).toBeLessThanOrEqual(5);
    expect(arc.some(b=>b.sourceFactIds.includes('career-battle-6'))).toBe(true);
    expect(arc.some(b=>b.sourceFactIds.includes('career-battle-0'))).toBe(true);
    expect(arc.map(b=>b.sourceFactIds).flat().every(id=>world.facts.some(f=>f.id===id))).toBe(true);
  });

  it('joins adjacent gains and the later collapse, retaining each fact without crediting national victories as personal combat', () => {
    const world = createWorld('不绑定姓名的兴亡');
    const person = world.characters.find(p => world.armies.some(a => a.commanderId === p.id))!;
    const other = world.characters.find(p => p.polityId !== person.polityId && world.armies.some(a => a.commanderId === p.id))!;
    const base = battleFact(world, person.id, 'last-battle', 30, 150);
    const place = world.regions.find(r => r.id === base.regionIds[0])!;
    const neighbor = world.regions.find(r => place.neighbors.includes(r.id))!;
    world.offices.push({ id: 'reign', holderId: person.id, polityId: person.polityId, kind: '君主', rank: 100,
      armyId: null, regionId: place.id, appointedTurn: 10, endedTurn: 30, active: false });
    const gains = [place, neighbor].map((r,i): SimulationFact => ({ ...base, id: `gain-${i}`, turn: 20+i,
      kind: 'territory_control_changed', actorIds: [other.id], regionIds: [r.id], sourceFactIds: [`victory-${i}`],
      payload: { warId: 'expansion', regionId: r.id, previousControllerId: other.polityId,
        nextControllerId: person.polityId, reason: 'battle_capture' } }));
    const losses = gains.map((f,i): SimulationFact => ({ ...f, id: `loss-${i}`, turn: 27+i,
      kind: 'territory_control_changed', sourceFactIds: [`defeat-${i}`], payload: { warId: base.payload.warId,
        regionId: f.regionIds[0], previousControllerId: person.polityId, nextControllerId: other.polityId, reason: 'battle_capture' } }));
    base.payload.attackerWon = false;
    world.facts.push(...gains, ...losses, base, { ...base, id: 'death', kind: 'character_death', sourceFactIds: [base.id],
      payload: { characterId: person.id, cause: 'battle', age: person.age, role: person.role, health: person.health, diseaseId: null, battleFactId: base.id } });
    person.alive = false;
    const before = serializeWorld(world), arc = projectPersonStoryArc(world, person);
    expect(arc.map(b => b.title)).toContain(`${person.name}任内连取${place.name}、${neighbor.name}`);
    const campaign = arc.find(b => b.title.includes('任内连取'))!;
    expect(campaign.title).toBe(`${person.name}任内连取${place.name}、${neighbor.name}`);
    expect(campaign.summary).not.toContain('本人参战');
    expect(campaign.sourceFactIds).toEqual(['gain-0','gain-1','victory-0','victory-1']);
    expect(arc.at(-1)?.title).toContain(`${place.name}、${neighbor.name}先后失守`);
    expect(arc.at(-1)?.sourceFactIds).toEqual(expect.arrayContaining(['loss-0','loss-1','defeat-0','defeat-1',base.id,'death']));
    expect(serializeWorld(world)).toBe(before);
    world.facts.reverse();
    expect(projectPersonStoryArc(world, person)).toEqual(arc);
  });

  it('merges a witnessed founding with its throne appointment, not the former ruler in actorIds', () => {
    const world = createWorld('起兵身份并非人物姓名');
    const person = world.characters.find(p => world.armies.some(a => a.commanderId === p.id))!;
    const former = world.characters.find(p => p.id === world.polities.find(n => n.id === person.polityId)!.rulerId)!;
    const base = battleFact(world, person.id, 'base', 20, 10);
    world.offices.push({ id: 'founder-seat', holderId: person.id, polityId: 'founded-polity', kind: '君主', rank: 100,
      armyId: null, regionId: base.regionIds[0], appointedTurn: 20, endedTurn: null, active: true });
    const fact = { ...base, id: 'founder-office', kind: 'appointment_started' as const, sourceFactIds: [],
      payload: { appointmentId: 'founder-seat', action: 'started' as const, officeKind: '君主' as const,
        holderId: person.id, polityId: 'founded-polity', regionId: base.regionIds[0], armyId: null, fleetId: null, rank: 100 } };
    world.facts.push(fact);
    const old = { ...fact,id:'former-governor',kind:'appointment_ended' as const,
      payload:{...fact.payload,action:'ended' as const,officeKind:'地方长官' as const,polityId:person.polityId} };
    world.facts.push(old);
    world.history.push({ ...base, id: 'founding', kind: 'rebellion', actorIds: [former.id, person.id],
      title: `${person.name}据边城起兵`, summary: '建立新国', sourceFactIds: [], evidence: [], situationIds: [],
      stateDeltas: [{ entityType: 'polity', entityId: 'founded-polity', field: 'alive', before: false, after: true },
        {entityType:'character',entityId:person.id,field:'polityId',before:person.polityId,after:'founded-polity'}] });
    const arc = projectPersonStoryArc(world, person), founding = arc.find(b => b.sourceEventIds.includes('founding'))!;
    expect(founding.title).toContain('据边城起兵');
    expect(founding.sourceFactIds).toContain(fact.id);
    expect(arc.filter(b => b.sourceFactIds.includes(fact.id))).toHaveLength(1);
    expect(founding.sourceFactIds).toContain(old.id);
    expect(arc.filter(b=>b.sourceFactIds.includes(old.id))).toHaveLength(1);
    expect(projectPersonStoryArc(world, former).some(b => b.title.includes('起兵'))).toBe(false);
  });

  it('joins a normal same-quarter transfer without pretending dismissal, but retains a sourced purge', () => {
    const world = createWorld('任职转换不等于失势');
    const p = world.characters.find(p => world.armies.some(a => a.commanderId === p.id))!;
    const base = battleFact(world, p.id, 'base', 24, 10);
    const ended = { ...base, id: 'transfer-end', kind: 'appointment_ended' as const,
      payload: { appointmentId: 'old-seat', action: 'ended' as const, officeKind: '地方长官' as const,
        holderId: p.id, polityId: p.polityId, regionId: base.regionIds[0], armyId: null, fleetId: null, rank: 55 } };
    const started = { ...ended, id: 'transfer-start', kind: 'appointment_started' as const,
      payload: { ...ended.payload, action: 'started' as const, officeKind: '军团主帅' as const, rank: 70 } };
    world.facts.push(ended, started);
    const arc = projectPersonStoryArc(world, p);
    expect(arc).toHaveLength(1);
    expect(arc[0].title).toContain('由地方长官转任军团主帅');
    expect(arc[0].sourceFactIds).toEqual(['transfer-end', 'transfer-start']);
    ended.sourceFactIds = ['purge-source'];
    expect(projectPersonStoryArc(world, p).some(b => b.phase === 'setback')).toBe(true);
  });

  it('keeps accession and a sourced capital capture above repeated late victories, without crediting the absent ruler', () => {
    const world = createWorld('重要转折非固定人生');
    const person = world.characters.find(p => world.armies.some(a => a.commanderId === p.id))!;
    const battle = battleFact(world, person.id, 'career_battle', 30, 100);
    const ruler = world.characters.find(p => p.id !== person.id)!;
    const capital = battle.payload.targetRegionId;
    world.facts.push(battle, { ...battle, id: 'late_battle', turn: 100 }, {
      ...battle, id: 'career_capture', kind: 'territory_control_changed', sourceFactIds: [battle.id],
      payload: { regionId: capital, previousControllerId: 'old_polity', nextControllerId: person.polityId, reason: 'battle_capture', warId: battle.payload.warId },
    });
    const event = { id: 'career_accession', turn: 20, year: 6, season: '春' as const, category: '政治' as const,
      kind: 'succession', title: `${person.name}登位`, summary: `${person.name}获拥立继位。`, importance: 5 as const,
      actorIds: [person.id], polityIds: [person.polityId], regionIds: [], causes: [], evidence: [], sourceFactIds: [], situationIds: [],
      stateDeltas: [{ entityType: 'polity' as const, entityId: person.polityId, field: 'rulerId', before: ruler.id, after: person.id }],
    };
    world.history.push(event, { ...event, id: 'capital_event', kind: 'capital_fall', turn: 30,
      title: '旧国失都', summary: '旧国迁都，权威下降。', actorIds: [person.id, ruler.id],
      regionIds: ['unrelated_first_sorted_region', capital], sourceFactIds: ['career_capture'],
      stateDeltas: [{ entityType: 'polity', entityId: 'old_polity', field: 'capitalRegionId', before: capital, after: 'elsewhere' }],
    });
    const before = serializeWorld(world);
    const arc = projectPersonStoryArc(world, person);
    expect(arc.some(b => b.title === `${person.name}登位`)).toBe(true);
    expect(arc.find(b => b.sourceEventIds.includes('capital_event'))?.title).toContain('参战，攻克');
    const national = projectPersonStoryArc(world, ruler).find(b => b.sourceEventIds.includes('capital_event'))!;
    expect(national.title).toContain('任内国事：攻取');
    expect(national.phase).toBe('battle');
    expect(national.title).not.toContain('参战');
    expect(serializeWorld(world)).toBe(before);
    world.facts.reverse(); world.history.reverse();
    expect(projectPersonStoryArc(world, person)).toEqual(arc);
  });

  it('compresses repeated battles, keeps first/costliest/latest sources and deduplicates the Chronicle telling', () => {
    const world = createWorld('人物故事压缩');
    const person = world.characters.find((item) => world.armies.some((army) => army.participantIds.includes(item.id)))!;
    const battles = [
      battleFact(world, person.id, 'fact_story_b1', 4, 20),
      battleFact(world, person.id, 'fact_story_b2', 8, 80),
      battleFact(world, person.id, 'fact_story_b3', 12, 30),
      battleFact(world, person.id, 'fact_story_b4', 16, 40),
    ];
    world.facts.push(...battles);
    const before = serializeWorld(world);
    const hash = computeWorldHash(world);

    const first = projectPersonStoryArc(world, person);
    const second = projectPersonStoryArc(world, person);
    const compressed = first.find((beat) => beat.sourceFactIds.includes('fact_story_b1'));

    expect(first).toEqual(second);
    expect(first.length).toBeLessThanOrEqual(3);
    expect(compressed?.sourceFactIds).toEqual(['fact_story_b1', 'fact_story_b2', 'fact_story_b3', 'fact_story_b4']);
    expect(compressed?.summary).toContain('记录战损累计170人；最近一战战前');
    expect(compressed?.summary).not.toContain('本部由');
    expect(first.every((beat) => beat.sourceFactIds.length > 0)).toBe(true);
    expect(serializeWorld(world)).toBe(before);
    expect(computeWorldHash(world)).toBe(hash);
  });

  it('uses battle-linked wounds and deaths as concrete turning points', () => {
    const world = createWorld('人物命运转折');
    const person = world.characters.find((item) => world.armies.some((army) => army.participantIds.includes(item.id)))!;
    const battle = battleFact(world, person.id, 'fact_story_turn_battle', 4, 90);
    world.facts.push(battle, {
      id: 'fact_story_wound',
      turn: 4,
      year: 2,
      season: '春',
      kind: 'character_wounded',
      category: '军事',
      importance: 4,
      actorIds: [person.id],
      polityIds: [person.polityId],
      regionIds: [battle.payload.targetRegionId],
      causes: [],
      stateDeltas: [{ entityType: 'character', entityId: person.id, field: 'health', before: 100, after: 67, delta: -33 }],
      sourceFactIds: [battle.id],
      payload: {
        characterId: person.id,
        battleFactId: battle.id,
        warId: battle.payload.warId,
        regionId: battle.payload.targetRegionId,
        role: 'commander',
        sideWon: true,
        soldiersBefore: 500,
        soldiersAfter: 410,
        losses: 90,
        healthBefore: 100,
        healthAfter: 67,
        observerProtectionConsumed: false,
      },
    });

    const story = projectPersonStoryArc(world, person);

    const beat = story.find((item) => item.phase === 'setback' && item.sourceFactIds.includes('fact_story_wound'));
    expect(beat?.title).toContain('负伤退营');
    expect(beat?.sourceFactIds).toEqual(['fact_story_turn_battle', 'fact_story_wound']);
    expect(beat?.primaryFactId).toBe('fact_story_wound');
    expect(beat?.summary).toContain('此役战前');
    expect(beat?.summary).toContain('退出行营');
    expect(story.length).toBeLessThanOrEqual(3);
  });

  it('keeps a battle death and its same-seat cleanup in one evidence-owned ending', () => {
    const world = createWorld('人物结局同源归并');
    const person = world.characters.find((item) => world.armies.some((army) => army.commanderId === item.id))!;
    const battle = battleFact(world, person.id, 'fact_story_death_battle', 8, 240);
    const army = world.armies.find((item) => item.commanderId === person.id)!;
    const office = world.offices.find((item) => item.active && item.holderId === person.id)!;
    const deathId = 'fact_story_death';
    world.facts.push(battle, {
      id: deathId, turn: 8, year: 3, season: '春', kind: 'character_death', category: '军事', importance: 5,
      actorIds: [person.id], polityIds: [person.polityId], regionIds: [army.regionId], causes: [], stateDeltas: [],
      sourceFactIds: [battle.id], payload: { characterId: person.id, age: person.age, role: person.role,
        health: person.health, diseaseId: null, cause: 'battle', battleFactId: battle.id },
    }, {
      id: 'fact_story_cleanup', turn: 8, year: 3, season: '春', kind: 'appointment_ended', category: '政治', importance: 3,
      actorIds: [person.id], polityIds: [person.polityId], regionIds: [army.regionId], causes: [], stateDeltas: [],
      sourceFactIds: [deathId], payload: { appointmentId: office.id, action: 'ended', officeKind: office.kind,
        holderId: person.id, polityId: person.polityId, regionId: office.regionId, armyId: office.armyId,
        fleetId: office.fleetId ?? null, rank: office.rank },
    });
    person.alive = false;

    const story = projectPersonStoryArc(world, person);
    const ending = story.find((beat) => beat.phase === 'ending');

    expect(story).toHaveLength(1);
    expect(ending?.sourceFactIds).toEqual([
      'fact_story_cleanup',
      'fact_story_death',
      'fact_story_death_battle',
    ]);
    expect(ending?.summary).toContain(`同季卸下${office.kind}`);
    expect(ending?.primaryFactId).toBe(deathId);
  });

  it('does not merge a past wound into a later battle chapter or send its link to unrelated battle evidence', () => {
    const world = createWorld('人物经历时间边界');
    const person = world.characters.find((item) => world.armies.some((army) => army.participantIds.includes(item.id)))!;
    const early = battleFact(world, person.id, 'fact_story_early_battle', 5, 120);
    const later = battleFact(world, person.id, 'fact_story_later_battle', 25, 90);
    const woundId = 'fact_story_early_wound';
    world.facts.push(early, {
      id: woundId,
      turn: 5,
      year: 2,
      season: '夏',
      kind: 'character_wounded',
      category: '军事',
      importance: 4,
      actorIds: [person.id],
      polityIds: [person.polityId],
      regionIds: [early.payload.targetRegionId],
      causes: [],
      stateDeltas: [{ entityType: 'character', entityId: person.id, field: 'health', before: 100, after: 72, delta: -28 }],
      sourceFactIds: [early.id],
      payload: {
        characterId: person.id,
        battleFactId: early.id,
        warId: early.payload.warId,
        regionId: early.payload.targetRegionId,
        role: 'member',
        sideWon: true,
        soldiersBefore: 600,
        soldiersAfter: 480,
        losses: 120,
        healthBefore: 100,
        healthAfter: 72,
        recoveryUntilTurn: 8,
        observerProtectionConsumed: false,
      },
    }, later);
    world.history.push({
      id: 'history_story_early_wound',
      turn: 5,
      year: 2,
      season: '夏',
      category: '军事',
      kind: '人物负伤',
      title: `${person.name}负伤退营`,
      summary: `${person.name}退出行营休养。`,
      importance: 4,
      actorIds: [person.id],
      polityIds: [person.polityId],
      regionIds: [early.payload.targetRegionId],
      causes: [],
      evidence: [],
      stateDeltas: [],
      sourceFactIds: [woundId],
      situationIds: [],
    });

    const story = projectPersonStoryArc(world, person);
    const wound = story.find((beat) => beat.sourceFactIds.includes(woundId));

    expect(wound?.dateLabel).toContain('第 2 年');
    expect(wound?.sourceFactIds).toEqual(['fact_story_early_battle', woundId]);
    expect(wound?.sourceFactIds).not.toContain(later.id);
    expect(wound?.primaryFactId).toBe(woundId);
    expect(wound?.primaryEventId).toBe('history_story_early_wound');
    expect(wound?.summary).toContain('休养至第8季');
  });
});
