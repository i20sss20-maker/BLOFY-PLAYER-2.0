import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createStoreAiAssistantHandlers,storeAiConfiguration,safeStoreQuestion} from '../src/store-ai-assistant.mjs';

const question='هل يناسب BLOFY STREAM شاشة اندرويد قديمة؟';
const env={BLOFY_STORE_AI_ENABLED:'true',BLOFY_STORE_AI_API_KEY:'local-test-key-value-not-a-secret-123456',
 BLOFY_STORE_AI_MODEL:'gemini-2.5-flash'};
const origin='https://blofyplayer.com';
const request=(input,{headers={},method='POST'}={})=>({
 method,headers:{origin,'content-type':'application/json',...headers},
 socket:{remoteAddress:'127.0.0.1'},input
});
const json=(res,status,body,headers)=>Object.assign(res,{status,body,headers});
const url=pathname=>({pathname});

test('opt-in assistant is disabled by default even if another Gemini key exists',async()=>{
 let called=0;
 const handler=createStoreAiAssistantHandlers({
  env:{BLOFY_LIBRARY_GEMINI_API_KEY:'a'.repeat(40)},
  json,readJson:async r=>r.input,fetchImpl:async()=>{called++;throw Error('should not call');}
 });
 let res={};
 assert.equal(await handler(request({}),res,url('/elsewhere')),false);
 assert.equal(await handler(request({}, {method:'GET'}),res,url('/api/v1/store/assistant/availability')),true);
 assert.equal(res.body.mode,'guided');
 res={};
 await handler(request({question}),res,url('/api/v1/store/assistant/chat'));
 assert.equal(res.status,503);assert.equal(res.body.error,'assistant_not_enabled');
 assert.equal(called,0);
});

test('secure input rejects card numbers, email, URLs, codes and invalid model names',()=>{
 assert.equal(safeStoreQuestion('هل اشتراكك يناسب تلفزيون Android؟'),'هل اشتراكك يناسب تلفزيون Android؟');
 for(const value of ['رمز التحقق 123456','4111 1111 1111 1111','abc@gmail.com',
  'https://example.com/id','كلمة مرور سرية','a'.repeat(400),''])
  assert.equal(safeStoreQuestion(value),null,value);
 assert.equal(storeAiConfiguration({...env,BLOFY_STORE_AI_MODEL:'http://127.0.0.1'}).configured,false);
 assert.equal(storeAiConfiguration({...env,BLOFY_STORE_AI_ENABLED:'false'}).configured,false);
});

test('valid opt-in question receives a short, stateless generated reply',async()=>{
 const calls=[];
 const handler=createStoreAiAssistantHandlers({
  env,json,readJson:async req=>req.input,
  fetchImpl:async(path,options)=>{
   calls.push({path,options});
   return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:'جرّب صفحة التجربة وتأكد من توافق الجهاز.'}]}}]})};
  }
 });
 const res={};
 await handler(request({question}),res,url('/api/v1/store/assistant/chat'));
 assert.equal(res.status,200);
 assert.equal(res.body.reply,'جرّب صفحة التجربة وتأكد من توافق الجهاز.');
 assert.equal(res.body.mode,'generative');
 assert.equal(res.headers['cache-control'],'no-store, private');
 assert.equal(calls.length,1);
 assert.match(calls[0].path,/^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-2\.5-flash:generateContent$/);
 assert.equal(calls[0].options.headers['x-goog-api-key'],env.BLOFY_STORE_AI_API_KEY);
 const data=JSON.parse(calls[0].options.body);
 assert.deepEqual(data.contents,[{role:'user',parts:[{text:question}]}]);
 assert.equal(JSON.stringify(data).includes('sessionToken'),false);
 assert.equal(JSON.stringify(data).includes('customerId'),false);
 assert.match(data.systemInstruction.parts[0].text,/لا تختلق أسعارًا/);
});

test('cross-origin, invalid media type and sensitive questions never reach provider',async()=>{
 let calls=0;
 const handler=createStoreAiAssistantHandlers({env,json,readJson:async r=>r.input,
  fetchImpl:async()=>{calls++;throw Error('should not call');}});
 for(const [req,status] of [
  [request({question},{headers:{origin:'https://evil.example'}}),403],
  [request({question},{headers:{'content-type':'text/plain'}}),415],
  [request({question},{headers:{'content-length':'3000'}}),413],
  [request({question:'بطاقتي 4111111111111111'}),400]
 ]){
  const res={};
  await handler(req,res,url('/api/v1/store/assistant/chat'));
  assert.equal(res.status,status);
 }
 assert.equal(calls,0);
});

test('verified storefront handles financial questions without sending them to AI',async()=>{
 let external=0;
 const handler=createStoreAiAssistantHandlers({env,json,readJson:async r=>r.input,
  fetchImpl:async()=>{external++;throw Error('provider should not be called');}});
 const res={};
 await handler(request({question:'كم سعر الاشتراك في BLOFY؟'}),res,
  url('/api/v1/store/assistant/chat'));
 assert.equal(res.status,200);
 assert.equal(res.body.mode,'guided');
 assert.match(res.body.reply,/افتح صفحة المنتجات والسلة/);
 assert.equal(external,0);
});

test('provider failure is sanitized and rate limiter caps expensive calls',async()=>{
 let calls=0;
 const handler=createStoreAiAssistantHandlers({
  env,json,readJson:async r=>r.input,
  fetchImpl:async()=>{calls++;throw Error('private provider diagnostic must not reach browser');},
  clock:()=>1000000,rateKey:()=> 'same-test-client'
 });
 for(let i=0;i<9;i++){
  const res={};
  await handler(request({question}),res,url('/api/v1/store/assistant/chat'));
  assert.equal(res.status,i===8?429:503);
  assert.doesNotMatch(JSON.stringify(res),/private provider diagnostic/);
 }
 assert.equal(calls,8);
});

test('AI UI exposes accurate fallback and never sends checkout credentials',()=>{
 const html=readFileSync(new URL('../web/store-assistant.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../web/store-assistant.js',import.meta.url),'utf8');
 const server=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
 assert.match(html,/id="assistant-mode"/);
 assert.match(html,/الميزة التوليدية اختيارية/);
 assert.match(js,/\/api\/v1\/store\/assistant\/availability/);
 assert.match(js,/\/api\/v1\/store\/assistant\/chat/);
 assert.match(js,/credentials:'omit'/);
 assert.match(js,/add\(guided\.text,false,guided\.links\|\|\[\]\)/);
 assert.doesNotMatch(js,/innerHTML|localStorage|apiKey|sessionToken/);
 assert.doesNotThrow(()=>new Function(js));
 assert.match(server,/createStoreAiAssistantHandlers/);
 assert.match(server,/storeAiAssistant\(req,res,requestUrl\)/);
});
