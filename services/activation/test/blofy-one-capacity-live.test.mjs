import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Script} from 'node:vm';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('live capacity dashboard is inside existing owner-protected BLOFY ONE, not a public route',async()=>{
  const [html,js,css,hook]=await Promise.all([
    read('web/blofy-one.html'),read('web/blofy-one-capacity.js'),
    read('web/blofy-one-capacity.css'),read('src/admin-console-hook.mjs')]);
  assert.doesNotThrow(()=>new Script(js));
  for(const key of ['one-capacity','one-capacity-refresh','one-capacity-status',
    'one-capacity-indicator','one-capacity-viewers','one-capacity-feeds',
    'one-capacity-feed-limit','one-capacity-tickets','one-capacity-capacity-rejected',
    'one-capacity-provider-failures','one-capacity-reconnects','one-capacity-samples',
    'one-capacity-alerts','one-capacity-trend','one-capacity-playback-note']){
    assert.equal((html.match(new RegExp('id="'+key+'"','g'))||[]).length,1,key);
  }
  assert.match(html,/href="#one-capacity"/);
  assert.match(html,/option value="one-capacity"/);
  assert.match(html,/لا نعلن قدرة 100 أو 1000 مشاهد/);
  for(const extension of ['js','css']){
    assert.ok(hook.includes("'/blofy-one-capacity."+extension+"'"));
    assert.ok(html.includes('/blofy-one-capacity.'+extension+'?v=20261118-v1'));
  }
  assert.match(css,/@media\(max-width:660px\)/);
});

test('dashboard fetches only authenticated read-only cached operator metrics',async()=>{
  const js=await read('web/blofy-one-capacity.js');
  assert.ok(js.includes('/operator/api/smart-ops'));
  assert.ok(js.includes('/operator/api/security'));
  assert.ok(js.includes('/operator/api/playback-health'));
  assert.match(js,/method:'GET',credentials:'same-origin'/);
  assert.match(js,/redirect:'error',cache:'no-store'/);
  assert.match(js,/ops\.readOnly!==true/);
  assert.match(js,/ops\.isAllSubscribersMeasured!==false/);
  assert.match(js,/cap\?\.maxViewersPerFeed/);
  assert.match(js,/source\.length/);
  assert.doesNotMatch(js,/method:'POST'|\/internal\/smoke|\/operator\/api\/shared-live\/probe/);
  assert.doesNotMatch(js,/localStorage|sessionStorage|document\.cookie|innerHTML\s*=/);
  assert.doesNotMatch(js,/automaticRestart|autoRetrySource|sendMessage\(/);
});

test('STREAM operator telemetry documents it measures relay only and has explicit bounded alerts',async()=>{
  const html=await read('web/blofy-one.html');
  const js=await read('web/blofy-one-capacity.js');
  assert.match(html,/لا يمثل جميع مشتركي BLOFY/);
  assert.match(html,/لا يقيس الحد المسموح من Xtream/);
  assert.match(html,/لا نقوم بأي اختبار ضغط تلقائي/);
  assert.match(js,/feed_media_stalled/);
  assert.match(js,/provider_failures_increased/);
  assert.match(js,/capacity_rejections_increased/);
  assert.match(js,/setInterval\(/);
  assert.match(js,/document\.hidden/);
});
