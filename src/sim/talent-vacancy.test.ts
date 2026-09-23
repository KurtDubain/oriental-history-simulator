import { describe, expect, it } from 'vitest';
import { createWorld, maintainArmies } from './engine';
import { createTurnContext } from './turn-context-state';
import { processV03Maritime } from './v03-ocean';
import { syncOfficeAppointments, promoteBackgroundPerson, ensureV02PolitySystems } from './v02';
import { lineageLegitimacy, continuesRulingLine } from './lineage';
import type { HistoryEvent, WorldState } from './types';

function vacancy() {
  const world = createWorld('真实职位候补夹具', 'contest-v01');
  const polity = world.polities.find(p => world.fleets.some(f => f.polityId === p.id))!;
  const fleet = world.fleets.find(f => f.polityId === polity.id)!;
  const region = world.regions.find(r => r.id === fleet.homePortRegionId)!;
  const governorRegion = world.regions.find(r => r.controllerId === polity.id && r.id !== polity.capitalRegionId)!;
  const ruler = world.characters.find(c => c.id === polity.rulerId)!;
  const candidate = world.characters.find(c => c.polityId === polity.id && c.id !== ruler.id && c.id !== fleet.commanderId)!;
  world.characters = world.characters.filter(c => c.polityId !== polity.id || c.id === ruler.id);
  world.armies = []; world.fleets = []; world.wars = []; world.shipbuildingProjects = []; world.navalOperations = [];
  for (const c of world.characters) c.governedRegionId = c.commandingArmyId = c.commandingFleetId = null;
  for (const p of world.polities) p.treasury = 0; // No unrelated army creation or paid ship projects.
  const stub = world.backgroundPeople.find(s => s.regionId === governorRegion.id)!;
  world.backgroundPeople = [stub]; stub.birthTurn = world.turn - 30 * 4;
  Object.assign(candidate, {age:30,health:100,alive:true,deathTurn:null,role:'廷臣',governedRegionId:null,commandingArmyId:null,commandingFleetId:null});
  for (const f of world.personalForces) f.formationId = null;
  return {world,polity,region,governorRegion,ruler,candidate,stub,fleet};
}
function land(world: WorldState) {
  const context = createTurnContext(world); maintainArmies(world, context);
  syncOfficeAppointments(world, world.turn, context); return context;
}
function sea(world: WorldState) {
  const context=createTurnContext(world);
  const emit=(input:Partial<HistoryEvent>)=>{
    const e={actorIds:[],polityIds:[],regionIds:[],sourceFactIds:[],stateDeltas:[],...input,
      id:`event_${++world.counters.event}`,turn:world.turn,year:world.year,season:world.season} as HistoryEvent;
    context.events.push(e);return e;
  };
  processV03Maritime(world,context,emit,()=>{throw Error('unexpected landing');});
  syncOfficeAppointments(world,world.turn,context);return context;
}

