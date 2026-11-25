import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const app=await readFile(new URL('./app.js',import.meta.url),'utf8');
const begin=app.indexOf('function resumeLiveHlsNetwork('),end=app.indexOf('function playHls(',begin);
assert.ok(begin>=0&&end>begin);
const resume=new Function(app.slice(begin,end)+';return resumeLiveHlsNetwork')();
test('initial failed manifest reloads the same session URL',()=>{
 const calls=[],engine={loadSource:url=>calls.push(url),startLoad:()=>calls.push('start')};
 resume(engine,'/same-manifest',{});
 assert.deepEqual(calls,['/same-manifest']);
});
test('established HLS session resumes loading without reloading the source',()=>{
 const calls=[],engine={loadSource:url=>calls.push(url),startLoad:()=>calls.push('start')};
 resume(engine,'/same-manifest',{manifestParsed:true});
 assert.deepEqual(calls,['start']);
});

const lostStart=app.indexOf('function liveSessionLost(');
const lostEnd=app.indexOf('function resumeLiveHlsNetwork(',lostStart);
const {liveSessionLost,liveSessionRetryDelay}=new Function(app.slice(lostStart,lostEnd)+';return {liveSessionLost,liveSessionRetryDelay}')();
test('only established fatal missing fragments or unavailable playlists require a new session',()=>{
 assert.equal(liveSessionLost({manifestParsed:true},{fatal:true,frag:{}},404),true);
 assert.equal(liveSessionLost({manifestParsed:true},{fatal:true,details:'levelLoadError'},503),true);
 assert.equal(liveSessionLost({},{fatal:true,frag:{}},404),false);
 assert.equal(liveSessionLost({manifestParsed:true},{fatal:false,frag:{}},404),false);
 assert.equal(liveSessionLost({manifestParsed:true},{fatal:true,details:'fragLoadError'},429),false);
});
test('source restart backoff is bounded and respects a valid Retry-After',()=>{
 assert.equal(liveSessionRetryDelay(0,0),5000);
 assert.equal(liveSessionRetryDelay(2,12),12000);
 assert.equal(liveSessionRetryDelay(4,30),30000);
 assert.equal(liveSessionRetryDelay(4,999),25000);
});

test('full-screen adds a modest bounded buffer reserve while preview remains unchanged',()=>{
 const start=app.indexOf('function liveBufferProfile('),end=app.indexOf('function resumeLiveHlsNetwork(',start);
 const profile=new Function(app.slice(start,end)+';return liveBufferProfile')();
 assert.deepEqual(profile(true),{sync:4,maxLatency:10,buffer:35});
 assert.deepEqual(profile(false),{sync:5,maxLatency:12,buffer:45});
 assert.match(app,/record\.ready\|\|record\.reconnecting\|\|context\.userPaused\|\|record\.autoplayBlocked/);
 assert.match(app,/!record\.ready\|\|record\.reconnecting\|\|!video\.isConnected/);
});

test('live sequence guard detects a reset without treating duplicate playlists as failures',()=>{
 const start=app.indexOf('function liveSequenceRegressed('),end=app.indexOf('function liveBufferProfile(',start);
 const check=new Function(app.slice(start,end)+';return liveSequenceRegressed')();
 const state={};
 assert.equal(check(state,{startSN:10,endSN:17,live:true}),false);
 assert.equal(check(state,{startSN:11,endSN:18,live:true}),false);
 assert.equal(check(state,{startSN:11,endSN:18,live:true}),false);
 assert.equal(check(state,{startSN:0,endSN:7,live:false}),false);
 assert.equal(check(state,{startSN:0,endSN:7,live:true}),true);
 assert.equal(check(state,{startSN:0,endSN:null,live:true}),false);
 assert.equal(state.highestLiveEndSN,18);
});

test('provider retry hint accepts only bounded integer seconds from XHR or Fetch',()=>{
 const start=app.indexOf('function liveRetryHint('),end=app.indexOf('function liveSessionRetryDelay(',start);
 const hint=new Function(app.slice(start,end)+';return liveRetryHint')();
 assert.equal(hint({networkDetails:{getResponseHeader:()=> '12'}}),12000);
 assert.equal(hint({networkDetails:{headers:{get:()=> '30'}}}),30000);
 for(const value of [null,'0','31','999','1.5','invalid'])assert.equal(hint({networkDetails:{getResponseHeader:()=>value}}),0);
 assert.equal(hint({}),0);
 assert.equal(hint({networkDetails:{getResponseHeader(){throw Error('unavailable')}}}),0);
 assert.match(app,/Math\.max\(liveCapacityRetryMs\(record\.capacityRetries\),liveRetryHint\(detail\)\)/);
 assert.match(app,/Math\.max\(liveOriginRetryMs\(record\.originRetries\),liveRetryHint\(detail\)\)/);
});

test('live HLS has explicit forward and back buffer caps',()=>{
 assert.match(app,/maxBufferLength:bufferProfile\.buffer,maxMaxBufferLength:preview\?45:60,backBufferLength:preview\?12:30/);
});

test('startup recovers when decoder stays paused but no user gesture is required',()=>{
 const a=app.indexOf('function liveStartupDecision('),b=app.indexOf('function liveRetryHint(',a);
 const decide=new Function(app.slice(a,b)+';return liveStartupDecision')();
 assert.equal(decide({},{active:true,paused:true}),'recover');
 assert.equal(decide({autoplayBlocked:true},{active:true}),'stop');
 assert.equal(decide({},{active:true,userPaused:true}),'stop');
 assert.equal(decide({},{active:true,hidden:true}),'defer');
 assert.equal(decide({},{active:true,offline:true}),'defer');
 assert.equal(decide({originTimer:1},{active:true}),'defer');
 assert.equal(decide({reconnecting:true},{active:true}),'stop');
 assert.equal(decide({},{active:false}),'stop');
 assert.match(app,/error\.name==='NotAllowedError'/);
});

test('desktop direct live transport is limited to compatible MSE browsers; TV and touch retain HLS',()=>{
 const a=app.indexOf('function preferDesktopDirectLive('),b=app.indexOf('function playDirectMpegts(',a);
 const prefer=new Function(app.slice(a,b)+';return preferDesktopDirectLive')();
 assert.equal(prefer('desktop',{isTypeSupported:()=>true}),true);
 assert.equal(prefer('desktop',{isTypeSupported:()=>false}),false);
 assert.equal(prefer('desktop',null),false);
 assert.equal(prefer('tv',{isTypeSupported:()=>true}),false);
 assert.equal(prefer('touch',{isTypeSupported:()=>true}),false);
 assert.equal(prefer('desktop',{isTypeSupported:()=>{throw Error('unsupported')}}),false);
 assert.match(app,/statusCode===429\|\|statusCode===503/);
});
