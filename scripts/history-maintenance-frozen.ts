import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { deserializeWorld, readWorldFacts, serializeWorld } from '../src/sim';
import { projectPersonStoryArc } from '../src/view/person-story-arc';
import { projectRosterDirectory } from '../src/view/roster-adapter';
import { toPersonExperienceRecords, toPersonInspector } from '../src/view/person-dossier-adapter';
import { projectHistoricalScenes } from '../src/view/historical-scenes';

const dir = process.argv[2] ?? 'output/history-maintenance-v1.29.5/frozen';
mkdirSync(dir, { recursive: true });
for (const [label, file, names] of [
  ['yanmen', 'output/deep-player-v1.29.5/world-T400.portable.json', ['韩维晟', '王德义', '谢绍成']],
  ['jiangshan', 'output/playwright/ordinary-v1295/world-T400.json', ['韩青衡', '韩德直', '陆维钧', '宇文彦成']],
] as const) {
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  const world = deserializeWorld(JSON.stringify(saved.world ?? saved));
  const before = serializeWorld(world), facts = readWorldFacts(world);
  const began = performance.now(), roster = projectRosterDirectory(world).people.items, firstMs = performance.now() - began;
  const warm = performance.now(); projectRosterDirectory(world); const warmMs = performance.now() - warm;
  const people = names.map(name => {
    const p = world.characters.find(c => c.name === name)!;
    const began = performance.now(), story = projectPersonStoryArc(world, p);
    return { name, id: p.id, alive: p.alive, elapsedMs: performance.now() - began,
      reason: roster.find(r => r.id === p.id)?.reason,
      biography: toPersonInspector(world, p).summary, story,
      chronological: toPersonExperienceRecords(world, p),
    };
  });
  const scenes = [20, 21, 23, 279, 319].map(turn => ({ turn,
    scenes: projectHistoricalScenes(world, facts.filter(f => f.turn === turn && ['battle', 'territory_control_changed'].includes(f.kind)), 100),
  }));
  const result = { label, hash: world.hash, firstMs, warmMs, unchanged: serializeWorld(world) === before, people, scenes };
  writeFileSync(`${dir}/${label}.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ label, firstMs, warmMs, unchanged: result.unchanged, people: people.map(p => ({ name: p.name, biography: p.biography, reason: p.reason })) }));
}
