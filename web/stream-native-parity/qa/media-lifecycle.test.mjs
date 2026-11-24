import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';

const source=readFileSync(new URL('../media-worker.ts',import.meta.url),'utf8');
const playerSource=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const serverSource=readFileSync(new URL('../server.ts',import.meta.url),'utf8');

test('frozen VIDEO at readyState=4 is detected from real pixel/playhead progress',()=>{
 const start=playerSource.indexOf('function livePlaybackProgress(');
 const end=playerSource.indexOf('\nfunction playHls(',start);
 assert.ok(start>0&&end>start,'live progress watchdog helper is present');
 const sample=vm.runInNewContext(playerSource.slice(start,end)+';\nlivePlaybackProgress',{});
 const rec={started:1000,lastProgressAt:1000,lastMediaTime:61,lastVideoFrames:500,frameCounterObserved:true,bufferSince:2000,stallChecks:2};
 const video={readyState:4,currentTime:61,getVideoPlaybackQuality:()=>({totalVideoFrames:500})};
 assert.equal(sample(rec,video,20000).advanced,false);
 assert.equal(sample(rec,video,20000).idleMs,19000,'readyState=4 does not conceal a frozen frame');
 video.currentTime=62;
 assert.equal(sample(rec,video,21000).advanced,false,'an audio clock without new picture is still frozen');
 video.getVideoPlaybackQuality=()=>({totalVideoFrames:501});
 assert.equal(sample(rec,video,22000).advanced,true,'actual decoded frame advancement restores playback');
 assert.equal(rec.bufferSince,0);
 assert.equal(rec.stallChecks,0);
 video.getVideoPlaybackQuality=()=>({totalVideoFrames:502});
 assert.equal(sample(rec,video,23200).advanced,true,'decoded frames also count if TV playhead is imprecise');
 video.currentTime=80;
 video.getVideoPlaybackQuality=()=>({totalVideoFrames:502});
 assert.equal(sample(rec,video,43000).advanced,false,'audio clock must not hide frozen picture');
 assert.ok(sample(rec,video,43000).idleMs>=19000,'watchdog may recover video even when audio continues');
 video.getVideoPlaybackQuality=()=>({totalVideoFrames:505});
 assert.equal(sample(rec,video,45100).advanced,true,'visual progress resets the freeze timer');
});

test('displayed-frame heartbeat detects freeze even when video and audio clocks continue',()=>{
 const start=playerSource.indexOf('function livePlaybackProgress(');
 const end=playerSource.indexOf('\nfunction liveUnexpectedPause(',start);
 assert.ok(start>0&&end>start);
 const check=vm.runInNewContext(playerSource.slice(start,end)+';\nlivePlaybackProgress',{});
 const r={started:1000,lastProgressAt:1000,lastMediaTime:45,
  lastVideoFrames:null,framePresentationObserved:true,lastPresentedFrameAt:19000,lastSampledPresentationAt:0};
 const v={currentTime:46,getVideoPlaybackQuality:()=>({totalVideoFrames:0})};
 assert.equal(check(r,v,20000).advanced,true,'first presented callback is evidence of moving picture');
 v.currentTime=47;
 assert.equal(check(r,v,22000).advanced,false,'audio clock alone is not visual progress');
 assert.equal(check(r,v,40000).idleMs,20000,'16-second freeze watchdog may restart this decoder');
 r.lastPresentedFrameAt=40500;
 assert.equal(check(r,v,41000).advanced,true,'new displayed frame resets timeout');
 assert.equal(check(r,v,42000).advanced,false);
 assert.equal(check(r,v,42000).idleMs,1000);
});

test('frame presentation callback is cleaned on playback stop to prevent cross-channel races',()=>{
 const start=playerSource.indexOf('function stopPlayback(sendStop){');
 const end=playerSource.indexOf('\nfunction cleanupPlayer()',start);
 assert.ok(start>0&&end>start);
 const source=playerSource.slice(start,end);
 assert.match(source,/cancelVideoFrameCallback\(old\.presentedFrameId\)/);
 assert.match(source,/clearInterval\(old\.progressWatchdog\)/);
 assert.match(source,/clearTimeout\(old\.retryTimer\)/);
});

test('persistent live delay catches up once without disrupting a healthy source',()=>{
 const start=playerSource.indexOf('function liveLatencyCatchup('),
  end=playerSource.indexOf('\nfunction liveOriginRetryMs(',start);
 assert.ok(start>0&&end>start,'bounded live latency catch-up helper exists');
 const catchUp=vm.runInNewContext(playerSource.slice(start,end)+';\nliveLatencyCatchup',{});
 const events=[],engine={liveSyncPosition:130};
 const video={currentTime:102,readyState:4,paused:false,ended:false,seeking:false,
  seekable:{length:1,start:()=>90,end:()=>135}};
 const record={};
 assert.equal(catchUp(record,engine,video,10000,false,false),false,'first observation arms delay monitor');
 assert.equal(catchUp(record,engine,video,17000,false,false),false,'short-lived lag never forces seek');
 assert.equal(catchUp(record,engine,video,19000,false,false),true,'sustained 16+ second lag returns to edge');
 assert.equal(video.currentTime,130,'seek targets HLS.js live sync position');
 video.currentTime=100;engine.liveSyncPosition=145;video.seekable.end=()=>147;
 assert.equal(catchUp(record,engine,video,20500,false,false),false);
 assert.equal(catchUp(record,engine,video,30000,false,false),false,'90-second cool-down suppresses repeated jumping');
 assert.equal(video.currentTime,100);
 assert.equal(catchUp(record,engine,video,109001,false,false),true,'after cool-down, another persistent lag can recover');
 assert.equal(video.currentTime,145);
 video.currentTime=100;engine.liveSyncPosition=180;video.seekable.end=()=>140;
 assert.equal(catchUp(record,engine,video,115000,false,false),false,'out-of-range sync points are ignored');
 engine.liveSyncPosition=130;video.seekable.end=()=>135;
 assert.equal(catchUp(record,engine,video,120000,true,false),false,'explicit user Pause never auto-seeks');
 assert.equal(catchUp(record,engine,video,130000,false,true),false,'background browser never auto-seeks');
 video.paused=true;
 assert.equal(catchUp(record,engine,video,140000,false,false),false,'browser paused state never auto-seeks');
 video.paused=false;record.reconnecting=true;
 assert.equal(catchUp(record,engine,video,150000,false,false),false,'reconnecting decoder does not jump');
 record.reconnecting=false;
 engine.liveSyncPosition=video.currentTime+8;
 assert.equal(catchUp(record,engine,video,160000,false,false),false,'ordinary live delay is safe');
 assert.match(playerSource,/recordLiveIncident\('live_catchup',now\)/);
});

test('HLS 429 capacity retry uses capped backoff and never hammers the shared source',()=>{
 const start=playerSource.indexOf('function liveCapacityRetryMs(');
 const end=playerSource.indexOf('\nfunction liveUnexpectedPause(',start);
 assert.ok(start>0&&end>start,'capacity backoff is present');
 const delay=vm.runInNewContext(playerSource.slice(start,end)+';\nliveCapacityRetryMs',{});
 assert.equal(delay(1),4700);
 assert.equal(delay(2),6900);
 assert.equal(delay(5),13500);
 assert.equal(delay(100),13500,'delay stays capped');
 const oldStart=playerSource.indexOf('function stopPlayback(sendStop){');
 const oldEnd=playerSource.indexOf('\nfunction cleanupPlayer()',oldStart);
 assert.ok(oldStart>0&&oldEnd>oldStart);
 assert.match(playerSource.slice(oldStart,oldEnd),/clearTimeout\(old\.capacityTimer\)/,
  'a channel change must cancel its delayed capacity retry');
 assert.match(playerSource,/record\.capacityRetries=0/,'good segments reset the backoff');
});

