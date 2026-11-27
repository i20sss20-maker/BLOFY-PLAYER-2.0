import test from 'node:test';
import assert from 'node:assert/strict';
import {createEngineWorkerPart} from '../src/blofy-engine-worker-part.mjs';
const now=1700000000000,g='a'.repeat(32),accountId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',a=accountId.replaceAll('-','');
const context={engineId:'hostbrr',generation:g,accountId,name:'index.m3u8'};
test('worker reader requires current account, engine and generation grants on every part',async()=>{
 let calls=0,auth=0,host='media2.blofyplayer.com',generation=g,account=a,expiry=now/1000+60,allowed=true;
 const read=createEngineWorkerPart({enabled:true,clock:()=>now,authorizeGrant:async()=>{auth++;return {ok:allowed,mediaHost:host,path:'/v1/'+generation+'/'+account+'/'+expiry+'/'+ 'c'.repeat(64)+'/index.m3u8'}},fetchImpl:async(url,o)=>{
  calls++;assert.equal(new URL(url).host,'media2.blofyplayer.com');assert.equal(o.redirect,'error');return new Response('fixture');
 }});
 assert.equal((await read(context)).status,200);
 assert.equal((await read({...context,name:'seg-000000001.ts'})).status,200);
 assert.equal(auth,2);assert.equal(calls,2);
 account='d'.repeat(32);assert.equal((await read(context)).status,403);account=a;
 host='media.blofyplayer.com';assert.equal((await read(context)).status,403);host='media2.blofyplayer.com';
 generation='d'.repeat(32);assert.equal((await read(context)).status,403);generation=g;
 expiry=now/1000;assert.equal((await read(context)).status,403);expiry=now/1000+60;
 allowed=false;assert.equal((await read(context)).status,403);
 assert.equal((await read({...context,name:'../status.json'})).status,404);
 assert.equal(calls,2);
});
test('disabled and cancelled readers do not authorize or fetch',async()=>{
 const fn=()=>{throw Error('unexpected call')};
 assert.equal((await createEngineWorkerPart({authorizeGrant:fn,fetchImpl:fn})(context)).status,503);
 const ctl=new AbortController();ctl.abort();
 assert.equal((await createEngineWorkerPart({enabled:true,authorizeGrant:fn,fetchImpl:fn})(context,{signal:ctl.signal})).status,503);
});
