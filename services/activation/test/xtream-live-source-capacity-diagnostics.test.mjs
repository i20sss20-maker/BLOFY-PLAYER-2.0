import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {sourceLiveCapacity} from '../src/xtream-live-source-capacity.mjs';
import {recordXtreamPlayback,xtreamPlaybackSnapshot,resetXtreamPlaybackMetricsForTest} from '../src/xtream-playback-metrics.mjs';
const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';

test('a single upstream source account can limit multiple issued BLOFY codes',()=>{
 const result=sourceLiveCapacity({maxConnections:1,activeConnections:1,
   isRestreamer:false,allowedOutputFormats:['ts','m3u8'],password:'DO_NOT_LOG'});
 assert.equal(result.maxConnections,1);
 assert.equal(result.sourceAccountSharedByCodes,true);
 assert.equal(result.automaticConnectionSharingEnabled,false);
 assert.ok(result.warningCodes.includes('source_single_upstream_connection'));
 assert.ok(result.warningCodes.includes('source_restream_not_authorized'));
 assert.ok(result.warningCodes.includes('source_upstream_at_reported_limit'));
 assert.ok(!JSON.stringify(result).includes('DO_NOT_LOG'));
});
test('unknown source limits and source limits greater than one are not invented',()=>{
 const unknown=sourceLiveCapacity({});
 assert.equal(unknown.maxConnections,null);
 assert.ok(unknown.warningCodes.includes('source_upstream_limit_unknown'));
 const allowed=sourceLiveCapacity({maxConnections:10,activeConnections:1,isRestreamer:true});
 assert.ok(!allowed.warningCodes.includes('source_single_upstream_connection'));
 assert.ok(!allowed.warningCodes.includes('source_restream_not_authorized'));
});
test('20-second upstream TS end and distinct client close are sanitized and per-source',()=>{
 resetXtreamPlaybackMetricsForTest();
 const now=Date.now();
 recordXtreamPlayback({kind:'live',phase:'started',sourceId:A},now);
 recordXtreamPlayback({kind:'live',phase:'ended',sourceId:A,durationMs:20340,
  reason:'upstream_stream_ended',password:'DO_NOT_LOG'},now+20340);
 recordXtreamPlayback({kind:'live',phase:'client_closed',sourceId:B,durationMs:21000,
  reason:'client_or_proxy_closed'},now+20340);
 recordXtreamPlayback({kind:'live',phase:'interrupted',sourceId:A,durationMs:19800,
  reason:'xtream_transport_connection_reset'},now+21340);
 const a=xtreamPlaybackSnapshot(now+22340,A);
 assert.equal(a.upstreamEnded,1);
 assert.equal(a.shortLiveUpstreamEnds,2);
 assert.equal(a.clientOrProxyClosed,0);
 assert.equal(a.recentIssues[0].reason,'xtream_transport_connection_reset');
 assert.equal(a.recentIssues[1].durationMs,20340);
 const b=xtreamPlaybackSnapshot(now+22340,B);
 assert.equal(b.upstreamEnded,0);
 assert.equal(b.clientOrProxyClosed,1);
 assert.equal(b.shortLiveUpstreamEnds,0);
 assert.ok(!JSON.stringify(a).includes('DO_NOT_LOG'));
 resetXtreamPlaybackMetricsForTest();
});
test('gateway stream terminal metadata is safe and never auto-activates sharing',async()=>{
 const proxy=(await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8'))
  .split('async function proxyMedia(')[1].split('async function probeGatewayMedia(')[0];
 assert.match(proxy,/feedEndedNormally=true/);
 assert.match(proxy,/observe\('ended',\{reason:'upstream_stream_ended'/);
 assert.match(proxy,/observe\('client_closed',\{reason:'client_or_proxy_closed'/);
 assert.match(proxy,/sourceId:row.server_id/);
 // Licensed source branch checks rights; legacy canary must never share.
 assert.match(proxy,/permittedLicensedLiveFanout\(/);
 assert.match(proxy,/sharedLive:false/);
 const hook=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 assert.match(hook,/liveSourceCapacity:sourceLiveCapacity\(source.account_info\)/);
 assert.match(hook,/livePlayback:xtreamPlaybackSnapshot\(Date.now\(\),sourceId\)/);
});
