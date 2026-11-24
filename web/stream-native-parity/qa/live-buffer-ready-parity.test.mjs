import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');

const start=app.indexOf('function liveBufferNoticeAllowed(');
const end=app.indexOf('function liveTransientRetryMs(',start);
assert.ok(start>0&&end>start,'live buffer parity helpers are available');
const cleared=[];
const helpers=vm.runInNewContext(app.slice(start,end)+
 ';({liveBufferNoticeAllowed,clearLiveBufferWait,finishObservedBuffer})',{
  Number,Math,Date,clearTimeout:id=>cleared.push(id)
});
const {liveBufferNoticeAllowed:allowed,clearLiveBufferWait:finish,finishObservedBuffer:close}=helpers;

test('Android-like short network hiccups do not claim true stalled playback',()=>{
 const rec={ready:true,visualProgressSeen:true,lastProgressAt:9000,started:100};
 const video={paused:false,seeking:false,ended:false};
 assert.equal(allowed(rec,video,11000,false),false,'recent picture protects a momentary waiting event');
 assert.equal(allowed(rec,video,14000,false),true,'a sustained no-picture period is visible');
 assert.equal(allowed({...rec,ready:false},video,11000,false),true,'first picture remains a distinct startup state');
});
test('intentional pause, hidden tab, seek, source backoff and 429 never show a false waiting notice',()=>{
 const rec={ready:true,visualProgressSeen:true,lastProgressAt:1000,started:100};
 const video={paused:false,seeking:false,ended:false};
 assert.equal(allowed(rec,video,12000,true),false);
 assert.equal(allowed(rec,{...video,paused:true},12000,false),false);
 assert.equal(allowed(rec,{...video,seeking:true},12000,false),false);
 assert.equal(allowed(rec,{...video,ended:true},12000,false);
 for(const key of ['capacityTimer','originTimer','retryTimer','reconnecting']){
  assert.equal(allowed({...rec,[key]:1},video,12000,false),false,key)
 }
});
test('visual recovery cancels timers and dismisses only a buffer notice it owns',()=>{
 const record={bufferNoticeTimer:11,stallTimer:22,waitingSince:2000,
  bufferSince:2000,stallChecks:2,bufferStatusShown:true};
 const label={textContent:'جار استقبال البث…',style:{display:'block'}};
 finish(record,label);
 assert.equal(record.bufferStatusShown,false);
 assert.equal(record.waitingSince,0);
 assert.equal(record.stallTimer,null);
 assert.equal(record.bufferNoticeTimer,null);
 assert.equal(label.style.display,'none');
 assert.deepEqual(cleared.slice(-2),[11,22]);
 const newError={textContent:'تعذر اتصال المصدر؛ انتظر إعادة المحاولة',style:{display:'block'}};
 finish({...record,bufferStatusShown:true},newError);
 assert.equal(newError.style.display,'block','later source errors are never hidden');
 const watchdog={textContent:'تعليق في صورة البث؛ جار استعادة التشغيل تلقائيًا…',style:{display:'block'}};
 finish({...record,bufferStatusShown:true},watchdog);
 assert.equal(watchdog.style.display,'none','recovered frames remove watchdog-owned stale buffering');
});
test('real picture recovery ends one buffer duration even without another playing event',()=>{
 const stats={bufferSince:12000,bufferMs:2000,bufferEvents:1};
 assert.equal(close(stats,15500),true);
 assert.equal(stats.bufferMs,5500);
 assert.equal(stats.bufferSince,0);
 assert.equal(close(stats,16000),false,'repeated timeupdates do not double-count wait');
 assert.equal(stats.bufferMs,5500);
 assert.equal(close({bufferSince:0,bufferMs:1},20000),false)
});
test('repeated live waiting does not reset its 8.5-second stall timer',()=>{
 const hls=app.slice(app.indexOf('function playHls('),app.indexOf('function durationSeconds('));
 const first=hls.indexOf(' video.onwaiting=video.onstalled=function(){');
 const last=hls.indexOf(' // Independent timer covers silent stalls',first);
 const onWaiting=hls.slice(first,last);
 assert.ok(first>0&&last>first);
 assert.match(onWaiting,/if\(record\.stallTimer\)return/);
 assert.doesNotMatch(onWaiting,/if\(record\.stallTimer\)clearTimeout/);
 assert.match(onWaiting,/record\.bufferNoticeTimer=setTimeout/);
 assert.match(onWaiting,/record\.waitingSince=now/);
 assert.match(onWaiting,/liveBufferNoticeAllowed\(record,video,Date\.now\(\),document\.hidden\)/);
 assert.match(onWaiting,/record\.capacityTimer\|\|record\.originTimer\|\|record\.retryTimer/);
 assert.doesNotMatch(onWaiting,/جار تعبئة مخزن البث/);
 assert.match(hls,/if\(progress\.advanced\)[\s\S]{0,300}finishObservedBuffer\(S\.playerView\.stats,now\)/);
 assert.match(hls,/if\(progress\.advanced\)[\s\S]{0,550}clearLiveBufferWait\(record,statusElement\)/);
 assert.match(app,/if\(old\.bufferNoticeTimer\)clearTimeout\(old\.bufferNoticeTimer\)/);
});
test('native MP4 and direct MPEGTS also keep recovery deadlines across waiting events',()=>{
 const direct=app.slice(app.indexOf('function startDirect(){'),app.indexOf('var directTsButton='));
 assert.match(direct,/if\(state\.directTimer\)return/);
 assert.match(direct,/state\.directBufferNoticeTimer=setTimeout/);
 assert.match(direct,/function clearDirectWaiting\(\)/);
 assert.doesNotMatch(direct,/جار تعبئة مخزن الفيديو/);
 assert.match(direct,/finishObservedBuffer\(state\.stats,Date\.now\(\)\)/);
 const ts=app.slice(app.indexOf('function playDirectMpegts('),app.indexOf('function playHls('));
 assert.match(ts,/if\(record\.stallTimer\)return/);
 assert.match(ts,/if\(progress\.advanced\&\&record\.stallTimer\)/);
 assert.match(app,/if\(S\.playerView\.directBufferNoticeTimer\)\{clearTimeout/);
});
test('actual Android Media3 backend remains unchanged; browser works by evidence, not fake engine claims',()=>{
 assert.match(app,/Browser live playback uses native Safari HLS or Hls\.js, NOT Media3/);
 assert.match(app,/record\.framePresentationObserved/);
 assert.match(app,/if\(progress\.idleMs>=16000\)/);
 assert.match(app,/if\(record\.recoveryAttempt>=4\)/);
 assert.match(app,/maxLiveSyncPlaybackRate:1/);
});
