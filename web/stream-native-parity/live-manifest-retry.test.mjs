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
 const resume=new Function('playDirectMpegts','playHls','installedLiveResume',app.slice(a,b)+';return resumeSelectedLiveTransport')(
  (...args)=>calls.push(['direct',...args]),(...args)=>calls.push(['hls',...args]),null);
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

test('HLS delayed recovery defers while paused/offline and manual play restarts a reconnecting engine',()=>{
 const a=app.indexOf('   function resumeHlsRecovery(){'),b=app.indexOf('   record.retryTimer=setTimeout(resumeHlsRecovery,25000);',a);
 let queued,opened=0,active=true;
 const record={},state={userPaused:true},doc={hidden:false},nav={onLine:true},video={isConnected:true};
 const f=new Function('record','state','document','navigator','video','alive','S','playHls','setTimeout','kind','id','extension','track','statusElement',app.slice(a,b)+';return resumeHlsRecovery')(record,state,doc,nav,video,()=>active,{route:'player'},()=>opened++,(fn,ms)=>{queued={fn,ms};return 1},'live','9','ts',0,null);
 f();assert.equal(queued.ms,3000);assert.equal(opened,0);
 state.userPaused=false;nav.onLine=false;queued.fn();assert.equal(opened,0);
 nav.onLine=true;doc.hidden=true;queued.fn();assert.equal(opened,0);
 doc.hidden=false;queued.fn();assert.equal(opened,1);
 active=false;queued.fn();assert.equal(opened,1);
 assert.match(app,/S\.play\.video===video&&S\.play\.reconnecting/);
});

test('Apple touch Safari with supported MSE or ManagedMediaSource uses direct TS, not TV or Android',()=>{
 const a=app.indexOf('function preferDesktopDirectLive('),b=app.indexOf('function resumeSelectedLiveTransport(',a);
 const prefer=new Function(app.slice(a,b)+';return preferDirectLiveForDevice')();
 const good={isTypeSupported:()=>true},bad={isTypeSupported:()=>false};
 assert.equal(prefer('touch','iPad Safari',{ManagedMediaSource:good}),true);
 assert.equal(prefer('touch','Macintosh Safari',{MediaSource:good}),true);
 assert.equal(prefer('touch','iPhone Safari',{ManagedMediaSource:bad}),false);
 assert.equal(prefer('tv','Safari',{ManagedMediaSource:good}),false);
 assert.equal(prefer('touch','Android Chrome',{MediaSource:good}),false);
 assert.equal(prefer('desktop','Chrome',{MediaSource:good}),true);
 assert.match(app,/video\.disableRemotePlayback=true/);
});

test('installed Apple WebKit without Safari token can use direct engine when supported',()=>{
 const a=app.indexOf('function preferDesktopDirectLive('),b=app.indexOf('function resumeSelectedLiveTransport(',a);
 const prefer=new Function(app.slice(a,b)+';return preferDirectLiveForDevice')();
 const ua='Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile/15E148';
 const win={ManagedMediaSource:{isTypeSupported:()=>true}};
 assert.equal(prefer('touch',ua,win,true),true);
 assert.equal(prefer('touch',ua,win,false),false);
 assert.equal(prefer('tv',ua,win,true),false);
});
test('installed live restoration only resumes the same retired viewer and respects offline and pause',()=>{
 const a=app.indexOf('function installedLiveResumeDecision('),b=app.indexOf('function resumeInstalledLiveAfterExit(',a);
 const decide=new Function(app.slice(a,b)+';return installedLiveResumeDecision')();
 const state={kind:'live',id:'17',video:{isConnected:true}},pending={state,id:'17'};
 const context={installed:true,verified:true,route:'player',hidden:false,offline:false};
 assert.equal(decide(pending,state,null,context),'resume');
 assert.equal(decide(pending,state,{},context),'discard');
 assert.equal(decide(pending,state,null,{...context,offline:true}),'defer');
 assert.equal(decide(pending,state,null,{...context,hidden:true}),'defer');
 assert.equal(decide(pending,state,null,{...context,installed:false}),'discard');
 state.userPaused=true;assert.equal(decide(pending,state,null,context),'defer');
 state.userPaused=false;state.id='18';assert.equal(decide(pending,state,null,context),'discard');
});

