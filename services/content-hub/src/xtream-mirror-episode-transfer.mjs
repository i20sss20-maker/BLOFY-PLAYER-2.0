// Private, default-OFF episode mirror dispatcher. Uses the EXISTING
// 8MiB S3/SHA episode worker, not an independent downloader. A source-scoped
// PG claim and shared movie+episode daily budget prevent duplicate copying.
import pg from 'pg';
import {randomBytes} from 'node:crypto';
import {episodeCopyReadiness,runOneEpisodeChunk} from './episode-chunk-pilot.mjs';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const RUN=/^mirror_[a-f0-9]{40}$/;
const PART=8*1024*1024,MAX_DAILY=512*1024**2;
const CODE=/^[a-z0-9_]{1,80}$/;
const DAY=/^20[0-9]{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])$/;

function riyadhDay(now){
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{
  timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit',
  hour:'2-digit',hourCycle:'h23'
 }).formatToParts(new Date(now)).map(x=>[x.type,x.value]));
 return {day:[p.year,p.month,p.day].join('-'),hour:Number(p.hour)};
}
export function mirrorEpisodeDispatchReadiness(env={},now=new Date()){
 const denied=[];
 const flags=[
  ['BLOFY_CONTENT_HUB_MIRROR_EPISODE_DISPATCH_ENABLED','episode_dispatch_disabled'],
  ['BLOFY_CONTENT_HUB_MIRROR_INDIVIDUAL_RIGHTS_AUDITED','individual_rights_not_audited'],
  ['BLOFY_CONTENT_HUB_MIRROR_EPISODE_AV_SAMPLE_CONFIRMED','episode_av_sample_not_confirmed'],
  ['BLOFY_CONTENT_HUB_EPISODE_COPY_ENABLED','episode_copy_disabled'],
  ['BLOFY_CONTENT_HUB_UPLOAD_ENABLED','storage_upload_disabled'],
  ['BLOFY_CONTENT_HUB_STORAGE_RIGHTS_CONFIRMED','storage_rights_unconfirmed'],
  ['BLOFY_CONTENT_HUB_EPISODE_RIGHTS_CONFIRMED','episode_rights_unconfirmed'],
  ['BLOFY_CONTENT_HUB_SOURCE_IDLE_CONFIRMED','source_idle_unconfirmed'],
  ['BLOFY_CONTENT_HUB_SOURCE_QUIET_WINDOW_CONFIRMED','source_quiet_window_unconfirmed']
 ];
 for(const [flag,code] of flags)if(env[flag]!=='1')denied.push(code);
 if(!UUID.test(String(env.BLOFY_XTREAM_DAILY_CATALOG_SOURCE_ID||'')))
  denied.push('source_not_pinned');
 if(String(env.BLOFY_CONTENT_HUB_BRIDGE_TOKEN||'').length<32)
  denied.push('bridge_token_missing');
 const budget=Number(env.BLOFY_CONTENT_HUB_MIRROR_DAILY_BYTES_LIMIT||67108864);
 if(!Number.isSafeInteger(budget)||budget<PART||
    budget>MAX_DAILY||budget%PART!==0)
  denied.push('daily_budget_invalid');
 const date=new Date(now);
 if(!Number.isFinite(date.getTime()))denied.push('clock_invalid');
 else if(![4,5].includes(riyadhDay(date).hour))
  denied.push('outside_riyadh_quiet_hours');
 return {ready:denied.length===0,blockedBy:denied,
  dailyBytesLimit:budget,privateOnly:true,customerCutover:false};
}

