import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const PORT = Number(process.env.SELF_EVOLUTION_E2E_PORT ?? 4199);
const APP_URL = process.env.SELF_EVOLUTION_E2E_URL ?? `http://127.0.0.1:${PORT}`;
const VERSION = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
const ARTIFACT_DIR = `output/self-evolution-v${VERSION}`;
const EXPECTED_T12_HASH = '8ac8f4521fe2e255';
const SCENARIOS = [
  { slug: 'desktop-1440x900', viewport: { width: 1440, height: 900 }, mobile: false },
  { slug: 'mobile-390x844', viewport: { width: 390, height: 844 }, mobile: true },
];

const server = process.env.SELF_EVOLUTION_E2E_URL ? null : await createServer({
  logLevel: 'error',
  server: { host: '127.0.0.1', port: PORT, strictPort: true },
});

function readState(page) {
  return page.evaluate(() => JSON.parse(window.render_game_to_text()));
}

async function setEightTimes(page, mobile) {
  if (!mobile) {
    await page.getByRole('button', { name: '8 倍速推演' }).click();
    return;
  }
  while ((await readState(page)).playback.speed !== 8) {
    await page.locator('.observer-speed-cycle').click();
  }
}

async function advanceWhileRunning(page, targetTurn) {
  let current = await readState(page);
  let unexpectedStops = 0;
  for (let guard = 0; current.time.turn < targetTurn && guard < 40; guard += 1) {
    await page.evaluate(() => window.advanceTime(240));
    await page.waitForTimeout(30);
    current = await readState(page);
    if (!current.playback.running && current.time.turn < targetTurn) unexpectedStops += 1;
  }
  return { current, unexpectedStops };
}

async function openAndCloseCurrentStory(page, mobile, artifactPrefix) {
  const mapContext = await readState(page);
  if (mobile) {
    const toggle = page.getByTestId('observer-leads-mobile-toggle');
    if (await toggle.isVisible()) await toggle.click();
    const pulseHeight = await page.getByTestId('quarter-pulse').evaluate((element) => element.getBoundingClientRect().height);
    assert.ok(pulseHeight <= 52, `${artifactPrefix} 展开眼下大事时季报必须保持紧凑`);
    assert.equal(await page.locator('.war-focus-summary:visible, .observer-inspector:visible').count(), 0, `${artifactPrefix} 眼下大事不得叠加其他阅读面`);
  }
  await page.screenshot({ path: `${ARTIFACT_DIR}/${artifactPrefix}-leads.png`, fullPage: false });
  await page.locator('[data-testid="observer-lead"] .observer-leads__inspect').first().click();
  const reading = await readState(page);
  assert.equal(reading.playback.running, false, `${artifactPrefix} 主动阅读必须先暂停`);
  await page.screenshot({ path: `${ARTIFACT_DIR}/${artifactPrefix}-reading.png`, fullPage: false });

  const situationClose = page.locator('.situation-workbench__close');
  const inspectorClose = page.locator('[data-inspector-close]');
  await Promise.race([
    situationClose.waitFor({ state: 'visible' }),
    inspectorClose.waitFor({ state: 'visible' }),
  ]);
  if (await situationClose.isVisible().catch(() => false)) {
    await situationClose.click();
  } else {
    await inspectorClose.click();
  }
  const returned = await readState(page);
  assert.equal(returned.playback.running, false, `${artifactPrefix} 关闭详情后不得偷偷恢复`);
  assert.equal(returned.interface.overlay, mapContext.interface.overlay, `${artifactPrefix} 应回到原舆图叠层`);
  assert.deepEqual(returned.interface.mapViewport, mapContext.interface.mapViewport, `${artifactPrefix} 应回到原观察位置`);
  await page.getByRole('button', { name: '继续演变' }).waitFor();
  await page.screenshot({ path: `${ARTIFACT_DIR}/${artifactPrefix}-returned.png`, fullPage: false });
}

