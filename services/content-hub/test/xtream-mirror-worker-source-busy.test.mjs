import test from 'node:test';
import assert from 'node:assert/strict';
import {createContentHubServer} from '../src/server.mjs';

const ID='123e4567-e89b-42d3-a456-426614174000';
const QUIET=new Date('2026-11-15T01:05:00.000Z');
const ENV={
 BLOFY_CONTENT_HUB_MIRROR_EPISODE_DISPATCH_ENABLED:'1',
 BLOFY_CONTENT_HUB_MIRROR_MOVIE_DISPATCH_ENABLED:'1',
 BLOFY_CONTENT_HUB_MIRROR_INDIVIDUAL_RIGHTS_AUDITED:'1',
 BLOFY_CONTENT_HUB_MIRROR_EPISODE_AV_SAMPLE_CONFIRMED:'1',
 BLOFY_CONTENT_HUB_EPISODE_COPY_ENABLED:'1',
 BLOFY_CONTENT_HUB_EPISODE_RIGHTS_CONFIRMED:'1',
 BLOFY_CONTENT_HUB_CHUNKED_ENABLED:'1',
 BLOFY_CONTENT_HUB_UPLOAD_ENABLED:'1',
 BLOFY_CONTENT_HUB_STORAGE_RIGHTS_CONFIRMED:'1',
 BLOFY_CONTENT_HUB_SOURCE_IDLE_CONFIRMED:'1',
 BLOFY_CONTENT_HUB_SOURCE_QUIET_WINDOW_CONFIRMED:'1',
 BLOFY_XTREAM_DAILY_CATALOG_SOURCE_ID:ID,
 BLOFY_CONTENT_HUB_BRIDGE_TOKEN:'X'.repeat(40)
};
const noJob=code=>({ok:false,code});
const storage={health:async()=>({ok:true})};
function hubWithStores(episodeStore,movieStore,{preflightReady=true}={}){
 // The runtime safety gate talks to the Hub's private PostgreSQL
 // connection; these rows simulate the SAME source and all manifests.
 const mirrorPreflightStore={db:{async query(sql){
  if(sql.startsWith('SELECT to_regclass('))return {rows:[{
   xtreamServers:preflightReady,xtreamCatalog:preflightReady,
   movieGatewayMap:preflightReady,episodeGatewayMap:preflightReady,
   mirrorQueue:preflightReady,privateMovieManifests:true,
   privateEpisodeManifests:true,sharedDailyBudget:true
  }]};
  if(sql.includes('FROM blofy_xtream_servers'))return {
   rows:[{id:ID,source_online:true,catalog_fresh:true}]
  };
  throw Error('unexpected_preflight_sql');
 }}};
 return createContentHubServer({
  storage,lease:{acquire:async()=>({release:async()=>{}})},pilotEnv:ENV,
  mirrorEpisodeTransferStore:episodeStore,mirrorPreflightStore,
  mirrorMovieTransferStore:movieStore
 });
}
test('scheduled episode dispatch never mistakes its OWN busy flag for another source user',async()=>{
 let calls=0;
 const h=hubWithStores({
  async claim(){calls++;return noJob('mirror_episode_no_approved_item')},
  async finish(){throw Error('finish must never run for empty queue')}
 },{
  async claim(){return noJob('mirror_movie_no_approved_item')},
  async finish(){throw Error('no jobs')}
 });
 const result=await h.runOneMirroredEpisodeChunk(QUIET);
 assert.equal(result.code,'mirror_episode_no_approved_item');
 assert.equal(calls,1,
  'the actual episode-store claim must run, rather than self-block');
});

test('one active episode source-scoped tick blocks concurrent movie tick, never parallel source reads',async()=>{
 let started,release;
 const entered=new Promise(resolve=>{started=resolve});
 const gate=new Promise(resolve=>{release=resolve});
 let episodeClaims=0,movieClaims=0;
 const h=hubWithStores({
  async claim(){
   episodeClaims++;started();
   await gate;
   return noJob('mirror_episode_no_approved_item');
  },
  async finish(){throw Error('no transfer')}
 },{
  async claim(){movieClaims++;return noJob('mirror_movie_no_approved_item')},
  async finish(){throw Error('no transfer')}
 });
 const running=h.runOneMirroredEpisodeChunk(QUIET);
 await entered;
 try{
  const second=await h.runOneMirroredEpisodeChunk(QUIET);
  assert.equal(second.code,'mirror_episode_worker_busy');
  const movie=await h.runOneMirroredMovieChunk(QUIET);
  assert.equal(movie.code,'mirror_movie_source_busy');
  assert.equal(movieClaims,0);
  assert.equal(episodeClaims,1);
 }finally{release()}
 const finished=await running;
 assert.equal(finished.code,'mirror_episode_no_approved_item');
 const after=await h.runOneMirroredMovieChunk(QUIET);
 assert.equal(after.code,'mirror_movie_no_approved_item');
 assert.equal(movieClaims,1);
});

test('missing Xtream tables in private Hub PostgreSQL blocks episode AND movie before claiming bytes',async()=>{
 let claims=0;
 const denied={async claim(){claims++;throw Error('source should not be used')},
  async finish(){throw Error('not attempted')}};
 const hub=hubWithStores(denied,denied,{preflightReady:false});
 const episode=await hub.runOneMirroredEpisodeChunk(QUIET);
 assert.equal(episode.code,'mirror_copy_preflight_blocked');
 assert.equal(episode.sourceMediaRequests,0);
 assert.ok(episode.blockedBy.includes(
  'mirror_preflight_xtream_catalog_not_on_hub_db'));
 const movie=await hub.runOneMirroredMovieChunk(QUIET);
 assert.equal(movie.code,'mirror_copy_preflight_blocked');
 assert.equal(claims,0);
});
