import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('operator can inspect live, movie, series info and episode samples with cancellation',async()=>{
  const [js,html,css]=await Promise.all([
    readFile(new URL('../web/sources-admin.js',import.meta.url),'utf8'),
    readFile(new URL('../web/sources-admin.html',import.meta.url),'utf8'),
    readFile(new URL('../web/sources-admin.css',import.meta.url),'utf8')
  ]);
  for(const id of ['xtProbeAllBtn','xtBatchProbeCancel','xtBatchProbeProgress','xtBatchProbeSummary','xtBatchProbeResults'])
    assert.ok(html.includes('id="'+id+'"'),id);
  const a=js.indexOf('async function runXtreamBatchProbe()');
  const b=js.indexOf('async function addXtream(event)',a);
  const block=js.slice(a,b);
  assert.ok(a>0&&b>a);
  assert.match(block,/const sources=available\.slice\(0,6\)/);
  for(const t of ["['live','قناة']","['movie','فيلم']","['series','بيانات مسلسل']","['episode','حلقة']"])
    assert.ok(block.includes(t),t);
  assert.match(block,/new AbortController\(\)/);
  assert.match(block,/controller\.abort\(\),14500/);
  assert.match(block,/signal:controller\.signal/);
  assert.match(block,/session\.cancelled/);
  assert.match(block,/session\.finished\+\+/);
  assert.match(block,/result\.ok/);
  assert.match(js,/cancelXtreamBatchProbe\(\)/);
  assert.match(js,/xtProbeAllBtn'\)\.addEventListener/);
  assert.match(css,/\.xt-batch-probe-results/);
});

test('batch inspection never changes source credentials, published content, or source order',async()=>{
  const js=await readFile(new URL('../web/sources-admin.js',import.meta.url),'utf8');
  const a=js.indexOf('async function runXtreamBatchProbe()');
  const b=js.indexOf('async function addXtream(event)',a);
  const block=js.slice(a,b);
  assert.match(block,/\/probe-playback'/);
  assert.doesNotMatch(block,/\/sync'|\/bulk'|\/items\/|\/delete|api\([^\n]*PATCH/);
  assert.doesNotMatch(block,/password:|username:|host:/);
});

test('mixed sample results are clearly labelled partial despite an overall passing group',async()=>{
  const [js,css]=await Promise.all([
    readFile(new URL('../web/sources-admin.js',import.meta.url),'utf8'),
    readFile(new URL('../web/sources-admin.css',import.meta.url),'utf8')
  ]);
  const start=js.indexOf('async function runXtreamBatchProbe()');
  const end=js.indexOf('async function addXtream(event)',start);
  const block=js.slice(start,end);
  assert.match(block,/session\.partial\+\+/);
  assert.match(block,/session\.failedSamples\+=failedSamples/);
  assert.match(block,/status\.className=failedSamples\?'status partial':'status passed'/);
  assert.match(block,/نجاح جزئي للعينة/);
  assert.match(block,/partialReasons/);
  assert.match(block,/xtream_transport_connection_reset:'انقطاع الاتصال'/);
  assert.match(block,/failedCheck/);
  assert.match(block,/partialReason/);
  assert.match(block,/عينات فرعية فاشلة/);
  assert.match(css,/\.xt-batch-probe-row \.status\.partial/);
});

test('operator sees item-level sample failures without raw credentials or URLs',async()=>{
 const [js,css]=await Promise.all([
   readFile(new URL('../web/sources-admin.js',import.meta.url),'utf8'),
   readFile(new URL('../web/sources-admin.css',import.meta.url),'utf8')
 ]);
 const begin=js.indexOf('function appendXtreamFailedSampleDetails(');
 const end=js.indexOf('// Operator-initiated batch probes:',begin);
 const helper=js.slice(begin,end);
 assert.ok(begin>=0&&end>begin);
 assert.match(helper,/filter\(x=>x&&!x.ok\)\.slice\(0,4\)/);
 assert.match(helper,/String\(item.title\|\|/);
 assert.match(helper,/make\('details'/);
 assert.match(helper,/make\('summary'/);
 assert.doesNotMatch(helper,/innerHTML|sourceUrl|password|username|baseUrl|mediaUrl/);
 const batch=js.slice(js.indexOf('async function runXtreamBatchProbe()'),
   js.indexOf('async function addXtream(event)'));
 assert.equal((batch.match(/appendXtreamFailedSampleDetails\(row,result.checks\)/g)||[]).length,2);
 assert.match(css,/\.xt-batch-failed-details/);
});

test('batch summary never labels partial passing groups fully healthy',async()=>{
 const js=await readFile(new URL('../web/sources-admin.js',import.meta.url),'utf8');
 const a=js.indexOf('async function runXtreamBatchProbe()');
 const b=js.indexOf('async function addXtream(event)',a);
 const block=js.slice(a,b);
 assert.ok(a>=0&&b>a);
 assert.match(block,/سليم في العينة/);
 assert.match(block,/session\.passed-session\.partial/);
 assert.match(block,/نجاح جزئي/);
 assert.match(block,/عينات فرعية فاشلة/);
 assert.doesNotMatch(block,/'نجح '\+session\.passed\+' من '/);
});
