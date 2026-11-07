// Series-only translation of provider episodes into stable BLOFY IDs.
// Never expose source episode IDs when a mapping is absent or invalid.
const validSourceId = value => /^[A-Za-z0-9_-]{1,128}$/.test(String(value ?? ''));
const validGatewayId = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const safeExtension = value => /^(mp4|mkv|avi|mov|webm|ts)$/i.test(String(value || '')) ? String(value).toLowerCase() : 'mp4';

export function collectSourceEpisodes(seasons) {
  const records = new Map();
  if (!seasons || typeof seasons !== 'object' || Array.isArray(seasons)) return [];
  for (const list of Object.values(seasons)) {
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
  if (!seasons || typeof seasons !== 'object' || Array.isArray(seasons)) return result;
  for (const [season, list] of Object.entries(seasons)) {
    if (!Array.isArray(list)) continue;
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
