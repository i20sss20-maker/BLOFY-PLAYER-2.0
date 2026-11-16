import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPrivateMirrorCapacity} from '../src/content-hub-private-mirror-capacity-bridge.mjs';
const KEY='s'.repeat(48);
const NOW=1700000000000;
function fixture(overrides={}){
 return {ok:true,code:'private_capacity_attested',privateOnly:true,
  verifiedPrivateBucket:true,usageExact:true,
  budgetBytes:1024**3,usedBytes:8*1024**2,reservedBytes:0,
  objectCount:1,observedAt:NOW,automaticDownload:false,
  providerRequests:0,mediaBytesTransferred:0,customerCutover:false,
  ...overrides};
}
test('attestation is fixed origin, signed, recent, and never uses user URL',async()=>{
 const calls=[];
 const res=await loadPrivateMirrorCapacity({token:KEY,now:NOW,
  fetchImpl:async(url,options)=>{
   calls.push({url,options});
   return Response.json(fixture());
  }
 });
 assert.equal(res.ok,true);
 assert.equal(res.capacity.usedBytes,8*1024**2);
 assert.equal(res.capacity.reservedBytes,0);
 assert.equal(calls.length,1);
 assert.equal(calls[0].url,
  'http://blofy-content-hub.railway.internal:3000/internal/mirror/preflight-capacity');
 assert.equal(calls[0].options.method,'GET');
 assert.equal(calls[0].options.headers.authorization,'Bearer '+KEY);
 assert.equal(calls[0].options.headers['x-blofy-owner-action'],
  'private-bucket-capacity-preflight');
 assert.equal(res.customerCutover,false);
});
test('no token or forged/stale capacity can reserve S3 budget',async()=>{
 let calls=0;
 const noToken=await loadPrivateMirrorCapacity({token:'short',now:NOW,
  fetchImpl:async()=>{calls++}});
 assert.equal(noToken.ok,false);
 assert.equal(calls,0);
 for(const payload of [
  fixture({observedAt:NOW-3600000}),
  fixture({observedAt:NOW+1}),
  fixture({usedBytes:-1}),
  fixture({budgetBytes:1.5}),
  fixture({verifiedPrivateBucket:false}),
  fixture({usageExact:false}),
  fixture({reservedBytes:1}),
  fixture({providerRequests:1}),
  fixture({mediaBytesTransferred:4096}),
  fixture({customerCutover:true})
 ]){
  const res=await loadPrivateMirrorCapacity({token:KEY,now:NOW,
   fetchImpl:async()=>Response.json(payload)});
  assert.equal(res.ok,false);
  assert.equal(res.capacity,null);
 }
});
