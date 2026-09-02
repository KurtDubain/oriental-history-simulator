import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const PORT = Number(process.env.FUX01_E2E_PORT ?? 4186);
const APP_URL = `http://127.0.0.1:${PORT}`;
const PACKAGE_VERSION = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
const ARTIFACT_DIR = `output/fux01-mobile-e2e-v${PACKAGE_VERSION}`;

const ALL_SCENARIOS = Object.freeze([
  {
    slug: 'mobile-private',
    viewport: { width: 390, height: 844 },
    profileId: 'private-v03',
    contentVersion: 'v03-82',
    seed: 'FUX01-窄屏私图',
  },
  {
    slug: 'wide-mobile-contest',
    viewport: { width: 640, height: 900 },
    profileId: 'contest-v01',
    contentVersion: 'contest-v01-68',
    seed: 'FUX01-宽屏赛图',
  },
]);
const requestedScenario = process.env.FUX01_E2E_SCENARIO;
const SCENARIOS = requestedScenario
  ? ALL_SCENARIOS.filter((scenario) => scenario.slug === requestedScenario)
  : ALL_SCENARIOS;
assert.ok(SCENARIOS.length > 0, `未知 FUX01 E2E 场景：${requestedScenario}`);

function collectBrowserErrors(page, target) {
  page.on('console', (message) => {
    if (message.type() === 'error') target.push({ type: 'console.error', text: message.text() });
  });
  page.on('pageerror', (error) => target.push({ type: 'pageerror', text: String(error) }));
}

async function state(page) {
  return page.evaluate(() => JSON.parse(window.render_game_to_text()));
}

async function waitForState(page, predicate, argument, timeout = 15_000) {
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

function assertObserverInvariant(current, baseline, message) {
  assert.equal(current.time.turn, baseline.time.turn, `${message}：观察操作不得推进季度`);
  assert.equal(current.deterministicWorldHash, baseline.deterministicWorldHash, `${message}：观察操作不得改变世界哈希`);
  assert.equal(current.mapContentVersion, baseline.mapContentVersion, `${message}：观察操作不得改变地图内容版本`);
}

async function profileGeometry(page, contentVersion) {
  return page.evaluate(async (version) => {
    const maps = await import('/src/maps/index.ts');
    const profile = maps.getMapProfileForContentVersion(version);
    return {
      regionSites: profile.presentation.regionDisplaySites,
      seaCenters: profile.presentation.seaZoneDisplayCenters,
    };
  }, contentVersion);
}

async function mapMetrics(page) {
  return page.locator('.world-map').evaluate((map) => {
    const canvas = map.querySelector('.world-map__canvas');
    const bounds = canvas?.getBoundingClientRect();
    if (!bounds) return null;
    const numberAttribute = (name) => Number(map.getAttribute(name) ?? 0);
    return {
      canvas: {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      },
      zoom: numberAttribute('data-map-zoom'),
      panX: numberAttribute('data-map-pan-x'),
      panY: numberAttribute('data-map-pan-y'),
      focusX: numberAttribute('data-focus-offset-x'),
      focusY: numberAttribute('data-focus-offset-y'),
      lod: map.getAttribute('data-map-lod'),
      visibleArmyIds: (map.getAttribute('data-visible-army-ids') ?? '').split(',').filter(Boolean),
      visibleFleetIds: (map.getAttribute('data-visible-fleet-ids') ?? '').split(',').filter(Boolean),
      selectionAvoided: map.getAttribute('data-selection-avoided') === 'true',
      selectedScreenX: map.hasAttribute('data-selected-screen-x')
        ? numberAttribute('data-selected-screen-x')
        : null,
      selectedScreenY: map.hasAttribute('data-selected-screen-y')
        ? numberAttribute('data-selected-screen-y')
        : null,
    };
  });
}

function screenPoint(metrics, worldPoint, includeFocus = true) {
  const padding = 8;
  const drawableWidth = Math.max(1, metrics.canvas.width - padding * 2);
  const drawableHeight = Math.max(1, metrics.canvas.height - padding * 2);
  const baseScale = Math.min(drawableWidth / 1_000, drawableHeight / 700);
  const offsetX = (metrics.canvas.width - 1_000 * baseScale) / 2;
  const offsetY = (metrics.canvas.height - 700 * baseScale) / 2;
  return {
    x: metrics.canvas.x + offsetX + metrics.panX + worldPoint.x * baseScale * metrics.zoom
      + (includeFocus ? metrics.focusX : 0),
    y: metrics.canvas.y + offsetY + metrics.panY + worldPoint.y * baseScale * metrics.zoom
      + (includeFocus ? metrics.focusY : 0),
    scale: baseScale * metrics.zoom,
  };
}

async function assertTapTarget(locator, message) {
  const result = await locator.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;
    const hit = document.elementFromPoint(centerX, centerY);
    return {
      width: bounds.width,
      height: bounds.height,
      left: bounds.left,
      right: bounds.right,
      top: bounds.top,
      bottom: bounds.bottom,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      unobstructed: Boolean(hit && (hit === element || element.contains(hit))),
    };
  });
  assert.ok(result.width >= 44 && result.height >= 44, `${message}：触控目标不得小于44px`);
  assert.ok(
    result.left >= 0 && result.right <= result.viewportWidth + 1
      && result.top >= 0 && result.bottom <= result.viewportHeight + 1,
    `${message}：触控目标必须位于可见视口内`,
  );
  assert.equal(result.unobstructed, true, `${message}：触控中心不得被其他元素遮挡`);
}

