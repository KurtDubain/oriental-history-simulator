import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { getMapProfile } from '../src/maps/index';
import { layoutMapMarkers } from '../src/view/map-marker-layout';
import { createMapViewportTransform } from '../src/view/map-scene-geometry';

const PORT = Number(process.env.POLITICAL_VISIBILITY_E2E_PORT ?? 4198);
const externalUrl = process.env.POLITICAL_VISIBILITY_E2E_URL;
const APP_URL = externalUrl ?? `http://127.0.0.1:${PORT}`;
const ARTIFACT_DIR = 'output/political-visibility-e2e';
const TARGET_TURN = 4;
const MOBILE_DOSSIER_MAX_WIDTH = 840;
const MOBILE_QUICK_LOOK_MAX_WIDTH = 760;
const MOBILE_SEAT_MAX_WIDTH = 720;
const SCENARIO_FILTER = process.env.POLITICAL_VISIBILITY_E2E_SCENARIO;

const SCENARIOS = Object.freeze([
  {
    slug: 'private-desktop-1440x900',
    viewport: { width: 1440, height: 900 },
    mapProfileId: 'private-v03',
    targetPolityId: 'p_yan',
    seed: 'POL05-朝堂舆图-心中山河',
  },
  {
    slug: 'private-mobile-wide-640x900',
    viewport: { width: 640, height: 900 },
    mapProfileId: 'private-v03',
    targetPolityId: 'p_yan',
    seed: 'POL05-朝堂舆图-心中山河',
  },
  {
    slug: 'private-touch-tablet-768x900',
    viewport: { width: 768, height: 900 },
    mapProfileId: 'private-v03',
    targetPolityId: 'p_yan',
    seed: 'POL05-朝堂舆图-心中山河',
  },
  {
    slug: 'private-mobile-390x844',
    viewport: { width: 390, height: 844 },
    mapProfileId: 'private-v03',
    targetPolityId: 'p_yan',
    seed: 'POL05-朝堂舆图-心中山河',
  },
  {
    slug: 'contest-desktop-1440x900',
    viewport: { width: 1440, height: 900 },
    mapProfileId: 'contest-v01',
    targetPolityId: 'p_linyuan',
    seed: 'POL05-朝堂舆图-云海八荒',
  },
  {
    slug: 'contest-mobile-390x844',
    viewport: { width: 390, height: 844 },
    mapProfileId: 'contest-v01',
    targetPolityId: 'p_linyuan',
    seed: 'POL05-朝堂舆图-云海八荒',
  },
].filter((scenario) => !SCENARIO_FILTER || scenario.slug === SCENARIO_FILTER));

assert.ok(SCENARIOS.length > 0, `未知 POL05 E2E 场景：${SCENARIO_FILTER}`);

const CENTRAL_OFFICES = new Set(['君主', '宰辅', '枢密使', '廷臣']);

function collectBrowserErrors(page, target) {
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    if (message.location().url.endsWith('/favicon.ico')) return;
    target.push({ type: 'console.error', text: message.text(), location: message.location() });
  });
  page.on('pageerror', (error) => target.push({ type: 'pageerror', text: String(error) }));
}

async function snapshot(page) {
  return page.evaluate(() => JSON.parse(window.render_game_to_text()));
}

async function waitForState(page, predicate, argument, timeout = 20_000) {
  await page.waitForFunction(
    ({ source, argument: innerArgument }) => {
      if (typeof window.render_game_to_text !== 'function') return false;
      try {
        const current = JSON.parse(window.render_game_to_text());
        return Function('current', 'argument', `return (${source})(current, argument);`)(current, innerArgument);
      } catch {
        return false;
      }
    },
    { source: predicate.toString(), argument },
    { timeout },
  );
  return snapshot(page);
}

async function waitForAnimations(locator) {
  await locator.evaluate(async (element) => {
    await Promise.all(
      element.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined)),
    );
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function activate(locator, scenario) {
  await locator.scrollIntoViewIfNeeded();
  if (scenario.viewport.width <= MOBILE_DOSSIER_MAX_WIDTH) await locator.tap();
  else await locator.click();
}

async function activateCanvasPoint(page, scenario, point) {
  if (scenario.viewport.width <= MOBILE_DOSSIER_MAX_WIDTH) {
    await page.touchscreen.tap(point.x, point.y);
  } else {
    await page.mouse.click(point.x, point.y);
  }
}

function politicalMarkerIds(markers) {
  return markers.map((marker) => marker.id);
}

function commaSeparatedAttribute(value) {
  return value ? value.split(',').filter(Boolean) : [];
}

async function mapMarkerScreenPoint(page, markerId) {
  const viewport = await page.evaluate(() => {
    const current = JSON.parse(window.render_game_to_text());
    const political = current.interface?.politicalMap;
    const host = document.querySelector('.world-map');
    const canvas = document.querySelector('.world-map__canvas');
    if (!political || !(host instanceof HTMLElement) || !(canvas instanceof HTMLCanvasElement)) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      mapProfileId: current.mapProfile.id,
      political,
      camera: current.interface.mapViewport,
      width: canvas.clientWidth,
      height: canvas.clientHeight,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      focusX: Number.parseFloat(host.dataset.focusOffsetX ?? '0') || 0,
      focusY: Number.parseFloat(host.dataset.focusOffsetY ?? '0') || 0,
    };
  });
  if (!viewport) return null;

  const profile = getMapProfile(viewport.mapProfileId);
  const entries = [
    ...viewport.political.visiblePulses.map((marker) => ({
      id: marker.id,
      kind: 'capitalPulse',
      position: { x: marker.position[0], y: marker.position[1] },
      magnitude: marker.power,
      label: marker.label,
      targetKind: marker.target.kind,
      targetId: marker.target.id,
      polityId: marker.polityId,
      factionId: marker.factionId ?? undefined,
      tone: marker.tone,
    })),
    ...viewport.political.visibleRoots.map((marker) => ({
      id: marker.id,
      kind: 'powerRoot',
      position: { x: marker.position[0], y: marker.position[1] },
      magnitude: marker.value,
      label: marker.label,
      targetKind: marker.target.kind,
      targetId: marker.target.id,
      polityId: marker.polityId,
      factionId: marker.factionId,
      rootKind: marker.category,
    })),
  ];
  const projectPoint = (point) => {
    const region = profile.simulation.regions.find((item) => (
      Math.abs(item.x - point.x) < 0.001 && Math.abs(item.y - point.y) < 0.001
    ));
    const regionSite = region ? profile.presentation.regionDisplaySites[region.id] : null;
    if (regionSite) return { x: regionSite.x, y: regionSite.y };
    const seaZone = profile.simulation.seaZones.find((item) => (
      Math.abs(item.x - point.x) < 0.001 && Math.abs(item.y - point.y) < 0.001
    ));
    const seaCenter = seaZone ? profile.presentation.seaZoneDisplayCenters[seaZone.id] : null;
    return seaCenter ? { x: seaCenter.x, y: seaCenter.y } : point;
  };
  const projected = entries.map((marker) => ({ ...marker, position: projectPoint(marker.position) }));
  const transform = createMapViewportTransform(viewport.width, viewport.height, 8, viewport.camera);
  const layout = layoutMapMarkers(projected, transform)
    .find((item) => item.marker.id === markerId);
  if (!layout) return null;
  return {
    x: viewport.rect.left
      + (layout.point.x + viewport.focusX) * viewport.rect.width / Math.max(1, viewport.width),
    y: viewport.rect.top
      + (layout.point.y + viewport.focusY) * viewport.rect.height / Math.max(1, viewport.height),
    radius: layout.radius,
  };
}

