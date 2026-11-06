import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [backend,frontend,html]=await Promise.all([
  readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8'),
  readFile(new URL('../web/sources-admin.js',import.meta.url),'utf8'),
  readFile(new URL('../web/sources-admin.html',import.meta.url),'utf8')
]);

test('Xtream source delete and pause never queue behind huge catalog imports',()=>{
  assert.match(backend,/const controlPool = new pg\.Pool\(\{/);
  assert.match(backend,/max: 2,/);
  assert.match(backend,/const result=await client\.query\(sql,values\)/);
  assert.match(backend,/await client\.query\('COMMIT'\)/);
  assert.match(backend,/await client\.query\('ROLLBACK'\)/);
  assert.match(backend,/SET LOCAL lock_timeout='1300ms'/);
  assert.match(backend,/new Error\('xtream_source_busy_retry'\),\{status:409\}/);
  assert.match(backend,/return \(await controlPool\.query\('SELECT \* FROM blofy_xtream_servers WHERE deletion_requested_at IS NULL/);
  const patch=backend.slice(backend.indexOf('async function patchServer('),backend.indexOf('async function listCategories('));
  assert.match(patch,/await sourceMutation\(\x60UPDATE blofy_xtream_servers SET/);
  assert.match(patch,/WHERE id=\$\$\{values\.length\} AND deletion_requested_at IS NULL/);
});

test('deletion means a committed tombstone, not a frontend-only disappearance',()=>{
  const del=backend.slice(backend.indexOf('async function requestDeleteSource('),backend.indexOf('async function checkedFetch('));
  assert.match(del,/await sourceMutation\(\x60UPDATE blofy_xtream_servers/);
  assert.match(del,/SET enabled=FALSE,publish_catalog=FALSE,status='offline'/);
  assert.match(del,/deletion_requested_at=COALESCE\(deletion_requested_at,NOW\(\)\)/);
  assert.match(del,/void purgeSource\(id\)/);
  const ui=frontend.slice(frontend.indexOf("} else if (action === 'delete')"),frontend.indexOf("} else if (action.startsWith('sync-')"));
  assert.match(ui,/result\.deletionQueued!==true/);
  assert.match(ui,/await loadXtream\(true,true\)/);
  assert.match(ui,/state\.xtreamServers\.some\(source=>source\.id===item\.id\)/);
  assert.doesNotMatch(ui,/state\.xtreamServers\s*=\s*state\.xtreamServers\.filter/);
});

test('deletion never runs all source purges concurrently',()=>{
  assert.match(backend,/purgeRunning\.size>=1/);
  assert.match(backend,/new Promise\(resolve => setTimeout\(resolve,12\)\)/);
  assert.match(backend,/LIMIT 400/);
  assert.match(backend,/WHERE deletion_requested_at IS NULL ORDER BY/);
});

test('admin manager forces fresh state after deployment',()=>{
  assert.match(frontend,/cache: 'no-store'/);
  assert.match(html,/sources-admin\.js\?v=20261106-smart-studio-v10/);
  assert.match(frontend,/xtreamLoadSequence/);
});
