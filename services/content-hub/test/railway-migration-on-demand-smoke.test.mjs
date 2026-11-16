import test from 'node:test';
import assert from 'node:assert/strict';
import {checkOnDemandFanout} from '../scripts/railway-migration-on-demand-smoke.mjs';
const env={RAILWAY_PROJECT_ID:'538a56fa-cdbb-49ba-9620-d350dcdc6aa4',
 RAILWAY_ENVIRONMENT_NAME:'test',BLOFY_QA_SYNTHETIC_ONLY:'1'};
test('no live stream read outside exact lab',async()=>{
 let calls=0;
 const r=await checkOnDemandFanout({
  env:{...env,RAILWAY_ENVIRONMENT_NAME:'production'},
  run:async()=>{calls++}
 });
 assert.equal(r.ok,false);assert.equal(calls,0);
});
test('two parallel readers decode independently',async()=>{
 let calls=0;const r=await checkOnDemandFanout({
  env,run:async()=>{calls++;return {stdout:'',stderr:''}}
 });
 assert.equal(r.ok,true);assert.equal(calls,2);
 assert.equal(r.viewersTested,2);assert.equal(r.customerCutover,false);
});
test('fail-closed if a reader fails',async()=>{
 let calls=0;const r=await checkOnDemandFanout({
  env,run:async()=>{calls++;if(calls===2)throw Error('unavailable')}
 });
 assert.equal(r.ok,false);assert.equal(r.passedViewers,1);
});
