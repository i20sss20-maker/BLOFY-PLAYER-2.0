// Series-only translation of provider episodes into stable BLOFY IDs.
// Never expose source episode IDs when a mapping is absent or invalid.
const validSourceId = value => (typeof value === 'string' || (typeof value === 'number' && Number.isSafeInteger(value))) && /^[A-Za-z0-9_-]{1,128}$/.test(String(value));
const validGatewayId = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const safeExtension = value => /^(mp4|mkv|avi|mov|webm|ts)$/i.test(String(value || '')) ? String(value).toLowerCase() : 'mp4';

// Xtream implementations may return episode seasons as an object or a flat
// episode array. Normalize a flat list to season "1" to match the admin
// diagnostic and preserve the original episode objects without mutation.
function episodeSeasons(seasons) {
  if (Array.isArray(seasons)) return {'1': seasons};
  if (!seasons || typeof seasons !== 'object') return null;
  return seasons;
}

export function collectSourceEpisodes(seasons) {
  const records = new Map();
  const groups=episodeSeasons(seasons);
  if (!groups) return [];
  for (const [season,list] of Object.entries(groups)) {
    if (['__proto__','prototype','constructor'].includes(season)) continue;
    if (!Array.isArray(list)) continue;
    for (const episode of list) {
      if (!episode || typeof episode !== 'object' || !validSourceId(episode.id)) continue;
      const sourceId = String(episode.id);
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
      if (!episode || typeof episode !== 'object' || !validSourceId(episode.id)) return [];
      const mapping = mappings.get(String(episode.id));
      if (!mapping || !validGatewayId(mapping.id)) return [];
      const clean = sanitize(episode);
      if (!clean || typeof clean !== 'object' || Array.isArray(clean)) return [];
      return [{...clean, id:Number(mapping.id), container_extension:safeExtension(mapping.extension), direct_source:''}];
    });
  }
  return result;
}
