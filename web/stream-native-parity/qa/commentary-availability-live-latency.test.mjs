import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const sidecar=readFileSync(new URL('../stream-commentary.js',import.meta.url),'utf8');
const server=readFileSync(new URL('../server.ts',import.meta.url),'utf8');

test('LIVE MSE startup is one segment closer to the source but retains compatibility guard',()=>{
 const at=app.indexOf('function playHls(');
 const end=app.indexOf('\nfunction ',at+15);
 assert.ok(at>=0&&end>at);
 const live=app.slice(at,end);
 assert.match(live,/liveSyncDurationCount:3/);
 assert.match(live,/liveMaxLatencyDurationCount:10/);
 assert.match(live,/lowLatencyMode:false/);
 assert.match(live,/manifestLoadingRetryDelay:1600/);
 assert.match(live,/levelLoadingRetryDelay:1600/);
 assert.match(live,/manifestLoadingMaxRetry:2/);
 assert.match(live,/var engine=new window.Hls/);
});
test('LIVE commentator menu supports existing in-stream audio without another upstream feed',()=>{
 assert.match(app,/function embeddedCommentaryChoices\(manager\)/);
 assert.match(app,/video\.audioTracks/);
 assert.match(app,/engine\.audioTracks/);
 assert.match(app,/engine\.audioTrack=index/);
 assert.match(app,/manager\.select\('original'\)/);
 assert.match(app,/choicePanel\.hidden\|\|choiceOrigin!==origin/);
 assert.match(app,/المعلقون الخارجيون غير مفعّلين على السيرفر/);
 assert.match(app,/id="commentator-voice-preview"/);
 assert.match(app,/tracks\.filter\(function\(t\)/);
 assert.match(app,/commentary_not_enabled/);
 assert.match(app,/تقدر تجرب الصوتيات المدمجة/);
});

test('disabled external commentary returns explicit status while primary TV audio stays live',async()=>{
 const win={};
 const video={muted:false,volume:0.7,addEventListener(){},removeEventListener(){}};
 runInNewContext(sidecar,{window:win,Audio:function(){throw Error('must not open audio source')},
  fetch:async()=>({ok:false,status:503,json:async()=>({error:'commentary_not_enabled'})}),encodeURIComponent,Promise,setTimeout,clearTimeout});
 const manager=win.BlofyCommentary.create(video,'1312445');
 const tracks=await manager.load();
 assert.equal(tracks.length,0);
 assert.equal(manager.failure(),'not_enabled');
 assert.equal(video.muted,false);
 manager.destroy();
});

test('protected commentary API checks authentication before feature availability',()=>{
 assert.match(server,/if\(p==='\/api\/audio\/catalog'&&method==='GET'\)\{\s*if\(!h\)return json\(401/);
 assert.match(server,/if\(p\.startsWith\('\/api\/audio\/track\/'\)&&method==='GET'\)\{\s*if\(!h\)return json\(401/);
 assert.match(server,/BLOFY_WEB_COMMENTARY_ENABLED!=='1'/);
});

test('upstream commentary outage is not mislabeled as disabled web settings',async()=>{
 const win={};
 const video={muted:false,volume:0.7,addEventListener(){},removeEventListener(){}};
 runInNewContext(sidecar,{window:win,Audio:function(){throw Error('must not open audio source')},
  fetch:async()=>({ok:false,status:503,json:async()=>({error:'commentary_unavailable'})}),
  encodeURIComponent,Promise,setTimeout,clearTimeout});
 const manager=win.BlofyCommentary.create(video,'1312445');
 await manager.load();
 assert.equal(manager.failure(),'source_unavailable');
 assert.equal(video.muted,false);
 manager.destroy()
});
