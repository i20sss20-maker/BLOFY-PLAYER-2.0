import test from 'node:test';
import assert from 'node:assert/strict';
import {
 validatePrivateFullHeadManifest,auditAllVerifiedPrivateS3Chunks
} from '../src/private-full-head-audit.mjs';
const SOURCE='123e4567-e89b-42d3-a456-426614174000';
const runId='verified_movie_head_full_001';
function setup(count=65){
 const manifest={bytes:count*1024*1024,sha256:'a'.repeat(64),
  parts:Array.from({length:count},(_,i)=>({
   partNumber:i+1,sha256:'b'.repeat(64),bytes:1024*1024,
   key:'saleh/movie/'+SOURCE+'/batch_123456789012345678901234_part_'+
     String(i+1).padStart(6,'0')+'.mkv'
  }))};
 const calls=[];
 return {manifest,calls,
  lease:{async getVerifiedChunkedObject(id){
   assert.equal(id,runId);return manifest;}},
  storage:{async headVerifiedChunk(args){
   calls.push(args);return {ok:true,status:'present_size_match',
    bytes:args.expectedBytes};}}
 };
}
test('physical HEAD full scan checks every chunk with bounded sequential S3 requests',async()=>{
 const x=setup(65),progress=[];
 const out=await auditAllVerifiedPrivateS3Chunks({
  kind:'movie',runId,lease:x.lease,storage:x.storage,pauseMs:0,
  onProgress:r=>progress.push(r)});
 assert.equal(out.ok,true);
 assert.equal(out.code,'full_private_head_all_chunk_sizes_match');
 assert.equal(out.totalParts,65);
 assert.equal(out.checkedParts,65);
 assert.equal(out.matched,65);
 assert.equal(out.allPartsHeadChecked,true);
 assert.equal(out.allPhysicalS3ChunkSizesMatched,true);
 assert.equal(out.contentSha256Recomputed,false);
 assert.equal(out.s3MediaBytesRead,0);
 assert.equal(out.sourceMediaRequests,0);
 assert.equal(x.calls.length,65);
 assert.deepEqual(progress.map(p=>p.visited),[32,64,65]);
 assert.ok(x.calls.every(p=>p.expectedBytes===1024*1024));
});
test('a single missing part is detected; no full-success claim',async()=>{
 const x=setup(17);
 x.storage.headVerifiedChunk=async({key,expectedBytes})=>{
  x.calls.push(key);
  return key.includes('_000009')?{ok:false,status:'missing'}:
   {ok:true,status:'present_size_match',bytes:expectedBytes};
 };
 const out=await auditAllVerifiedPrivateS3Chunks({
  kind:'movie',runId,lease:x.lease,storage:x.storage,pauseMs:0});
 assert.equal(out.ok,false);
 assert.equal(out.code,'full_private_head_needs_attention');
 assert.equal(out.checkedParts,17);
 assert.equal(out.matched,16);
 assert.equal(out.missing,1);
 assert.equal(out.allPartsHeadChecked,true);
 assert.equal(out.allPhysicalS3ChunkSizesMatched,false);
});
test('inconsistent manifest is rejected before touching any physical S3 object',async()=>{
 const x=setup(3);
 x.manifest.parts[1].bytes=123;
 assert.equal(validatePrivateFullHeadManifest(x.manifest).ok,false);
 const out=await auditAllVerifiedPrivateS3Chunks({
  kind:'movie',runId,lease:x.lease,storage:x.storage,pauseMs:0});
 assert.equal(out.ok,false);
 assert.equal(out.code,'full_private_head_total_mismatch');
 assert.equal(x.calls.length,0);
});
test('aborted whole-file audit never reports all S3 parts verified',async()=>{
 const x=setup(32);
 const controller=new AbortController();
 x.storage.headVerifiedChunk=async args=>{
  x.calls.push(args);
  if(x.calls.length===8)controller.abort();
  return {ok:true,status:'present_size_match',bytes:args.expectedBytes};
 };
 const out=await auditAllVerifiedPrivateS3Chunks({
  kind:'movie',runId,lease:x.lease,storage:x.storage,pauseMs:0,
  signal:controller.signal});
 assert.equal(out.ok,false);
 assert.equal(out.code,'full_private_head_incomplete');
 assert.equal(out.allPartsHeadChecked,false);
 assert.equal(out.checkedParts<32,true);
 assert.equal(x.calls.length,8);
});
test('transient S3 failures are retried only once, fail closed if never recovered',async()=>{
 const x=setup(2);
 x.storage.headVerifiedChunk=async args=>{
  x.calls.push(args);
  if(x.calls.length===1)return {ok:false,status:'head_unavailable'};
  return {ok:true,status:'present_size_match',bytes:args.expectedBytes};
 };
 const out=await auditAllVerifiedPrivateS3Chunks({
  kind:'movie',runId,lease:x.lease,storage:x.storage,pauseMs:0});
 assert.equal(out.ok,true);
 assert.equal(out.retries,1);
 assert.equal(x.calls.length,3);
});
test('reject path traversal, duplicate part numbering and oversized manifest',()=>{
 const x=setup(2);
 x.manifest.parts[0].key='https://evil.invalid/file';
 assert.equal(validatePrivateFullHeadManifest(x.manifest).ok,false);
 const y=setup(2);
 y.manifest.parts[1].partNumber=1;
 assert.equal(validatePrivateFullHeadManifest(y.manifest).ok,false);
 const z=setup(513);
 assert.equal(validatePrivateFullHeadManifest(z.manifest).ok,false);
});
test('episode reads its own exact verified manifest only',async()=>{
 const x=setup(1);
 const lease={getVerifiedEpisodeObject:async id=>{
  assert.equal(id,runId);
  x.manifest.parts[0].key=x.manifest.parts[0].key.replace('/movie/','/episode/');
  return x.manifest;
 }};
 const out=await auditAllVerifiedPrivateS3Chunks({
  kind:'episode',runId,lease,storage:x.storage,pauseMs:0});
 assert.equal(out.ok,true);
 assert.equal(out.matched,1);
});
