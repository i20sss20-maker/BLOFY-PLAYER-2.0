import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdmission,readBoundedJson} from '../web-security-controls.mjs';
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
