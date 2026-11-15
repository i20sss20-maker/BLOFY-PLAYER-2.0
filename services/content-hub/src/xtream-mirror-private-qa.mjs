// Exactly verified private mirror copies can be tested for A/V and seeking
// without any new provider request or subscriber-facing stream. The queue
// "verified" state alone is not a playback proof: compare it to the actual
// private verified manifest from the S3 chunk worker first.
import pg from 'pg';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const DIGEST=/^[a-f0-9]{64}$/;
const RUN=/^mirror_[a-f0-9]{40}$/;
const KINDS=new Set(['movie','episode']);

export function createPrivateMirrorQaStore({
 connectionString,Pool=pg.Pool
}={}){
 if(!connectionString)throw Error('mirror_qa_db_missing');
 const pool=new Pool({connectionString,max:1,
  connectionTimeoutMillis:5000,idleTimeoutMillis:10000,
  application_name:'blofy-private-mirror-media-qa'});
 return {db:pool,close:()=>pool.end()};
}

export async function resolveVerifiedMirrorMedia({
 db,lease,sourceId,mediaKind,gatewayId
}={}){
 if(typeof db?.query!=='function'||!lease||
    !UUID.test(String(sourceId||''))||
    !KINDS.has(mediaKind)||!Number.isSafeInteger(gatewayId)||gatewayId<1)
  throw Error('mirror_qa_selection_invalid');
 const r=await db.query(`SELECT q.copy_run_id,q.copy_sha256,
   q.expected_bytes,q.extension,q.copy_completed_at
   FROM blofy_xtream_mirror_items q
   WHERE q.source_id=$1 AND q.media_kind=$2 AND q.gateway_id=$3
    AND q.state='verified' AND q.mapping_conflict=FALSE
    AND q.copy_completed_at IS NOT NULL
    AND q.license_reviewed_at IS NOT NULL
    AND q.rights_ref_sha256 ~ '^[a-f0-9]{64}$'
    AND q.copy_sha256 ~ '^[a-f0-9]{64}$'
    AND q.expected_bytes BETWEEN 8388608 AND 4294967296
   LIMIT 1`,[sourceId,mediaKind,gatewayId]);
 const row=r.rows?.[0];
 if(!row)return {ok:false,code:'mirror_qa_no_verified_record',
  providerRequests:0,customerCutover:false};
 const runId=String(row.copy_run_id||'').trim();
 const sha=String(row.copy_sha256||'').trim();
 const bytes=Number(row.expected_bytes);
 const extension=String(row.extension||'').toLowerCase();
 if(!RUN.test(runId)||!DIGEST.test(sha)||
    !Number.isSafeInteger(bytes)||bytes<8*1024*1024||
    bytes>4*1024**3||!['mkv','mp4','avi','ts'].includes(extension))
  return {ok:false,code:'mirror_qa_record_invalid',
   providerRequests:0,customerCutover:false};
 let manifest;
 try{
  manifest=mediaKind==='episode'?
   await lease.getVerifiedEpisodeObject(runId):
   await lease.getVerifiedChunkedObject(runId);
 }catch{
  return {ok:false,code:'mirror_qa_manifest_unavailable',
   providerRequests:0,customerCutover:false};
 }
 if(!manifest||manifest.bytes!==bytes||
    String(manifest.sha256||'').trim()!==sha||
    manifest.extension!==extension||
    !Array.isArray(manifest.parts)||manifest.parts.length<1)
  return {ok:false,code:'mirror_qa_manifest_mismatch',
   providerRequests:0,customerCutover:false};
 return {ok:true,code:'mirror_qa_private_manifest_verified',
  sourceId,mediaKind,gatewayId,runId,
  sha256:sha,bytes,parts:manifest.parts.length,
  providerRequests:0,copyStarted:false,customerCutover:false};
}
