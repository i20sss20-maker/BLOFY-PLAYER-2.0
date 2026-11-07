import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {xtreamConnectionReport,normalizedXtreamIssue} from '../src/xtream-smart-connection.mjs';

test('known network and provider permission errors are reported separately',()=>{
 const cases={
  xtream_transport_connection_reset:'المصدر قطع اتصال Railway',
  xtream_transport_timeout:'المصدر لم يستجب خلال المهلة',
  xtream_transport_dns_failed:'تعذر الوصول إلى اسم المصدر',
  xtream_http_401:'بيانات المصدر مرفوضة (401)',
  xtream_http_403:'المصدر رفض السماح (403)',
  xtream_http_456:'المصدر رفض الطلب (456)'
 };
 for(const [code,title] of Object.entries(cases)){
  const report=xtreamConnectionReport({errorCode:code,checkedAt:Date.UTC(2026,10,7)});
  assert.equal(report.code,code);
  assert.equal(report.title,title);
  assert.equal(report.ok,false);
  assert.equal(report.playbackVerified,false);
  assert.equal(report.route,'railway_default');
 }
});
test('unknown exceptions cannot leak upstream URLs or credentials',()=>{
 const secret='https://user:password@provider.invalid:8080/secret';
 for(const data of [secret,'fetch failed','xtream_http_999','ECONNRESET '+secret]){
  const report=xtreamConnectionReport({errorCode:data});
  assert.equal(normalizedXtreamIssue(data),'xtream_connection_unknown');
  assert.equal(report.code,'xtream_connection_unknown');
  const result=JSON.stringify(report);
  assert.ok(!result.includes(secret));
  assert.ok(!result.includes('password'));
  assert.ok(!result.includes('provider.invalid'));
 }
});
test('reachable Xtream account does not claim playable streaming or active static IP',()=>{
 const report=xtreamConnectionReport({ok:true});
 assert.equal(report.code,'xtream_api_reachable');
 assert.equal(report.playbackVerified,false);
 assert.equal(report.staticOutboundIpStatus,'not_checked');
});
test('production admin check bounds to one GET, is authenticated and is non-mutating',async()=>{
 const admin=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 const begin=admin.indexOf('async function runSmartConnection(');
 const end=admin.indexOf('async function testServer(',begin);
 assert.ok(begin>=0&&end>begin);
 const segment=admin.slice(begin,end);
 assert.match(segment,/timeoutMs:8000,maxAttempts:1/);
 assert.match(segment,/smartConnectionCooldowns\.set\(id,now\)/);
 assert.match(segment,/now-old<30_000/);
 assert.doesNotMatch(segment,/UPDATE |DELETE |INSERT |probeXtreamPlayback|syncServer\(/);
 assert.match(admin,/if \(!requireAdmin\(req, res\)\) return/);
 assert.match(admin,/action === 'smart-connection' && req\.method === 'POST'/);
});
test('the source UI provides one clear operator action with safe response handling',async()=>{
 const [ui,html,css]=await Promise.all([
  readFile(new URL('../web/sources-admin.js',import.meta.url),'utf8'),
  readFile(new URL('../web/sources-admin.html',import.meta.url),'utf8'),
  readFile(new URL('../web/stream-premium.css',import.meta.url),'utf8')
 ]);
 assert.match(ui,/\['🔎 تشخيص الاتصال الذكي', 'smart-connection'/);
 assert.match(ui,/action === 'smart-connection'/);
 assert.match(ui,/data\.diagnosis/);
 assert.match(css,/button\[data-action="smart-connection"\]/);
 assert.match(html,/sources-admin\.js\?v=20261107-smart-v1/);
});
