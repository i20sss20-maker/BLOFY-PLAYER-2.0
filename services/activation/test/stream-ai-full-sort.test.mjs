import test from 'node:test';
import assert from 'node:assert/strict';
import {fullCatalogCategoryOrder,summarizeFullCatalogCoverage} from '../src/stream-ai-full-sort.mjs';
const rows=[
 {source_category_id:'f',name:'Foreign Movies',item_count:5},
 {source_category_id:'s',name:'STARZPLAY',item_count:7},
 {source_category_id:'b',name:'beIN SPORTS',item_count:3},
 {source_category_id:'a',name:'أفلام عربية 2026',item_count:2},
 {source_category_id:'t',name:'THMANEA',item_count:2},
 {source_category_id:'w',name:'أفلام عربية 2025',item_count:10},
 {source_category_id:'l',name:'ALWAN',item_count:1},
 {source_category_id:'h',name:'SHASHA',item_count:2}
];
test('live brands appear beIN, ALWAN, THMANEA, STARZPLAY, SHASHA',()=>{
 const result=fullCatalogCategoryOrder(rows,'live');
 assert.deepEqual(result.slice(0,5),['b','l','t','s','h']);
 assert.deepEqual(rows.map(x=>x.source_category_id),['f','s','b','a','t','w','l','h']);
});
test('movies and series prioritize Arabic categories with newer known year',()=>{
 for(const type of ['movie','series']){
  const result=fullCatalogCategoryOrder(rows,type);
  assert.equal(result[0],'a');
  assert.equal(result[1],'w');
 }
});
test('coverage does not invent dates or claim actual item classification',()=>{
 const summary=summarizeFullCatalogCoverage(rows,'movie');
 assert.equal(summary.datedAtLeast2026,1);
 assert.match(summary.note,/الأقسام الموجودة فقط/);
 assert.equal(summary.categories,8);
});
test('invalid media type and years fail closed',()=>{
 assert.throws(()=>fullCatalogCategoryOrder(rows,'movie',{cutoffYear:3000}),/invalid/);
 assert.throws(()=>fullCatalogCategoryOrder(rows,'all'),/invalid/);
});
