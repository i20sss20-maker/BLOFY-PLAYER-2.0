import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fingerprintXtreamListing,createMinuteCatalogWatcher}
 from '../src/xtream-minute-catalog-watch.mjs';

const readable=values=>({
 body:{async *[Symbol.asyncIterator](){
  yield Buffer.from(JSON.stringify(values));
 }}
});
const entries=[
 {stream_id:10,name:'Channel one',category_id:'1',stream_icon:''},
 {stream_id:11,name:'Channel two',category_id:'1',stream_icon:''}
];
const categories=[{category_id:'1',category_name:'Sports',category_order:10}];
const fingerprint=(items=entries,cats=categories)=>fingerprintXtreamListing({
 mediaType:'live',load:async kind=>readable(kind==='categories'?cats:items)
});
test('fingerprint is streaming, stable and detects additions and title changes',async()=>{
 const one=await fingerprint();
 const repeat=await fingerprint();
 const added=await fingerprint([...entries,
  {stream_id:12,name:'New channel',category_id:'1'}]);
 const renamed=await fingerprint([{...entries[0],name:'Changed'},entries[1]]);
 assert.equal(one.items,2);
 assert.equal(one.categories,1);
 assert.equal(one.hash,repeat.hash);
 assert.notEqual(one.hash,added.hash);
 assert.notEqual(one.hash,renamed.hash);
 assert.notEqual(one.inventoryHash,added.inventoryHash);
 assert.equal(one.inventoryHash,renamed.inventoryHash);
 const shuffled=await fingerprint([...entries].reverse());
 assert.equal(one.inventoryHash,shuffled.inventoryHash);
 assert.notEqual(one.hash,shuffled.hash);
 assert.throws(()=>createMinuteCatalogWatcher({}),/dependencies_invalid/);
});
test('empty provider result cannot silently replace a published library',async()=>{
 await assert.rejects(()=>fingerprint([]),/xtream_catalog_empty_preserved/);
});
test('minute watcher is source-specific, durable across replicas and respects import outcomes',async()=>{
 const source=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 const watcher=await readFile(new URL('../src/xtream-minute-catalog-watch.mjs',import.meta.url),'utf8');
 const ui=await readFile(new URL('../web/sources-admin.js',import.meta.url),'utf8');
 assert.match(source,/BLOFY_XTREAM_MINUTE_SYNC_ENABLED/);
 assert.match(source,/approvedSource:approvedSalehMirrorSource/);
 assert.match(source,/setInterval\(minuteWatchTick,60000\)/);
 assert.match(source,/minuteCatalogWatch\.status\(\)/);
 assert.match(watcher,/ON CONFLICT \(source_id\) DO UPDATE SET/);
 assert.match(watcher,/lease_until/);
 assert.match(watcher,/import_accepted/);
 assert.match(watcher,/result\?\.details\?\.\[x\.mediaType\]/);
 assert.match(ui,/minuteCatalogWatchStatus/);
});

test('manual hidden and custom category order survive automatic provider re-import',async()=>{
 const admin=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 assert.match(admin,/ADD COLUMN IF NOT EXISTS manual_sort BOOLEAN NOT NULL DEFAULT FALSE/);
 const flush=admin.slice(admin.indexOf('async function flushCategoryBatch('),admin.indexOf('async function flushItemBatch('));
 assert.match(flush,/CASE WHEN blofy_xtream_categories\.manual_sort/);
 assert.doesNotMatch(flush,/enabled=EXCLUDED.enabled/);
 const sort=admin.slice(admin.indexOf('async function autoSortCategories('),admin.indexOf('async function moveCategory('));
 assert.match(sort,/manual_sort=\$4::boolean/);
 assert.match(sort,/mode!=='provider'/);
});

test('a live metadata-only change uses the throttled fingerprint, but structural additions sync immediately',async()=>{
 const watcher=await readFile(new URL('../src/xtream-minute-catalog-watch.mjs',import.meta.url),'utf8');
 assert.match(watcher,/inventory_fingerprint TEXT/);
 assert.match(watcher,/inventoryHash:inventory.toString\('hex'\)/);
 assert.match(watcher,/const structural=!prev/);
 assert.match(watcher,/Date.now\(\)-new Date\(prev.synced_at\).getTime\(\)>=10\*60_000/);
});
