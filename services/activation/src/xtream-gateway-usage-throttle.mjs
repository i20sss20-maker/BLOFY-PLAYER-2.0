// Account checks always hit PostgreSQL so revocations and expirations take
// effect immediately. Only the optional "last used" write is coalesced.
// This avoids one extra UPDATE for every Xtream metadata/list request.
export function createGatewayUsageThrottle({
  intervalMs=60_000,maxEntries=4096,clock=()=>Date.now()
}={}){
  if(!Number.isSafeInteger(intervalMs)||intervalMs<1000||
      !Number.isSafeInteger(maxEntries)||maxEntries<1||
      typeof clock!=='function')
    throw new Error('xtream_usage_throttle_invalid');
  const lastWrites=new Map();
  return {
    shouldWrite(key){
      const id=String(key||'');
      if(!id)return false;
      const now=clock();
      if(!Number.isFinite(now))return false;
      const previous=lastWrites.get(id);
      if(previous!==undefined&&now-previous<intervalMs)return false;
      // Bound memory even if thousands of distinct accounts connect.
      lastWrites.delete(id);
      if(lastWrites.size>=maxEntries)lastWrites.delete(lastWrites.keys().next().value);
      lastWrites.set(id,now);
      return true;
    },
    // A failed DB write may be attempted again on the next verified request.
    forget(key){lastWrites.delete(String(key||''));},
    get size(){return lastWrites.size;}
  };
}
