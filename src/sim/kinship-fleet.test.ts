import { describe, expect, it } from 'vitest';
import { createWorld, maintainArmies, resolveVacantRulers } from './engine';
import { processV02Society, processV02Diplomacy, establishRulingFamilyBranch, syncOfficeAppointments } from './v02';
import { processV03Maritime } from './v03-ocean';
import { createTurnContext, totalWorldPopulation } from './turn-context-state';
import { settleCharacterDeathState } from './character-death';
import { validateWorld } from './invariants';
import { keyedChance } from './random';
import type { HistoryEvent, WorldState } from './types';

function context(world: WorldState) {
  const c = createTurnContext(world);
  const emit = (input: Partial<HistoryEvent>) => {
    const e = { actorIds: [], polityIds: [], regionIds: [], sourceFactIds: [], situationIds: [], evidence: [], stateDeltas: [],
      ...input, id: `event_${++world.counters.event}`, turn: world.turn, year: world.year, season: world.season } as HistoryEvent;
    c.events.push(e); return e;
  };
  return { c, emit };
}

function couple(diplomatic = false) {
  const world = createWorld('谱系资格夹具');
  const a = world.characters[1], b = world.characters.find(p => diplomatic ? p.polityId !== a.polityId : p.polityId === a.polityId && p.familyId !== a.familyId)!;
  for (const p of world.characters) { p.spouseIds = []; p.politicalClass = '宗室'; }
  a.sex = '女'; b.sex = '男';
  for (const p of [a,b]) { p.age = 26; p.birthTurn = -104; p.alive = true; p.deathTurn = null; p.parentIds = []; p.influence = 90; p.loyalty = 90; p.politicalClass = diplomatic ? '宗室' : '官僚'; }
  if (diplomatic) {
    for (const p of world.characters.filter(p => p.id !== a.id && p.id !== b.id)) p.politicalClass = '官僚';
    for (const d of world.diplomacy) { d.status = '中立'; d.marriageIds = []; d.trust = 0; }
    const d = world.diplomacy.find(d => [d.polityAId,d.polityBId].includes(a.polityId) && [d.polityAId,d.polityBId].includes(b.polityId))!;
    d.trust = 60; d.grievance = 0;
  }
  world.turn = 3; world.year = 1; world.season = '冬';
  return { world, a, b };
}

describe('real genealogy and biological births', () => {
  it.each(['siblings', 'father', 'mother', 'parent', 'grandparent'])('blocks %s across different family branches at both marriage entries', kind => {
    for (const diplomatic of [false,true]) {
      const { world,a,b } = couple(diplomatic);
      const [p,q] = world.characters.filter(c => c.id !== a.id && c.id !== b.id);
      if (kind === 'siblings') { a.parentIds = [p.id,q.id]; b.parentIds = [p.id,q.id]; }
      if (kind === 'father') { a.parentIds = [p.id]; b.parentIds = [p.id,q.id]; }
      if (kind === 'mother') { a.parentIds = [q.id]; b.parentIds = [p.id,q.id]; }
      if (kind === 'parent') a.parentIds = [b.id];
      if (kind === 'grandparent') { a.parentIds = [p.id]; p.parentIds = [b.id]; }
      expect(a.familyId).not.toBe(b.familyId);
      const {c,emit} = context(world);
      (diplomatic ? processV02Diplomacy : processV02Society)(world,c,emit);
      expect(a.spouseIds).not.toContain(b.id);
      expect(c.facts.some(f => f.kind === 'marriage' && f.actorIds.includes(a.id) && f.actorIds.includes(b.id))).toBe(false);
    }
  });
  it.each([false,true])('allows unrelated same-surname marriage (diplomatic=%s)', diplomatic => {
    const {world,a,b} = couple(diplomatic); b.familyName = a.familyName;
    const {c,emit} = context(world);
    (diplomatic ? processV02Diplomacy : processV02Society)(world,c,emit);
    expect(a.spouseIds).toContain(b.id);
    expect(c.facts.some(f => f.kind === 'marriage' && f.actorIds.includes(a.id) && f.actorIds.includes(b.id))).toBe(true);
  });
  it.each(['valid','same-sex','dead','young','older-mother','related'])('does not equate marriage with biological birth (%s)', kind => {
    const {world,a,b} = couple(); a.spouseIds = [b.id]; b.spouseIds = [a.id];
    const ordered=world.characters.filter(p=>[a.id,b.id].includes(p.id));
    for (let t=3;t<403;t+=4) if (keyedChance(world.seed,.22,t,'birth',ordered[0].id,ordered[1].id)) { world.turn=t; break; }
    if (kind === 'same-sex') b.sex = a.sex;
    if (kind === 'dead') { b.alive=false; b.deathTurn=world.turn-1; }
    if (kind === 'young') a.age=17;
    if (kind === 'older-mother') a.age=45;
    if (kind === 'related') { a.parentIds=['shared']; b.parentIds=['shared']; }
    const {c,emit} = context(world); processV02Society(world,c,emit);
    const births = world.characters.filter(p => p.parentIds.includes(a.id) && p.parentIds.includes(b.id));
    expect(births.length > 0).toBe(kind === 'valid');
    expect(a.spouseIds).toContain(b.id); // No deletion or invented alternative parentage.
  });
  it('full validation rejects hidden kin marriage and incompatible biological parents', () => {
    const {world,a,b} = couple(); a.spouseIds=[b.id]; b.spouseIds=[a.id];
    const p=world.characters.find(p => p.id!==a.id && p.id!==b.id)!;
    a.parentIds=[p.id]; b.parentIds=[p.id];
    expect(validateWorld(world).some(v => v.code==='character.spouse-kin')).toBe(true);
    a.parentIds=[]; b.parentIds=[]; b.sex=a.sex;
    const child=world.characters.find(p => ![a.id,b.id].includes(p.id))!;
    child.parentIds=[a.id,b.id]; child.birthTurn=world.turn;
    expect(validateWorld(world).some(v => v.code==='character.birth-parents')).toBe(true);
  });
});

