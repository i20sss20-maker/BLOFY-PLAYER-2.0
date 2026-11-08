// Verified upstream-404 registry. No media, credentials, provider URLs or customer data.
// Do not hide content or grant cross-source playback rights.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID=/^[A-Za-z0-9_-]{1,128}$/;
export const DEFAULT_RECHECK_BATCH=3;
export function validUnavailableKey({serverId,kind,itemId,seriesId=''}={}){
 const sid=String(serverId||'').toLowerCase(),item=String(itemId??''),series=String(seriesId??'');
 return UUID.test(sid)&&['movie','series'].includes(kind)&&ID.test(item)&&
  (kind==='movie'?series==='':ID.test(series))
   ?{serverId:sid,kind,itemId:item,seriesId:series}:null;
}
export function recoverySources(env=process.env){
 if(env.BLOFY_XTREAM_UNAVAILABLE_TRACKING_ENABLED!=='1')return new Set();
 return new Set(String(env.BLOFY_XTREAM_UNAVAILABLE_SOURCE_IDS||'')
  .split(',').map(x=>x.trim().toLowerCase()).filter(x=>UUID.test(x)));
}
export function recoveryEnabled(env=process.env){
 return env.BLOFY_XTREAM_UNAVAILABLE_RECHECK_ENABLED==='1'&&recoverySources(env).size>0;
}
export function nextRecheckHours(attempts=0){
 const n=Number.isSafeInteger(attempts)?Math.max(0,Math.min(6,attempts)):0;
 return Math.min(48,6*(2**n));
}
export function createRegistryWriteGuard({cooldownMs=900000,max=3000}={}){
 const seen=new Map();
 return function canWrite(key,now=Date.now()){
  if(typeof key!=='string'||!key||!Number.isFinite(now))return false;
  if((seen.get(key)||0)>now)return false;
  if(seen.size>=max){
   for(const [id,until] of seen)if(until<=now)seen.delete(id);
   if(seen.size>=max)seen.delete(seen.keys().next().value);
  }
  seen.set(key,now+cooldownMs);
  return true;
 };
}
export async function ensureUnavailableMediaTable(client){
 await client.query(`CREATE TABLE IF NOT EXISTS blofy_xtream_unavailable_media (
  server_id UUID NOT NULL REFERENCES blofy_xtream_servers(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('movie','series')),
  item_id TEXT NOT NULL,
  series_id TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'missing' CHECK(state IN ('missing','recovered')),
  first_missing_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_missing_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_checked_at TIMESTAMPTZ,
  recovered_at TIMESTAMPTZ,
  next_check_at TIMESTAMPTZ DEFAULT (NOW()+INTERVAL '6 hours'),
  failure_count INTEGER NOT NULL DEFAULT 1,
  recheck_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(server_id,kind,item_id,series_id)
 )`);
 await client.query(`CREATE INDEX IF NOT EXISTS idx_blofy_xtream_unavailable_due
  ON blofy_xtream_unavailable_media(server_id,next_check_at)
  WHERE state='missing'`);
}
export async function registerProvider404(pool,key){
 const k=validUnavailableKey(key);if(!k)return false;
 await pool.query(`INSERT INTO blofy_xtream_unavailable_media
  (server_id,kind,item_id,series_id) VALUES($1,$2,$3,$4)
  ON CONFLICT(server_id,kind,item_id,series_id) DO UPDATE
  SET state='missing',last_missing_at=NOW(),
    failure_count=CASE WHEN blofy_xtream_unavailable_media.state='recovered'
      THEN 1 ELSE LEAST(blofy_xtream_unavailable_media.failure_count+1,999999) END,
    recheck_count=CASE WHEN blofy_xtream_unavailable_media.state='recovered'
      THEN 0 ELSE blofy_xtream_unavailable_media.recheck_count END,
    next_check_at=CASE WHEN blofy_xtream_unavailable_media.state='recovered'
      THEN NOW()+INTERVAL '6 hours'
      ELSE blofy_xtream_unavailable_media.next_check_at END,
    recovered_at=NULL
  WHERE blofy_xtream_unavailable_media.state='recovered' OR
    blofy_xtream_unavailable_media.last_missing_at < NOW()-INTERVAL '15 minutes'`,
  [k.serverId,k.kind,k.itemId,k.seriesId]);
 return true;
}
export async function noteMediaRestored(pool,key){
 const k=validUnavailableKey(key);if(!k)return false;
 const r=await pool.query(`UPDATE blofy_xtream_unavailable_media
  SET state='recovered',recovered_at=NOW(),last_checked_at=NOW(),
    next_check_at=NULL
  WHERE server_id=$1 AND kind=$2 AND item_id=$3 AND series_id=$4
    AND state='missing'`,[k.serverId,k.kind,k.itemId,k.seriesId]);
 return (r.rowCount||0)>0;
}
export async function claimDueMedia(pool,serverId,{limit=DEFAULT_RECHECK_BATCH}={}){
 if(!UUID.test(String(serverId||''))||!Number.isInteger(limit)||
  limit<1||limit>5)return [];
 const r=await pool.query(`WITH due AS (
  SELECT server_id,kind,item_id,series_id FROM blofy_xtream_unavailable_media
  WHERE server_id=$1 AND state='missing' AND next_check_at<=NOW()
  ORDER BY next_check_at,first_missing_at LIMIT $2 FOR UPDATE SKIP LOCKED
 )
 UPDATE blofy_xtream_unavailable_media v
 SET next_check_at=NOW()+INTERVAL '30 minutes'
 FROM due d
 WHERE v.server_id=d.server_id AND v.kind=d.kind
   AND v.item_id=d.item_id AND v.series_id=d.series_id
 RETURNING v.server_id,v.kind,v.item_id,v.series_id,v.recheck_count`,
 [serverId,limit]);
 return r.rows||[];
}
export async function finishUnavailableRecheck(pool,key,{result='transient',rechecks=0}={}){
 const k=validUnavailableKey(key);if(!k)return false;
 if(result==='recovered')return noteMediaRestored(pool,k);
 const missing=result==='provider404';
 const hours=missing?nextRecheckHours(rechecks+1):1;
 const r=await pool.query(`UPDATE blofy_xtream_unavailable_media
  SET last_checked_at=NOW(),next_check_at=NOW()+make_interval(hours=>$5::int),
    failure_count=CASE WHEN $6::boolean THEN LEAST(failure_count+1,999999)
       ELSE failure_count END,
    last_missing_at=CASE WHEN $6::boolean THEN NOW() ELSE last_missing_at END,
    recheck_count=LEAST(recheck_count+1,1000)
  WHERE server_id=$1 AND kind=$2 AND item_id=$3 AND series_id=$4
   AND state='missing'`,[k.serverId,k.kind,k.itemId,k.seriesId,hours,missing]);
 return (r.rowCount||0)>0;
}
export async function unavailableMediaSummary(pool,sourceId=null){
 if(sourceId!==null&&!UUID.test(String(sourceId)))return {ok:false,code:'invalid_source'};
 const r=await pool.query(`SELECT server_id::text AS server_id,kind,state,
   COUNT(*)::int AS count,
   COUNT(*) FILTER (WHERE state='missing' AND next_check_at<=NOW())::int AS due
  FROM blofy_xtream_unavailable_media
  WHERE ($1::uuid IS NULL OR server_id=$1::uuid)
  GROUP BY server_id,kind,state ORDER BY server_id,kind,state LIMIT 100`,
  [sourceId]);
 return {ok:true,scope:'verified_upstream_404_only',entries:(r.rows||[]).map(x=>({
  sourceId:x.server_id,kind:x.kind,state:x.state,count:Number(x.count)||0,
  due:Number(x.due)||0
 })),catalogMutation:false,subscriberCutover:false};
}
