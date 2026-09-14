import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { resolveBuildTarget, assertPreviewArtifact } from './build-target.mjs';

// All inputs are the four current production builds; saves are made through the UI.
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const root = process.env.OHS_ICP_E2E_DIR ?? `output/icp-footer-v${version}/browser`;
const port = Number(process.env.OHS_ICP_E2E_PORT ?? 5391);
const filingText = '冀ICP备2023028175号-1';
const filingUrl = 'https://beian.miit.gov.cn/';
const results = [], hashes = new Set();
await mkdir(root, { recursive: true });
const browser = await chromium.launch();
try {
  for (const enabled of [false, true]) for (const edition of ['personal', 'contest']) {
    const target = resolveBuildTarget(edition, { OHS_TENCENT_ICP: enabled ? '1' : '0' });
    const metadata = JSON.parse(await readFile(`${target.outDir}/version.json`, 'utf8'));
    assertPreviewArtifact(target, metadata, version);
    assert.equal(metadata.icpFooter, enabled);
    const server = await preview({ configFile: false, build: { outDir: target.outDir }, preview: { host: '127.0.0.1', port, strictPort: true } });
    try {
      const viewports = [['desktop', 1440, 900], ['mobile', 390, 844]];
      if (enabled) viewports.push(['short', 1280, 720]);
      for (const [size, width, height] of viewports) {
        const key = `${edition}-${enabled ? 'tencent' : 'default'}-${size}`;
        const context = await browser.newContext({ viewport: { width, height }, hasTouch: size === 'mobile', reducedMotion: 'reduce' });
        const page = await context.newPage(), errors = [], homes = [];
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        page.on('pageerror', error => errors.push(String(error)));
        const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
        const shot = async name => {
          await page.screenshot({ path: `${root}/${key}-${name}.png`, animations: 'disabled' });
          await writeFile(`${root}/${key}-${name}.json`, JSON.stringify(await state(), null, 2));
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'document does not overflow');
        };
        const home = async saved => {
          await page.locator(saved ? '#continue-world' : '#start-world').waitFor();
          assert.equal(await page.locator('#continue-world').count(), saved ? 1 : 0);
          const link = page.getByRole('link', { name: filingText, exact: true });
          assert.equal(await link.count(), enabled ? 1 : 0);
          assert.equal((await state()).availableMapProfiles.length, edition === 'personal' ? 2 : 1);
          if (enabled) {
            assert.equal(await link.getAttribute('href'), filingUrl);
            // A shorter window may scroll the home page, but must never overlay its actions.
            if (size === 'short') await link.scrollIntoViewIfNeeded();
            const geometry = await link.evaluate(el => {
              const box = el.getBoundingClientRect(), range = document.createRange();
              range.selectNodeContents(el);
              const text = range.getBoundingClientRect(), style = getComputedStyle(el);
              return { x: box.x, y: box.y, width: box.width, height: box.height, textWidth: text.width,
                fontSize: style.fontSize, singleLine: range.getClientRects().length === 1,
                inViewport: box.top >= 0 && box.bottom <= innerHeight && text.left >= 0 && text.right <= innerWidth,
                centered: Math.abs((text.left + text.right) / 2 - innerWidth / 2) < 1,
                hit: el.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)),
                overflow: el.closest('.world-start').scrollWidth > el.closest('.world-start').clientWidth };
            });
            assert(geometry.inViewport && geometry.centered && geometry.hit && geometry.singleLine && !geometry.overflow, JSON.stringify(geometry));
            assert(geometry.height >= 44 && Number.parseFloat(geometry.fontSize) >= 11);
            homes.push({ saved, ...geometry });
          }
          await shot(saved ? 'saved-home' : 'first-home');
        };
        try {
          await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
          await home(false);
          if (enabled) {
            // Verify actual link navigation without relying on the external service/network.
            await context.route(filingUrl, route => route.fulfill({ contentType: 'text/html', body: '<title>Link target check</title>' }));
            const popup = context.waitForEvent('page');
            await page.getByRole('link', { name: filingText, exact: true }).click();
            const opened = await popup;
            await opened.waitForLoadState();
            assert.equal(opened.url(), filingUrl);
            await opened.close();
          }
          await page.locator('[data-map-profile-id="contest-v01"]').click();
          await page.getByLabel('世界种子').fill('页脚只读-验收');
          await page.locator('#start-world').click();
          await page.locator('.world-map__canvas').waitFor();
          assert.equal(await page.getByRole('link', { name: filingText }).count(), 0, 'footer does not enter the map');
          await page.getByRole('button', { name: '推进至下一季', exact: true }).click();
          await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).time.turn === 1);
          const hash = (await state()).deterministicWorldHash;
          hashes.add(hash);
          await shot('map');
          const save = page.getByRole('button', { name: '保存当前世界', exact: true });
          if (!await save.isVisible()) await page.getByRole('button', { name: '打开更多工具', exact: true }).click();
          await save.click();
          await page.locator('.observer-toast').filter({ hasText: '写入本地史册' }).waitFor();
          await page.reload({ waitUntil: 'networkidle' });
          await home(true);
          await page.locator('#continue-world').click();
          await page.locator('.world-map__canvas').waitFor();
          assert.equal((await state()).deterministicWorldHash, hash, 'save and resume keep the world');
          assert.deepEqual(errors, []);
          results.push({ key, outDir: target.outDir, metadata, hash, homes, errors });
          process.stdout.write(`${key}: fresh / saved / link / resume passed\n`);
        } catch (error) {
          await page.screenshot({ path: `${root}/${key}-failure.png` });
          await writeFile(`${root}/${key}-failure.json`, JSON.stringify({ error: String(error), errors, state: await state() }, null, 2));
          throw error;
        } finally { await context.close(); }
      }
    } finally { await new Promise(resolve => server.httpServer.close(resolve)); }
  }
  assert.equal(hashes.size, 1, 'both editions and footer variants produce the same contest-map T1');
} finally {
  await browser.close();
  await writeFile(`${root}/results.json`, JSON.stringify(results, null, 2));
}
