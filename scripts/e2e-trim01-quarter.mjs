import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const PORT = Number(process.env.TRIM01_E2E_PORT ?? 4192);
const externalUrl = process.env.TRIM01_E2E_URL;
const APP_URL = externalUrl ?? `http://127.0.0.1:${PORT}`;
const ARTIFACT_DIR = 'output/trim01-quarter-e2e';
const QUARTERS = 8;
const ROSTER_DOSSIER_MAX_WIDTH = 840;
const SCENARIO_FILTER = process.env.TRIM01_E2E_SCENARIO;

const SCENARIOS = Object.freeze([
  { slug: 'desktop-1440x900', viewport: { width: 1440, height: 900 } },
  { slug: 'tablet-768x900', viewport: { width: 768, height: 900 } },
  { slug: 'mobile-390x844', viewport: { width: 390, height: 844 } },
  { slug: 'mobile-wide-640x900', viewport: { width: 640, height: 900 } },
].filter((scenario) => !SCENARIO_FILTER || scenario.slug === SCENARIO_FILTER));

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

async function activate(locator, scenario) {
  if (scenario.viewport.width <= ROSTER_DOSSIER_MAX_WIDTH) await locator.tap();
  else await locator.click();
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
      timeButtons: Array.from(document.querySelectorAll('.observer-time-controls button')).map((button) => {
        const bounds = button.getBoundingClientRect();
        return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom };
      }),
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
  assert.equal(
    layout.timeButtons.every((bounds) => bounds.left >= -1 && bounds.right <= layout.viewportWidth + 1 && bounds.top >= -1 && bounds.bottom <= layout.viewportHeight + 1),
    true,
    `${scenario.slug} 时间控制必须完整落在视口内：${JSON.stringify(layout.timeButtons)}`,
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
    stories.every((story) => story.id && story.title && story.kind === 'event'),
    `${scenario.slug} 每件事必须有稳定 id、具体标题，裸局势不得补进季报`,
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

const HISTORY_LAYER_SELECTORS = Object.freeze({
  quarter: '[data-testid="quarter-pulse"][data-history-layer="quarter"]',
  situation: '.situation-workbench-layer[data-history-layer="situation"]',
  chronicle: '.history-workbench-layer[data-history-layer="chronicle"]',
  entity: '.history-archive-layer[data-history-layer="entity"]',
  evidence: '.observer-causal-layer[data-history-layer="evidence"]',
});

async function assertHistoryLayer(page, scenario, expected, baseline, detail) {
  const layer = page.locator(HISTORY_LAYER_SELECTORS[expected]);
  await layer.waitFor({ state: 'visible' });
  const current = await snapshot(page);
  assert.equal(
    current.interface?.historyReadingLayer,
    expected,
    `${scenario.slug} ${detail}的 DOM 与文本快照必须指向同一阅读层`,
  );
  assert.equal(current.time.turn, baseline.time.turn, `${scenario.slug} ${detail}不得推进季度`);
  assert.equal(
    current.deterministicWorldHash,
    baseline.deterministicWorldHash,
    `${scenario.slug} ${detail}不得改写世界哈希`,
  );
  return current;
}

async function assertTouchTarget(locator, scenario, detail) {
  if (scenario.viewport.width > ROSTER_DOSSIER_MAX_WIDTH) return;
  await locator.scrollIntoViewIfNeeded();
  await locator.evaluate(async (element) => {
    const layer = element.closest('[data-history-layer]') ?? element;
    await Promise.all(layer.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined)));
  });
  const bounds = await locator.boundingBox();
  assert.ok(
    bounds && bounds.width >= 44 && bounds.height >= 44,
    `${scenario.slug} ${detail}的触控区至少应为 44px，实际 ${JSON.stringify(bounds)}`,
  );
  const hitTest = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    return {
      ok: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight
        && Boolean(hit && (hit === element || element.contains(hit))),
      hit: hit?.closest('button')?.getAttribute('aria-label') ?? hit?.outerHTML.slice(0, 180) ?? null,
    };
  });
  assert.equal(hitTest.ok, true, `${scenario.slug} ${detail}必须位于视口内且中心点可命中；命中 ${hitTest.hit}`);
}

