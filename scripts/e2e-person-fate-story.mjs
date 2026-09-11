import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { createWorld, advanceWorld, deserializeWorld, serializeWorld, readWorldFacts, readWorldHistory, validateWorld } from '../src/sim';

const PORT = Number(process.env.PERSON_FATE_E2E_PORT ?? 4212);
const externalUrl = process.env.PERSON_FATE_E2E_URL;
const appUrl = externalUrl ?? `http://127.0.0.1:${PORT}`;
const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
const artifactDir = `output/person-fate-e2e-v${version}`;
const fixtureRoot = new URL('./fixtures/person-fate/', import.meta.url);
const fixtures = JSON.parse(await readFile(new URL('manifest.json', fixtureRoot), 'utf8'));
const scenarios = [
  { slug: 'desktop-1440x900', viewport: { width: 1440, height: 900 } },
  { slug: 'mobile-390x844', viewport: { width: 390, height: 844 } },
];
const snapshot = page => page.evaluate(() => JSON.parse(window.render_game_to_text()));
async function openPerson(page, name, id) {
  const close = page.locator('[data-inspector-close]');
  if (await close.isVisible()) await close.click();
  await page.locator('[data-observer-view="people"]').click();
  await page.getByLabel('检索时人群像').fill(name);
  await page.locator(`[data-roster-id="${id}"]`).click();
  const inspector = page.locator('.observer-inspector[data-kind="person"]');
  await inspector.waitFor();
  assert.equal((await snapshot(page)).interface.selectedDetail.id, id);
  return inspector;
}
async function evidenceRoundtrip(page, eventId, baseline, path) {
  await page.locator('.observer-causal-layer').waitFor();
  assert.equal(await page.locator('.observer-causal-layer').getAttribute('data-event-id'), eventId);
  await page.screenshot({path});
  await page.keyboard.press('Escape');
  await page.locator('.observer-causal-layer').waitFor({state:'hidden'});
  const after = await snapshot(page);
  assert.equal(after.deterministicWorldHash, baseline.deterministicWorldHash);
  assert.equal(after.playback.running, false);
  assert.deepEqual(after.interface.mapViewport, baseline.interface.mapViewport);
}
async function verifyDeparted(page, person, world) {
  const inspector = await openPerson(page, person.name, person.id);
  const detail = (await snapshot(page)).interface.selectedDetail;
  assert.equal(detail.alive, false);
  const arc = detail.storyArc;
  assert.ok(arc.length >= 1 && arc.length <= 5);
  assert.equal(arc.at(-1).phase, 'ending');
  const facts = new Set(readWorldFacts(world).map(f=>f.id)), events = new Set(readWorldHistory(world).map(e=>e.id));
  for (const beat of arc) {
    assert.ok(beat.sourceFactIds.length || beat.sourceEventIds.length);
    assert.ok(beat.sourceFactIds.every(id=>facts.has(id)) && beat.sourceEventIds.every(id=>events.has(id)));
  }
  assert.equal(detail.militaryForce.status, '已解散');
  return inspector;
}
await mkdir(artifactDir, {recursive:true});
const server = externalUrl ? null : await createServer({logLevel:'error',server:{host:'127.0.0.1',port:PORT,strictPort:true}});
await server?.listen();
const browser = await chromium.launch({headless:true}), results=[];
try {
  for (const scenario of scenarios) {
    const page = await browser.newPage({viewport:scenario.viewport,hasTouch:scenario.viewport.width<840});
    const errors=[];
    page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.error(m.text());}});
    page.on('pageerror',e=>{errors.push(String(e));console.error(String(e));});
    await page.goto(appUrl,{waitUntil:'networkidle'});
    await page.getByLabel('世界种子').fill('乱世一将');
    await page.locator('#start-world').click();
    await page.locator('.world-map__canvas').waitFor();
    // Natural replay has no death, wound or comeback quota. Every checkpoint must agree.
    let source=createWorld('乱世一将');
    for(let turn=1;turn<=64;turn++) {
      source=advanceWorld(source);
      await page.getByRole('button',{name:'推进至下一季',exact:true}).click();
      await page.waitForFunction(t=>JSON.parse(window.render_game_to_text()).time.turn===t,turn);
      assert.equal((await snapshot(page)).deterministicWorldHash,source.hash);
      const wounds=source.facts.filter(f=>f.kind==='character_wounded');
      for(const army of source.armies) for(const id of army.participantIds) {
        assert.ok(!wounds.some(f=>f.payload.characterId===id && f.payload.recoveryUntilTurn>source.turn), '休养期不可作为在役参战者');
      }
    }
    assert.deepEqual(validateWorld(source),[]);
    const deaths=readWorldFacts(source).filter(f=>f.kind==='character_death' && f.payload.cause==='battle');
    for(const death of deaths) {
      const person=source.characters.find(c=>c.id===death.payload.characterId);
      await verifyDeparted(page,person,source); // Not all deaths belong in the top-three news.
    }
    results.push({scenario:scenario.slug,natural64Hash:source.hash,naturalBattleDeaths:deaths.length});
    await page.close();

    // Frozen complete natural histories guarantee UI coverage even in a quiet natural run.
    for(const fixture of fixtures) {
      const buffer=gunzipSync(Buffer.from(await readFile(new URL(`${fixture.key}.json.gz.base64`,fixtureRoot),'utf8'),'base64'));
      assert.equal(createHash('sha256').update(buffer).digest('hex'),fixture.sha256);
      const world=deserializeWorld(JSON.stringify(JSON.parse(buffer.toString()).world)), body=serializeWorld(world);
      assert.equal(world.hash,fixture.hash); assert.deepEqual(validateWorld(world),[]);
      const fact=readWorldFacts(world).find(f=>f.id===fixture.factId);
      assert.equal(fact.payload.characterId,fixture.personId);
      const p=await browser.newPage({viewport:scenario.viewport,hasTouch:scenario.viewport.width<840});
      p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});p.on('pageerror',e=>errors.push(String(e)));
      await p.goto(appUrl,{waitUntil:'networkidle'});
      await p.locator('input[type=file]').setInputFiles({name:'frozen.json',mimeType:'application/json',buffer});
      await p.locator('.world-map__canvas').waitFor({timeout:60000});
      await p.locator('.observer-toast').waitFor({state:'hidden'});
      assert.equal((await snapshot(p)).deterministicWorldHash,fixture.hash);
      if(fixture.key==='deceased') {
        assert.equal(fact.kind,'character_death'); assert.equal(fact.payload.cause,'battle');
        const event=readWorldHistory(world).find(e=>e.id===fixture.eventId);
        assert.ok(event.sourceFactIds.includes(fact.id));
        const baseline=await snapshot(p);
        await p.locator(`[data-testid="quarter-pulse-event"][data-event-id="${fixture.eventId}"]`).click();
        await evidenceRoundtrip(p,fixture.eventId,baseline,`${artifactDir}/${scenario.slug}-death-card-evidence.png`);
        const person=world.characters.find(c=>c.id===fixture.personId);
        const inspector=await verifyDeparted(p,person,world);
        await p.screenshot({path:`${artifactDir}/${scenario.slug}-deceased-story.png`});
        const selected=await snapshot(p), ending=selected.interface.selectedDetail.storyArc.at(-1);
        await inspector.locator('.observer-person-story button').filter({hasText:ending.title}).click();
        await evidenceRoundtrip(p,ending.primaryEventId??ending.primaryFactId,selected,`${artifactDir}/${scenario.slug}-person-ending-evidence.png`);
        await openPerson(p,person.name,person.id);
        assert.equal((await snapshot(p)).interface.selectedDetail.alive,false);
      } else {
        assert.equal(fact.kind,'character_wounded');
        await openPerson(p,fixture.name,fixture.personId);
        const detail=(await snapshot(p)).interface.selectedDetail;
        if(fixture.key==='wounded') {
          assert.match(detail.militaryForce.status,/休养/);assert.match(detail.militaryForce.formation,/退离/);
          await p.screenshot({path:`${artifactDir}/${scenario.slug}-wounded-resting.png`});
          await p.locator('[data-inspector-close]').click();
          await p.getByRole('button',{name:'推进至下一季',exact:true}).click();
          await p.waitForFunction(t=>JSON.parse(window.render_game_to_text()).time.turn===t,fixture.turn+1);
          assert.equal((await snapshot(p)).deterministicWorldHash,advanceWorld(world).hash);
          await openPerson(p,fixture.name,fixture.personId);
          assert.doesNotMatch((await snapshot(p)).interface.selectedDetail.militaryForce.formation,/^(自领|随)/);
        } else {
          assert.match(detail.militaryForce.formation,/^(自领|随)/);assert.doesNotMatch(detail.militaryForce.status,/休养/);
          assert.ok(fact.payload.recoveryUntilTurn<=world.turn);
          await p.screenshot({path:`${artifactDir}/${scenario.slug}-returned-to-service.png`});
        }
      }
      assert.equal(serializeWorld(world),body);
      assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      await writeFile(`${artifactDir}/${scenario.slug}-${fixture.key}-state.json`,JSON.stringify(await snapshot(p),null,2));
      await p.close();
    }
    assert.deepEqual(errors,[]);
  }
  assert.equal(results[0].natural64Hash,results[1].natural64Hash);
  await writeFile(`${artifactDir}/result.json`,JSON.stringify({version,results,fixtures,errors:[]},null,2));
  console.log(JSON.stringify({version,results,paths:['wound-rest-next-quarter','return-to-service','death-card','deceased-roster','ending-evidence-return']},null,2));
} catch(error) {
  for(const [i,page] of browser.contexts().flatMap(c=>c.pages()).entries()) {
    await page.screenshot({path:`${artifactDir}/failure-${i}.png`,fullPage:true});
    await writeFile(`${artifactDir}/failure-${i}.txt`,await page.locator('body').innerText());
  }
  throw error;
} finally {await browser.close();await server?.close();}
