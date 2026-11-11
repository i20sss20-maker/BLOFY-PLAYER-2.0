// Series-only translation of provider episodes into stable BLOFY IDs.
// Never expose source episode IDs when a mapping is absent or invalid.
const validSourceId = value => (typeof value === 'string' || (typeof value === 'number' && Number.isSafeInteger(value))) && /^[A-Za-z0-9_-]{1,128}$/.test(String(value));
const validGatewayId = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const safeExtension = value => /^(mp4|mkv|avi|mov|webm|ts)$/i.test(String(value || '')) ? String(value).toLowerCase() : 'mp4';

// Xtream implementations may return episode seasons as an object or a flat
// episode array. Normalize a flat list to season "1" to match the admin
// diagnostic and preserve the original episode objects without mutation.
function episodeSeasons(seasons) {
  if (Array.isArray(seasons)) {
    // Some Xtream providers return a flat array with explicit season values.
    // Preserve seasons for clients that build their episode routes from them.
    const grouped={};
    for(const episode of seasons){
      if(!episode||typeof episode!=='object')continue;
      const candidate=Number(episode.season??episode.season_number??1);
      const key=Number.isSafeInteger(candidate)&&candidate>=0&&candidate<=999?
        String(candidate):'1';
      (grouped[key]??=[]).push(episode);
    }
    return Object.keys(grouped).length?grouped:{'1':[]};
  }
  if (!seasons || typeof seasons !== 'object') return null;
  const normalized={};
  for(const [key,value] of Object.entries(seasons)){
    if(['__proto__','prototype','constructor'].includes(key))continue;
    // Providers sometimes wrap season arrays as {episodes:[...]}.
    if(Array.isArray(value))normalized[key]=value;
    else if(value&&typeof value==='object'&&Array.isArray(value.episodes))
      normalized[key]=value.episodes;
  }
  return normalized;
}
// Do not use a metadata/tmdb ID as an episode media ID. Only the
// documented Xtream media identifier alternatives are allowed.
function episodeSourceId(episode){
  if(!episode||typeof episode!=='object')return null;
  for(const value of [episode.id,episode.episode_id,episode.stream_id]){
    if(!validSourceId(value))continue;
    const id=String(value);
    if(id!=='0')return id;
  }
  return null;
}

export function collectSourceEpisodes(seasons) {
  const records = new Map();
  const groups=episodeSeasons(seasons);
  if (!groups) return [];
  for (const [season,list] of Object.entries(groups)) {
    if (['__proto__','prototype','constructor'].includes(season)) continue;
    if (!Array.isArray(list)) continue;
    for (const episode of list) {
      if (!episode || typeof episode !== 'object' || !episodeSourceId(episode)) continue;
      const sourceId = episodeSourceId(episode);
      if (!records.has(sourceId)) records.set(sourceId, {sourceId, extension:safeExtension(episode.container_extension)});
    }
  }
  return [...records.values()];
}

export function mapSeriesEpisodes(seasons, mappings, sanitize) {
  const result = {};
  const groups=episodeSeasons(seasons);
  if (!groups) return result;
  for (const [season, list] of Object.entries(groups)) {
    if (!Array.isArray(list) || ['__proto__', 'prototype', 'constructor'].includes(season)) continue;
    result[season] = list.flatMap((episode,index) => {
      if (!episode || typeof episode !== 'object' || !episodeSourceId(episode)) return [];
      const mapping = mappings.get(episodeSourceId(episode));
      if (!mapping || !validGatewayId(mapping.id)) return [];
      const clean = sanitize(episode);
      if (!clean || typeof clean !== 'object' || Array.isArray(clean)) return [];
      const id=Number(mapping.id);
      const number=Number(episode.episode_num);
      const episodeNum=Number.isSafeInteger(number)&&number>0&&number<100000?
        number:index+1;
      const seasonId=Number(season);
      const validSeason=Number.isSafeInteger(seasonId)&&seasonId>=0&&seasonId<=999;
      // Xtream apps differ: one reads 'id', another 'stream_id' or
      // 'episode_id'. All must identify the same authorized gateway episode.
      // Never forward any provider/source media ID in these fields.
      return [{...clean,id,stream_id:id,episode_id:id,
        episode_num:episodeNum,
        ...(validSeason?{season:seasonId,season_number:seasonId}:{}),
        container_extension:safeExtension(mapping.extension),direct_source:''}];
    });
  }
  return result;
}

// Provider season metadata can list seasons that have no playable episodes,
// or include the provider's internal season ID rather than the season number.
// Align the public Xtream season picker with the actually mapped episode IDs,
// without inventing episode files or modifying the upstream catalog.
export function normalizePlayableSeriesInfo(clean,episodes,gatewayId,categoryGatewayId=null) {
  if(!clean||typeof clean!=='object'||Array.isArray(clean)||!validGatewayId(gatewayId))
    return null;
  const seriesId=Number(gatewayId);
  const active=Object.entries(episodes||{}).filter(([key,list])=>
    /^\\d{1,3}$/.test(key)&&Number(key)<=999&&Array.isArray(list)&&list.length>0);
  const bySeason=new Map(active.map(([key,list])=>[String(Number(key)),list.length]));
  const present=new Set();
  const seasons=[];
  const storedSeasons=Array.isArray(clean.seasons)?clean.seasons:[];
  for(const raw of storedSeasons){
    if(!raw||typeof raw!=='object'||Array.isArray(raw))continue;
    const candidate=Number(raw.season_number??raw.number??raw.id);
    if(!Number.isSafeInteger(candidate)||candidate<0||candidate>999)continue;
    const key=String(candidate),count=bySeason.get(key);
    if(!count||present.has(key))continue;
    present.add(key);
    seasons.push({...raw,id:candidate,season_number:candidate,episode_count:count});
  }
  for(const [key,count] of bySeason){
    if(present.has(key))continue;
    const season=Number(key);
    seasons.push({id:season,season_number:season,
      name:season===0?'Specials':'Season '+season,episode_count:count});
  }
  seasons.sort((a,b)=>a.season_number-b.season_number);
  const info=clean.info&&typeof clean.info==='object'&&!Array.isArray(clean.info)?
    {...clean.info}:{};
  info.series_id=seriesId;
  if(categoryGatewayId!=null)info.category_id=String(categoryGatewayId);
  return {...clean,info,seasons,episodes};
}
