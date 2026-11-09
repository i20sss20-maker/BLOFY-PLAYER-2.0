import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareItemCategoryBatch,proposeExistingCategoryAssignments} from '../src/stream-ai-item-organizer.mjs';
const rows=[{id:'100',name:'Football Live',categoryName:'عام'},
 {id:'101',name:'Children Cartoons',categoryName:'عام'}];
const cats=[{source_category_id:'11',name:'رياضة'},{source_category_id:'12',name:'أطفال'}];
function result(items){
 return {candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({assignments:items})}]}}]};
}
test('prepares at most 12 sanitized titles and allowed categories',()=>{
 const input=prepareItemCategoryBatch(rows,cats);
 assert.equal(input.ok,true);
 assert.equal(input.entries.length,2);
 assert.equal(input.categoryOptions.length,2);
 assert.equal(prepareItemCategoryBatch(rows,Array.from({length:81},(_,i)=>({id:String(i),name:'قسم'}))).code,'ai_batch_invalid');
});
test('Gemini suggests only high-confidence pre-existing category IDs',async()=>{
 let calls=0;
 const out=await proposeExistingCategoryAssignments(rows,cats,{apiKey:'x'.repeat(40),
  fetchImpl:async(url,request)=>{
   calls++;
   assert.match(url,/generativelanguage\.googleapis\.com/);
   const body=JSON.parse(request.body);
   assert.equal(body.generationConfig.responseMimeType,'application/json');
   return new Response(JSON.stringify(result([
    {id:'100',categoryId:'11',confidence:'high',reason:'مباراة'},
    {id:'101',categoryId:'12',confidence:'medium',reason:'ربما'},
    {id:'102',categoryId:'11',confidence:'high',reason:'مختلق'},
    {id:'100',categoryId:'999',confidence:'high',reason:'فئة غير موجودة'}
   ])));
  }});
 assert.equal(calls,1);
 assert.equal(out.ok,true);assert.equal(out.assignments.length,1);
 assert.equal(out.assignments[0].categoryId,'11');
 assert.equal(out.declined,1);
});
test('no private credentials or streams leak to Gemini',async()=>{
 const output=prepareItemCategoryBatch([
  {id:'1',name:'https://host.test/playlist?password=secret',categoryName:'عام'},
  {id:'2',name:'Cartoon Show',categoryName:'أطفال'}
 ],cats);
 assert.equal(output.ok,true);
 assert.ok(!JSON.stringify(output).includes('password='));
});
test('bad keys, quota and model names fail with fixed safe errors',async()=>{
 assert.equal((await proposeExistingCategoryAssignments(rows,cats)).code,'stream_ai_not_configured');
 assert.equal((await proposeExistingCategoryAssignments(rows,cats,{apiKey:'x'.repeat(40),model:'evil'})).code,'stream_ai_model_not_allowed');
 const quota=await proposeExistingCategoryAssignments(rows,cats,{apiKey:'x'.repeat(40),
  fetchImpl:async()=>new Response('provider key should not leak',{status:429})});
 assert.equal(quota.code,'stream_ai_provider_quota');
 assert.ok(!JSON.stringify(quota).includes('provider key'));
});
