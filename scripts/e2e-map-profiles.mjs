import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const PORT = Number(process.env.MAP_PROFILE_E2E_PORT ?? 4184);
const APP_URL = `http://127.0.0.1:${PORT}`;
const PACKAGE_VERSION = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
const ARTIFACT_DIR = `output/map-profiles-e2e-v${PACKAGE_VERSION}`;

const ALL_SCENARIOS = Object.freeze([
  {
    slug: 'desktop-private',
    viewport: { width: 1280, height: 820 },
    profileId: 'private-v03',
    revision: 1,
    contentVersion: 'v03-82',
    name: '心中山河',
    regions: 82,
    seaZones: 10,
    seed: '双图门禁-桌面私图',
  },
  {
    slug: 'desktop-contest',
    viewport: { width: 1280, height: 820 },
    profileId: 'contest-v01',
    revision: 1,
    contentVersion: 'contest-v01-68',
    name: '云海八荒',
    regions: 68,
    seaZones: 10,
    seed: '双图门禁-桌面赛图',
  },
  {
    slug: 'mobile-private',
    viewport: { width: 390, height: 844 },
    profileId: 'private-v03',
    revision: 1,
    contentVersion: 'v03-82',
    name: '心中山河',
    regions: 82,
    seaZones: 10,
    seed: '双图门禁-窄屏私图',
  },
  {
    slug: 'mobile-contest',
    viewport: { width: 390, height: 844 },
    profileId: 'contest-v01',
    revision: 1,
    contentVersion: 'contest-v01-68',
    name: '云海八荒',
    regions: 68,
    seaZones: 10,
    seed: '双图门禁-窄屏赛图',
  },
  {
    slug: 'wide-mobile-private',
    viewport: { width: 640, height: 900 },
    profileId: 'private-v03',
    revision: 1,
    contentVersion: 'v03-82',
    name: '心中山河',
    regions: 82,
    seaZones: 10,
    seed: '双图门禁-宽屏私图',
  },
  {
    slug: 'wide-mobile-contest',
    viewport: { width: 640, height: 900 },
    profileId: 'contest-v01',
    revision: 1,
    contentVersion: 'contest-v01-68',
    name: '云海八荒',
    regions: 68,
    seaZones: 10,
    seed: '双图门禁-宽屏赛图',
  },
]);
const requestedScenario = process.env.MAP_PROFILE_E2E_SCENARIO;
const SCENARIOS = requestedScenario
  ? ALL_SCENARIOS.filter((scenario) => scenario.slug === requestedScenario)
  : ALL_SCENARIOS;
assert.ok(SCENARIOS.length > 0, `未知双图 E2E 场景：${requestedScenario}`);

function collectBrowserErrors(page, target) {
  page.on('console', (message) => {
    if (message.type() === 'error') target.push({ type: 'console.error', text: message.text() });
  });
  page.on('pageerror', (error) => target.push({ type: 'pageerror', text: String(error) }));
}

async function state(page) {
  return page.evaluate(() => JSON.parse(window.render_game_to_text()));
}

async function waitForState(page, predicate, argument, timeout = 20_000) {
  await page.waitForFunction(
    ({ source, argument: innerArgument }) => {
      if (typeof window.render_game_to_text !== 'function') return false;
      const current = JSON.parse(window.render_game_to_text());
      return Function('current', 'argument', `return (${source})(current, argument);`)(current, innerArgument);
    },
    { source: predicate.toString(), argument },
    { timeout },
  );
  return state(page);
}

async function readIndexedDbRow(page, key) {
  return page.evaluate((storageKey) => new Promise((resolve, reject) => {
    const request = indexedDB.open('canghai-history-v01', 1);
    request.onerror = () => reject(request.error ?? new Error('无法打开世界存档数据库'));
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('world-saves', 'readonly');
      const row = transaction.objectStore('world-saves').get(storageKey);
      row.onerror = () => reject(row.error ?? new Error(`无法读取存档 ${storageKey}`));
      row.onsuccess = () => {
        resolve(row.result ?? null);
        database.close();
      };
    };
  }), key);
}

