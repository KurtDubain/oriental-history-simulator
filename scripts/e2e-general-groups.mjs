import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const PORT = Number(process.env.GENERAL_GROUP_E2E_PORT ?? 4203);
const externalUrl = process.env.GENERAL_GROUP_E2E_URL;
const APP_URL = externalUrl ?? `http://127.0.0.1:${PORT}`;
const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
const ARTIFACT_DIR = `output/general-groups-e2e-v${version}`;
const scenarios = [
  { slug: 'desktop-1440x900', viewport: { width: 1440, height: 900 } },
  { slug: 'mobile-390x844', viewport: { width: 390, height: 844 } },
];

async function snapshot(page) {
  return page.evaluate(() => JSON.parse(window.render_game_to_text()));
}

async function advance(page, currentTurn) {
  await page.getByRole('button', { name: '推进至下一季', exact: true }).click();
  await page.waitForFunction((turn) => JSON.parse(window.render_game_to_text()).time.turn === turn + 1, currentTurn);
}

function armiesIn(war) {
  return war.sides.flatMap((side) => side.groups.flatMap((group) => group.armies));
}

function personsIn(war) {
  return war.sides.flatMap((side) => side.groups.flatMap((group) => group.persons));
}

function findWar(snapshotValue, warId = null) {
  return snapshotValue.mapObjects.wars.find((war) => !warId || war.warId === warId) ?? null;
}

