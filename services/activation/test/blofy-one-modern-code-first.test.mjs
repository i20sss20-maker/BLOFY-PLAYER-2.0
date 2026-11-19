import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Script} from 'node:vm';
const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('code issuance is visible immediately, ahead of all long customer and STREAM tables',async()=>{
  const html=await read('web/blofy-one.html');
  assert.ok(html.includes('href="#one-issue"'));
  const position=html.indexOf('id="one-issue"');
  assert.ok(position>0);
  assert.ok(position<html.indexOf('id="customers"'));
  assert.ok(position<html.indexOf('id="stream-management"'));
  assert.ok(position<html.indexOf('id="one-sources"'));
  assert.match(html,/id="one-issue-form"/);
  assert.match(html,/id="one-issue-submit"/);
  assert.match(html,/id="one-issue-preview"/);
  assert.match(html,/id="one-issue-code-list"/);
  assert.match(html,/id="one-issue-countdown"/);
  assert.match(html,/data-one-days="90"/);
  assert.match(html,/data-one-days="180"/);
  assert.match(html,/data-one-days="365"/);
  assert.match(html,/id="one-quick-jump"/);
  const ids=[...html.matchAll(/\sid="([^"]+)"/g)].map(x=>x[1]);
  assert.equal(ids.length,new Set(ids).size,'unique DOM IDs');
  const nav=html.slice(html.indexOf('<nav class="one-nav"'),html.indexOf('</nav>')+6);
  const separated=nav.includes('class="one-panel-switch"');
  for(const href of ['#one-issue','#customers','#stream-management','#one-distributors',
    ...(!separated?['#one-storage','#one-releases']:[])])
    assert.ok(nav.includes('href="'+href+'"'),href);
  if(separated)assert.match(nav,/href="\/admin"/);
  assert.match(html,/لا نغيّر بيانات أي عميل عند فتح هذه الصفحة/);
});
test('modern interface is local, CSP-compatible, responsive and uses real KPIs',async()=>{
  const [html,css,js,hook]=await Promise.all([
    read('web/blofy-one.html'),read('web/blofy-one-modern.css'),
    read('web/blofy-one-modern.js'),read('src/admin-console-hook.mjs')
  ]);
  assert.doesNotThrow(()=>new Script(js));
  assert.ok(html.includes('/blofy-one-modern.css?v=20261118-v2'));
  assert.ok(html.includes('/blofy-one-modern.js?v=20261118-v2'));
  for(const path of ['/blofy-one-modern.css','/blofy-one-modern.js'])
    assert.ok(hook.includes("['"+path+"'"),path);
  assert.match(css,/\.one-mobile-create/);
  assert.match(css,/@media\(max-width:465px\)/);
  assert.match(css,/@media\(max-width:970px\)/);
  for(const id of ['one-customer-total','one-stream-code-total','one-stream-unused','one-src-active'])
    assert.ok(js.includes(id),id);
  assert.match(js,/new MutationObserver\(sync\)/);
  assert.match(js,/data-one-days/);
  assert.match(js,/navigator\.clipboard\.writeText\(code\)/);
  assert.doesNotMatch(js,/localStorage|sessionStorage|eval\(|\.innerHTML\s*=/);
  assert.doesNotMatch(js,/\/api\/v1\/admin|\/operator\/api|fetch\(/);
  assert.doesNotMatch(css,/@import|url\(https?:/);
  assert.equal(html.split('/blofy-one-operations.js?v=20261118-v1').length-1,1);
});
test('new code issue is still the validated explicit-confirm owner action, not auto issuance',async()=>{
  const [operations,modern]=await Promise.all([
    read('web/blofy-one-operations.js'),read('web/blofy-one-modern.js')
  ]);
  assert.match(operations,/issueForm\.addEventListener\('submit'/);
  assert.match(operations,/window\.confirm\('إصدار '/);
  assert.match(operations,/sourceId:'d2bb0397-1c56-4751-adc9-1a17758022f6'/);
  assert.match(operations,/payload\.quantity<1\|\|payload\.quantity>20/);
  assert.match(operations,/\/api\/v1\/admin\/xtream-gateway\/codes/);
  assert.match(operations,/window\.addEventListener\('pagehide',hideIssued\)/);
  assert.match(operations,/\$\('one-issue-hide'\)\.addEventListener\('click',hideIssued\)/);
  assert.doesNotMatch(modern,/issueForm\.requestSubmit\(/);
  assert.doesNotMatch(modern,/\/api\/v1\/stream\/redeem/);
});
