import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {allowedLiveTsRecoveryPilot,safeLiveTsRecoveryStart,liveTsRecoveryBytes}
 from '../src/xtream-live-ts-recovery.mjs';

const accountId='937ba740-b1dd-44cf-9ff4-55b99e4ca15a';
const sourceId='f2631a8b-37e4-4b37-ab7b-3f3fe2de912f';
const other='4e0ce9b3-1b26-4405-af70-86be533e2ffc';
const url='https://authorized-test-origin.example/live/credential-redacted/1001.ts';
function ts(){
 const b=new Uint8Array(564);
 b[0]=b[188]=b[376]=0x47;
 return b;
}
function response(bytes=ts(),opts={}){
 return new Response(new ReadableStream({
  start(c){c.enqueue(bytes);if(!opts.open)c.close();}
 }),{status:opts.status||200,headers:{'content-type':'video/mp2t',...opts.headers}});
}
function failingResponse(){
 let step=0;
 return new Response(new ReadableStream({
  pull(c){if(step++===0)c.enqueue(ts());else c.error(new Error('transport reset'));}
 }),{status:200,headers:{'content-type':'video/mp2t'}});
}
const immediately=async({signal})=>!signal?.aborted;

test('reconnection is explicitly bound to one account AND one source',()=>{
 const ok={enabled:true,accountId,sourceId,pilotAccountId:accountId,pilotSourceId:sourceId};
 assert.equal(allowedLiveTsRecoveryPilot(ok),true);
 for(const changes of [{enabled:false},{pilotAccountId:''},{pilotSourceId:''},
   {pilotAccountId:other},{pilotSourceId:other},{sourceId:other},{accountId:other},
   {pilotAccountId:'*'},{pilotSourceId:'*'}])
  assert.equal(allowedLiveTsRecoveryPilot({...ok,...changes}),false);
});
test('live TS source must be open-ended, direct, uncompressed, non-ranged and first packets validated',()=>{
 const init=response();
 const ok={enabled:true,kind:'live',method:'GET',status:200,
  requestRange:null,usingIndependentRelay:false,format:'ts',response:init,first:ts()};
 assert.equal(safeLiveTsRecoveryStart(ok),true);
 for(const change of [{enabled:false},{kind:'movie'},{method:'HEAD'},
   {status:206},{requestRange:'bytes=0-'},{usingIndependentRelay:true},
   {format:'hls'},{first:new Uint8Array(564)},
   {response:response(ts(),{headers:{'content-length':'564'}})},
   {response:response(ts(),{headers:{'content-encoding':'gzip'}})},
   {response:response(ts(),{headers:{'content-range':'bytes 0-563/564'}})}])
  assert.equal(safeLiveTsRecoveryStart({...ok,...change}),false,JSON.stringify(change));
});
test('a transient live EOF or socket drop reconnects SAME URI after old socket closed',async()=>{
 const initial=failingResponse(),reader=initial.body.getReader();
 const first=(await reader.read()).value;
 const old=new AbortController();
 let calls=0;let events=[];
 const iter=liveTsRecoveryBytes({
  first,reader,controller:old,target:url,clientSignal:new AbortController().signal,
  waitRetry:immediately,headers:{'user-agent':'BLOFY-QA'},
  fetchImpl:async(target,req)=>{
   calls++;
   assert.equal(String(target),url);
   assert.equal(req.method,'GET');
   assert.equal(req.headers.range,undefined);
   assert.equal(req.headers['accept-encoding'],'identity');
   assert.equal(req.headers['user-agent'],'BLOFY-QA');
   assert.equal(old.signal.aborted,true,'release old connection before opening another');
   return response();
  },onReconnect:event=>events.push(event)
 });
 const firstOut=await iter.next(), secondOut=await iter.next();
 assert.equal(firstOut.value.length,564);
 assert.deepEqual(secondOut.value,ts());
 await iter.return();
 assert.equal(calls,1);
 assert.deepEqual(events,[{attempt:1}]);
});
test('provider refusal 403/429/509 is terminal, never retried after bytes',async()=>{
 for(const status of [403,429,509]){
  const initial=failingResponse(),reader=initial.body.getReader();
  const first=(await reader.read()).value;
  let calls=0;
  const iter=liveTsRecoveryBytes({first,reader,controller:new AbortController(),
   target:url,waitRetry:immediately,fetchImpl:async()=>{
    calls++;return new Response('denied',{status});
   }});
  assert.equal((await iter.next()).value.length,564);
  await assert.rejects(async()=>{await iter.next()},/live_ts_reconnect_denied/);
  assert.equal(calls,1);
 }
});
test('network reconnects are capped at two, no infinite retry storm',async()=>{
 const initial=failingResponse(),reader=initial.body.getReader();
 const first=(await reader.read()).value;
 let calls=0;
 const iter=liveTsRecoveryBytes({first,reader,controller:new AbortController(),
  target:url,waitRetry:immediately,fetchImpl:async()=>{calls++;throw Error('ECONNRESET');}});
 assert.equal((await iter.next()).value.length,564);
 await assert.rejects(async()=>{await iter.next()},/live_ts_reconnect_exhausted/);
 assert.equal(calls,2);
});
test('client disconnect prevents any additional provider request',async()=>{
 const initial=failingResponse(),reader=initial.body.getReader();
 const first=(await reader.read()).value;
 const ctl=new AbortController();
 let calls=0;
 const iter=liveTsRecoveryBytes({first,reader,controller:new AbortController(),
  clientSignal:ctl.signal,target:url,
  waitRetry:async()=>{ctl.abort();return false;},
  fetchImpl:async()=>{calls++;return response();}
 });
 assert.equal((await iter.next()).value.length,564);
 await assert.rejects(async()=>{await iter.next()},/live_ts_client_closed/);
 assert.equal(calls,0);
});
test('production entrypoint keeps midstream recovery off without exact opt-in',async()=>{
 const gateway=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
 const start=gateway.slice(gateway.indexOf('const liveTsPilot=safeLiveTsRecoveryStart({'),
  gateway.indexOf('let resumedVod=false;',gateway.indexOf('const liveTsPilot=')));
 assert.match(start,/enabled:allowedLiveTsRecoveryPilot/);
 assert.match(start,/BLOFY_XTREAM_LIVE_TS_RECOVERY_ENABLED==='1'/);
 assert.match(start,/BLOFY_XTREAM_LIVE_TS_RECOVERY_PILOT_ACCOUNT_ID/);
 assert.match(start,/BLOFY_XTREAM_LIVE_TS_RECOVERY_PILOT_SOURCE_ID/);
 assert.match(gateway,/liveTsPilot\?\s*Readable\.from\(liveTsRecoveryBytes/);
 assert.match(gateway,/BLOFY_LIVE_TS_RECOVERED/);
});
