import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const first=app.indexOf('function livePlaybackProgress(');
const end=app.indexOf('\nfunction liveExpiredSegmentRecovery(',first);
assert.ok(first>=0&&end>first);
const monitor=vm.runInNewContext(app.slice(first,end)+';livePlaybackProgress',{Date,Number,Math});

test('audio-only clock cannot mask frozen or missing live video even at readyState 4',()=>{
 const record={started:1000,lastProgressAt:1000,lastMediaTime:10,lastVideoFrames:null};
 const video={readyState:4,currentTime:12,videoWidth:0,videoHeight:0,
  getVideoPlaybackQuality:()=>({totalVideoFrames:0})};
 let status=monitor(record,video,4000);
 assert.equal(status.advanced,false,'audio-only currentTime must not count as picture');
 assert.equal(status.idleMs,3000);
 video.currentTime=30;
 status=monitor(record,video,18000);
 assert.equal(status.advanced,false,'audio still moving after 18 seconds is not valid video');
 assert.equal(status.idleMs,17000,'HLS watchdog can recover black screen in 16s');
 video.readyState=4;video.currentTime=35;
 status=monitor(record,video,28000);
 assert.equal(status.advanced,false);
 assert.ok(status.idleMs>=16000);
});

test('healthy picture dimensions and advancing media clock remain playable on old TVs without frame counters',()=>{
 const record={started:1000,lastProgressAt:1000,lastMediaTime:10,lastVideoFrames:null};
 const video={currentTime:11,videoWidth:1280,videoHeight:720,
  getVideoPlaybackQuality:()=>({totalVideoFrames:0})};
 const check=monitor(record,video,2000);
 assert.equal(check.advanced,true,'real picture dimensions permit legacy TV time fallback');
 assert.equal(record.lastProgressAt,2000);
 video.currentTime=12;
 video.videoHeight=0;
 assert.equal(monitor(record,video,3000).advanced,false,'disappearing video size freezes progress even if audio continues');
 video.videoHeight=720;
 video.currentTime=13;
 assert.equal(monitor(record,video,4000).advanced,true,'returning picture can recover naturally');
});

test('a presented frame callback is actual visual evidence even when TV firmware exposes no dimensions',()=>{
 const record={started:1000,lastProgressAt:1000,lastMediaTime:10,
  framePresentationObserved:true,lastPresentedFrameAt:2500,lastSampledPresentationAt:0};
 const video={currentTime:11,videoWidth:0,videoHeight:0,
  getVideoPlaybackQuality:()=>({totalVideoFrames:0})};
 assert.equal(monitor(record,video,2600).advanced,true);
 video.currentTime=19;
 assert.equal(monitor(record,video,12000).advanced,false,
  'audio must not hide stalled frame callbacks');
 record.lastPresentedFrameAt=12001;
 assert.equal(monitor(record,video,12100).advanced,true);
});

test('live player reports audio-without-picture separately and recovers within a bounded watchdog window',()=>{
 const begin=app.indexOf('function playHls('),end=app.indexOf('function playFullVod(',begin);
 const hls=app.slice(begin,end);
 assert.match(hls,/progress.idleMs>=16000/);
 assert.match(hls,/!video.videoWidth\|\|!video.videoHeight/);
 assert.match(hls,/وصل الصوت أو توقيت البث لكن الصورة لم تظهر/);
 assert.match(hls,/['"]picture_freeze['"]:['"]picture_missing['"]/,
  'watchdog distinguishes an invisible picture from frozen picture frames');
 assert.match(app,/picture_missing:'الصورة غير ظاهرة'/,
  'private playback timeline explains the missing-picture incident');
 assert.match(app,/picture_freeze:'تجمد الصورة'/,
  'visible frozen-frame diagnosis remains available');
 assert.match(hls,/recoverConnection\(\)/);
 assert.match(hls,/if\(video.paused\|\|video.ended\|\|video.seeking\|\|document.hidden\)/,
  'never restart a user-paused or hidden TV player');
});


test('manual timing restores the actual live latency profile',()=>{
 const begin=app.indexOf('function setLiveTimeshiftMode('),end=app.indexOf('function liveTimeshiftTarget(',begin);
 assert.ok(begin>=0&&end>begin);
 const setMode=vm.runInNewContext(app.slice(begin,end)+';setLiveTimeshiftMode',{Number,Infinity});
 const record={engine:{config:{liveMaxLatencyDurationCount:12}},liveLagSince:100};
 setMode(record,true);assert.equal(record.userTimeshift,true);assert.equal(record.engine.config.liveMaxLatencyDurationCount,Infinity);
 record.normalLiveMaxLatency=16;
 setMode(record,false);assert.equal(record.engine.config.liveMaxLatencyDurationCount,16);assert.equal(record.userTimeshift,false);assert.equal(record.liveLagSince,0);
 const native={};setMode(native,true);assert.equal(native.userTimeshift,true);setMode(native,false);assert.equal(native.userTimeshift,false);
});
