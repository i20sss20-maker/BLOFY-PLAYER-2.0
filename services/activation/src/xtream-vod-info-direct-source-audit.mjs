// Redacted, read-only answer to one question: does official get_vod_info
// advertise a legitimate alternate URL for the SAME saved movie ID?
// This module never constructs a media URL, fetches it or returns its token.
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const EXT=/^(mp4|mkv|avi|mov|webm|ts)$/i;
function directPresent(value){
 if(typeof value!=='string'||value.length>2000)return false;
 try{
  const u=new URL(value.trim());
  return ['http:','https:'].includes(u.protocol)&&
   !u.username&&!u.password&&Boolean(u.hostname);
 }catch{return false;}
}
export function inspectSameXtreamVodInfo(payload,expectedId,expectedExtension){
 if(!ID.test(String(expectedId||''))||!payload||
    typeof payload!=='object'||Array.isArray(payload))
  return {ok:false,code:'info_invalid'};
 const movie=payload.movie_data;
 if(!movie||typeof movie!=='object'||String(movie.stream_id??'')!==String(expectedId))
  return {ok:false,code:'movie_id_mismatch'};
 const ext=String(movie.container_extension||'').replace(/^\./,'').toLowerCase();
 const original=String(expectedExtension||'').replace(/^\./,'').toLowerCase();
 return {ok:true,code:'same_id',
  extensionMatches:EXT.test(ext)&&ext===original,
  extensionChanged:EXT.test(ext)&&ext!==original,
  movieDirectSourceAdvertised:directPresent(movie.direct_source),
  infoDirectSourceAdvertised:directPresent(payload.info?.direct_source)
 };
}
