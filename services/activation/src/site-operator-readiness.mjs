// Owner-only, read-only readiness of the REAL BLOFY STREAM operator actions.
// No client supplied URLs, no mutations and no response bodies returned to UI.
// This does NOT validate actual subscriber playback, data writes, or copying.
const ORIGIN='https://blofy-stream-api-production.up.railway.app';
const TIMEOUT_MS=4500;
const MAX_BODY=128*1024;
const READINESS=Object.freeze([
  Object.freeze({id:'overview',label:'حالة لوحة STREAM',path:'/operator/api/overview'}),
  Object.freeze({id:'sources',label:'مصادر Xtream',path:'/operator/api/sources'}),
  Object.freeze({id:'library',label:'فهرس المكتبة',path:'/operator/api/content-hub/status'}),
  Object.freeze({id:'accounts',label:'المشتركون',path:'/operator/api/accounts?offset=0'}),
  Object.freeze({id:'codes',label:'أكواد الاشتراك',path:'/operator/api/codes?offset=0'}),
  Object.freeze({id:'distributors',label:'لوحات الموزعين',path:'/operator/api/distributors'}),
  Object.freeze({id:'restream',label:'البث والمراقبة',path:'/operator/api/auto-health'}),
  Object.freeze({id:'security',label:'حماية لوحة الإدارة',path:'/operator/api/security'})
]);

export const SITE_OPERATOR_READINESS_TARGETS=READINESS;

function unknown(target,code,status=null,durationMs=null) {
  return {id:target.id,label:target.label,state:'unknown',code,httpStatus:status,latencyMs:durationMs};
}
function classify(target,status,payload,latency) {
  let state,code;
  if(status===401||status===403){state='blocked';code='operator_backend_auth_denied';}
  else if(status>=500){state='unavailable';code='operator_backend_error';}
  else if(status<200||status>=300){state='unavailable';code='operator_route_unavailable';}
  else if(payload?.ok===false||payload?.healthy===false||payload?.status==='unhealthy'||
    payload?.status==='error'){
    state='degraded';code='operator_reported_unhealthy';
  }else if(payload?.ok===true){
    state='connected';code='operator_read_ok';
  }else{
    state='reachable';code='operator_http_ok_only';
  }
  return {id:target.id,label:target.label,state,code,httpStatus:status,latencyMs:latency};
}

// Return JSON only when it fits the fixed limit. A large catalog can be
// reachable but never counted as verified if it exceeds the cap.
async function boundedJson(response) {
  const type=response.headers.get('content-type')||'';
  if(!/application\/(?:json|[a-z0-9.+-]+\+json)\b/i.test(type)) {
    try{await response.body?.cancel()}catch{}
    return null;
  }
  const declared=Number(response.headers.get('content-length'));
  if(Number.isFinite(declared)&&declared>MAX_BODY){
    try{await response.body?.cancel()}catch{}
    return null;
  }
  if(!response.body)return null;
  const reader=response.body.getReader();
  let size=0,parts=[];
  try{
    for(;;){
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>MAX_BODY)return null;
      parts.push(Buffer.from(value));
    }
    const value=JSON.parse(Buffer.concat(parts).toString('utf8'));
    return value&&typeof value==='object'?value:null;
  }catch{return null}
  finally{try{await reader.cancel()}catch{}try{reader.releaseLock()}catch{}}
}

export async function probeSiteOperatorAction(target,{
  secret=process.env.BLOFY_STREAM_OPERATOR_PROXY_TOKEN||'',
  fetchImpl=fetch,clock=Date.now
}={}){
  if(!READINESS.some(item=>item===target))return unknown(target,'unknown_readiness_target');
  if(typeof secret!=='string'||secret.length<40)
    return unknown(target,'operator_bridge_not_configured');
  const started=clock(),ctl=new AbortController();
  const timer=setTimeout(()=>ctl.abort(),TIMEOUT_MS);
  const url=new URL(target.path,ORIGIN);
  try{
    const response=await fetchImpl(url.toString(),{
      method:'GET',redirect:'manual',signal:ctl.signal,
      headers:{
        authorization:'Basic '+Buffer.from('operator:'+secret).toString('base64'),
        accept:'application/json',
        'accept-encoding':'identity',
        'user-agent':'BLOFY-Site-Readiness/1.0'
      }
    });
    const latencyMs=Math.max(0,clock()-started);
    if(response.status>=300&&response.status<400){
      try{await response.body?.cancel()}catch{}
      return unknown(target,'operator_redirect_rejected',response.status,latencyMs);
    }
    const payload=response.status>=200&&response.status<300?
      await boundedJson(response):null;
    if(payload===null)try{await response.body?.cancel()}catch{}
    return classify(target,response.status,payload,latencyMs);
  }catch{
    return unknown(target,ctl.signal.aborted?'operator_probe_timeout':'operator_probe_network_error',
      null,Math.max(0,clock()-started));
  }finally{clearTimeout(timer)}
}

export async function siteOperatorReadiness(options={}){
  const checks=await Promise.all(READINESS.map(t=>probeSiteOperatorAction(t,options)));
  return {
    scope:'Real STREAM operator read-only GET endpoints only; no POST, customer writes, source connection, audio/video proof, or media transfer',
    lastCheckedAt:new Date().toISOString(),
    checks,
    summary:{
      connected:checks.filter(x=>x.state==='connected').length,
      reachable:checks.filter(x=>x.state==='reachable').length,
      degraded:checks.filter(x=>x.state==='degraded').length,
      unavailable:checks.filter(x=>x.state==='unavailable'||x.state==='blocked').length,
      unknown:checks.filter(x=>x.state==='unknown').length
    }
  };
}