test('private live incident timeline is bounded, local-only and never captures account data',()=>{
 const start=playerSource.indexOf('function recordLiveIncident(');
 const end=playerSource.indexOf('\nfunction liveUnexpectedPause(',start);
 assert.ok(start>0&&end>start,'on-device incident timeline is available');
 const st={liveEvents:[]};
 const S={route:'player',playerView:{kind:'live',stats:st}};
 const track=vm.runInNewContext(playerSource.slice(start,end)+';\nrecordLiveIncident',{S,Date});
 assert.equal(track('playing',1000),true);
 assert.equal(track('playing',1200),false,'duplicate HLS onplaying events are suppressed');
 assert.equal(track('source_error',1300),true);
 assert.equal(track('Authorization: Bearer secret https://provider.example',1500),false,'arbitrary strings never enter the report');
 assert.equal(st.liveEvents.length,2);
 assert.deepEqual(st.liveEvents.map(x=>x.code),['playing','source_error']);
 for(let i=0;i<30;i++)track('reconnect',4000+i*3200);
 assert.equal(st.liveEvents.length,12,'event buffer is capped at twelve');
 assert.equal(st.liveEvents.at(-1).at,4000+29*3200);
 assert.ok(st.liveEvents.every(x=>Object.keys(x).sort().join(',')==='at,code'),'events have only type and timestamp');
 S.route='settings';
 assert.equal(track('buffering',150000),false,'nonplayer screens cannot be logged');
 S.route='player';S.playerView.kind='movie';
 assert.equal(track('buffering',150000),false,'VOD is never mixed into live diagnostics');
 assert.match(playerSource,/آخر أحداث البث \(وقت UTC\)/);
});

test('unexpected paused/ended TV live decoder recovers without overriding user Pause',()=>{
 const start=playerSource.indexOf('function liveUnexpectedPause(');
 const end=playerSource.indexOf('\nfunction playHls(',start);
 assert.ok(start>=0&&end>start,'paused decoder watchdog is present');
 const check=vm.runInNewContext(playerSource.slice(start,end)+';\nliveUnexpectedPause',{});
 const record={},video={paused:true,ended:false,seeking:false};
 assert.equal(check(record,video,false,false,1000),false,'allow a short transient pause');
 assert.equal(check(record,video,false,false,10999),false);
 assert.equal(check(record,video,false,false,11000),true,'recover paused decoder after 10 seconds');
 assert.equal(check(record,video,true,false,14000),false,'user-selected pause must remain paused');
 assert.equal(record.unexpectedPauseAt,0);
 assert.equal(check(record,video,false,true,15000),false,'hidden TV browser must not restart playback');
 assert.equal(check(record,video,false,false,20000),false,'timer starts over on visibility');
 video.paused=false;video.ended=false;
 assert.equal(check(record,video,false,false,22000),false,'playback resumes');
 video.paused=true;video.ended=true;
 assert.equal(check(record,video,false,false,23000),false,'live EOF starts a new watchdog');
 assert.equal(check(record,video,false,false,33000),true,'ended channel also restarts');
 video.seeking=true;
 assert.equal(check(record,video,false,false,34000),false,'intentional seek suppresses recovery');
});

test('live previews restart automatically but stop after two tries and never resurrect a changed channel',()=>{
 const start=playerSource.indexOf(' function recoverConnection(){',playerSource.indexOf('function playHls('));
 const end=playerSource.indexOf('\n record.startupTimer=',start);
 assert.ok(start>0&&end>start,'HLS recovery function is available');
 const ctx={
  preview:true,record:{recoveryAttempt:0,reconnecting:false},video:{isConnected:true},
  id:31,kind:'live',extension:'ts',track:0,statusElement:null,
  S:{route:'live',selected:31},alive:()=>true,
  status(m){ctx.message=m},
  clearTimeout(){},clearInterval(){},Date,
  setTimeout(fn,ms){ctx.task={fn,ms};return 1},
  playHls(...args){ctx.played=args}
 };
 const recover=vm.runInNewContext(playerSource.slice(start,end)+';\nrecoverConnection',ctx);
 recover();
 assert.equal(ctx.record.reconnecting,true);
 assert.equal(ctx.task.ms,1200);
 assert.match(ctx.message,/استعادة معاينة/);
 ctx.task.fn();
 assert.equal(ctx.played[6],true,'recovery stays a muted preview');
 assert.equal(ctx.played[7],1,'first recovery attempt');
 ctx.played=null;
 ctx.record={recoveryAttempt:1,reconnecting:false};
 recover();
 assert.equal(ctx.task.ms,2400);
 ctx.S.selected=32;
 ctx.task.fn();
 assert.equal(ctx.played,null,'channel switch cancels old preview recovery');
 ctx.S.selected=31;
 ctx.record={recoveryAttempt:2,reconnecting:false};
 ctx.task=null;
 recover();
 assert.equal(ctx.task,null,'recovery attempts are bounded');
 assert.match(ctx.message,/بعد محاولات الاستعادة/);
});

test('rapid upstream EOF uses bounded HMAC-keyed cooldown; unrelated channels stay available',()=>{
 const hashStart=source.indexOf('function hlsKey(');
 const hashEnd=source.indexOf('\nfunction liveSourceIdentity(',hashStart);
 const helperStart=source.indexOf('function liveSourceIdentity(',hashEnd);
 const helperEnd=source.indexOf('\nfunction touchHls(',helperStart);
 assert.ok(hashStart>0&&hashEnd>hashStart&&helperStart>hashEnd&&helperEnd>helperStart);
 const windows=new Map();
 const ctx={createHmac:crypto.createHmac,SECRET:'c'.repeat(64),
  liveSourceFailureWindows:windows,MAX_LIVE_SOURCE_WINDOWS:256};
 const api=vm.runInNewContext(source.slice(hashStart,hashEnd)+'\n'+source.slice(helperStart,helperEnd)+
  ';\n({liveSourceIdentity,liveSourceRetryMs,recordLiveSourceFailure,noteLiveSourceHealthy})',ctx);
 const token='Bearer synthetic-A';
 const key=api.liveSourceIdentity(token,'live','31','ts','0',false,false);
 const otherChannel=api.liveSourceIdentity(token,'live','32','ts','0',false,false);
 const otherAccount=api.liveSourceIdentity('Bearer synthetic-B','live','31','ts','0',false,false);
 const otherMode=api.liveSourceIdentity(token,'live','31','ts','0',true,false);
 assert.notEqual(key,otherChannel);
 assert.notEqual(key,otherAccount);
 assert.notEqual(key,otherMode);
 const t=50000;
 for(let n=1;n<=6;n++){
  const at=t+(n-1)*10000;
  api.recordLiveSourceFailure({kind:'live',startedAt:at-3200,sourceIdentity:key},'live_source_finished',at);
  assert.equal(api.liveSourceRetryMs(key,at),Math.min(30000,1600*Math.pow(2,n-1)));
 }
 assert.equal(api.liveSourceRetryMs(key,t+50000),30000);
 assert.equal(api.liveSourceRetryMs(otherChannel,t+50000),0);
 assert.equal(api.liveSourceRetryMs(otherAccount,t+50000),0);
 assert.equal(api.liveSourceRetryMs(otherMode,t+50000),0);
 api.recordLiveSourceFailure({kind:'live',startedAt:t+50000-2000,sourceIdentity:key},'viewer_stopped',t+50000);
 assert.equal(api.liveSourceRetryMs(key,t+50000),30000,'intentional viewer stop must not escalate origin penalty');
 api.noteLiveSourceHealthy({kind:'live',sourceIdentity:key,startedAt:t},t+96000);
 assert.equal(api.liveSourceRetryMs(key,t+96000),0,'healthy ninety-second live stream clears previous failure history');
 api.recordLiveSourceFailure({kind:'movie',startedAt:t,sourceIdentity:otherChannel},'stale_manifest',t+100000);
 assert.equal(api.liveSourceRetryMs(otherChannel,t+100000),0,'VOD is unaffected');
 for(let i=0;i<300;i++)api.recordLiveSourceFailure({kind:'live',startedAt:t+100000,sourceIdentity:'synthetic-'+i},'live_source_finished',t+100050);
 assert.equal(windows.size,256,'source failure memory is bounded');
 assert.equal(api.liveSourceRetryMs('synthetic-299',t+100050),1600);
 assert.equal(api.liveSourceRetryMs('synthetic-0',t+100050),0,'oldest origin record gets evicted');
 assert.equal(api.liveSourceRetryMs('synthetic-299',t+240051),0,'origin record expires after two minutes');
});

