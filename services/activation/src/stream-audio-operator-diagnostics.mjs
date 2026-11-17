// Authenticated owner-only, opt-in diagnostic for the configured radio catalog.
// This module never exposes upstream credentials/URLs and never contacts the
// provider on a read-only readiness request.
const TRACK=/^anis-[a-z0-9-]{1,54}$/;
const CODE=/^[a-z][a-z0-9_]{1,62}$/;

export function createStreamAudioOperatorDiagnostics({
  bridge,now=Date.now,cooldownMs=120000
}={}){
 if(!bridge||typeof bridge.catalog!=='function'||typeof bridge.probe!=='function')
   throw Error('audio_operator_bridge_required');
 let latest=null,checkedAt=0,attemptAt=0,running=false;
 function configuredTracks(){
   const catalog=bridge.catalog();
   const tracks=catalog.status===200&&Array.isArray(catalog.body?.tracks)?
     catalog.body.tracks:[];
   return tracks.filter(x=>TRACK.test(String(x?.id||''))).slice(0,40)
     .map(x=>({id:String(x.id),label:String(x.label||x.id).slice(0,80)}));
 }
 function readiness(){
  const tracks=configuredTracks();
  return {status:200,body:{ok:true,configured:tracks.length>0,
    tracks,probeInProgress:running,checkedAt:checkedAt||null,
    latest:latest?latest.map(x=>({...x})):null,
    onlyConfiguredProvider:true,noProbeOnRead:true,customerTrafficChanged:false}};
 }
 async function probe(ids){
  const rows=configuredTracks(),allow=new Set(rows.map(x=>x.id));
  if(!Array.isArray(ids)||ids.length<1||ids.length>2||
     new Set(ids).size!==ids.length||
     ids.some(id=>typeof id!=='string'||!TRACK.test(id)||!allow.has(id)))
   return {status:400,body:{ok:false,code:'audio_probe_tracks_invalid'}};
  if(running)return {status:429,body:{ok:false,code:'audio_probe_busy'}};
  const ts=now();
  const remaining=Math.max(0,cooldownMs-(ts-attemptAt));
  if(attemptAt&&remaining>0)
   return {status:429,body:{ok:false,code:'audio_probe_cooldown',
    retryAfterSeconds:Math.ceil(remaining/1000)}};
  attemptAt=ts;running=true;
  try{
   const results=await bridge.probe(ids);
   if(!Array.isArray(results)||results.length!==ids.length)
    return {status:503,body:{ok:false,code:'audio_probe_unavailable'}};
   // Only a fixed schema. Never copy upstream metadata, request objects,
   // error messages, provider URLs, radio tokens, or arbitrary body fields.
   latest=results.map((r,i)=>({
    id:ids[i],
    reason:CODE.test(String(r?.reason||''))?r.reason:'unknown',
    payloadClass:CODE.test(String(r?.payloadClass||''))?r.payloadClass:'unknown',
    httpStatus:Number.isSafeInteger(r?.httpStatus)&&r.httpStatus>=100&&
      r.httpStatus<=599?r.httpStatus:null,
    receivedBytes:Number.isSafeInteger(r?.receivedBytes)?
      Math.max(0,Math.min(4096,r.receivedBytes)):0,
    progressiveAudioDetected:r?.payloadClass==='audio_packet'&&
      r?.reason==='audio_bytes_detected'
   }));
   checkedAt=now();
   return {status:200,body:{ok:true,checkedAt,results:latest,
     checked:latest.length,mediaPlaybackVerified:false,
     sourceBytesStored:false,customerTrafficChanged:false}};
  }catch{
   return {status:503,body:{ok:false,code:'audio_probe_unavailable'}};
  }finally{running=false}
 }
 return {readiness,probe};
}
