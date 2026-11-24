import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const first=app.indexOf('function livePlaybackProgress(');
const end=app.indexOf('\nfunction liveExpiredSegmentRecovery(',first);
assert.ok(first>=0&&end>first);

function monitorHarness(){
 const video={currentTime:10,videoWidth:1280,videoHeight:720,paused:false,seeking:false,
  getVideoPlaybackQuality:()=>({totalVideoFrames:0})};
 const stats={visualOutageCount:0,visualOutageMs:0,longestVisualOutageMs:0};
 const S={route:'player',playerView:{kind:'live',video,stats}};
 const context={Date,Math,Number,S,document:{hidden:false}};
 const monitor=vm.runInNewContext(app.slice(first,end)+';livePlaybackProgress',context);
 const rec={started:1000,ready:true,lastProgressAt:1000,lastMediaTime:9,lastVideoFrames:null};
 return {video,stats,S,rec,monitor,context,countOutage:context.countVisualOutage};
}

test('verified picture outage is counted once on recovery; startup excluded',()=>{
 const {video,stats,rec,monitor}=monitorHarness();
 assert.equal(monitor(rec,video,2000).advanced,true);
 assert.equal(stats.visualOutageCount,0);
 video.currentTime=10;
 assert.equal(monitor(rec,video,6000).advanced,false);
 video.currentTime=11;
 assert.equal(monitor(rec,video,10000).advanced,true);
 assert.equal(stats.visualOutageCount,1);
 assert.equal(stats.visualOutageMs,8000);
 assert.equal(stats.longestVisualOutageMs,8000);
 video.currentTime=12;
 assert.equal(monitor(rec,video,12000).advanced,true);
 assert.equal(stats.visualOutageCount,1);
});

test('picture outage is not charged to paused, hidden or seeking playback',()=>{
 const {video,stats,rec,monitor,context}=monitorHarness();
 monitor(rec,video,2000);
 video.paused=true;video.currentTime=11;
 monitor(rec,video,12000);
 assert.equal(stats.visualOutageCount,0);
 video.paused=false;context.document.hidden=true;video.currentTime=12;
 monitor(rec,video,23000);
 assert.equal(stats.visualOutageCount,0);
 context.document.hidden=false;video.seeking=true;video.currentTime=13;
 monitor(rec,video,34000);
 assert.equal(stats.visualOutageCount,0);
});

test('media observations from preview or another video never affect player stats',()=>{
 const {video,stats,rec,monitor,S}=monitorHarness();
 monitor(rec,video,2000);
 S.route='live';video.currentTime=11;
 monitor(rec,video,10000);
 assert.equal(stats.visualOutageCount,0);
 S.route='player';S.playerView.video={};video.currentTime=12;
 monitor(rec,video,21000);
 assert.equal(stats.visualOutageCount,0);
});

test('diagnostics report only aggregate local picture gaps',()=>{
 assert.match(app,/visualOutageCount:0,visualOutageMs:0,longestVisualOutageMs:0/);
 assert.match(app,/فترات غياب تقدم الصورة المرصودة/);
 assert.match(app,/مدة غياب تقدم الصورة تقديرية من العينات/);
});

test('a decoder recovery records one prolonged outage without seeing a later frame',()=>{
 const {video,stats,rec,monitor,countOutage}=monitorHarness();
 monitor(rec,video,2000);
 // The watchdog keeps running, but no new decoded frame is presented.
 video.currentTime=10;
 monitor(rec,video,6000);
 monitor(rec,video,10000);
 assert.equal(countOutage(rec,video,17000),false,
  'a late recovery callback without recent samples must not invent frame health');
 monitor(rec,video,14000);
 assert.equal(countOutage(rec,video,16500),true,
  'a monitored 14.5-second stall is counted when engine restarts');
 assert.equal(countOutage(rec,video,17000),false,'no double count per stall');
 assert.equal(stats.visualOutageCount,1);
 assert.equal(stats.visualOutageMs,14500);
});

test('a sleeping browser cannot inflate frozen-picture time',()=>{
 const {video,stats,rec,monitor}=monitorHarness();
 monitor(rec,video,2000);
 video.currentTime=11;
 monitor(rec,video,9000);
 assert.equal(stats.visualOutageCount,0,'no outage from a 7-second missing sample');
 assert.equal(rec.lastProgressAt,9000,'clock baseline resumes after suspension');
 video.currentTime=12;
 monitor(rec,video,11000);
 assert.equal(stats.visualOutageCount,0);
});

test('both HLS and direct watchers reset visual gap on user pause and hidden tab',()=>{
 const directStart=app.indexOf('function playDirectMpegts(');
 const hlsStart=app.indexOf('function playHls(',directStart);
 const hlsEnd=app.indexOf('function playFullVod(',hlsStart);
 assert.ok(directStart>0&&hlsStart>directStart&&hlsEnd>hlsStart);
 const direct=app.slice(directStart,hlsStart),hls=app.slice(hlsStart,hlsEnd);
 assert.match(direct,/record\.visualProgressSeen=false;/);
 assert.match(hls,/record\.lastVisualSampleAt=now;/);
 assert.match(direct,/countVisualOutage\(record,video,Date\.now\(\)\)/);
 assert.match(hls,/countVisualOutage\(record,video,Date\.now\(\)\)/);
});