async function selectLayer(page, layer) {
  const trigger = page.getByRole('button', { name: /^舆图叠层/ });
  await trigger.click();
  await page.waitForSelector('#observer-layer-sheet');
  const target = page.locator(`[data-layer-id="${layer}"]`);
  await target.click();
  await page.waitForSelector(`.world-map[data-overlay="${layer}"]`);
  await waitForState(page, (current, expected) => current.interface.overlay === expected, layer);
}

async function createWorld(page, scenario) {
  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
  await page.locator(`input[name="world-map-profile"][value="${scenario.profileId}"]`).click();
  await page.getByLabel('世界种子').fill(scenario.seed);
  await page.locator('#start-world').click();
  await page.waitForSelector('.world-map__canvas');
  const created = await waitForState(
    page,
    (current, expected) => current.mode === 'observing' && current.mapProfile.id === expected,
    scenario.profileId,
  );
  assert.equal(created.mapContentVersion, scenario.contentVersion);
  assert.equal(created.interface.mapViewport.lod, 'overview');
  assert.equal(created.interface.mobileInspectorMode, 'closed');
  await page.locator('button[aria-label="推进至下一季"]').click();
  const turnOne = await waitForState(page, (current) => current.time.turn === 1);
  assert.equal(turnOne.interface.mapViewport.lod, 'overview');
  assert.equal(turnOne.interface.mobileInspectorMode, 'closed');
  return turnOne;
}

async function assertLod(page, expected, baseline, message) {
  const current = await waitForState(page, (snapshot, level) => (
    snapshot.interface.mapViewport.lod === level
    && document.querySelector('.world-map')?.getAttribute('data-map-lod') === level
  ), expected);
  assertObserverInvariant(current, baseline, message);
  return current;
}

async function exerciseLodButtons(page, baseline, scenario) {
  const zoomIn = page.locator('[data-map-zoom-in="true"]');
  const zoomOut = page.locator('[data-map-zoom-out="true"]');
  const expected = [
    ['in', 'regional'],
    ['in', 'regional'],
    ['in', 'local'],
    ['out', 'regional'],
    ['out', 'regional'],
    ['out', 'overview'],
  ];
  for (const [direction, level] of expected) {
    await (direction === 'in' ? zoomIn : zoomOut).click();
    await assertLod(page, level, baseline, `${scenario.slug} ${direction}→${level}`);
  }
  const reset = await state(page);
  assert.deepEqual(reset.interface.mapViewport, { zoom: 1, panX: 0, panY: 0, lod: 'overview' });
}

async function closeQuickLook(page) {
  const inspector = page.locator('.observer-inspector');
  if (!await inspector.count()) return;
  const close = page.getByTestId('map-quick-look').getByRole('button', { name: '收起', exact: true });
  if (await close.isVisible().catch(() => false)) await close.click();
  else await inspector.locator('button[aria-label="关闭档案"]').click();
  await inspector.waitFor({ state: 'detached' });
  await waitForState(page, (current) => current.interface.selected === null && current.interface.mobileInspectorMode === 'closed');
}

