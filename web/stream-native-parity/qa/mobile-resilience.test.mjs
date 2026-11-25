import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../styles.css',import.meta.url),'utf8');
const sw=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
const start=app.indexOf('function touchSeekDecision(');
const end=app.indexOf('function setDeviceInput(',start);
assert.ok(start>=0&&end>start);
const helpers=vm.runInNewContext(app.slice(start,end)+';({touchSeekDecision,browserConnectionCopy})',{Number,Math,String});
const judge=helpers.touchSeekDecision;

test('VOD double taps seek by exactly 10 seconds in the appropriate side',()=>{
 const first=judge(null,1000,40,100,360,'movie',false);
 assert.equal(first.step,0);
 assert.equal(first.last.side,-1);
 const second=judge(first.last,1150,43,101,360,'movie',false);
 assert.equal(second.step,-10);
 assert.equal(second.last,null);
 const right=judge(null,4000,310,120,360,'series',false);
 assert.equal(judge(right.last,4190,308,125,360,'series',false).step,10);
});

test('live streams, center taps, wide gestures, stale taps and blocked playback cannot seek',()=>{
 assert.equal(judge(null,1000,20,100,360,'live',false).step,0);
 assert.equal(judge(null,1000,150,100,360,'movie',false).last,null);
 const p=judge(null,1000,20,100,360,'movie',false).last;
 assert.equal(judge(p,1600,19,101,360,'movie',false).step,0);
 assert.equal(judge(p,1130,90,101,360,'movie',false).step,0);
 assert.equal(judge(p,1130,19,181,360,'movie',false).step,0);
 assert.equal(judge(p,1130,19,100,360,'movie',true).step,0);
 assert.equal(judge(p,1130,-11,100,360,'movie',false).step,0);
 assert.equal(judge(p,1130,21,100,0,'movie',false).step,0);
});

test('connection warnings distinguish browser connectivity from upstream health',()=>{
 assert.match(helpers.browserConnectionCopy(false),/غير متصل بالإنترنت/);
 assert.match(helpers.browserConnectionCopy(true),/حسب المتصفح/);
 assert.match(helpers.browserConnectionCopy(true),/المصدر أو الشبكة/);
});

test('tap feedback and gesture stay local, no extra streaming or API requests',()=>{
 const begin=app.indexOf('function showTouchSeekFeedback(');
 const last=app.indexOf('function refreshVideoResolution(',begin);
 assert.ok(begin>=0&&last>begin);
 const part=app.slice(begin,last);
 assert.match(part,/video\.addEventListener\('pointerup'/);
 assert.match(part,/video\.addEventListener\('touchend'/);
 assert.match(part,/state\.seekBy\(decision\.step\)/);
 assert.match(part,/state\.touchSkipClickUntil=Date\.now\(\)\+420/);
 assert.doesNotMatch(part,/\.load\(|\.src=|fetch\(|\bapi\(|stopPlayback\(/);
 assert.match(app,/id="mobile-seek-feedback" hidden role="status"/);
 assert.match(css,/\.mobile-seek-feedback\[hidden\]/);
});

test('network events do not restart source, reload UI or issue new requests',()=>{
 const begin=app.indexOf('var connectivityHideTimer=');
 const last=app.indexOf("document.addEventListener('visibilitychange',function()",begin);
 assert.ok(begin>=0&&last>begin);
 const part=app.slice(begin,last);
 assert.match(part,/window\.addEventListener\('offline'/);
 assert.match(part,/window\.addEventListener\('online'/);
 assert.match(part,/showBrowserConnectionNotice\(false\)/);
 assert.doesNotMatch(part,/startVod\(|playHls\(|fetch\(|\.reload\(|\bapi\(/);
});

test('updates are offered without reloading while a player is active',()=>{
 const begin=app.indexOf('var freshShellAvailable=');
 const last=app.indexOf("// Shell-only service worker:",begin);
 assert.ok(begin>=0&&last>begin);
 const scoped=app.slice(begin,last);
 assert.match(scoped,/if\(!freshShellAvailable\|\|S\.route==='player'\)/);
 assert.match(scoped,/if\(S\.route==='player'\)return/);
 assert.match(scoped,/window\.location\.reload\(\)/);
 assert.match(app,/if\(previousShellController\&\&current\&\&current!==previousShellController\)/);
 assert.match(app,/now-lastShellCheckAt<30\*60\*1000/);
 assert.match(sw,/blofy-stream-shell-v7/);
 assert.match(sw,/if\(SHELL\.indexOf\(url\.pathname\)<0\)return/);
 assert.doesNotMatch(sw,/['"]\/api\//);
});
