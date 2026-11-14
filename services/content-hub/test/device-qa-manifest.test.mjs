import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPrivateDeviceQaManifest,deviceQaPlatforms,
 validateDeviceQaSelection} from '../src/device-qa-manifest.mjs';
import {createContentHubServer} from '../src/server.mjs';

const seasonKey='series_42_s01';
const base={
 page:{number:1,seasonKey,pages:2,hasNext:true},
 totals:{episode_count:'55'},
 episodes:[
  {runId:'season_verified_12345',episodeNumber:1,
   state:'verified',verified:true,ownerAvConfirmedAt:'2026-11-14T10:00:00Z',
   title:'Episode 1',expectedBytes:8388608},
  {runId:'season_awaiting_12345',episodeNumber:2,
   state:'verified',verified:true,ownerAvConfirmedAt:null,title:'Episode 2'},
  {runId:'season_failed_12345',episodeNumber:3,
   state:'failed',verified:false,
   ownerAvConfirmedAt:'2026-11-14T09:00:00Z',title:'Episode 3'}
 ]
};
test('selects exactly three supported QA targets and rejects unsafe selection',()=>{
 assert.deepEqual(deviceQaPlatforms(),['android','android_tv','windows']);
 assert.equal(validateDeviceQaSelection({platform:'android_tv',seasonKey,page:1}).page,1);
 for(const invalid of [
  {platform:'ios'}, {platform:'../../android'},
  {seasonKey:'../passwd'},{seasonKey:'series_42_s01?x=1'},
  {page:0},{page:20001},{page:'1'}
 ]){
  assert.throws(()=>validateDeviceQaSelection({
   platform:'android',seasonKey,page:1,...invalid}),
   /private_device_qa_selection_invalid/);
 }
});
test('device QA v1 is bounded and never includes media URLs, tokens or customer approval',()=>{
 for(const platform of deviceQaPlatforms()){
  const data=buildPrivateDeviceQaManifest({platform,seasonKey,page:1,
   detail:base});
  assert.equal(data.schema,'blofy.private-device-qa-manifest');
  assert.equal(data.version,1);
  assert.equal(data.platform,platform);
  assert.equal(data.privateOnly,true);
  assert.equal(data.readOnly,true);
  assert.equal(data.candidateCount,1);
  assert.equal(data.blockedCount,2);
  assert.equal(data.totalShown,3);
  assert.equal(data.pageCount,2);
  assert.equal(data.registeredEpisodesInSeason,55);
  assert.equal(data.hasNextPage,true);
  assert.equal(data.appIntegrationCompleted,false);
  assert.equal(data.devicePlaybackValidated,false);
  assert.equal(data.releaseToSubscribersApproved,false);
  assert.equal(data.playableMediaUrlsIncluded,false);
  assert.equal(data.providerMediaRequests,undefined);
  assert.equal(data.episodes[0].candidateForOwnerDeviceTesting,true);
  assert.deepEqual(data.episodes[1].blockers,['human_audio_video_review_missing']);
  assert.deepEqual(data.episodes[2].blockers,['storage_proof_not_verified']);
  assert.equal(data.episodes[2].manualAudioVideoReviewed,false);
  assert.equal(data.episodes.every(x=>x.releaseToSubscribersApproved===false),true);
  assert.equal(JSON.stringify(data).includes('https://'),false);
  assert.equal(Object.hasOwn(data.episodes[0],'playbackUrl'),false);
  assert.equal(Object.hasOwn(data.episodes[0],'sourceId'),false);
  assert.equal(Object.hasOwn(data.episodes[0],'gatewayId'),false);
 }
});
test('stale, malformed or oversized snapshots fail closed',()=>{
 for(const detail of [
  null,
  {...base,page:{...base.page,number:2}},
  {...base,page:{...base.page,seasonKey:'series_43_s01'}},
  {...base,episodes:[...base.episodes,{runId:'../secret',episodeNumber:4}]},
  {...base,episodes:Array.from({length:51},()=>base.episodes[0])}
 ]){
  assert.throws(()=>buildPrivateDeviceQaManifest({
   platform:'android',seasonKey,page:1,detail
  }),/private_device_qa_snapshot_invalid|private_device_qa_episode_invalid/);
 }
});
test('owner-only QA route checks bearer token, signed action and querystring',async()=>{
 const token='p'.repeat(48),seen=[];
 const hub=createContentHubServer({token,storage:{},lease:{},
  seasonQueueStore:{seasonDetailPage:async args=>{
   seen.push(args);return base;
  }}});
 hub.server.listen(0,'127.0.0.1');
 await new Promise(done=>hub.server.once('listening',done));
 const url='http://127.0.0.1:'+hub.server.address().port+
  '/internal/seasons/device-qa/android_tv/'+seasonKey+'/page/1';
 const auth={authorization:'Bearer '+token};
 const ok={...auth,'x-blofy-owner-action':'prepare-private-device-qa'};
 try{
  assert.equal((await fetch(url)).status,401);
  assert.equal((await fetch(url,{headers:auth})).status,403);
  assert.equal((await fetch(url+'?url=secret',{headers:ok})).status,403);
  assert.equal((await fetch(url,{headers:{
   ...ok,'x-blofy-owner-action':'review-private-seasons'}})).status,403);
  assert.equal((await fetch(url,{method:'POST',headers:ok})).status,404);
  assert.equal((await fetch(url.replace('/page/1','/page/000'),{
   headers:ok})).status,404);
  assert.equal(seen.length,0);
  const response=await fetch(url,{headers:ok});
  assert.equal(response.status,200);
  assert.match(response.headers.get('cache-control'),'no-store');
  const data=await response.json();
  assert.equal(data.platform,'android_tv');
  assert.equal(data.candidateCount,1);
  assert.equal(data.customerCutover,false);
  assert.equal(data.playableMediaUrlsIncluded,false);
  assert.equal(seen.length,1);
  assert.equal(seen[0].seasonKey,seasonKey);
  assert.equal(seen[0].page,1);
 }finally{await new Promise(done=>hub.server.close(done))}
});