async function assertQuickLook(page, expectedKind, baseline, scenario) {
  const inspector = page.locator('.observer-inspector');
  await inspector.waitFor();
  await page.waitForFunction(() => document.querySelector('.observer-inspector')?.getAttribute('data-mobile-mode') === 'quick');
  await inspector.evaluate(async (element) => {
    await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined)));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const current = await state(page);
  assert.equal(current.interface.selected.kind, expectedKind, `${scenario.slug} 应选中 ${expectedKind}`);
  assert.equal(current.interface.mobileInspectorMode, 'quick');
  if (baseline.interface.settings.soundPromptVisible) {
    assert.equal(current.interface.settings.soundPromptVisible, false, `${scenario.slug} 速览应让声音邀请暂时退场`);
    assert.equal(await page.getByTestId('audio-invitation').count(), 0, `${scenario.slug} 速览期间不应保留声音邀请触点`);
  }
  assertObserverInvariant(current, baseline, `${scenario.slug} ${expectedKind}速览`);

  const quick = page.getByTestId('map-quick-look');
  for (const field of ['identity', 'owner', 'current']) {
    const text = (await page.getByTestId(`map-quick-look-${field}`).textContent())?.trim() ?? '';
    assert.ok(text.length > 0, `${scenario.slug} ${expectedKind}速览必须填写 ${field}`);
  }
  const details = page.getByTestId('map-quick-look-details');
  assert.ok(((await details.textContent()) ?? '').trim().length > 0, `${scenario.slug} 速览必须给出完整档案入口`);
  await assertTapTarget(inspector.locator('.observer-inspector__mobile-handle'), `${scenario.slug} 速览划柄`);
  await assertTapTarget(details, `${scenario.slug} 完整档案入口`);
  await assertTapTarget(quick.getByRole('button', { name: '收起', exact: true }), `${scenario.slug} 速览收起入口`);

  const inspectorBounds = await inspector.boundingBox();
  const metrics = await mapMetrics(page);
  assert.ok(inspectorBounds && metrics?.selectedScreenY !== null, `${scenario.slug} 应公开选中对象和速览几何`);
  const selectedClientY = metrics.canvas.y + metrics.selectedScreenY;
  assert.ok(
    selectedClientY <= inspectorBounds.y - 16 + 1,
    `${scenario.slug} 选中对象不得被底部速览遮住：${selectedClientY} > ${inspectorBounds.y - 16}`,
  );
  if (metrics.selectionAvoided) {
    assert.ok(Math.abs(metrics.focusX) > 0.1 || Math.abs(metrics.focusY) > 0.1, `${scenario.slug} 避让标记必须有真实偏移`);
  } else {
    assert.ok(Math.abs(metrics.focusX) <= 0.1 && Math.abs(metrics.focusY) <= 0.1, `${scenario.slug} 无遮挡时不得擅自跳图`);
  }

  const viewportControls = page.locator('.world-map__viewport-controls button');
  for (let index = 0; index < await viewportControls.count(); index += 1) {
    await assertTapTarget(viewportControls.nth(index), `${scenario.slug} 速览期间舆图控件${index + 1}`);
  }
  return { current, avoided: metrics.selectionAvoided };
}

async function createTouchDispatcher(context, page) {
  const cdp = await context.newCDPSession(page);
  return (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: touchPoints.map((point, index) => ({
      x: point.x,
      y: point.y,
      id: index + 1,
      radiusX: 5,
      radiusY: 5,
      force: 1,
    })),
  });
}

async function swipeQuickLook(page, dispatch, direction, baseline, scenario) {
  const handle = page.locator('.observer-inspector__mobile-handle');
  const bounds = await handle.boundingBox();
  assert.ok(bounds, `${scenario.slug} 速览划柄必须可见`);
  const start = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  const distance = direction === 'up' ? -74 : 74;
  await dispatch('touchStart', [start]);
  await dispatch('touchMove', [{ x: start.x, y: start.y + distance }]);
  await dispatch('touchEnd', []);
  const expected = direction === 'up' ? 'full' : 'quick';
  const current = await waitForState(page, (snapshot, mode) => (
    snapshot.interface.mobileInspectorMode === mode
    && document.querySelector('.observer-inspector')?.getAttribute('data-mobile-mode') === mode
  ), expected);
  assertObserverInvariant(current, baseline, `${scenario.slug} ${direction} swipe`);
  return current;
}

