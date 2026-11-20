import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {inspectDailyMirrorPlan} from '../src/xtream-mirror-daily-plan.mjs';

const SOURCE='123e4567-e89b-42d3-a456-426614174000';
const DAY=new Date('2026-11-16T02:15:00.000Z');
const BYTES=16*1024*1024;
const ENV={BLOFY_STREAM_MIRROR_DAILY_PLAN_ENABLED:'1'};
function fixture({source=true,daily='completed',fresh=true,
 license=true,validator=true,preflight='eligible',items=null}={}){
 const calls=[];
 const sample=items||[
  {media_kind:'movie',catalog_id:'100',title:'Sample 100',
   extension:'mkv',state:'awaiting_size_and_license',
   preflight_state:preflight,expected_bytes:BYTES,
   measured_at:new Date(DAY.getTime()-(fresh?60000:60*60000)),
   validator_present:validator,validator_sha256:validator?'a'.repeat(64):null,
   rights_evidence_hash:license?'a'.repeat(64):null},
  {media_kind:'episode',catalog_id:'123456',title:'Episode',
   extension:'mp4',state:'awaiting_size_and_license',
   preflight_state:null,expected_bytes:null,
   measured_at:null,validator_present:null,
   rights_evidence_hash:null}
 ];
 return {calls,db:{async query(sql,args=[]){
  calls.push({sql,args});
  if(sql.includes('FROM blofy_xtream_servers'))
   return {rows:source?[{id:SOURCE}]:[]};
  if(sql.includes('FROM blofy_xtream_daily_catalog_requests'))
   return {rows:daily===null?[]:[{
    state:daily,finished_at:daily==='completed'?
      DAY:null}]};
  if(sql.includes('FROM blofy_stream_mirror_intents i'))
   return {rows:sample.slice(0,args[1])};
  throw Error('unexpected SQL');
 }}};
}
test('feature flag OFF and invalid id do not contact database',async()=>{
 const f=fixture();
 const no=await inspectDailyMirrorPlan(f.db,{
  env:{},sourceId:SOURCE,now:DAY});
 assert.equal(no.ok,false);
 assert.equal(no.code,'daily_mirror_plan_disabled');
 const invalid=await inspectDailyMirrorPlan(f.db,{
  env:ENV,sourceId:'../../invalid',now:DAY});
 assert.equal(invalid.ok,false);
 assert.equal(f.calls.length,0);
});
test('one exact active source and completed Riyadh import yields capped plan',async()=>{
 const f=fixture();
 const out=await inspectDailyMirrorPlan(f.db,{
  env:ENV,sourceId:SOURCE,now:DAY});
 assert.equal(out.ok,true);
 assert.equal(out.day,'2026-11-16');
 assert.equal(out.catalogSync,'completed');
 assert.equal(out.catalogConfirmed,true);
 assert.equal(out.eligibleForOwnerReview,1);
 assert.equal(out.blocked,1);
 assert.equal(out.items.length,2);
 assert.equal(out.eligibleBytes,BYTES);
 assert.equal(out.items[0].state,'eligible_for_owner_review');
 assert.equal(out.items[0].independentRightsVerification,false);
 assert.equal(out.items[0].autoTransferAuthorized,false);
 assert.equal(out.items[0].transferReady,false);
 assert.equal(out.items[1].state,'blocked');
 assert.equal(out.items[1].blockedBy.includes('preflight_missing'),true);
 assert.equal(out.items[1].blockedBy.includes('source_size_not_verified'),true);
 assert.equal(out.mediaCopyStarted,false);
 assert.equal(out.mediaBytesTransferred,0);
 assert.equal(out.providerRequests,0);
 assert.equal(out.customerCutover,false);
 assert.ok(f.calls.every(x=>x.sql.startsWith('SELECT')));
 assert.equal(f.calls.length,3);
});
test('failed or pending daily catalog receipts block all automatic eligibility',async()=>{
 for(const daily of [null,'queued','running','partial','failed']){
  const f=fixture({daily});
  const out=await inspectDailyMirrorPlan(f.db,{env:ENV,
   sourceId:SOURCE,now:DAY});
  assert.equal(out.ok,true);
  assert.equal(out.eligibleForOwnerReview,0);
  assert.ok(out.items.every(x=>
   x.blockedBy.includes('daily_catalog_not_confirmed')));
  assert.equal(out.automaticBytesScheduled,0);
 }
});
test('stale proof, missing licensing/validator and unverified size fail closed',async()=>{
 for(const opts of [
  {fresh:false},{license:false},{validator:false},
  {preflight:'measured'}
 ]){
  const f=fixture(opts),result=await inspectDailyMirrorPlan(
   f.db,{env:ENV,sourceId:SOURCE,now:DAY});
  assert.equal(result.ok,true);
  assert.equal(result.eligibleForOwnerReview,0);
  assert.equal(result.blocked,2);
  assert.ok(result.items[0].blockedBy.length>=1);
 }
});
test('disabled or ambiguous source cannot generate ready plan',async()=>{
 const f=fixture({source:false});
 const out=await inspectDailyMirrorPlan(f.db,{
  env:ENV,sourceId:SOURCE,now:DAY});
 assert.equal(out.ok,false);
 assert.equal(out.code,'daily_mirror_plan_source_not_approved');
 assert.equal(f.calls.length,1);
});
test('invalid staged identifiers filtered; no credentials or URLs returned',async()=>{
 const f=fixture({items:[{media_kind:'movie',catalog_id:'../../etc',
  title:'invalid',extension:'mkv',state:'awaiting_size_and_license',
  preflight_state:'eligible',expected_bytes:BYTES,
  measured_at:DAY,validator_present:true,
  rights_evidence_hash:'b'.repeat(64)}]});
 const out=await inspectDailyMirrorPlan(f.db,{env:ENV,sourceId:SOURCE,now:DAY});
 assert.equal(out.ok,true);
 assert.equal(out.items.length,0);
 assert.equal(out.providerRequests,0);
});
test('daily plan API is authenticated, fixed and separate from actual copy',async()=>{
 const source=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 assert.ok(source.includes("p==='/internal/blofy-stream/ops/mirror-intake/daily-plan'"));
 assert.ok(source.includes('inspectDailyMirrorPlan(controlPool'));
 assert.ok(source.includes("req.method!=='GET'"));
});
