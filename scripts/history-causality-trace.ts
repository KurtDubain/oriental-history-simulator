import { mkdirSync, writeFileSync } from 'node:fs';
import { createWorld, advanceWorld } from '../src/sim';
import { executableWarTarget } from '../src/sim/military/orders';
const dir = process.argv[2] ?? 'output/history-discovery-v1.29.5/after';
mkdirSync(dir, { recursive: true });
for (const [profile, seed, ids, label] of [
  ['private-v03', '铁衣照雪-行旅', ['p_xuantu', 'p_haedong'], 'war'],
  ['contest-v01', '百年归舟-复验', ['p_linyuan'], 'authority'],
] as const) {
  let world = createWorld(seed, profile);
  const rows = [];
  for (let t = 0; t < (label === 'war' ? 40 : 200); t++) {
    const gate = label === 'war' ? executableWarTarget(world, ids[0], ids[1]!) : null;
    world = advanceWorld(world);
    if (label === 'authority' && t < 115) continue;
    rows.push({ turn: t, gate,
      countries: world.polities.filter(p => ids.some(id => id === p.id)).map(p => ({ id: p.id, authority: p.authority,
        legitimacy: p.legitimacy, administration: p.administration, treasury: p.treasury, regions: p.controlledRegionIds.length,
        ruler: p.rulerId, weariness: p.warWeariness })),
      armies: world.armies.filter(a => ids.some(id => id === a.polityId)).map(a => ({ id: a.id, region: a.regionId,
        soldiers: a.soldiers, supply: a.supply, order: a.order, movement: a.recentMovement, allegiance: a.allegiance })),
      wars: world.wars.filter(w => ids.some(id => id === w.attackerId || id === w.defenderId)),
      facts: world.facts.filter(f => f.turn === t && f.polityIds.some(id => ids.some(p => id === p))),
      events: world.history.filter(e => e.turn === t && e.polityIds.some(id => ids.some(p => id === p)) && e.kind !== 'quarter_summary'),
    });
  }
  writeFileSync(`${dir}/${label}-trace.json`, JSON.stringify(rows));
}
