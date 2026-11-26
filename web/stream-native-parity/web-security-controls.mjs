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
export async function readBoundedJson(req,maxBytes){
 const declared=req.headers.get('content-length');
 if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>maxBytes))return {ok:false,status:413};
 if(!req.body)return {ok:false,status:400};
 const reader=req.body.getReader();let size=0;const chunks=[];
 try{
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){try{await reader.cancel()}catch{};return {ok:false,status:413}}chunks.push(value)}
  const data=new Uint8Array(size);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.byteLength}
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));
  if(!value||typeof value!=='object'||Array.isArray(value))return {ok:false,status:400};
  return {ok:true,value};
 }catch{return {ok:false,status:400}}finally{try{reader.releaseLock()}catch{}}
}
