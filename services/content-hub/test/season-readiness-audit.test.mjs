import test from 'node:test';
import assert from 'node:assert/strict';
import {createSeasonQueueStore} from '../src/season-queue.mjs';
import {createContentHubServer} from '../src/server.mjs';
const globalRow={
 episode_count:'10',registered_season_count:'2',
 queued_count:'2',paused_count:'1',running_count:'0',
 failed_count:'1',verified_count:'6',av_reviewed_count:'3',
 inconsistent_count:'0',expected_bytes:'100000',
 stored_bytes:'60000',last_reviewed_at:'2026-11-14T11:00:00Z'
};
const s=(key,n)=>({...globalRow,season_key:key,
 episode_count:String(n),registered_season_count:'1',
 verified_count:'2',av_reviewed_count:'1',failed_count:'0'});
test('global audit has exact registered queue coverage, bounded page and no media reads',async()=>{
 const queries=[];
 class MockPool{
  async query(sql,params=[]){
   queries.push({sql,params});
   if(sql.includes('GROUP BY q.season_key'))
    return {rows:Array.from({length:21},(_,i)=>
     s('series_42_s'+String(i+1).padStart(2,'0'),3))};
   if(sql.includes('COUNT(DISTINCT q.season_key)'))
    return {rows:[globalRow]};
   return {rows:[]};
  }
  async end(){}
 }
 const store=createSeasonQueueStore({connectionString:'mock',Pool:MockPool});
 const d=await store.readinessAudit({page:4});
 assert.equal(d.ok,true);
 assert.equal(d.readOnly,true);
 assert.equal(d.databaseSnapshotOnly,true);
 assert.equal(d.scope,'all_registered_private_season_queue_episodes_only');
 assert.equal(d.global.registeredEpisodes,10);
 assert.equal(d.global.registeredSeasons,2);
 assert.equal(d.global.storageVerifiedEpisodes,6);
 assert.equal(d.global.ownerAvReviewedEpisodes,3);
 assert.equal(d.global.verifiedAwaitingOwnerAv,3);
 assert.equal(d.global.ownerAvReviewPercentOfVerified,50);
 assert.equal(d.global.failedEpisodes,1);
 assert.equal(d.seasons.length,20);
 assert.equal(d.hasNext,true);
 assert.equal(d.hasPrevious,true);
 assert.equal(d.providerMediaRequests,0);
 assert.equal(d.storageRequests,0);
 assert.equal(d.mediaCodecScanned,false);
 assert.equal(d.allSourceEpisodesCountKnown,false);
 const pageQuery=queries.find(x=>x.sql.includes('GROUP BY q.season_key'));
 assert.deepEqual(pageQuery.params,[21,60]);
 assert.match(pageQuery.sql,/GREATEST\(q.updated_at,r.updated_at\)/);
 assert.match(pageQuery.sql,/q.state='verified' AND r.state='verified'/);
 assert.match(pageQuery.sql,/LIMIT \$1 OFFSET \$2/);
 assert.equal(queries.filter(q=>/CREATE TABLE/.test(q.sql)).length,1,
  'only existing queue ensure, never create review ledger during read');
 for(const page of [-1,0,1.3,'1',10001,NaN]){
  await assert.rejects(store.readinessAudit({page}),
   /season_readiness_page_invalid/);
 }
 await store.close();
});
test('read-only audit treats missing A/V review table as unknown and does not create it',async()=>{
 let misses=0;
 class MockPool{
  async query(sql){
   if(sql.includes('JOIN blofy_content_hub_episode_av_reviews v')){
    misses++;
    throw Object.assign(Error('does not exist'),{code:'42P01'});
   }
   if(sql.includes('GROUP BY q.season_key'))
    return {rows:[{...globalRow,season_key:'series_42_s01',
     av_reviewed_count:'0'}]};
   if(sql.includes('COUNT(DISTINCT q.season_key)'))
    return {rows:[{...globalRow,av_reviewed_count:'0'}]};
   return {rows:[]};
  }
  async end(){}
 }
 const store=createSeasonQueueStore({connectionString:'mock',Pool:MockPool});
 const r=await store.readinessAudit();
 assert.equal(misses,1);
 assert.equal(r.manifestStateAvailable,true);
 assert.equal(r.ownerReviewSchemaAvailable,false);
 assert.equal(r.global.ownerAvReviewedEpisodes,0);
 assert.equal(r.global.verifiedAwaitingOwnerAv,6);
 assert.equal(r.global.registeredEpisodes,10);
 await store.close();
});
test('read-only audit fails closed to unknown verification when manifest table absent',async()=>{
 class MockPool{
  async query(sql){
   if(sql.includes('JOIN blofy_content_hub_episode_av_reviews v')||
      sql.includes('JOIN blofy_content_hub_episode_runs r'))
    throw Object.assign(Error('relation missing'),{code:'42P01'});
   if(sql.includes('GROUP BY q.season_key'))
    return {rows:[{...globalRow,verified_count:'0',
     av_reviewed_count:'0',inconsistent_count:'0',season_key:'series_42_s01'}]};
   if(sql.includes('COUNT(DISTINCT q.season_key)'))
    return {rows:[{...globalRow,verified_count:'0',
     av_reviewed_count:'0',inconsistent_count:'0'}]};
   return {rows:[]};
  }
  async end(){}
 }
 const store=createSeasonQueueStore({connectionString:'mock',Pool:MockPool});
 const d=await store.readinessAudit();
 assert.equal(d.manifestStateAvailable,false);
 assert.equal(d.ownerReviewSchemaAvailable,false);
 assert.equal(d.global.storageVerifiedEpisodes,0);
 assert.equal(d.global.ownerAvReviewedEpisodes,0);
 await store.close();
});
test('private readiness route rejects missing bearer, query tricks, no owner header and invalid page',async()=>{
 const token='e'.repeat(48),calls=[];
 const hub=createContentHubServer({token,storage:{},lease:{},
  seasonQueueStore:{readinessAudit:async({page})=>{
   calls.push(page);return {ok:true,page,global:{registeredEpisodes:0},
    readOnly:true,privateOnly:true,databaseSnapshotOnly:true,
    seasons:[],scope:'all_registered_private_season_queue_episodes_only',
    automaticStart:false,storageRequests:0,providerMediaRequests:0};
  }}});
 hub.server.listen(0,'127.0.0.1');
 await new Promise(done=>hub.server.once('listening',done));
 const url='http://127.0.0.1:'+hub.server.address().port+
  '/internal/seasons/readiness/page/1';
 const auth={authorization:'Bearer '+token};
 const headers={...auth,'x-blofy-owner-action':'review-private-seasons'};
 try{
  assert.equal((await fetch(url)).status,401);
  assert.equal((await fetch(url,{headers:auth})).status,403);
  assert.equal((await fetch(url+'?url=https://evil.example',{headers})).status,403);
  assert.equal((await fetch(url,{method:'POST',headers})).status,404);
  assert.equal((await fetch(url.replace(/\\/page\\/1$/, '/page/000'),{headers})).status,404);
  assert.equal(calls.length,0);
  const response=await fetch(url,{headers});
  assert.equal(response.status,200);
  const d=await response.json();
  assert.equal(d.ok,true);
  assert.equal(d.privateOnly,true);
  assert.deepEqual(calls,[1]);
 }finally{await new Promise(done=>hub.server.close(done))}
});