test('temporary live origin failures emit bounded HTTP retry hints and gradual web-player recovery',async()=>{
 const begin=source.indexOf('function hlsError('),end=source.indexOf('\n/* An FFmpeg pipe',begin);
 assert.ok(begin>0&&end>begin);
 const err=vm.runInNewContext(source.slice(begin,end)+';\nhlsError',
  {Response,json:(status,value)=>({status,value})});
 const response=err(503,'hls_origin_backoff',8);
 assert.equal(response.status,503);
 assert.equal(response.headers.get('retry-after'),'8');
 assert.equal(response.headers.get('cache-control'),'no-store, private');
 assert.deepEqual(await response.json(),{ok:false,error:'hls_origin_backoff',retryAfterSeconds:8});
 const normal=err(404,'hls_session_missing');
 assert.equal(normal.status,404);
 assert.equal(normal.value.error,'hls_session_missing');
 const helperStart=playerSource.indexOf('function liveOriginRetryMs('),
  helperEnd=playerSource.indexOf('\nfunction liveCapacityRetryMs(',helperStart);
 assert.ok(helperStart>0&&helperEnd>helperStart);
 const retry=vm.runInNewContext(playerSource.slice(helperStart,helperEnd)+';\nliveOriginRetryMs',{});
 assert.equal(retry(1),2400);
 assert.equal(retry(2),4100);
 assert.equal(retry(5),16800);
 assert.equal(retry(100),16800,'player origin recovery cannot retry too fast or grow without a limit');
 assert.match(playerSource,/clearTimeout\(old\.originTimer\)/,'channel change cancels pending origin retry');
 assert.match(playerSource,/record\.originRetries=0/,'a successful media fragment resets source failure history');
 assert.match(serverSource,/headers\['Retry-After'\]=String\(retrySeconds\)/,
  'proxy must preserve worker retry hint without leaking untrusted response headers');
});

test('HLS expired sequence is a fast 410 only for deleted live TS segments',()=>{
 const start=source.indexOf('function expiredLiveSegment('),end=source.indexOf('\nfunction staleLiveManifest(',start);
 assert.ok(start>0&&end>start,'live segment expiration detector exists');
 let playlist='#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:120\n#EXTINF:1,\nseg-000120.ts\n';
 const files=new Set(['/live/index.m3u8','/live/seg-000107.ts']);
 const ctx={
  join:(...parts)=>parts.join('/'),
  existsSync:(path)=>files.has(path),
  readFileSync:(path)=>{assert.equal(path,'/live/index.m3u8');return playlist}
 };
 const expired=vm.runInNewContext(source.slice(start,end)+';\nexpiredLiveSegment',ctx);
 const live={kind:'live',dir:'/live',stopped:false};
 assert.equal(expired(live,'seg-000107.ts'),false,'still-existing segment remains playable');
 files.delete('/live/seg-000107.ts');
 assert.equal(expired(live,'seg-000107.ts'),true,'missing segment below media sequence cannot return');
 assert.equal(expired(live,'seg-000120.ts'),false,'current playlist segment can still arrive');
 assert.equal(expired(live,'seg-000121.ts'),false,'future segment must not be incorrectly evicted');
 assert.equal(expired({...live,kind:'movie'},'seg-000107.ts'),false,'VOD is not a sliding live playlist');
 assert.equal(expired({...live,stopped:true},'seg-000107.ts'),false);
 assert.equal(expired(live,'index.m3u8'),false);
 playlist='#EXTM3U\n#EXTINF:1,\nseg-000130.ts\n';
 assert.equal(expired(live,'seg-000120.ts'),true,'fallback uses first filename if sequence header missing');
 files.delete('/live/index.m3u8');
 assert.equal(expired(live,'seg-000107.ts'),false,'playlist absence is not proof of eviction');
 const startHandler=source.indexOf('async function hlsRequest('),endHandler=source.indexOf('\n/* Web VOD seek experiment',startHandler);
 assert.match(source.slice(startHandler,endHandler),/hlsError\(410,'hls_segment_evicted'\)/,
  'an expired segment must be rejected instead of waiting eight seconds');
});

test('HLS.js resyncs its live edge on a 410, with bounded retries and no unnecessary source teardown',()=>{
 const start=playerSource.indexOf('function liveExpiredSegmentRecovery('),
  end=playerSource.indexOf('\nfunction liveOriginRetryMs(',start);
 assert.ok(start>0&&end>start);
 const recover=vm.runInNewContext(playerSource.slice(start,end)+';\nliveExpiredSegmentRecovery',{});
 let stopped=0,loaded=[],position=45;
 const engine={liveSyncPosition:70,stopLoad(){stopped++},startLoad(x){loaded.push(x)}};
 const video={readyState:4,get currentTime(){return position},set currentTime(v){position=v}};
 const record={};
 assert.equal(recover(record,engine,video,10000),'resync');
 assert.equal(position,70,'video seeks to freshest live sync position');
 assert.equal(stopped,1);assert.deepEqual(loaded,[-1]);
 assert.equal(recover(record,engine,video,12000),'cooling','duplicate 410 is throttled');
 assert.equal(stopped,1,'duplicate HLS 410 does not trigger another load');
 assert.equal(recover(record,engine,video,14000),'resync');
 assert.equal(recover(record,engine,video,19000),'restart','third gap asks outer recovery to refresh stale HLS connection');
 assert.equal(stopped,2,'bounded two in-place resyncs before restart');
 assert.equal(recover(record,engine,video,50000),'resync','edge-resync window resets after thirty seconds');
 const fail={};
 assert.equal(recover(fail,{liveSyncPosition:55},video,10000),'restart',
  'missing engine API falls back to normal controlled reconnect');
 const index=playerSource.indexOf('engine.on(window.Hls.Events.ERROR');
 assert.ok(index>0);
 assert.match(playerSource.slice(index,index+700),/code===410/,
  'HLS NETWORK_ERROR handler handles expired segment before generic fatal reconnect');
});

test('worker identifies stale live manifests but never expires VOD or healthy live files',()=>{
 const begin=source.indexOf('function staleLiveManifest(');
 const end=source.indexOf('\n/**',begin);
 assert.ok(begin>0&&end>begin);
 let mtime=1000;
 const isStale=vm.runInNewContext(source.slice(begin,end)+';\nstaleLiveManifest',{
  statSync:()=>({mtimeMs:mtime}),Number
 });
 const live={kind:'live',startedAt:1000,stopped:false};
 assert.equal(isStale(live,'/live/index.m3u8',25000),true,'source stopped updating for 24s');
 assert.equal(isStale(live,'/live/index.m3u8',12000),false);
 assert.equal(isStale({...live,kind:'movie'},'/vod/index.m3u8',25000),false);
 assert.equal(isStale({...live,stopped:true},'/live/index.m3u8',25000),false);
 mtime=22000;
 assert.equal(isStale(live,'/live/index.m3u8',25000),false,'playlist still advancing');
});

const start=source.indexOf('function touchHls(session){');
const end=source.indexOf('\nfunction stopHls(',start);
assert.ok(start>=0&&end>start,'hls timeout lifecycle is present');
const touchDefinition=source.slice(start,end);

