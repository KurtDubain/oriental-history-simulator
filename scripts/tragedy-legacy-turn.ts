import { writeFileSync } from 'node:fs';
import { advanceWorldBy, createWorld, serializeWorld, validateWorld } from '../src/sim';
import { encodeWorldFile } from '../src/persistence/storage';
const world = advanceWorldBy(createWorld('故城秋灯-九月新卷', 'private-v03'), 160);
const errors = validateWorld(world);
if (errors.length) throw new Error(JSON.stringify(errors));
writeFileSync(process.argv[2], encodeWorldFile(serializeWorld(world)));
console.log(JSON.stringify({ seed: world.seed, turn: world.turn, hash: world.hash, errors }));
