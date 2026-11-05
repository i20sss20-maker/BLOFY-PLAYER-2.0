import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ui=await readFile(new URL('../web/sources-admin.js',import.meta.url),'utf8');
const html=await readFile(new URL('../web/sources-admin.html',import.meta.url),'utf8');
const backend=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');

test('sources manager has independent search, filter, add and refresh controls',()=>{
  for(const id of ['xtSourceSearch','xtSourceFilter','xtSourceSummary','xtNewSourceBtn','xtRefreshSourcesBtn','xtAddSourceSection','xtreamServers']) {
    assert.match(html,new RegExp('id="'+id+'"'));
  }
  assert.match(ui,/xtSourceSearch'\)\.addEventListener\('input', renderXtream\)/);
  assert.match(ui,/xtSourceFilter'\)\.addEventListener\('change', renderXtream\)/);
});

test('each Xtream source has direct on/off, publish, sync and delete actions',()=>{
  const card=ui.slice(ui.indexOf('function serverCard('),ui.indexOf('function renderXtream('));
  for(const action of ['toggle-enabled','toggle-publish','sync-all','delete','save']) {
    assert.ok(card.includes("'"+action+"'"),action);
  }
  assert.match(card,/item\.enabled \? '⏸ إيقاف المصدر' : '▶ تفعيل المصدر'/);
  assert.match(card,/item\.publishCatalog \? 'إخفاء المحتوى عن العملاء' : 'نشر المحتوى للعملاء'/);
  assert.match(card,/item\.syncing && \(action\.startsWith\('sync'\) \|\| action === 'delete'\)/);
});

test('switches persist immediately through the protected admin PATCH route and deletion is confirmed',()=>{
  const handler=ui.slice(ui.indexOf('async function handleServerAction('),ui.indexOf('async function syncAllXtream('));
  assert.match(handler,/const payload=isEnable\?\{enabled:next\}:\{publishCatalog:next\}/);
  assert.match(handler,/method:'PATCH',body:JSON\.stringify\(payload\)/);
  assert.match(handler,/window\.confirm\(/);
  assert.match(handler,/method: 'DELETE'/);
  assert.match(backend,/if \(!action && req\.method === 'PATCH'\)/);
  assert.match(backend,/if \(!action && req\.method === 'DELETE'\)/);
  assert.match(backend,/if \(!requireAdmin\(req, res\)\) return;/);
});

test('editing a source never displays stored credentials',()=>{
  const card=ui.slice(ui.indexOf('function serverCard('),ui.indexOf('function renderXtream('));
  assert.match(card,/\['username','Username جديد .*?,'text','',512\]/);
  assert.match(card,/\['password','Password جديد .*?,'password','',1024\]/);
  assert.doesNotMatch(card,/value=item\.password/);
});
