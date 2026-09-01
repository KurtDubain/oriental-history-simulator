import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const PORT = Number(process.env.TRIM018_E2E_PORT ?? 4197);
const externalUrl = process.env.TRIM018_E2E_URL;
const APP_URL = externalUrl ?? `http://127.0.0.1:${PORT}`;
const PACKAGE_VERSION = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
).version;
const ARTIFACT_DIR = `output/trim018-acceptance-e2e-v${PACKAGE_VERSION}`;
const SCENARIO_FILTER = process.env.TRIM018_E2E_SCENARIO;
const MOBILE_MAX_WIDTH = 840;

const SCENARIOS = Object.freeze([
  { slug: 'desktop-1440x900', viewport: { width: 1440, height: 900 } },
  { slug: 'mobile-wide-640x900', viewport: { width: 640, height: 900 } },
  { slug: 'mobile-390x844', viewport: { width: 390, height: 844 } },
].filter((scenario) => !SCENARIO_FILTER || scenario.slug === SCENARIO_FILTER));

assert.ok(SCENARIOS.length > 0, `未知 TRIM018 E2E 场景：${SCENARIO_FILTER}`);

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

async function waitForAnimations(locator) {
  await locator.evaluate(async (element) => {
    await Promise.all(
      element.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined)),
    );
  });
}

async function activate(locator, scenario) {
  await locator.scrollIntoViewIfNeeded();
  if (scenario.viewport.width <= MOBILE_MAX_WIDTH) await locator.tap();
  else await locator.click();
}

async function assertTouchTarget(locator, scenario, detail) {
  if (scenario.viewport.width > MOBILE_MAX_WIDTH) return;
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
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      hittable: Boolean(hit && (hit === element || element.contains(hit))),
    };
  });
  assert.ok(
    metrics.width >= 44 && metrics.height >= 44,
    `${scenario.slug} ${detail}触控区至少应为 44px，实际 ${JSON.stringify(metrics)}`,
  );
  assert.ok(
    metrics.left >= -1
      && metrics.right <= metrics.viewportWidth + 1
      && metrics.top >= -1
      && metrics.bottom <= metrics.viewportHeight + 1,
    `${scenario.slug} ${detail}必须完整落在视口内，实际 ${JSON.stringify(metrics)}`,
  );
  assert.equal(metrics.hittable, true, `${scenario.slug} ${detail}中心点不得被遮挡`);
}

function assertObserverReadOnly(current, baseline, detail) {
  assert.equal(current.time.turn, baseline.time.turn, `${detail}不得推进季度`);
  assert.equal(
    current.deterministicWorldHash,
    baseline.deterministicWorldHash,
    `${detail}不得改写权威世界`,
  );
}

async function assertNoHorizontalOverflow(page, scenario, detail) {
  const layout = await page.evaluate(() => {
    const inspector = document.querySelector('.observer-inspector')?.getBoundingClientRect();
    return {
      viewportWidth: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      inspector: inspector ? { left: inspector.left, right: inspector.right } : null,
    };
  });
  assert.ok(
    layout.documentWidth <= layout.viewportWidth + 1,
    `${scenario.slug} ${detail}不得横向溢出：${JSON.stringify(layout)}`,
  );
  if (layout.inspector) {
    assert.ok(
      layout.inspector.left >= -1 && layout.inspector.right <= layout.viewportWidth + 1,
      `${scenario.slug} ${detail}人物档案必须落在视口内：${JSON.stringify(layout.inspector)}`,
    );
  }
}

