import test from 'node:test';
import assert from 'node:assert/strict';
import {createCatalogFlights} from '../catalog-flights.mjs';
import {createAdmission} from '../web-security-controls.mjs';
test('synthetic burst: 1000 catalog requests remain within 12 in-flight loads and 8 waiters per key',async()=>{
 const flights=createCatalogFlights({maxFlights:12,maxWaiters:8,timeoutMs:10000});
 const finish=[];let calls=0;
 const loader=()=>{calls++;return new Promise(r=>finish.push(r))};
 const requests=Array.from({length:1000},(_,i)=>flights.run('opaque-'+(i%100),loader));
 await Promise.resolve();assert.equal(calls,12);
 assert.equal(flights.snapshot().active,12);
 for(const f of finish)f({status:200,payload:{synthetic:true}});
 const replies=await Promise.all(requests);
 assert.equal(replies.filter(r=>r.status===200).length,96);
 assert.equal(replies.filter(r=>r.status===429).length,904);
 assert.equal(flights.snapshot().active,0);
 assert.equal((await flights.run('new-account',()=>({status:200}))).status,200);
});
test('synthetic burst: admission rejects excess work, releases capacity and isolates accounts',()=>{
 const gate=createAdmission({maxKeys:2048,maxInflight:24,limit:8});
 const leases=Array.from({length:1000},(_,i)=>gate.acquire('opaque-'+i));
 assert.equal(leases.filter(x=>x.ok).length,24);
 assert.equal(gate.snapshot().inflight,24);
 leases.filter(x=>x.ok).forEach(x=>x.release());
 assert.equal(gate.snapshot().inflight,0);
 const next=gate.acquire('fresh');assert.ok(next.ok);next.release();
});
