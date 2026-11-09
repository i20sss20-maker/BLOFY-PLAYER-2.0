import test from 'node:test';
import assert from 'node:assert/strict';
import {runSyntheticHlsRamp} from '../src/restream-load-ramp.mjs';
test('100 synthetic segment readers ramp without invoking provider sources',async()=>{
 let probes=0;
 const result=await runSyntheticHlsRamp({assertIsolated:true,probe:async()=>{
  probes++;return {ok:true,mediaVerified:true,elapsedMs:25};
 },delay:async()=>{}});
 assert.equal(result.ok,true);
 assert.deepEqual(result.steps.map(x=>x.requests),[2,10,25,50,100]);
 assert.equal(probes,187);
 assert.equal(result.continuousViewersVerified,false);
 assert.equal(result.realSourceVerified,false);
});
test('no isolated environment means no requests',async()=>{
 let calls=0;
 const result=await runSyntheticHlsRamp({probe:async()=>{calls++;return {ok:true}}});
 assert.equal(result.code,'load_test_isolation_required');assert.equal(calls,0);
});
test('one failure stops before higher concurrency levels',async()=>{
 let calls=0;
 const result=await runSyntheticHlsRamp({assertIsolated:true,ramp:[2,10,100],
  probe:async()=>{calls++;return {ok:calls!==3,mediaVerified:true}}});
 assert.equal(result.ok,false);
 assert.deepEqual(result.steps.map(x=>x.requests),[2,10]);
 assert.equal(calls,12);
});
test('invalid ramp does not run',async()=>{
 const result=await runSyntheticHlsRamp({assertIsolated:true,probe:async()=>{},
  ramp:[100,10]});
 assert.equal(result.code,'load_ramp_invalid');
});
