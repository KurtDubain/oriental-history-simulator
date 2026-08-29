import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const PORT = Number(process.env.TRIM01_E2E_PORT ?? 4192);
const externalUrl = process.env.TRIM01_E2E_URL;
const APP_URL = externalUrl ?? `http://127.0.0.1:${PORT}`;
const ARTIFACT_DIR = 'output/trim01-quarter-e2e';
const QUARTERS = 8;

const SCENARIOS = Object.freeze([
  { slug: 'desktop-1440x900', viewport: { width: 1440, height: 900 } },
  { slug: 'mobile-390x844', viewport: { width: 390, height: 844 } },
  { slug: 'mobile-wide-640x900', viewport: { width: 640, height: 900 } },
]);

function collectBrowserErrors(page, target) {
  page.on('console', (message) => {
    if (message.type() === 'error') {
      target.push({ type: 'console.error', text: message.text() });
    }
  });
  page.on('pageerror', (error) => {
    target.push({ type: 'pageerror', text: String(error) });
  });
}

async function snapshot(page) {
  return page.evaluate(() => JSON.parse(window.render_game_to_text()));
}

async function waitForTurn(page, turn) {
  await page.waitForFunction((expectedTurn) => {
    if (typeof window.render_game_to_text !== 'function') return false;
    const current = JSON.parse(window.render_game_to_text());
    return current.time?.turn === expectedTurn
      && current.interface?.quarterPulse?.turn === expectedTurn - 1;
  }, turn, { timeout: 15_000 });
  return snapshot(page);
}

async function domStories(page) {
  return page.locator(
    '[data-testid="quarter-pulse"] .quarter-pulse__event-list > li[data-story-kind]',
  ).evaluateAll((items) => items.map((item) => ({
    id: item.getAttribute('data-story-id'),
    kind: item.getAttribute('data-story-kind'),
    title: item.querySelector('.quarter-pulse__event > strong')?.textContent?.trim() ?? '',
  })));
}

async function assertNoPageOverflow(page, scenario) {
  const layout = await page.evaluate(() => {
    const app = document.querySelector('.observer-app');
    const pulse = document.querySelector('[data-testid="quarter-pulse"]');
    const appRect = app?.getBoundingClientRect();
    const pulseRect = pulse?.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      documentWidth: document.documentElement.scrollWidth,
      documentHeight: document.documentElement.scrollHeight,
      app: appRect ? {
        left: appRect.left,
        right: appRect.right,
        top: appRect.top,
        bottom: appRect.bottom,
      } : null,
      pulse: pulseRect ? {
        left: pulseRect.left,
        right: pulseRect.right,
        top: pulseRect.top,
        bottom: pulseRect.bottom,
      } : null,
    };
  });

  assert.ok(layout.app, `${scenario.slug} 应渲染观察台外壳`);
  assert.ok(layout.pulse, `${scenario.slug} 应渲染本季变化`);
  assert.ok(
    layout.documentWidth <= layout.viewportWidth + 1,
    `${scenario.slug} 页面不得横向溢出：${layout.documentWidth} > ${layout.viewportWidth}`,
  );
  assert.ok(
    layout.documentHeight <= layout.viewportHeight + 1,
    `${scenario.slug} 页面不得纵向溢出：${layout.documentHeight} > ${layout.viewportHeight}`,
  );
  assert.ok(
    layout.app.left >= -1
      && layout.app.right <= layout.viewportWidth + 1
      && layout.app.top >= -1
      && layout.app.bottom <= layout.viewportHeight + 1,
    `${scenario.slug} 观察台外壳必须完整落在视口内`,
  );
  assert.ok(
    layout.pulse.left >= -1
      && layout.pulse.right <= layout.viewportWidth + 1
      && layout.pulse.top >= -1
      && layout.pulse.bottom <= layout.viewportHeight + 1,
    `${scenario.slug} 本季变化不得被视口或外壳裁切：${JSON.stringify(layout)}`,
  );
}