describe('ruling lineage is distinct from branch identity', () => {
  it.each(['child','same-surname','foreign-branch'])('uses one classification for branch, title and legitimacy (%s)', kind => {
    const world=createWorld('承统支系夹具'); const polity=world.polities[0];
    const old=world.characters.find(p=>p.id===polity.rulerId)!;
    const heir=world.characters.find(p=>p.polityId===polity.id && p.id!==old.id)!;
    const source=old.familyId; heir.familyId=source; heir.parentIds=[old.id];
    establishRulingFamilyBranch(world,polity,old);
    const ruling=polity.rulingFamilyId;
    if (kind==='same-surname') { heir.familyId=world.families.find(f=>f.id!==source && f.id!==ruling)!.id; heir.familyName=old.familyName; heir.parentIds=[]; }
    if (kind==='foreign-branch') {
      const foreign=world.polities[1]; const foreignRuler=world.characters.find(p=>p.id===foreign.rulerId)!;
      foreignRuler.familyId=source; establishRulingFamilyBranch(world,foreign,foreignRuler); heir.familyId=foreign.rulingFamilyId!;
    }
    for (const p of world.characters.filter(p=>p.polityId===polity.id && ![old.id,heir.id].includes(p.id))) {p.alive=false;p.deathTurn=0;}
    heir.age=30; heir.alive=true; heir.governance=60; polity.legitimacy=70;
    settleCharacterDeathState(world,old.id,world.turn); const families=world.families.length;
    const {c}=context(world); resolveVacantRulers(world,c);
    expect(polity.rulerId).toBe(heir.id);
    expect(polity.legitimacy).toBe(kind==='child'?68:56);
    expect(world.families.length-families).toBe(kind==='child'?0:1);
    const e=c.events.find(e=>e.kind==='succession' && e.polityIds.includes(polity.id))!;
    expect(e.summary.includes('改奉')).toBe(kind!=='child');
    expect(e.stateDeltas.find(d=>d.field==='legitimacy')?.delta).toBe(kind==='child'?-2:-14);
  });
});

