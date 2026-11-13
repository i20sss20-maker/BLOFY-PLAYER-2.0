import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {createContentHubServer,runSyntheticPrivateStorageCheck}
 from '../src/server.mjs';

function fakePrivateStorage({verificationFails=false}={}){
 const seen=[],state={body:null};
 const storage={
  async health(){return {ok:true}},
  async begin({key,private:scope}){
   assert.equal(scope,true);
   assert.match(key,/^saleh\/movie\//);
   seen.push('begin');state.key=key;
   return {uploadId:'private-upload-test'};
  },
  async part({key,body,partNumber}){
   assert.equal(key,state.key);assert.equal(partNumber,1);
   assert.equal(body.length,8*1024*1024);
   state.body=Buffer.from(body);seen.push('part');
   return {etag:'private-etag'};
  },
  async complete(){seen.push('complete')},
  async verify({expectedBytes,expectedSha256}){
   const actual=createHash('sha256').update(state.body).digest('hex');
   assert.equal(actual,expectedSha256);
   assert.equal(expectedBytes,state.body.length);
   seen.push('verify');
   return {ok:!verificationFails,bytes:state.body.length,sha256:actual};
  },
  async remove({key}){assert.equal(key,state.key);seen.push('remove')},
  async abort(){seen.push('abort')}
 };
 return {storage,seen};
}
const lease={health:async()=>true};
async function withServer(token,work){
 const fixture=fakePrivateStorage();
 const hub=createContentHubServer({storage:fixture.storage,lease,token,
  allowSynthetic:false});
 hub.server.listen(0,'127.0.0.1');await once(hub.server,'listening');
 try{await work('http://127.0.0.1:'+hub.server.address().port,fixture)}
 finally{await new Promise(resolve=>hub.server.close(resolve))}
}
test('private S3 8MiB synthetic check performs complete upload, SHA256 readback, cleanup',async()=>{
 const fixture=fakePrivateStorage();
 const result=await runSyntheticPrivateStorageCheck({storage:fixture.storage});
 assert.equal(result.ok,true);
 assert.equal(result.providerRequests,0);
 assert.equal(result.customerTrafficChanged,false);
 assert.deepEqual(fixture.seen,['begin','part','complete','verify','remove']);
});
test('SHA256 mismatch is never accepted, fixture is deleted even on failure',async()=>{
 const fixture=fakePrivateStorage({verificationFails:true});
 const result=await runSyntheticPrivateStorageCheck({storage:fixture.storage});
 assert.equal(result.ok,false);
 assert.equal(result.providerRequests,0);
 assert.deepEqual(fixture.seen,['begin','part','complete','verify','remove']);
});
test('health is non-secret, private status authenticated and synthetic writes off by default',async()=>{
 await withServer('ContentHubPrivateAdminKeyAtLeast32RandomBytes2026',async(base,fixture)=>{
  const h=await fetch(base+'/health');
  assert.equal(h.status,200);
  assert.equal((await h.json()).automaticSourceDownloads,false);
  assert.equal((await fetch(base+'/internal/status')).status,401);
  const headers={authorization:'Bearer ContentHubPrivateAdminKeyAtLeast32RandomBytes2026'};
  const r=await fetch(base+'/internal/status',{headers});
  assert.equal(r.status,200);
  assert.equal((await r.json()).downloadQueueEnabled,false);
  const noWrite=await fetch(base+'/internal/storage/synthetic-check',{method:'POST',headers});
  assert.equal(noWrite.status,409);
  assert.deepEqual(fixture.seen,[]);
 });
});
