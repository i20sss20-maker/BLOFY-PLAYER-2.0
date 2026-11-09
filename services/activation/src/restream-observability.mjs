// MediaMTX Prometheus metrics are fetched from a FIXED private Railway host.
// Never expose path names: paths can contain provider credentials or tokens.
// HLS sessions are not equivalent to distinct subscribers or devices.
import crypto from 'node:crypto';
import {normalizePrivateRestreamOrigin} from './restream-engine-core.mjs';
const MAX_BYTES=512*1024;
const ALLOWED=new Set(['paths','paths_readers','paths_inbound_bytes','paths_outbound_bytes',
 'hls_sessions','hls_sessions_outbound_bytes','hls_muxers',
 'hls_muxers_outbound_bytes','hls_muxers_outbound_frames_discarded']);
function labels(raw){
 const out=Object.create(null);
 const matcher=/([a-zA-Z][a-zA-Z0-9_]*)="((?:\\.|[^"\\])*)"/g;
 for(const match of raw.matchAll(matcher)){
  if(match[2].length<=256)out[match[1]]=match[2];
 }
 return out;
}
export function parseRestreamMetrics(payload,{key=''}={}){
 if(typeof payload!=='string'||Buffer.byteLength(payload)>MAX_BYTES)
  throw new Error('restream_metrics_too_large');
 const perPath=new Map(),totals={hlsSessions:0,readers:0,hlsBytes:0,
  sourceInboundBytes:0,sourceOutboundBytes:0,discardedFrames:0};
 const safeId=p=>crypto.createHmac('sha256',key||'no-identity-secret')
  .update(p).digest('hex').slice(0,16);
 const get=p=>{
  if(!perPath.has(p))perPath.set(p,{id:safeId(p),hlsSessions:0,readers:0,
   inboundBytes:0,outboundBytes:0,hlsBytes:0,discardedFrames:0,ready:false});
  return perPath.get(p);
 };
 for(const line of payload.split(/\r?\n/)){
  if(!line||line.startsWith('#'))continue;
  const match=/^([a-z_]+)(?:\{([^\r\n]{0,1024})\})?\s+([0-9]+(?:\.[0-9]+)?)(?:\s|$)/.exec(line);
  if(!match||!ALLOWED.has(match[1]))continue;
  const n=Number(match[3]);if(!Number.isFinite(n)||n<0)continue;
  const l=labels(match[2]||'');
  // No raw path, IP, MediaMTX session ID or provider metadata returned.
  const p=l.path||l.name;
  if(!p||p.length>256||perPath.size>=500&&!perPath.has(p))continue;
  const row=get(p);
  switch(match[1]){
   case 'paths':row.ready=l.state==='ready'&&n>0;break;
   case 'paths_readers':row.readers+=n;totals.readers+=n;break;
   case 'paths_inbound_bytes':row.inboundBytes+=n;totals.sourceInboundBytes+=n;break;
   case 'paths_outbound_bytes':row.outboundBytes+=n;totals.sourceOutboundBytes+=n;break;
   case 'hls_sessions':row.hlsSessions+=n;totals.hlsSessions+=n;break;
   case 'hls_muxers_outbound_bytes':row.hlsBytes+=n;totals.hlsBytes+=n;break;
   case 'hls_muxers_outbound_frames_discarded':
    row.discardedFrames+=n;totals.discardedFrames+=n;break;
  }
 }
 const paths=[...perPath.values()].sort((a,b)=>b.hlsSessions-a.hlsSessions)
  .slice(0,100);
 return {ok:true,scope:'mediamtx_instance',uniqueViewersVerified:false,
  pathCount:perPath.size,totals,paths,
  note:'HLS sessions and readers are protocol sessions, not unique people or devices.'};
}
export function metricsOrigin(engine){
 const origin=normalizePrivateRestreamOrigin(engine);
 if(!origin)return null;
 const u=new URL(origin);
 u.port='9998';return u.origin;
}
export async function getRestreamMetrics(engine,{fetchImpl=fetch,key='',timeoutMs=3000}={}){
 const origin=metricsOrigin(engine);
 if(!origin)return {ok:false,code:'restream_not_configured'};
 try{
  const response=await fetchImpl(origin+'/metrics',{
   method:'GET',redirect:'error',signal:AbortSignal.timeout(Math.min(timeoutMs,5000)),
   headers:{accept:'text/plain'}});
  if(!response.ok){await response.body?.cancel().catch(()=>{});
   return {ok:false,code:'restream_metrics_http_error',httpStatus:response.status};}
  const len=Number(response.headers.get('content-length'));
  if(Number.isFinite(len)&&len>MAX_BYTES){
   await response.body?.cancel().catch(()=>{});
   return {ok:false,code:'restream_metrics_too_large'};}
  const reader=response.body?.getReader();
  if(!reader)return {ok:false,code:'restream_metrics_empty'};
  let count=0,parts=[];
  try{
   for(;;){
    const {done,value}=await reader.read();if(done)break;
    count+=value?.byteLength||0;
    if(count>MAX_BYTES)throw new Error('restream_metrics_too_large');
    parts.push(Buffer.from(value));
   }
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  return parseRestreamMetrics(Buffer.concat(parts).toString('utf8'),{key});
 }catch(error){
  return {ok:false,code:error?.message==='restream_metrics_too_large'
    ?'restream_metrics_too_large':'restream_metrics_unreachable'};
 }
}
