import { writeFileSync } from 'node:fs';
import { createWorld, advanceWorld, validateWorld } from '../src/sim';
const chains: Record<string, string[][]> = {};
let twelve;
for (const seed of ['架构边界-入世', '州县民生', '春战副将']) {
  let a = createWorld(seed), b = createWorld(seed); const chain = [];
  for (let t = 0; t <= 12; t++) {
    if (a.hash !== b.hash) throw new Error('Replay mismatch');
    if (validateWorld(a).length) throw new Error('Validation failed');
    chain.push([a.hash, a.factDigest, a.historyDigest]);
    if (t < 12) { a = advanceWorld(a); b = advanceWorld(b); }
  }
  if (seed === '春战副将') twelve = { turn: a.turn, hash: a.hash, factDigest: a.factDigest,
    historyDigest: a.historyDigest, factCount: a.facts.length, historyCount: a.history.length };
  else chains[seed] = chain;
}
writeFileSync('output/tragedy-v1.29.7/goldens.json', JSON.stringify({ chains, twelve }, null, 2));
