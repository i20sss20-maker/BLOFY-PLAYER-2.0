// Public, read-only and credential-free health probes for owned BLOFY services.
// Never proxy URLs supplied by callers, return upstream bodies, or probe media.
// A transport/HTTP health result does NOT establish licensed playback.
const FIXED_HEALTH_CHECKS=Object.freeze([
  Object.freeze({key:'downloads',url:'https://updates.blofyplayer.com/health'}),
  Object.freeze({key:'stream',url:'https://blofy-stream-api-production.up.railway.app/health'})
]);

export function createPublicSystemHealth({
  fetchImpl=fetch,clock=()=>Date.now(),ttlMs=30000,timeoutMs=5000
}={}){
  if(typeof fetchImpl!=='function'||typeof clock!=='function'||
     !Number.isInteger(ttlMs)||ttlMs<5000||ttlMs>120000||
     !Number.isInteger(timeoutMs)||timeoutMs<250||timeoutMs>10000)
    throw new Error('system_health_config_invalid');
  let cached=null,cacheUntil=0,inflight=null;

  async function probe(entry){
    const abort=new AbortController();
    const timer=setTimeout(()=>abort.abort(),timeoutMs);
    timer.unref?.();
    try{
      const response=await fetchImpl(entry.url,{
        method:'GET',redirect:'manual',cache:'no-store',
        headers:{accept:'application/json'},signal:abort.signal
      });
      if(response.status!==200)return {status:'degraded'};
      const body=await response.json();
      // Intentionally expose just a fixed status enum, never upstream
      // catalog, subscriber counts, credentials, provider names or URLs.
      return {status:body?.ok===true?'healthy':'degraded'};
    }catch{
      return {status:'unknown'};
    }finally{clearTimeout(timer)}
  }

  function snapshot(){
    if(cached&&clock()<cacheUntil)return Promise.resolve(cached);
    if(inflight)return inflight;
    inflight=Promise.all(FIXED_HEALTH_CHECKS.map(async check=>
      [check.key,await probe(check)]
    )).then(rows=>{
      const services=Object.fromEntries(rows);
      cached={ok:true,checkedAt:new Date(clock()).toISOString(),services,
        scope:'HTTP health only; media playback and source rights not verified'};
      cacheUntil=clock()+ttlMs;
      return cached;
    }).finally(()=>{inflight=null});
    return inflight;
  }

  return {snapshot};
}
