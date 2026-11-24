import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../styles.css',import.meta.url),'utf8');
const start=app.indexOf('function nativeLiveHlsResync(');
const end=app.indexOf('/* Browser live playback uses native Safari HLS',start);
assert.ok(start>0&&end>start);
const resync=vm.runInNewContext(app.slice(start,end)+';nativeLiveHlsResync',{Number,Math});
function setup(){
 const rec={ready:true,visualProgressSeen:true,lastProgressAt:1000,engine:null};
 const video={currentTime:12,paused:false,ended:false,seeking:false,
  seekable:{length:1,start:()=>10,end:()=>30}};
 return {rec,video}
}
test('Apple native HLS rejoins within existing seekable window without a new session',()=>{
 const {rec,video}=setup();
 assert.equal(resync(rec,video,10000,false,false,true),true);
 assert.equal(video.currentTime,25);
 assert.equal(rec.nativeResyncPending,true);
 assert.equal(rec.nativeResyncGraceUntil,17500);
 assert.equal(rec.nativeResyncAt,10000);
 assert.equal(resync(rec,video,11000,false,false,true),false,'do not seek repeatedly');
});
test('never touch Safari if paused, seeking, hidden, recovering, or with existing network backoff',()=>{
 for(const change of [{paused:true},{seeking:true},{ended:true}]){
  const {rec,video}=setup();
  Object.assign(video,change);
  assert.equal(resync(rec,video,10000,false,false,true),false);
  assert.equal(video.currentTime,12);
 }
 for(const changed of [{reconnecting:true},{engine:{}},{originTimer:1},{capacityTimer:1},{retryTimer:1}]){
  const {rec,video}=setup();
  Object.assign(rec,changed);
  assert.equal(resync(rec,video,10000,false,false,true),false);
  assert.equal(video.currentTime,12);
 }
 for(const [paused,hidden,apple] of [[true,false,true],[false,true,true],[false,false,false]]){
  const {rec,video}=setup();
  assert.equal(resync(rec,video,10000,paused,hidden,apple),false);
  assert.equal(video.currentTime,12);
 }
});
test('do not chase a close live edge or retry within 45-second cooldown',()=>{
 const {rec,video}=setup();
 video.currentTime=24;
 assert.equal(resync(rec,video,10000,false,false,true),false);
 video.currentTime=12;
 rec.nativeResyncAt=9000;
 assert.equal(resync(rec,video,10000,false,false,true),false);
 delete rec.nativeResyncAt;
 video.seekable={length:0};
 assert.equal(resync(rec,video,10000,false,false,true),false);
});
test('iPhone-only HLS safeguards and native fullscreen preserve Android/TV source paths',()=>{
 assert.match(app,/data-blofy-ios/);
 assert.match(app,/nativeLiveHlsResync\(record,video,now,/);
 assert.match(app,/if\(record\.nativeResyncPending\&\&video\.seeking/);
 assert.match(app,/record\.nativeResyncPending=false;\s*recoverConnection\(\);return/);
 assert.match(app,/record\.nativeResyncPending=false;\s*if\(!preview/);
 assert.match(app,/appleTouchBrowser\(navigator\.userAgent,navigator\.maxTouchPoints\)\&\&video\.webkitEnterFullscreen/);
 assert.match(css,/data-blofy-ios="true"/);
 assert.match(css,/safe-area-inset-top/);
 assert.match(css,/safe-area-inset-bottom/);
 assert.match(app,/if\(shouldUseNativeHls\(video\)\)/);
 assert.match(app,/hlsForceCompatibility/);
});
