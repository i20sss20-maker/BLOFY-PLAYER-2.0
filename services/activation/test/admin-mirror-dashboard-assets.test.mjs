// Offline regression: the owner-visible Xtream status dashboard must be
// shipped, syntactically valid, read-only and not leak provider URLs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Script} from 'node:vm';
const web=new URL('../web/',import.meta.url);
const src=new URL('../src/content-hub-admin-hook.mjs',import.meta.url);

test('mirror dashboard is linked and served by the explicit admin asset allowlist',async()=>{
 const [html,hook,js]=await Promise.all([
  readFile(new URL('admin-content-hub.html',web),'utf8'),
  readFile(src,'utf8'),
  readFile(new URL('admin-mirror-dashboard.js',web),'utf8')
 ]);
 assert.match(html,/<script src="\/admin-mirror-dashboard\.js" defer><\/script>/);
 assert.match(hook,/\/'\/admin-mirror-dashboard\.js'/);
 assert.doesNotThrow(()=>new Script(js,{filename:'admin-mirror-dashboard.js'}));
 for(const id of ['mirrorSource','mirrorKind','mirrorState',
  'mirrorStatus','mirrorStats','mirrorRows','mirrorScan',
  'mirrorTransfers','mirrorPrev','mirrorNext','mirrorPage',
  'mirrorRefresh']){
  assert.match(html,new RegExp('id="'+id+'"'),id);
  assert.match(js,new RegExp("'"+id+"'"),id);
 }
});
test('new owner dashboard reads only, never posts source/media/copy operations',async()=>{
 const js=await readFile(new URL('admin-mirror-dashboard.js',web),'utf8');
 assert.doesNotMatch(js,/innerHTML|localStorage|sessionStorage/);
 assert.doesNotMatch(js,/method:\s*['"]POST['"]/);
 assert.doesNotMatch(js,/fetch\([^\n]*get\.php|username\s*=|password\s*=/i);
 assert.match(js,/\/api\/v1\/admin\/xtream\/mirror\/queue\/status/);
 assert.match(js,/\/api\/v1\/admin\/xtream\/mirror\/queue\/items/);
 assert.match(js,/episodesOnlyMappedSubset|الفهرس|فهرسة/);
});
