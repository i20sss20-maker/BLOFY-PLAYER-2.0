// Experimental BLOFY STREAM Web / VIDAA live MPEG-TS continuity.
// For ONE preapproved channel AND one preapproved access-token UUID only.
// Keeps the same authenticated first-party media URL, media track and viewer.
// Never retries denied content, shares subscriptions, rewrites timestamps,
// switches providers, or records bearer tokens / source URLs.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACCESS=/^Bearer v1\.([0-9a-f-]{36})\.[A-Za-z0-9_-]{43}$/;
const TRANSIENT=new Set([408,500,502,503,504]);

export function allowedSingleViewerLiveTsContinuity({
 enabled=false,kind,id,ext,bearer,approvedChannelId,approvedAccessId
}={}){
 const token=ACCESS.exec(String(bearer||''));
 return enabled===true&&kind==='live'&&ext==='ts'&&
  /^[1-9][0-9]{0,14}$/.test(String(id||''))&&
  String(id)===String(approvedChannelId||'')&&
  UUID.test(String(approvedAccessId||''))&&
  !!token&&UUID.test(token[1])&&
  token[1].toLowerCase()===String(approvedAccessId).toLowerCase();
}
function delayForRetry(attempt,signal,sleep){
 if(signal?.aborted)return Promise.resolve(false);
 const ms=attempt===1?350:1000;
 if(sleep)return Promise.resolve(sleep(ms,signal)).then(v=>v!==false&&!signal?.aborted);
 return new Promise(resolve=>{
  let settled=false;
  const end=ok=>{
   if(settled)return;
   settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
   resolve(ok);
  };
  const abort=()=>end(false);
  const timer=setTimeout(()=>end(true),ms);
  timer.unref?.();
  signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted)end(false)
 })
}
async function tsFirstBytes(reader){
 const chunks=[];let total=0;
 for(let n=0;n<8&&total<376;n++){
  const part=await reader.read();
  if(part.done||!(part.value instanceof Uint8Array))throw Error('invalid_ts');
  if(!part.value.byteLength)continue;
  if(total+part.value.byteLength>1024*1024)throw Error('oversized_probe');
  chunks.push(part.value);total+=part.value.byteLength
 }
 if(total<376)throw Error('short_ts');
 const all=new Uint8Array(total);let offset=0;
 for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.byteLength}
 if(all[0]!==0x47||all[188]!==0x47)throw Error('invalid_ts');
 return all
}
function acceptableSource(reply){
 if(!reply||reply.status!==200||!reply.body?.getReader)return false;
 if(reply.headers?.get('content-length')||reply.headers?.get('content-range'))return false;
 const encoding=String(reply.headers?.get('content-encoding')||'identity').toLowerCase();
 const mime=String(reply.headers?.get('content-type')||'').toLowerCase();
 return encoding==='identity'&&!/^(?:text\/|application\/(?:json|xml|html))/.test(mime)
}
// This function does not know account secrets or the provider URL. It is
// supplied with a single-source fetch closure from the already authorized
// worker; each reconnect attempt uses a fresh abortable fetch with a new
// controller. Closing the player aborts pending retries immediately.
export function liveTsSameSourceContinuity({
 firstBody,fetchSameSource,clientSignal,onEvent=()=>{},now=Date.now,
 sleep,maxAttemptsPerDrop=2,maxPerWindow=4,windowMs=120000,maxTotal=80
}={}){
 if(!firstBody?.getReader||typeof fetchSameSource!=='function'||
  !clientSignal||typeof now!=='function'||
  maxAttemptsPerDrop!==2||maxPerWindow!==4||windowMs!==120000||
  maxTotal!==80)throw Error('invalid_live_continuity_config');
 let reader=firstBody.getReader(),activeRetry=null,pending=null;
 let stopped=false,total=0,openedAt=Number(now());
 const recent=[];
 const announce=event=>{try{onEvent(event)}catch{}};
 async function release(){
  const old=reader;reader=null;
  try{await old?.cancel()}catch{}
  try{old?.releaseLock()}catch{}
  if(activeRetry){activeRetry.abort();activeRetry=null}
 }
 async function reconnect(cause,at){
  const lifetimeMs=Number.isFinite(at)&&Number.isFinite(openedAt)?
   Math.max(0,Math.min(86400000,at-openedAt)):null;
  announce({phase:'source_drop',cause,
   lifetimeSeconds:lifetimeMs===null?null:Math.round(lifetimeMs/10000)*10});
  await release();
  for(let attempt=1;attempt<=maxAttemptsPerDrop;attempt++){
   if(stopped||clientSignal.aborted)break;
   const atAttempt=Number(now());
   while(recent.length&&recent[0]<=atAttempt-windowMs)recent.shift();
   if(total>=maxTotal||recent.length>=maxPerWindow)break;
   recent.push(atAttempt);total++;
   if(!(await delayForRetry(attempt,clientSignal,sleep)))break;
   const ctl=new AbortController();activeRetry=ctl;
   const abort=()=>ctl.abort();
   clientSignal.addEventListener('abort',abort,{once:true});
   const timeout=setTimeout(()=>ctl.abort(),12000);
   timeout.unref?.();
   let reply=null,probeReader=null;
   let terminal=false;
   try{
    reply=await fetchSameSource(ctl.signal);
    if(!acceptableSource(reply)){
     terminal=!TRANSIENT.has(Number(reply?.status));
     throw Error('untrusted_source_reply')
    }
    probeReader=reply.body.getReader();
    // This timer covers TS packet validation after response headers.
    const probeTimer=setTimeout(()=>ctl.abort(),3500);
    probeTimer.unref?.();
    try{pending=await tsFirstBytes(probeReader)}finally{clearTimeout(probeTimer)}
    if(stopped||clientSignal.aborted)break;
    reader=probeReader;probeReader=null;
    openedAt=Number(now());
    const gapMs=Number.isFinite(openedAt)&&Number.isFinite(at)?
     Math.max(0,Math.min(60000,openedAt-at)):null;
    announce({phase:'source_recovered',cause,attempt,
     gapMs:gapMs===null?null:Math.round(gapMs/500)*500});
    return true
   }catch{
    // Never report raw fetch errors: they may include source credentials.
    if(clientSignal.aborted||stopped)break
   }finally{
    clearTimeout(timeout);
    clientSignal.removeEventListener('abort',abort);
    if(probeReader){try{await probeReader.cancel()}catch{};try{probeReader.releaseLock()}catch{}}
    if(reply&&(!reader||reader!==probeReader)&&!pending){
     try{await reply.body?.cancel()}catch{}
    }
    if(reader!==null&&activeRetry===ctl){
     // Reader is linked to this controller on successful restore.
    }else if(activeRetry===ctl){
     ctl.abort();activeRetry=null
    }
   }
   if(terminal)break
  }
  announce({phase:'source_exhausted',cause});
  return false
 }
 return new ReadableStream({
  async pull(output){
   try{
    for(;;){
     if(stopped||clientSignal.aborted)throw Error('viewer_stopped');
     if(pending){
      const part=pending;pending=null;output.enqueue(part);return
     }
     if(!reader)throw Error('source_exhausted');
     let item,cause='eof';
     try{item=await reader.read()}catch{cause='transport_error'}
     if(item&&!item.done){
      if(item.value instanceof Uint8Array&&item.value.byteLength){
       output.enqueue(item.value);return
      }
      continue
     }
     if(!(await reconnect(cause,Number(now()))))
      throw Error('source_exhausted')
    }
   }catch{
    stopped=true;
    try{await release()}catch{}
    output.error(Error('live_source_continuity_ended'))
   }
  },
  cancel(){
   stopped=true;
   if(activeRetry)activeRetry.abort();
   try{reader?.cancel()}catch{}
   try{reader?.releaseLock()}catch{}
  }
 },{highWaterMark:0})
}
