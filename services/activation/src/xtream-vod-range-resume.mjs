// Opt-in recovery for a broken DIRECT Xtream VOD response after video bytes
// have reached an authorized viewer. Never switches provider, credentials,
// media ID or stream type. Live feeds and independent relay tickets excluded.
// Requires strong ETag and exact HTTP 206 Range response for byte continuity.
// Does not read entire media into memory; emits chunks with backpressure.
const MAX_TOTAL=8*1024*1024*1024;
const MAX_ETAG=128;
function strongEtag(input){
 const x=typeof input==='string'?input:'';
 return x.length>=3&&x.length<=MAX_ETAG&&
   /^"[\x21\x23-\x7e]{1,126}"$/.test(x)?x:null;
}
function positiveInteger(input){
 const n=Number(input);
 return Number.isSafeInteger(n)&&n>0?n:null;
}
// Exact one-span requests only: never join multipart Range or extend a seek.
// Limit numeric width and reject malformed, negative or unsafe offsets.
function requestedByteSpan(value){
 const m=/^bytes=(0|[1-9][0-9]{0,14})-(0|[1-9][0-9]{0,14})?$/.exec(String(value||''));
 if(!m)return null;
 const start=Number(m[1]);
 const end=m[2]===undefined?null:Number(m[2]);
 if(!Number.isSafeInteger(start)||start<0||
    (end!==null&&(!Number.isSafeInteger(end)||end<start)))return null;
 return {start,end};
}
function sourceContentRange(value){
 const m=/^bytes (0|[1-9][0-9]{0,14})-(0|[1-9][0-9]{0,14})\/(0|[1-9][0-9]{0,14})$/.exec(String(value||''));
 if(!m)return null;
 const start=Number(m[1]),end=Number(m[2]),fileTotal=Number(m[3]);
 if(![start,end,fileTotal].every(Number.isSafeInteger)||
    start<0||end<start||fileTotal<=end||fileTotal>MAX_TOTAL)return null;
 return {start,end,fileTotal};
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Never allow broad subscriber rollout by switching a single Boolean.
// Both a known test account AND its approved source must match explicit
// allowlists. Missing IDs leave the feature OFF even if enabled='1'.
export function allowedVodResumePilot({
 enabled=false,accountId,sourceId,pilotAccountId,pilotSourceId
}={}){
 return enabled===true&&[accountId,sourceId,pilotAccountId,pilotSourceId]
   .every(x=>typeof x==='string'&&UUID.test(x))&&
   accountId.toLowerCase()===pilotAccountId.toLowerCase()&&
   sourceId.toLowerCase()===pilotSourceId.toLowerCase();
}
export function verifiedVodResumePlan({
 enabled=false,kind,method='GET',status=200,requestRange=null,
 usingIndependentRelay=false,format='',headers
}={}){
 // Many players seek using Range: bytes=N- or bytes=N-M.
 // Permit recovery ONLY if the origin provided an exact matching 206
 // Content-Range spanning the full requested interval. Never extend a
 // bounded seek or silently replay already delivered bytes to the viewer.
 const fullGet=status===200&&!requestRange;
 const requestSpan=requestedByteSpan(requestRange);
 const ranged=status===206&&requestSpan!==null;
 if(!enabled||!['movie','series'].includes(kind)||method!=='GET'||
   (!fullGet&&!ranged)||usingIndependentRelay||
   !['mp4','mkv'].includes(format)||!headers?.get)return null;
 const total=positiveInteger(headers.get('content-length'));
 const etag=strongEtag(headers.get('etag'));
 const range=String(headers.get('accept-ranges')||'').toLowerCase().trim();
 const encoding=String(headers.get('content-encoding')||'identity').trim().toLowerCase();
 if(!total||total<2048||total>MAX_TOTAL||!etag||range!=='bytes'||
    encoding!=='identity')return null;
 const advertisedRange=headers.get('content-range');
 let rangeStart=0,rangeEnd=total-1,fileTotal=total;
 if(fullGet){
  if(advertisedRange)return null;
 }else{
  const actual=sourceContentRange(advertisedRange);
  if(!actual||actual.start!==requestSpan.start||
     actual.end-actual.start+1!==total||
     (requestSpan.end!==null
       ?actual.end!==requestSpan.end
       :actual.end!==actual.fileTotal-1))return null;
  rangeStart=actual.start;rangeEnd=actual.end;fileTotal=actual.fileTotal;
 }
 return Object.freeze({total,etag,format,rangeStart,rangeEnd,fileTotal});
}
// Only a single targeted replacement connection; never retry 403/404/429,
// redirects, a 200/full replay, a wrong byte span, or a changed ETag.
// No URL/header/body data is logged. Caller supplies previously checked
// authorized same-file upstream target and a client-abort signal.
export async function* resumeVerifiedVodBytes({
 plan,forwarded,url,fetchImpl,clientSignal,headers={}
}={}){
 if(!plan||!Number.isSafeInteger(forwarded)||forwarded<1||
   forwarded>=plan.total||typeof fetchImpl!=='function'||!url)
  throw Error('vod_resume_invalid_request');
 if(clientSignal?.aborted)throw Error('vod_resume_client_cancelled');
 const ctl=new AbortController();
 const signal=clientSignal?AbortSignal.any([ctl.signal,clientSignal]):ctl.signal;
 if(!Number.isSafeInteger(plan.rangeStart)||plan.rangeStart<0||
    !Number.isSafeInteger(plan.rangeEnd)||
    !Number.isSafeInteger(plan.fileTotal)||
    plan.rangeEnd-plan.rangeStart+1!==plan.total||
    plan.fileTotal<=plan.rangeEnd)throw Error('vod_resume_invalid_request');
 const start=plan.rangeStart+forwarded,end=plan.rangeEnd;
 const range='bytes='+start+'-'+end;
 const sendHeaders={
  'user-agent':String(headers['user-agent']||'BLOFY-Xtream-Range-Recovery/1.0').slice(0,160),
  'range':range,
  'if-range':plan.etag,
  'accept-encoding':'identity'
 };
 let reply,reader,got=0;
 try{
  const timeout=setTimeout(()=>ctl.abort(new Error('vod_resume_headers_timeout')),12000);
  timeout.unref?.();
  try{
   reply=await fetchImpl(url,{method:'GET',headers:sendHeaders,
    timeoutMs:12000,signal});
  }finally{clearTimeout(timeout)}
  const exact='bytes '+start+'-'+end+'/'+plan.fileTotal;
  if(reply?.status!==206||!reply.body||
     reply.headers.get('content-range')!==exact||
     positiveInteger(reply.headers.get('content-length'))!==plan.total-forwarded||
     reply.headers.get('etag')!==plan.etag||
     String(reply.headers.get('content-encoding')||'identity').toLowerCase()!=='identity'){
    throw Error('vod_resume_range_contract_denied');
  }
  reader=reply.body.getReader();
  for(;;){
   if(signal.aborted)throw Error('vod_resume_cancelled');
   const timer=setTimeout(()=>ctl.abort(new Error('vod_resume_read_timeout')),20000);
   timer.unref?.();
   let part;
   try{part=await reader.read()}finally{clearTimeout(timer)}
   if(part.done)break;
   if(!(part.value instanceof Uint8Array)||!part.value.byteLength)
    throw Error('vod_resume_invalid_bytes');
   got+=part.value.byteLength;
   if(got>plan.total-start)throw Error('vod_resume_overshoot');
   yield part.value;
  }
  if(got!==plan.total-start)throw Error('vod_resume_truncated');
 }finally{
  ctl.abort();
  try{await reader?.cancel()}catch{}
  try{reader?.releaseLock()}catch{}
  try{await reply?.body?.cancel()}catch{}
 }
}
