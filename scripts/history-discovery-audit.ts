import { mkdirSync, writeFileSync } from 'node:fs';
import { createWorld, advanceWorld, readWorldFacts, readWorldHistory, serializeWorld, deserializeWorld, validateWorld } from '../src/sim';
import { encodeWorldFile } from '../src/persistence/storage';
import { projectPersonStoryArc } from '../src/view/person-story-arc';
import { peopleRoster } from '../src/view/roster-adapter';

const dir = process.argv[2] ?? 'output/history-discovery-v1.29.5/after';
const cases = [
  ['private-v03', '霜河孤雁-白露'], ['contest-v01', '秋灯照故人-复验'],
  ['private-v03', '铁衣照雪-行旅'], ['contest-v01', '百年归舟-复验'],
  ['private-v03', '潮声入塞-辛未'], ['contest-v01', '长风换世-新验'],
  ['private-v03', '石桥春信-留验'], ['contest-v01', '远浦秋声-留验'],
] as const;
mkdirSync(dir, { recursive: true });
for (const [index, [profile, seed]] of cases.entries()) {
  if (process.argv[3] && index % 2 !== Number(process.argv[3])) continue;
  let world = createWorld(seed, profile);
  const checkpoints = [], errors = [];
  for (let turn = 1; turn <= 400; turn++) {
    world = advanceWorld(world);
    if (turn % 40) continue;
    const problems = validateWorld(world);
    if (problems.length) errors.push({ turn, problems });
    checkpoints.push({ turn, hash: world.hash, countries: world.polities.filter(p => p.alive).map(p => ({
      id: p.id, authority: p.authority, regions: p.controlledRegionIds.length,
    })) });
    console.log(JSON.stringify({ dir, index, turn, hash: world.hash }));
  }
  const facts = readWorldFacts(world), history = readWorldHistory(world);
  const battles = facts.filter(f => f.kind === 'battle');
  const exposures = battles.flatMap(b => [b.payload.attacker, ...b.payload.defenders].flatMap((s, i) =>
    (s.participants ?? []).map(p => ({ ...p, battleId: b.id, turn: b.turn, won: i === 0 ? b.payload.attackerWon : !b.payload.attackerWon }))));
  const wounds = facts.filter(f => f.kind === 'character_wounded');
  const deaths = facts.filter(f => f.kind === 'character_death' && f.payload.cause === 'battle');
  const closed = world.wars.filter(w => !w.active && w.endedTurn !== null);
  const roster = peopleRoster(world);
  const projectionWorld = { ...world, facts, history };
  const people = world.characters.map(p => ({ id: p.id, name: p.name, alive: p.alive, polity: p.polityId,
    story: projectPersonStoryArc(projectionWorld, p, 'active'), reason: roster.find(r => r.id === p.id)?.reason,
  }));
  const result = { seed, profile, hash: world.hash, checkpoints, errors,
    replay: advanceWorld(deserializeWorld(serializeWorld(world))).hash === advanceWorld(world).hash,
    battles: battles.length, attackerWins: battles.filter(b => b.payload.attackerWon).length,
    closedWars: closed.length, emptyWars: closed.filter(w => !battles.some(b => b.payload.warId === w.id)).length,
    exposures, wounds, deaths, people, facts, history,
    suffixNames: world.factions.filter(f => /[二三四五六七八九十\d]+$/.test(f.name)).map(f => f.name),
    recoveryViolations: wounds.flatMap(w => exposures.filter(e => e.characterId === w.payload.characterId
      && e.turn > w.turn && e.turn < (w.payload.recoveryUntilTurn ?? w.turn + 2)).map(e => ({ wound: w.id, battle: e.battleId }))),
  };
  writeFileSync(`${dir}/${index}.json`, JSON.stringify(result));
  writeFileSync(`${dir}/${index}.portable.json`, encodeWorldFile(serializeWorld(world)));
}
