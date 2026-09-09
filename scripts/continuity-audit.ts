import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { advanceWorld, createWorld, deserializeWorld, serializeWorld, readWorldFacts, readWorldHistory, validateWorld } from '../src/sim';
import { encodeWorldFile } from '../src/persistence/storage';
import { personHistoryEvidence, projectPersonStoryArc, personShortBiography } from '../src/view/person-story-arc';
import { deriveObserverLeadProjection } from '../src/view/observer-leads';
const dir = process.argv[2], frozen = process.argv[3];
mkdirSync(dir, { recursive: true });
const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v));
const input = frozen ? JSON.parse(readFileSync(frozen, 'utf8')) : null;
let world = input ? deserializeWorld(serializeWorld(input.world ?? input)) : createWorld(process.env.OHS_AUDIT_SEED ?? '寒江照铁-戌时', 'private-v03');
const points: unknown[] = [], early: unknown[] = [];
const measure = () => {
  const body = serializeWorld(world), evidence = personHistoryEvidence(world);
  const people = ['宋弘廉', '高德钧', '独孤德义', '崔德济', '宇文崇礼'].map(name => world.characters.find(p => p.name === name)).filter(p => !!p);
  const facts = readWorldFacts(world), history = readWorldHistory(world);
  const record = { turn: world.turn, hash: world.hash, bytes: Buffer.byteLength(body), factDigest: world.factDigest, historyDigest: world.historyDigest,
    fields: Object.fromEntries(Object.entries(world).map(([k,v]) => [k, bytes(v)])),
    characterFields: Object.fromEntries(['biography','biographyDigest','memories'].map(k => [k, world.characters.reduce((n,p) => n + bytes((p as unknown as Record<string, unknown>)[k] ?? null),0)])),
    archiveFields: Object.fromEntries(Object.entries(world.archiveSystem).map(([k,v])=>[k,bytes(v)])),
    facts: facts.length, history: history.length, wars: world.wars.length, battles: facts.filter(f=>f.kind==='battle').length,
    errors: validateWorld(world),
    people: people.map(p => ({ id:p!.id,name:p!.name,beats:projectPersonStoryArc(world,p!,evidence),short:personShortBiography(world,p!,projectPersonStoryArc(world,p!,evidence)) })) };
  points.push(record); writeFileSync(`${dir}/T${world.turn}.json`,JSON.stringify(record,null,2));
  writeFileSync(`${dir}/T${world.turn}.world.json`,body);
  try { const portable=encodeWorldFile(body); const restored=deserializeWorld(JSON.stringify(JSON.parse(portable).world));
    writeFileSync(`${dir}/T${world.turn}.portable.json`,portable);
    writeFileSync(`${dir}/T${world.turn}.restore.json`,JSON.stringify({hash:restored.hash,sameHash:restored.hash===world.hash,next:advanceWorld(restored).hash,direct:advanceWorld(world).hash}));
  } catch(error) { writeFileSync(`${dir}/T${world.turn}.export-error.json`,JSON.stringify({error:String(error)})); }
  console.log(JSON.stringify({turn:world.turn,bytes:record.bytes,hash:world.hash,errors:record.errors.length}));
};
if(frozen) measure();
else for(let t=1;t<=Number(process.env.OHS_AUDIT_TURNS ?? 440);t++) {
  world=advanceWorld(world);
  if(t<=12) early.push({turn:t,hash:world.hash,leads:deriveObserverLeadProjection(world).leads, facts:world.facts.filter(f=>f.turn===world.lastTurn!.turn && ['appointment_started','appointment_ended','situation_milestone'].includes(f.kind))});
  if([12,40,120,240,400,440].includes(t)) measure();
}
writeFileSync(`${dir}/growth.json`,JSON.stringify(points,null,2));
writeFileSync(`${dir}/early.json`,JSON.stringify(early,null,2));
