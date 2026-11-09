import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRestreamMetrics,metricsOrigin,getRestreamMetrics} from '../src/restream-observability.mjs';
const source='channel?username=secret&password=hidden';
const example=[
 'paths{name="'+source+'",state="ready"} 1',
 'paths_readers{name="'+source+'",state="ready",readerType="hls"} 2',
 'paths_inbound_bytes{name="'+source+'",state="ready"} 12345',
 'hls_sessions{id="abc",path="'+source+'"} 1',
 'hls_sessions{id="def",path="'+source+'"} 1',
 'hls_muxers_outbound_bytes{name="'+source+'"} 9876',
 'hls_muxers_outbound_frames_discarded{name="'+source+'"} 3'
].join('\n');
test('aggregate reader sessions and redact provider paths and session IDs',()=>{
 const snapshot=parseRestreamMetrics(example,{key:'test-private-key'});
 assert.equal(snapshot.ok,true);
 assert.equal(snapshot.totals.hlsSessions,2);
 assert.equal(snapshot.totals.readers,2);
 assert.equal(snapshot.totals.hlsBytes,9876);
 assert.equal(snapshot.totals.discardedFrames,3);
 assert.equal(snapshot.paths.length,1);
 assert.equal(snapshot.paths[0].ready,true);
 assert.ok(!JSON.stringify(snapshot).includes('password='));
 assert.ok(!JSON.stringify(snapshot).includes('abc'));
 assert.equal(snapshot.uniqueViewersVerified,false);
});
test('private metrics URL does not accept arbitrary hosts',()=>{
 assert.equal(metricsOrigin('http://blofy-restream-engine.railway.internal:8888'),
  'http://blofy-restream-engine.railway.internal:9998');
 assert.throws(()=>metricsOrigin('https://evil.example:8888'));
});
test('upstream failure returns fixed code, never response contents',async()=>{
 const result=await getRestreamMetrics('http://blofy-restream-engine.railway.internal:8888',{
  fetchImpl:async()=>new Response('provider password=bad',{status:503})});
 assert.equal(result.code,'restream_metrics_http_error');
 assert.ok(!JSON.stringify(result).includes('password'));
});
test('metrics endpoint sends no external tokens or sensitive paths',async()=>{
 const snapshot=await getRestreamMetrics('http://blofy-restream-engine.railway.internal:8888',{
  key:'test-private-key',
  fetchImpl:async(url,options)=>{
   assert.equal(url,'http://blofy-restream-engine.railway.internal:9998/metrics');
   assert.equal(options.redirect,'error');
   assert.ok(!options.headers.authorization);
   return new Response(example,{status:200,headers:{'content-type':'text/plain'}});
  }});
 assert.equal(snapshot.totals.hlsSessions,2);
});
