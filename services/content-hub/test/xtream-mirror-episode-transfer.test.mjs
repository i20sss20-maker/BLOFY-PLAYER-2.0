import test from 'node:test';
import assert from 'node:assert/strict';
import {
 mirrorEpisodeDispatchReadiness,runOneApprovedMirrorEpisodeChunk,
 createMirrorEpisodeTransferStore
} from '../src/xtream-mirror-episode-transfer.mjs';

const ID='123e4567-e89b-42d3-a456-426614174000';
const NOW=new Date('2026-11-15T01:05:00Z');
const env={
 BLOFY_CONTENT_HUB_MIRROR_EPISODE_DISPATCH_ENABLED:'1',
 BLOFY_CONTENT_HUB_MIRROR_INDIVIDUAL_RIGHTS_AUDITED:'1',
 BLOFY_CONTENT_HUB_MIRROR_EPISODE_AV_SAMPLE_CONFIRMED:'1',
 BLOFY_CONTENT_HUB_EPISODE_COPY_ENABLED:'1',
 BLOFY_CONTENT_HUB_UPLOAD_ENABLED:'1',
 BLOFY_CONTENT_HUB_STORAGE_RIGHTS_CONFIRMED:'1',
 BLOFY_CONTENT_HUB_EPISODE_RIGHTS_CONFIRMED:'1',
 BLOFY_CONTENT_HUB_SOURCE_IDLE_CONFIRMED:'1',
 BLOFY_CONTENT_HUB_SOURCE_QUIET_WINDOW_CONFIRMED:'1',
 BLOFY_XTREAM_DAILY_CATALOG_SOURCE_ID:ID,
 BLOFY_CONTENT_HUB_BRIDGE_TOKEN:'X'.repeat(40)
};
const job={ok:true,sourceId:ID,gatewayId:401,mediaId:'ep100',
 extension:'mkv',expectedBytes:16*1024**2,
 runId:'mirror_'+'a'.repeat(40),previousParts:0};
const mock=()=>{
 const events=[],store={
  async claim(x){events.push(['claim',x]);return job},
  async finish(j,opts){events.push(['finish',j,opts]);return {ok:true}}
 };
 const storage={health:async()=>({ok:true})};
 const lease={acquire:async()=>({release:async()=>{}}),
  getVerifiedEpisodeObject:async()=>({
   bytes:job.expectedBytes,sha256:'b'.repeat(64),
   parts:[{partNumber:1},{partNumber:2}]
  })};
 return {events,store,storage,lease};
};

test('disabled by default, individual legal audit, AV proof, source idle and quiet hours required',()=>{
 assert.equal(mirrorEpisodeDispatchReadiness({},NOW).ready,false);
 assert.equal(mirrorEpisodeDispatchReadiness(env,NOW).ready,true);
 assert.equal(mirrorEpisodeDispatchReadiness({...env,
  BLOFY_CONTENT_HUB_MIRROR_EPISODE_AV_SAMPLE_CONFIRMED:'0'},NOW).ready,false);
 assert.ok(mirrorEpisodeDispatchReadiness(env,
  new Date('2026-11-15T16:00:00Z')).blockedBy
  .includes('outside_riyadh_quiet_hours'));
});

test('one approved episode runs EXACT dynamic media chunk worker',async()=>{
 const f=mock();let ran=0;
 const r=await runOneApprovedMirrorEpisodeChunk({...f,env,now:NOW,
  runner:async opts=>{
   ran++;assert.equal(opts.env.BLOFY_CONTENT_HUB_EPISODE_RUN_ID,job.runId);
   assert.equal(opts.env.BLOFY_CONTENT_HUB_MIRROR_DYNAMIC_EPISODE_ENABLED,'1');
   assert.equal(opts.env.BLOFY_CONTENT_HUB_EPISODE_APPROVED_GATEWAY_ID,'401');
   const accepted=await opts.candidateInspector();
   assert.equal(accepted.candidates[0].mediaId,'ep100');
   assert.equal(accepted.candidates[0].extension,'mkv');
   return {ok:true,code:'episode_checkpoint_saved',chunksSaved:1};
  }});
 assert.equal(r.ok,true);assert.equal(r.verified,false);
 assert.equal(r.code,'mirror_episode_chunk_checkpoint_saved');
 assert.equal(r.customerCutover,false);
 assert.equal(f.events[0][1].day,'2026-11-15');
 assert.equal(f.events[1][2].state,'approved');
 assert.equal(f.events[1][2].parts,1);
 assert.equal(ran,1);
});

test('full SHA-verified private manifest required for episode success',async()=>{
 const f=mock();
 const r=await runOneApprovedMirrorEpisodeChunk({...f,env,now:NOW,
  runner:async()=>({ok:true,code:'episode_fully_verified',chunksSaved:2})});
 assert.equal(r.ok,true);assert.equal(r.verified,true);
 assert.equal(f.events[1][2].sha256,'b'.repeat(64));
 const g=mock();g.lease.getVerifiedEpisodeObject=async()=>null;
 const fail=await runOneApprovedMirrorEpisodeChunk({...g,env,now:NOW,
  runner:async()=>({ok:true,code:'episode_fully_verified'})});
 assert.equal(fail.ok,false);
 assert.equal(g.events[1][2].state,'failed');
});

