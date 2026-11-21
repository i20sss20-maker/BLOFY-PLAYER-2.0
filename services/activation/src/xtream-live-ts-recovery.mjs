// Opt-in continuity for a SINGLE viewer's direct live MPEG-TS stream.
// This never shares a provider feed, changes a source, replays delivered bytes,
// retries denied content, or enables a wider customer rollout automatically.
import {waitXtreamMediaRetry} from './xtream-media-retry-backoff.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function allowedLiveTsRecoveryPilot({
 enabled=false,accountId,sourceId,pilotAccountId,pilotSourceId
}={}){
 return enabled===true&&[accountId,sourceId,pilotAccountId,pilotSourceId]
  .every(x=>typeof x==='string'&&UUID.test(x))&&
  accountId.toLowerCase()===pilotAccountId.toLowerCase()&&
  sourceId.toLowerCase()===pilotSourceId.toLowerCase();
}
function tsPackets(bytes){
 return bytes instanceof Uint8Array&&bytes.byteLength>=376&&
  bytes[0]===0x47&&bytes[188]===0x47;
}
function plainOpenEnded(response){
 if(!response||response.status!==200||!response.body||!response.headers?.get)return false;
 const length=response.headers.get('content-length');
 const span=response.headers.get('content-range');
 const encoding=String(response.headers.get('content-encoding')||'identity').toLowerCase();
 return !length&&!span&&encoding==='identity';
}
export function safeLiveTsRecoveryStart({
 enabled=false,kind,method,status,requestRange,usingIndependentRelay,
 format,response,first
}={}){
 return enabled===true&&kind==='live'&&method==='GET'&&status===200&&
  !requestRange&&!usingIndependentRelay&&format==='ts'&&
  plainOpenEnded(response)&&tsPackets(first);
}
async function closeConnection(reader,controller){
 controller?.abort();
 try{await reader?.cancel()}catch{}
 try{reader?.releaseLock()}catch{}
}
async function readWithin(reader,controller,ms){
 const timer=setTimeout(()=>controller.abort(new Error('live_ts_read_timeout')),ms);
 timer.unref?.();
 try{return await reader.read()}finally{clearTimeout(timer)}
}
// Each failed interruption may retry at most twice, but an earlier successful
// reconnect must not consume the budget for an unrelated drop minutes later.
// Explicit limits defend the provider from a true reconnect storm, while a
// limited number of short clean EOFs can be recovered within one player session.
export function createLiveTsReconnectBudget({
 now=Date.now,windowMs=120_000,maxInWindow=8,maxTotal=120,
 stableResetMs=300_000
}={}){
 let total=0,lastAttempt=null;
 const recent=[];
 return {
  claim(){
   const ts=Number(now());
   if(!Number.isFinite(ts))return 'live_ts_reconnect_budget_exhausted';
   if(lastAttempt!==null&&ts-lastAttempt>=stableResetMs)total=0;
   while(recent.length&&ts-recent[0]>=windowMs)recent.shift();
   if(total>=maxTotal)return 'live_ts_reconnect_budget_exhausted';
   if(recent.length>=maxInWindow)return 'live_ts_reconnect_rate_limited';
   recent.push(ts);total++;lastAttempt=ts;
   return null;
  }
 };
}
// Source-side interruptions are categorized WITHOUT logging raw fetch errors,
// provider URLs, subscription credentials or client IPs.
export function liveTsSourceDropReason(error,controller){
 if(error?.message==='live_ts_source_eof')return 'live_ts_source_eof';
 if(controller?.signal?.reason?.message==='live_ts_read_timeout')
  return 'live_ts_source_stalled';
 return 'live_ts_source_transport_error';
}
// This generator runs only AFTER the upstream passed the initial media
// checks and the HTTP response began. It keeps one replacement socket at
// a time. At most two retries PER interruption, eight connections in any
// two-minute window, 120 attempts in sustained instability; a stable five
// minutes resets the total. A failed reconnect ends the viewer response.
export async function* liveTsRecoveryBytes({
 first,reader,controller,fetchImpl,target,headers={},
 clientSignal,maxReconnects=2,waitRetry=waitXtreamMediaRetry,onReconnect=()=>{},
 onSourceDrop=()=>{},now=Date.now,
 reconnectBudget=createLiveTsReconnectBudget()
}={}){
 if(!tsPackets(first)||!reader||!controller||typeof fetchImpl!=='function'||
  !target||typeof waitRetry!=='function')throw Error('live_ts_recovery_invalid_args');
 const limit=Math.min(2,Math.max(0,Number.isSafeInteger(maxReconnects)?maxReconnects:2));
 if(typeof reconnectBudget?.claim!=='function')
  throw Error('live_ts_recovery_invalid_args');
 let activeReader=reader,activeController=controller,pending=first,attempts=0;
 let lastValidatedMediaAt=Number(now());
 try{
  for(;;){
   if(clientSignal?.aborted)throw Error('live_ts_client_closed');
   try{
    const item=pending?{done:false,value:pending}:
      await readWithin(activeReader,activeController,45000);
    pending=null;
    if(item.done)throw Error('live_ts_source_eof');
    if(!(item.value instanceof Uint8Array)||!item.value.byteLength)
      continue;
    yield item.value;
    continue;
   }catch(error){
    if(clientSignal?.aborted)throw Error('live_ts_client_closed');
    const seenAt=Number(now());
    const durationMs=Number.isFinite(seenAt)&&Number.isFinite(lastValidatedMediaAt)?
      Math.max(0,Math.min(86_400_000,seenAt-lastValidatedMediaAt)):null;
    try{onSourceDrop({
      reason:liveTsSourceDropReason(error,activeController),durationMs
    })}catch{}
    await closeConnection(activeReader,activeController);
    activeReader=null;activeController=null;
    // Successful recovery on a previous drop must not exhaust all future
    // recovery. Keep the per-event retry limit and an independent bounded
    // rolling-window/session budget.
    let failedThisDrop=0;
    if(limit===0)throw Error('live_ts_reconnect_exhausted');
    // A failed fetch is transient only when there was no HTTP response.
    // Never retry 401/403/404/429/456/509, invalid MIME or unsafe TS bytes.
    for(;;){
     if(clientSignal?.aborted)throw Error('live_ts_client_closed');
     if(failedThisDrop>=limit)throw Error('live_ts_reconnect_exhausted');
     const denied=reconnectBudget.claim();
     if(denied)throw Error(denied);
     failedThisDrop++;attempts++;
     if(!(await waitRetry({attempt:failedThisDrop,signal:clientSignal})))
      throw Error('live_ts_client_closed');
     const ctl=new AbortController();
     const requestSignal=clientSignal?AbortSignal.any([ctl.signal,clientSignal]):ctl.signal;
     let reply=null,temporaryReader=null;
     try{
      const timer=setTimeout(()=>ctl.abort(new Error('live_ts_headers_timeout')),12000);
      timer.unref?.();
      try{
       reply=await fetchImpl(target,{method:'GET',headers:{
        'user-agent':String(headers['user-agent']||'BLOFY-Xtream-Gateway/1.0').slice(0,160),
        'accept-encoding':'identity'
       },timeoutMs:12000,signal:requestSignal});
      }finally{clearTimeout(timer)}
      if(!plainOpenEnded(reply))throw Error('live_ts_reconnect_denied');
      temporaryReader=reply.body.getReader();
      const probe=await readWithin(temporaryReader,ctl,15000);
      if(probe.done||!tsPackets(probe.value))
       throw Error('live_ts_reconnect_denied');
      activeReader=temporaryReader;activeController=ctl;
      temporaryReader=null;pending=probe.value;
      lastValidatedMediaAt=Number(now());
      try{onReconnect({attempt:attempts})}catch{}
      break;
     }catch(e){
      ctl.abort();
      await closeConnection(temporaryReader,ctl);
      if(!temporaryReader)await reply?.body?.cancel().catch(()=>{});
      if(clientSignal?.aborted)throw Error('live_ts_client_closed');
      if(e?.message==='live_ts_reconnect_denied')throw e;
      if(failedThisDrop>=limit)throw Error('live_ts_reconnect_exhausted');
     }
    }
   }
  }
 }finally{
  await closeConnection(activeReader,activeController);
 }
}
