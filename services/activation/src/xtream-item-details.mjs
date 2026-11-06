// Opt-in, single-item detail enrichment using the already authorized Xtream
// source API. The returned object deliberately omits upstream credentials and
// preserves original source item IDs, categories and playback URLs.
const stringField=(input,max=1000)=>{
  if(input==null||typeof input==='object')return null;
  const value=String(input).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,' ').trim();
  return value?value.slice(0,max):null;
};
const first=(...items)=>items.find(x=>x!==undefined&&x!==null&&x!=='')??null;

export function safeXtreamArtwork(input){
  const candidate=stringField(input,2048);
  if(!candidate)return null;
  try{
    const url=new URL(candidate);
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return null;
    for(const key of url.searchParams.keys())
      if(/^(?:username|password|pass|api[_-]?key|auth|authorization|token)$/i.test(key))return null;
    return url.href;
  }catch{return null;}
}

export function normalizeXtreamDetails(kind,payload){
  if(!['movie','series'].includes(kind)||!payload||typeof payload!=='object'||Array.isArray(payload))
    throw new Error('xtream_details_invalid');
  const info=payload.info&&typeof payload.info==='object'&&!Array.isArray(payload.info)?payload.info:{};
  const data=payload.movie_data&&typeof payload.movie_data==='object'&&!Array.isArray(payload.movie_data)?payload.movie_data:{};
  const raw={...data,...info};
  const fields={
    plot: stringField(first(raw.plot,raw.description,raw.overview),4000),
    cast: stringField(first(raw.cast,raw.actors),2000),
    director: stringField(raw.director,1000),
    genre: stringField(raw.genre,600),
    releaseDate: stringField(first(raw.releasedate,raw.release_date,raw.releaseDate,raw.first_air_date),80),
    year: stringField(raw.year,8),
    rating: stringField(first(raw.rating,raw.rating_imdb),24),
    rating5: stringField(raw.rating_5based,24),
    tmdb: stringField(first(raw.tmdb_id,raw.tmdb),40),
    imdb: stringField(first(raw.imdb_id,raw.imdb),40),
    youtubeTrailer: stringField(raw.youtube_trailer,500),
    episodeRunTime: stringField(raw.episode_run_time,60)
  };
  if(!fields.year&&fields.releaseDate){
    const year=fields.releaseDate.match(/(?:^|[^\d])(19[5-9]\d|20\d{2})(?:$|[^\d])/);
    if(year)fields.year=year[1];
  }
  const image=safeXtreamArtwork(first(raw.movie_image,raw.cover_big,raw.cover,raw.stream_icon,raw.thumbnail));
  const backdrop=(Array.isArray(raw.backdrop_path)?raw.backdrop_path:[])
    .map(safeXtreamArtwork).filter(Boolean).slice(0,6);
  const metadata=Object.fromEntries(Object.entries(fields).filter(([,value])=>value));
  if(backdrop.length)metadata.backdropPath=backdrop;
  if(!Object.keys(metadata).length&&!image)
    throw new Error('xtream_details_unavailable');
  return {metadata,artworkUrl:image,fieldsFound:Object.keys(metadata).length};
}

export function mergedXtreamMetadata(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return{};
  const details=raw.sourceDetails;
  if(!details||typeof details!=='object'||Array.isArray(details))return raw;
  // Explicit source-info fields are preferable to incomplete list entries.
  return {...raw,...details};
}