test('direct startup defers in background and offline and never switches engine on autoplay denial',()=>{
 const a=app.indexOf(' function directStartupCheck(){'),b=app.indexOf(' record.startupCheck=directStartupCheck;',a);
 const c=app.indexOf('function liveStartupDecision('),d=app.indexOf('function liveRetryHint(',c);
 const decide=new Function(app.slice(c,d)+';return liveStartupDecision')();
 let queued,retries=0;
 const record={},state={},doc={hidden:true},nav={onLine:true};
 const check=new Function('record','state','document','navigator','alive','liveStartupDecision','setTimeout','retryDirect',app.slice(a,b)+';return directStartupCheck')(record,state,doc,nav,()=>true,decide,(fn,ms)=>{queued={fn,ms};return 1},()=>retries++);
 check();assert.equal(queued.ms,5000);assert.equal(retries,0);
 doc.hidden=false;nav.onLine=false;queued.fn();assert.equal(retries,0);
 nav.onLine=true;record.autoplayBlocked=true;queued.fn();assert.equal(retries,0);assert.equal(record.startupTimer,null);
 record.autoplayBlocked=false;check();assert.equal(retries,1);
 assert.match(app,/var blockedRecord=S\.play;[\s\S]*?var result=video\.play\(\);/);
});

test('runtime diagnostic identifies installed, browser and preview modes without exposing UA',()=>{
 const a=app.indexOf('function webRuntimeMode('),b=app.indexOf('function diagnose(',a);
 const mode=new Function(app.slice(a,b)+';return webRuntimeMode')();
 assert.equal(mode(true,false),'installed');
 assert.equal(mode(false,false),'browser');
 assert.equal(mode(true,true),'preview');
 assert.match(app,/runtime:webRuntimeMode\(installedWebApp\(\)/);
 assert.match(app,/2026\.11\.26\.5/);
});

test('installed Apple HLS policy is restricted to supported standalone WebKit',()=>{
 const a=app.indexOf('function installedNativeHlsPreferred('),b=app.indexOf('function shouldUseNativeHls(',a);
 const prefer=new Function(app.slice(a,b)+';return installedNativeHlsPreferred')();
 const apple='Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile/15E148';
 const mac='Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/27.2 Safari/605.1.15';
 const video={canPlayType:()=> 'maybe'};
 assert.equal(prefer(true,apple,video),true);
 assert.equal(prefer(true,mac,video),true);
 assert.equal(prefer(false,apple,video),false);
 assert.equal(prefer(true,mac,{canPlayType:()=>''}),false);
 assert.equal(prefer(true,'Mozilla/5.0 (Macintosh) AppleWebKit Chrome/157 Safari',video),false);
 assert.match(app,/record\.nativeHls=true/);
});
test('installed native recovery respects background, pause, offline and session ownership',()=>{
 const a=app.indexOf('   function recoverInstalledNative(){'),b=app.indexOf('   record.retryTimer=setTimeout(recoverInstalledNative,liveSessionRetryDelay',a);
 let queued,opens=0,active=true;
 const record={},state={userPaused:false},doc={hidden:true},nav={onLine:true},video={isConnected:true};
 const recover=new Function('record','document','navigator','S','video','alive','preview','setTimeout','playHls','kind','id','extension','track','statusElement','attempt',app.slice(a,b)+';return recoverInstalledNative')(record,doc,nav,{playerView:state},video,()=>active,false,(fn,ms)=>{queued={fn,ms};return 1},()=>opens++,'live','1','ts',0,null,0);
 recover();assert.equal(queued.ms,3000);assert.equal(opens,0);
 doc.hidden=false;state.userPaused=true;queued.fn();assert.equal(opens,0);
 state.userPaused=false;nav.onLine=false;queued.fn();assert.equal(opens,0);
 nav.onLine=true;queued.fn();assert.equal(opens,1);
 active=false;queued.fn();assert.equal(opens,1);
});

test('refreshing installed shell is explicit, online-only and preserves account storage',()=>{
 const a=app.indexOf("document.getElementById('refresh-web-shell').onclick"),b=app.indexOf("document.getElementById('refresh-content').onclick",a);
 const source=app.slice(a,b);
 assert.match(source,/S\.route!=='settings'/);
 assert.match(source,/navigator\.onLine===false/);
 assert.match(source,/window\.location\.replace\(target\.href\)/);
 assert.doesNotMatch(source,/localStorage\.(clear|removeItem)|caches\.delete\(|\/api\/logout/);
 assert.ok(app.includes('/vendor/mpegts.js?v=1.8.2'));
 assert.ok(app.includes('/vendor/hls.min.js?v=1.5.20'));
});

test('installed admission gates native playback and bounds retries',()=>{assert.match(app,/admissionAttempt>=5/);assert.match(app,/liveSessionRetryDelay\(admissionAttempt\+\+,hint\)/);assert.match(app,/old.admissionAbort.abort\(\)/);assert.match(app,/installedWebApp\(\)&&pendingMediaStops>0/);});