async function assertQuarterProjection(page, scenario, current) {
  const pulse = page.getByTestId('quarter-pulse');
  const storyCount = Number(await pulse.getAttribute('data-story-count'));
  const reportTurn = Number(await pulse.getAttribute('data-turn'));
  const stories = await domStories(page);
  const projected = current.interface?.quarterPulse;

  assert.ok(projected, `${scenario.slug} 文本快照应公开 quarterPulse`);
  assert.equal(reportTurn, current.time.turn - 1, `${scenario.slug} 季报季度必须对应刚结算的一季`);
  assert.equal(projected.turn, reportTurn, `${scenario.slug} 文本季报与 DOM 季度必须一致`);
  assert.equal(storyCount, stories.length, `${scenario.slug} data-story-count 必须等于实际 DOM 条数`);
  assert.equal(projected.storyCount, stories.length, `${scenario.slug} 文本季报条数必须等于 DOM 条数`);
  assert.ok(stories.length <= 3, `${scenario.slug} 每季最多展示三件具体事，实际 ${stories.length}`);
  assert.equal(
    new Set(stories.map((story) => story.id)).size,
    stories.length,
    `${scenario.slug} 同一季不得重复 story id`,
  );
  assert.ok(
    stories.every((story) => story.id && story.title && ['situation', 'event'].includes(story.kind)),
    `${scenario.slug} 每件事必须有稳定 id、具体标题和合法类型`,
  );

  assert.deepEqual(
    projected.stories.map((story) => ({ id: story.id, kind: story.kind, title: story.title })),
    stories,
    `${scenario.slug} render_game_to_text 与屏幕故事顺序/身份/标题必须一致`,
  );
  assert.equal(
    Number(await page.locator('.world-map').getAttribute('data-highlighted-region-count')),
    projected.highlightedRegionIds.length,
    `${scenario.slug} 地图关联州数必须与文本季报一致`,
  );
}

async function assertHighlightPulse(page, scenario, reportTurn, projected) {
  const map = page.locator('.world-map');
  if (projected.highlightedRegionIds.length === 0) {
    assert.equal(
      await map.getAttribute('data-quarter-highlight-epoch'),
      String(reportTurn),
      `${scenario.slug} 空季仍应记录季度高亮轮次`,
    );
    assert.notEqual(
      await map.getAttribute('data-quarter-highlight-active'),
      'true',
      `${scenario.slug} 无关联州域时不应制造地图高亮`,
    );
    return;
  }
  const startedAt = Date.now();
  await page.waitForFunction((turn) => {
    const element = document.querySelector('.world-map');
    return element?.getAttribute('data-quarter-highlight-epoch') === String(turn)
      && element.getAttribute('data-quarter-highlight-active') === 'true';
  }, reportTurn, { timeout: 1_500 });
  const highlightedCount = Number(await map.getAttribute('data-highlighted-region-count'));
  assert.ok(highlightedCount > 0, `${scenario.slug} 推进后必须短暂高亮至少一个相关州域`);

  await page.waitForFunction((turn) => {
    const element = document.querySelector('.world-map');
    return element?.getAttribute('data-quarter-highlight-epoch') === String(turn)
      && element.getAttribute('data-quarter-highlight-active') !== 'true';
  }, reportTurn, { timeout: 2_500 });
  const elapsed = Date.now() - startedAt;
  assert.ok(
    elapsed >= 650 && elapsed <= 1_800,
    `${scenario.slug} 季度高亮应约一秒后消退，实际 ${elapsed}ms`,
  );
}

