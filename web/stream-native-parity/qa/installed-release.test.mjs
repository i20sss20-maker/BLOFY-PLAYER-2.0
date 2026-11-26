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

test('installed web explicit selection starts immediately, passive focus does not',()=>{
 const a=app.indexOf('function selectChannel('),b=app.indexOf('function decodeEpgField(',a);
 const S={selected:null,library:{}},calls=[],desc={};
 const document={querySelectorAll:()=>[],getElementById:id=>id==='live-desc'?desc:null};
 const select=new Function('S','document','findItem','title','loadShortEpg','installedWebApp','beginPreview',app.slice(a,b)+';return selectChannel')(
 S,document,(kind,id)=>({id}),item=>item.id,()=>{},()=>true,item=>calls.push(item.id));
 select('1',true,false);assert.deepEqual(calls,[]);
 select('2',true,true);assert.deepEqual(calls,['2']);
 assert.ok(app.includes("if(ch){selectChannel(ch,true,true);return}"));
 assert.ok(app.includes("if(selected)selectChannel(itemId(selected,'live'),true,true);"));
});
