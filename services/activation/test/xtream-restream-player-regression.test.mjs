import test from 'node:test';
import assert from 'node:assert/strict';
import { gatewayItemsPageQuery } from '../src/xtream-gateway-query.mjs';
import { readFile } from 'node:fs/promises';

const sourceId='11111111-1111-4111-8111-111111111111';
const otherId='22222222-2222-4222-8222-222222222222';

test('a selected Xtream source is a bound UUID, never a bare SQL integer',()=>{
  const query=gatewayItemsPageQuery('live',0,{sourceId});
  assert.deepEqual(query.values,['live',0,sourceId,2000]);
  assert.match(query.text,/i\.server_id=\$3/);
  assert.match(query.text,/LIMIT \$4/);
  assert.doesNotMatch(query.text,/i\.server_id=3(?!\d)/);
  assert.doesNotMatch(query.text,new RegExp(sourceId));
});
test('source-specific category filter is scoped to the same source',()=>{
  const cat={server_id:sourceId,source_category_id:'sports'};
  const query=gatewayItemsPageQuery('movie',20,{sourceId,filter:cat});
  assert.deepEqual(query.values,['movie',20,sourceId,sourceId,'sports',2000]);
  assert.match(query.text,/i\.server_id=\$3/);
  assert.match(query.text,/i\.server_id=\$4/);
  assert.match(query.text,/i\.category_id=\$5/);
  assert.match(query.text,/LIMIT \$6/);
  assert.throws(()=>gatewayItemsPageQuery('live',20,{sourceId,filter:{...cat,server_id:otherId}}),/source_category_mismatch/);
});
test('catalog page without a selected source retains all published sources',()=>{
  const query=gatewayItemsPageQuery('series',0);
  assert.deepEqual(query.values,['series',0,2000]);
  assert.doesNotMatch(query.text,/i\.server_id=\$/);
  assert.match(query.text,/s\.publish_catalog=TRUE/);
  assert.throws(()=>gatewayItemsPageQuery('other',0),/invalid_media_type/);
  assert.throws(()=>gatewayItemsPageQuery('live',-1),/invalid_cursor/);
});
test('gateway mapping only refreshed as one bounded single-flight task',async()=>{
  const gateway=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
  assert.match(gateway,/import \{ gatewayItemsPageQuery,gatewayOrderedItemsPageQuery,gatewayOrderCursor \}/);
  assert.match(gateway,/oncePerMediaMap\(itemMapJobs/);
  assert.match(gateway,/oncePerMediaMap\(categoryMapJobs/);
  assert.match(gateway,/!old\.settled/);
  assert.match(gateway,/gatewayOrderedItemsPageQuery\(mediaType,cursor,\{filter,sourceId\}\)/);
});
test('protected Live and VOD diagnostics check real upstream media and report no credentials',async()=>{
  const server=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
  const web=await readFile(new URL('../web/sources-admin.js',import.meta.url),'utf8');
  assert.match(server,/async function probeXtreamPlayback\(id,mediaType='live',\{forcePortalDirect=false,/);
  assert.match(server,/action === 'probe-playback' && req\.method === 'POST'/);
  assert.match(server,/await assertPublicXtreamUrl\(target\.origin\)/);
  assert.match(server,/response\.body\?\.cancel\(\)/);
  assert.match(server,/checks\.push\(\{/);
  assert.match(web,/\['probe-live','probe-movie','probe-series','probe-episode'\]\.includes\(action\)/);
  assert.match(web,/اختبار بث قناة/);
  assert.match(web,/اختبار تشغيل فيلم/);
  assert.match(web,/اختبار بيانات مسلسل/);
  assert.match(web,/اختبار تشغيل حلقة/);
});

test('huge Xtream playlists obey HTTP backpressure and validate maps before success',async()=>{
  const gateway=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
  const output=gateway.slice(gateway.indexOf('async function streamGatewayItems('),gateway.indexOf('async function gatewayItemById('));
  const m3u=gateway.slice(gateway.indexOf('async function handleM3u('),gateway.indexOf('async function gatewayHealth('));
  assert.match(gateway,/async function writeStreamChunk\(res,chunk\)/);
  assert.match(gateway,/res\.once\('drain',ok\)/);
  assert.ok(output.indexOf('await ensureItemMaps') < output.indexOf('res.writeHead(200'));
  assert.match(output,/await writeStreamChunk\(output,prefix\+JSON\.stringify/);
  assert.match(output,/gzipEnabled=acceptsXtreamGzip/);
  assert.match(m3u,/await writeStreamChunk\(res,'#EXTM3U/);
  assert.match(m3u,/await writeStreamChunk\(res,`#EXTINF/);
});
