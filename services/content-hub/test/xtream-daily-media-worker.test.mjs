import test from 'node:test';
import assert from 'node:assert/strict';
import {
 riyadhDailyMediaWindow,startApprovedDailyMediaSession,
 createDailyMediaSessionStore
} from '../src/xtream-daily-media-worker.mjs';

const movieEnv={
 BLOFY_CONTENT_HUB_DAILY_COPY_ENABLED:'1',
 BLOFY_CONTENT_HUB_DAILY_COPY_MODE:'movie',
 BLOFY_CONTENT_HUB_CHUNKED_ENABLED:'1',
 BLOFY_CONTENT_HUB_UPLOAD_ENABLED:'1',
 BLOFY_CONTENT_HUB_STORAGE_RIGHTS_CONFIRMED:'1',
 BLOFY_CONTENT_HUB_SOURCE_QUIET_WINDOW_CONFIRMED:'1',
 BLOFY_CONTENT_HUB_SOURCE_IDLE_CONFIRMED:'1',
 BLOFY_CONTENT_HUB_BATCH_RUN_ID:'copy_movie_approved_0001',
 BLOFY_CONTENT_HUB_BRIDGE_TOKEN:'x'.repeat(40),
 BLOFY_CONTENT_HUB_EXPECTED_BYTES:String(16*1024*1024),
 BLOFY_CONTENT_HUB_APPROVED_GATEWAY_ID:'123',
 BLOFY_CONTENT_HUB_CHUNKS_PER_BATCH:'1'
};
const episodesEnv={...movieEnv,
 BLOFY_CONTENT_HUB_DAILY_COPY_MODE:'episodes',
 BLOFY_CONTENT_HUB_SEASON_QUEUE_ENABLED:'1',
 BLOFY_CONTENT_HUB_EPISODE_COPY_ENABLED:'1',
 BLOFY_CONTENT_HUB_EPISODE_RIGHTS_CONFIRMED:'1',
 BLOFY_CONTENT_HUB_EPISODE_RUN_ID:'approved_episode_0001',
 BLOFY_CONTENT_HUB_EPISODE_APPROVED_GATEWAY_ID:'321',
 BLOFY_CONTENT_HUB_EPISODE_EXPECTED_BYTES:String(16*1024*1024)
};
const at=new Date('2026-11-14T01:12:00Z');
function fixture(){
 const claim=new Set(),starts=[];
 const store={
  async claim(day,mode){const key=day+mode;
   if(claim.has(key))return false;
   claim.add(key);return true;
  },
  async release(day,mode){claim.delete(day+mode)}
 };
 const movie={isRunning:()=>false,start:()=>{starts.push('movie');return {ok:true}}};
 const episodes={isRunning:()=>false,start:opts=>{
  starts.push(opts);return {ok:true}
 }};
 return {store,movie,episodes,starts,claim,
  storageReady:()=>true,sourceBusy:()=>false};
}

test('daily media mode and Riyadh 04:00 window must both be explicit',()=>{
 assert.equal(riyadhDailyMediaWindow(at,{}).due,false);
 assert.equal(riyadhDailyMediaWindow(at,movieEnv).due,true);
 assert.equal(riyadhDailyMediaWindow(new Date('2026-11-14T02:15:00Z'),
  movieEnv).code,'daily_media_copy_outside_window');
 assert.equal(riyadhDailyMediaWindow(at,{
  ...movieEnv,BLOFY_CONTENT_HUB_DAILY_COPY_MODE:'all'
 }).due,false);
});

test('one pinned movie session per day starts real existing controller (not proof of copy)',async()=>{
 const f=fixture();
 const r=await startApprovedDailyMediaSession({...f,env:movieEnv,now:at});
 assert.equal(r.ok,true);
 assert.equal(r.mode,'movie');
 assert.equal(r.verifiedCopiesNotYetProven,true);
 assert.deepEqual(f.starts,['movie']);
 const repeated=await startApprovedDailyMediaSession({...f,env:movieEnv,now:at});
 assert.equal(repeated.code,'daily_media_already_started_today');
 assert.deepEqual(f.starts,['movie']);
});