function assertProfileState(current, scenario, expectedTurn, expectedHash = null) {
  assert.equal(current.mode, 'observing', `${scenario.slug} 应处于观察模式`);
  assert.equal(current.productVersion, PACKAGE_VERSION);
  assert.equal(current.mapContentVersion, scenario.contentVersion, `${scenario.slug} 世界正文必须绑定地图内容版本`);
  assert.deepEqual(
    current.mapProfile,
    { id: scenario.profileId, revision: scenario.revision, name: scenario.name },
    `${scenario.slug} 必须解析到精确地图修订`,
  );
  assert.equal(current.totals.regions, scenario.regions);
  assert.equal(current.totals.seaZones, scenario.seaZones);
  assert.equal(current.time.turn, expectedTurn);
  if (expectedHash !== null) assert.equal(current.deterministicWorldHash, expectedHash);
}

async function assertStartLayout(page, scenario) {
  const start = await state(page);
  assert.equal(start.mode, 'start');
  assert.equal(start.mapProfile.id, 'private-v03', '完整个人版默认选择私人地图');
  assert.deepEqual(
    start.availableMapProfiles.map((profile) => profile.id),
    ['private-v03', 'contest-v01'],
    '完整构建开篇必须稳定列出两张舆图',
  );
  const radios = page.locator('input[name="world-map-profile"]');
  assert.equal(await radios.count(), 2);
  for (let index = 0; index < 2; index += 1) {
    const bounds = await radios.nth(index).boundingBox();
    assert.ok(bounds && bounds.width >= 44 && bounds.height >= 44, `${scenario.slug} 地图卡触控目标不得小于44px`);
    assert.ok(
      bounds.x >= 0 && bounds.x + bounds.width <= scenario.viewport.width + 1,
      `${scenario.slug} 地图卡不得横向越界`,
    );
  }
  assert.equal(await page.getByLabel('世界种子').isVisible(), true, `${scenario.slug} 种子输入必须可见`);
  const startBounds = await page.locator('#start-world').boundingBox();
  assert.ok(startBounds && startBounds.width >= 44 && startBounds.height >= 44, `${scenario.slug} 开启按钮不得小于44px`);
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    true,
    `${scenario.slug} 开篇不得横向溢出`,
  );
}

async function selectProfileAndCreate(page, scenario) {
  await page.locator(`input[name="world-map-profile"][value="${scenario.profileId}"]`).click();
  const selected = await waitForState(
    page,
    (current, profileId) => current.mode === 'start' && current.mapProfile.id === profileId,
    scenario.profileId,
  );
  assert.equal('deterministicWorldHash' in selected, false, `${scenario.slug} 选图不得提前创建世界`);
  assert.equal(selected.mapProfile.revision, scenario.revision);
  await page.screenshot({ path: `${ARTIFACT_DIR}/${scenario.slug}-start-selected.png`, fullPage: true });

  await page.getByLabel('世界种子').fill(scenario.seed);
  assert.equal((await state(page)).mapProfile.id, scenario.profileId, `${scenario.slug} 填种子不得重置选图`);
  await page.locator('#start-world').click();
  await page.waitForSelector('.world-map__canvas');
  const created = await waitForState(
    page,
    (current, profileId) => current.mode === 'observing' && current.mapProfile.id === profileId,
    scenario.profileId,
  );
  assertProfileState(created, scenario, 0);
  assert.equal(created.seed, scenario.seed);

  const map = page.locator('.world-map');
  assert.equal(await map.getAttribute('data-map-profile-id'), scenario.profileId);
  assert.equal(await map.getAttribute('data-map-content-version'), scenario.contentVersion);
  assert.equal(await map.getAttribute('data-map-layout'), `${scenario.profileId}-r${scenario.revision}`);
  return created;
}

