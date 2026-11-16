import test from 'node:test';
import assert from 'node:assert/strict';
import {allowedScope,runDeviceRangeSmoke}
 from '../scripts/railway-migration-device-range-smoke.mjs';
const env={RAILWAY_PROJECT_ID:'538a56fa-cdbb-49ba-9620-d350dcdc6aa4',
 RAILWAY_ENVIRONMENT_NAME:'test',BLOFY_QA_SYNTHETIC_ONLY:'1'};
test('private synthetic HTTP QA denies production and source credentials',()=>{
 assert.equal(allowedScope(env),true);
 assert.equal(allowedScope({...env,RAILWAY_ENVIRONMENT_NAME:'production'}),false);
 assert.equal(allowedScope({...env,XTREAM_PASSWORD:'secret'}),false);
 assert.equal(allowedScope({...env,BLOFY_CONTENT_HUB_BRIDGE_TOKEN:'secret'}),false);
});
test('scope gate prevents any network or media executor calls',async()=>{
 let calls=0;
 const r=await runDeviceRangeSmoke({
  env:{...env,RAILWAY_PROJECT_ID:'production'},
  fetchImpl:async()=>{calls++},
  run:async()=>{calls++}
 });
 assert.equal(r.ok,false);assert.equal(r.code,'device_qa_probe_scope_invalid');
 assert.equal(calls,0);
});
test('unavailable test-only server reports sanitized failure',async()=>{
 const r=await runDeviceRangeSmoke({env,
   fetchImpl:async()=>({status:503}),run:async()=>{throw Error('secret')}});
 assert.equal(r.ok,false);assert.equal(r.stage,'health');
 assert.equal(r.providerMediaRequests,0);
});
