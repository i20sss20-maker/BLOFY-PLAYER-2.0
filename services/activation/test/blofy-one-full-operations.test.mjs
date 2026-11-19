import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Script} from 'node:vm';
const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('BLOFY ONE integrates sources, Content Hub, distributors and releases on the same page',async()=>{
  const [html,js,css,handler]=await Promise.all([
    read('web/blofy-one.html'),read('web/blofy-one-operations.js'),
    read('web/blofy-one-operations.css'),read('src/admin-console-hook.mjs')
  ]);
  assert.doesNotThrow(()=>new Script(js));
  for(const id of [
    'one-sources','one-storage','one-distributors','one-releases','one-issue',
    'one-sources-search','one-sources-refresh','one-sources-rows',
    'one-src-total','one-src-active','one-src-published','one-src-alerts',
    'one-storage-refresh','one-hub-database','one-hub-bucket','one-hub-runs',
    'one-distributors-rows','one-dist-total','one-dist-active',
    'one-releases-rows','one-release-primary','one-release-count',
    'one-issue-form','one-issue-submit','one-issue-code-list','one-issue-result'
  ])assert.ok(html.includes('id="'+id+'"'),id);
  const ids=[...html.matchAll(/\sid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(new Set(ids).size,ids.length,'no duplicate HTML ids');
  const split=html.includes('class="one-panel-switch"');
  for(const href of ['#one-sources','#one-storage','#one-distributors',...(!split?['#one-releases']:[])])
    assert.ok(html.includes('href="'+href+'"'),href);
  if(split)assert.match(html,/href="\/admin"/);
  assert.equal(html.split('/blofy-one-stream.js?v=20261118-v1').length-1,1);
  for(const asset of ['/blofy-one-operations.js','/blofy-one-operations.css']){
    assert.ok(html.includes(asset+'?v=20261118-v1'));
    assert.ok(handler.includes("['"+asset+"'"));
  }
  assert.match(css,/@media\(max-width:680px\)/);
  assert.match(css,/\.one-issue-form/);
});
test('operator panels use real read-only scoped existing endpoints without fabricated amounts',async()=>{
  const js=await read('web/blofy-one-operations.js');
  for(const route of [
    '/api/v1/admin/xtream/servers',
    '/api/v1/admin/content-hub/status',
    '/operator/api/distributors',
    '/api/v1/admin/experience/releases'
  ])assert.ok(js.includes(route),route);
  assert.match(js,/credentials:'same-origin',cache:'no-store'/);
  assert.match(js,/sourceState\(s\)/);
  assert.match(js,/row\.status\|\|row\.state/);
  assert.match(js,/row\.updatedAt\|\|row\.completedAt\|\|row\.createdAt/);
  assert.match(js,/readJson|request\(/);
  // Reject executable secret persistence, not a comment explicitly forbidding it.\n  const executable=js.replace(/\/\/[^\n]*/g,'').replace(/\/\*[\s\S]*?\*\//g,'');\n  assert.doesNotMatch(executable,/\.innerHTML\s*=|localStorage|sessionStorage|eval\(|console\.log/);
  assert.doesNotMatch(js,/source\.password|s\.password|source\.host|s\.serverUrl/);
  assert.match(js,/value===null\|\|value===undefined/);
});
test('publishing an existing release requires three affirmative steps and DB revision guards',async()=>{
  const js=await read('web/blofy-one-operations.js');
  assert.match(js,/window\.confirm\('هذا الإجراء يغيّر الإصدار الأساسي/);
  assert.match(js,/window\.prompt\('لتأكيد اعتماد النسخة/);
  assert.match(js,/if\(typed!==target\)/);
  assert.match(js,/window\.confirm\('تأكيد نهائي/);
  assert.match(js,/expectedRevision:rel\.revision/);
  assert.match(js,/expectedSelectionRevision:group\.state\.revision/);
  assert.match(js,/group\.state\?\.primaryId===rel\.id/);
  assert.doesNotMatch(js,/\/download\/latest\.apk|deleteRelease|method:'DELETE'/);
});
test('owner-only issuance uses verified saleh and never silently bills, redeems or stores codes',async()=>{
  const [js,html]=await Promise.all([
    read('web/blofy-one-operations.js'),read('web/blofy-one.html')
  ]);
  assert.match(js,/sourceId:'d2bb0397-1c56-4751-adc9-1a17758022f6'/);
  assert.match(js,/payload\.quantity<1\|\|payload\.quantity>20/);
  assert.match(js,/\['app','xtream'\]/);
  assert.match(js,/window\.confirm\('إصدار '/);
  assert.match(js,/method:'POST',body:payload/);
  assert.match(js,/result\.ok!==true\|\|items\.length!==payload\.quantity/);
  assert.match(js,/window\.setTimeout\(hideIssued,90000\)/);
  assert.match(js,/if\(document\.hidden\)hideIssued\(\)/);
  assert.match(html,/لا تُباع تلقائيًا/);
  assert.doesNotMatch(js,/\/api\/v1\/stream\/redeem|\/api\/v1\/admin\/xtream-gateway\/accounts\/bulk/);
});
