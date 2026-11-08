// Source-scoped, authenticated Xtream TS transport through standalone
// BLOFY STREAM. The BLOFY gateway checks subscription and catalog access first.
// Live TS remains separate. Movie/series traffic requires an independent,
// default-OFF per-source VOD opt-in. HLS remains unsupported by this relay.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STREAM='https://blofy-stream-api-production.up.railway.app';
export function shouldUseIndependentSourceMedia({sourceId,kind,extension},env=process.env){
 if(env.BLOFY_STREAM_RELAY_ORIGIN!==STREAM||
    String(env.BLOFY_STREAM_RELAY_SHARED_TOKEN||'').length<32)
   return false;
 const live=kind==='live'&&String(extension||'').toLowerCase()==='ts';
 const vod=['movie','series'].includes(kind)&&
   /^(mp4|mkv|avi|mov|webm|ts)$/i.test(String(extension||''))&&
   env.BLOFY_XTREAM_INDEPENDENT_VOD_PROXY_ENABLED==='1';
 if(!live&&!vod)return false;
 if(live&&env.BLOFY_XTREAM_INDEPENDENT_MEDIA_PROXY_ENABLED!=='1')return false;
 const sourceIds=live?env.BLOFY_XTREAM_INDEPENDENT_MEDIA_PROXY_SOURCE_IDS:
   env.BLOFY_XTREAM_INDEPENDENT_VOD_PROXY_SOURCE_IDS;
 const allowlist=new Set(
   String(sourceIds||'')
     .split(',').map(x=>x.trim().toLowerCase()).filter(x=>UUID.test(x))
 );
 return allowlist.has(String(sourceId||'').toLowerCase());
}

// Last-resort egress recovery for movie/episode transport failures only.
// Unlike the primary VOD relay switch, this cannot alter an already working
// response, and is never used for a provider HTTP denial or missing file.
export function shouldFallbackIndependentVod({sourceId,kind,extension},env=process.env){
 if(!['movie','series'].includes(kind)||
    !/^(mp4|mkv|avi|mov|webm|ts)$/i.test(String(extension||'')))return false;
 if(env.BLOFY_XTREAM_VOD_EGRESS_FALLBACK_ENABLED!=='1')return false;
 return shouldUseIndependentSourceMedia({sourceId,kind,extension},{
   ...env,BLOFY_XTREAM_INDEPENDENT_VOD_PROXY_ENABLED:'1',
   BLOFY_XTREAM_INDEPENDENT_VOD_PROXY_SOURCE_IDS:
     env.BLOFY_XTREAM_VOD_EGRESS_FALLBACK_SOURCE_IDS||''
 });
}
