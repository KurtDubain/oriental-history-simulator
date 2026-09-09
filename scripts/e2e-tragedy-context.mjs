import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const root='output/tragedy-v1.29.7/context-browser';
await mkdir(root,{recursive:true});
const browser=await chromium.launch();
try {
  for(const [label,viewport] of [['desktop',{width:1440,height:900}],['mobile',{width:390,height:844}]]) {
    for(const [caseName,file] of [['T160','output/tragedy-v1.29.7/legacy-T160.portable.json'],['authority','output/playwright/ordinary-v1296/world-T400.json']]) {
      const page=await browser.newPage({viewport}); const errors=[];
      page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
      await page.goto('http://127.0.0.1:4174',{waitUntil:'networkidle'});
      await page.locator('input[type=file]').setInputFiles(file);
      await page.locator('.world-map__canvas').waitFor({timeout:60000});
      const state=await page.evaluate(()=>JSON.parse(window.render_game_to_text()));
      if(caseName==='T160') {
        const toggle=page.getByTestId('observer-leads-mobile-toggle');
        if(await toggle.isVisible()) {await toggle.click();await toggle.click();}
        const general=state.observer.focusLeads.find(lead=>lead.question.includes('独孤若衡'));
        assert(general, '旧T160应保留独孤若衡自己的军权线索');
        assert(!/出任洛阳君主/.test(`${general.question} ${general.evidence.join(' ')}`), '不得把谢清和的君主任命接到独孤若衡');
        await page.screenshot({path:`${root}/${label}-${caseName}-leads.png`,fullPage:true});
        const card=page.getByTestId('observer-lead').first();
        if(await card.count()) {await card.locator('.observer-leads__inspect').click();}
      } else {
        await page.locator('[data-observer-view="powers"]').click();
        const row=page.locator('[data-roster-id]').filter({hasText:'沧海盟'}).first();
        await row.click();
        await page.locator('.observer-inspector').waitFor();
      }
      await page.waitForTimeout(300);
      await page.screenshot({path:`${root}/${label}-${caseName}-detail.png`,fullPage:true});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      const final=await page.evaluate(()=>JSON.parse(window.render_game_to_text()));
      assert.equal(final.deterministicWorldHash,state.deterministicWorldHash);assert.deepEqual(errors,[]);
      await writeFile(`${root}/${label}-${caseName}.json`,JSON.stringify({state,final,errors},null,2));
      await page.close();
    }
  }
}finally{await browser.close()}
