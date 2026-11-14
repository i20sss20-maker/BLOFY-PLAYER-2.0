// Private, opt-in season transfer queue. No subscriber/media endpoints.
// One operator-approved episode chunk (8 MiB) per worker iteration.
// PostgreSQL checkpoints + the underlying episode manifest allow safe resume.
import pg from 'pg';
import {randomBytes} from 'node:crypto';
import {episodeCopyReadiness,runOneEpisodeChunk} from './episode-chunk-pilot.mjs';

const RUN=/^[A-Za-z0-9_-]{8,80}$/;
const SEASON=/^[a-z0-9][a-z0-9_-]{2,63}$/;
const MAX_BYTES=4*1024**3, MIN_BYTES=8*1024*1024;
const MODES=new Set(['queued','running','paused','verified','failed']);
const safeCode=value=>/^[a-z0-9_]{1,80}$/.test(String(value||''))?
  String(value):'season_copy_failed';
const safeStatus=row=>{
 const total=Number(row.expected_bytes||0);
 const bytes=Math.max(0,Math.min(total,Number(row.bytes_copied||0)));
 const state=row.episode_state==='verified'?'verified':row.state;
 return {runId:row.run_id,seasonKey:row.season_key,
  episodeNumber:Number(row.episode_number),title:row.title,
  gatewayId:Number(row.gateway_id),state,expectedBytes:total,
  bytesCopied:bytes,percent:total?Math.floor(100*bytes/total):0,
  retries:Number(row.retries||0),code:row.code||null,
  createdAt:row.created_at,updatedAt:row.updated_at};
};
export function seasonQueueSummary(rows){
 const seasons=new Map();
 for(const row of rows){
  const s=seasons.get(row.seasonKey)||{seasonKey:row.seasonKey,
   episodeCount:0,verifiedCount:0,failedCount:0,bytesCopied:0,
   expectedBytes:0,percent:0};
  s.episodeCount++;
  s.verifiedCount+=Number(row.state==='verified');
  s.failedCount+=Number(row.state==='failed');
  s.bytesCopied+=row.bytesCopied;
  s.expectedBytes+=row.expectedBytes;
  seasons.set(row.seasonKey,s);
 }
 return [...seasons.values()].map(s=>({...s,
  percent:s.expectedBytes?Math.floor(100*s.bytesCopied/s.expectedBytes):0}));
}
export function seasonQueueReadiness(env={}){
 const blockedBy=[];
 if(env.BLOFY_CONTENT_HUB_SEASON_QUEUE_ENABLED!=='1')
  blockedBy.push('season_queue_disabled');
 for(const [key,code] of [
  ['BLOFY_CONTENT_HUB_UPLOAD_ENABLED','storage_upload_disabled'],
  ['BLOFY_CONTENT_HUB_STORAGE_RIGHTS_CONFIRMED','storage_rights_unconfirmed'],
  ['BLOFY_CONTENT_HUB_EPISODE_RIGHTS_CONFIRMED','episode_rights_unconfirmed'],
  ['BLOFY_CONTENT_HUB_EPISODE_COPY_ENABLED','episode_copy_disabled'],
  ['BLOFY_CONTENT_HUB_SOURCE_IDLE_CONFIRMED','source_idle_unconfirmed'],
  ['BLOFY_CONTENT_HUB_SOURCE_QUIET_WINDOW_CONFIRMED','quiet_window_unconfirmed']
 ])if(env[key]!=='1')blockedBy.push(code);
 if(String(env.BLOFY_CONTENT_HUB_BRIDGE_TOKEN||'').length<32)
  blockedBy.push('source_bridge_not_configured');
 return {ready:blockedBy.length===0,blockedBy,privateOnly:true,
  customerCutover:false,automaticStartup:false};
}
export function validateSeasonSelection({seasonKey,episodes,candidates}={}){
 if(!SEASON.test(String(seasonKey||''))||
   !Array.isArray(episodes)||episodes.length<1||episodes.length>12||
   !Array.isArray(candidates))
  throw Error('season_selection_invalid');
 const usedIds=new Set(),usedPositions=new Set();
 return episodes.map(row=>{
  const gatewayId=Number(row?.gatewayId);
  const episodeNumber=Number(row?.episodeNumber);
  const expectedBytes=Number(row?.expectedBytes);
  const matched=candidates.find(c=>c.gatewayId===gatewayId);
  if(!Number.isSafeInteger(gatewayId)||gatewayId<1||
    !Number.isSafeInteger(episodeNumber)||episodeNumber<1||
    episodeNumber>500||
    !Number.isSafeInteger(expectedBytes)||expectedBytes<MIN_BYTES||
    expectedBytes>MAX_BYTES||usedIds.has(gatewayId)||
    usedPositions.has(episodeNumber)||
    matched?.sourceName!=='saleh'||matched?.mediaKind!=='episode'||
    !/^[a-f0-9-]{36}$/i.test(String(matched?.sourceId||''))||
    !/^[A-Za-z0-9._-]{1,128}$/.test(String(matched?.mediaId||''))||
    !['mp4','mkv','avi','ts'].includes(matched?.extension))
   throw Error('season_episode_not_approved');
  usedIds.add(gatewayId);usedPositions.add(episodeNumber);
  return {runId:'season_'+randomBytes(12).toString('hex'),
   seasonKey,gatewayId,episodeNumber,expectedBytes,
   sourceId:matched.sourceId,mediaId:matched.mediaId,
   extension:matched.extension,title:String(matched.title||'').slice(0,220)};
 });
}
export function createSeasonQueueStore({
 connectionString,Pool=pg.Pool}={}){
 if(!connectionString)throw Error('season_queue_database_required');
 const pool=new Pool({connectionString,max:2,connectionTimeoutMillis:5000,
  idleTimeoutMillis:10000,application_name:'blofy-season-queue'});
 let initPromise;
 async function ensure(){
  if(!initPromise){
   initPromise=(async()=>{
    await pool.query([
     'CREATE TABLE IF NOT EXISTS blofy_content_hub_season_queue (',
     'run_id TEXT PRIMARY KEY,',
     'season_key TEXT NOT NULL,',
     'episode_number INTEGER NOT NULL CHECK (episode_number BETWEEN 1 AND 500),',
     'title TEXT NOT NULL, gateway_id INTEGER NOT NULL UNIQUE,',
     'source_id UUID NOT NULL, media_id TEXT NOT NULL,',
     'extension TEXT NOT NULL,',
     'expected_bytes BIGINT NOT NULL CHECK(expected_bytes BETWEEN 8388608 AND 4294967296),',
     "state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','paused','verified','failed')),",
     'retries INTEGER NOT NULL DEFAULT 0, code TEXT,',
     'created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),',
     'updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),',
     'UNIQUE (season_key, episode_number))'
    ].join(' '));
   })().catch(e=>{initPromise=null;throw e});
  }
  await initPromise;
 }
 return {
  ensure,
  // Global scheduler lock is distinct from the per-chunk source lock.
  // Prevents a second replica from resetting an active worker's state.
  async acquireWorker(){
   await ensure();
   const client=await pool.connect();
   try{
    const row=await client.query([
     'SELECT pg_try_advisory_lock(',
     "hashtext('blofy_season_scheduler'),hashtext('saleh')) AS held"
    ].join(' '));
    if(row.rows?.[0]?.held!==true){client.release();return null}
    let released=false;
    return {release:async()=>{
     if(released)return;
     released=true;
     try{
      await client.query([
       'SELECT pg_advisory_unlock(',
       "hashtext('blofy_season_scheduler'),hashtext('saleh'))"
      ].join(' '));
     }finally{client.release()}
    }};
   }catch(e){client.release(e);throw e}
  },
  async enqueue(entries){
   await ensure();
   if(!Array.isArray(entries)||entries.length<1||entries.length>12||
     entries.some(e=>!RUN.test(e.runId)||!SEASON.test(e.seasonKey)))
    throw Error('season_queue_entries_invalid');
   const client=await pool.connect();
   try{
    await client.query('BEGIN');
    const exists=await client.query(
      "SELECT to_regclass('blofy_content_hub_episode_runs') AS table_name");
    const hasEpisodeRecords=Boolean(exists.rows?.[0]?.table_name);
    let added=0,reused=0;
    for(const e of entries){
     let previous=null;
     if(hasEpisodeRecords){
      const row=await client.query([
       'SELECT run_id,state,source_id,media_id,extension,expected_bytes',
       'FROM blofy_content_hub_episode_runs',
       "WHERE gateway_id=$1 AND state IN ('staged','verified')",
       'ORDER BY updated_at DESC LIMIT 1'
      ].join(' '),[e.gatewayId]);
      previous=row.rows?.[0]||null;
      if(previous&&(String(previous.source_id)!==e.sourceId||
        previous.media_id!==e.mediaId||
        previous.extension!==e.extension||
        Number(previous.expected_bytes)!==e.expectedBytes))
       throw Error('season_existing_episode_scope_conflict');
     }
     // Adopt an exact already-verified or partial licensed pilot instead of
     // downloading identical media bytes into a second set of S3 objects.
     const runId=previous?.run_id||e.runId;
     const state=previous?.state==='verified'?'verified':'queued';
     const result=await client.query([
      'INSERT INTO blofy_content_hub_season_queue',
      '(run_id,season_key,episode_number,title,gateway_id,source_id,',
      'media_id,extension,expected_bytes,state) VALUES',
      '($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      'ON CONFLICT (season_key,episode_number) DO NOTHING',
      'RETURNING run_id'
     ].join(' '),[runId,e.seasonKey,e.episodeNumber,e.title,
      e.gatewayId,e.sourceId,e.mediaId,e.extension,e.expectedBytes,state]);
     added+=result.rowCount;
     if(result.rowCount&&previous)reused++;
    }
    await client.query('COMMIT');
    return {added,reusedExisting:reused,skipped:entries.length-added};
   }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}
   finally{client.release()}
  },
  async list({limit=100}={}){
   await ensure();
   const n=Math.max(1,Math.min(200,Number(limit)||100));
   const result=await pool.query([
    'SELECT q.*,COALESCE(r.bytes_copied,0) AS bytes_copied,',
    'r.state AS episode_state FROM blofy_content_hub_season_queue q',
    'LEFT JOIN blofy_content_hub_episode_runs r ON r.run_id=q.run_id',
    'ORDER BY q.created_at,q.episode_number LIMIT $1'
   ].join(' '),[n]).catch(async e=>{
    // The episode table is created lazily by the original pilot.
    if(e?.code!=='42P01')throw e;
    const q=await pool.query('SELECT * FROM blofy_content_hub_season_queue ORDER BY created_at,episode_number LIMIT $1',[n]);
    return {rows:q.rows.map(row=>({...row,bytes_copied:0,episode_state:null}))};
   });
   return (result.rows||[]).map(safeStatus);
  },
  async recoverInterrupted(){
   await ensure();
   // Call ONLY on an explicit operator start with a single queue replica.
   await pool.query([
    'UPDATE blofy_content_hub_season_queue SET state=$1,code=$2,',
    'updated_at=NOW() WHERE state=$3'
   ].join(' '),['queued','resuming_after_interruption','running']);
   await pool.query([
    'UPDATE blofy_content_hub_season_queue SET state=$1,code=NULL,',
    'updated_at=NOW() WHERE state=$2'
   ].join(' '),['queued','paused']);
  },
  async claimNext(){
   await ensure();
   const r=await pool.query([
    'WITH picked AS (SELECT run_id FROM blofy_content_hub_season_queue',
    "WHERE state='queued' ORDER BY created_at,episode_number",
    'FOR UPDATE SKIP LOCKED LIMIT 1)',
    'UPDATE blofy_content_hub_season_queue q SET',
    "state='running',updated_at=NOW() FROM picked",
    'WHERE q.run_id=picked.run_id RETURNING q.*'
   ].join(' '));
   const row=r.rows?.[0];
   return row?{runId:row.run_id,seasonKey:row.season_key,
    episodeNumber:row.episode_number,gatewayId:Number(row.gateway_id),
    expectedBytes:Number(row.expected_bytes),sourceId:row.source_id,
    mediaId:row.media_id,extension:row.extension,retries:Number(row.retries)}:null;
  },
  async update(runId,state,{code=null,retry=false}={}){
   if(!RUN.test(runId)||!MODES.has(state)||
      (code!==null&&!/^[a-z0-9_]{1,80}$/.test(code)))
    throw Error('season_queue_status_invalid');
   await ensure();
   const r=await pool.query([
    'UPDATE blofy_content_hub_season_queue SET state=$2,code=$3,',
    'retries=retries+CASE WHEN $4 THEN 1 ELSE 0 END,',
    "updated_at=NOW() WHERE run_id=$1 AND state='running'",
    'RETURNING run_id'
   ].join(' '),[runId,state,code,retry]);
   if(r.rowCount!==1)throw Error('season_queue_state_conflict');
  },
  async close(){await pool.end()}
 };
}
export function createSeasonQueueController({
 store,lease,storage,env=process.env,
 runner=runOneEpisodeChunk,logger=()=>{},isSourceBusy=()=>false,
 delayMs=2200,maxBatches=5000,maxDurationMs=45*60*1000,
 pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
}={}){
 if(!store||!lease||!storage)throw Error('season_queue_dependencies_missing');
 let active=null;
 let status={state:'idle',code:null,batches:0,currentRunId:null,
  customerCutover:false};
 const snapshot=()=>({...status,active:active!==null});
 const stop=()=>{
  if(!active)return {...snapshot(),ok:false,code:'season_queue_not_running'};
  active.abort();
  status={...status,state:'stopping',code:'season_queue_pause_requested'};
  return {...snapshot(),ok:true,code:'season_queue_pause_requested'};
 };
 const start=()=>{
  if(active)return {...snapshot(),ok:false,code:'season_queue_running'};
  const ready=seasonQueueReadiness(env);
  if(!ready.ready)return {...snapshot(),ok:false,
   code:'season_queue_safety_gates_off',blockedBy:ready.blockedBy};
  if(isSourceBusy())return {...snapshot(),ok:false,code:'source_writer_busy'};
  const abort=new AbortController();active=abort;
  status={state:'running',code:'season_queue_started',batches:0,
   currentRunId:null,customerCutover:false};
  const since=Date.now();
  void (async()=>{
   const workerLock=typeof store.acquireWorker==='function'?
    await store.acquireWorker():{release:async()=>{}};
   if(!workerLock){
    status={...status,state:'paused',
     code:'season_queue_other_worker_running'};
    return;
   }
   try{
   await store.recoverInterrupted();
   for(let n=0;n<maxBatches&&Date.now()-since<maxDurationMs;n++){
    if(abort.signal.aborted){status={...status,state:'paused',
     code:'season_queue_paused'};break}
    if(!seasonQueueReadiness(env).ready||isSourceBusy()){
     status={...status,state:'paused',code:'season_safety_gates_changed'};break;
    }
    const job=await store.claimNext();
    if(!job){status={...status,state:'completed',
      code:'season_queue_empty',currentRunId:null};break}
    status={...status,currentRunId:job.runId};
    const perEpisodeEnv={...env,
     BLOFY_CONTENT_HUB_EPISODE_APPROVED_GATEWAY_ID:String(job.gatewayId),
     BLOFY_CONTENT_HUB_EPISODE_EXPECTED_BYTES:String(job.expectedBytes),
     BLOFY_CONTENT_HUB_EPISODE_RUN_ID:job.runId};
    if(!episodeCopyReadiness(perEpisodeEnv).ready){
     await store.update(job.runId,'paused',{code:'episode_safety_gates_off'});
     status={...status,state:'paused',code:'episode_safety_gates_off'};break;
    }
    let result;
    try{
     result=await runner({env:perEpisodeEnv,storage,lease,
      signal:abort.signal,logger});
    }catch{result={ok:false,code:'episode_retryable_error'}}
    const code=safeCode(result?.code);
    if(abort.signal.aborted){
     await store.update(job.runId,'paused',{code:'season_queue_paused'});
     status={...status,state:'paused',code:'season_queue_paused'};break;
    }
    if(result?.ok===true&&(result.completed===true||
      code==='episode_already_verified')){
     await store.update(job.runId,'verified',{code});
    }else if(result?.ok===true&&code==='episode_checkpoint_saved'){
     await store.update(job.runId,'queued',{code:null});
    }else if(['episode_retryable_error','episode_source_busy'].includes(code)
      &&job.retries<2){
     await store.update(job.runId,'queued',{code,retry:true});
     await pause(3000*(job.retries+1));
    }else{
     await store.update(job.runId,'failed',{code});
     // A failed episode is not silently retried; continue to next
     // only after explicit operator review on a later session.
     status={...status,state:'paused',code:'season_job_failed'};break;
    }
    status={...status,batches:status.batches+1};
    if(delayMs)await pause(delayMs);
   }
   if(status.state==='running')status={...status,state:'paused',
    code:'season_session_limit',currentRunId:null};
   }finally{await workerLock.release()}
  })().catch(()=>{
   status={...status,state:'failed',code:'season_queue_controller_failed'};
  }).finally(()=>{
   if(active===abort)active=null;
   if(abort.signal.aborted&&status.state==='stopping')status={
    ...status,state:'paused',code:'season_queue_paused'};
   status={...status,currentRunId:null};
   logger('BLOFY_CONTENT_HUB_SEASON_QUEUE',snapshot());
  });
  return {...snapshot(),ok:true,code:'season_queue_started'};
 };
 return {start,stop,status:snapshot,isRunning:()=>active!==null};
}