function regionCandidates(snapshot, geometry, metrics, occupiedRegionIds) {
  return snapshot.mapObjects.regions
    .filter((region) => geometry.regionSites[region.id] && !occupiedRegionIds.has(region.id))
    .map((region) => ({
      id: region.id,
      point: screenPoint(metrics, geometry.regionSites[region.id], false),
    }))
    .filter(({ point }) => (
      point.x >= metrics.canvas.x + 34
      && point.x <= metrics.canvas.x + metrics.canvas.width - 34
      && point.y >= metrics.canvas.y + 76
      && point.y <= metrics.canvas.y + metrics.canvas.height - 90
    ))
    .sort((left, right) => left.point.y - right.point.y || left.id.localeCompare(right.id));
}

function armyCandidates(snapshot, geometry, metrics) {
  const visible = new Set(metrics.visibleArmyIds);
  const slots = new Map();
  return snapshot.mapObjects.armies
    .filter((army) => visible.has(army.id) && geometry.regionSites[army.regionId])
    .map((army) => {
      const slot = slots.get(army.regionId) ?? 0;
      slots.set(army.regionId, slot + 1);
      const anchor = screenPoint(metrics, geometry.regionSites[army.regionId], false);
      const compact = anchor.scale < 0.42;
      return {
        id: army.id,
        point: {
          x: anchor.x + (compact ? 6 : 14) + (slot % 3) * (compact ? 7 : 17),
          y: anchor.y - (compact ? 5 : 12) - Math.floor(slot / 3) * (compact ? 8 : 19),
        },
      };
    })
    .filter(({ point }) => (
      point.x >= metrics.canvas.x + 28
      && point.x <= metrics.canvas.x + metrics.canvas.width - 28
      && point.y >= metrics.canvas.y + 72
      && point.y <= metrics.canvas.y + metrics.canvas.height - 72
    ))
    .sort((left, right) => right.point.y - left.point.y || left.id.localeCompare(right.id));
}

function fleetCandidates(snapshot, geometry, metrics) {
  const visible = new Set(metrics.visibleFleetIds);
  return snapshot.mapObjects.fleets
    .filter((fleet) => visible.has(fleet.id) && (
      geometry.seaCenters[fleet.seaZoneId] || geometry.regionSites[fleet.portRegionId]
    ))
    .map((fleet) => {
      const position = geometry.seaCenters[fleet.seaZoneId] ?? geometry.regionSites[fleet.portRegionId];
      return {
        id: fleet.id,
        point: screenPoint(metrics, position, false),
      };
    })
    .filter(({ point }) => (
      point.x >= metrics.canvas.x + 28
      && point.x <= metrics.canvas.x + metrics.canvas.width - 28
      && point.y >= metrics.canvas.y + 72
      && point.y <= metrics.canvas.y + metrics.canvas.height - 72
    ))
    .sort((left, right) => right.point.y - left.point.y || left.id.localeCompare(right.id));
}

async function touchFirstExact(page, candidates, kind, scenario) {
  const attempts = [];
  for (const candidate of candidates) {
    await page.touchscreen.tap(candidate.point.x, candidate.point.y);
    await page.waitForTimeout(70);
    const current = await state(page);
    attempts.push({ candidate, selected: current.interface.selected });
    if (
      current.interface.selected?.kind === kind
      && current.interface.selected.id === candidate.id
      && current.interface.mobileInspectorMode === 'quick'
    ) {
      return current;
    }
    await closeQuickLook(page);
  }
  assert.fail(`${scenario.slug} 未能以真实触控命中 ${kind}：${JSON.stringify(attempts)}`);
}

