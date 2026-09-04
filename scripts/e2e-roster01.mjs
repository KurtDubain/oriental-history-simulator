import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const PORT = Number(process.env.ROSTER01_E2E_PORT ?? 4194);
const externalUrl = process.env.ROSTER01_E2E_URL;
const APP_URL = externalUrl ?? `http://127.0.0.1:${PORT}`;
const ARTIFACT_DIR = 'output/roster01-e2e';
const TARGET_TURN = 8;
const MOBILE_LAYOUT_MAX_WIDTH = 760;
const ROSTER_DOSSIER_MAX_WIDTH = 840;
const SCENARIO_FILTER = process.env.ROSTER01_E2E_SCENARIO;

const SCENARIOS = Object.freeze([
  { slug: 'desktop-1440x900', viewport: { width: 1440, height: 900 } },
  { slug: 'tablet-768x900', viewport: { width: 768, height: 900 } },
  { slug: 'mobile-wide-640x900', viewport: { width: 640, height: 900 } },
  { slug: 'mobile-390x844', viewport: { width: 390, height: 844 } },
].filter((scenario) => !SCENARIO_FILTER || scenario.slug === SCENARIO_FILTER));

assert.ok(SCENARIOS.length > 0, `未知 ROSTER01 E2E 场景：${SCENARIO_FILTER}`);

const FILTER_LABELS = Object.freeze({
  people: { polity: '所属', identity: '身份' },
  polities: { war: '战况' },
  families: {},
  military: { kind: '编制', supply: '军粮' },
});

const CONTROL_ORDER = Object.freeze({
  people: ['速览', '所属', '身份', '排序'],
  polities: ['战况', '排序'],
  families: ['排序'],
  military: ['编制', '军粮', '排序'],
});

function collectBrowserErrors(page, target) {
  page.on('console', (message) => {
    if (message.type() === 'error') target.push({ type: 'console.error', text: message.text() });
  });
  page.on('pageerror', (error) => target.push({ type: 'pageerror', text: String(error) }));
}

async function snapshot(page) {
  return page.evaluate(() => JSON.parse(window.render_game_to_text()));
}

function assertObserverInvariant(current, baseline, message) {
  assert.equal(current.time.turn, baseline.time.turn, `${message}：观察操作不得推进季度`);
  assert.equal(
    current.deterministicWorldHash,
    baseline.deterministicWorldHash,
    `${message}：观察操作不得改变世界哈希`,
  );
}

function panelFor(page, directory) {
  return page.locator(`.roster-panel[data-roster-directory="${directory}"]`);
}

async function activate(locator, scenario) {
  if (scenario.viewport.width <= ROSTER_DOSSIER_MAX_WIDTH) await locator.tap();
  else await locator.click();
}

async function waitForTurn(page, turn) {
  await page.waitForFunction((expected) => {
    if (typeof window.render_game_to_text !== 'function') return false;
    return JSON.parse(window.render_game_to_text()).time?.turn === expected;
  }, turn, { timeout: 20_000 });
  return snapshot(page);
}

async function waitForRosterState(page, expected) {
  await page.waitForFunction((target) => {
    if (typeof window.render_game_to_text !== 'function') return false;
    const projected = JSON.parse(window.render_game_to_text()).interface?.rosterDiscovery;
    if (!projected || projected.scope !== target.scope) return false;
    if (target.query !== undefined && projected.query !== target.query) return false;
    if (target.quickView !== undefined && projected.quickView !== target.quickView) return false;
    if (target.sort !== undefined && projected.sort !== target.sort) return false;
    if (target.matched !== undefined
      && JSON.parse(window.render_game_to_text()).interface?.rosterMatched !== target.matched) return false;
    if (target.filters) {
      for (const [key, value] of Object.entries(target.filters)) {
        if (projected.filters?.[key] !== value) return false;
      }
    }
    return true;
  }, expected, { timeout: 15_000 });
  return snapshot(page);
}

