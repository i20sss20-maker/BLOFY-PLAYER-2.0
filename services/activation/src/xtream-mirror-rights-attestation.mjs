// Owner-only record of an individual item-specific perpetual VOD storage
// grant. An Xtream subscription alone is NEVER proof of download rights.
// No media reads, no passwords, no source URLs, no automatic copying.
// This records an attestation; independent document validation is external.
import {createHash} from 'node:crypto';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const REF=/^[A-Za-z0-9][A-Za-z0-9._:/-]{11,159}$/;
const MEDIA_ID=/^[A-Za-z0-9._-]{1,128}$/;
const KINDS=new Set(['movie','episode']);
const EXT=new Set(['mp4','mkv','avi','ts']);

export function validateMirrorStorageAttestation(item={}){
 const sourceId=String(item.sourceId||'').trim();
 const mediaKind=String(item.mediaKind||'').trim();
 const gatewayId=Number(item.gatewayId);
 const mediaId=String(item.mediaId||'').trim();
 const extension=String(item.extension||'').toLowerCase();
 const evidenceReference=String(item.evidenceReference||'').trim();
 if(!UUID.test(sourceId)||!KINDS.has(mediaKind)||
    !Number.isSafeInteger(gatewayId)||gatewayId<1||
    !MEDIA_ID.test(mediaId)||!EXT.has(extension)||
    !REF.test(evidenceReference)||
    item.storagePermitted!==true||
    item.persistentStorageScope!=='saleh-vod-persistent-copy'||
    item.operatorReviewed!==true)
  throw Error('mirror_rights_review_invalid');
 return {sourceId,mediaKind,gatewayId,mediaId,extension,
  rightsDigest:createHash('sha256').update(evidenceReference).digest('hex')};
}

export async function attestMirrorStorageRights(db,item={}){
 if(typeof db?.query!=='function')
  throw Error('mirror_rights_database_missing');
 const valid=validateMirrorStorageAttestation(item);
 const sourceGuard=`EXISTS(SELECT 1 FROM blofy_xtream_servers s
      WHERE s.id=q.source_id AND lower(btrim(s.name))='saleh'
      AND s.enabled=TRUE AND s.publish_catalog=TRUE
      AND s.deletion_requested_at IS NULL
      AND s.status='online' AND s.last_error IS NULL
      AND s.last_sync_at>NOW()-INTERVAL '48 hours')`;
 const mediaGuard=valid.mediaKind==='movie'?
   `EXISTS(SELECT 1 FROM blofy_xtream_gateway_item_map m
     JOIN blofy_xtream_items i ON i.server_id=m.server_id
       AND i.media_type=m.media_type AND i.source_id=m.source_id
     WHERE m.gateway_id=q.gateway_id AND m.server_id=q.source_id
       AND m.media_type='movie' AND m.source_id=q.media_id
       AND i.enabled=TRUE AND lower(i.container_extension)=q.extension)`:
   `EXISTS(SELECT 1 FROM blofy_xtream_gateway_episode_map e
     JOIN blofy_xtream_items i ON i.server_id=e.server_id
       AND i.media_type='series' AND i.source_id=e.series_source_id
     WHERE e.gateway_id=q.gateway_id AND e.server_id=q.source_id
       AND e.source_episode_id=q.media_id
       AND lower(e.container_extension)=q.extension
       AND i.enabled=TRUE)`;
 const query=`UPDATE blofy_xtream_mirror_items q SET
    rights_ref_sha256=$6,license_reviewed_at=NOW(),
    expected_bytes=NULL,size_probe_at=NULL,size_probe_day=NULL,
    source_validator_sha256=NULL,size_probe_error=NULL,
    state='needs_review'
    WHERE q.source_id=$1 AND q.media_kind=$2 AND q.gateway_id=$3
      AND q.media_id=$4 AND q.extension=$5
      AND q.mapping_conflict=FALSE
      AND q.state IN ('needs_review','failed')
      AND ${sourceGuard} AND ${mediaGuard}
    RETURNING q.gateway_id`;
 const result=await db.query(query,[valid.sourceId,valid.mediaKind,
   valid.gatewayId,valid.mediaId,valid.extension,valid.rightsDigest]);
 return {ok:result.rowCount===1,
  code:result.rowCount===1?'mirror_rights_attestation_recorded':
   'mirror_rights_candidate_not_eligible',
  sourceId:valid.sourceId,mediaKind:valid.mediaKind,
  gatewayId:valid.gatewayId,
  // An attestation is never automatically a verified license or
  // a provider range probe.
  individuallyLicensedNotIndependentlyVerified:true,
  sizeProbed:false,readyForCopy:false,copyStarted:false,
  mediaBytesTransferred:0,customerCutover:false};
}
