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
// This generator runs only AFTER the upstream passed the initial media
// checks and the HTTP response began. It keeps one replacement socket at
// a time, with at most two attempts per viewer and a hard timeout per read.
// A failed reconnect ends the response, letting the app surface an error.
export async function* liveTsRecoveryBytes({
 first,reader,controller,fetchImpl,target,headers={},
 clientSignal,maxReconnects=2,waitRetry=waitXtreamMediaRetry,onReconnect=()=>{}
}={}){
 if(!tsPackets(first)||!reader||!controller||typeof fetchImpl!=='function'||
  !target||typeof waitRetry!=='function')throw Error('live_ts_recovery_invalid_args');
 const limit=Math.min(2,Math.max(0,Number.isSafeInteger(maxReconnects)?maxReconnects:2));
 let activeReader=reader,activeController=controller,pending=first,attempts=0;
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
    await closeConnection(activeReader,activeController);
    activeReader=null;activeController=null;
    if(attempts>=limit)throw Error('live_ts_reconnect_exhausted');
    // A failed fetch is transient only when there was no HTTP response.
    // Never retry 401/403/404/429/456/509, invalid MIME or unsafe TS bytes.
    for(;;){
     if(clientSignal?.aborted)throw Error('live_ts_client_closed');
     if(attempts>=limit)throw Error('live_ts_reconnect_exhausted');
     attempts++;
     if(!(await waitRetry({attempt:attempts,signal:clientSignal})))
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
      onReconnect({attempt:attempts});
      break;
     }catch(e){
      ctl.abort();
      await closeConnection(temporaryReader,ctl);
      if(!temporaryReader)await reply?.body?.cancel().catch(()=>{});
      if(clientSignal?.aborted)throw Error('live_ts_client_closed');
      if(e?.message==='live_ts_reconnect_denied')throw e;
      if(attempts>=limit)throw Error('live_ts_reconnect_exhausted');
     }
    }
   }
  }
 }finally{
  await closeConnection(activeReader,activeController);
 }
}
