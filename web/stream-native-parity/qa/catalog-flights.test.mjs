import test from 'node:test';
import assert from 'node:assert/strict';
import {createCatalogFlights} from '../catalog-flights.mjs';
test('same account/page coalesces and different accounts do not',async()=>{
 const f=createCatalogFlights();let calls=0,done;
 const loader=()=>{calls++;return new Promise(r=>done=r)};
 const a=f.run('account-a/page',loader),b=f.run('account-a/page',loader);
 const c=f.run('account-b/page',()=>({status:200,other:true}));
 await Promise.resolve();assert.equal(calls,1);done({status:200,items:[1]});
 assert.deepEqual(await a,await b);assert.equal((await c).other,true);assert.equal(f.snapshot().joined,1);
});
test('one cancelled waiter cannot abort another; last cancellation releases slot',async()=>{
 const f=createCatalogFlights({maxFlights:1});const a=new AbortController(),b=new AbortController();let source,done;
 const loader=s=>{source=s;return new Promise(r=>done=r)};
 const first=f.run('a',loader,a.signal),second=f.run('a',loader,b.signal);
 await Promise.resolve();a.abort();assert.equal((await first).status,499);assert.equal(source.aborted,false);
 assert.equal((await f.run('b',loader)).status,429);b.abort();assert.equal((await second).status,499);assert.equal(source.aborted,true);done({status:200});
 assert.equal((await f.run('b',()=>({status:200}))).status,200);
});
test('bounded waiters and deadline release resources even if loader hangs',async()=>{
 const f=createCatalogFlights({maxWaiters:1,timeoutMs:10});let source;
 const a=f.run('a',s=>{source=s;return new Promise(()=>{})});
 assert.equal((await f.run('a',()=>{})).status,429);assert.equal((await a).status,504);assert.equal(source.aborted,true);assert.equal(f.snapshot().active,0);
});
