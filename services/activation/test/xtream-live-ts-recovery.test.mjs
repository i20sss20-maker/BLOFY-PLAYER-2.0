import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {allowedLiveTsRecoveryPilot,safeLiveTsRecoveryStart,liveTsRecoveryBytes,createLiveTsReconnectBudget,liveTsSourceDropReason}
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

test('global source reconnect budget limits storms without identifying subscribers',async()=>{
 const {createLiveTsSourceRetryGate}=await import('../src/xtream-live-ts-recovery.mjs');
 let time=10000;
 const gate=createLiveTsSourceRetryGate({now:()=>time,windowMs:120000,maxPerSource:2});
 for(let n=0;n<2;n++)assert.equal(gate.claim(sourceId),null);
 assert.equal(gate.claim(sourceId),'live_ts_reconnect_rate_limited');
 assert.equal(gate.claim(other),null,'a different source does not share the quota');
 time+=120001;
 assert.equal(gate.claim(sourceId),null);
 assert.equal(gate.claim('unknown'),'live_ts_reconnect_rate_limited');
});
test('gateway treats first-byte TS as uncompressed low-latency and only retries prestart transport',async()=>{
 const gateway=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
 assert.match(gateway,/headers\['accept-encoding'\]='identity'/);
 assert.match(gateway,/kind==='live'\?3:2/);
 assert.match(gateway,/liveSourceRetryGate\.claim\(row\.server_id\)/);
 assert.match(gateway,/no-store, no-transform/);
 assert.match(gateway,/onlyValidatedDirectTs:true/);
});

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
 assert.equal(events.length,1);
 assert.equal(events[0].attempt,1);
 assert.equal(events[0].retriesThisDrop,1);
 assert.equal(events[0].sourceDropReason,'live_ts_source_transport_error');
 assert.ok(Number.isFinite(events[0].interruptionMs)&&events[0].interruptionMs>=0);
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
 assert.match(start,/enabled:authorizedMediaRecoveryRelease/);
 assert.match(start,/BLOFY_XTREAM_LIVE_TS_RECOVERY_PRODUCTION/);
 assert.match(start,/allowedLiveTsRecoveryPilot/);
 assert.match(start,/BLOFY_XTREAM_LIVE_TS_RECOVERY_ENABLED==='1'/);
 assert.match(start,/BLOFY_XTREAM_LIVE_TS_RECOVERY_PILOT_ACCOUNT_ID/);
 assert.match(start,/BLOFY_XTREAM_LIVE_TS_RECOVERY_PILOT_SOURCE_ID/);
 assert.match(gateway,/liveTsPilot\?\s*Readable\.from\(liveTsRecoveryBytes/);
 assert.match(gateway,/BLOFY_LIVE_TS_RECOVERED/);
});

test('third clean live drop can recover after two previous successful reconnects',async()=>{
 const initial=response(),reader=initial.body.getReader();
 const first=(await reader.read()).value;
 let calls=0,seen=[];
 const iter=liveTsRecoveryBytes({first,reader,controller:new AbortController(),
  target:url,waitRetry:immediately,
  fetchImpl:async()=>{calls++;return response();},
  onReconnect:e=>seen.push(e.attempt)
 });
 for(let i=0;i<4;i++)assert.equal((await iter.next()).value.length,564);
 await iter.return();
 assert.equal(calls,3);
 assert.deepEqual(seen,[1,2,3]);
});

test('rolling window rate cap prevents source retry storms, but credits refill',()=>{
 let t=100_000;
 const budget=createLiveTsReconnectBudget({now:()=>t,maxInWindow:3,maxTotal:5,windowMs:120000});
 for(let i=0;i<3;i++)assert.equal(budget.claim(),null);
 assert.equal(budget.claim(),'live_ts_reconnect_rate_limited');
 t+=120001;
 assert.equal(budget.claim(),null);
 assert.equal(budget.claim(),null);
 assert.equal(budget.claim(),'live_ts_reconnect_budget_exhausted');
 t+=300001;
 assert.equal(budget.claim(),null,'stable gap resets the per-session breaker');
});

