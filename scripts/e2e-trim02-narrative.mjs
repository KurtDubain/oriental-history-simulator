import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const PORT = Number(process.env.TRIM02_E2E_PORT ?? 4198);
const externalUrl = process.env.TRIM02_E2E_URL;
const APP_URL = externalUrl ?? `http://127.0.0.1:${PORT}`;
const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
const ARTIFACT_DIR = `output/trim02-narrative-e2e-v${version}`;
const scenarios = [
  { slug: 'desktop-1440x900', viewport: { width: 1440, height: 900 } },
  { slug: 'mobile-390x844', viewport: { width: 390, height: 844 } },
];
const FORBIDDEN = /张力|势头|升温|降温|萌芽|临界|阶段变化|阶段转折|结构信号|推动因素|会不会|能否|还是/u;

await mkdir(ARTIFACT_DIR, { recursive: true });
const server = externalUrl ? null : await createServer({
  root: new URL('..', import.meta.url).pathname,
  logLevel: 'error',
  server: { host: '127.0.0.1', port: PORT, strictPort: true },
});
if (server) await server.listen();

const browser = await chromium.launch({ headless: true });
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
    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    await page.getByLabel('世界种子').fill('沧衡-甲子');
    await page.locator('#start-world').click();
    await page.waitForSelector('.world-map__canvas');
    for (let turn = 0; turn < 8; turn += 1) {
      await page.getByRole('button', { name: '推进至下一季', exact: true }).click();
      await page.waitForFunction((expected) => JSON.parse(window.render_game_to_text()).time.turn === expected, turn + 1);
    }

    const baseline = JSON.parse(await page.evaluate(() => window.render_game_to_text()));
    const pulse = page.getByTestId('quarter-pulse');
    assert.ok(Number(await pulse.getAttribute('data-story-count')) <= 3, `${scenario.slug} 季报最多三件事`);
    assert.equal(await page.getByTestId('quarter-pulse-situation').count(), 0, `${scenario.slug} 裸局势走势不得进入季报`);
    assert.doesNotMatch((await pulse.textContent()) ?? '', FORBIDDEN, `${scenario.slug} 季报不得泄漏后台阶段词`);

    const leads = page.locator('[data-observer-leads=true]');
    assert.equal(await leads.locator('[data-testid=observer-lead]').count(), 3, `${scenario.slug} 应保留三条观察线索`);
    assert.equal(await leads.locator('[data-stage]').count(), 0, `${scenario.slug} 三问不得展示检测阶段`);
    assert.equal(await leads.locator('[data-testid=observer-lead-next]').count(), 0, `${scenario.slug} 三问不得补写未来预测`);
    assert.doesNotMatch((await leads.textContent()) ?? '', FORBIDDEN, `${scenario.slug} 三问应讲当前事实`);
    if (scenario.viewport.width <= 840 && await leads.getAttribute('data-mobile-open') === null) {
      await leads.getByTestId('observer-leads-mobile-toggle').click();
    }
    const visibleLeadFacts = leads.locator('[data-testid=observer-lead-fact]:visible');
    assert.ok(await visibleLeadFacts.count() >= 1, `${scenario.slug} 三问至少显示一条回答问题的当前事实`);

    await leads.locator('.observer-leads__situation-shortcut').click();
    const workbench = page.locator('.situation-workbench-layer');
    await workbench.waitFor();
    assert.equal(await workbench.locator('.situation-workbench__phase').count(), 0, `${scenario.slug} 卷宗不得显示阶段轨道`);
    assert.equal(await workbench.locator('.situation-workbench__audit').count(), 0, `${scenario.slug} 普通卷宗不得显示推演底账`);
    assert.equal(await workbench.getByTestId('situation-current-action').count(), 1, `${scenario.slug} 卷首只讲一件最近实事`);
    assert.ok(await workbench.getByTestId('situation-direct-change').locator('dd').count() <= 4, `${scenario.slug} 直接变化必须有界`);
    assert.equal(await workbench.getByTestId('situation-participants-disclosure').getAttribute('open'), null, `${scenario.slug} 相关各方默认折叠`);
    const sceneIds = await workbench.locator('[data-narrative-scene-id]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-narrative-scene-id')));
    assert.equal(sceneIds.length, new Set(sceneIds).size, `${scenario.slug} 同一场面不得在卷首与沿革重复`);
    assert.doesNotMatch((await workbench.textContent()) ?? '', FORBIDDEN, `${scenario.slug} 普通卷宗不得泄漏检测语言`);

    const after = JSON.parse(await page.evaluate(() => window.render_game_to_text()));
    assert.equal(after.time.turn, baseline.time.turn, `${scenario.slug} 查阅卷宗不得推进季度`);
    assert.equal(after.deterministicWorldHash, baseline.deterministicWorldHash, `${scenario.slug} 查阅卷宗不得改变世界`);
    const layout = await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth }));
    assert.ok(layout.documentWidth <= layout.width + 1, `${scenario.slug} 不得横向溢出`);
    if (scenario.viewport.width <= 840) {
      for (const selector of ['.situation-workbench__watch', '.situation-workbench__directory-toggle', '.situation-workbench__close']) {
        const rect = await workbench.locator(selector).evaluate((element) => {
          const box = element.getBoundingClientRect();
          return { width: box.width, height: box.height };
        });
        assert.ok(
          rect.width >= 44 && rect.height >= 44,
          `${scenario.slug} ${selector} 至少 44px，实际 ${JSON.stringify(rect)}`,
        );
      }
    }
    await page.screenshot({ path: `${ARTIFACT_DIR}/${scenario.slug}.png` });
    assert.deepEqual(errors, [], `${scenario.slug} 不得出现浏览器错误`);
    await page.close();
  }
  console.log(JSON.stringify({ version, scenarios: scenarios.map((scenario) => scenario.slug), failures: [] }, null, 2));
} finally {
  await browser.close();
  if (server) await server.close();
}
