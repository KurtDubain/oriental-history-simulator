import { mkdirSync, writeFileSync } from 'node:fs';
import { createWorld, advanceWorld, readWorldHistory } from '../src/sim';
import { processRegions } from '../src/sim/engine';
import { createTurnContext } from '../src/sim/turn-context-state';

let world = createWorld('长风换世-新验');
const records: unknown[] = [];
for (let turn = 0; turn < 240; turn++) {
  const before = world;
  const env = before.regions.filter(r => ['奥州','关东'].includes(r.name)).map(region => {
    const local = structuredClone(before);
    local.regions = [structuredClone(region)];
    const context = createTurnContext(local);
    processRegions(local, context);
    const natural = Math.floor(region.population * (.0019 + local.regions[0]!.devastation / 45000));
    return { id:region.id, name:region.name, before:region, environment:local.regions[0],
      produced:context.food.produced, consumed:context.food.civilianConsumed, spoiled:context.food.spoiled,
      births:context.population.births, naturalDeaths:natural, famineDeaths:context.population.civilianDeaths-natural };
  });
  world = advanceWorld(world);
  for (const item of env) {
    const final = world.regions.find(r => r.id === item.id)!;
    const ships = world.lastTurn!.trade.shipments.filter(s => [s.originRegionId,s.destinationRegionId].includes(item.id));
    const incoming = ships.filter(s => s.destinationRegionId === item.id);
    const outgoing = ships.filter(s => s.originRegionId === item.id);
    const migrationNet = incoming.reduce((s,x) => s+x.peopleArrived,0)-outgoing.reduce((s,x)=>s+x.peopleDeparted,0);
    const foodIn = incoming.filter(s=>s.commodity === '粮食' && s.kind === '贸易').reduce((s,x)=>s+x.deliveredAmount,0);
    const foodOut = outgoing.filter(s=>s.commodity === '粮食').reduce((s,x)=>s+x.acceptedAmount,0);
    records.push({ turn, ...item, final, foodIn, foodOut, migrationNet,
      // Do not call this residual starvation: recruitment, demobilisation,
      // warfare and disease are settled by the later authoritative phases.
      laterPopulationResidual:final.population-item.environment!.population-migrationNet,
      laterFoodResidual:final.food-item.environment!.food-foodIn+foodOut,
      shipments:ships, events:readWorldHistory(world).filter(e=>e.turn===turn&&e.regionIds.includes(item.id)) });
  }
}
const directory = process.argv[2]!;
mkdirSync(directory,{recursive:true});
writeFileSync(`${directory}/regional-trace.json`, JSON.stringify({hash:world.hash,records}));
console.log(world.hash);
