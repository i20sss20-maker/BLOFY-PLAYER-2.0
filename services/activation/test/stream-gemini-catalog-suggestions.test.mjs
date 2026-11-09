import test from 'node:test';
import assert from 'node:assert/strict';
import {suggestCatalogWithGemini} from '../src/stream-gemini-catalog-suggestions.mjs';
const sample=[{id:'1',name:'Sports Plus',categoryName:'Sport'}];
test('Gemini unconfigured makes zero requests',async()=>{
 let calls=0;
 const r=await suggestCatalogWithGemini(sample,{fetchImpl:async()=>{calls++;throw Error('must not call')}});
 assert.equal(r.code,'stream_ai_not_configured');assert.equal(calls,0);
});
test('Gemini sends only sanitized titles and uses structured JSON',async()=>{
 let calls=0;
 const list=[...sample,{id:'2',name:'https://bad.example/?password=secret',categoryName:'test'},
  {id:'3',name:'News Channel',categoryName:'News'}];
 const fetchImpl=async(url,options)=>{
  calls++;
  assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
  assert.equal(options.headers['x-goog-api-key'],'x'.repeat(40));
  assert.equal(options.redirect,'error');
  assert.equal(options.body.includes('password=secret'),false);
  const posted=JSON.parse(options.body);
  assert.equal(posted.generationConfig.responseMimeType,'application/json');
  assert.equal(posted.contents[0].parts[0].text.includes('secret'),false);
  return new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:
   JSON.stringify({suggestions:[{id:'1',category:'رياضة',
    cleanTitle:'Sports Plus',confidence:'مرتفع',reason:'رياضة'}]})}]}}]}),
   {status:200,headers:{'content-type':'application/json'}});
 };
 const r=await suggestCatalogWithGemini(list,{apiKey:'x'.repeat(40),fetchImpl});
 assert.equal(calls,1);
 assert.equal(r.ok,true);
 assert.equal(r.engine,'Google Gemini generateContent');
 assert.equal(r.suggestions.length,1);
 assert.equal(r.suggestions[0].category,'رياضة');
 assert.equal(r.advisoryOnly,true);
});
test('Gemini output cannot inject unknown IDs or unsafe URLs',async()=>{
 const fetchImpl=async()=>new Response(JSON.stringify({candidates:[{finishReason:'STOP',
  content:{parts:[{text:JSON.stringify({suggestions:[
   {id:'1000',category:'أخبار',cleanTitle:'Fake',confidence:'مرتفع',reason:'not in batch'},
   {id:'1',category:'رياضة',cleanTitle:'https://evil.example',confidence:'مرتفع',reason:'unsafe'}
  ]})}]}}]}),{status:200});
 const r=await suggestCatalogWithGemini(sample,{apiKey:'x'.repeat(40),fetchImpl});
 assert.equal(r.code,'stream_ai_invalid_output');
});
test('Gemini fails closed on provider errors, malformed or stopped generation',async()=>{
 const key='x'.repeat(40);
 const fail=await suggestCatalogWithGemini(sample,{apiKey:key,
  fetchImpl:async()=>new Response('secret provider error',{status:429})});
 assert.equal(fail.code,'stream_ai_provider_unavailable');
 const incomplete=await suggestCatalogWithGemini(sample,{apiKey:key,
  fetchImpl:async()=>new Response(JSON.stringify({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[]}}]}))});
 assert.equal(incomplete.code,'stream_ai_incomplete');
 const invalid=await suggestCatalogWithGemini(sample,{apiKey:key,
  fetchImpl:async()=>new Response('not json')});
 assert.equal(invalid.code,'stream_ai_request_failed');
});
test('Gemini model allowlist prevents URL injection',async()=>{
 let calls=0;
 const r=await suggestCatalogWithGemini(sample,{apiKey:'x'.repeat(40),
  model:'gemini-3.5-flash-lite/../../etc',fetchImpl:async()=>{calls++}});
 assert.equal(r.code,'stream_ai_model_not_allowed');assert.equal(calls,0);
});
