import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeStreamMediaQuality} from '../src/stream-media-quality.mjs';

test('live, movie, and series playback quality is aggregated and private',()=>{
 const raw={
  started:100,failed:10,interrupted:4,slowStarts:8,
  medianStartMs:1100,p95StartMs:9000,
  upstreamFailed:7,clientOrProxyClosed:6,
  byKind:{
    live:{started:60,failed:8,interrupted:3,clientClosed:2},
    movie:{started:30,failed:1},
    series:{started:10,failed:1}
  },
  recentIssues:[
    {reason:'upstream_http_404',sourceId:'x',itemId:123,
      providerUrl:'https://credential.secret/path'},
    {reason:'upstream_http_404',sourceId:'x',itemId:123},
    {reason:'unknown_sensitive_reason',password:'secret'}
  ],
  upstreamCodes:{404:5,456:2,999:5}
 };
 const r=summarizeStreamMediaQuality(raw,Date.parse('2026-11-12T10:00:00Z'));
 assert.equal(r.ok,true);
 assert.equal(r.decodedOnClient,false);
 assert.equal(r.byKind.live.started,60);
 assert.equal(r.byKind.live.failed,8);
 assert.equal(r.byKind.live.errorPercent,12);
 assert.equal(r.byKind.movie.started,30);
 assert.equal(r.byKind.series.started,10);
 assert.equal(r.byReason.upstream_http_404,2);
 assert.deepEqual(r.providerCodes,{'404':5,'456':2});
 assert.equal(r.byKind.live.verifiedPlayback,false);
 assert.equal(r.checkedAt,'2026-11-12T10:00:00.000Z');
 assert.doesNotMatch(JSON.stringify(r),/credential\.secret|password|sourceId|itemId|providerUrl/i);
});
test('missing metrics remain zero/unknown, not false evidence of playback',()=>{
 const r=summarizeStreamMediaQuality({byKind:{live:{started:0,failed:0}}});
 assert.equal(r.byKind.live.errorPercent,null);
 assert.equal(r.p95StartMs,null);
 assert.equal(r.started,0);
 assert.equal(r.decodedOnClient,false);
 assert.deepEqual(r.byReason,{});
});

test('hourly 502 connection resets are counted from whole bounded window, not only last 12',()=>{
 const r=summarizeStreamMediaQuality({
  started:24,failed:21,interrupted:3,byKind:{
   series:{started:5,failed:18,interrupted:3},
   movie:{started:19,failed:3},live:{started:0,failed:0}
  },
  failureByReason:{xtream_transport_connection_reset:21,
   xtream_transport_timeout:3,not_allowed_with_secret:100},
  failureByKind:{
   series:{xtream_transport_connection_reset:18,
    xtream_transport_timeout:3,password:'invisible'},
   movie:{xtream_transport_connection_reset:3}
  },
  recentIssues:[{reason:'xtream_transport_connection_reset',sourceUrl:'secret.url'}]
 });
 assert.equal(r.byReason.xtream_transport_connection_reset,21);
 assert.equal(r.byReason.xtream_transport_timeout,3);
 assert.equal(r.reasonByKind.series.xtream_transport_connection_reset,18);
 assert.equal(r.reasonByKind.movie.xtream_transport_connection_reset,3);
 assert.equal(r.reasonCountWindow,'bounded_hourly_samples');
 assert.doesNotMatch(JSON.stringify(r),/not_allowed_with_secret|password|secret\.url|sourceUrl/);
});
test('legacy processes remain explicitly labeled as last-issues-only',()=>{
 const r=summarizeStreamMediaQuality({recentIssues:[
  {reason:'upstream_http_502',providerUrl:'private'},
  {reason:'upstream_http_502',providerUrl:'private'}
 ]});
 assert.equal(r.byReason.upstream_http_502,2);
 assert.equal(r.reasonCountWindow,'recent_issue_fallback');
 assert.deepEqual(r.reasonByKind,{live:{},movie:{},series:{}});
});
