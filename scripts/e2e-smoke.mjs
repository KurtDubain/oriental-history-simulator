import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const APP_URL = 'http://127.0.0.1:4173';
const SNAPSHOT_LIMIT = 128 * 1024;
const ARTIFACT_DIR = 'output/v1-release-visual';
const SITUATION_TYPE_LABELS = Object.freeze({
  military_power_crisis: '军权危机',
  inheritance_crisis: '继承危机',
  war_progress: '战争进程',
});
const SITUATION_OPEN_BUDGETS = Object.freeze({
  military_power_crisis: 5,
  inheritance_crisis: 3,
  war_progress: 4,
});
const LEAD_SLOTS = Object.freeze(['person', 'polity', 'tension']);
const SITUATION_TYPE_BY_LEAD_SLOT = Object.freeze({
  person: 'military_power_crisis',
  polity: 'inheritance_crisis',
  tension: 'war_progress',
});
const LEAD_STAGE_BY_SITUATION_PHASE = Object.freeze({
  emerging: '伏线',
  active: '升温',
  critical: '临界',
});
const SITUATION_WATCH_SEED = '春战副将';
const SITUATION_WATCH_TURN = 8;
const SITUATION_WATCH_SLOT = 'tension';
const SITUATION_WATCH_EXPECTED_ID = 'situation_000001';
const SITUATION_WATCH_EXPECTED_PAUSE_TURN = 10;

const server = await createServer({
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 4173, strictPort: true },
});

function collectBrowserErrors(page, target) {
  page.on('console', (message) => {
    if (message.type() === 'error') target.push(message.text());
  });
  page.on('pageerror', (error) => target.push(String(error)));
}

async function snapshotText(page) {
  return page.evaluate(() => window.render_game_to_text());
}

async function snapshot(page) {
  return JSON.parse(await snapshotText(page));
}

async function selectPersonWithCommandRequest(page, rows, maximum = 120) {
  const current = await snapshot(page);
  const candidates = current.observer.commandCandidates ?? [];
  const search = page.getByLabel('检索时人群像');
  for (const candidate of candidates) {
    const id = candidate.characterId;
    await search.fill(candidate.name);
    const row = page.locator(`.roster-panel button[data-roster-id="${id}"]`);
    if (!await row.count()) continue;
    await row.click();
    const state = await waitForSnapshot(page, (currentState, expectedId) => (
      currentState.interface.selected?.kind === 'person'
      && currentState.interface.selected.id === expectedId
    ), id);
    if (state.interface.selectedDetail.agency?.commandRequest) {
      await search.fill('');
      return state;
    }
  }
  await search.fill('');
  const count = Math.min(maximum, await rows.count());
  for (let index = 0; index < count; index += 1) {
    const id = await rows.nth(index).getAttribute('data-roster-id');
    if (!id) continue;
    await rows.nth(index).click();
    const state = await waitForSnapshot(page, (current, expectedId) => (
      current.interface.selected?.kind === 'person'
      && current.interface.selected.id === expectedId
    ), id);
    if (state.interface.selectedDetail.agency?.commandRequest) return state;
  }
  return null;
}

function assertRuntimePhase(state, phase, message) {
  const metric = state.runtimePerformance?.phases?.[phase];
  assert.ok(metric, message ?? `缺少 ${phase} 性能样本`);
  assert.ok(metric.count >= 1, `${phase} 至少应记录一次`);
  assert.ok(metric.latestMs >= 0 && metric.p95Ms >= 0 && metric.maxMs >= metric.p95Ms, `${phase} 指标必须有效`);
  return metric;
}

async function readAutosaveWorld(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('canghai-history-v01', 1);
    request.onerror = () => reject(request.error ?? new Error('无法打开自动存档数据库'));
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('world-saves', 'readonly');
      const row = transaction.objectStore('world-saves').get('autosave');
      row.onerror = () => reject(row.error ?? new Error('无法读取自动存档'));
      row.onsuccess = () => {
        try {
          resolve(row.result?.payload ? JSON.parse(row.result.payload) : null);
        } catch (error) {
          reject(error);
        } finally {
          database.close();
        }
      };
    };
  }));
}

async function waitForLatestAutosave(page, expected, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  let saved = null;
  while (Date.now() <= deadline) {
    saved = await readAutosaveWorld(page);
    if (saved?.turn === expected.time.turn && saved?.hash === expected.deterministicWorldHash) return saved;
    await page.waitForTimeout(50);
  }
  assert.fail(`暂停后 ${timeoutMs}ms 内自动存档未达到 T${expected.time.turn}/${expected.deterministicWorldHash}，实际 ${saved?.turn ?? 'none'}/${saved?.hash ?? 'none'}`);
}

async function openFreshWorld(page, seed = null) {
  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'start-world');
  if (seed) await page.getByLabel('世界种子').fill(seed);
  await page.click('#start-world');
  await page.waitForSelector('.world-map__canvas');
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).productVersion === '1.0.0');
}

async function exerciseMapPrimer(page) {
  const before = await snapshot(page);
  assert.equal(before.observer.primerOpen, true, '首次新建世界应打开三步读图导览');
  assert.equal(before.observer.primerStep, 'terrain');
  const originalHash = before.deterministicWorldHash;
  const primer = page.locator('.map-primer');
  await primer.waitFor();
  assert.equal(await primer.getAttribute('role'), 'dialog');
  assert.equal(await primer.getAttribute('aria-modal'), 'true');
  assert.equal(await page.locator('.observer-app').evaluate((element) => element.inert), true);
  await assertFocusTrapped(page, '.map-primer', 10);

  await primer.locator('[data-map-primer-action]').click();
  const terrainRead = await waitForSnapshot(
    page,
    (current) => current.observer.primerStep === 'situation' && current.interface.overlay === 'none',
  );
  assert.equal(terrainRead.deterministicWorldHash, originalHash, '切换地势观察不得改变世界哈希');

  await primer.locator('[data-map-primer-action]').click();
  const situationRead = await waitForSnapshot(
    page,
    (current) => current.observer.primerStep === 'history' && current.interface.overlay === 'political',
  );
  assert.equal(situationRead.deterministicWorldHash, originalHash, '切换政治观察不得改变世界哈希');

  await primer.locator('[data-map-primer-action]').click();
  const advanced = await waitForSnapshot(page, (current, turn) => current.time.turn === turn + 1, before.time.turn);
  assert.notEqual(advanced.deterministicWorldHash, originalHash, '导览中的推进一季应写入新历史');
  assert.equal(advanced.observer.primerOpen, true);
  assert.match(await primer.textContent(), /一季已过/);

  await primer.locator('[data-map-primer-action]').click();
  await primer.waitFor({ state: 'detached' });
  await page.waitForSelector('#observer-causal-drawer');
  const traced = await snapshot(page);
  assert.equal(traced.observer.primerOpen, false);
  assert.ok(traced.interface.selectedEventId, '导览应打开刚过去一季的可追溯史事');
  await page.locator('#observer-causal-drawer button[aria-label="关闭因果链"]').click();
  await page.waitForSelector('#observer-causal-drawer', { state: 'detached' });
  assert.equal(
    await page.evaluate(() => localStorage.getItem('canghai-map-primer-complete-v1')),
    '1',
    '完成导览应保存非权威偏好标记',
  );
  return snapshot(page);
}

async function waitForSnapshot(page, predicate, argument, timeout = 15_000) {
  await page.waitForFunction(
    ({ source, argument: innerArgument }) => {
      const current = JSON.parse(window.render_game_to_text());
      return Function('current', 'argument', `return (${source})(current, argument);`)(current, innerArgument);
    },
    { source: predicate.toString(), argument },
    { timeout },
  );
  return snapshot(page);
}

async function assertFocusTrapped(page, dialogSelector, tabCount = 16) {
  for (let index = 0; index < tabCount; index += 1) {
    await page.keyboard.press('Tab');
    assert.equal(
      await page.evaluate((selector) => Boolean(document.activeElement?.closest(selector)), dialogSelector),
      true,
      `${dialogSelector} 应把键盘焦点留在弹层内`,
    );
  }
}

async function assertWithinViewport(page, selector, message) {
  await page.waitForFunction((target) => {
    const element = document.querySelector(target);
    if (!element) return false;
    const bounds = element.getBoundingClientRect();
    return bounds.left >= 0 && bounds.right <= window.innerWidth + 1;
  }, selector);
  const bounds = await page.locator(selector).boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 391, message);
  return bounds;
}

async function waitForVisualSettled(locator) {
  await locator.evaluate(async (element) => {
    await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined)));
  });
}

async function readObserverDeskSettings(page, seed) {
  return page.evaluate((worldSeed) => {
    const raw = localStorage.getItem(`canghai-observer-desk-v1:${encodeURIComponent(worldSeed)}`);
    return raw ? JSON.parse(raw) : null;
  }, seed);
}

function situationFromSnapshot(state, situationId) {
  return [...state.observer.situations.open, ...state.observer.situations.recentResolved]
    .find((item) => item.id === situationId) ?? null;
}

async function assertUnobstructedTapTarget(locator, message) {
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
  return result;
}

async function selectLayer(page, layer) {
  const trigger = page.getByRole('button', { name: /^舆图叠层/ });
  if (!(await page.locator('#observer-layer-sheet').isVisible().catch(() => false))) await trigger.click();
  await page.waitForSelector('#observer-layer-sheet');
  await page.locator(`[data-layer-id="${layer}"]`).click();
  await page.waitForSelector(`.world-map[data-overlay="${layer}"]`);
  assert.equal((await snapshot(page)).interface.overlay, layer);
}

async function auditLayerDialog(page, mobile = false) {
  const trigger = page.getByRole('button', { name: /^舆图叠层/ });
  await trigger.click();
  const sheet = page.locator('#observer-layer-sheet');
  await sheet.waitFor();
  assert.equal(await sheet.getAttribute('role'), 'dialog');
  assert.equal(await sheet.getAttribute('aria-modal'), 'true');
  assert.equal(await sheet.locator('[role="radio"]').count(), 10);
  for (let index = 0; index < 14; index += 1) {
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest('#observer-layer-sheet'))), true);
  }
  if (mobile) {
    const layout = await sheet.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const section = element.querySelector('.layer-picker__groups section');
      return {
        left: rect.left,
        right: rect.right,
        sectionDisplay: section ? getComputedStyle(section).display : null,
      };
    });
    assert.ok(layout.left >= 0 && layout.right <= 390, '移动端叠层弹页不可越出视口');
    assert.equal(layout.sectionDisplay, 'block', '移动端叠层应为单列');
  }
  await page.keyboard.press('Escape');
  await sheet.waitFor({ state: 'detached' });
  assert.ok((await page.evaluate(() => document.activeElement?.getAttribute('aria-label')))?.startsWith('舆图叠层'));
}

async function advanceOneQuarter(page) {
  const before = await snapshot(page);
  const nextTurn = before.time.turn + 1;
  await page.click('button[aria-label="推进至下一季"]');
  await page.waitForFunction(
    (turn) => JSON.parse(window.render_game_to_text()).time.turn >= turn,
    nextTurn,
    { timeout: 15_000 },
  );
  const fatal = page.locator('.observer-fatal');
  if (await fatal.count()) throw new Error(`季度推进触发错误：${await fatal.textContent()}`);
  return snapshot(page);
}

async function advanceTo(page, turn) {
  let current = await snapshot(page);
  while (current.time.turn < turn) current = await advanceOneQuarter(page);
  return current;
}

function assertChineseSituationCopy(value, message) {
  assert.equal(typeof value, 'string', message);
  assert.match(value, /[\p{Script=Han}]/u, message);
}

function auditSituationProjection(projection, requiredTypes) {
  assert.ok(projection.open.length <= 12 && projection.recentResolved.length <= 2, '局势文本投影必须有界');
  assert.equal(projection.openCount, projection.open.length, '开放局势计数应与投影一致');
  const openByType = Object.fromEntries(Object.keys(SITUATION_TYPE_LABELS).map((type) => [type, 0]));
  for (const situation of projection.open) {
    assert.ok(Object.hasOwn(SITUATION_TYPE_LABELS, situation.type), `未接纳的局势类型 ${situation.type}`);
    openByType[situation.type] = (openByType[situation.type] ?? 0) + 1;
    assert.equal(situation.typeLabel, SITUATION_TYPE_LABELS[situation.type], `${situation.type}应公开中文类型名`);
    assertChineseSituationCopy(situation.title, `${situation.type}应公开中文标题`);
    assert.match(situation.title, new RegExp(situation.typeLabel), `${situation.type}标题应明示局势类型`);
    assert.ok(['emerging', 'active', 'critical'].includes(situation.phase));
    assert.ok(situation.tension >= 0 && situation.tension <= 100);
    assert.ok(situation.evidence.filter((item) => item.role === 'structural').length >= 2, '正式局势应公开至少两条结构证据');
    assert.ok(situation.evidence.every((item) => {
      assertChineseSituationCopy(item.label, `${situation.type}证据应使用中文标签`);
      assertChineseSituationCopy(item.roleLabel, `${situation.type}证据角色应使用中文标签`);
      return item.refs.length > 0;
    }), '局势证据必须保留结构化引用');
    assert.ok(situation.causalFactIds.length > 0 && situation.milestoneFactIds.length > 0);
    assertChineseSituationCopy(situation.nextSignal.label, `${situation.type}应公开中文观察线索`);
    assert.ok(situation.nextSignal.refs.length > 0, `${situation.type}观察线索应保留结构化引用`);
  }
  for (const [type, budget] of Object.entries(SITUATION_OPEN_BUDGETS)) {
    assert.ok((openByType[type] ?? 0) <= budget, `${type}开放局势不得超过类型预算${budget}`);
  }
  for (const requiredType of requiredTypes) {
    assert.ok(projection.open.some((situation) => situation.type === requiredType), `固定世界应自然形成${requiredType}`);
  }
}

