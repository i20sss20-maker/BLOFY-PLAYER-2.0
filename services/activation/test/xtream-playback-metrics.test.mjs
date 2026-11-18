import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  recordXtreamPlayback,xtreamPlaybackSnapshot,resetXtreamPlaybackMetricsForTest
} from '../src/xtream-playback-metrics.mjs';

test('production playback metrics summarize start latency and provider errors without secrets',()=>{
  resetXtreamPlaybackMetricsForTest();
  const now=Date.now();
  recordXtreamPlayback({kind:'live',phase:'started',startupMs:2400,attempts:1},now);
  recordXtreamPlayback({kind:'movie',phase:'started',startupMs:8100,attempts:2},now+1);
  recordXtreamPlayback({kind:'series',phase:'failed',reason:'upstream_http_403',upstreamStatus:403,attempts:1,
    username:'sensitive',password:'sensitive',host:'https://example.org/private'},now+2);
  recordXtreamPlayback({kind:'movie',phase:'interrupted',reason:'media_read_timeout',attempts:2},now+3);
  const m=xtreamPlaybackSnapshot(now+4);
  assert.equal(m.started,2);
  assert.equal(m.failed,1);
  assert.equal(m.interrupted,1);
  assert.equal(m.slowStarts,1);
  assert.equal(m.medianStartMs,2400);
  assert.equal(m.p95StartMs,8100);
  assert.equal(m.byKind.live.started,1);
  assert.equal(m.byKind.series.failed,1);
  assert.equal(m.upstreamCodes['403'],1);
  recordXtreamPlayback({kind:'live',phase:'failed',upstreamStatus:456,reason:'upstream_http_456',itemId:12345},now+4);
  const denied=xtreamPlaybackSnapshot(now+5);
  assert.equal(denied.upstreamCodes['456'],1);
  assert.equal(denied.recentIssues[0].reason,'upstream_http_456');
  assert.equal(m.recentIssues[0].reason,'media_read_timeout');
  assert.ok(!JSON.stringify(m).includes('sensitive'));
  assert.ok(!JSON.stringify(m).includes('example.org'));
});

test('live one-minute close logs distinguish source EOF from client closure without credentials',async()=>{
  const gateway=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
  assert.match(gateway,/BLOFY_LIVE_RELAY_ONE_MINUTE_CLOSE/);
  assert.match(gateway,/cause:'upstream_clean_eof'/);
  assert.match(gateway,/cause:'client_or_proxy_closed'/);
  assert.match(gateway,/secondsBucket:Math\.round\(liveDurationMs\/10000\)\*10/);
});

test('bounded data expires and malformed values cannot pollute dashboard',()=>{
  resetXtreamPlaybackMetricsForTest();
  const now=Date.now();
  recordXtreamPlayback({kind:'invalid',phase:'started',startupMs:1},now);
  recordXtreamPlayback({kind:'live',phase:'unknown',startupMs:1},now);
  recordXtreamPlayback({kind:'live',phase:'failed',upstreamStatus:403,
    reason:'../../passwords/origin',startupMs:Infinity,attempts:100},now-3700_000);
  recordXtreamPlayback({kind:'live',phase:'failed',upstreamStatus:403,
    reason:'../../passwords/origin',startupMs:Infinity,attempts:100},now);
  const x=xtreamPlaybackSnapshot(now);
  assert.equal(x.failed,1);
  assert.equal(x.recentIssues[0].reason,'');
  assert.equal(x.recentIssues[0].attempts,3);
  assert.equal(x.medianStartMs,null);
  resetXtreamPlaybackMetricsForTest();
});

