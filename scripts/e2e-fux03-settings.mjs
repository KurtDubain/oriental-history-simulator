import assert from 'node:assert/strict';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const PORT = Number(process.env.FUX03_E2E_PORT ?? 4187);
const APP_URL = `http://127.0.0.1:${PORT}`;
const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
const artifactDir = `output/settings-e2e-v${version}`;
const settingsKey = 'canghai-observer-interface-settings-v1';
const scenarios = [
  { slug: 'desktop', viewport: { width: 1280, height: 800 } },
  { slug: 'mobile', viewport: { width: 390, height: 844 } },
];

const snapshot = (page) => page.evaluate(() => JSON.parse(window.render_game_to_text()));

await rm(artifactDir, { recursive: true, force: true });
await mkdir(artifactDir, { recursive: true });
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: PORT, strictPort: true } });
await server.listen();
const browser = await chromium.launch({ headless: true });

try {
  for (const scenario of scenarios) {
    const context = await browser.newContext({ viewport: scenario.viewport });
    const page = await context.newPage();
    const errors = [];
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.addInitScript(() => {
      localStorage.setItem('canghai-map-primer-complete-v1', '1');
      localStorage.removeItem('canghai-observer-interface-settings-v1');
    });
    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    await page.getByLabel('世界种子').fill(`设置减法-${scenario.slug}`);
    await page.click('#start-world');
    await page.waitForSelector('.world-map__canvas');
    const baseline = await snapshot(page);
    assert.equal(baseline.productVersion, version);

    const trigger = page.locator('[data-settings-trigger="true"]');
    await trigger.click();
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).interface.settings.open);
    const panel = page.getByTestId('settings-panel');
    await panel.waitFor();
    assert.match(await panel.textContent(), /只调整舆图与界面的观看方式/);
    assert.doesNotMatch(await panel.textContent(), /声音|音量|声景|试听/);
    assert.equal(await panel.locator('img, input[type="range"]').count(), 0);

    await panel.getByRole('button', { name: /^减少/ }).click();
    await panel.getByRole('button', { name: /^紧凑/ }).click();
    await panel.locator('.settings-switch-row input[type="checkbox"]').uncheck();
    const configured = await snapshot(page);
    assert.equal(configured.interface.settings.motion, 'reduced');
    assert.equal(configured.interface.settings.density, 'compact');
    assert.equal(configured.interface.settings.mapAtmosphere, false);
    assert.equal(configured.time.turn, baseline.time.turn);
    assert.equal(configured.deterministicWorldHash, baseline.deterministicWorldHash);
    const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), settingsKey);
    assert.equal(stored.motion, 'reduced');
    assert.equal('sound' in stored, false);

    const viewportFits = await page.evaluate(() => (
      document.documentElement.scrollWidth <= document.documentElement.clientWidth
      && document.documentElement.scrollHeight <= document.documentElement.clientHeight
    ));
    assert.equal(viewportFits, true);
    if (scenario.slug === 'mobile') {
      const close = panel.getByRole('button', { name: '关闭设置' });
      for (const button of [trigger, close]) {
        const box = await button.boundingBox();
        assert.ok(box && box.width >= 44 && box.height >= 44, '移动触控区应至少44px');
      }
    }
    await page.screenshot({ path: `${artifactDir}/${scenario.slug}-settings.png`, fullPage: true });
    await panel.getByRole('button', { name: '关闭设置' }).click();
    await page.waitForFunction(() => !JSON.parse(window.render_game_to_text()).interface.settings.open);
    assert.equal(await trigger.evaluate((element) => document.activeElement === element), true);
    assert.deepEqual(errors, []);
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}

console.log(`Settings E2E passed for ${scenarios.length} viewports (${version}).`);
