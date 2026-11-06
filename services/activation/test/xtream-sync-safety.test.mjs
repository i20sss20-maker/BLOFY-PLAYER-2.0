import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {assessXtreamSync} from '../src/xtream-sync-guard.mjs';

test('empty Xtream reply is never treated as success that deletes customers media',()=>{
  assert.throws(()=>assessXtreamSync({
    previousItems:25000,importedItems:0,previousCategories:120,importedCategories:0
  }),/xtream_catalog_empty_preserved/);
  assert.throws(()=>assessXtreamSync({
    previousItems:0,importedItems:0,previousCategories:0,importedCategories:0
  }),/xtream_catalog_empty_preserved/);
});

test('suspicious drop (>95%) fails safely; normal provider updates continue',()=>{
  assert.throws(()=>assessXtreamSync({
    previousItems:300000,importedItems:1200,previousCategories:420,importedCategories:30
  }),/xtream_catalog_suspicious_drop_preserved/);
  const normal=assessXtreamSync({
    previousItems:25000,importedItems:22000,previousCategories:100,importedCategories:96
  });
  assert.deepEqual(normal,{preserveCategories:false,items:22000,categories:96});
  assert.deepEqual(assessXtreamSync({
    previousItems:0,importedItems:800,previousCategories:0,importedCategories:0
  }),{preserveCategories:false,items:800,categories:0});
});

test('source without category API keeps manually hidden and ordered categories',()=>{
  const noCategories=assessXtreamSync({
    previousItems:9000,importedItems:9300,previousCategories:80,importedCategories:0
  });
  assert.equal(noCategories.preserveCategories,true);
  const suspiciousCategories=assessXtreamSync({
    previousItems:9000,importedItems:8700,previousCategories:120,importedCategories:2
  });
  assert.equal(suspiciousCategories.preserveCategories,true);
  const clean=assessXtreamSync({
    previousItems:9000,importedItems:9300,previousCategories:80,importedCategories:88
  });
  assert.equal(clean.preserveCategories,false);
  assert.throws(()=>assessXtreamSync({
    previousItems:9000,importedItems:-1,previousCategories:80,importedCategories:88
  }),/xtream_catalog_count_invalid/);
});

test('source sync checks unique inserted token counts BEFORE any stale-record pruning',async()=>{
  const source=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
  const start=source.indexOf("async function syncServer(");
  const end=source.indexOf("async function cancelSourceSync(",start);
  const sync=source.slice(start,end);
  const before=sync.indexOf("const before=(await pool.query");
  const importStart=sync.indexOf("await syncItems(");
  const countUnique=sync.indexOf("const imported=(await pool.query");
  const guard=sync.indexOf("const decision=assessXtreamSync(");
  const finalize=sync.indexOf("await finalizeTypeSync(");
  assert.ok(before>-1&&before<importStart);
  assert.ok(importStart<countUnique&&countUnique<guard&&guard<finalize);
  assert.match(sync,/sync_token=\$3/);
  assert.match(sync,/preserveCategories:decision\.preserveCategories/);
  assert.match(source,/for\(const table of preserveCategories\?\['blofy_xtream_items'\]/);
  assert.match(source,/UPDATE blofy_xtream_categories c SET item_count/);
  assert.doesNotMatch(sync.slice(0,finalize),/DELETE FROM blofy_xtream_/);
});