export function createMirrorEpisodeTransferStore({connectionString,Pool=pg.Pool}={}){
 if(!connectionString)throw Error('mirror_episode_db_missing');
 const pool=new Pool({connectionString,max:2,connectionTimeoutMillis:5000,
  idleTimeoutMillis:10000,application_name:'blofy-licensed-mirror-episode'});
 let init=null;
 const ensure=()=>{
  if(!init)init=(async()=>{
  await pool.query(`CREATE TABLE IF NOT EXISTS
  blofy_content_hub_mirror_daily_budget (
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
 async function claim({sourceId,day,limit}={}){
  if(!UUID.test(String(sourceId||''))||!DAY.test(String(day||''))||
     !Number.isSafeInteger(limit)||limit<PART||
     limit>MAX_DAILY||limit%PART!==0)
   throw Error('mirror_episode_claim_invalid');
  await ensure();
  const client=await pool.connect();let inTx=false;
  try{
   await client.query('BEGIN');inTx=true;
   await client.query(`INSERT INTO blofy_content_hub_mirror_daily_budget
     (source_id,local_day) VALUES ($1,$2::date)
     ON CONFLICT DO NOTHING`,[sourceId,day]);
   const balance=await client.query(`SELECT reserved_bytes
     FROM blofy_content_hub_mirror_daily_budget
     WHERE source_id=$1 AND local_day=$2::date FOR UPDATE`,
    [sourceId,day]);
   const used=Number(balance.rows?.[0]?.reserved_bytes);
   if(!Number.isSafeInteger(used)||used<0||used+PART>limit){
    await client.query('COMMIT');inTx=false;
    return {ok:false,code:'mirror_episode_daily_budget_exhausted'};
   }
   const created='mirror_'+randomBytes(20).toString('hex');
   const r=await client.query(`WITH picked AS (
     SELECT q.source_id,q.media_kind,q.gateway_id
     FROM blofy_xtream_mirror_items q
     JOIN blofy_xtream_servers s ON s.id=q.source_id
     JOIN blofy_xtream_gateway_episode_map e
      ON e.server_id=q.source_id AND e.gateway_id=q.gateway_id
       AND e.source_episode_id=q.media_id
     JOIN blofy_xtream_items i ON i.server_id=e.server_id
       AND i.media_type='series' AND i.source_id=e.series_source_id
     WHERE q.source_id=$1 AND q.media_kind='episode'
       AND (q.state='approved' OR
        (q.state='copying' AND q.copy_lease_until<NOW()))
       AND q.mapping_conflict=FALSE
       AND q.license_reviewed_at IS NOT NULL
       AND q.rights_ref_sha256 ~ '^[a-f0-9]{64}$'
       AND q.size_probe_at>NOW()-INTERVAL '48 hours'
       AND q.expected_bytes BETWEEN 8388608 AND 4294967296
       AND (q.copy_run_id IS NULL OR
        q.copy_run_id ~ '^mirror_[a-f0-9]{40}$')
       AND COALESCE(q.copy_retry_count,0)<3
       AND (q.copy_retry_after IS NULL OR q.copy_retry_after<=NOW())
       AND s.enabled=TRUE AND s.publish_catalog=TRUE
       AND s.deletion_requested_at IS NULL AND s.status='online'
       AND s.last_error IS NULL AND lower(btrim(s.name))='saleh'
       AND s.last_sync_at>NOW()-INTERVAL '48 hours'
       AND i.enabled=TRUE AND lower(e.container_extension)=q.extension
     ORDER BY (COALESCE(q.copied_parts,0)>0) DESC,
       q.gateway_id ASC
     LIMIT 1 FOR UPDATE OF q SKIP LOCKED
   ) UPDATE blofy_xtream_mirror_items q
     SET state='copying',copy_run_id=COALESCE(q.copy_run_id,$2),
       copy_lease_until=NOW()+INTERVAL '30 minutes',copy_error=NULL
     FROM picked p
     WHERE q.source_id=p.source_id AND q.media_kind=p.media_kind
       AND q.gateway_id=p.gateway_id
     RETURNING q.source_id,q.gateway_id,q.media_id,q.extension,
       q.expected_bytes,q.copy_run_id,q.copied_parts`,
    [sourceId,created]);
   const row=r.rows?.[0];
   if(!row){
    await client.query('COMMIT');inTx=false;
    return {ok:false,code:'mirror_episode_no_approved_item'};
   }
   const gatewayId=Number(row.gateway_id),
    expectedBytes=Number(row.expected_bytes);
   if(!Number.isSafeInteger(gatewayId)||gatewayId<1||
      !Number.isSafeInteger(expectedBytes)||expectedBytes<PART||
      expectedBytes>4*1024**3||!RUN.test(String(row.copy_run_id)))
    throw Error('mirror_episode_claim_data_invalid');
   await client.query(`UPDATE blofy_content_hub_mirror_daily_budget
     SET reserved_bytes=reserved_bytes+$3,
      reserved_batches=reserved_batches+1
     WHERE source_id=$1 AND local_day=$2::date`,
    [sourceId,day,PART]);
   await client.query('COMMIT');inTx=false;
   return {ok:true,code:'mirror_episode_8m_chunk_reserved',
    sourceId,gatewayId,mediaId:String(row.media_id),
    extension:String(row.extension),expectedBytes,
    runId:String(row.copy_run_id),
    previousParts:Number(row.copied_parts)||0};
  }catch(e){
   if(inTx)await client.query('ROLLBACK').catch(()=>{});
   throw e;
  }finally{client.release()}
 }
 async function finish(job,{state,parts=0,sha256=null,code=null}={}){
  if(!UUID.test(job?.sourceId)||!RUN.test(job?.runId)||
     !Number.isSafeInteger(job.gatewayId)||job.gatewayId<1||
     !['approved','verified','failed','retry'].includes(state)||
     !Number.isSafeInteger(parts)||parts<0||parts>512||
     (state==='verified'&&!/^[a-f0-9]{64}$/.test(String(sha256)))||
     (['failed','retry'].includes(state)&&!CODE.test(String(code||''))))
   throw Error('mirror_episode_finish_invalid');
  const r=await pool.query(`UPDATE blofy_xtream_mirror_items
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
    WHERE source_id=$1 AND media_kind='episode' AND gateway_id=$2
      AND copy_run_id=$3 AND state='copying'
      AND copy_lease_until>NOW() AND mapping_conflict=FALSE
    RETURNING gateway_id,state,copy_retry_count,copy_retry_after`,
     [job.sourceId,job.gatewayId,job.runId,
      state,parts,sha256,code]);
  return {ok:r.rowCount===1,
   state:r.rows?.[0]?.state||state,
   retryAttempts:Number(r.rows?.[0]?.copy_retry_count)||0,
   retryAfter:r.rows?.[0]?.copy_retry_after||null,
   code:r.rowCount===1?'mirror_episode_checkpoint_committed':
    'mirror_episode_lease_or_mapping_changed'};
 }
 async function status(sourceId){
  if(!UUID.test(String(sourceId||'')))throw Error('mirror_episode_source_invalid');
  await ensure();
  const r=await pool.query(`SELECT local_day,reserved_bytes,reserved_batches
    FROM blofy_content_hub_mirror_daily_budget WHERE source_id=$1
    ORDER BY local_day DESC LIMIT 7`,[sourceId]);
  return {ok:true,sourceId,dailyBudgets:(r.rows||[]).map(x=>({
   day:x.local_day,reservedBytes:Number(x.reserved_bytes)||0,
   reservedChunks:Number(x.reserved_batches)||0
  })),readOnly:true,customerCutover:false};
 }
 return {claim,finish,status,close:()=>pool.end()};
}

export async function runOneApprovedMirrorEpisodeChunk({
 env={},now=new Date(),store,storage,lease,runner=runOneEpisodeChunk,
 sourceBusy=()=>false,logger=()=>{}
}={}){
 const guard=mirrorEpisodeDispatchReadiness(env,now);
 if(!guard.ready)return {ok:false,code:'mirror_episode_safety_gates_off',
  blockedBy:guard.blockedBy,customerCutover:false};
 if(!store?.claim||!store?.finish||!storage?.health||!lease?.acquire)
  return {ok:false,code:'mirror_episode_worker_dependencies_missing'};
 if(sourceBusy())return {ok:false,code:'mirror_episode_source_busy'};
 const ok=await storage.health().catch(()=>({ok:false}));
 if(ok?.ok!==true)return {ok:false,code:'mirror_episode_private_storage_unavailable'};
 const job=await store.claim({
  sourceId:String(env.BLOFY_XTREAM_DAILY_CATALOG_SOURCE_ID),
  day:riyadhDay(now).day,limit:guard.dailyBytesLimit
 });
 if(!job?.ok)return {ok:false,code:job?.code||'mirror_episode_claim_failed'};
 const jobEnv={...env,BLOFY_CONTENT_HUB_MIRROR_DYNAMIC_EPISODE_ENABLED:'1',
  BLOFY_CONTENT_HUB_EPISODE_APPROVED_GATEWAY_ID:String(job.gatewayId),
  BLOFY_CONTENT_HUB_EPISODE_EXPECTED_BYTES:String(job.expectedBytes),
  BLOFY_CONTENT_HUB_EPISODE_RUN_ID:job.runId
 };
 if(!episodeCopyReadiness(jobEnv).ready){
  await store.finish(job,{state:'failed',
   code:'mirror_episode_copy_safety_changed'});
  return {ok:false,code:'mirror_episode_copy_safety_changed'};
 }
 const candidate={sourceName:'saleh',mediaKind:'episode',
  sourceId:job.sourceId,mediaId:job.mediaId,gatewayId:job.gatewayId,
  extension:job.extension,title:'Private approved episode'};
 let outcome;
 try{
  outcome=await runner({env:jobEnv,storage,lease,logger,
   candidateInspector:async()=>({ok:true,candidates:[candidate]})});
 }catch{outcome={ok:false,code:'mirror_episode_runner_error'}}
 let state='failed',sha256=null,
     parts=Number(outcome?.chunksSaved??outcome?.checkpointsRetained)||0;
 if(outcome?.ok&&outcome.code==='episode_checkpoint_saved')
  state='approved';
 else if(outcome?.ok&&
   ['episode_fully_verified','episode_already_verified'].includes(outcome.code)){
  // Do not trust a claimed response; the private PG/S3 manifest must
  // contain exact file length plus SHA after independent chunk checks.
  const verified=await lease.getVerifiedEpisodeObject?.(job.runId)
   .catch(()=>null);
  if(verified?.bytes===job.expectedBytes&&
    /^[a-f0-9]{64}$/.test(String(verified.sha256||''))){
   state='verified';sha256=verified.sha256;
   parts=verified.parts.length;
  }
 }
 // Only recoverable, source-busy / transient network / S3 errors get
 // automatic bounded retry. A changed file, rights or gateway mapping
 // stays held for independent operator review.
 const transientCodes=new Set([
  'episode_retryable_error','episode_source_busy','episode_cancelled',
  'mirror_episode_runner_error'
 ]);
 if(outcome?.ok===false&&transientCodes.has(outcome.code))state='retry';
 const rawCode=String(outcome?.code||'');
 const code=CODE.test(rawCode)?rawCode:'mirror_episode_unverified';
 const saved=await store.finish(job,{state,parts,sha256,
  code:['failed','retry'].includes(state)?code:null});
 return {ok:saved.ok&&(state==='approved'||state==='verified'),
  code:!saved.ok?'mirror_episode_lease_or_mapping_changed':
    state==='verified'?'mirror_episode_private_sha_verified':
    state==='approved'?'mirror_episode_chunk_checkpoint_saved':
    state==='retry'&&saved.state==='approved'?
      'mirror_episode_retry_scheduled':
    state==='retry'?'mirror_episode_retry_limit_review':
    'mirror_episode_transfer_requires_review',
  nextRetryAt:saved.retryAfter||null,retryAttempts:saved.retryAttempts||0,
  sourceId:job.sourceId,gatewayId:job.gatewayId,
  verified:state==='verified'&&saved.ok,partsSaved:parts,
  bytesReserved:PART,subscriberRoutesChanged:false,customerCutover:false};
}
