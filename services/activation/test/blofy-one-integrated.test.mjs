import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Script} from 'node:vm';

const web=new URL('../web/',import.meta.url);
const read=name=>readFile(new URL(name,web),'utf8');

test('BLOFY ONE integrated dashboard links real operator paths and secured workflows',async()=>{
  const [html,js,css,dual]=await Promise.all([
    read('blofy-one.html'),read('blofy-one.js'),
    read('blofy-one.css'),read('stream-dual-access.js')
  ]);
  assert.doesNotThrow(()=>new Script(js));
  assert.doesNotThrow(()=>new Script(dual));
  for(const href of [
    '/admin/control-center','/admin/control-center/health',
    '/sources-admin#dual','/sources-admin#xtream',
    '/admin/content-hub','/distributor','/admin#devices',
    ...(!html.includes('class="one-panel-switch"')?['/admin#codes']:[]),
    '/admin#support','/admin#releases'
  ])assert.ok(html.includes('href="'+href+'"'),href);
  if(html.includes('class="one-panel-switch"'))assert.match(html,/href="\/admin"/);
  assert.match(html,/id="one-readiness-list"/);
  assert.match(html,/id="one-module-filter"/);
  assert.match(html,/id="one-module-list"/);
  assert.match(js,/\/api\/v1\/admin\/control-center\/status/);
  assert.match(js,/credentials:'same-origin'/);
  assert.match(js,/cache:'no-store'/);
  assert.match(dual,/window\.location\.hash\.toLowerCase\(\) === '#dual'/);
  assert.match(css,/\.one-readiness-grid/);
  assert.match(css,/@media\(max-width:660px\)/);
});

test('BLOFY ONE remains a read-only aggregated interface',async()=>{
  const script=await read('blofy-one.js');
  // Smoke probes remain explicit separate actions; dashboard fetches are GET-only.
  assert.match(script,/method:'GET'/);
  assert.match(script,/operatorReadiness/);
  assert.doesNotMatch(script,/localStorage|sessionStorage|console\.log|\/api\/v1\/admin\/xtream-gateway\/link\/xtream-to-code/);
  assert.match(script,/oneReadinessStates/);
});
