// Authenticated STREAM operator -> authoritative Portal -> private Content Hub.
// A finite allowlist only. No arbitrary forwarding or public media routes.
const HUB='http://blofy-content-hub.railway.internal:3000';
const NS='/internal/blofy-stream/content-hub/seasons';
const ID=/^[1-9][0-9]{0,14}$/;
const TOKEN=32;
const MAX=256000;
const PAGE_ROUTE=/^\/internal\/blofy-stream\/content-hub\/seasons\/queue\/page\/([1-9][0-9]{0,4})$/;

const shortError=(code,status=400)=>({status,data:{ok:false,code}});
export function isStreamSeasonBridgePath(path){
 return path===NS+'/series'||path===NS+'/pilot'||
  path===NS+'/queue'||path===NS+'/confirmation'||
  path===NS+'/health'||path===NS+'/audit'||
  path===NS+'/concurrent-read'||path===NS+'/retry'||
  path===NS+'/probe'||path===NS+'/enqueue'||
  path===NS+'/start'||path===NS+'/pause'||path===NS+'/confirm'||
  (PAGE_ROUTE.test(path)&&Number(path.match(PAGE_ROUTE)?.[1])<=20000)||
  /^\/internal\/blofy-stream\/content-hub\/seasons\/series\/[1-9][0-9]{0,14}$/.test(path);
}
const boundedId=n=>Number.isSafeInteger(Number(n))&&Number(n)>0&&
 Number(n)<=Number.MAX_SAFE_INTEGER;