let browser;
try {
  await mkdir(ARTIFACT_DIR, { recursive: true });
  if (server) await server.listen();
  browser = await chromium.launch({ headless: true });

  for (const scenario of SCENARIOS) {
    const context = await browser.newContext({
      viewport: scenario.viewport,
      isMobile: scenario.mobile,
      hasTouch: scenario.mobile,
      deviceScaleFactor: scenario.mobile ? 3 : 1,
    });
    const page = await context.newPage();
    const errors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    page.on('pageerror', (error) => errors.push(`page: ${error.message}`));

    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    await page.getByLabel('世界种子').fill('春战副将');
    await page.locator('#start-world').click();
    await page.locator('.world-map__canvas').waitFor();
    const initial = await readState(page);
    assert.equal(initial.time.turn, 0);
    assert.equal(initial.observer.primerOpen, false, `${scenario.slug} 不应强制打开读图`);
    assert.equal(initial.interface.selected, null, `${scenario.slug} 首屏不应抢开档案`);
    assert.equal(await page.locator('.observer-leads').count(), 0, `${scenario.slug} T0 不应保留空线索栏`);
    assert.equal(await page.getByTestId('quarter-pulse-waiting').textContent(), '开始演变，看看第一季发生什么。');
    await page.getByRole('button', { name: '开始演变' }).waitFor();
    await page.screenshot({ path: `${ARTIFACT_DIR}/${scenario.slug}-initial.png`, fullPage: false });

    await setEightTimes(page, scenario.mobile);
    await page.getByRole('button', { name: '开始演变' }).click();
    const firstRun = await advanceWhileRunning(page, 6);
    assert.equal(firstRun.unexpectedStops, 0, `${scenario.slug} T0→T6 不得自动停表`);
    assert.equal(firstRun.current.playback.running, true);
    assert.equal(await page.getByTestId('quarter-pulse').getAttribute('data-presentation'), 'condensed', `${scenario.slug} 演变中季报应进入观看态`);
    const beforeActiveWorldClick = await readState(page);
    await page.locator('[data-observer-view="world"]').click();
    const afterActiveWorldClick = await readState(page);
    assert.equal(afterActiveWorldClick.playback.running, true, `${scenario.slug} 重复点击当前世界页不得暂停`);
    assert.equal(afterActiveWorldClick.interface.view, 'world');
    assert.deepEqual(afterActiveWorldClick.interface.mapViewport, beforeActiveWorldClick.interface.mapViewport);
    assert.equal(afterActiveWorldClick.interface.selected, beforeActiveWorldClick.interface.selected);
    await page.screenshot({ path: `${ARTIFACT_DIR}/${scenario.slug}-running-t6.png`, fullPage: false });

    await openAndCloseCurrentStory(page, scenario.mobile, scenario.slug);
    assert.equal(await page.getByTestId('quarter-pulse').getAttribute('data-presentation'), 'full', `${scenario.slug} 暂停阅读后季报应恢复完整`);
    await page.getByRole('button', { name: '继续演变' }).click();
    const secondRun = await advanceWhileRunning(page, 12);
    assert.equal(secondRun.unexpectedStops, 0, `${scenario.slug} T6→T12 不得自动停表`);
    assert.equal(secondRun.current.time.turn, 12);
    assert.equal(secondRun.current.deterministicWorldHash, EXPECTED_T12_HASH);
    assert.equal(secondRun.current.observer.primerOpen, false);
    assert.equal(secondRun.current.interface.selectedEventId, null, `${scenario.slug} 自动演变不得抢开史事`);
    assert.ok(secondRun.current.mapObjects.wars.length > 0, `${scenario.slug} T12 应已有真实战争`);
    assert.ok(secondRun.current.interface.quarterPulse.storyCount > 0, `${scenario.slug} 应保留本季变化`);
    assert.ok(secondRun.current.recentHistory.length > 1, `${scenario.slug} 应保留史册记录`);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      true,
      `${scenario.slug} 不得横向溢出`,
    );
    assert.deepEqual(errors, [], `${scenario.slug} 不得产生 console/page error`);
    await page.getByRole('button', { name: '暂停演变' }).click();
    await page.screenshot({ path: `${ARTIFACT_DIR}/${scenario.slug}-t12.png`, fullPage: false });

    process.stdout.write(`${scenario.slug}: T0→T12 自动停表 0 次，hash ${secondRun.current.deterministicWorldHash}\n`);
    await context.close();
  }

  const watchedContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const watchedPage = await watchedContext.newPage();
  await watchedPage.goto(APP_URL, { waitUntil: 'networkidle' });
  await watchedPage.getByLabel('世界种子').fill('春战副将');
  await watchedPage.locator('#start-world').click();
  await watchedPage.locator('.world-map__canvas').waitFor();
  for (let turn = 1; turn <= 4; turn += 1) {
    await watchedPage.getByRole('button', { name: '推进至下一季' }).click();
    await watchedPage.waitForFunction((expected) => JSON.parse(window.render_game_to_text()).time.turn === expected, turn);
  }
  const watch = watchedPage.locator('[data-testid="observer-lead"][data-situation-id] [data-testid="observer-lead-watch"]').first();
  await watch.click();
  await watchedPage.waitForFunction(() => JSON.parse(window.render_game_to_text()).observer.watchedCount === 1);
  await setEightTimes(watchedPage, false);
  await watchedPage.getByRole('button', { name: '继续演变' }).click();
  let watchedState = await readState(watchedPage);
  for (let guard = 0; watchedState.playback.running && guard < 20; guard += 1) {
    await watchedPage.evaluate(() => window.advanceTime(240));
    await watchedPage.waitForTimeout(30);
    watchedState = await readState(watchedPage);
  }
  assert.equal(watchedState.playback.running, false, '明确关注的局势发生关键变化时必须停表');
  assert.equal(watchedState.observer.lastPauseRule, 'situationChanges');
  assert.ok(watchedState.time.turn > 4, '关注停表必须由后续变化触发');
  assert.doesNotMatch(watchedState.observer.lastPauseReason ?? '', /重要度|阈值|规则命中/);
  await watchedPage.screenshot({ path: `${ARTIFACT_DIR}/watched-situation-paused.png`, fullPage: false });
  process.stdout.write(`watched-situation: T${watchedState.time.turn} 因明确关注的局势变化停表\n`);
  await watchedContext.close();
} finally {
  await browser?.close();
  await server?.close();
}