function assertObserverInvariant(current, baseline, detail) {
  assert.equal(current.time.turn, baseline.time.turn, `${detail}不得推进季度`);
  assert.equal(
    current.deterministicWorldHash,
    baseline.deterministicWorldHash,
    `${detail}不得改写权威世界哈希`,
  );
}

function selectCourtSituation(state, scenario) {
  const courts = state.observer.situations.open
    .filter((situation) => situation.type === 'court_power_struggle');
  assert.ok(courts.length <= 3, `${scenario.slug} 朝堂权斗开放局势不得超过类型配额 3`);
  if (!courts.length) return null;
  const targetPolity = state.polities.find((polity) => polity.id === scenario.targetPolityId);
  const polityLabels = targetPolity
    ? [targetPolity.name, targetPolity.name.replace(/(?:国|朝|邦)$/u, '')].filter(Boolean)
    : [];
  return courts.find((situation) => polityLabels.some((label) => (
    situation.title.includes(`${label}的`) || situation.title.startsWith(label)
  ))) ?? courts[0];
}

async function assertMobileTapTarget(locator, scenario, label) {
  if (scenario.viewport.width > MOBILE_DOSSIER_MAX_WIDTH) return;
  await locator.scrollIntoViewIfNeeded();
  const metrics = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      width: rect.width,
      height: rect.height,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      unobstructed: Boolean(hit && (hit === element || element.contains(hit))),
    };
  });
  assert.ok(metrics.width >= 44 && metrics.height >= 44, `${scenario.slug} ${label}触控区至少 44px`);
  assert.ok(
    metrics.left >= -1 && metrics.right <= metrics.viewportWidth + 1
      && metrics.top >= -1 && metrics.bottom <= metrics.viewportHeight + 1,
    `${scenario.slug} ${label}必须位于可见触控视口内`,
  );
  assert.equal(metrics.unobstructed, true, `${scenario.slug} ${label}触控中心不得被遮挡`);
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
  const mapProfile = page.locator(`input[name="world-map-profile"][value="${scenario.mapProfileId}"]`);
  assert.equal(await mapProfile.count(), 1, `${scenario.slug} 开局应提供目标地图`);
  await mapProfile.click();
  await page.waitForFunction((profileId) => (
    document.querySelector(`input[name="world-map-profile"][value="${profileId}"]`)?.checked === true
  ), scenario.mapProfileId);
  await page.getByLabel('世界种子').fill(scenario.seed);
  await page.locator('#start-world').click();
  await page.waitForSelector('.world-map__canvas');

  for (let turn = 1; turn <= TARGET_TURN; turn += 1) {
    await page.getByRole('button', { name: '推进至下一季', exact: true }).click();
    await waitForState(page, (current, expectedTurn) => current.time.turn === expectedTurn, turn);
  }

  const baseline = await snapshot(page);
  assert.equal(baseline.time.turn, TARGET_TURN, `${scenario.slug} 应推进到关系可见的固定季度`);
  assert.equal(baseline.mapProfile.id, scenario.mapProfileId);
  assert.ok(
    baseline.polities.some((polity) => polity.id === scenario.targetPolityId),
    `${scenario.slug} 固定世界必须保留目标政权`,
  );
  return baseline;
}

async function assertPoliticalMapOverview(page, scenario, baseline) {
  const political = baseline.interface?.politicalMap;
  assert.ok(political?.active, `${scenario.slug} 默认疆界层必须公开政治舆图投影`);
  assert.equal(political.focusedPolityId, null, `${scenario.slug} 未入朝局前不得偷选政权`);
  assert.equal(political.focusedFactionId, null, `${scenario.slug} 未入朝局前不得偷选派系`);
  assert.equal(political.courtEntryActive, false);
  assert.deepEqual(political.visibleRoots, [], `${scenario.slug} 未聚焦派系前不得洒满根基印记`);
  assert.equal(
    political.visiblePulses.length,
    baseline.polities.length,
    `${scenario.slug} 每个存续政权应有且仅有一枚都城朝局印记`,
  );
  assert.deepEqual(
    [...new Set(political.visiblePulses.map((pulse) => pulse.polityId))].sort(),
    baseline.polities.map((polity) => polity.id).sort(),
    `${scenario.slug} 都城印记必须覆盖所有存续政权且不重复`,
  );
  for (const pulse of political.visiblePulses) {
    assert.deepEqual(pulse.target, { kind: 'country', id: pulse.polityId });
    assert.ok(pulse.status?.trim(), `${scenario.slug} ${pulse.id} 必须给出具体朝局判断`);
    assert.ok(pulse.summary?.trim(), `${scenario.slug} ${pulse.id} 必须给出具体实据摘要`);
  }

  const map = page.locator('.world-map');
  assert.equal(await map.getAttribute('data-overlay'), 'political');
  assert.deepEqual(
    commaSeparatedAttribute(await map.getAttribute('data-political-pulse-ids')),
    politicalMarkerIds(political.visiblePulses),
    `${scenario.slug} Canvas 都城印记顺序必须与文本投影一致`,
  );
  assert.equal(await map.getAttribute('data-political-root-ids'), null);
  assert.equal(await map.getAttribute('data-political-focus-polity-id'), null);
  assert.equal(await map.getAttribute('data-political-focus-faction-id'), null);
  assertObserverInvariant(await snapshot(page), baseline, `${scenario.slug} 查看都城朝局印记`);
}

async function expandMobileCountryInspector(page, scenario, inspector) {
  // 761–840px is a touch-friendly full dossier, not the compact map quick-look.
  if (scenario.viewport.width > MOBILE_QUICK_LOOK_MAX_WIDTH) return;
  const mode = await inspector.getAttribute('data-mobile-mode');
  assert.ok(mode === 'quick' || mode === 'full', `${scenario.slug} 移动档案必须声明速览/完整模式`);
  if (mode === 'quick') await activate(page.getByTestId('map-quick-look-details'), scenario);
  await page.waitForFunction(() => (
    document.querySelector('.observer-inspector[data-kind="country"]')?.getAttribute('data-mobile-mode') === 'full'
  ));
}