const validatedBody=(path,method,raw)=>{
 if(method==='GET'){
  if(!['series','pilot','queue','confirmation','health'].some(k=>path===NS+'/'+k)&&
    !(PAGE_ROUTE.test(path)&&Number(path.match(PAGE_ROUTE)?.[1])<=20000)&&
    !/^\/internal\/blofy-stream\/content-hub\/seasons\/series\/[1-9][0-9]{0,14}$/.test(path))
   throw Error('season_bridge_method_denied');
  return null;
 }
 if(method!=='POST')throw Error('season_bridge_method_denied');
 const b=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
 if(path===NS+'/probe'){
  if(b.confirmed!==true||!boundedId(b.gatewayId))
   throw Error('season_probe_confirmation_required');
  return {gatewayId:Number(b.gatewayId)};
 }
 if(path===NS+'/enqueue'){
  if(b.confirmed!==true||b.licensedStorage!==true||
    !Array.isArray(b.episodes)||b.episodes.length<1||b.episodes.length>12)
   throw Error('season_enqueue_owner_confirmation_required');
  const episodes=b.episodes.map(row=>{
   const num=Number(row?.episodeNumber),id=Number(row?.gatewayId);
   const bytes=Number(row?.expectedBytes);
   if(!boundedId(id)||!Number.isSafeInteger(num)||num<1||num>500||
      !Number.isSafeInteger(bytes)||bytes<8388608||bytes>4294967296)
    throw Error('season_enqueue_invalid_episode');
   return {gatewayId:id,episodeNumber:num,expectedBytes:bytes};
  });
  const seriesGatewayId=Number(b.seriesGatewayId);
  if(boundedId(seriesGatewayId)&&Number.isSafeInteger(Number(b.seasonNumber))&&
     Number(b.seasonNumber)>=0&&Number(b.seasonNumber)<=999)
   return {seriesGatewayId,seasonNumber:Number(b.seasonNumber),episodes};
  if(!/^[a-z0-9][a-z0-9_-]{2,63}$/.test(String(b.seasonKey||'')))
   throw Error('season_enqueue_invalid_season');
  return {seasonKey:b.seasonKey,episodes};
 }
 if(path===NS+'/start'){
  if(b.confirmed!==true||b.sourceIdle!==true||b.licensedStorage!==true)
   throw Error('season_start_operator_confirmation_required');
  if(b.maxBatches===undefined)return {};
  if(![12,60,120].includes(Number(b.maxBatches)))
   throw Error('season_start_batch_budget_invalid');
  return {maxBatches:Number(b.maxBatches)};
 }
 if(path===NS+'/pause'){
  if(b.confirmed!==true)throw Error('season_pause_confirmation_required');
  return {};
 }
 if(path===NS+'/retry'){
  if(b.confirmed!==true||b.licensedStorage!==true||
     b.sourceIdle!==true||
     !/^[A-Za-z0-9_-]{8,80}$/.test(String(b.runId||'')))
   throw Error('season_retry_manual_review_required');
  return {runId:b.runId,confirmed:true,licensedStorage:true,
   sourceIdle:true};
 }
 if(path===NS+'/concurrent-read'){
  const ids=b.runIds;
  if(b.confirmed!==true||!Array.isArray(ids)||ids.length!==2||
      ids.some(x=>!/^[A-Za-z0-9_-]{8,80}$/.test(String(x||'')))||
      ids[0]===ids[1])
   throw Error('private_read_canary_owner_confirmation_required');
  return {confirmed:true,runIds:ids};
 }
 if(path===NS+'/audit'){
  if(b.confirmed!==true||
     !/^[A-Za-z0-9_-]{8,80}$/.test(String(b.runId||'')))
   throw Error('season_audit_owner_confirmation_required');
  return {confirmed:true,runId:b.runId};
 }
 if(path===NS+'/confirm'){
  if(b.confirmed!==true||b.videoConfirmed!==true||b.audioConfirmed!==true)
   throw Error('season_browser_av_confirmation_required');
  return {};
 }
 throw Error('season_bridge_route_denied');
};
export async function requestStreamSeasonBridge({path,method='GET',body,
  operatorToken='',fetchImpl=fetch}={}){
 if(!isStreamSeasonBridgePath(path))
  return shortError('season_bridge_route_denied',404);
 if(String(operatorToken).length<TOKEN)
  return shortError('season_bridge_private_token_missing',503);
 let input;try{input=validatedBody(path,method,body)}
 catch(error){return shortError(error.message,405===method?405:400)}
 const action=path.slice(NS.length+1);
 const routes={
  series:'/internal/series/candidates',
  pilot:'/internal/series/pilot',
  queue:'/internal/seasons/queue',
  health:'/internal/seasons/health',
  audit:'/internal/seasons/audit',
  'concurrent-read':'/internal/seasons/concurrent-read',
  confirmation:'/internal/episodes/playback/confirmation',
  probe:'/internal/episodes/probe',
  enqueue:'/internal/seasons/enqueue',
  retry:'/internal/seasons/retry',
  start:'/internal/seasons/start',
  pause:'/internal/seasons/pause',
  confirm:'/internal/episodes/playback/confirm'
 };
 const page=PAGE_ROUTE.exec(path);
 const target=page&&Number(page[1])<=20000?
   '/internal/seasons/queue/page/'+page[1]:
   Object.hasOwn(routes,action)?routes[action]:
  action.startsWith('series/')&&ID.test(action.slice(7))?
   '/internal/series/episodes/'+action.slice(7):null;
 if(!target)return shortError('season_bridge_route_denied',404);
 const headers={authorization:'Bearer '+operatorToken,
  accept:'application/json'};
 if(action==='probe')Object.assign(headers,{
  'x-blofy-episode-probe-confirm':'operator-approved-probe',
  'x-blofy-episode-gateway-id':String(input.gatewayId)});
 if(action==='enqueue')Object.assign(headers,{
  'content-type':'application/json',
  'x-blofy-season-confirm':'licensed-private-episodes',
  'x-blofy-storage-rights-confirm':'licensed-persistent-copy'});
 if(action==='start'){
  headers['x-blofy-season-confirm']='start-private-sequential';
  if(input?.maxBatches)headers['x-blofy-season-batch-budget']=String(input.maxBatches);
 }
 if(action==='retry')Object.assign(headers,{
  'x-blofy-season-confirm':'manual-review-transient-failure',
  'content-type':'application/json'});
 if(action==='concurrent-read')Object.assign(headers,{
  'x-blofy-season-confirm':'two-verified-private-s3-reads',
  'content-type':'application/json'});
 if(action==='audit')Object.assign(headers,{
  'x-blofy-season-confirm':'audit-private-verified-chunks',
  'content-type':'application/json'});
 if(action==='pause')headers['x-blofy-season-confirm']='pause-private-sequential';
 if(action==='confirm')Object.assign(headers,{
  'x-blofy-browser-confirm':'owner-saw-and-heard',
  'x-blofy-video-confirmed':'yes',
  'x-blofy-audio-confirmed':'yes'});
 try{
  const response=await fetchImpl(HUB+target,{
   method,headers,redirect:'manual',cache:'no-store',
   signal:AbortSignal.timeout(action.startsWith('series/')?65000:
      action==='concurrent-read'?55000:action==='audit'?73000:action==='probe'?55000:11000),
   ...(['enqueue','audit','concurrent-read','retry'].includes(action)?{body:JSON.stringify(input)}:{})
  });
  if(![200,201,202,400,403,409,429,503].includes(response.status))
   return shortError('season_bridge_private_status_unexpected',503);
  if(!String(response.headers.get('content-type')||'').includes('application/json'))
   return shortError('season_bridge_private_not_json',503);
  if(Number(response.headers.get('content-length')||0)>MAX)
   return shortError('season_bridge_private_payload_too_large',503);
  const raw=await response.text();
  if(Buffer.byteLength(raw)>MAX)
   return shortError('season_bridge_private_payload_too_large',503);
  let data;try{data=JSON.parse(raw)}catch{
   return shortError('season_bridge_private_invalid_json',503);
  }
  if(!data||typeof data!=='object'||Array.isArray(data))
   return shortError('season_bridge_private_invalid_payload',503);
  return {status:response.status,data};
 }catch{return shortError('season_bridge_private_unavailable',503)}
}
