// A bounded one-file-per-tick provider-size preflight for EXACT operator-
// reviewed, approved-source mirror candidates. Not a video download.
// A verified HTTP 206 4 KiB response only proves the source's reported
// file length at probe time; the independent 8MiB private copy worker must
// verify every byte and final SHA-256 before any file is usable.
import {createHash} from 'node:crypto';
import {parseStrictContentRange} from './xtream-content-hub-range-pilot.mjs';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const LOCK_A=1774401053,LOCK_B=1774401055;
const PROBE_BYTES=4096;
const MIN_FILE=8*1024*1024,MAX_FILE=4*1024**3;

export function mirrorSizeProbeEnabled(env={}){
 return env.BLOFY_XTREAM_MIRROR_SIZE_PROBE_ENABLED==='1'&&
   UUID.test(String(env.BLOFY_XTREAM_DAILY_CATALOG_SOURCE_ID||''));
}

export async function readMirrorFileSize206(fetchOneRange){
 if(typeof fetchOneRange!=='function')
  throw Error('mirror_size_probe_fetch_missing');
 let response;
 try{
  response=await fetchOneRange();
  if(response?.status!==206||!response.body ||
     typeof response.headers?.get!=='function')
   return {ok:false,code:'provider_range_not_supported'};
  const range=parseStrictContentRange(
   response.headers.get('content-range'),0,PROBE_BYTES-1);
  const total=range?.totalSize;
  if(!Number.isSafeInteger(total)||total<MIN_FILE||total>MAX_FILE)
   return {ok:false,code:'provider_size_missing_or_excessive'};
  if(response.headers.get('content-length')!==String(PROBE_BYTES))
   return {ok:false,code:'provider_range_length_invalid'};
  const validator=String(response.headers.get('etag')||
    response.headers.get('last-modified')||'');
  if(validator.length>140||/[\r\n]/.test(validator))
   return {ok:false,code:'provider_validator_invalid'};
  const reader=response.body.getReader();
  let received=0;
  try{
   while(received<PROBE_BYTES){
    const next=await reader.read();
    const len=next?.value?.byteLength||0;
    if(next.done||len<=0||len>PROBE_BYTES-received)
     return {ok:false,code:'provider_range_payload_invalid'};
    received+=len;
   }
  }finally{
   await reader.cancel().catch(()=>{});reader.releaseLock();
  }
  return {ok:true,code:'mirror_size_4k_range_probed',
   expectedBytes:total,sourceValidatorSha256:validator?
    createHash('sha256').update(validator).digest('hex'):null,
   probeBytes:received,
   // There is no media file in S3 yet.
   stored:false,copyStarted:false,customerCutover:false};
 }catch{
  return {ok:false,code:'provider_range_unavailable',
    stored:false,copyStarted:false,customerCutover:false};
 }finally{
  if(response?.body&&!response.body.locked)
   await response.body.cancel().catch(()=>{});
 }
}

