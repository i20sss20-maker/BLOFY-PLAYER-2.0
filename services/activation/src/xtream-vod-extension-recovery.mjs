// Optional source-scoped recovery for Xtream providers whose imported movie
// extension is stale. Do not guess file names or bypass authorization.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXT=/^(mp4|mkv|avi|mov|webm|ts)$/i;
const IDS=/^[A-Za-z0-9._-]{1,128}$/;

export function mayRefreshMovieExtension(sourceId,env=process.env){
  if(env.BLOFY_XTREAM_MOVIE_EXTENSION_REFRESH_ENABLED!=='1')return false;
  const ids=String(env.BLOFY_XTREAM_MOVIE_EXTENSION_REFRESH_SOURCE_IDS||'')
    .split(',').map(x=>x.trim().toLowerCase()).filter(x=>UUID.test(x));
  return ids.includes(String(sourceId||'').toLowerCase());
}
// Only trust a fresh provider get_vod_info response that names the EXACT same
// movie stream ID, and only if it explicitly advertises a distinct safe ext.
export function correctedMovieExtension(payload,sourceId,oldExtension){
  if(!IDS.test(String(sourceId||''))||!payload||typeof payload!=='object'||
     Array.isArray(payload))return null;
  const data=payload.movie_data;
  if(!data||typeof data!=='object'||Array.isArray(data)||
     String(data.stream_id??'')!==String(sourceId))return null;
  const extension=String(data.container_extension||'').trim().replace(/^\./,'').toLowerCase();
  if(!EXT.test(extension)||extension===String(oldExtension||'').toLowerCase())return null;
  return extension;
}

export function mayRefreshEpisodeExtension(sourceId,env=process.env){
  if(env.BLOFY_XTREAM_EPISODE_EXTENSION_REFRESH_ENABLED!=='1')return false;
  const ids=String(env.BLOFY_XTREAM_EPISODE_EXTENSION_REFRESH_SOURCE_IDS||'')
    .split(',').map(x=>x.trim().toLowerCase()).filter(x=>UUID.test(x));
  return ids.includes(String(sourceId||'').toLowerCase());
}
// A series may contain multiple seasons and hundreds of entries. Verify the
// exact existing episode ID from its parent series; never substitute an ID
// from another episode, or guess an extension not advertised by the provider.
export function correctedEpisodeExtension(payload,seriesId,episodeId,oldExtension){
  if(!IDS.test(String(seriesId||''))||!IDS.test(String(episodeId||''))||
     !payload||typeof payload!=='object'||Array.isArray(payload))return null;
  const data=payload.episodes;
  if(!data||typeof data!=='object')return null;
  const seasons=Array.isArray(data)?[data]:Object.values(data).slice(0,200);
  let seen=0;
  for(const season of seasons){
    if(!Array.isArray(season))continue;
    for(const item of season){
      if(++seen>12000)return null;
      if(!item||typeof item!=='object'||String(item.id??'')!==String(episodeId))continue;
      const ext=String(item.container_extension||'').trim().replace(/^\./,'').toLowerCase();
      return EXT.test(ext)&&ext!==String(oldExtension||'').toLowerCase()?ext:null;
    }
  }
  return null;
}
