import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const dir = 'output/balance-story-review/browser';
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 840 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    await page.goto('http://127.0.0.1:4174', { waitUntil: 'networkidle' });
    await page.getByLabel('世界种子').fill('沧衡-甲子');
    await page.locator('#start-world').click();
    await page.locator('.world-map__canvas').waitFor();
    const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
    const shot = async suffix => {
      await page.screenshot({ path: `${dir}/${name}-${suffix}.png` });
      await writeFile(`${dir}/${name}-${suffix}.json`, JSON.stringify(await state(), null, 2));
    };
    await shot('initial');
    for (let turn = 1; turn <= 120; turn++) {
      await page.getByRole('button', { name: '推进至下一季', exact: true }).evaluate(button => button.click());
      await page.waitForFunction(expected => JSON.parse(window.render_game_to_text()).time.turn === expected, turn);
      if ([12, 64, 120].includes(turn)) await shot(`t${turn}`);
    }
    const final = await state();
    await page.locator('[data-observer-view="people"]').click();
    await page.getByLabel('检索时人群像').fill('李维宣');
    const row = page.locator('[data-roster-id]').filter({ hasText: '李维宣' }).first();
    await row.click();
    await shot('person');
    const text = await page.locator('.observer-inspector').innerText();
    assert.doesNotMatch(text, /c_\d+|进入事实档案|可核验/);
    await writeFile(`${dir}/${name}-person.txt`, text);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    results.push({ name, turn: final.time.turn, hash: final.deterministicWorldHash, errors });
    await page.close();
  }
  assert.equal(results[0].hash, results[1].hash);
  await writeFile(`${dir}/results.json`, JSON.stringify(results, null, 2));
  console.log(results);
} finally { await browser.close(); }
