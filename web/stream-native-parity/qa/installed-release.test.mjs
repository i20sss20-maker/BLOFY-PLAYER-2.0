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