test('no permission, source occupied or S3 down never claim provider resources',async()=>{
 const f=mock();
 let r=await runOneApprovedMirrorEpisodeChunk({...f,
  env:{...env,BLOFY_CONTENT_HUB_MIRROR_EPISODE_DISPATCH_ENABLED:'0'},
  now:NOW});assert.equal(r.code,'mirror_episode_safety_gates_off');
 r=await runOneApprovedMirrorEpisodeChunk({...f,env,now:NOW,
  sourceBusy:()=>true});assert.equal(r.code,'mirror_episode_source_busy');
 r=await runOneApprovedMirrorEpisodeChunk({...f,env,now:NOW,
  storage:{health:async()=>({ok:false})}});
 assert.equal(r.code,'mirror_episode_private_storage_unavailable');
 assert.equal(f.events.length,0);
});

test('provider failure marks episode for review rather than infinite retries',async()=>{
 const f=mock();
 const r=await runOneApprovedMirrorEpisodeChunk({...f,env,now:NOW,
  runner:async()=>({ok:false,code:'episode_source_version_changed'})});
 assert.equal(r.ok,false);
 assert.equal(f.events[1][2].state,'failed');
 assert.equal(f.events[1][2].code,'episode_source_version_changed');
});

test('cross-item daily byte budget table is the same as the movie worker',async()=>{
 const logs=[],row={source_id:ID,gateway_id:401,media_id:'ep100',
  extension:'mkv',expected_bytes:16777216,
  copy_run_id:job.runId,copied_parts:0};
 class Pool{
  async connect(){return this}
  release(){}
  async query(sql,args=[]){
   logs.push({sql,args});
   if(sql.startsWith('CREATE')||sql.startsWith('ALTER')||sql==='BEGIN'||sql==='COMMIT')
    return {rowCount:0,rows:[]};
   if(sql.startsWith('INSERT'))return {rowCount:1,rows:[]};
   if(sql.includes('SELECT reserved_bytes'))return {rows:[{reserved_bytes:'0'}]};
   if(sql.includes('WITH picked'))return {rows:[row],rowCount:1};
   if(sql.includes('SET reserved_bytes='))return {rowCount:1};
   if(sql.includes("SET state=CASE WHEN $4='retry'"))return {rowCount:1,rows:[{gateway_id:401}]};
   if(sql.includes('SELECT local_day,reserved_bytes'))return {rows:[]};
   throw Error('unexpected SQL '+sql.slice(0,100));
  }
  async end(){}
 }
 const store=createMirrorEpisodeTransferStore({
  connectionString:'postgres://example/private',Pool
 });
 const result=await store.claim({sourceId:ID,day:'2026-11-15',
  limit:67108864});
 assert.equal(result.ok,true);
 assert.equal(result.runId,job.runId);
 assert.ok(logs.some(x=>x.sql.includes('FOR UPDATE OF q SKIP LOCKED')));
 assert.ok(logs.some(x=>x.sql.includes('rights_ref_sha256')));
 assert.ok(logs.some(x=>x.sql.includes('blofy_content_hub_mirror_daily_budget')));
 assert.equal((await store.finish(job,{state:'verified',parts:2,
  sha256:'b'.repeat(64)})).ok,true);
 await store.close();
});

test('temporary episode media failure backs off but never loses previously recorded parts',async()=>{
 const f=mock();
 f.store.finish=async(j,opts)=>{
  f.events.push(['finish',j,opts]);
  return {ok:true,state:'approved',retryAttempts:1,
   retryAfter:'2026-11-15T01:20:00Z'};
 };
 const result=await runOneApprovedMirrorEpisodeChunk({
  ...f,env,now:NOW,
  runner:async()=>({ok:false,code:'episode_retryable_error',
   checkpointsRetained:1,errorStage:'source_chunk'})
 });
 assert.equal(result.ok,false);
 assert.equal(result.code,'mirror_episode_retry_scheduled');
 assert.equal(result.retryAttempts,1);
 assert.equal(f.events[1][2].state,'retry');
 assert.equal(f.events[1][2].parts,1);
 assert.equal(f.events[1][2].code,'episode_retryable_error');
 const exhausted=mock();
 exhausted.store.finish=async()=>({ok:true,state:'failed',
  retryAttempts:3,retryAfter:null});
 const reviewed=await runOneApprovedMirrorEpisodeChunk({
  ...exhausted,env,now:NOW,
  runner:async()=>({ok:false,code:'episode_retryable_error'})
 });
 assert.equal(reviewed.code,'mirror_episode_retry_limit_review');
});

test('episode PostgreSQL lease SELECT validates exact parent series identity',async()=>{
 const sql=[];
 class FakePool{
  async connect(){return this}
  release(){}
  async query(text,args=[]){
   sql.push({text,args});
   if(text.startsWith('CREATE')||text.startsWith('ALTER')||
      text==='BEGIN'||text==='COMMIT')return {rows:[],rowCount:0};
   if(text.startsWith('INSERT'))return {rows:[],rowCount:1};
   if(text.includes('SELECT reserved_bytes'))return {
    rows:[{reserved_bytes:'0'}],rowCount:1};
   if(text.includes('WITH picked'))return {rows:[],rowCount:0};
   return {rows:[],rowCount:0};
  }
  async end(){}
 }
 const store=createMirrorEpisodeTransferStore({
  connectionString:'postgres://test',Pool:FakePool});
 try{
  const result=await store.claim({sourceId:ID,day:'2026-11-15',
   limit:64*1024**2});
  assert.equal(result.code,'mirror_episode_no_approved_item');
  const claim=sql.find(x=>x.text.includes('WITH picked'));
  assert.match(claim.text,/e.series_source_id=q.series_media_id/);
 }finally{await store.close()}
});