async function assertTouchTarget(locator, message) {
  await locator.scrollIntoViewIfNeeded();
  const result = await locator.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const x = bounds.left + bounds.width / 2;
    const y = bounds.top + bounds.height / 2;
    const hit = document.elementFromPoint(x, y);
    return {
      width: bounds.width,
      height: bounds.height,
      left: bounds.left,
      right: bounds.right,
      top: bounds.top,
      bottom: bounds.bottom,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      hittable: Boolean(hit && (hit === element || element.contains(hit))),
    };
  });
  assert.ok(result.width >= 44 && result.height >= 44, `${message}：触控目标不得小于 44px，实际 ${JSON.stringify(result)}`);
  assert.ok(
    result.left >= 0 && result.top >= 0
      && result.right <= result.viewportWidth + 1 && result.bottom <= result.viewportHeight + 1,
    `${message}：触控目标必须完整落在视口内，实际 ${JSON.stringify(result)}`,
  );
  assert.equal(result.hittable, true, `${message}：触控中心不得被遮挡`);
}

async function assertNoHorizontalOverflow(page, panel, scenario, detail) {
  const layout = await page.evaluate((selector) => {
    const roster = document.querySelector(selector);
    const controls = roster?.querySelector('[data-roster-discovery-controls]');
    return {
      viewport: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      rosterClient: roster?.clientWidth ?? 0,
      rosterScroll: roster?.scrollWidth ?? 0,
      controlsClient: controls?.clientWidth ?? 0,
      controlsScroll: controls?.scrollWidth ?? 0,
    };
  }, `.roster-panel[data-roster-directory="${await panel.getAttribute('data-roster-directory')}"]`);
  assert.ok(
    layout.documentWidth <= layout.viewport + 1,
    `${scenario.slug} ${detail}不得造成页面横向溢出：${JSON.stringify(layout)}`,
  );
  assert.ok(
    layout.rosterScroll <= layout.rosterClient + 1,
    `${scenario.slug} ${detail}名录不得横向溢出：${JSON.stringify(layout)}`,
  );
  if (layout.controlsClient > 0) {
    assert.ok(
      layout.controlsScroll <= layout.controlsClient + 1,
      `${scenario.slug} ${detail}筛选控件不得横向溢出：${JSON.stringify(layout)}`,
    );
  }
}

async function ensureDiscoveryControls(page, panel, scenario) {
  const toggle = panel.locator('[data-roster-filter-toggle]');
  const controls = panel.locator('[data-roster-discovery-controls]');
  if (scenario.viewport.width <= MOBILE_LAYOUT_MAX_WIDTH) {
    assert.equal(await toggle.count(), 1, `${scenario.slug} 移动名录只能有一个筛选与排序入口`);
    assert.equal(await toggle.isVisible(), true, `${scenario.slug} 移动筛选与排序入口必须可见`);
    await assertTouchTarget(toggle, `${scenario.slug} 筛选与排序入口`);
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await activate(toggle, scenario);
    await controls.waitFor({ state: 'visible' });
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    for (const select of await controls.locator('select').all()) {
      await assertTouchTarget(select, `${scenario.slug} 移动筛选选项`);
    }
  } else {
    assert.equal(await toggle.isVisible(), false, `${scenario.slug} 宽屏应直接显示紧凑筛选行`);
    await controls.waitFor({ state: 'visible' });
    if (scenario.viewport.width <= ROSTER_DOSSIER_MAX_WIDTH) {
      await assertTouchTarget(panel.locator('.roster-panel__search input'), `${scenario.slug} 名录搜索输入`);
      for (const select of await controls.locator('select').all()) {
        await assertTouchTarget(select, `${scenario.slug} 平板筛选选项`);
      }
    }
  }
  return controls;
}

function discoveryControl(panel, label) {
  return panel.locator('[data-roster-discovery-controls] label')
    .filter({ hasText: new RegExp(`^\\s*${label}`) })
    .locator('select');
}

