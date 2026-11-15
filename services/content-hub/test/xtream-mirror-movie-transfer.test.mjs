import test from 'node:test';
import assert from 'node:assert/strict';
import {
 mirrorMovieDispatchReadiness,runOneApprovedMirrorMovieChunk,
 createMirrorMovieTransferStore
} from '../src/xtream-mirror-movie-transfer.mjs';

const ID='123e4567-e89b-42d3-a456-426614174000';
const time=new Date('2026-11-15T01:12:00Z');
const env={
 BLOFY_CONTENT_HUB_MIRROR_MOVIE_DISPATCH_ENABLED:'1',
 BLOFY_CONTENT_HUB_MIRROR_INDIVIDUAL_RIGHTS_AUDITED:'1',
 BLOFY_CONTENT_HUB_UPLOAD_ENABLED:'1',
 BLOFY_CONTENT_HUB_STORAGE_RIGHTS_CONFIRMED:'1',
 BLOFY_CONTENT_HUB_CHUNKED_ENABLED:'1',
 BLOFY_CONTENT_HUB_SOURCE_IDLE_CONFIRMED:'1',
 BLOFY_CONTENT_HUB_SOURCE_QUIET_WINDOW_CONFIRMED:'1',
 BLOFY_XTREAM_DAILY_CATALOG_SOURCE_ID:ID,
 BLOFY_CONTENT_HUB_BRIDGE_TOKEN:'X'.repeat(40)
};
const runId='mirror_'+'a'.repeat(40);
const sample={ok:true,sourceId:ID,gatewayId:15,mediaId:'film-9',
 extension:'mp4',expectedBytes:16*1024*1024,runId,previousParts:0};

function fixture({claimed=sample}={}){
 const calls=[],store={
  async claim(args){calls.push(['claim',args]);return claimed},
  async finish(job,opts){calls.push(['finish',job,opts]);return {ok:true}}
 };
 const storage={health:async()=>({ok:true})};
 const lease={acquire:async()=>({release:async()=>{}}),
  getVerifiedChunkedObject:async()=>({
   bytes:sample.expectedBytes,sha256:'b'.repeat(64),
   parts:[{partNumber:1},{partNumber:2}]
  })};
 return {store,storage,lease,calls};
}
test('mirror transfer opt-in, rights audit and quiet hours all required',()=>{
 assert.equal(mirrorMovieDispatchReadiness({},time).ready,false);
 assert.equal(mirrorMovieDispatchReadiness(env,time).ready,true);
 assert.equal(mirrorMovieDispatchReadiness({
  ...env,BLOFY_CONTENT_HUB_MIRROR_INDIVIDUAL_RIGHTS_AUDITED:'0'
 },time).ready,false);
 assert.ok(mirrorMovieDispatchReadiness(env,
  new Date('2026-11-15T14:00:00Z')).blockedBy
  .includes('mirror_outside_quiet_window'));
});

test('one approved row invokes one real chunk-worker call, not simulated transfer',async()=>{
 const f=fixture();
 const launched=[];
 const done=await runOneApprovedMirrorMovieChunk({...f,env,now:time,
  runner:async args=>{
   launched.push(args.env);
   return {ok:true,code:'batch_checkpoint_saved',chunksSaved:1}
  }});
 assert.equal(done.ok,true);
 assert.equal(done.code,'mirror_movie_chunk_checkpoint_saved');
 assert.equal(done.customerCutover,false);
 assert.equal(launched.length,1);
 assert.equal(launched[0].BLOFY_CONTENT_HUB_MIRROR_DYNAMIC_MOVIE_ENABLED,'1');
 assert.equal(launched[0].BLOFY_CONTENT_HUB_APPROVED_GATEWAY_ID,'15');
 assert.equal(launched[0].BLOFY_CONTENT_HUB_BATCH_RUN_ID,runId);
 assert.equal(launched[0].BLOFY_CONTENT_HUB_CHUNKS_PER_BATCH,'1');
 assert.equal(f.calls[1][2].status,'approved');
 assert.equal(f.calls[1][2].parts,1);
 assert.equal(f.calls[0][1].dailyBytesLimit,64*1024**2);
});

test('full private verified manifest required before marking movie copied',async()=>{
 const f=fixture(),done=await runOneApprovedMirrorMovieChunk({
  ...f,env,now:time,
  runner:async()=>({ok:true,code:'batch_movie_fully_verified',
   chunksSaved:2,sha256:'b'.repeat(64)})
 });
 assert.equal(done.verified,true);
 assert.equal(done.code,'mirror_movie_private_sha_verified');
 assert.equal(f.calls[1][2].status,'verified');
 assert.equal(f.calls[1][2].sha256,'b'.repeat(64));
 const invalid=fixture();invalid.lease.getVerifiedChunkedObject=
  async()=>({bytes:100,sha256:'bad',parts:[]});
 const blocked=await runOneApprovedMirrorMovieChunk({
  ...invalid,env,now:time,runner:async()=>({
   ok:true,code:'batch_movie_fully_verified'})});
 assert.equal(blocked.ok,false);
 assert.equal(invalid.calls[1][2].status,'failed');
});

