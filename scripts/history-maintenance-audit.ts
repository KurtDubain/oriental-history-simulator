import { mkdirSync, writeFileSync } from 'node:fs';
import { createWorld, advanceWorld, readWorldFacts, serializeWorld, deserializeWorld, validateWorld } from '../src/sim';
import { encodeWorldFile } from '../src/persistence/storage';

const cases = [
  ['private-v03', '雁门残雪-壬午'], ['private-v03', '江山一梦-九月行旅'],
  ['private-v03', '鹤汀照野-维护留验甲'], ['contest-v01', '鹤汀照野-维护留验乙'],
  ['private-v03', '苔城听雨-维护留验丙'], ['contest-v01', '苔城听雨-维护留验丁'],
  ['private-v03', '沙浦落星-维护留验戊'], ['contest-v01', '沙浦落星-维护留验己'],
  ['private-v03', '松关渡月-维护留验庚'], ['contest-v01', '松关渡月-维护留验辛'],
] as const;
const dir = process.argv[2] ?? 'output/history-maintenance-v1.29.5/after';
mkdirSync(dir, { recursive: true });
for (const [index, [profile, seed]] of cases.entries()) {
  if (process.argv[3] && index % 2 !== Number(process.argv[3])) continue;
  let world = createWorld(seed, profile), maximumTerritory = 0;
  const checkpoints = [], elderlyCommand = [], errors = [];
  for (let turn = 1; turn <= 400; turn++) {
    world = advanceWorld(world);
    maximumTerritory = Math.max(maximumTerritory, ...world.polities.map(p => p.controlledRegionIds.length));
    for (const army of world.armies) {
      const p = world.characters.find(c => c.id === army.commanderId);
      if (p && p.age >= 65) elderlyCommand.push({ turn, id: p.id, age: p.age, health: p.health, army: army.id });
    }
    if (turn % 40) continue;
    const problems = validateWorld(world);
    if (problems.length) errors.push({ turn, problems });
    checkpoints.push({ turn, hash: world.hash });
    console.log(JSON.stringify({ dir, index, turn, errors: problems.length }));
  }
  const facts = readWorldFacts(world), battles = facts.filter(f => f.kind === 'battle');
  const wounds = facts.filter(f => f.kind === 'character_wounded');
  const exposures = battles.flatMap(b => [b.payload.attacker, ...b.payload.defenders].flatMap((side, i) =>
    (side.participants ?? []).map(p => ({ ...p, battleId: b.id, turn: b.turn,
      won: i === 0 ? b.payload.attackerWon : !b.payload.attackerWon,
      age: Math.floor((b.turn - (world.characters.find(c => c.id === p.characterId)?.birthTurn ?? b.turn)) / 4),
    }))));
  const closed = world.wars.filter(w => !w.active && w.endedTurn !== null);
  const result = { seed, profile, hash: world.hash, errors, checkpoints, maximumTerritory,
    finalTerritory: world.polities.filter(p => p.alive).map(p => ({ name: p.name, count: p.controlledRegionIds.length })),
    wars: world.wars.length, endedWars: closed.length,
    emptyEndedWars: closed.filter(w => !battles.some(b => b.payload.warId === w.id)).length,
    activeWithoutBattle: world.wars.filter(w => w.active && !battles.some(b => b.payload.warId === w.id)).length,
    battles: battles.length, attackerWins: battles.filter(b => b.payload.attackerWon).length,
    wounds, deaths: facts.filter(f => f.kind === 'character_death' && f.payload.cause === 'battle'),
    elderlyCommand, exposures,
    recoveryViolations: wounds.flatMap(w => exposures.filter(e => e.characterId === w.payload.characterId
      && e.turn > w.turn && e.turn < (w.payload.recoveryUntilTurn ?? w.turn + 2)).map(e => ({ wound: w.id, battle: e.battleId }))),
    replay: advanceWorld(deserializeWorld(serializeWorld(world))).hash === advanceWorld(world).hash,
  };
  writeFileSync(`${dir}/${index}.json`, JSON.stringify(result));
  writeFileSync(`${dir}/${index}.portable.json`, encodeWorldFile(serializeWorld(world)));
}
