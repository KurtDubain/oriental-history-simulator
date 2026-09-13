import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {chromium} from 'playwright';
import {preview} from 'vite';
// Committed, unmodified natural history shared with the person-fate acceptance tests.
// Fail before launching a server if this input is missing, damaged, or lacks its real history.
const fixtures=new URL('./fixtures/person-fate/',import.meta.url);
const fixture=JSON.parse(await readFile(new URL('manifest.json',fixtures),'utf8')).find(x=>x.key==='deceased');
assert(fixture,'historical media import requires the deceased fixture');
const buffer=gunzipSync(Buffer.from(await readFile(new URL(`${fixture.key}.json.gz.base64`,fixtures),'utf8'),'base64'));
assert.equal(createHash('sha256').update(buffer).digest('hex'),fixture.sha256);
const {world:history}=JSON.parse(buffer);
assert.equal(history.hash,fixture.hash);assert.equal(history.turn,fixture.turn);
const death=history.facts.find(f=>f.id===fixture.factId);
assert.equal(death?.kind,'character_death');assert.equal(death.payload.characterId,fixture.personId);
assert(history.facts.some(f=>f.id===death.payload.battleFactId&&f.kind==='battle'));
assert(history.history.some(e=>e.id===fixture.eventId&&e.sourceFactIds.includes(death.id)));
const url=process.env.OHS_E2E_URL??'http://127.0.0.1:4298';
const server=process.env.OHS_E2E_URL?null:await preview({preview:{host:'127.0.0.1',port:4298,strictPort:true}});
const version=JSON.parse(await readFile('package.json','utf8')).version;
const root=process.env.OHS_MEDIA_DIR??`output/media-e2e-v${version}`;
await mkdir(root,{recursive:true});
await writeFile(`${root}/fixture.json`,JSON.stringify({path:'scripts/fixtures/person-fate/deceased.json.gz.base64',...fixture,bytes:buffer.length},null,2));
// Test-only observation of real decoded audio in the native output graph, not a mocked player.
function audioProbe(){
 const qa=window.__audioQA={starts:[],levels:[],contexts:[]};
 const Base=window.AudioContext;
 window.AudioContext=class extends Base{
  constructor(...args){super(...args);qa.contexts.push(this);const gain=this.createGain.bind(this),source=this.createBufferSource.bind(this);
   this.createGain=()=>{const g=gain(),connect=g.connect.bind(g);g.connect=destination=>{if(destination===this.destination){const meter=this.createAnalyser();meter.fftSize=512;connect(meter);meter.connect(destination);const data=new Float32Array(512);const timer=setInterval(()=>{if(this.state==='closed'){clearInterval(timer);return;}meter.getFloatTimeDomainData(data);qa.levels.push({t:performance.now(),peak:Math.max(...data.map(Math.abs))});},20);return destination;}return connect(destination);};return g;};
   this.createBufferSource=()=>{const s=source(),start=s.start.bind(s);s.start=(...a)=>{qa.starts.push({t:performance.now(),duration:s.buffer?.duration});return start(...a);};return s;};
  }
 };
}
const browser=await chromium.launch({ignoreDefaultArgs:['--mute-audio']}),results=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try{for(const[label,width,height]of[['desktop',1440,900],['mobile',390,844]]){
 const context=await browser.newContext({viewport:{width,height},hasTouch:label==='mobile'}),page=await context.newPage(),errors=[],requests=[];
 await page.addInitScript(audioProbe);
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('request',r=>{if(r.url().includes('/media/'))requests.push(r.url());});
 const state=()=>page.evaluate(()=>JSON.parse(window.render_game_to_text()));
 const audio=()=>page.evaluate(()=>({starts:window.__audioQA.starts,levels:window.__audioQA.levels,contexts:window.__audioQA.contexts.map(c=>c.state)}));
 const shot=async name=>{await page.screenshot({path:`${root}/${label}-${name}.png`,animations:'disabled'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await writeFile(`${root}/${label}-${name}.json`,JSON.stringify(await state(),null,2));};
 const settings=async()=>{await page.locator('[data-settings-trigger="true"]').click();await page.getByTestId('settings-panel').waitFor();};
 const closeSettings=()=>page.getByTestId('settings-panel').getByRole('button',{name:'关闭设置',exact:true}).click();
 const reload=async()=>{await page.reload({waitUntil:'networkidle'});await page.locator('#continue-world').click();await page.locator('.world-map__canvas').waitFor();};
 const tool=async name=>{const b=page.getByRole('button',{name,exact:true});if(!await b.isVisible())await page.getByRole('button',{name:'打开更多工具',exact:true}).click();await b.click();};
 const save=async()=>{await tool('保存当前世界');await page.locator('.observer-toast').filter({hasText:'写入本地史册'}).waitFor();await page.locator('.observer-toast').waitFor({state:'hidden'});};
 await page.goto(url,{waitUntil:'networkidle'});await shot('start');assert(!requests.some(r=>r.endsWith('.mp3')||r.endsWith('river-seal.webp')));
 await page.locator('#start-world').click();await page.locator('.world-map__canvas').waitFor();await page.getByRole('button',{name:'推进至下一季',exact:true}).click();await shot('muted-quarter');assert.equal((await audio()).contexts.length,0);
 await settings();const before=(await state()).deterministicWorldHash;await page.getByLabel('提示音').check();await page.waitForFunction(()=>window.__audioQA.contexts[0]?.state==='running');
 await page.getByLabel('音量').fill('0.25');await page.getByRole('button',{name:'试听翻卷',exact:true}).click();await sleep(700);
 assert((await audio()).levels.some(x=>x.peak>.0001),'native output contains real samples');await shot('settings');assert.equal((await state()).deterministicWorldHash,before);
 await page.getByLabel('提示音').uncheck();const muteAt=await page.evaluate(()=>performance.now());await sleep(100);assert((await audio()).levels.filter(x=>x.t>muteAt+40).every(x=>x.peak===0));
 await page.getByLabel('书页装饰').uncheck();await closeSettings();const count=(await audio()).starts.length;
 await page.getByRole('button',{name:'推进至下一季',exact:true}).click();await sleep(400);assert.equal((await audio()).starts.length,count);
 // Preferences survive a reload; restoring itself must neither create nor play audio.
 await save();await reload();await settings();assert.equal(await page.getByLabel('提示音').isChecked(),false);assert.equal(await page.getByLabel('音量').inputValue(),'0.25');assert.equal(await page.getByLabel('书页装饰').isChecked(),false);assert.equal((await audio()).contexts.length,0);
 await page.getByLabel('提示音').check();await page.getByLabel('书页装饰').check();await closeSettings();
 const start=(await audio()).starts.length;
 await page.getByRole('button',{name:'推进至下一季',exact:true}).click();await sleep(500);assert.equal((await audio()).starts.length,start+1);
 // Persist enabled but reload quiet. A following real gesture can unlock again.
 await save();await page.reload({waitUntil:'networkidle'});assert.equal((await audio()).starts.length,0);assert.equal((await audio()).contexts.length,0);await page.locator('#continue-world').click();await page.locator('.world-map__canvas').waitFor();assert.equal((await audio()).starts.length,0);
 await settings();assert.equal(await page.getByLabel('提示音').isChecked(),true);await closeSettings();
 if(label==='mobile'){while((await state()).playback.speed!==8)await page.locator('.observer-speed-cycle').click();}
 else await page.getByRole('button',{name:'8 倍速推演',exact:true}).click();
 await page.getByRole('button',{name:/开始演变|继续演变/,exact:false}).first().click();await sleep(4200);await page.getByRole('button',{name:'暂停演变',exact:true}).click();await shot('automatic');
 const auto=(await audio()).starts;for(let i=1;i<auto.length;i++)assert(auto[i].t-auto[i-1].t>=2950,'automatic results must not form a sound barrage');
 await tool('返回世界书页');const prior=(await audio()).starts.length;
 await page.locator('input[type=file]').setInputFiles({name:'historical-media.portable.json',mimeType:'application/json',buffer});await page.locator('.world-map__canvas').waitFor();await page.locator('.world-start').waitFor({state:'hidden'});await page.locator('.observer-toast').waitFor({state:'hidden'});assert.equal((await audio()).starts.length,prior,'import may not broadcast old history');assert.equal((await state()).deterministicWorldHash,fixture.hash);
 const inspector=page.locator('[data-inspector-close]');if(await inspector.isVisible())await inspector.click();
 const hash=(await state()).deterministicWorldHash;
 const leads=page.locator('[data-observer-leads=true]'),toggle=leads.getByTestId('observer-leads-mobile-toggle');if(await toggle.isVisible())await toggle.click();
 const t=performance.now();await leads.locator('.observer-leads__situation-shortcut').click();await page.locator('.situation-workbench-layer').waitFor();const firstMs=performance.now()-t;await sleep(750);await shot('case');
 const readStarts=(await audio()).starts;assert.equal(readStarts.length,prior+1);assert(Math.abs(readStarts.at(-1).duration-.32)<.08,'old case uses paper, not historical event cue');
 await page.locator('.situation-workbench__evidence summary').click();await page.locator('.situation-workbench__fact-list button[data-event-id]').first().click();await page.locator('#observer-causal-drawer').waitFor();await shot('evidence');await page.keyboard.press('Escape');await page.locator('#observer-causal-drawer').waitFor({state:'hidden'});await page.locator('.situation-workbench__close').click();await shot('return');assert.equal((await state()).deterministicWorldHash,hash);
 assert.deepEqual(errors,[]);results.push({label,hash,firstMs,audio:await audio(),requests,errors});await writeFile(root+'/results.json',JSON.stringify(results,null,2));await context.close();
}}catch(e){for(const c of browser.contexts())for(const p of c.pages()){await p.screenshot({path:`${root}/failure.png`});await writeFile(`${root}/failure.txt`,await p.locator('body').innerText());}throw e;}finally{await browser.close();await new Promise(r=>server?server.httpServer.close(r):r());}
console.log(results.map(({label,hash,firstMs,errors})=>({label,hash,firstMs,errors})));