async function tapBlankToClose(page, baseline, scenario) {
  const metrics = await mapMetrics(page);
  const samples = [
    [0.96, 0.08], [0.04, 0.08], [0.96, 0.35], [0.04, 0.35], [0.5, 0.04],
    [0.18, 0.58], [0.38, 0.58], [0.62, 0.58], [0.82, 0.58],
    [0.18, 0.72], [0.38, 0.72], [0.62, 0.72], [0.82, 0.72],
  ];
  for (const [xRatio, yRatio] of samples) {
    const x = metrics.canvas.x + metrics.canvas.width * xRatio;
    const y = metrics.canvas.y + metrics.canvas.height * yRatio;
    const canvasOwnsPoint = await page.evaluate(({ x: clientX, y: clientY }) => (
      document.elementFromPoint(clientX, clientY)?.classList.contains('world-map__canvas') ?? false
    ), { x, y });
    if (!canvasOwnsPoint) continue;
    await page.touchscreen.tap(x, y);
    await page.waitForTimeout(70);
    const current = await state(page);
    if (current.interface.selected === null) {
      assert.equal(current.interface.mobileInspectorMode, 'closed');
      if (baseline.interface.settings.soundPromptVisible) {
        assert.equal(current.interface.settings.soundPromptVisible, true, `${scenario.slug} 收起速览后应恢复声音邀请`);
        await page.getByTestId('audio-invitation').waitFor();
      }
      assertObserverInvariant(current, baseline, `${scenario.slug} 空白关闭`);
      return;
    }
  }
  assert.fail(`${scenario.slug} 地图空白触控未能关闭速览`);
}

async function exerciseMapGestures(page, dispatch, baseline, scenario) {
  const selectedBefore = (await state(page)).interface.selected;
  const metrics = await mapMetrics(page);
  const dragStart = {
    x: metrics.canvas.x + metrics.canvas.width * 0.42,
    y: metrics.canvas.y + metrics.canvas.height * 0.42,
  };
  await dispatch('touchStart', [dragStart]);
  await dispatch('touchMove', [{ x: dragStart.x + 58, y: dragStart.y + 34 }]);
  await waitForState(page, (current) => current.interface.mapGestureActive === true);
  await dispatch('touchEnd', []);
  const dragged = await waitForState(page, (current) => current.interface.mapGestureActive === false);
  assert.deepEqual(dragged.interface.selected, selectedBefore, `${scenario.slug} 单指拖图不得误选`);
  assertObserverInvariant(dragged, baseline, `${scenario.slug} 单指拖图`);

  const afterDragMetrics = await mapMetrics(page);
  const centerY = afterDragMetrics.canvas.y + afterDragMetrics.canvas.height * 0.4;
  const centerX = afterDragMetrics.canvas.x + afterDragMetrics.canvas.width * 0.5;
  await dispatch('touchStart', [
    { x: centerX - 42, y: centerY },
    { x: centerX + 42, y: centerY },
  ]);
  await dispatch('touchMove', [
    { x: centerX - 122, y: centerY - 8 },
    { x: centerX + 122, y: centerY + 8 },
  ]);
  await waitForState(page, (current) => current.interface.mapGestureActive === true);
  await dispatch('touchEnd', []);
  const pinched = await waitForState(page, (current) => (
    current.interface.mapGestureActive === false && current.interface.mapViewport.lod === 'local'
  ));
  assert.deepEqual(pinched.interface.selected, selectedBefore, `${scenario.slug} 双指缩放不得误选`);
  assertObserverInvariant(pinched, baseline, `${scenario.slug} 双指缩放`);
  assert.equal(await page.evaluate(() => window.visualViewport?.scale ?? 1), 1, `${scenario.slug} 双指只能缩放舆图`);
  return pinched;
}

