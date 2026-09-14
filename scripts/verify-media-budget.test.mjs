import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {checkMediaAssets, mediaBudgets, verifyMedia} from './verify-media-budget.mjs';
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
const icons = ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png'].map(path => ({...image, path, load: 'initial'}));
test('only the three root icons enter image, initial and total budgets', () => {
  const result = checkMediaAssets(icons);
  assert.deepEqual(result.totals, {sfx: 0, image: 300, initial: 300, total: 300});
  assert.deepEqual(result.failures, []);
  for (const patch of [{path: 'other.ico'}, {path: 'icons/favicon.svg'}, {path: 'media/images/favicon.svg'}, {path: 'media/images/icon.png'}, {load: 'lazy'}, {kind: 'sfx'}, {license: ''}]) {
    assert(checkMediaAssets([{...icons[0], ...patch}]).failures.length);
  }
  assert(checkMediaAssets([{...icons[0], bytes: mediaBudgets.initial + 1}]).failures.some(f => f.startsWith('initial:')));
});

test('root icons must be registered and copied without missing or same-length corruption', async t => {
  const root = await mkdtemp(join(tmpdir(), 'canghai-media-budget-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await Promise.all(['media', 'public', 'dist'].map(directory => mkdir(join(root, directory))));
  await writeFile(join(root, 'media/manifest.json'), JSON.stringify({assets: icons}));
  for (const base of ['public', 'dist']) for (const icon of icons) await writeFile(join(root, base, icon.path), 'original');
  const verified = await verifyMedia(root, 'dist');
  assert.deepEqual(verified.failures, []);
  assert.equal(verified.totals.initial, 24);
  await writeFile(join(root, 'dist/favicon.ico'), 'modified');
  assert((await verifyMedia(root, 'dist')).failures.includes('产物资源不一致：favicon.ico'));
  await rm(join(root, 'dist/apple-touch-icon.png'));
  assert((await verifyMedia(root, 'dist')).failures.includes('产物资源不一致：apple-touch-icon.png'));
  await writeFile(join(root, 'media/manifest.json'), JSON.stringify({assets: icons.slice(1)}));
  const unregistered = (await verifyMedia(root, 'dist')).failures;
  for (const base of ['public', 'dist']) assert(unregistered.includes(`未登记资源：${join(root, base, 'favicon.svg')}`));
  await writeFile(join(root, 'public/unlisted.ico'), 'other');
  assert((await verifyMedia(root)).failures.includes(`未登记资源：${join(root, 'public/unlisted.ico')}`));
});

test('project icons are self-contained, correctly sized and linked from the shared entry', async () => {
  const source = path => readFile(new URL(`../${path}`, import.meta.url));
  const svg = (await source('public/favicon.svg')).toString('utf8');
  assert.match(svg, /<svg\b/);
  assert.match(svg, /<path\b/);
  assert.doesNotMatch(svg, /<(?:text|font|foreignObject|image|use|script|style)\b|font-family|@font-face|url\s*\(|(?:href|xlink:href)\s*=/i);
  const pngSize = data => {
    assert.ok(data.length >= 24);
    assert.equal(data.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(data.toString('ascii', 12, 16), 'IHDR');
    return [data.readUInt32BE(16), data.readUInt32BE(20)];
  };
  const ico = await source('public/favicon.ico');
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 3);
  const sizes = [16, 32, 48];
  for (const [i, size] of sizes.entries()) {
    const entry = 6 + i * 16, length = ico.readUInt32LE(entry + 8), offset = ico.readUInt32LE(entry + 12);
    assert.equal(ico[entry], size);
    assert.equal(ico[entry + 1], size);
    assert.ok(offset >= 6 + sizes.length * 16 && offset + length <= ico.length);
    assert.deepEqual(pngSize(ico.subarray(offset, offset + length)), [size, size]);
  }
  assert.deepEqual(pngSize(await source('public/apple-touch-icon.png')), [180, 180]);
  const html = (await source('index.html')).toString('utf8');
  const links = [...html.matchAll(/<link\b([^>]+)>/g)].map(match => Object.fromEntries(
    [...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]),
  ));
  for (const [path, rel, size] of [
    ['/favicon.ico', 'icon', '16x16 32x32 48x48'],
    ['/favicon.svg', 'icon', 'any'],
    ['/apple-touch-icon.png', 'apple-touch-icon', '180x180'],
  ]) {
    const matches = links.filter(link => link.href === path);
    assert.equal(matches.length, 1, path);
    assert.equal(matches[0].rel, rel);
    assert.equal(matches[0].sizes, size);
    if (path.endsWith('.svg')) assert.equal(matches[0].type, 'image/svg+xml');
  }
  const {assets} = JSON.parse((await source('media/manifest.json')).toString('utf8'));
  for (const icon of icons) {
    const registered = assets.filter(asset => asset.path === icon.path);
    assert.equal(registered.length, 1, icon.path);
    assert.equal(registered[0].kind, 'image');
    assert.equal(registered[0].load, 'initial');
  }
});
