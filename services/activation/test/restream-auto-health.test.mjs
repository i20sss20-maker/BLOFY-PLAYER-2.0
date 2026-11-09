import test from 'node:test';
import assert from 'node:assert/strict';
import {checkRestreamHealth,publicHealthSummary,resetRestreamHealthForTest,
 verifySyntheticConcurrency} from '../src/restream-auto-health.mjs';
test('synthetic failures alert after three checks without assuming real failure',async()=>{
 resetRestreamHealthForTest();
 for(let i=1;i<=3;i++){
  const r=await checkRestreamHealth({clock:()=>i*120000,probe:async()=>({
   ok:false,code:'restream_smoke_engine_unreachable',mediaVerified:false
  })});
  assert.equal(r.consecutiveFailures,i);
 }
 const summary=publicHealthSummary();
 assert.equal(summary.alert,'synthetic_restream_repeated_failure');
 assert.equal(summary.realSourceVerified,false);
 assert.equal(summary.history.length,3);
});
test('recovery resets alert and safe report does not expose upstream strings',async()=>{
 resetRestreamHealthForTest();
 const a=await checkRestreamHealth({clock:()=>120000,probe:async()=>({
  ok:true,code:'synthetic_hls_ts_verified',mediaVerified:true,
  providerUrl:'http://secret/path?password=do-not-leak'
 })});
 assert.equal(a.ok,true);
 assert.equal(a.consecutiveFailures,0);
 assert.ok(!JSON.stringify(a).includes('do-not-leak'));
});
test('cooldown prevents repeated checks',async()=>{
 resetRestreamHealthForTest();
 let calls=0;
 const opts={clock:()=>120000,probe:async()=>{calls++;return {ok:true,code:'synthetic_hls_ts_verified',mediaVerified:true}}};
 await checkRestreamHealth(opts);
 const r=await checkRestreamHealth(opts);
 assert.equal(r.code,'health_check_cooldown');
 assert.equal(calls,1);
});
test('concurrency bounded and synthetic-only',async()=>{
 let n=0;
 const r=await verifySyntheticConcurrency({concurrency:3,probe:async()=>{n++;return {
  ok:true,mediaVerified:true,code:'synthetic_hls_ts_verified'
 }}});
 assert.equal(r.ok,true);assert.equal(n,3);
 assert.equal(r.realSourceVerified,false);
 const blocked=await verifySyntheticConcurrency({concurrency:11,probe:async()=>{}});
 assert.equal(blocked.ok,false);assert.equal(n,3);
});
