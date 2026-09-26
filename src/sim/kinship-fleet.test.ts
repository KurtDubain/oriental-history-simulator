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
  it.each([30,100])('detaches a real expansion from an empty disbanding fleet at its own safe port (%s%%)', progress=>{
    const {world,fleet,commander,deputy,polity}=navy();world.backgroundPeople=[];
    settleCharacterDeathState(world,commander.id,world.turn);settleCharacterDeathState(world,deputy.id,world.turn);
    fleet.warships=fleet.transports=fleet.patrolShips=0;
    const batch={id:'shipproject_99999',polityId:polity.id,portRegionId:fleet.portRegionId!,targetFleetId:fleet.id,
      warships:4,transports:2,patrolShips:0,timberCommitted:370,ironCommitted:164,treasurySpent:770,
      progress,startedTurn:0,completedTurn:null,status:'建造中' as const};world.shipbuildingProjects=[batch];
    const population=totalWorldPopulation(world),first=sea(world);
    expect(batch).toMatchObject({status:'建造中',targetFleetId:null,warships:4,transports:2});
    expect(first.maritime.shipsLost).toBe(0);expect(totalWorldPopulation(world)).toBe(population);
    expect(world.shipbuildingProjects).toHaveLength(1);
    world.turn++;const next=sea(world);
    expect(next.events.filter(e=>e.kind==='fleet_disbanded'||e.kind==='shipbuilding_cancelled')).toHaveLength(0);
    expect([batch.timberCommitted,batch.ironCommitted,batch.treasurySpent]).toEqual([370,164,770]);
  });
  it.each(['other-port','lost-port'] as const)('does not move a paid batch across a disbanding fleet’s port/authority boundary (%s)', mode=>{
    const {world,fleet,commander,deputy,polity}=navy();world.backgroundPeople=[];
    settleCharacterDeathState(world,commander.id,world.turn);settleCharacterDeathState(world,deputy.id,world.turn);
    fleet.warships=fleet.transports=fleet.patrolShips=0;
    const port=world.regions.find(r=>r.id===fleet.portRegionId)!;
    const other=world.regions.find(r=>r.port&&r.controllerId===polity.id&&r.id!==port.id)!;
    const batch={id:'shipproject_99999',polityId:polity.id,portRegionId:mode==='other-port'?other.id:port.id,targetFleetId:fleet.id,
      warships:4,transports:2,patrolShips:0,timberCommitted:370,ironCommitted:164,treasurySpent:770,
      progress:100,startedTurn:0,completedTurn:null,status:'建造中' as const};world.shipbuildingProjects=[batch];
    if(mode==='lost-port')port.controllerId=world.polities.find(p=>p.id!==polity.id)!.id;
    const first=sea(world);
    expect(batch.status).toBe('取消');expect(first.maritime.shipsLost).toBe(6);
    expect(first.events.filter(e=>e.kind==='shipbuilding_cancelled')).toHaveLength(1);
    expect(world.fleets).toHaveLength(0);
    world.turn++;const next=sea(world);
    expect(next.maritime.shipsLost).toBe(0);expect(next.events.filter(e=>e.kind==='shipbuilding_cancelled')).toHaveLength(0);
    expect([batch.timberCommitted,batch.ironCommitted,batch.treasurySpent]).toEqual([370,164,770]);
  });
  it('allows one paid local production behind completed hulls, counts waiting stock against demand, and commissions each batch once',()=>{
    const {world,fleet,polity,commander,deputy}=navy();
    const port=world.regions.find(r=>r.id===fleet.portRegionId)!;
    world.fleets=[];commander.commandingFleetId=null;
    world.ports=world.ports.filter(p=>p.regionId===port.id);world.backgroundPeople=[];
    commander.age=deputy.age=12;polity.treasury=100000;port.food=100000;port.population=100000;
    port.goods.木材=port.goods.铁器=100000;
    const original={id:'shipproject_99999',polityId:polity.id,portRegionId:port.id,targetFleetId:null,
      warships:2,transports:1,patrolShips:0,timberCommitted:0,ironCommitted:0,treasurySpent:0,
      progress:100,startedTurn:0,completedTurn:null,status:'建造中' as const};world.shipbuildingProjects=[original];
    const population=totalWorldPopulation(world),events:HistoryEvent[]=[];
    events.push(...sea(world).events);
    expect(world.shipbuildingProjects).toHaveLength(2);
    expect(world.shipbuildingProjects[1]).toMatchObject({progress:0,portRegionId:port.id,targetFleetId:null});
    for(let i=0;i<30;i++){world.turn++;events.push(...sea(world).events);}
    const count=world.shipbuildingProjects.length,cost=polity.treasury;
    const hulls=world.shipbuildingProjects.reduce((n,p)=>n+p.warships+p.transports+p.patrolShips,0);
    const demand=10+world.ports[0].level*5;
    expect(hulls).toBeLessThan(demand+6);expect(world.fleets).toHaveLength(0);
    world.turn++;sea(world);expect(world.shipbuildingProjects).toHaveLength(count);expect(polity.treasury).toBe(cost);
    commander.health=100;commander.age=30;commander.loyalty=90;
    const originalPayments=world.shipbuildingProjects.map(p=>[p.treasurySpent,p.timberCommitted,p.ironCommitted]);
    world.turn++;const commissioned=sea(world);events.push(...commissioned.events);
    world.turn++;const absorbed=sea(world);events.push(...absorbed.events);
    expect(world.shipbuildingProjects.every(p=>p.status==='完成')).toBe(true);
    expect(world.fleets.reduce((n,f)=>n+f.warships+f.transports+f.patrolShips,0)).toBe(hulls);
    expect(totalWorldPopulation(world)).toBe(population);
    expect(world.shipbuildingProjects.map(p=>[p.treasurySpent,p.timberCommitted,p.ironCommitted])).toEqual(originalPayments);
    expect(cost-polity.treasury).toBe(commissioned.wealth.militaryPayments+absorbed.wealth.militaryPayments);
    expect(events.filter(e=>e.kind==='shipbuilding_completed')).toHaveLength(count);
    world.turn++;expect(sea(world).events.filter(e=>e.kind==='shipbuilding_completed')).toHaveLength(0);
  });
  it('returns empty formations’ real sailors and food without making an active zero-hull batch',()=>{
    const {world,fleet,commander,deputy}=navy();
    world.backgroundPeople=[];
    settleCharacterDeathState(world,commander.id,world.turn);
    settleCharacterDeathState(world,deputy.id,world.turn);
    fleet.warships=0;fleet.transports=0;fleet.patrolShips=0;
    const population=totalWorldPopulation(world),port=world.regions.find(r=>r.id===fleet.portRegionId)!;
    const food=port.food+fleet.food;
    const result=sea(world);
    expect(world.fleets).toHaveLength(0);
    expect(world.shipbuildingProjects.filter(p=>p.status==='建造中')).toHaveLength(0);
    expect(totalWorldPopulation(world)).toBe(population);
    expect(port.food).toBe(food);
    expect(result.maritime.shipsLost).toBe(0);
    expect(result.events.some(e=>e.kind==='fleet_disbanded')).toBe(true);
  });
  it('closes an existing empty batch once and releases the real paid construction queue',()=>{
    const {world,fleet,polity}=navy();
    const batch={id:'shipproject_99999',polityId:polity.id,portRegionId:fleet.portRegionId!,targetFleetId:null,
      warships:0,transports:0,patrolShips:0,timberCommitted:0,ironCommitted:0,treasurySpent:0,
      progress:100,startedTurn:0,completedTurn:null,status:'建造中' as const};
    world.shipbuildingProjects=[batch];
    polity.treasury=100000;
    for(const r of world.regions.filter(r=>r.controllerId===polity.id)){r.goods.木材=10000;r.goods.铁器=10000;}
    const population=totalWorldPopulation(world),ships=fleet.warships+fleet.transports+fleet.patrolShips;
    const first=sea(world);
    expect(batch.status).toBe('取消');expect(batch.completedTurn).toBe(world.turn);
    expect(first.events.some(e=>e.kind==='shipbuilding_cancelled'&&e.summary.includes('无舰船'))).toBe(true);
    expect(world.shipbuildingProjects.some(p=>p.id!==batch.id&&p.status==='建造中')).toBe(true);
    expect(polity.treasury).toBeLessThan(100000);
    expect(totalWorldPopulation(world)).toBe(population);
    expect(fleet.warships+fleet.transports+fleet.patrolShips).toBe(ships);
    world.turn++;
    expect(sea(world).events.filter(e=>e.kind==='shipbuilding_cancelled')).toHaveLength(0);
  });
  it.each(['home', 'other-port', 'other-polity', 'at-sea', 'cancelled'] as const)(
    'commissions a small orphan batch only into a lawful local fleet (%s)', mode => {
      const { world, fleet, polity } = navy();
      const port = world.regions.find(r => r.id === fleet.portRegionId)!;
      port.food = 100000;
      const project = { id: 'shipproject_99999', polityId: polity.id, portRegionId: port.id,
        targetFleetId: null, warships: 1, transports: 2, patrolShips: 2,
        timberCommitted: 220, ironCommitted: 82, treasurySpent: 450,
        progress: 100, startedTurn: world.turn, completedTurn: null,
        status: mode === 'cancelled' ? '取消' as const : '建造中' as const };
      world.shipbuildingProjects.push(project);
      if (mode === 'other-port') project.portRegionId = world.regions.find(r => r.port && r.controllerId === polity.id && r.id !== port.id)!.id;
      if (mode === 'other-polity') project.polityId = world.polities.find(p => p.id !== polity.id)!.id;
      if (mode === 'at-sea') { fleet.portRegionId = null; fleet.seaZoneId = world.seaZones[0].id; }
      const before = [fleet.warships, fleet.transports, fleet.patrolShips];
      const population = totalWorldPopulation(world), stocks = JSON.stringify(port.goods);
      const result = sea(world);
      const completions = result.events.filter(e => e.kind === 'shipbuilding_completed');
      expect(completions).toHaveLength(mode === 'home' ? 1 : 0);
      expect(totalWorldPopulation(world)).toBe(population);
      expect(JSON.stringify(port.goods)).toBe(stocks);
      expect(polity.treasury).toBe(0);
      if (mode === 'home') {
        expect(project).toMatchObject({ status: '完成', targetFleetId: fleet.id, completedTurn: world.turn });
        expect([fleet.warships, fleet.transports, fleet.patrolShips]).toEqual(before.map((n, i) => n + [1, 2, 2][i]));
        expect(completions[0].stateDeltas.filter(d => d.entityId === fleet.id).map(d => d.delta)).toEqual([1,2,2]);
        world.turn++;
        expect(sea(world).events.filter(e => e.kind === 'shipbuilding_completed')).toHaveLength(0);
        expect([fleet.warships, fleet.transports, fleet.patrolShips]).toEqual(before.map((n, i) => n + [1,2,2][i]));
      } else expect(project.status).not.toBe('完成');
    });

  it('waits for real personnel to restore the original fleet, then absorbs the small batch once', () => {
    const { world, fleet, commander, deputy, polity } = navy();
    world.backgroundPeople = [];
    const port = world.regions.find(r => r.id === fleet.portRegionId)!;
    port.food = 100000;
    const former = world.polities.find(p => p.id !== polity.id)!;
    former.alive = false; former.rulerId = deputy.id; former.eliminatedTurn = world.turn;
    deputy.loyalty = 31; world.relationships = [];
    world.shipbuildingProjects.push({ id: 'shipproject_99999', polityId: polity.id, portRegionId: port.id,
      targetFleetId: fleet.id, warships: 1, transports: 2, patrolShips: 2, timberCommitted: 220,
      ironCommitted: 82, treasurySpent: 450, progress: 100, startedTurn: world.turn, completedTurn: null, status: '建造中' });
    const batch = world.shipbuildingProjects[0];
    const ships = [fleet.warships, fleet.transports, fleet.patrolShips];
    const population = totalWorldPopulation(world);
    settleCharacterDeathState(world, commander.id, world.turn);
    sea(world); world.turn++; sea(world);
    expect(world.fleets).toHaveLength(0);
    expect(batch).toMatchObject({ status: '建造中', progress: 100, targetFleetId: null });
    expect(totalWorldPopulation(world)).toBe(population);
    deputy.loyalty = 90; world.turn = 8;
    sea(world); world.turn++;
    const restored = world.fleets[0];
    expect(restored).toBeDefined();
    expect(sea(world).events.filter(e => e.kind === 'shipbuilding_completed')).toHaveLength(1);
    expect(batch).toMatchObject({ status: '完成', targetFleetId: restored.id });
    expect([restored.warships, restored.transports, restored.patrolShips]).toEqual(ships.map((n, i) => n + [1,2,2][i]));
    expect(totalWorldPopulation(world)).toBe(population);
    world.turn++;
    expect(sea(world).events.some(e => e.kind === 'shipbuilding_completed')).toBe(false);
    expect(world.shipbuildingProjects.every(p => p.status === '完成')).toBe(true);
    // With actual stocks/payment available the formerly blocked national queue can resume.
    polity.treasury = 100000;
    for (const r of world.regions.filter(r => r.controllerId === polity.id)) { r.goods.木材 = 10000; r.goods.铁器 = 10000; }
    world.turn++; sea(world);
    expect(world.shipbuildingProjects.some(p => p.status === '建造中')).toBe(true);
    expect(polity.treasury).toBeLessThan(100000);
  });

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
    world.backgroundPeople=[]; // No eligible named OR registered background commander.
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
    world.backgroundPeople=[]; // Exercise genuine exhaustion, not the local replacement path.
    const former=world.polities.find(p=>p.id!==fleet.polityId)!;former.alive=false;former.rulerId=deputy.id;former.eliminatedTurn=world.turn;deputy.loyalty=31;world.relationships=[];
    settleCharacterDeathState(world,commander.id,world.turn); sea(world);
    const p=world.shipbuildingProjects.find(p=>p.status==='建造中')!;
    world.regions.find(r=>r.id===p.portRegionId)!.controllerId=former.id;
    const c=sea(world);
    expect(p.status).toBe('取消');expect(c.maritime.shipsLost).toBe(p.warships+p.transports+p.patrolShips);
    expect(c.events.find(e=>e.kind==='shipbuilding_cancelled')?.summary).toContain('非战斗退出');
  });
});
