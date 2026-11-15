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
function hubWithStores(episodeStore,movieStore){
 return createContentHubServer({
  storage,lease:{},pilotEnv:ENV,
  mirrorEpisodeTransferStore:episodeStore,
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
