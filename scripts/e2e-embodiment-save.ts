import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium, type Page } from 'playwright';
import { preview } from 'vite';
import { advanceWorld, advanceWorldBy, createWorld, deserializeWorld, projectEmbodiedActions, serializeWorld, validateWorld } from '../src/sim';
import { BUILD_TARGETS, assertPreviewArtifact } from './build-target.mjs';
import pkg from '../package.json';

const root = process.env.OHS_SAVE_HISTORY_DIR ?? `output/save-history-v${pkg.version}/browser`;
await mkdir(root, { recursive: true });
const initial = advanceWorldBy(createWorld('秋潮入卷-验收九月', 'contest-v01'), 8);
// This is an ordinary action contract, not a quota for a random death or promotion.
const action = projectEmbodiedActions(initial, 'c_014').find(a => a.available && a.command.kind === 'strengthen_relationship')!;
assert.equal(action.command.targetId, 'c_001');
const settled = advanceWorld(initial, { embodiedAction: action.command }), continued = advanceWorld(settled);
assert.deepEqual(validateWorld(settled), []);
assert.equal(serializeWorld(advanceWorld(deserializeWorld(serializeWorld(settled)))), serializeWorld(continued));
assertPreviewArtifact(BUILD_TARGETS.contest, JSON.parse(await readFile('dist-contest/version.json', 'utf8')), pkg.version);
const server = await preview({ configFile: false, build: { outDir: 'dist-contest' }, preview: { host: '127.0.0.1', port: 4394, strictPort: true } });
const browser = await chromium.launch();
const results: unknown[] = [];
const state = (p: Page): Promise<any> => p.evaluate(() => JSON.parse(window.render_game_to_text!()));
const tool = async (page: Page, name: string) => {
  const close = page.locator('[data-inspector-close]');
  if (await close.isVisible()) await close.click();
  const directory = page.getByRole('button', { name: '关闭时人群像', exact: true });
  if (await directory.isVisible()) await directory.click();
  const button = page.getByRole('button', { name, exact: true });
  if (!await button.isVisible()) await page.getByRole('button', { name: '打开更多工具', exact: true }).click();
  await button.click();
};
try {
  for (const [label, width, height] of [['desktop',1440,900], ['mobile',390,844]] as const) {
    const context = await browser.newContext({ viewport: { width,height }, hasTouch: label === 'mobile', reducedMotion:'reduce' });
    const page = await context.newPage(), errors: string[] = [];
    page.on('pageerror',e=>errors.push(String(e)));
    page.on('console',m=>{ if(m.type()==='error')errors.push(m.text()); });
    const shot = async (name:string) => {
      await page.screenshot({path:`${root}/${label}-${name}.png`,animations:'disabled'});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await writeFile(`${root}/${label}-${name}.json`,JSON.stringify(await state(page),null,2));
    };
    await page.goto('http://127.0.0.1:4394',{waitUntil:'networkidle'});
    await page.getByLabel('世界种子').fill(initial.seed);
    await page.locator('#start-world').click();await page.locator('.world-map__canvas').waitFor();
    for(let turn=1;turn<=8;turn++){
      await page.getByRole('button',{name:'推进至下一季',exact:true}).click();
      await page.waitForFunction(t=>JSON.parse(window.render_game_to_text!()).time.turn===t,turn);
    }
    assert.equal((await state(page)).deterministicWorldHash,initial.hash);
    await shot('t8-map');
    await page.locator('[data-observer-view="people"]').click();
    const row=page.locator('[data-roster-id="c_014"]');
    if(!await row.count())await page.locator('.roster-panel input[type="search"]').fill(initial.characters.find(p=>p.id==='c_014')!.name);
    await row.click();
    await page.getByRole('button',{name:'以此人入世',exact:true}).click();
    await page.locator('[data-embodied-action-kind="strengthen_relationship"]').click();
    assert.equal((await state(page)).observer.embodiment.pending.actionId,action.command.actionId);
    await shot('action-pending');
    await page.getByRole('button',{name:'推进至下一季',exact:true}).click();
    await page.waitForFunction(()=>JSON.parse(window.render_game_to_text!()).time.turn===9);
    assert.equal((await state(page)).deterministicWorldHash,settled.hash);
    await shot('action-settled');
    await page.getByRole('button',{name:'离开此人',exact:true}).click();
    await page.getByRole('tab',{name:'生平',exact:true}).click();
    await page.locator('.observer-inspector-records button').filter({hasText:'经营关系'}).first().click();
    await page.locator('#observer-causal-drawer').waitFor();
    await shot('action-evidence');
    assert.match(await page.locator('#observer-causal-drawer').innerText(),/信任|拜访/);
    await page.keyboard.press('Escape');await page.locator('#observer-causal-drawer').waitFor({state:'hidden'});
    assert.equal((await state(page)).deterministicWorldHash,settled.hash);
    await tool(page,'保存当前世界');
    await page.locator('.observer-toast').filter({hasText:'写入本地史册'}).waitFor();
    await page.reload({waitUntil:'networkidle'});await page.locator('#continue-world').click();
    await page.locator('.world-map__canvas').waitFor();
    assert.equal((await state(page)).deterministicWorldHash,settled.hash);
    await shot('restored');
    const pending=page.waitForEvent('download');await tool(page,'导出完整史册');
    const file=`${root}/${label}-t9.portable.json`;await (await pending).saveAs(file);
    const exported=deserializeWorld(JSON.stringify(JSON.parse(await readFile(file,'utf8')).world));
    assert.equal(serializeWorld(exported),serializeWorld(settled));
    await tool(page,'返回世界书页');
    await page.locator('input[type=file]').setInputFiles(file);
    await page.locator('.world-map__canvas').waitFor();await page.locator('.world-start').waitFor({state:'hidden'});
    assert.equal((await state(page)).deterministicWorldHash,settled.hash);
    await page.getByRole('button',{name:'推进至下一季',exact:true}).click();
    await page.waitForFunction(()=>JSON.parse(window.render_game_to_text!()).time.turn===10);
    assert.equal((await state(page)).deterministicWorldHash,continued.hash);
    await shot('imported-continued');
    const nextDownload=page.waitForEvent('download');await tool(page,'导出完整史册');
    const nextFile=`${root}/${label}-t10.portable.json`;await (await nextDownload).saveAs(nextFile);
    assert.equal(serializeWorld(deserializeWorld(JSON.stringify(JSON.parse(await readFile(nextFile,'utf8')).world))),serializeWorld(continued));
    assert.deepEqual(errors,[]);results.push({label,hash:continued.hash,restored:exported.hash,errors,bodyEqual:true});
    await context.close();
  }
} catch(e) {
  for(const context of browser.contexts())for(const page of context.pages()){
    await page.screenshot({path:`${root}/failure.png`});await writeFile(`${root}/failure.txt`,await page.locator('body').innerText());
  }
  throw e;
} finally { await browser.close();await new Promise<void>(r=>server.httpServer!.close(()=>r())); }
await writeFile(`${root}/results.json`,JSON.stringify(results,null,2));console.log(results);
