import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { preview } from 'vite';

const APP_URL = 'http://127.0.0.1:4176';
const PACKAGE_VERSION = JSON.parse(await readFile('package.json', 'utf8')).version;
const ARTIFACT_DIR = `output/app-update-v${PACKAGE_VERSION}`;

const deployed = JSON.parse(await readFile('dist/version.json', 'utf8'));
assert.equal(deployed.version, PACKAGE_VERSION);
assert.equal(typeof deployed.buildId, 'string');
assert.ok(deployed.buildId.length > 0);

const vercel = JSON.parse(await readFile('vercel.json', 'utf8'));
const versionHeaders = vercel.headers?.find((entry) => entry.source === '/version.json')?.headers ?? [];
assert.ok(
  versionHeaders.some((entry) => entry.key === 'Cache-Control' && /no-store/.test(entry.value)),
  'version.json 必须由 Vercel 明确禁止缓存',
);
const appFallback = vercel.rewrites?.find((entry) => entry.destination === '/index.html');
assert.ok(appFallback, 'Vercel 必须保留单页应用回退');
const appFallbackPattern = new RegExp(`^${appFallback.source}$`);
assert.equal(appFallbackPattern.test('/version.json'), false, '单页应用回退不得拦截 version.json');
assert.equal(appFallbackPattern.test('/history'), true, '普通应用路径必须继续回退到 index.html');

await mkdir(ARTIFACT_DIR, { recursive: true });
const server = await preview({
  logLevel: 'error',
  preview: { host: '127.0.0.1', port: 4176, strictPort: true },
});
const browser = await chromium.launch();

async function state(page) {
  return page.evaluate(() => JSON.parse(window.render_game_to_text()));
}

async function readAutosave(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('canghai-history-v01', 1);
    request.onerror = () => reject(request.error ?? new Error('无法打开自动存档数据库'));
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('world-saves', 'readonly');
      const row = transaction.objectStore('world-saves').get('autosave');
      row.onerror = () => reject(row.error ?? new Error('无法读取自动存档'));
      row.onsuccess = () => {
        try {
          resolve(row.result?.payload ? JSON.parse(row.result.payload) : null);
        } catch (error) {
          reject(error);
        } finally {
          database.close();
        }
      };
    };
  }));
}

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.addInitScript(() => localStorage.setItem('canghai-map-primer-complete-v1', '1'));
  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).appUpdate.phase === 'current');
  await page.click('#start-world');
  await page.waitForSelector('.world-map__canvas');
  await page.click('button[aria-label="推进至下一季"]');
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).time.turn === 1);
  const before = await state(page);

  await page.locator('[data-observer-desk-trigger="true"]').click();
  await page.waitForSelector('.observer-desk');
  const release = page.locator('.observer-desk__release');
  await release.scrollIntoViewIfNeeded();
  await release.getByTestId('check-app-update').click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).appUpdate.phase === 'current');
  assert.equal((await state(page)).deterministicWorldHash, before.deterministicWorldHash);

  await page.route('**/version.json?*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ version: '99.0.0', buildId: 'remote-build-future' }),
  }));
  await release.getByTestId('check-app-update').click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).appUpdate.phase === 'available');
  assert.match(await release.getByTestId('app-update-status').textContent(), /发现 v99\.0\.0/);
  assert.equal((await state(page)).deterministicWorldHash, before.deterministicWorldHash);
  assert.match(await page.locator('[data-observer-desk-trigger="true"]').getAttribute('aria-label'), /发现新版本/);
  await page.screenshot({ path: `${ARTIFACT_DIR}/desktop-update-available.png`, fullPage: true });

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    release.getByTestId('apply-app-update').click(),
  ]);
  const saved = await readAutosave(page);
  assert.equal(saved?.turn, before.time.turn, '更新重载前必须保存最新季度');
  assert.equal(saved?.hash, before.deterministicWorldHash, '更新重载前必须保存同一世界哈希');
  assert.deepEqual(errors, []);

  await page.unroute('**/version.json?*');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).appUpdate.phase === 'current');
  await page.click('#start-world');
  await page.waitForSelector('.world-map__canvas');
  await page.locator('[data-observer-desk-trigger="true"]').click();
  await page.waitForSelector('.observer-desk');
  const mobileRelease = page.locator('.observer-desk__release');
  await mobileRelease.scrollIntoViewIfNeeded();
  const mobileButton = mobileRelease.getByTestId('check-app-update');
  const bounds = await mobileButton.boundingBox();
  assert.ok(bounds && bounds.width >= 44 && bounds.height >= 44, '移动端检查更新必须满足44px触控目标');
  const deskBounds = await page.locator('.observer-desk').boundingBox();
  assert.ok(deskBounds && deskBounds.x >= 0 && deskBounds.x + deskBounds.width <= 390, '观察台不得越出移动端视口');
  await page.screenshot({ path: `${ARTIFACT_DIR}/mobile-version-entry.png`, fullPage: true });

  await context.close();
  console.log('App update verification passed: current → available → safe autosave reload + mobile entry.');
} finally {
  await browser.close();
  await new Promise((resolve, reject) => server.httpServer.close((error) => (error ? reject(error) : resolve())));
}
