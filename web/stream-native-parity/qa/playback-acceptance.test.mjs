import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const context={module:{exports:{}}};
const src=readFileSync(new URL('../playback-acceptance.js',import.meta.url),'utf8');
runInNewContext(src,context);
const monitor=context.module.exports;
const start={at:0,playing:true,hidden:false,width:1920,height:1080,
 frames:100,presented:100,time:10,errors:0,recoveries:0,bufferMs:0};
function begin(){return monitor.init('live',0,start)}
function beat(i,override={}){
 return {...start,at:i*2000,frames:100+i,presented:100+i,time:10+i*2,...override}
}
test('success requires 20 real elapsed minutes and verified moving video pixels',()=>{
 const m=begin();let result;
 for(let i=1;i<=600;i++){
  result=monitor.tick(m,beat(i));
  if(i<600)assert.equal(result,null,'cannot claim success before 20 minutes');
 }
 assert.equal(result.status,'passed');
 assert.equal(result.elapsedSeconds,1200);
 assert.equal(result.videoFramesObserved,true);
 assert.equal(result.timeProgressObserved,true);
 assert.equal(monitor.message(result).includes('الصوت يحتاج استماع'),true);
 const next=monitor.tick(m,beat(601));
 assert.equal(next,result,'once finalized, a stale callback cannot change the result');
});
test('audio/currentTime progress cannot mask frozen decoded video frames',()=>{
 const m=begin();
 for(let i=1;i<=7;i++)assert.equal(monitor.tick(m,beat(i)),null);
 const fail=monitor.tick(m,beat(8,{frames:107,presented:107,time:990}));
 assert.equal(fail,null,'first frame freeze observed only for two seconds');
 for(let i=9;i<=14;i++)assert.equal(monitor.tick(m,beat(i,{frames:107,presented:107,time:990+i*3})),null);
 const result=monitor.tick(m,beat(15,{frames:107,presented:107,time:1200}));
 assert.equal(result.status,'failed');
 assert.equal(result.reason,'video_stalled');
});
test('TVs without reliable decoded frame counters must NEVER get fake 100% pass',()=>{
 const m=monitor.init('live',0,{...start,frames:null,presented:null});
 let result;
 for(let i=1;i<=600;i++)result=monitor.tick(m,beat(i,{frames:null,presented:null}));
 assert.equal(result.status,'inconclusive');
 assert.equal(result.reason,'inconclusive');
 assert.equal(result.videoFramesObserved,false);
 assert.equal(result.timeProgressObserved,true);
});
test('stop, hidden page, pause, source reboot, real media errors, and excessive buffering all fail clearly',()=>{
 const probes=[
  {update:{playing:false},reason:'paused'},
  {update:{hidden:true},reason:'hidden'},
  {update:{recoveries:1},reason:'playback_restarted'},
  {update:{errors:1},reason:'playback_error'},
  {update:{bufferMs:30001},reason:'buffering'}
 ];
 for(const {update,reason} of probes){
  const m=begin(),v=monitor.tick(m,beat(1,update));
  assert.equal(v.status,'failed',reason);
  assert.equal(v.reason,reason);
  assert.equal(v.videoFramesObserved,reason==='paused'||reason==='hidden'?false:false);
 }
 const m=begin(),v=monitor.stop(m,10000);
 assert.equal(v.status,'failed');
 assert.equal(v.reason,'stopped');
 assert.equal(monitor.stop(m,50000),v,'cannot double-finalize');
});
test('TV standby / timer suspension gap is not reported as continuous',()=>{
 const m=begin();
 assert.equal(monitor.tick(m,beat(1)),null);
 const result=monitor.tick(m,beat(12));
 assert.equal(result.status,'failed');
 assert.equal(result.reason,'long_gap');
});
test('negative or backwards timer does not claim 20 min progress',()=>{
 const m=begin();monitor.tick(m,beat(1));
 const result=monitor.tick(m,beat(0));
 assert.equal(result.status,'inconclusive');
 assert.equal(result.reason,'clock_regressed');
});
test('start while no video decoded or the browser is hidden is rejected',()=>{
 for(const bad of [{...start,width:0},{...start,hidden:true},{...start,playing:false}])
  assert.throws(()=>monitor.init('live',0,bad),/player_not_ready/);
 assert.throws(()=>monitor.init('movie_bad',0,start),/invalid_kind/);
});
test('local report excludes account, channel ID, source host, token and links',()=>{
 const m=begin();const raw=JSON.stringify(monitor.tick(m,beat(1,{errors:1})));
 for(const secret of ['token','code','sourceHost','channelId','streamId','deviceKey','accessKey','http:'])
  assert.doesNotMatch(raw,new RegExp(secret,'i'));
 assert.equal(raw.includes('movie'),false);
});
test('UI and CI integration: real-player stats only, account-partitioned report, no duplicate source GETs',()=>{
 const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
 const server=readFileSync(new URL('../server.ts',import.meta.url),'utf8');
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const docker=readFileSync(new URL('../Dockerfile',import.meta.url),'utf8');
 const worker=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
 assert.match(app,/profileSave\('lastLongPlaybackTest',saved\)/);
 assert.match(app,/if\(S\.playerView\.stopLongTest\)S\.playerView\.stopLongTest\(\)/);
 assert.match(app,/window\.performance\.now/);
 assert.match(app,/acceptance\.tick\(state\.longTest,acceptanceSnapshot\(\)\)/);
 assert.match(app,/state\.longTestTimer=setInterval\(sampleAcceptance,2000\)/);
 assert.doesNotMatch(app,/id="player-verify-20m"/);
 assert.doesNotMatch(app,/id="last-long-playback-test"/);
 assert.doesNotMatch(app,/api\('POST','\/api\/acceptance/);
 assert.match(server,/p==='\/playback-acceptance\.js'/);
 assert.match(html,/<script src="\/playback-acceptance\.js\?v=2026\.11\.28\.56\.0\.3"><\/script>/);
 assert.match(docker,/COPY .*playback-acceptance\.js/);
 assert.match(worker,/\/playback-acceptance\.js/);
});

test('live timeline regression fails even when decoded video continues advancing',()=>{
 const m=begin();
 assert.equal(monitor.tick(m,beat(1)),null);
 const result=monitor.tick(m,beat(2,{time:2}));
 assert.equal(result.status,'failed');
 assert.equal(result.reason,'media_rewind');
});
test('missing counters becoming available do not count as displayed-frame progress',()=>{
 const m=monitor.init('live',0,{...start,frames:null,presented:null});
 assert.equal(monitor.tick(m,beat(1)),null);
 assert.equal(m.hasFrameProof,false);
 assert.equal(monitor.tick(m,beat(2)),null);
 assert.equal(m.hasFrameProof,true);
});
