import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveVerifiedMirrorMedia}
 from '../src/xtream-mirror-private-qa.mjs';

const ID='123e4567-e89b-42d3-a456-426614174000';
const runId='mirror_'+'a'.repeat(40),sha='b'.repeat(64),size=16777216;
const row={copy_run_id:runId,copy_sha256:sha,
 source_id:ID,media_id:'movie_123',gateway_id:123,
 expected_bytes:String(size),extension:'mp4',
 copy_completed_at:'2026-11-15T01:00:00Z'};
const base={sourceId:ID,mediaKind:'movie',gatewayId:123};
function fake({record=row,manifest={
  kind:'chunked',mediaKind:'movie',sourceId:ID,mediaId:'movie_123',
  gatewayId:123,bytes:size,sha256:sha,extension:'mp4',
  parts:[{partNumber:1},{partNumber:2}]
}}={}){
 let reads=0,sql='';
 const db={query:async(q,args)=>{
  sql=q;assert.deepEqual(args,[ID,'movie',123]);
  return {rows:record?[record]:[]};
 }};
 const lease={getVerifiedChunkedObject:async()=>{
  reads++;return manifest;
 },getVerifiedEpisodeObject:async()=>{throw Error('wrong_kind')}};
 return {db,lease,getReads:()=>reads,getSql:()=>sql};
}
test('reconcile exact rights-reviewed mirror row and independent private manifest',async()=>{
 const f=fake();
 const r=await resolveVerifiedMirrorMedia({...f,...base});
 assert.equal(r.ok,true);
 assert.equal(r.runId,runId);
 assert.equal(r.sha256,sha);
 assert.equal(r.parts,2);
 assert.equal(r.bytes,size);
 assert.equal(r.customerCutover,false);
 assert.equal(r.providerRequests,0);
 assert.equal(f.getReads(),1);
 for(const term of ["q.state='verified'","q.mapping_conflict=FALSE",
  'q.copy_completed_at IS NOT NULL','q.rights_ref_sha256',
  "q.copy_sha256 ~","q.source_id=$1","q.media_kind=$2","q.gateway_id=$3"])
  assert.ok(f.getSql().includes(term),term);
});
test('no verified row means no access to private files',async()=>{
 const f=fake({record:null});
 const r=await resolveVerifiedMirrorMedia({...f,...base});
 assert.equal(r.ok,false);
 assert.equal(r.code,'mirror_qa_no_verified_record');
 assert.equal(f.getReads(),0);
});
test('tampered length, sha or extension cannot become QA-ready',async()=>{
 for(const manifest of [
  {bytes:size-1,sha256:sha,extension:'mp4',parts:[{}]},
  {bytes:size,sha256:'c'.repeat(64),extension:'mp4',parts:[{}]},
  {bytes:size,sha256:sha,extension:'mkv',parts:[{}]},
  {bytes:size,sha256:sha,extension:'mp4',parts:[]}
 ]){
  const f=fake({manifest});
  const result=await resolveVerifiedMirrorMedia({...f,...base});
  assert.equal(result.ok,false);
  assert.equal(result.code,'mirror_qa_manifest_mismatch');
 }
});
test('verified episodes get checked via episode S3 manifest only',async()=>{
 let hits=0;
 const db={query:async()=>({rows:[{...row,
  media_id:'episode_88',gateway_id:88,extension:'mkv'}]})};
 const lease={
  getVerifiedChunkedObject:async()=>{throw Error('wrong_kind')},
  getVerifiedEpisodeObject:async id=>{
   hits++;assert.equal(id,runId);
   return {kind:'chunked',mediaKind:'episode',sourceId:ID,
    mediaId:'episode_88',gatewayId:88,
    bytes:size,sha256:sha,extension:'mkv',parts:[{},{}]};
  }
 };
 const r=await resolveVerifiedMirrorMedia({
  db,lease,sourceId:ID,mediaKind:'episode',gatewayId:88
 });
 assert.equal(r.ok,true);
 assert.equal(r.mediaKind,'episode');
 assert.equal(hits,1);
});
test('invalid selections never query database',async()=>{
 const f=fake();
 await assert.rejects(()=>resolveVerifiedMirrorMedia({
  ...f,sourceId:'x',mediaKind:'movie',gatewayId:123
 }),/selection_invalid/);
 await assert.rejects(()=>resolveVerifiedMirrorMedia({
  ...f,sourceId:ID,mediaKind:'live',gatewayId:123
 }),/selection_invalid/);
 assert.equal(f.getReads(),0);
});

test('private QA rejects cross-source and remapped movie files even with matching SHA and length',async()=>{
 const manifest={kind:'chunked',mediaKind:'movie',
  sourceId:ID,mediaId:'movie_123',gatewayId:123,
  bytes:size,sha256:sha,extension:'mp4',parts:[{},{}]};
 for(const override of [
  {sourceId:'523e4567-e89b-42d3-a456-426614174000'},
  {mediaId:'different_movie'},
  {gatewayId:999},
  {mediaKind:'episode'},
  {kind:'not_chunked'},
  {sourceId:undefined}
 ]){
  const f=fake({manifest:{...manifest,...override}});
  const result=await resolveVerifiedMirrorMedia({...f,...base});
  assert.equal(result.ok,false,JSON.stringify(override));
  assert.equal(result.code,'mirror_qa_manifest_mismatch');
 }
});
test('owner QA requires exact reviewed movie identity in queue even if a manifest exists',async()=>{
 const f=fake({record:{...row,media_id:''}});
 const result=await resolveVerifiedMirrorMedia({...f,...base});
 assert.equal(result.ok,false);
 assert.equal(result.code,'mirror_qa_record_invalid');
 assert.equal(f.getReads(),0);
});