async function waitForExactCourtFocus(
  page,
  scenario,
  baseline,
  target,
  preservedMapFactionId,
  detail,
) {
  const selected = await waitForState(
    page,
    (current, expected) => current.interface?.selected?.kind === 'country'
      && current.interface.selected.id === expected.polityId
      && current.interface.politicalMap?.courtEntryActive === true
      && current.interface.politicalMap?.courtFocusedPolityId === expected.polityId
      && current.interface.politicalMap?.courtFocusedFactionId === expected.factionId
      && current.interface.politicalMap?.focusedFactionId === expected.preservedMapFactionId,
    { ...target, preservedMapFactionId },
  );
  assert.equal(selected.interface.selected.initialTab, 'court', `${scenario.slug} ${detail}必须直达朝局页`);
  assert.deepEqual(
    {
      polityId: selected.interface.selected.courtFocus?.polityId,
      factionId: selected.interface.selected.courtFocus?.factionId,
    },
    target,
    `${scenario.slug} ${detail}必须保留精确政权/派系请求`,
  );
  assert.equal(
    selected.interface.politicalMap.focusedFactionId,
    preservedMapFactionId,
    `${scenario.slug} ${detail}不得改写地图政治 overlay 的 focusedFactionId`,
  );
  assertObserverInvariant(selected, baseline, `${scenario.slug} ${detail}`);

  const map = page.locator('.world-map');
  assert.equal(
    await map.getAttribute('data-political-focus-faction-id'),
    preservedMapFactionId,
    `${scenario.slug} ${detail}不得改写地图 DOM 的派系 overlay 焦点`,
  );
  const inspector = page.locator('.observer-inspector[data-kind="country"]');
  await inspector.waitFor({ state: 'visible' });
  await expandMobileCountryInspector(page, scenario, inspector);
  const court = inspector.getByTestId('court-projection');
  await court.waitFor({ state: 'visible' });
  await waitForAnimations(court);
  assert.equal(
    await court.getAttribute('data-court-focused-faction-id'),
    target.factionId,
    `${scenario.slug} ${detail}必须在朝局中聚焦 exact faction`,
  );
  assert.equal(
    await court.getAttribute('data-court-focus-state'),
    'faction',
    `${scenario.slug} ${detail}不得静默回退到默认派系`,
  );
  return { inspector, court, selected: await snapshot(page) };
}

async function openCountryCourtFromCapitalPulse(page, scenario, baseline) {
  const pulse = baseline.interface.politicalMap.visiblePulses
    .find((item) => item.polityId === scenario.targetPolityId);
  assert.ok(pulse, `${scenario.slug} 目标政权必须有都城朝局印记`);
  assert.ok(pulse.factionId, `${scenario.slug} 都城朝局印记必须公开其真实主导派系`);
  const point = await mapMarkerScreenPoint(page, pulse.id);
  assert.ok(point, `${scenario.slug} 必须能解析都城朝局印记的屏幕坐标`);
  await activateCanvasPoint(page, scenario, point);
  const opened = await waitForExactCourtFocus(
    page,
    scenario,
    baseline,
    { polityId: pulse.polityId, factionId: pulse.factionId },
    baseline.interface.politicalMap.focusedFactionId,
    '点都城印记',
  );
  const courtTab = opened.inspector.locator('[data-inspector-tab="court"]');
  assert.equal(await courtTab.getAttribute('aria-selected'), 'true', `${scenario.slug} 都城印记必须直接打开朝局页`);
  return opened;
}

async function openPolityRoster(page, scenario) {
  const trigger = page.locator('[data-observer-view="powers"]');
  const panel = page.locator('.roster-panel[data-roster-scope="powers"]');
  if (!await panel.isVisible().catch(() => false)) await activate(trigger, scenario);
  await panel.waitFor({ state: 'visible' });
  const tab = panel.locator('[data-roster-section="polities"]');
  if ((await tab.getAttribute('aria-selected')) !== 'true') await activate(tab, scenario);
  const polityPanel = page.locator('.roster-panel[data-roster-directory="polities"]');
  await polityPanel.waitFor({ state: 'visible' });
  return polityPanel;
}

async function openCountryCourt(page, scenario, baseline) {
  const roster = await openPolityRoster(page, scenario);
  const row = roster.locator(`[data-roster-id="${scenario.targetPolityId}"]`);
  assert.equal(await row.count(), 1, `${scenario.slug} 列国卷必须存在目标政权`);
  await activate(row, scenario);
  await waitForState(
    page,
    (current, polityId) => current.interface?.selected?.kind === 'country'
      && current.interface.selected.id === polityId,
    scenario.targetPolityId,
  );

  const inspector = page.locator('.observer-inspector[data-kind="country"]');
  await inspector.waitFor();
  if (scenario.viewport.width <= MOBILE_DOSSIER_MAX_WIDTH) {
    await expandMobileCountryInspector(page, scenario, inspector);
  } else {
    const closeRoster = roster.getByRole('button', { name: /关闭天下列国/ });
    if (await closeRoster.isVisible().catch(() => false)) await closeRoster.click();
  }

  const courtTab = inspector.locator('[data-inspector-tab="court"]');
  await activate(courtTab, scenario);
  const court = inspector.getByTestId('court-projection');
  await court.waitFor({ state: 'visible' });
  await waitForAnimations(court);
  const selected = await waitForState(
    page,
    (current, polityId) => current.interface?.selectedDetail?.court?.polityId === polityId,
    scenario.targetPolityId,
  );
  assertObserverInvariant(selected, baseline, `${scenario.slug} 打开国家朝局`);
  return { inspector, court, selected };
}

async function visibleAttributeValues(locator, attribute) {
  return locator.evaluateAll((elements, name) => elements
    .filter((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    })
    .map((element) => element.getAttribute(name))
    .filter(Boolean), attribute);
}

