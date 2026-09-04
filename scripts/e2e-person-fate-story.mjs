import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const PORT = Number(process.env.PERSON_FATE_E2E_PORT ?? 4212);
const externalUrl = process.env.PERSON_FATE_E2E_URL;
const appUrl = externalUrl ?? `http://127.0.0.1:${PORT}`;
const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
const artifactDir = `output/person-fate-e2e-v${version}`;
const seed = '乱世一将';
const personId = 'c_098';
const personName = '陆维宣';
const scenarios = [
  { slug: 'desktop-1440x900', viewport: { width: 1440, height: 900 } },
  { slug: 'mobile-390x844', viewport: { width: 390, height: 844 } },
];

async function snapshot(page) {
  return page.evaluate(() => JSON.parse(window.render_game_to_text()));
}

async function advance(page, turn) {
  await page.getByRole('button', { name: '推进至下一季', exact: true }).click();
  await page.waitForFunction((previous) => JSON.parse(window.render_game_to_text()).time.turn === previous + 1, turn);
}

async function advanceWithShortcut(page, turn) {
  await page.getByRole('button', { name: '推进至下一季', exact: true }).evaluate((button) => button.click());
  await page.waitForFunction((previous) => JSON.parse(window.render_game_to_text()).time.turn === previous + 1, turn);
}

async function openPerson(page) {
  await page.locator('[data-observer-view="people"]').click();
  const roster = page.locator('.roster-panel[data-roster-scope="people"]');
  await roster.waitFor();
  await page.getByLabel('检索时人群像').fill(personName);
  const row = roster.locator(`[data-roster-id="${personId}"]`);
  await row.waitFor();
  await row.click();
  await page.waitForFunction((id) => {
    const current = JSON.parse(window.render_game_to_text());
    return current.interface.selected?.kind === 'person' && current.interface.selected.id === id;
  }, personId);
  return page.locator('.observer-inspector[data-kind="person"]');
}

await mkdir(artifactDir, { recursive: true });
const server = externalUrl ? null : await createServer({
  root: new URL('..', import.meta.url).pathname,
  logLevel: 'error',
  server: { host: '127.0.0.1', port: PORT, strictPort: true },
});
if (server) await server.listen();

