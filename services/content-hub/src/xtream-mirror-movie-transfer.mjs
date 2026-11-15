// OFF by default. Move one EXACT reviewed/probed saleh movie through the
// existing private 8MiB/SHA-256 chunk worker, then checkpoint in PostgreSQL.
// No Xtream catalog write, public video route, live recording or customer
// playback change. No general-media copy rights are inferred.
import pg from 'pg';
import {randomBytes} from 'node:crypto';
import {runChunkedMovieBatch,chunkedBatchReadiness} from './chunked-pilot.mjs';
function riyadhMirrorDay(now=new Date()){
 const d=new Date(now);
 if(!Number.isFinite(d.getTime()))throw Error('mirror_clock_invalid');
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{
  timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'
 }).formatToParts(d).map(x=>[x.type,x.value]));
 return [p.year,p.month,p.day].join('-');
}

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const RUN=/^mirror_[a-f0-9]{40}$/;
const PART=8*1024*1024, MAX_FILE=4*1024**3;
const MAX_DAILY=512*1024**2;
const SAFE_CODE=/^[a-z0-9_]{1,80}$/;

export function mirrorMovieDispatchReadiness(env={},now=new Date()){
 const blockedBy=[];
 const required=[
  ['BLOFY_CONTENT_HUB_MIRROR_MOVIE_DISPATCH_ENABLED','mirror_dispatch_disabled'],
  ['BLOFY_CONTENT_HUB_MIRROR_INDIVIDUAL_RIGHTS_AUDITED','mirror_rights_not_audited'],
  ['BLOFY_CONTENT_HUB_UPLOAD_ENABLED','storage_upload_disabled'],
  ['BLOFY_CONTENT_HUB_STORAGE_RIGHTS_CONFIRMED','storage_rights_unconfirmed'],
  ['BLOFY_CONTENT_HUB_CHUNKED_ENABLED','chunk_worker_disabled'],
  ['BLOFY_CONTENT_HUB_SOURCE_IDLE_CONFIRMED','source_idle_unconfirmed'],
  ['BLOFY_CONTENT_HUB_SOURCE_QUIET_WINDOW_CONFIRMED','source_quiet_unconfirmed']
 ];
 for(const [name,code] of required)if(env[name]!=='1')blockedBy.push(code);
 if(!UUID.test(String(env.BLOFY_XTREAM_DAILY_CATALOG_SOURCE_ID||'')))
  blockedBy.push('mirror_exact_source_missing');
 if(String(env.BLOFY_CONTENT_HUB_BRIDGE_TOKEN||'').length<32)
  blockedBy.push('mirror_source_bridge_token_missing');
 const bytes=Number(env.BLOFY_CONTENT_HUB_MIRROR_DAILY_BYTES_LIMIT||64*1024**2);
 if(!Number.isSafeInteger(bytes)||bytes<PART||bytes>MAX_DAILY||
    bytes%PART!==0)blockedBy.push('mirror_daily_budget_invalid');
 const date=new Date(now);
 if(!Number.isFinite(date.getTime()))blockedBy.push('mirror_clock_invalid');
 else{
  const hourParts=new Intl.DateTimeFormat('en-US',{
   timeZone:'Asia/Riyadh',hour:'2-digit',hourCycle:'h23'
  }).formatToParts(date);
  const hour=Number(hourParts.find(x=>x.type==='hour')?.value);
  if(![4,5].includes(hour))blockedBy.push('mirror_outside_quiet_window');
 }
 return {ready:blockedBy.length===0,blockedBy,privateOnly:true,
  dailyBytesLimit:bytes,customerCutover:false};
}

