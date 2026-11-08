// A registry episode can be discovered by an admin probe before the player's
// account-specific episode map has been created. To recheck it, verify the
// *same exact provider episode ID* still belongs to the original series.
// Never guess another item, scrape direct_source, or create account mappings.
import {collectSourceEpisodes} from './xtream-series-resolver.mjs';

export function sameSeriesRecoveryEpisode(payload,episodeId){
 if(!payload||typeof payload!=='object'||!payload.episodes||
  !/^[A-Za-z0-9_-]{1,128}$/.test(String(episodeId??'')))return null;
 const match=collectSourceEpisodes(payload.episodes)
  .find(row=>row.sourceId===String(episodeId));
 return match?{extension:match.extension}:null;
}