async function assertProjectionAlignment(page, scenario, court, selected) {
  const projection = selected.interface.selectedDetail?.court;
  assert.ok(projection, `${scenario.slug} render_game_to_text 必须公开朝堂投影`);
  assert.equal(projection.polityId, scenario.targetPolityId);
  assert.ok(projection.seats.length > 0, `${scenario.slug} 朝堂必须至少有一个实际在任席位`);
  assert.ok(
    projection.seats.every((seat) => CENTRAL_OFFICES.has(seat.office)),
    `${scenario.slug} 地方、军队与家族根基不得冒充中枢席位`,
  );
  assert.equal(
    projection.seats.filter((seat) => seat.office === '君主').length,
    projection.ruler ? 1 : 0,
    `${scenario.slug} 君位投影必须唯一`,
  );

  assert.equal(
    (await court.locator('.court-projection__summary').textContent())?.trim(),
    projection.summary,
    `${scenario.slug} 朝局总断必须与文本快照一致`,
  );
  assert.deepEqual(
    await visibleAttributeValues(court.locator('[data-court-seat]'), 'data-court-seat'),
    projection.seats.map((seat) => seat.officeId),
    `${scenario.slug} 可见座次及顺序必须与文本快照一致`,
  );
  assert.deepEqual(
    await court.locator('[data-court-rank]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-court-rank'))),
    projection.factionPositions.map((position) => position.factionId),
    `${scenario.slug} 派系排名必须与文本快照逐项一致`,
  );

  const rankingRows = court.locator('[data-court-rank]');
  for (let index = 0; index < projection.factionPositions.length; index += 1) {
    const position = projection.factionPositions[index];
    const text = (await rankingRows.nth(index).textContent()) ?? '';
    assert.match(text, new RegExp(position.name), `${scenario.slug} 第${index + 1}派名称应与快照一致`);
    assert.match(text, new RegExp(String(Math.round(position.power))), `${scenario.slug} 第${index + 1}派权势应与快照一致`);
  }

  const desktopLayout = court.locator('[data-court-layout="desktop"]');
  const desktopDisplay = await desktopLayout.evaluate((element) => getComputedStyle(element).display);
  const mobileSeats = court.locator('.court-projection__mobile-seats');
  const mobileDisplay = await mobileSeats.evaluate((element) => getComputedStyle(element).display);
  if (scenario.viewport.width <= MOBILE_SEAT_MAX_WIDTH) {
    assert.equal(desktopDisplay, 'none', `${scenario.slug} 窄屏不得压缩桌面座次图`);
    assert.notEqual(mobileDisplay, 'none', `${scenario.slug} 窄屏必须改用按远近排序的席位清单`);
    assert.equal(
      await court.locator('[data-court-faction]:visible').count(),
      0,
      `${scenario.slug} 隐藏桌面图时不得泄漏派系印记`,
    );
  } else {
    assert.notEqual(desktopDisplay, 'none', `${scenario.slug} 桌面必须显示暖纸座次图`);
    assert.equal(mobileDisplay, 'none', `${scenario.slug} 桌面不得重复显示移动席位清单`);
    assert.deepEqual(
      await visibleAttributeValues(court.locator('[data-court-faction]'), 'data-court-faction'),
      projection.graphFactionIds,
      `${scenario.slug} 桌面派系印记必须与文本快照一致`,
    );
  }

  const relationRows = court.locator('.court-projection__relations li[data-relation]');
  assert.equal(
    await relationRows.count(),
    projection.relations.length,
    `${scenario.slug} 联盟/相争条数必须与文本快照一致`,
  );
  assert.ok(projection.relations.length > 0, `${scenario.slug} 固定季度必须形成至少一条可见派系关系`);
  for (let index = 0; index < projection.relations.length; index += 1) {
    const relation = projection.relations[index];
    const row = relationRows.nth(index);
    assert.equal(await row.getAttribute('data-relation'), relation.kind);
    const text = (await row.textContent()) ?? '';
    for (const token of [relation.leftName, relation.label, relation.rightName]) {
      assert.ok(text.includes(token), `${scenario.slug} 关系行必须显示“${token}”`);
    }
  }

  assert.equal(
    await court.locator('[data-court-focus-detail]').count(),
    1,
    `${scenario.slug} 朝局只能保留一处焦点详情`,
  );
  const dominant = projection.factionPositions[0];
  assert.ok(dominant, `${scenario.slug} 固定政权必须有可排名派系`);
  const requestedFactionId = selected.interface.politicalMap?.courtFocusedFactionId;
  const expectedFocus = projection.factionPositions
    .find((position) => position.factionId === requestedFactionId) ?? dominant;
  assert.match(
    (await court.locator('[data-court-focus-detail] h4').textContent()) ?? '',
    new RegExp(expectedFocus.name),
    `${scenario.slug} 朝局详情必须指向请求的 exact faction；无请求时才用排名首位派系`,
  );

  const layout = await page.evaluate(() => {
    const inspector = document.querySelector('.observer-inspector');
    const courtElement = document.querySelector('[data-testid="court-projection"]');
    const metrics = (element) => element ? {
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      left: element.getBoundingClientRect().left,
      right: element.getBoundingClientRect().right,
    } : null;
    return {
      viewportWidth: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      inspector: metrics(inspector),
      court: metrics(courtElement),
    };
  });
  assert.ok(
    layout.documentWidth <= layout.viewportWidth + 1,
    `${scenario.slug} 页面不得横向溢出：${JSON.stringify(layout)}`,
  );
  for (const [name, metrics] of [['档案', layout.inspector], ['朝局', layout.court]]) {
    assert.ok(metrics, `${scenario.slug} ${name}容器必须存在`);
    assert.ok(metrics.scrollWidth <= metrics.clientWidth + 1, `${scenario.slug} ${name}内容不得横向溢出`);
    assert.ok(metrics.left >= -1 && metrics.right <= layout.viewportWidth + 1, `${scenario.slug} ${name}必须落在视口内`);
  }

  const targetMetrics = await court.locator('button:visible, summary:visible').evaluateAll((targets) => (
    targets.map((target) => {
      const rect = target.getBoundingClientRect();
      return {
        label: `${target.getAttribute('aria-label') ?? ''} ${target.textContent ?? ''}`.replace(/\s+/g, ' ').trim(),
        width: rect.width,
        height: rect.height,
      };
    })
  ));
  assert.ok(targetMetrics.length > 0, `${scenario.slug} 朝局必须有可操作入口`);
  for (const target of targetMetrics) {
    assert.ok(
      target.width >= 44 && target.height >= 44,
      `${scenario.slug} “${target.label}”触控区至少应为44px：${JSON.stringify(target)}`,
    );
  }
}

async function exerciseFocusAndTrace(page, scenario, baseline, court, selected) {
  const projection = selected.interface.selectedDetail.court;
  const seat = projection.seats[0];
  const visibleSeat = court.locator(`[data-court-seat="${seat.officeId}"]:visible`);
  await activate(visibleSeat, scenario);
  assert.equal(await visibleSeat.getAttribute('aria-pressed'), 'true');
  assert.match(
    (await court.locator('[data-court-focus-detail] h4').textContent()) ?? '',
    new RegExp(seat.holder),
    `${scenario.slug} 点席位后焦点详情必须显示任官者`,
  );
  assert.ok(seat.appointmentEvidence, `${scenario.slug} 中枢席位必须公开具体任职依据`);
  const appointment = court.locator('[data-court-focus-detail] .court-projection__appointment');
  assert.equal(await appointment.count(), 1, `${scenario.slug} 席位详情必须提供“为何任此职”`);
  await activate(appointment.locator('summary'), scenario);
  assert.ok(
    ((await appointment.textContent()) ?? '').includes(seat.appointmentEvidence),
    `${scenario.slug} 席位任职依据必须与权威 Fact 投影一致`,
  );
  if (seat.sourceEventId) {
    const appointmentHistory = court.getByRole('button', { name: '查看任命史事', exact: true });
    assert.equal(await appointmentHistory.count(), 1, `${scenario.slug} 有史事来源的任命必须可继续追溯`);
    await activate(appointmentHistory, scenario);
    const appointmentDrawer = page.locator('#observer-causal-drawer');
    await appointmentDrawer.waitFor({ state: 'visible' });
    const tracedAppointment = await waitForState(
      page,
      (current, eventId) => current.interface?.selectedEventId === eventId,
      seat.sourceEventId,
    );
    assertObserverInvariant(tracedAppointment, baseline, `${scenario.slug} 查阅任命史事`);
    await page.keyboard.press('Escape');
    await appointmentDrawer.waitFor({ state: 'detached' });
    await court.waitFor({ state: 'visible' });
  }
  assertObserverInvariant(await snapshot(page), baseline, `${scenario.slug} 查看中枢席位`);

  const firstRank = court.locator('[data-court-rank]').first();
  await activate(firstRank, scenario);
  assert.equal(await firstRank.getAttribute('aria-pressed'), 'true');
  if (projection.factionPositions.length > 1) {
    await firstRank.focus();
    await page.keyboard.press('ArrowDown');
    assert.equal(
      await page.evaluate(() => document.activeElement?.getAttribute('data-court-rank')),
      projection.factionPositions[1].factionId,
      `${scenario.slug} 派系排名必须支持方向键逐项浏览`,
    );
    await firstRank.focus();
  }

  const relationFold = court.locator('.court-projection__relation-fold');
  if ((await relationFold.getAttribute('open')) === null) await activate(relationFold.locator('summary'), scenario);
  const firstRelation = court.locator('.court-projection__relations li[data-relation]').first();
  const relationWhy = firstRelation.getByRole('button', { name: /查看.+缘由/ });
  assert.equal(await relationWhy.count(), 1, `${scenario.slug} 派系关系必须给出可追溯入口`);
  const relationSourceId = projection.relations[0].sourceEventId;
  assert.ok(relationSourceId, `${scenario.slug} 派系关系必须绑定权威史事`);
  await activate(relationWhy, scenario);
  const drawer = page.locator('#observer-causal-drawer');
  await drawer.waitFor({ state: 'visible' });
  const traced = await waitForState(
    page,
    (current, eventId) => current.interface?.selectedEventId === eventId,
    relationSourceId,
  );
  assertObserverInvariant(traced, baseline, `${scenario.slug} 查阅派系关系缘由`);
  await page.keyboard.press('Escape');
  await drawer.waitFor({ state: 'detached' });
  await court.waitFor({ state: 'visible' });
}