function fakeClock(){
 const timers=new Map(),cleared=[];
 let seq=0,now=0;
 const context={
  Date:{now:()=>now},
  hardTTL:9*60*1000,
  setTimeout:function(fn,ms){const id=++seq;timers.set(id,{fn,ms});return {id,unref(){}}},
  clearTimeout:function(handle){const id=handle&&handle.id;if(id){timers.delete(id);cleared.push(id)}},
  stopHls:function(){throw Error('unexpected stop during touch')}
 };
 const touch=vm.runInNewContext(touchDefinition+';\ntouchHls',context);
 return {touch,timers,cleared,advance:function(ms){now+=ms},
  makeTimer:function(ms){const id=++seq;timers.set(id,{fn:()=>{},ms});return {id,unref(){}}}
 }
}

test('active live HLS refreshes the old nine-minute expiry on every playlist or segment request',()=>{
 const c=fakeClock(),session={legacyHls:true,fullVod:false};
 // startHls installs the initial guard AFTER calling touchHls once.
 c.touch(session);
 session.hardTimer=c.makeTimer(9*60*1000);
 const first=session.hardTimer,firstIdle=session.idleTimer;
 assert.equal(c.timers.get(first.id).ms,9*60*1000);
 assert.equal(c.timers.get(firstIdle.id).ms,110000);
 c.advance(8*60*1000);
 c.touch(session);
 assert.notEqual(session.hardTimer.id,first.id);
 assert.ok(c.cleared.includes(first.id));
 assert.ok(c.cleared.includes(firstIdle.id));
 assert.equal(c.timers.get(session.hardTimer.id).ms,9*60*1000);
 assert.equal(session.lastAccess,8*60*1000);
});

test('non-live VOD keeps separate long-lived hard timeout and twenty-five-minute idle TTL',()=>{
 const c=fakeClock(),manual={id:600,unref(){}},session={fullVod:true,legacyHls:false,hardTimer:manual};
 c.touch(session);
 assert.equal(session.hardTimer,manual);
 assert.equal(c.timers.get(session.idleTimer.id).ms,25*60*1000);
 assert.ok(!c.cleared.includes(manual.id))
});


test('late stop of an old stream never deletes the replacement session with the same key',()=>{
 const begin=source.indexOf('function stopHls(session,reason){');
 const end=source.indexOf('\nconst nap=',begin);
 assert.ok(begin>=0&&end>begin);
 const map=new Map(),removed=[];
 const context={
  hlsSessions:map,active:1,recordLiveSourceFailure(){},
  clearTimeout(){},
  rmSync(path){removed.push(path)},
  console:{info(){}}
 };
 const stop=vm.runInNewContext(source.slice(begin,end)+';\nstopHls',context);
 const old={key:'account:channel',abort:{abort(){}},dir:'/old-unique-session'};
 const replacement={key:'account:channel',stopped:false,dir:'/new-unique-session'};
 map.set(old.key,replacement);
 stop(old,'viewer_stopped');
 assert.equal(map.get(old.key),replacement);
 assert.equal(old.stopped,true);
 assert.equal(context.active,0);
 assert.deepEqual(removed,['/old-unique-session'],'late cleanup removes only old decoder directory, not replacement');
});

test('cancelled upstream header fetch cannot start FFmpeg after a viewer stops watching',async()=>{
 const begin=source.indexOf('async function startHls({');
 const end=source.indexOf('\nasync function hlsRequest(',begin);
 assert.ok(begin>=0&&end>begin);
 let resolveFetch,spawnCount=0,bodyCancelled=false;
 const map=new Map();
 const context={
  MAX_JOBS:2,active:0,hlsSessions:map,hlsRoot:'/fake',hardTTL:540000,
  liveSourceIdentity:()=> 'synthetic-source',
  BASE:'https://example.invalid/source/',
  join:(...args)=>args.join('/'),
  mkdirSync(){},touchHls(){},clearTimeout(){},
  randomBytes:()=>Buffer.from('00bb22cc44dd','hex'),
  setTimeout(){return{unref(){}}},
  AbortController,
  fetch:async()=>new Promise(resolve=>{resolveFetch=resolve}),
  stopHls(session){session.stopped=true;session.abort.abort();if(map.get(session.key)===session)map.delete(session.key)},
  Bun:{spawn(){spawnCount++;throw Error('decoder must not start')}},
 };
 const startHls=vm.runInNewContext(source.slice(begin,end)+';\nstartHls',context);
 const task=startHls({bearer:'test',kind:'live',id:'12',ext:'ts',track:0,key:'test-key'});
 await Promise.resolve();
 const old=map.get('test-key');
 assert.ok(old);
 old.stopped=true;old.abort.abort();
 map.delete('test-key');
 assert.equal(typeof resolveFetch,'function');
 resolveFetch({ok:true,body:{cancel:async()=>{bodyCancelled=true}}});
 const result=await task;
 assert.equal(result.status,409);
 assert.equal(spawnCount,0);
 assert.equal(bodyCancelled,true);
});


test('HD fallback keeps source dimensions without upscaling and has a bounded bitrate',()=>{
 const begin=source.indexOf('function videoQualityProfile(');
 const end=source.indexOf('\nconst hlsSessions=',begin);
 assert.ok(begin>=0&&end>begin,'HD profile helper is part of the worker');
 const code=source.slice(begin,end);
 const fakeEnv={};
 const funcs=vm.runInNewContext(code+';\n({videoQualityProfile,compatibleVideoArgs})',
  {Bun:{env:fakeEnv}});
 const hd=funcs.videoQualityProfile('live');
 assert.equal(hd.name,'720');
 const args=funcs.compatibleVideoArgs('live');
 const vf=args[args.indexOf('-vf')+1];
 assert.match(vf,/min\(iw,1280\)/);
 assert.match(vf,/min\(ih,720\)/);
 assert.ok(!vf.includes('fps=25'),'do not distort source frame rate');
 assert.equal(args[args.indexOf('-maxrate')+1],'3400k');
 assert.ok(!args.join(' ').includes('900k'));
 fakeEnv.VIDAA_LIVE_VIDEO_PROFILE='1080';
 const full=funcs.compatibleVideoArgs('live');
 assert.match(full[full.indexOf('-vf')+1],/min\(ih,1080\)/);
 assert.equal(full[full.indexOf('-maxrate')+1],'8500k');
 const uhd=funcs.compatibleVideoArgs('live',1,'2160');
 assert.match(uhd[uhd.indexOf('-vf')+1],/min\(iw,3840\)/);
 assert.match(uhd[uhd.indexOf('-vf')+1],/min\(ih,2160\)/);
 assert.equal(uhd[uhd.indexOf('-maxrate')+1],'20000k');
 assert.equal(uhd[uhd.indexOf('-level')+1],'5.2');
 assert.ok(!uhd[uhd.indexOf('-vf')+1].includes('scale=3840:2160'),'do not enlarge SD sources to 4K');
 fakeEnv.VIDAA_LIVE_VIDEO_PROFILE='invalid';
 assert.equal(funcs.videoQualityProfile('live').name,'720');
 assert.equal(funcs.videoQualityProfile('movie').name,'1080');
 assert.equal(funcs.videoQualityProfile('series').name,'1080');
 const vod=funcs.compatibleVideoArgs('movie');
 assert.match(vod[vod.indexOf('-vf')+1],/min\(ih,1080\)/);
 assert.equal(vod[vod.indexOf('-crf')+1],'18');
 assert.equal(vod[vod.indexOf('-preset')+1],'veryfast');
 assert.equal(vod[vod.indexOf('-tune')+1],'film');
 assert.equal(args[args.indexOf('-tune')+1],'zerolatency');
 fakeEnv.VIDAA_VOD_VIDEO_PROFILE='480';
 assert.equal(funcs.videoQualityProfile('movie').name,'480');
});


