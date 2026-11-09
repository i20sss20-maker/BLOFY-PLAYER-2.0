import test from 'node:test';
import assert from 'node:assert/strict';
import {createSharedStreamCoordinator} from '../src/restream-shared-lease.mjs';
const KEY='a'.repeat(64);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('100 synthetic readers share exactly one start and independently release',async()=>{
 let starts=0,stops=0;
 const shared=createSharedStreamCoordinator({start:async()=>{starts++;await delay(5);return {id:'publisher'};},
  stop:async()=>{stops++;},idleMs:8});
 const readers=await Promise.all(Array.from({length:100},()=>shared.acquire(KEY,{authorized:true})));
 assert.equal(starts,1);
 assert.equal(new Set(readers.map(x=>x.handle)).size,1);
 assert.equal(shared.snapshot().activeViewers,100);
 readers.slice(0,99).forEach(x=>x.release());
 assert.equal(shared.snapshot().activeViewers,1);
 await delay(30);assert.equal(stops,0);
 assert.equal(readers[99].release(),true);
 assert.equal(readers[99].release(),false);
 await delay(30);
 assert.equal(stops,1);
});
test('refuses unlicensed and invalid source identity',async()=>{
 let starts=0;const c=createSharedStreamCoordinator({start:()=>{starts++;return 1},stop:()=>{}});
 await assert.rejects(c.acquire(KEY),/not_authorized/);
 await assert.rejects(c.acquire('https:\/\/provider', {authorized:true}),/not_authorized/);
 assert.equal(starts,0);
});
test('one failed publisher does not leave stale ref counts',async()=>{
 let starts=0;const c=createSharedStreamCoordinator({start:async()=>{starts++;throw Error('source_down')},stop:()=>{}});
 const results=await Promise.allSettled([c.acquire(KEY,{authorized:true}),c.acquire(KEY,{authorized:true})]);
 assert.equal(results.filter(x=>x.status==='rejected').length,2);
 assert.equal(c.snapshot().activeViewers,0);
 assert.equal(starts,1);
});

test('stop failure quarantines source and prevents duplicate upstream connections',async()=>{
 let startCount=0,stopCount=0;
 const s=createSharedStreamCoordinator({start:async()=>{startCount++;return {x:1};},
  stop:async()=>{stopCount++;throw Error('unknown_stream_shutdown');},idleMs:4});
 const session=await s.acquire(KEY,{authorized:true});
 session.release();
 await delay(30);
 assert.equal(stopCount,1);
 assert.equal(s.snapshot().quarantined,1);
 await assert.rejects(s.acquire(KEY,{authorized:true}),/shared_stream_stop_failed/);
 assert.equal(startCount,1);
});
test('concurrent acquisition respects per-key capacity even before startup completes',async()=>{
 let starts=0;
 const s=createSharedStreamCoordinator({start:async()=>{starts++;await delay(5);return {x:1};},
  stop:async()=>{},maxViewersPerKey:2,idleMs:5});
 const a=s.acquire(KEY,{authorized:true}),b=s.acquire(KEY,{authorized:true});
 await assert.rejects(s.acquire(KEY,{authorized:true}),/shared_stream_viewer_limit/);
 const sessions=await Promise.all([a,b]);
 assert.equal(starts,1);
 sessions.forEach(x=>x.release());
});
