import test from 'node:test';
import assert from 'node:assert/strict';
import {createContentHubServer} from '../src/server.mjs';

const token='x'.repeat(48),runId='saleh_episode_127434_20261114';
const env={
 BLOFY_CONTENT_HUB_FULL_SHA_AUDIT_ENABLED:'1',
 BLOFY_CONTENT_HUB_STORAGE_RIGHTS_CONFIRMED:'1',
 BLOFY_CONTENT_HUB_EPISODE_RIGHTS_CONFIRMED:'1',
 BLOFY_CONTENT_HUB_EPISODE_RUN_ID:runId,
 BLOFY_CONTENT_HUB_BATCH_RUN_ID:'saleh_movie_20261114_123',
};
async function serving({pilotEnv={...env},auditor=async()=>({
 ok:true,code:'private_copy_audit_full_sha256_verified',fullSha256Verified:true,
 fullFileReadBackVerified:true,bytesRead:1024,checkedParts:1
})}={}){
 const calls=[];
 const hub=createContentHubServer({pilotEnv,storage:{},lease:{},token,
  fullCopyAuditor:async args=>{calls.push(args);return auditor(args)}});
 hub.server.listen(0,'127.0.0.1');
 await new Promise(resolve=>hub.server.once('listening',resolve));
 const origin='http://127.0.0.1:'+hub.server.address().port;
 const status=()=>fetch(origin+'/internal/private-copy/audit-full/status',{
  headers:{authorization:'Bearer '+token,
   'x-blofy-owner-action':'audit-one-stored-private-copy'}});
 const request=(body={kind:'episode',runId,confirmed:true},opts={})=>
  fetch(origin+'/internal/private-copy/audit-full',{
   method:'POST',headers:{
    'authorization':'Bearer '+token,
    'content-type':'application/json',
    'x-blofy-owner-action':'audit-one-stored-private-copy',
    ...opts.headers},body:JSON.stringify(body)});
 return {calls,hub,request,status,origin,close:()=>new Promise(resolve=>
  hub.server.close(resolve))};
}
test('full SHA endpoint is off by default, private bearer is mandatory',async()=>{
 const d=await serving({pilotEnv:{}});
 try{
  assert.equal((await d.request()).status,404);
  const r=await fetch(d.origin+'/internal/private-copy/audit-full',{
   method:'POST',headers:{'content-type':'application/json'},
   body:'{}'});
  assert.equal(r.status,401);
  assert.equal(d.calls.length,0);
 }finally{await d.close()}
});
test('owner marker, exact approved run and rights gate are required',async()=>{
 const d=await serving();
 try{
  assert.equal((await d.request({kind:'episode',runId,confirmed:false})).status,403);
  assert.equal((await d.request({kind:'episode',runId:'season_unknown_123',confirmed:true})).status,403);
  assert.equal((await d.request(undefined,{
   headers:{'x-blofy-owner-action':'invalid'}})).status,404);
  assert.equal(d.calls.length,0);
 }finally{await d.close()}
 const noRights=await serving({pilotEnv:{...env,BLOFY_CONTENT_HUB_EPISODE_RIGHTS_CONFIRMED:'0'}});
 try{
  assert.equal((await noRights.request()).status,403);
  assert.equal(noRights.calls.length,0);
 }finally{await noRights.close()}
});
test('one verified stored episode calls read-only auditor once and cools down',async()=>{
 const d=await serving();
 try{
  const r=await d.request();assert.equal(r.status,202);
  const json=await r.json();
  assert.equal(json.state,'running');
  assert.equal(json.providerRequests,0);
  assert.equal(json.customerCutover,false);
  assert.equal(json.automaticCopyStarted,false);
  // Worker completes independently of caller's HTTP connection.
  await new Promise(resolve=>setTimeout(resolve,20));
  const status=await d.status();assert.equal(status.status,200);
  const result=(await status.json()).status;
  assert.equal(result.state,'verified');
  assert.equal(result.fullSha256Verified,true);
  assert.equal(result.bytesRead,1024);
  assert.equal(d.calls.length,1);
  assert.equal(d.calls[0].kind,'episode');
  assert.equal(d.calls[0].runId,runId);
  assert.equal(d.calls[0].maxDurationMs,280000);
  assert.equal((await d.request()).status,429);
  assert.equal(d.calls.length,1);
 }finally{await d.close()}
});
test('concurrent full audit is rejected, no second storage read',async()=>{
 let start,finish;
 const started=new Promise(resolve=>{start=resolve});
 const pending=new Promise(resolve=>{finish=resolve});
 const d=await serving({auditor:async()=>{start();await pending;return {ok:true}}});
 try{
  const first=d.request();
  await started;
  assert.equal((await d.request()).status,429);
  assert.equal((await first).status,202);
  const status=await d.status();
  assert.equal((await status.json()).status.state,'running');
  finish();await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal((await (await d.status()).json()).status.state,'failed');
  assert.equal(d.calls.length,1);
 }finally{finish?.();await d.close()}
});
