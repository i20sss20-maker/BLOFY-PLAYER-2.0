import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {runIsolatedS3Smoke} from '../scripts/railway-isolated-s3-smoke.mjs';

const M=5*1024*1024;
const ENV={
 BLOFY_QA_SYNTHETIC_ONLY:'1',BLOFY_QA_ISOLATED_BUCKET:'1',
 BLOFY_QA_EXPECTED_BUCKET:'blofy-mirror-s3-qa',
 BLOFY_CONTENT_HUB_S3_BUCKET:'blofy-mirror-s3-qa',
 BLOFY_CONTENT_HUB_S3_ENDPOINT:'https://qa.storageapi.dev',
 BLOFY_CONTENT_HUB_S3_URL_STYLE:'virtual-host',
 BLOFY_CONTENT_HUB_S3_REGION:'auto',
 BLOFY_CONTENT_HUB_S3_ACCESS_KEY_ID:'test_only',
 BLOFY_CONTENT_HUB_S3_SECRET_ACCESS_KEY:'test_only'
};
const sha=b=>createHash('sha256').update(b).digest('hex');
function fake(){
 const contents=new Map(), pending=new Map();const calls={deletes:0,parts:0};
 return {
  calls,contents,storage:{
   measurePrivateUsage:async()=>({ok:true,objectCount:contents.size,
    usedBytes:[...contents.values()].reduce((n,b)=>n+b.length,0)}),
   begin:async({key,private:priv})=>{
    assert.equal(priv,true);return {uploadId:'synthetic_test'}
   },
   part:async({key,body,partNumber})=>{
    const a=pending.get(key)||[];
    a.push({partNumber,body:Buffer.from(body)});
    pending.set(key,a);calls.parts++;
    return {etag:'"testpart'+partNumber+'"'};
   },
   complete:async({key})=>{
    const a=pending.get(key)||[];
    contents.set(key,Buffer.concat(a.sort((x,y)=>x.partNumber-y.partNumber)
     .map(x=>x.body)));pending.delete(key);
   },
   abort:async({key})=>{pending.delete(key)},
   remove:async({key})=>{calls.deletes++;contents.delete(key)},
   headVerifiedChunk:async({key,expectedBytes})=>({
    ok:contents.get(key)?.length===expectedBytes}),
   verify:async({key,expectedBytes,expectedSha256})=>{
    const b=contents.get(key);
    return {ok:b?.length===expectedBytes&&sha(b)===expectedSha256,
     sha256:sha(b)}
   },
   readVerifiedRange:async({key,from,to})=>{
    const {Readable}=await import('node:stream');
    return Readable.from([contents.get(key).subarray(from,to+1)]);
   }
  }};
}
test('synthetic smoke requires a distinct bucket and virtual-host mode',async()=>{
 for(const overrides of [
  {BLOFY_QA_SYNTHETIC_ONLY:'0'},
  {BLOFY_QA_ISOLATED_BUCKET:'0'},
  {BLOFY_QA_EXPECTED_BUCKET:'customer-bucket'},
  {BLOFY_CONTENT_HUB_S3_URL_STYLE:'path'}
 ]){
  const out=await runIsolatedS3Smoke({
   env:{...ENV,...overrides},makeStorage:()=>{throw Error('must not call')}
  });
  assert.equal(out.ok,false);assert.equal(out.writtenBytes,0);
  assert.equal(out.sourceRequests,0);assert.equal(out.customerCutover,false);
 }
});
test('isolated S3 smoke verifies 5MiB two-part SHA, Range, AES and cleanup',async()=>{
 const f=fake();
 const out=await runIsolatedS3Smoke({
  env:ENV,makeStorage:()=>f.storage,
  makeS3:opts=>{
   assert.equal(opts.forcePathStyle,false);
   assert.equal(opts.endpoint,ENV.BLOFY_CONTENT_HUB_S3_ENDPOINT);
   return {send:async()=>({ServerSideEncryption:'AES256'}),destroy(){}}
  },
  generate:()=>Buffer.alloc(M+127,7)
 });
 assert.equal(out.ok,true,JSON.stringify(out));
 assert.equal(out.code,'qa_isolated_s3_verified');
 assert.equal(out.writtenBytes,M+127);
 assert.equal(out.fullShaVerified,true);
 assert.equal(out.rangeVerified,true);
 assert.equal(out.encrypted,true);
 assert.equal(out.cleanedUp,true);
 assert.equal(out.objectCountAfter,0);
 assert.equal(f.calls.parts,2);
 assert.equal(f.calls.deletes,1);
 assert.equal(f.contents.size,0);
});
test('a nonempty QA bucket refuses writes, corruption causes failure and cleanup',async()=>{
 const f=fake();f.contents.set('unknown-key',Buffer.alloc(12));
 const refused=await runIsolatedS3Smoke({env:ENV,makeStorage:()=>f.storage});
 assert.equal(refused.ok,false);
 assert.equal(refused.code,'qa_bucket_not_empty');
 assert.equal(f.calls.parts,0);
 f.contents.clear();
 const tamper={...f.storage,verify:async()=>({ok:false,sha256:'0'.repeat(64)})};
 const bad=await runIsolatedS3Smoke({env:ENV,makeStorage:()=>tamper,
  generate:()=>Buffer.alloc(M+127,3)});
 assert.equal(bad.ok,false);
 assert.equal(bad.code,'qa_sha256_mismatch');
 assert.equal(bad.cleanedUp,true);
 assert.equal(bad.objectCountAfter,0);
});