function navy() {
  const world=createWorld('水师交接与资产夹具'); const fleet=world.fleets[0];
  const polity=world.polities.find(p=>p.id===fleet.polityId)!;
  const commander=world.characters.find(p=>p.id===fleet.commanderId)!;
  const deputy=world.characters.find(p=>p.polityId===polity.id && ![commander.id,polity.rulerId].includes(p.id))!;
  world.armies=[]; world.fleets=[fleet]; world.shipbuildingProjects=[]; world.wars=[]; world.navalOperations=[];
  for (const p of world.characters) {p.governedRegionId=null;p.commandingArmyId=null;p.commandingFleetId=null;}
  commander.commandingFleetId=fleet.id;
  world.characters=world.characters.filter(p=>p.polityId!==polity.id || [polity.rulerId,commander.id,deputy.id].includes(p.id));
  deputy.age=30;deputy.health=100;deputy.loyalty=90;deputy.role='将领';
  fleet.deputyCommanderId=deputy.id;
  for(const p of world.polities)p.treasury=0;
  return {world,fleet,polity,commander,deputy};
}
function sea(world:WorldState) {const {c,emit}=context(world); processV03Maritime(world,c,emit,()=>{throw Error('unexpected landing');}); syncOfficeAppointments(world,world.turn,c); return c;}
describe('naval deputy occupation and handover',()=>{
  it('does not take an active naval deputy to fill a local office',()=>{
    const {world,fleet,deputy}=navy(); maintainArmies(world,createTurnContext(world));
    expect(deputy.governedRegionId).toBeNull(); expect(fleet.deputyCommanderId).toBe(deputy.id);
  });
  it('lets the eligible onboard deputy compete and records one command without losing vessels',()=>{
    const {world,fleet,commander,deputy}=navy(); syncOfficeAppointments(world,world.turn);
    const ships=[fleet.warships,fleet.transports,fleet.patrolShips];
    settleCharacterDeathState(world,commander.id,world.turn); const c=sea(world);
    expect(world.fleets).toHaveLength(1); expect(fleet.commanderId).toBe(deputy.id);expect(fleet.deputyCommanderId).not.toBe(deputy.id);
    expect([fleet.warships,fleet.transports,fleet.patrolShips]).toEqual(ships);
    expect(world.offices.filter(o=>o.active&&o.holderId===deputy.id&&o.fleetId===fleet.id).map(o=>o.kind)).toEqual(['水师提督']);
    expect(c.facts.some(f=>f.kind==='appointment_ended'&&f.payload.officeKind==='水师副将'&&f.payload.holderId===deputy.id)).toBe(true);
    expect(c.facts.some(f=>f.kind==='appointment_started'&&f.payload.officeKind==='水师提督'&&f.payload.holderId===deputy.id)).toBe(true);
  });
  it.each(['untrusted','other-fleet'])('does not invent authorization or take another fleet deputy (%s)',kind=>{
    const {world,fleet,commander,deputy}=navy();
    if(kind==='untrusted'){const former=world.polities.find(p=>p.id!==fleet.polityId)!;former.alive=false;former.rulerId=deputy.id;former.eliminatedTurn=world.turn;deputy.loyalty=31;world.relationships=[];}
    else {world.fleets.push({...fleet,id:'fleet_9999',commanderId:world.polities.find(p=>p.id===fleet.polityId)!.rulerId});fleet.deputyCommanderId=null;}
    settleCharacterDeathState(world,commander.id,world.turn); sea(world);
    expect(world.fleets.find(f=>f.id===fleet.id)?.commanderId).not.toBe(deputy.id);
  });
  it('keeps the unstaffed hulls as a completed waiting batch, with no duplicate cost or unexplained loss',()=>{
    const {world,fleet,commander,deputy}=navy();
    const ships=fleet.warships+fleet.transports+fleet.patrolShips;
    const former=world.polities.find(p=>p.id!==fleet.polityId)!;former.alive=false;former.rulerId=deputy.id;former.eliminatedTurn=world.turn;deputy.loyalty=31;world.relationships=[];
    settleCharacterDeathState(world,commander.id,world.turn);
    const population=totalWorldPopulation(world); const c=sea(world);
    expect(world.fleets).toHaveLength(0);
    const p=world.shipbuildingProjects.find(p=>p.status==='建造中'&&p.progress===100)!;
    expect(p).toBeDefined();expect(p.warships+p.transports+p.patrolShips).toBe(ships);
    expect([p.treasurySpent,p.timberCommitted,p.ironCommitted]).toEqual([0,0,0]);
    expect(totalWorldPopulation(world)).toBe(population);expect(c.maritime.shipsLost).toBe(0);
    expect(c.events.some(e=>e.kind==='fleet_disbanded'&&e.stateDeltas.some(d=>d.entityId===fleet.id))).toBe(true);
    world.turn++;
    sea(world);
    expect(world.shipbuildingProjects.filter(p=>p.progress===100&&p.status==='建造中')).toHaveLength(1);
    // Once genuinely qualified, re-entry consumes this batch once, not new construction inputs.
    former.eliminatedTurn=world.turn-8; deputy.loyalty=90;
    world.regions.find(r=>r.id===p.portRegionId)!.food=100000;
    sea(world); expect(p.status).toBe('完成');
    const total=()=>world.fleets.reduce((n,f)=>n+f.warships+f.transports+f.patrolShips,0);
    expect(total()).toBe(ships); world.turn++; sea(world); expect(total()).toBe(ships);
    expect([p.treasurySpent,p.timberCommitted,p.ironCommitted]).toEqual([0,0,0]);
  });
  it('records completed unstaffed hulls lost with the port, instead of silently cancelling construction',()=>{
    const {world,fleet,commander,deputy}=navy();
    const former=world.polities.find(p=>p.id!==fleet.polityId)!;former.alive=false;former.rulerId=deputy.id;former.eliminatedTurn=world.turn;deputy.loyalty=31;world.relationships=[];
    settleCharacterDeathState(world,commander.id,world.turn); sea(world);
    const p=world.shipbuildingProjects.find(p=>p.status==='建造中')!;
    world.regions.find(r=>r.id===p.portRegionId)!.controllerId=former.id;
    const c=sea(world);
    expect(p.status).toBe('取消');expect(c.maritime.shipsLost).toBe(p.warships+p.transports+p.patrolShips);
    expect(c.events.find(e=>e.kind==='shipbuilding_cancelled')?.summary).toContain('非战斗退出');
  });
});
