import { mkdirSync, writeFileSync } from 'node:fs';
import { advanceWorld, createWorld, readWorldFacts, readWorldHistory, serializeWorld, deserializeWorld, validateWorld } from '../src/sim';
import { governingCharacter } from '../src/sim/v02';

const mode = process.argv[2] ?? 'after';
if (mode === 'agency') {
  for (const seed of ['军权春秋', '北境军令', 'agency-v10-support-migration', '燕云逐鹿']) {
    let world = createWorld(seed);
    for (let turn = 1; turn <= 120; turn++) {
      world = advanceWorld(world);
      const resolved = world.facts.filter(fact => fact.turn === turn && fact.kind === 'agency_intent_resolved');
      if (resolved.length) console.log(JSON.stringify({ seed, turn, resolved }));
    }
  }
  process.exit(0);
}
if (mode === 'digests') {
  for (const seed of ['架构边界-入世', '州县民生', '春战副将']) {
    let world = createWorld(seed);
    const chain = [[world.hash, world.factDigest, world.historyDigest]];
    for (let turn = 1; turn <= 12; turn++) {
      world = advanceWorld(world); chain.push([world.hash, world.factDigest, world.historyDigest]);
    }
    console.log(JSON.stringify({ seed, chain, facts: world.facts.length, history: world.history.length }));
  }
  process.exit(0);
}
const samples = [
  ['private-v03', '风流三十年-丙午'], ['private-v03', '沧衡-甲子'], ['private-v03', '孤城疫年'],
  ['contest-v01', '风流三十年-丙午'], ['private-v03', '雨歇边城-留验'], ['contest-v01', '海晏秋灯-留验'],
];
const directory = `output/balance-story-review/${mode}`;
mkdirSync(directory, { recursive: true });
for (const [profile, seed] of samples) {
  let world = createWorld(seed!, profile!);
  const turns: unknown[] = [];
  for (let turn = 1; turn <= 120; turn++) {
    world = advanceWorld(world);
    const facts = world.facts.filter(fact => fact.turn === turn);
    const battles = facts.filter(fact => fact.kind === 'battle');
    turns.push({ turn, battles: battles.map(fact => ({ id: fact.id, ...fact.payload })),
      regents: world.polities.filter(polity => polity.alive && governingCharacter(world, polity)?.id !== polity.rulerId)
        .map(polity => ({ polityId: polity.id, rulerId: polity.rulerId, regentId: governingCharacter(world, polity)?.id })),
      orders: facts.filter(fact => fact.kind === 'army_order_changed').map(fact => ({ id: fact.id, ...fact.payload })),
      people: world.characters.filter(person => battles.some(battle => battle.actorIds.includes(person.id)))
        .map(person => ({ id: person.id, name: person.name, merit: person.merit, renown: person.renown, health: person.health,
          alive: person.alive, army: person.commandingArmyId, force: world.personalForces.find(force => force.ownerId === person.id)?.soldiers })),
    });
  }
  const facts = readWorldFacts(world), history = readWorldHistory(world);
  const battles = facts.filter(fact => fact.kind === 'battle');
  const wars = [...world.wars].sort((a, b) => a.startedTurn - b.startedTurn);
  const rematches = wars.flatMap((war, index) => {
    const previous = wars.slice(0, index).reverse().find(old => [old.attackerId, old.defenderId].sort().join() === [war.attackerId, war.defenderId].sort().join());
    return previous?.endedTurn == null ? [] : [{ pair: [war.attackerId, war.defenderId], gap: war.startedTurn - previous.endedTurn }];
  });
  const losses = new Map<string, number>();
  let longestFailureRun = 0;
  for (const battle of battles) {
    const key = `${battle.payload.attacker.polityId}:${battle.payload.targetRegionId}`;
    const count = battle.payload.attackerWon ? 0 : (losses.get(key) ?? 0) + 1;
    losses.set(key, count); longestFailureRun = Math.max(longestFailureRun, count);
  }
  const report = { profile, seed, hash: world.hash, validation: validateWorld(world).map(item => item.code),
    battles: battles.length, attackerWins: battles.filter(fact => fact.payload.attackerWon).length, longestFailureRun,
    losses: battles.reduce((sum, fact) => sum + fact.payload.attacker.losses + fact.payload.defenders.reduce((s, side) => s + side.losses, 0), 0),
    deaths: facts.filter(fact => fact.kind === 'character_death').map(fact => ({ turn: fact.turn, ...fact.payload })),
    wounds: facts.filter(fact => fact.kind === 'character_wounded').map(fact => ({ turn: fact.turn, ...fact.payload })),
    rematches, wars: world.wars, tribute: history.filter(event => event.kind.startsWith('tribute_')),
    regency: history.filter(event => ['regency', 'succession', 'usurpation', 'character_adult'].includes(event.kind)),
    careers: history.filter(event => ['deputy_merit', 'open_granary_enacted', 'reduce_levy_enacted', 'marriage'].includes(event.kind)),
    countries: world.polities.map(polity => ({ id: polity.id, name: polity.name, alive: polity.alive,
      regions: world.regions.filter(region => region.controllerId === polity.id).length,
      battles: battles.filter(fact => fact.polityIds.includes(polity.id)).length })),
    actors: world.characters.map(person => ({ id: person.id, name: person.name, merit: person.merit, renown: person.renown,
      biography: person.biography, alive: person.alive, health: person.health })),
    facts: facts.filter(fact => ['battle', 'appointment_started', 'appointment_ended', 'succession_resolved', 'local_governance_resolved', 'agency_intent_submitted', 'agency_intent_resolved', 'agency_support_resolved', 'embodied_action_resolved'].includes(fact.kind)),
    turns,
  };
  const saved = deserializeWorld(serializeWorld(world));
  const replay = advanceWorld(saved);
  if (replay.hash !== advanceWorld(world).hash) throw new Error(`save replay mismatch ${seed}`);
  writeFileSync(`${directory}/${profile}-${seed}.json`, JSON.stringify(report, null, 2));
  if (seed === '沧衡-甲子') writeFileSync(`${directory}/world-T120.json`, serializeWorld(world));
  console.log(JSON.stringify({ mode, profile, seed, battles: report.battles, attackerWins: report.attackerWins,
    longestFailureRun, immediateRematches: rematches.filter(item => item.gap === 1).length,
    tribute: report.tribute.reduce<Record<string, number>>((counts, event) => ({ ...counts, [event.kind]: (counts[event.kind] ?? 0) + 1 }), {}),
    validation: report.validation, hash: report.hash }));
}