async function assertMapTouchControls(page, scenario) {
  if (scenario.viewport.width > ROSTER_DOSSIER_MAX_WIDTH) return;
  const viewportButtons = page.locator('.world-map__viewport-controls button');
  for (let index = 0; index < await viewportButtons.count(); index += 1) {
    await assertTouchTarget(viewportButtons.nth(index), scenario, `舆图缩放控件 ${index + 1}`);
  }
  const primaryTools = page.locator('.observer-world-tools > button:visible');
  assert.equal(await primaryTools.count(), 4, `${scenario.slug} 窄屏地图只直露观察、天意、设置和更多`);
  for (let index = 0; index < await primaryTools.count(); index += 1) {
    await assertTouchTarget(primaryTools.nth(index), scenario, `地图常用工具 ${index + 1}`);
  }
  const primer = page.locator('.observer-map-primer-trigger:visible');
  if (await primer.count()) await assertTouchTarget(primer, scenario, '读图入口');
  await activate(page.locator('.observer-world-tools__more'), scenario);
  const secondaryTools = page.locator('.observer-world-tools__secondary button:visible');
  assert.equal(await secondaryTools.count(), 4, `${scenario.slug} 更多菜单应收纳四项低频工具`);
  for (let index = 0; index < await secondaryTools.count(); index += 1) {
    await assertTouchTarget(secondaryTools.nth(index), scenario, `地图低频工具 ${index + 1}`);
  }
  await activate(page.locator('.observer-world-tools__more'), scenario);
  const overlap = await page.evaluate(() => {
    const tools = document.querySelector('.observer-world-tools')?.getBoundingClientRect();
    const summaries = Array.from(document.querySelectorAll('.observer-world-summary > span'))
      .filter((element) => getComputedStyle(element).display !== 'none')
      .map((element) => element.getBoundingClientRect());
    return tools ? summaries.some((summary) => !(
      summary.right <= tools.left || summary.left >= tools.right || summary.bottom <= tools.top || summary.top >= tools.bottom
    )) : false;
  });
  assert.equal(overlap, false, `${scenario.slug} 地图工具不得遮住世界总览`);
}

async function assertEvidenceIdentity(page, scenario, sourceEventId, evidenceState, detail) {
  assert.ok(sourceEventId, `${scenario.slug} ${detail}的来源入口必须携带史事 ID`);
  const layerEventId = await page.locator(HISTORY_LAYER_SELECTORS.evidence).getAttribute('data-event-id');
  assert.equal(layerEventId, sourceEventId, `${scenario.slug} ${detail}打开的何故层必须是同一史事`);
  assert.equal(evidenceState.interface.selectedEventId, sourceEventId, `${scenario.slug} ${detail}的全文快照必须保留同一史事`);
}

async function exerciseQuarterEventHistoryPath(page, scenario, baseline) {
  const eventStory = page.locator(
    '[data-testid="quarter-pulse"][data-history-layer="quarter"] [data-testid="quarter-pulse-event"]',
  ).first();
  if (!(await eventStory.count())) return false;

  await assertHistoryLayer(page, scenario, 'quarter', baseline, '从本季变化出发');
  await assertTouchTarget(eventStory, scenario, '本季具体史事入口');
  const sourceEventId = await eventStory.getAttribute('data-event-id');
  await eventStory.click();
  const evidenceState = await assertHistoryLayer(page, scenario, 'evidence', baseline, '从本季史事查看何故与证据');
  await assertEvidenceIdentity(page, scenario, sourceEventId, evidenceState, '本季具体史事');

  const evidenceClose = page.locator(`${HISTORY_LAYER_SELECTORS.evidence} .observer-causal-drawer__header button`);
  await assertTouchTarget(evidenceClose, scenario, '本季史事返回入口');
  await evidenceClose.click();
  await assertHistoryLayer(page, scenario, 'quarter', baseline, '因果阅读后返回本季变化');
  await page.waitForFunction((id) => document.activeElement?.getAttribute('data-event-id') === id, sourceEventId);
  return true;
}

