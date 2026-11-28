// Small bounded security primitives for authenticated control-plane requests.
// Keys must be opaque HMAC identifiers, never credentials or IP addresses.
export function createAdmission({limit=6,windowMs=60000,maxKeys=2048,maxInflight=32,perKeyInflight=1,clock=Date.now}={}){
 const entries=new Map();let inflight=0;
 function prune(now){for(const [key,e] of entries)if(e.until<=now&&!e.active)entries.delete(key)}
 function acquire(key){
  const now=clock();prune(now);let e=entries.get(key);
  if(!e){if(entries.size>=maxKeys)return {ok:false,retryAfter:Math.ceil(windowMs/1000)};e={until:now+windowMs,used:0,active:0,generation:0};entries.set(key,e)}
  if(e.until<=now){e.until=now+windowMs;e.used=0}
  if(e.used>=limit||e.active>=perKeyInflight||inflight>=maxInflight)return {ok:false,retryAfter:e.used>=limit?Math.max(1,Math.ceil((e.until-now)/1000)):1};
  e.used++;e.active++;inflight++;const generation=e.generation;let finished=false;
  return {ok:true,current:()=>!finished&&e.generation===generation,release(){if(finished)return;finished=true;e.active--;inflight--}};
 }
 return {acquire,revoke(key){const e=entries.get(key);if(e)e.generation++},snapshot(){return {keys:entries.size,inflight}}};
}
export async function readBoundedJson(req,maxBytes,timeoutMs=5000){
 const declared=req.headers.get('content-length');
 if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>maxBytes))return {ok:false,status:413};
 if(!req.body)return {ok:false,status:400};
 const reader=req.body.getReader();let size=0,reads=0,timedOut=false;
 // Fixed memory per JSON reader, even for excessively fragmented requests.
 const data=new Uint8Array(maxBytes);
 const expires=performance.now()+timeoutMs;
 const cancel=()=>{try{void reader.cancel().catch(()=>{})}catch{}};
 const timer=setTimeout(()=>{timedOut=true;cancel()},timeoutMs);
 try{
  while(true){
   if(timedOut||performance.now()>=expires){cancel();return {ok:false,status:408}}
   const {done,value}=await reader.read();
   if(timedOut||performance.now()>=expires){cancel();return {ok:false,status:408}}
   if(done)break;
   // Limit pathological zero-length/tiny chunk floods independently of bytes.
   if(++reads>4096||value.byteLength>maxBytes-size){cancel();return {ok:false,status:413}}
   data.set(value,size);size+=value.byteLength;
   if(reads%64===0)await new Promise(resolve=>setTimeout(resolve,0));
  }
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data.subarray(0,size)));
  if(!value||typeof value!=='object'||Array.isArray(value))return {ok:false,status:400};
  return {ok:true,value};
 }catch{return {ok:false,status:timedOut?408:400}}finally{clearTimeout(timer);try{reader.releaseLock()}catch{}}
}

 // Never translate an upstream outage into a revoked subscription.
export function sessionFailure(status){
 return status===401||status===403?{status,body:{active:false}}:
  {status:503,body:{error:'session_unavailable'}};
}
export function createPlaybackMetrics({clock=Date.now,maxBuckets=32}={}){
 const buckets=new Map();
 const bounds=[1000,3000,5000,10000,20000,60000];
 function record({kind,runtime,phase,firstPictureMs}){
  if(!['live','movie','series'].includes(kind)||!['installed','browser','preview','unknown'].includes(runtime))return false;
  const key=kind+':'+runtime;
  if(!buckets.has(key)){if(buckets.size>=maxBuckets)return false;buckets.set(key,{kind,runtime,events:0,starts:0,firstPictures:0,failures:0,firstPictureHistogram:Array(bounds.length+1).fill(0)})}
  const b=buckets.get(key);b.events++;
  if(phase==='live_start'||phase==='vod_full_start')b.starts++;
  if(['media_error','mpegts_error','startup_timeout','hls_error','play_rejected'].includes(phase))b.failures++;
  if(phase==='first_picture'&&Number.isInteger(firstPictureMs)&&firstPictureMs>=0&&firstPictureMs<=120000){
   b.firstPictures++;let i=bounds.findIndex(n=>firstPictureMs<=n);if(i<0)i=bounds.length;b.firstPictureHistogram[i]++;
  }
  return true
 }
 function drain(){const data={at:clock(),firstPictureBoundsMs:bounds.slice(),buckets:[...buckets.values()]};buckets.clear();return data}
 return {record,drain};
}
