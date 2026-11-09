// Safe, bounded observation of synthetic restream health. No customer source requests.
// This module deliberately does NOT treat MediaMTX process reachability as proof
// that real channels or real subscribers can play.
const HISTORY_LIMIT=96;
const history=[];
const state={running:false,lastCheckAt:0,lastResult:null,consecutiveFailures:0};
const ALLOWED=new Set(['synthetic_hls_ts_verified','restream_not_configured',
 'restream_smoke_failed','restream_smoke_engine_unreachable','restream_smoke_not_published',
 'restream_smoke_auth_rejected','restream_smoke_http_error','restream_smoke_segment_missing',
 'restream_smoke_manifest_invalid','restream_smoke_not_mpegts','restream_smoke_redirect_invalid',
 'restream_smoke_response_too_large','restream_smoke_empty_body','restream_smoke_variant_missing']);
export function publicHealthSummary(){
 return {enabled:process.env.BLOFY_RESTREAM_AUTO_HEALTH==='1',scope:'synthetic_only',realSourceVerified:false,
  running:state.running,lastCheckAt:state.lastCheckAt?new Date(state.lastCheckAt).toISOString():null,
  lastResult:state.lastResult,consecutiveFailures:state.consecutiveFailures,
  alert:state.consecutiveFailures>=3?'synthetic_restream_repeated_failure':null,
  history:history.slice(-24)};
}
export async function checkRestreamHealth({probe,clock=Date.now,minIntervalMs=60000}={}){
 if(typeof probe!=='function')throw new TypeError('probe_required');
 const now=clock();
 if(state.running)return {ok:false,code:'health_check_busy',...publicHealthSummary()};
 if(now-state.lastCheckAt<minIntervalMs && state.lastCheckAt)
  return {ok:false,code:'health_check_cooldown',...publicHealthSummary()};
 state.running=true;state.lastCheckAt=now;
 try{
  const result=await probe();
  const safe={ok:result?.ok===true&&result?.mediaVerified===true,
   code:ALLOWED.has(result?.code)?result.code:'restream_smoke_failed',
   elapsedMs:Number.isFinite(result?.elapsedMs)?Math.min(Math.max(Math.round(result.elapsedMs),0),120000):null,
   checkedAt:new Date(now).toISOString(),realSourceVerified:false};
  if(!safe.ok)state.consecutiveFailures++;
  else state.consecutiveFailures=0;
  state.lastResult=safe;
  history.push(safe);
  while(history.length>HISTORY_LIMIT)history.shift();
  return {ok:safe.ok,...publicHealthSummary()};
 }catch{
  state.consecutiveFailures++;
  const safe={ok:false,code:'restream_smoke_failed',elapsedMs:null,checkedAt:new Date(now).toISOString(),realSourceVerified:false};
  state.lastResult=safe;history.push(safe);
  while(history.length>HISTORY_LIMIT)history.shift();
  return {ok:false,...publicHealthSummary()};
 }finally{state.running=false;}
}
export async function verifySyntheticConcurrency({probe,concurrency=5}={}){
 if(typeof probe!=='function')throw new TypeError('probe_required');
 // Hard limit prevents accidentally saturating production.
 if(!Number.isInteger(concurrency)||concurrency<2||concurrency>10)
  return {ok:false,code:'invalid_synthetic_concurrency',maximum:10};
 const started=Date.now();
 const results=await Promise.all(Array.from({length:concurrency},async()=>{
  try{const r=await probe();return {ok:r?.ok===true&&r?.mediaVerified===true,
   code:ALLOWED.has(r?.code)?r.code:'restream_smoke_failed'};}
  catch{return {ok:false,code:'restream_smoke_failed'};}
 }));
 return {ok:results.every(x=>x.ok),scope:'synthetic_only',
  realSourceVerified:false,concurrency,passed:results.filter(x=>x.ok).length,
  failed:results.filter(x=>!x.ok).length,
  codes:Object.fromEntries([...new Set(results.map(x=>x.code))].map(code=>
   [code,results.filter(x=>x.code===code).length])),
  elapsedMs:Date.now()-started};
}
export function resetRestreamHealthForTest(){
 state.running=false;state.lastCheckAt=0;state.lastResult=null;state.consecutiveFailures=0;
 history.length=0;
}
