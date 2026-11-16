import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectViewerProgress,runEnduranceCanary}
  from '../scripts/railway-migration-endurance-smoke.mjs';

const env={RAILWAY_PROJECT_ID:'538a56fa-cdbb-49ba-9620-d350dcdc6aa4',
  RAILWAY_ENVIRONMENT_NAME:'test',BLOFY_QA_SYNTHETIC_ONLY:'1'};
const complete='frame=450\nout_time_us=30000000\nprogress=end\n';
const short='frame=180\nout_time_us=12000000\nprogress=end\n';

test('rejects empty, incomplete, short and low-frame transcripts',()=>{
 assert.equal(inspectViewerProgress('').ok,false);
 assert.equal(inspectViewerProgress(short).ok,false);
 assert.equal(inspectViewerProgress('frame=460\nout_time_us=30000000\n').ok,false);
 assert.equal(inspectViewerProgress('frame=120\nout_time_us=30000000\nprogress=end').ok,false);
 assert.equal(inspectViewerProgress(complete).ok,true);
});

test('scoping prevents live access on wrong project, missing approval or provider credentials',async()=>{
 let called=0;
 const run=async()=>{called++;return {stdout:complete}};
 for(const mod of [
  {RAILWAY_PROJECT_ID:'other'},
  {RAILWAY_ENVIRONMENT_NAME:'production'},
  {BLOFY_QA_SYNTHETIC_ONLY:'0'},
  {XTREAM_PASSWORD:'secret'},
  {BLOFY_CONTENT_HUB_BRIDGE_TOKEN:'secret'}
 ]){
  const result=await runEnduranceCanary({env:{...env,...mod},run});
  assert.equal(result.ok,false);
  assert.equal(result.code,'endurance_scope_invalid');
 }
 assert.equal(called,0);
});
test('five viewers must each complete at least 28s with >300 video frames',async()=>{
 let count=0;
 const result=await runEnduranceCanary({env,now:()=>1500,
  run:async(binary,args)=>{
   count++;
   assert.equal(binary,'ffmpeg');
   assert.ok(args.includes('0:v:0'));
   assert.ok(args.includes('0:a:0'));
   assert.ok(args.includes('30'));
   return {stdout:complete};
  }});
 assert.equal(count,5);assert.equal(result.ok,true);
 assert.equal(result.passedViewers,5);assert.equal(result.minimumDecodedSeconds,30);
 assert.equal(result.minimumVideoFrames,450);
 assert.equal(result.customerCutover,false);
 assert.equal(result.providerMediaRequests,0);
});

test('one early clean EOF fails the entire cohort, even without process error',async()=>{
 let count=0;
 const result=await runEnduranceCanary({env,run:async()=>{
  count++;return {stdout:count===5?short:complete};
 }});
 assert.equal(result.ok,false);assert.equal(result.passedViewers,4);
 assert.equal(result.minimumDecodedSeconds,12);
});
test('one ffmpeg exception fails closed without emitting secrets',async()=>{
 let count=0;
 const result=await runEnduranceCanary({env,run:async()=>{
  count++;if(count===3)throw Error('private-key-do-not-report');
  return {stdout:complete};
 }});
 assert.equal(result.ok,false);assert.equal(result.passedViewers,4);
 assert.ok(!JSON.stringify(result).includes('private-key-do-not-report'));
});
