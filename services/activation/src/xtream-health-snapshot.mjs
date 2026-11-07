// Public /xtream/health is informational, not an authentication decision.
// Cache its expensive full-catalog aggregation briefly and coalesce concurrent
// requests, while keeping account/player authorization database-backed.
export function createXtreamHealthSnapshot(load,{ttlMs=15_000,clock=()=>Date.now()}={}){
  if(typeof load!=='function'||typeof clock!=='function'||
      !Number.isSafeInteger(ttlMs)||ttlMs<1000||ttlMs>60000)
    throw new Error('xtream_health_cache_invalid');
  let value=null,validUntil=0,inflight=null;
  return function snapshot(){
    const now=clock();
    if(value!==null&&now<validUntil)return Promise.resolve(value);
    if(inflight)return inflight;
    inflight=Promise.resolve().then(load).then(result=>{
      if(result===null||typeof result!=='object')
        throw new Error('xtream_health_snapshot_invalid');
      value=result;
      validUntil=clock()+ttlMs;
      return result;
    }).finally(()=>{inflight=null;});
    return inflight;
  };
}
