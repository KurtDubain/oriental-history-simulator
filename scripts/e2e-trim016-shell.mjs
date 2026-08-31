import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const PORT = Number(process.env.TRIM016_E2E_PORT ?? 4196);
const externalUrl = process.env.TRIM016_E2E_URL;
const APP_URL = externalUrl ?? `http://127.0.0.1:${PORT}`;
const PACKAGE_VERSION = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
).version;
const ARTIFACT_DIR = `output/trim016-shell-e2e-v${PACKAGE_VERSION}`;
const SCENARIO_FILTER = process.env.TRIM016_E2E_SCENARIO;
const SCENARIOS = Object.freeze([
  {
    slug: 'desktop-1440x900',
    viewport: { width: 1440, height: 900 },
    seed: 'TRIM01.6-桌面壳层',
  },
  {
    slug: 'tablet-768x900',
    viewport: { width: 768, height: 900 },
    seed: 'TRIM01.6-平板壳层',
  },
  {
    slug: 'wide-mobile-640x900',
    viewport: { width: 640, height: 900 },
    seed: 'TRIM01.6-宽屏移动壳层',
  },
  {
    slug: 'mobile-390x844',
    viewport: { width: 390, height: 844 },
    seed: 'TRIM01.6-移动壳层',
  },
].filter((scenario) => !SCENARIO_FILTER || scenario.slug === SCENARIO_FILTER));

assert.ok(SCENARIOS.length > 0, `未知 TRIM016 场景：${SCENARIO_FILTER}`);

const HISTORY_LAYER_SELECTORS = Object.freeze({
  quarter: '[data-testid="quarter-pulse"][data-history-layer="quarter"]',
  chronicle: '.history-workbench-layer[data-history-layer="chronicle"]',
  situation: '.situation-workbench-layer[data-history-layer="situation"]',
  archive: '.history-archive-layer[data-history-layer="entity"]',
  evidence: '.observer-causal-layer[data-history-layer="evidence"]',
});

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

async function state(page) {
  return page.evaluate(() => JSON.parse(window.render_game_to_text()));
}

async function waitForState(page, predicate, argument, timeout = 15_000) {
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
  return state(page);
}

async function activate(locator, scenario) {
  await locator.scrollIntoViewIfNeeded();
  if (scenario.viewport.width <= 840) await locator.tap();
  else await locator.click();
}

async function waitForAnimations(locator) {
  await locator.evaluate(async (element) => {
    await Promise.all(
      element.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined)),
    );
  });
}

async function assertTouchTarget(locator, scenario, detail) {
  if (scenario.viewport.width > 390) return;
  await locator.scrollIntoViewIfNeeded();
  await waitForAnimations(locator);
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
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      unobstructed: Boolean(hit && (hit === element || element.contains(hit))),
    };
  });
  assert.ok(
    metrics.width >= 44 && metrics.height >= 44,
    `${scenario.slug} ${detail} 触控目标至少应为 44px，实际 ${JSON.stringify(metrics)}`,
  );
  assert.ok(
    metrics.left >= -1
      && metrics.right <= metrics.viewportWidth + 1
      && metrics.top >= -1
      && metrics.bottom <= metrics.viewportHeight + 1,
    `${scenario.slug} ${detail} 必须完整落在视口内，实际 ${JSON.stringify(metrics)}`,
  );
  assert.equal(metrics.unobstructed, true, `${scenario.slug} ${detail} 中心点不得被遮挡`);
}

function artifactPath(scenario, name) {
  return `${ARTIFACT_DIR}/${scenario.slug}-${name}.png`;
}

