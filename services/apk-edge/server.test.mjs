import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createSignedApkGateway} from './server.mjs';
import {resolveRange,resolveSignedApk,SIGNED_APKS,keyOf} from './signed-release-policy.mjs';

const pin={name:'BLOFY-TEST-OWNER-SIGNED.apk',size:128,
  sha256:'ab'.repeat(32)};
const bytes=Buffer.alloc(128);
for(let i=0;i<bytes.length;i++)bytes[i]=i;
const matching={
  head:async()=>({ContentLength:pin.size,Metadata:{sha256:pin.sha256}}),
  get:async(key,range)=>{
    assert.equal(key,keyOf(pin));
    const policy=resolveRange(range,128);
    const actual=range?resolveRange(range,128):resolveRange('',128);
    return {$metadata:{httpStatusCode:actual.status},
      ContentLength:actual.length,
      ...(range?{ContentRange:actual.contentRange}:{}),
      Body:Readable.from(bytes.subarray(actual.start,actual.end+1))};
  }
};
const start=async gateway=>{
  await new Promise(r=>gateway.server.listen(0,'127.0.0.1',r));
  return 'http://127.0.0.1:'+gateway.server.address().port;
};
const stop=async gateway=>new Promise(r=>gateway.server.close(r));
test('pinned list includes only verified owner signed app versions',()=>{
 assert.equal(SIGNED_APKS.length,2);
 for(const p of SIGNED_APKS){
  assert.match(p.name,/OWNER-SIGNED\.apk$/);
  assert.match(p.sha256,/^[0-9a-f]{64}$/);
  assert.ok(p.size>130_000_000);
 }
 assert.equal(resolveSignedApk('/files/releases/BLOFY-TEST-OWNER-SIGNED.apk',[pin]),pin);
 assert.equal(resolveSignedApk('/files/releases/../../private'),null);
 assert.equal(resolveSignedApk('/files/releases/evil.apk'),null);
});
test('no public download until pinned S3 HEAD readback passes',async()=>{
 const gateway=createSignedApkGateway({storage:matching,pins:[pin]});
 const url=await start(gateway);
 const before=await fetch(url+'/health');
 assert.equal(before.status,503);
 const fail=await fetch(url+'/files/releases/'+pin.name);
 assert.equal(fail.status,503);
 await gateway.verify();
 const ready=await (await fetch(url+'/health')).json();
 assert.equal(ready.ok,true);
 assert.equal(ready.mode,'canary_not_customer_cutover');
 await stop(gateway);
});
test('full and partial immutable APK streams never mix CDN cached byte slices',async()=>{
 const gateway=createSignedApkGateway({storage:matching,pins:[pin]});
 await gateway.verify();
 const url=await start(gateway),target=url+'/files/releases/'+pin.name;
 const full=await fetch(target);
 assert.equal(full.status,200);
 assert.match(full.headers.get('cache-control'),/immutable/);
 assert.equal(full.headers.get('content-length'),'128');
 assert.deepEqual(Buffer.from(await full.arrayBuffer()),bytes);
 const partial=await fetch(target,{headers:{range:'bytes=20-35'}});
 assert.equal(partial.status,206);
 assert.equal(partial.headers.get('content-range'),'bytes 20-35/128');
 assert.match(partial.headers.get('cache-control'),/no-store/);
 assert.deepEqual(Buffer.from(await partial.arrayBuffer()),bytes.subarray(20,36));
 const last=await fetch(target,{headers:{range:'bytes=-4'}});
 assert.equal(last.status,206);
 assert.deepEqual(Buffer.from(await last.arrayBuffer()),bytes.subarray(124));
 const header=await fetch(target,{method:'HEAD',headers:{range:'bytes=9-10'}});
 assert.equal(header.status,206);
 assert.equal(header.headers.get('content-length'),'2');
 const invalid=await fetch(target,{headers:{range:'bytes=500-'}});
 assert.equal(invalid.status,416);
 assert.equal(invalid.headers.get('content-range'),'bytes */128');
 assert.match(invalid.headers.get('cache-control'),/no-store/);
 const malformed=await fetch(target,{headers:{range:'bytes=0-1,3-4'}});
 assert.equal(malformed.status,416);
 await stop(gateway);
});
test('never serve unknown binaries, writable actions or secretful paths',async()=>{
 const gateway=createSignedApkGateway({storage:matching,pins:[pin]});
 await gateway.verify();const base=await start(gateway);
 const variants=[
   {url:'/files/releases/another.apk',method:'GET',status:404},
   {url:'/files/releases/'+pin.name+'?anything=yes',method:'GET',status:404},
   {url:'/api/admin',method:'GET',status:404},
   {url:'/files/releases/'+pin.name,method:'POST',status:405}
 ];
 for(const v of variants){
  const response=await fetch(base+v.url,{method:v.method});
  assert.equal(response.status,v.status,v.url);
 }
 await stop(gateway);
});
test('metadata mismatch fails closed and no request can switch customer site',async()=>{
 const gateway=createSignedApkGateway({storage:{
  head:async()=>({ContentLength:12,Metadata:{sha256:'bad'}}),
  get:async()=>{throw Error('must_not_fetch');}
 },pins:[pin]});
 await assert.rejects(gateway.verify(),/apk_edge_verified_object_missing/);
 const url=await start(gateway);
 const response=await fetch(url+'/files/releases/'+pin.name);
 assert.equal(response.status,503);
 assert.equal(gateway.state().ready,false);
 await stop(gateway);
});
