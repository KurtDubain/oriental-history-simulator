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
const scenarios = [
  { slug: 'desktop-1440x900', viewport: { width: 1440, height: 900 } },
  { slug: 'mobile-390x844', viewport: { width: 390, height: 844 } },
];

async function snapshot(page) {
  return page.evaluate(() => JSON.parse(window.render_game_to_text()));
}

async function advance(page, turn) {
  await page.getByRole('button', { name: '推进至下一季', exact: true }).evaluate((button) => button.click());
  await page.waitForFunction((previous) => JSON.parse(window.render_game_to_text()).time.turn === previous + 1, turn);
}

async function openPerson(page, name, id = null) {
  const before = await snapshot(page);
  const panel = page.locator('.roster-panel[data-roster-scope="people"]');
  if (before.interface.view === 'people' && !await panel.isVisible().catch(() => false)) {
    const back = page.locator('[data-inspector-close]');
    if (await back.count()) await back.first().evaluate((button) => button.click());
  }
  if (!await panel.isVisible().catch(() => false)) {
    await page.locator('[data-observer-view="people"]').evaluate((button) => button.click());
  }
  const roster = panel;
  await roster.waitFor();
  await page.getByLabel('检索时人群像').fill(name);
  const row = roster.locator('[data-roster-id]').filter({ hasText: name }).first();
  await row.waitFor();
  const personId = await row.getAttribute('data-roster-id');
  await row.click();
  await page.waitForFunction((expected) => {
    const current = JSON.parse(window.render_game_to_text());
    return current.interface.selected?.kind === 'person' && current.interface.selected.id === expected;
  }, personId);
  return { inspector: page.locator('.observer-inspector[data-kind="person"]'), personId };
}