async function exerciseHistoryFactionRoundTrip(page, scenario, baseline, court, selected) {
  const relation = selected.interface.selectedDetail.court.relations[0];
  assert.ok(relation?.sourceEventId, `${scenario.slug} 固定派系关系必须有可追溯史事`);
  const relationFold = court.locator('.court-projection__relation-fold');
  if ((await relationFold.getAttribute('open')) === null) await activate(relationFold.locator('summary'), scenario);
  const relationRow = court.locator('.court-projection__relations li[data-relation]').first();
  const relationWhy = relationRow.getByRole('button', { name: /查看.+缘由/ });
  await activate(relationWhy, scenario);
  const drawer = page.locator('#observer-causal-drawer');
  await drawer.waitFor({ state: 'visible' });
  const eventState = await waitForState(
    page,
    (current, eventId) => current.interface?.selectedEventId === eventId,
    relation.sourceEventId,
  );
  assertObserverInvariant(eventState, baseline, `${scenario.slug} 打开派系关系史事`);

  const factionButton = drawer.locator(
    `[data-court-focus-faction="${relation.leftFactionId}"]`,
  );
  assert.equal(
    await factionButton.count(),
    1,
    `${scenario.slug} 派系关系史事必须保留左派 exact faction 入口`,
  );
  await assertMobileTapTarget(factionButton, scenario, '史事所系朝局派系入口');
  await activate(factionButton, scenario);
  await drawer.waitFor({ state: 'detached' });
  const returned = await waitForExactCourtFocus(
    page,
    scenario,
    baseline,
    { polityId: scenario.targetPolityId, factionId: relation.leftFactionId },
    eventState.interface.politicalMap.focusedFactionId,
    '从史事所系朝局进入派系',
  );
  assertObserverInvariant(returned.selected, baseline, `${scenario.slug} 史事派系往返完整链`);
  return returned;
}

async function closePersonInspector(page, scenario, inspector) {
  const close = inspector.locator('[data-inspector-close]');
  assert.equal(await close.count(), 1, `${scenario.slug} 人物档案必须有明确返回/关闭入口`);
  await activate(close, scenario);
  await inspector.waitFor({ state: 'detached' });
}

async function exerciseLeaderRoundTrip(page, scenario, baseline, court, selected) {
  const dominant = selected.interface.selectedDetail.court.factionPositions[0];
  await activate(court.locator(`[data-court-rank="${dominant.factionId}"]`), scenario);
  const leader = court.getByRole('button', { name: `看领袖 · ${dominant.leader}`, exact: true });
  assert.equal(await leader.count(), 1, `${scenario.slug} 焦点派系必须提供领袖人物入口`);
  await activate(leader, scenario);

  const personInspector = page.locator('.observer-inspector[data-kind="person"]');
  await personInspector.waitFor({ state: 'visible' });
  const person = await waitForState(
    page,
    (current, personId) => current.interface?.selected?.kind === 'person'
      && current.interface.selected.id === personId,
    dominant.leaderId,
  );
  assertObserverInvariant(person, baseline, `${scenario.slug} 从朝局查看派系领袖`);
  assert.match(
    (await personInspector.locator('h2').first().textContent()) ?? '',
    new RegExp(dominant.leader),
    `${scenario.slug} 领袖入口必须打开同一人物档案`,
  );
  if (scenario.viewport.width <= MOBILE_QUICK_LOOK_MAX_WIDTH
    && await personInspector.getAttribute('data-mobile-mode') === 'quick') {
    await activate(personInspector.getByTestId('map-quick-look-details'), scenario);
    await page.waitForFunction(() => (
      document.querySelector('.observer-inspector[data-kind="person"]')?.getAttribute('data-mobile-mode') === 'full'
    ));
  }
  const mindTab = personInspector.locator('[data-inspector-tab="mind"]');
  if ((await mindTab.getAttribute('aria-selected')) !== 'true') await activate(mindTab, scenario);
  const powerPosition = personInspector.getByTestId('person-power-position');
  await powerPosition.waitFor({ state: 'visible' });
  const factionButton = powerPosition.locator(`[data-court-focus-faction="${dominant.factionId}"]`);
  assert.equal(
    await factionButton.count(),
    1,
    `${scenario.slug} 领袖“手中权势”必须给出其 exact faction 入口`,
  );
  await assertMobileTapTarget(factionButton, scenario, '人物手中权势派系入口');
  const beforeCourtFocus = await snapshot(page);
  assertObserverInvariant(beforeCourtFocus, baseline, `${scenario.slug} 查看人物手中权势`);
  await activate(factionButton, scenario);
  const returned = await waitForExactCourtFocus(
    page,
    scenario,
    baseline,
    { polityId: scenario.targetPolityId, factionId: dominant.factionId },
    beforeCourtFocus.interface.politicalMap.focusedFactionId,
    '从人物手中权势进入派系',
  );
  assert.deepEqual(
    returned.selected.interface.selectedDetail.court.factionPositions.map((position) => position.factionId),
    selected.interface.selectedDetail.court.factionPositions.map((position) => position.factionId),
    `${scenario.slug} 领袖往返后派系次序不得漂移`,
  );
  assertObserverInvariant(returned.selected, baseline, `${scenario.slug} 领袖人物往返完整链`);
  return returned;
}

