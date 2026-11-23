// Read-only canary for the public STREAM updater metadata.
// Does not modify customer routing or serve private release data.
const ORIGIN='https://updates.blofyplayer.com/stream/release.json';
const MAX_BYTES=16384;
function validRelease(payload){
 const app=payload?.release?.app;
 return app&&typeof app==='object'&&
  app.packageName==='tv.blofy.player.v2.stream'&&
  Number.isSafeInteger(app.versionCode)&&app.versionCode>0&&
  typeof app.versionName==='string'&&app.versionName.length<=100&&
  /^[a-f0-9]{64}$/i.test(String(app.sha256||''))&&
  Number.isSafeInteger(app.apkSizeBytes)&&app.apkSizeBytes>1000000&&
  typeof app.downloadUrl==='string'&&
  app.downloadUrl==='https://updates.blofyplayer.com/d/blofy-stream';
}
export function createStreamFeedCanary({fetchImpl=globalThis.fetch,now=Date.now,
 freshMs=15000,staleMs=600000}={}){
 let cache=null,checkedAt=0,flight=null;
 const load=async()=>{
  if(flight)return flight;
  flight=(async()=>{
   const response=await fetchImpl(ORIGIN,{
    headers:{accept:'application/json','user-agent':'BLOFY-Feed-Canary/1.0'},
    signal:AbortSignal.timeout(5000),redirect:'error'
   });
   if(!response.ok)throw Error('feed_origin_unavailable');
   const length=Number(response.headers.get('content-length')||0);
   if(length>MAX_BYTES)throw Error('feed_too_large');
   const body=await response.text();
   if(Buffer.byteLength(body)>MAX_BYTES)throw Error('feed_too_large');
   const parsed=JSON.parse(body);
   if(!validRelease(parsed))throw Error('feed_invalid_release');
   cache=JSON.stringify(parsed);
   checkedAt=now();
   return {body:cache,stale:false};
  })().finally(()=>{flight=null;});
  return flight;
 };
 return {
  async read(){
   const age=now()-checkedAt;
   if(cache&&age>=0&&age<=freshMs)return {body:cache,stale:false};
   try{return await load()}catch{
    if(cache&&age>=0&&age<=staleMs)return {body:cache,stale:true};
    return null;
   }
  },
  status(){return {hasCache:cache!==null,checkedAt};},
  prime(){return load().catch(()=>null)}
 };
}
