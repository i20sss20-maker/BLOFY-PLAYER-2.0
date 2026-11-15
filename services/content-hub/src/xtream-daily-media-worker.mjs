// An intentionally OFF-by-default daily session launcher for ALREADY
// approved private Content Hub movie/episode copy controllers.
//
// This does not discover new Xtream content, grant per-file storage rights,
// overwrite files, reroute subscribers, or record live television.
// The two existing chunk workers enforce source, S3, SHA and Range limits.
// The source remains pinned to the approved saleh bridge.
import pg from 'pg';
import {chunkedBatchReadiness} from './chunked-pilot.mjs';
import {seasonQueueReadiness} from './season-queue.mjs';

export function riyadhDailyMediaWindow(now=new Date(),env={}){
 if(env.BLOFY_CONTENT_HUB_DAILY_COPY_ENABLED!=='1')
  return {due:false,code:'daily_media_copy_disabled'};
 const mode=String(env.BLOFY_CONTENT_HUB_DAILY_COPY_MODE||'');
 if(!['movie','episodes'].includes(mode))
  return {due:false,code:'daily_media_copy_mode_invalid'};
 const date=new Date(now);
 if(!Number.isFinite(date.getTime()))
  return {due:false,code:'daily_media_copy_clock_invalid'};
 const local=Object.fromEntries(new Intl.DateTimeFormat('en-US',{
  timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',
  day:'2-digit',hour:'2-digit',hourCycle:'h23'
 }).formatToParts(date).map(x=>[x.type,x.value]));
 const localDay=[local.year,local.month,local.day].join('-');
 if(Number(local.hour)!==4)
  return {due:false,code:'daily_media_copy_outside_window',mode,localDay};
 return {due:true,code:'daily_media_copy_window',mode,localDay};
}

export function createDailyMediaSessionStore({
 connectionString,Pool=pg.Pool
}={}){
 if(!connectionString)throw Error('daily_media_copy_db_required');
 const pool=new Pool({connectionString,max:1,connectionTimeoutMillis:5000,
  idleTimeoutMillis:10000,application_name:'blofy-private-daily-media'});
 let ready=null;
 const ensure=()=>{
  if(!ready)ready=pool.query(`CREATE TABLE IF NOT EXISTS blofy_content_hub_daily_sessions (
    source_name TEXT NOT NULL CHECK (source_name='saleh'),
    local_day DATE NOT NULL,
    mode TEXT NOT NULL CHECK(mode IN ('movie','episodes')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    state TEXT NOT NULL DEFAULT 'started' CHECK(state IN ('started')),
    PRIMARY KEY(source_name,local_day)
  )`).catch(error=>{ready=null;throw error});
  return ready;
 };
 return {
  async claim(day,mode){
   if(!/^20[0-9]{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])$/.test(day)||
      !['movie','episodes'].includes(mode))
    throw Error('daily_media_copy_claim_invalid');
   await ensure();
   const r=await pool.query(`INSERT INTO blofy_content_hub_daily_sessions
    (source_name,local_day,mode) VALUES ('saleh',$1::date,$2)
    ON CONFLICT DO NOTHING RETURNING local_day`,[day,mode]);
   return r.rowCount===1;
  },
  async release(day,mode){
   await ensure();
   await pool.query(`DELETE FROM blofy_content_hub_daily_sessions
    WHERE source_name='saleh' AND local_day=$1::date AND mode=$2`,
    [day,mode]);
  },
  async recent(){
   await ensure();
   const r=await pool.query(`SELECT local_day,mode,started_at FROM
    blofy_content_hub_daily_sessions WHERE source_name='saleh'
    ORDER BY local_day DESC LIMIT 7`);
   return (r.rows||[]).map(row=>({
    day:row.local_day,mode:row.mode,startedAt:row.started_at
   }));
  },
  close:()=>pool.end()
 };
}

export async function startApprovedDailyMediaSession({
 now=new Date(),env={},store,movie,episodes,lease,seasonStore,
 sourceBusy=()=>false,storageReady=()=>false
}={}){
 const window=riyadhDailyMediaWindow(now,env);
 if(!window.due)return {ok:false,started:false,code:window.code,
  customerCutover:false,mediaFilesCopied:0};
 if(!store||typeof store.claim!=='function'||typeof store.release!=='function')
  return {ok:false,started:false,code:'daily_media_copy_store_missing'};
 if(storageReady()!==true)
  return {ok:false,started:false,code:'daily_media_storage_not_confirmed'};
 if(sourceBusy())
  return {ok:false,started:false,code:'daily_media_source_busy'};
 const {mode,localDay}=window;
 const ready=mode==='movie'?chunkedBatchReadiness(env):
  seasonQueueReadiness(env);
 if(!ready.ready)
  return {ok:false,started:false,code:'daily_media_copy_safety_gates_off',
    blockedBy:ready.blockedBy};
 const controller=mode==='movie'?movie:episodes;
 if(!controller||typeof controller.start!=='function'||
    typeof controller.isRunning!=='function')
  return {ok:false,started:false,code:'daily_media_copy_controller_missing'};
 if(controller.isRunning())
  return {ok:false,started:false,code:'daily_media_copy_already_running'};
 if(mode==='episodes'){
  // Identical preflight to the owner-only POST /internal/seasons/start.
  // Never bypass the independent manual visible-video and audible-audio
  // test of an already SHA-verified episode.
  let playbackConfirmed=false;
  try{
   const check=await lease?.getEpisodeBrowserPlaybackStatus?.(
    String(env.BLOFY_CONTENT_HUB_EPISODE_RUN_ID||''));
   playbackConfirmed=check?.confirmed===true;
  }catch{}
  if(!playbackConfirmed)
   return {ok:false,started:false,code:'daily_media_owner_av_proof_required'};
  if(typeof seasonStore?.unresolvedAuditCounts!=='function')
   return {ok:false,started:false,code:'daily_media_audit_unavailable'};
  try{
   const count=await seasonStore.unresolvedAuditCounts();
   if(Number(count?.mismatch)>0||Number(count?.unavailable)>0)
    return {ok:false,started:false,code:'daily_media_storage_integrity_review'};
  }catch{return {ok:false,started:false,code:'daily_media_audit_unavailable'}}
 }
 if(!await store.claim(localDay,mode))
  return {ok:false,started:false,code:'daily_media_already_started_today'};
 try{
  // One movie = the fixed, pre-approved bridge movie. Episodes = already
  // manually selected and separately licensed rows in the durable queue.
  // No full-catalog unattended downloads are authorized by this scheduler.
  const result=mode==='movie'?controller.start():
   controller.start({sessionMaxBatches:60});
  if(!result?.ok){
   await store.release(localDay,mode);
   return {ok:false,started:false,code:String(result?.code||'daily_media_start_refused'),
    blockedBy:result?.blockedBy||[]};
  }
  return {ok:true,started:true,mode,localDay,code:'daily_media_private_session_started',
    privateOnly:true,customerCutover:false,
    // Actual async worker success must be read from its own status/proofs.
    verifiedCopiesNotYetProven:true,mediaFilesCopied:0};
 }catch{
  await store.release(localDay,mode).catch(()=>{});
  return {ok:false,started:false,code:'daily_media_controller_start_failed'};
 }
}
