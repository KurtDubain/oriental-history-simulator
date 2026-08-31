import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const PORT = Number(process.env.POLITICAL_VISIBILITY_E2E_PORT ?? 4198);
const externalUrl = process.env.POLITICAL_VISIBILITY_E2E_URL;
const APP_URL = externalUrl ?? `http://127.0.0.1:${PORT}`;
const ARTIFACT_DIR = 'output/political-visibility-e2e';
const TARGET_POLITY_ID = 'p_yan';
const TARGET_TURN = 4;
const MOBILE_DOSSIER_MAX_WIDTH = 840;
const MOBILE_SEAT_MAX_WIDTH = 720;
const SCENARIO_FILTER = process.env.POLITICAL_VISIBILITY_E2E_SCENARIO;

const SCENARIOS = Object.freeze([
  { slug: 'desktop-1440x900', viewport: { width: 1440, height: 900 } },
  { slug: 'mobile-wide-640x900', viewport: { width: 640, height: 900 } },
  { slug: 'mobile-390x844', viewport: { width: 390, height: 844 } },
].filter((scenario) => !SCENARIO_FILTER || scenario.slug === SCENARIO_FILTER));

assert.ok(SCENARIOS.length > 0, `未知 POL03 E2E 场景：${SCENARIO_FILTER}`);

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

function assertObserverInvariant(current, baseline, detail) {
  assert.equal(current.time.turn, baseline.time.turn, `${detail}不得推进季度`);
  assert.equal(
    current.deterministicWorldHash,
    baseline.deterministicWorldHash,
    `${detail}不得改写权威世界哈希`,
  );
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
  await page.getByLabel('世界种子').fill('POL03-朝堂能见度');
  await page.locator('#start-world').click();
  await page.waitForSelector('.world-map__canvas');

  for (let turn = 1; turn <= TARGET_TURN; turn += 1) {
    await page.getByRole('button', { name: '推进至下一季', exact: true }).click();
    await waitForState(page, (current, expectedTurn) => current.time.turn === expectedTurn, turn);
  }

  const baseline = await snapshot(page);
  assert.equal(baseline.time.turn, TARGET_TURN, `${scenario.slug} 应推进到关系可见的固定季度`);
  assert.equal(baseline.mapProfile.id, 'private-v03');
  assert.ok(
    baseline.polities.some((polity) => polity.id === TARGET_POLITY_ID),
    `${scenario.slug} 固定世界必须保留目标政权`,
  );
  return baseline;
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
  const row = roster.locator(`[data-roster-id="${TARGET_POLITY_ID}"]`);
  assert.equal(await row.count(), 1, `${scenario.slug} 列国卷必须存在目标政权`);
  await activate(row, scenario);
  await waitForState(
    page,
    (current, polityId) => current.interface?.selected?.kind === 'country'
      && current.interface.selected.id === polityId,
    TARGET_POLITY_ID,
  );

  const inspector = page.locator('.observer-inspector[data-kind="country"]');
  await inspector.waitFor();
  if (scenario.viewport.width <= MOBILE_DOSSIER_MAX_WIDTH) {
    const mode = await inspector.getAttribute('data-mobile-mode');
    assert.ok(mode === 'quick' || mode === 'full', `${scenario.slug} 移动档案必须声明速览/完整模式`);
    if (mode === 'quick') {
      const details = page.getByTestId('map-quick-look-details');
      await activate(details, scenario);
    }
    await page.waitForFunction(() => (
      document.querySelector('.observer-inspector[data-kind="country"]')?.getAttribute('data-mobile-mode') === 'full'
    ));
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
    TARGET_POLITY_ID,
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
  assert.equal(projection.polityId, TARGET_POLITY_ID);
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
  assert.match(
    (await court.locator('[data-court-focus-detail] h4').textContent()) ?? '',
    new RegExp(dominant.name),
    `${scenario.slug} 默认焦点必须指向排名首位派系`,
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
  await closePersonInspector(page, scenario, personInspector);

  const returned = await openCountryCourt(page, scenario, baseline);
  assert.deepEqual(
    returned.selected.interface.selectedDetail.court.factionPositions.map((position) => position.factionId),
    selected.interface.selectedDetail.court.factionPositions.map((position) => position.factionId),
    `${scenario.slug} 领袖往返后派系次序不得漂移`,
  );
  assertObserverInvariant(returned.selected, baseline, `${scenario.slug} 领袖人物往返完整链`);
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
    const opened = await openCountryCourt(page, scenario, baseline);
    await assertProjectionAlignment(page, scenario, opened.court, opened.selected);
    await exerciseFocusAndTrace(page, scenario, baseline, opened.court, opened.selected);
    await page.screenshot({ path: `${ARTIFACT_DIR}/${scenario.slug}-court.png`, fullPage: false });
    const seatReturned = await exerciseSeatHolderRoundTrip(page, scenario, baseline, opened.court, opened.selected);
    const returned = await exerciseLeaderRoundTrip(page, scenario, baseline, seatReturned.court, seatReturned.selected);
    await assertProjectionAlignment(page, scenario, returned.court, returned.selected);
    const final = await snapshot(page);
    assertObserverInvariant(final, baseline, `${scenario.slug} POL03 完整观察链`);
    await page.screenshot({ path: `${ARTIFACT_DIR}/${scenario.slug}-returned.png`, fullPage: false });
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
  process.stdout.write(`POL03 political visibility E2E passed: turn ${TARGET_TURN} × ${SCENARIOS.length} viewports.\n`);
} finally {
  await browser?.close();
  await server?.close();
}
