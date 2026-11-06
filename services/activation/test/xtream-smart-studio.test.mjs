import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {xtreamTitleKey,xtreamKnownYear,auditXtreamCatalogSample} from '../src/xtream-library-insights.mjs';

const item=(server_id,source_id,name,metadata={},icon_url='',enabled=true,server_name='')=>({
  server_id,source_id,name,metadata,icon_url,enabled,server_name
});

test('Arabic variants, written years and quality labels share a strict title key',()=>{
  assert.equal(xtreamTitleKey('أكشن ٢٠٢٦ 1080p'),xtreamTitleKey('اكشن 2026'));
  assert.equal(xtreamTitleKey('مسلسل كريم 4K'),xtreamTitleKey('مسلسل كريم'));
  assert.notEqual(xtreamTitleKey('فيلم أكشن'),xtreamTitleKey('فيلم رعب'));
  assert.equal(xtreamKnownYear(item('s','1','فيلم مصري ٢٠٢٥')),2025);
  assert.equal(xtreamKnownYear(item('s','1','عمل',{releaseDate:'2026-06-18'})),2026);
  assert.equal(xtreamKnownYear(item('s','1','لا توجد سنة')),null);
});

test('audit finds duplicates and possible matching items from other provider catalogs',()=>{
  const main=[
    item('s1','1','فيلم عربي 2026',{year:2026,plot:'قصة'},'https://example.test/img.jpg'),
    item('s1','2','فيلم عربي ٢٠٢٦ 1080p',{year:2026}),
    item('s1','3','فيلم آخر 2025',{},'',false),
    item('s1','4','فيلم ثالث',{rating:'7'},'')
  ];
  const backups=[
    item('s2','7','فيلم عربي 2026',{year:2026},'https://example.test/p.jpg',true,'المصدر الثاني'),
    item('s3','8','فيلم عربي 2025',{year:2025},'',true,'مصدر سنة مختلفة'),
    item('s4','9','فيلم عربي 2026',{year:2026},'',false,'مصدر موقوف')
  ];
  const x=auditXtreamCatalogSample(main,backups);
  assert.equal(x.sampleOnly,true);
  assert.equal(x.sampledPrimary,4);
  assert.equal(x.duplicateGroupCount,1);
  assert.equal(x.duplicateGroups[0].copies,2);
  assert.equal(x.missingPoster,3);
  assert.equal(x.missingYear,1);
  assert.equal(x.hidden,1);
  assert.equal(x.candidateAlternatives.length,1);
  assert.deepEqual(x.candidateAlternatives[0].otherSources,['المصدر الثاني']);
  assert.ok(!JSON.stringify(x).includes('example.test'));
});

test('read-only preview remains authenticated, source-scoped and bounded',async()=>{
  const [backend,js,html,css]=await Promise.all([
    readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8'),
    readFile(new URL('../web/sources-admin.js',import.meta.url),'utf8'),
    readFile(new URL('../web/sources-admin.html',import.meta.url),'utf8'),
    readFile(new URL('../web/sources-admin.css',import.meta.url),'utf8')
  ]);
  const start=backend.indexOf('async function previewCatalogInsights(');
  const end=backend.indexOf('async function patchCategory(',start);
  assert.ok(start>0&&end>start);
  const preview=backend.slice(start,end);
  assert.match(preview,/validUuid\(serverId\)/);
  assert.match(preview,/ORDER BY source_id LIMIT 1200/);
  assert.match(preview,/LIMIT 1800/);
  assert.match(preview,/auditXtreamCatalogSample\(/);
  assert.doesNotMatch(preview,/DELETE|UPDATE\s+blofy_xtream/);
  const endpoint=backend.indexOf("url.pathname === '/api/v1/admin/xtream/catalog/insights'");
  const auth=backend.indexOf("if (!requireAdmin(req, res)) return;");
  assert.ok(endpoint>auth&&auth>0);
  for(const id of ['studioQuickStats','catalogAuditBtn','catalogPrevPage','catalogNextPage'])
    assert.ok(html.includes('id="'+id+'"'),id);
  for(const text of ['function renderStudioOverview(', 'async function loadCatalogAudit(',
    'function catalogFilterQuery(', 'async function changeCatalogPage(', 'catalogSearchTimer=window.setTimeout'])
    assert.ok(js.includes(text),text);
  assert.ok(js.includes('item.metadata?.plot'));
  assert.match(css,/\.studio-quick-stats/);
});

test('query placeholders and SQL wildcard escaping remain in place',async()=>{
  const b=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
  const line=b.split('\n').find(x=>x.includes('if (query.q)'));
  assert.ok(line);
  assert.equal(line.split('$$'+'{values.length}').length-1,4);
  assert.match(line,/translate\(i\.name/);
  assert.match(line,/c\.name/);
  assert.match(line,/genre/);
});