async function exerciseFamilyRoundTrip(page, scenario, baseline, court, selected) {
  const dominant = selected.interface.selectedDetail.court.factionPositions[0];
  await activate(court.locator(`[data-court-rank="${dominant.factionId}"]`), scenario);
  const leader = court.getByRole('button', { name: `看领袖 · ${dominant.leader}`, exact: true });
  await activate(leader, scenario);

  const personInspector = page.locator('.observer-inspector[data-kind="person"]');
  await personInspector.waitFor({ state: 'visible' });
  const familyLink = personInspector
    .locator('[aria-labelledby="person-origin-heading"] .observer-text-link');
  assert.equal(await familyLink.count(), 1, `${scenario.slug} 派系领袖必须可进入其真实家族`);
  await activate(familyLink, scenario);

  const familyInspector = page.locator('.observer-inspector[data-kind="family"]');
  await familyInspector.waitFor({ state: 'visible' });
  const familyState = await waitForState(
    page,
    (current) => current.interface?.selected?.kind === 'family',
    null,
  );
  assertObserverInvariant(familyState, baseline, `${scenario.slug} 从派系领袖查看家族`);
  const factionButton = familyInspector.locator(
    `[data-court-focus-faction="${dominant.factionId}"]`,
  );
  assert.equal(
    await factionButton.count(),
    1,
    `${scenario.slug} 领袖家族必须保留该派的真实在朝/账本支点`,
  );
  await assertMobileTapTarget(factionButton, scenario, '家族在朝派系入口');
  await activate(factionButton, scenario);
  const returned = await waitForExactCourtFocus(
    page,
    scenario,
    baseline,
    { polityId: scenario.targetPolityId, factionId: dominant.factionId },
    familyState.interface.politicalMap.focusedFactionId,
    '从家族在朝支点进入派系',
  );
  assert.deepEqual(
    returned.selected.interface.selectedDetail.court.factionPositions.map((position) => position.factionId),
    selected.interface.selectedDetail.court.factionPositions.map((position) => position.factionId),
    `${scenario.slug} 家族往返后派系次序不得漂移`,
  );
  assertObserverInvariant(returned.selected, baseline, `${scenario.slug} 家族派系往返完整链`);
  return returned;
}

async function exerciseSeatHolderRoundTrip(page, scenario, baseline, court, selected) {
  const seat = selected.interface.selectedDetail.court.seats[0];
  await activate(court.locator(`[data-court-seat="${seat.officeId}"]:visible`), scenario);
  const personLink = court.getByRole('button', { name: `看人物 · ${seat.holder}`, exact: true });
  assert.equal(await personLink.count(), 1, `${scenario.slug} 焦点席位必须提供任官者人物入口`);
  await activate(personLink, scenario);

  const personInspector = page.locator('.observer-inspector[data-kind="person"]');
  await personInspector.waitFor({ state: 'visible' });
  const person = await waitForState(
    page,
    (current, personId) => current.interface?.selected?.kind === 'person'
      && current.interface.selected.id === personId,
    seat.holderId,
  );
  assertObserverInvariant(person, baseline, `${scenario.slug} 从中枢席位查看任官者`);
  assert.match(
    (await personInspector.locator('h2').first().textContent()) ?? '',
    new RegExp(seat.holder),
    `${scenario.slug} 席位人物入口必须打开同一人物档案`,
  );
  await closePersonInspector(page, scenario, personInspector);

  const returned = await openCountryCourt(page, scenario, baseline);
  assert.deepEqual(
    returned.selected.interface.selectedDetail.court.seats.map((item) => item.officeId),
    selected.interface.selectedDetail.court.seats.map((item) => item.officeId),
    `${scenario.slug} 任官者往返后中枢席位不得漂移`,
  );
  assertObserverInvariant(returned.selected, baseline, `${scenario.slug} 任官者人物往返完整链`);
  return returned;
}

async function closeVisibleInspector(page, scenario) {
  const inspector = page.locator('.observer-inspector:visible');
  if (!await inspector.count()) return;
  const quick = scenario.viewport.width <= MOBILE_QUICK_LOOK_MAX_WIDTH
    && await inspector.getAttribute('data-mobile-mode') === 'quick';
  const close = quick
    ? inspector.getByTestId('map-quick-look').getByRole('button', { name: '收起', exact: true })
    : inspector.locator('[data-inspector-close]');
  assert.equal(await close.count(), 1, `${scenario.slug} 地图对象档案必须可返回舆图`);
  await activate(close, scenario);
  await inspector.waitFor({ state: 'detached' });
}

async function assertMapFitsViewport(page, scenario, detail) {
  const layout = await page.evaluate(() => {
    const map = document.querySelector('.world-map');
    const canvas = document.querySelector('.world-map__canvas');
    const metrics = (element) => element ? {
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      left: element.getBoundingClientRect().left,
      right: element.getBoundingClientRect().right,
    } : null;
    return {
      viewportWidth: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      map: metrics(map),
      canvas: metrics(canvas),
    };
  });
  assert.ok(layout.documentWidth <= layout.viewportWidth + 1, `${scenario.slug} ${detail}不得引发页面横滚动`);
  for (const [name, metrics] of [['舆图', layout.map], ['Canvas', layout.canvas]]) {
    assert.ok(metrics, `${scenario.slug} ${name}必须存在`);
    assert.ok(metrics.scrollWidth <= metrics.clientWidth + 1, `${scenario.slug} ${name}不得内溢出`);
    assert.ok(metrics.left >= -1 && metrics.right <= layout.viewportWidth + 1, `${scenario.slug} ${name}必须落在视口内`);
  }
}

async function chooseMapOverlay(page, scenario, overlayId) {
  await activate(page.locator('[data-navigation-entry="layers"]'), scenario);
  const sheet = page.locator('#observer-layer-sheet');
  await sheet.waitFor({ state: 'visible' });
  const layer = sheet.locator(`[data-layer-id="${overlayId}"]`);
  assert.equal(await layer.count(), 1, `${scenario.slug} 叠层菜单必须提供 ${overlayId}`);
  await activate(layer, scenario);
  await waitForState(page, (current, expected) => current.interface?.overlay === expected, overlayId);
}

