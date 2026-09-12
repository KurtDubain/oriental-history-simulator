import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkMediaAssets, mediaBudgets} from './verify-media-budget.mjs';
const image = {path: 'media/images/court-seal.webp', kind: 'image', load: 'lazy', source: 'original working file', creator: 'project', license: 'owned', bytes: 100};
test('empty preparation and a licensed lazy image pass', () => {assert.equal(checkMediaAssets([]).failures.length, 0);assert.equal(checkMediaAssets([image]).failures.length, 0);});
test('initial, category and total bytes are independently bounded', () => {
 for (const a of [{...image, load:'initial', bytes: mediaBudgets.initial+1}, {...image, bytes: mediaBudgets.image+1}]) assert(checkMediaAssets([a]).failures.length);
 const sound={...image,path:'media/sfx/quarter-turn.ogg',kind:'sfx',bytes:mediaBudgets.sfx};
 assert(checkMediaAssets([{...image,bytes:mediaBudgets.image},sound]).failures.some(f=>f.startsWith('total:')));
});
test('duplicate, traversal, license, format and loading declarations fail', () => {
 assert(checkMediaAssets([image,image]).failures.length);
 for(const patch of [{path:'../outside.webp'}, {license:''}, {load:'automatic'}, {kind:'sfx'}, {bytes:-1}]) assert(checkMediaAssets([{...image,...patch}]).failures.length);
});
