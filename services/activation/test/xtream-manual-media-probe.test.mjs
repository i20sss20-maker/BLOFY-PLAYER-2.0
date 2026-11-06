import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {recordXtreamPlayback,xtreamPlaybackSnapshot,resetXtreamPlaybackMetricsForTest} from '../src/xtream-playback-metrics.mjs';

const read=name=>readFile(new URL('../'+name,import.meta.url),'utf8');

test('stream failures identify safe Xtream gateway IDs but never expose source paths or credentials',()=>{
  resetXtreamPlaybackMetricsForTest();
  recordXtreamPlayback({kind:'live',phase:'failed',itemId:'689196',
    reason:'upstream_http_403',upstreamStatus:403,password:'do-not-leak',url:'https://example.org'});
  recordXtreamPlayback({kind:'movie',phase:'interrupted',itemId:'../../../etc/passwd',reason:'media_read_timeout'});
  recordXtreamPlayback({kind:'series',phase:'failed',itemId:'9007199254740992',reason:'upstream_http_404',upstreamStatus:404});
  const result=xtreamPlaybackSnapshot();
  assert.equal(result.recentIssues.length,3);
  assert.equal(result.recentIssues.find(x=>x.kind==='live').itemId,689196);
  assert.equal(result.recentIssues.find(x=>x.kind==='movie').itemId,null);
  assert.equal(result.recentIssues.find(x=>x.kind==='series').itemId,null);
  assert.equal(result.upstreamCodes['403'],1);
  assert.equal(result.upstreamCodes['404'],1);
  assert.ok(!JSON.stringify(result).includes('do-not-leak'));
  assert.ok(!JSON.stringify(result).includes('etc/passwd'));
  resetXtreamPlaybackMetricsForTest();
});

test('manual source media probe is admin-only, validates ID, rate-limits and never returns media URLs',async()=>{
  const source=await read('src/xtream-gateway-hook.mjs');
  const auth=source.indexOf("if (!url.pathname.startsWith('/api/v1/admin/xtream-gateway'))");
  const probe=source.indexOf("url.pathname === '/api/v1/admin/xtream-gateway/playback-probe'");
  assert.ok(auth>=0 && probe>auth);
  assert.ok(source.indexOf('if (!requireAdmin(req, res)) return;',auth)<probe);
  assert.match(source,/if\(itemProbeRunning\)/);
  assert.match(source,/now-itemProbeAt<12000/);
  assert.match(source,/setTimeout\(\(\)=>controller.abort\(\),10000\)/);
  assert.match(source,/await checkedFetch\(url/);
  assert.match(source,/reader=response.body.getReader\(\)/);
  assert.match(source,/if\(!\/\^\[1-9\]\[0-9\]\{0,14\}\$\/\.test\(raw\)\)/);
  assert.match(source,/response\.body\.cancel\(\)/);
  const piece=source.slice(source.indexOf('async function probeGatewayMedia('),source.indexOf('function playerServerInfo('));
  assert.doesNotMatch(piece,/return\{[^\n]*url:/);
  assert.match(piece,/inspectXtreamMediaChunk\(first.value,response.headers.get\('content-type'\)\)/);
  const inspector=await read('src/xtream-media-inspector.mjs');
  assert.match(inspector,/upstream_non_media_response/);
  assert.match(piece,/first_media_bytes_only/);
});

test('real BLOFY admin can test a failed channel with one click without entering Xtream secrets',async()=>{
  const [html,js]=await Promise.all([read('web/sources-admin.html'),read('web/sources-admin.js')]);
  for(const id of ['blofyProbeKind','blofyProbeId','blofyProbeRun','blofyProbeResult','blofyPlaybackIssues'])
    assert.ok(html.includes('id="'+id+'"'),id);
  assert.match(js,/async function runBlofyItemProbe\(/);
  assert.match(js,/method:'POST',body:JSON\.stringify\(\{kind,itemId\}\)/);
  assert.match(js,/dataset\.probeItem/);
  assert.match(js,/dataset\.probeKind/);
  assert.match(js,/upstream_http_403:'المصدر يرفض الوصول/);
  assert.match(js,/upstream_http_404:'رابط التشغيل غير موجود/);
});