function assertObserverLeadMilestone(state, expectedSources, label) {
  const leads = state.observer.focusLeads;
  assert.equal(leads.length, LEAD_SLOTS.length, `${label}应始终给出三条观察题`);
  assert.deepEqual(leads.map((lead) => lead.slot), LEAD_SLOTS, `${label}三问槽位顺序不得变化`);
  assert.deepEqual(
    leads.map((lead) => lead.source),
    LEAD_SLOTS.map((slot) => expectedSources[slot]),
    `${label}应按槽位优先使用 Situation，仅在无匹配时回退`,
  );
  const arbitration = state.observer.leadArbitration;
  assert.equal(arbitration.version, 1, `${label}应暴露有界的连续性仲裁版本`);
  assert.equal(arbitration.lastArbitratedTurn, state.time.turn, `${label}仲裁必须对应当前季度`);
  assert.deepEqual(arbitration.slots.map((entry) => entry.slot), LEAD_SLOTS, `${label}仲裁应覆盖三个槽位`);

  for (const lead of leads) {
    const continuity = arbitration.slots.find((entry) => entry.slot === lead.slot);
    assert.ok(continuity, `${label} ${lead.slot}应有连续性记录`);
    assert.equal(continuity.leadId, lead.id, `${label} ${lead.slot}展示题与仲裁身份必须一致`);
    assert.equal(continuity.situationId, lead.situationId, `${label} ${lead.slot}不得丢失 Situation 身份`);
    assert.equal(lead.selectedSinceTurn, continuity.selectedSinceTurn, `${label} ${lead.slot}应公开真实留任起点`);
    assert.equal(lead.retainThroughTurn, continuity.retainThroughTurn, `${label} ${lead.slot}应公开最短留任边界`);
    assert.equal(lead.trackingTurns, state.time.turn - lead.selectedSinceTurn + 1, `${label} ${lead.slot}追踪季数应可校验`);
    assert.ok(lead.evidence.length === 2 && lead.nextSignal.length > 0, `${label} ${lead.slot}应保留两条证据与下一观察`);

    if (lead.source === 'fallback') {
      assert.equal(lead.situationId, null, `${label} ${lead.slot}回退题不得伪造 Situation ID`);
      assert.equal(lead.situationType, null, `${label} ${lead.slot}回退题不得伪造 Situation 类型`);
      assert.equal(lead.displayMode, 'fallback', `${label} ${lead.slot}回退题应明示来源`);
      continue;
    }

    assert.equal(lead.source, 'situation', `${label} ${lead.slot}只能使用权威 Situation 题源`);
    assert.equal(lead.situationType, SITUATION_TYPE_BY_LEAD_SLOT[lead.slot], `${label} ${lead.slot}应匹配正确局势类型`);
    assert.equal(lead.displayMode, 'tracking', `${label} ${lead.slot}的未结案局势应持续追踪`);
    const situation = state.observer.situations.open.find((item) => item.id === lead.situationId);
    assert.ok(situation, `${label} ${lead.slot}必须指向当前开放的局势`);
    assert.equal(situation.type, lead.situationType, `${label} ${lead.slot}题源与局势投影类型必须一致`);
    assert.equal(lead.stage, LEAD_STAGE_BY_SITUATION_PHASE[situation.phase], `${label} ${lead.slot}阶段必须取自滞回后的 Situation phase`);
    assert.equal(lead.tension, Math.round(situation.tension), `${label} ${lead.slot}张力必须取自 Situation`);
  }

  return leads;
}

function observerLeadIdentity(state) {
  return state.observer.focusLeads.map((lead) => ({
    slot: lead.slot,
    id: lead.id,
    situationId: lead.situationId,
    selectedSinceTurn: lead.selectedSinceTurn,
    retainThroughTurn: lead.retainThroughTurn,
  }));
}

async function exerciseSituationLeadCards(page, state) {
  const panel = page.locator('[data-observer-leads="true"]');
  await panel.waitFor();
  await waitForVisualSettled(panel);
  await page.screenshot({ path: `${ARTIFACT_DIR}/situation-backed-leads-desktop.png`, fullPage: true });
  for (const lead of state.observer.focusLeads) {
    assert.ok(lead.situationId, `${lead.slot}卡片必须持有可直达的 Situation ID`);
    const row = panel.locator(`[data-testid="observer-lead"][data-situation-id="${lead.situationId}"]`);
    await row.waitFor();
    assert.equal(await row.count(), 1, `${lead.slot}应只有一张对应局势卡片`);
    await row.locator('.observer-leads__inspect').click();
    const opened = await waitForSnapshot(page, (current, situationId) => (
      current.observer.situationWorkbenchOpen
      && current.observer.selectedSituationId === situationId
      && current.observer.selectedSituation?.id === situationId
    ), lead.situationId);
    assert.equal(opened.observer.selectedSituation.type, lead.situationType, `${lead.slot}卡片应直达同一类型的局势卷宗`);
    assert.equal(opened.deterministicWorldHash, state.deterministicWorldHash, `${lead.slot}卡片阅卷不得改变世界哈希`);
    await page.locator('.situation-workbench__close').click();
    await page.waitForSelector('.situation-workbench', { state: 'detached' });
    const inspectorClose = page.locator('.observer-inspector button[aria-label="关闭档案"]');
    if (await inspectorClose.isVisible().catch(() => false)) await inspectorClose.click();
    await panel.waitFor();
    assert.equal((await snapshot(page)).deterministicWorldHash, state.deterministicWorldHash, `${lead.slot}返回当世三问后世界哈希应保持不变`);
  }
}

async function exerciseSituationSnapshot(context, { seed, turn, requiredTypes }) {
  assert.equal(seed, '春战副将', 'C01/C02 端到端验收必须使用冻结种子“春战副将”');
  assert.equal(turn, 8, 'C01/C02 端到端验收必须覆盖 T0/T4/T6/T8');
  const page = await context.newPage();
  const errors = [];
  collectBrowserErrors(page, errors);
  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  await page.getByLabel('世界种子').fill(seed);
  await page.click('#start-world');
  await page.waitForSelector('.world-map__canvas');
  const initial = await snapshot(page);
  assert.equal(initial.observer.primerOpen, false, '已完成导览的浏览器不应为审计世界重复弹出导览');
  assert.deepEqual(initial.observer.situations, {
    version: 1,
    lastReducedTurn: -1,
    openCount: 0,
    resolvedCount: 0,
    archivedResolvedCount: 0,
    open: [],
    recentResolved: [],
  });
  assertObserverLeadMilestone(initial, {
    person: 'fallback',
    polity: 'fallback',
    tension: 'fallback',
  }, 'T0');

  const turn4 = await advanceTo(page, 4);
  auditSituationProjection(turn4.observer.situations, ['war_progress']);
  assertObserverLeadMilestone(turn4, {
    person: 'fallback',
    polity: 'fallback',
    tension: 'situation',
  }, 'T4');

  const turn6 = await advanceTo(page, 6);
  auditSituationProjection(turn6.observer.situations, requiredTypes);
  assertObserverLeadMilestone(turn6, {
    person: 'situation',
    polity: 'situation',
    tension: 'situation',
  }, 'T6');
  const turn6Identity = observerLeadIdentity(turn6);

  const turn7 = await advanceTo(page, 7);
  assertObserverLeadMilestone(turn7, {
    person: 'situation',
    polity: 'situation',
    tension: 'situation',
  }, 'T7');
  assert.deepEqual(observerLeadIdentity(turn7), turn6Identity, 'T6→T7 未出现明确高优先级转折时三问不得换题');

  const observed = await advanceTo(page, turn);
  const projection = observed.observer.situations;
  assert.equal(projection.lastReducedTurn, observed.time.turn - 1);
  assert.ok(projection.openCount > 0, '固定种子应从真实季度事实自然形成局势');
  auditSituationProjection(projection, requiredTypes);
  assert.deepEqual((await snapshot(page)).observer.situations, projection, '重复读取必须得到完全相同的局势投影');
  assertObserverLeadMilestone(observed, {
    person: 'situation',
    polity: 'situation',
    tension: 'situation',
  }, 'T8');
  assert.deepEqual(observerLeadIdentity(observed), turn6Identity, 'T6→T8 应跨越三季稳定追踪同三条 Situation');
  assert.ok(observed.observer.focusLeads.every((lead) => lead.trackingTurns >= 3), 'T8 三问应展示连续追踪季数');
  assert.equal(observed.observer.watchedCount, 0, '本阶段不得自动创建关注项');
  assert.ok(Buffer.byteLength(await snapshotText(page), 'utf8') < SNAPSHOT_LIMIT);
  const situationHash = observed.deterministicWorldHash;
  const leadProjectionBeforeSave = {
    focusLeads: observed.observer.focusLeads,
    leadArbitration: observed.observer.leadArbitration,
  };

  await exerciseSituationLeadCards(page, observed);

  const workbenchTrigger = page.locator('.observer-leads__footer button');
  await workbenchTrigger.waitFor();
  await workbenchTrigger.click();
  await page.waitForSelector('.situation-workbench[role="dialog"]');
  let workbenchState = await snapshot(page);
  assert.equal(workbenchState.observer.situationWorkbenchOpen, true, '局势全卷必须拥有独立只读打开态');
  assert.ok(workbenchState.observer.selectedSituationId, '局势全卷必须选中一条稳定 Situation');
  assert.ok(workbenchState.observer.selectedSituation?.playerSummary.length >= 2, '默认读势层必须提供玩家语言摘要');
  assert.equal(workbenchState.deterministicWorldHash, situationHash, '打开局势全卷不得改变世界哈希');
  const workbench = page.locator('.situation-workbench');
  const auditDetails = workbench.locator('.situation-workbench__audit');
  assert.equal(await auditDetails.getAttribute('open'), null, 'Simulation Audit 默认必须折叠');
  assert.equal(await auditDetails.getByText('Situation ID', { exact: true }).isVisible(), false, '默认画面不得泄漏调试 ID');
  assert.ok(await workbench.locator('.situation-workbench__directory li > button').count() >= requiredTypes.length, '全卷目录应列出真实开放局势');
  await waitForVisualSettled(workbench);
  await page.screenshot({ path: `${ARTIFACT_DIR}/situation-workbench-desktop.png`, fullPage: true });

  const directoryButtons = workbench.locator('.situation-workbench__directory li > button');
  if (await directoryButtons.count() > 1) {
    const firstSelected = workbenchState.observer.selectedSituationId;
    await directoryButtons.nth(1).click();
    workbenchState = await snapshot(page);
    assert.notEqual(workbenchState.observer.selectedSituationId, firstSelected, '目录切换必须保留 Situation 身份');
    assert.equal(workbenchState.deterministicWorldHash, situationHash, '切换局势不得改变世界哈希');
  }
  await auditDetails.locator('summary').click();
  assert.notEqual(await auditDetails.getAttribute('open'), null, '高级审计应可按需展开');
  assert.equal((await snapshot(page)).deterministicWorldHash, situationHash, '展开审计不得改变世界哈希');
  await auditDetails.locator('summary').click();

  const causalButton = workbench.getByRole('button', { name: '查明因果' }).first();
  if (await causalButton.count()) {
    await causalButton.click();
    await page.waitForSelector('.observer-causal-drawer');
    const causalState = await snapshot(page);
    assert.equal(causalState.observer.situationWorkbenchOpen, false, '查明因果时应暂收卷宗，避免双层焦点陷阱');
    assert.ok(causalState.interface.selectedEventId, '里程碑因果入口必须精确指向史事');
    await page.locator('.observer-causal-drawer button[aria-label="关闭因果链"]').click();
    await page.waitForSelector('.situation-workbench[role="dialog"]');
    assert.equal((await snapshot(page)).observer.situationWorkbenchOpen, true, '关闭因果链后应回到原局势卷宗');
  }
  await page.locator('.situation-workbench__close').click();
  await page.waitForSelector('.situation-workbench', { state: 'detached' });
  assert.equal((await snapshot(page)).deterministicWorldHash, situationHash, '关闭局势全卷不得改变世界哈希');

  await page.click('button[aria-label="保存当前世界"]');
  await page.waitForTimeout(500);
  await page.click('button[aria-label="返回世界书页"]');
  await page.waitForSelector('#continue-world');
  await page.click('#continue-world');
  await page.waitForSelector('.world-map__canvas');
  const restored = await snapshot(page);
  assert.equal(restored.deterministicWorldHash, situationHash, '形成局势后的 schema-4 存档应精确恢复哈希');
  assert.deepEqual(restored.observer.situations, projection, '形成局势后的存档应精确恢复局势投影');
  assert.deepEqual(restored.observer.focusLeads, leadProjectionBeforeSave.focusLeads, '续读不得重置三问身份、留任起点或追踪季数');
  assert.deepEqual(restored.observer.leadArbitration, leadProjectionBeforeSave.leadArbitration, '续读必须恢复同一份非权威连续性仲裁记录');
  assert.ok(restored.observer.focusLeads.some((lead) => lead.selectedSinceTurn < restored.time.turn), '续读后不得把三问留任起点伪造为当前季度');
  auditSituationProjection(restored.observer.situations, requiredTypes);
  assert.deepEqual(errors, []);
  await page.close();
  return { seed, turn, requiredTypes, projection, leadProjection: leadProjectionBeforeSave };
}

