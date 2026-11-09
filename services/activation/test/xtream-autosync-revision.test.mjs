import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {bumpXtreamCatalogRevision,ensureXtreamCatalogRevisionSchema,
 xtreamCatalogVersionForAccount} from '../src/xtream-catalog-revision.mjs';
const sourceId='11111111-1111-4111-8111-111111111111';
test('source-scoped catalog version bumps atomically without client account changes',async()=>{
 const calls=[];
 const db={async query(sql,args=[]){calls.push({sql,args});return {rows:[{revision:'5'}]}}};
 await ensureXtreamCatalogRevisionSchema(db);
 const rev=await bumpXtreamCatalogRevision(db,sourceId);
 assert.equal(rev,5);
 assert.ok(calls.some(x=>x.sql.includes('ON CONFLICT (source_id) DO UPDATE')));
 assert.deepEqual(calls.at(-1).args,[sourceId,'sync']);
 assert.ok(!JSON.stringify(calls).includes('password_secret'));
});
test('client version detects stale catalog only for the correct authorized source',async()=>{
 const pool={async query(sql,args){
  assert.deepEqual(args,[sourceId]);
  return {rows:[{enabled:true,publish_catalog:true,status:'online',
   last_sync_at:'2026-11-10T00:00:00Z',counts:{live:9,movie:10,series:11},revision:'4'}]};
 }};
 const old=await xtreamCatalogVersionForAccount(pool,sourceId,'3');
 assert.equal(old.changed,true);assert.equal(old.requiresFullReload,true);
 assert.equal(old.automaticPush,false);assert.equal(old.revision,4);
 const fresh=await xtreamCatalogVersionForAccount(pool,sourceId,'4');
 assert.equal(fresh.changed,false);
 const unspecified=await xtreamCatalogVersionForAccount(pool,sourceId);
 assert.equal(unspecified.changed,null);
});
test('no unscoped account or unpublished source receives catalog version',async()=>{
 let queries=0;
 const pool={async query(){queries++;return {rows:[{enabled:false,publish_catalog:true}]}}};
 const invalid=await xtreamCatalogVersionForAccount(pool,null,'0');
 assert.equal(invalid.ok,false);assert.equal(queries,0);
 const unpublished=await xtreamCatalogVersionForAccount(pool,sourceId,'0');
 assert.equal(unpublished.code,'xtream_catalog_source_unavailable');
 assert.equal(queries,1);
 const bad=await xtreamCatalogVersionForAccount(pool,sourceId,'1 UNION SELECT');
 assert.equal(bad.code,'xtream_catalog_version_invalid');
 assert.equal(queries,1);
});
test('bridge exposes only protected source schedule, backup metadata and aggregate code stats',async()=>{
 const hook=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 const start=hook.indexOf('async function unifiedStreamBridge(req,res,url)');
 const authorized=hook.indexOf('streamBridgeAuthorized(req.headers.authorization,STREAM_BRIDGE_KEY)',start);
 const schedule=hook.indexOf("/internal/blofy-stream/ops/schedule",start);
 assert.ok(authorized>start&&schedule>authorized);
 assert.match(hook,/studioPro\.setSchedule\(sourceId/);
 assert.match(hook,/studioPro\.snapshot\(sourceId,label\)/);
 assert.match(hook,/firstRunImmediately:false/);
 assert.match(hook,/concurrentViewersMeasured:false/);
 assert.match(hook,/bumpXtreamCatalogRevision\(pool,id,'sync'\)/);
 const gateway=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
 const position=gateway.indexOf("action==='get_blofy_catalog_version'");
 const auth=gateway.indexOf('const account = await authenticate(username, password');
 assert.ok(position>auth);
 assert.match(gateway,/res\.setHeader\('cache-control','private, no-store'\)/);
});
