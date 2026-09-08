import { mkdirSync, writeFileSync } from 'node:fs';
import { advanceWorld, createWorld, readWorldFacts, readWorldHistory, serializeWorld, deserializeWorld, validateWorld, validateTurnRuntime } from '../src/sim';

const mode = process.argv[2] ?? 'after';
const cases = [
  ['private-v03','风流三十年-丙午'], ['contest-v01','风流三十年-丙午'],
  ['private-v03','沧衡-甲子'], ['contest-v01','白露群雄-新验'],
  ['private-v03','孤城疫年'], ['contest-v01','山河故人-新验'],
  ['private-v03','白露群雄-新验'], ['contest-v01','孤城疫年'],
  ['private-v03','山河故人-新验'], ['contest-v01','长风换世-新验'],
  ['private-v03','长风换世-新验'], ['contest-v01','海门残照-新验'],
  ['private-v03','平野归鸿-留验'], ['contest-v01','秋浦新枝-留验'],
];
const directory = `output/historical-continuity/${mode}`;
mkdirSync(directory, { recursive: true });
for (const [index, [profile, seed]] of cases.entries()) {
  if (process.argv[3] && index !== Number(process.argv[3])) continue;
  let world = createWorld(seed!, profile!);
  const opening = structuredClone(world);
  const diagnostics: unknown[] = [];
  const ledgers: unknown[] = [];
  const runtimeViolations: Array<{ turn:number; code:string; message:string }> = [];
  const end = index >= 12 || index === 10 || index === 3 ? 400 : 240;
  for (let turn = 0; turn < end; turn++) {
    const before = world;
    world = advanceWorld(world);
    runtimeViolations.push(...validateTurnRuntime(before,world).map(v => ({ turn:world.turn, code:v.code, message:v.message })));
    ledgers.push({ turn, population: world.lastTurn!.population, food: world.lastTurn!.food,
      wealth: world.lastTurn!.wealth, health: world.lastTurn!.health });
    const watched = before.regions.filter(r => r.name === '奥州' || r.name === '关东');
    if (index === 10) diagnostics.push({ turn, before: watched, after: world.regions.filter(r => watched.some(w => w.id === r.id)),
      shipments: world.lastTurn!.trade.shipments.filter(s => watched.some(r => [s.originRegionId, s.destinationRegionId].includes(r.id))),
      events: readWorldHistory(world).filter(e => e.turn === turn && e.regionIds.some(id => watched.some(r => r.id === id))) });
    if (turn !== 239 && turn !== end - 1) continue;
    const facts = readWorldFacts(world), history = readWorldHistory(world);
    const battles = facts.filter(f => f.kind === 'battle' && f.turn < world.turn);
    const field = battles.filter(f => f.payload.defenders.some(d => d.soldiersBefore > 0));
    const closed = world.wars.filter(w => !w.active && w.endedTurn !== null && w.endedTurn < world.turn);
    const rematches = world.wars.flatMap(w => {
      const previous = world.wars.filter(p => p.endedTurn !== null && p.endedTurn < w.startedTurn
        && [p.attackerId,p.defenderId].sort().join() === [w.attackerId,w.defenderId].sort().join())
        .sort((a,b) => b.endedTurn! - a.endedTurn!)[0];
      return previous ? [w.startedTurn - previous.endedTurn!] : [];
    });
    const promotions = world.backgroundPeople.filter(p => p.promotedTurn !== null).map(p => ({
      id: p.promotedCharacterId, turn: p.promotedTurn, age: Math.floor((p.promotedTurn! + 1 - p.birthTurn) / 4) }));
    const governance = facts.filter(f => f.kind === 'local_governance_resolved' && f.payload.outcome === 'enacted');
    const validation = validateWorld(world);
    const serialized = serializeWorld(world);
    const replay = advanceWorld(world).hash;
    let saveReplay = false, saveError: string | null = null;
    try { saveReplay = advanceWorld(deserializeWorld(serialized)).hash === replay; }
    catch (error) { saveError = String(error); }
    const report = { index, profile, seed, turn: world.turn, hash: world.hash,
      validation: validation.map(v => v.code), runtimeViolations: [...runtimeViolations], saveReplay, saveError,
      repeatedStep: advanceWorld(world).hash === replay,
      battles: battles.length, attackerWins: battles.filter(f => f.payload.attackerWon).length,
      fieldBattles: field.length, fieldWins: field.filter(f => f.payload.attackerWon).length,
      closed: closed.length, noBattle: closed.filter(w => !battles.some(f => f.payload.warId === w.id)).length,
      rematches, promotions, governance: governance.length,
      emptyLevyRewards: governance.filter(f => f.payload.action === 'reduce_levy' && f.payload.foodSeasonsBefore === 0
        && f.stateDeltas.some(d => d.field === 'merit' && Number(d.delta) > 0)).length,
      decline90: world.regions.filter(r => r.population < opening.regions.find(o => o.id === r.id)!.population * .1).length,
      countries: world.polities.map(p => ({ id:p.id, name:p.name, alive:p.alive, authority:p.authority, administration:p.administration,
        regions:p.controlledRegionIds.length, treasury:p.treasury, battles:battles.filter(f => f.polityIds.includes(p.id)).length })),
      deaths: facts.filter(f => f.kind === 'character_death').reduce((o,f) => ({ ...o, [f.payload.cause]: (o[f.payload.cause] ?? 0)+1 }), {} as Record<string,number>),
      wounds: facts.filter(f => f.kind === 'character_wounded').length,
      wars: world.wars, regions: world.regions, people: world.characters, history, facts, ledgers,
    };
    const key = `${index}-T${world.turn}`;
    writeFileSync(`${directory}/${key}.json`, JSON.stringify(report));
    writeFileSync(`${directory}/${key}.world.json`, serialized);
    console.log(JSON.stringify({ ...report, regions:undefined, people:undefined, history:undefined, facts:undefined, wars:undefined, ledgers:undefined, promotions:promotions.length }));
    if (validation.length || runtimeViolations.length || !report.saveReplay || !report.repeatedStep) process.exitCode = 1;
  }
  if (diagnostics.length) writeFileSync(`${directory}/${index}-regions.json`, JSON.stringify(diagnostics));
}
