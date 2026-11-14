// Read-only licensed series picker and season normalization for Content Hub.
// No media reads, source credentials, private object keys or customer routing.
import {cleanEpisodeCandidate} from './xtream-content-hub-episode-candidates.mjs';
const SAFE_TITLE=value=>String(value||'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,220);
export function cleanSeriesCandidate(row){
 const seriesGatewayId=Number(row?.gateway_id);
 const title=SAFE_TITLE(row?.title);
 if(!Number.isSafeInteger(seriesGatewayId)||seriesGatewayId<1||
    !title||title.length>220)return null;
 return {seriesGatewayId,title,sourceName:'saleh',mediaKind:'series'};
}
export async function listLicensedSeries(pool,{limit=30}={}){
 const n=Math.max(1,Math.min(50,Number(limit)||30));
 const result=await pool.query(`SELECT m.gateway_id,
   COALESCE(NULLIF(i.custom_name,''),i.name) AS title
   FROM blofy_xtream_gateway_item_map m
   JOIN blofy_xtream_items i ON i.server_id=m.server_id
     AND i.media_type=m.media_type AND i.source_id=m.source_id
   JOIN blofy_xtream_servers s ON s.id=m.server_id
   WHERE s.enabled=TRUE AND s.publish_catalog=TRUE
     AND s.deletion_requested_at IS NULL
     AND lower(btrim(s.name))='saleh'
     AND i.enabled=TRUE AND m.media_type='series'
   ORDER BY m.gateway_id ASC LIMIT $1`,[n]);
 return (result.rows||[]).map(cleanSeriesCandidate).filter(Boolean);
}
export async function mappedLicensedSeriesEpisodes(pool,{serverId,sourceSeriesId}={}){
 const result=await pool.query(`SELECT e.gateway_id,e.server_id,
  e.source_episode_id AS source_id,e.container_extension,
  (i.name || ' — episode ' || e.source_episode_id) AS display_name
  FROM blofy_xtream_gateway_episode_map e
  JOIN blofy_xtream_items i ON i.server_id=e.server_id
    AND i.media_type='series' AND i.source_id=e.series_source_id
  JOIN blofy_xtream_servers s ON s.id=e.server_id
  WHERE e.server_id=$1 AND e.series_source_id=$2
    AND s.enabled=TRUE AND s.publish_catalog=TRUE
    AND s.deletion_requested_at IS NULL AND i.enabled=TRUE
    AND lower(btrim(s.name))='saleh'
    AND lower(e.container_extension) IN ('mp4','mkv','ts','avi')
  ORDER BY e.gateway_id ASC LIMIT 200`,[serverId,String(sourceSeriesId)]);
 return (result.rows||[]).map(cleanEpisodeCandidate).filter(Boolean);
}
export function buildLicensedSeriesSeasons({
 info,candidates,seriesGatewayId,title
}={}){
 const id=Number(seriesGatewayId);
 if(!Number.isSafeInteger(id)||id<1||
    !info||typeof info!=='object'||!Array.isArray(candidates))
  throw Error('licensed_series_metadata_invalid');
 const byId=new Map(candidates.map(item=>[item.gatewayId,item]));
 const seasons=new Map(),seen=new Set();
 for(const [key,rows] of Object.entries(info.episodes||{})){
  const seasonNumber=Number(key);
  if(!Number.isSafeInteger(seasonNumber)||seasonNumber<0||
    seasonNumber>999||!Array.isArray(rows))continue;
  for(const row of rows){
   const gatewayId=Number(row?.id);
   const mapped=byId.get(gatewayId);
   const episodeNumber=Number(row?.episode_num);
   if(!mapped||seen.has(gatewayId)||
      !Number.isSafeInteger(episodeNumber)||episodeNumber<1||
      episodeNumber>500)continue;
   seen.add(gatewayId);
   if(seen.size>160)throw Error('licensed_series_episode_cap_exceeded');
   const entry={...mapped,seriesGatewayId:id,seasonNumber,
    episodeNumber,title:SAFE_TITLE(row?.title||row?.name||mapped.title)};
   const arr=seasons.get(seasonNumber)||[];
   if(arr.some(x=>x.episodeNumber===episodeNumber))continue;
   arr.push(entry);seasons.set(seasonNumber,arr);
  }
 }
 return {ok:true,readOnly:true,privateOnly:true,
  sourceMediaRequests:0,customerCutover:false,seriesGatewayId:id,
  title:SAFE_TITLE(title),seasons:[...seasons.entries()]
   .sort((a,b)=>a[0]-b[0])
   .map(([seasonNumber,episodes])=>({
     seasonNumber,episodeCount:episodes.length,
     episodes:episodes.sort((a,b)=>a.episodeNumber-b.episodeNumber)
   }))};
}
