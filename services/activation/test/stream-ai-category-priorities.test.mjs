import test from 'node:test';
import assert from 'node:assert/strict';
import {sortXtreamCategories} from '../src/xtream-category-sort.mjs';
const categories=[
 {source_category_id:'1',name:'أفلام عربية',item_count:5},
 {source_category_id:'2',name:'SSC رياضة',item_count:2},
 {source_category_id:'3',name:'أخبار اليوم',item_count:7},
 {source_category_id:'4',name:'كرتون أطفال',item_count:3}
];
test('specific requested category appears first without changing item IDs',()=>{
 assert.equal(sortXtreamCategories(categories,'sports_first')[0],'2');
 assert.equal(sortXtreamCategories(categories,'news_first')[0],'3');
 assert.equal(sortXtreamCategories(categories,'kids_first')[0],'4');
 assert.deepEqual(categories.map(x=>x.source_category_id),['1','2','3','4']);
});
