import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('repeat series info avoids unnecessary episode-map UPDATEs and preserves stable IDs',async()=>{
  const src=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
  const start=src.indexOf('async function ensureEpisodeMaps(');
  const end=src.indexOf('async function seriesInfo(',start);
  const block=src.slice(start,end);
  assert.ok(start>0&&end>start);
  assert.match(block,/ON CONFLICT\(server_id,series_source_id,source_episode_id\) DO UPDATE/);
  assert.match(block,/WHERE blofy_xtream_gateway_episode_map\.container_extension IS DISTINCT FROM EXCLUDED\.container_extension/);
  assert.match(block,/SELECT gateway_id,source_episode_id,container_extension FROM blofy_xtream_gateway_episode_map/);
  assert.match(block,/new Map\(rows\.map\(row => \[String\(row\.source_episode_id\)/);
  assert.doesNotMatch(block,/DELETE FROM blofy_xtream_gateway_episode_map/);
});
