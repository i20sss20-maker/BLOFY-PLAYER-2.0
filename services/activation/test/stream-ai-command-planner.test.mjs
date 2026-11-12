import test from 'node:test';
import assert from 'node:assert/strict';
import {proposeCatalogCommand,validateOperatorInstruction} from '../src/stream-ai-command-planner.mjs';
const key='a'.repeat(40);
function fixture(action='category_sort',mode='smart'){
 return {candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({
  action,sortMode:mode,reply:'أقترح تنظيم الأقسام. انتظر موافقتك.'})}]}}]};
}
test('natural Arabic request produces a constrained, preview-only plan',async()=>{
 const result=await proposeCatalogCommand('نظم المكتبة وخل الرياضة بالأول',{
  apiKey:key,fetchImpl:async(url,opts)=>{
   assert.match(url,/generativelanguage\.googleapis\.com/);
   assert.equal(opts.headers['x-goog-api-key'],key);
   assert.equal(JSON.parse(opts.body).generationConfig.responseMimeType,'application/json');
   return new Response(JSON.stringify(fixture()));
  }});
 assert.equal(result.ok,true);assert.equal(result.action,'category_sort');
 assert.equal(result.sortMode,'smart');assert.equal(result.previewOnly,true);
});
test('unsupported instruction is never an executable action',async()=>{
 const r=await proposeCatalogCommand('احذف جميع مشتركين BLOFY',{apiKey:key,
  fetchImpl:async()=>new Response(JSON.stringify(fixture('none','none')))});
 assert.equal(r.allowed,false);assert.equal(r.action,'none');
});
test('rejects credentials, URLs and long prompt before outbound request',async()=>{
 let calls=0;
 for(const msg of ['https://example.com/channel','password=secret','a'.repeat(600)]){
  const r=await proposeCatalogCommand(msg,{apiKey:key,fetchImpl:async()=>{calls++;}});
  assert.equal(r.code,'ai_instruction_invalid');
 }
 assert.equal(calls,0);
});
test('unknown model or provider errors fail with fixed codes',async()=>{
 assert.equal((await proposeCatalogCommand('نظم المكتبة',{apiKey:key,model:'evil/path'})).code,'stream_ai_model_not_allowed');
 const r=await proposeCatalogCommand('رتب الفئات',{apiKey:key,
  fetchImpl:async()=>new Response('private data',{status:429})});
 assert.equal(r.code,'stream_ai_provider_quota');
});

test('Gemini can request tightly scoped title cleanup but never semantic rewriting',async()=>{
 const response=await proposeCatalogCommand('نظف الزخارف والمسافات من أسماء الأفلام',{
  apiKey:key,fetchImpl:async()=>new Response(JSON.stringify(fixture('titles_cleanup','none')))});
 assert.equal(response.allowed,true);
 assert.equal(response.action,'titles_cleanup');
 assert.equal(response.previewOnly,true);
});
test('previous chat messages are context only; current request remains authoritative',async()=>{
 let body;
 const result=await proposeCatalogCommand('خل الرياضة أولاً',{
  apiKey:key,history:['نظّم المكتبة','احذف كل الاشتراكات'],fetchImpl:async(_url,opts)=>{
    body=JSON.parse(opts.body);
    return new Response(JSON.stringify(fixture('category_sort','sports_first')));
  }});
 assert.equal(result.sortMode,'sports_first');
 assert.match(body.contents[0].parts[0].text,/رسائل المدير السابقة للفهم فقط/);
 assert.match(body.contents[0].parts[0].text,/طلب المدير الحالي/);
});