async function exerciseFactionMapRoots(page, scenario, baseline, court, selected) {
  const dominant = selected.interface.selectedDetail.court.factionPositions[0];
  assert.ok(dominant, `${scenario.slug} 目标朝局必须有首位派系`);
  await activate(court.locator(`[data-court-rank="${dominant.factionId}"]`), scenario);
  const rootsTrigger = court.locator(`[data-court-map-roots="${dominant.factionId}"]`);
  assert.equal(await rootsTrigger.count(), 1, `${scenario.slug} 派系详情必须提供“舆图看根基”`);
  await activate(rootsTrigger, scenario);
  await page.locator('.observer-inspector[data-kind="country"]').waitFor({ state: 'detached' });

  const focused = await waitForState(
    page,
    (current, expected) => current.interface?.overlay === 'political'
      && current.interface.politicalMap?.focusedPolityId === expected.polityId
      && current.interface.politicalMap?.focusedFactionId === expected.factionId
      && current.interface.politicalMap.visibleRoots.length > 0,
    { polityId: scenario.targetPolityId, factionId: dominant.factionId },
  );
  assertObserverInvariant(focused, baseline, `${scenario.slug} 在舆图展开派系根基`);
  const political = focused.interface.politicalMap;
  assert.equal(political.visiblePulses.length, baseline.polities.length, `${scenario.slug} 展开根基后不得丢失都城印记`);
  assert.ok(political.visibleRoots.length > 0, `${scenario.slug} 固定派系必须有真实空间根基`);
  const targetKindByCategory = {
    regional_governance: 'region',
    army_command: 'army',
    fleet_command: 'fleet',
  };
  for (const root of political.visibleRoots) {
    assert.equal(root.polityId, scenario.targetPolityId);
    assert.equal(root.factionId, dominant.factionId);
    assert.equal(root.target.kind, targetKindByCategory[root.category], `${scenario.slug} ${root.label} 必须指向同类权威对象`);
    assert.ok(root.target.id, `${scenario.slug} ${root.label} 不得指向空对象`);
    assert.ok(root.detail?.trim(), `${scenario.slug} ${root.label} 必须说明掌握根基的具体人与事`);
  }

  const map = page.locator('.world-map');
  assert.deepEqual(
    commaSeparatedAttribute(await map.getAttribute('data-political-pulse-ids')),
    politicalMarkerIds(political.visiblePulses),
    `${scenario.slug} 聚焦后都城印记 DOM/文本必须一致`,
  );
  assert.deepEqual(
    commaSeparatedAttribute(await map.getAttribute('data-political-root-ids')),
    politicalMarkerIds(political.visibleRoots),
    `${scenario.slug} 派系根基 DOM/文本必须一致`,
  );
  assert.equal(await map.getAttribute('data-political-focus-polity-id'), scenario.targetPolityId);
  assert.equal(await map.getAttribute('data-political-focus-faction-id'), dominant.factionId);
  await assertMapFitsViewport(page, scenario, '派系根基层');
  await page.screenshot({ path: `${ARTIFACT_DIR}/${scenario.slug}-map-roots.png`, fullPage: false });

  const preferredTargetKinds = scenario.viewport.width <= MOBILE_DOSSIER_MAX_WIDTH
    ? ['region', 'army', 'fleet']
    : ['army', 'fleet', 'region'];
  const targetRoot = preferredTargetKinds
    .map((kind) => political.visibleRoots.find((root) => root.target.kind === kind))
    .find(Boolean);
  assert.ok(targetRoot, `${scenario.slug} 必须有可点的州治、军令或水师根基`);
  const point = await mapMarkerScreenPoint(page, targetRoot.id);
  assert.ok(point, `${scenario.slug} 必须能解析根基印记的屏幕坐标`);
  await activateCanvasPoint(page, scenario, point);
  await page.waitForTimeout(320);
  const opened = await snapshot(page);
  assert.deepEqual(
    { kind: opened.interface?.selected?.kind, id: opened.interface?.selected?.id },
    targetRoot.target,
    `${scenario.slug} 根基印记必须打开其权威对象`,
  );
  assertObserverInvariant(opened, baseline, `${scenario.slug} 根基印记打开真实对象档案`);
  const inspectorKind = targetRoot.target.kind === 'region' ? 'region' : 'system';
  await page.locator(`.observer-inspector[data-kind="${inspectorKind}"]`).waitFor({ state: 'visible' });
  await closeVisibleInspector(page, scenario);

  const pulseIds = politicalMarkerIds(political.visiblePulses);
  const rootIds = politicalMarkerIds(political.visibleRoots);
  await chooseMapOverlay(page, scenario, 'food');
  const hidden = await snapshot(page);
  assertObserverInvariant(hidden, baseline, `${scenario.slug} 切离疆界层`);
  assert.equal(hidden.interface.politicalMap.active, false);
  assert.deepEqual(hidden.interface.politicalMap.visiblePulses, []);
  assert.deepEqual(hidden.interface.politicalMap.visibleRoots, []);
  assert.equal(await map.getAttribute('data-political-pulse-ids'), null);
  assert.equal(await map.getAttribute('data-political-root-ids'), null);

  await chooseMapOverlay(page, scenario, 'political');
  const restored = await waitForState(
    page,
    (current, expected) => current.interface.politicalMap?.active === true
      && current.interface.politicalMap.visiblePulses.length === expected.pulseCount
      && current.interface.politicalMap.visibleRoots.length === expected.rootCount,
    { pulseCount: pulseIds.length, rootCount: rootIds.length },
  );
  assertObserverInvariant(restored, baseline, `${scenario.slug} 切回疆界层`);
  assert.deepEqual(politicalMarkerIds(restored.interface.politicalMap.visiblePulses), pulseIds);
  assert.deepEqual(politicalMarkerIds(restored.interface.politicalMap.visibleRoots), rootIds);
  assert.deepEqual(
    commaSeparatedAttribute(await map.getAttribute('data-political-pulse-ids')),
    pulseIds,
  );
  assert.deepEqual(
    commaSeparatedAttribute(await map.getAttribute('data-political-root-ids')),
    rootIds,
  );
  await assertMapFitsViewport(page, scenario, '疆界层恢复');
  return restored;
}

