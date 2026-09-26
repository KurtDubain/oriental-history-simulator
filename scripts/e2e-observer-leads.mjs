import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { preview } from 'vite';

const out=process.env.LEADS_E2E_OUTPUT ?? 'output/observer-leads-continuity';
const url=process.env.LEADS_E2E_URL ?? 'http://127.0.0.1:4522';
const server=process.env.LEADS_E2E_URL ? null : await preview({configFile:false,build:{outDir:'dist'},preview:{host:'127.0.0.1',port:4522,strictPort:true}});
const state=p=>p.evaluate(()=>JSON.parse(window.render_game_to_text()));
await mkdir(out,{recursive:true});const browser=await chromium.launch(),results=[];
try{for(const [label,width,height]of [['desktop',1440,900],['mobile',390,844]]){
  const c=await browser.newContext({viewport:{width,height},hasTouch:width<500,reducedMotion:'reduce'}),p=await c.newPage(),errors=[],mismatches=[],quarters=[];
  p.on('pageerror',e=>errors.push(String(e)));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  const shot=async name=>{await p.screenshot({path:`${out}/${label}-${name}.png`,animations:'disabled'});await writeFile(`${out}/${label}-${name}.json`,JSON.stringify(await state(p),null,2));await writeFile(`${out}/${label}-${name}.txt`,await p.locator('body').innerText());};
  const expand=async()=>{const b=p.getByTestId('observer-leads-mobile-toggle');if(await b.isVisible()){if(await b.getAttribute('aria-expanded')!=='true')await b.click();if(await b.getAttribute('data-fully-expanded')!=='true')await b.click();}};
  await p.goto(url,{waitUntil:'networkidle'});
  await p.locator('input[name=world-map-profile][value=contest-v01]').check();
  await p.getByLabel('世界种子').fill('秋潮折鼓-独验丙');await p.locator('#start-world').click();await p.locator('.world-map__canvas').waitFor();
  // Keep one mounted application and one world: importing T131 conceals the regression.
  for(let turn=1;turn<=131;turn++){
    await p.getByRole('button',{name:'推进至下一季',exact:true}).click();
    await p.waitForFunction(t=>JSON.parse(window.render_game_to_text()).time.turn===t,turn);
    const s=await state(p),expected=s.observer.focusLeads;
    const actual=await p.getByTestId('observer-lead').evaluateAll(nodes=>nodes.map(n=>({id:n.dataset.leadId,situationId:n.dataset.situationId??null,question:n.querySelector('[data-testid=observer-lead-question]').textContent})));
    const wanted=expected.map(l=>({id:l.id,situationId:l.situationId,question:l.question}));
    if(actual.length>3||new Set(actual.map(l=>l.id)).size!==actual.length||JSON.stringify(actual)!==JSON.stringify(wanted))mismatches.push({turn,actual,expected:wanted});
    quarters.push({turn,hash:s.deterministicWorldHash,actual,expected:wanted});
    if([32,55,131].includes(turn)){await expand();await shot(`T${turn}-leads`);}
    if(turn===32){
      const index=expected.findIndex(l=>l.situationType==='war_progress');assert(index>=0);
      await p.getByTestId('observer-lead').nth(index).locator('.observer-leads__inspect').click();
      const layer=p.locator('.situation-workbench-layer');await layer.waitFor();
      assert.equal(await layer.getAttribute('data-situation-id'),expected[index].situationId);
      await shot('T32-campaign');
      await p.locator('.situation-workbench__evidence summary').click();
      const entries=await p.locator('.situation-workbench__fact-list li').evaluateAll(nodes=>nodes.map(n=>({id:n.dataset.historyEntryId,title:n.querySelector('strong')?.textContent})));
      const currentDeath=entries.find(e=>expected[index].primarySourceFactIds.includes(e.id)&&/阵亡/.test(e.title));assert(currentDeath,'current campaign casualty must be in detailed evidence');
      const death=p.locator(`.situation-workbench__fact-list [data-history-entry-id="${currentDeath.id}"] button`);
      await death.scrollIntoViewIfNeeded();await death.click();await p.locator('.observer-causal-layer').waitFor();await shot('T32-death-evidence');
      await p.keyboard.press('Escape');await p.locator('.observer-causal-layer').waitFor({state:'hidden'});
      await p.locator('.situation-workbench__close').click();assert.equal((await state(p)).deterministicWorldHash,s.deterministicWorldHash);
    }
  }
  const s=await state(p),leads=s.observer.focusLeads;
  await writeFile(`${out}/${label}-quarters.json`,JSON.stringify({quarters,mismatches},null,2));
  for(let i=0;i<leads.length;i++){
    await expand();await p.getByTestId('observer-lead').nth(i).locator('.observer-leads__inspect').click();
    if(leads[i].situationId){
      const layer=p.locator('.situation-workbench-layer');
      await layer.waitFor();
      const actualId=await layer.count() ? await layer.getAttribute('data-situation-id') : null;
      if(actualId!==leads[i].situationId)mismatches.push({turn:131,click:i,expected:leads[i].situationId,actual:actualId});
      await shot(`T131-detail-${i}`);await p.keyboard.press('Escape');await layer.waitFor({state:'hidden'});
    }else{
      assert.equal((await state(p)).interface.selectedDetail.id,leads[i].target.id);
      await shot(`T131-detail-${i}`);
      const close=p.locator('[data-inspector-close]');
      if(await close.isVisible())await close.click();else await p.getByTestId('map-quick-look').getByRole('button',{name:'收起',exact:true}).click();
    }
    assert.equal((await state(p)).deterministicWorldHash,s.deterministicWorldHash);
  }
  assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  const row={label,physicalDevice:false,errors,mismatches,quarters};results.push(row);
  await writeFile(`${out}/results.json`,JSON.stringify(results,null,2));await shot('final');await c.close();
  assert.deepEqual(mismatches,[],`${label}: mounted cards must match current projection and click targets`);assert.deepEqual(errors,[]);
}}
finally{await browser.close();await server?.httpServer.close();}
console.log('Continuous T0→T131 observer leads: desktop and touch mobile passed.');
