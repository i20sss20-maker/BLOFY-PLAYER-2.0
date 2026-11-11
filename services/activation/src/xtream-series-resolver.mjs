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
    result[season] = list.flatMap(episode => {
      if (!episode || typeof episode !== 'object' || !episodeSourceId(episode)) return [];
      const mapping = mappings.get(episodeSourceId(episode));
      if (!mapping || !validGatewayId(mapping.id)) return [];
      const clean = sanitize(episode);
      if (!clean || typeof clean !== 'object' || Array.isArray(clean)) return [];
      return [{...clean, id:Number(mapping.id), container_extension:safeExtension(mapping.extension), direct_source:''}];
    });
  }
  return result;
}
