// A BLOFY gateway episode ID must never silently become a different video.
// Accept provider-reported extensions and, only when the original provider ID
// disappeared, a unique season/episode match within that SAME source series.
const SAFE_EXT=/^(mp4|mkv|ts|m3u8|avi|mov|webm|flv|wmv)$/i;
const SAFE_ID=/^[A-Za-z0-9._-]{1,128}$/;

export function episodeOrdinal(value,{allowZero=false}={}){
  if(value===null||value===undefined||String(value).trim()==='')return null;
  const s=String(value).trim();
  if(!/^[0-9]{1,5}$/.test(s))return null;
  const n=Number(s);
  return Number.isSafeInteger(n)&&n<10000&&n>=(allowZero?0:1)?String(n):null;
}

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
  return {status:'missing'};
}

export function verifiedEpisodeRecovery(payload,sourceEpisodeId,currentExtension,seasonNumber,episodeNumber){
  const exact=verifiedEpisodeExtension(payload,sourceEpisodeId,currentExtension);
  // An existing ID may have a broken file at the provider. We must never
  // interpret that alone as permission to select another episode.
  if(exact.status!=='missing')return exact;
  const season=episodeOrdinal(seasonNumber,{allowZero:true});
  const number=episodeOrdinal(episodeNumber);
  if(season===null||number===null)return exact;
  const matches=[];
  let scanned=0;
  for(const [seasonKey,rows] of Object.entries(payload.episodes)){
    if(episodeOrdinal(seasonKey,{allowZero:true})!==season||!Array.isArray(rows))continue;
    for(const entry of rows){
      if(++scanned>15000)return {status:'unavailable'};
      if(episodeOrdinal(entry?.episode_num)!==number)continue;
      const id=String(entry?.id??'').trim();
      const extension=String(entry?.container_extension??'').trim().replace(/^\./,'').toLowerCase();
      if(!SAFE_ID.test(id)||!SAFE_EXT.test(extension))return {status:'missing'};
      matches.push({id,extension});
      if(matches.length>1)return {status:'missing'}; // ambiguous episode
    }
  }
  if(matches.length!==1)return exact;
  return {status:'relocated',sourceId:matches[0].id,extension:matches[0].extension};
}

// On a confirmed provider 404, the provider's catalog can occasionally still
// advertise .mp4 while the same episode ID only serves .mkv (or vice versa).
// Bound any fallback to two common containers for that SAME exact episode ID;
// do not vary host, identity, route, user, password or source.
export function sameEpisodeContainerCandidates(extension){
  const current=String(extension??'').trim().replace(/^\./,'').toLowerCase();
  if(!['mp4','mkv','ts'].includes(current))return [];
  return ['mp4','mkv','ts'].filter(candidate=>candidate!==current).slice(0,2);
}
