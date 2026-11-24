// BLOFY STREAM Web: bounded per-session page preview cache. No media,
// activation, entitlement, playlist credentials or search requests are cached.
// The caller must pass an opaque server-side HMAC key, never a raw token.
export function createCatalogPageCache({
 maxEntries=40, maxEntryBytes=160*1024, ttlMs=45000, now=Date.now
}={}){
 if(!(Number.isSafeInteger(maxEntries)&&maxEntries>=1&&maxEntries<=128)||
    !(Number.isSafeInteger(maxEntryBytes)&&maxEntryBytes>=1024&&maxEntryBytes<=1024*1024)||
    !(Number.isSafeInteger(ttlMs)&&ttlMs>=1000&&ttlMs<=120000))
  throw Error('invalid_catalog_cache_limits');
 const data=new Map();
 let hits=0,misses=0;
 function valid(key){return typeof key==='string'&&/^[a-f0-9]{64}$/.test(key)}
 function get(key){
  if(!valid(key))return null;
  const stored=data.get(key);
  if(!stored){misses++;return null}
  if(stored.expiresAt<=now()){data.delete(key);misses++;return null}
  // LRU touch on hit, bounded by count and max bytes of each value.
  data.delete(key);data.set(key,stored);hits++;
  return stored.payload
 }
 function put(key,payload){
  if(!valid(key)||!payload||!Array.isArray(payload.items)||
    typeof payload.kind!=='string'||payload.items.length>48||
    payload.hasMore!==true&&payload.hasMore!==false||
    !Number.isSafeInteger(payload.nextOffset)||payload.nextOffset<0)
    return false;
  let bytes=0;
  try{bytes=Buffer.byteLength(JSON.stringify(payload),'utf8')}catch{return false}
  if(bytes>maxEntryBytes)return false;
  if(data.has(key))data.delete(key);
  const when=now();
  data.set(key,{expiresAt:when+ttlMs,payload});
  for(const [k,v] of data){
   if(v.expiresAt<=when)data.delete(k)
  }
  while(data.size>maxEntries)data.delete(data.keys().next().value);
  return true
 }
 function stats(){return {entries:data.size,hits,misses}}
 return {get,put,stats}
}
