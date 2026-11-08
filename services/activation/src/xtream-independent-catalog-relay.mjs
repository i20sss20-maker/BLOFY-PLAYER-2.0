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

// Strictly internal transport for a read-only manifest audit. Unlike catalog
// player_api.php traffic, this endpoint forwards a bounded text M3U stream.
// The operator must select an allowed source ID before calling this helper.
export async function fetchIndependentXtreamManifest(url,{
 env=process.env,fetchImpl=fetch,timeoutMs=105000
}={}){
 if(env.BLOFY_STREAM_RELAY_ORIGIN!==ENDPOINT||
   String(env.BLOFY_STREAM_RELAY_SHARED_TOKEN||'').length<32)
   throw Error('xtream_manifest_bridge_unavailable');
 const target=new URL(url);
 if(!['http:','https:'].includes(target.protocol)||
   !target.pathname.endsWith('/get.php')||
   !target.searchParams.get('username')||!target.searchParams.get('password')||
   target.searchParams.get('type')!=='m3u_plus'||
   target.searchParams.get('output')!=='ts'||
   [...target.searchParams.keys()].sort().join(',')!=='output,password,type,username')
   throw Error('xtream_manifest_url_invalid');
 try{
  return await fetchImpl(ENDPOINT+'/internal/xtream-manifest-relay',{
   method:'POST',redirect:'manual',
   headers:{authorization:'Bearer '+env.BLOFY_STREAM_RELAY_SHARED_TOKEN,
    'content-type':'application/json',accept:'audio/x-mpegurl'},
   body:JSON.stringify({sourceUrl:target.href}),
   signal:AbortSignal.timeout(Math.min(Math.max(1000,timeoutMs),120000))
  });
 }catch{throw Error('xtream_manifest_bridge_unreachable')}
}


// Operator-only comparison of the SAME media URL under standard client
// request headers. Only the hard-pinned internal STREAM service receives
// URLs; it returns sanitized HTTP statuses without any source URL or secrets.
export async function probeIndependentXtreamClientProfiles(samples,{
 env=process.env,fetchImpl=fetch
}={}){
 if(env.BLOFY_STREAM_RELAY_ORIGIN!==ENDPOINT||
    String(env.BLOFY_STREAM_RELAY_SHARED_TOKEN||'').length<32)
   throw Error('xtream_profile_diagnostic_unavailable');
 if(!Array.isArray(samples)||!samples.length||samples.length>3||
    samples.some(s=>!['movie','series'].includes(s?.kind)||
      typeof s?.sourceUrl!=='string'||s.sourceUrl.length>1500))
   throw Error('xtream_profile_samples_invalid');
 const response=await fetchImpl(ENDPOINT+'/internal/xtream-media-client-profiles',{
   method:'POST',redirect:'manual',
   headers:{authorization:'Bearer '+env.BLOFY_STREAM_RELAY_SHARED_TOKEN,
    'content-type':'application/json',accept:'application/json'},
   body:JSON.stringify({samples}),signal:AbortSignal.timeout(95000)
 });
 if(response.status!==200)throw Error('xtream_profile_diagnostic_http');
 const size=Number(response.headers.get('content-length')||0);
 if(size>12000)throw Error('xtream_profile_diagnostic_oversized');
 const body=await response.text();
 if(body.length>12000)throw Error('xtream_profile_diagnostic_oversized');
 let parsed;
 try{parsed=JSON.parse(body)}catch{throw Error('xtream_profile_diagnostic_invalid')}
 if(parsed?.ok!==true||!Array.isArray(parsed.samples))throw Error('xtream_profile_diagnostic_invalid');
 // Return fixed, allowlisted categories rather than trusting an arbitrary
 // object returned from a remote service to be safe for production logs.
 const profiles=new Set(['relay_range','relay_plain','player_plain']);
 const codes=new Set(['provider_not_found','provider_forbidden','provider_limited',
   'other_http','media_checked','empty_body','timeout','connection_reset',
   'unavailable','redirect_limit','cross_origin_redirect_disallowed',
   'outside_source_allowlist']);
 return {ok:true,samples:parsed.samples.slice(0,3).map(s=>({
   index:Number.isInteger(s?.index)?s.index:null,
   kind:['movie','series'].includes(s?.kind)?s.kind:null,
   checks:(Array.isArray(s?.checks)?s.checks:[]).slice(0,3).map(x=>({
     profile:profiles.has(x?.profile)?x.profile:'unknown',
     status:Number.isInteger(x?.status)&&x.status>=100&&x.status<=599?x.status:null,
     mediaBytes:x?.mediaBytes===true,
     code:codes.has(x?.code)?x.code:'other',
     redirects:Number.isInteger(x?.redirects)&&x.redirects>=0&&x.redirects<=2?x.redirects:0,
     crossOriginRedirect:x?.crossOriginRedirect===true
   }))
 }))};
}