const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const scenario of scenarios) {
    const page = await browser.newPage({ viewport: scenario.viewport, hasTouch: scenario.viewport.width <= 840 });
    const errors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    page.on('pageerror', (error) => errors.push(`page: ${String(error)}`));
    await page.addInitScript(() => {
      localStorage.setItem('canghai-map-primer-complete-v1', '1');
      localStorage.setItem('canghai-observer-interface-settings-v1', JSON.stringify({
        version: 2,
        sound: { enabled: false, promptDismissed: true, masterVolume: 0.72, ambienceVolume: 0.42, effectsVolume: 0.68 },
        motion: 'reduced',
        mapAtmosphere: true,
        interfaceDensity: 'comfortable',
      }));
    });
    await page.goto(appUrl, { waitUntil: 'networkidle' });
    await page.getByLabel('世界种子').fill(seed);
    await page.locator('#start-world').click();
    await page.waitForSelector('.world-map__canvas');

    let current = await snapshot(page);
    while (current.time.turn < 23) {
      await advance(page, current.time.turn);
      current = await snapshot(page);
    }
    const inspector = await openPerson(page);
    await inspector.waitFor();
    const beforeFate = await snapshot(page);
    assert.equal(beforeFate.interface.selectedDetail.alive, true, `${scenario.slug} 命运裁决前陆维宣应仍在世`);
    assert.ok(beforeFate.interface.selectedDetail.commandingArmyId, `${scenario.slug} 命运裁决前陆维宣应仍领军`);
    await advanceWithShortcut(page, beforeFate.time.turn);
    current = await snapshot(page);
    assert.equal(current.interface.selectedDetail.alive, false, `${scenario.slug} 战死事实应在同季度同步到人物档案`);
    assert.equal(current.interface.selectedDetail.commandingArmyId, null, `${scenario.slug} 战死者应在同季度交出军令`);
    assert.equal(current.interface.selectedDetail.militaryForce?.soldiers ?? 0, 0, `${scenario.slug} 战死者个人军势应当季归零`);
    assert.equal(current.interface.selectedDetail.militaryForce?.formation ?? null, null, `${scenario.slug} 战死者应当季退出编队`);
    assert.equal(current.mapObjects.armies.find((item) => item.commander === personName) ?? null, null, `${scenario.slug} 战死者不应继续出现在地图主将栏`);
    const fateStory = current.interface.quarterPulse.stories.find((item) => JSON.stringify(item).includes(personName));
    assert.ok(fateStory, `${scenario.slug} 重要主将阵亡应进入当季变化`);
    const fate = { turn: current.time.turn, story: fateStory, hash: current.deterministicWorldHash };
    await page.screenshot({ path: `${artifactDir}/${scenario.slug}-fate-quarter.png`, fullPage: false });
    await writeFile(`${artifactDir}/${scenario.slug}-fate-state.json`, JSON.stringify(current, null, 2));

    while (current.time.turn < 64) {
      await advanceWithShortcut(page, current.time.turn);
      current = await snapshot(page);
    }
    const story = inspector.locator('.observer-person-story');
    await story.waitFor();
    await story.scrollIntoViewIfNeeded();
    const selected = await snapshot(page);
    const arc = selected.interface.selectedDetail.storyArc;
    assert.ok(Array.isArray(arc) && arc.length >= 3 && arc.length <= 4, `${scenario.slug} 人物档案应给出克制的三至四段生平`);
    assert.ok(arc.every((beat) => beat.sourceFactIds.length > 0), `${scenario.slug} 每段生平都必须有 Fact 来源`);
    assert.match(JSON.stringify(arc), /进兵|攻取|得胜/u, `${scenario.slug} 生平应保留早期进兵`);
    assert.match(JSON.stringify(arc), /道路未通|中止|远征/u, `${scenario.slug} 生平应保留远征中止转折`);
    assert.match(JSON.stringify(arc), /阵亡|负伤/u, `${scenario.slug} 生平应以真实战后命运收束`);
    assert.equal(selected.interface.selectedDetail.alive, false, `${scenario.slug} 陆维宣的当前状态应与战死事实一致`);
    await page.screenshot({ path: `${artifactDir}/${scenario.slug}-person-story.png`, fullPage: false });

    if (scenario.viewport.width <= 840 && arc.length > 3) {
      const visibleBefore = await story.locator('li').evaluateAll((items) => items.filter((item) => getComputedStyle(item).display !== 'none').length);
      assert.equal(visibleBefore, 3, `${scenario.slug} 移动端默认只展开三段`);
      await story.locator('.observer-person-story__more').click();
      assert.equal(await story.locator('li').evaluateAll((items) => items.filter((item) => getComputedStyle(item).display !== 'none').length), arc.length);
    }

    const historyTab = inspector.locator('[data-inspector-tab="history"]');
    await historyTab.click();
    assert.equal(await historyTab.getAttribute('aria-selected'), 'true');
    await page.screenshot({ path: `${artifactDir}/${scenario.slug}-person-history.png`, fullPage: false });
    await inspector.locator('[data-entity-history-gateway="person"]').click();
    const archive = page.locator('.history-archive-layer[data-history-scope="person"]');
    await archive.waitFor();
    await archive.evaluate(async (element) => {
      await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined)));
    });
    assert.ok(await archive.locator('.history-archive__chronology li button').count(), `${scenario.slug} 完整人物传应保留原史事入口`);
    await page.screenshot({ path: `${artifactDir}/${scenario.slug}-person-archive.png`, fullPage: false });

    const layout = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
    assert.ok(layout.document <= layout.viewport + 1, `${scenario.slug} 页面不得横向溢出`);
    assert.deepEqual(errors, [], `${scenario.slug} 不得出现 console/page error`);
    results.push({ scenario: scenario.slug, fate, storyBeats: arc.length, finalHash: current.deterministicWorldHash });
    await page.close();
  }
  assert.equal(results[0].fate.turn, results[1].fate.turn, '桌面与移动端必须重放同一命运季度');
  assert.deepEqual(results[0].fate.story, results[1].fate.story, '桌面与移动端必须重放同一命运事实');
  assert.equal(results[0].finalHash, results[1].finalHash, '两种视口观察不得改变世界演化');
  console.log(JSON.stringify({ version, seed, personId, results, failures: [] }, null, 2));
} finally {
  await browser.close();
  if (server) await server.close();
}