async function runScenario(browser, scenario) {
  const context = await browser.newContext({
    viewport: scenario.viewport,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: scenario.viewport.width <= 400 ? 3 : 2,
  });
  const page = await context.newPage();
  const errors = [];
  collectBrowserErrors(page, errors);
  await page.addInitScript(() => localStorage.setItem('canghai-map-primer-complete-v1', '1'));
  const dispatch = await createTouchDispatcher(context, page);
  try {
    const baseline = await createWorld(page, scenario);
    const geometry = await profileGeometry(page, scenario.contentVersion);
    assert.ok(await page.evaluate(() => navigator.maxTouchPoints > 0), `${scenario.slug} 必须使用真实触控上下文`);
    await exerciseLodButtons(page, baseline, scenario);
    await page.locator('[data-map-zoom-in="true"]').click();
    await assertLod(page, 'regional', baseline, `${scenario.slug} 对象点选进入 regional`);
    let snapshot = await state(page);
    let metrics = await mapMetrics(page);
    const occupiedRegions = new Set(snapshot.mapObjects.armies.map((army) => army.regionId));
    const region = await touchFirstExact(page, regionCandidates(snapshot, geometry, metrics, occupiedRegions), 'region', scenario);
    const selectedRegionId = region.interface.selected.id;
    const regionQuick = await assertQuickLook(page, 'region', baseline, scenario);
    await swipeQuickLook(page, dispatch, 'up', baseline, scenario);
    await swipeQuickLook(page, dispatch, 'down', baseline, scenario);
    await tapBlankToClose(page, baseline, scenario);

    snapshot = await state(page);
    metrics = await mapMetrics(page);
    const army = await touchFirstExact(page, armyCandidates(snapshot, geometry, metrics), 'army', scenario);
    const selectedArmyId = army.interface.selected.id;
    const armyQuick = await assertQuickLook(page, 'army', baseline, scenario);
    await page.screenshot({ path: `${ARTIFACT_DIR}/${scenario.slug}-army-quick.png`, fullPage: true });
    await exerciseMapGestures(page, dispatch, baseline, scenario);

    await page.locator('[data-map-reset="true"]').click();
    const overviewWithArmy = await assertLod(page, 'overview', baseline, `${scenario.slug} 选中军团缩回 overview`);
    assert.equal(overviewWithArmy.interface.selected.id, selectedArmyId, `${scenario.slug} 缩回概览必须保持选中军团`);
    const overviewMetrics = await mapMetrics(page);
    assert.ok(overviewMetrics.visibleArmyIds.includes(selectedArmyId), `${scenario.slug} 选中军团必须作为 LOD 可见例外`);
    await tapBlankToClose(page, baseline, scenario);

    await page.locator('[data-map-zoom-in="true"]').click();
    await assertLod(page, 'regional', baseline, `${scenario.slug} 水师点选进入 regional`);
    await selectLayer(page, 'war');
    snapshot = await state(page);
    metrics = await mapMetrics(page);
    const fleetsToTap = fleetCandidates(snapshot, geometry, metrics);
    assert.ok(fleetsToTap.length > 0, `${scenario.slug} 没有可见水师候选：${JSON.stringify({
      visibleFleetIds: metrics.visibleFleetIds,
      fleets: snapshot.mapObjects.fleets,
      seaCenterIds: Object.keys(geometry.seaCenters),
      canvas: metrics.canvas,
      zoom: metrics.zoom,
      panX: metrics.panX,
      panY: metrics.panY,
    })}`);
    const fleet = await touchFirstExact(page, fleetsToTap, 'fleet', scenario);
    const selectedFleetId = fleet.interface.selected.id;
    const fleetQuick = await assertQuickLook(page, 'fleet', baseline, scenario);
    await tapBlankToClose(page, baseline, scenario);

    const finalState = await state(page);
    assertObserverInvariant(finalState, baseline, `${scenario.slug} 完整 FUX01 路径`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, `${scenario.slug} 不得横向溢出`);
    assert.deepEqual(errors, [], `${scenario.slug} 不得产生 console/page error`);
    await page.screenshot({ path: `${ARTIFACT_DIR}/${scenario.slug}-final.png`, fullPage: true });
    return {
      scenario: scenario.slug,
      profile: scenario.profileId,
      viewport: `${scenario.viewport.width}x${scenario.viewport.height}`,
      hash: baseline.deterministicWorldHash,
      focusAvoided: regionQuick.avoided || armyQuick.avoided || fleetQuick.avoided,
      region: selectedRegionId,
      army: selectedArmyId,
      fleet: selectedFleetId,
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
  process.stdout.write(`FUX01 mobile E2E passed (${PACKAGE_VERSION}): ${results.map((result) => (
    `${result.scenario} ${result.profile} ${result.viewport} ${result.hash.slice(0, 12)} region=${result.region} army=${result.army} fleet=${result.fleet} focus=${result.focusAvoided ? 'avoided' : 'clear'}`
  )).join(' | ')}\n`);
} finally {
  await browser?.close();
  await server.close();
}