async function selectControl(page, panel, scenario, label, value) {
  await ensureDiscoveryControls(page, panel, scenario);
  const control = discoveryControl(panel, label);
  assert.equal(await control.count(), 1, `${scenario.slug} ${label}控件必须唯一`);
  await control.selectOption(value);
}

async function domRosterIds(panel) {
  return panel.locator('[data-roster-id]').evaluateAll((items) => (
    items.map((item) => item.getAttribute('data-roster-id')).filter(Boolean)
  ));
}

async function assertRosterProjection(page, panel, scenario, baseline, detail) {
  const current = await snapshot(page);
  const projection = current.interface?.rosterDiscovery;
  const directory = await panel.getAttribute('data-roster-directory');
  assert.ok(projection, `${scenario.slug} ${detail}必须公开名录观察状态`);
  assert.equal(projection.scope, directory, `${scenario.slug} ${detail} DOM 分类必须与文本快照一致`);
  assert.equal(
    await panel.locator('.roster-panel__search input').inputValue(),
    projection.query,
    `${scenario.slug} ${detail}搜索词必须与文本快照一致`,
  );
  assert.equal(
    (await panel.locator('.roster-panel__result-bar [role="status"]').textContent())?.trim(),
    projection.conditionSummary,
    `${scenario.slug} ${detail}命中摘要必须与文本快照一致`,
  );
  assert.deepEqual(
    await panel.locator('[data-roster-discovery-controls] label > span').allTextContents(),
    CONTROL_ORDER[directory],
    `${scenario.slug} ${detail}控件顺序必须与分卷契约一致`,
  );
  if (directory === 'people') assert.equal(await discoveryControl(panel, '速览').inputValue(), projection.quickView);
  else assert.equal(await discoveryControl(panel, '速览').count(), 0, `${scenario.slug} ${detail}不得显示无作用的速览控件`);
  assert.equal(await discoveryControl(panel, '排序').inputValue(), projection.sort);
  for (const [key, label] of Object.entries(FILTER_LABELS[directory] ?? {})) {
    assert.equal(
      await discoveryControl(panel, label).inputValue(),
      projection.filters[key],
      `${scenario.slug} ${detail}的${label}必须与文本快照一致`,
    );
  }

  const domIds = await domRosterIds(panel);
  const projectedIds = current.interface.visibleRoster.map((item) => item.id);
  assert.equal(
    domIds.length,
    Math.min(current.interface.rosterVisibleLimit, current.interface.rosterMatched),
    `${scenario.slug} ${detail}DOM 条数必须等于分页后的命中数`,
  );
  assert.deepEqual(domIds, projectedIds, `${scenario.slug} ${detail}DOM 与 render_game_to_text 必须逐项一致`);
  assertObserverInvariant(current, baseline, `${scenario.slug} ${detail}`);
  return current;
}

async function openRoster(page, scenario, directory) {
  if (directory === 'people') {
    await activate(page.locator('[data-observer-view="people"]'), scenario);
  } else {
    const existing = page.locator('.roster-panel[data-roster-scope="powers"]');
    if (!(await existing.count())) await activate(page.locator('[data-observer-view="powers"]'), scenario);
    const powers = page.locator('.roster-panel[data-roster-scope="powers"]');
    await powers.waitFor();
    const tab = powers.locator(`[data-roster-section="${directory}"]`);
    if ((await tab.getAttribute('aria-selected')) !== 'true') await activate(tab, scenario);
  }
  const panel = panelFor(page, directory);
  await panel.waitFor();
  await waitForRosterState(page, { scope: directory });
  return panel;
}