function namedStory(state, expression, people) {
  const story = state.interface.quarterPulse.stories.find((item) => expression.test(`${item.title} ${item.summary}`));
  if (!story) return null;
  const person = [...people.values()].find((item) => `${story.title} ${story.summary}`.includes(item.name));
  if (person) return { ...person, story };
  const name = story.title.match(/^(.+?)(?:负伤|受创|阵亡|战死)/u)?.[1]?.trim();
  return name ? { id: null, name, story } : null;
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
    page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
    page.on('pageerror', (error) => errors.push(`page: ${String(error)}`));
    await page.addInitScript(() => {
      localStorage.setItem('canghai-map-primer-complete-v1', '1');
      localStorage.setItem('canghai-observer-interface-settings-v1', JSON.stringify({
        version: 2,
        motion: 'reduced', mapAtmosphere: true, interfaceDensity: 'comfortable',
      }));
    });
    await page.goto(appUrl, { waitUntil: 'networkidle' });
    await page.getByLabel('世界种子').fill(seed);
    await page.locator('#start-world').click();
    await page.waitForSelector('.world-map__canvas');

    let current = await snapshot(page);
    const people = new Map(current.mapObjects.personalForces.map((force) => [force.ownerId, { id: force.ownerId, name: force.name }]));
    const wounded = new Map();
    let woundCapture = null;
    let recoveryCapture = null;
    let battleDeath = null;
    while (current.time.turn < 64) {
      await advance(page, current.time.turn);
      current = await snapshot(page);
      for (const force of current.mapObjects.personalForces) people.set(force.ownerId, { id: force.ownerId, name: force.name });

      const wound = namedStory(current, /负伤/u, people);
      if (wound && ![...wounded.values()].some((record) => record.name === wound.name)) {
        const opened = await openPerson(page, wound.name, wound.id);
        const record = { ...wound, id: opened.personId, observedTurn: current.time.turn };
        wounded.set(opened.personId, record);
        if (!woundCapture) {
          await opened.inspector.waitFor();
          const selected = await snapshot(page);
          assert.match(selected.interface.selectedDetail.militaryForce?.status ?? '', /休养/u, `${scenario.slug} 负伤者应显示休养处境`);
          assert.match(selected.interface.selectedDetail.militaryForce?.formation ?? '', /退离/u, `${scenario.slug} 负伤者应退出行营`);
          await page.screenshot({ path: `${artifactDir}/${scenario.slug}-wounded-resting.png`, fullPage: false });
          woundCapture = { id: opened.personId, name: wound.name, turn: current.time.turn, story: wound.story };
        }
      }
      for (const record of wounded.values()) {
        const opened = await openPerson(page, record.name, record.id);
        const selected = await snapshot(page);
        if (current.time.turn === record.observedTurn + 1) assert.doesNotMatch(selected.interface.selectedDetail.militaryForce?.formation ?? '', /^(自领|随)/u, `${scenario.slug} 负伤后下一季不得照常参战`);
        const returned = /^(自领|随)/u.test(selected.interface.selectedDetail.militaryForce?.formation ?? '');
        if (!recoveryCapture && returned && current.time.turn > record.observedTurn + 1) {
          assert.doesNotMatch(selected.interface.selectedDetail.militaryForce?.status ?? '', /休养/u, `${scenario.slug} 复出后不应仍标作休养`);
          await opened.inspector.scrollIntoViewIfNeeded();
          await page.screenshot({ path: `${artifactDir}/${scenario.slug}-returned-to-service.png`, fullPage: false });
          recoveryCapture = { id: record.id, name: record.name, turn: current.time.turn, formation: selected.interface.selectedDetail.militaryForce?.formation };
        }
      }
      battleDeath ??= namedStory(current, /阵亡|战死/u, people);
    }

    if (!recoveryCapture) {
      await page.locator('[data-map-zoom-in="true"]').evaluate((button) => button.click());
      await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).interface.mapViewport.lod !== 'overview');
      current = await snapshot(page);
      const activeParticipants = current.mapObjects.armies.flatMap((army) => army.participants ?? []);
      for (const person of activeParticipants.filter((item, index, values) => values.findIndex((other) => other.id === item.id) === index)) {
        const opened = await openPerson(page, person.name, person.id);
        const detail = (await snapshot(page)).interface.selectedDetail;
        const experiencedWound = detail.storyArc?.some((beat) => /负伤|受创/u.test(`${beat.title} ${beat.summary}`));
        if (!experiencedWound || !/^(自领|随)/u.test(detail.militaryForce?.formation ?? '')) continue;
        await opened.inspector.scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${artifactDir}/${scenario.slug}-returned-to-service.png`, fullPage: false });
        recoveryCapture = { id: person.id, name: person.name, turn: current.time.turn, formation: detail.militaryForce?.formation };
        break;
      }
    }

    assert.ok(woundCapture, `${scenario.slug} 六十四季应能观察到一次有来源的负伤`);
    assert.ok(recoveryCapture, `${scenario.slug} 应能观察到至少一名伤员休养后复出`);

    assert.ok(battleDeath, `${scenario.slug} 应能从当季变化或史册发现一名战死者`);
    const departed = await openPerson(page, battleDeath.name, battleDeath.id);
    await departed.inspector.waitFor();
    let selected = await snapshot(page);
    assert.equal(selected.interface.selectedDetail.alive, false, `${scenario.slug} 战死者档案应保留死亡状态`);
    const arc = selected.interface.selectedDetail.storyArc;
    assert.ok(Array.isArray(arc) && arc.length >= 1 && arc.length <= 5, `${scenario.slug} 故人生平应为一至五段真实经历，不强制补满`);
    assert.equal(arc.at(-1)?.phase, 'ending', `${scenario.slug} 故人生平最后一段必须是结局`);
    assert.ok(arc.every((beat) => beat.sourceFactIds.length || beat.sourceEventIds.length), `${scenario.slug} 每段生平必须有真实 Fact 或兼容史事来源`);
    assert.equal(selected.interface.selectedDetail.militaryForce?.status, '已解散', `${scenario.slug} 故人档案应保留最后军势而非现役军势`);
    await departed.inspector.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${artifactDir}/${scenario.slug}-deceased-story.png`, fullPage: false });

    const living = [...people.values()].find((person) => person.id !== battleDeath.id
      && current.mapObjects.personalForces.some((force) => force.ownerId === person.id));
    assert.ok(living);
    await openPerson(page, living.name, living.id);
    await openPerson(page, battleDeath.name, battleDeath.id);
    selected = await snapshot(page);
    assert.equal(selected.interface.selectedDetail.id, departed.personId, `${scenario.slug} 离开后仍应按姓名重新找到故人`);
    await writeFile(`${artifactDir}/${scenario.slug}-final-state.json`, JSON.stringify(selected, null, 2));

    const layout = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
    assert.ok(layout.document <= layout.viewport + 1, `${scenario.slug} 页面不得横向溢出`);
    assert.deepEqual(errors, [], `${scenario.slug} 不得出现 console/page error`);
    results.push({ scenario: scenario.slug, woundCapture, recoveryCapture, battleDeath: battleDeath.name,
      storyBeats: arc.length, finalHash: current.deterministicWorldHash });
    await page.close();
  }
  assert.deepEqual(results[0].woundCapture, results[1].woundCapture, '桌面与移动端必须重放同一负伤事实');
  assert.deepEqual(results[0].recoveryCapture, results[1].recoveryCapture, '桌面与移动端必须重放同一复出过程');
  assert.equal(results[0].battleDeath, results[1].battleDeath, '桌面与移动端必须发现同一战死者');
  assert.equal(results[0].finalHash, results[1].finalHash, '两种视口观察不得改变世界演化');
  console.log(JSON.stringify({ version, seed, results, failures: [] }, null, 2));
} catch (error) {
  for (const [index, page] of browser.contexts().flatMap(context => context.pages()).entries()) {
    await page.screenshot({ path: `${artifactDir}/failure-${index}.png`, fullPage: true });
    await writeFile(`${artifactDir}/failure-${index}.txt`, await page.locator('body').innerText());
  }
  throw error;
} finally {
  await browser.close();
  if (server) await server.close();
}
