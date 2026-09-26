import { describe, expect, it } from 'vitest';
import { advanceWorld, computeWorldHash, createWorld, deserializeWorld, serializeWorld, stableHash } from './index';
import { processV02Society, processV02PoliticalCommitments, processCharacterDeathConsequences, releaseRulerSubordination, syncOfficeAppointments } from './v02';
import { emitSimulationFact } from './facts';
import { validateCommitmentState } from './validation/commitments';
import { createTurnContext } from './turn-context-state';
import { woundRecoveryQuarters } from './military/battle-readiness';
import type { HistoryEvent } from './types';

describe('ruler identity and bounded recovery', () => {
  it.each(['alive','promisor','promisee','both','death-later','ended'])('settles institutional promises, not posthumous personal credit (%s)', mode=>{
    const world=createWorld('机构与个人承诺');
    const left=world.factions[0],right=world.factions.find(f=>f.polityId===left.polityId&&f.id!==left.id)!;
    left.alliedFactionIds=[right.id];right.alliedFactionIds=[left.id];
    const context=createTurnContext(world);
    const formation=emitSimulationFact(world,context,{kind:'faction_relation_changed',category:'政治',importance:2,
      actorIds:[left.leaderId,right.leaderId],polityIds:[left.polityId],regionIds:[],causes:[],stateDeltas:[],sourceFactIds:[],
      payload:{polityId:left.polityId,leftFactionId:left.id,rightFactionId:right.id,leftLeaderId:left.leaderId,rightLeaderId:right.leaderId,relation:'alliance',action:'formed',reasonCode:'shared_interest'}});
    if(formation.kind!=='faction_relation_changed')throw Error('expected alliance Fact');
    const creation={...world.history[0],id:'promise-source',sourceFactIds:[formation.id]};world.history.push(creation);
    const promise={id:'commit_test',kind:'政治联盟' as const,promisorId:left.leaderId,promiseeId:right.leaderId,polityIds:[left.polityId],terms:'互相支持',madeTurn:0,dueTurn:3,status:'生效' as const,resolvedTurn:null,eventId:creation.id,resolutionEventId:null,trustStake:18};
    world.commitments=[promise];world.turn=3;world.season='冬';
    const signerIds=mode==='both'?[left.leaderId,right.leaderId]:mode==='promisor'?[left.leaderId]:mode==='promisee'?[right.leaderId]:[];
    for(const id of signerIds){const p=world.characters.find(p=>p.id===id)!;p.alive=false;p.deathTurn=3;}
    if(mode==='ended'){
      emitSimulationFact(world,createTurnContext(world),{...formation,payload:{...formation.payload,action:'ended',reasonCode:'faction_core_exhausted'},sourceFactIds:[formation.id]});
      left.alliedFactionIds=[];right.alliedFactionIds=[];
    }
    const relations=JSON.stringify(world.relationships),ctx=createTurnContext(world);
    const emit:Parameters<typeof processV02PoliticalCommitments>[2]=input=>{
      const e:HistoryEvent={...creation,...input,id:`event_test_${ctx.events.length}`,turn:world.turn,actorIds:input.actorIds??[],sourceFactIds:input.sourceFactIds??[]};
      world.history.push(e);ctx.events.push(e);return e;
    };
    processV02PoliticalCommitments(world,ctx,emit);
    const event=ctx.events[0];expect(event).toBeDefined();
    expect(promise.status).toBe(mode==='ended'?'失效':'履约');
    expect(event.sourceFactIds).not.toHaveLength(0);
    if(signerIds.length||mode==='ended')expect(JSON.stringify(world.relationships)).toBe(relations);
    if(signerIds.length){expect(event.actorIds).toEqual([]);expect(event.summary).toContain(left.name);expect(event.summary).toContain(right.name);}
    if(mode==='death-later'){const p=world.characters.find(p=>p.id===left.leaderId)!;p.alive=false;p.deathTurn=3;}
    expect(validateCommitmentState(world)).toEqual([]);
    if(!signerIds.length&&mode!=='ended'){
      for(const r of world.relationships)r.memories=r.memories.filter(m=>m.eventId!==event.id);
      expect(validateCommitmentState(world).some(v=>v.code==='commitment.memory')).toBe(true);
    }
    const settled=JSON.stringify(world);processV02PoliticalCommitments(world,ctx,emit);expect(JSON.stringify(world)).toBe(settled);
  });
  it.each(['promisor','promisee'])('invalidates impossible personal duty after %s dies, preserving its origin',side=>{
    const world=createWorld('身后军令'),[a,b]=world.characters;
    const promise={id:'commit_test',kind:'军令' as const,promisorId:a.id,promiseeId:b.id,polityIds:[a.polityId],terms:'履行副将职责',madeTurn:0,dueTurn:16,status:'生效' as const,resolvedTurn:null,eventId:world.history[0].id,resolutionEventId:null,trustStake:18};
    world.commitments=[promise];const person=side==='promisor'?a:b;person.alive=false;person.deathTurn=0;
    const context=createTurnContext(world),relations=JSON.stringify(world.relationships);
    const death=emitSimulationFact(world,context,{kind:'character_death',category:'军事',importance:3,actorIds:[person.id],polityIds:[person.polityId],regionIds:[],causes:[],stateDeltas:[],sourceFactIds:[],payload:{characterId:person.id,age:person.age,health:person.health,role:person.role,diseaseId:null,cause:'natural'}});
    if(death.kind!=='character_death')throw Error('expected death Fact');
    processCharacterDeathConsequences(world,context,input=>{const e={...world.history[0],...input,id:`end_${context.events.length}`,actorIds:input.actorIds??[],sourceFactIds:input.sourceFactIds??[]};world.history.push(e);context.events.push(e);return e;},[death]);
    expect(promise.status).toBe('失效');expect(JSON.stringify(world.relationships)).toBe(relations);
    expect(world.history.find(e=>e.id===promise.resolutionEventId)?.sourceFactIds).toContain(death.id);
    expect(promise.eventId).toBe(world.history[0].id);
  });
  it.each(['living', 'died-before', 'died-earlier-this-turn', 'dies-later-this-turn', 'dies-next-turn'])('checks treaty memory against its actual settlement actors (%s)', mode => {
    const deceased = mode.startsWith('died-');
    const world = createWorld('国家履约与签约人');
    world.turn = 3; world.season = '冬';
    const [left,right] = world.characters;
    if (deceased) { left.alive = false; left.deathTurn = mode === 'died-before' ? 2 : 3; }
    const commitment = { id:'commit_test', kind:'外交盟约' as const, promisorId:left.id, promiseeId:right.id,
      polityIds:world.polities.slice(0,2).map(p=>p.id), terms:'互不进攻', madeTurn:0, dueTurn:3,
      status:'生效' as const, resolvedTurn:null, eventId:world.history[0].id, resolutionEventId:null, trustStake:10 };
    world.commitments = [commitment];
    const context = createTurnContext(world);
    processV02Society(world,context,input=>{
      const event: HistoryEvent = { ...input,id:`event_${++world.counters.event}`,turn:world.turn,year:world.year,season:world.season,
        actorIds:input.actorIds??[],polityIds:input.polityIds??[],regionIds:input.regionIds??[],evidence:input.evidence??[],
        stateDeltas:input.stateDeltas??[],sourceFactIds:input.sourceFactIds??[],situationIds:input.situationIds??[] };
      world.history.push(event);context.events.push(event);return event;
    });
    const event = world.history.find(e=>e.id===commitment.resolutionEventId)!;
    const memories = world.relationships.flatMap(r=>r.memories).filter(m=>m.eventId===event.id);
    expect(commitment.status).toBe('履约');
    expect(event.stateDeltas).toContainEqual(expect.objectContaining({entityId:commitment.id,after:'履约'}));
    expect(memories.length).toBe(deceased ? 0 : 1);
    if (deceased) {
      expect(event.actorIds).toEqual([]);
      expect(event.summary).toContain('国家');
      expect(event.summary).not.toContain(left.id);
    } else {
      expect(event.actorIds).toEqual([left.id,right.id]);
      expect(event.summary).toContain(left.name);
    }
    expect(validateCommitmentState(world)).toEqual([]);
    if (!deceased) {
      // A later death, even in the same quarter, does not erase an earlier personal action.
      if (mode.startsWith('dies-')) {
        left.alive = false; left.deathTurn = mode === 'dies-next-turn' ? 4 : 3;
        world.turn = left.deathTurn + 1;
      }
      expect(validateCommitmentState(world)).toEqual([]);
      for(const r of world.relationships)r.memories=r.memories.filter(m=>m.eventId!==event.id);
      expect(validateCommitmentState(world).some(v=>v.code==='commitment.memory')).toBe(true);
    } else {
      // Death alone cannot excuse a settlement that actually names personal actors.
      event.actorIds = [left.id, right.id];
      expect(validateCommitmentState(world).some(v=>v.code==='commitment.memory')).toBe(true);
    }
  });
  it('ends an inherited subordinate command without taking the commander’s force or calling it betrayal', () => {
    const world = createWorld('君位与旧军令');
    const army = world.armies.find(a => a.deputyCommanderId)!;
    const ruler = world.characters.find(p => p.id === army.deputyCommanderId)!;
    const polity = world.polities.find(p => p.id === army.polityId)!;
    polity.rulerId = ruler.id;
    const force = world.personalForces.find(f => f.ownerId === ruler.id)!;
    // A legacy save can also retain the same person's naval deputy appointment.
    const fleet = world.fleets[0];
    fleet.deputyCommanderId = ruler.id;
    const sailors = fleet.sailors, admiral = fleet.commanderId;
    const militaryPopulation = world.personalForces.reduce((sum, f) => sum + f.soldiers, 0);
    const people = world.regions.map(r => r.population), location = ruler.locationRegionId;
    const allegiance = structuredClone(world.armies.filter(a => a.id !== army.id).map(a => a.allegiance));
    const relations = JSON.stringify(world.relationships);
    const commitment = { id: 'commitment_test', kind: '军令' as const, promisorId: ruler.id, promiseeId: army.commanderId,
      polityIds: [polity.id], terms: '随军', madeTurn: 0, dueTurn: 16, status: '生效' as const,
      resolvedTurn: null, eventId: world.history[0].id, resolutionEventId: null, trustStake: 10 };
    world.commitments.push(commitment);
    world.counters.commitment++;
    const context = createTurnContext(world);
    const emit: Parameters<typeof releaseRulerSubordination>[2] = input => {
      const event: HistoryEvent = { ...input, id: `event_${++world.counters.event}`, turn: world.turn, year: world.year, season: world.season,
        actorIds: input.actorIds ?? [], polityIds: input.polityIds ?? [], regionIds: input.regionIds ?? [],
        evidence: input.evidence ?? [], stateDeltas: input.stateDeltas ?? [], sourceFactIds: input.sourceFactIds ?? [], situationIds: input.situationIds ?? [] };
      world.history.push(event); context.events.push(event); world.historyDigest = stableHash([world.historyDigest, event]);
      return event;
    };
    const historicalCount = world.history.length;
    releaseRulerSubordination(world, context, emit);
    expect(force.formationId).toBeNull();
    expect(army.participantIds).not.toContain(ruler.id);
    expect(army.deputyCommanderId).toBeNull();
    expect(fleet.deputyCommanderId).toBeNull();
    expect(fleet.sailors).toBe(sailors);
    expect(fleet.commanderId).toBe(admiral);
    expect(commitment.status).toBe('失效');
    expect(commitment.resolutionEventId).toBe(context.events[0].id);
    expect(context.events[0].stateDeltas.some(d => d.entityId === army.id && d.field === 'deputyCommanderId')).toBe(true);
    expect(world.personalForces.reduce((sum, f) => sum + f.soldiers, 0)).toBe(militaryPopulation);
    expect(world.regions.map(r => r.population)).toEqual(people);
    expect(ruler.locationRegionId).toBe(location);
    expect(world.armies.filter(a => a.id !== army.id).map(a => a.allegiance)).toEqual(allegiance);
    expect(JSON.stringify(world.relationships)).toBe(relations);
    releaseRulerSubordination(world, context, emit);
    expect(world.history).toHaveLength(historicalCount + 1);
    syncOfficeAppointments(world, world.turn);
    world.hash = computeWorldHash(world);
    // The helper ran inside T0; the complete T1 settlement owns the next report.
    const next = advanceWorld(advanceWorld(world));
    const restored = deserializeWorld(serializeWorld(next));
    expect(advanceWorld(restored).hash).toBe(advanceWorld(next).hash);
    expect(next.armies.some(a => a.deputyCommanderId === ruler.id)).toBe(false);
    expect(next.commitments.some(c => c.promisorId === ruler.id && c.kind === '军令' && c.status === '生效')).toBe(false);
  });

  it('retains a ruler’s independent command and allows a former ruler of a dead state to serve', () => {
    const world = createWorld('君主亲征边界');
    const army = world.armies.find(a => a.deputyCommanderId)!;
    const polity = world.polities.find(p => p.id === army.polityId)!;
    polity.rulerId = army.commanderId;
    const former = world.polities.find(p => p.id !== polity.id)!;
    former.rulerId = army.deputyCommanderId!; former.alive = false;
    const before = JSON.stringify([world.armies, world.personalForces]);
    releaseRulerSubordination(world, createTurnContext(world), () => { throw new Error('no incompatible identity'); });
    expect(JSON.stringify([world.armies, world.personalForces])).toBe(before);
  });

  it('makes recovery continuously harder with age and severity, never an age-based prohibition', () => {
    for (let age = 16; age < 100; age++) {
      const duration = woundRecoveryQuarters(age, .5, 60, .4);
      const next = woundRecoveryQuarters(age + 1, .5, 60, .4);
      expect(next).toBeGreaterThanOrEqual(duration);
      expect(next - duration).toBeLessThanOrEqual(1);
      expect(duration).toBeLessThan(16);
    }
    expect(woundRecoveryQuarters(85, .8, 35, .2)).toBeGreaterThan(woundRecoveryQuarters(30, .8, 35, .2));
    expect(woundRecoveryQuarters(85, .2, 90, .2)).toBeLessThan(woundRecoveryQuarters(85, .8, 35, .2));
  });
});
