// Licensed-content episode candidate discovery for the private operator.
// Metadata only. No requests to upstream provider media URLs and no automatic
// episode copying or customer playback cutover. Every candidate is on the
// explicitly approved saleh source; an operator must approve a specific ID.
const TYPES=new Set(['mp4','mkv','ts','avi']);
const UUID=/^[a-f0-9-]{36}$/i;
export function cleanEpisodeCandidate(raw){
 const gatewayId=Number(raw?.gateway_id);
 const sourceId=String(raw?.server_id||'');
 const extension=String(raw?.container_extension||'').toLowerCase();
 const title=String(raw?.display_name||'').replace(/[\u0000-\u001f\u007f]/g,' ').trim();
 const mediaId=String(raw?.source_id||'');
 if(!Number.isSafeInteger(gatewayId)||gatewayId<1||
   !UUID.test(sourceId)||!TYPES.has(extension)||
   !/^[A-Za-z0-9._-]{1,128}$/.test(mediaId)||
   !title||title.length>220)return null;
 return {gatewayId,sourceId,mediaId,extension,title,
   mediaKind:'episode',sourceName:'saleh'};
}
export async function findLicensedEpisodeCandidates(pool,{limit=8}={}){
 const n=Math.max(1,Math.min(12,Number(limit)||8));
 const result=await pool.query(`SELECT m.gateway_id,i.source_id,
   i.server_id,i.container_extension,i.name AS display_name
   FROM blofy_xtream_gateway_item_map m
   JOIN blofy_xtream_items i ON i.server_id=m.server_id
      AND i.media_type=m.media_type AND i.source_id=m.source_id
   JOIN blofy_xtream_servers s ON s.id=m.server_id
   WHERE s.enabled=TRUE AND s.publish_catalog=TRUE
     AND s.deletion_requested_at IS NULL
     AND lower(btrim(s.name))='saleh'
     AND m.media_type='episode' AND i.enabled=TRUE
     AND i.container_extension IN ('mp4','mkv','ts','avi')
   ORDER BY m.gateway_id ASC LIMIT $1`,[n]);
 return (result.rows||[]).map(cleanEpisodeCandidate).filter(Boolean);
}
