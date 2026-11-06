// Safe, provider-declared media alternatives for a *specific* original Xtream
// item. Do not guess titles, seasons, IDs, files, other accounts or hosts.
const MEDIA_EXT=/^(?:mp4|mkv|ts|m3u8|avi|mov|webm|flv|wmv)$/;
const MEDIA_ID=/^[a-z0-9._-]{1,128}$/i;

function getExactItem(payload,kind,itemId){
  if(!payload||typeof payload!=='object'||!MEDIA_ID.test(String(itemId||'')))return null;
  if(kind==='movie'){
    const row=payload.movie_data;
    if(!row||typeof row!=='object'||Array.isArray(row))return null;
    // VOD info is requested by the authenticated account's exact vod_id.
    // If it explicitly reports another ID, refuse to play someone else's film.
    if(row.stream_id!==undefined&&row.stream_id!==null&&
       String(row.stream_id)!==String(itemId))return null;
    return row;
  }
  if(kind!=='series'||!payload.episodes||typeof payload.episodes!=='object')return null;
  let match=null,count=0;
  for(const rows of Object.values(payload.episodes)){
    if(!Array.isArray(rows))continue;
    for(const episode of rows){
      if(!episode||String(episode.id??'')!==String(itemId))continue;
      match=episode;
      if(++count>1)return null;
    }
  }
  return match;
}

// Only official, individual get_vod_info / get_series_info direct_source values
// may become a candidate. Plaintext HTTP and any relative URI must remain
// on the original authorized source origin; HTTPS CDN links must still pass
// the caller's public DNS checks. No provider-supplied URL is used unverified.
export function authorizedXtreamDirectUrl(raw,baseUrl){
  if(typeof raw!=='string'||!raw.trim()||raw.length>4096)return null;
  const value=raw.trim();
  // Disallow protocol-relative links, backslashes and bare URI schemes. A
  // relative path is accepted only as a local URL from the configured host.
  if(value.startsWith('//')||value.includes('\\')||
     (!/^https?:\/\//i.test(value)&&/^[a-z][a-z0-9+.-]*:/i.test(value)))
    return null;
  let url,base;
  try{
    base=new URL(baseUrl);
    url=/^https?:\/\//i.test(value)?new URL(value):new URL(value,base.href.replace(/\/?$/,'/'));
  }catch{return null}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.hash)return null;
  if(!/^https?:\/\//i.test(value)&&url.origin!==base.origin)return null;
  if(url.protocol==='http:'&&url.origin!==base.origin)return null;
  if(url.hostname==='localhost'||url.hostname.endsWith('.local')||
     url.hostname.endsWith('.localhost'))return null;
  // The caller always verifies public network addresses on each fetch.
  return url.toString();
}

export function authoritativeXtreamMediaCandidates(payload,{kind,itemId,baseUrl,currentExtension}={}){
  const entry=getExactItem(payload,kind,itemId);
  if(!entry)return [];
  const candidates=[];
  // Some Xtream variants put direct_source under movie_data, info or the
  // exact episode's info. Never read a sibling episode's direct_source.
  const directFields=[entry.direct_source,entry?.info?.direct_source];
  if(kind==='movie'){
    directFields.push(payload?.info?.direct_source,payload?.direct_source);
  }
  for(const directValue of directFields){
    const direct=authorizedXtreamDirectUrl(directValue,baseUrl);
    if(direct&&!candidates.some(x=>x.url===direct))
      candidates.push({kind:'provider_direct',url:direct});
  }
  const declared=String(entry.container_extension??'').trim().replace(/^\./,'').toLowerCase();
  const current=String(currentExtension??'').trim().replace(/^\./,'').toLowerCase();
  if(MEDIA_EXT.test(declared)&&MEDIA_EXT.test(current)&&declared!==current)
    candidates.push({kind:'provider_extension',extension:declared});
  return candidates.slice(0,4);
}