async function clickVisibleMapObject(page, scenario) {
  const canvas = page.locator('.world-map__canvas');
  await canvas.scrollIntoViewIfNeeded();
  const bounds = await canvas.boundingBox();
  assert.ok(bounds && bounds.width > 100 && bounds.height > 100, `${scenario.slug} 舆图必须可见`);
  const original = await state(page);
  let hit = null;
  const horizontal = [0.22, 0.35, 0.48, 0.61, 0.74, 0.86];
  const vertical = [0.2, 0.34, 0.48, 0.62, 0.76];
  if (scenario.viewport.width <= 760) {
    assert.ok(await page.evaluate(() => navigator.maxTouchPoints > 0), `${scenario.slug} 必须运行在真实触控上下文`);
    for (const yRatio of vertical) {
      for (const xRatio of horizontal) {
        const x = bounds.x + bounds.width * xRatio;
        const y = bounds.y + bounds.height * yRatio;
        await page.touchscreen.tap(x, y);
        await page.waitForTimeout(35);
        const current = await state(page);
        if (current.interface.selected !== null && current.interface.selectedDetail !== null) {
          hit = { x, y };
          break;
        }
      }
      if (hit) break;
    }
  } else {
  for (const yRatio of vertical) {
    for (const xRatio of horizontal) {
      const x = bounds.x + bounds.width * xRatio;
      const y = bounds.y + bounds.height * yRatio;
      await page.mouse.move(x, y);
      await page.waitForTimeout(20);
      if (await page.locator('.world-map').getAttribute('data-hover-object') === 'true') {
        hit = { x, y };
        break;
      }
    }
    if (hit) break;
  }
  }
  assert.ok(hit, `${scenario.slug} 至少应有一个可由指针命中的地图对象`);
  if (scenario.viewport.width > 760) await page.mouse.click(hit.x, hit.y);
  const selected = await waitForState(
    page,
    (current) => current.interface.selected !== null && current.interface.selectedDetail !== null,
  );
  assert.ok(selected.interface.selected.id, `${scenario.slug} 地图点选应产生明确对象`);
  assert.equal(selected.deterministicWorldHash, original.deterministicWorldHash, `${scenario.slug} 地图点选不得改变世界`);

  const close = page.locator('.observer-inspector button[aria-label="关闭档案"]');
  if (await close.isVisible().catch(() => false)) {
    await close.click();
    await page.waitForSelector('.observer-inspector', { state: 'detached' });
  }
  return selected.interface.selected;
}

async function advanceOneQuarter(page, scenario) {
  const before = await state(page);
  await page.locator('button[aria-label="推进至下一季"]').click();
  const advanced = await waitForState(page, (current, turn) => current.time.turn === turn, before.time.turn + 1);
  assertProfileState(advanced, scenario, before.time.turn + 1);
  assert.notEqual(advanced.deterministicWorldHash, before.deterministicWorldHash);
  const fatal = page.locator('.observer-fatal');
  assert.equal(await fatal.count(), 0, `${scenario.slug} 推进不得进入致命错误态`);
  return advanced;
}

async function exposeSecondaryTool(page, selector) {
  const target = page.locator(selector);
  if (await target.isVisible().catch(() => false)) return target;
  const more = page.getByRole('button', { name: '打开更多工具' });
  await more.click();
  await target.waitFor({ state: 'visible' });
  return target;
}

async function verifyAutosaveRoundTrip(page, scenario, savedState) {
  const returnButton = await exposeSecondaryTool(page, 'button[aria-label="返回世界书页"]');
  await returnButton.click();
  await page.waitForSelector('#continue-world');
  const menu = await waitForState(page, (current) => current.mode === 'world-menu');
  assert.equal(menu.mapProfile.id, scenario.profileId);
  assert.equal(menu.mapProfile.revision, scenario.revision);

  const envelope = await readIndexedDbRow(page, 'autosave');
  assert.ok(envelope?.payload, `${scenario.slug} 返回书页必须落下 autosave`);
  const persisted = JSON.parse(envelope.payload);
  assert.equal(persisted.turn, savedState.time.turn);
  assert.equal(persisted.hash, savedState.deterministicWorldHash);
  assert.equal(persisted.mapContentVersion, scenario.contentVersion);

  await page.locator('#continue-world').click();
  await page.waitForSelector('.world-map__canvas');
  const restored = await waitForState(
    page,
    (current, hash) => current.mode === 'observing' && current.deterministicWorldHash === hash,
    savedState.deterministicWorldHash,
  );
  assertProfileState(restored, scenario, savedState.time.turn, savedState.deterministicWorldHash);
  return restored;
}

