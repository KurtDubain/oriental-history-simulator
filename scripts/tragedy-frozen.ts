import { toPersonInspector } from '../src/view/person-dossier-adapter';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { deserializeWorld, serializeWorld, readWorldFacts, readWorldHistory } from '../src/sim';
import { projectPersonStoryArc } from '../src/view/person-story-arc';
import { projectRosterDirectory } from '../src/view/roster-adapter';

const dir = process.argv[2]; mkdirSync(dir, { recursive: true });
for (const [label, file, names] of [
  ['xiao', 'output/history-maintenance-v1.29.5/after/2.portable.json', ['萧德宁']],
  ['stranger', 'output/playwright/ordinary-v1296/world-T400.json', ['拓跋云岫', '陆季安', '萧绍成']],
] as const) {
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  const world = deserializeWorld(JSON.stringify(saved.world ?? saved)), before = serializeWorld(world);
  const facts = readWorldFacts(world), history = readWorldHistory(world);
  const begin = performance.now(), collection = projectRosterDirectory(world).people;
  const coldMs = performance.now() - begin;
  const result = { hash: world.hash, coldMs, people: names.map(name => {
    const p = world.characters.find(p => p.name === name)!;
    const story = projectPersonStoryArc(world, p);
    return { name, id: p.id, polity: p.polityId, story, biography: toPersonInspector(world, p).summary,
      reason: collection.items.find(i => i.id === p.id)?.reason,
      offices: world.offices.filter(o => o.holderId === p.id),
      facts: facts.filter(f => f.actorIds.includes(p.id)),
      history: history.filter(e => e.actorIds.includes(p.id) || e.stateDeltas.some(d => d.after === p.id)),
    };
  }), unchanged: serializeWorld(world) === before };
  writeFileSync(`${dir}/${label}.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ label, coldMs, unchanged: result.unchanged, people: result.people.map(p => ({ name: p.name, biography: p.biography })) }));
}