test('recovery stream never opens a ninth source within the two-minute budget',async()=>{
 const firstReply=response(),reader=firstReply.body.getReader(),first=(await reader.read()).value;
 let calls=0;
 const budget=createLiveTsReconnectBudget({now:()=>200000,maxInWindow:2,maxTotal:120});
 const iter=liveTsRecoveryBytes({first,reader,controller:new AbortController(),
  target:url,waitRetry:immediately,reconnectBudget:budget,
  fetchImpl:async()=>{calls++;return response();}
 });
 for(let i=0;i<3;i++)assert.equal((await iter.next()).value.length,564);
 await assert.rejects(async()=>{await iter.next()},/live_ts_reconnect_rate_limited/);
 assert.equal(calls,2,'no unbounded connection attempts');
});

test('interruption classifier separates clean EOF, stalled source, network error without raw data',()=>{
 assert.equal(liveTsSourceDropReason(new Error('live_ts_source_eof'),null),'live_ts_source_eof');
 const stalled=new AbortController();stalled.abort(new Error('live_ts_read_timeout'));
 assert.equal(liveTsSourceDropReason(new Error('AbortError'),stalled),'live_ts_source_stalled');
 assert.equal(liveTsSourceDropReason(new Error('RESET private-password-must-not-log'),null),
  'live_ts_source_transport_error');
});
test('midstream recovery records source uptime for successive real EOFs, without more fetches',async()=>{
 const original=response(),reader=original.body.getReader(),first=(await reader.read()).value;
 let time=1000,calls=0,events=[];
 const iter=liveTsRecoveryBytes({first,reader,controller:new AbortController(),
  target:url,waitRetry:immediately,now:()=>time,
  onSourceDrop:event=>events.push(event),
  fetchImpl:async()=>{calls++;return response()}
 });
 assert.equal((await iter.next()).value.length,564);
 time+=20000;
 assert.equal((await iter.next()).value.length,564);
 time+=30000;
 assert.equal((await iter.next()).value.length,564);
 await iter.return();
 assert.equal(calls,2);
 assert.deepEqual(events,[
  {reason:'live_ts_source_eof',durationMs:20000},
  {reason:'live_ts_source_eof',durationMs:30000}
 ]);
});
test('gateway emits sanitized upstream drop category, distinct from successful reconnect',async()=>{
 const gateway=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
 assert.match(gateway,/onSourceDrop:\(\{reason,durationMs\}\)=>/);
 assert.match(gateway,/observe\('source_drop',\{reason,durationMs\}\)/);
 assert.match(gateway,/BLOFY_LIVE_TS_SOURCE_DROP/);
 assert.match(gateway,/secondsBucket:Number\.isFinite\(durationMs\)/);
});


test('after live EOF a transient 408/500/502/503/504 gets one bounded recovery retry, then valid TS',async()=>{
 for(const status of [408,500,502,503,504]){
  const initial=failingResponse(),reader=initial.body.getReader();
  const first=(await reader.read()).value;
  let calls=0;
  const iter=liveTsRecoveryBytes({
   first,reader,controller:new AbortController(),target:url,
   waitRetry:immediately,
   fetchImpl:async()=>{
    calls++;
    return calls===1?new Response('upstream temporarily unavailable',{status}):response();
   }
  });
  assert.equal((await iter.next()).value.length,564);
  assert.deepEqual((await iter.next()).value,ts());
  assert.equal(calls,2,'only one failed 5xx and one successful retry');
  await iter.return();
 }
});

test('repeated upstream 503 exhausts only two attempts; no reconnect storm',async()=>{
 const initial=failingResponse(),reader=initial.body.getReader();
 const first=(await reader.read()).value;
 let calls=0;
 const iter=liveTsRecoveryBytes({
  first,reader,controller:new AbortController(),target:url,waitRetry:immediately,
  fetchImpl:async()=>{calls++;return new Response('temporary outage',{status:503});}
 });
 assert.equal((await iter.next()).value.length,564);
 await assert.rejects(async()=>await iter.next(),/live_ts_reconnect_exhausted/);
 assert.equal(calls,2);
});

test('midstream retry never bypasses HTTP denial or invalid TS response',async()=>{
 for(const status of [401,403,404,429,456,509]){
  const initial=failingResponse(),reader=initial.body.getReader();
  const first=(await reader.read()).value;
  let calls=0;
  const iter=liveTsRecoveryBytes({
   first,reader,controller:new AbortController(),target:url,waitRetry:immediately,
   fetchImpl:async()=>{calls++;return new Response('provider denied',{status});}
  });
  assert.equal((await iter.next()).value.length,564);
  await assert.rejects(async()=>await iter.next(),/live_ts_reconnect_denied/);
  assert.equal(calls,1);
 }
});


