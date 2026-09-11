import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {chromium} from 'playwright';
import {createServer} from 'vite';

const version=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')).version;
const dir=process.env.READER_E2E_OUTPUT ?? `output/reader-layout-v${version}`;
const url=process.env.READER_E2E_URL ?? 'http://127.0.0.1:4286';
const server=process.env.READER_E2E_URL ? null : await createServer({logLevel:'error',server:{host:'127.0.0.1',port:4286,strictPort:true}});
const sizes=[[768,1024],[1440,900],[390,844],[760,900],[761,900],[840,900],[841,900],[1020,900],[1021,900]];
const state=page=>page.evaluate(()=>JSON.parse(window.render_game_to_text()));
const fixtureRoot=new URL('./fixtures/person-fate/',import.meta.url);
const deceased=JSON.parse(await readFile(new URL('manifest.json',fixtureRoot),'utf8')).find(f=>f.key==='deceased');
const buffer=gunzipSync(Buffer.from(await readFile(new URL('deceased.json.gz.base64',fixtureRoot),'utf8'),'base64'));
await mkdir(dir,{recursive:true});await server?.listen();
const browser=await chromium.launch(),results=[];
try {
 for(const [width,height] of sizes) {
  const page=await browser.newPage({viewport:{width,height},hasTouch:width<=840,reducedMotion:'reduce'}),errors=[];
  page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  const shot=async label=>{
   await page.evaluate(async()=>Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a=>a.finished.catch(()=>{}))));
   await page.screenshot({path:`${dir}/${width}x${height}-${label}.png`});
  };
  await page.goto(url,{waitUntil:'networkidle'});await page.getByLabel('世界种子').fill('春战副将');await page.locator('#start-world').click();
  await page.locator('.world-map__canvas').waitFor();
  for(let turn=1;turn<=4;turn++) {
   await page.getByRole('button',{name:'推进至下一季',exact:true}).click();
   await page.waitForFunction(t=>JSON.parse(window.render_game_to_text()).time.turn===t,turn);
  }
  await page.locator('[data-map-zoom-in=true]').click();
  const toggle=page.getByTestId('observer-leads-mobile-toggle');
  if(await toggle.isVisible() && await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();
  const before=await state(page);
  const war=before.observer.situations.open.find(s=>s.type==='war_progress');assert(war,'战争阅读前必须准备真实战争');
  await page.locator('[data-situation-workbench-trigger=true]').click();
  await page.locator('.situation-workbench__directory-toggle').click();
  await page.locator(`.situation-workbench__directory [data-situation-id="${war.id}"]`).click();
  const reader=page.locator('.situation-workbench__reader');
  const bounds=await reader.evaluate(e=>({reader:e.getBoundingClientRect().width,body:e.parentElement.getBoundingClientRect().width,columns:getComputedStyle(e.parentElement).gridTemplateColumns}));
  await shot('reading');
  await writeFile(`${dir}/${width}x${height}-layout.json`,JSON.stringify(bounds,null,2));
  assert(bounds.reader>=bounds.body-2,`目录隐藏后正文应铺满可用区域：${JSON.stringify(bounds)}`);
  await page.locator('.situation-workbench__directory-toggle').click();
  assert.equal(await reader.isVisible(),false);
  await shot('directory');
  await page.locator(`.situation-workbench__directory [data-situation-id="${war.id}"]`).click();
  let entry=page.locator('.situation-workbench__timeline button').first();
  if(!await entry.count()) {
   await page.locator('.situation-workbench__evidence > summary').click();
   entry=page.locator('.situation-workbench__evidence button').first();
  }
  assert(await entry.count(),'必须真实打开证据，不能空路径通过');
  await entry.evaluate(e=>e.scrollIntoView({block:'center',behavior:'instant'}));
  const scroll=await reader.evaluate(e=>e.scrollTop),id=await entry.getAttribute('data-event-id');
  await entry.click();await page.locator('.observer-causal-layer').waitFor();
  assert.equal(await page.locator('.observer-causal-layer').getAttribute('data-event-id'),id);
  await shot('evidence');await page.keyboard.press('Escape');
  await page.locator('.observer-causal-layer').waitFor({state:'hidden'});
  assert.equal((await state(page)).observer.selectedSituationId,war.id);
  const returnedScroll=await reader.evaluate(e=>e.scrollTop);
  // The existing reader restores the selected dossier at its heading; record this baseline.
  if(!await entry.isVisible()) await page.locator('.situation-workbench__evidence > summary').click();
  await entry.evaluate(e=>e.scrollIntoView({block:'center',behavior:'instant'}));
  assert(await entry.isVisible(),'返回后原证据仍可滚动到达');
  assert.equal(await entry.getAttribute('data-event-id'),id);
  await page.locator('.situation-workbench__close').click();
  const returned=await state(page);
  assert.equal(returned.interface.overlay,before.interface.overlay);
  assert.deepEqual(returned.interface.mapViewport,before.interface.mapViewport);
  assert.equal(returned.deterministicWorldHash,before.deterministicWorldHash);
  assert.equal(returned.playback.running,false);await shot('returned');
  if([1440,768,390].includes(width)) {
   await page.reload({waitUntil:'networkidle'});
   await page.locator('input[type=file]').setInputFiles({name:'deceased.json',mimeType:'application/json',buffer});
   await page.locator('.world-map__canvas').waitFor();await page.locator('.observer-toast').waitFor({state:'hidden'});
   await page.locator('[data-observer-view=people]').click();await page.getByLabel('检索时人群像').fill(deceased.name);
   await page.locator(`[data-roster-id="${deceased.personId}"]`).click();
   const person=await state(page);assert.equal(person.interface.selectedDetail.alive,false);
   await shot('person');
   const beat=person.interface.selectedDetail.storyArc.at(-1);
   await page.locator('.observer-person-story button').filter({hasText:beat.title}).click();
   await page.locator('.observer-causal-layer').waitFor();
   assert.equal(await page.locator('.observer-causal-layer').getAttribute('data-event-id'),beat.primaryEventId??beat.primaryFactId);
   await shot('person-evidence');await page.keyboard.press('Escape');
   await page.locator('.observer-causal-layer').waitFor({state:'hidden'});
   assert.equal((await state(page)).interface.selectedDetail.id,deceased.personId);
   assert.equal((await state(page)).deterministicWorldHash,deceased.hash);
  }
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);
  results.push({width,height,bounds,scroll,returnedScroll,warId:war.id,hash:before.deterministicWorldHash,errors});
  await writeFile(`${dir}/${width}x${height}-state.json`,JSON.stringify(await state(page),null,2));await page.close();
 }
 await writeFile(`${dir}/result.json`,JSON.stringify(results,null,2));console.log('Reader layout passed: 9 viewports; war/chronicle/person evidence return.');
}finally{await browser.close();await server?.close();}
