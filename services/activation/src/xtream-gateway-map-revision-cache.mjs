// Prevent repeated full-library gateway mapping scans while the source
// catalogue revision is unchanged. Map IDs are stable: never delete/reissue.
// The caller must authorize the source as usual on every player request.
// Single-flight includes the cheap revision read to handle bursty clients.
export async function ensureRevisionAwareGatewayMap(cache,key,mapRows,readRevision,{
  ttlMs=60_000,now=Date.now
}={}){
  if(!(cache instanceof Map)||typeof key!=='string'||key.length>160||
    typeof mapRows!=='function'||typeof readRevision!=='function'||
    !Number.isSafeInteger(ttlMs)||ttlMs<1||typeof now!=='function')
    throw new TypeError('xtream_gateway_map_cache_invalid');
  const old=cache.get(key),at=now();
  if(old&&(!old.settled||at-old.startedAt<ttlMs))return old.promise;
  const entry={startedAt:at,settled:false,revision:null,promise:null};
  entry.promise=(async()=>{
    let revision=null;
    try{
      const value=await readRevision();
      if(typeof value==='string'&&/^[0-9]{1,32}$/.test(value)&&
        value!=='0')revision=value;
    }catch{
      // If the revision table is unavailable, use the original full
      // mapping work instead of trusting stale source entries.
    }
    entry.revision=revision;
    if(old?.settled&&revision!==null&&old.revision===revision)
      return old.promise;
    return mapRows();
  })();
  cache.set(key,entry);
  try{return await entry.promise;}
  catch(error){
    if(cache.get(key)===entry)cache.delete(key);
    throw error;
  }finally{entry.settled=true;}
}
