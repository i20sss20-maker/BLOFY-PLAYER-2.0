// Small per-process cache for public, already-sanitized Xtream metadata.
// ACL and source-enabled status MUST be checked by the caller on every hit.
// Never use this cache for credentials, live video, segments or user sessions.
export function createXtreamPublicInfoCache({
  ttlMs=45000,maxEntries=32,maxValueBytes=262144,maxTotalBytes=4194304,
  now=Date.now
}={}){
  if(!Number.isSafeInteger(ttlMs)||ttlMs<1||!Number.isSafeInteger(maxEntries)||maxEntries<1||
     !Number.isSafeInteger(maxValueBytes)||maxValueBytes<1||
     !Number.isSafeInteger(maxTotalBytes)||maxTotalBytes<maxValueBytes||
     typeof now!=='function')throw new TypeError('xtream_info_cache_invalid_config');
  const entries=new Map();
  let size=0;
  function drop(key,entry){
    if(entries.get(key)===entry){entries.delete(key);size-=entry.bytes||0;}
  }
  function prune(){
    const current=now();
    for(const [key,entry] of entries)if(!entry.pending&&entry.expires<=current)drop(key,entry);
    for(const [key,entry] of entries){
      if(entries.size<=maxEntries&&size<=maxTotalBytes)break;
      if(!entry.pending)drop(key,entry);
    }
  }
  async function get(key,loader){
    if(typeof key!=='string'||key.length>256||typeof loader!=='function')
      throw new TypeError('xtream_info_cache_invalid_request');
    prune();
    const old=entries.get(key);
    if(old&&(old.pending||old.expires>now()))return old.promise;
    if(old)drop(key,old);
    const entry={pending:true,expires:0,bytes:0,promise:null};
    entry.promise=Promise.resolve().then(loader);
    entries.set(key,entry);
    try{
      const value=await entry.promise;
      if(entries.get(key)===entry){
        let bytes=maxValueBytes+1;
        try{bytes=Buffer.byteLength(JSON.stringify(value));}catch{}
        if(value==null||bytes>maxValueBytes)drop(key,entry);
        else{
          entry.pending=false;
          entry.expires=now()+ttlMs;
          entry.bytes=bytes;
          size+=bytes;
          prune();
        }
      }
      return value;
    }catch(error){
      drop(key,entry);
      throw error;
    }
  }
  return {get};
}
