import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('BLOFY smart library has real 2026 and language browse shortcuts, not fake new catalog rows',async()=>{
  const [html,js]=await Promise.all([read('web/sources-admin.html'),read('web/sources-admin.js')]);
  for(const id of ['catalogYear','catalogLanguage','catalogSmartQuick','categoryGroupedView','categoryFlatView'])
    assert.ok(html.includes('id="'+id+'"'),id);
  assert.ok(html.includes('value="smart"'),'smart order option');
  assert.match(js,/function describeCategoryShelf\(name,mediaType\)/);
  assert.match(js,/function initCatalogSmartShortcuts\(\)/);
  assert.match(js,/title:'🎬 عربي '/);
  assert.match(js,/title:'📺 مسلسلات عربي '/);
  assert.match(js,/if\(selected\.type!=='current'\)el\('catalogType'\)\.value=selected\.type/);
  assert.match(js,/await loadCategories\(\)/);
  assert.match(js,/await loadCatalog\(\)/);
  assert.match(js,/categorySmartUi\.grouped/);
});

test('metadata year and recognized source category labels are parameterized SQL filters',async()=>{
  const backend=await read('src/xtream-admin-hook.mjs');
  const start=backend.indexOf('async function listCatalog(');
  const end=backend.indexOf('async function patchCategory(',start);
  const query=backend.slice(start,end);
  assert.match(query,/if\(query\.year\)/);
  assert.match(query,/year<1950\|\|year>2099/);
  assert.ok(query.includes("i.metadata->>'year'"));
  assert.ok(query.includes("i.metadata->>'releaseDate'"));
  assert.ok(query.includes("substring(i.name"));
  assert.ok(query.includes(")=$${values.length}"));
  assert.ok(query.includes("c.name ~* $${values.length}"));
  assert.match(query,/if\(!query\.serverId\)throw Object\.assign\(new Error\('xtream_smart_filter_source_required'/);
  assert.match(query,/xtream_language_filter_invalid/);
  assert.doesNotMatch(query,/i\.category_id\s*=\s*'smart:/);
});

test('smart shelf filters cannot accidentally bulk enable or disable an entire library',async()=>{
  const js=await read('web/sources-admin.js');
  const begin=js.indexOf('async function bulkCatalog(enabled)');
  const end=js.indexOf('async function runBlofyItemProbe()',begin);
  const bulk=js.slice(begin,end);
  assert.match(bulk,/if\(el\('catalogYear'\)\.value\|\|el\('catalogLanguage'\)\.value\)/);
  assert.ok(bulk.indexOf("showMessage('ألغِ فلاتر السنة")<bulk.indexOf("const serverId ="));
  assert.match(js,/el\('enableTypeBtn'\)\.disabled=filtered/);
  assert.match(js,/el\('disableTypeBtn'\)\.disabled=filtered/);
  assert.match(js,/params\.set\('year',el\('catalogYear'\)\.value\)/);
  assert.match(js,/params\.set\('language',el\('catalogLanguage'\)\.value\)/);
});