async function exerciseCourtSituationRoundTrip(page, scenario, baseline) {
  const situation = selectCourtSituation(baseline, scenario);
  if (!situation) return baseline;
  assert.equal(situation.typeLabel, '朝堂权斗');
  assert.match(situation.title, /朝堂权斗/);
  for (const hidden of ['participants', 'politicalFocus', 'evidence', 'phase', 'nextSignal']) {
    assert.equal(
      Object.hasOwn(situation, hidden),
      false,
      `${scenario.slug} 局势目录不得泄漏后台字段 ${hidden}`,
    );
  }
  assert.equal(baseline.interface.overlay, 'political', `${scenario.slug} 阅读朝局应从疆界政治层开始`);

  const shortcut = page.locator('[data-situation-workbench-trigger="true"]');
  await shortcut.waitFor({ state: 'visible' });
  await assertMobileTapTarget(shortcut, scenario, '持续局势入口');
  await activate(shortcut, scenario);
  const workbench = page.locator('.situation-workbench');
  await workbench.waitFor({ state: 'visible' });
  const targetRow = workbench.locator(`.situation-workbench__directory button[data-situation-id="${situation.id}"]`);
  if (!await targetRow.isVisible()) {
    const directoryToggle = workbench.locator('.situation-workbench__directory-toggle');
    await assertMobileTapTarget(directoryToggle, scenario, '局势目录开关');
    await activate(directoryToggle, scenario);
    await targetRow.waitFor({ state: 'visible' });
  }
  await assertMobileTapTarget(targetRow, scenario, '朝堂权斗目录项');
  await activate(targetRow, scenario);
  const opened = await waitForState(
    page,
    (current, expected) => current.observer?.selectedSituationId === expected.id
      && current.observer?.selectedSituation?.type === 'court_power_struggle',
    { id: situation.id },
  );
  if (scenario.viewport.width <= MOBILE_DOSSIER_MAX_WIDTH
    && await workbench.getAttribute('data-mobile-directory') !== null) {
    await activate(workbench.locator('.situation-workbench__directory-toggle'), scenario);
    await page.waitForFunction(() => (
      document.querySelector('.situation-workbench')?.getAttribute('data-mobile-directory') === null
    ));
  }
  assertObserverInvariant(opened, baseline, `${scenario.slug} 阅读朝堂权斗`);
  assert.equal(opened.interface.overlay, 'political', `${scenario.slug} 阅卷不得离开政治疆界层`);
  const detail = opened.observer.selectedSituation;
  assert.equal(detail.title, situation.title);
  assert.ok(detail.playerSummary.length >= 1, `${scenario.slug} 朝堂权斗应有一句明确的当季事实`);
  for (const hidden of ['participants', 'politicalFocus', 'evidence', 'phase', 'nextSignal']) {
    assert.equal(
      Object.hasOwn(detail, hidden),
      false,
      `${scenario.slug} 文本快照不得泄漏卷宗后台字段 ${hidden}`,
    );
  }
  const currentAction = (await workbench.getByTestId('situation-current-action').textContent()) ?? '';
  const concreteCopy = [
    ...detail.playerSummary,
    currentAction,
    ...detail.scenes.flatMap((scene) => [scene.title, scene.summary, scene.result]),
  ].join(' ');
  assert.doesNotMatch(
    concreteCopy,
    /萌芽|发展|临界|张力|势头|推动因素/,
    `${scenario.slug} 朝局可见正文不得用后台阶段代替实事`,
  );
  assert.match((await workbench.textContent()) ?? '', /朝堂权斗/);

  const participantDisclosure = workbench.locator('[data-testid="situation-participants-disclosure"]');
  assert.equal(await participantDisclosure.count(), 1, `${scenario.slug} 朝局卷宗应折叠收纳相关各方`);
  const participantSummary = participantDisclosure.locator('summary').first();
  await assertMobileTapTarget(participantSummary, scenario, '局势相关各方入口');
  await activate(participantSummary, scenario);
  await page.waitForFunction(() => document.querySelector('[data-testid="situation-participants-disclosure"]')?.hasAttribute('open'));
  const participantGroups = await participantDisclosure.locator('dl > div').evaluateAll((groups) => (
    groups.map((group) => ({
      label: group.querySelector('dt')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      entities: [...group.querySelectorAll('dd > button, dd > span')]
        .map((entity) => (
          entity.querySelector('strong')?.textContent ?? entity.textContent ?? ''
        ).replace(/\s+/g, ' ').trim())
        .filter(Boolean),
    }))
  ));
  const polityLabel = participantGroups.find((group) => group.label.includes('相关政权'))?.entities[0];
  const namedParticipants = participantGroups
    .filter((group) => group.label.includes('相关派系') || group.label.includes('核心人物'))
    .flatMap((group) => group.entities);
  assert.ok(polityLabel, `${scenario.slug} 朝堂权斗必须在公开卷宗中点明政权`);
  assert.ok(namedParticipants.length > 0, `${scenario.slug} 朝堂权斗必须公开真实派系或人物`);
  assert.match(concreteCopy, new RegExp(polityLabel), `${scenario.slug} 朝局正文必须点明政权`);
  assert.ok(
    namedParticipants.some((label) => concreteCopy.includes(label)),
    `${scenario.slug} 朝局正文必须点明真实派系或人物，不能只说“起源”与“转折”`,
  );
  assert.match((await workbench.textContent()) ?? '', new RegExp(polityLabel));
  await page.screenshot({ path: `${ARTIFACT_DIR}/${scenario.slug}-court-situation.png`, fullPage: false });

  const factionButton = workbench.locator('[data-court-focus-faction]:not([disabled])').first();
  assert.equal(await factionButton.count(), 1, `${scenario.slug} 朝局卷宗应有可进入的真实派系入口`);
  const politicalFocus = {
    polityId: await factionButton.getAttribute('data-court-focus-polity'),
    factionId: await factionButton.getAttribute('data-court-focus-faction'),
  };
  assert.ok(politicalFocus.polityId, `${scenario.slug} 派系入口必须公开所属政权身份`);
  assert.ok(politicalFocus.factionId, `${scenario.slug} 派系入口必须公开派系身份`);
  await assertMobileTapTarget(factionButton, scenario, '局势派系参与者入口');
  await activate(factionButton, scenario);
  await workbench.waitFor({ state: 'detached' });
  const focusedCourt = await waitForExactCourtFocus(
    page,
    scenario,
    baseline,
    { polityId: politicalFocus.polityId, factionId: politicalFocus.factionId },
    opened.interface.politicalMap.focusedFactionId,
    '从 Situation 派系参与者进入朝局',
  );
  const { court, selected: courtState } = focusedCourt;
  assertObserverInvariant(courtState, baseline, `${scenario.slug} 从朝局卷读取国家朝局`);
  assert.equal(courtState.interface.overlay, 'political');
  const courtScenario = { ...scenario, targetPolityId: politicalFocus.polityId };
  await assertProjectionAlignment(page, courtScenario, court, courtState);
  assert.ok(
    courtState.interface.selectedDetail.court.factionPositions
      .some((item) => item.factionId === politicalFocus.factionId),
    `${scenario.slug} Situation 入口必须聚焦仍在当下朝局的同一派系`,
  );
  await page.screenshot({ path: `${ARTIFACT_DIR}/${scenario.slug}-court-situation-polity.png`, fullPage: false });
  await closeVisibleInspector(page, scenario);
  const returned = await snapshot(page);
  assertObserverInvariant(returned, baseline, `${scenario.slug} 朝堂权斗完整阅读链`);
  assert.equal(returned.interface.overlay, 'political');
  return returned;
}

async function verifyScenario(browser, scenario) {
  const context = await browser.newContext({
    viewport: scenario.viewport,
    hasTouch: scenario.viewport.width <= MOBILE_DOSSIER_MAX_WIDTH,
    isMobile: scenario.viewport.width <= MOBILE_DOSSIER_MAX_WIDTH,
  });
  const page = await context.newPage();
  const browserErrors = [];
  collectBrowserErrors(page, browserErrors);

  try {
    const baseline = await createWorld(page, scenario);
    await assertPoliticalMapOverview(page, scenario, baseline);
    const opened = await openCountryCourtFromCapitalPulse(page, scenario, baseline);
    await assertProjectionAlignment(page, scenario, opened.court, opened.selected);
    await exerciseFocusAndTrace(page, scenario, baseline, opened.court, opened.selected);
    await page.screenshot({ path: `${ARTIFACT_DIR}/${scenario.slug}-court.png`, fullPage: false });
    const seatReturned = await exerciseSeatHolderRoundTrip(page, scenario, baseline, opened.court, opened.selected);
    const familyReturned = await exerciseFamilyRoundTrip(
      page,
      scenario,
      baseline,
      seatReturned.court,
      seatReturned.selected,
    );
    const personReturned = await exerciseLeaderRoundTrip(
      page,
      scenario,
      baseline,
      familyReturned.court,
      familyReturned.selected,
    );
    const historyReturned = await exerciseHistoryFactionRoundTrip(
      page,
      scenario,
      baseline,
      personReturned.court,
      personReturned.selected,
    );
    await assertProjectionAlignment(page, scenario, historyReturned.court, historyReturned.selected);
    const mapRestored = await exerciseFactionMapRoots(
      page,
      scenario,
      baseline,
      historyReturned.court,
      historyReturned.selected,
    );
    assertObserverInvariant(mapRestored, baseline, `${scenario.slug} POL03–POL07 完整观察链`);
    const final = await exerciseCourtSituationRoundTrip(page, scenario, baseline);
    assertObserverInvariant(final, baseline, `${scenario.slug} POL07 朝堂权斗与精确派系观察闭环`);
    await page.screenshot({ path: `${ARTIFACT_DIR}/${scenario.slug}-restored.png`, fullPage: false });
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
  process.stdout.write(`POL03–POL07 political visibility E2E passed: turn ${TARGET_TURN} × ${SCENARIOS.length} map/viewport scenarios.\n`);
} finally {
  await browser?.close();
  await server?.close();
}