async function closeReasonDestination(page, scenario, target) {
  if (target.kind === 'event') {
    await page.waitForFunction((id) => (
      JSON.parse(window.render_game_to_text()).interface?.selectedEventId === id
    ), target.id);
    const drawer = page.locator('.observer-causal-drawer');
    await drawer.waitFor();
    await page.keyboard.press('Escape');
    await drawer.waitFor({ state: 'detached' });
    return;
  }
  if (target.kind === 'situation') {
    await page.waitForFunction((id) => (
      JSON.parse(window.render_game_to_text()).observer?.selectedSituationId === id
    ), target.id);
    const workbench = page.locator('.situation-workbench');
    await workbench.waitFor();
    await page.keyboard.press('Escape');
    await workbench.waitFor({ state: 'detached' });
    return;
  }
  await page.waitForFunction((id) => (
    JSON.parse(window.render_game_to_text()).interface?.selected?.id === id
  ), target.id);
  const inspector = page.locator('.observer-inspector');
  await inspector.waitFor();
  if (await inspector.locator('[data-inspector-return="roster"]').count()) {
    await activate(inspector.locator('[data-inspector-return="roster"]'), scenario);
  } else {
    await inspector.locator('button[aria-label="关闭档案"]').click();
  }
  await inspector.waitFor({ state: 'detached' });
}

async function exerciseDefaultReason(page, scenario, baseline) {
  const panel = await openRoster(page, scenario, 'people');
  let current = await assertRosterProjection(page, panel, scenario, baseline, '默认人物名录');
  if (current.interface.rosterMatched > current.interface.rosterVisibleLimit) {
    const more = panel.locator('.roster-panel__more button');
    if (scenario.viewport.width <= ROSTER_DOSSIER_MAX_WIDTH) await assertTouchTarget(more, `${scenario.slug} 继续展卷`);
    await activate(more, scenario);
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).interface?.visibleRoster?.length > 120);
    current = await assertRosterProjection(page, panel, scenario, baseline, '人物名录继续展卷');
  }
  const first = current.interface.visibleRoster[0];
  assert.ok(first?.reason?.label, `${scenario.slug} 默认首位人物必须给出具体关注缘由`);
  assert.ok(['event', 'situation', 'item'].includes(first.reason.target?.kind), `${scenario.slug} 关注缘由必须有合法去向`);
  assert.ok(first.reason.target.id, `${scenario.slug} 关注缘由必须有稳定目标 ID`);
  const reason = panel.locator(`[data-roster-id="${first.id}"]`).locator('xpath=..').locator('[data-roster-reason]');
  assert.equal(await reason.count(), 1, `${scenario.slug} 默认首位人物必须只有一个缘由入口`);
  assert.equal(await reason.getAttribute('data-roster-reason'), first.reason.kind);
  assert.equal((await reason.locator('strong').textContent())?.trim(), first.reason.label);
  if (scenario.viewport.width <= ROSTER_DOSSIER_MAX_WIDTH) {
    await assertTouchTarget(reason, `${scenario.slug} 关注缘由入口`);
  }
  await activate(reason, scenario);
  await closeReasonDestination(page, scenario, first.reason.target);
  await panel.waitFor();
  assert.equal(await panel.getAttribute('data-roster-state'), 'active');
  await assertRosterProjection(page, panel, scenario, baseline, '关注缘由往返');
  return panel;
}

