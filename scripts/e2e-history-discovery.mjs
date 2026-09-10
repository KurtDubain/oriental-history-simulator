import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const dir = process.argv[2] ?? 'output/history-discovery-v1.29.5/browser';
const file = process.argv[3] ?? 'output/playwright/revisit-v1294/1.portable.json';
const name = process.argv[4] ?? '顾崇珩';
const view = process.argv[5] ?? 'deceased';
await mkdir(dir, { recursive: true });
const browser = await chromium.launch();
try {
  for (const [label, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(process.env.HISTORY_DISCOVERY_E2E_URL ?? 'http://127.0.0.1:4174', { waitUntil: 'networkidle' });
    await page.locator('input[type=file]').setInputFiles(file);
    await page.locator('.world-map__canvas').waitFor({ timeout: 60000 });
    const hash = await page.evaluate(() => JSON.parse(window.render_game_to_text()).deterministicWorldHash);
    await page.locator('[data-observer-view="people"]').click();
    await page.locator('.roster-panel').waitFor();
    await page.waitForTimeout(400);
    const quickView = page.locator('.roster-panel__controls select').first();
    if (await page.locator('[data-roster-filter-toggle]').isVisible()) await page.locator('[data-roster-filter-toggle]').click();
    await quickView.selectOption(view);
    const filterToggle = page.locator('[data-roster-filter-toggle]');
    if (await filterToggle.isVisible() && await filterToggle.getAttribute('aria-expanded') === 'true') await filterToggle.click();
    await page.screenshot({ path: `${dir}/${label}-list-top.png`, fullPage: true });
    const row = (name ? page.locator('[data-roster-id]').filter({ hasText: name }) : page.locator('[data-roster-id]')).first();
    for (let i = 0; !await row.count() && i < 3; i++) {
      await page.getByRole('button', { name: /继续展卷/ }).click();
    }
    await row.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    assert.equal(await page.getByLabel('检索时人群像').inputValue(), '');
    await page.screenshot({ path: `${dir}/${label}-discovery.png`, fullPage: true });
    const reason = await row.locator('..').locator('.roster-panel__reason strong').innerText();
    await row.click();
    const inspector = page.locator('.observer-inspector[data-kind="person"]');
    await inspector.waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${dir}/${label}-person.png`, fullPage: true });
    const text = await inspector.innerText();
    const state = JSON.parse(await page.evaluate(() => window.render_game_to_text()));
    assert(state.interface.selectedDetail.storyArc.some(beat => beat.title === reason));
    assert(text.includes(reason), '名录理由必须在实际人物档案中可读');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(() => JSON.parse(window.render_game_to_text()).deterministicWorldHash), hash);
    assert(!/已故 · 已故|配角|长远所重/.test(text));
    const beats = inspector.locator('.observer-person-story button');
    const evidenceCount = await beats.count();
    assert.equal(evidenceCount, state.interface.selectedDetail.storyArc.length);
    for (let i = 0; i < evidenceCount; i++) {
      const evidence = beats.nth(i);
      await evidence.scrollIntoViewIfNeeded();
      await evidence.click();
      await page.locator('#observer-causal-drawer').waitFor();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${dir}/${label}-evidence-${i}.png`, fullPage: true });
      await page.keyboard.press('Escape');
      await page.locator('#observer-causal-drawer').waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate(() => JSON.parse(window.render_game_to_text()).deterministicWorldHash), hash);
    }
    await inspector.getByRole('tab', { name: '生平', exact: true }).click();
    await inspector.getByRole('button', { name: '读完整人物传', exact: true }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${dir}/${label}-full-biography.png`, fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await page.evaluate(() => JSON.parse(window.render_game_to_text()).deterministicWorldHash), hash);
    assert.deepEqual(errors, []);
    await writeFile(`${dir}/${label}.json`, JSON.stringify({ text, reason, state, hashAfter: hash, evidenceOpened: evidenceCount, errors }, null, 2));
    await page.close();
  }
} finally { await browser.close(); }
