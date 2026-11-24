import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
function extract(a,b){
 const i=app.indexOf(a),j=app.indexOf(b,i+a.length);
 assert.ok(i>=0&&j>i,'missing helper between '+a+' and '+b);
 return app.slice(i,j)
}
test('warm HLS code runs only after a verified desktop session and only when idle',()=>{
 const code=extract('function warmDesktopHlsAfterAuth(){','function loadMpegts(done){');
 let idle,loads=0;
 const S={userVerified:true,accountEpoch:4,route:'home',hlsState:null},
  document={hidden:false},
  navigator={userAgent:'Mozilla/5.0 Chrome/142.0 Windows NT 10.0'},
  window={MediaSource:function(){},requestIdleCallback:(cb,opts)=>{idle=cb;assert.equal(opts.timeout,7500)}};
 const ctx={S,document,navigator,window,loadHls:(cb)=>{loads++;cb(true)},setTimeout};
 const warm=vm.runInNewContext(code+';warmDesktopHlsAfterAuth',ctx);
 warm();assert.equal(loads,0);assert.equal(typeof idle,'function');
 idle();assert.equal(loads,1,'authorized desktop warms library during idle');
 loads=0;warm();S.accountEpoch++;idle();assert.equal(loads,0,'logout/account change cancels old warmup')
});
test('warmup never loads media engine for VIDAA/Android TV or before authentication',()=>{
 const code=extract('function warmDesktopHlsAfterAuth(){','function loadMpegts(done){');
 for(const ua of ['VIDAA SmartTV','Hisense SmartTV','Android Chrome','iPhone Safari','Tizen','Windows Chrome']){
  let warmed=0;const S={userVerified:ua!=='Windows Chrome',accountEpoch:1,route:'home'};
  const ctx={S,document:{hidden:false},navigator:{userAgent:ua},
   window:{MediaSource:function(){},requestIdleCallback:()=>warmed++},
   loadHls:()=>{throw Error('should not load')},setTimeout};
  const warm=vm.runInNewContext(code+';warmDesktopHlsAfterAuth',ctx);
  warm();assert.equal(warmed,0,'must not prime '+ua)
 }
});
test('audio-only playing does not claim a decoded first picture',()=>{
 const code=extract('function noteFirstPicture(basis){','function onBufferEvent(){');
 const calls=[];let dimensions=[0,0],quality=0;
 const state={stats:{firstFrameAt:0},pictureObservationAllowed:true,firstPictureFrameId:null,
  firstPictureWatchTimer:null};
 const video={isConnected:true,readyState:4,
  get videoWidth(){return dimensions[0]},get videoHeight(){return dimensions[1]},
  getVideoPlaybackQuality:()=>({totalVideoFrames:quality}),
  requestVideoFrameCallback:(fn)=>{calls.push(fn);return calls.length},
  cancelVideoFrameCallback:()=>{}};
 const S={route:'player',playerView:state};
 const ctx={S,state,video,Date,setInterval,clearInterval,Number};
 const {noteFirstPicture,observeFirstPicture}=vm.runInNewContext(code+';({noteFirstPicture,observeFirstPicture})',ctx);
 observeFirstPicture();
 assert.equal(state.stats.firstFrameAt,0);
 assert.equal(calls.length,0);
 dimensions=[1920,1080];observeFirstPicture();
 assert.equal(state.stats.firstFrameAt,0,'video metadata alone is not enough');
 assert.equal(calls.length,1);
 calls[0]();
 assert.ok(state.stats.firstFrameAt>0);
 assert.equal(state.stats.firstFrameBasis,'presented');
});
test('decoded-video counters give evidence when a TV lacks frame callbacks',()=>{
 const code=extract('function noteFirstPicture(basis){','function onBufferEvent(){');
 let quality=0;
 const state={stats:{firstFrameAt:0},pictureObservationAllowed:true,firstPictureFrameId:null};
 const video={isConnected:true,readyState:4,videoWidth:1280,videoHeight:720,
  getVideoPlaybackQuality:()=>({totalVideoFrames:quality})};
 const S={route:'player',playerView:state};
 const observer=vm.runInNewContext(code+';observeFirstPicture',{S,state,video,Date,Number,setInterval,clearInterval});
 observer();assert.equal(state.stats.firstFrameAt,0);
 quality=2;observer();assert.ok(state.stats.firstFrameAt>0);assert.equal(state.stats.firstFrameBasis,'decoded')
});
test('first picture observers are canceled on player exit and channel switches reset metrics',()=>{
 const appClean=extract('function cleanupPlayer(){','function livePlaybackProgress(');
 assert.match(appClean,/clearInterval\(S\.playerView\.firstPictureWatchTimer\)/);
 assert.match(appClean,/cancelVideoFrameCallback\(S\.playerView\.firstPictureFrameId\)/);
 const live=extract('function openPlayer(', 'function persistPlaybackCheckpoint(');
 assert.match(live,/state\.pictureObservationAllowed=false/);
 assert.match(live,/state\.stats\.firstFrameAt=0/);
 assert.match(live,/state\.pictureObservationAllowed=true/);
 assert.match(app,/startup===null\?'لم يؤكد الجهاز أول إطار'/);
 assert.equal((app.match(/stats\.firstFrameAt=Date\.now\(\)/g)||[]).length,1,
  'the sole first-frame assignment must be inside guarded first-picture observer');
});
