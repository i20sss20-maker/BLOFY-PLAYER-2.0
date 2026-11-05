import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [api,ui]=await Promise.all([
  readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8'),
  readFile(new URL('../web/sources-admin.js',import.meta.url),'utf8')
]);

test('source mutations use positional UUID SQL parameter instead of a number literal',()=>{
  const method=api.slice(api.indexOf('async function patchServer('),api.indexOf('async function listCategories('));
  assert.match(method,/WHERE id=\$\$\{values\.length\} AND deletion_requested_at IS NULL RETURNING \*/);
  assert.doesNotMatch(method,/WHERE id=\$\{values\.length\}/);
  assert.match(method,/if\(!result\.rows\[0\]\)throw Object\.assign\(new Error\('xtream_server_not_found'\)/);
});

test('source pause/unpublish are verified from database readback before success',()=>{
  const method=ui.slice(ui.indexOf('async function handleServerAction('),ui.indexOf('async function syncAllXtream('));
  assert.match(method,/const result=await api\(/);
  assert.match(method,/Boolean\(result\.item\[field\]\)!==next/);
  assert.match(method,/await loadXtream\(true,true\)/);
  assert.match(method,/if\(!saved\|\|Boolean\(saved\[field\]\)!==next\)/);
  assert.match(method,/el\('xtSourceFilter'\)\.value='all'/);
});

test('out-of-order loading cannot replace latest saved Xtream source state',()=>{
  assert.match(ui,/xtreamLoadSequence: 0/);
  assert.match(ui,/const seq=\+\+state\.xtreamLoadSequence/);
  assert.match(ui,/if\(seq!==state\.xtreamLoadSequence\)/);
  assert.match(ui,/if\(strict\)throw error/);
});
