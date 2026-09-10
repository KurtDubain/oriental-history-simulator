import { toPersonInspector } from '../src/view/person-dossier-adapter';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { advanceWorld, createWorld, deserializeWorld, serializeWorld, readWorldFacts, readWorldHistory } from '../src/sim';
import { encodeWorldFile } from '../src/persistence/storage';
import { projectRosterDirectory, projectRosterCollection } from '../src/view/roster-adapter';
import { createRosterDiscoveryState } from '../src/view/roster-discovery';
import { projectPersonStoryArc } from '../src/view/person-story-arc';

const dir = process.argv[2] ?? 'output/history-discovery-v1.29.5/after';
mkdirSync(dir, { recursive: true });
for (let i = 0; i < 8; i++) {
  const file = `${dir}/${i}.portable.json`;
  const world = deserializeWorld(JSON.stringify(JSON.parse(readFileSync(file, 'utf8')).world));
  const before = serializeWorld(world);
  const roster = projectRosterDirectory(world).people.items;
  const state = { ...createRosterDiscoveryState(), quickView: 'deceased' };
  const deceased = projectRosterCollection(world, 'people', state).items;
  const full = { ...world, facts: readWorldFacts(world), history: readWorldHistory(world) };
  const people = world.characters.map(p => {
    const story = projectPersonStoryArc(full, p);
    return { id: p.id, name: p.name, polity: p.polityId, alive: p.alive, reason: roster.find(r => r.id === p.id)?.reason,
      deceasedRank: deceased.findIndex(r => r.id === p.id) + 1, story, biography: toPersonInspector(world, p).summary };
  });
  if (serializeWorld(world) !== before) throw new Error('Observation mutated save');
  writeFileSync(`${dir}/${i}.reading.json`, JSON.stringify({ hash: world.hash, people }));
}

// A live sequence, not a reconstruction of past character attributes from their final state.
let world = createWorld('秋灯照故人-复验', 'contest-v01');
const stages = [];
for (let t = 1; t <= 400; t++) {
  world = advanceWorld(world);
  if (t % 40) continue;
  const top = projectRosterCollection(world, 'people').items.slice(0, 5);
  stages.push({ turn: t, hash: world.hash, top: top.map(r => {
    const p = world.characters.find(p => p.id === r.id)!;
    const story = projectPersonStoryArc(world, p);
    return { name: p.name, id: p.id, reason: r.reason, story, biography: personShortBiography(world, p, story) };
  }) });
  if (t === 80 || t === 240) writeFileSync(`${dir}/stage-T${t}.portable.json`, encodeWorldFile(serializeWorld(world)));
}
writeFileSync(`${dir}/discovery-stages.json`, JSON.stringify(stages));