async function exerciseSituationWatchAndPause(browserInstance) {
  const context = await browserInstance.newContext({ viewport: { width: 1_280, height: 720 } });
  const page = await context.newPage();
  const errors = [];
  collectBrowserErrors(page, errors);
  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.setItem('canghai-map-primer-complete-v1', '1'));
  await page.getByLabel('世界种子').fill(SITUATION_WATCH_SEED);
  await page.click('#start-world');
  await page.waitForSelector('.world-map__canvas');

  const turn8 = await advanceTo(page, SITUATION_WATCH_TURN);
  const lead = turn8.observer.focusLeads.find((item) => item.slot === SITUATION_WATCH_SLOT);
  assert.ok(lead?.situationId, '冻结种子 T8 的天下矛盾必须由真实 Situation 承载');
  assert.equal(lead.situationId, SITUATION_WATCH_EXPECTED_ID, '冻结种子应保持稳定的局势 ID');
  const watchedSituationId = lead.situationId;
  const turn8Situation = situationFromSnapshot(turn8, watchedSituationId);
  assert.equal(turn8Situation?.status, 'open');
  assert.equal(turn8Situation?.phase, 'critical', '关注前的战争局势应处于临界阶段');

  const leadRow = page.locator(
    `[data-testid="observer-lead"][data-situation-id="${watchedSituationId}"]`,
  );
  await leadRow.waitFor();
  const watchButton = leadRow.locator('[data-testid="observer-lead-watch"]');
  await watchButton.waitFor();
  assert.equal(await watchButton.getAttribute('data-watch-kind'), 'situation');
  assert.equal(await watchButton.getAttribute('data-watch-key'), `situation:${watchedSituationId}`);
  const hashBeforeWatch = turn8.deterministicWorldHash;
  await watchButton.click();
  const watched = await waitForSnapshot(page, (current) => current.observer.watchedCount === 1);
  assert.equal(watched.deterministicWorldHash, hashBeforeWatch, '关注 Situation 只能改变观察者设置');
  assert.equal(await watchButton.getAttribute('aria-pressed'), 'true');

  await page.waitForFunction(({ seed, situationId }) => {
    const raw = localStorage.getItem(`canghai-observer-desk-v1:${encodeURIComponent(seed)}`);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return parsed.version === 3
      && parsed.watchlist?.some((item) => item.kind === 'situation' && item.id === situationId);
  }, { seed: SITUATION_WATCH_SEED, situationId: watchedSituationId });
  let stored = await readObserverDeskSettings(page, SITUATION_WATCH_SEED);
  assert.equal(stored.version, 3, 'C03 观察台应迁移到 v3');
  assert.equal(stored.watchlist.length, 1);
  assert.deepEqual(
    stored.watchlist.map((item) => ({ kind: item.kind, id: item.id })),
    [{ kind: 'situation', id: watchedSituationId }],
    '当世三问的关注项必须存 Situation ID，不得存代理人物或政权',
  );

  const deskTrigger = page.locator('button[data-observer-desk-trigger="true"]');
  await deskTrigger.click();
  const desk = page.locator('.observer-desk');
  await desk.waitFor();
  const watchedRow = desk.locator(
    `[data-testid="observer-watch-item"][data-watch-kind="situation"][data-watch-id="${watchedSituationId}"]`,
  );
  assert.equal(await watchedRow.count(), 1, '观察台必须以同一 Situation ID 展示关注项');
  const legacyRules = ['majorHistory', 'wars', 'powerTransfers', 'outbreaks', 'watchlistHits'];
  for (const rule of legacyRules) {
    const input = desk.locator(`[data-pause-rule="${rule}"] input[type="checkbox"]`);
    assert.equal(await input.count(), 1, `自动暂停规则 ${rule} 应有稳定语义标识`);
    if (await input.isChecked()) await input.uncheck();
  }
  const situationRule = desk.locator('[data-pause-rule="situationChanges"] input[type="checkbox"]');
  assert.equal(await situationRule.count(), 1, '观察台必须提供独立的局势里程碑暂停规则');
  if (!(await situationRule.isChecked())) await situationRule.check();
  await page.keyboard.press('Escape');
  await desk.waitFor({ state: 'detached' });

  await page.waitForFunction((seed) => {
    const raw = localStorage.getItem(`canghai-observer-desk-v1:${encodeURIComponent(seed)}`);
    if (!raw) return false;
    const rules = JSON.parse(raw).pauseRules;
    return rules?.enabled === true
      && rules.situationChanges === true
      && rules.majorHistory === false
      && rules.wars === false
      && rules.powerTransfers === false
      && rules.outbreaks === false
      && rules.watchlistHits === false;
  }, SITUATION_WATCH_SEED);

  await page.click('button[aria-label="保存当前世界"]');
  await waitForLatestAutosave(page, watched);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#continue-world');
  await page.click('#continue-world');
  await page.waitForSelector('.world-map__canvas');
  const restored = await waitForSnapshot(page, (current, expected) => (
    current.time.turn === expected.turn && current.deterministicWorldHash === expected.hash
  ), { turn: SITUATION_WATCH_TURN, hash: hashBeforeWatch });
  assert.equal(restored.observer.watchedCount, 1, '浏览器重载续读后应保留 Situation 关注');
  assert.deepEqual(restored.observer.watchedSituationIds, [watchedSituationId]);
  assert.ok(
    restored.observer.watchlist.some((item) => item.kind === 'situation' && item.id === watchedSituationId),
    '文本快照应公开续读后的稳定 Situation 关注身份',
  );
  stored = await readObserverDeskSettings(page, SITUATION_WATCH_SEED);
  assert.ok(
    stored.watchlist.some((item) => item.kind === 'situation' && item.id === watchedSituationId),
    '续读后 localStorage 仍应保留原 Situation ID',
  );
  const restoredInspectorClose = page.locator('.observer-inspector button[aria-label="关闭档案"]');
  if (await restoredInspectorClose.isVisible().catch(() => false)) {
    await restoredInspectorClose.click();
    await page.waitForSelector('.observer-inspector', { state: 'detached' });
  }
  const restoredWatchButton = page.locator(
    `[data-testid="observer-lead"][data-situation-id="${watchedSituationId}"] [data-testid="observer-lead-watch"]`,
  );
  await restoredWatchButton.waitFor();
  assert.equal(await restoredWatchButton.getAttribute('aria-pressed'), 'true');

  await page.getByRole('button', { name: '8 倍速推演' }).click();
  await page.getByRole('button', { name: '开始自动推演' }).click();
  await page.evaluate(() => window.advanceTime(225));
  const turn9 = await waitForSnapshot(page, (current) => current.time.turn === 9 && current.playback.running === true);
  assert.equal(turn9.observer.lastPauseReason, null, '被关注局势没有转折的 T9 不得误暂停');
  assert.equal(situationFromSnapshot(turn9, watchedSituationId)?.phase, 'critical');

  await page.evaluate(() => window.advanceTime(225));
  const paused = await waitForSnapshot(page, (current, expected) => (
    current.time.turn === expected.turn
      && current.playback.running === false
      && current.observer.lastPauseSituationId === expected.situationId
  ), { turn: SITUATION_WATCH_EXPECTED_PAUSE_TURN, situationId: watchedSituationId });
  assert.equal(paused.observer.lastPauseRule, 'situationChanges', '局势转折必须由 C04 规则暂停，不得冒充旧史事规则');
  assert.equal(paused.observer.lastPauseSituationId, watchedSituationId);
  assert.equal(paused.observer.lastPauseSituationTrigger, 'phase-change');
  assert.match(paused.observer.lastPauseReason, /局势|阶段|转折/);
  const pausedSituation = situationFromSnapshot(paused, watchedSituationId);
  assert.equal(pausedSituation?.status, 'open');
  assert.equal(pausedSituation?.phase, 'active', '冻结种子应在局势由 critical 回落为 active 的精确季度停下');
  assert.equal(pausedSituation?.latestChange?.kind, 'phase_changed');
  assert.equal(pausedSituation?.latestChange?.turn, SITUATION_WATCH_EXPECTED_PAUSE_TURN - 1);
  const refreshedWatch = paused.observer.watchlist.find((item) => (
    item.kind === 'situation' && item.id === watchedSituationId
  ));
  assert.match(refreshedWatch?.detail ?? '', /发展/, '关注簿应随权威局势刷新当前阶段');
  assert.doesNotMatch(refreshedWatch?.detail ?? '', /临界/, '关注簿不得在转阶段后继续展示关注当季的旧阶段');
  await waitForLatestAutosave(page, paused);

  await deskTrigger.click();
  await desk.waitFor();
  const pauseNote = desk.locator('.observer-desk__pause-note[data-pause-rule="situationChanges"]');
  await pauseNote.waitFor();
  const pauseNoteText = await pauseNote.textContent();
  assert.match(pauseNoteText, /局势里程碑|局势关键变化/);
  assert.match(pauseNoteText, /时间已停/);
  const pauseOpen = pauseNote.locator(
    `[data-testid="observer-pause-open"][data-situation-id="${watchedSituationId}"][data-situation-trigger="phase-change"]`,
  );
  assert.equal(await pauseOpen.count(), 1, '暂停项必须保留触发局势 ID 和转折类型');
  await waitForVisualSettled(desk);
  await page.screenshot({ path: `${ARTIFACT_DIR}/situation-milestone-pause-desktop.png`, fullPage: true });
  const pausedHash = paused.deterministicWorldHash;
  await pauseOpen.click();
  const opened = await waitForSnapshot(page, (current, situationId) => (
    current.observer.situationWorkbenchOpen
      && current.observer.selectedSituationId === situationId
      && current.observer.selectedSituation?.id === situationId
  ), watchedSituationId);
  assert.equal(opened.deterministicWorldHash, pausedHash, '从暂停原因阅卷不得改变世界哈希');
  assert.equal(opened.observer.selectedSituation.phase, 'active');
  assert.equal(
    opened.observer.watchlist.find((item) => item.kind === 'situation' && item.id === watchedSituationId)?.alert,
    false,
    '从暂停原因阅卷后应清除同一局势的未读里程碑',
  );
  await page.locator('.situation-workbench__close').click();
  await page.waitForSelector('.situation-workbench', { state: 'detached' });
  await page.waitForFunction(() => (
    document.activeElement?.getAttribute('data-observer-desk-trigger') === 'true'
  ));
  assert.deepEqual(errors, []);
  await context.close();
  return {
    seed: SITUATION_WATCH_SEED,
    situationId: watchedSituationId,
    pauseTurn: paused.time.turn,
    trigger: paused.observer.lastPauseSituationTrigger,
  };
}

async function exerciseObserverLeads(page, initialHash) {
  const initial = await snapshot(page);
  assert.equal(initial.observer.focusLeads.length, 3, '史家应始终给出一人、一国、一条矛盾');
  assert.deepEqual(initial.observer.focusLeads.map((item) => item.slot), ['person', 'polity', 'tension']);
  const panel = page.locator('[data-observer-leads="true"]');
  await panel.waitFor();
  assert.match(await panel.textContent(), /现在看什么/);
  const rows = panel.locator('[data-testid="observer-lead"]');
  assert.equal(await rows.count(), 3);

  const firstLead = initial.observer.focusLeads[0];
  await rows.first().locator('.observer-leads__inspect').click();
  const inspected = await waitForSnapshot(page, (current, target) => (
    current.interface.selected?.kind === target.kind && current.interface.selected?.id === target.id
  ), firstLead.target);
  assert.equal(inspected.interface.overlay, firstLead.overlay);
  assert.equal(inspected.deterministicWorldHash, initialHash, '查看史家线索不得改写世界哈希');
  await page.locator('.observer-inspector button[aria-label="关闭档案"]').click();
  await panel.waitFor();

  const firstWatch = panel.locator('[data-testid="observer-lead"]').first().locator('.observer-leads__watch');
  await firstWatch.click();
  const watched = await waitForSnapshot(page, (current) => current.observer.watchedCount === 1);
  assert.equal(watched.deterministicWorldHash, initialHash, '关注史家线索不得改写世界哈希');
  assert.equal(await firstWatch.getAttribute('aria-pressed'), 'true');
  await firstWatch.click();
  await waitForSnapshot(page, (current) => current.observer.watchedCount === 0);
  assert.equal((await snapshot(page)).deterministicWorldHash, initialHash);
  await page.locator('.observer-toast').waitFor({ state: 'detached', timeout: 5_000 });
}

