import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const server=readFileSync(new URL('../server.ts',import.meta.url),'utf8');
const docker=readFileSync(new URL('../Dockerfile',import.meta.url),'utf8');
function extract(name,next){
 const a=app.indexOf('function '+name+'('),b=app.indexOf('\nfunction '+next+'(',a+10);
 assert.ok(a>=0&&b>a,'helper '+name+' exists');
 return app.slice(a,b)
}
test('HLS transient network recoveries are bounded and spaced (Wi-Fi recovery no tight source storm)',()=>{
 const fn=runInNewContext(extract('liveTransientRetryMs','hlsRemuxWorkerSupported')+';liveTransientRetryMs');
 assert.deepEqual([fn(1),fn(2),fn(3),fn(4)], [950,1800,3600,3600]);
 assert.ok(fn(-4)>=950);
 const live=app.slice(app.indexOf('function playHls('),app.indexOf('\nfunction durationSeconds(',app.indexOf('function playHls(')));
 assert.match(live,/record\.transientRetries=\(record\.transientRetries\|\|0\)\+1/);
 assert.match(live,/record\.retryTimer=setTimeout\(function\(\)/);
 assert.match(live,/record\.transientRetries=0/);
 assert.match(app,/if\(old\.retryTimer\)clearTimeout\(old\.retryTimer\)/);
});
test('desktop browsers remux in a worker; old TV engines retain main-thread compatibility',()=>{
 const make=ua=>runInNewContext(extract('hlsRemuxWorkerSupported','liveOriginRetryMs')+';hlsRemuxWorkerSupported',{
  window:{Worker:function(){},Blob:function(){},MediaSource:function(){}},
  navigator:{userAgent:ua}
 });
 assert.equal(make('Mozilla/5.0 Chrome/142.0 Windows NT 10.0')(),true);
 for(const legacy of ['VIDAA','Hisense SmartTV','Tizen 5.0','WebOS','Android 9','iPhone'])assert.equal(make(legacy)(),false,legacy);
 const noWorker=runInNewContext(extract('hlsRemuxWorkerSupported','liveOriginRetryMs')+';hlsRemuxWorkerSupported',{
  window:{Blob:function(){},MediaSource:function(){}},navigator:{userAgent:'Chrome'}
 });
 assert.equal(noWorker(),false);
});
test('HLS+VOD use the same safe remux-worker policy, live starts closer without rate changing pitch',()=>{
 assert.equal((app.match(/enableWorker:hlsRemuxWorkerSupported\(\)/g)||[]).length,3);
 assert.match(app,/liveSyncDurationCount:3,\s*liveMaxLatencyDurationCount:10,maxBufferLength:35/);
 assert.match(app,/maxLiveSyncPlaybackRate:1/);
 const vod=app.slice(app.indexOf('function playFullVod('),app.indexOf('function playVodSegments('));
 assert.match(vod,/rec\.retryTimer=setTimeout/);
 const segment=app.slice(app.indexOf('function playVodSegments('),app.indexOf('function playerIcon('));
 assert.match(segment,/rec\.retryTimer=setTimeout/);
});
test('explicit direct MPEGTS uses first-party auth stream only after old HLS STOP acknowledgment',()=>{
 const m=app.slice(app.indexOf('function playDirectMpegts('),app.indexOf('function playHls('));
 assert.match(m,/api\('POST','\/api\/hls\/'.*'\/stop'/);
 assert.match(m,/if\(st!==200&&st!==404\)/);
 assert.match(m,/stopPlayback\(false\)/);
 assert.match(m,/api\/media\/live\//);
 assert.match(m,/enableStashBuffer:true,stashInitialSize:131072/);
 assert.match(m,/window\.mpegts\.createPlayer/);
 assert.match(m,/window\.mpegts\.Events\.ERROR/);
 assert.match(m,/record\.startupTimer=setTimeout/);
 assert.match(m,/record\.progressWatchdog=setInterval/);
 assert.match(m,/!video\.videoWidth\|\|!video\.videoHeight/);
 assert.match(m,/livePlaybackProgress\(record,video,now\)/);
 assert.match(m,/progress\.idleMs>18000/);
 assert.match(m,/playHls\(video,'live',id,'ts',0,statusElement,false,0\)/);
 assert.match(server,/p==='\/vendor\/mpegts\.js'/);
 assert.match(server,/p\.indexOf\('\/api\/media\/'\)===0/);
 assert.match(docker,/bun install --production/);
 assert.match(app,/id="player-direct-ts"/);
 assert.doesNotMatch(m,/https?:\/\//);
});
test('direct mode can be switched back to HLS without touching other live-viewer sessions',()=>{
 const m=app.slice(app.indexOf('var directTsButton='),app.indexOf("document.getElementById('player-back')"));
 assert.match(m,/state\.mode==='mpegts'/);
 assert.match(m,/playDirectMpegts\(video,String\(state\.id\)/);
 assert.match(m,/playHls\(video,'live',String\(state\.id\)/);
 const start=app.slice(app.indexOf('function playHls('),app.indexOf('function durationSeconds('));
 assert.match(start,/S\.playerView\.mode='hls'/);
 assert.match(start,/directBtn\.textContent=/);
});
