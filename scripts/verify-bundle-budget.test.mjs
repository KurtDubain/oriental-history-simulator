import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {gzipSync} from 'node:zlib';

// Deterministic high-entropy bytes exercise the measurement, not JS parsing.
function payload(length,seed=17){
  const bytes=Buffer.alloc(length);let x=seed;
  for(let i=0;i<length;i++){x^=x<<13;x^=x>>>17;x^=x<<5;bytes[i]=x&255;}
  return bytes;
}
function check(t,assets){
  const root=mkdtempSync(join(tmpdir(),'ohs-bundle-budget-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  for(const [path,body]of Object.entries(assets)){
    const target=join(root,path);mkdirSync(resolve(target,'..'),{recursive:true});writeFileSync(target,body);
  }
  const result=spawnSync(process.execPath,['node_modules/vite-node/vite-node.mjs','scripts/verify-bundle-budget.ts',root],{encoding:'utf8'});
  return {...result,report:result.stdout.trim().startsWith('{')?JSON.parse(result.stdout):null};
}

test('430 KiB sums every nested JS chunk at gzip level 9; raw and CSS budgets stay unchanged',t=>{
  const a=payload(218000),b=payload(218000,23),css='body{color:black}';
  const r=check(t,{'assets/main.js':a,'assets/async/detail.js':b,'assets/app.css':css});
  assert.equal(r.status,0,r.stderr);
  assert.deepEqual(r.report.budgets,{singleJavaScriptRawBytes:585*1024,totalJavaScriptGzipBytes:430*1024,totalCssGzipBytes:40*1024});
  assert.equal(r.report.assets.javaScript.length,2);
  assert.equal(r.report.totals.javaScriptGzipBytes,gzipSync(a,{level:9}).length+gzipSync(b,{level:9}).length);
  assert.ok(r.report.totals.javaScriptGzipBytes>415*1024);
  assert.ok(r.report.totals.javaScriptGzipBytes<=430*1024);
});
test('a nested asynchronous chunk cannot evade the total JS limit',t=>{
  const r=check(t,{'main.js':payload(230000),'lazy/chunk.js':payload(230000,23),'app.css':''});
  assert.notEqual(r.status,0);assert.equal(r.report.violations.length,1);
  assert.match(r.report.violations[0],/JavaScript gzip total .* > 440320/);
});
test('single raw chunk ceiling is inclusive and unchanged',t=>{
  assert.equal(check(t,{'main.js':'x'.repeat(585*1024),'app.css':''}).status,0);
  const r=check(t,{'main.js':'x'.repeat(585*1024+1),'app.css':''});
  assert.notEqual(r.status,0);assert.match(r.report.violations[0],/raw 599041 > 599040/);
});
test('CSS gzip ceiling is unchanged',t=>{
  const r=check(t,{'main.js':'export {}','app.css':payload(42000)});
  assert.notEqual(r.status,0);assert.match(r.report.violations[0],/CSS gzip total .* > 40960/);
});
test('missing production JS or CSS is not accepted as a small build',t=>{
  for(const assets of [{'main.js':''},{'app.css':''}]){
    const r=check(t,assets);assert.notEqual(r.status,0);assert.match(r.stderr,/没有.*构建产物/);
  }
});
