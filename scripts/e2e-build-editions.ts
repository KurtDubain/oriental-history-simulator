import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium, type Page } from 'playwright';
import { preview } from 'vite';
import { BUILD_TARGETS, assertPreviewArtifact } from './build-target.mjs';
import packageJson from '../package.json';
import { createWorld, advanceWorld, serializeWorld, deserializeWorld, validateWorld } from '../src/sim';
import { stableStringify } from '../src/sim/random';
import { encodeWorldFile } from '../src/persistence/storage';

// Current-version test preparation, not an ignored historical output or a natural-event quota.
const seed = '双版同史-交付验收';
const source = [createWorld(seed, 'contest-v01')];
for (let turn = 1; turn <= 9; turn++) source.push(advanceWorld(source.at(-1)!));
const privatePayload = serializeWorld(createWorld(seed, 'private-v03'));
const root = `output/build-editions-v${packageJson.version}/browser`;
await mkdir(root, { recursive: true });
const state = (page: Page): Promise<any> => page.evaluate(() => JSON.parse(window.render_game_to_text!()));
const tool = async (page: Page, name: string) => {
  const button = page.getByRole('button', { name, exact: true });
  if (!await button.isVisible()) await page.getByRole('button', { name: '打开更多工具', exact: true }).click();
  await button.click();
};
async function exported(page: Page, name: string) {
  const pending = page.waitForEvent('download');
  await tool(page, '导出完整史册');
  const path = `${root}/${name}.portable.json`;
  await (await pending).saveAs(path);
  const buffer = await readFile(path);
  return { buffer, body: stableStringify(JSON.parse(buffer.toString()).world) };
}
async function autosave(page: Page) {
  return page.evaluate(() => new Promise<string>((resolve, reject) => {
    const request = indexedDB.open('canghai-history-v01', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, row = db.transaction('world-saves').objectStore('world-saves').get('autosave');
      row.onsuccess = () => { db.close(); resolve(row.result?.payload); };
      row.onerror = () => { db.close(); reject(row.error); };
    };
  }));
}
// Native decoded audio probe. Sampling is test-only and never shipped in either app.
function audioProbe() {
  const qa = (window as any).__editionAudio = { starts: 0, peak: 0 };
  const Base = window.AudioContext;
  window.AudioContext = class extends Base {
    createBufferSource() {
      const source = super.createBufferSource(), start = source.start.bind(source);
      source.start = (...args) => { qa.starts++; start(...args); };
      return source;
    }
    createGain() {
      const gain = super.createGain(), connect = gain.connect.bind(gain);
      gain.connect = ((destination: AudioNode) => {
        if (destination !== this.destination) return connect(destination);
        const meter = this.createAnalyser(); meter.fftSize = 512;
        connect(meter); meter.connect(destination);
        const data = new Float32Array(512);
        const timer = setInterval(() => { meter.getFloatTimeDomainData(data); qa.peak = Math.max(qa.peak, ...data.map(Math.abs)); }, 20);
        setTimeout(() => clearInterval(timer), 5000);
        return destination;
      }) as typeof gain.connect;
      return gain;
    }
  };
}

