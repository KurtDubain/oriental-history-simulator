import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const root = 'output/historical-continuity';
const read = (mode,index,turn) => {
  const path = `${root}/${mode}/${index}-T${turn}.json`;
  return existsSync(path) ? JSON.parse(readFileSync(path,'utf8')) : null;
};
function summarize(reports) {
  const sum = key => reports.reduce((s,r)=>s+r[key],0);
  const people = reports.flatMap(r=>r.promotions);
  const rematches = reports.flatMap(r=>r.rematches);
  const longestFailures = reports.map(r => {
    const runs=new Map(); let maximum=0;
    for(const f of r.facts.filter(f=>f.kind==='battle')) {
      const key=`${f.payload.attacker.polityId}:${f.payload.targetRegionId}`;
      const n=f.payload.attackerWon?0:(runs.get(key)??0)+1;
      runs.set(key,n); maximum=Math.max(maximum,n);
    }
    return maximum;
  });
  return { cases:reports.length, battles:sum('battles'), wins:sum('attackerWins'), field:sum('fieldBattles'), fieldWins:sum('fieldWins'),
    closed:sum('closed'), noBattle:sum('noBattle'), populationBelowTenth:sum('decline90'), emptyLevyRewards:sum('emptyLevyRewards'),
    promotions:people.length, promoted65Plus:people.filter(p=>p.age>=65).length,
    ageBands:[0,16,30,50,65].map((min,i,a)=>({min,max:a[i+1]??100,count:people.filter(p=>p.age>=min&&p.age<(a[i+1]??100)).length})),
    rematches:rematches.length, peaceMinimum:Math.min(...rematches), peaceMedian:[...rematches].sort((a,b)=>a-b)[Math.floor(rematches.length/2)],
    wounds:sum('wounds'), battleDeaths:reports.reduce((s,r)=>s+(r.deaths.battle??0),0), longestFailures,
    largest:reports.map(r=>{const p=[...r.countries].sort((a,b)=>b.regions-a.regions)[0];return{index:r.index,polity:p.name,regions:p.regions,total:r.regions.length,authority:p.authority};}),
    population:reports.reduce((s,r)=>s+r.regions.reduce((v,x)=>v+x.population,0),0),
    civilianDeaths:reports.reduce((s,r)=>s+r.ledgers.reduce((v,l)=>v+l.population.civilianDeaths,0),0),
    validators:reports.flatMap(r=>r.validation), runtime:reports.flatMap(r=>r.runtimeViolations??[]),
    saveFailures:reports.filter(r=>!r.saveReplay).map(r=>({index:r.index,turn:r.turn,error:r.saveError})),
    tribute:reports.flatMap(r=>r.history.filter(e=>e.kind.startsWith('tribute_'))).reduce((o,e)=>({...o,[e.kind]:(o[e.kind]??0)+1}),{}),
  };
}
const report={};
for(const mode of ['before','after','verified','optimized']) {
  report[mode]={};
  for(const [label,indices,turn] of [['original',Array.from({length:12},(_,i)=>i),240],['heldout',[12,13],240],['century',[3,10,12,13],400]]) {
    report[mode][label]=summarize(indices.map(i=>read(mode,i,turn)).filter(Boolean));
  }
}
report.replay=Array.from({length:14},(_,i)=>i).flatMap(i=>[240,400].flatMap(t=>{
  const a=read('after',i,t),v=read('verified',i,t),o=read('optimized',i,t);
  return a&&v?[{index:i,turn:t,equal:a.hash===v.hash,optimizedEqual:o ? a.hash===o.hash : null,
    optimizedBodyEqual:o ? readFileSync(`${root}/after/${i}-T${t}.world.json`).equals(readFileSync(`${root}/optimized/${i}-T${t}.world.json`)) : null,
    hash:v.hash}]:[];
}));
writeFileSync(`${root}/summary.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