async function exerciseObserverSituationHistoryPath(page, scenario, baseline) {
  const situationTrigger = page.locator('[data-situation-workbench-trigger="true"]');
  if (!(await situationTrigger.count()) || !(await situationTrigger.isVisible())) return false;

  await assertHistoryLayer(page, scenario, 'quarter', baseline, '从当世三问出发');
  await assertTouchTarget(situationTrigger, scenario, '持续局势入口');
  await situationTrigger.click();

  const situationState = await assertHistoryLayer(page, scenario, 'situation', baseline, '打开持续局势');
  const situationId = situationState.observer.selectedSituationId;
  assert.ok(situationId, `${scenario.slug} 持续局势入口必须选中稳定身份`);

  const workbench = page.locator(HISTORY_LAYER_SELECTORS.situation);
  let causalEntry = workbench.locator('.situation-workbench__timeline button').first();
  if (!(await causalEntry.count())) {
    const evidenceDisclosure = workbench.locator('.situation-workbench__evidence > summary');
    if (await evidenceDisclosure.count()) {
      await assertTouchTarget(evidenceDisclosure, scenario, '局势历史凭证入口');
      await evidenceDisclosure.click();
      causalEntry = workbench.locator('.situation-workbench__evidence button').first();
    }
  }
  if (!(await causalEntry.count())) {
    await workbench.locator('.situation-workbench__close').click();
    await assertHistoryLayer(page, scenario, 'quarter', baseline, '返回本季变化');
    return false;
  }

  await assertTouchTarget(causalEntry, scenario, '局势转折的何故入口');
  const sourceEventId = await causalEntry.getAttribute('data-event-id');
  await causalEntry.click();
  const evidenceState = await assertHistoryLayer(page, scenario, 'evidence', baseline, '从局势查看何故与证据');
  await assertEvidenceIdentity(page, scenario, sourceEventId, evidenceState, '局势转折');

  const evidenceClose = page.locator(`${HISTORY_LAYER_SELECTORS.evidence} .observer-causal-drawer__header button`);
  await assertTouchTarget(evidenceClose, scenario, '何故与证据返回入口');
  await evidenceClose.click();
  const resumed = await assertHistoryLayer(page, scenario, 'situation', baseline, '因果阅读后返回局势');
  assert.equal(resumed.observer.selectedSituationId, situationId, `${scenario.slug} 返回后必须保留原局势上下文`);

  const situationClose = workbench.locator('.situation-workbench__close');
  await assertTouchTarget(situationClose, scenario, '持续局势关闭入口');
  await situationClose.click();
  await assertHistoryLayer(page, scenario, 'quarter', baseline, '局势阅读后返回季报');
  const warFocusClose = page.getByRole('button', { name: '退出战局聚焦' });
  if (await warFocusClose.isVisible().catch(() => false)) {
    await assertTouchTarget(warFocusClose, scenario, '战局聚焦关闭入口');
    await warFocusClose.click();
    await page.waitForSelector('[data-testid="war-focus-summary"]', { state: 'detached' });
  } else {
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-situation-workbench-trigger') === 'true');
  }
  return true;
}

async function exerciseChronicleHistoryPath(page, scenario, baseline) {
  const trigger = page.locator('[data-history-workbench-trigger="true"]');
  assert.equal(await trigger.count(), 1, `${scenario.slug} 长期史册只能有一个全局入口`);
  await assertTouchTarget(trigger, scenario, '长期史册入口');
  await trigger.click();
  await assertHistoryLayer(page, scenario, 'chronicle', baseline, '打开长期史册');

  const workbench = page.locator(HISTORY_LAYER_SELECTORS.chronicle);
  const eventEntry = workbench.locator('.history-workbench__event-list > li > button').first();
  assert.ok(await eventEntry.count(), `${scenario.slug} 长期史册必须提供可追溯史事`);
  if (scenario.viewport.width <= 760) {
    const mobileAction = eventEntry.locator('.history-workbench__event-action');
    assert.equal(await mobileAction.textContent(), '为何如此', `${scenario.slug} 移动端必须明示因果入口`);
    assert.equal(
      await mobileAction.evaluate((element) => getComputedStyle(element).opacity),
      '1',
      `${scenario.slug} 移动端因果入口不能继承桌面端的隐藏样式`,
    );
  }
  await assertTouchTarget(eventEntry, scenario, '史册史事入口');
  const sourceEventId = await eventEntry.getAttribute('data-event-id');
  await eventEntry.click();
  const evidenceState = await assertHistoryLayer(page, scenario, 'evidence', baseline, '从长期史册查看何故与证据');
  await assertEvidenceIdentity(page, scenario, sourceEventId, evidenceState, '天下史册史事');

  const evidenceClose = page.locator(`${HISTORY_LAYER_SELECTORS.evidence} .observer-causal-drawer__header button`);
  await assertTouchTarget(evidenceClose, scenario, '史册因果返回入口');
  await evidenceClose.click();
  await assertHistoryLayer(page, scenario, 'chronicle', baseline, '因果阅读后返回长期史册');
  assert.equal(
    await workbench.evaluate((element) => element.contains(document.activeElement)),
    true,
    `${scenario.slug} 返回长期史册后焦点必须留在卷内`,
  );

  const chronicleClose = workbench.locator('.history-workbench__close');
  await assertTouchTarget(chronicleClose, scenario, '天下史册关闭入口');
  await chronicleClose.click();
  await assertHistoryLayer(page, scenario, 'quarter', baseline, '长期史册关闭后返回本季变化');
}