test('source-preserving live H264 TS probe keeps ALL incoming bytes and chooses copy',async()=>{
 const begin=source.indexOf('async function selectSourcePreservingInput(');
 const end=source.indexOf('\nasync function startHls(',begin);
 const parse=source.indexOf('function tsCodecs(buffer){');
 const parseEnd=source.indexOf('\nfunction hlsSelfTest(',parse);
 assert.ok(begin>0&&end>begin&&parse>0&&parseEnd>parse);
 const sandbox={ReadableStream,Uint8Array};
 const select=vm.runInNewContext(source.slice(parse,parseEnd)+'\n'+source.slice(begin,end)+
  '\nselectSourcePreservingInput',sandbox);
 const makePacket=(pid,table)=>{
  const bytes=new Uint8Array(188).fill(255);
  bytes[0]=0x47;bytes[1]=0x40|((pid>>8)&31);bytes[2]=pid&255;bytes[3]=0x10;
  bytes[4]=0;bytes.set(table,5);return bytes
 };
 function sourceBytes(codec){
  const pat=makePacket(0,new Uint8Array([0,0xb0,13,0,1,0xc1,0,0,0,1,0xe1,0,0,0,0,0]));
  const pmt=makePacket(256,new Uint8Array([
   2,0xb0,23,0,1,0xc1,0,0,0xe1,1,0xf0,0,
   codec,0xe1,1,0xf0,0,0x0f,0xe1,2,0xf0,0,
   0,0,0,0
  ]));
  const packets=[pat,pmt,new Uint8Array(188).fill(0)];
  packets[2][0]=0x47;packets[2][1]=0x01;packets[2][2]=0x01;packets[2][3]=0x10;
  const bytes=new Uint8Array(packets.reduce((a,x)=>a+x.byteLength,0));
  let o=0;for(const p of packets){bytes.set(p,o);o+=p.length}
  return bytes
 }
 async function run(codec){
  const bytes=sourceBytes(codec);
  const src=new ReadableStream({start(ctrl){
   ctrl.enqueue(bytes.slice(0,188));
   ctrl.enqueue(bytes.slice(188,376));
   ctrl.enqueue(bytes.slice(376));
   ctrl.close()
  }});
  const result=await select(src,true);
  const reader=result.input.getReader(),segments=[];
  for(;;){const item=await reader.read();if(item.done)break;segments.push(item.value)}
  const actual=new Uint8Array(segments.reduce((a,x)=>a+x.length,0));
  let at=0;for(const part of segments){actual.set(part,at);at+=part.length}
  assert.deepEqual(Array.from(actual),Array.from(bytes),'TS sniff must never discard or reorder source data');
  return result
 }
 const h264=await run(0x1b);
 assert.equal(h264.copyVideo,true,'H264 from PMT should use original quality without re-encoding');
 assert.equal(h264.detected,'h264_transport');
 const hevc=await run(0x24);
 assert.equal(hevc.copyVideo,false,'HEVC must keep compatibility fallback on unsupported browsers');
 assert.equal(hevc.detected,'needs_transcode');
 const raw=await select(new ReadableStream({start(c){c.enqueue(new Uint8Array([1,2,3]));c.close()}}),false);
 assert.equal(raw.copyVideo,false)
});


