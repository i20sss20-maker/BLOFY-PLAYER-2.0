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
 return {video,stats,S,rec,monitor,context};
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
