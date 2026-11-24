import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const code=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../styles.css',import.meta.url),'utf8');
const start=code.indexOf('function activePlaybackNoticeRecord(');
const end=code.indexOf('function playerStatus(message,error){',start);
assert.ok(start>0&&end>start,'real video notice controller must exist');
const helpers=code.slice(start,end);
function runtime(mode='loading'){
 let frames=0,mediaTime=30,qualityEnabled=true;
 const record={id:'authorized-session'};
 const video={
  isConnected:true,paused:false,seeking:false,ended:false,readyState:4,
  videoWidth:1920,videoHeight:1080,
  get currentTime(){return mediaTime},
  getVideoPlaybackQuality:()=>qualityEnabled?{totalVideoFrames:frames}:null
 };
 const state={video,userPaused:false,noticeShownAt:1000};
 const status={style:{display:'block'},textContent:'جار تحميل المقطع التالي من الفيلم…',
  className:mode==='error'?'player-error':'player-loading'};
 const retry={style:{display:mode==='error'?'inline-flex':'none'}};
 const nodes={'player-status':status,'player-retry':retry};
 const S={route:'player',playerView:state,play:{...record,video}};
 const doc={hidden:false,getElementById:id=>nodes[id]||null};
 let calls=0,events=[];
 const context={S,document:doc,Number,Math,Date,
  playerStatus:(message)=>{calls++;events.push(message);status.style.display=message?'block':'none';
   status.textContent=message;retry.style.display='none'}};
 const funcs=vm.runInNewContext(helpers+';({activePlaybackNoticeRecord,playbackNoticeProgress,playbackNoticeSample,dismissRecoveredPlaybackNotice})',context);
 return {funcs,state,video,status,retry,S,doc,setFrames:n=>frames=n,
  setTime:n=>mediaTime=n,setQualityEnabled:b=>qualityEnabled=b,events:()=>events,calls:()=>calls}
}
test('new decoded video frames remove stuck loading text after Safari omits playing',()=>{
 const x=runtime();
 assert.equal(x.funcs.dismissRecoveredPlaybackNotice(x.state,1100),false);
 x.setFrames(5);
 assert.equal(x.funcs.dismissRecoveredPlaybackNotice(x.state,1800),false,
  'first detectable frame count establishes a baseline');
 x.setFrames(10);
 assert.equal(x.funcs.dismissRecoveredPlaybackNotice(x.state,2600),true);
 assert.equal(x.status.style.display,'none');
 assert.equal(x.calls(),1);
 assert.equal(x.retry.style.display,'none')
});
test('stale error + retry clears only after two successive decoded progress samples',()=>{
 const x=runtime('error');
 x.funcs.dismissRecoveredPlaybackNotice(x.state,1200);
 x.setFrames(2);x.funcs.dismissRecoveredPlaybackNotice(x.state,1700);
 x.setFrames(4);x.funcs.dismissRecoveredPlaybackNotice(x.state,2500);
 assert.equal(x.status.style.display,'block');
 assert.equal(x.retry.style.display,'inline-flex');
 x.setFrames(8);x.funcs.dismissRecoveredPlaybackNotice(x.state,3300);
 assert.equal(x.status.style.display,'none');
 assert.equal(x.retry.style.display,'none')
});
test('audio/playhead progress over frozen video never hides overlay',()=>{
 const x=runtime();
 x.setFrames(15);x.funcs.dismissRecoveredPlaybackNotice(x.state,1400);
 for(let i=1;i<=7;i++){x.setTime(30+i);x.funcs.dismissRecoveredPlaybackNotice(x.state,1500+i*1000)}
 assert.equal(x.status.style.display,'block');
 assert.equal(x.calls(),0)
});
test('pauses, background, seeks, ended and source changes cannot claim recovered frames',()=>{
 const variants=[['paused',true],['seeking',true],['ended',true],['readyState',1],['videoWidth',0]];
 for(const [field,val] of variants){
  const x=runtime();x.setFrames(3);x.funcs.dismissRecoveredPlaybackNotice(x.state,1100);
  x.video[field]=val;x.setFrames(6);
  assert.equal(x.funcs.dismissRecoveredPlaybackNotice(x.state,2200),false,field);
  assert.equal(x.calls(),0)
 }
 const x=runtime();x.setFrames(4);x.funcs.dismissRecoveredPlaybackNotice(x.state,1200);
 x.doc.hidden=true;x.setFrames(9);
 assert.equal(x.funcs.dismissRecoveredPlaybackNotice(x.state,2300),false);
 x.doc.hidden=false;x.state.pendingSeek={target:500};
 x.setFrames(10);assert.equal(x.funcs.dismissRecoveredPlaybackNotice(x.state,3400),false);
 x.state.pendingSeek=null;x.state.userPaused=true;x.setFrames(11);
 assert.equal(x.funcs.dismissRecoveredPlaybackNotice(x.state,4500),false);
 x.state.userPaused=false;x.S.play={id:'next-session',video:x.video};
 x.setFrames(12);
 assert.equal(x.funcs.dismissRecoveredPlaybackNotice(x.state,5600),false,
  'source identity change resets progress baseline')
});
test('legacy decoders may use bounded playhead advance only when no frame counter exists',()=>{
 const x=runtime();
 x.setQualityEnabled(false);x.funcs.dismissRecoveredPlaybackNotice(x.state,1000);
 x.setTime(30.6);assert.equal(x.funcs.dismissRecoveredPlaybackNotice(x.state,2000),true);
 assert.equal(x.status.style.display,'none');
 const y=runtime();y.setQualityEnabled(false);
 y.funcs.dismissRecoveredPlaybackNotice(y.state,1000);
 y.setTime(500);assert.equal(y.funcs.dismissRecoveredPlaybackNotice(y.state,2000),false,
  'seek jumps must not be mistaken for decoded progress')
});
test('buffer notices are delayed for both VOD engines and cleaned on stop',()=>{
 const full=code.slice(code.indexOf('function playFullVod('),code.indexOf('function playVodSegments('));
 const fallback=code.slice(code.indexOf('function playVodSegments('),code.indexOf('function playerIcon('));
 assert.match(full,/rec\.bufferNoticeTimer=setTimeout\(function\(\)/);
 assert.match(full,/video\.readyState<3\)playerStatus\('جار تحميل الجزء المطلوب من الفيلم…'\)/);
 assert.match(fallback,/rec\.bufferNoticeTimer=setTimeout\(function\(\)/);
 assert.match(fallback,/video\.readyState<3\)playerStatus\('جار تحميل المقطع التالي من الفيلم…'\)/);
 const stop=code.slice(code.indexOf('function stopPlayback('),code.indexOf('function cleanupPlayer('));
 assert.match(stop,/old\.bufferNoticeTimer\)clearTimeout\(old\.bufferNoticeTimer\)/);
 const cleanup=code.slice(code.indexOf('function cleanupPlayer('),code.indexOf('function activePlaybackNoticeRecord('));
 assert.match(cleanup,/noticeObserverTimer\)\{clearInterval/);
 assert.match(cleanup,/noticeFrameRepeatTimer\)\{clearTimeout/);
 assert.match(cleanup,/cancelVideoFrameCallback\(S\.playerView\.noticeFrameId\)/);
});
test('real fullscreen overlay layer is bounded and hidden when playback resumes',()=>{
 assert.match(css,/#player-status\.player-loading/);
 assert.match(css,/#player-status\.player-error/);
 assert.match(css,/#player-status\[style\*="display: none"\]\{display:none!important\}/);
 assert.match(css,/pointer-events:none/);
 assert.match(code,/dismissRecoveredPlaybackNotice\(state,Date\.now\(\)\)/);
 assert.match(code,/state\.noticeObserverTimer=setInterval/);
 assert.match(code,/state\.noticeFrameRepeatTimer=setTimeout/);
 assert.match(code,/if\(iosPrompt\&\&!iosPrompt\.hidden\)iosPrompt\.hidden=true/,
  'iOS touch-start overlay must not survive decoded video');
 assert.match(code,/modeBadge\.textContent='MP4 • تشغيل مباشر'/,
  'temporary MP4 inspection label changes once real frames appear');
 const status=code.slice(code.indexOf('function playerStatus(message,error){'),code.indexOf('/* A VIDAA decoder',code.indexOf('function playerStatus(message,error){')));
 assert.match(status,/state\.noticeLastProgressRecord===activePlaybackNoticeRecord\(state\)/);
 assert.match(status,/state\.noticeRecoveryFrames=0/);
 assert.doesNotMatch(helpers,/\/api\//,'the observer never opens a second upstream session');
});


test('direct MP4 without a media-worker record clears stale movie text on decoded video',()=>{
 const x=runtime();x.S.play=null;x.state.mode='direct';
 assert.ok(x.funcs.activePlaybackNoticeRecord(x.state),
  'direct MP4 uses a local identity, not a second media session');
 x.setFrames(1);x.funcs.dismissRecoveredPlaybackNotice(x.state,1000);
 x.setFrames(4);assert.equal(x.funcs.dismissRecoveredPlaybackNotice(x.state,1900),true);
 assert.equal(x.status.style.display,'none');
 assert.equal(x.S.play,null,'no HLS producer was created')
});
