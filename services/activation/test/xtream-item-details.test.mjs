import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeXtreamDetails,mergedXtreamMetadata,safeXtreamArtwork} from '../src/xtream-item-details.mjs';
import {formatGatewayItem} from '../src/xtream-gateway-core.mjs';

test('merges exact Xtream VOD info without changing item/stream ID',()=>{
  const r=normalizeXtreamDetails('movie',{
    info:{plot:'قصة فيلم',cast:'ممثّل أول',director:'مدير',genre:'دراما',
      rating:'7.8',releasedate:'2026-03-14',tmdb_id:'123456',
      movie_image:'https://cdn.example.test/movie.jpg',backdrop_path:['https://cdn.example.test/bg.jpg']},
    movie_data:{name:'Movie 2026',stream_id:128,container_extension:'mp4'}
  });
  assert.equal(r.metadata.plot,'قصة فيلم');
  assert.equal(r.metadata.year,'2026');
  assert.equal(r.metadata.tmdb,'123456');
  assert.equal(r.artworkUrl,'https://cdn.example.test/movie.jpg');
  assert.deepEqual(r.metadata.backdropPath,['https://cdn.example.test/bg.jpg']);
  assert.ok(!Object.hasOwn(r,'stream_id'));
  const merged=mergedXtreamMetadata({plot:null,sourceDetails:r.metadata,added:999});
  assert.equal(merged.plot,'قصة فيلم');
  assert.equal(merged.added,999);
  assert.deepEqual(mergedXtreamMetadata({year:2025}),{year:2025});
});

test('series details are read from info with bounded text and video-safe artwork',()=>{
  const r=normalizeXtreamDetails('series',{
    info:{plot:'x'.repeat(8000),cover:'https://cdn.example.test/series.jpg',
      first_air_date:'2024-08-05',rating:'9.1'},
    episodes:{'1':[{id:17}]}
  });
  assert.equal(r.metadata.plot.length,4000);
  assert.equal(r.metadata.year,'2024');
  assert.ok(!JSON.stringify(r).includes('"episodes"'));
  for(const url of ['javascript:alert(1)','http://u:p@source.test/poster.jpg',
    'https://source.test/poster.jpg?username=me&password=secret', 'file:///etc/passwd'])
    assert.equal(safeXtreamArtwork(url),null,url);
  assert.throws(()=>normalizeXtreamDetails('series',{episodes:{1:[{id:1}]}}),/xtream_details_unavailable/);
  assert.throws(()=>normalizeXtreamDetails('live',{info:{plot:'x'}}),/xtream_details_invalid/);
});

test('details enrich series exposed to BLOFY PLAYER while retaining gateway IDs and safe links',()=>{
  const formatted=formatGatewayItem('series',{
    name:'مسلسل',gateway_id:'600',category_gateway_id:'42',icon_url:'https://cdn.example.test/s.jpg',
    metadata:{plot:'',year:null,sourceDetails:{plot:'وصف حقيقي',rating:'8.3',releaseDate:'2026-01-01'}}
  });
  assert.equal(formatted.series_id,600);
  assert.equal(formatted.category_id,'42');
  assert.equal(formatted.plot,'وصف حقيقي');
  assert.equal(formatted.rating,'8.3');
});

test('single-item detail endpoint requires admin, source ownership and preserves details through future sync',async()=>{
  const [backend,ui,html]=await Promise.all([
    readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8'),
    readFile(new URL('../web/sources-admin.js',import.meta.url),'utf8'),
    readFile(new URL('../web/sources-admin.html',import.meta.url),'utf8')
  ]);
  const a=backend.indexOf('async function enrichOneXtreamItem('),b=backend.indexOf('async function patchItem(',a);
  assert.ok(a>0&&b>a);
  const method=backend.slice(a,b);
  assert.match(method,/validUuid\(serverId\)/);
  assert.match(method,/!\['movie','series'\]\.includes\(mediaType\)/);
  assert.match(method,/source_id=\$3/);
  assert.match(method,/mediaType==='movie'\?'get_vod_info':'get_series_info'/);
  assert.match(method,/bytes>2_000_000/);
  assert.match(method,/sourceMutation\(/);
  assert.match(method,/jsonb_build_object\('sourceDetails',\$4::jsonb\)/);
  assert.doesNotMatch(method,/UPDATE blofy_xtream_servers|DELETE FROM|password:/);
  const endpoint=backend.indexOf("const enrichMatch=url.pathname.match(");
  const auth=backend.indexOf("if (!requireAdmin(req, res)) return;");
  assert.ok(endpoint>auth&&auth>0);
  assert.match(backend,/jsonb_build_object\('sourceDetails',\s*COALESCE\(blofy_xtream_items.metadata->'sourceDetails'/);
  const syncStart=backend.indexOf('async function flushItemBatch('),syncEnd=backend.indexOf('async function syncCategories(',syncStart);
  const sync=backend.slice(syncStart,syncEnd);
  assert.equal(sync.split('icon_url=').length-1,1,'no duplicate PostgreSQL UPDATE SET icon_url');
  assert.match(ui,/✨ تحديث معلومات المحتوى/);
  assert.match(ui,/\+'\/enrich'/);
  assert.match(html,/sources-admin\.js\?v=/);
});