async function exerciseMapViewportDesktop(page) {
  const map = page.locator('.world-map');
  const canvas = page.locator('.world-map__canvas');
  const before = await snapshot(page);
  const box = await canvas.boundingBox();
  assert.ok(box);
  const wheelPoint = { x: box.x + box.width * 0.56, y: box.y + box.height * 0.52 };
  await page.mouse.move(wheelPoint.x, wheelPoint.y);
  await page.mouse.wheel(0, -420);
  const nativeWheelObserved = await page.waitForFunction(
    () => Number(document.querySelector('.world-map')?.getAttribute('data-map-zoom')) > 1.05,
    undefined,
    { timeout: 2_000 },
  ).then(() => true).catch(() => false);
  if (!nativeWheelObserved) {
    await canvas.dispatchEvent('wheel', {
      deltaY: -420,
      deltaMode: 0,
      clientX: wheelPoint.x,
      clientY: wheelPoint.y,
      bubbles: true,
      cancelable: true,
    });
    await page.waitForFunction(
      () => Number(document.querySelector('.world-map')?.getAttribute('data-map-zoom')) > 1.05,
      undefined,
      { timeout: 5_000 },
    );
  }
  const zoomed = await snapshot(page);
  assert.ok(zoomed.interface.mapViewport.zoom > 1.05, '桌面滚轮应放大舆图');
  assert.equal(zoomed.deterministicWorldHash, before.deterministicWorldHash, '舆图缩放不得改变世界哈希');
  const selectionBeforeDrag = JSON.stringify(zoomed.interface.selected);
  const panBefore = {
    x: Number(await map.getAttribute('data-map-pan-x')),
    y: Number(await map.getAttribute('data-map-pan-y')),
  };
  await page.mouse.move(box.x + box.width * 0.44, box.y + box.height * 0.62);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.53, box.y + box.height * 0.69, { steps: 6 });
  await page.mouse.up();
  const panAfter = {
    x: Number(await map.getAttribute('data-map-pan-x')),
    y: Number(await map.getAttribute('data-map-pan-y')),
  };
  assert.ok(Math.abs(panAfter.x - panBefore.x) > 2 || Math.abs(panAfter.y - panBefore.y) > 2, '桌面拖动应平移舆图');
  assert.equal(JSON.stringify((await snapshot(page)).interface.selected), selectionBeforeDrag, '拖动舆图不得误选对象');
  await page.locator('[data-map-reset="true"]').click();
  await page.waitForFunction(() => document.querySelector('.world-map')?.getAttribute('data-map-zoom') === '1.000');
  const reset = await snapshot(page);
  assert.deepEqual(reset.interface.mapViewport, { zoom: 1, panX: 0, panY: 0 });
  assert.equal(reset.deterministicWorldHash, before.deterministicWorldHash);
}

async function exerciseMapViewportTouch(context, page) {
  const map = page.locator('.world-map');
  const canvas = page.locator('.world-map__canvas');
  const before = await snapshot(page);
  const controls = page.locator('.world-map__viewport-controls button');
  assert.equal(await controls.count(), 3);
  for (let index = 0; index < await controls.count(); index += 1) {
    const bounds = await controls.nth(index).boundingBox();
    assert.ok(bounds && bounds.width >= 44 && bounds.height >= 44, '移动端舆图缩放按钮至少应为44px');
  }
  const viewportControlsBounds = await page.locator('.world-map__viewport-controls').boundingBox();
  const navigationBounds = await page.locator('.observer-navigation').boundingBox();
  assert.ok(
    viewportControlsBounds && navigationBounds
      && viewportControlsBounds.y + viewportControlsBounds.height <= navigationBounds.y,
    '舆图缩放控件必须位于底部观察坞上方',
  );
  const worldTools = page.locator('.observer-world-tools > button:visible');
  assert.equal(await worldTools.count(), 4, '移动端常驻工具只保留观察、史册、天意和更多');
  for (let index = 0; index < await worldTools.count(); index += 1) {
    const bounds = await worldTools.nth(index).boundingBox();
    assert.ok(bounds && bounds.width >= 44 && bounds.height >= 44, '移动端世界工具至少应为44px');
  }
  await page.locator('.observer-world-tools__more').click();
  const secondaryTools = page.locator('.observer-world-tools__secondary button:visible');
  assert.equal(await secondaryTools.count(), 5, '更多工具应展开五项低频操作');
  for (let index = 0; index < await secondaryTools.count(); index += 1) {
    const bounds = await secondaryTools.nth(index).boundingBox();
    assert.ok(bounds && bounds.width >= 44 && bounds.height >= 44, '展开后的移动端世界工具至少应为44px');
  }
  await page.screenshot({ path: `${ARTIFACT_DIR}/mobile-world-tools-more-390x844.png`, fullPage: true });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.observer-world-tools').getAttribute('data-mobile-more-open'), null, 'Escape 应收起移动端更多工具');
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('observer-world-tools__more')), true, '收起更多工具后应把焦点还给省略号按钮');
  for (const selector of ['.observer-speed-cycle', '.observer-time-controls__toggle', '.observer-advance-button']) {
    const bounds = await page.locator(selector).boundingBox();
    assert.ok(bounds && bounds.width >= 44 && bounds.height >= 44, `${selector} 应提供44px触控目标`);
  }

  await page.locator('.observer-speed-cycle').click();
  const speedChanged = await waitForSnapshot(page, (current) => current.playback.speed === 2);
  assert.equal(speedChanged.deterministicWorldHash, before.deterministicWorldHash, '切换倍速不得推进世界');

  await page.locator('[data-map-zoom-in="true"]').click();
  await page.waitForFunction(() => Number(document.querySelector('.world-map')?.getAttribute('data-map-zoom')) > 1.1);
  const box = await canvas.boundingBox();
  assert.ok(box);
  const cdp = await context.newCDPSession(page);
  const dispatch = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', {
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
  const dragStart = { x: box.x + 72, y: box.y + box.height * 0.62 };
  const dragEnd = { x: dragStart.x + 68, y: dragStart.y + 38 };
  const selectedBeforeDrag = JSON.stringify((await snapshot(page)).interface.selected);
  const panBefore = Number(await map.getAttribute('data-map-pan-x'));
  await dispatch('touchStart', [dragStart]);
  await dispatch('touchMove', [{ x: dragStart.x + 24, y: dragStart.y + 12 }]);
  await dispatch('touchMove', [dragEnd]);
  await dispatch('touchEnd', []);
  await page.waitForTimeout(80);
  assert.notEqual(Number(await map.getAttribute('data-map-pan-x')), panBefore, '单指拖动应平移放大后的舆图');
  assert.equal(JSON.stringify((await snapshot(page)).interface.selected), selectedBeforeDrag, '单指拖动不得误选对象');

  const zoomBeforePinch = Number(await map.getAttribute('data-map-zoom'));
  const midpointY = box.y + box.height * 0.62;
  await dispatch('touchStart', [
    { x: box.x + 112, y: midpointY },
    { x: box.x + 252, y: midpointY },
  ]);
  await dispatch('touchMove', [
    { x: box.x + 78, y: midpointY - 8 },
    { x: box.x + 286, y: midpointY + 8 },
  ]);
  await dispatch('touchEnd', []);
  await page.waitForTimeout(80);
  assert.ok(Number(await map.getAttribute('data-map-zoom')) > zoomBeforePinch, '双指张开应放大舆图');
  assert.equal(JSON.stringify((await snapshot(page)).interface.selected), selectedBeforeDrag, '双指手势不得误选对象');
  assert.equal(await page.evaluate(() => window.visualViewport?.scale ?? 1), 1, '双指只应缩放舆图而非浏览器页面');

  await page.locator('[data-map-reset="true"]').click();
  await page.waitForFunction(() => document.querySelector('.world-map')?.getAttribute('data-map-zoom') === '1.000');
  const reset = await snapshot(page);
  assert.deepEqual(reset.interface.mapViewport, { zoom: 1, panX: 0, panY: 0 });
  assert.equal(reset.deterministicWorldHash, before.deterministicWorldHash);

  const fitScale = Math.min((box.width - 16) / 1000, (box.height - 16) / 700);
  const taiwan = {
    x: box.x + (box.width - 1000 * fitScale) / 2 + 416 * fitScale,
    y: box.y + (box.height - 700 * fitScale) / 2 + 547 * fitScale,
  };
  await page.locator('.observer-world-tools__more').click();
  assert.equal(await page.locator('.observer-world-tools').getAttribute('data-mobile-more-open'), 'true');
  await dispatch('touchStart', [taiwan]);
  await dispatch('touchMove', [{ x: taiwan.x + 10, y: taiwan.y + 3 }]);
  await dispatch('touchEnd', []);
  await page.waitForTimeout(120);
  const touchSelection = (await snapshot(page)).interface.selected;
  assert.equal(touchSelection?.kind, 'army', `100%缩放下轻微手抖仍应点中台湾驻军，实际为 ${touchSelection?.kind ?? 'none'}:${touchSelection?.id ?? 'none'}`);
  assert.equal(touchSelection?.id, 'a_006', `台湾驻军应打开自身档案，而非地域或主帅，实际为 ${touchSelection?.kind ?? 'none'}:${touchSelection?.id ?? 'none'}`);
  assert.equal(await page.locator('.observer-world-tools').getAttribute('data-mobile-more-open'), null, '点选地图对象后应自动收起更多工具');
  const inspectorBounds = await page.locator('.observer-inspector').boundingBox();
  assert.ok(inspectorBounds && inspectorBounds.x >= 0 && inspectorBounds.x + inspectorBounds.width <= 391, '触摸点选后的档案不可横向溢出');
  assert.ok(inspectorBounds && inspectorBounds.height <= 196, '移动端首次点选只应展开地图速览');
  assert.equal(await page.locator('.observer-inspector').getAttribute('data-mobile-expanded'), 'false');
  assert.equal(await page.locator('.observer-navigation').isVisible(), false, '移动端档案打开时应隐藏被遮挡的底部导航');
  const quickLookToggleBounds = await page.locator('.observer-inspector__mobile-toggle button').boundingBox();
  assert.ok(quickLookToggleBounds && quickLookToggleBounds.width >= 44 && quickLookToggleBounds.height >= 44, '移动端档案展开按钮至少应为44px');
  await page.screenshot({ path: `${ARTIFACT_DIR}/mobile-map-quick-look-390x844.png`, fullPage: true });
  await page.locator('.observer-inspector__mobile-toggle button').click();
  await page.waitForFunction(() => document.querySelector('.observer-inspector')?.getAttribute('data-mobile-expanded') === 'true');
  const expandedInspectorBounds = await page.locator('.observer-inspector').boundingBox();
  assert.ok(expandedInspectorBounds && inspectorBounds && expandedInspectorBounds.height > inspectorBounds.height, '点击展开档案后应显示完整移动端卷宗');
  await page.locator('.observer-inspector button[aria-label="关闭档案"]').click();
  await page.locator('.observer-inspector').waitFor({ state: 'detached' });
}

async function selectFirstMapObject(page, expectedKind, expectedDossier) {
  const canvas = page.locator('.world-map__canvas');
  await canvas.focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(
    (kind) => JSON.parse(window.render_game_to_text()).interface.selectedDetail?.kind === kind,
    expectedKind,
  );
  const selected = await snapshot(page);
  assert.equal(selected.interface.selected.kind, expectedKind);
  assert.equal(selected.interface.selectedDetail.kind, expectedKind);
  assert.equal((await page.locator('.observer-inspector__kind').textContent())?.trim(), expectedDossier);
  await page.keyboard.press('Enter');
  const confirmed = await snapshot(page);
  assert.deepEqual(confirmed.interface.selected, selected.interface.selected, '回车确认当前地图对象不得跳到无关地域');
  return selected;
}

async function expandAnyStructuredReference(page) {
  const factors = page.locator('.observer-causal-chain__factor');
  for (let factorIndex = 0; factorIndex < await factors.count(); factorIndex += 1) {
    const evidence = factors.nth(factorIndex).locator('button.observer-causal-chain__evidence');
    if (!(await evidence.count())) continue;
    await evidence.click();
    const references = factors.nth(factorIndex).locator('.observer-causal-chain__references');
    if (await references.count()) return references;
  }
  return null;
}

async function findThreeClickCausalPath(page) {
  const tryEvents = async (events, returnsToHistory = false) => {
    const count = Math.min(await events.count(), 60);
    for (let index = 0; index < count; index += 1) {
      await events.nth(index).click();
      await page.waitForSelector('#observer-causal-drawer');
      const references = await expandAnyStructuredReference(page);
      if (references) return references;
      await page.click('#observer-causal-drawer button[aria-label="关闭因果链"]');
      if (returnsToHistory) await page.waitForSelector('.history-workbench');
    }
    return null;
  };

  let references = await tryEvents(page.locator('[data-testid="quarter-pulse-event"]'));
  if (references) return references;
  await page.click('button[data-history-workbench-trigger="true"]');
  await page.waitForSelector('.history-workbench');
  references = await tryEvents(page.locator('.history-workbench__event-list > li > button'), true);
  assert.ok(references, '至少一条史事应提供可点击的结构化因果凭证');
  return references;
}

