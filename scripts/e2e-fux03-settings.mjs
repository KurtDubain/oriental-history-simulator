import assert from 'node:assert/strict';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const PORT = Number(process.env.FUX03_E2E_PORT ?? 4187);
const APP_URL = `http://127.0.0.1:${PORT}`;
const PACKAGE_VERSION = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
const ARTIFACT_DIR = `output/fux03-settings-e2e-v${PACKAGE_VERSION}`;
const SETTINGS_KEY = 'canghai-observer-interface-settings-v1';

const SCENARIOS = Object.freeze([
  { slug: 'desktop', viewport: { width: 1280, height: 800 } },
  { slug: 'mobile', viewport: { width: 390, height: 844 } },
]);

function collectBrowserErrors(page, target) {
  page.on('console', (message) => {
    if (message.type() === 'error') target.push({ type: 'console.error', text: message.text() });
  });
  page.on('pageerror', (error) => target.push({ type: 'pageerror', text: String(error) }));
}

async function snapshot(page) {
  return page.evaluate(() => JSON.parse(window.render_game_to_text()));
}

async function waitForSettings(page, open) {
  await page.waitForFunction((expected) => {
    if (typeof window.render_game_to_text !== 'function') return false;
    return JSON.parse(window.render_game_to_text()).interface.settings.open === expected;
  }, open);
  return snapshot(page);
}

await rm(ARTIFACT_DIR, { recursive: true, force: true });
await mkdir(ARTIFACT_DIR, { recursive: true });

const server = await createServer({
  logLevel: 'error',
  server: { host: '127.0.0.1', port: PORT, strictPort: true },
});
await server.listen();

const browser = await chromium.launch({ headless: true });
try {
  for (const scenario of SCENARIOS) {
    const context = await browser.newContext({ viewport: scenario.viewport });
    const page = await context.newPage();
    const browserErrors = [];
    collectBrowserErrors(page, browserErrors);
    await page.addInitScript(() => {
      if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
      localStorage.setItem('canghai-map-primer-complete-v1', '1');
      localStorage.removeItem('canghai-observer-interface-settings-v1');
    });
    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    await page.getByLabel('世界种子').fill(`FUX03-${scenario.slug}`);
    await page.click('#start-world');
    await page.waitForSelector('.world-map__canvas');

    const baseline = await snapshot(page);
    assert.equal(baseline.productVersion, PACKAGE_VERSION);
    assert.equal(baseline.interface.settings.soundEnabled, false);
    assert.equal(baseline.interface.settings.mapAtmosphere, true);

    const trigger = page.locator('[data-settings-trigger="true"]');
    await trigger.click();
    const opened = await waitForSettings(page, true);
    assert.equal(opened.time.turn, baseline.time.turn, '打开设置不得推进季度');
    assert.equal(opened.deterministicWorldHash, baseline.deterministicWorldHash, '打开设置不得改变世界哈希');
    assert.equal(await page.locator('.observer-app').evaluate((element) => element.inert), true);

    const panel = page.getByTestId('settings-panel');
    await panel.waitFor();
    assert.equal(await panel.getAttribute('role'), 'dialog');
    assert.match(await panel.textContent(), /不改变人物选择、历史结果或世界种子/);
    const heroLoaded = await panel.locator('.settings-panel__hero img').evaluate((image) => (
      image.complete && image.naturalWidth >= 1_000 && image.naturalHeight >= 500
    ));
    assert.equal(heroLoaded, true, '设置题图应加载完整资源');

    const volumeInputs = panel.locator('input[type="range"]');
    assert.equal(await volumeInputs.count(), 3);
    for (let index = 0; index < 3; index += 1) {
      assert.equal(await volumeInputs.nth(index).isDisabled(), true, '声音关闭时音量滑杆必须禁用');
    }
    await page.screenshot({ path: `${ARTIFACT_DIR}/${scenario.slug}-settings-initial.png`, fullPage: true });

    const soundToggle = panel.locator('[data-testid="settings-sound-toggle"] input');
    await soundToggle.check();
    await volumeInputs.nth(0).fill('0.55');
    await panel.getByRole('button', { name: /^减少 / }).click();
    await panel.getByRole('button', { name: /紧凑/ }).click();
    const atmosphereToggle = panel.locator('.settings-switch-row input[type="checkbox"]').nth(1);
    await atmosphereToggle.uncheck();

    const configured = await snapshot(page);
    assert.equal(configured.interface.settings.soundEnabled, true);
    assert.equal(configured.interface.settings.motion, 'reduced');
    assert.equal(configured.interface.settings.density, 'compact');
    assert.equal(configured.interface.settings.mapAtmosphere, false);
    assert.ok(['ready', 'waiting', 'suspended'].includes(configured.interface.settings.audioState));
    assert.equal(configured.time.turn, baseline.time.turn);
    assert.equal(configured.deterministicWorldHash, baseline.deterministicWorldHash);
    const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), SETTINGS_KEY);
    assert.equal(stored.sound.masterVolume, 0.55);
    assert.equal(stored.motion, 'reduced');

    const viewportFits = await page.evaluate(() => (
      document.documentElement.scrollWidth <= document.documentElement.clientWidth
      && document.documentElement.scrollHeight <= document.documentElement.clientHeight
    ));
    assert.equal(viewportFits, true, `${scenario.slug} 设置页不得产生整页溢出`);
    if (scenario.slug === 'mobile') {
      const triggerBounds = await trigger.boundingBox();
      const closeBounds = await panel.locator('.settings-panel__hero > button').boundingBox();
      assert.ok(triggerBounds && triggerBounds.width >= 44 && triggerBounds.height >= 44, '移动端设置入口触控区至少 44px');
      assert.ok(closeBounds && closeBounds.width >= 44 && closeBounds.height >= 44, '移动端关闭触控区至少 44px');
    }

    await page.screenshot({ path: `${ARTIFACT_DIR}/${scenario.slug}-settings.png`, fullPage: true });
    await panel.locator('.settings-panel__hero > button').click();
    const closed = await waitForSettings(page, false);
    assert.equal(closed.deterministicWorldHash, baseline.deterministicWorldHash);
    assert.equal(await page.locator('.observer-app').getAttribute('data-motion'), 'reduced');
    assert.equal(await page.locator('.observer-app').getAttribute('data-interface-density'), 'compact');
    assert.equal(await page.locator('.world-map').getAttribute('data-atmosphere'), null);
    assert.equal(await trigger.evaluate((element) => document.activeElement === element), true, '关闭设置后应归还焦点');
    await page.screenshot({ path: `${ARTIFACT_DIR}/${scenario.slug}-map.png`, fullPage: true });

    assert.deepEqual(browserErrors, [], `${scenario.slug} 不应出现浏览器错误`);
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}

console.log(`FUX03 settings E2E passed for ${SCENARIOS.length} viewports (${PACKAGE_VERSION}).`);
