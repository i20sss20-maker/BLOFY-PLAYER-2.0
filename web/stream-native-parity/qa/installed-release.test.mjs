import {test} from 'bun:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const app=readFileSync('app.js','utf8');
test('background retirement excludes browser, VOD and picture-in-picture',()=>{
 const a=app.indexOf('function installedLiveShouldRelease('),b=app.indexOf('function retireHiddenInstalledLive(',a);
 const decide=new Function(app.slice(a,b)+';return installedLiveShouldRelease')();
 const r={kind:'live'};
 assert.equal(decide(true,true,r,{},false),true);assert.equal(decide(false,true,r,{},false),false);
 assert.equal(decide(true,false,r,{},false),false);assert.equal(decide(true,true,r,{},true),false);
 assert.equal(decide(true,true,{kind:'movie'},{},false),false);
 assert.ok(app.includes("if(pending.stopKey){confirmInstalledStop(pending);return}"));
 assert.ok(app.includes("failure.error==='hls_session_retired'"));
});
test('stop confirmation does not restart an installed player while hidden or before acknowledgment',async()=>{
 const a=app.indexOf('function confirmInstalledStop('),b=app.indexOf('function installedLiveResumeDecision(',a);
 let resumed=0,status=0;
 const pending={stopKey:'live/1/ts/0/sid-test',stopping:false},doc={hidden:false};
 const confirm=new Function('fetch','api','installedLiveResume','document','resumeInstalledLiveAfterExit','playerStatus',app.slice(a,b)+';return confirmInstalledStop')(
  async()=>({status}),()=>{},pending,doc,()=>resumed++,()=>{});
 status=503;confirm(pending);await Promise.resolve();await Promise.resolve();
 assert.equal(resumed,0);assert.ok(pending.stopKey);
 status=200;confirm(pending);await Promise.resolve();await Promise.resolve();
 assert.equal(pending.stopKey,null);assert.equal(resumed,1);
});