test('source traffic and missing rights block any worker or DB claim',async()=>{
 const f=fixture();
 const sourceBusy=await startApprovedDailyMediaSession({...f,env:movieEnv,
  now:at,sourceBusy:()=>true});
 assert.equal(sourceBusy.code,'daily_media_source_busy');
 const rights=await startApprovedDailyMediaSession({...f,now:at,
  env:{...movieEnv,BLOFY_CONTENT_HUB_STORAGE_RIGHTS_CONFIRMED:'0'}});
 assert.equal(rights.code,'daily_media_copy_safety_gates_off');
 assert.equal(f.claim.size,0);
 assert.equal(f.starts.length,0);
});

test('daily episodes require verified owner A/V playback and clean storage audit',async()=>{
 const f=fixture();
 const missing=await startApprovedDailyMediaSession({...f,now:at,
  env:episodesEnv,lease:{getEpisodeBrowserPlaybackStatus:async()=>({
   confirmed:false})},seasonStore:{unresolvedAuditCounts:async()=>({
    mismatch:0,unavailable:0})}});
 assert.equal(missing.code,'daily_media_owner_av_proof_required');
 assert.equal(f.starts.length,0);
 const mismatch=await startApprovedDailyMediaSession({...f,now:at,
  env:episodesEnv,lease:{getEpisodeBrowserPlaybackStatus:async()=>({
   confirmed:true})},seasonStore:{unresolvedAuditCounts:async()=>({
    mismatch:1,unavailable:0})}});
 assert.equal(mismatch.code,'daily_media_storage_integrity_review');
 assert.equal(f.starts.length,0);
 const started=await startApprovedDailyMediaSession({...f,now:at,
  env:episodesEnv,lease:{getEpisodeBrowserPlaybackStatus:async()=>({
   confirmed:true})},seasonStore:{unresolvedAuditCounts:async()=>({
    mismatch:0,unavailable:0})}});
 assert.equal(started.ok,true);
 assert.deepEqual(f.starts,[{sessionMaxBatches:60}]);
});

test('controller refusal releases day claim without falsely marking media copied',async()=>{
 const f=fixture();
 f.movie.start=()=>({ok:false,code:'copy_already_running'});
 const rejected=await startApprovedDailyMediaSession({...f,env:movieEnv,now:at});
 assert.equal(rejected.started,false);
 assert.equal(rejected.code,'copy_already_running');
 assert.equal(f.claim.size,0);
});

test('daily sessions use a durable unique PG day claim, never duplicate across workers',async()=>{
 const issued=new Set();
 let db;
 class FakePool {
  constructor(){db=this}
  async query(sql,args=[]){
   if(sql.startsWith('CREATE'))return {rowCount:0};
   if(sql.startsWith('INSERT')){
    const key=args.join('|');
    if(issued.has(key))return {rowCount:0};
    issued.add(key);return {rowCount:1};
   }
   if(sql.startsWith('DELETE')){issued.delete(args.join('|'));return {rowCount:1}}
   if(sql.startsWith('SELECT'))return {rows:[]};
   throw Error('unexpected SQL');
  }
  async end(){}
 }
 const store=createDailyMediaSessionStore({
  connectionString:'postgres://private/local',Pool:FakePool});
 assert.equal(await store.claim('2026-11-14','movie'),true);
 assert.equal(await store.claim('2026-11-14','movie'),false);
 assert.equal((await store.recent()).length,0);
 await store.release('2026-11-14','movie');
 assert.equal(await store.claim('2026-11-14','movie'),true);
 await assert.rejects(()=>store.claim('2026-11-14','live'),
  /daily_media_copy_claim_invalid/);
 await store.close();
});