async function exerciseObserverDesk(page, initialHash) {
  const inspector = page.locator('.observer-inspector');
  await inspector.waitFor();
  const followButton = inspector.locator('button[aria-label^="关注"]');
  assert.equal(await followButton.count(), 1, '默认州域档案应允许被关注');
  const followedLabel = (await followButton.getAttribute('aria-label')).replace(/^关注/, '');
  await followButton.click();
  await waitForSnapshot(page, (current) => current.observer.watchedCount === 1);
  assert.equal((await snapshot(page)).deterministicWorldHash, initialHash, '关注对象不得改写世界哈希');

  const trigger = page.locator('button[data-observer-desk-trigger="true"]');
  await trigger.click();
  const desk = page.locator('.observer-desk');
  await desk.waitFor();
  assert.equal(await desk.getAttribute('role'), 'dialog');
  assert.equal(await desk.getAttribute('aria-modal'), 'true');
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '关闭观察台');
  assert.match(await desk.textContent(), new RegExp(followedLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.ok(Number(await desk.locator('[role="progressbar"]').getAttribute('aria-valuenow')) >= 2);

  const masterSwitch = desk.locator('.observer-desk__master-switch input');
  assert.equal(await masterSwitch.isChecked(), true);
  await masterSwitch.uncheck();
  assert.equal(await desk.locator('.observer-desk__rules input:not(:disabled)').count(), 0, '总开关关闭后规则应不可编辑');
  await masterSwitch.check();
  const threshold = desk.locator('select[aria-label="重大史事暂停阈值"]');
  await threshold.selectOption('2');
  assert.equal(await threshold.inputValue(), '2');
  assert.ok(await desk.locator('.observer-desk__rules label:has-text("战争") input:checked').count());
  await assertFocusTrapped(page, '.observer-desk');
  await page.screenshot({ path: `${ARTIFACT_DIR}/observer-desk.png`, fullPage: true });
  await page.keyboard.press('Escape');
  await desk.waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-observer-desk-trigger') === 'true');

  const stored = await page.evaluate((label) => Object.keys(localStorage)
    .filter((candidate) => candidate.startsWith('canghai-observer-desk-v1:'))
    .map((key) => JSON.parse(localStorage.getItem(key)))
    .find((settings) => settings.watchlist.some((item) => item.label === label)) ?? null, followedLabel);
  assert.ok(stored, '应按当前世界的关注对象找到观察台存储');
  assert.equal(stored.watchlist.length, 1);
  assert.equal(stored.pauseRules.importanceThreshold, 2);
  return { followedLabel, trigger };
}

async function exerciseAutomaticPause(page) {
  await page.getByRole('button', { name: '8 倍速推演' }).click();
  const speedState = await waitForSnapshot(page, (current) => current.playback.speed === 8);
  assert.equal(speedState.playback.speed, 8);
  assert.equal(await page.getByRole('button', { name: '8 倍速推演' }).getAttribute('aria-pressed'), 'true');

  const turnBefore = speedState.time.turn;
  await page.getByRole('button', { name: '开始自动推演' }).click();
  for (let burst = 0; burst < 10; burst += 1) {
    await page.evaluate(() => window.advanceTime(300));
    await page.waitForTimeout(40);
    const state = await snapshot(page);
    if (state.time.turn > turnBefore && !state.playback.running) break;
  }
  const paused = await snapshot(page);
  assert.ok(paused.time.turn > turnBefore, '自动推演至少应推进一季');
  assert.equal(paused.playback.running, false, '符合规则的史事应暂停自动推演');
  assert.equal(typeof paused.observer.lastPauseReason, 'string');
  assert.ok(paused.observer.lastPauseReason.length > 0);
  assert.ok(paused.observer.guideCompleted >= 3, '推进季度应写入首次试玩进度');

  await page.locator('button[data-observer-desk-trigger="true"]').click();
  const pauseNote = page.locator('.observer-desk__pause-note');
  await pauseNote.waitFor();
  assert.match(await pauseNote.textContent(), /时间已停/);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.observer-desk', { state: 'detached' });
  return paused;
}

async function exerciseHistoryWorkbench(page, current) {
  const hashBefore = current.deterministicWorldHash;
  const trigger = page.locator('button[data-history-workbench-trigger="true"]');
  await trigger.click();
  const workbench = page.locator('.history-workbench');
  await workbench.waitFor();
  assert.equal(await workbench.getAttribute('role'), 'dialog');
  assert.equal(await workbench.getAttribute('aria-modal'), 'true');
  await page.waitForFunction(() => document.activeElement?.matches('.history-workbench input[type="search"]'));
  const opened = await snapshot(page);
  assert.equal(opened.observer.historyWorkbenchOpen, true);
  assert.equal(opened.observer.historicalTurn, null);

  const eventButtons = workbench.locator('.history-workbench__event-list > li > button');
  assert.ok(await eventButtons.count(), '历史工作台应列出已发生史事');
  const firstTitle = (await eventButtons.first().locator('strong').textContent()).trim();
  const search = workbench.locator('input[type="search"]');
  await search.fill(firstTitle);
  await page.waitForFunction((title) => {
    const buttons = [...document.querySelectorAll('.history-workbench__event-list > li > button')];
    return buttons.length > 0 && buttons.every((button) => button.textContent.includes(title));
  }, firstTitle);
  assert.ok(await eventButtons.count());
  await search.fill('');
  await page.waitForFunction(() => document.querySelectorAll('.history-workbench__event-list > li > button').length > 1);

  const targetTurn = Math.max(0, current.time.turn - 2);
  const slider = workbench.locator('input[type="range"][aria-label="选择历史季度"]');
  assert.equal(Number(await slider.getAttribute('max')), current.time.turn);
  await slider.evaluate((element, nextTurn) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(element, String(nextTurn));
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, targetTurn);
  await waitForSnapshot(page, (state, turn) => state.observer.historicalTurn === turn, targetTurn);
  assert.equal(await page.locator('.observer-stage').getAttribute('data-historical-turn'), String(targetTurn));
  assert.equal(await page.locator('.world-map').getAttribute('data-overlay'), 'political');
  assert.equal((await snapshot(page)).deterministicWorldHash, hashBefore, '季度回拨只读，不得改变世界哈希');
  await page.screenshot({ path: `${ARTIFACT_DIR}/history-workbench.png`, fullPage: true });
  await assertFocusTrapped(page, '.history-workbench');
  await workbench.locator('.history-workbench__close').click();
  await workbench.waitFor({ state: 'detached' });
  assert.ok(await page.locator('.observer-history-lens').count(), '关闭史册后应保留只读历史舆图镜片');
  await page.screenshot({ path: `${ARTIFACT_DIR}/historical-map-readonly.png`, fullPage: true });
  assert.equal(await page.getByRole('button', { name: '推进至下一季' }).isDisabled(), true);
  assert.equal((await snapshot(page)).time.turn, current.time.turn);
  assert.equal((await snapshot(page)).deterministicWorldHash, hashBefore);
  await page.locator('.observer-history-lens').getByRole('button', { name: '归还当下' }).click();
  await page.waitForSelector('.observer-history-lens', { state: 'detached' });
  const restored = await waitForSnapshot(page, (state) => state.observer.historicalTurn === null);
  assert.equal(restored.deterministicWorldHash, hashBefore);
  assert.equal(await page.getByRole('button', { name: '推进至下一季' }).isDisabled(), false);
  return restored;
}

async function exerciseWorldCollectionIfAvailable(page) {
  const trigger = page.locator('button[data-world-collection-trigger="true"], button[aria-label^="打开世界收藏"]');
  if (!(await trigger.count())) return { tested: false };

  const savedState = await snapshot(page);
  const savedHash = savedState.deterministicWorldHash;
  await trigger.first().click();
  const panel = page.locator('.world-collection');
  await panel.waitFor();
  await page.waitForFunction(() => document.querySelector('.world-collection')?.getAttribute('aria-busy') === 'false');
  assert.equal(await panel.getAttribute('role'), 'dialog');
  assert.equal(await panel.getAttribute('aria-modal'), 'true');
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '关闭世界收藏');

  const label = `明日试玩本-${savedState.time.turn}`;
  await panel.locator('input[placeholder="例如：北海兴亡录"]').fill(label);
  await panel.getByRole('button', { name: '存入收藏' }).click();
  const rowFor = (name) => panel.getByRole('button', { name: `删除${name}`, exact: true })
    .locator('xpath=ancestor::li[contains(@class,"world-collection__row")]');
  const originalRow = rowFor(label);
  await originalRow.waitFor();
  assert.match(await originalRow.textContent(), new RegExp(savedHash.slice(0, 12)));

  await originalRow.getByRole('button', { name: `修改${label}的名称` }).click();
  const renamed = `${label}·改`;
  await panel.getByRole('textbox', { name: `修改${label}的名称` }).fill(renamed);
  await panel.getByRole('button', { name: '确认改名' }).click();
  const renamedRow = rowFor(renamed);
  await renamedRow.waitFor();

  const namedCountBeforeCopy = await panel.locator('.world-collection__row').count();
  const namesBeforeCopy = await panel.locator('.world-collection__name strong').allTextContents();
  await renamedRow.getByRole('button', { name: `复制${renamed}为新收藏` }).click();
  await page.waitForFunction((before) => document.querySelectorAll('.world-collection__row').length > before, namedCountBeforeCopy);
  const namesAfterCopy = await panel.locator('.world-collection__name strong').allTextContents();
  const duplicateName = namesAfterCopy.find((name) => !namesBeforeCopy.includes(name))?.trim();
  assert.ok(duplicateName);
  await page.screenshot({ path: `${ARTIFACT_DIR}/world-collection.png`, fullPage: true });
  await panel.getByRole('button', { name: '关闭世界收藏' }).click();
  await panel.waitFor({ state: 'detached' });

  const advanced = await advanceOneQuarter(page);
  assert.notEqual(advanced.deterministicWorldHash, savedHash, '推进后当前世界应离开已收藏快照');
  await trigger.first().click();
  await panel.waitFor();
  await page.waitForFunction(() => document.querySelector('.world-collection')?.getAttribute('aria-busy') === 'false');
  const loadRow = rowFor(renamed);
  const loadButton = loadRow.getByRole('button', { name: '读取' });
  assert.equal(await loadButton.isDisabled(), false);
  await loadButton.click();
  await page.waitForSelector('.world-collection', { state: 'detached' });
  const loaded = await waitForSnapshot(page, (state, hash) => state.deterministicWorldHash === hash, savedHash);
  assert.equal(loaded.time.turn, savedState.time.turn);

  await trigger.first().click();
  await panel.waitFor();
  await page.waitForFunction(() => document.querySelector('.world-collection')?.getAttribute('aria-busy') === 'false');
  for (const name of [duplicateName, renamed]) {
    const row = rowFor(name);
    if (!(await row.count())) continue;
    await row.getByRole('button', { name: `删除${name}` }).click();
    await row.getByRole('button', { name: '确认删除' }).click();
    await row.waitFor({ state: 'detached' });
  }
  await panel.getByRole('button', { name: '关闭世界收藏' }).click();
  await panel.waitFor({ state: 'detached' });
  return { tested: true, hash: savedHash };
}