async function exercisePeopleDiscovery(page, panel, scenario, baseline) {
  const initial = await snapshot(page);
  const target = initial.interface.visibleRoster.find((item) => item.discovery?.quickViews?.includes('recent'))
    ?? initial.interface.visibleRoster.find((item) => item.discovery?.quickViews?.length);
  assert.ok(target, `${scenario.slug} 推进 ${TARGET_TURN} 季后人物名录必须有可用快捷观察对象`);
  const quickView = target.discovery.quickViews.includes('recent') ? 'recent' : target.discovery.quickViews[0];
  const polityId = target.discovery.filters.polity;
  const identity = target.discovery.filters.identity;

  await panel.locator('.roster-panel__search input').fill(target.title);
  await selectControl(page, panel, scenario, '速览', quickView);
  await selectControl(page, panel, scenario, '所属', polityId);
  await selectControl(page, panel, scenario, '身份', identity);
  await selectControl(page, panel, scenario, '排序', 'influence');
  const intersected = await waitForRosterState(page, {
    scope: 'people',
    query: target.title,
    quickView,
    filters: { polity: polityId, identity },
    sort: 'influence',
  });
  assert.ok(intersected.interface.rosterMatched > 0, `${scenario.slug} 搜索、快捷、筛选和排序交集必须命中人物`);
  assert.ok(
    intersected.interface.visibleRoster.some((item) => item.id === target.id),
    `${scenario.slug} 交集结果必须保留目标人物`,
  );
  assert.match(
    intersected.interface.rosterDiscovery.conditionSummary,
    new RegExp(`^${intersected.interface.rosterMatched} / ${intersected.interface.rosterTotal}`),
    `${scenario.slug} 命中数必须明确显示`,
  );
  await assertRosterProjection(page, panel, scenario, baseline, '人物组合发现');
  await page.screenshot({ path: `${ARTIFACT_DIR}/${scenario.slug}-people-discovery.png`, fullPage: false });

  await panel.locator('.roster-panel__search input').fill('绝无此人·ROSTER01');
  await waitForRosterState(page, { scope: 'people', query: '绝无此人·ROSTER01', matched: 0 });
  assert.equal(await panel.locator('[data-roster-id]').count(), 0, `${scenario.slug} 空结果不得残留人物行`);
  assert.match(
    (await panel.locator('.roster-panel__empty').textContent()) ?? '',
    /没有符合检索“绝无此人·ROSTER01”/,
    `${scenario.slug} 空态必须说明收窄条件`,
  );
  await assertRosterProjection(page, panel, scenario, baseline, '人物空结果');
  await page.screenshot({ path: `${ARTIFACT_DIR}/${scenario.slug}-people-empty.png`, fullPage: false });

  const clear = panel.getByRole('button', { name: '清除条件', exact: true });
  if (scenario.viewport.width <= ROSTER_DOSSIER_MAX_WIDTH) await assertTouchTarget(clear, `${scenario.slug} 清除条件`);
  await activate(clear, scenario);
  const cleared = await waitForRosterState(page, {
    scope: 'people', query: '', quickView: 'living', sort: 'attention', filters: { polity: 'all', identity: 'all' },
  });
  assert.ok(cleared.interface.rosterMatched > 0, `${scenario.slug} 清除后应恢复在世人物`);
  assert.ok(cleared.interface.visibleRoster.every((item) => !item.subtitle.includes('故人')), `${scenario.slug} 默认名录不应混入故人`);
  await assertRosterProjection(page, panel, scenario, baseline, '人物清除条件');
}

async function visibleRowAfterScroll(panel) {
  const list = panel.locator('.roster-panel__list');
  await list.evaluate((element) => {
    element.scrollTop = Math.min(Math.max(0, element.scrollHeight - element.clientHeight), 520);
  });
  const id = await panel.evaluate((element) => {
    const listElement = element.querySelector('.roster-panel__list');
    if (!listElement) return null;
    const bounds = listElement.getBoundingClientRect();
    const rows = Array.from(listElement.querySelectorAll('[data-roster-id]'));
    const row = rows.find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return rect.top >= bounds.top + 1 && rect.bottom <= bounds.bottom - 1;
    });
    return row?.getAttribute('data-roster-id') ?? null;
  });
  assert.ok(id, '滚动后应有完整可见人物行');
  return { list, id, scrollTop: await list.evaluate((element) => element.scrollTop) };
}