export async function probeOneAttestedMirrorItem({
 db,sourceId,localDay,resolveSourceMedia
}={}){
 if(!UUID.test(String(sourceId||''))||
   !/^20[0-9]{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])$/.test(String(localDay||''))||
   typeof db?.connect!=='function'||typeof resolveSourceMedia!=='function')
  throw Error('mirror_size_scan_request_invalid');
 const client=await db.connect();
 let held=false;
 try{
  const lock=await client.query(
   'SELECT pg_try_advisory_lock($1::integer,$2::integer) AS held',
   [LOCK_A,LOCK_B]);
  held=lock.rows?.[0]?.held===true;
  if(!held)return {ok:false,code:'mirror_size_scan_busy',
   providerRequests:0,mediaBytesTransferred:0};
  const picked=await client.query(`SELECT q.media_kind,q.gateway_id,
     q.source_id,q.media_id,q.extension
    FROM blofy_xtream_mirror_items q
    JOIN blofy_xtream_servers s ON s.id=q.source_id
    WHERE q.source_id=$1 AND s.enabled=TRUE AND s.publish_catalog=TRUE
      AND lower(btrim(s.name))='saleh' AND s.status='online'
      AND s.deletion_requested_at IS NULL AND s.last_error IS NULL
      AND s.last_sync_at>NOW()-INTERVAL '48 hours'
      AND q.state='needs_review' AND q.mapping_conflict=FALSE
      AND q.license_reviewed_at IS NOT NULL
      AND q.rights_ref_sha256 ~ '^[a-f0-9]{64}$'
      AND (q.size_probe_day IS NULL OR q.size_probe_day<$2::date)
    ORDER BY q.gateway_id,q.media_kind LIMIT 1`,[sourceId,localDay]);
  const row=picked.rows?.[0];
  if(!row)return {ok:true,code:'mirror_size_no_attested_items_due',
   providerRequests:0,probeBytes:0,mediaBytesTransferred:0,
   customerCutover:false};
  const gatewayId=Number(row.gateway_id);
  if(!Number.isSafeInteger(gatewayId)||gatewayId<1)
   throw Error('mirror_size_gateway_invalid');
  const item={
   sourceId:String(row.source_id),mediaKind:String(row.media_kind),
   gatewayId,mediaId:String(row.media_id),extension:String(row.extension)
  };
  let proof;
  try{
   const source=await resolveSourceMedia(item);
   if(!source||source.ok!==true||
      typeof source.fetchOneRange!=='function'){
    proof={ok:false,code:'mirror_size_source_mapping_changed'};
   }else proof=await readMirrorFileSize206(source.fetchOneRange);
  }catch{
   proof={ok:false,code:'mirror_size_source_unavailable'};
  }
  // A changed ID or extension is held for operator review, never silently
  // re-pointed to a new film or episode.
  if(proof.code==='mirror_size_source_mapping_changed'){
   await client.query(`UPDATE blofy_xtream_mirror_items
     SET mapping_conflict=TRUE,mapping_conflict_at=NOW(),
       size_probe_error=$6,size_probe_day=$7::date
     WHERE source_id=$1 AND media_kind=$2 AND gateway_id=$3
       AND media_id=$4 AND extension=$5 AND state='needs_review'`,
    [item.sourceId,item.mediaKind,item.gatewayId,item.mediaId,
     item.extension,proof.code,localDay]);
   return {ok:false,code:proof.code,providerRequests:0,
     probeBytes:0,mediaBytesTransferred:0,customerCutover:false};
  }
  const sql=proof.ok?`UPDATE blofy_xtream_mirror_items q SET
    expected_bytes=$6,size_probe_at=NOW(),size_probe_day=$7::date,
    source_validator_sha256=$8,size_probe_error=NULL,
    state='approved'
    WHERE q.source_id=$1 AND q.media_kind=$2 AND q.gateway_id=$3
      AND q.media_id=$4 AND q.extension=$5
      AND q.mapping_conflict=FALSE AND q.state='needs_review'
      AND q.license_reviewed_at IS NOT NULL
      AND q.rights_ref_sha256 ~ '^[a-f0-9]{64}$'
    RETURNING q.gateway_id`:
   `UPDATE blofy_xtream_mirror_items SET
    size_probe_day=$6::date,size_probe_error=$7
    WHERE source_id=$1 AND media_kind=$2 AND gateway_id=$3
      AND media_id=$4 AND extension=$5 AND state='needs_review'
    RETURNING gateway_id`;
  const params=proof.ok?
   [item.sourceId,item.mediaKind,item.gatewayId,item.mediaId,
    item.extension,proof.expectedBytes,localDay,
    proof.sourceValidatorSha256]:
   [item.sourceId,item.mediaKind,item.gatewayId,item.mediaId,
    item.extension,localDay,proof.code];
  const saved=await client.query(sql,params);
  return {ok:proof.ok&&saved.rowCount===1,
    code:saved.rowCount!==1?'mirror_size_candidate_changed':proof.code,
    gatewayId:item.gatewayId,mediaKind:item.mediaKind,
    expectedBytes:proof.ok?proof.expectedBytes:null,
    providerRequests:1,probeBytes:proof.probeBytes||0,
    stored:false,copyStarted:false,mediaBytesTransferred:0,
    readyForCopy:false,customerCutover:false};
 }finally{
  if(held)await client.query(
    'SELECT pg_advisory_unlock($1::integer,$2::integer)',
    [LOCK_A,LOCK_B]).catch(()=>{});
  client.release();
 }
}
