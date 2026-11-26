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
  assert.equal(normalize(phase,false),'جار تشغيل القناة…');
 assert.equal(normalize('اضغط تشغيل ▶',false),'اضغط تشغيل ▶');
 assert.equal(normalize('تعذر تشغيل القناة',false),'تعذر تشغيل القناة');
 assert.equal(normalize('جار استعادة الاتصال',true),'جار استعادة الاتصال');
 assert.match(app,/old\.quietWaitTimer\)clearTimeout/);
 assert.match(app,/record\.quietWaitTimer=null;if\(alive\(\)&&record\.bufferSince/);
 assert.match(app,/cachedInfo\?Promise\.resolve\(cachedInfo\):fetch\(manifest/);
 assert.match(app,/record\.admissionVideoInfo=\{mode:response\.headers/);
 assert.match(app,/phoneLiveLayout\(\)&&\(!guide\|\|!guide\.classList\.contains\('phone-guide-open'\)\)\)return/);
});