let browser;
try {
  await mkdir(ARTIFACT_DIR, { recursive: true });
  await server.listen();
  browser = await chromium.launch({ headless: true });

  const desktopContext = await browser.newContext({ viewport: { width: 1_280, height: 720 } });
  const page = await desktopContext.newPage();
  const desktopErrors = [];
  collectBrowserErrors(page, desktopErrors);
  await openFreshWorld(page);

  const initialText = await snapshotText(page);
  const initial = JSON.parse(initialText);
  assert.equal(initial.mode, 'observing');
  assert.equal(initial.productVersion, '1.0.0');
  assert.equal(initial.worldSchemaVersion, 4);
  assert.match(initial.mapContentVersion, /^v03/);
  assert.equal(initial.totals.regions, 82);
  assert.equal(initial.totals.seaZones, 10);
  assert.ok(initial.totals.ports > 0);
  assert.ok(initial.totals.fleets > 0);
  assert.ok(initial.totals.livingPolities >= 5);
  assert.ok(initial.totals.livingCharacters > 0 && initial.totals.livingCharacters <= 240);
  assert.ok(initial.totals.families > 0);
  assert.ok(initial.totals.activeOutbreaks > 0);
  assert.ok(initial.totals.population > 0);
  assert.equal(initial.mandate.available, 8);
  assert.equal(initial.mandate.usedThisTurn, false);
  assert.equal(initial.mandate.recentIntervention, null);
  assert.equal(initial.observer.guideCompleted, 1);
  assert.equal(initial.observer.watchedCount, 0);
  assert.equal(initial.observer.primerOpen, true);
  assert.equal(initial.interface.selected, null, '新建世界应先展示完整舆图，不抢先展开地区档案');
  assertRuntimePhase(initial, 'validation.full', '新建世界必须记录全量校验耗时');
  assertRuntimePhase(initial, 'react.commit', '新建世界必须记录 React 提交耗时');
  assertRuntimePhase(initial, 'canvas.draw', '新建世界必须记录 Canvas 绘制耗时');
  assert.ok(Buffer.byteLength(initialText, 'utf8') < SNAPSHOT_LIMIT, '文本观察快照必须小于128KiB');
  const mapTopology = await page.locator('.world-map').evaluate((element) => ({
    layout: element.getAttribute('data-map-layout'),
    landmasses: element.getAttribute('data-landmass-count'),
    islands: element.getAttribute('data-island-shape-count'),
  }));
  assert.deepEqual(mapTopology, {
    layout: 'reference-topology-v3',
    landmasses: '2',
    islands: '6',
  }, '舆图必须使用北陆半岛体系、岭南陆与六岛形的参考拓扑');

  const afterPrimer = await exerciseMapPrimer(page);
  const situationSample = await exerciseSituationSnapshot(desktopContext, {
    seed: '春战副将',
    turn: 8,
    requiredTypes: Object.keys(SITUATION_TYPE_LABELS),
  });
  assert.ok(situationSample.projection.openCount > 0);
  const situationPauseSample = await exerciseSituationWatchAndPause(browser);
  assert.deepEqual(situationPauseSample, {
    seed: SITUATION_WATCH_SEED,
    situationId: SITUATION_WATCH_EXPECTED_ID,
    pauseTurn: SITUATION_WATCH_EXPECTED_PAUSE_TURN,
    trigger: 'phase-change',
  });
  await exerciseMapViewportDesktop(page);
  await exerciseObserverLeads(page, afterPrimer.deterministicWorldHash);
  await page.screenshot({ path: `${ARTIFACT_DIR}/geographic-world-map.png`, fullPage: true });
  await selectFirstMapObject(page, 'region', '地域档案');
  await exerciseObserverDesk(page, afterPrimer.deterministicWorldHash);
  const afterAutomaticPause = await exerciseAutomaticPause(page);
  assert.ok(afterAutomaticPause.time.turn >= 1);
  const pausedAutosave = await waitForLatestAutosave(page, afterAutomaticPause);
  assert.equal(pausedAutosave.schemaVersion, 4, '暂停落盘必须写入 schema 4 世界');

  await auditLayerDialog(page);
  await page.locator('button[data-mandate-trigger="true"]').click();
  await page.getByRole('button', { name: /准备在.+降下一级灾害/ }).click();
  await page.waitForSelector('.mandate-panel__confirmation');
  assert.ok(await page.getByRole('button', { name: /确认在.+降下一级灾害/ }).count(), '灾害必须经过第二次确认');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.mandate-panel__confirmation', { state: 'detached' });
  assert.ok(await page.locator('.mandate-panel').count(), '首次 Esc 只应撤销灾害确认');
  await page.locator('.mandate-panel button[aria-label="关闭天意"]').click();
  const politicalPixels = await page.locator('.world-map__canvas').evaluate((canvas) => canvas.toDataURL());
  await selectLayer(page, 'naval');
  const navalPixels = await page.locator('.world-map__canvas').evaluate((canvas) => canvas.toDataURL());
  assert.notEqual(politicalPixels, navalPixels, '疆界与海权叠层应绘出不同画面');
  await selectFirstMapObject(page, 'seaZone', '海域档案');

  await page.click('button[data-observer-view="military"]');
  const militaryRoster = page.locator('.roster-panel[data-roster-title="天下军旅"]');
  await militaryRoster.waitFor();
  const fleetId = initial.mapObjects.fleets[0].id;
  await militaryRoster.locator(`[data-roster-id="${fleetId}"]`).click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).interface.selectedDetail?.kind === 'fleet');
  assert.equal((await page.locator('.observer-inspector__kind').textContent())?.trim(), '舰队档案');

  await page.click('button[data-observer-view="polities"]');
  await page.waitForSelector('.roster-panel[data-roster-title="天下列国"]');
  await page.locator('.roster-panel button[data-roster-id]').first().click();
  const beforeIntervention = await snapshot(page);
  const legitimacyBefore = beforeIntervention.interface.selectedDetail.legitimacy;
  const hashBeforeIntervention = beforeIntervention.deterministicWorldHash;
  const mandateTrigger = page.locator('button[data-mandate-trigger="true"]');
  await mandateTrigger.click();
  await page.waitForSelector('.mandate-panel[role="dialog"]');
  assert.equal(await page.locator('.observer-app').evaluate((element) => element.inert), true);
  assert.match(await page.locator('.mandate-panel__ledger').textContent(), /8点可用天命/);
  await page.getByRole('button', { name: /提升.+合法性3点/ }).click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).mandate.usedThisTurn === true);
  const afterIntervention = await snapshot(page);
  assert.notEqual(afterIntervention.deterministicWorldHash, hashBeforeIntervention, '有限干预必须形成新的确定性世界分支');
  assert.equal(afterIntervention.interface.selectedDetail.legitimacy, legitimacyBefore + 3);
  assert.equal(afterIntervention.mandate.available, 0);
  assert.equal(afterIntervention.mandate.recentIntervention.kind, 'observer_intervention_modify_mandate');
  assert.match(afterIntervention.mandate.recentIntervention.costEvidence, /消耗2点/);
  assert.equal(afterIntervention.recentHistory.at(-1).title, afterIntervention.mandate.recentIntervention.title);
  await page.waitForSelector('.mandate-panel__message[data-tone="success"]');
  assert.equal(await page.getByRole('button', { name: /提升.+合法性3点/ }).isDisabled(), true);
  await page.locator('.mandate-panel button[aria-label="关闭天意"]').click();
  await page.waitForSelector('.mandate-panel', { state: 'detached' });
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-mandate-trigger')), 'true');
  await mandateTrigger.click();
  assert.match(await page.locator('.mandate-panel__ledger').textContent(), /本季已经落笔/);
  assert.equal(await page.getByRole('button', { name: /降低.+合法性3点/ }).isDisabled(), true);
  await page.locator('.mandate-panel button[aria-label="关闭天意"]').click();
  await page.click('button[data-observer-view="world"]');

  const afterCooldown = await advanceOneQuarter(page);
  assert.equal(afterCooldown.mandate.available, 6);
  assert.equal(afterCooldown.mandate.usedThisTurn, false);
  const afterManual = await advanceTo(page, 4);
  assert.equal(afterManual.time.turn, 4);
  for (const phase of [
    'simulation.clone',
    'simulation.systems',
    'simulation.hash',
    'simulation.total',
    'validation.runtime',
    'react.commit',
    'canvas.draw',
  ]) assertRuntimePhase(afterManual, phase, `推进季度后必须记录 ${phase}`);
  assert.equal(
    afterManual.lastTurnLedger.population.end,
    afterManual.lastTurnLedger.population.start
      + afterManual.lastTurnLedger.population.births
      - afterManual.lastTurnLedger.population.civilianDeaths
      - afterManual.lastTurnLedger.population.militaryDeaths,
    '人口账本必须守恒闭合',
  );
  assert.ok(afterManual.totals.activeTradeCorridors > 0);
  assert.ok(afterManual.lastTurnLedger.trade.shipments > 0);
  assert.ok(afterManual.lastTurnLedger.migration.departed > 0);
  assert.ok(afterManual.lastTurnLedger.health.infectiousEnd >= 0);
  assert.ok(Array.isArray(afterManual.lastTurnLedger.knowledge.prototypeIds));
  assert.ok(Array.isArray(afterManual.lastTurnLedger.maritime.fleetIds));
  assert.ok(afterManual.lastTurnLedger.logistics.seaUsage > 0);
  const quarterPulse = page.locator('[data-testid="quarter-pulse"]');
  assert.equal(await quarterPulse.getAttribute('data-turn'), String(afterManual.lastTurnLedger.turn));
  const quarterEventIds = await quarterPulse.locator('[data-testid="quarter-pulse-event"]').evaluateAll((nodes) => (
    nodes.map((node) => node.getAttribute('data-event-id'))
  ));
  assert.ok(quarterEventIds.length <= 3);
  assert.ok(quarterEventIds.every((eventId) => afterManual.lastTurnLedger.eventIds.includes(eventId)), '季报不得混入旧史');
  assert.ok(Number(await page.locator('.world-map').getAttribute('data-highlighted-region-count')) > 0, '本季相关地区应在舆图上保留低调高亮');
  const formatSigned = (value) => {
    const rounded = Math.round(value);
    const digits = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(Math.abs(rounded));
    return rounded > 0 ? `+${digits}` : rounded < 0 ? `−${digits}` : '±0';
  };
  const populationNet = afterManual.lastTurnLedger.population.end - afterManual.lastTurnLedger.population.start;
  assert.match(await quarterPulse.locator('[data-testid="quarter-pulse-ledger-population"]').textContent(), new RegExp(formatSigned(populationNet).replace('+', '\\+')));
  await quarterPulse.locator('[data-testid="quarter-pulse-ledger-population"]').click();
  await page.waitForSelector('#observer-causal-drawer');
  assert.equal((await snapshot(page)).interface.overlay, 'population');
  await page.locator('#observer-causal-drawer button[aria-label="关闭因果链"]').click();
  await page.waitForSelector('#observer-causal-drawer', { state: 'detached' });
  let hashBeforeBrowsing = afterManual.deterministicWorldHash;

  const afterHistoryBrowse = await exerciseHistoryWorkbench(page, afterManual);
  assert.equal(afterHistoryBrowse.deterministicWorldHash, hashBeforeBrowsing);

  await selectLayer(page, 'trade');
  assert.ok((await snapshot(page)).interface.topFlows.length > 0);
  await selectFirstMapObject(page, 'tradeCorridor', '商路档案');

  await selectLayer(page, 'migration');
  assert.ok((await snapshot(page)).interface.topFlows.length > 0);
  await selectFirstMapObject(page, 'migration', '迁徙档案');

  await selectLayer(page, 'disease');
  await selectFirstMapObject(page, 'outbreak', '疫病档案');

  await selectLayer(page, 'knowledge');
  await selectFirstMapObject(page, 'practice', '知识档案');

  await selectLayer(page, 'food');
  assert.equal(await page.locator('.world-map').getAttribute('data-overlay'), 'food');
  await selectLayer(page, 'population');
  await selectLayer(page, 'war');
  await selectFirstMapObject(page, 'army', '军团档案');

  const references = await findThreeClickCausalPath(page);
  assert.ok(await references.locator('button').count());
  await references.locator('button').first().click();
  await page.waitForSelector('#observer-causal-drawer', { state: 'detached' });
  const causalTarget = await snapshot(page);
  assert.ok(['region', 'country', 'family', 'person', 'seaZone', 'fleet', 'tradeCorridor', 'practice', 'outbreak', 'migration'].includes(causalTarget.interface.selectedDetail.kind));

  await page.click('button[data-observer-view="polities"]');
  await page.waitForSelector('.roster-panel[data-roster-title="天下列国"]');
  await page.locator('.roster-panel button[data-roster-id]').first().click();
  await page.getByRole('tab', { name: '海贸' }).click();
  const selectedCountry = await snapshot(page);
  assert.equal(selectedCountry.interface.selectedDetail.kind, 'country');
  assert.equal(typeof selectedCountry.interface.selectedDetail.tradeRevenue, 'number');
  assert.ok(Array.isArray(selectedCountry.interface.selectedDetail.maritimeAssets.fleets));

  await page.click('button[data-observer-view="families"]');
  await page.waitForSelector('.roster-panel[data-roster-title="天下世家"]');
  await page.locator('.roster-panel button[data-roster-id]').first().click();
  const selectedFamily = await snapshot(page);
  assert.equal(selectedFamily.interface.selectedDetail.kind, 'family');
  assert.ok(selectedFamily.interface.selectedDetail.members.length > 0);
  assert.ok(selectedFamily.visibleFamilies.length > 0);

  await page.click('button[data-observer-view="world"]');
  const commandWorld = await advanceTo(page, 8);
  hashBeforeBrowsing = commandWorld.deterministicWorldHash;
  await page.click('button[data-observer-view="people"]');
  await page.waitForSelector('.roster-panel[data-roster-title="时人群像"]');
  const personRows = page.locator('.roster-panel button[data-roster-id]');
  await personRows.first().click();
  let selectedPerson = await snapshot(page);
  for (let index = 1; !selectedPerson.interface.selectedDetail.relationships?.length && index < Math.min(20, await personRows.count()); index += 1) {
    await personRows.nth(index).click();
    selectedPerson = await snapshot(page);
  }
  assert.equal(selectedPerson.interface.selectedDetail.kind, 'person');
  assert.ok(selectedPerson.interface.selectedDetail.biography.length > 0);
  assert.ok(selectedPerson.interface.selectedDetail.relationships?.length > 0, '人物名录中应有可观察的关系网络');
  const relationshipPersonId = selectedPerson.interface.selected.id;
  const commandPerson = selectedPerson.interface.selectedDetail.agency?.commandRequest
    ? selectedPerson
    : await selectPersonWithCommandRequest(page, personRows);
  assert.ok(commandPerson, '人物名录中应有由 C10 接管的副将请令计划');
  const personAgency = commandPerson.interface.selectedDetail.agency;
  assert.equal(personAgency.availability, 'active');
  assert.equal(personAgency.desires.length, 2, '人物速览只展示两项长期所重');
  assert.ok(personAgency.primaryGoal?.label, '成年人物必须给出一项眼下所图');
  assert.ok(personAgency.secondaryGoals.length <= 2, '次要打算不得超过两项');
  assert.ok(personAgency.currentPlanSteps.length <= 5, '准备路径不得超过五步');
  assert.ok(Array.isArray(personAgency.memories) && personAgency.memories.length <= 16, '人物心事必须来自有界记忆账');
  assert.ok(['planned', 'preparing', 'submitted', 'approved', 'blocked'].includes(personAgency.commandRequest.stage));
  assert.ok(personAgency.commandRequest.evidence.length <= 3, '请令进展最多显示三条有利或掣肘');
  assert.equal(personAgency.quarterChoice, null, 'C10 接管请令链后不得再显示 C09 同链对照');
  assert.equal(selectedPerson.observer.agencyContinuity?.matchesWorld, true, '人物观察账必须与当前世界锚点相合');
  assert.ok(selectedPerson.observer.agencyContinuity?.trackedCharacters <= 16, '人物观察账不得无界追踪人物');
  const agencyHash = selectedPerson.deterministicWorldHash;
  await page.getByRole('tab', { name: '所图' }).click();
  const agencyPanel = page.getByRole('tabpanel');
  const agencyTab = page.getByRole('tab', { name: '所图' });
  assert.equal(await agencyTab.getAttribute('aria-controls'), await agencyPanel.getAttribute('id'));
  assert.equal(await agencyPanel.getAttribute('aria-labelledby'), await agencyTab.getAttribute('id'));
  await agencyPanel.getByRole('heading', { name: '此人所重' }).waitFor();
  await agencyPanel.getByRole('heading', { name: '放在心上的事' }).waitFor();
  assert.match(await agencyPanel.textContent(), /眼下所图/);
  assert.match(await agencyPanel.textContent(), /所行之路/);
  const commandRequest = agencyPanel.locator('[data-testid="person-command-request"]');
  await commandRequest.waitFor();
  assert.equal(await commandRequest.getAttribute('data-stage'), personAgency.commandRequest.stage);
  assert.match(await commandRequest.textContent(), new RegExp(personAgency.commandRequest.statusLabel));
  assert.ok(await commandRequest.locator('[data-tone]').count() <= 3);
  assert.doesNotMatch(await agencyPanel.textContent(), /Goal|Plan|Shadow|Simulation Audit|Intent|Resolver|request_independent_command|decisionScore|decisionThreshold/);
  await waitForVisualSettled(page.locator('.observer-inspector'));
  await page.screenshot({ path: `${ARTIFACT_DIR}/person-agency.png`, fullPage: true });
  if (personAgency.commandRequest.sourceEventId) {
    const source = commandRequest.locator('.observer-agency-command__source');
    await source.click();
    await page.waitForSelector('#observer-causal-drawer');
    assert.equal((await snapshot(page)).interface.selectedEventId, personAgency.commandRequest.sourceEventId);
    await page.locator('#observer-causal-drawer button[aria-label="关闭因果链"]').click();
    await page.waitForSelector('#observer-causal-drawer', { state: 'detached' });
  }
  await agencyPanel.getByRole('heading', { name: '最近取舍' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${ARTIFACT_DIR}/person-agency-plan.png`, fullPage: true });
  assert.equal((await snapshot(page)).deterministicWorldHash, agencyHash, '查看人物所图不得改变世界哈希');
  if (commandPerson.interface.selected.id !== relationshipPersonId) {
    await page.locator(`.roster-panel button[data-roster-id="${relationshipPersonId}"]`).click();
    await waitForSnapshot(page, (state, id) => (
      state.interface.selected?.kind === 'person' && state.interface.selected.id === id
    ), relationshipPersonId);
  }
  await page.getByRole('tab', { name: '关系' }).click();
  const relationshipMap = page.locator('.observer-relationship-map');
  await relationshipMap.waitFor();
  const relationshipNodes = relationshipMap.locator('[role="button"]');
  assert.ok(await relationshipNodes.count(), '人物关系星图应提供可键盘操作的相关人物');
  const relationshipHash = selectedPerson.deterministicWorldHash;
  const relationshipSourceId = selectedPerson.interface.selected.id;
  await relationshipNodes.first().focus();
  await page.screenshot({ path: `${ARTIFACT_DIR}/relationship-constellation.png`, fullPage: true });
  await page.keyboard.press('Enter');
  const relatedPerson = await waitForSnapshot(page, (state, sourceId) => (
    state.interface.selected?.kind === 'person' && state.interface.selected.id !== sourceId
  ), relationshipSourceId);
  assert.equal(relatedPerson.deterministicWorldHash, relationshipHash, '关系星图跳转不得改变世界哈希');
  assert.equal(relatedPerson.observer.agencyContinuity?.matchesWorld, true, '跳转人物后观察账仍须锚定当前世界');
  const continuityPersonId = relatedPerson.interface.selected.id;
  const continuityGoalId = relatedPerson.interface.selectedDetail.agency.primaryGoal?.id ?? null;

  const observedText = await snapshotText(page);
  const observed = JSON.parse(observedText);
  assert.equal(observed.deterministicWorldHash, hashBeforeBrowsing, '纯观察操作不应改变世界哈希');
  assert.equal(observed.observer.guideCompleted, 5, '首次试玩的五项真实操作应全部完成');
  assert.ok(Buffer.byteLength(observedText, 'utf8') < SNAPSHOT_LIMIT, '对象档案展开后文本快照仍须小于128KiB');

  await page.locator('button[data-observer-desk-trigger="true"]').click();
  const completedGuide = page.locator('.observer-desk [role="progressbar"]');
  await completedGuide.waitFor();
  assert.equal(await completedGuide.getAttribute('aria-valuenow'), '5');
  assert.match(await page.locator('.observer-desk__guide footer').textContent(), /已掌握观察世界的基本方法/);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.observer-desk', { state: 'detached' });

  const collectionResult = await exerciseWorldCollectionIfAvailable(page);
  if (collectionResult.tested) {
    assert.equal((await snapshot(page)).deterministicWorldHash, hashBeforeBrowsing, '读取收藏应恢复已命名分支');
  }

  await page.click('button[aria-label="保存当前世界"]');
  await page.waitForTimeout(500);
  const afterSave = await snapshot(page);
  assertRuntimePhase(afterSave, 'validation.full', '手动保存必须执行全量校验');
  assertRuntimePhase(afterSave, 'persistence.serialize', '手动保存必须记录序列化耗时');
  assertRuntimePhase(afterSave, 'persistence.indexeddb', '手动保存必须记录 IndexedDB 写入耗时');
  await page.click('button[aria-label="返回世界书页"]');
  await page.waitForSelector('#continue-world');
  assert.equal(await page.locator('.observer-app').evaluate((element) => element.inert), true);
  await page.click('#continue-world');
  await page.waitForSelector('.world-map__canvas');
  const reloaded = await snapshot(page);
  assert.equal(reloaded.productVersion, '1.0.0');
  assert.equal(reloaded.worldSchemaVersion, 4);
  assert.equal(reloaded.observer.primerOpen, false, '续读不应重复弹出首次读图导览');
  assert.equal(reloaded.deterministicWorldHash, hashBeforeBrowsing, 'Schema 4存档续读应恢复完全相同的世界');
  assert.equal(reloaded.observer.agencyContinuity?.matchesWorld, true, '续读必须恢复与存档精确相合的人物观察账');
  await page.click('button[data-observer-view="people"]');
  await page.waitForSelector('.roster-panel[data-roster-title="时人群像"]');
  await page.locator(`.roster-panel button[data-roster-id="${continuityPersonId}"]`).click();
  const continuityReloaded = await waitForSnapshot(
    page,
    (state, id) => state.interface.selected?.kind === 'person' && state.interface.selected.id === id,
    continuityPersonId,
  );
  assert.equal(
    continuityReloaded.interface.selectedDetail.agency.primaryGoal?.id ?? null,
    continuityGoalId,
    '同一存档中的人物盘算身份应跨续读保持连续',
  );
  assert.equal(continuityReloaded.deterministicWorldHash, hashBeforeBrowsing, '核对人物续读不得改变世界哈希');
  assert.deepEqual(desktopErrors, []);

  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
  });
  const mobilePage = await mobileContext.newPage();
  const mobileErrors = [];
  collectBrowserErrors(mobilePage, mobileErrors);
  await openFreshWorld(mobilePage, '春战副将');
  assert.equal((await snapshot(mobilePage)).productVersion, '1.0.0');
  assert.equal((await snapshot(mobilePage)).observer.primerOpen, true);
  const mobilePrimer = mobilePage.locator('.map-primer');
  await mobilePrimer.waitFor();
  await assertWithinViewport(mobilePage, '.map-primer', '移动端读图导览不可横向溢出');
  await waitForVisualSettled(mobilePrimer);
  await mobilePage.screenshot({ path: `${ARTIFACT_DIR}/mobile-map-primer-390x844.png`, fullPage: true });
  await mobilePrimer.locator('[data-map-primer-skip]').click();
  await mobilePrimer.waitFor({ state: 'detached' });
  const mobileTurn0 = await snapshot(mobilePage);
  assert.equal(mobileTurn0.observer.primerOpen, false);
  assertObserverLeadMilestone(mobileTurn0, {
    person: 'fallback',
    polity: 'fallback',
    tension: 'fallback',
  }, '移动端 T0');
  assert.equal(await mobilePage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
  const mobileMapLayout = await mobilePage.evaluate(() => {
    const stage = document.querySelector('.observer-stage')?.getBoundingClientRect();
    const map = document.querySelector('.world-map')?.getBoundingClientRect();
    const dock = document.querySelector('.observer-navigation')?.getBoundingClientRect();
    return {
      stageWidth: stage?.width ?? 0,
      mapWidth: map?.width ?? 0,
      dockWidth: dock?.width ?? 0,
      mapLayout: document.querySelector('.world-map')?.getAttribute('data-map-layout'),
    };
  });
  assert.ok(mobileMapLayout.stageWidth >= 389 && mobileMapLayout.mapWidth >= 389, '移动端舆图必须使用完整视口宽度');
  assert.ok(mobileMapLayout.dockWidth >= 370, '移动端观察导航应成为全宽底部观察坞');
  assert.equal(mobileMapLayout.mapLayout, 'reference-topology-v3');
  const mobileLeads = mobilePage.locator('[data-observer-leads="true"]');
  await mobileLeads.waitFor();
  await assertWithinViewport(mobilePage, '[data-observer-leads="true"]', '移动端史家线索不可横向溢出');
  assert.equal(await mobileLeads.locator('[data-testid="observer-lead"]:visible').count(), 0, '移动端默认只显示紧凑线索条，避免遮挡舆图');
  await mobilePage.screenshot({ path: `${ARTIFACT_DIR}/mobile-world-map-390x844.png`, fullPage: true });
  await mobileLeads.locator('.observer-leads__mobile-toggle').click();
  assert.equal(await mobileLeads.locator('[data-testid="observer-lead"]:visible').count(), 1, '移动端可展开第一条线索');
  await mobileLeads.locator('.observer-leads__mobile-toggle').click();
  assert.equal(await mobileLeads.locator('[data-testid="observer-lead"]:visible').count(), 3, '移动端可展开全部三条线索');
  await mobileLeads.locator('.observer-leads__mobile-toggle').click();
  await exerciseMapViewportTouch(mobileContext, mobilePage);

  const mobileTurn4 = await advanceTo(mobilePage, 4);
  assertObserverLeadMilestone(mobileTurn4, {
    person: 'fallback',
    polity: 'fallback',
    tension: 'situation',
  }, '移动端 T4');
  const mobileTurn6 = await advanceTo(mobilePage, 6);
  assertObserverLeadMilestone(mobileTurn6, {
    person: 'situation',
    polity: 'situation',
    tension: 'situation',
  }, '移动端 T6');
  const mobileTurn6Identity = observerLeadIdentity(mobileTurn6);
  const mobileSituationState = await advanceTo(mobilePage, 8);
  assertObserverLeadMilestone(mobileSituationState, {
    person: 'situation',
    polity: 'situation',
    tension: 'situation',
  }, '移动端 T8');
  assert.deepEqual(observerLeadIdentity(mobileSituationState), mobileTurn6Identity, '移动端 T6→T8 应稳定追踪同三条 Situation');
  const mobileTurn8Layout = await mobilePage.evaluate(() => {
    const app = document.querySelector('.observer-app');
    const stage = document.querySelector('.observer-stage')?.getBoundingClientRect();
    return {
      appScrollLeft: app?.scrollLeft ?? -1,
      appScrollWidth: app?.scrollWidth ?? -1,
      appClientWidth: app?.clientWidth ?? -1,
      stageLeft: stage?.left ?? -1,
      stageRight: stage?.right ?? -1,
      viewportWidth: window.innerWidth,
    };
  });
  assert.equal(mobileTurn8Layout.appScrollLeft, 0, '移动端连续推进到 T8 不得使观察台横向滚动');
  assert.ok(
    mobileTurn8Layout.appScrollWidth <= mobileTurn8Layout.appClientWidth,
    '隐藏的季度提示不得撑宽移动端观察台',
  );
  assert.ok(
    mobileTurn8Layout.stageLeft >= 0 && mobileTurn8Layout.stageRight <= mobileTurn8Layout.viewportWidth + 1,
    '移动端 T8 世界舞台必须仍完整覆盖视口',
  );
  await mobilePage.click('button[data-observer-view="people"]');
  await mobilePage.waitForSelector('.roster-panel[data-roster-title="时人群像"]');
  const mobilePersonRows = mobilePage.locator('.roster-panel button[data-roster-id]');
  const mobilePerson = await selectPersonWithCommandRequest(mobilePage, mobilePersonRows);
  assert.ok(mobilePerson, '移动端人物名录中应能找到副将请令计划');
  assert.equal(mobilePerson.interface.selectedDetail.kind, 'person');
  assert.equal(mobilePerson.interface.selectedDetail.agency.desires.length, 2);
  assert.ok(mobilePerson.interface.selectedDetail.agency.primaryGoal?.label);
  assert.ok(mobilePerson.interface.selectedDetail.agency.commandRequest);
  const quickMind = mobilePage.getByRole('button', { name: /看所图/ });
  const quickMindBounds = await quickMind.boundingBox();
  assert.ok(quickMindBounds && quickMindBounds.height >= 44, '移动端“看所图”触控高度不得小于44px');
  await quickMind.click();
  await mobilePage.waitForFunction(() => document.querySelector('.observer-inspector')?.getAttribute('data-mobile-expanded') === 'true');
  const mobileAgency = mobilePage.getByRole('tabpanel');
  await mobileAgency.getByRole('heading', { name: '放在心上的事' }).waitFor();
  await mobileAgency.getByRole('heading', { name: '眼下所图' }).waitFor();
  const mobileCommand = mobileAgency.locator('[data-testid="person-command-request"]');
  await mobileCommand.waitFor();
  assert.equal(
    await mobileCommand.getAttribute('data-stage'),
    mobilePerson.interface.selectedDetail.agency.commandRequest.stage,
  );
  assert.ok(await mobileCommand.locator('[data-tone]').count() <= 3);
  await assertWithinViewport(mobilePage, '.observer-inspector', '移动端人物所图不可横向溢出');
  const mobileAgencyTabs = mobilePage.locator('.observer-inspector-tabs button');
  for (let index = 0; index < await mobileAgencyTabs.count(); index += 1) {
    const bounds = await mobileAgencyTabs.nth(index).boundingBox();
    assert.ok(bounds && bounds.height >= 44, '移动端人物档案页签触控高度不得小于44px');
  }
  const mobileCommandSource = mobileCommand.locator('.observer-agency-command__source');
  if (await mobileCommandSource.count()) {
    const bounds = await mobileCommandSource.boundingBox();
    assert.ok(bounds && bounds.height >= 44, '移动端请令原事入口触控高度不得小于44px');
  }
  await waitForVisualSettled(mobilePage.locator('.observer-inspector'));
  await mobilePage.screenshot({ path: `${ARTIFACT_DIR}/mobile-person-agency-390x844.png`, fullPage: true });
  await mobileAgency.getByRole('heading', { name: '最近取舍' }).scrollIntoViewIfNeeded();
  await mobilePage.screenshot({ path: `${ARTIFACT_DIR}/mobile-person-agency-plan-390x844.png`, fullPage: true });
  assert.equal((await snapshot(mobilePage)).deterministicWorldHash, mobileSituationState.deterministicWorldHash, '移动端查看人物所图不得改变世界哈希');
  await mobilePage.locator('.observer-inspector button[aria-label="关闭档案"]').click();
  await mobilePage.waitForSelector('.observer-inspector', { state: 'detached' });
  await mobilePage.click('button[data-observer-view="world"]');
  const mobileSituationTrigger = mobileLeads.locator('.observer-leads__situation-shortcut');
  await mobileSituationTrigger.waitFor();
  assert.equal(await mobileSituationTrigger.isVisible(), true, '移动端紧凑线索条必须直接提供局势卷宗入口');
  await mobileLeads.locator('.observer-leads__mobile-toggle').click();
  assert.equal(await mobileLeads.locator('[data-testid="observer-lead"]:visible').count(), 1, '移动端 T8 应可单独展开首条 Situation 题');
  const mobileLead = mobileSituationState.observer.focusLeads[0];
  const mobileLeadRow = mobileLeads.locator(`[data-testid="observer-lead"][data-situation-id="${mobileLead.situationId}"]`);
  await mobileLeadRow.waitFor();
  await waitForVisualSettled(mobileLeads);
  await mobilePage.screenshot({ path: `${ARTIFACT_DIR}/mobile-situation-backed-lead-390x844.png`, fullPage: true });
  const mobileWatchButton = mobileLeadRow.locator('[data-testid="observer-lead-watch"]');
  await mobileWatchButton.waitFor();
  await mobileWatchButton.scrollIntoViewIfNeeded();
  assert.equal(await mobileWatchButton.getAttribute('data-watch-kind'), 'situation');
  assert.equal(await mobileWatchButton.getAttribute('data-watch-key'), `situation:${mobileLead.situationId}`);
  await assertUnobstructedTapTarget(mobileWatchButton, '移动端局势关注按钮');
  await mobileWatchButton.click();
  const mobileWatched = await waitForSnapshot(mobilePage, (current) => current.observer.watchedCount === 1);
  assert.equal(mobileWatched.deterministicWorldHash, mobileSituationState.deterministicWorldHash, '移动端关注局势不得改写世界');
  await mobilePage.waitForFunction(({ seed, situationId }) => {
    const raw = localStorage.getItem(`canghai-observer-desk-v1:${encodeURIComponent(seed)}`);
    if (!raw) return false;
    return JSON.parse(raw).watchlist?.some((item) => item.kind === 'situation' && item.id === situationId);
  }, { seed: SITUATION_WATCH_SEED, situationId: mobileLead.situationId });
  await mobileLeadRow.locator('.observer-leads__inspect').click();
  const mobileSituation = mobilePage.locator('.situation-workbench');
  await mobileSituation.waitFor();
  const mobileLeadOpened = await snapshot(mobilePage);
  assert.equal(mobileLeadOpened.observer.selectedSituationId, mobileLead.situationId, '移动端局势卡片应直达对应卷宗');
  assert.equal(mobileLeadOpened.observer.selectedSituation?.id, mobileLead.situationId, '移动端卷宗正文应保留稳定 Situation ID');
  assert.equal(mobileLeadOpened.deterministicWorldHash, mobileSituationState.deterministicWorldHash, '移动端从卡片阅卷不得改变世界哈希');
  await assertWithinViewport(mobilePage, '.situation-workbench', '移动端局势全卷不可横向溢出');
  assert.equal(await mobileSituation.evaluate((element) => Math.round(element.getBoundingClientRect().height)), 844, '移动端局势全卷应占满100dvh');
  await waitForVisualSettled(mobileSituation);
  for (const locator of [
    mobileSituation.locator('.situation-workbench__close'),
    mobileSituation.locator('.situation-workbench__directory-toggle'),
    mobileSituation.locator('.situation-workbench__evidence > summary'),
    mobileSituation.locator('.situation-workbench__audit > summary'),
  ]) {
    const bounds = await locator.boundingBox();
    assert.ok(bounds && bounds.height >= 44 && bounds.width >= 44, '移动端局势操作目标不得小于44px');
  }
  await mobilePage.screenshot({ path: `${ARTIFACT_DIR}/mobile-situation-workbench-390x844.png`, fullPage: true });
  await mobileSituation.locator('.situation-workbench__directory-toggle').click();
  const mobileSituationRows = mobileSituation.locator('.situation-workbench__directory li > button');
  assert.ok(await mobileSituationRows.count() >= 3, '移动端局势目录应能切换三类真实故事');
  await mobileSituationRows.nth(1).click();
  assert.equal(await mobileSituation.locator('.situation-workbench__directory').isVisible(), false, '移动端选择局势后应回到正文');
  assert.equal((await snapshot(mobilePage)).deterministicWorldHash, mobileSituationState.deterministicWorldHash, '移动端阅卷不得改变世界哈希');
  await mobilePage.keyboard.press('Escape');
  await mobileSituation.waitFor({ state: 'detached' });
  await mobilePage.waitForFunction(() => !document.querySelector('.observer-app')?.inert);
  const mobileLeadInspectorClose = mobilePage.locator('.observer-inspector button[aria-label="关闭档案"]');
  if (await mobileLeadInspectorClose.isVisible().catch(() => false)) {
    await mobileLeadInspectorClose.click();
    await mobilePage.waitForSelector('.observer-inspector', { state: 'detached' });
  }

  await mobilePage.locator('button[data-observer-desk-trigger="true"]').click();
  const mobileObserverDesk = mobilePage.locator('.observer-desk');
  await mobileObserverDesk.waitFor();
  await assertWithinViewport(mobilePage, '.observer-desk', '移动端观察台不可横向溢出');
  const mobileWatchRow = mobileObserverDesk.locator(
    `[data-testid="observer-watch-item"][data-watch-kind="situation"][data-watch-id="${mobileLead.situationId}"]`,
  );
  assert.equal(await mobileWatchRow.count(), 1, '移动端观察台应显示真实 Situation 关注项');
  const mobileWatchOpen = mobileWatchRow.locator('[data-testid="observer-watch-open"]');
  const mobileWatchRemove = mobileWatchRow.locator('[data-testid="observer-watch-remove"]');
  const mobileSituationRule = mobileObserverDesk.locator('[data-pause-rule="situationChanges"]');
  for (const [locator, label] of [
    [mobileWatchOpen, '移动端局势关注项'],
    [mobileWatchRemove, '移动端取消局势关注'],
    [mobileSituationRule, '移动端局势里程碑规则'],
  ]) {
    await locator.scrollIntoViewIfNeeded();
    await assertUnobstructedTapTarget(locator, label);
  }
  await waitForVisualSettled(mobileObserverDesk);
  await mobilePage.screenshot({ path: `${ARTIFACT_DIR}/mobile-observer-desk-390x844.png`, fullPage: true });
  await mobileWatchOpen.click();
  await mobileObserverDesk.waitFor({ state: 'detached' });
  await mobilePage.waitForSelector('.situation-workbench');
  const mobileWatchOpened = await snapshot(mobilePage);
  assert.equal(mobileWatchOpened.observer.selectedSituationId, mobileLead.situationId, '移动端观察台关注项应直达同一局势');
  assert.equal(mobileWatchOpened.observer.selectedSituation?.id, mobileLead.situationId);
  assert.equal(mobileWatchOpened.deterministicWorldHash, mobileSituationState.deterministicWorldHash);
  await mobilePage.locator('.situation-workbench__close').click();
  await mobilePage.waitForSelector('.situation-workbench', { state: 'detached' });

  await mobilePage.locator('button[data-history-workbench-trigger="true"]').click();
  const mobileHistory = mobilePage.locator('.history-workbench');
  await mobileHistory.waitFor();
  await assertWithinViewport(mobilePage, '.history-workbench', '移动端历史工作台不可横向溢出');
  await waitForVisualSettled(mobileHistory);
  await mobilePage.screenshot({ path: `${ARTIFACT_DIR}/mobile-history-390x844.png`, fullPage: true });
  await mobilePage.keyboard.press('Escape');
  await mobileHistory.waitFor({ state: 'detached' });

  await mobilePage.locator('.observer-world-tools__more').click();
  const mobileCollectionTrigger = mobilePage.locator('button[data-world-collection-trigger="true"], button[aria-label^="打开世界收藏"]');
  if (await mobileCollectionTrigger.count()) {
    await mobileCollectionTrigger.first().click();
    const mobileCollection = mobilePage.locator('.world-collection');
    await mobileCollection.waitFor();
    await assertWithinViewport(mobilePage, '.world-collection', '移动端世界收藏不可横向溢出');
    await waitForVisualSettled(mobileCollection);
    await mobilePage.screenshot({ path: `${ARTIFACT_DIR}/mobile-world-collection-390x844.png`, fullPage: true });
    await mobilePage.keyboard.press('Escape');
    await mobileCollection.waitFor({ state: 'detached' });
  }

  await mobilePage.locator('button[data-mandate-trigger="true"]').click();
  const mobileMandate = mobilePage.locator('.mandate-panel');
  await mobileMandate.waitFor();
  await mobilePage.waitForFunction(() => {
    const panel = document.querySelector('.mandate-panel');
    if (!panel) return false;
    const bounds = panel.getBoundingClientRect();
    return bounds.left >= 0 && bounds.right <= window.innerWidth + 1;
  });
  const mandateBounds = await mobileMandate.boundingBox();
  assert.ok(mandateBounds && mandateBounds.x >= 0 && mandateBounds.x + mandateBounds.width <= 391, '移动端天意窄页不可横向溢出');
  assert.match(await mobileMandate.textContent(), /先在舆图或名录中选择/);
  await mobilePage.keyboard.press('Escape');
  await mobileMandate.waitFor({ state: 'detached' });
  assert.equal(await mobilePage.evaluate(() => document.activeElement?.getAttribute('data-mandate-trigger')), 'true');
  await auditLayerDialog(mobilePage, true);
  await selectLayer(mobilePage, 'disease');
  await selectFirstMapObject(mobilePage, 'outbreak', '疫病档案');
  await mobilePage.waitForFunction(() => {
    const inspector = document.querySelector('.observer-inspector');
    if (!inspector) return false;
    const bounds = inspector.getBoundingClientRect();
    return bounds.left >= 0 && bounds.right <= window.innerWidth + 1;
  });
  const inspectorBounds = await mobilePage.locator('.observer-inspector').boundingBox();
  assert.ok(inspectorBounds && inspectorBounds.x >= 0 && inspectorBounds.x + inspectorBounds.width <= 391, '移动端对象档案不可横向溢出');
  const mobileText = await snapshotText(mobilePage);
  assert.ok(Buffer.byteLength(mobileText, 'utf8') < SNAPSHOT_LIMIT);
  assert.equal(await mobilePage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
  assert.deepEqual(mobileErrors, []);

  await mobileContext.close();
  await desktopContext.close();
  process.stdout.write(`E2E V1 passed: turn ${reloaded.time.turn}, hash ${reloaded.deterministicWorldHash}, snapshot ${Buffer.byteLength(observedText, 'utf8')} bytes, collection ${collectionResult.tested ? 'covered' : 'not wired'}\n`);
} finally {
  await browser?.close();
  await server.close();
}
