// Source-scoped, authenticated Xtream TS transport through standalone
// BLOFY STREAM. Existing BLOFY gateway still checks account authorization,
// expiry and catalog access. Movies, episodes and HLS are never switched here.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STREAM='https://blofy-stream-api-production.up.railway.app';
export function shouldUseIndependentSourceMedia({sourceId,kind,extension},env=process.env){
 if(env.BLOFY_XTREAM_INDEPENDENT_MEDIA_PROXY_ENABLED!=='1'||
    env.BLOFY_STREAM_RELAY_ORIGIN!==STREAM||
    String(env.BLOFY_STREAM_RELAY_SHARED_TOKEN||'').length<32)
   return false;
 if(kind!=='live'||String(extension||'').toLowerCase()!=='ts')
   return false;
 const allowlist=new Set(
   String(env.BLOFY_XTREAM_INDEPENDENT_MEDIA_PROXY_SOURCE_IDS||'')
     .split(',').map(x=>x.trim().toLowerCase()).filter(x=>UUID.test(x))
 );
 return allowlist.has(String(sourceId||'').toLowerCase());
}
