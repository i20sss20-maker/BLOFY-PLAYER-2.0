import test from 'node:test';
import assert from 'node:assert/strict';
import {shortlistExistingCategories} from '../src/stream-ai-category-shortlist.mjs';
test('sources with 600 categories still present 80 safe choices and preserve current shelf',()=>{
 const cats=Array.from({length:600},(_,i)=>({source_category_id:String(i),name:'قسم '+i,item_count:i}));
 cats[499].name='قنوات رياضة';
 const out=shortlistExistingCategories(cats,[
  {name:'مباراة رياضة',category_id:'4',categoryName:'قنوات رياضة'}]);
 assert.equal(out.length,80);
 assert.ok(out.some(x=>x.source_category_id==='4'));
 assert.ok(out.some(x=>x.source_category_id==='499'));
});
test('rejects unbounded result requests',()=>{
 assert.throws(()=>shortlistExistingCategories([],[],200),/invalid/);
});
