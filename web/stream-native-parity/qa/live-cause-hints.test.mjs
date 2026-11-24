import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const begin=app.indexOf('function liveCauseHint(');
const end=app.indexOf('function liveUnexpectedPause(',begin);
assert.ok(begin>=0&&end>begin,'local diagnosis is available');
const diagnose=vm.runInNewContext(app.slice(begin,end)+';liveCauseHint',{
 Number,Math,Array,Date
});

function base(overrides={}){
 const now=60000;
 const rec={lastProgressAt:45000,visualProgressSeen:true,ready:true,started:1000,
  engine:{},lastFragmentAt:57500};
 const video={paused:false,seeking:false,videoWidth:1280,videoHeight:720};
 const stats={liveEvents:[],visualOutageCount:2};
 Object.assign(rec,overrides.record||{});
 Object.assign(video,overrides.video||{});
 Object.assign(stats,overrides.stats||{});
 return diagnose(rec,video,stats,now,!!overrides.paused,!!overrides.hidden)
}

test('local evidence is not a verdict against subscriber network or provider',()=>{
 assert.equal(base().code,'picture_pipeline');
 assert.match(base().detail,/دون الجزم/);
 assert.equal(base({record:{lastFragmentAt:35000}}).code,'delivery_gap');
 assert.match(base({record:{lastFragmentAt:35000}}).detail,/قد يكون/);
 assert.equal(base({record:{engine:null,lastFragmentAt:0}}).code,'unknown_stall',
  'a native decoder without Hls.js fragment callbacks cannot implicate the source');
});

test('prior verified live picture distinguishes a healthy decoder from missing first frame',()=>{
 assert.equal(base({record:{lastProgressAt:59000}}).code,'progress');
 assert.equal(base({record:{visualProgressSeen:false,lastProgressAt:59000}}).code,'first_picture');
 assert.equal(base({record:{visualProgressSeen:false,engine:null,lastFragmentAt:0}}).code,'first_picture');
 assert.equal(base({record:{engine:null,lastFragmentAt:0},video:{videoWidth:0,videoHeight:0}}).code,'picture_absent');
});

test('recent failures classify capacity, 5xx path, and HLS decode separately',()=>{
 assert.equal(base({stats:{liveEvents:[{code:'encoder_capacity',at:59000}]}}).code,'capacity');
 assert.equal(base({stats:{liveEvents:[{code:'source_error',at:59000}]}}).code,'upstream_response');
 assert.equal(base({stats:{liveEvents:[{code:'decoder_error',at:59000}]}}).code,'decoder_error');
 assert.equal(base({stats:{liveEvents:[{code:'source_error',at:10000}]}}).code,'picture_pipeline',
  'old incident does not mask fresh fragment evidence');
 assert.equal(base({record:{lastProgressAt:59000},stats:{liveEvents:[{code:'source_error',at:58000}]}}).code,'progress',
  'an image which has resumed outweighs a prior network-related error');
});

test('inactive tabs, seeking and manual pause never get diagnosed as packet loss',()=>{
 assert.equal(base({paused:true}).code,'paused');
 assert.equal(base({hidden:true}).code,'paused');
 assert.equal(base({video:{seeking:true}}).code,'paused');
 assert.equal(base({video:{paused:true}}).code,'paused');
 assert.equal(diagnose(null,null,{},60000,false,false).code,'unknown');
});

test('unknown arbitrary incident payloads never enter displayed hint',()=>{
 const res=base({stats:{liveEvents:[{code:'https://host/secret?token=123',at:59000}]}});
 assert.equal(res.code,'picture_pipeline');
 assert.doesNotMatch(res.title+res.detail,/token|https|secret/);
});

test('existing web diagnostics and health cards use same safe local hint',()=>{
 assert.match(app,/var currentHint=isLive\?liveCauseHint\(liveRecord,video,st,now/);
 assert.match(app,/var evidence=state\.kind==='live'\?liveCauseHint\(r,video,st,now/);
 assert.match(app,/مؤشر سبب التقطيع/);
 assert.match(app,/قراءة احتمالية من المشغل وليست تأكيدًا للسبب/);
});
