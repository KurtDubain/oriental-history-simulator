import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const root = 'output/history-maintenance-v1.29.5';
const browser = await chromium.launch();
try {
  for (const name of ['changshan', 'quanzhou']) {
    for (const [label, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
      const page = await browser.newPage({ viewport });
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      await page.goto('http://127.0.0.1:4174', { waitUntil: 'networkidle' });
      await page.locator('input[type=file]').setInputFiles(`${root}/frozen/${name}.portable.json`);
      await page.locator('.world-map__canvas').waitFor({ timeout: 60000 });
      await page.waitForTimeout(500);
      const close = page.locator('[data-inspector-close]');
      if (await close.isVisible()) await close.click();
      const state = JSON.parse(await page.evaluate(() => window.render_game_to_text()));
      const dir = `${root}/battle-browser/${name}`;
      await mkdir(dir, { recursive: true });
      await page.screenshot({ path: `${dir}/${label}-quarter.png`, fullPage: true });
      const story = state.interface.quarterPulse.stories.find(s => s.title.includes('接连3战'));
      assert.ok(story, `${name}: 真实三战必须出现在本季回顾`);
      assert.match(story.summary, /第1战.*第2战.*第3战/s);
      assert.ok(story.summary.indexOf('此战后') > story.summary.indexOf('第3战'));
      const toggle = page.getByTestId('observer-leads-mobile-toggle');
      if (await toggle.isVisible()) {
        if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
        if (await toggle.getAttribute('data-fully-expanded') !== 'true') await toggle.click();
      }
      await page.screenshot({ path: `${dir}/${label}-leads.png`, fullPage: true });
      const card = page.getByTestId('observer-lead').filter({ hasText: '接连3战' }).first();
      if (await card.count()) {
        await card.locator('.observer-leads__inspect').click();
        await page.waitForTimeout(350);
        await page.screenshot({ path: `${dir}/${label}-evidence.png`, fullPage: true });
        await page.keyboard.press('Escape');
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.equal(JSON.parse(await page.evaluate(() => window.render_game_to_text())).deterministicWorldHash, state.deterministicWorldHash);
      assert.deepEqual(errors, []);
      await writeFile(`${dir}/${label}.json`, JSON.stringify({ state, story, errors }, null, 2));
      await page.close();
    }
  }
} finally { await browser.close(); }
