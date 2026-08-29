import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';
import { preview } from 'vite';
import packageJson from '../package.json';
import { createWorld, serializeWorld } from '../src/sim';

const PORT = Number(process.env.CONTEST_E2E_PORT ?? 4186);
const APP_URL = `http://127.0.0.1:${PORT}`;
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const ARTIFACT_DIR = fileURLToPath(new URL(`../output/contest-build-e2e-v${packageJson.version}/`, import.meta.url));
const privatePayload = serializeWorld(createWorld('参赛缺图恢复门禁', 'private-v03'));
const privateEnvelope = {
  schemaVersion: 1,
  savedAt: '2026-08-29T00:00:00.000Z',
  engineVersion: '1.0.0',
  payload: privatePayload,
  label: '旧卷留底',
};

async function state(page: Page): Promise<Record<string, any>> {
  return page.evaluate(() => JSON.parse((window as typeof window & { render_game_to_text(): string }).render_game_to_text()));
}

async function putAutosave(page: Page): Promise<void> {
  await page.evaluate((envelope) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('canghai-history-v01', 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('world-saves')) request.result.createObjectStore('world-saves');
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('world-saves', 'readwrite');
      transaction.objectStore('world-saves').put(envelope, 'autosave');
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    };
  }), privateEnvelope);
}

async function allSaves(page: Page): Promise<Array<{ key: IDBValidKey; value: typeof privateEnvelope }>> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('canghai-history-v01', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('world-saves', 'readonly');
      const store = transaction.objectStore('world-saves');
      const keys = store.getAllKeys();
      const values = store.getAll();
      transaction.oncomplete = () => {
        database.close();
        resolve(keys.result.map((key, index) => ({ key, value: values.result[index] })));
      };
      transaction.onerror = () => reject(transaction.error);
    };
  }));
}

await rm(ARTIFACT_DIR, { recursive: true, force: true });
await mkdir(ARTIFACT_DIR, { recursive: true });
const server = await preview({
  configFile: false,
  root: ROOT,
  build: { outDir: 'dist-contest' },
  preview: { host: '127.0.0.1', port: PORT, strictPort: true },
});
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});
const page = await context.newPage();
const errors: string[] = [];
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
page.on('pageerror', (error) => errors.push(String(error)));

try {
  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  await putAutosave(page);
  await page.evaluate(() => localStorage.setItem('canghai-map-primer-complete-v1', '1'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => typeof (window as typeof window & { render_game_to_text?: unknown }).render_game_to_text === 'function');
  await page.waitForSelector('#continue-world');

  const opening = await state(page);
  assert.equal(opening.productVersion, packageJson.version);
  assert.deepEqual(opening.availableMapProfiles.map((profile: { id: string }) => profile.id), ['contest-v01']);
  assert.equal(await page.locator('input[name="world-map-profile"]').count(), 1);
  assert.equal(await page.locator('input[name="world-map-profile"]').getAttribute('value'), 'contest-v01');

  await page.locator('#continue-world').tap();
  await page.waitForFunction(() => document.querySelector('.world-start__error')?.textContent?.includes('v03-82'));
  assert.match(await page.locator('.world-start__error').textContent() ?? '', /当前版本未包含/);
  assert.equal((await allSaves(page)).find((row) => row.key === 'autosave')?.value.payload, privatePayload);

  await page.locator('#open-world-collection').tap();
  const incompatible = page.locator('.world-collection__row[data-incompatible="true"]');
  await incompatible.waitFor();
  assert.match(await incompatible.textContent() ?? '', /地图未安装/);
  assert.equal(await incompatible.getByRole('button', { name: '读取' }).count(), 0);
  await page.screenshot({ path: `${ARTIFACT_DIR}/missing-map-collection.png`, fullPage: true });
  await page.locator('.world-collection').getByRole('button', { name: '关闭世界收藏' }).tap();

  await page.getByLabel('世界种子').fill('参赛公开试玩');
  await page.locator('#start-world').tap();
  await page.waitForSelector('.world-map[data-map-profile-id="contest-v01"]');
  const created = await state(page);
  assert.equal(created.mapContentVersion, 'contest-v01-68');
  assert.equal(created.mapProfile.revision, 1);

  const afterCreateRows = await allSaves(page);
  const recovery = afterCreateRows.find((row) => String(row.key).startsWith('v1:world:recovery_'));
  assert.ok(recovery, '新纪开始前必须自动复制缺图 autosave');
  assert.equal(recovery.value.payload, privatePayload, '留底副本必须逐字节保留原世界');

  await page.getByRole('button', { name: '推进至下一季' }).tap();
  await page.waitForFunction(() => JSON.parse((window as typeof window & { render_game_to_text(): string }).render_game_to_text()).time.turn === 1);
  const more = page.getByRole('button', { name: '打开更多工具' });
  if (await more.isVisible().catch(() => false)) await more.tap();
  await page.getByRole('button', { name: '返回世界书页' }).tap();
  await page.waitForSelector('#continue-world');

  const finalRows = await allSaves(page);
  const autosave = finalRows.find((row) => row.key === 'autosave');
  assert.equal(JSON.parse(autosave?.value.payload ?? '{}').mapContentVersion, 'contest-v01-68');
  assert.equal(finalRows.find((row) => row.key === recovery.key)?.value.payload, privatePayload);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: `${ARTIFACT_DIR}/contest-autosave-restored.png`, fullPage: true });
  process.stdout.write(`${JSON.stringify({
    version: packageJson.version,
    profile: 'contest-v01@1',
    touch: true,
    missingMapProtected: true,
    recoverySlot: recovery.key,
    turn: 1,
  }, null, 2)}\n`);
} finally {
  await context.close();
  await browser.close();
  await new Promise<void>((resolve, reject) => server.httpServer.close((error) => error ? reject(error) : resolve()));
}
