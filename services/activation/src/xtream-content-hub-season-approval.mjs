// Only a short-lived, owner-curated *running* season job can authorize
// additional source ranges. This is never a general playback proxy.
// The operator queue row and live indexed saleh episode must match exactly.
import {cleanEpisodeCandidate} from './xtream-content-hub-episode-candidates.mjs';
export async function findRunningApprovedSeasonEpisode(pool,{
 gatewayId,enabled=false
}={}){
 const id=Number(gatewayId);
 if(enabled!==true||!Number.isSafeInteger(id)||id<1)return null;
 try{
  const response=await pool.query(`SELECT q.gateway_id,
   q.source_id AS server_id,q.media_id AS source_id,
   q.extension AS container_extension,
   (i.name || ' — episode ' || q.media_id) AS display_name
   FROM blofy_content_hub_season_queue q
   JOIN blofy_xtream_gateway_episode_map e
     ON e.gateway_id=q.gateway_id AND e.server_id=q.source_id
     AND e.source_episode_id=q.media_id
     AND lower(e.container_extension)=lower(q.extension)
   JOIN blofy_xtream_items i ON i.server_id=e.server_id
     AND i.media_type='series' AND i.source_id=e.series_source_id
   JOIN blofy_xtream_servers s ON s.id=e.server_id
   WHERE q.gateway_id=$1 AND q.state='running'
     AND q.updated_at > NOW() - INTERVAL '3 minutes'
     AND q.expected_bytes BETWEEN 8388608 AND 4294967296
     AND s.enabled=TRUE AND s.publish_catalog=TRUE
     AND s.deletion_requested_at IS NULL
     AND lower(btrim(s.name))='saleh' AND i.enabled=TRUE
     AND lower(e.container_extension) IN ('mp4','mkv','ts','avi')
   LIMIT 1`,[id]);
  const rows=response?.rows||[];
  return rows.length===1?cleanEpisodeCandidate(rows[0]):null;
 }catch{
  // Schema missing, permissions revoked or database unavailable => no access.
  return null;
 }
}