await mkdir(ARTIFACT_DIR, { recursive: true });
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
        motion: 'full',
        mapAtmosphere: true,
        interfaceDensity: 'comfortable',
      }));
    });
    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    await page.getByLabel('世界种子').fill('春战副将');
    await page.locator('#start-world').click();
    await page.waitForSelector('.world-map__canvas');

    let current = await snapshot(page);
    let warLead = current.observer.focusLeads.find((lead) => lead.situationType === 'war_progress' && lead.situationId);
    for (let step = 0; step < 24 && (!warLead || !findWar(current)); step += 1) {
      await advance(page, current.time.turn);
      current = await snapshot(page);
      warLead = current.observer.focusLeads.find((lead) => lead.situationType === 'war_progress' && lead.situationId);
    }
    assert.ok(warLead, `${scenario.slug} 应在24季内出现可点击的战争线索`);

    if (scenario.viewport.width <= 840) {
      const leads = page.locator('[data-observer-leads=true]');
      const toggle = leads.getByTestId('observer-leads-mobile-toggle');
      if (await leads.getAttribute('data-mobile-open') === null) await toggle.click();
      if (await leads.getAttribute('data-mobile-expanded') === null) await toggle.click();
    }
    await page.locator(`[data-lead-id="${warLead.id}"] .observer-leads__inspect`).click();
    const workbench = page.locator('.situation-workbench-layer');
    await workbench.waitFor();
    assert.ok((await workbench.getByTestId('situation-current-action').textContent())?.trim(), `${scenario.slug} 战争卷必须先讲具体战况`);
    await workbench.getByRole('button', { name: '回到舆图看战线' }).click();

    const summary = page.getByTestId('war-focus-summary');
    await summary.waitFor();
    const warId = await summary.getAttribute('data-war-id');
    assert.ok(warId, `${scenario.slug} 战局摘要必须指向真实战争`);
    current = await snapshot(page);
    let war = findWar(current, warId);
    assert.ok(war, `${scenario.slug} 战局摘要必须与活动战争一致`);
    assert.equal(current.interface.overlay, 'war', `${scenario.slug} 打开战争应转入军争层`);
    assert.equal(await page.locator('.world-map').getAttribute('data-focused-war-id'), warId, `${scenario.slug} 舆图应聚焦同一战线`);

    const projectedArmyIds = armiesIn(war).map((army) => army.id);
    const projectedPersonIds = personsIn(war).map((person) => person.id);
    assert.equal(new Set(projectedArmyIds).size, projectedArmyIds.length, `${scenario.slug} 每军只能计入一个集团`);
    assert.equal(new Set(projectedPersonIds).size, projectedPersonIds.length, `${scenario.slug} 每个人物军势只能计入一个集团`);
    for (const side of war.sides) {
      assert.equal(side.soldiers, side.groups.reduce((sum, group) => sum + group.soldiers, 0), `${scenario.slug} ${side.polity}集团兵力应等于参战军团和`);
      assert.equal(side.armyCount, side.groups.reduce((sum, group) => sum + group.armies.length, 0), `${scenario.slug} ${side.polity}军数应守恒`);
      for (const group of side.groups) {
        assert.equal(group.soldiers, group.persons.reduce((sum, person) => sum + person.soldiers, 0), `${scenario.slug} ${group.name}兵力应来自人物部曲`);
      }
    }
    for (const army of armiesIn(war)) {
      const participantSoldiers = current.mapObjects.personalForces
        .filter((force) => force.formationId === army.id)
        .reduce((sum, force) => sum + force.soldiers, 0);
      assert.equal(army.soldiers, participantSoldiers, `${scenario.slug} ${army.name}编队兵力应等于人物部曲之和`);
    }
    const groupRows = summary.locator('[data-soldiers]');
    assert.equal(await groupRows.count(), war.sides.reduce((sum, side) => sum + side.groups.length, 0), `${scenario.slug} UI应展示全部参战集团`);
    for (const side of war.sides) {
      for (const group of side.groups) {
        const row = summary.locator(`[data-faction-id="${group.factionId}"]`);
        if (group.factionId) {
          assert.equal(Number(await row.getAttribute('data-soldiers')), group.soldiers, `${scenario.slug} ${group.name}兵力应与投影一致`);
          assert.match((await row.textContent()) ?? '', new RegExp(`${group.name}.*${group.leader}`, 'u'), `${scenario.slug} 集团应显示首领`);
        }
      }
    }
    assert.doesNotMatch((await summary.textContent()) ?? '', /胜率|概率/u, `${scenario.slug} 战局不得伪造胜率`);
    await page.screenshot({ path: `${ARTIFACT_DIR}/${scenario.slug}-war-focus.png` });

    const observedArmyIds = new Set(projectedArmyIds);
    const movedArmyIds = new Set();
    let sawContact = war.contacts.length > 0;
    let sawBattle = Boolean(war.latestBattle);
    let movementShot = false;
    for (let step = 0; step < 24 && (!sawBattle || movedArmyIds.size < 2); step += 1) {
      const positions = new Map(armiesIn(war).map((army) => [army.id, army.regionId]));
      await advance(page, current.time.turn);
      await page.waitForTimeout(180);
      current = await snapshot(page);
      const nextWar = findWar(current, warId);
      if (!nextWar) break;
      war = nextWar;
      const nextArmies = armiesIn(war);
      for (const army of nextArmies) {
        observedArmyIds.add(army.id);
        if (positions.has(army.id) && positions.get(army.id) !== army.regionId) movedArmyIds.add(army.id);
      }
      sawContact ||= war.contacts.length > 0;
      sawBattle ||= Boolean(war.latestBattle);
      if (!movementShot && current.mapObjects.armies.some((army) => army.recentMovement?.current)) {
        await page.screenshot({ path: `${ARTIFACT_DIR}/${scenario.slug}-movement.png` });
        movementShot = true;
      }
    }
    assert.ok(observedArmyIds.size >= 2, `${scenario.slug} 应连续观察至少两支参战军队`);
    assert.ok(movedArmyIds.size >= 2, `${scenario.slug} 应看到至少两支军队的实际移动`);
    assert.equal(sawContact, true, `${scenario.slug} 接敌前必须有具名对手与地点`);
    assert.equal(sawBattle, true, `${scenario.slug} 必须看到一次战后反馈`);

    const latestSummary = page.getByTestId('war-focus-summary');
    await latestSummary.waitFor();
    const battleButton = latestSummary.locator('.war-focus-summary__battle');
    await battleButton.waitFor();
    assert.match((await battleButton.textContent()) ?? '', /战前.*攻损.*守损/u, `${scenario.slug} 战后应显示战前兵力与双方损失`);
    await page.screenshot({ path: `${ARTIFACT_DIR}/${scenario.slug}-battle.png` });
    if (scenario.viewport.width <= 840) {
      for (const selector of ['header button', '.war-focus-summary__battle']) {
        const rect = await latestSummary.locator(selector).first().evaluate((element) => {
          const box = element.getBoundingClientRect();
          return { width: box.width, height: box.height };
        });
        assert.ok(rect.width >= 44 && rect.height >= 44, `${scenario.slug} ${selector} 触控区应至少44px`);
      }
    }
    if (await battleButton.isEnabled()) {
      await battleButton.click();
      await page.locator('.observer-causal-layer').waitFor();
      await page.locator('.observer-causal-layer .observer-icon-button').click();
    }

    const firstGroup = latestSummary.locator('details').first();
    await firstGroup.locator('summary').click();
    const firstPersonButton = firstGroup.locator('[data-person-id]').first();
    const firstPersonId = await firstPersonButton.getAttribute('data-person-id');
    assert.ok(firstPersonId, `${scenario.slug} 集团应能展开到具体人物`);
    if (scenario.viewport.width <= 840) {
      const rect = await firstPersonButton.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return { width: box.width, height: box.height };
      });
      assert.ok(rect.width >= 44 && rect.height >= 44, `${scenario.slug} 人物军势触控区应至少44px`);
    }
    await firstPersonButton.click();
    await page.waitForFunction((personId) => {
      const state = JSON.parse(window.render_game_to_text());
      return state.interface.selected?.kind === 'person'
        && state.interface.selected.id === personId
        && state.interface.selectedDetail?.militaryForce?.soldiers >= 0;
    }, firstPersonId);

    const mapBounds = await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth }));
    assert.ok(mapBounds.documentWidth <= mapBounds.width + 1, `${scenario.slug} 不得横向溢出`);
    assert.deepEqual(errors, [], `${scenario.slug} 不得出现浏览器错误`);
    results.push({ scenario: scenario.slug, warId, turn: current.time.turn, observedArmies: observedArmyIds.size, movedArmies: movedArmyIds.size });
    await page.close();
  }
  console.log(JSON.stringify({ version, results, failures: [] }, null, 2));
} finally {
  await browser.close();
  if (server) await server.close();
}