async function exercisePersonHistoryPath(page, scenario, baseline) {
  const peopleTrigger = page.locator('[data-observer-view="people"]');
  await assertTouchTarget(peopleTrigger, scenario, '人物名录入口');
  await peopleTrigger.click();
  const roster = page.locator('.roster-panel[data-roster-scope="people"]');
  await roster.waitFor();
  const personEntry = roster.locator('[data-roster-id]').first();
  assert.ok(await personEntry.count(), `${scenario.slug} 人物名录必须有可读人物`);
  await assertTouchTarget(personEntry, scenario, '人物名录条目');
  const personId = await personEntry.getAttribute('data-roster-id');
  await personEntry.click();

  const inspector = page.locator('.observer-inspector[data-kind="person"]');
  await inspector.waitFor();
  if (scenario.viewport.width <= ROSTER_DOSSIER_MAX_WIDTH) {
    await page.waitForFunction(() => document.querySelector('.observer-inspector')?.getAttribute('data-mobile-expanded') === 'true');
    assert.equal(
      await page.evaluate(() => document.activeElement?.getAttribute('data-inspector-return')),
      'roster',
      `${scenario.slug} 隐藏名录后焦点必须进入人物档案的返回入口`,
    );
    assert.equal(await roster.getAttribute('data-roster-state'), 'suspended', `${scenario.slug} 完整档案打开时原人物名录应留在原位但暂停交互`);
    const fullState = await snapshot(page);
    assert.equal(fullState.interface.view, 'people', `${scenario.slug} 名录来源档案必须保留人物卷上下文`);
    assert.equal(fullState.interface.mobileInspectorMode, 'full');
    if (scenario.viewport.width <= 760) {
      assert.equal(await page.getByTestId('quarter-pulse').getAttribute('data-presentation'), 'condensed', `${scenario.slug} 完整档案必须让季度纪要收成单行`);
      const pulseLayout = await page.getByTestId('quarter-pulse').evaluate((element) => ({
        height: element.getBoundingClientRect().height,
        media: matchMedia('(max-width: 760px)').matches,
        innerWidth,
      }));
      assert.ok(pulseLayout.height <= 64, `${scenario.slug} 单行季度纪要不得超过64px：${JSON.stringify(pulseLayout)}`);
      await page.screenshot({ path: `${ARTIFACT_DIR}/${scenario.slug}-dossier-condensed-quarter.png`, fullPage: false });
    }
  } else {
    const separation = await page.evaluate(() => {
      const rosterBounds = document.querySelector('.roster-panel')?.getBoundingClientRect();
      const inspectorBounds = document.querySelector('.observer-inspector')?.getBoundingClientRect();
      return rosterBounds && inspectorBounds ? { rosterRight: rosterBounds.right, inspectorLeft: inspectorBounds.left } : null;
    });
    assert.ok(separation && separation.rosterRight <= separation.inspectorLeft + 1, `${scenario.slug} 名录与档案不得重叠：${JSON.stringify(separation)}`);
  }

  const embodimentEntry = inspector.locator('.observer-embodiment-switch > button');
  if (await embodimentEntry.count()) await assertTouchTarget(embodimentEntry, scenario, '人物入世入口');
  const dossierLink = inspector.locator('.observer-inspector__jump .observer-text-link').first();
  if (await dossierLink.count()) await assertTouchTarget(dossierLink, scenario, '档案内链');

  if (scenario.viewport.width <= ROSTER_DOSSIER_MAX_WIDTH) {
    const relationsTab = inspector.locator('[data-inspector-tab="relations"]');
    await relationsTab.click();
    const relationshipNode = inspector.locator('.observer-relationship-map__node').first();
    if (await relationshipNode.count()) await assertTouchTarget(relationshipNode, scenario, '关系星图人物');
    const relatedPerson = inspector.locator('.observer-relation-list [data-related-person-id]').first();
    if (await relatedPerson.count()) {
      const relatedPersonId = await relatedPerson.getAttribute('data-related-person-id');
      await activate(relatedPerson, scenario);
      await page.waitForFunction((id) => JSON.parse(window.render_game_to_text()).interface.selected?.id === id, relatedPersonId);
      await page.waitForFunction(() => document.activeElement?.getAttribute('data-inspector-return') === 'roster');
      await activate(inspector.locator('[data-inspector-return="roster"]'), scenario);
      await inspector.waitFor({ state: 'detached' });
      await page.waitForFunction((id) => document.activeElement?.getAttribute('data-roster-id') === id, personId);
      await activate(roster.locator(`[data-roster-id="${personId}"]`), scenario);
      await inspector.waitFor();
      await page.waitForFunction(() => document.activeElement?.getAttribute('data-inspector-return') === 'roster');
    }
  }

  const historyTab = inspector.locator('[data-inspector-tab="history"]');
  await assertTouchTarget(historyTab, scenario, '人物生平页签');
  await historyTab.click();
  assert.equal(await historyTab.getAttribute('aria-selected'), 'true', `${scenario.slug} 人物生平页签必须成为当前页`);

  const archiveEntry = inspector.locator('[data-entity-history-gateway="person"]');
  assert.equal(await archiveEntry.count(), 1, `${scenario.slug} 人物生平页只能有一个完整人物传入口`);
  await assertTouchTarget(archiveEntry, scenario, '完整人物传入口');
  await archiveEntry.click();
  const archiveState = await assertHistoryLayer(page, scenario, 'entity', baseline, '打开完整人物传');
  assert.equal(archiveState.interface.selected?.kind, 'person');
  assert.equal(archiveState.interface.selected?.id, personId, `${scenario.slug} 完整人物传必须属于当前人物`);

  const archive = page.locator(HISTORY_LAYER_SELECTORS.entity);
  assert.equal(await archive.getAttribute('data-history-scope'), 'person', `${scenario.slug} 对象史卷必须声明人物 scope`);
  assert.equal(await archive.getAttribute('data-history-scope-id'), personId, `${scenario.slug} 对象史卷必须声明当前人物 ID`);
  const archiveEvent = archive.locator('.history-archive__chronology li button').first();
  assert.ok(await archiveEvent.count(), `${scenario.slug} 固定世界的首位人物传必须至少有一条可追溯史事`);
  await assertTouchTarget(archiveEvent, scenario, '人物传史事入口');
  const sourceEventId = await archiveEvent.getAttribute('data-event-id');
  await archiveEvent.click();
  const evidenceState = await assertHistoryLayer(page, scenario, 'evidence', baseline, '从人物传查看何故与证据');
  await assertEvidenceIdentity(page, scenario, sourceEventId, evidenceState, '人物传史事');

  const evidenceClose = page.locator(`${HISTORY_LAYER_SELECTORS.evidence} .observer-causal-drawer__header button`);
  await assertTouchTarget(evidenceClose, scenario, '人物传因果返回入口');
  await evidenceClose.click();
  const resumedArchive = await assertHistoryLayer(page, scenario, 'entity', baseline, '因果阅读后返回完整人物传');
  assert.equal(resumedArchive.interface.selected?.id, personId, `${scenario.slug} 返回后必须保留人物上下文`);

  const archiveClose = archive.locator('.history-archive__masthead > button');
  await assertTouchTarget(archiveClose, scenario, '完整人物传关闭入口');
  await archiveClose.click();
  await archive.waitFor({ state: 'detached' });
  await inspector.waitFor();
  assert.equal(await historyTab.getAttribute('aria-selected'), 'true', `${scenario.slug} 关闭人物传后必须返回同一生平页签`);
  assert.equal(
    await page.evaluate(() => document.activeElement?.getAttribute('data-entity-history-gateway')),
    'person',
    `${scenario.slug} 关闭人物传后必须返回原入口`,
  );
  const returned = await snapshot(page);
  assert.equal(returned.time.turn, baseline.time.turn);
  assert.equal(returned.deterministicWorldHash, baseline.deterministicWorldHash);

  await archiveEntry.click();
  await assertHistoryLayer(page, scenario, 'entity', baseline, '重新打开人物传查看卷中人事');
  const relatedEntity = page.locator(`${HISTORY_LAYER_SELECTORS.entity} .history-archive__index button`).first();
  assert.ok(await relatedEntity.count(), `${scenario.slug} 人物传必须有可到达的卷中人事`);
  const relatedKind = await relatedEntity.getAttribute('data-entity-kind');
  const relatedId = await relatedEntity.getAttribute('data-entity-id');
  assert.ok(relatedKind && relatedId, `${scenario.slug} 卷中人事必须携带对象身份`);
  await assertTouchTarget(relatedEntity, scenario, '卷中人事入口');
  await relatedEntity.click();
  await page.locator(HISTORY_LAYER_SELECTORS.entity).waitFor({ state: 'detached' });
  const linkedInspector = page.locator(`.observer-inspector[data-kind="${relatedKind}"]`);
  await linkedInspector.waitFor();
  const linkedState = await snapshot(page);
  assert.equal(linkedState.interface.selected?.kind, relatedKind, `${scenario.slug} 卷中链接必须打开同类对象档案`);
  assert.equal(linkedState.interface.selected?.id, relatedId, `${scenario.slug} 卷中链接必须打开同一对象档案`);
  if (scenario.viewport.width <= ROSTER_DOSSIER_MAX_WIDTH) {
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-inspector-return') === 'roster');
  } else {
    assert.equal(await linkedInspector.evaluate((element) => document.activeElement === element), true, `${scenario.slug} 跨对象后焦点必须落在新档案`);
  }

  if (scenario.viewport.width <= ROSTER_DOSSIER_MAX_WIDTH) {
    const returnToRoster = linkedInspector.locator('[data-inspector-return="roster"]');
    await assertTouchTarget(returnToRoster, scenario, '返回人物名录入口');
    await activate(returnToRoster, scenario);
  } else await linkedInspector.locator('button[aria-label="关闭档案"]').click();
  await linkedInspector.waitFor({ state: 'detached' });
  if (scenario.viewport.width <= ROSTER_DOSSIER_MAX_WIDTH) {
    await roster.waitFor();
    assert.equal(await roster.getAttribute('data-roster-state'), 'active', `${scenario.slug} 返回后人物名录必须恢复交互`);
    await page.waitForFunction((id) => document.activeElement?.getAttribute('data-roster-id') === id, personId);
    assert.equal(await roster.locator(`[data-roster-id="${personId}"]`).isVisible(), true, `${scenario.slug} 返回后原人物必须仍在可见名单位置`);
    assert.equal(await page.getByTestId('quarter-pulse').getAttribute('data-presentation'), 'full', `${scenario.slug} 返回名单后季度纪要必须恢复`);
    await page.screenshot({ path: `${ARTIFACT_DIR}/${scenario.slug}-roster-return.png`, fullPage: false });
  }
  const openRoster = page.locator('.roster-panel');
  if (await openRoster.count()) {
    await openRoster.locator('.roster-panel__header > button').click();
    await openRoster.waitFor({ state: 'detached' });
  }
  await assertHistoryLayer(page, scenario, 'quarter', baseline, '人物生平阅读后返回季报');
}

