import test from 'node:test';
import assert from 'node:assert/strict';
import {createPrivateS3Adapter} from '../src/private-s3.mjs';
const UUID='123e4567-e89b-42d3-a456-426614174000';
const KEY='saleh/movie/'+UUID+'/batch_123456789012345678901234_part_000001.mkv';
function s3(send){
 const config={
  BLOFY_CONTENT_HUB_S3_BUCKET:'private-fixture',
  BLOFY_CONTENT_HUB_S3_ENDPOINT:'https://test.storageapi.dev',
  BLOFY_CONTENT_HUB_S3_ACCESS_KEY_ID:'test',
  BLOFY_CONTENT_HUB_S3_SECRET_ACCESS_KEY:'test',
  BLOFY_CONTENT_HUB_S3_REGION:'auto'
 };
 return createPrivateS3Adapter({config,client:{send}});
}
test('private S3 HEAD-only checks current object size, never calls GET media',async()=>{
 const cmds=[];
 const storage=s3(async(cmd)=>{
  cmds.push(cmd.constructor.name);
  assert.equal(cmd.input.Key,KEY);
  assert.equal(cmd.input.Bucket,'private-fixture');
  return {ContentLength:1024*1024};
 });
 const a=await storage.headVerifiedChunk({key:KEY,expectedBytes:1024*1024});
 assert.deepEqual(a,{ok:true,status:'present_size_match',bytes:1024*1024});
 assert.deepEqual(cmds,['HeadObjectCommand']);
 const b=await storage.headVerifiedChunk({key:KEY,expectedBytes:1024});
 assert.equal(b.status,'size_mismatch');
 assert.equal(b.ok,false);
});
test('HEAD 404 and S3 errors are never presented as physical proof',async()=>{
 const missing=s3(async()=>{throw Object.assign(Error('404'),{
  name:'NotFound',$metadata:{httpStatusCode:404}})});
 const a=await missing.headVerifiedChunk({key:KEY,expectedBytes:1024});
 assert.equal(a.status,'missing');assert.equal(a.ok,false);
 const offline=s3(async()=>{throw Error('network')});
 const b=await offline.headVerifiedChunk({key:KEY,expectedBytes:1024});
 assert.equal(b.status,'head_unavailable');assert.equal(b.ok,false);
});
test('invalid paths and oversized S3 HEAD checks fail without any S3 contact',async()=>{
 let calls=0;
 const storage=s3(async()=>{calls++;return {ContentLength:100}});
 await assert.rejects(()=>storage.headVerifiedChunk({
  key:'https://evil.invalid/bucket',expectedBytes:100}),/invalid_object_key/);
 await assert.rejects(()=>storage.headVerifiedChunk({
  key:KEY,expectedBytes:64*1024*1024}),/private_head_invalid/);
 assert.equal(calls,0);
});