async function createWorld(page, scenario) {
  await page.addInitScript(() => {
    localStorage.setItem('canghai-map-primer-complete-v1', '1');
    localStorage.setItem('canghai-observer-interface-settings-v1', JSON.stringify({
      version: 2,
      sound: {
        enabled: false,
        promptDismissed: false,
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
  await page.getByLabel('世界种子').fill('春战副将');
  await page.locator('#start-world').click();
  await page.waitForSelector('.world-map__canvas');
  const initial = await state(page);
  assert.equal(initial.time.turn, 0, `${scenario.slug} 验收世界必须从第 0 季开始`);
  assert.equal(initial.interface.quarterPulse.turn, null, `${scenario.slug} 推进前不应伪造季报`);
  return initial;
}

async function advanceAndReadPrimaryStory(page, scenario, initial) {
  const advance = page.getByRole('button', { name: '推进至下一季', exact: true });
  await assertTouchTarget(advance, scenario, '推进一季入口');
  await activate(advance, scenario);
  const advanced = await waitForState(
    page,
    (current, turn) => current.time.turn === turn && current.interface?.quarterPulse?.turn === turn - 1,
    initial.time.turn + 1,
  );
  assert.notEqual(advanced.deterministicWorldHash, initial.deterministicWorldHash, `${scenario.slug} 推进必须产生新历史`);
  const pulse = advanced.interface.quarterPulse;
  assert.ok(pulse.storyCount > 0, `${scenario.slug} 第一季必须给出可读的重要变化`);
  assert.ok(
    pulse.stories[0].importance >= Math.max(...pulse.stories.map((story) => story.importance)),
    `${scenario.slug} 季报首条必须是本季最重要变化`,
  );
  assert.ok(pulse.stories[0].title.length >= 4, `${scenario.slug} 首条变化必须说明具体发生了什么`);
  assert.ok(pulse.stories[0].summary.length >= 12, `${scenario.slug} 首条变化必须给出具体结果摘要`);

  const invitation = page.getByTestId('audio-invitation');
  await invitation.waitFor();
  const enableSound = invitation.getByRole('button', { name: '开启声音', exact: true });
  const dismissSound = invitation.getByRole('button', { name: '暂不开启声音' });
  await assertTouchTarget(enableSound, scenario, '声音邀请开启入口');
  await assertTouchTarget(dismissSound, scenario, '声音邀请暂缓入口');
  await activate(dismissSound, scenario);
  await invitation.waitFor({ state: 'detached' });

  const primary = page.locator(
    `[data-testid="quarter-pulse"] li[data-story-id="${pulse.stories[0].id}"]`,
  );
  await primary.waitFor();
  assert.equal(
    (await primary.locator('strong').first().textContent())?.trim(),
    pulse.stories[0].title,
    `${scenario.slug} 屏幕首条变化必须与文本快照一致`,
  );
  const storyButton = primary.locator('button');
  assert.equal(await storyButton.count(), 1, `${scenario.slug} 最重要变化必须可以继续查阅`);
  await assertTouchTarget(storyButton, scenario, '最重要变化入口');
  await activate(storyButton, scenario);
  return { advanced, story: pulse.stories[0] };
}

async function openCausalLayer(page, scenario, baseline, story) {
  if (story.destination.kind === 'situation') {
    const workbench = page.locator('.situation-workbench-layer[data-history-layer="situation"]');
    await workbench.waitFor();
    let eventEntry = workbench.locator('.situation-workbench__timeline button[data-event-id]').first();
    if (!(await eventEntry.count())) {
      const disclosure = workbench.locator('.situation-workbench__evidence > summary');
      assert.equal(await disclosure.count(), 1, `${scenario.slug} 持续局势必须给出可查凭证`);
      await assertTouchTarget(disclosure, scenario, '局势凭证入口');
      await activate(disclosure, scenario);
      eventEntry = workbench.locator('.situation-workbench__evidence button[data-event-id]').first();
    }
    assert.equal(await eventEntry.count(), 1, `${scenario.slug} 持续局势必须至少有一件可追溯史事`);
    await assertTouchTarget(eventEntry, scenario, '局势史事入口');
    await activate(eventEntry, scenario);
  } else {
    assert.equal(story.destination.kind, 'event', `${scenario.slug} 首要变化不得只停留在无去向官档`);
  }

  const drawer = page.locator('#observer-causal-drawer');
  await drawer.waitFor();
  await waitForAnimations(drawer);
  const causal = await state(page);
  assertObserverReadOnly(causal, baseline, `${scenario.slug} 查阅何故`);
  assert.equal(causal.interface.historyReadingLayer, 'evidence', `${scenario.slug} 查因时必须进入证据层`);
  assert.ok(causal.interface.selectedEvent?.title, `${scenario.slug} 何故层必须保留具体史事`);
  assert.ok(causal.interface.selectedEvent.causes.length > 0, `${scenario.slug} 具体史事必须说明至少一项成因`);
  assert.ok(
    causal.interface.selectedEvent.causes.every((cause) => cause.label && cause.evidence),
    `${scenario.slug} 每项成因都必须给出名称与可核验凭证`,
  );
  assert.equal(
    await drawer.locator('.observer-causal-chain__factor').count(),
    causal.interface.selectedEvent.causes.length + 1,
    `${scenario.slug} 屏幕因果链必须完整包含原因与结果`,
  );
  assert.match(await drawer.textContent(), /此事为何发生？/, `${scenario.slug} 何故层必须明确回答阅读问题`);
  await page.screenshot({ path: `${ARTIFACT_DIR}/${scenario.slug}-why.png`, fullPage: false });
  return causal;
}

async function openRelatedPerson(page, scenario, baseline) {
  const subject = page.locator('.observer-causal-subjects button').first();
  assert.equal(await subject.count(), 1, `${scenario.slug} 史事必须给出卷中人物`);
  await assertTouchTarget(subject, scenario, '卷中人物入口');
  await activate(subject, scenario);
  const inspector = page.locator('.observer-inspector[data-kind="person"]');
  await inspector.waitFor();
  let selected = await waitForState(page, (current) => current.interface?.selected?.kind === 'person');
  assertObserverReadOnly(selected, baseline, `${scenario.slug} 从史事查看人物`);

  if (scenario.viewport.width <= MOBILE_MAX_WIDTH) {
    assert.equal(selected.interface.mobileInspectorMode, 'full', `${scenario.slug} 从史事选人应直接打开可操作的完整档案`);
  }
  await waitForAnimations(inspector);
  await page.waitForFunction(() => document.activeElement?.matches('.observer-inspector[data-kind="person"]') ?? false);
  assert.equal(
    await inspector.evaluate((element) => document.activeElement === element),
    true,
    `${scenario.slug} 从史事选人后焦点必须进入人物档案`,
  );
  assert.equal(selected.interface.historyReadingLayer, 'quarter', `${scenario.slug} 从史事选人后旧阅读层必须退出`);
  assert.equal(await page.locator('[aria-modal="true"]').count(), 0, `${scenario.slug} 从史事选人后不得残留模态层`);
  await assertNoHorizontalOverflow(page, scenario, '打开人物档案后');
  return { inspector, selected };
}

async function followAndEmbodimentRoundTrip(page, scenario, baseline, inspector, selected) {
  const personId = selected.interface.selected.id;
  const personName = selected.interface.selected.label;
  const watchedBefore = baseline.observer.watchedCount;
  const follow = page.getByRole('button', { name: `关注${personName}`, exact: true });
  await assertTouchTarget(follow, scenario, '关注人物入口');
  await activate(follow, scenario);
  const followed = await waitForState(
    page,
    (current, expected) => current.observer.watchlist.some((item) => (
      item.kind === 'person' && item.id === expected
    )),
    personId,
  );
  assertObserverReadOnly(followed, baseline, `${scenario.slug} 关注人物`);
  assert.equal(followed.observer.watchedCount, watchedBefore + 1, `${scenario.slug} 关注应只增加一个观察对象`);

  const enter = page.getByRole('button', { name: '以此人入世', exact: true });
  await assertTouchTarget(enter, scenario, '人物入世入口');
  await activate(enter, scenario);
  const embodied = await waitForState(page, (current, id) => current.observer.embodiment.actorId === id, personId);
  assertObserverReadOnly(embodied, baseline, `${scenario.slug} 进入人物视角`);
  assert.ok(embodied.observer.embodiment.actions.length > 0, `${scenario.slug} 入世后必须给出少量人物行动`);
  await inspector.locator('[data-testid="embodiment-actions"]').waitFor();

  const leave = page.getByRole('button', { name: '离开此人', exact: true });
  await assertTouchTarget(leave, scenario, '离开人物入口');
  await activate(leave, scenario);
  const observer = await waitForState(page, (current) => current.observer.embodiment.actorId === null);
  assertObserverReadOnly(observer, baseline, `${scenario.slug} 回到观察者视角`);
  assert.equal(observer.observer.embodiment.pending, null, `${scenario.slug} 未定行动时离开不得制造隐藏命令`);
  assert.equal(observer.observer.embodiment.actions.length, 0, `${scenario.slug} 观察者视角不得保留人物行动入口`);
  assert.equal(await inspector.locator('[data-testid="embodiment-actions"]').count(), 0, `${scenario.slug} 离开后不得显示入世行动面板`);
  assert.match(await inspector.locator('.observer-embodiment-switch strong').textContent(), /仍是历史观察者/);

  const visibleCommands = await page.locator('button:visible').evaluateAll((buttons) => (
    buttons.map((button) => `${button.getAttribute('aria-label') ?? ''} ${button.textContent ?? ''}`.replace(/\s+/g, ' ').trim())
  ));
  const rulerCommands = ['直接征兵', '直接宣战', '调动军队', '任免官员', '征收赋税', '颁布政令', '接管政权'];
  assert.deepEqual(
    visibleCommands.filter((label) => rulerCommands.some((command) => label.includes(command))),
    [],
    `${scenario.slug} 观察者视角不得出现统治者式控制`,
  );
  await assertNoHorizontalOverflow(page, scenario, '关注与入世往返后');
  await page.screenshot({ path: `${ARTIFACT_DIR}/${scenario.slug}-observer-restored.png`, fullPage: false });
}

async function followSituationFromDossier(page, scenario, baseline, inspector) {
  const closeInspector = inspector.locator('[data-inspector-close]');
  await assertTouchTarget(closeInspector, scenario, '人物档案关闭入口');
  await activate(closeInspector, scenario);
  await inspector.waitFor({ state: 'detached' });

  let current = baseline;
  const advance = page.getByRole('button', { name: '推进至下一季', exact: true });
  while (current.time.turn < 8) {
    await activate(advance, scenario);
    current = await waitForState(
      page,
      (snapshot, turn) => snapshot.time.turn === turn && snapshot.interface?.quarterPulse?.turn === turn - 1,
      current.time.turn + 1,
    );
  }

  const shortcut = page.locator('[data-situation-workbench-trigger="true"]');
  assert.equal(await shortcut.count(), 1, `${scenario.slug} 八季后必须能从地图打开持续局势`);
  await assertTouchTarget(shortcut, scenario, '持续局势入口');
  await activate(shortcut, scenario);

  const workbench = page.locator('.situation-workbench[data-status="open"]');
  await workbench.waitFor();
  const opened = await state(page);
  assertObserverReadOnly(opened, current, `${scenario.slug} 打开持续局势`);
  assert.ok(opened.observer.selectedSituationId, `${scenario.slug} 局势卷必须保留稳定身份`);
  assert.equal(opened.interface.selected, null, `${scenario.slug} 打开局势不得暗中选中代理人物或政权`);

  const watch = workbench.locator('.situation-workbench__watch');
  assert.equal(await watch.count(), 1, `${scenario.slug} 发展中的局势卷必须直接提供关注入口`);
  await assertTouchTarget(watch, scenario, '局势卷关注入口');
  await activate(watch, scenario);
  const watched = await waitForState(
    page,
    (snapshot, situationId) => snapshot.observer.watchedSituationIds.includes(situationId),
    opened.observer.selectedSituationId,
  );
  assertObserverReadOnly(watched, current, `${scenario.slug} 关注持续局势`);
  assert.equal(await watch.getAttribute('aria-pressed'), 'true', `${scenario.slug} 局势卷应显示已关注状态`);
  await page.screenshot({ path: `${ARTIFACT_DIR}/${scenario.slug}-situation-watched.png`, fullPage: false });

  const participantDisclosure = workbench.locator('[data-testid="situation-participants-disclosure"]');
  assert.equal(await participantDisclosure.count(), 1, `${scenario.slug} 局势卷必须提供折叠的相关各方`);
  assert.equal(await participantDisclosure.getAttribute('open'), null, `${scenario.slug} 相关各方默认应折叠`);
  const participantSummary = participantDisclosure.locator('summary').first();
  await assertTouchTarget(participantSummary, scenario, '局势卷相关各方入口');
  await activate(participantSummary, scenario);
  await page.waitForFunction(() => document.querySelector('[data-testid="situation-participants-disclosure"]')?.hasAttribute('open'));
  const participant = participantDisclosure.locator('button').first();
  assert.equal(await participant.count(), 1, `${scenario.slug} 局势卷必须给出可查看的核心人物`);
  await assertTouchTarget(participant, scenario, '局势卷人物入口');
  await activate(participant, scenario);
  const participantInspector = page.locator('.observer-inspector[data-kind="person"]');
  await participantInspector.waitFor();
  const personOpened = await waitForState(page, (snapshot) => snapshot.interface?.selected?.kind === 'person');
  assertObserverReadOnly(personOpened, current, `${scenario.slug} 从局势查看人物`);
  assert.equal(personOpened.interface.historyReadingLayer, 'quarter', `${scenario.slug} 从局势选人后旧阅读层必须退出`);
  assert.equal(await page.locator('[aria-modal="true"]').count(), 0, `${scenario.slug} 从局势选人后不得残留模态层`);
  await page.waitForFunction(() => document.activeElement?.matches('.observer-inspector[data-kind="person"]') ?? false);
  assert.equal(
    await participantInspector.evaluate((element) => document.activeElement === element),
    true,
    `${scenario.slug} 从局势选人后焦点必须进入人物档案`,
  );
  await activate(participantInspector.locator('[data-inspector-close]'), scenario);
  await participantInspector.waitFor({ state: 'detached' });
  await shortcut.waitFor();
  await activate(shortcut, scenario);
  await waitForState(
    page,
    (snapshot, situationId) => (
      snapshot.interface.historyReadingLayer === 'situation'
      && snapshot.observer.selectedSituationId === situationId
    ),
    opened.observer.selectedSituationId,
  );
  await workbench.waitFor();

  const historyEntry = workbench.locator('.situation-workbench__timeline button[data-event-id]').first();
  if (await historyEntry.count()) {
    const eventId = await historyEntry.getAttribute('data-event-id');
    await assertTouchTarget(historyEntry, scenario, '局势卷何故入口');
    await activate(historyEntry, scenario);
    const evidence = await waitForState(page, (snapshot) => snapshot.interface.historyReadingLayer === 'evidence');
    assertObserverReadOnly(evidence, current, `${scenario.slug} 从局势查明原因`);
    assert.equal(evidence.interface.selectedEventId, eventId, `${scenario.slug} 局势与何故必须指向同一史事`);
    await activate(page.locator('#observer-causal-drawer .observer-causal-drawer__header button'), scenario);
    await waitForState(page, (snapshot) => snapshot.interface.historyReadingLayer === 'situation');
  }

  await activate(workbench.locator('.situation-workbench__close'), scenario);
  const returned = await waitForState(page, (snapshot) => snapshot.interface.historyReadingLayer === 'quarter');
  assertObserverReadOnly(returned, current, `${scenario.slug} 关闭局势卷`);
  assert.equal(await page.locator('.observer-inspector').count(), 0, `${scenario.slug} 关闭局势卷后不得露出代理对象档案`);
}

async function assertObserverToolTouchContracts(page, scenario) {
  const deskTrigger = page.locator('[data-observer-desk-trigger="true"]');
  await assertTouchTarget(deskTrigger, scenario, '观察台入口');
  await activate(deskTrigger, scenario);
  const desk = page.locator('.observer-desk');
  await desk.waitFor();
  for (const [locator, label] of [
    [desk.locator('.observer-desk__master-switch'), '观察暂停总开关'],
    [desk.locator('.observer-desk__rules select').first(), '观察暂停阈值'],
    [desk.locator('.observer-desk__guide footer > button'), '观察导览重置'],
    [desk.locator('.observer-desk__release-notes summary'), '版本说明展开入口'],
  ]) {
    if (await locator.count()) await assertTouchTarget(locator, scenario, label);
  }
  await activate(desk.locator('.observer-desk__header > button'), scenario);
  await desk.waitFor({ state: 'detached' });

  const mandateTrigger = page.locator('[data-mandate-trigger="true"]');
  await assertTouchTarget(mandateTrigger, scenario, '天意入口');
  await activate(mandateTrigger, scenario);
  const mandate = page.locator('.mandate-panel');
  await mandate.waitFor();
  const mandateClose = mandate.locator('.mandate-panel__header > button');
  await assertTouchTarget(mandateClose, scenario, '天意关闭入口');
  await activate(mandateClose, scenario);
  await mandate.waitFor({ state: 'detached' });
}

async function verifyScenario(browser, scenario) {
  const context = await browser.newContext({
    viewport: scenario.viewport,
    hasTouch: scenario.viewport.width <= MOBILE_MAX_WIDTH,
    isMobile: scenario.viewport.width <= MOBILE_MAX_WIDTH,
  });
  const page = await context.newPage();
  const browserErrors = [];
  collectBrowserErrors(page, browserErrors);

  try {
    const initial = await createWorld(page, scenario);
    const { advanced, story } = await advanceAndReadPrimaryStory(page, scenario, initial);
    await openCausalLayer(page, scenario, advanced, story);
    const { inspector, selected } = await openRelatedPerson(page, scenario, advanced);
    await followAndEmbodimentRoundTrip(page, scenario, advanced, inspector, selected);
    await followSituationFromDossier(page, scenario, advanced, inspector);
    await assertObserverToolTouchContracts(page, scenario);
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
  process.stdout.write(`TRIM01.8 acceptance E2E passed: ${SCENARIOS.length} viewports.\n`);
} finally {
  await browser?.close();
  await server?.close();
}