describe('existing necessary vacancies can draw on registered local society',()=>{
  it.each(['ready','no-person','young','population','lost-port','eliminated','cancelled'])(
    'recommissions preserved hulls only when their actual port can supply a crew and officer (%s)', mode => {
      const {world,polity,region,stub}=vacancy();
      stub.regionId=region.id; region.population=100000;region.food=100000;
      const batch={id:'shipproject_99999',polityId:polity.id,portRegionId:region.id,targetFleetId:null,
        warships:18,transports:13,patrolShips:7,timberCommitted:0,ironCommitted:0,treasurySpent:0,
        progress:100,startedTurn:0,completedTurn:null,status:'建造中' as '建造中'|'取消'};
      world.shipbuildingProjects=[batch];
      if(mode==='no-person')world.backgroundPeople=[];
      if(mode==='young')stub.birthTurn=world.turn-15*4;
      if(mode==='population')region.population=299;
      if(mode==='lost-port')region.controllerId=world.polities.find(p=>p.id!==polity.id)!.id;
      if(mode==='eliminated')polity.alive=false;
      if(mode==='cancelled')batch.status='取消';
      const c=sea(world),fleet=world.fleets.find(f=>f.polityId===polity.id);
      if(mode!=='ready') {expect(fleet).toBeUndefined();expect(stub.promotedCharacterId).toBeNull();return;}
      expect(fleet).toBeDefined();expect(fleet!.commanderId).toBe(stub.promotedCharacterId);
      expect([fleet!.warships,fleet!.transports,fleet!.patrolShips]).toEqual([18,13,7]);
      expect(fleet!.sailors).toBe(2629);expect(region.population).toBe(100000-2629);
      expect(fleet!.food).toBe(5258);expect(region.food).toBe(100000-5258);
      expect(world.characters.find(p=>p.id===fleet!.commanderId)?.commandingFleetId).toBe(fleet!.id);
      expect(c.facts.some(f=>f.kind==='appointment_started'&&f.payload.holderId===fleet!.commanderId&&f.payload.officeKind==='水师提督')).toBe(true);
      expect(c.events.find(e=>e.kind==='shipbuilding_completed')?.actorIds).toContain(fleet!.commanderId);
      expect(c.events.filter(e=>e.kind==='background_promoted')).toHaveLength(1);
      expect(batch.status).toBe('完成');
      const count=world.characters.length,population=region.population;
      const retry=sea(world);world.turn++;const next=sea(world);
      expect(world.characters).toHaveLength(count);expect(world.fleets.filter(f=>f.polityId===polity.id)).toHaveLength(1);
      expect(region.population).toBe(population);
      expect([...retry.events,...next.events].filter(e=>e.kind==='shipbuilding_completed')).toHaveLength(0);
    });

  it('does not convert a shared surname into royal membership, but retains explicit and parental membership',()=>{
    const {world,polity,region,ruler,stub}=vacancy();stub.regionId=region.id;stub.familyName=ruler.familyName;
    const original=new Map(world.characters.map(p=>[p.id,p.familyId]));
    const person=promoteBackgroundPerson(world,polity,'fleet-commander',undefined,region.id)!;
    expect(person).not.toBeNull();expect(person.parentIds).toEqual([]);
    expect(person.familyId).not.toBe(ruler.familyId);expect(lineageLegitimacy(person,ruler,polity.rulingFamilyId)).toBe(0);
    expect(continuesRulingLine(world,polity,person)).toBe(false);
    for(const [id,family] of original)expect(world.characters.find(p=>p.id===id)?.familyId).toBe(family);
    const count=world.families.length;ensureV02PolitySystems(world,polity.id);ensureV02PolitySystems(world,polity.id);
    expect(world.families).toHaveLength(count);
    // Missing membership with real parentage is different from a matching surname.
    person.familyId='';person.parentIds=[ruler.id];ensureV02PolitySystems(world,polity.id);
    expect(person.familyId).toBe(ruler.familyId);expect(lineageLegitimacy(person,ruler,polity.rulingFamilyId)).toBe(100);
  });
  it('uses an eligible named governor before promoting anyone',()=>{
    const {world,polity,candidate,stub}=vacancy();world.characters.push(candidate);
    // Restrict genuine responsibilities to one non-capital vacancy, not every other polity.
    polity.controlledRegionIds=[polity.capitalRegionId!,stub.regionId];
    land(world);
    expect(candidate.governedRegionId).toBe(stub.regionId);expect(stub.promotedCharacterId).toBeNull();
  });
  it('promotes a local registered adult once, with entry and appointment evidence',()=>{
    const {world,stub,polity}=vacancy(); const context=land(world);
    const person=world.characters.find(c=>c.id===stub.promotedCharacterId)!;
    expect(person).toBeDefined();expect(person.sourceStubId).toBe(stub.id);
    expect(person.governedRegionId).toBe(stub.regionId);expect(person.polityId).toBe(polity.id);
    expect(person.age).toBe(30);expect(person.parentIds).toEqual([]);expect(person.merit).toBe(0);
    const entry=context.events.find(e=>e.kind==='background_promoted'&&e.actorIds.includes(person.id))!;
    expect(entry).toBeDefined();expect(person.biography.some(b=>b.eventId===entry.id)).toBe(true);
    expect(context.facts.some(f=>f.kind==='appointment_started'&&f.payload.holderId===person.id&&f.payload.officeKind==='地方长官')).toBe(true);
    const count=world.characters.length; land(world); world.turn++;land(world);
    expect(world.characters).toHaveLength(count);
  });
  it.each(['young','old','foreign','occupied-region','no-background'])('leaves a real vacancy when background is %s',kind=>{
    const {world,stub,polity}=vacancy();
    if(kind==='young')stub.birthTurn=world.turn-15*4;
    if(kind==='old')stub.birthTurn=world.turn-76*4;
    if(kind==='foreign')stub.polityId=world.polities.find(p=>p.id!==polity.id)!.id;
    if(kind==='occupied-region')world.regions.find(r=>r.id===stub.regionId)!.controllerId=world.polities.find(p=>p.id!==polity.id)!.id;
    if(kind==='no-background')world.backgroundPeople=[];
    // syncOfficeAppointments then synchronizes a stub's allegiance to its actual locality;
    // this assertion concerns the entry before that separate, legitimate ownership update.
    const count=world.characters.length;land(world);
    expect(world.characters).toHaveLength(count);
  });
  it('does not draw people for capital-only administration or an already filled locality',()=>{
    const {world,polity,stub,candidate}=vacancy();
    polity.controlledRegionIds=[polity.capitalRegionId!,stub.regionId];
    candidate.governedRegionId=stub.regionId;world.characters.push(candidate);land(world);
    expect(stub.promotedCharacterId).toBeNull();
    candidate.governedRegionId=null;polity.controlledRegionIds=[polity.capitalRegionId!];land(world);
    expect(stub.promotedCharacterId).toBeNull();
  });
  it.each(['minor','foreign','naval-deputy','land-member','untrusted-former-ruler'])('does not bypass named eligibility (%s)',kind=>{
    const {world,polity,candidate,stub,fleet}=vacancy();world.characters.push(candidate);
    polity.controlledRegionIds=[polity.capitalRegionId!,stub.regionId];
    if(kind==='minor')candidate.age=15;
    if(kind==='foreign')candidate.polityId=world.polities.find(p=>p.id!==polity.id)!.id;
    if(kind==='naval-deputy'){world.fleets=[fleet];fleet.deputyCommanderId=candidate.id;}
    if(kind==='land-member')world.personalForces.find(f=>f.ownerId===candidate.id)!.formationId='active-field-formation';
    if(kind==='untrusted-former-ruler') {const old=world.polities.find(p=>p.id!==polity.id)!;old.alive=false;old.rulerId=candidate.id;old.eliminatedTurn=world.turn;candidate.loyalty=31;world.relationships=[];}
    land(world);expect(candidate.governedRegionId).not.toBe(stub.regionId);expect(stub.promotedCharacterId).not.toBeNull();
  });
  it('permits one local selection per polity/quarter across repeated repair and naval entry',()=>{
    const {world,polity,stub,fleet,region}=vacancy();
    const other=world.regions.find(r=>r.controllerId===polity.id&&![polity.capitalRegionId,stub.regionId].includes(r.id))!;
    world.backgroundPeople.push({...stub,id:'bg:second',regionId:other.id});
    land(world);land(world);world.fleets=[fleet];
    world.backgroundPeople.push({...stub,id:'bg:naval',regionId:region.id,promotedCharacterId:null,promotedTurn:null});sea(world);
    expect(world.backgroundPeople.filter(s=>s.promotedCharacterId)).toHaveLength(1);
    const holders=world.offices.filter(o=>o.active&&['地方长官','水师提督','水师副将','军团主帅','军团副将'].includes(o.kind)).map(o=>o.holderId);
    expect(new Set(holders).size).toBe(holders.length);
  });
  it('keeps existing naval officers first, and uses local background only for a real docked command vacancy',()=>{
    const {world,stub,candidate,fleet,region}=vacancy();
    world.fleets=[fleet];fleet.portRegionId=region.id;fleet.deputyCommanderId=candidate.id;
    world.characters.push(candidate);stub.regionId=region.id;sea(world);
    expect(fleet.commanderId).toBe(candidate.id);expect(stub.promotedCharacterId).toBeNull();
    candidate.alive=false;candidate.deathTurn=world.turn;
    fleet.portRegionId=region.id;fleet.seaZoneId=null;
    const ships=fleet.warships+fleet.transports+fleet.patrolShips;const c=sea(world);
    expect(world.fleets.find(f=>f.id===fleet.id)).toBeDefined();
    expect(fleet.commanderId).toBe(stub.promotedCharacterId);expect(stub.promotedCharacterId).not.toBeNull();
    expect(fleet.warships+fleet.transports+fleet.patrolShips).toBe(ships);
    expect(c.events.some(e=>e.kind==='background_promoted'&&e.actorIds.includes(fleet.commanderId))).toBe(true);
    expect(c.facts.some(f=>f.kind==='appointment_started'&&f.payload.officeKind==='水师提督'&&f.payload.holderId===fleet.commanderId)).toBe(true);
  });
  it('does not teleport a background officer to a fleet at sea; only returned hulls may recommission in port',()=>{
    const {world,stub,fleet,region}=vacancy();stub.regionId=region.id;world.fleets=[fleet];
    fleet.portRegionId=null;fleet.deputyCommanderId=null;
    const c=sea(world);
    expect(world.fleets.some(f=>f.id===fleet.id)).toBe(false);
    const disband=c.events.find(e=>e.kind==='fleet_disbanded')!;
    const completion=c.events.find(e=>e.kind==='shipbuilding_completed')!;
    expect(disband.regionIds).toContain(region.id);expect(completion.regionIds).toContain(region.id);
    expect(c.events.indexOf(disband)).toBeLessThan(c.events.indexOf(completion));
    const rebuilt=world.fleets.find(f=>f.commanderId===stub.promotedCharacterId)!;
    expect(rebuilt.portRegionId).toBe(region.id);expect(rebuilt.seaZoneId).toBeNull();
    expect(rebuilt.deputyCommanderId).toBeNull();
  });
});
