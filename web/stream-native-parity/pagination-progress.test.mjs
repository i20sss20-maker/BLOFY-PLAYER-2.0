import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('./app.js',import.meta.url),'utf8');
const snippet=source.slice(source.indexOf('function mergeCatalogPage('),source.indexOf('function loadMore('));
const ctx=vm.createContext({itemId:(item,kind)=>String(item.id??'')});
vm.runInContext(snippet,ctx);
const merge=(listing,page)=>ctx.mergeCatalogPage(listing,page,'movie');
test('duplicate-only pages preserve pagination when cursor advances',()=>{
 const listing={items:[{id:1},{id:2}],nextOffset:2,hasMore:true};
 assert.equal(merge(listing,{items:[{id:1},{id:2}],nextOffset:4,hasMore:true}).length,0);
 assert.equal(listing.nextOffset,4);assert.equal(listing.hasMore,true);
 assert.equal(merge(listing,{items:[{id:3}],nextOffset:5,hasMore:false}).length,1);
 assert.equal(listing.items.length,3);assert.equal(listing.hasMore,false);
});
test('invalid or stalled cursor leaves cached content unchanged',()=>{
 for(const nextOffset of [2,1,NaN,2.5]){
  const listing={items:[{id:1},{id:2}],nextOffset:2,hasMore:true};
  assert.equal(merge(listing,{items:[{id:3}],nextOffset,hasMore:true}),null);
  assert.equal(listing.items.length,2);assert.equal(listing.nextOffset,2);assert.equal(listing.hasMore,true);
 }
});
test('final empty page ends pagination and duplicates within a page are removed',()=>{
 const listing={items:[{id:1}],nextOffset:1,hasMore:true};
 assert.equal(merge(listing,{items:[{id:2},{id:2},{id:1}],nextOffset:4,hasMore:true}).length,1);
 assert.equal(merge(listing,{items:[],nextOffset:4,hasMore:false}).length,0);
 assert.equal(listing.items.length,2);assert.equal(listing.hasMore,false);
});
