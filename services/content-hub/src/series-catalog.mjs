// Bounded metadata-only bridge: explicit licensed series, no video bytes.
import {safeEpisodeCandidate} from './episode-candidates.mjs';
const ORIGIN='http://blofy-activation-portal.railway.internal:3000';
const base={ok:false,privateOnly:true,readOnly:true,
 customerCutover:false,providerMediaRequests:0,automaticDownload:false};
const isId=v=>Number.isSafeInteger(Number(v))&&Number(v)>0;
const safeText=value=>String(value||'')
 .replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,220);
async function bridge(path,{env=process.env,fetchImpl=fetch,signal}={}){
 const token=String(env.BLOFY_CONTENT_HUB_BRIDGE_TOKEN||'');
 if(token.length<32)throw Error('licensed_series_bridge_unconfigured');
 const res=await fetchImpl(ORIGIN+path,{
  method:'GET',redirect:'manual',headers:{authorization:'Bearer '+token},
  signal:signal?AbortSignal.any([signal,AbortSignal.timeout(55000)]):
   AbortSignal.timeout(55000)});
 if(res.status!==200||!String(res.headers.get('content-type')||'')
   .includes('application/json'))
  throw Error('licensed_series_bridge_unavailable');
 return res.json();
}
export async function inspectLicensedSeries({env=process.env,fetchImpl=fetch,signal}={}){
 try{
  const result=await bridge('/internal/blofy-content-hub/series/candidates',
   {env,fetchImpl,signal});
  if(result?.ok!==true||result.readOnly!==true||
     !Array.isArray(result.series)||result.series.length>30)
   throw Error('series_catalog_invalid');
  const series=result.series.map(x=>{
   if(!isId(x?.seriesGatewayId)||x.sourceName!=='saleh'||
      x.mediaKind!=='series'||!safeText(x.title))
    throw Error('series_catalog_invalid_row');
   return {seriesGatewayId:Number(x.seriesGatewayId),
    title:safeText(x.title)};
  });
  return {...base,ok:true,series};
 }catch{return {...base,code:'licensed_series_list_unavailable',series:[]}}
}
export async function inspectLicensedSeriesEpisodes({
 seriesGatewayId,env=process.env,fetchImpl=fetch,signal
}={}){
 const id=Number(seriesGatewayId);
 if(!isId(id))return {...base,code:'series_id_invalid'};
 try{
  const data=await bridge('/internal/blofy-content-hub/series/'+id,
    {env,fetchImpl,signal});
  if(!data?.ok||data.readOnly!==true||
    Number(data.seriesGatewayId)!==id||
    !Array.isArray(data.seasons)||data.seasons.length>100)
   throw Error('series_season_response_invalid');
  let count=0;
  const seasons=data.seasons.map(group=>{
   const seasonNumber=Number(group?.seasonNumber);
   if(!Number.isSafeInteger(seasonNumber)||seasonNumber<0||
     seasonNumber>999||!Array.isArray(group.episodes))
    throw Error('series_season_invalid');
   const episodes=group.episodes.map(item=>{
    const candidate=safeEpisodeCandidate(item);
    const number=Number(item?.episodeNumber);
    if(!candidate||Number(item?.seriesGatewayId)!==id||
      Number(item?.seasonNumber)!==seasonNumber||
      !Number.isSafeInteger(number)||number<1||number>500)
     throw Error('series_episode_invalid');
    return {...candidate,seriesGatewayId:id,seasonNumber,
     episodeNumber:number};
   });
   count+=episodes.length;
   if(count>160||group.episodeCount!==episodes.length)
    throw Error('series_episode_limit');
   return {seasonNumber,episodeCount:episodes.length,episodes};
  });
  return {...base,ok:true,seriesGatewayId:id,
   title:safeText(data.title),seasons};
 }catch{return {...base,code:'licensed_series_episodes_unavailable',
   seriesGatewayId:id,seasons:[]}}
}

export async function inspectLicensedPilotSeries({
 env=process.env,fetchImpl=fetch,signal
}={}){
 try{
  const data=await bridge('/internal/blofy-content-hub/series/pilot',
   {env,fetchImpl,signal});
  if(data?.ok!==true||data.readOnly!==true||
    !isId(data.seriesGatewayId)||!isId(data.episodeGatewayId))
   throw Error('pilot_series_result_invalid');
  return {...base,ok:true,seriesGatewayId:Number(data.seriesGatewayId),
   episodeGatewayId:Number(data.episodeGatewayId)};
 }catch{return {...base,code:'pilot_series_not_available'}}
}
