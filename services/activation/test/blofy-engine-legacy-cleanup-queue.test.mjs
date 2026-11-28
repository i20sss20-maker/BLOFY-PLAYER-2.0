import test from 'node:test';
import assert from 'node:assert/strict';
import {createGatewayHoldLifetime,createLegacyCleanupQueue} from '../src/blofy-engine-legacy-ingress.mjs';
const make=options=>createLegacyCleanupQueue({intervalMs:60000,...options});
test('HTTP shutdown waits for an admitted request and its database close retry',async()=>{
 const lifetime=createGatewayHoldLifetime();
 const finish=lifetime.begin();
 const queue=make({attempt:op=>op()});
 lifetime.register(queue);
 let calls=0;
 try{
  const receipt=lifetime.drain(3000);
  assert.equal(lifetime.begin(),null);
  assert.equal(await queue.submit('ending',async()=>++calls===2),false);
  finish();
  assert.deepEqual(await receipt,{complete:true,active:0,pending:0,overflow:0});
  assert.equal(calls,2);
 }finally{queue.stop()}
});
test('a timeout does not settle a live hold or authorize another admission',async()=>{
 const lifetime=createGatewayHoldLifetime(),finish=lifetime.begin();
 assert.deepEqual(await lifetime.drain(0),{complete:false,active:1,pending:0,overflow:0});
 assert.equal(lifetime.begin(),null);
 finish();
});
test('explicit failed close is retried without releasing any other hold',async()=>{
 let calls=0;
 const q=make({attempt:op=>op()});
 try{
  assert.equal(await q.submit('closed-id',async()=>++calls>=2),false);
  assert.equal(q.pendingCount(),1);
  await q.flush();
  assert.equal(q.pendingCount(),0);
  assert.equal(calls,2);
 }finally{q.stop()}
});
test('retry rotates failing operations and keeps a bounded queue',async()=>{
 const q=make({maxPending:2,batchSize:1,attempt:op=>op()});
 let second=0;
 try{
  await q.submit('first',async()=>false);
  await q.submit('second',async()=>++second>=2);
  await q.submit('third',async()=>false);
  assert.equal(q.pendingCount(),2);
  await q.flush();
  assert.equal(second,1);
  await q.flush();
  assert.equal(second,2);
  assert.equal(q.pendingCount(),1);
 }finally{q.stop()}
});
test('concurrent submits of the same cleanup share a single attempt',async()=>{
 let calls=0,finish;
 const gate=new Promise(r=>finish=r);
 const q=make({attempt:op=>op()});
 try{
  const a=q.submit('id',async()=>{calls++;return gate});
  const b=q.submit('id',async()=>{calls++;return true});
  finish(true);
  assert.deepEqual(await Promise.all([a,b]),[true,true]);
  assert.equal(calls,1);
  assert.equal(q.pendingCount(),0);
 }finally{q.stop()}
});
