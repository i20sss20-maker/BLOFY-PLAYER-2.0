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
  assert.equal(m.recentIssues[0].reason,'media_read_timeout');
  assert.ok(!JSON.stringify(m).includes('sensitive'));
  assert.ok(!JSON.stringify(m).includes('example.org'));
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
