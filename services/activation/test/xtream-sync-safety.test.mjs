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

test('partial HTTP-200 sync cannot erase a small source or manually organized categories',()=>{
  // A 200-item service unexpectedly returning only 3 entries must preserve
  // all customer catalog references while operator reviews the source.
  for(const oldItems of [50,80,120,300,499,800,30000]){
    const truncated=Math.max(1,Math.ceil(oldItems*0.09));
    assert.throws(()=>assessXtreamSync({
      previousItems:oldItems,importedItems:truncated,
      previousCategories:8,importedCategories:1
    }),/xtream_catalog_suspicious_drop_preserved/);
  }
  // Provider can legitimately remove modest subsets; old IDs and categories
  // need no extra source calls or reindex if the response is plausible.
  assert.deepEqual(assessXtreamSync({
    previousItems:120,importedItems:91,
    previousCategories:10,importedCategories:9
  }),{preserveCategories:false,items:91,categories:9});
  // An implausibly small category list may be a provider bug even when the
  // media list itself is complete: keep the previous ordering/visibility.
  assert.equal(assessXtreamSync({
    previousItems:400,importedItems:395,
    previousCategories:20,importedCategories:2
  }).preserveCategories,true);
  assert.equal(assessXtreamSync({
    previousItems:75,importedItems:75,
    previousCategories:8,importedCategories:1
  }).preserveCategories,true);
});

test('initial sparse imports remain allowed and bad counts fail closed',()=>{
  const fresh=assessXtreamSync({
    previousItems:0,importedItems:2,
    previousCategories:0,importedCategories:0
  });
  assert.equal(fresh.items,2);
  assert.equal(fresh.preserveCategories,false);
  assert.throws(()=>assessXtreamSync({
    previousItems:100,importedItems:Number.MAX_VALUE,
    previousCategories:8,importedCategories:8
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
