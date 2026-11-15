// Memory-only, bounded, rights-scoped optimization for short verified S3
// timeline clips on the private STREAM owner website. Never disk/persistent,
// never customer routes, never provider Xtream media access.
const SHA=/^[a-f0-9]{64}$/, RUN=/^[A-Za-z0-9_-]{8,80}$/;
const MAX_CLIP=18*1024*1024;
const MAX_CACHE=36*1024*1024;
const TTL_MS=90*1000;
function safeKey({mediaKind,runId,sha256,originalFileBytes,segment}={}){
 if(!['movie','episode'].includes(mediaKind)||
   !RUN.test(String(runId||''))||!SHA.test(String(sha256||''))||
   !Number.isSafeInteger(originalFileBytes)||originalFileBytes<2048||
   originalFileBytes>4*1024**3||
   !Number.isSafeInteger(segment)||segment<0||segment>1199)return null;
 return mediaKind+':'+runId+':'+sha256+':'+originalFileBytes+':'+segment;
}
export function createPrivateTimelineClipCache({
 clock=()=>Date.now(),ttlMs=TTL_MS,maxBytes=MAX_CACHE,maxEntries=2
}={}){
 if(!Number.isSafeInteger(ttlMs)||ttlMs<1000||ttlMs>180000||
    !Number.isSafeInteger(maxBytes)||maxBytes<MAX_CLIP||maxBytes>MAX_CACHE||
    !Number.isSafeInteger(maxEntries)||maxEntries<1||maxEntries>2)
  throw Error('private_timeline_cache_limits_invalid');
 const entries=new Map();
 let used=0;
 function prune(){
  for(const [key,entry] of entries){
   if(entry.expiresAt<=clock()){
    used-=entry.clip.bytes.byteLength;
    entries.delete(key);
   }
  }
 }
 function dropOldest(){
  const oldest=entries.keys().next().value;
  if(oldest===undefined)return;
  used-=entries.get(oldest).clip.bytes.byteLength;
  entries.delete(oldest);
 }
 return {
  get(selection){
   prune();
   const key=safeKey(selection);if(!key)return null;
   const stored=entries.get(key);if(!stored)return null;
   // LRU promotion; the cache never persists or sends cryptographic keys.
   entries.delete(key);entries.set(key,stored);
   return {...stored.clip,cachedInPrivateMemory:true};
  },
  put(selection,clip){
   prune();
   const key=safeKey(selection);
   const length=clip?.bytes?.byteLength||0;
   if(!key||clip?.ok!==true||!Buffer.isBuffer(clip.bytes)||
      length<2048||length>MAX_CLIP||length>maxBytes||
      clip.segmentIndex!==selection.segment||
      clip.startSeconds!==selection.segment*30||
      clip.mediaKind!==selection.mediaKind||
      clip.runId!==selection.runId||
      clip.originalFileBytes!==selection.originalFileBytes||
      !(clip.segmentDurationSeconds>0&&clip.segmentDurationSeconds<=30))
    return false;
   if(entries.has(key)){
    used-=entries.get(key).clip.bytes.byteLength;
    entries.delete(key);
   }
   while(entries.size>=maxEntries||used+length>maxBytes)dropOldest();
   entries.set(key,{clip:{...clip,cachedInPrivateMemory:true},
    expiresAt:clock()+ttlMs});
   used+=length;
   return true;
  },
  clear(){entries.clear();used=0},
  status(){prune();return {entries:entries.size,bytes:used,maxBytes,
    privateOnly:true,customerCutover:false}}
 };
}