async function exerciseDossierReturn(page, panel, scenario, baseline) {
  await selectControl(page, panel, scenario, '排序', 'influence');
  await waitForRosterState(page, { scope: 'people', sort: 'influence' });
  const before = await assertRosterProjection(page, panel, scenario, baseline, '进档前人物排序');
  const { list, id, scrollTop } = await visibleRowAfterScroll(panel);
  assert.ok(scrollTop > 0, `${scenario.slug} 应建立可验证的名录滚动位置`);
  const row = panel.locator(`[data-roster-id="${id}"]`);
  await activate(row, scenario);
  const inspector = page.locator('.observer-inspector[data-kind="person"]');
  await inspector.waitFor();

  if (scenario.viewport.width <= ROSTER_DOSSIER_MAX_WIDTH) {
    assert.equal(await panel.getAttribute('data-roster-state'), 'suspended', `${scenario.slug} 窄屏档案应暂停原名录`);
  } else {
    assert.equal(await panel.getAttribute('data-roster-state'), 'active', `${scenario.slug} 桌面档案应与名录并排`);
  }
  await page.waitForFunction(() => document.activeElement?.hasAttribute('data-inspector-close'));
  assert.equal(
    await inspector.locator('[data-inspector-return="roster"]').count(),
    scenario.viewport.width <= ROSTER_DOSSIER_MAX_WIDTH ? 1 : 0,
    `${scenario.slug} 只在窄屏使用返回名录外观`,
  );
  await page.keyboard.press('Escape');
  await inspector.waitFor({ state: 'detached' });
  await panel.waitFor();
  const returned = await waitForRosterState(page, { scope: 'people', sort: 'influence' });
  assert.deepEqual(returned.interface.rosterDiscovery, before.interface.rosterDiscovery, `${scenario.slug} 档案往返必须保留全部名录条件`);
  const returnedScroll = await list.evaluate((element) => element.scrollTop);
  assert.ok(
    returnedScroll > 0 && Math.abs(returnedScroll - scrollTop) <= 80,
    `${scenario.slug} 档案往返必须留在原行附近：${scrollTop} → ${returnedScroll}`,
  );
  await page.waitForFunction((expectedId) => (
    document.activeElement?.getAttribute('data-roster-id') === expectedId
  ), id);
  assert.equal(
    await page.evaluate(() => document.activeElement?.getAttribute('data-roster-id')),
    id,
    `${scenario.slug} 返回后必须聚焦原人物行`,
  );
  await assertRosterProjection(page, panel, scenario, baseline, '人物档案原位返回');
  await page.screenshot({ path: `${ARTIFACT_DIR}/${scenario.slug}-dossier-return.png`, fullPage: false });
}

function assertSorted(items, key, direction, message) {
  const values = items.map((item) => item.discovery?.sortValues?.[key]);
  assert.ok(values.every(Number.isFinite), `${message}必须公开真实 ${key} 排序值`);
  for (let index = 1; index < values.length; index += 1) {
    if (direction === 'asc') assert.ok(values[index - 1] <= values[index], `${message}应升序：${values.join(',')}`);
    else assert.ok(values[index - 1] >= values[index], `${message}应降序：${values.join(',')}`);
  }
}