export function createMirrorMovieTransferStore({connectionString,Pool=pg.Pool}={}){
 if(!connectionString)throw Error('mirror_movie_db_missing');
 const pool=new Pool({connectionString,max:2,
  connectionTimeoutMillis:5000,idleTimeoutMillis:10000,
  application_name:'blofy-licensed-mirror-movie'});
 let init=null;
 const ensure=()=>{
  if(!init)init=(async()=>{
  await pool.query(`CREATE TABLE IF NOT EXISTS blofy_content_hub_mirror_daily_budget (
   source_id UUID NOT NULL,local_day DATE NOT NULL,
   reserved_bytes BIGINT NOT NULL DEFAULT 0,
   reserved_batches INTEGER NOT NULL DEFAULT 0,
   PRIMARY KEY(source_id,local_day)
  )`);
  // Activation may not yet have initialized the latest queue schema:
  // add the recovery columns before claiming any provider connection.
  // If databases differ or the queue itself is absent, fail CLOSED.
  await pool.query(`ALTER TABLE blofy_xtream_mirror_items
   ADD COLUMN IF NOT EXISTS copy_retry_count INTEGER NOT NULL DEFAULT 0,
   ADD COLUMN IF NOT EXISTS copy_retry_after TIMESTAMPTZ`);
 })().catch(e=>{init=null;throw e});
  return init;
 };
 async function claim({sourceId,localDay,dailyBytesLimit}={}){
  if(!UUID.test(sourceId)||
     !/^20[0-9]{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])$/.test(String(localDay))||
     !Number.isSafeInteger(dailyBytesLimit)||
     dailyBytesLimit<PART||dailyBytesLimit>MAX_DAILY||
     dailyBytesLimit%PART!==0)
   throw Error('mirror_movie_claim_invalid');
  await ensure();
  const client=await pool.connect();let tx=false;
  try{
   await client.query('BEGIN');tx=true;
   // One global source-day budget row serializes all Railway replicas.
   await client.query(`INSERT INTO blofy_content_hub_mirror_daily_budget
    (source_id,local_day) VALUES ($1,$2::date)
    ON CONFLICT DO NOTHING`,[sourceId,localDay]);
   const budget=await client.query(`SELECT reserved_bytes
    FROM blofy_content_hub_mirror_daily_budget
    WHERE source_id=$1 AND local_day=$2::date FOR UPDATE`,
    [sourceId,localDay]);
   const consumed=Number(budget.rows?.[0]?.reserved_bytes);
   if(!Number.isSafeInteger(consumed)||consumed<0||
      consumed+PART>dailyBytesLimit){
    await client.query('COMMIT');tx=false;
    return {ok:false,code:'mirror_movie_daily_budget_exhausted'};
   }
   const randomRun='mirror_'+randomBytes(20).toString('hex');
   const claimed=await client.query(`WITH picked AS (
    SELECT q.source_id,q.media_kind,q.gateway_id
      FROM blofy_xtream_mirror_items q
      JOIN blofy_xtream_servers s ON s.id=q.source_id
      JOIN blofy_xtream_gateway_item_map m
        ON m.server_id=q.source_id AND m.media_type='movie'
        AND m.gateway_id=q.gateway_id AND m.source_id=q.media_id
      JOIN blofy_xtream_items i ON i.server_id=m.server_id
        AND i.media_type=m.media_type AND i.source_id=m.source_id
    WHERE q.source_id=$1 AND q.media_kind='movie'
      AND ((q.state='approved') OR
       (q.state='copying' AND q.copy_lease_until<NOW()))
      AND q.mapping_conflict=FALSE
      AND q.license_reviewed_at IS NOT NULL
      AND q.rights_ref_sha256 ~ '^[a-f0-9]{64}$'
      AND q.size_probe_at>NOW()-INTERVAL '48 hours'
      AND q.expected_bytes BETWEEN 8388608 AND 4294967296
      AND (q.copy_run_id IS NULL OR q.copy_run_id ~ '^mirror_[a-f0-9]{40}$')
      AND COALESCE(q.copy_retry_count,0)<3
      AND (q.copy_retry_after IS NULL OR q.copy_retry_after<=NOW())
      AND s.enabled=TRUE AND s.publish_catalog=TRUE
      AND s.deletion_requested_at IS NULL AND s.status='online'
      AND s.last_error IS NULL AND lower(btrim(s.name))='saleh'
      AND s.last_sync_at>NOW()-INTERVAL '48 hours'
      AND i.enabled=TRUE AND lower(i.container_extension)=q.extension
    ORDER BY (COALESCE(q.copied_parts,0)>0) DESC,
      q.gateway_id ASC
    LIMIT 1 FOR UPDATE OF q SKIP LOCKED
   ) UPDATE blofy_xtream_mirror_items q
     SET state='copying',copy_run_id=COALESCE(q.copy_run_id,$2),
       copy_lease_until=NOW()+INTERVAL '10 minutes',
       copy_error=NULL
     FROM picked p
     WHERE q.source_id=p.source_id AND q.media_kind=p.media_kind
       AND q.gateway_id=p.gateway_id
     RETURNING q.source_id,q.gateway_id,q.media_id,q.extension,
       q.expected_bytes,q.copy_run_id,q.copied_parts`,
    [sourceId,randomRun]);
   const row=claimed.rows?.[0];
   if(!row){
    await client.query('COMMIT');tx=false;
    return {ok:false,code:'mirror_movie_no_approved_item'};
   }
   const expectedBytes=Number(row.expected_bytes),gatewayId=Number(row.gateway_id);
   if(!Number.isSafeInteger(expectedBytes)||expectedBytes<PART||
      expectedBytes>MAX_FILE||!Number.isSafeInteger(gatewayId)||gatewayId<1||
      !RUN.test(String(row.copy_run_id)))throw Error('mirror_movie_claim_corrupt');
   await client.query(`UPDATE blofy_content_hub_mirror_daily_budget
     SET reserved_bytes=reserved_bytes+$3,
       reserved_batches=reserved_batches+1
     WHERE source_id=$1 AND local_day=$2::date`,
    [sourceId,localDay,PART]);
   await client.query('COMMIT');tx=false;
   return {ok:true,code:'mirror_movie_chunk_reserved',
    sourceId,gatewayId,mediaId:String(row.media_id),
    extension:String(row.extension),expectedBytes,
    runId:String(row.copy_run_id),
    previousParts:Number(row.copied_parts)||0};
  }catch(e){
   if(tx)await client.query('ROLLBACK').catch(()=>{});
   throw e;
  }finally{client.release()}
 }
 async function finish(job,{status,parts=0,sha256=null,code=null}={}){
  if(!UUID.test(job?.sourceId)||!RUN.test(job?.runId)||
     !Number.isSafeInteger(job.gatewayId)||job.gatewayId<1||
     !['approved','verified','failed','retry'].includes(status)||
     !Number.isSafeInteger(parts)||parts<0||parts>512||
     (status==='verified'&&!/^[a-f0-9]{64}$/.test(String(sha256)))||
     ['failed','retry'].includes(status)&&
       !SAFE_CODE.test(String(code||'')))
   throw Error('mirror_movie_finish_invalid');
  const query=`UPDATE blofy_xtream_mirror_items
    SET state=CASE WHEN $4='retry' AND copy_retry_count<2
         THEN 'approved' WHEN $4='retry' THEN 'failed' ELSE $4 END,
      copy_lease_until=NULL,
      copied_parts=GREATEST(copied_parts,$5),
      copy_retry_count=CASE WHEN $4='retry' THEN
        LEAST(copy_retry_count+1,3)
        WHEN $4 IN ('approved','verified') THEN 0
        ELSE copy_retry_count END,
      copy_retry_after=CASE WHEN $4='retry' AND
        copy_retry_count<2 THEN NOW()+INTERVAL '15 minutes'
        ELSE NULL END,
      copy_sha256=CASE WHEN $4='verified' THEN $6
        ELSE copy_sha256 END,
      copy_completed_at=CASE WHEN $4='verified' THEN NOW()
        ELSE copy_completed_at END,
      copy_error=CASE WHEN $4 IN ('failed','retry') THEN $7 ELSE NULL END
    WHERE source_id=$1 AND media_kind='movie' AND gateway_id=$2
      AND copy_run_id=$3 AND state='copying'
      AND copy_lease_until>NOW()
      AND mapping_conflict=FALSE
    RETURNING gateway_id,state,copy_retry_count,copy_retry_after`;
  const r=await pool.query(query,[job.sourceId,job.gatewayId,job.runId,
    status,parts,sha256,code]);
  return {ok:r.rowCount===1,
   state:r.rows?.[0]?.state||status,
   retryAttempts:Number(r.rows?.[0]?.copy_retry_count)||0,
   retryAfter:r.rows?.[0]?.copy_retry_after||null,
   code:r.rowCount===1?'mirror_movie_checkpoint_committed':
    'mirror_movie_lease_or_mapping_changed',
   customerCutover:false};
 }
 async function status(sourceId){
  if(!UUID.test(String(sourceId||'')))throw Error('mirror_movie_source_invalid');
  await ensure();
  const r=await pool.query(`SELECT local_day,reserved_bytes,reserved_batches
    FROM blofy_content_hub_mirror_daily_budget WHERE source_id=$1
    ORDER BY local_day DESC LIMIT 7`,[sourceId]);
  return {ok:true,sourceId,dailyBudgets:(r.rows||[]).map(x=>({
   day:x.local_day,bytesReserved:Number(x.reserved_bytes)||0,
   chunkAttemptsReserved:Number(x.reserved_batches)||0
  })),readOnly:true,customerCutover:false};
 }
 return {claim,finish,status,close:()=>pool.end()};
}

