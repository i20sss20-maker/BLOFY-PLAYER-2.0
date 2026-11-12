import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('AI approved item category remains pinned across provider imports',async()=>{
 const code=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 assert.match(code,/ADD COLUMN IF NOT EXISTS custom_category_id TEXT/);
 assert.match(code,/category_id=COALESCE\(blofy_xtream_items\.custom_category_id,EXCLUDED\.category_id\)/);
 assert.match(code,/SET category_id=\$4,custom_category_id=\$4,updated_at=NOW\(\)/);
 assert.match(code,/i\.category_id IS NOT DISTINCT FROM \$5/);
 assert.match(code,/stream_ai_plan_conflict/);
});