async function exercisePowerDirectories(page, scenario, baseline) {
  const polities = await openRoster(page, scenario, 'polities');
  await selectControl(page, polities, scenario, '战况', 'at-war');
  await selectControl(page, polities, scenario, '排序', 'authority');
  const warState = await waitForRosterState(page, {
    scope: 'polities', filters: { war: 'at-war' }, sort: 'authority',
  });
  assert.ok(warState.interface.rosterMatched > 0, `${scenario.slug} 固定世界第 ${TARGET_TURN} 季必须有交战政权`);
  assert.ok(
    warState.interface.visibleRoster.every((item) => item.discovery?.filters?.war === 'at-war'),
    `${scenario.slug} 列国战况筛选不得混入和平政权`,
  );
  assertSorted(warState.interface.visibleRoster, 'authority', 'desc', `${scenario.slug} 列国威权排行`);
  await assertRosterProjection(page, polities, scenario, baseline, '列国战况与威权');

  const families = await openRoster(page, scenario, 'families');
  await selectControl(page, families, scenario, '排序', 'politicalInfluence');
  const familyState = await waitForRosterState(page, { scope: 'families', sort: 'politicalInfluence' });
  assert.ok(familyState.interface.rosterMatched > 0, `${scenario.slug} 世家名录必须有结果`);
  assertSorted(familyState.interface.visibleRoster, 'politicalInfluence', 'desc', `${scenario.slug} 世家朝堂势力排行`);
  await assertRosterProjection(page, families, scenario, baseline, '世家朝堂势力');

  const military = await openRoster(page, scenario, 'military');
  await selectControl(page, military, scenario, '排序', 'supply');
  const militaryState = await waitForRosterState(page, { scope: 'military', sort: 'supply' });
  assert.ok(militaryState.interface.rosterMatched > 0, `${scenario.slug} 军势名录必须有结果`);
  assert.ok(
    militaryState.interface.visibleRoster.every((item) => /余粮\s*[\d.]+\s*季/.test(item.meta)),
    `${scenario.slug} 陆军与水师都必须显示真实余粮覆盖`,
  );
  assertSorted(militaryState.interface.visibleRoster, 'supply', 'asc', `${scenario.slug} 军势余粮最少排行`);
  const kinds = new Set(militaryState.interface.visibleRoster.map((item) => item.discovery?.filters?.kind));
  assert.ok(kinds.has('army') && kinds.has('fleet'), `${scenario.slug} 军势排行必须同时覆盖陆军与水师`);
  await assertRosterProjection(page, military, scenario, baseline, '军势余粮覆盖与排序');

  if (scenario.viewport.width <= MOBILE_LAYOUT_MAX_WIDTH) {
    await ensureDiscoveryControls(page, military, scenario);
    await assertNoHorizontalOverflow(page, military, scenario, '展开筛选后');
  }
  await page.screenshot({ path: `${ARTIFACT_DIR}/${scenario.slug}-powers.png`, fullPage: false });
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
  const privateMap = page.locator('input[name="world-map-profile"][value="private-v03"]');
  if (await privateMap.count()) await privateMap.click();
  await page.getByLabel('世界种子').fill('ROSTER01-观察名录');
  await page.locator('#start-world').click();
  await page.waitForSelector('.world-map__canvas');
  for (let turn = 1; turn <= TARGET_TURN; turn += 1) {
    await page.getByRole('button', { name: '推进至下一季', exact: true }).click();
    await waitForTurn(page, turn);
  }
  const baseline = await snapshot(page);
  assert.equal(baseline.time.turn, TARGET_TURN);
  assert.equal(baseline.mapProfile.id, 'private-v03');
  return baseline;
}

async function verifyScenario(browser, scenario) {
  const context = await browser.newContext({
    viewport: scenario.viewport,
    hasTouch: scenario.viewport.width <= ROSTER_DOSSIER_MAX_WIDTH,
    isMobile: scenario.viewport.width <= MOBILE_LAYOUT_MAX_WIDTH,
  });
  const page = await context.newPage();
  const browserErrors = [];
  collectBrowserErrors(page, browserErrors);

  try {
    const baseline = await createWorld(page, scenario);
    const people = await exerciseDefaultReason(page, scenario, baseline);
    await exercisePeopleDiscovery(page, people, scenario, baseline);
    await exerciseDossierReturn(page, people, scenario, baseline);
    await exercisePowerDirectories(page, scenario, baseline);
    const final = await snapshot(page);
    assertObserverInvariant(final, baseline, `${scenario.slug} 完整 ROSTER01 浏览链`);
    await assertNoHorizontalOverflow(page, panelFor(page, 'military'), scenario, '最终状态');
    assert.deepEqual(browserErrors, [], `${scenario.slug} 不得产生 console.error 或 pageerror`);
  } finally {
    await context.close();
  }
}

await rm(ARTIFACT_DIR, { recursive: true, force: true });
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
  process.stdout.write(`ROSTER01 E2E passed: ${TARGET_TURN} quarters × ${SCENARIOS.length} viewports.\n`);
} finally {
  await browser?.close();
  await server?.close();
}