async function openCollection(page) {
  const trigger = await exposeSecondaryTool(page, 'button[data-world-collection-trigger="true"]');
  await trigger.click();
  const panel = page.locator('.world-collection');
  await panel.waitFor();
  await page.waitForFunction(() => document.querySelector('.world-collection')?.getAttribute('aria-busy') === 'false');
  return panel;
}

async function verifyCollectionRoundTrip(page, scenario, savedState) {
  const label = `双图门禁·${scenario.slug}`;
  let panel = await openCollection(page);
  await panel.locator('input[placeholder="例如：北海兴亡录"]').fill(label);
  await panel.getByRole('button', { name: '存入收藏' }).click();
  const rowFor = () => panel.locator('.world-collection__row').filter({ hasText: label });
  const savedRow = rowFor();
  await savedRow.waitFor();
  const savedCopy = await savedRow.textContent();
  assert.match(savedCopy, new RegExp(`${scenario.name}\\s*·\\s*第 ${scenario.revision} 版`));
  assert.match(savedCopy, new RegExp(scenario.seed));
  const panelBounds = await panel.boundingBox();
  assert.ok(
    panelBounds && panelBounds.x >= 0 && panelBounds.x + panelBounds.width <= scenario.viewport.width + 1,
    `${scenario.slug} 世界收藏不得横向越界`,
  );
  await page.screenshot({ path: `${ARTIFACT_DIR}/${scenario.slug}-collection.png`, fullPage: true });
  await panel.getByRole('button', { name: '关闭世界收藏' }).click();
  await panel.waitFor({ state: 'detached' });

  const later = await advanceOneQuarter(page, scenario);
  assert.notEqual(later.deterministicWorldHash, savedState.deterministicWorldHash);
  panel = await openCollection(page);
  const loadRow = panel.locator('.world-collection__row').filter({ hasText: label });
  await loadRow.getByRole('button', { name: '读取' }).click();
  await panel.waitFor({ state: 'detached' });
  const restored = await waitForState(
    page,
    (current, hash) => current.mode === 'observing' && current.deterministicWorldHash === hash,
    savedState.deterministicWorldHash,
  );
  assertProfileState(restored, scenario, savedState.time.turn, savedState.deterministicWorldHash);
  return restored;
}

