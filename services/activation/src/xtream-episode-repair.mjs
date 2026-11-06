// Repair Xtream episode file extensions only from the same provider's
// authoritative get_series_info payload. Never invent an episode ID, guess
// a host or change a subscriber's source when an upstream returns 404.
const SAFE_EXT=/^(mp4|mkv|ts|m3u8|avi|mov|webm|flv|wmv)$/i;

export function verifiedEpisodeExtension(payload,sourceEpisodeId,currentExtension){
  const id=String(sourceEpisodeId??'');
  const lists=payload?.episodes;
  if(!id||!lists||typeof lists!=='object'||Array.isArray(lists))
    return {status:'unavailable'};
  let inspected=0;
  for(const values of Object.values(lists)){
    if(!Array.isArray(values))continue;
    for(const entry of values){
      if(++inspected>15000)return {status:'unavailable'};
      if(!entry||String(entry.id??'')!==id)continue;
      const raw=String(entry.container_extension??'').trim().replace(/^\./,'').toLowerCase();
      if(!SAFE_EXT.test(raw))return {status:'unavailable'};
      if(raw===String(currentExtension??'').replace(/^\./,'').toLowerCase())
        return {status:'unchanged',extension:raw};
      return {status:'changed',extension:raw};
    }
  }
  // The old ID is no longer advertised for this series. Do not map it to
  // another episode by guesswork (that could show the wrong content).
  return {status:'missing'};
}
