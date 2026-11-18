import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Script} from 'node:vm';
const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('single, integrated BLOFY ONE launch command center lists all seven workstreams',async()=>{
  const html=await read('web/blofy-one.html');
  assert.match(html,/id="one-growth"/);
  assert.match(html,/href="#one-growth"/);
  assert.match(html,/BLOFY OPERATIONS · LAUNCH COMMAND CENTER/);
  assert.match(html,/id="one-growth-campaigns"/);
  assert.match(html,/id="one-growth-days"/);
  assert.match(html,/id="one-growth-refresh"/);
  assert.match(html,/id="one-growth-issues"/);
  for(const id of [
    'sessions','views','wa-clicks','checkout-starts','store-paid','store-revenue',
    'funnel-views','funnel-product','funnel-checkout','funnel-paid',
    'health-activation','health-downloads','health-stream','health-payment',
    'health-fulfillment','health-stock','health-whatsapp','health-media'
  ])assert.ok(html.includes('id="one-growth-'+id+'"'),id);
  const firstIssue=html.indexOf('id="one-issue"'),growth=html.indexOf('id="one-growth"');
  assert.ok(firstIssue>0&&firstIssue<growth,'create-code form stays above analytics panel');
  const allIds=[...html.matchAll(/\sid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(new Set(allIds).size,allIds.length,'no duplicate HTML IDs');
});
test('dashboard reads existing authenticated real finance/analytics endpoints, never writes payments',async()=>{
  const [js,css,assets,shop,analytics]=await Promise.all([
    read('web/blofy-one-launch.js'),read('web/blofy-one-launch.css'),
    read('src/admin-console-hook.mjs'),read('src/store-geidea-checkout.mjs'),
    read('src/site-analytics.mjs')
  ]);
  assert.doesNotThrow(()=>new Script(js));
  for(const endpoint of [
    '/api/v1/admin/site-analytics/summary?days=',
    '/api/v1/public/system-health',
    '/health',
    '/api/v1/store/products',
    '/api/v1/admin/store/sales',
    '/api/v1/admin/store/inventory'
  ])assert.ok(js.includes(endpoint),endpoint);
  assert.match(shop,/p==='\/api\/v1\/admin\/store\/sales'/);
  assert.match(shop,/p==='\/api\/v1\/admin\/store\/inventory'/);
  assert.match(analytics,/\/api\/v1\/admin\/site-analytics\/summary/);
  assert.match(js,/fulfillmentIssues/);
  assert.match(js,/paidMinor\+=BigInt\(amount\)/);
  assert.match(js,/source==='consented_first_party'/);
  assert.match(js,/لا يعدّ ذلك اختبار ضغط أو تسوية بنكية/);
  assert.doesNotMatch(js,/localStorage|sessionStorage|innerHTML\s*=|window\.GeideaCheckout/);
  assert.doesNotMatch(js,/method:\s*'POST'|fetch\(.*\/stream\/activate/);
  assert.doesNotMatch(js,/\/api\/v1\/admin\/xtream\/source\/.*\/test/);
  for(const name of ['/blofy-one-launch.css','/blofy-one-launch.js'])
    assert.ok(assets.includes("['"+name+"'"),name);
  assert.match(css,/@media\(max-width:700px\)/);
});
test('launch status tells owner explicitly what is NOT verified',async()=>{
  const [html,js]=await Promise.all([read('web/blofy-one.html'),
    read('web/blofy-one-launch.js')]);
  assert.match(html,/لا نفترض أعداد المشاهدين أو تسوية البنك/);
  assert.match(html,/الرد الآلي الرسمي يتطلب توصيل Meta/);
  assert.match(html,/لا يثبت اكتمال ملف APK/);
  assert.match(html,/ليست تسوية بنكية أو صافي ربح/);
  assert.match(js,/signal\('media','غير مُقاس','warn'\)/);
  assert.match(js,/signal\('whatsapp','رابط فقط','warn'\)/);
  assert.match(js,/لا توجد مشاكل ظاهرة في فحوصات الخدمات/);
  assert.match(js,/لا تظهر أرقام تقديرية/);
  assert.match(js,/مصادر الزيارات/);
});
