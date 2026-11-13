import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {runPrivateSalehSample} from '../src/real-source-sample.mjs';
const origin='http://blofy-activation-portal.railway.internal:3000';
const token='PrivateBridgeLongTokenForUnitTest123456';
const sourceId='9adc6472-5d4e-4359-83e4-0298cc038ae3';
const length=8*1024*1024;
function setup({cleanupFails=false,storageMismatch=false}={}){
 const calls=[];let body=null,locked=0,done=0,removed=0;
 const lease={acquire:async()=>{locked++;return {release:async()=>{done++}}}};
 const fetchImpl=async(url,options)=>{
  calls.push({url,range:options.headers.range||null,redirect:options.redirect});
  if(url.endsWith('/describe'))return Response.json({
   ok:true,sourceName:'saleh',sourceId,mediaKind:'movie',
   mediaId:'42',gatewayId:21,extension:'mkv'
  });
  assert.equal(url,origin+'/internal/blofy-content-hub/source/movie/21');
  assert.equal(options.headers.range,'bytes=0-'+(length-1));
  return new Response(Buffer.alloc(length,7),{status:206,
   headers:{'content-range':`bytes 0-${length-1}/2934023949`,
    'content-length':String(length)}});
 };
 const storage={
  begin:async({private:privateOnly,key})=>{
   assert.equal(privateOnly,true);assert.ok(key.startsWith('saleh/movie/'+sourceId));
   calls.push({action:'begin'});return {uploadId:'private-test-upload'}
  },
  part:async({body:part})=>{
   body=Buffer.from(part);calls.push({action:'part'});
   return {etag:'part-1'};
  },
  complete:async()=>{calls.push({action:'complete'})},
  verify:async({expectedBytes,expectedSha256})=>{
   assert.equal(body.length,expectedBytes);
   const digest=createHash('sha256').update(body).digest('hex');
   assert.equal(digest,expectedSha256);
   calls.push({action:'verify'});
   return {ok:!storageMismatch,bytes:expectedBytes,sha256:digest};
  },
  remove:async()=>{removed++;if(cleanupFails)throw Error('delete-failed')},
  abort:async()=>{throw Error('should not abort completed source sample')}
 };
 return {calls,lease,storage,fetchImpl,getState:()=>({locked,done,removed})};
}
test('feature OFF or absent quiet-window proof must never touch source or S3',async()=>{
 const f=setup();
 const result=await runPrivateSalehSample({storage:f.storage,lease:f.lease,
  fetchImpl:f.fetchImpl,bridgeOrigin:origin,bridgeToken:token});
 assert.equal(result.ok,false);
 assert.equal(result.providerRequests,0);
 assert.deepEqual(f.calls,[]);
 assert.deepEqual(f.getState(),{locked:0,done:0,removed:0});
});
test('one source Range copied to PRIVATE 8 MiB temporary object, SHA256 verified and deleted',async()=>{
 const f=setup();
 const result=await runPrivateSalehSample({storage:f.storage,lease:f.lease,
  fetchImpl:f.fetchImpl,bridgeOrigin:origin,bridgeToken:token,
  enabled:true,quietWindowConfirmed:true});
 assert.equal(result.ok,true);
 assert.equal(result.providerRequests,1);
 assert.equal(result.privateFixtureRemoved,true);
 assert.equal(result.sourceMediaRetained,false);
 assert.equal(result.sampleBytesVerified,length);
 assert.equal(result.fullFilmDownloaded,false);
 assert.equal(result.customerTrafficChanged,false);
 assert.equal(result.sourceTotalBytes,2934023949);
 assert.equal(f.calls.filter(x=>x.url.endsWith('source/movie/21')).length,1);
 assert.deepEqual(f.getState(),{locked:1,done:1,removed:1});
});
test('private S3 failure or failed deletion is NOT claimed a success',async()=>{
 for(const flags of [{cleanupFails:true},{storageMismatch:true}]){
  const f=setup(flags);
  const r=await runPrivateSalehSample({storage:f.storage,lease:f.lease,
   fetchImpl:f.fetchImpl,bridgeOrigin:origin,bridgeToken:token,
   enabled:true,quietWindowConfirmed:true});
  assert.equal(r.ok,false);
  assert.equal(r.privateFixtureRemoved,!flags.cleanupFails);
  assert.equal(r.sourceMediaRetained,!!flags.cleanupFails);
  assert.equal(f.getState().done,1);
 }
});