async function assertSingleModalSurface(page, scenario, detail, surfaceSelector) {
  const surface = page.locator(surfaceSelector);
  await surface.waitFor();
  await waitForAnimations(surface);
  await surface.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const layout = await page.evaluate((selector) => {
    const surface = document.querySelector(selector);
    const visibleModals = Array.from(document.querySelectorAll('[aria-modal="true"]'))
      .filter((element) => element instanceof HTMLElement && element.offsetParent !== null);
    const rect = surface?.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      modalCount: visibleModals.length,
      surfaceExists: Boolean(surface),
      surfaceInert: surface instanceof HTMLElement ? Boolean(surface.inert) : null,
      insideInertTree: Boolean(surface?.closest('[inert]')),
      rect: rect ? {
        left: rect.left,
        right: rect.right,
      } : null,
      scrollWidth: surface instanceof HTMLElement ? surface.scrollWidth : null,
      clientWidth: surface instanceof HTMLElement ? surface.clientWidth : null,
    };
  }, surfaceSelector);

  assert.equal(layout.surfaceExists, true, `${scenario.slug} ${detail} 应渲染弹层`);
  assert.equal(layout.modalCount, 1, `${scenario.slug} ${detail} 同时最多一个 aria-modal`);
  assert.equal(layout.surfaceInert, false, `${scenario.slug} ${detail} 自身不得 inert`);
  assert.equal(layout.insideInertTree, false, `${scenario.slug} ${detail} 不得落在 inert 子树中`);
  assert.ok(
    layout.documentWidth <= layout.viewportWidth + 1,
    `${scenario.slug} ${detail} 不得引发页面横向溢出：${layout.documentWidth} > ${layout.viewportWidth}`,
  );
  assert.ok(layout.rect, `${scenario.slug} ${detail} 应可测得视口边界`);
  assert.ok(
    layout.rect.left >= -1 && layout.rect.right <= layout.viewportWidth + 1,
    `${scenario.slug} ${detail} 必须横向完整落在视口内：${JSON.stringify(layout.rect)}`,
  );
  if (layout.clientWidth !== null && layout.scrollWidth !== null) {
    assert.ok(
      layout.scrollWidth <= layout.clientWidth + 1,
      `${scenario.slug} ${detail} 内部不得出现横向滚动：${layout.scrollWidth} > ${layout.clientWidth}`,
    );
  }
}

async function assertSingleModalAndShell(page, scenario, detail, surfaceSelector) {
  await assertSingleModalSurface(page, scenario, detail, surfaceSelector);
  const layout = await page.evaluate(() => {
    const app = document.querySelector('.observer-app');
    return {
      mainInert: Boolean(app?.inert),
      mainAriaHidden: app?.getAttribute('aria-hidden') ?? null,
    };
  });
  assert.equal(layout.mainInert, true, `${scenario.slug} ${detail} 打开时主界面必须 inert`);
  assert.equal(layout.mainAriaHidden, 'true', `${scenario.slug} ${detail} 打开时主界面必须 aria-hidden`);
}

async function assertQuarterLayer(page, scenario, detail = '返回季度层') {
  const current = await waitForState(
    page,
    (snapshot) => snapshot.interface.historyReadingLayer === 'quarter',
  );
  const modalCount = await page.locator('[aria-modal="true"]').count();
  assert.equal(modalCount, 0, `${scenario.slug} ${detail} 后不应残留 aria-modal`);
  assert.equal(current.interface.primerOpen, false, `${scenario.slug} ${detail} 后不应残留 primer`);
  return current;
}

async function ensureTurnStable(page, scenario, detail, expectedTurn, delayMs = 2_200) {
  await page.waitForTimeout(delayMs);
  const current = await state(page);
  assert.equal(current.time.turn, expectedTurn, `${scenario.slug} ${detail} 后回合不得继续变化`);
  assert.equal(current.playback.running, false, `${scenario.slug} ${detail} 后自动推演必须保持暂停`);
  return current;
}

async function startAutoplay(page, scenario, detail) {
  const toggle = page.locator('.observer-time-controls__toggle');
  await activate(toggle, scenario);
  const running = await waitForState(
    page,
    (snapshot) => snapshot.playback.running,
    undefined,
    4_000,
  );
  assert.equal(running.playback.running, true, `${scenario.slug} ${detail} 前应已进入自动推演`);
  return running;
}

