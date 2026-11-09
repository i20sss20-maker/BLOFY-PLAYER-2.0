// Synthetic control-plane concurrency regression.
// This does NOT open 100 video streams and is not proof of 100 viewers.
import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {xtreamCatalogVersionForAccount} from '../src/xtream-catalog-revision.mjs';
import {gatewayOrderedItemsPageQuery,gatewayOrderCursor} from '../src/xtream-gateway-query.mjs';
const source='11111111-1111-4111-8111-111111111111';
test('100 synthetic code clients can concurrently check revision without content mutation',async()=>{
 let calls=0;
 const pool={async query(sql,params){
  calls++;
  assert.deepEqual(params,[source]);
  assert.match(sql,/FROM blofy_xtream_servers s/);
  return {rows:[{enabled:true,publish_catalog:true,status:'online',
   last_sync_at:'2026-11-10T01:00:00Z',revision:'19',
   counts:{live:9000,movie:24000,series:5000}}]};
 }};
 const clients=Array.from({length:100},(_,i)=>
  xtreamCatalogVersionForAccount(pool,source,i%2?'19':'18'));
 const started=performance.now();
 const results=await Promise.all(clients);
 assert.equal(calls,100);
 assert.equal(results.length,100);
 assert.equal(results.filter(x=>x.changed===true).length,50);
 assert.ok(results.every(x=>x.automaticPush===false));
 assert.ok(results.every(x=>x.counts.live===9000));
 // No stringent wall-time SLA: mocked database/network are not production.
 assert.ok(performance.now()>=started);
});
test('100 distinct ordered gateway pages preserve source scope and bounds',()=>{
 for(let i=1;i<=100;i++){
  const cursor=gatewayOrderCursor({
   sort_source_priority:100,sort_server_id:source,
   sort_category_order:i,sort_item_order:i*2,gateway_id:String(i)});
  const page=gatewayOrderedItemsPageQuery('live',cursor,{sourceId:source});
  assert.equal(page.values.length,8);
  assert.equal(page.values[1],source);
  assert.equal(page.values.at(-1),2000);
  assert.doesNotMatch(page.text,/\bOFFSET\b/);
 }
});
