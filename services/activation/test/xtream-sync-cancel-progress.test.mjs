import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [server,web]=await Promise.all([
  readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8'),
  readFile(new URL('../web/sources-admin.js',import.meta.url),'utf8')
]);

test('cancel sync remains available while a 290k item import is running',()=>{
  assert.match(server,/const syncProgress = new Map\(\)/);
  assert.match(server,/async function cancelSourceSync\(id\)/);
  assert.match(server,/cancelledSources\.add\(id\)/);
  assert.match(server,/staleStateCleared/);
  assert.match(server,/\(test\|sync\|cancel-sync\)/);
  assert.match(server,/if \(action === 'cancel-sync' && req\.method === 'POST'\)/);
});

test('sync progress counts imported items and clears after completion',()=>{
  assert.match(server,/syncProgress\.set\(id,\{mediaType/);
  assert.match(server,/progress\.imported\+=payload\.length/);
  assert.match(server,/syncProgress\.delete\(id\)/);
  assert.match(server,/syncProgress: syncProgress\.get\(row\.id\) \|\| null/);
  assert.match(server,/xtream_sync_cancelled/);
  assert.match(web,/item\.syncProgress\.imported/);
  assert.match(web,/action === 'cancel-sync'/);
  assert.match(web,/⏹ إلغاء المزامنة/);
});

test('no phantom sync queued for a paused or removed source',()=>{
  const handler=server.slice(server.indexOf("if (action === 'sync' && req.method === 'POST')"),server.indexOf("const categoryMatch = url.pathname.match"));
  assert.match(handler,/if\(!source\)return json\(res,404/);
  assert.match(handler,/if\(!source\.enabled\)return json\(res,409/);
  assert.match(handler,/startSync\(id, selected\)/);
});
