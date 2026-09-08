import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const mode = process.env.PLAYER_CLOSE_MODE ?? 'after';
const dir = `output/player-close-v1.29.3/${mode}`;
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 840 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto('http://127.0.0.1:4174', { waitUntil: 'networkidle' });
    await page.getByLabel('世界种子').fill('沧衡-甲子');
    await page.locator('#start-world').click();
    await page.locator('.world-map__canvas').waitFor();
    const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
    const shot = async (suffix) => {
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${dir}/${name}-${suffix}.png` });
    };
    await shot('initial');
    await page.locator('[data-map-zoom-in="true"]').click();
    await shot('regional');
    await page.locator('[data-map-reset="true"]').click();
    const pauses = [];
    for (let turn = 1; turn <= (mode === 'before' ? 109 : 88); turn++) {
      await page.getByRole('button', { name: '推进至下一季', exact: true }).evaluate(button => button.click());
      await page.waitForFunction(expected => JSON.parse(window.render_game_to_text()).time.turn === expected, turn);
      if ([24, 64, 96, 109].includes(turn)) await writeFile(`${dir}/${name}-t${turn}.json`, JSON.stringify(await state(), null, 2));
    }
    if (mode !== 'before') {
      const lead = { situationId: 'situation_000032' };
      await page.locator('[data-situation-workbench-trigger]').first().click();
      await page.locator('.situation-workbench__directory-toggle').click();
      await page.locator(`.situation-workbench__directory [data-situation-id="${lead.situationId}"]`).click();
      await page.getByRole('button', { name: '关注：雍攻沧', exact: true }).click();
      assert.equal(await page.locator('.situation-workbench__directory').isVisible(), false);
      await shot('current-case');
      await page.getByRole('button', { name: '回到舆图看战线' }).click();
      await shot('war-focus');
      const focused = await state();
      const formation = focused.mapObjects.armies.find(army => army.participants.length > 1);
      assert.ok(formation);
      const point = await page.evaluate(({ position, camera }) => {
        const canvas = document.querySelector('.world-map__canvas');
        const map = document.querySelector('.world-map');
        const width = canvas.clientWidth, height = canvas.clientHeight;
        const scale = Math.min((width - 16) / (width < 620 ? 800 : 1000), (height - 16) / 700);
        return { x: (width - 1000 * scale) / 2 + camera.panX + Number(map.dataset.focusOffsetX ?? 0) + position[0] * scale * camera.zoom,
          y: (height - 700 * scale) / 2 + camera.panY + Number(map.dataset.focusOffsetY ?? 0) + position[1] * scale * camera.zoom };
      }, { position: formation.position, camera: focused.interface.mapViewport });
      await page.locator('.world-map__canvas').click({ position: point });
      assert.equal((await state()).mapObjects.expandedFormationId, formation.id);
      assert.ok((await state()).mapObjects.personalForces.every(person => person.formationId === formation.id));
      await shot('formation-expanded');
      if (width < 840) await page.getByTestId('map-quick-look-details').click();
      await page.locator('[data-inspector-close]').click();
      if (width >= 840) await page.getByRole('button', { name: '8 倍速推演' }).click();
      else while ((await state()).playback.speed !== 8) await page.locator('.observer-speed-cycle').click();
      while ((await state()).time.turn < 109) {
        if (!(await state()).playback.running) await page.getByRole('button', { name: '继续演变' }).click();
        await page.evaluate(() => window.advanceTime(240));
        await page.waitForTimeout(30);
        const current = await state();
        if (!current.playback.running) {
          const receipt = page.getByTestId('watch-pause-receipt');
          assert.equal(await receipt.getAttribute('data-situation-id'), lead.situationId);
          const text = await receipt.innerText();
          pauses.push({ turn: current.time.turn, text, observer: current.observer });
          await shot(`watch-paused-t${current.time.turn}`);
          if (width < 840) {
            const [dateBox, receiptBox] = await Promise.all([page.locator('.observer-date').boundingBox(), receipt.boundingBox()]);
            assert.ok(dateBox.y + dateBox.height <= receiptBox.y, '纪年不应落入停表回执');
          }
          const changedLead = page.locator(`[data-testid="observer-lead"][data-situation-id="${lead.situationId}"]`);
          if (await changedLead.count()) assert.equal(await changedLead.getByTestId('observer-lead-watch').getAttribute('aria-pressed'), 'true');
          await receipt.click();
          if (current.observer.lastPauseSituationChange === 'core-character-death') {
            await page.locator('.observer-causal-drawer').waitFor();
            assert.match(await page.locator('.observer-causal-drawer').innerText(), /裴德和.*(逝世|去世|病亡|离世)/s);
            assert.doesNotMatch(await page.locator('.observer-causal-drawer').innerText(), /死亡裁决|alive:|alive：|personalForce\.soldiers/);
            await page.locator('.observer-causal-drawer__consequence > summary').click();
            assert.match(await page.locator('.observer-causal-drawer__consequence').innerText(), /alive/);
            await page.locator('.observer-causal-drawer__consequence > summary').click();
            await shot(`watch-reading-t${current.time.turn}`);
            await page.locator('.observer-causal-drawer').getByRole('button', { name: '关闭何故与证据' }).click();
          } else {
            await page.locator('.situation-workbench__reader').waitFor();
            assert.equal(await page.locator('.situation-workbench__directory').isVisible(), false);
            await shot(`watch-reading-t${current.time.turn}`);
            await page.locator('.situation-workbench__close').click();
          }
          assert.equal((await state()).playback.running, false);
          assert.equal(await receipt.count(), 0);
        }
      }
      if ((await state()).playback.running) await page.getByRole('button', { name: '暂停演变' }).click();
      assert.ok(pauses.some(pause => pause.text.includes('已经结束')));
      assert.ok(pauses.some(pause => pause.text.includes('广州')));
      assert.equal((await state()).deterministicWorldHash, '06cbe5a7949a91ed');
      const baseline = await readFile(`output/player-close-v1.29.3/before/${name}-t109.json`, 'utf8').then(JSON.parse).catch(() => null);
      if (baseline) {
        assert.deepEqual((await state()).totals, baseline.totals);
        assert.deepEqual((await state()).recentHistory, baseline.recentHistory);
      }
      await writeFile(`${dir}/${name}-t109.json`, JSON.stringify(await state(), null, 2));
    }
    await shot('t109');
    await page.locator('[data-observer-view="people"]').click();
    await page.getByLabel('检索时人群像').fill('李维宣');
    await page.locator('[data-roster-id]').filter({ hasText: '李维宣' }).first().click();
    await shot('person');
    await writeFile(`${dir}/${name}-person.json`, JSON.stringify(await state(), null, 2));
    await writeFile(`${dir}/${name}-person.txt`, await page.locator('.observer-inspector').innerText());
    if (mode !== 'before') {
      await page.getByRole('tab', { name: '生平', exact: true }).click();
      await page.getByRole('button', { name: '读完整人物传' }).click();
      await shot('person-archive');
      while (await page.locator('.history-archive__more-records').count()) await page.locator('.history-archive__more-records').click();
      const archive = await page.locator('.history-archive').innerText();
      await writeFile(`${dir}/${name}-archive.txt`, archive);
      assert.doesNotMatch(archive, /c_\d+|具名出生是|不重复增加州域人口|进入事实档案|可核验|经职位、支持与风险审查/);
      assert.equal((archive.match(/首次参战 ·/g) ?? []).length, 1);
      assert.equal((archive.match(/首次以副将身份参战 ·/g) ?? []).length, 1);
      await page.getByRole('button', { name: '关闭李维宣传', exact: true }).click();
      await page.getByRole('tab', { name: '关系', exact: true }).click();
      await shot('person-relations');
      assert.doesNotMatch(await page.locator('.observer-inspector').innerText(), /c_\d+/);
      await page.locator('[data-inspector-close]').click();
      await page.locator('[data-observer-view="world"]').click();
      const exitWar = page.getByRole('button', { name: '退出战局聚焦' });
      if (await exitWar.isVisible()) await exitWar.click();
      await page.locator('[data-situation-workbench-trigger]').first().click();
      await page.locator('.situation-workbench__directory-toggle').click();
      await page.locator('.situation-workbench__directory [data-situation-id="situation_000019"]').click();
      await shot('inheritance-case');
      assert.doesNotMatch(await page.getByTestId('situation-current-action').innerText(), /任广州中军主帅|存续状态/);
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.deepEqual(errors, []);
    results.push({ name, turn: (await state()).time.turn, hash: (await state()).deterministicWorldHash, pauses, errors });
    await page.close();
  }
  await writeFile(`${dir}/results.json`, JSON.stringify(results, null, 2));
  console.log(results);
} finally { await browser.close(); }