async function assertPrimaryNavigation(page, scenario, initial) {
  const entries = page.locator('.observer-navigation [data-navigation-entry]');
  assert.equal(await entries.count(), 5, `${scenario.slug} 常驻导航必须恰好五项`);
  assert.deepEqual(
    await entries.evaluateAll((items) => items.map((item) => ({
      id: item.getAttribute('data-navigation-entry'),
      label: item.textContent?.replace(/\s+/g, '').trim(),
    }))),
    [
      { id: 'world', label: '世界' },
      { id: 'powers', label: '势力' },
      { id: 'people', label: '人物' },
      { id: 'chronicle', label: '史册' },
      { id: 'layers', label: '叠层' },
    ],
    `${scenario.slug} 五项导航顺序必须稳定`,
  );
  assert.equal(
    await page.locator('[data-observer-view="polities"], [data-observer-view="families"], [data-observer-view="military"]').count(),
    0,
    `${scenario.slug} 列国、世家、军旅不得继续占用一级入口`,
  );

  for (let index = 0; index < await entries.count(); index += 1) {
    const bounds = await entries.nth(index).boundingBox();
    assert.ok(bounds && bounds.width >= 44 && bounds.height >= 44, `${scenario.slug} 第 ${index + 1} 个导航入口至少应为44px`);
  }
  if (scenario.viewport.width <= 760) {
    const dock = await page.locator('.observer-navigation').evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }));
    assert.ok(dock.scrollWidth <= dock.clientWidth + 1, `${scenario.slug} 五项导航无需横向滚动：${JSON.stringify(dock)}`);
  }

  const historyTriggers = page.locator('[data-history-workbench-trigger="true"]');
  assert.equal(await historyTriggers.count(), 1, `${scenario.slug} 全局只能有一个史册入口`);
  assert.equal(
    await historyTriggers.first().evaluate((element) => Boolean(element.closest('.observer-navigation'))),
    true,
    `${scenario.slug} 唯一史册入口必须归入主导航`,
  );
  assert.equal(
    await page.locator('.observer-world-tools [data-history-workbench-trigger="true"]').count(),
    0,
    `${scenario.slug} 地图工具不得重复放置历史工作台`,
  );
  await historyTriggers.first().click();
  const history = page.locator('.history-workbench');
  await history.waitFor();
  const historyOpened = await snapshot(page);
  assert.equal(historyOpened.interface.view, 'chronicle', `${scenario.slug} 史册入口必须打开长期史册`);
  assert.equal(historyOpened.deterministicWorldHash, initial.deterministicWorldHash, `${scenario.slug} 打开史册不得改变世界`);
  await page.keyboard.press('Escape');
  await history.waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-history-workbench-trigger') === 'true');

  await page.locator('[data-observer-view="powers"]').click();
  const panel = page.locator('.roster-panel[data-roster-scope="powers"]');
  await panel.waitFor();
  const tabs = panel.locator('[role="tab"][data-roster-section]');
  assert.equal(await tabs.count(), 3, `${scenario.slug} 势力卷必须只有列国、世家、军旅三页`);
  assert.deepEqual(
    await tabs.evaluateAll((items) => items.map((item) => item.getAttribute('data-roster-section'))),
    ['polities', 'families', 'military'],
  );
  for (let index = 0; index < await tabs.count(); index += 1) {
    const bounds = await tabs.nth(index).boundingBox();
    assert.ok(bounds && bounds.width >= 44 && bounds.height >= 44, `${scenario.slug} 势力页签至少应为44px`);
  }

  const sectionTitles = {
    polities: '天下列国',
    families: '天下世家',
    military: '天下军旅',
  };
  for (const section of ['polities', 'families', 'military']) {
    const tab = panel.locator(`[data-roster-section="${section}"]`);
    if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
    await page.waitForFunction(
      (expected) => JSON.parse(window.render_game_to_text()).interface.powerRosterSection === expected,
      section,
    );
    const current = await snapshot(page);
    assert.equal(current.interface.view, 'powers', `${scenario.slug} 势力页签必须留在同一一级页面`);
    assert.equal(current.interface.powerRosterSection, section);
    assert.ok(current.interface.rosterTotal > 0, `${scenario.slug} ${sectionTitles[section]}必须有可读条目`);
    assert.equal(await panel.getAttribute('data-roster-title'), sectionTitles[section]);
    assert.equal(current.time.turn, initial.time.turn, `${scenario.slug} 浏览势力不得推进季度`);
    assert.equal(current.deterministicWorldHash, initial.deterministicWorldHash, `${scenario.slug} 浏览势力不得改写世界`);
  }

  const search = panel.locator('.roster-panel__search input');
  await panel.locator('[data-roster-section="polities"]').click();
  await search.fill('不会跨卷保留');
  await panel.locator('[data-roster-section="families"]').click();
  await page.waitForFunction(() => document.querySelector('.roster-panel__search input')?.value === '');

  const familyTab = panel.locator('[data-roster-section="families"]');
  await familyTab.focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('.roster-panel')?.getAttribute('data-active-section') === 'military');
  assert.equal(
    await page.evaluate(() => document.activeElement?.getAttribute('data-roster-section')),
    'military',
    `${scenario.slug} 方向键应切页并把焦点留在当前页签`,
  );

  if (scenario.viewport.width <= 760) {
    const list = panel.locator('.roster-panel__list');
    await list.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    const clearance = await page.evaluate(() => {
      const lastRow = document.querySelector('.roster-panel__list li:last-child');
      const dock = document.querySelector('.observer-navigation');
      if (!lastRow || !dock) return null;
      return {
        lastBottom: lastRow.getBoundingClientRect().bottom,
        dockTop: dock.getBoundingClientRect().top,
      };
    });
    assert.ok(clearance && clearance.lastBottom <= clearance.dockTop + 1, `${scenario.slug} 势力名录尾项不得藏在底部导航后：${JSON.stringify(clearance)}`);
  }

  await page.screenshot({ path: `${ARTIFACT_DIR}/${scenario.slug}-powers.png`, fullPage: false });
  await page.keyboard.press('Escape');
  await panel.waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-observer-view') === 'powers');
  const closed = await snapshot(page);
  assert.equal(closed.interface.view, 'world', `${scenario.slug} 关闭势力卷应回到世界`);
  assert.equal(closed.deterministicWorldHash, initial.deterministicWorldHash, `${scenario.slug} 完整导航浏览不得改写世界`);
}

