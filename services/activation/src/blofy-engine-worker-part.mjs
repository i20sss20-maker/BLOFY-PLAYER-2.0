// Shared authenticated worker media reader for legacy TS and HLS canaries.
// Server-owned authorization must recheck account, catalog, viewer lease and
// current generation on every request. Never accept a URL supplied by a client.
const gen=/^[a-f0-9]{32}$/;
const pathPattern=/^\/v1\/([a-f0-9]{32})\/([a-f0-9]{32})\/(\d{10})\/[a-f0-9]{64}\/index\.m3u8$/;
export function createEngineWorkerPart({authorizeGrant,fetchImpl=fetch,enabled=false,clock=Date.now}={}){
 return async function read(context,{signal}={}){
  const deny=status=>({status,body:null});
  if(!enabled||typeof authorizeGrant!=='function')return deny(503);
  if(!gen.test(context?.generation??'')||
     !['hostbrr','linode'].includes(context?.engineId)||
     !/^(index\.m3u8|seg-[0-9]{9}\.ts)$/.test(context?.name??''))return deny(404);
  if(signal?.aborted)return deny(503);
  const grant=await authorizeGrant(context);
  const host=context.engineId==='hostbrr'?'media2.blofyplayer.com':'media.blofyplayer.com';
  const a=String(context.accountId??'').replaceAll('-','').toLowerCase();
  if(!grant?.ok||grant.mediaHost!==host||!gen.test(a))return deny(403);
  const m=pathPattern.exec(grant.path??''),now=clock();
  if(!m||m[1]!==context.generation||m[2]!==a||Number(m[3])*1000<=now+3000||Number(m[3])*1000>now+65000)return deny(403);
  if(signal?.aborted)return deny(503);
  const url='https://'+host+grant.path.slice(0,-'index.m3u8'.length)+context.name;
  const upstream=await fetchImpl(url,{method:'GET',redirect:'error',headers:{
   accept:context.name==='index.m3u8'?'application/vnd.apple.mpegurl':'video/mp2t','accept-encoding':'identity'
  },signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});
  if(upstream.status!==200||!upstream.body){
   await upstream.body?.cancel().catch(()=>{});return deny(502);
  }
  return {status:200,generation:context.generation,headers:upstream.headers,body:upstream.body};
 };
}
