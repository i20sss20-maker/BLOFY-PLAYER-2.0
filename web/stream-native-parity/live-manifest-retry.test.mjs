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

test('channel switch and retry keep selected transport and do not race pending HLS shutdown',()=>{
 const a=app.indexOf('function resumeSelectedLiveTransport('),b=app.indexOf('function playDirectMpegts(',a);
 const calls=[];
 const resume=new Function('playDirectMpegts','playHls',app.slice(a,b)+';return resumeSelectedLiveTransport')(
  (...args)=>calls.push(['direct',...args]),(...args)=>calls.push(['hls',...args]));
 resume({id:8,mode:'mpegts'},'video','status');
 resume({id:9,mode:'hls'},'video','status');
 resume({id:10,mode:'mpegts',directStopPending:true},'video','status');
 assert.deepEqual(calls,[['direct','video','8','status'],['hls','video','live','9','ts',0,'status',false,0]]);
 assert.match(app,/requestedState\.directStopPending=true/);
 assert.match(app,/playDirectMpegts\(video,String\(requestedState\.id\),statusElement\)/);
});

test('direct MPEG-TS retains documented stash buffer and disables latency chasing',()=>{
 assert.match(app,/enableStashBuffer:true,stashInitialSize:393216/);
 assert.match(app,/liveBufferLatencyChasing:false,liveSync:false/);
 assert.match(app,/autoCleanupMaxBackwardDuration:45,\s*autoCleanupMinBackwardDuration:15/);
});

test('direct reconnect backs off on network and capacity failures without racing engines',()=>{
 const a=app.indexOf('function directLiveRetryDelay('),b=app.indexOf('function playDirectMpegts(',a);
 const delay=new Function(app.slice(a,b)+';return directLiveRetryDelay')();
 assert.deepEqual([0,1,2,3,4,99].map(n=>delay(n,false)),[2000,4000,8000,16000,20000,20000]);
 assert.deepEqual([0,1,2,3,4,99].map(n=>delay(n,true)),[5000,10000,20000,30000,30000,30000]);
 const start=app.indexOf(' function retryDirect(capacity)'),end=app.indexOf(' function fallback(msg)',start);
 const source=app.slice(start,end);
 const calls=[];let queued,active=true;
 const record={recoveryAttempt:0,engine:{destroy(){calls.push('destroy')}},reconnecting:false};
 const state={userPaused:false};
 const doc={hidden:false},nav={onLine:true};
 const video={pause(){},removeAttribute(){},load(){}};
 const retry=new Function('record','state','video','document','navigator','alive','fallback','countVisualOutage','playerStatus','setTimeout','clearTimeout','clearInterval','recordLiveIncident','playDirectMpegts','directLiveRetryDelay','id','statusElement',source+';return retryDirect')(
 record,state,video,doc,nav,()=>active,()=>calls.push('fallback'),()=>{},()=>{},(fn,ms)=>{queued={fn,ms};return 1},()=>{},()=>{},()=>{},()=>calls.push('reopen'),delay,'7',null);
 retry(true);retry(true);assert.deepEqual(calls,['destroy']);assert.equal(queued.ms,5000);
 doc.hidden=true;queued.fn();assert.equal(queued.ms,3000);assert.deepEqual(calls,['destroy']);
 doc.hidden=false;state.userPaused=true;queued.fn();assert.deepEqual(calls,['destroy']);
 state.userPaused=false;queued.fn();assert.deepEqual(calls,['destroy','reopen']);
 active=false;queued.fn();assert.deepEqual(calls,['destroy','reopen']);
});
