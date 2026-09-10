import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { advanceWorld, createWorld, deserializeWorld, serializeWorld, validateWorld } from '../src/sim';
import { stableStringify } from '../src/sim/random';
import { encodeWorldFile } from '../src/persistence/storage';

// Run against vite preview, never the development server: minification is part of this boundary.
const dir = process.env.OHS_DETERMINISM_DIR ?? 'output/production-determinism';
const url = process.env.OHS_E2E_URL ?? 'http://127.0.0.1:4176';
const investigate = process.env.OHS_DETERMINISM_INVESTIGATE === '1';
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch();
const results: unknown[] = [];
async function exported(page: import('playwright').Page, name: string) {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出完整史册', exact: true }).click();
  const path = `${dir}/${name}.json`;
  await (await download).saveAs(path);
  return stableStringify(JSON.parse(readFileSync(path, 'utf8')).world);
}
try {
  for (const profile of (process.env.OHS_DETERMINISM_PROFILES ?? 'private-v03,contest-v01').split(',')) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(url, { waitUntil: 'networkidle' });
    if (profile !== 'private-v03') await page.locator(`[data-map-profile-id="${profile}"]`).click();
    await page.getByLabel('世界种子').fill('暮云归朔-新卷甲');
    await page.locator('#start-world').click();
    await page.locator('.world-map__canvas').waitFor();
    let source = createWorld('暮云归朔-新卷甲', profile);
    for (let turn = 0; turn <= 41; turn++) {
      if (turn) {
        source = advanceWorld(source);
        await page.getByRole('button', { name: '推进至下一季', exact: true }).click();
        await page.waitForFunction(t => JSON.parse(window.render_game_to_text()).time.turn === t, turn);
      }
      if (![0, 1, 12, 40, 41].includes(turn)) continue;
      const actual = await exported(page, `${profile}-T${turn}`), expected = serializeWorld(source);
      writeFileSync(`${dir}/${profile}-source-T${turn}.json`, encodeWorldFile(expected));
      const restored = JSON.parse(actual);
      let importError: string | null = null;
      try { deserializeWorld(actual); } catch (e) { importError = String(e); }
      const row = { profile, turn, source: source.hash, production: restored.hash, exact: actual === expected,
        valid: validateWorld(restored).length === 0, importError, errors: [...errors] };
      results.push(row); console.log(row);
      writeFileSync(`${dir}/result.json`, JSON.stringify(results, null, 2));
      assert.deepEqual(errors, []);
      if (!investigate) assert.equal(importError, null);
      if (!investigate) assert(actual === expected, `source/production differs: ${profile} T${turn}`);
    }
    await page.screenshot({ path: `${dir}/${profile}-T41.png` });
    await page.close();
  }
  // Authenticate original numeric-boolean saves without normalizing or replacing their hashes.
  for (const input of (process.env.OHS_COMPAT_FILES ?? '').split(',').filter(Boolean)) {
    const text = readFileSync(input, 'utf8'), serialized = stableStringify(JSON.parse(text).world);
    const source = deserializeWorld(serialized);
    assert(serializeWorld(source) === serialized, 'import must not rewrite an authenticated snapshot');
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.locator('input[type=file]').setInputFiles(input);
    await page.locator('.world-map__canvas').waitFor({ timeout: 60000 });
    assert(await exported(page, `import-${results.length}`) === serialized);
    const next = advanceWorld(source);
    await page.getByRole('button', { name: '推进至下一季', exact: true }).click();
    await page.waitForFunction(t => JSON.parse(window.render_game_to_text()).time.turn === t, next.turn);
    const actual = await exported(page, `resume-${results.length}`);
    results.push({ input, turn: next.turn, exact: actual === serializeWorld(next), hash: next.hash });
    writeFileSync(`${dir}/result.json`, JSON.stringify(results, null, 2));
    if (!investigate) assert(actual === serializeWorld(next));
    await page.close();
  }
} finally { await browser.close(); }
