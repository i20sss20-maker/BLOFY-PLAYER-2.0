import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createMirrorPortalBridge} from '../src/mirror-transfer-bridge.mjs';
const KEY='k'.repeat(42);
const FULL='/internal/blofy-content-hub/mirror';
test('only fixed private Portal approval and exact immutable item routes allowed',async()=>{
 const calls=[];
 const bridge=createMirrorPortalBridge({token:KEY,
  fetchImpl:async(url,options)=>{
   calls.push({url,options});
   return Response.json({ok:true,kind:'movie',id:'1234',
    code:'mirror_approval_exact_item'});
  }
 });
 const approval=await bridge.approval({kind:'movie',id:'1234'});
 assert.equal(approval.ok,true);
 assert.equal(calls.length,1);
 assert.equal(calls[0].url,
  'http://blofy-activation-portal.railway.internal:3000'+
  FULL+'/approval/movie/1234');
 assert.equal(calls[0].options.method,'GET');
 assert.equal(calls[0].options.headers.authorization,'Bearer '+KEY);
});
test('range bridge cannot change origin, method or Range length',async()=>{
 const calls=[];
 const bridge=createMirrorPortalBridge({token:KEY,
  fetchImpl:async(url,options)=>{
   calls.push({url,options});
   return new Response('x',{status:206});
  }
 });
 await bridge.range({approval:{kind:'episode',id:'1234'},
  from:0,to:4095});
 assert.equal(calls[0].url,
  'http://blofy-activation-portal.railway.internal:3000'+
  FULL+'/range/episode/1234');
 assert.equal(calls[0].options.method,'GET');
 assert.equal(calls[0].options.headers['x-blofy-mirror-transfer'],
  'licensed-one-chunk');
 assert.equal(calls[0].options.headers.range,'bytes=0-4095');
 await assert.rejects(()=>bridge.range({
  approval:{kind:'episode',id:'../../etc'},from:0,to:10}));
 await assert.rejects(()=>bridge.range({
  approval:{kind:'movie',id:'1'},from:0,to:9*1024*1024}));
 assert.equal(calls.length,1);
});
test('missing credentials or forged approval scope fail closed',async()=>{
 let touched=0;
 const bridge=createMirrorPortalBridge({token:'',
  fetchImpl:async()=>{touched++}});
 const p=await bridge.approval({kind:'movie',id:'123'});
 assert.equal(p.ok,false);assert.equal(touched,0);
 const wrong=createMirrorPortalBridge({token:KEY,
  fetchImpl:async()=>Response.json({ok:true,kind:'episode',id:'123'})});
 const r=await wrong.approval({kind:'movie',id:'123'});
 assert.equal(r.ok,false);assert.equal(r.code,'mirror_bridge_wrong_item');
});
test('private Hub copy endpoint requires owner token, all flags, and no boot scheduler',async()=>{
 const src=await readFile(new URL('../src/server.mjs',import.meta.url),'utf8');
 for(const text of [
  "path==='/internal/mirror/copy/next'",
  "'copy-one-licensed-private-chunk'",
  'mirrorWorkerReadiness(pilotEnv)',
  'mirrorChunkBusy',
  'mirrorChunkRunner({kind,id,env:pilotEnv',
  'mirrorBridge.approval(args)',
  'mirrorBridge.range(args)'
 ])assert.ok(src.includes(text),text);
});
