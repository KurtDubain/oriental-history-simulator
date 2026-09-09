import { readFileSync, writeFileSync } from 'node:fs';
const root = 'output/tragedy-v1.29.7';
const load = file => JSON.parse(readFileSync(`${root}/${file}`, 'utf8'));
const sum = (rows, key) => rows.reduce((n, r) => n + r[key], 0);
const quantiles = values => {
  const a = [...values].sort((a,b) => a-b);
  return { n: a.length, min: a[0], p50: a[Math.floor(a.length*.5)], p95: a[Math.floor(a.length*.95)], max: a.at(-1) };
};
const output = {};
for (const phase of ['before-verified', 'after-verified']) {
  const worlds = Array.from({length:8}, (_, i) => load(`${phase}/${i}.json`));
  const rows = worlds.map(w => {
    const standing = w.battles.filter(b => b.payload.defenders.some(d => d.soldiersBefore > 0));
    const deaths = w.deaths.map(d => {
      const battle = w.battles.find(b => b.id === d.payload.battleFactId);
      const side = battle && [battle.payload.attacker, ...battle.payload.defenders].find(s => s.participants?.some(p => p.characterId === d.payload.characterId));
      const p = side?.participants.find(p => p.characterId === d.payload.characterId);
      const previous = w.battles.filter(b => b.turn < d.turn && [b.payload.attacker,...b.payload.defenders].some(s => s.participants?.some(p => p.characterId === d.payload.characterId)));
      const wins = previous.filter(b => b.payload.attackerWon === b.payload.attacker.participants?.some(p => p.characterId === d.payload.characterId));
      return { id: d.payload.characterId, turn: d.turn, role: d.payload.role, battleRole: p?.role, won: battle?.payload.attackerWon === (side === battle?.payload.attacker), losses: p?.losses, before: p?.soldiersBefore, previousBattles: previous.length, previousWins: wins.length, factId:d.id };
    });
    return { seed:w.seed, profile:w.profile, wars:w.wars, ended:w.ended, empty:w.empty,
      battles:w.battles.length, attackerWins:w.battles.filter(b=>b.payload.attackerWon).length,
      standing:standing.length, standingAttackerWins:standing.filter(b=>b.payload.attackerWon).length,
      wounds:w.wounds.length, deaths:w.deaths.length, deathDetails:deaths, elderly:w.elderly.length,
      healthy100:w.elderly.filter(e=>e.health===100).length, health:quantiles(w.elderly.map(e=>e.health)),
      peak:w.peak, final:w.final, coldRosterMs:w.coldRosterMs, errors:w.errors, restoreContinuesIdentically:w.replay,
      lateDeclarationsMs:quantiles(w.quarterly.filter(q=>q.turn>200).map(q=>q.timings.systems.war_declarations)) };
  });
  const allBattles=worlds.flatMap(w=>w.battles), byTerrain={};
  for(const b of allBattles){ const g=byTerrain[b.terrain]??={battles:0,defenderWins:0};g.battles++;g.defenderWins+=Number(!b.payload.attackerWon); }
  const declarationRatios=worlds.flatMap(w=>w.declarations).flatMap(d=>{
    const match=d.fact.causes.find(c=>c.label==='军力判断')?.evidence.match(/己方军力(\d+)，对方(\d+)/);
    return match?[Number(match[1])/Math.max(1,Number(match[2]))]:[];
  });
  output[phase]={ rows, totals:Object.fromEntries(['wars','ended','empty','battles','attackerWins','standing','standingAttackerWins','wounds','deaths','elderly','healthy100'].map(k=>[k,sum(rows,k)])),
    zeroDeathWorlds: rows.filter(r=>!r.deaths).length, byTerrain,
    declarationEstimatedPolityPowerRatio:quantiles(declarationRatios),
    lateDeclarationsMs:quantiles(worlds.flatMap(w=>w.quarterly.filter(q=>q.turn>200).map(q=>q.timings.systems.war_declarations))),
    reopeningEvidence:worlds.flatMap(w=>w.declarations.filter(d=>d.fact.causes.some(c=>c.label==='再战条件变化')).map(d=>({seed:w.seed,fact:d.fact}))) };
}
for(const phase of ['authority-before','authority-after']){
  const rows=load(`${phase}/trace.json`);
  output[phase]={checkpoints:rows.filter((_,i)=>i%10===0).map(r=>({turn:r.turn,authority:r.polity.authority,legitimacy:r.polity.legitimacy,
    treasury:r.polity.treasury,regions:r.polity.controlledRegionIds.length,armies:r.armies.length,morale:r.armies.map(a=>a.morale),errors:r.violations})),
    importantFacts:rows.slice(1).flatMap(r=>r.facts).filter(f=>['war_started','war_ended','court_action_resolved','territory_control_changed'].includes(f.kind)),
    authorityDeltas:rows.slice(1).flatMap(r=>r.facts).filter(f=>f.stateDeltas.some(d=>d.entityType==='polity'&&d.entityId==='p_canghai'&&d.field==='authority'))};
}
writeFileSync(`${root}/comparison.json`,JSON.stringify(output,null,2));
console.log(JSON.stringify(Object.fromEntries(['before-verified','after-verified'].map(k=>[k,{...output[k].totals,zeroDeathWorlds:output[k].zeroDeathWorlds,late:output[k].lateDeclarationsMs,ratios:output[k].declarationEstimatedPolityPowerRatio}])),null,2));
