import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const first=app.indexOf('function countVisualOutage(');
const end=app.indexOf('/* Stop a silent ended/paused live decoder',first);
assert.ok(first>0&&end>first,'outage accounting helper exists');
const helper=app.slice(first,end);

function setup(mode){
 const video={paused:false,seeking:false};
 const stats={visualOutageCount:0,visualOutageMs:0,longestVisualOutageMs:0,
  visualOutageByEngine:{hls:{count:0,ms:0},mpegts:{count:0,ms:0}}};
 const S={route:'player',playerView:{kind:'live',video,userPaused:false,stats}};
 const document={hidden:false};
 const count=vm.runInNewContext(helper+';countVisualOutage',{S,document,Number,Math});
 const record={mode:mode||'hls',visualProgressSeen:true,visualOutageReported:false,
  ready:true,lastProgressAt:1000,lastVisualSampleAt:14000};
 return {video,stats,S,document,count,record};
}

test('HLS outage attributed exactly once and remains local, without a channel identifier',()=>{
 const h=setup('hls');
 assert.equal(h.count(h.record,h.video,15000),true);
 assert.equal(h.count(h.record,h.video,15200),false,'duplicate same outage');
 assert.equal(h.stats.visualOutageCount,1);
 assert.equal(h.stats.visualOutageMs,14000);
 assert.equal(h.stats.longestVisualOutageMs,14000);
 assert.deepEqual(JSON.parse(JSON.stringify(h.stats.visualOutageByEngine)),
  {hls:{count:1,ms:14000},mpegts:{count:0,ms:0}});
 assert.deepEqual(Object.keys(h.stats.visualOutageByEngine).sort(),['hls','mpegts']);
});

test('MPEG-TS outage attributed to direct player and not HLS',()=>{
 const h=setup('mpegts');
 assert.equal(h.count(h.record,h.video,15100),true);
 assert.equal(h.stats.visualOutageByEngine.mpegts.count,1);
 assert.equal(h.stats.visualOutageByEngine.hls.count,0);
});

test('no fabricated per-engine gap for paused/hidden/sleeping/preview playback',()=>{
 for(const reason of ['userPaused','hidden','preview','sleep','startup']){
  const h=setup('hls');
  if(reason==='userPaused')h.S.playerView.userPaused=true;
  if(reason==='hidden')h.document.hidden=true;
  if(reason==='preview')h.S.route='live';
  if(reason==='sleep')h.record.lastVisualSampleAt=1000;
  if(reason==='startup')h.record.visualProgressSeen=false;
  assert.equal(h.count(h.record,h.video,15000),false,reason);
  assert.equal(h.stats.visualOutageByEngine.hls.count,0,reason);
 }
});

test('channel switch clears current channel QoE metrics while leaving engine routing intact',()=>{
 assert.match(app,/state\.stats\.visualOutageByEngine=\{hls:\{count:0,ms:0\},mpegts:\{count:0,ms:0\}\}/);
 assert.match(app,/state\.stats\.visualOutageCount=0;state\.stats\.visualOutageMs=0/);
 assert.match(app,/توقف الصورة حسب المحرك/);
 assert.match(app,/حسب المحرك: HLS/);
 assert.match(app,/محرك التشغيل الحالي/);
});
