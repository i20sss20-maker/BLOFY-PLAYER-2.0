import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=name=>readFile(new URL('../'+name,import.meta.url),'utf8');
const [gateway,admin,html,ui]=await Promise.all([
  read('src/xtream-gateway-hook.mjs'),
  read('src/xtream-admin-hook.mjs'),
  read('web/sources-admin.html'),
  read('web/xtream-gateway-admin.js')
]);

test('new accounts bind to a specific chosen source, older accounts stay all-sources',()=>{
  assert.match(gateway,/ADD COLUMN IF NOT EXISTS source_id UUID/);
  assert.match(gateway,/sourceId: row\.source_id \|\| null/);
  assert.match(gateway,/async function checkedAccountSourceId\(value\)/);
  assert.match(gateway,/deletion_requested_at IS NULL/);
  assert.match(gateway,/await checkedAccountSourceId\(body\.sourceId\)/);
  assert.match(gateway,/max_connections,expires_at,source_id/);
  assert.match(gateway,/if \(body\.sourceId !== undefined\) set\('source_id', await checkedAccountSourceId\(body\.sourceId\)\)/);
});

test('account-selected source restricts all content and playback endpoints',()=>{
  assert.match(gateway,/async function gatewayCategories\(mediaType, sourceId=null\)/);
  assert.match(gateway,/async function categoryFilter\(mediaType, gatewayId, sourceId=null\)/);
  assert.match(gateway,/async function walkGatewayItems\(mediaType, filter, onRow, sourceId=null\)/);
  assert.match(gateway,/async function gatewayItemById\(mediaType, gatewayId, sourceId=null\)/);
  assert.match(gateway,/async function episodeByGatewayId\(gatewayId,sourceId=null\)/);
  assert.match(gateway,/account\.source_id\|\|null/);
  assert.match(gateway,/sourceId\);/);
  assert.match(gateway,/AND \(\$3::uuid IS NULL OR i\.server_id=\$3::uuid\)/);
  assert.match(gateway,/AND \(\$2::uuid IS NULL OR e\.server_id=\$2::uuid\)/);
  const player=gateway.slice(gateway.indexOf('async function handlePlayerApi('),gateway.indexOf('async function gatewayHealth('));
  assert.match(player,/gatewayCategories\('live',account\.source_id\|\|null\)/);
  assert.match(player,/streamGatewayItems\(req,res, 'movie', url\.searchParams\.get\('category_id'\),account\.source_id\|\|null\)/);
  assert.match(player,/seriesInfo\(url\.searchParams\.get\('series_id'\),account\.source_id\|\|null\)/);
  assert.match(player,/}, account\.source_id\|\|null\);/);
  const playback=gateway.slice(gateway.indexOf('async function proxyMedia('),gateway.indexOf('function playerServerInfo('));
  assert.match(playback,/gatewayItemById\(kind === 'live' \? 'live' : 'movie', gatewayId,account\.source_id\|\|null\)/);
});

test('source picker is available for issuance and existing customer changes',()=>{
  assert.match(html,/id="gatewaySourceId"/);
  assert.match(ui,/sourceId:sourceId\|\|null/);
  assert.match(ui,/function gatewaySourceOptions/);
  assert.match(ui,/تغيير المصدر/);
  assert.match(ui,/renderGatewaySourcePicker\(\)/);
});

test('large library sync completes in small transactions and pausing halts jobs',()=>{
  const end=admin.slice(admin.indexOf('async function finalizeTypeSync('),admin.indexOf('async function calculateCounts('));
  assert.match(end,/LIMIT 350/);
  assert.match(end,/cancelledSources\.has\(serverId\)/);
  assert.doesNotMatch(end,/BEGIN/);
  assert.doesNotMatch(end,/DELETE FROM blofy_xtream_items WHERE server_id=\$1 AND media_type=\$2 AND sync_token IS DISTINCT FROM \$3',/);
  assert.match(admin,/if\(!source\.enabled\)return json\(res,409,\{error:'xtream_source_paused'\}\)/);
});