async function exerciseLayerPicker(page, scenario, baseline) {
  const trigger = page.getByRole('button', { name: /^舆图叠层/ });
  await activate(trigger, scenario);
  const sheet = page.locator('#observer-layer-sheet');
  await sheet.waitFor();
  const radios = sheet.locator('[data-layer-id]');
  assert.equal(await radios.count(), 4, `${scenario.slug} 四种叠层必须保持唯一可达`);
  assert.deepEqual(
    await radios.evaluateAll((items) => items.map((item) => item.getAttribute('data-layer-id'))),
    ['political', 'war', 'food', 'none'],
  );

  if (scenario.viewport.width <= 760) {
    assert.deepEqual(
      await sheet.locator('[data-layer-id]:visible').evaluateAll((items) => items.map((item) => item.getAttribute('data-layer-id'))),
      ['political', 'war', 'food', 'none'],
      `${scenario.slug} 四种叠层应全部可见`,
    );
    await page.screenshot({ path: `${ARTIFACT_DIR}/${scenario.slug}-layers.png`, fullPage: false });
  }

  await activate(sheet.locator('[data-layer-id="food"]'), scenario);
  await sheet.waitFor({ state: 'detached' });
  let current = await snapshot(page);
  assert.equal(current.interface.overlay, 'food');
  assert.equal(current.time.turn, baseline.time.turn);
  assert.equal(current.deterministicWorldHash, baseline.deterministicWorldHash);

  await activate(trigger, scenario);
  await sheet.waitFor();
  const food = sheet.locator('[data-layer-id="food"]');
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-layer-id') === 'food');
  assert.equal(await food.isVisible(), true, `${scenario.slug} 当前供养叠层必须直接露出`);
  assert.equal(await food.getAttribute('aria-pressed'), 'true');
  await page.screenshot({ path: `${ARTIFACT_DIR}/${scenario.slug}-layers-active.png`, fullPage: false });
  await activate(sheet.locator('[data-layer-id="political"]'), scenario);
  current = await snapshot(page);
  assert.equal(current.interface.overlay, 'political');
  assert.equal(current.deterministicWorldHash, baseline.deterministicWorldHash);
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
    elapsed >= 600 && elapsed <= 1_800,
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

  if (scenario.viewport.width <= ROSTER_DOSSIER_MAX_WIDTH) {
    await familyTab.click();
    const familyEntry = panel.locator('[data-roster-id]').first();
    const familyId = await familyEntry.getAttribute('data-roster-id');
    await activate(familyEntry, scenario);
    const familyInspector = page.locator('.observer-inspector[data-kind="family"]');
    await familyInspector.waitFor();
    assert.equal(await panel.getAttribute('data-roster-state'), 'suspended', `${scenario.slug} 世家档案打开时应暂停原势力卷`);
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-inspector-return') === 'roster');
    await activate(familyInspector.locator('[data-inspector-return="roster"]'), scenario);
    await familyInspector.waitFor({ state: 'detached' });
    await panel.waitFor();
    assert.equal(await panel.getAttribute('data-active-section'), 'families', `${scenario.slug} 应返回原世家分卷`);
    await page.waitForFunction((id) => document.activeElement?.getAttribute('data-roster-id') === id, familyId);
  }

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

async function exerciseResponsiveRosterDossier(page, scenario, baseline) {
  const height = scenario.viewport.height;
  await page.setViewportSize({ width: 1024, height });

  const peopleTrigger = page.locator('[data-observer-view="people"]');
  await peopleTrigger.click();
  const roster = page.locator('.roster-panel[data-roster-scope="people"]');
  await roster.waitFor();
  const personEntry = roster.locator('[data-roster-id]').first();
  const personId = await personEntry.getAttribute('data-roster-id');
  assert.ok(personId, `${scenario.slug} 响应式回归必须取得原人物身份`);
  await personEntry.click();

  const inspector = page.locator('.observer-inspector[data-kind="person"]');
  await inspector.waitFor();
  assert.equal(await roster.getAttribute('data-roster-state'), 'active', `${scenario.slug} 1024px 下人物名录应保持可交互`);
  assert.equal(await inspector.locator('[data-inspector-return="roster"]').count(), 0, `${scenario.slug} 1024px 双栏档案不应显示返回名录入口`);

  await page.setViewportSize({ width: 768, height });
  await page.waitForFunction(() => document.querySelector('.roster-panel')?.getAttribute('data-roster-state') === 'suspended');
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-inspector-return') === 'roster');
  assert.equal(await inspector.locator('[data-inspector-return="roster"]').count(), 1, `${scenario.slug} 缩至 768px 后应切换为名录到档案单页流`);

  await page.setViewportSize({ width: 1024, height });
  await page.waitForFunction(() => document.querySelector('.roster-panel')?.getAttribute('data-roster-state') === 'active');
  await page.waitForFunction(() => !document.querySelector('[data-inspector-return="roster"]'));
  const separation = await page.evaluate(() => {
    const rosterBounds = document.querySelector('.roster-panel')?.getBoundingClientRect();
    const inspectorBounds = document.querySelector('.observer-inspector')?.getBoundingClientRect();
    return rosterBounds && inspectorBounds
      ? { rosterRight: rosterBounds.right, inspectorLeft: inspectorBounds.left }
      : null;
  });
  assert.ok(
    separation && separation.rosterRight <= separation.inspectorLeft + 1,
    `${scenario.slug} 扩回 1024px 后名录与档案应恢复无重叠双栏：${JSON.stringify(separation)}`,
  );

  await page.setViewportSize({ width: 844, height });
  await page.waitForFunction(() => document.querySelector('.roster-panel')?.getAttribute('data-roster-state') === 'active');
  await page.setViewportSize({ width: 390, height });
  await page.waitForFunction(() => document.querySelector('.roster-panel')?.getAttribute('data-roster-state') === 'suspended');
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-inspector-return') === 'roster');
  assert.equal(await page.getByTestId('quarter-pulse').getAttribute('data-presentation'), 'condensed', `${scenario.slug} 844→390 后完整档案应同步收起季度纪要`);

  await page.setViewportSize({ width: 844, height });
  await page.waitForFunction(() => document.querySelector('.roster-panel')?.getAttribute('data-roster-state') === 'active');
  await page.waitForFunction(() => !document.querySelector('[data-inspector-return="roster"]'));
  assert.equal(await page.getByTestId('quarter-pulse').getAttribute('data-presentation'), 'full', `${scenario.slug} 扩回 844px 后季度纪要应恢复完整展示`);

  await page.setViewportSize({ width: 768, height });
  await page.waitForFunction(() => document.querySelector('.roster-panel')?.getAttribute('data-roster-state') === 'suspended');
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-inspector-return') === 'roster');
  await page.locator('.observer-speed-cycle').focus();
  await page.keyboard.press('Escape');
  await inspector.waitFor({ state: 'detached' });
  await roster.waitFor();
  assert.equal(await roster.getAttribute('data-roster-state'), 'active', `${scenario.slug} Escape 返回后人物名录必须恢复交互`);
  await page.waitForFunction((id) => document.activeElement?.getAttribute('data-roster-id') === id, personId);

  await roster.locator('.roster-panel__header > button').click();
  await roster.waitFor({ state: 'detached' });
  await page.setViewportSize(scenario.viewport);

  await page.setViewportSize({ width: 1024, height });
  await peopleTrigger.click();
  await roster.waitFor();
  await roster.locator('[data-roster-id]').first().click();
  await inspector.waitFor();
  await inspector.evaluate(async (element) => {
    await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined)));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const canvas = page.locator('.world-map__canvas');
  await canvas.focus();
  await page.waitForFunction(() => document.activeElement?.classList.contains('world-map__canvas'));
  await canvas.press('ArrowRight');
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).interface.selected?.kind === 'region');
  await page.setViewportSize({ width: 768, height });
  assert.equal(await page.locator('[data-inspector-return="roster"]').count(), 0, `${scenario.slug} 地图改选后不得复活旧名录来路`);
  assert.equal(await page.locator('.roster-panel').count(), 0, `${scenario.slug} 地图改选后旧名录必须退出`);
  await page.locator('.observer-inspector button[aria-label="关闭档案"]').click();
  await page.locator('.observer-inspector').waitFor({ state: 'detached' });
  await page.setViewportSize(scenario.viewport);

  const returned = await snapshot(page);
  assert.equal(returned.time.turn, baseline.time.turn, `${scenario.slug} 响应式档案往返不得推进季度`);
  assert.equal(returned.deterministicWorldHash, baseline.deterministicWorldHash, `${scenario.slug} 响应式档案往返不得改写世界`);
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
  await page.getByLabel('世界种子').fill('春战副将');
  await page.locator('#start-world').click();
  await page.waitForSelector('.world-map__canvas');
  const initial = await snapshot(page);
  assert.equal(initial.time.turn, 0, `${scenario.slug} 应从未推进的新世界开始`);
  assert.equal(await page.getByTestId('quarter-pulse').getAttribute('data-story-count'), null);
  return initial;
}

