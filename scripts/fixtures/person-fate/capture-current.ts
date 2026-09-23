// Manual recapture only: npm exec vite-node scripts/fixtures/person-fate/capture-current.ts
// Frozen evidence from the already audited talent world, not a runtime death quota.
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {createWorld, advanceWorld, serializeWorld, deserializeWorld, validateWorld, readWorldFacts, readWorldHistory} from '../../../src/sim';
import {encodeWorldFile} from '../../../src/persistence/storage';
import {toPersonInspector} from '../../../src/view/person-dossier-adapter';
import {projectQuarterPulse} from '../../../src/view/quarter-pulse-stories';
import {projectSituationWorkbench} from '../../../src/view/situation-detail';

const root=new URL('./current/',import.meta.url);
mkdirSync(root,{recursive:true});
const manifest:unknown[]=[];
let world=createWorld('秋灯照海-收卷乙酉','contest-v01');
function capture(key:string, factId:string, eventId?:string){
 assert.deepEqual(validateWorld(world),[]);
 const fact=readWorldFacts(world).find(f=>f.id===factId);
 assert(fact?.kind==='character_wounded'||fact?.kind==='character_death');
 const person=world.characters.find(c=>c.id===fact.payload.characterId)!;
 const body=serializeWorld(world);
 assert.equal(serializeWorld(deserializeWorld(body)),body);
 const portable=JSON.parse(encodeWorldFile(body));
 portable.savedAt='2026-09-16T00:00:00.000Z'; // envelope only, reproducible capture
 const buffer=Buffer.from(JSON.stringify(portable));
 const cases=projectSituationWorkbench(world,null,false);
 const readingCase=eventId?[...cases.open,...cases.recentResolved].find(entry=>entry.type==='war_progress'&&projectSituationWorkbench(world,entry.id).selected?.evidence.some(f=>f.historyEventIds.length)):undefined;
 const caseEventId=readingCase?projectSituationWorkbench(world,readingCase.id).selected!.evidence.find(f=>f.historyEventIds.length)!.historyEventIds[0]:undefined;
 if(eventId)assert(readingCase&&readWorldHistory(world).some(e=>e.id===caseEventId),'media evidence requires an accessible, real case event');
 writeFileSync(new URL(`${key}.json.gz.base64`,root),gzipSync(buffer,{level:9}).toString('base64')+'\n');
 manifest.push({key,personId:person.id,factId,...(eventId?{eventId,caseId:readingCase!.id,caseEventId}:{}),seed:world.seed,map:'contest-v01',
  turn:world.turn,hash:world.hash,name:person.name,sha256:createHash('sha256').update(buffer).digest('hex')});
}
for(let t=1;t<=14;t++){
 world=advanceWorld(world);
 if(t===7){
  const person=world.characters.find(c=>c.id==='c_067')!;
  const view=toPersonInspector(world,person);
  assert.match(view.militaryForce!.status,/休养/);assert.match(view.militaryForce!.formation,/退离/);
  capture('wounded','fact_0000161');
 }
 if(t===14){
  const person=world.characters.find(c=>c.id==='c_067')!;
  const view=toPersonInspector(world,person);
  assert(person.alive);assert.match(view.militaryForce!.formation,/^(自领|随)/);
  assert.doesNotMatch(view.militaryForce!.status,/休养/);
  capture('returned','fact_0000161');
 }
}
world=createWorld('枫渡余灯-丙申','contest-v01');
for(let t=1;t<=210;t++)world=advanceWorld(world);
const death=readWorldFacts(world).find(f=>f.id==='fact_0003652');
assert(death?.kind==='character_death'&&death.payload.cause==='battle');
const event=readWorldHistory(world).find(e=>e.kind==='character_battle_death'&&e.sourceFactIds.includes(death.id));
assert(event);
assert(projectQuarterPulse(world).stories.some(s=>s.eventId===event.id),'capture must cover the real death-card UI');
capture('deceased',death.id,event.id);
writeFileSync(new URL('manifest.json',root),JSON.stringify(manifest,null,2)+'\n');
console.log(manifest);
