import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createPrivateS3Adapter} from '../src/private-s3.mjs';

function s3(send){
 return createPrivateS3Adapter({config:{
  BLOFY_CONTENT_HUB_S3_BUCKET:'private-fixture',
  BLOFY_CONTENT_HUB_S3_ENDPOINT:'https://test.storageapi.dev',
  BLOFY_CONTENT_HUB_S3_ACCESS_KEY_ID:'fixture',
  BLOFY_CONTENT_HUB_S3_SECRET_ACCESS_KEY:'fixture',
  BLOFY_CONTENT_HUB_S3_REGION:'auto'
 },client:{send}});
}
test('private S3 cost usage counts all current objects with full pagination',async()=>{
 const calls=[];
 const storage=s3(async cmd=>{
  calls.push(cmd.constructor.name);
  switch(cmd.constructor.name){
   case 'GetBucketVersioningCommand':return {};
   case 'ListMultipartUploadsCommand':return {Uploads:[],IsTruncated:false};
   case 'ListObjectsV2Command':
    return !cmd.input.ContinuationToken?
     {IsTruncated:true,NextContinuationToken:'next',
      Contents:[{Size:8388608},{Size:512}]}:
     {IsTruncated:false,Contents:[{Size:1024}]};
   default:throw Error('unexpected S3 operation');
  }
 });
 const p=await storage.measurePrivateUsage();
 assert.equal(p.ok,true);
 assert.equal(p.usageExact,true);
 assert.equal(p.usedBytes,8388608+512+1024);
 assert.equal(p.objectCount,3);
 assert.equal(p.providerRequests,0);
 assert.equal(p.customerCutover,false);
 assert.deepEqual(calls,['GetBucketVersioningCommand',
  'ListMultipartUploadsCommand','ListObjectsV2Command',
  'ListObjectsV2Command']);
});
test('active multipart and versioned buckets fail closed before listing',async()=>{
 for(const mode of ['multipart','versioned']){
  const calls=[];
  const storage=s3(async cmd=>{
   calls.push(cmd.constructor.name);
   if(cmd.constructor.name==='GetBucketVersioningCommand')
    return mode==='versioned'?{Status:'Enabled'}:{};
   if(cmd.constructor.name==='ListMultipartUploadsCommand')
    return {Uploads:[{UploadId:'in-progress'}]};
   throw Error('unexpected listing');
  });
  const p=await storage.measurePrivateUsage();
  assert.equal(p.ok,false);
  assert.ok(p.code.startsWith('private_usage_'));
  assert.equal(calls.includes('ListObjectsV2Command'),false);
 }
});
test('truncated S3 listing or unknown size cannot fake exact capacity',async()=>{
 const storage=s3(async cmd=>{
  if(cmd.constructor.name==='GetBucketVersioningCommand')return {};
  if(cmd.constructor.name==='ListMultipartUploadsCommand')return {Uploads:[]};
  return {IsTruncated:true,Contents:[{Size:8388608}]};
 });
 const p=await storage.measurePrivateUsage();
 assert.equal(p.ok,false);assert.equal(p.code,'private_usage_cursor_invalid');
 const missing=s3(async cmd=>{
  if(cmd.constructor.name==='GetBucketVersioningCommand')return {};
  if(cmd.constructor.name==='ListMultipartUploadsCommand')return {Uploads:[]};
  return {IsTruncated:false,Contents:[{Size:undefined}]};
 });
 const bad=await missing.measurePrivateUsage();
 assert.equal(bad.ok,false);
 assert.equal(bad.code,'private_usage_item_invalid');
});
test('capacity endpoint is Bearer-private, read-only, opt-in and budget-bounded',async()=>{
 const src=await readFile(new URL('../src/server.mjs',import.meta.url),'utf8');
 for(const s of [
  "path==='/internal/mirror/preflight-capacity'",
  "BLOFY_CONTENT_HUB_MIRROR_CAPACITY_AUDIT_ENABLED!=='1'",
  "BLOFY_CONTENT_HUB_MIRROR_BUDGET_BYTES",
  "'private-bucket-capacity-preflight'",
  'storage.measurePrivateUsage',
  "private_capacity_budget_unconfigured",
  'automaticDownload:false,customerCutover:false'
 ])assert.ok(src.includes(s),s);
});