test('recovery reports measured media interruption instead of confusing upstream uptime with blackout',async()=>{
 const initial=failingResponse(),reader=initial.body.getReader();
 const first=(await reader.read()).value;
 let t=1000,drop=null,recovered=null,calls=0;
 const iter=liveTsRecoveryBytes({
  first,reader,controller:new AbortController(),target:url,
  now:()=>t,
  waitRetry:async()=>{t+=650;return true;},
  onSourceDrop:e=>{drop=e;},
  onReconnect:e=>{recovered=e;},
  fetchImpl:async()=>{calls++;t+=250;return response();}
 });
 assert.equal((await iter.next()).value.length,564);
 t+=17000;
 assert.equal((await iter.next()).value.length,564);
 assert.equal(calls,1);
 assert.deepEqual(drop,{reason:'live_ts_source_transport_error',durationMs:17000});
 assert.deepEqual(recovered,{
  attempt:1,retriesThisDrop:1,
  interruptionMs:900,sourceDropReason:'live_ts_source_transport_error'
 });
 await iter.return();
});

test('two transient upstream 503 attempts report a single terminal failure without a fabricated recovery',async()=>{
 const initial=failingResponse(),reader=initial.body.getReader();
 const first=(await reader.read()).value;
 let recoveries=0,attempts=0;
 const iter=liveTsRecoveryBytes({
  first,reader,controller:new AbortController(),target:url,
  waitRetry:immediately,
  fetchImpl:async()=>{attempts++;return new Response('temporary',{status:503});},
  onReconnect:()=>recoveries++
 });
 assert.equal((await iter.next()).value.length,564);
 await assert.rejects(async()=>await iter.next(),/live_ts_reconnect_exhausted/);
 assert.equal(attempts,2);
 assert.equal(recoveries,0,'a 503 is not restored decoded media');
});

test('gateway logs rounded media gap and never includes account, credential or URL',async()=>{
 const gateway=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
 const segment=gateway.slice(gateway.indexOf('onReconnect:({attempt:reconnection,interruptionMs'),
  gateway.indexOf('})):',gateway.indexOf('onReconnect:({attempt:reconnection,interruptionMs')));
 assert.match(segment,/gapBucketMs=Number.isFinite\(interruptionMs\)/);
 assert.match(segment,/Math.round\(interruptionMs\/500\)\*500/);
 assert.match(segment,/BLOFY_LIVE_TS_RECOVERED/);
 const logStart=segment.indexOf("console.info('BLOFY_LIVE_TS_RECOVERED',JSON.stringify({");
 assert.ok(logStart>=0,'recovery events are emitted as one JSON log entry');
 const logEnd=segment.indexOf('}));',logStart);
 assert.ok(logEnd>logStart,'JSON log is properly terminated');
 const logPayload=segment.slice(logStart,logEnd+4);
 assert.doesNotMatch(logPayload,/password|username|accountId|credentials|target\.href|clientIp/);
});

test('clean TS EOF uses a shorter first retry without weakening other retries',async()=>{
 const {mediaRetryDelayMs}=await import('../src/xtream-media-retry-backoff.mjs');
 assert.equal(mediaRetryDelayMs(1,()=>0.5,{firstAttemptBaseMs:300}),300);
 assert.equal(mediaRetryDelayMs(1,()=>0.5),700);
 assert.equal(mediaRetryDelayMs(2,()=>0.5,{firstAttemptBaseMs:300}),1400);
 const initial=response(),reader=initial.body.getReader(),first=(await reader.read()).value;
 const waits=[];
 const iter=liveTsRecoveryBytes({
  first,reader,controller:new AbortController(),target:url,
  waitRetry:async options=>{waits.push(options);return true;},
  fetchImpl:async()=>response()
 });
 assert.equal((await iter.next()).value.length,564);
 assert.equal((await iter.next()).value.length,564);
 await iter.return();
 assert.equal(waits[0].firstAttemptBaseMs,300);
});