test('web HLS proxy validates optional playback SID and preserves legacy URL group positions',()=>{
 const post=serverSource.indexOf("if(p.startsWith('/api/hls/')&&method==='POST'){");
 const get=serverSource.indexOf("if(p.startsWith('/api/hls/')&&method==='GET'){");
 assert.ok(post>0&&get>post);
 function parser(begin,label){
  const anchor=label==='stop'?'const m=p.match(':'const match=p.match(';
  const start=serverSource.indexOf(anchor,begin),end=serverSource.indexOf(');',start);
  assert.ok(start>=begin&&end>start&&end-start<350);
  const name=label==='stop'?'m':'match';
  return new Function('p',serverSource.slice(start,end+2)+'\nreturn '+name+';');
 }
 const matchStop=parser(post,'stop'),matchGet=parser(get,'get');
 const sid='a'.repeat(32);
 const legacy=matchGet('/api/hls/live/31/ts/0/index.m3u8');
 assert.ok(legacy&&legacy[7]==='index.m3u8');
 assert.equal(legacy[5],undefined);
 const modern=matchGet('/api/hls/live/31/ts/0/sid-'+sid+'/compat/seg-000034.ts');
 assert.ok(modern);
 assert.equal(modern[5],sid);
 assert.equal(modern[6],'compat');
 assert.equal(modern[7],'seg-000034.ts');
 const stopping=matchStop('/api/hls/live/31/ts/0/sid-'+sid+'/stop');
 assert.ok(stopping&&stopping[5]===sid&&stopping[6]===undefined);
 const ultra=matchStop('/api/hls/live/31/ts/0/sid-'+sid+'/ultra/stop');
 assert.ok(ultra&&ultra[5]===sid&&ultra[6]==='ultra');
 assert.equal(matchGet('/api/hls/live/31/ts/0/sid-nonsense/index.m3u8'),null);
 assert.equal(matchStop('/api/hls/live/31/ts/0/sid-'+sid+'/garbage/stop'),null);
 assert.match(playerSource,/\/sid-'\+freshPlaybackId\(\)/,'web player generates new live SID');
});

test('guarded same-bearer live fan-out shares one encoder but isolates each viewer stop',async()=>{
 const hlsBegin=source.indexOf('function hlsKey('),hlsEnd=source.indexOf('\nfunction touchHls(',hlsBegin);
 const shareBegin=source.indexOf('function liveShareGroupKey('),shareEnd=source.indexOf('\nasync function hlsRequest(',shareBegin);
 const stopBegin=source.indexOf('function stopHls('),stopEnd=source.indexOf('\nfunction releaseHls(',stopBegin);
 assert.ok(hlsBegin>=0&&hlsEnd>hlsBegin&&shareBegin>hlsEnd&&shareEnd>shareBegin&&stopBegin>0&&stopEnd>stopBegin);
 const secret='f'.repeat(64),hlsSessions=new Map(),sharedLiveGroups=new Map(),
  pendingSharedLiveViewers=new Map();
 let started=0,killCount=0,abortCount=0,removed=[];
 const bearer='Bearer pilot-A',other='Bearer pilot-B';
 const context={createHmac:crypto.createHmac,SECRET:secret,hlsSessions,sharedLiveGroups,pendingSharedLiveViewers,
  recordLiveSourceFailure(){},
  MAX_SHARED_LIVE_VIEWERS:4,
  Bun:{env:{VIDAA_LIVE_SHARE_SAME_BEARER:'1'}},
  touchHls(session){session.lastAccess=Date.now()},
  startHls:async({key,kind})=>{
   started++;
   const session={key,kind,dir:'/encoder-'+started,released:false,
    abort:{abort(){abortCount++}},proc:{kill(){killCount++}}};
   hlsSessions.set(key,session);
   return {session}
  },
  clearTimeout(){},rmSync(path){removed.push(path)},console:{info(){}},
  releaseHls(s){s.released=true}
 };
 const hash=vm.runInNewContext(source.slice(hlsBegin,hlsEnd)+';\nhlsKey',context);
 context.hlsKey=hash;
 const methods=vm.runInNewContext(source.slice(shareBegin,shareEnd)+
  ';\n({startSharedLiveViewer,liveShareGroupKey,liveShareAllowed})',context);
 const stop=vm.runInNewContext(source.slice(stopBegin,stopEnd)+';\nstopHls',context);
 context.stopHls=stop;
 const a='a'.repeat(32),b='b'.repeat(32);
 function request(token,sid,track='0',compat=false){
  return {bearer:token,kind:'live',id:'31',ext:'ts',track,forceCompat:compat,
   viewerSid:sid,key:hash(token,'live','31','ts',track,compat,false,sid)}
 }
 assert.equal(methods.liveShareAllowed('live',a),true);
 const [first,second]=await Promise.all([
  methods.startSharedLiveViewer(request(bearer,a)),
  methods.startSharedLiveViewer(request(bearer,b))
 ]);
 assert.equal(started,1,'two same-bearer viewers share exactly one media source and encoder');
 assert.equal(first.session.dir,second.session.dir);
 assert.notEqual(first.session.key,second.session.key);
 const [sameFirst,sameSecond]=await Promise.all([
  methods.startSharedLiveViewer(request(bearer,a)),
  methods.startSharedLiveViewer(request(bearer,a))
 ]);
 assert.strictEqual(sameFirst.session,first.session,'repeat same SID must reuse the existing viewer');
 assert.strictEqual(sameSecond.session,first.session,'concurrent duplicate SID joins are idempotent');
 assert.equal(sharedLiveGroups.size,1);
 assert.equal(hlsSessions.size,3,'duplicate manifests do not introduce orphan viewer timers');
 stop(first.session,'viewer_stopped');
 assert.equal(abortCount,0,'one STOP must not abort the shared stream');
 assert.equal(killCount,0);
 assert.equal(hlsSessions.has(second.session.key),true);
 assert.equal(hlsSessions.has(first.session.key),false);
 stop(second.session,'viewer_stopped');
 assert.equal(abortCount,1,'last viewer releases upstream connection exactly once');
 assert.equal(killCount,1);
 assert.equal(sharedLiveGroups.size,0);
 assert.equal(hlsSessions.size,0);
 assert.deepEqual(removed,['/encoder-1']);
 const [differentAccount,differentAudio]=await Promise.all([
  methods.startSharedLiveViewer(request(other,a)),
  methods.startSharedLiveViewer(request(bearer,b,'1'))
 ]);
 assert.equal(started,3,'different bearer or audio track never shares a producer');
 assert.notEqual(differentAccount.session.dir,differentAudio.session.dir);
 const differentMode=await methods.startSharedLiveViewer(request(bearer,a,'1',true));
 assert.equal(started,4,'compatibility transcoder cannot reuse a source-copy producer');
 const otherSid='c'.repeat(32);
 const otherViewer=await methods.startSharedLiveViewer(request(other,otherSid));
 assert.equal(started,4,'same bearer attaches to existing producer');
 const sharedOrigin=differentAccount.session.sharedProducer;
 stop(sharedOrigin,'stale_manifest');
 assert.equal(differentAccount.session.stopped,true,'source failure invalidates first viewer alias');
 assert.equal(otherViewer.session.stopped,true,'source failure also invalidates second alias');
 assert.equal(hlsSessions.has(otherViewer.session.key),false);
 assert.equal(hlsSessions.has(differentAccount.session.key),false);
 stop(differentAccount.session,'viewer_stopped');
 stop(differentAudio.session,'viewer_stopped');
 stop(differentMode.session,'viewer_stopped');
});

test('stop during slow upstream startup cancels only that SID and closes final orphan immediately',async()=>{
 const hashBegin=source.indexOf('function hlsKey('),hashEnd=source.indexOf('\nfunction touchHls(',hashBegin);
 const stopBegin=source.indexOf('function stopHls('),stopEnd=source.indexOf('\nfunction releaseHls(',stopBegin);
 const shareBegin=source.indexOf('function liveShareGroupKey('),shareEnd=source.indexOf('\nasync function hlsRequest(',shareBegin);
 assert.ok(hashBegin>0&&hashEnd>hashBegin&&stopBegin>0&&stopEnd>stopBegin&&shareBegin>0&&shareEnd>shareBegin);
 const hlsSessions=new Map(),sharedLiveGroups=new Map(),pendingSharedLiveViewers=new Map();
 const starts=[],closed=[];
 const ctx={
  createHmac:crypto.createHmac,SECRET:'a'.repeat(64),
  hlsSessions,sharedLiveGroups,pendingSharedLiveViewers,
  MAX_SHARED_LIVE_VIEWERS:4,
  Bun:{env:{VIDAA_LIVE_SHARE_SAME_BEARER:'1'}},
  clearTimeout(){},rmSync(){},console:{info(){}},touchHls(){},
  recordLiveSourceFailure(){},
  releaseHls(owner){owner.released=true},
  startHls({key,kind}){
   let resolve;
   const promise=new Promise(r=>{resolve=r});
   const owner={key,kind,dir:'/test-source-'+starts.length,stopped:false,released:false,
    abort:{abort(){closed.push(key)}},proc:{kill(){}}};
   hlsSessions.set(key,owner);
   starts.push({resolve,owner});
   return promise
  }
 };
 ctx.hlsKey=vm.runInNewContext(source.slice(hashBegin,hashEnd)+';\nhlsKey',ctx);
 const api=vm.runInNewContext(source.slice(stopBegin,stopEnd)+'\n'+source.slice(shareBegin,shareEnd)+
   ';\n({startSharedLiveViewer,cancelPendingSharedLiveViewer})',ctx);
 ctx.stopHls=vm.runInNewContext(source.slice(stopBegin,stopEnd)+';\nstopHls',ctx);
 const bearer='Bearer same-authorized-account',id='31',mode=false;
 const sidA='a'.repeat(32),sidB='b'.repeat(32),sidC='c'.repeat(32);
 const make=(sid)=>({bearer,kind:'live',id,ext:'ts',track:'0',forceCompat:mode,
   viewerSid:sid,key:ctx.hlsKey(bearer,'live',id,'ts','0',mode,false,sid)});
 const a=make(sidA),b=make(sidB),c=make(sidC);
 const first=api.startSharedLiveViewer(a),second=api.startSharedLiveViewer(b);
 assert.equal(starts.length,1,'only one pending upstream connection is opened');
 assert.equal(pendingSharedLiveViewers.size,2);
 assert.equal(api.cancelPendingSharedLiveViewer(a.key),true);
 assert.equal(closed.length,0,'cancelled viewer cannot disrupt another pending viewer');
 starts[0].resolve({session:starts[0].owner});
 const [resultA,resultB]=await Promise.all([first,second]);
 assert.equal(resultA.status,409,'stopped viewer cannot resurrect after slow startup');
 assert.ok(resultB.session,'another viewer is admitted normally');
 assert.equal(hlsSessions.has(a.key),false);
 assert.equal(hlsSessions.has(b.key),true);
 assert.equal(pendingSharedLiveViewers.size,0,'no pending-registration memory leaks');
 ctx.stopHls(resultB.session,'viewer_stopped');
 assert.equal(closed.length,1,'final viewer closes producer');
 assert.equal(hlsSessions.size,0);
 const orphan=api.startSharedLiveViewer(c);
 assert.equal(starts.length,2);
 assert.equal(api.cancelPendingSharedLiveViewer(c.key),true);
 assert.equal(closed.length,2,'last pending cancellation aborts upstream immediately');
 starts[1].resolve({session:starts[1].owner});
 const cancelled=await orphan;
 assert.equal(cancelled.status,409);
 assert.equal(sharedLiveGroups.size,0);
 assert.equal(hlsSessions.size,0,'aborted session cannot create a ghost stream');
 assert.equal(pendingSharedLiveViewers.size,0);
});

test('authenticated HLS manifest and segments fan out to two SID viewers using one real session keyspace',async()=>{
 const b=source.indexOf('function hlsKey('),e=source.indexOf('\nfunction touchHls(',b),
  st=source.indexOf('function stopHls('),stEnd=source.indexOf('\nfunction releaseHls(',st),
  sh=source.indexOf('function liveShareGroupKey('),shEnd=source.indexOf('\nasync function hlsRequest(',sh),
  hr=source.indexOf('async function hlsRequest('),hrEnd=source.indexOf('\n/* Web VOD seek experiment',hr);
 assert.ok(b>=0&&e>b&&st>e&&stEnd>st&&sh>stEnd&&shEnd>sh&&hr>=shEnd&&hrEnd>hr);
 const secret='b'.repeat(64),hlsSessions=new Map(),sharedLiveGroups=new Map(),
  pendingSharedLiveViewers=new Map();
 let startups=0,sourceClosed=0;
 const auth='Bearer v1.00000000-0000-0000-0000-000000000000.'+'B'.repeat(43);
 const ctx={
  SECRET:secret,createHmac:crypto.createHmac,hlsSessions,sharedLiveGroups,pendingSharedLiveViewers,MAX_SHARED_LIVE_VIEWERS:4,
  liveSourceFailureWindows:new Map(),MAX_LIVE_SOURCE_WINDOWS:256,
  Bun:{env:{VIDAA_LIVE_SHARE_SAME_BEARER:'1'}},
  Response,Buffer,Date,console:{info(){},warn(){}},
  clearTimeout(){},rmSync(){},recordLiveSourceFailure(){},
  liveSourceIdentity:()=> 'synthetic-source',liveSourceRetryMs:()=>0,
  noteLiveSourceHealthy(){},
  releaseHls(s){s.released=true},join:(...p)=>p.join('/'),
  secureEquals:()=>true,staleLiveManifest:()=>false,
  touchHls(){},awaitHlsFile:async()=>true,existsSync:()=>true,expiredLiveSegment:()=>false,
  readFileSync:(path,encoding)=>encoding==='utf8'?
   '#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:1,\nseg-000001.ts\n':
   Buffer.from(path.endsWith('.ts')?'video':'#EXTM3U\n#EXTINF:1,\nseg-000001.ts\n'),
  json:(status,body)=>({status,body}),
  hlsError:(status,error)=>({status,error}),
  startHls:async({key,kind})=>{
   startups++;
   const producer={key,kind,dir:'/tmp/encoder-'+startups,stopped:false,
    sourceDimensions:'3840x2160',videoMode:'source_copy',
    abort:{abort(){sourceClosed++}},proc:{kill(){}},released:false};
   hlsSessions.set(key,producer);
   return {session:producer}
  }
 };
 const code=source.slice(b,e)+'\n'+source.slice(st,stEnd)+'\n'+source.slice(sh,shEnd)+'\n'+source.slice(hr,hrEnd)+
  ';\n({hlsRequest,liveShareAllowed})';
 const runner=vm.runInNewContext(code,ctx);
 const headers={get(key){return key==='authorization'?auth:key==='x-compat-secret'?secret:null}};
 const makeReq=(method)=>({method,headers}),sidA='a'.repeat(32),sidB='b'.repeat(32);
 const url=(sid,file)=>new URL('http://worker/hls/live/31/ts/0/sid-'+sid+'/'+file);
 const [a,bresp]=await Promise.all([
  runner.hlsRequest(makeReq('GET'),url(sidA,'index.m3u8')),
  runner.hlsRequest(makeReq('GET'),url(sidB,'index.m3u8'))
 ]);
 assert.equal(a.status,200);assert.equal(bresp.status,200);
 assert.equal(a.headers.get('x-blofy-source-resolution'),'3840x2160');
 assert.equal(bresp.headers.get('x-blofy-video-mode'),'source_copy');
 assert.equal(startups,1,'shared live source starts once');
 assert.equal(sharedLiveGroups.size,1);
 assert.equal(hlsSessions.size,3,'two independent aliases plus one hidden encoder owner');
 const firstStop=await runner.hlsRequest(makeReq('POST'),url(sidA,'stop'));
 assert.equal(firstStop.status,200);
 assert.equal(sourceClosed,0,'stopping first viewer retains source for second viewer');
 const data=await runner.hlsRequest(makeReq('GET'),url(sidB,'seg-000001.ts'));
 assert.equal(data.status,200,'remaining viewer reads same shared video without restarting');
 assert.equal(startups,1);
 const lastStop=await runner.hlsRequest(makeReq('POST'),url(sidB,'stop'));
 assert.equal(lastStop.status,200);assert.equal(sourceClosed,1);
 assert.equal(sharedLiveGroups.size,0);
 assert.equal(hlsSessions.size,0,'source is cleaned when final viewer stops');
});

test('same-bearer fan-out is off by default and max four authenticated viewers',async()=>{
 const begin=source.indexOf('function liveShareGroupKey('),end=source.indexOf('\nasync function hlsRequest(',begin);
 assert.ok(begin>0&&end>begin);
 const hlsBegin=source.indexOf('function hlsKey('),hlsEnd=source.indexOf('\nfunction touchHls(',hlsBegin);
 const map=new Map(),groups=new Map(),pendingSharedLiveViewers=new Map(),env={},ctx={
  createHmac:crypto.createHmac,SECRET:'d'.repeat(64),Bun:{env},hlsSessions:map,sharedLiveGroups:groups,pendingSharedLiveViewers,
  MAX_SHARED_LIVE_VIEWERS:4,touchHls(){},startHls:async args=>{
   const producer={key:args.key,kind:'live',dir:'/temp',stopped:false};map.set(args.key,producer);return {session:producer}
  }
 };
 ctx.hlsKey=vm.runInNewContext(source.slice(hlsBegin,hlsEnd)+';\nhlsKey',ctx);
 const share=vm.runInNewContext(source.slice(begin,end)+';\n({liveShareAllowed,startSharedLiveViewer})',ctx);
 const sid='a'.repeat(32);
 assert.equal(share.liveShareAllowed('live',sid),false,'opt-in defaults to disabled');
 env.VIDAA_LIVE_SHARE_SAME_BEARER='1';
 assert.equal(share.liveShareAllowed('movie',sid),false,'VOD must not share by this feature');
 assert.equal(share.liveShareAllowed('live',''),false,'legacy sessions stay isolated');
 const args={bearer:'Bearer A',kind:'live',id:'31',ext:'ts',track:'0',viewerSid:sid,key:'viewer0'};
 for(let i=0;i<4;i++){
  const session=await share.startSharedLiveViewer({...args,key:'viewer'+i,viewerSid:i.toString(16).padStart(32,'0')});
  assert.ok(session.session)
 }
 const overflow=await share.startSharedLiveViewer({...args,key:'viewer5',viewerSid:'f'.repeat(32)});
 assert.equal(overflow.status,429);
 assert.equal(map.size,5,'one producer plus four aliases, not five FFmpeg jobs');
});

test('source H264 and forced VIDAA compatibility HLS use isolated subscriber session keys',()=>{
 const begin=source.indexOf('function hlsKey(');
 const end=source.indexOf('\nfunction touchHls(',begin);
 assert.ok(begin>0&&end>begin);
 const {createHmac}=crypto;
 const key=vm.runInNewContext(source.slice(begin,end)+';\nhlsKey',
  {createHmac,SECRET:'a'.repeat(64)});
 const original=key('Bearer customer-A','live','31','ts','0');
 const legacy=key('Bearer customer-A','live','31','ts','0',false);
 const compatible=key('Bearer customer-A','live','31','ts','0',true);
 assert.equal(original,legacy,'existing original-video sessions preserve their key');
 assert.notEqual(original,compatible,'transcoder may not share the source-copy segment files');
 assert.notEqual(compatible,key('Bearer customer-B','live','31','ts','0',true));
 const sidA='a'.repeat(32),sidB='b'.repeat(32);
 const firstViewer=key('Bearer customer-A','live','31','ts','0',false,false,sidA);
 const secondViewer=key('Bearer customer-A','live','31','ts','0',false,false,sidB);
 assert.notEqual(firstViewer,secondViewer,'two viewers sharing one activation cannot terminate each other');
 assert.notEqual(firstViewer,original,'new scoped viewers cannot kill a legacy connection');
 assert.notEqual(firstViewer,key('Bearer customer-A','live','31','ts','0',true,false,sidA),
  'original and compatible mode must be distinct for the same viewer');
 assert.equal(key('Bearer customer-A','live','31','ts','0',false,false,''),original,
  'old links with no SID continue to work');
 assert.equal(original.length,40);
 assert.equal(compatible.length,40);
});


test('stopping a live HLS session closes the upstream stream after fetch headers arrived',()=>{
 const begin=source.indexOf('function stopHls(session,reason){');
 const end=source.indexOf('\nconst nap=',begin);
 const code=source.slice(begin,end);
 const map=new Map(),ctx={
  hlsSessions:map,active:1,clearTimeout(){},rmSync(){},console:{info(){}},recordLiveSourceFailure(){}
 };
 const stop=vm.runInNewContext(code+';\nstopHls',ctx);
 const upstream=new AbortController(),worker=new AbortController(),key='active-h264';
 const session={key,kind:'live',dir:'/fake',abort:worker,sourceController:upstream,released:false};
 map.set(key,session);
 stop(session,'viewer_stopped');
 assert.equal(upstream.signal.aborted,true,'provider must disconnect even after its response headers');
 assert.equal(worker.signal.aborted,true,'encoding must also stop');
 assert.equal(map.has(key),false);
 assert.equal(ctx.active,0);
});


test('authenticated compatibility HLS GET and STOP stay isolated from source-copy session',async()=>{
 const begin=source.indexOf('async function hlsRequest(req,url){');
 const end=source.indexOf('\n/* Web VOD seek experiment',begin);
 const hashBegin=source.indexOf('function hlsKey('),hashEnd=source.indexOf('\nfunction touchHls(',hashBegin);
 assert.ok(begin>=0&&end>begin&&hashBegin>=0&&hashEnd>hashBegin);
 const secret='f'.repeat(64),hmac=vm.runInNewContext(source.slice(hashBegin,hashEnd)+';\nhlsKey',
  {createHmac:crypto.createHmac,SECRET:secret});
 const bearer='Bearer v1.00000000-0000-0000-0000-000000000000.'+'A'.repeat(43);
 const originalKey=hmac(bearer,'live','31','ts','0'),compatKey=hmac(bearer,'live','31','ts','0',true);
 const map=new Map(),started=[],stopped=[];
 const ctx={
  SECRET:secret,hlsSessions:map,hlsKey:hmac,Buffer,Response,cancelPendingSharedLiveViewer:()=>false,
  secureEquals:()=>true,join:(...args)=>args.join('/'),
  readFileSync:(file,encoding)=>encoding==='utf8'?'#EXTM3U\n#EXT-X-VERSION:3\n':Buffer.from('#EXTM3U\n#EXT-X-VERSION:3\n'),
  existsSync:()=>true,touchHls(){},awaitHlsFile:async()=>true,
  expiredLiveSegment:()=>false,staleLiveManifest:()=>false,
  liveShareAllowed:()=>false,liveSourceIdentity:()=> 'synthetic-source',
  liveSourceRetryMs:()=>0,noteLiveSourceHealthy(){},
  hlsError:(status,error)=>({status,error}),
  json:(status,value)=>({status,value}),
  startHls:async args=>{
   started.push(args);
   const session={key:args.key,kind:args.kind,dir:'/fake',videoMode:args.forceCompat?'compatibility_transcode':'source_copy'};
   map.set(session.key,session);
   return {session}
  },
  stopHls:(session)=>{stopped.push(session.key);map.delete(session.key)}
 };
 const worker=vm.runInNewContext(source.slice(begin,end)+';\nhlsRequest',ctx);
 const headers={get(name){if(name==='authorization')return bearer;if(name==='x-compat-secret')return secret;return null}};
 map.set(originalKey,{key:originalKey,kind:'live',dir:'/fake',videoMode:'source_copy'});
 const get=await worker({method:'GET',headers},new URL('http://worker/hls/live/31/ts/0/compat/index.m3u8'));
 assert.equal(get.status,200);
 assert.equal(get.headers.get('x-blofy-video-mode'),'compatibility_transcode');
 assert.equal(started.length,1);
 assert.equal(started[0].forceCompat,true);
 assert.equal(started[0].key,compatKey);
 assert.equal(map.has(originalKey),true,'compatibility must not replace original-video session');
 const stop=await worker({method:'POST',headers},new URL('http://worker/hls/live/31/ts/0/compat/stop'));
 assert.equal(stop.status,200);
 assert.deepEqual(stopped,[compatKey]);
 assert.equal(map.has(originalKey),true,'compatibility stop must not terminate original-video playback');
 const sidA='a'.repeat(32),sidB='b'.repeat(32);
 const viewerA=hmac(bearer,'live','31','ts','0',false,false,sidA);
 const viewerB=hmac(bearer,'live','31','ts','0',false,false,sidB);
 map.set(viewerA,{key:viewerA,kind:'live',dir:'/userA',videoMode:'source_copy'});
 map.set(viewerB,{key:viewerB,kind:'live',dir:'/userB',videoMode:'source_copy'});
 const stopA=await worker({method:'POST',headers},
  new URL('http://worker/hls/live/31/ts/0/sid-'+sidA+'/stop'));
 assert.equal(stopA.status,200);
 assert.equal(map.has(viewerA),false);
 assert.equal(map.has(viewerB),true,'stopping viewer A must preserve concurrent viewer B');
 assert.equal(map.has(originalKey),true,'scoped stop must not kill a legacy viewer');
 const getB=await worker({method:'GET',headers},
  new URL('http://worker/hls/live/31/ts/0/sid-'+sidB+'/index.m3u8'));
 assert.equal(getB.status,200,'viewer B continues playing');
 assert.equal(started.length,1,'viewer B already has a live session and does not start another FFmpeg');
 const fakeResource=await worker({method:'GET',headers},
  new URL('http://worker/hls/live/31/ts/0/sid-'+sidA+'/seg-000001.ts'));
 assert.equal(fakeResource.status,404,'a stopped viewer cannot download a different viewers segment');
 const invalid=await worker({method:'GET',headers},
  new URL('http://worker/hls/live/31/ts/0/sid-not-a-valid-sid/index.m3u8'));
 assert.equal(invalid.status,404,'malformed playback identifiers are rejected');
});


test('active live playlist requests survive 12 simulated minutes without the old nine-minute cutoff',()=>{
 const c=fakeClock(),session={legacyHls:true,fullVod:false};
 c.touch(session);session.hardTimer=c.makeTimer(540000);
 for(let minute=1;minute<=12;minute++){
  const old=session.hardTimer;
  c.advance(60*1000);
  c.touch(session);
  assert.ok(c.cleared.includes(old.id),'the previous hard timer must be cancelled');
  assert.equal(c.timers.get(session.hardTimer.id).ms,9*60*1000);
  assert.equal(session.lastAccess,minute*60*1000)
 }
});

test('live FFmpeg maintains the normal audio clock without pitch-shifting the commentator',()=>{
 const start=source.indexOf('async function startHls({');
 const end=source.indexOf('\nasync function hlsRequest(',start);
 assert.ok(start>0&&end>start);
 const live=source.slice(start,end);
 assert.ok(live.includes("aresample=async=1:min_hard_comp=0.100:first_pts=0"),
   'audio should correct timestamp gaps by sample insertion/trimming rather than speed stretch');
 assert.ok(live.includes("'-ar','48000'"),'AAC output is a stable 48kHz clock');
 assert.ok(live.includes("'-b:a','160k'"),'preserve useful speech and broadcast audio bitrate');
});


test('FFmpeg log parsing identifies upstream SD vs FHD without exposing input URLs or credentials',()=>{
 const start=source.indexOf('function streamInputVideoDimensions(log){');
 const end=source.indexOf('\nasync function startHls(',start);
 assert.ok(start>0&&end>start,'source resolution parser must exist');
 const parse=vm.runInNewContext(source.slice(start,end)+';\nstreamInputVideoDimensions');
 const sd="Input #0, mpegts, from 'pipe:0':\n    Stream #0:0[0x100]: Video: h264 (High), yuv420p(tv), 854x480 [SAR 1:1 DAR 427:240], 25 fps\nOutput #0, hls, to '/tmp/file':\n    Stream #0:0: Video: h264, yuv420p, 1280x720";
 assert.equal(parse(sd),'854x480','must report source SD, never transcoded 720p');
 assert.equal(parse("Input #0, mpegts, from 'pipe:0':\n Stream #0:0: Video: h264, 1920x1080, 50 fps"),'1920x1080');
 assert.equal(parse("Input #0\n Stream #0:0: Audio: aac, 48000 Hz"),'');
 assert.equal(parse("Input #0\n Stream #0:0: Video: hevc, 9999x9999"),'','reject implausible dimensions');
});
