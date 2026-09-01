import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const PORT = Number(process.env.RELATION_E2E_PORT ?? 4191);
const externalUrl = process.env.RELATION_E2E_URL;
const APP_URL = externalUrl ?? `http://127.0.0.1:${PORT}`;
const ARTIFACT_DIR = 'output/person-relationship-e2e';
const SUBJECT_ID = 'c_145';
const SUBJECT_NAME = '顾允谦';
const EXPECTED_PEERS = new Map([
  ['c_153', '顾允亮'],
  ['c_154', '顾允钧'],
  ['c_156', '顾允璋'],
]);

await mkdir(ARTIFACT_DIR, { recursive: true });
const server = externalUrl ? null : await createServer({
  logLevel: 'error',
  server: { host: '127.0.0.1', port: PORT, strictPort: true },
});
await server?.listen();
let browser = null;

async function state(page) {
  return JSON.parse(await page.evaluate(() => window.render_game_to_text()));
}

async function openRelationships(page, mobile) {
  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  await page.locator('#start-world').click();
  await page.waitForSelector('.world-map__canvas');
  const skip = page.locator('[data-map-primer-skip]');
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await page.locator('button[data-observer-view="people"]').click();
  await page.getByLabel('检索时人群像').fill(SUBJECT_NAME);
  await page.locator(`.roster-panel button[data-roster-id="${SUBJECT_ID}"]`).click();
  await page.waitForFunction((id) => JSON.parse(window.render_game_to_text()).interface.selected?.id === id, SUBJECT_ID);
  if (mobile) {
    const inspector = page.locator('.observer-inspector');
    if (await inspector.getAttribute('data-mobile-expanded') !== 'true') {
      await page.locator('.observer-inspector__mobile-handle').click();
    }
    await page.waitForFunction(() => document.querySelector('.observer-inspector')?.getAttribute('data-mobile-expanded') === 'true');
  }
  await page.getByRole('tab', { name: '关系', exact: true }).click();
  await page.waitForSelector('.observer-relationship-map__node');
}

async function verify(viewport, slug) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  await openRelationships(page, viewport.width <= 640);

  const before = await state(page);
  const relationships = before.interface.selectedDetail.relationships;
  assert.equal(relationships.length, 3, `${slug} 文本快照应只有三名关系人`);
  assert.equal(new Set(relationships.map((entry) => entry.targetId)).size, 3, `${slug} 文本快照不得重复 targetId`);
  for (const entry of relationships) {
    assert.equal(entry.with, EXPECTED_PEERS.get(entry.targetId), `${slug} 关系人姓名与 ID 必须一致`);
    assert.match(entry.detail, new RegExp(`${SUBJECT_NAME}：.+；${entry.with}：`), `${slug} 应分开说明双方态度`);
  }

  const nodes = page.locator('.observer-relationship-map__node');
  const rows = page.locator('.observer-relation-list > li');
  assert.equal(await nodes.count(), 3, `${slug} 星图应只有三个人物节点`);
  assert.equal(await rows.count(), 3, `${slug} 列表应只有三个人物行`);
  const ariaLabels = await nodes.evaluateAll((items) => items.map((item) => item.getAttribute('aria-label')));
  assert.equal(new Set(ariaLabels.map((label) => label?.split('，')[0])).size, 3, `${slug} 星图姓名不得重复`);
  const layout = await page.locator('.observer-inspector').evaluate((element) => ({
    left: element.getBoundingClientRect().left,
    right: element.getBoundingClientRect().right,
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  assert.ok(layout.left >= 0 && layout.right <= layout.viewport + 1, `${slug} 人物档案不得横向溢出`);
  assert.ok(layout.documentWidth <= layout.viewport + 1, `${slug} 双向态度文案不得撑宽页面`);
  await page.screenshot({ path: `${ARTIFACT_DIR}/${slug}.png`, fullPage: true });
  await rows.first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${ARTIFACT_DIR}/${slug}-list.png`, fullPage: false });

  const firstTargetId = relationships[0].targetId;
  await nodes.first().click();
  await page.waitForFunction((id) => JSON.parse(window.render_game_to_text()).interface.selected?.id === id, firstTargetId);
  const after = await state(page);
  assert.equal(after.deterministicWorldHash, before.deterministicWorldHash, `${slug} 查看关系人物不得改变世界`);
  assert.deepEqual(errors, [], `${slug} 不应产生浏览器错误`);
  await context.close();
}

try {
  browser = await chromium.launch({ headless: true });
  await verify({ width: 1440, height: 900 }, 'desktop-1440x900');
  await verify({ width: 390, height: 844 }, 'mobile-390x844');
  process.stdout.write('Person relationship E2E passed: 3 unique peers on desktop and mobile.\n');
} finally {
  await browser?.close();
  await server?.close();
}
