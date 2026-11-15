import test from 'node:test';
import assert from 'node:assert/strict';
import {createContentHubServer} from '../src/server.mjs';

const ID='123e4567-e89b-42d3-a456-426614174000';
const runId='mirror_'+'a'.repeat(40),sha='b'.repeat(64);
const token='Q'.repeat(40);
const fakeRow={copy_run_id:runId,copy_sha256:sha,
 expected_bytes:'16777216',extension:'mp4',
 copy_completed_at:'2026-11-15T01:00:00Z'};

async function withHub({enabled=true,verified=true}={},cb){
 let providerRequests=0,canaryCalls=0;
 const db={query:async()=>({rows:verified?[fakeRow]:[]})};
 const lease={
  getVerifiedChunkedObject:async()=>({
   bytes:16777216,sha256:sha,extension:'mp4',
   parts:[{partNumber:1},{partNumber:2}]
  })
 };
 const hub=createContentHubServer({
  token,storage:{health:async()=>({ok:true})},lease,
  mirrorQaStore:{db},
  pilotEnv:{
   BLOFY_XTREAM_DAILY_CATALOG_SOURCE_ID:ID,
   BLOFY_CONTENT_HUB_MIRROR_OWNER_QA_ENABLED:enabled?'1':'0'
  },
  mirrorCanaryRunner:async args=>{
   canaryCalls++;
   assert.equal(args.runId,runId);
   assert.equal(args.mediaKind,'movie');
   return {ok:true,seekVerified:true,
    code:'canary_audio_video_and_seeks_verified',
    videoCodec:'h264',audioCodec:'aac',seeksVerified:4}
  }
 });
 await new Promise(resolve=>hub.server.listen(0,'127.0.0.1',resolve));
 try{await cb('http://127.0.0.1:'+hub.server.address().port+
  '/internal/mirror/media-qa/movie/123',()=>canaryCalls,
  ()=>providerRequests);}
 finally{await new Promise(resolve=>hub.server.close(resolve))}
}
const opts=(method,owner=true)=>({method,headers:{
 authorization:'Bearer '+token,
 ...(owner?{'x-blofy-owner-action':'verify-private-mirror-playback'}:{})
}});
test('only bearer-authenticated owner may run private verified movie A/V+seek QA',async()=>{
 await withHub({},async(url,calls,provider)=>{
  assert.equal((await fetch(url,{method:'GET'})).status,401);
  const before=await fetch(url,opts('GET'));
  assert.equal(before.status,200);
  const meta=await before.json();
  assert.equal(meta.fullSha256Verified,true);
  assert.equal(meta.devicePlaybackValidated,false);
  assert.equal(meta.releaseToSubscribersApproved,false);
  assert.equal(meta.lastQa,null);
  assert.equal((await fetch(url,opts('POST',false))).status,403);
  const go=await fetch(url,opts('POST'));
  assert.equal(go.status,202);
  const accepted=await go.json();
  assert.equal(accepted.customerCutover,false);
  for(let i=0;i<20&&calls()===0;i++)
   await new Promise(resolve=>setTimeout(resolve,1));
  const after=await (await fetch(url,opts('GET'))).json();
  assert.equal(after.lastQa.ok,true);
  assert.equal(after.lastQa.seeksVerified,4);
  assert.equal(after.lastQa.audioCodec,'aac');
  assert.equal(after.devicePlaybackValidated,false);
  assert.equal(calls(),1);
  assert.equal(provider(),0);
 });
});
test('unverified S3 media and disabled QA feature cannot trigger diagnostics',async()=>{
 await withHub({verified:false},async(url,calls)=>{
  const r=await fetch(url,opts('POST'));
  assert.equal(r.status,409);
  assert.equal(calls(),0);
 });
 await withHub({enabled:false},async(url,calls)=>{
  const r=await fetch(url,opts('POST'));
  assert.equal(r.status,409);
  assert.equal(calls(),0);
 });
});
test('querystring cannot select other files or bypass owner-only token',async()=>{
 await withHub({},async(url,calls)=>{
  const r=await fetch(url+'?sourceId=other',opts('POST'));
  assert.equal(r.status,400);
  assert.equal(calls(),0);
 });
});
