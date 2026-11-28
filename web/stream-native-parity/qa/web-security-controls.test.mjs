import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createAdmission,readBoundedJson,sessionFailure,createPlaybackMetrics} from '../web-security-controls.mjs';
test('same account cannot issue overlapping tickets; release is idempotent',()=>{
 const g=createAdmission({limit:3});const a=g.acquire('opaque');assert.equal(a.ok,true);assert.equal(g.acquire('opaque').ok,false);a.release();a.release();assert.equal(g.snapshot().inflight,0);assert.equal(g.acquire('opaque').ok,true);
});
test('limits are bounded and recover after window without evicting active leases',()=>{
 let now=0;const g=createAdmission({limit:2,windowMs:1000,maxKeys:2,maxInflight:2,clock:()=>now});
 const a=g.acquire('a');a.release();g.acquire('a').release();assert.equal(g.acquire('a').ok,false);const b=g.acquire('b');assert.equal(g.acquire('c').ok,false);now=1001;const c=g.acquire('c');assert.equal(c.ok,true);assert.equal(g.snapshot().inflight,2);b.release();c.release();
});
test('logout invalidates pending issuance without releasing its slot early',()=>{
 const g=createAdmission();const a=g.acquire('account');g.revoke('account');assert.equal(a.current(),false);assert.equal(g.acquire('account').ok,false);a.release();const b=g.acquire('account');assert.equal(b.current(),true);b.release();
});
test('actual streamed bytes are capped even without Content-Length',async()=>{
 const r=new Request('https://example.invalid',{method:'POST',body:new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{"x":"'+ 'a'.repeat(500)+'"}'));c.close()}}),duplex:'half'});
 assert.equal((await readBoundedJson(r,256)).status,413);
});
test('valid small JSON succeeds and arrays/malformed input are rejected',async()=>{
 const req=s=>new Request('https://example.invalid',{method:'POST',body:s});
 assert.deepEqual(await readBoundedJson(req('{"id":"123"}'),256),{ok:true,value:{id:'123'}});
 for(const s of ['[]','null','{bad'])assert.equal((await readBoundedJson(req(s),256)).status,400);
});

test('slow body cannot monopolize admission indefinitely',async()=>{
 let cancelled=false;const body=new ReadableStream({pull(){return new Promise(()=>{})},cancel(){cancelled=true}});
 const result=await readBoundedJson({headers:new Headers(),body},256,10);
 assert.equal(result.status,408);assert.equal(cancelled,true);
});

test('session outage is not mistaken for invalid subscription',()=>{
 for(const code of [0,429,500,502,503,504])assert.deepEqual(sessionFailure(code),{status:503,body:{error:'session_unavailable'}});
 for(const code of [401,403])assert.deepEqual(sessionFailure(code),{status:code,body:{active:false}});
});
test('aggregate playback metrics keep fixed buckets and never retain supplied IDs',()=>{
 const q=createPlaybackMetrics({clock:()=>100});
 q.record({kind:'live',runtime:'installed',phase:'live_start',itemId:'private'});
 q.record({kind:'live',runtime:'installed',phase:'first_picture',firstPictureMs:2500,account:'private'});
 q.record({kind:'live',runtime:'installed',phase:'hls_error'});
 assert.equal(q.record({kind:'unknown',runtime:'installed',phase:'first_picture',firstPictureMs:3}),false);
 const report=q.drain(),b=report.buckets[0];assert.equal(b.starts,1);assert.equal(b.firstPictures,1);assert.equal(b.failures,1);
 assert.deepEqual(b.firstPictureHistogram,[0,1,0,0,0,0,0]);assert.ok(!JSON.stringify(report).includes('private'));
 assert.equal(q.drain().buckets.length,0);
});
test('boot recovery retries temporary failures without activation or navigation',()=>{
 const app=readFileSync('app.js','utf8');
 const a=app.indexOf('function bootSession('),b=app.indexOf('bootSession(0);',a);
 assert.ok(a>=0&&b>a);
 assert.match(app,/if\(st===401\|\|st===403\|\|\(st===200&&data.active===false\)\)/);
 assert.match(app,/if\(attempt<3\)/);
 assert.match(app,/state\.stats\.firstFrameAt-Number\(state\.stats\.openedAt/);
});

test('boot session retries 503 and later authenticates; only actual rejection prompts activation',()=>{
 const appSource=readFileSync('app.js','utf8');
 const a=appSource.indexOf('function bootSession('),b=appSource.indexOf('\nbootSession(0);',a);
 const state={route:'boot',userVerified:false},requests=[],scheduled=[],logins=[],routes=[];
 const boot=new Function('S','api','setTimeout','useProfile','navigate','warmDesktopHlsAfterAuth','checkCatalogVersion','login','rememberOfflineGrant','offlineOnlyScreen',appSource.slice(a,b)+';return bootSession')(
  state,(method,path,body,cb)=>requests.push(cb),(fn,ms)=>scheduled.push({fn,ms}),()=>true,(route)=>routes.push(route),()=>{},()=>{},m=>logins.push(m),()=>{},()=>false);
 boot(0);requests[0](503,{error:'session_unavailable'});assert.equal(logins.length,0);assert.equal(scheduled[0].ms,1000);
 scheduled.shift().fn();requests[1](200,{active:true,profileKey:'synthetic'});assert.deepEqual(routes,['home']);assert.equal(state.userVerified,true);
 state.userVerified=false;boot(0);requests[2](401,{});assert.equal(logins.length,1);
});
