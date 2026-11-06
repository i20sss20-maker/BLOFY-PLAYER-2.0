// Optional TMDB v3 details for commercial BLOFY installations.
// Commercial license confirmation and a read-access bearer token are BOTH
// required. Never search arbitrary titles or send private Xtream data to TMDB.
export function tmdbConfigured(env=process.env){
  const token=String(env.BLOFY_TMDB_READ_ACCESS_TOKEN||'').trim();
  return env.BLOFY_TMDB_COMMERCIAL_LICENSE_CONFIRMED==='1'&&token.length>=20;
}
export function validatedTmdbId(value){
  const id=String(value??'').trim();
  return /^[1-9][0-9]{0,11}$/.test(id)?id:null;
}
const value=(v,max=1000)=>typeof v==='string'&&v.trim()?v.trim().slice(0,max):null;
const posterUrl=(path,size)=>{
  if(typeof path!=='string'||!/^\/[A-Za-z0-9/_-]{3,190}\.(?:jpg|png|webp)$/.test(path))return null;
  return 'https://image.tmdb.org/t/p/'+size+path;
};
export function normalizeTmdbDetails(kind,payload,expectedId){
  if(!['movie','series'].includes(kind)||!payload||typeof payload!=='object'||Array.isArray(payload)||
    validatedTmdbId(payload.id)!==validatedTmdbId(expectedId))
    throw new Error('tmdb_id_mismatch');
  const date=value(kind==='movie'?payload.release_date:payload.first_air_date,24);
  const cast=Array.isArray(payload.credits?.cast)?payload.credits.cast.slice(0,10)
    .map(person=>value(person?.name,70)).filter(Boolean).join('، '):'';
  const directors=Array.isArray(payload.credits?.crew)?payload.credits.crew.filter(p=>p?.job==='Director')
    .slice(0,3).map(p=>value(p?.name,70)).filter(Boolean).join('، '):'';
  const trailers=Array.isArray(payload.videos?.results)?payload.videos.results:[];
  const trailer=trailers.find(x=>x?.site==='YouTube'&&x?.type==='Trailer'&&/^[A-Za-z0-9_-]{5,32}$/.test(String(x.key||'')));
  const genres=Array.isArray(payload.genres)?payload.genres.slice(0,6)
    .map(g=>value(g?.name,80)).filter(Boolean).join('، '):'';
  const score=Number(payload.vote_average);
  const details={
    tmdb:validatedTmdbId(expectedId),
    plot:value(payload.overview,4000),
    cast:cast||null,director:directors||null,genre:genres||null,
    releaseDate:date,year:date?.slice(0,4)||null,
    rating:Number.isFinite(score)&&score>=0&&score<=10?String(Math.round(score*10)/10):null,
    youtubeTrailer:trailer?'https://www.youtube.com/watch?v='+trailer.key:null,
    backdropPath:posterUrl(payload.backdrop_path,'w780')?[posterUrl(payload.backdrop_path,'w780')]:null
  };
  return{metadata:Object.fromEntries(Object.entries(details).filter(([,v])=>v!=null&&v!=='')),
    artworkUrl:posterUrl(payload.poster_path,'w500')};
}
export async function fetchTmdbDetails(kind,id,options={}){
  const tmdbId=validatedTmdbId(id);
  if(!tmdbId||!['movie','series'].includes(kind))throw new Error('tmdb_invalid_selection');
  const bearer=String(options.token||'').trim();
  if(!bearer)throw new Error('tmdb_not_configured');
  const url='https://api.themoviedb.org/3/'+(kind==='movie'?'movie':'tv')+'/'+tmdbId+
    '?language=ar-SA&append_to_response=credits%2Cvideos';
  const response=await (options.fetcher||fetch)(url,{
    method:'GET',redirect:'error',
    headers:{accept:'application/json',authorization:'Bearer '+bearer},
    signal:AbortSignal.timeout(9500)
  });
  if(!response.ok){
    try{await response.body?.cancel()}catch{}
    throw new Error(response.status===404?'tmdb_title_not_found':
      response.status===429?'tmdb_rate_limited':'tmdb_upstream_unavailable');
  }
  const parts=[];let size=0;
  if(!response.body)throw new Error('tmdb_empty_response');
  for await(const part of response.body){
    size+=part.byteLength;
    if(size>1_500_000)throw new Error('tmdb_response_too_large');
    parts.push(Buffer.from(part));
  }
  let data;
  try{data=JSON.parse(Buffer.concat(parts).toString('utf8'))}
  catch{throw new Error('tmdb_invalid_json')}
  return normalizeTmdbDetails(kind,data,tmdbId);
}
