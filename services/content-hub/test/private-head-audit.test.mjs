import test from 'node:test';
import assert from 'node:assert/strict';
import {auditPrivateHeadBatch,validatePrivateHeadSelection,PRIVATE_HEAD_BATCH}
 from '../src/private-head-audit.mjs';
const SOURCE='123e4567-e89b-42d3-a456-426614174000';
const SHA='a'.repeat(64);
const MOVIE='1349410';
function fake(count=17){
 const calls=[];
 const manifest={kind:'chunked',sha256:SHA,
  bytes:count*1024*1024,
  parts:Array.from({length:count},(_,i)=>({
   partNumber:i+1,key:'saleh/movie/'+SOURCE+'/batch_123456789012345678901234_part_'+
    String(i+1).padStart(6,'0')+'.mkv',
   sha256:'b'.repeat(64),bytes:1024*1024}))};
 return {calls,manifest,
  lease:{getVerifiedManifestForPhysicalAudit:async args=>{
   calls.push({kind:'lease',args});return {runId:'verified_run_0001',manifest}}},
  storage:{headVerifiedChunk:async args=>{
   calls.push({kind:'head',args});
   return {ok:true,status:'present_size_match',bytes:args.expectedBytes};
  }}
 };
}
test('owner physical audit validates exact source and 8-part request cursor',()=>{
 assert.equal(PRIVATE_HEAD_BATCH,8);
 assert.equal(validatePrivateHeadSelection({
  sourceId:SOURCE,kind:'movie',id:MOVIE,start:0}),true);
 assert.equal(validatePrivateHeadSelection({
  sourceId:SOURCE,kind:'episode',id:'127434',start:504}),true);
 for(const item of [
  {kind:'movie',id:'../../etc/passwd',start:0},
  {kind:'movie',id:'https://evil.test',start:0},
  {kind:'episode',id:'1 OR 1=1',start:0},
  {kind:'movie',id:MOVIE,start:7},
  {kind:'movie',id:MOVIE,start:512}
 ]){
  assert.equal(validatePrivateHeadSelection({sourceId:SOURCE,...item}),false);
 }
});
test('reads at most 8 S3 HEADs per request and makes no full-file claim',async()=>{
 const m=fake(17);
 const a=await auditPrivateHeadBatch({
  sourceId:SOURCE,kind:'movie',id:MOVIE,start:0,
  lease:m.lease,storage:m.storage});
 assert.equal(a.ok,true);
 assert.equal(a.partsChecked,8);
 assert.equal(a.matchedParts,8);
 assert.equal(a.nextPartStart,8);
 assert.equal(a.totalParts,17);
 assert.equal(a.entireFileHeadCheckedInThisRequest,false);
 assert.equal(a.contentSha256Recomputed,false);
 assert.equal(a.currentPhysicalS3ProofType,'HEAD_object_size_only');
 assert.equal(a.mediaBytesTransferred,0);
 assert.equal(a.providerRequests,0);
 assert.equal(m.calls.filter(x=>x.kind==='head').length,8);
 assert.equal(m.calls[0].args.sourceId,SOURCE);
 assert.equal(m.calls.at(-1).args.expectedBytes,1024*1024);
});
test('a final 1-part page only establishes current-batch checks',async()=>{
 const m=fake(17);
 const a=await auditPrivateHeadBatch({
  sourceId:SOURCE,kind:'movie',id:MOVIE,start:16,
  lease:m.lease,storage:m.storage});
 assert.equal(a.ok,true);
 assert.equal(a.partsChecked,1);
 assert.equal(a.nextPartStart,null);
 assert.equal(a.entireFileHeadCheckedInThisRequest,false);
});
test('missing physical S3 object is not accepted even with verified DB manifest',async()=>{
 const m=fake(8);
 let i=0;
 m.storage.headVerifiedChunk=async()=>{
  i++;return i===3?{ok:false,status:'missing'}:
    {ok:true,status:'present_size_match',bytes:1024*1024};
 };
 const a=await auditPrivateHeadBatch({
  sourceId:SOURCE,kind:'movie',id:MOVIE,start:0,
  lease:m.lease,storage:m.storage});
 assert.equal(a.ok,true);
 assert.equal(a.failures,1);
 assert.equal(a.checks[2].status,'missing');
 assert.equal(a.currentBatchAllSizesMatched,false);
 assert.equal(a.entireFileHeadCheckedInThisRequest,false);
});
test('only one <=8-part source file can be proved size-present in one request',async()=>{
 const m=fake(3);
 const a=await auditPrivateHeadBatch({
  sourceId:SOURCE,kind:'movie',id:MOVIE,start:0,
  lease:m.lease,storage:m.storage});
 assert.equal(a.entireFileHeadCheckedInThisRequest,true);
 assert.equal(a.contentSha256Recomputed,false);
});
test('no verified manifest prevents any S3 access',async()=>{
 let n=0;
 const a=await auditPrivateHeadBatch({
  sourceId:SOURCE,kind:'movie',id:MOVIE,start:0,
  lease:{getVerifiedManifestForPhysicalAudit:async()=>null},
  storage:{headVerifiedChunk:async()=>{n++}}});
 assert.equal(a.ok,false);
 assert.equal(a.code,'private_head_verified_manifest_missing');
 assert.equal(n,0);
});