const metadata = await Promise.all(Object.values(BUILD_TARGETS).map(async target => {
  const value = JSON.parse(await readFile(`${target.outDir}/version.json`, 'utf8'));
  assertPreviewArtifact(target, value, packageJson.version);
  return value;
}));
assert.equal(metadata[0].commitId, metadata[1].commitId);
assert.notEqual(metadata[0].buildId, metadata[1].buildId);
const browser = await chromium.launch({ ignoreDefaultArgs: ['--mute-audio'] });
const results: any[] = [];
try {
  for (const [index, target] of Object.values(BUILD_TARGETS).entries()) {
    const port = 4315 + index;
    const server = await preview({ configFile: false, build: { outDir: target.outDir }, preview: { host: '127.0.0.1', port, strictPort: true } });
    try {
      for (const [label, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]] as const) {
        const key = `${target.edition}-${label}`, errors: string[] = [];
        const context = await browser.newContext({ viewport: { width, height }, hasTouch: label === 'mobile', isMobile: label === 'mobile' });
        const page = await context.newPage();
        await page.addInitScript(audioProbe);
        page.on('pageerror', e => errors.push(String(e)));
        page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
        const shot = async (name: string) => {
          await page.screenshot({ path: `${root}/${key}-${name}.png`, animations: 'disabled' });
          await writeFile(`${root}/${key}-${name}.json`, JSON.stringify(await state(page), null, 2));
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no horizontal overflow');
        };
        try {
          await page.goto(`http://127.0.0.1:${port}/?edition=personal`, { waitUntil: 'networkidle' });
          assert.deepEqual(await (await page.request.get(`http://127.0.0.1:${port}/version.json`)).json(), metadata[index]);
          const opening = await state(page);
          assert.equal(opening.edition, target.edition);
          assert.deepEqual(opening.availableMapProfiles.map((p: any) => p.id), metadata[index].profiles.map((p: any) => p.id));
          assert.equal(opening.availableMapProfiles.length, target.edition === 'personal' ? 2 : 1);
          assert.match(await page.locator('.world-start').innerText(), new RegExp(target.label));
          await shot('opening');
          await page.locator('.world-start [data-map-profile-id="contest-v01"]').click();
          await page.getByLabel('世界种子').fill(seed);
          await page.locator('#start-world').click();
          await page.locator('.world-map__canvas').waitFor();
          const hashes: Record<number, string> = {};
          for (let turn = 0; turn <= 8; turn++) {
            if (turn) {
              await page.getByRole('button', { name: '推进至下一季', exact: true }).click();
              await page.waitForFunction(t => JSON.parse(window.render_game_to_text!()).time.turn === t, turn);
            }
            if (![0, 1, 4, 8].includes(turn)) continue;
            const actual = await exported(page, `${key}-T${turn}`);
            assert.equal(actual.body, serializeWorld(source[turn]!), `source / ${key} T${turn} full body`);
            hashes[turn] = (await state(page)).deterministicWorldHash;
          }
          await shot('map-T8');
          const body = serializeWorld(source[8]!);
          await page.locator('[data-settings-trigger=true]').click();
          assert.equal(await page.getByLabel('提示音').isChecked(), false);
          await page.getByLabel('提示音').check();
          await page.getByLabel('音量').fill('0.25');
          await page.getByRole('button', { name: '试听翻卷', exact: true }).click();
          await page.waitForFunction(() => (window as any).__editionAudio.peak > 0.0001);
          await shot('sound');
          await page.getByLabel('提示音').uncheck();
          await page.getByTestId('settings-panel').getByRole('button', { name: '关闭设置', exact: true }).click();

          await page.locator('[data-observer-desk-trigger=true]').click();
          const release = page.locator('.observer-desk__release');
          assert.match(await release.innerText(), new RegExp(target.label));
          await page.route('**/version.json?*', route => route.fulfill({ json: metadata[1 - index] }));
          await release.getByTestId('check-app-update').click();
          await page.waitForFunction(() => JSON.parse(window.render_game_to_text!()).appUpdate.phase === 'mismatch');
          assert.equal(await release.getByTestId('apply-app-update').count(), 0);
          await shot('cross-edition-update');
          await page.unroute('**/version.json?*');
          await page.keyboard.press('Escape');

          await page.locator('[data-observer-view=people]').click();
          await page.locator('[data-roster-id^="c_"]').first().click();
          const inspector = page.locator('.observer-inspector[data-kind=person]');
          await inspector.waitFor();
          const person = (await state(page)).interface.selectedDetail;
          assert(person.storyArc.length > 0, 'a real selected experience supplies the evidence path');
          await shot('person');
          await inspector.locator('.observer-person-story button').first().click();
          await page.locator('.observer-causal-layer').waitFor();
          assert.equal(await page.locator('.observer-causal-layer').getAttribute('data-event-id'), person.storyArc[0].primaryEventId ?? person.storyArc[0].primaryFactId);
          await shot('evidence');
          await page.keyboard.press('Escape');
          await page.locator('.observer-causal-layer').waitFor({ state: 'hidden' });
          assert.equal((await state(page)).interface.selectedDetail.id, person.id);
          await page.locator('[data-inspector-close]').click();
          await page.locator('[data-observer-view=world]').click();
          assert.equal((await exported(page, `${key}-read-only`)).body, body);
          await tool(page, '保存当前世界');
          await page.locator('.observer-toast').filter({ hasText: '写入本地史册' }).waitFor();
          assert.equal(await autosave(page), body);
          await page.reload({ waitUntil: 'networkidle' });
          await page.locator('#continue-world').click();
          await page.locator('.world-map__canvas').waitFor();
          assert.equal((await state(page)).deterministicWorldHash, source[8]!.hash);
          const saved = await exported(page, `${key}-restored`);
          assert.equal(saved.body, body);
          await tool(page, '返回世界书页');
          if (target.edition === 'contest') {
            const before = await autosave(page);
            const beforeImport = await state(page);
            await page.locator('input[type=file]').setInputFiles({ name: 'private.portable.json', mimeType: 'application/json', buffer: Buffer.from(encodeWorldFile(privatePayload)) });
            await page.locator('.world-start__error').waitFor();
            assert.match(await page.locator('.world-start__error').innerText(), /当前版别不包含.*地图/);
            assert.equal((await state(page)).mode, beforeImport.mode);
            assert.equal((await state(page)).deterministicWorldHash, beforeImport.deterministicWorldHash);
            assert.equal(await autosave(page), before, 'rejected import must not overwrite the valid save');
            await shot('private-import-rejected');
          }
          await page.locator('input[type=file]').setInputFiles({ name: 'contest-history.portable.json', mimeType: 'application/json', buffer: saved.buffer });
          await page.locator('.world-map__canvas').waitFor();
          assert.equal((await state(page)).deterministicWorldHash, source[8]!.hash);
          assert(source[8]!.history.length > 0 && source[8]!.facts.length > 0);
          await page.getByRole('button', { name: '推进至下一季', exact: true }).click();
          await page.waitForFunction(() => JSON.parse(window.render_game_to_text!()).time.turn === 9);
          const resumed = await exported(page, `${key}-resumed-T9`);
          assert.equal(resumed.body, serializeWorld(source[9]!));
          assert.deepEqual(validateWorld(deserializeWorld(resumed.body)), []);
          await shot('resumed-T9');
          assert.deepEqual(errors, []);
          results.push({ edition: target.edition, label, hashes, resumed: source[9]!.hash, fullBodyExact: true, errors });
          await writeFile(`${root}/result.json`, JSON.stringify(results, null, 2));
        } catch (error) {
          await shot('failure');
          await writeFile(`${root}/${key}-failure.txt`, `${String(error)}\n${await page.locator('body').innerText()}\n${JSON.stringify(errors)}`);
          throw error;
        } finally { await context.close(); }
      }
    } finally { await new Promise<void>(resolve => server.httpServer.close(() => resolve())); }
  }
} finally { await browser.close(); }
console.log(JSON.stringify(results, null, 2));