test('main site health path is authenticated and player retains imported movie extensions',async()=>{
  const [gateway,html,js]=await Promise.all([
    readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8'),
    readFile(new URL('../web/sources-admin.html',import.meta.url),'utf8'),
    readFile(new URL('../web/sources-admin.js',import.meta.url),'utf8')
  ]);
  const block=gateway.slice(gateway.indexOf("if (!url.pathname.startsWith('/api/v1/admin/xtream-gateway'))"),gateway.indexOf('return json(res, 404, { error:',gateway.indexOf("if (!url.pathname.startsWith('/api/v1/admin/xtream-gateway'))")));
  assert.ok(block.indexOf('if (!requireAdmin(req, res)) return;')>=0);
  assert.ok(block.indexOf('if (!requireAdmin(req, res)) return;')<block.indexOf("url.pathname === '/api/v1/admin/xtream-gateway/playback-health'"));
  assert.match(gateway,/const mediaExtension=kind==='live'\?\(requestedExtension\|\|extension\):\(extension\|\|requestedExtension\)/);
  assert.match(gateway,/recordXtreamPlayback\(/);
  assert.match(html,/id="blofyPlaybackMetrics"/);
  assert.match(html,/id="blofyPlaybackRefresh"/);
  assert.match(js,/function loadBlofyPlaybackHealth\(/);
  assert.match(js,/blofyPlaybackRefresh'\)\.addEventListener/);
});

test('gateway 401 and missing catalog 404 are tracked without blaming the source provider',()=>{
  resetXtreamPlaybackMetricsForTest();
  const now=Date.now();
  recordXtreamPlayback({kind:'movie',phase:'failed',reason:'gateway_auth_denied',itemId:698244},now);
  recordXtreamPlayback({kind:'live',phase:'failed',reason:'catalog_item_unavailable',itemId:688516},now+1);
  recordXtreamPlayback({kind:'series',phase:'failed',reason:'upstream_http_403',upstreamStatus:403,itemId:999},now+2);
  const result=xtreamPlaybackSnapshot(now+3);
  assert.equal(result.failed,3);
  assert.equal(result.gatewayAuthDenied,1);
  assert.equal(result.unavailableItems,1);
  assert.equal(result.upstreamFailed,1);
  assert.deepEqual(result.upstreamCodes,{'403':1});
  assert.equal(result.recentIssues[0].itemId,999);
  assert.equal(result.recentIssues[1].reason,'catalog_item_unavailable');
  assert.equal(result.recentIssues[2].reason,'gateway_auth_denied');
  resetXtreamPlaybackMetricsForTest();
});

test('actual gateway denies unauthorized media before fetching upstream or disclosing credentials',async()=>{
  const [gateway,ui]=await Promise.all([
    readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8'),
    readFile(new URL('../web/sources-admin.js',import.meta.url),'utf8')
  ]);
  const proxy=gateway.slice(gateway.indexOf('async function proxyMedia('),gateway.indexOf('async function probeGatewayMedia('));
  assert.match(proxy,/reason:'gateway_auth_denied'/);
  assert.match(proxy,/reason:'catalog_item_unavailable'/);
  assert.ok(proxy.indexOf("if (!account) {")<proxy.indexOf("const upstream = mediaUpstreamUrl"));
  assert.match(ui,/gateway_auth_denied:'بيانات دخول حساب BLOFY/);
  assert.match(ui,/catalog_item_unavailable:'هذا المحتوى غير متاح/);
  assert.match(ui,/gatewayAuthDenied/);
  assert.match(ui,/upstreamFailed/);
});

test('shared ticket issue and safe fallback do not falsify player health',()=>{
 resetXtreamPlaybackMetricsForTest();
 const at=Date.now();
 recordXtreamPlayback({kind:'live',phase:'shared_grant',itemId:1234,
  username:'secret',sourceUrl:'https://provider.example/private'},at);
 recordXtreamPlayback({kind:'live',phase:'shared_fallback',itemId:1234,
  reason:'licensed_fanout_unavailable',password:'secret'},at+1);
 const m=xtreamPlaybackSnapshot(at+2);
 assert.equal(m.sharedTicketsIssued,1);
 assert.equal(m.sharedGrantFallbacks,1);
 assert.equal(m.started,0);
 assert.equal(m.failed,0);
 assert.equal(m.byKind.live.sharedTicketsIssued,1);
 assert.equal(m.byKind.live.sharedGrantFallbacks,1);
 assert.doesNotMatch(JSON.stringify(m),/secret|provider.example|password|username/);
 resetXtreamPlaybackMetricsForTest();
});

test('hourly transport reset diagnostics count beyond recent 12 events without credentials',()=>{
  resetXtreamPlaybackMetricsForTest();
  const now=Date.now();
  for(let i=0;i<21;i++)recordXtreamPlayback({
    kind:i%2?'series':'movie',phase:'failed',reason:'xtream_transport_connection_reset',
    itemId:i+1,sourceId:'6cbe3f8e-f14d-4d0d-9f7e-39b4ae34993a',
    accessToken:'private-token',providerUrl:'https://provider.example/?password=private'
  },now+i);
  recordXtreamPlayback({
    kind:'series',phase:'interrupted',reason:'xtream_transport_timeout',
    sourceId:'6cbe3f8e-f14d-4d0d-9f7e-39b4ae34993a'
  },now+22);
  const sample=xtreamPlaybackSnapshot(now+25);
  assert.equal(sample.recentIssues.length,12);
  assert.equal(sample.failureByReason.xtream_transport_connection_reset,21);
  assert.equal(sample.failureByReason.xtream_transport_timeout,1);
  assert.equal(sample.failureByKind.series.xtream_transport_connection_reset,10);
  assert.equal(sample.failureByKind.movie.xtream_transport_connection_reset,11);
  assert.equal(sample.failureByKind.series.xtream_transport_timeout,1);
  assert.equal(sample.failed,21);
  assert.equal(sample.interrupted,1);
  assert.doesNotMatch(JSON.stringify(sample.failureByReason),/password|private-token|provider/);
  resetXtreamPlaybackMetricsForTest();
});
test('transport failure aggregates exclude old events, invalid reasons and successful streams',()=>{
  resetXtreamPlaybackMetricsForTest();
  const now=Date.now();
  recordXtreamPlayback({kind:'series',phase:'failed',
    reason:'xtream_transport_connection_reset'},now-3700000);
  recordXtreamPlayback({kind:'series',phase:'started',
    reason:'xtream_transport_connection_reset'},now);
  recordXtreamPlayback({kind:'series',phase:'failed',reason:'https://secret'},now+1);
  const sample=xtreamPlaybackSnapshot(now+2);
  assert.deepEqual({...sample.failureByReason},{});
  assert.deepEqual({...sample.failureByKind.series},{});
  assert.equal(sample.failed,1);
  resetXtreamPlaybackMetricsForTest();
});

test('real MPEG-TS recovery success and exhausted/limited outcomes surface in hourly health',()=>{
 resetXtreamPlaybackMetricsForTest();
 const now=Date.now();
 const source='6cbe3f8e-f14d-4d0d-9f7e-39b4ae34993a';
 for(let i=0;i<4;i++)recordXtreamPlayback({
  kind:'live',phase:'recovered',reason:'live_ts_recovered',
  sourceId:source,itemId:1312445,attempts:i+1,
  upstreamUrl:'https://secret.provider/live/password',token:'private-key'
 },now+i);
 recordXtreamPlayback({kind:'live',phase:'interrupted',
  reason:'live_ts_reconnect_exhausted',sourceId:source,itemId:1312445},now+10);
 recordXtreamPlayback({kind:'live',phase:'interrupted',
  reason:'live_ts_reconnect_rate_limited',sourceId:source,itemId:1312445},now+11);
 recordXtreamPlayback({kind:'live',phase:'interrupted',
  reason:'live_ts_reconnect_budget_exhausted',sourceId:source,itemId:1312445},now+12);
 const snapshot=xtreamPlaybackSnapshot(now+20,source);
 assert.equal(snapshot.started,0,'HTTP 200 start is different from midstream recovery');
 assert.equal(snapshot.recovered,4);
 assert.equal(snapshot.liveTsRecoverySuccesses,4);
 assert.equal(snapshot.byKind.live.recovered,4);
 assert.equal(snapshot.liveTsRecoveryExhausted,1);
 assert.equal(snapshot.liveTsRecoveryRateLimited,1);
 assert.equal(snapshot.liveTsRecoveryBudgetExhausted,1);
 assert.equal(snapshot.interrupted,3);
 assert.equal(snapshot.recentRecoveries.length,4);
 assert.equal(snapshot.failureByReason.live_ts_reconnect_exhausted,1);
 assert.equal(snapshot.failureByReason.live_ts_reconnect_rate_limited,1);
 assert.equal(snapshot.failureByReason.live_ts_reconnect_budget_exhausted,1);
 assert.doesNotMatch(JSON.stringify(snapshot),/secret.provider|private-key|upstreamUrl|token/);
 const unknown=xtreamPlaybackSnapshot(now+20,'4e0ce9b3-1b26-4405-af70-86be533e2ffc');
 assert.equal(unknown.liveTsRecoverySuccesses,0);
 resetXtreamPlaybackMetricsForTest();
});
test('production telemetry records live reconnects and admin renders them without claiming no black screens',async()=>{
 const [gateway,ui]=await Promise.all([
  readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8'),
  readFile(new URL('../web/sources-admin.js',import.meta.url),'utf8')
 ]);
 assert.match(gateway,/observe\('recovered',\{reason:'live_ts_recovered',attempts:reconnection\}\)/);
 assert.match(ui,/m\.liveTsRecoverySuccesses/);
 assert.match(ui,/m\.liveTsRecoveryExhausted/);
 assert.match(ui,/m\.liveTsRecoveryRateLimited/);
 assert.match(ui,/m\.liveTsRecoveryBudgetExhausted/);
 assert.match(ui,/لا تثبت عدم ظهور شاشة سوداء/);
});

test('live source drop metrics separate EOF, stalled bytes and transport failures from HTTP starts',()=>{
 resetXtreamPlaybackMetricsForTest();
 const now=Date.now(),src='6cbe3f8e-f14d-4d0d-9f7e-39b4ae34993a';
 const types=['live_ts_source_eof','live_ts_source_stalled','live_ts_source_transport_error'];
 for(let i=0;i<3;i++)recordXtreamPlayback({
  phase:'source_drop',kind:'live',reason:types[i],sourceId:src,
  itemId:1312445,durationMs:[20000,45000,5000][i],
  origin:'https://secret.example.com/private',password:'hidden'
 },now+i);
 const health=xtreamPlaybackSnapshot(now+8,src);
 assert.equal(health.started,0);
 assert.equal(health.failed,0);
 assert.equal(health.interrupted,0);
 assert.equal(health.liveTsSourceDrops,3);
 assert.equal(health.medianLiveTsSourceUptimeMs,20000);
 assert.equal(health.byKind.live.sourceDrops,3);
 assert.deepEqual({...health.sourceDropByReason},{
  live_ts_source_eof:1,live_ts_source_stalled:1,
  live_ts_source_transport_error:1
 });
 assert.deepEqual(health.recentSourceDrops.map(x=>x.durationMs),[5000,45000,20000]);
 assert.doesNotMatch(JSON.stringify(health),/secret.example.com|hidden|private/);
 resetXtreamPlaybackMetricsForTest();
});
test('admin dashboard displays live origin drop timing and cause without guessing playback success',async()=>{
 const src=await readFile(new URL('../web/sources-admin.js',import.meta.url),'utf8');
 assert.match(src,/m\.liveTsSourceDrops/);
 assert.match(src,/m\.medianLiveTsSourceUptimeMs/);
 assert.match(src,/m\.sourceDropByReason\?\.live_ts_source_eof/);
 assert.match(src,/m\.sourceDropByReason\?\.live_ts_source_stalled/);
 assert.match(src,/m\.sourceDropByReason\?\.live_ts_source_transport_error/);
 assert.match(src,/m\.recentSourceDrops/);
});
