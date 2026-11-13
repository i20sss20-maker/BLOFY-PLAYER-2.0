import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {authorizeMirrorJob,rangeParts,parseMirrorContentRange,MIN_PART_BYTES}
 from '../src/mirror-policy.mjs';
import {runLicensedMirrorPilot} from '../src/mirror-pilot.mjs';

const sourceId='9adc6472-5d4e-4359-83e4-0298cc038ae3';
const env={BLOFY_CONTENT_HUB_UPLOAD_ENABLED:'1',
 BLOFY_CONTENT_HUB_STORAGE_RIGHTS_CONFIRMED:'1'};
const total=MIN_PART_BYTES*2+4096;
const job={sourceName:'saleh',sourceId,mediaKind:'movie',mediaId:'314',
 extension:'mkv',expectedBytes:total,
 licenseEvidence:{storagePermitted:true,scope:'saleh-vod-persistent-copy'}};
const privateBucket={private:true,configured:true};
function fixtures({status=206,etag='"stable-v1"',badAt=0,
  verificationFails=false}={}){
 let active=0,peak=0,requests=0,uploads=0,aborts=0,removes=0,release=0,started=0;
 const parts=new Map();
 const lease={acquire:async key=>{
  assert.equal(key,'saleh');
  return {release:async()=>{release++}};
 }};
 const storage={
  begin:async({key,private:isolated})=>{
   assert.match(key,/^saleh\/movie\//);
   assert.equal(isolated,true);started++;
   return {uploadId:'test-multipart-123'};
  },
  part:async({partNumber,body})=>{
   parts.set(partNumber,Buffer.from(body));uploads++;
   return {etag:'s3-part-'+partNumber};
  },
  complete:async({parts:confirmed})=>{
   assert.equal(confirmed.length,parts.size);
   return {ok:true};
  },
  abort:async()=>{aborts++},
  remove:async()=>{removes++}
 };
 const readRange=async({from,to,sourceId:src,mediaId})=>{
  requests++;active++;peak=Math.max(peak,active);
  try{
   assert.equal(src,sourceId);assert.equal(mediaId,'314');
   const len=to-from+1,headers={
    'content-range':`bytes ${from}-${to}/${total}`,
    'content-length':String(len),'etag':badAt===requests?'"different"':etag};
   return new Response(Buffer.alloc(len,requests),{
    status:status,headers
   });
  }finally{active--}
 };
 const verifyStoredObject=async({expectedBytes,expectedSha256})=>{
  assert.equal(expectedBytes,total);
  const body=Buffer.concat([...parts].sort((a,b)=>a[0]-b[0]).map(([,v])=>v));
  assert.equal(body.length,expectedBytes);
  const sum=createHash('sha256').update(body).digest('hex');
  assert.equal(sum,expectedSha256);
  return {ok:!verificationFails,bytes:body.length,sha256:sum};
 };
 return {lease,storage,readRange,verifyStoredObject,
  stats:()=>({peak,requests,uploads,aborts,removes,release,started})};
}
const args=deps=>({env,job,privateBucket,...deps});

test('without explicit rights, private storage and quiet origin no I/O occurs',async()=>{
 for(const [override,code] of [
  [{env:{}},'upload_feature_disabled'],
  [{env:{BLOFY_CONTENT_HUB_UPLOAD_ENABLED:'1'}},'storage_rights_not_confirmed'],
  [{job:{...job,licenseEvidence:{storagePermitted:false}}},'individual_storage_license_missing'],
  [{privateBucket:{private:false,configured:true}},'private_object_storage_unavailable'],
  [{job:{...job,activeUpstreamFeeds:1}},'source_connection_in_use'],
  [{job:{...job,sourceName:'other'}},'source_not_saleh']
 ]){
  const deps=fixtures();
  const res=await runLicensedMirrorPilot({...args(deps),...override});
  assert.equal(res.ok,false);
  assert.ok(res.reasons.includes(code),JSON.stringify(res));
  assert.deepEqual(deps.stats(),{peak:0,requests:0,uploads:0,
   aborts:0,removes:0,release:0,started:0});
 }
});
test('exact 206 ranges upload in source order into a private object; verifies real SHA256',async()=>{
 const deps=fixtures();
 const out=await runLicensedMirrorPilot(args(deps));
 assert.equal(out.ok,true);
 assert.equal(out.bytes,total);
 assert.equal(out.parts,3);
 assert.equal(out.customerCutover,false);
 assert.equal(out.privateOnly,true);
 assert.equal(out.accessURLCreated,false);
 assert.equal(out.externalSourceConnections,1);
 assert.deepEqual(deps.stats(),{peak:1,requests:3,uploads:3,
  aborts:0,removes:0,release:1,started:1});
 assert.equal(out.receipt,undefined);
});
test('provider 200 ignores Range: never write a part or retry as full GET',async()=>{
 const deps=fixtures({status:200});
 const out=await runLicensedMirrorPilot(args(deps));
 assert.equal(out.ok,false);assert.equal(out.code,'content_hub_range_mismatch');
 assert.deepEqual(deps.stats(),{peak:1,requests:1,uploads:0,
  aborts:1,removes:0,release:1,started:1});
});
test('provider source changed at second part: abort partial object, no publish',async()=>{
 const deps=fixtures({badAt:2});
 const out=await runLicensedMirrorPilot(args(deps));
 assert.equal(out.ok,false);assert.equal(out.code,'content_hub_source_changed');
 assert.equal(out.partsUploaded,1);
 assert.equal(out.customerCutover,false);
 assert.equal(deps.stats().aborts,1);
 assert.equal(deps.stats().release,1);
});
test('object checksum failure deletes the private completed object',async()=>{
 const deps=fixtures({verificationFails:true});
 const out=await runLicensedMirrorPilot(args(deps));
 assert.equal(out.ok,false);assert.equal(out.code,'content_hub_storage_verification_failed');
 assert.equal(deps.stats().removes,1);
 assert.equal(deps.stats().release,1);
});
test('part plans and Content-Range parsing bound large movies',()=>{
 const parts=rangeParts(MIN_PART_BYTES*2+4096);
 assert.deepEqual(parts.map(x=>x.partNumber),[1,2,3]);
 assert.equal(parts[0].from,0);assert.equal(parts[0].to,MIN_PART_BYTES-1);
 assert.equal(parts[2].to,MIN_PART_BYTES*2+4095);
 assert.equal(parseMirrorContentRange('bytes 0-8191/16384',
  {from:0,to:8191,expectedBytes:16384}),true);
 for(const value of ['bytes 0-8192/16384','bytes 0-8191/*',
  'bytes 0-8191/16000','bytes 0-8191/0'])
  assert.equal(parseMirrorContentRange(value,
   {from:0,to:8191,expectedBytes:16384}),false);
 assert.throws(()=>rangeParts(0),/content_hub_invalid_size/);
 assert.throws(()=>rangeParts(2**40),/content_hub_invalid_size/);
 assert.equal(authorizeMirrorJob({...job,env,privateBucket}).allowed,true);
});
