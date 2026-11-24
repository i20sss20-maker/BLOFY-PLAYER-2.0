import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../styles.css',import.meta.url),'utf8');
const appleStart=app.indexOf('function appleTouchBrowser(');
const appleEnd=app.indexOf('/* A double tap',appleStart);
const hlsStart=app.indexOf('function shouldUseNativeHls(');
const hlsEnd=app.indexOf('function loadHls(',hlsStart);
assert.ok(appleStart>=0&&appleEnd>appleStart&&hlsStart>appleEnd&&hlsEnd>hlsStart);
function makeContext(ua,touch=0,preferMse=true,videoType='probably'){
 const env={S:{route:'player',preferMseHls:preferMse,playerView:null},
  navigator:{userAgent:ua,maxTouchPoints:touch},
  window:{MediaSource:{isTypeSupported:()=>true}},
  Number,String};
 const funcs=vm.runInNewContext(
  app.slice(appleStart,appleEnd)+app.slice(hlsStart,hlsEnd)+
  ';({shouldUseNativeHls,offerIosPlayGesture})',env);
 return {...funcs,env,video:{canPlayType:()=>videoType}};
}

test('native Apple HLS always wins for iPhone Safari, Chrome, Firefox, Edge, iPad desktop UA',()=>{
 const agents=['Mozilla/5.0 (iPhone; CPU iPhone OS 18_7) AppleWebKit/605.1.15 Mobile Safari/604.1',
 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7) AppleWebKit/605.1.15 CriOS/120 Mobile',
 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7) AppleWebKit/605.1.15 FxiOS/140 Mobile',
 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7) AppleWebKit/605.1.15 EdgiOS/120 Mobile',
 'Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/605.1.15 Version/18 Safari/605.1.15'];
 for(let i=0;i<agents.length;i++){
  const t=makeContext(agents[i],i===4?5:0,true);
  assert.equal(t.shouldUseNativeHls(t.video),true,agents[i]);
  t.video.canPlayType=()=>'';assert.equal(t.shouldUseNativeHls(t.video),false);
 }
});
test('non-Apple browsers and VIDAA keep prior MSE/native policy',()=>{
 const chrome=makeContext('Mozilla/5.0 (Android 14) Chrome/120 Mobile',0,true);
 assert.equal(chrome.shouldUseNativeHls(chrome.video),false);
 const tv=makeContext('Mozilla/5.0 VIDAA Hisense SmartTV',0,false);
 assert.equal(tv.shouldUseNativeHls(tv.video),true);
 const safari=makeContext('Mozilla/5.0 (Macintosh; Intel Mac OS X) Version/18 Safari/605.1.15',0,false);
 assert.equal(safari.shouldUseNativeHls(safari.video),true);
});
test('autoplay affordance requires iPhone, NotAllowedError, current player and non-preview',()=>{
 const t=makeContext('Mozilla/5.0 (iPhone) AppleWebKit/605.1.15');
 let calls=0;
 t.env.S.playerView={video:t.video,promptIosPlay:()=>{calls++;return true}};
 assert.equal(t.offerIosPlayGesture({name:'NotAllowedError'},t.video,false),true);
 assert.equal(calls,1);
 assert.equal(t.offerIosPlayGesture({name:'AbortError'},t.video,false),false);
 assert.equal(t.offerIosPlayGesture({name:'NotAllowedError'},t.video,true),false);
 assert.equal(t.offerIosPlayGesture({name:'NotAllowedError'},{},false),false);
 t.env.S.route='home';
 assert.equal(t.offerIosPlayGesture({name:'NotAllowedError'},t.video,false),false);
 assert.equal(calls,1);
 const other=makeContext('Mozilla/5.0 Android Chrome',0,false);
 other.env.S.playerView={video:other.video,promptIosPlay:()=>true};
 assert.equal(other.offerIosPlayGesture({name:'NotAllowedError'},other.video,false),false);
});
test('tap-to-play only invokes video.play() on user click and preserves paused/source state',()=>{
 const start=app.indexOf('function hideIosPlayGesture(){');
 const end=app.indexOf('// The 20-minute acceptance',start);
 assert.ok(start>0&&end>start);
 const local=app.slice(start,end);
 assert.match(local,/state\.promptIosPlay=promptIosPlay/);
 assert.match(local,/if\(!error\|\|error\.name!=='NotAllowedError'/);
 assert.match(local,/!video\.paused\|\|!video\.isConnected/);
 assert.match(local,/state\.userPaused/);
 assert.match(local,/iosPlayButton\.onclick=function\(\)/);
 assert.match(local,/var promise=video\.play\(\)/);
 assert.match(local,/video\.addEventListener\('playing',hideIosPlayGesture\)/);
 assert.doesNotMatch(local,/stopPlayback\(|playHls\(|fetch\(|\bapi\(|video\.src=/);
 assert.match(app,/id="player-ios-tap-to-play"/);
 assert.match(app,/offerIosPlayGesture\(error,video,preview\)/);
 assert.match(css,/\.player-ios-tap-to-play\[hidden\]\{display:none!important\}/);
 assert.match(css,/data-blofy-ios="true"\] \.player-ios-tap-to-play/);
});