export async function runOneApprovedMirrorMovieChunk({
 env={},now=new Date(),store,storage,lease,
 runner=runChunkedMovieBatch,
 sourceBusy=()=>false,logger=()=>{}
}={}){
 const gate=mirrorMovieDispatchReadiness(env,now);
 if(!gate.ready)return {ok:false,code:'mirror_movie_safety_gates_off',
  blockedBy:gate.blockedBy,customerCutover:false};
 if(!store?.claim||!store?.finish||!storage?.health||!lease?.acquire)
  return {ok:false,code:'mirror_movie_worker_dependencies_missing'};
 if(sourceBusy())return {ok:false,code:'mirror_movie_source_busy'};
 const health=await storage.health().catch(()=>({ok:false}));
 if(health?.ok!==true)return {ok:false,code:'mirror_movie_private_storage_unavailable'};
 const sourceId=String(env.BLOFY_XTREAM_DAILY_CATALOG_SOURCE_ID);
 const job=await store.claim({sourceId,localDay:riyadhMirrorDay(now),
  dailyBytesLimit:gate.dailyBytesLimit});
 if(!job?.ok)return {ok:false,code:job?.code||'mirror_movie_claim_failed'};
 const jobEnv={...env,
  BLOFY_CONTENT_HUB_MIRROR_DYNAMIC_MOVIE_ENABLED:'1',
  BLOFY_CONTENT_HUB_APPROVED_GATEWAY_ID:String(job.gatewayId),
  BLOFY_CONTENT_HUB_EXPECTED_BYTES:String(job.expectedBytes),
  BLOFY_CONTENT_HUB_BATCH_RUN_ID:job.runId,
  BLOFY_CONTENT_HUB_CHUNKS_PER_BATCH:'1'
 };
 const batchGate=chunkedBatchReadiness(jobEnv);
 if(!batchGate.ready){
  await store.finish(job,{status:'failed',code:'mirror_movie_batch_safety_changed'});
  return {ok:false,code:'mirror_movie_batch_safety_changed'};
 }
 let result;
 try{result=await runner({env:jobEnv,storage,lease,logger})}
 catch{result={ok:false,code:'mirror_movie_worker_failed'}}
 let state='failed',sha=null;
 let parts=Number(result?.chunksSaved??result?.checkpointsRetained)||0;
 if(result?.ok===true&&result.code==='batch_checkpoint_saved'){
  state='approved';
 }else if(result?.ok===true&&
  ['batch_movie_fully_verified','batch_already_verified'].includes(result.code)){
  // A worker response alone is NOT proof. Confirm the trusted private
  // manifest has a full file digest and exact verified byte count.
  const verified=await lease.getVerifiedChunkedObject?.(job.runId).catch(()=>null);
  if(verified?.bytes===job.expectedBytes&&
     /^[a-f0-9]{64}$/.test(String(verified.sha256||''))){
   state='verified';sha=verified.sha256;
   parts=verified.parts.length;
  }
 }
 // A short network/S3 outage must NOT poison a successfully SHA-checked
 // partial copy. Retry at most 3 times per stalled item, 15min apart;
 // never blindly retry an origin-version, mapping or rights change.
 const transientCodes=new Set([
  'batch_retryable_error','batch_source_busy','batch_cancelled',
  'mirror_movie_worker_failed'
 ]);
 if(result?.ok===false&&transientCodes.has(result?.code))state='retry';
 const safeCode=SAFE_CODE.test(String(result?.code||''))?
  result.code:'mirror_movie_chunk_unverified';
 const saved=await store.finish(job,{status:state,parts,sha256:sha,
  code:state==='failed'?safeCode:null});
 return {ok:saved.ok&&(state==='approved'||state==='verified'),
  code:!saved.ok?'mirror_movie_lease_or_mapping_changed':
    state==='verified'?'mirror_movie_private_sha_verified':
    state==='approved'?'mirror_movie_chunk_checkpoint_saved':
    state==='retry'&&saved.state==='approved'?
      'mirror_movie_retry_scheduled':
    state==='retry'?'mirror_movie_retry_limit_review':
    'mirror_movie_worker_requires_review',
  nextRetryAt:saved.retryAfter||null,retryAttempts:saved.retryAttempts||0,
  gatewayId:job.gatewayId,sourceId:job.sourceId,
  partsSaved:parts,verified:state==='verified'&&saved.ok,
  mediaCopiedInThisAttempt:result?.code==='batch_checkpoint_saved'||
   result?.code==='batch_movie_fully_verified',
  customerCutover:false,subscriberRoutesChanged:false,
  dailyBudgetBytesReserved:PART};
}
