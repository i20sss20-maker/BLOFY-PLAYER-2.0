import test from 'node:test';
import assert from 'node:assert/strict';
import {createSourceLease} from '../src/source-lease.mjs';

const source='123e4567-e89b-42d3-a456-426614174000';
const other='523e4567-e89b-42d3-a456-426614174000';
const runId='mirror_'+'a'.repeat(40);
const digest='b'.repeat(64),bytes=8*1024*1024;
function fakeLease({mediaKind='movie',storedSource=source,keySource=source,
 storedMedia='media_123',gatewayId=12}={}){
 const path='saleh/'+mediaKind+'/'+keySource+
  '/batch_'+'f'.repeat(24)+'_part_000001.mp4';
 let selects=0;
 const record={
  source_id:storedSource,media_id:storedMedia,gateway_id:gatewayId,
  extension:'mp4',expected_bytes:String(bytes),
  verified_sha256:digest,
  parts:[{partNumber:1,key:path,bytes,sha256:digest}]
 };
 class Pool{
  constructor(){}
  async query(sql){
   if(sql.includes('FROM blofy_content_hub_episode_runs')||
      sql.includes('FROM blofy_content_hub_chunk_runs')){
    selects++;return {rows:[record]};
   }
   throw Error('unexpected_lease_sql');
  }
  async end(){}
 }
 return {
  lease:createSourceLease({connectionString:'postgres://fake',Pool}),
  getSelects:()=>selects
 };
}

test('private movie full SHA manifest retains exact source, media and gateway identity',async()=>{
 const {lease,getSelects}=fakeLease();
 const object=await lease.getVerifiedChunkedObject(runId);
 assert.ok(object);
 assert.equal(object.kind,'chunked');
 assert.equal(object.mediaKind,'movie');
 assert.equal(object.sourceId,source);
 assert.equal(object.gatewayId,12);
 assert.equal(object.mediaId,'media_123');
 assert.equal(object.bytes,bytes);
 assert.equal(object.parts.length,1);
 assert.equal(getSelects(),1);
 await lease.close();
});

test('private episode full SHA manifest carries its exact origin identity',async()=>{
 const {lease}=fakeLease({mediaKind:'episode'});
 const object=await lease.getVerifiedEpisodeObject(runId);
 assert.ok(object);
 assert.equal(object.kind,'chunked');
 assert.equal(object.mediaKind,'episode');
 assert.equal(object.sourceId,source);
 assert.equal(object.mediaId,'media_123');
 assert.equal(object.gatewayId,12);
 await lease.close();
});

test('wrong-source S3 part key is rejected for both film and episode before exposing playback',async()=>{
 for(const mediaKind of ['movie','episode']){
  const {lease}=fakeLease({mediaKind,keySource:other});
  const object=mediaKind==='movie'?
   await lease.getVerifiedChunkedObject(runId):
   await lease.getVerifiedEpisodeObject(runId);
  assert.equal(object,null,mediaKind);
  await lease.close();
 }
});

test('unknown or incomplete verified manifest row cannot authorize a private file',async()=>{
 for(const mediaKind of ['movie','episode']){
  for(const override of [
   {storedSource:other,keySource:source},
   {storedSource:'',keySource:source},
   {storedMedia:'',keySource:source},
   {gatewayId:0,keySource:source}
  ]){
   const {lease}=fakeLease({mediaKind,...override});
   const obj=mediaKind==='movie'?
    await lease.getVerifiedChunkedObject(runId):
    await lease.getVerifiedEpisodeObject(runId);
   assert.equal(obj,null,JSON.stringify({mediaKind,...override}));
   await lease.close();
  }
 }
});