test('missing license flag, in-use source, or unhealthy private storage never claims',async()=>{
 const f=fixture();
 const gated=await runOneApprovedMirrorMovieChunk({
  ...f,env:{...env,BLOFY_CONTENT_HUB_MIRROR_MOVIE_DISPATCH_ENABLED:'0'},
  now:time,runner:async()=>{throw Error('should not run')}});
 assert.equal(gated.code,'mirror_movie_safety_gates_off');
 assert.equal(f.calls.length,0);
 const busy=await runOneApprovedMirrorMovieChunk({...f,env,
  now:time,sourceBusy:()=>true});
 assert.equal(busy.code,'mirror_movie_source_busy');
 assert.equal(f.calls.length,0);
 const storage=await runOneApprovedMirrorMovieChunk({
  ...f,storage:{health:async()=>({ok:false})},env,now:time});
 assert.equal(storage.code,'mirror_movie_private_storage_unavailable');
 assert.equal(f.calls.length,0);
});

test('failed chunk holds source item for review instead of infinite retries',async()=>{
 const f=fixture();
 const result=await runOneApprovedMirrorMovieChunk({
  ...f,env,now:time,
  runner:async()=>({ok:false,code:'batch_source_version_changed'})});
 assert.equal(result.ok,false);
 assert.equal(f.calls[1][2].status,'failed');
 assert.equal(f.calls[1][2].code,'batch_source_version_changed');
});

test('global per-source/day budget is reserved before a single claimed item',async()=>{
 const trace=[],row={source_id:ID,gateway_id:15,media_id:'film-9',
  extension:'mp4',expected_bytes:16777216,copy_run_id:runId,
  copied_parts:0};
 let pool;
 class FakePool{
  constructor(){pool=this}
  async connect(){return this}
  release(){}
  async query(sql,args=[]){
   trace.push({sql,args});
   if(sql.startsWith('CREATE')||sql==='BEGIN'||sql==='COMMIT')
    return {rowCount:0,rows:[]};
   if(sql.startsWith('INSERT'))return {rowCount:1,rows:[]};
   if(sql.includes('SELECT reserved_bytes'))return {
    rows:[{reserved_bytes:'0'}]};
   if(sql.includes('WITH picked'))return {rows:[row],rowCount:1};
   if(sql.includes('SET reserved_bytes='))return {rowCount:1};
   if(sql.includes('SET state=$4'))return {rowCount:1,
    rows:[{gateway_id:15}]};
   if(sql.includes('SELECT local_day,reserved_bytes'))return {rows:[]};
   throw Error('unexpected SQL '+sql.slice(0,70));
  }
  async end(){}
 }
 const store=createMirrorMovieTransferStore({
  connectionString:'postgres://local',Pool:FakePool
 });
 const claimed=await store.claim({
  sourceId:ID,localDay:'2026-11-15',dailyBytesLimit:64*1024**2});
 assert.equal(claimed.ok,true);
 assert.equal(claimed.gatewayId,15);
 assert.ok(trace.some(t=>t.sql.includes('FOR UPDATE OF q SKIP LOCKED')));
 assert.ok(trace.some(t=>t.sql.includes('rights_ref_sha256')));
 assert.ok(trace.some(t=>t.sql.includes('reserved_bytes=reserved_bytes+$3')));
 const finished=await store.finish({
  sourceId:ID,gatewayId:15,runId
 },{status:'verified',parts:2,sha256:'b'.repeat(64)});
 assert.equal(finished.ok,true);
 await store.close();
});

test('budget exhausted before provider/source job claim',async()=>{
 let calls=0;
 class FakePool{
  async connect(){return this}
  release(){}
  async query(sql){
   calls++;
   if(sql.includes('SELECT reserved_bytes'))return {
    rows:[{reserved_bytes:String(64*1024**2)}]};
   if(sql.includes('WITH picked'))throw Error('unexpected media claim');
   return {rowCount:0,rows:[]};
  }
  async end(){}
 }
 const store=createMirrorMovieTransferStore({
  connectionString:'postgres://local',Pool:FakePool
 });
 const r=await store.claim({sourceId:ID,localDay:'2026-11-15',
  dailyBytesLimit:64*1024**2});
 assert.equal(r.code,'mirror_movie_daily_budget_exhausted');
 assert.ok(calls>=4);
 await store.close();
});
