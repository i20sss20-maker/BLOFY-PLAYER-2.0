import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readPrivateHubJsonResponse} from '../src/content-hub-private-json.mjs';

const json=(status,value,type='application/json; charset=utf-8')=>
 new Response(JSON.stringify(value),{status,headers:{'content-type':type}});

test('owner-only private movie/episode QA 202 acceptance retains async result',async()=>{
 const response=json(202,{ok:true,code:'mirror_media_qa_accepted',
  privateOnly:true,customerCutover:false});
 const decoded=await readPrivateHubJsonResponse(response,{
  allowedStatuses:[200,202,400,403,409]});
 assert.equal(decoded.code,'mirror_media_qa_accepted');
 assert.equal(decoded.customerCutover,false);
});

test('no media and rejected owner action keep explicit 409 and 403 JSON',async()=>{
 for(const code of [400,403,409]){
  const payload=await readPrivateHubJsonResponse(json(code,{
   ok:false,code:'mirror_media_qa_not_ready'
  }),{allowedStatuses:[200,202,400,403,409]});
  assert.equal(payload.ok,false);
  assert.equal(payload.code,'mirror_media_qa_not_ready');
 }
});

test('default strict caller only accepts 200; invalid types and payloads fail closed',async()=>{
 await assert.rejects(readPrivateHubJsonResponse(json(202,{ok:true})),
  /status_unexpected/);
 await assert.rejects(readPrivateHubJsonResponse(json(503,{ok:false}),{
  allowedStatuses:[200,202]}),/status_unexpected/);
 await assert.rejects(readPrivateHubJsonResponse(json(200,{ok:true},
  'text/plain')),/type_invalid/);
 await assert.rejects(readPrivateHubJsonResponse(
  new Response('invalid',{status:200,headers:{
   'content-type':'application/json'}})),/parse_failed/);
 await assert.rejects(readPrivateHubJsonResponse(json(200,[1,2])),
  /payload_invalid/);
 await assert.rejects(readPrivateHubJsonResponse(json(200,{
  large:'x'.repeat(1000)}),{maxBytes:128}),/too_large/);
});

test('owner admin route explicitly allows and forwards 202 without invoking strict 200 decoder',async()=>{
 const src=await readFile(new URL('../src/content-hub-admin-hook.mjs',
  import.meta.url),'utf8');
 const start=src.indexOf("const mirrorMediaQa=/^");
 const end=src.indexOf("if(path==='/api/v1/admin/content-hub/mirror/deployment/preflight'",start);
 assert.ok(start>0&&end>start);
 const fragment=src.slice(start,end);
 assert.match(fragment,/allowedStatuses:\[200,202,400,403,409\]/);
 assert.match(fragment,/return json\(res,response\.status,await readPrivateHubJsonResponse/);
 assert.doesNotMatch(fragment,/safeReadJson\(response\)/);
 assert.match(fragment,/verify-private-mirror-playback/);
});