async function createWorld(page, scenario) {
  await page.addInitScript(() => {
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
  const startState = await waitForState(page, (snapshot) => snapshot.mode === 'start' && snapshot.seedInputVisible === true);
  assert.equal(startState.collectionOpen, false, `${scenario.slug} 初始应停留在世界书页`);

  const collectionTrigger = page.locator('#open-world-collection');
  await collectionTrigger.waitFor();
  await activate(collectionTrigger, scenario);
  const collectionState = await waitForState(
    page,
    (snapshot) => snapshot.mode === 'start' && snapshot.collectionOpen === true && snapshot.seedInputVisible === false,
  );
  assert.equal(collectionState.collectionOpen, true, `${scenario.slug} 开场世界收藏必须在 start 快照中可见`);
  assert.equal(await page.locator('.world-start').count(), 0, `${scenario.slug} 打开世界收藏时 WorldStart 不得继续可见`);
  await assertSingleModalSurface(page, scenario, '开场世界收藏', '.world-collection');
  await page.screenshot({ path: artifactPath(scenario, 'start-collection'), fullPage: false });
  const collectionClose = page.locator('.world-collection__header > button').last();
  await assertTouchTarget(collectionClose, scenario, '世界收藏关闭入口');
  await activate(collectionClose, scenario);
  await waitForState(page, (snapshot) => snapshot.mode === 'start' && snapshot.collectionOpen === false && snapshot.seedInputVisible === true);
  await page.waitForFunction(() => document.activeElement?.id === 'open-world-collection');
  assert.equal(
    await page.evaluate(() => document.activeElement?.id),
    'open-world-collection',
    `${scenario.slug} 关闭开场收藏后应回到原入口`,
  );

  await page.getByLabel('世界种子').fill(scenario.seed);
  await activate(page.locator('#start-world'), scenario);
  const created = await waitForState(page, (snapshot) => snapshot.mode === 'observing');
  assert.equal(created.time.turn, 0, `${scenario.slug} 新世界应从 T0 开始`);
  assert.equal(created.observer.primerOpen, true, `${scenario.slug} 新世界应先打开 primer`);
  return created;
}

async function completePrimer(page, scenario) {
  const initial = await createWorld(page, scenario);
  const primer = page.locator('.map-primer');
  await primer.waitFor();
  await assertSingleModalAndShell(page, scenario, '地图导览', '.map-primer');
  await page.screenshot({ path: artifactPath(scenario, 'primer'), fullPage: false });

  const skip = primer.locator('[data-map-primer-skip]');
  const back = primer.locator('.map-primer__back');
  const primary = primer.locator('[data-map-primer-action]');
  await assertTouchTarget(skip, scenario, 'primer 跳过入口');
  await assertTouchTarget(back, scenario, 'primer 上一步入口');
  await assertTouchTarget(primary, scenario, 'primer 主按钮');

  await activate(primary, scenario);
  let current = await waitForState(
    page,
    (snapshot) => snapshot.observer.primerOpen && snapshot.observer.primerStep === 'situation',
  );
  assert.equal(current.time.turn, initial.time.turn, `${scenario.slug} primer 第一步不得推进季度`);
  await assertSingleModalAndShell(page, scenario, '地图导览第二步', '.map-primer');

  await activate(primary, scenario);
  current = await waitForState(
    page,
    (snapshot) => snapshot.observer.primerOpen && snapshot.observer.primerStep === 'history',
  );
  assert.equal(current.time.turn, initial.time.turn, `${scenario.slug} primer 第二步不得推进季度`);
  await assertSingleModalAndShell(page, scenario, '地图导览第三步', '.map-primer');

  await activate(primary, scenario);
  current = await waitForState(
    page,
    (snapshot, startTurn) => snapshot.observer.primerOpen && snapshot.time.turn === startTurn + 1,
    initial.time.turn,
  );
  assert.equal(current.time.turn, initial.time.turn + 1, `${scenario.slug} primer 完成前只能推进一季`);
  assert.equal(current.playback.running, false, `${scenario.slug} primer 推进后不应启动自动推演`);
  await ensureTurnStable(page, scenario, 'primer 推进一季', current.time.turn);

  await activate(primary, scenario);
  const evidence = await waitForState(
    page,
    (snapshot, expectedTurn) => (
      snapshot.interface.historyReadingLayer === 'evidence'
      && snapshot.time.turn === expectedTurn
      && snapshot.interface.primerOpen === false
      && Boolean(snapshot.interface.selectedEventId)
    ),
    current.time.turn,
  );
  await assertSingleModalAndShell(page, scenario, 'primer 完成后的何故层', '#observer-causal-drawer');
  await page.screenshot({ path: artifactPath(scenario, 'primer-why'), fullPage: false });
  const drawerClose = page.locator('#observer-causal-drawer .observer-causal-drawer__header button');
  await assertTouchTarget(drawerClose, scenario, 'primer 因果关闭入口');
  await page.keyboard.press('Escape');
  const quarter = await assertQuarterLayer(page, scenario, '关闭 primer 因果层');
  await page.waitForFunction(() => document.activeElement?.matches('.world-map__canvas') ?? false);
  assert.equal(quarter.time.turn, initial.time.turn + 1, `${scenario.slug} primer 完成后总计只能推进一季`);
  assert.equal(evidence.time.turn, initial.time.turn + 1, `${scenario.slug} primer 打开因果层时不得额外推进`);
  return quarter;
}

async function openChronicleEventAndEscape(page, scenario) {
  await startAutoplay(page, scenario, '打开天下史册');
  const trigger = page.locator('[data-history-workbench-trigger="true"]');
  await activate(trigger, scenario);
  const chronicle = await waitForState(
    page,
    (snapshot) => snapshot.interface.historyReadingLayer === 'chronicle' && snapshot.interface.view === 'chronicle',
  );
  assert.equal(chronicle.playback.running, false, `${scenario.slug} 打开天下史册必须暂停自动推演`);
  await assertSingleModalAndShell(page, scenario, '天下史册', '.history-workbench');
  await page.screenshot({ path: artifactPath(scenario, 'chronicle'), fullPage: false });

  const eventEntry = page.locator('.history-workbench__event-list > li > button').first();
  assert.ok(await eventEntry.count(), `${scenario.slug} 天下史册必须有可追溯史事`);
  await assertTouchTarget(eventEntry, scenario, '天下史册史事入口');
  const eventId = await eventEntry.getAttribute('data-event-id');
  assert.ok(eventId, `${scenario.slug} 天下史册史事必须携带 event id`);
  await activate(eventEntry, scenario);
  const evidence = await waitForState(
    page,
    (snapshot, expectedId) => (
      snapshot.interface.historyReadingLayer === 'evidence'
      && snapshot.interface.selectedEventId === expectedId
      && snapshot.interface.view === 'chronicle'
    ),
    eventId,
  );
  assert.equal(evidence.playback.running, false, `${scenario.slug} 打开何故层必须保持暂停`);
  await assertSingleModalAndShell(page, scenario, '天下史册的何故层', '#observer-causal-drawer');
  await page.screenshot({ path: artifactPath(scenario, 'chronicle-why'), fullPage: false });
  await assertTouchTarget(page.locator('#observer-causal-drawer .observer-causal-drawer__header button'), scenario, '史册因果关闭入口');
  await page.keyboard.press('Escape');
  const resumed = await waitForState(
    page,
    (snapshot) => snapshot.interface.historyReadingLayer === 'chronicle' && snapshot.interface.view === 'chronicle',
  );
  assert.equal(resumed.playback.running, false, `${scenario.slug} 从史册因果返回后必须保持暂停`);
  await ensureTurnStable(page, scenario, '天下史册打开', chronicle.time.turn);

  await activate(page.locator('.history-workbench__close'), scenario);
  return assertQuarterLayer(page, scenario, '关闭天下史册');
}

async function openArchiveEventAndEscape(page, scenario) {
  await activate(page.locator('[data-observer-view="people"]'), scenario);
  const roster = page.locator('.roster-panel[data-roster-scope="people"]');
  await roster.waitFor();
  const row = roster.locator('[data-roster-id]').first();
  assert.ok(await row.count(), `${scenario.slug} 人物名录必须存在条目`);
  const personId = await row.getAttribute('data-roster-id');
  assert.ok(personId, `${scenario.slug} 人物条目必须携带 id`);
  await activate(row, scenario);

  const inspector = page.locator('.observer-inspector[data-kind="person"]');
  await inspector.waitFor();
  await activate(inspector.locator('[data-inspector-tab="history"]'), scenario);
  const gateway = inspector.locator('[data-entity-history-gateway="person"]');
  await assertTouchTarget(gateway, scenario, '完整人物传入口');

  await startAutoplay(page, scenario, '打开人物传');
  await activate(gateway, scenario);
  const archive = await waitForState(
    page,
    (snapshot, expectedId) => (
      snapshot.interface.historyReadingLayer === 'entity'
      && snapshot.interface.selected?.kind === 'person'
      && snapshot.interface.selected?.id === expectedId
    ),
    personId,
  );
  assert.equal(archive.playback.running, false, `${scenario.slug} 打开人物传必须暂停自动推演`);
  await assertSingleModalAndShell(page, scenario, '完整人物传', '.history-archive');
  await page.screenshot({ path: artifactPath(scenario, 'archive'), fullPage: false });

  const eventEntry = page.locator('.history-archive__chronology li button').first();
  assert.ok(await eventEntry.count(), `${scenario.slug} 完整人物传必须存在可追溯史事`);
  await assertTouchTarget(eventEntry, scenario, '人物传史事入口');
  const eventId = await eventEntry.getAttribute('data-event-id');
  assert.ok(eventId, `${scenario.slug} 人物传史事必须携带 event id`);
  await activate(eventEntry, scenario);
  await waitForState(
    page,
    (snapshot, expectedId) => (
      snapshot.interface.historyReadingLayer === 'evidence'
      && snapshot.interface.selectedEventId === expectedId
      && snapshot.interface.selected?.kind === 'person'
    ),
    eventId,
  );
  await assertSingleModalAndShell(page, scenario, '人物传的何故层', '#observer-causal-drawer');
  await page.screenshot({ path: artifactPath(scenario, 'archive-why'), fullPage: false });
  await assertTouchTarget(page.locator('#observer-causal-drawer .observer-causal-drawer__header button'), scenario, '人物传因果关闭入口');
  await page.keyboard.press('Escape');
  const resumed = await waitForState(
    page,
    (snapshot, expectedId) => (
      snapshot.interface.historyReadingLayer === 'entity'
      && snapshot.interface.selected?.kind === 'person'
      && snapshot.interface.selected?.id === expectedId
    ),
    personId,
  );
  assert.equal(resumed.playback.running, false, `${scenario.slug} 从人物传因果返回后必须保持暂停`);
  await ensureTurnStable(page, scenario, '人物传打开', archive.time.turn);

  const archiveClose = page.locator('.history-archive__masthead > button');
  await assertTouchTarget(archiveClose, scenario, '人物传关闭入口');
  await activate(archiveClose, scenario);
  await inspector.waitFor();

  const returnToRoster = inspector.locator('[data-inspector-return="roster"]');
  if (await returnToRoster.count()) {
    await activate(returnToRoster, scenario);
    await inspector.waitFor({ state: 'detached' });
  } else {
    await activate(inspector.locator('button[aria-label="关闭档案"]').first(), scenario);
    await inspector.waitFor({ state: 'detached' });
  }

  if (await roster.count()) {
    await activate(roster.locator('.roster-panel__header > button'), scenario);
    await roster.waitFor({ state: 'detached' });
  }

  return assertQuarterLayer(page, scenario, '关闭人物传后');
}

async function ensureSituationTrigger(page, scenario, maxTurn = 8) {
  for (let index = 0; index < maxTurn; index += 1) {
    const trigger = page.locator('[data-situation-workbench-trigger="true"]').first();
    if (await trigger.count()) return trigger;
    const before = await state(page);
    await activate(page.getByRole('button', { name: '推进至下一季', exact: true }), scenario);
    await waitForState(page, (snapshot, turn) => snapshot.time.turn === turn + 1, before.time.turn);
  }
  assert.fail(`${scenario.slug} ${maxTurn} 季内未出现可读的持续局势入口`);
}

async function findSituationCausalEntry(page, scenario) {
  const timelineEntry = page.locator('.situation-workbench__timeline button[data-event-id]').first();
  if (await timelineEntry.count()) return timelineEntry;
  const disclosure = page.locator('.situation-workbench__evidence > summary');
  if (await disclosure.count()) {
    await activate(disclosure, scenario);
    const evidenceEntry = page.locator('.situation-workbench__evidence button[data-event-id]').first();
    if (await evidenceEntry.count()) return evidenceEntry;
  }
  return null;
}

async function openSituationEvidence(page, scenario, entry, eventId) {
  try {
    await activate(entry, scenario);
    return await waitForState(
      page,
      (snapshot, expectedId) => (
        snapshot.interface?.historyReadingLayer === 'evidence'
        && snapshot.interface?.selectedEventId === expectedId
      ),
      eventId,
      2_500,
    );
  } catch {
    const fallbackEntry = await findSituationCausalEntry(page, scenario);
    assert.ok(fallbackEntry, `${scenario.slug} 局势卷 fallback 时仍应存在因果入口`);
    await fallbackEntry.evaluate((element) => element.click());
    return waitForState(
      page,
      (snapshot, expectedId) => (
        snapshot.interface?.historyReadingLayer === 'evidence'
        && snapshot.interface?.selectedEventId === expectedId
      ),
      eventId,
      5_000,
    );
  }
}

async function openSituationWorkbench(page, scenario) {
  const trigger = page.locator('[data-situation-workbench-trigger="true"]').first();
  await trigger.waitFor();
  await waitForAnimations(trigger);
  try {
    await activate(trigger, scenario);
    return await waitForState(
      page,
      (snapshot) => (
        snapshot.interface.historyReadingLayer === 'situation'
        && Boolean(snapshot.observer.selectedSituationId)
      ),
      undefined,
      2_500,
    );
  } catch {
    await trigger.evaluate((element) => element.click());
    return waitForState(
      page,
      (snapshot) => (
        snapshot.interface.historyReadingLayer === 'situation'
        && Boolean(snapshot.observer.selectedSituationId)
      ),
      undefined,
      5_000,
    );
  }
}

async function openSituationEventAndEscape(page, scenario) {
  await ensureSituationTrigger(page, scenario);
  const trigger = page.locator('[data-situation-workbench-trigger="true"]').first();
  await assertTouchTarget(trigger, scenario, '持续局势入口');
  await startAutoplay(page, scenario, '打开持续局势');
  const situation = await openSituationWorkbench(page, scenario);
  const situationId = situation.observer.selectedSituationId;
  assert.ok(situationId, `${scenario.slug} 打开持续局势后必须公开所选局势`);
  assert.equal(situation.playback.running, false, `${scenario.slug} 打开持续局势必须暂停自动推演`);
  await assertSingleModalAndShell(page, scenario, '持续局势', '.situation-workbench');
  await page.screenshot({ path: artifactPath(scenario, 'situation'), fullPage: false });

  const close = page.locator('.situation-workbench__close');
  await assertTouchTarget(close, scenario, '持续局势关闭入口');
  const causalEntry = await findSituationCausalEntry(page, scenario);
  assert.ok(causalEntry, `${scenario.slug} 持续局势必须提供至少一个通往因果层的入口`);
  await assertTouchTarget(causalEntry, scenario, '持续局势因果入口');
  const eventId = await causalEntry.getAttribute('data-event-id');
  assert.ok(eventId, `${scenario.slug} 局势因果入口必须携带 event id`);
  await openSituationEvidence(page, scenario, causalEntry, eventId);
  await assertSingleModalAndShell(page, scenario, '持续局势的何故层', '#observer-causal-drawer');
  await page.screenshot({ path: artifactPath(scenario, 'situation-why'), fullPage: false });
  await assertTouchTarget(page.locator('#observer-causal-drawer .observer-causal-drawer__header button'), scenario, '局势因果关闭入口');
  await page.keyboard.press('Escape');
  const resumed = await waitForState(
    page,
    (snapshot, expectedId) => (
      snapshot.interface.historyReadingLayer === 'situation'
      && snapshot.observer.selectedSituationId === expectedId
    ),
    situationId,
  );
  assert.equal(resumed.playback.running, false, `${scenario.slug} 从局势因果返回后必须保持暂停`);
  await ensureTurnStable(page, scenario, '持续局势打开', situation.time.turn);

  await activate(close, scenario);
  return assertQuarterLayer(page, scenario, '关闭持续局势');
}

async function verifyWorldStartReturnJourney(page, scenario) {
  const worldMenuTrigger = page.getByRole('button', { name: '返回世界书页' });
  const moreTrigger = page.locator('.observer-world-tools__more');
  if (!(await worldMenuTrigger.isVisible().catch(() => false))) {
    await activate(moreTrigger, scenario);
    await worldMenuTrigger.waitFor({ state: 'visible' });
  }
  const returnLabel = await moreTrigger.getAttribute('aria-expanded') === 'true'
    ? '打开更多工具'
    : '返回世界书页';
  await activate(worldMenuTrigger, scenario);
  await waitForState(page, (snapshot) => snapshot.mode === 'world-menu');

  await activate(page.locator('#open-world-collection'), scenario);
  await waitForState(page, (snapshot) => snapshot.observer.collectionOpen === true);
  await activate(page.locator('.world-collection__header > button').last(), scenario);
  await waitForState(
    page,
    (snapshot) => snapshot.mode === 'world-menu' && snapshot.observer.collectionOpen === false,
  );
  await page.waitForFunction(() => document.activeElement?.id === 'open-world-collection');

  await activate(page.locator('.world-start__close'), scenario);
  await assertQuarterLayer(page, scenario, '关闭世界书页');
  await page.waitForFunction(
    (expected) => document.activeElement?.getAttribute('aria-label') === expected,
    returnLabel,
  );
}

async function verifyScenario(browser, scenario) {
  const context = await browser.newContext({
    viewport: scenario.viewport,
    hasTouch: scenario.viewport.width <= 840,
    isMobile: scenario.viewport.width <= 760,
  });
  const page = await context.newPage();
  const browserErrors = [];
  collectBrowserErrors(page, browserErrors);

  try {
    await completePrimer(page, scenario);
    await verifyWorldStartReturnJourney(page, scenario);
    await openChronicleEventAndEscape(page, scenario);
    await openArchiveEventAndEscape(page, scenario);
    await openSituationEventAndEscape(page, scenario);

    const finalState = await assertQuarterLayer(page, scenario, '场景结束');
    assert.equal(finalState.playback.running, false, `${scenario.slug} 场景结束时自动推演应为暂停`);
    await page.screenshot({ path: artifactPath(scenario, 'final-quarter'), fullPage: false });
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
  for (const scenario of SCENARIOS) {
    await verifyScenario(browser, scenario);
  }
  process.stdout.write(`TRIM01.6 shell E2E passed: ${SCENARIOS.length} scenarios.\n`);
} finally {
  await browser?.close();
  await server?.close();
}
