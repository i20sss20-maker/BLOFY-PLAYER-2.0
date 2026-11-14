import test from 'node:test';
import assert from 'node:assert/strict';
import {createSeasonQueueStore} from '../src/season-queue.mjs';
import {createContentHubServer} from '../src/server.mjs';
import {buildSeasonReport} from '../src/season-report.mjs';
const good='season_verified_123456789';
test('missing A/V table reads as no owner review, without creating schema',async()=>{
 const queries=[];
 class MockPool{
  async query(sql,args){
   queries.push({sql,args});
   if(sql.includes('FROM blofy_content_hub_episode_av_reviews'))
    throw Object.assign(Error('relation does not exist'),{code:'42P01'});
   return {rows:[]};
  }
  async end(){}
 }
 const store=createSeasonQueueStore({connectionString:'mock',Pool:MockPool});
 const result=await store.episodeAvReviews({runIds:[good]});
 assert.deepEqual(result,[]);
 assert.equal(queries.some(x=>x.sql.includes('CREATE TABLE IF NOT EXISTS blofy_content_hub_episode_av_reviews')),false);
 assert.equal(queries.some(x=>x.sql.includes('DELETE')),false);
 for(const list of [Array(51).fill(good),['../../secret'],['<script>']]){
  await assert.rejects(store.episodeAvReviews({runIds:list}),
   /episode_av_review_selection_invalid/);
 }
 await store.close();
});
test('unverified queue episodes are rejected before ANY A/V write or table creation',async()=>{
 let insert=false,created=false;
 class MockPool{
  async query(sql){
   if(sql.includes('CREATE TABLE IF NOT EXISTS blofy_content_hub_episode_av_reviews'))
    created=true;
   if(sql.includes('INSERT INTO blofy_content_hub_episode_av_reviews'))insert=true;
   return {rows:[]};
  }
  async end(){}
 }
 const store=createSeasonQueueStore({connectionString:'mock',Pool:MockPool});
 assert.equal((await store.confirmEpisodeAv({runId:'bad'})).code,
  'episode_av_review_id_invalid');
 assert.equal((await store.confirmEpisodeAv({runId:good})).code,
  'episode_av_not_storage_verified');
 assert.equal(created,false);
 assert.equal(insert,false);
 await store.close();
});
test('manual A/V record is idempotent and produced only for verified episodes',async()=>{
 let written=0,created=0;
 class MockPool{
  async query(sql){
   if(sql.includes('CREATE TABLE IF NOT EXISTS blofy_content_hub_episode_av_reviews')){
    created++;return {rows:[]};
   }
   if(sql.includes('INSERT INTO blofy_content_hub_episode_av_reviews')){
    written++;
    assert.ok(sql.includes("q.state='verified' AND r.state='verified'"));
    return {rows:written===1?[{confirmed_at:'2026-11-14T12:00:00Z'}]:[]};
   }
   if(sql.includes('FROM blofy_content_hub_episode_av_reviews'))
    return {rows:[{run_id:good,confirmed_at:'2026-11-14T12:00:00Z'}]};
   if(sql.includes('SELECT 1 FROM blofy_content_hub_season_queue'))
    return {rows:[{'?column?':1}]};
   return {rows:[]};
  }
  async end(){}
 }
 const store=createSeasonQueueStore({connectionString:'mock',Pool:MockPool});
 const a=await store.confirmEpisodeAv({runId:good});
 assert.equal(a.ok,true);
 assert.equal(a.code,'episode_av_owner_review_saved');
 assert.equal(a.videoOwnerConfirmed,true);
 assert.equal(a.audioOwnerConfirmed,true);
 assert.equal(a.automaticVerification,false);
 assert.equal(a.customerCutover,false);
 const b=await store.confirmEpisodeAv({runId:good});
 assert.equal(b.ok,true);
 assert.equal(b.code,'episode_av_owner_review_already_saved');
 assert.equal(b.confirmedAt,a.confirmedAt);
 assert.equal(created,2);
 assert.equal(written,2);
 await store.close();
});
test('season report labels storage verification and owner A/V separately',()=>{
 const base={
  page:{seasonKey:'series_42_s01',number:1,pages:1},
  totals:{episode_count:'2',expected_bytes:'200',stored_bytes:'200',
   verified_count:'2'},
  episodes:[{runId:good,episodeNumber:1,expectedBytes:100,
   storedBytes:100,state:'verified',verified:true,
   ownerAvConfirmedAt:'2026-11-14T12:00:00Z'},
   {runId:'season_unreviewed_12345',episodeNumber:2,
    expectedBytes:100,storedBytes:100,state:'verified',verified:true}]
 };
 const r=buildSeasonReport(base);
 assert.equal(r.episodes[0].videoOwnerConfirmed,true);
 assert.equal(r.episodes[0].audioOwnerConfirmed,true);
 assert.equal(r.episodes[0].avReviewSource,'owner_manual_browser_confirmation_only');
 assert.equal(r.episodes[1].videoOwnerConfirmed,false);
 assert.equal(r.episodes[1].audioOwnerConfirmed,false);
 assert.equal(r.episodes[1].sourceVerified,true);
 assert.equal(r.providerMediaRequests,0);
});
test('owner A/V HTTP requires bearer, signed action and both confirmations',async()=>{
 const token='k'.repeat(48),calls=[];
 const hub=createContentHubServer({token,storage:{},lease:{},
  seasonQueueStore:{
   confirmEpisodeAv:async({runId})=>{
    calls.push(runId);
    return {ok:true,runId,videoOwnerConfirmed:true,
     audioOwnerConfirmed:true,confirmedAt:'2026-11-14T12:00:00Z'};
   }
  }});
 hub.server.listen(0,'127.0.0.1');
 await new Promise(resolve=>hub.server.once('listening',resolve));
 const url='http://127.0.0.1:'+hub.server.address().port+
 '/internal/seasons/episodes/av/confirm';
 const data={runId:good,confirmed:true,videoConfirmed:true,
  audioConfirmed:true};
 const body=JSON.stringify(data);
 const headers={authorization:'Bearer '+token,
  'content-type':'application/json',
  'x-blofy-owner-action':'confirm-manual-episode-av',
  'x-blofy-video-confirmed':'yes','x-blofy-audio-confirmed':'yes'};
 try{
  assert.equal((await fetch(url,{method:'POST',body,headers:{
   'content-type':'application/json'}})).status,401);
  assert.equal((await fetch(url,{method:'POST',body,headers:{
   authorization:'Bearer '+token,'content-type':'application/json'}})).status,403);
  assert.equal((await fetch(url+'?bad=1',{method:'POST',body,headers})).status,403);
  assert.equal((await fetch(url,{method:'POST',
   body:JSON.stringify({...data,audioConfirmed:false}),headers})).status,400);
  assert.equal((await fetch(url,{method:'POST',body,headers:{
   ...headers,'x-blofy-video-confirmed':'no'}})).status,403);
  assert.deepEqual(calls,[]);
  const response=await fetch(url,{method:'POST',body,headers});
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(result.ok,true);
  assert.equal(result.manualOnly,true);
  assert.equal(result.automaticStart,false);
  assert.equal(result.providerMediaRequests,0);
  assert.deepEqual(calls,[good]);
 }finally{await new Promise(resolve=>hub.server.close(resolve))}
});
