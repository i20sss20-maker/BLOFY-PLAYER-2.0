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
