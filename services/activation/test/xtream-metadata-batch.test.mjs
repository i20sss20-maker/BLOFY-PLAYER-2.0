import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('BLOFY batch metadata only touches eight items from the selected page with approval',async()=>{
  const [html,js,css]=await Promise.all([
    readFile(new URL('../web/sources-admin.html',import.meta.url),'utf8'),
    readFile(new URL('../web/sources-admin.js',import.meta.url),'utf8'),
    readFile(new URL('../web/sources-admin.css',import.meta.url),'utf8')
  ]);
  for(const id of ['catalogEnrichBatchBtn','catalogEnrichCancelBtn','catalogEnrichProgress','catalogEnrichStatus'])
    assert.ok(html.includes('id="'+id+'"'),id);
  const a=js.indexOf('async function enrichCurrentCatalogPage()');
  const b=js.indexOf('function renderCatalog()',a);
  const code=js.slice(a,b);
  assert.ok(a>0&&b>a);
  assert.match(code,/state\.catalog\.filter\(item=>item\.serverId===sourceId&&item\.type===type/);
  assert.match(code,/\.slice\(0,8\)/);
  assert.match(code,/window\.confirm\(/);
  assert.match(code,/new AbortController\(\)/);
  assert.match(code,/controller\.abort\(\),14500/);
  assert.match(code,/signal:controller\.signal/);
  assert.match(code,/session\.cancelled/);
  assert.match(code,/session\.processed\+\+/);
  assert.match(code,/session\.failed\+\+/);
  assert.match(code,/await loadCatalog\(\)/);
  assert.match(code,/\+'\/enrich'/);
  assert.doesNotMatch(code,/\/delete|\/bulk|\/sync|password:|username:/);
  assert.match(js,/catalogEnrichBatchBtn'\)\.addEventListener/);
  assert.match(js,/catalogEnrichCancelBtn'\)\.addEventListener/);
  assert.match(css,/\.catalog-enrich-panel/);
});