async function createWorld(page, scenario) {
  await page.addInitScript(() => {
    localStorage.setItem('canghai-map-primer-complete-v1', '1');
    localStorage.setItem('canghai-observer-interface-settings-v1', JSON.stringify({
      version: 2,
      sound: {
        enabled: false,
        promptDismissed: true,
        masterVolume: 0.72,
        ambienceVolume: 0.42,
        effectsVolume: 0.68,
      },
      motion: 'reduced',
      mapAtmosphere: true,
      interfaceDensity: 'comfortable',
    }));
  });
  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
  await page.getByLabel('世界种子').fill('沧衡-甲子');
  await page.locator('#start-world').click();
  await page.waitForSelector('.world-map__canvas');
  const initial = await snapshot(page);
  assert.equal(initial.time.turn, 0, `${scenario.slug} 应从未推进的新世界开始`);
  assert.equal(await page.getByTestId('quarter-pulse').getAttribute('data-story-count'), null);
  return initial;
}

async function verifyScenario(browser, scenario) {
  const context = await browser.newContext({ viewport: scenario.viewport });
  const page = await context.newPage();
  const browserErrors = [];
  collectBrowserErrors(page, browserErrors);

  try {
    const initial = await createWorld(page, scenario);
    await assertPrimaryNavigation(page, scenario, initial);
    let previousDate = '';
    for (let turn = 1; turn <= QUARTERS; turn += 1) {
      await page.getByRole('button', { name: '推进至下一季', exact: true }).click();
      const current = await waitForTurn(page, turn);
      const date = (await page.getByTestId('quarter-pulse-date').innerText()).replace(/\s+/g, ' ').trim();
      assert.notEqual(date, previousDate, `${scenario.slug} 第 ${turn} 季推进后日期必须更新`);
      previousDate = date;

      await assertQuarterProjection(page, scenario, current);
      await assertHighlightPulse(page, scenario, turn - 1, current.interface.quarterPulse);
      await assertNoPageOverflow(page, scenario);
    }

    const situationTriggers = page.locator('[data-situation-workbench-trigger="true"]');
    assert.equal(
      await situationTriggers.count(),
      1,
      `${scenario.slug} 当世三问只能保留一个泛局势入口`,
    );
    assert.equal(await situationTriggers.first().isVisible(), true, `${scenario.slug} 唯一局势入口必须可见`);
    await page.screenshot({ path: `${ARTIFACT_DIR}/${scenario.slug}.png`, fullPage: false });
    assert.deepEqual(browserErrors, [], `${scenario.slug} 不得产生 console.error 或 pageerror`);
  } finally {
    await context.close();
  }
}

await mkdir(ARTIFACT_DIR, { recursive: true });
const server = externalUrl ? null : await createServer({
  logLevel: 'error',
  server: { host: '127.0.0.1', port: PORT, strictPort: true },
});
await server?.listen();
let browser = null;

try {
  browser = await chromium.launch({ headless: true });
  for (const scenario of SCENARIOS) await verifyScenario(browser, scenario);
  process.stdout.write(`TRIM01 quarter E2E passed: ${QUARTERS} quarters × ${SCENARIOS.length} viewports.\n`);
} finally {
  await browser?.close();
  await server?.close();
}
