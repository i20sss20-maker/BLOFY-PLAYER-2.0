import test from 'node:test';
import assert from 'node:assert/strict';
import {checkOnDemandFanout} from '../scripts/railway-migration-on-demand-smoke.mjs';

const env={
 RAILWAY_PROJECT_ID:'538a56fa-cdbb-49ba-9620-d350dcdc6aa4',
 RAILWAY_ENVIRONMENT_NAME:'test',BLOFY_QA_SYNTHETIC_ONLY:'1'
};
test('no live stream read outside exact isolated project',async()=>{
 let calls=0;
 const r=await checkOnDemandFanout({
  env:{...env,RAILWAY_ENVIRONMENT_NAME:'production'},
  run:async()=>{calls++}
 });
 assert.equal(r.ok,false);assert.equal(calls,0);
});
test('never uses provider source credentials',async()=>{
 let calls=0;
 const r=await checkOnDemandFanout({env:{...env,XTREAM_USERNAME:'secret'},
  run:async()=>{calls++}});
 assert.equal(r.ok,false);assert.equal(calls,0);
});
test('five parallel readers decode both tracks independently',async()=>{
 let calls=0;const r=await checkOnDemandFanout({
  env,run:async(_bin,args)=>{calls++;
    assert.ok(args.includes('0:a:0'));
    assert.ok(args.includes('0:v:0'));
    assert.ok(args.includes('8'));
    return {stdout:'',stderr:''};
  },now:()=>1234
 });
 assert.equal(r.ok,true);assert.equal(calls,5);
 assert.equal(r.viewersTested,5);assert.equal(r.passedViewers,5);
 assert.equal(r.customerCutover,false);
 assert.equal(r.independentPublisherCountVerified,false);
});
test('fail-closed if one of five viewers fails',async()=>{
 let calls=0;const r=await checkOnDemandFanout({
  env,run:async()=>{calls++;if(calls===5)throw Error('unavailable')}
 });
 assert.equal(r.ok,false);assert.equal(r.passedViewers,4);
 assert.equal(r.code,'canary_parallel_decode_failed');
});
