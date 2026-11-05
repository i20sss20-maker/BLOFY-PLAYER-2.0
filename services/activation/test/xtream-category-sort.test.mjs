import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {sortXtreamCategories} from '../src/xtream-category-sort.mjs';

const sample=[
  {source_category_id:'kids',name:'أطفال 10',item_count:5,enabled:false},
  {source_category_id:'sports',name:'رياضة',item_count:25,enabled:true},
  {source_category_id:'news',name:'أخبار',item_count:12,enabled:true},
  {source_category_id:'kids2',name:'أطفال 2',item_count:5,enabled:true}
];

test('sorts by most-populated content without mutating original items or visibility',()=>{
  const before=JSON.stringify(sample);
  assert.deepEqual(sortXtreamCategories(sample,'popular'),['sports','news','kids2','kids']);
  assert.equal(JSON.stringify(sample),before);
  assert.equal(sample[0].enabled,false);
});

test('sorts Arabic names with numeric-aware comparisons and stable names',()=>{
  assert.deepEqual(sortXtreamCategories(sample,'alphabetical'),['news','kids2','kids','sports']);
  assert.deepEqual(sortXtreamCategories([
    {source_category_id:'same-1',name:'Drama',item_count:1},
    {source_category_id:'same-2',name:'drama',item_count:7}
  ],'alphabetical'),['same-1','same-2']);
  assert.throws(()=>sortXtreamCategories(sample,'unexpected'),/xtream_category_sort_invalid/);
});

test('one-click sorting only updates selected category order in an authorized transaction',async()=>{
  const [backend,js,html]=await Promise.all([
    readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8'),
    readFile(new URL('../web/sources-admin.js',import.meta.url),'utf8'),
    readFile(new URL('../web/sources-admin.html',import.meta.url),'utf8')
  ]);
  const start=backend.indexOf('async function autoSortCategories(');
  const end=backend.indexOf('async function moveCategory(',start);
  assert.ok(start>0&&end>start);
  const sort=backend.slice(start,end);
  assert.match(sort,/validUuid\(serverId\)/);
  assert.match(sort,/validType\(mediaType\)/);
  assert.match(sort,/lock_timeout='1300ms'/);
  assert.match(sort,/LIMIT 1001 FOR UPDATE/);
  assert.match(sort,/SET sort_order=rank\.pos::int/);
  assert.match(sort,/await client\.query\('COMMIT'\)/);
  assert.doesNotMatch(sort,/DELETE FROM|enabled\s*=|source_id\s*=/);
  assert.match(backend,/url\.pathname === '\/api\/v1\/admin\/xtream\/categories\/auto-sort'/);
  const auth=backend.indexOf("if (!requireAdmin(req, res)) return;");
  const endpoint=backend.indexOf("url.pathname === '/api/v1/admin/xtream/categories/auto-sort'");
  assert.ok(auth>0&&endpoint>auth);
  assert.match(html,/id="categoryAutoSortMode"/);
  assert.match(html,/id="categoryAutoSortBtn"/);
  assert.match(js,/async function autoSortCurrentCategories\(/);
  assert.match(js,/window\.confirm\(/);
  assert.match(js,/await loadCategories\(\)/);
});
