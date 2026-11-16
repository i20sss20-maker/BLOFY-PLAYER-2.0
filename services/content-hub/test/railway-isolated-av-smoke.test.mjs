import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {generateSyntheticAvFixture,verifySyntheticAvOnPrivateS3,
 runRailwaySyntheticAvSmoke} from '../scripts/railway-isolated-av-smoke.mjs';
const SIZE=5*1024*1024+127;
const sha=b=>createHash('sha256').update(b).digest('hex');
const available=['ffmpeg','ffprobe'].every(x=>
 spawnSync(x,['-version'],{timeout:10000,stdio:'ignore'}).status===0
);
const ENV={
 BLOFY_QA_SYNTHETIC_ONLY:'1',BLOFY_QA_ISOLATED_BUCKET:'1',
 BLOFY_QA_SYNTHETIC_AV:'1',
 BLOFY_QA_EXPECTED_BUCKET:'blofy-av-ci-synthetic',
 BLOFY_CONTENT_HUB_S3_BUCKET:'blofy-av-ci-synthetic',
 BLOFY_CONTENT_HUB_S3_ENDPOINT:'https://t3.storageapi.dev',
 BLOFY_CONTENT_HUB_S3_URL_STYLE:'virtual-host',
 BLOFY_CONTENT_HUB_S3_REGION:'auto',
 BLOFY_CONTENT_HUB_S3_ACCESS_KEY_ID:'ci-only',
 BLOFY_CONTENT_HUB_S3_SECRET_ACCESS_KEY:'ci-only',
 BLOFY_QA_PLATFORM_ENCRYPTION_DOC_ACK:'1'
};
function fake({corruptRead=false}={}){
 const objects=new Map(),pending=new Map();
 const calls={reads:0,parts:0,uploads:0,deletes:0};
 return {objects,calls,storage:{
  measurePrivateUsage:async()=>({ok:true,objectCount:objects.size,
   usedBytes:[...objects.values()].reduce((n,v)=>n+v.length,0)}),
  begin:async({private:priv})=>{
   assert.equal(priv,true);calls.uploads++;return {uploadId:'av-fixture'}
  },
  part:async({key,body,partNumber})=>{
   const parts=pending.get(key)||[];
   parts.push({partNumber,buffer:Buffer.from(body)});
   pending.set(key,parts);calls.parts++;
   return {etag:'"qa-part-'+partNumber+'"'}
  },
  complete:async({key})=>{
   const parts=pending.get(key);
   objects.set(key,Buffer.concat(parts.sort((a,b)=>a.partNumber-b.partNumber)
    .map(p=>p.buffer)));
   pending.delete(key);
  },
  abort:async({key})=>{pending.delete(key)},
  remove:async({key})=>{calls.deletes++;objects.delete(key)},
  headVerifiedChunk:async({key,expectedBytes})=>({
   ok:objects.get(key)?.length===expectedBytes}),
  verify:async({key,expectedBytes,expectedSha256})=>{
   const bytes=objects.get(key);
   return {ok:bytes.length===expectedBytes&&sha(bytes)===expectedSha256,
    sha256:sha(bytes)};
  },
  readVerifiedRange:async({key,from,to})=>{
   calls.reads++;
   const bytes=Buffer.from(objects.get(key).subarray(from,to+1));
   if(corruptRead&&from===0&&to===SIZE-1)bytes[0]^=0xff;
   return Readable.from([bytes]);
  }
 }};
}
test('real synthetic MP4/AAC fixture has size suitable for two-part T3 S3 multipart',{
 skip:!available,timeout:60000
},async()=>{
 const bytes=await generateSyntheticAvFixture();
 assert.equal(bytes.length,SIZE);
 assert.equal(bytes.subarray(SIZE-1).length,1);
 assert.equal(bytes.includes(Buffer.from('ftyp')),true);
 assert.equal(bytes.includes(Buffer.from('free')),true);
});
test('independent S3 read proves audio+video decode and synthetic cleanup',{
 skip:!available,timeout:85000
},async()=>{
 const f=fake();
 const out=await runRailwaySyntheticAvSmoke({
  env:ENV,makeStorage:()=>f.storage,
  makeS3:()=>({send:async()=>({}),destroy(){}})
 });
 assert.equal(out.ok,true,JSON.stringify(out));
 assert.equal(out.avVerified,true);
 assert.equal(out.independentS3AudioVideoDecoded,true);
 assert.equal(out.fullShaVerified,true);
 assert.equal(out.rangeVerified,true);
 assert.equal(out.synthetic,true);
 assert.equal(out.sourceRequests,0);
 assert.equal(out.devicePlaybackVerified,false);
 assert.equal(out.mediaKind,'synthetic_mp4_mpeg4_aac');
 assert.equal(out.encrypted,false);
 assert.equal(out.platformEncryptionDocumented,true);
 assert.equal(f.calls.parts,2);
 assert.ok(f.calls.reads>=2);
 assert.equal(f.calls.deletes,1);
 assert.equal(out.objectCountAfter,0);
 assert.equal(f.objects.size,0);
});
test('corruption during separate A/V read fails SHA and cleans private QA object',{
 skip:!available,timeout:85000
},async()=>{
 const f=fake({corruptRead:true});
 const out=await runRailwaySyntheticAvSmoke({
  env:ENV,makeStorage:()=>f.storage,
  makeS3:()=>({send:async()=>({}),destroy(){}})
 });
 assert.equal(out.ok,false);
 assert.equal(out.independentS3AudioVideoDecoded,false);
 assert.equal(out.code,'qa_av_s3_sha256_mismatch');
 assert.equal(out.cleanedUp,true);
 assert.equal(out.objectCountAfter,0);
 assert.equal(f.objects.size,0);
 assert.equal(out.sourceRequests,0);
});
test('A/V verification is refused without an explicit synthetic video QA flag',{
 timeout:10000
},async()=>{
 let received=false;
 const result=await runRailwaySyntheticAvSmoke({
  env:{...ENV,BLOFY_QA_SYNTHETIC_AV:'0'},
  makeStorage:()=>{received=true;return fake().storage},
  makeS3:()=>({send:async()=>({}),destroy(){}}),
  // The gate must reject any attempt to decode, before a real transfer.
 });
 assert.equal(result.ok,false);
 assert.equal(result.sourceRequests,0);
 assert.equal(result.customerCutover,false);
 assert.equal(result.avVerified,false);
 assert.equal(result.code,'qa_av_validation_not_authorized');
 assert.equal(result.objectCountAfter,null);
 assert.equal(received,false);
});
