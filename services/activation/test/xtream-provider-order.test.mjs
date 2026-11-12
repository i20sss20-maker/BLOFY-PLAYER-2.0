import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {xtreamProviderOrder,withXtreamProviderPosition} from '../src/xtream-provider-order.mjs';

test('Xtream category order uses explicit upstream ranking when supplied',()=>{
 assert.equal(xtreamProviderOrder({category_order:2},8,'category'),2);
 assert.equal(xtreamProviderOrder({sort_order:'13'},8,'category'),13);
 assert.equal(xtreamProviderOrder({order:0},8,'category'),0);
});
test('preserves exact order returned by Xtream array when no valid rank',()=>{
 const returned=[{category_id:'900',category_name:'Movies'},
  {category_id:'10',category_name:'Sports'},
  {category_id:'2',category_name:'News'}];
 assert.deepEqual(returned.map((x,index)=>({
  id:x.category_id,order:xtreamProviderOrder(x,index+1,'category')
 })),[{id:'900',order:1},{id:'10',order:2},{id:'2',order:3}]);
});
test('Xtream item num wins when valid; fallback preserves response/M3U order',()=>{
 assert.equal(xtreamProviderOrder({num:'42'},100,'item'),42);
 assert.equal(xtreamProviderOrder({num:'abc'},100,'item'),100);
 assert.equal(xtreamProviderOrder({num:-5},11,'item'),11);
 assert.equal(xtreamProviderOrder({},25,'item'),25);
 assert.deepEqual(withXtreamProviderPosition({sourceId:'channel'},25),
  {sourceId:'channel',sourceSortOrder:25});
});
test('unsafe ordering data never becomes a SQL number',()=>{
 for(const value of ['1;DROP TABLE','10000000000','NaN','Infinity',-10,{},null])
  assert.equal(xtreamProviderOrder({order:value},4,'category'),4);
 assert.throws(()=>withXtreamProviderPosition({},0),/position_invalid/);
 assert.throws(()=>xtreamProviderOrder({},2,'invalid'),/kind_invalid/);
});
test('upstream order is persisted on sync and used by catalog listing',async()=>{
 const code=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 assert.match(code,/sort_order=EXCLUDED\.sort_order/);
 assert.match(code,/source_sort_order=EXCLUDED\.source_sort_order/);
 assert.match(code,/COALESCE\(c\.sort_order,2147483647\) ASC/);
 assert.match(code,/COALESCE\(i\.source_sort_order,2147483647\) ASC/);
 assert.match(code,/for\(const item of fallback\.categories\[mediaType\]\)/);
 assert.match(code,/xtreamProviderOrder\(raw,accepted\+1,'category'\)/);
 assert.match(code,/xtreamProviderOrder\(raw,accepted\+1,'item'\)/);
 assert.match(code,/ALTER TABLE blofy_xtream_items ADD COLUMN IF NOT EXISTS source_sort_order INTEGER/);
});

test('Gemini library chat never publishes category ordering over Xtream authority',async()=>{
 const code=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 assert.match(code,/action:'xtream_order_authority'/);
 assert.match(code,/stream_order_managed_by_xtream/);
 assert.match(code,/رتّبها هناك، ثم زامن مصدر Xtream/);
});