async function verifyScenario(browser, scenario) {
  const context = await browser.newContext({
    viewport: scenario.viewport,
    hasTouch: scenario.viewport.width <= ROSTER_DOSSIER_MAX_WIDTH,
    isMobile: scenario.viewport.width <= 760,
  });
  const page = await context.newPage();
  const browserErrors = [];
  collectBrowserErrors(page, browserErrors);

  try {
    const initial = await createWorld(page, scenario);
    await assertMapTouchControls(page, scenario);
    await assertPrimaryNavigation(page, scenario, initial);
    if (scenario.slug === 'desktop-1440x900') {
      await exerciseResponsiveRosterDossier(page, scenario, initial);
    }
    await exerciseLayerPicker(page, scenario, initial);
    let previousDate = '';
    let quarterEventPathCovered = false;
    let situationHistoryPathCovered = false;
    for (let turn = 1; turn <= QUARTERS; turn += 1) {
      await page.getByRole('button', { name: '推进至下一季', exact: true }).click();
      const current = await waitForTurn(page, turn);
      const date = (await page.getByTestId('quarter-pulse-date').innerText()).replace(/\s+/g, ' ').trim();
      assert.notEqual(date, previousDate, `${scenario.slug} 第 ${turn} 季推进后日期必须更新`);
      previousDate = date;

      await assertQuarterProjection(page, scenario, current);
      await assertHighlightPulse(page, scenario, turn - 1, current.interface.quarterPulse);
      await assertNoPageOverflow(page, scenario);
      if (!quarterEventPathCovered) quarterEventPathCovered = await exerciseQuarterEventHistoryPath(page, scenario, current);
      if (!situationHistoryPathCovered) situationHistoryPathCovered = await exerciseObserverSituationHistoryPath(page, scenario, current);
    }

    assert.equal(quarterEventPathCovered, true, `${scenario.slug} 八季内必须走通季报→具体史事→因果→返回`);
    assert.equal(situationHistoryPathCovered, true, `${scenario.slug} 八季内必须走通三问→局势→具体因果→返回`);

    const browsingBaseline = await snapshot(page);
    await exerciseChronicleHistoryPath(page, scenario, browsingBaseline);
    await exercisePersonHistoryPath(page, scenario, browsingBaseline);

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