test('native phone list never starts preview; wide explicit selection still works',()=>{
 const a=app.indexOf('function selectChannel('),b=app.indexOf('function decodeEpgField(',a);
 const S={selected:null,library:{}},calls=[],desc={};
 let phone=true;
 const document={querySelectorAll:()=>[],getElementById:id=>id==='live-desc'?desc:null};
 const select=new Function('S','document','findItem','title','loadShortEpg','installedWebApp','beginPreview','phoneLiveLayout',app.slice(a,b)+';return selectChannel')(
 S,document,(kind,id)=>({id}),item=>item.id,()=>{},()=>true,item=>calls.push(item.id),()=>phone);
 select('1',true,true);assert.deepEqual(calls,[]);
 phone=false;
 select('1',true,false);assert.deepEqual(calls,[]);
 select('2',true,true);assert.deepEqual(calls,['2']);
 assert.match(app,/if\(phoneLiveLayout\(\)\)\{[\s\S]*?S\.selected=ch;openPlayer\('live',ch,'ts',title\(chosen\),0\)/);
 assert.ok(app.includes("if(phoneLiveLayout())return;"));
 assert.ok(readFileSync('styles.css','utf8').includes('.live-catalog .preview{display:none}'));
});

test('phone navigation keeps content tabs and four primary destinations',()=>{
 const a=app.indexOf('function phoneHomeNavigation('),b=app.indexOf('function navHtml(',a);
 const result=new Function('S',app.slice(a,b)+';return {bottom:phoneHomeNavigation(),tabs:phoneHomeTabs()}')({route:'home'});
 assert.equal((result.bottom.match(/data-go=/g)||[]).length,4);
 assert.equal((result.tabs.match(/data-go=/g)||[]).length,3);
 assert.match(result.bottom,/data-go="favorites"/);
 assert.match(result.tabs,/data-go="movie"/);
 assert.match(result.tabs,/data-go="series"/);
 assert.match(app,/phoneLiveLayout\(\)\?document.getElementById\('workspace'\)/);
});

test('phone orientation and player chrome remain compact',()=>{
 const css=readFileSync('styles.css','utf8');
 assert.match(css,/html\[data-blofy-device="touch"\] \.app\{\s*display:flex;flex-direction:column;height:100vh/);
 assert.match(css,/\.app \.workspace\{\s*order:0;flex:1 1 0;width:100%;min-height:0/);
 assert.match(css,/\.native-stream-hud \.mobile-player-actions,[\s\S]*?\.player-mode-badge\{display:none\}/);
 assert.match(css,/\.player-live-guide\.phone-guide-open\{display:block/);
 assert.match(app,/id="player-guide-toggle"/);
 assert.match(app,/data-blofy-input'\)==='touch'\?3200:3800/);
 assert.match(app,/enrichPosters\('movie',film.slice\(0,12\)\);enrichPosters\('series',show.slice\(0,12\)\)/);
});

test('live loading status remains stable while actionable errors remain visible',()=>{
 const a=app.indexOf('function simpleLiveStatus('),b=app.indexOf('function playerStatus(',a);
 const normalize=new Function(app.slice(a,b)+';return simpleLiveStatus')();
 for(const phase of ['جار إعادة تهيئة اتصال القناة…','جار استعادة القناة تلقائيًا… (2/4)','جار تعبئة مخزن البث لتقليل التقطيع…','انتهت جلسة المصدر؛ جار استعادة البث خلال 5 ثوانٍ…'])
  assert.equal(normalize(phase,false),'');
 assert.equal(normalize('اضغط تشغيل ▶',false),'اضغط تشغيل ▶');
 assert.equal(normalize('تعذر تشغيل القناة',false),'تعذر تشغيل القناة');
 assert.equal(normalize('جار استعادة الاتصال',true),'جار استعادة الاتصال');
 assert.match(app,/old\.quietWaitTimer\)clearTimeout/);
 assert.match(app,/record\.quietWaitTimer=null;if\(alive\(\)&&record\.bufferSince/);
 assert.match(app,/cachedInfo\?Promise\.resolve\(cachedInfo\):fetch\(manifest/);
 assert.match(app,/record\.admissionVideoInfo=\{mode:response\.headers/);
 assert.match(app,/phoneLiveLayout\(\)&&\(!guide\|\|!guide\.classList\.contains\('phone-guide-open'\)\)\)return/);
});

test('customer settings exposes essential actions only, not engineering reports',()=>{
 const a=app.indexOf('function settingsScreen()'),b=app.indexOf('function fmt(',a);
 const source=app.slice(a,b);
 for(const id of ['refresh-content','refresh-web-shell','clear-watch-history','logout','install-blofy-web'])
  assert.match(source,new RegExp('id="'+id+'"'));
 for(const id of ['check-player-health','check-live-share-health','last-playback-diagnostic','last-long-playback-test','test-tv-capabilities','profile-export','profile-import'])
  assert.doesNotMatch(source,new RegExp('id="'+id+'"'));
 assert.match(source,/customer-settings/);
 assert.doesNotMatch(app,/id="player-(verify-20m|health-toggle|diagnostic-toggle|direct-ts)"/);
 assert.match(app,/id="player-guide-toggle"/);
 assert.match(source,/cleanupPlayer\(\);/);
 assert.match(app,/button.hidden=state.mode==='installed'/);
});

test('installed native recovery has a terminal retry control instead of endless restart',()=>{
 assert.match(app,/var attempt=record.recoveryAttempt\|\|0;\s*if\(attempt>=4\)\{/);
 assert.match(app,/playerStatus\('تعذر الاتصال بالقناة\. أعد المحاولة\.',true\)/);
 assert.match(app,/playerStatus\('تعذر التحقق من صلاحية تشغيل القناة\.',true\)/);
 assert.match(app,/playerStatus\('انتهت جلسة البث\. أعد المحاولة\.',true\)/);
 assert.match(app,/playerStatus\('القناة غير متاحة حاليًا\. أعد المحاولة\.',true\)/);
 assert.match(app,/retry\.style\.display=error\?'inline-flex':'none'/);
});

function handoffFixture(){
 const a=app.indexOf('function queueLiveHlsHandoff('),b=app.indexOf('function playHls(',a);
 const queue=new Function(app.slice(a,b)+';return queueLiveHlsHandoff')();
 const state={},calls=[],starts=[];let current=true,visible=true,wanted='2',errors=0,detached=0;
 const ops={detach:()=>detached++,current:()=>current,visible:()=>visible,matches:r=>r.id===wanted,
 wait:()=>{},error:()=>errors++,timer:()=>1,clear:()=>{},stop:(key,done)=>calls.push({key,done}),start:r=>starts.push(r.id)};
 return {state,calls,starts,request:(id,key)=>{wanted=id;return queue(state,{id},key,ops)},exit:()=>{current=false;state.liveHlsHandoff=null},hide:()=>visible=false,show:()=>visible=true,errors:()=>errors,detached:()=>detached};
}
test('rapid channel choices wait for one confirmed STOP and start only latest choice',()=>{
 const f=handoffFixture();f.request('2','old-sid');f.request('3',null);f.request('4',null);
 assert.equal(f.calls.length,1);assert.equal(f.detached(),1);assert.deepEqual(f.starts,[]);
 f.calls[0].done(200);assert.deepEqual(f.starts,['4']);assert.equal(f.state.liveHlsHandoff,null);
});
test('failed STOP retains original SID and retries before new connection',()=>{
 const f=handoffFixture();f.request('2','old-sid');f.calls[0].done(503);
 assert.equal(f.errors(),1);assert.deepEqual(f.starts,[]);
 f.request('3',null);assert.equal(f.calls[1].key,'old-sid');f.calls[1].done(404);
 assert.deepEqual(f.starts,['3']);
});
test('hidden or exited player never starts a queued connection',()=>{
 const f=handoffFixture();f.request('2','old-sid');f.hide();f.calls[0].done(200);
 assert.deepEqual(f.starts,[]);f.show();f.request('3',null);assert.deepEqual(f.starts,['3']);assert.equal(f.calls.length,1);
 const g=handoffFixture();g.request('2','old-sid');g.exit();g.calls[0].done(200);assert.deepEqual(g.starts,[]);
});


test('transient stop failure retries same SID automatically, latest channel only',()=>{
 const a=app.indexOf('function queueLiveHlsHandoff('),b=app.indexOf('function playHls(',a);
 const queue=new Function(app.slice(a,b)+';return queueLiveHlsHandoff')();
 const state={},stops=[],starts=[],retries=[];let wanted='2',errors=0;
 const ops={detach(){},current:()=>true,visible:()=>true,matches:r=>r.id===wanted,wait(){},error:()=>errors++,timer:()=>1,clear(){},retry:fn=>retries.push(fn),stop:(key,done)=>stops.push({key,done}),start:r=>starts.push(r.id)};
 queue(state,{id:'2'},'old',ops);stops[0].done(503);assert.equal(retries.length,1);assert.equal(errors,0);
 wanted='3';state.liveHlsHandoff.request={id:'3'};retries[0]();assert.equal(stops[1].key,'old');stops[1].done(200);assert.deepEqual(starts,['3']);
});
test('explicit channel selection clears previous user pause and loading text is hidden',()=>{
 assert.match(app,/state\.userPaused=false;\s*if\(newId===String\(id\)\)/);
 assert.match(app,/isLive\?' style="display:none"':''/);
 assert.match(app,/S\.queuedLiveOpen=intent/);
});

test('handoff adapters call browser timers without an invalid native receiver',()=>{
 const a=app.indexOf('timer:function(fn,ms){return setTimeout(fn,ms)},clear:function(id){clearTimeout(id)},retry:function(fn,ms){return setTimeout(fn,ms)},');
 assert.ok(a>=0,'native timer callbacks must be wrapped for browser invocation');
 const line=app.slice(a,app.indexOf('\n',a)).trim().replace(/,$/,'');
 let scheduled=0,cleared=0;
 const nativeSet=function(fn,ms){'use strict';assert.equal(this,undefined);scheduled++;return 7};
 const nativeClear=function(id){'use strict';assert.equal(this,undefined);assert.equal(id,7);cleared++};
 const ops=new Function('setTimeout','clearTimeout','return ({'+line+'})')(nativeSet,nativeClear);
 assert.equal(ops.timer(()=>{},6500),7);ops.clear(7);assert.equal(ops.retry(()=>{},700),7);
 assert.equal(scheduled,2);assert.equal(cleared,1);
});

test('failed preview stop retains its original SID until confirmed, with latest intent only',()=>{
 const a=app.indexOf('function markPreviewRetiring('),b=app.indexOf('function beginPreview(',a);
 const S={accountEpoch:7},calls=[],messages=[],resumes=[];
 const f=new Function('S','api','document',app.slice(a,b)+';return {markPreviewRetiring,confirmPreviewRetired,retryRetiredPreview}')(S,(m,p,b,cb)=>calls.push({p,cb}),{getElementById:()=>({set textContent(v){messages.push(v)}})});
 f.markPreviewRetiring('live/1/ts/0/sid-test');
 assert.equal(f.retryRetiredPreview(()=>resumes.push('first')),true);
 assert.equal(f.retryRetiredPreview(()=>resumes.push('latest')),true);
 assert.equal(calls.length,1);calls[0].cb(503);
 assert.equal(resumes.length,0);assert.equal(S.retiredPreview.key,'live/1/ts/0/sid-test');
 f.retryRetiredPreview(()=>resumes.push('retry'));assert.equal(calls[1].p,calls[0].p);
 calls[1].cb(404);assert.deepEqual(resumes,['retry']);assert.equal(S.retiredPreview,null);
 f.markPreviewRetiring('live/2/ts/0/sid-test');f.retryRetiredPreview(()=>resumes.push('stale'));
 S.accountEpoch++;calls[2].cb(200);assert.deepEqual(resumes,['retry']);assert.equal(f.retryRetiredPreview(()=>{}),false);
});

test('adaptive live buffer increases on sustained waiting, caps growth and cools down after stability',()=>{
 const a=app.indexOf('function adaptLiveBuffer('),b=app.indexOf('function resumeLiveHlsNetwork(',a);
 const adapt=new Function(app.slice(a,b)+';return adaptLiveBuffer')();
 const record={ready:true},engine={config:{maxBufferLength:45,liveSyncDurationCount:5}};
 for(const now of [1000,10000,20000])adapt(record,engine,now,true,false);
 assert.equal(engine.config.maxBufferLength,52);assert.equal(engine.config.liveSyncDurationCount,6);
 for(const now of [30000,40000,50000])adapt(record,engine,now,true,false);
 assert.equal(engine.config.maxBufferLength,60);
 for(const now of [60000,70000,80000])adapt(record,engine,now,true,false);
 assert.equal(engine.config.maxBufferLength,60);
 adapt(record,engine,259999,false,false);assert.equal(engine.config.maxBufferLength,60);
 adapt(record,engine,260000,false,false);assert.equal(engine.config.maxBufferLength,52);
 adapt(record,engine,440000,false,false);assert.equal(engine.config.maxBufferLength,45);
 assert.equal(adapt({ready:true},engine,450000,true,true),null);
 assert.equal(adapt({ready:true,reconnecting:true},engine,450000,true,false),null);
});

test('live recovery cannot allocate another connection while paused, hidden, offline or external',()=>{
 const i=app.indexOf('function liveRecoveryAllowed('),j=app.indexOf('function resumeLiveHlsNetwork(',i);
 const f=new Function(app.slice(i,j)+';return liveRecoveryAllowed')();
 assert.equal(f(false,false,false,false),true);
 for(let bit=0;bit<4;bit++){const flags=[false,false,false,false];flags[bit]=true;assert.equal(f(...flags),false)}
});

test('VOD upgrade retains old session on failure and admits only the latest request after confirmation',()=>{
 const a=app.indexOf('function retireVodBeforeUpgrade('),b=app.indexOf('function playFullVod(',a);
 const retire=new Function(app.slice(a,b)+';return retireVodBeforeUpgrade')();
 const state={},calls=[],opened=[];let detached=0,errors=0;
 const ops=name=>({detach:()=>detached++,current:()=>true,stop:(url,cb)=>calls.push({url,cb}),error:()=>errors++,start:()=>opened.push(name)});
 assert.equal(retire(state,'/api/vod/test/stop',ops('first')),true);
 assert.equal(retire(state,null,ops('second')),true);
 assert.equal(calls.length,1);calls[0].cb(503);
 assert.equal(errors,1);assert.deepEqual(opened,[]);
 retire(state,null,ops('latest'));assert.equal(calls[1].url,calls[0].url);
 calls[1].cb(404);assert.deepEqual(opened,['latest']);
 assert.equal(detached,1);assert.equal(state.vodUpgradeStop,null);
});
