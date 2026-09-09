import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { advanceWorldDetailed, deserializeWorld, readWorldFacts, serializeWorld, validateWorld } from '../src/sim';
import { encodeWorldFile } from '../src/persistence/storage';
const dir = process.argv[2]; mkdirSync(dir, { recursive: true });
const raw = JSON.parse(readFileSync('/Users/mutu/Desktop/personal/res/history-war/output/playwright/ordinary-v1296/world-T400.json', 'utf8'));
let world = deserializeWorld(JSON.stringify(raw.world ?? raw));
const id = world.polities.find(p => p.name === '沧海盟')!.id, rows: Array<Record<string, any>> = [];
for (let i = 0; i <= 40; i++) {
  const polity = world.polities.find(p => p.id === id)!;
  rows.push({ turn: world.turn, hash: world.hash, polity: { ...polity },
    armies: world.armies.filter(a => a.polityId === id),
    characters: world.characters.filter(c => c.polityId === id && c.alive).map(c => ({ id: c.id, age: c.age,
      health: c.health, role: c.role, loyalty: c.loyalty, governedRegionId: c.governedRegionId, commandingArmyId: c.commandingArmyId })),
    facts: world.facts.filter(f => f.turn === world.lastTurn?.turn && f.polityIds.includes(id)),
    report: world.lastTurn, violations: i % 10 ? [] : validateWorld(world),
  });
  if (i < 40) { const next = advanceWorldDetailed(world); world = next.world; rows.at(-1)!.timings = next.timings; }
}
writeFileSync(`${dir}/trace.json`, JSON.stringify(rows));
try { writeFileSync(`${dir}/world-T440.portable.json`, encodeWorldFile(serializeWorld(world))); }
catch (error) {
  writeFileSync(`${dir}/export-failure.json`, JSON.stringify({ error: String(error), turn: world.turn,
    serializedBytes: Buffer.byteLength(serializeWorld(world)), hash: world.hash }));
  process.exitCode = 1;
}
console.log(JSON.stringify(rows.map(r => ({ turn: r.turn, authority: r.polity.authority, regions: r.polity.controlledRegionIds.length, armies: r.armies.length, errors: r.violations.length }))));
