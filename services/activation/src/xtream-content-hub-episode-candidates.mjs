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
 const result=await pool.query(`SELECT e.gateway_id,
   e.source_episode_id AS source_id,e.server_id,
   e.container_extension,
   (i.name || ' — episode ' || e.source_episode_id) AS display_name
   FROM blofy_xtream_gateway_episode_map e
   JOIN blofy_xtream_items i ON i.server_id=e.server_id
     AND i.media_type='series' AND i.source_id=e.series_source_id
   JOIN blofy_xtream_servers s ON s.id=e.server_id
   WHERE s.enabled=TRUE AND s.publish_catalog=TRUE
     AND s.deletion_requested_at IS NULL
     AND lower(btrim(s.name))='saleh'
     AND i.enabled=TRUE
     AND e.container_extension IN ('mp4','mkv','ts','avi')
   ORDER BY e.gateway_id ASC LIMIT $1`,[n]);
 return (result.rows||[]).map(cleanEpisodeCandidate).filter(Boolean);
}