async function runScenario(browser, scenario) {
  const context = await browser.newContext({
    viewport: scenario.viewport,
    ...(scenario.viewport.width <= 760 ? { hasTouch: true, isMobile: true } : {}),
  });
  const page = await context.newPage();
  const errors = [];
  collectBrowserErrors(page, errors);
  await page.addInitScript(() => localStorage.setItem('canghai-map-primer-complete-v1', '1'));
  try {
    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
    await assertStartLayout(page, scenario);
    await selectProfileAndCreate(page, scenario);
    const selected = await clickVisibleMapObject(page, scenario);
    const turnOne = await advanceOneQuarter(page, scenario);
    const autosaveRestored = await verifyAutosaveRoundTrip(page, scenario, turnOne);
    const collectionRestored = await verifyCollectionRoundTrip(page, scenario, autosaveRestored);
    const shellLayout = await page.evaluate(() => {
      const shellElement = document.querySelector('.observer-app');
      const stageElement = document.querySelector('.observer-stage');
      const topbarElement = document.querySelector('.observer-topbar');
      const shell = shellElement?.getBoundingClientRect();
      const stage = stageElement?.getBoundingClientRect();
      const topbar = topbarElement?.getBoundingClientRect();
      const shellStyle = shellElement ? getComputedStyle(shellElement) : null;
      const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const focusedRect = focused?.getBoundingClientRect();
      const toolsElement = document.querySelector('.observer-world-tools');
      const toolsRect = toolsElement?.getBoundingClientRect();
      const topbarStyle = topbarElement ? getComputedStyle(topbarElement) : null;
      return {
        shell: shell ? { x: shell.x, width: shell.width } : null,
        stage: stage ? { x: stage.x, width: stage.width } : null,
        topbar: topbar ? { x: topbar.x, width: topbar.width } : null,
        shellScrollLeft: shellElement?.scrollLeft ?? null,
        shellScrollWidth: shellElement?.scrollWidth ?? null,
        shellGridColumns: shellStyle?.gridTemplateColumns ?? null,
        shellOverflowX: shellStyle?.overflowX ?? null,
        activeElement: focused
          ? `${focused.tagName.toLowerCase()}.${focused.className}`
          : null,
        activeElementRect: focusedRect
          ? { x: focusedRect.x, width: focusedRect.width, right: focusedRect.right }
          : null,
        tools: toolsRect
          ? { x: toolsRect.x, width: toolsRect.width, right: toolsRect.right, scrollWidth: toolsElement?.scrollWidth }
          : null,
        topbarScrollWidth: topbarElement?.scrollWidth ?? null,
        topbarGridColumns: topbarStyle?.gridTemplateColumns ?? null,
        topbarChildren: topbarElement
          ? Array.from(topbarElement.children).map((child) => {
            const rect = child.getBoundingClientRect();
            return { className: child.className, x: rect.x, width: rect.width, right: rect.right };
          })
          : [],
        shellChildren: shellElement
          ? Array.from(shellElement.children).map((child) => {
            const rect = child.getBoundingClientRect();
            const element = child;
            const style = getComputedStyle(element);
            return {
              className: element.className,
              x: rect.x,
              width: rect.width,
              right: rect.right,
              scrollWidth: element.scrollWidth,
              position: style.position,
              gridColumn: style.gridColumn,
            };
          })
          : [],
        stageScrollWidth: stageElement?.scrollWidth ?? null,
        innerWidth: window.innerWidth,
      };
    });
    assert.ok(
      shellLayout.shell && shellLayout.shell.x === 0 && shellLayout.shell.width >= scenario.viewport.width - 1,
      `${scenario.slug} 世界外壳必须使用完整视口：${JSON.stringify(shellLayout)}`,
    );
    if (scenario.viewport.width <= 760) {
      assert.ok(
        shellLayout.stage && shellLayout.stage.x === 0 && shellLayout.stage.width >= scenario.viewport.width - 1,
        `${scenario.slug} 移动舆图必须使用完整视口：${JSON.stringify(shellLayout)}`,
      );
    }
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      true,
      `${scenario.slug} 世界界面不得横向溢出`,
    );
    await page.screenshot({ path: `${ARTIFACT_DIR}/${scenario.slug}-restored.png`, fullPage: true });
    assert.deepEqual(errors, [], `${scenario.slug} 不得产生 console/page error`);
    return {
      scenario: scenario.slug,
      profile: `${scenario.profileId}@${scenario.revision}`,
      viewport: `${scenario.viewport.width}x${scenario.viewport.height}`,
      selected: `${selected.kind}:${selected.id}`,
      turn: collectionRestored.time.turn,
      hash: collectionRestored.deterministicWorldHash,
    };
  } catch (error) {
    await page.screenshot({ path: `${ARTIFACT_DIR}/${scenario.slug}-failure.png`, fullPage: true }).catch(() => undefined);
    await writeFile(
      `${ARTIFACT_DIR}/${scenario.slug}-failure.json`,
      `${JSON.stringify({ error: String(error), browserErrors: errors }, null, 2)}\n`,
    );
    throw error;
  } finally {
    await context.close();
  }
}

await rm(ARTIFACT_DIR, { recursive: true, force: true });
await mkdir(ARTIFACT_DIR, { recursive: true });
const server = await createServer({
  logLevel: 'error',
  server: { host: '127.0.0.1', port: PORT, strictPort: true },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const results = [];
  for (const scenario of SCENARIOS) results.push(await runScenario(browser, scenario));
  process.stdout.write(`MAP05 profile E2E passed (${PACKAGE_VERSION}): ${results.map((result) => (
    `${result.scenario} ${result.profile} ${result.viewport} T${result.turn} ${result.hash.slice(0, 12)} ${result.selected}`
  )).join(' | ')}\n`);
} finally {
  await browser?.close();
  await server.close();
}
