// Protected Xtream catalog API data-plane route. Original portal retains
// account/playlist authority in PostgreSQL and sends only an allowlisted
// source to the isolated Railway service over HTTPS. Default OFF.
const ENDPOINT='https://blofy-stream-api-production.up.railway.app';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function shouldUseIndependentXtreamSource(sourceId,env=process.env){
 if(env.BLOFY_XTREAM_INDEPENDENT_API_ENABLED!=='1'||env.BLOFY_STREAM_RELAY_ORIGIN!==ENDPOINT
    ||String(env.BLOFY_STREAM_RELAY_SHARED_TOKEN||'').length<32)return false;
 const selected=new Set(String(env.BLOFY_XTREAM_INDEPENDENT_API_SOURCE_IDS||'')
    .split(',').map(x=>x.trim().toLowerCase()).filter(x=>UUID.test(x)));
 return selected.has(String(sourceId||'').toLowerCase());
}
export async function fetchIndependentXtreamSource(url,{
 env=process.env,fetchImpl=fetch,timeoutMs=30000
}={}){
 if(env.BLOFY_STREAM_RELAY_ORIGIN!==ENDPOINT||
     String(env.BLOFY_STREAM_RELAY_SHARED_TOKEN||'').length<32)
   throw new Error('xtream_independent_gateway_disabled');
 const target=new URL(url);
 if(!['http:','https:'].includes(target.protocol)||
   !target.pathname.endsWith('/player_api.php')||
   !target.searchParams.get('username')||!target.searchParams.get('password'))
   throw new Error('xtream_independent_source_invalid');
 // Authenticated service-to-service HTTPS. Source credentials are in body
 // only, never in client-facing URL, logs or HTTP response headers.
 let response;
 try{
  response=await fetchImpl(ENDPOINT+'/internal/xtream-catalog-relay',{
   method:'POST',redirect:'manual',
   headers:{'authorization':'Bearer '+env.BLOFY_STREAM_RELAY_SHARED_TOKEN,
     'content-type':'application/json','accept':'application/json'},
   body:JSON.stringify({sourceUrl:target.href}),
   signal:AbortSignal.timeout(Math.max(1000,Math.min(timeoutMs+5000,190000)))
  });
 }catch{throw new Error('xtream_independent_transport_unavailable');}
 if(response.status>=300&&response.status<=399){
  await response.body?.cancel().catch(()=>{});
  throw new Error('xtream_independent_redirect_rejected');
 }
 return response;
}
