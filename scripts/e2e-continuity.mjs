import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const dir = 'output/continuity-v1.29.8/browser-natural';
await mkdir(dir, { recursive: true });
const browser = await chromium.launch();
const state = page => page.evaluate(() => JSON.parse(window.render_game_to_text()));
try {
  for (const [label, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport });
    const errors = [], turns = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('http://127.0.0.1:4174', { waitUntil: 'networkidle' });
    await page.getByLabel('世界种子').fill('寒江照铁-戌时');
    await page.locator('#start-world').click();
    await page.locator('.world-map__canvas').waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${dir}/${label}-T0.png` });
    for (let t = 1; t <= 12; t++) {
      await page.getByRole('button', { name: '推进至下一季', exact: true }).click();
      await page.waitForFunction(t => JSON.parse(window.render_game_to_text()).time.turn === t, t);
      const s = await state(page);
      turns.push(s);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      if ([3, 4, 5, 6, 12].includes(t)) {
        await page.waitForTimeout(400);
        await page.screenshot({ path: `${dir}/${label}-T${t}.png` });
      }
    }
    assert.equal(turns.at(-1).deterministicWorldHash, 'f127bb509ac160c3');
    const lead = turns.at(-1).observer.focusLeads.find(l => l.situationType === 'war_progress' && l.situationId);
    let focusResult = null;
    if (lead) {
      if (label === 'mobile') {
        const panel = page.locator('[data-observer-leads=true]');
        const toggle = panel.getByTestId('observer-leads-mobile-toggle');
        if (await panel.getAttribute('data-mobile-open') === null) await toggle.click();
        if (await panel.getAttribute('data-mobile-expanded') === null) await toggle.click();
      }
      await page.locator(`[data-lead-id="${lead.id}"] .observer-leads__inspect`).click();
      await page.locator('.situation-workbench-layer').getByRole('button', { name: '回到舆图看战线' }).click();
      const summary = page.getByTestId('war-focus-summary');
      await summary.waitFor();
      const warId = await summary.getAttribute('data-war-id');
      await page.screenshot({ path: `${dir}/${label}-war-focus.png` });
      let s = await state(page);
      while (s.mapObjects.wars.some(w => w.warId === warId) && s.time.turn < 80) {
        await page.getByRole('button', { name: '推进至下一季', exact: true }).click();
        await page.waitForFunction(t => JSON.parse(window.render_game_to_text()).time.turn > t, s.time.turn);
        s = await state(page);
      }
      assert(!s.mapObjects.wars.some(w => w.warId === warId), 'natural focused war must reach its end within this fixture');
      await page.waitForFunction(() => !document.querySelector('.world-map')?.getAttribute('data-focused-war-id'));
      assert.equal(await summary.count(), 0);
      focusResult = { warId, endedByTurn: s.time.turn, focusedWarId: await page.locator('.world-map').getAttribute('data-focused-war-id') };
      await page.screenshot({ path: `${dir}/${label}-war-ended.png` });
    }
    assert.deepEqual(errors, []);
    await writeFile(`${dir}/${label}.json`, JSON.stringify({ turns, focusResult, errors }, null, 2));
    console.log(label, 'T12 verified', focusResult);
    await page.close();
  }
} finally { await browser.close(); }
