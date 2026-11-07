import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createXtreamSyncQueue} from '../src/xtream-sync-queue.mjs';

const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve()};

test('large catalog sources run one at a time and in FIFO order',async()=>{
  const queue=createXtreamSyncQueue({concurrency:1,maxPending:5});
  const events=[];
  let finishFirst;
  const first=new Promise(resolve=>finishFirst=resolve);
  assert.deepEqual(queue.enqueue('A',async()=>{events.push('start-A');await first;events.push('end-A')}),{queued:false,position:0});
  assert.deepEqual(queue.enqueue('B',async()=>{events.push('start-B');events.push('end-B')}),{queued:true,position:1});
  assert.deepEqual(queue.enqueue('C',async()=>{events.push('start-C')}),{queued:true,position:2});
  await flush();
  assert.deepEqual(events,['start-A']);
  assert.equal(queue.activeCount(),1);
  assert.equal(queue.waitingCount(),2);
  finishFirst();
  await flush();
  await flush();
  assert.deepEqual(events,['start-A','end-A','start-B','end-B','start-C']);
  assert.equal(queue.activeCount(),0);
  assert.equal(queue.waitingCount(),0);
  assert.equal(queue.has('A'),false);
});

test('queued source can be cancelled safely while another import runs',async()=>{
  const queue=createXtreamSyncQueue({concurrency:1});
  let release;
  const blocked=new Promise(resolve=>release=resolve);
  let ranB=false;
  queue.enqueue('A',()=>blocked);
  queue.enqueue('B',()=>{ranB=true});
  assert.equal(queue.isQueued('B'),true);
  assert.equal(queue.cancel('B'),true);
  assert.equal(queue.cancel('B'),false);
  assert.equal(queue.has('B'),false);
  release();
  await flush();
  await flush();
  assert.equal(ranB,false);
  assert.equal(queue.activeCount(),0);
});

test('duplicate source and oversubscribed queue are rejected',async()=>{
  const queue=createXtreamSyncQueue({concurrency:1,maxPending:1});
  let release;const blocked=new Promise(resolve=>release=resolve);
  queue.enqueue('A',()=>blocked);
  queue.enqueue('B',async()=>{});
  assert.throws(()=>queue.enqueue('A',async()=>{}),/xtream_sync_in_progress/);
  assert.throws(()=>queue.enqueue('C',async()=>{}),/xtream_sync_queue_full/);
  release();
  await flush();
  await flush();
});

test('a failed import does not block the next source and is reported once',async()=>{
  const errors=[],events=[];
  const queue=createXtreamSyncQueue({onError:(id,error)=>errors.push([id,error.message])});
  queue.enqueue('A',async()=>{throw new Error('xtream_transport_connection_reset')});
  queue.enqueue('B',async()=>events.push('B'));
  await flush();await flush();
  assert.deepEqual(errors,[['A','xtream_transport_connection_reset']]);
  assert.deepEqual(events,['B']);
  assert.equal(queue.activeCount(),0);
});

test('closed queue removes pending sources and refuses new work',async()=>{
  let release;const blocked=new Promise(resolve=>release=resolve);
  const queue=createXtreamSyncQueue();
  queue.enqueue('A',()=>blocked);
  queue.enqueue('B',async()=>{throw new Error('never reached')});
  queue.close();
  assert.equal(queue.isQueued('B'),false);
  assert.equal(queue.has('B'),false);
  assert.throws(()=>queue.enqueue('C',async()=>{}),/xtream_sync_queue_closed/);
  release();
  await flush();
});

test('production routes serialize manual and sync-all, support cancellation and state',async()=>{
  const server=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
  const ui=await readFile(new URL('../web/sources-admin.js',import.meta.url),'utf8');
  assert.match(server,/const syncQueue=createXtreamSyncQueue\(/);
  assert.match(server,/concurrency:1,maxPending:16/);
  assert.match(server,/syncQueue\.enqueue\(id,\(\)=>syncServer\(id,types\)\)/);
  assert.match(server,/const wasQueued=syncQueue\.cancel\(id\)/);
  assert.match(server,/syncQueue\.cancel\(id\)/);
  assert.match(server,/queued:syncQueue\.isQueued\(row\.id\)/);
  assert.match(server,/if\(cancelledSources\.has\(id\)\)throw Object\.assign\(new Error\('xtream_sync_cancelled'\)/);
  assert.match(server,/return json\(res, 202, \{ started,queued,skipped \}\)/);
  assert.match(ui,/item\.queued\?'في انتظار المزامنة'/);
  assert.match(ui,/بانتظار انتهاء مزامنة مصدر آخر/);
});


test('pausing and deleting a source cancels pending imports without touching subscriptions',async()=>{
  const server=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
  const pause=server.slice(server.indexOf('async function patchServer('),server.indexOf('async function listCategories('));
  const remove=server.slice(server.indexOf('async function requestDeleteSource('),server.indexOf('async function checkedFetch('));
  assert.match(pause,/syncQueue\.cancel\(id\)/);
  assert.match(remove,/syncQueue\.cancel\(id\)/);
  const cancel=server.slice(server.indexOf('async function cancelSourceSync('),server.indexOf('function startSync('));
  assert.match(cancel,/const wasQueued=syncQueue\.cancel\(id\)/);
  assert.match(cancel,/staleStateCleared:clearStale/);
  assert.doesNotMatch(cancel,/DELETE FROM|TRUNCATE|password/);
});

test('queue badges and separated active/waiting counts appear on the operator dashboard',async()=>{
  const html=await readFile(new URL('../web/sources-admin.html',import.meta.url),'utf8');
  const premium=await readFile(new URL('../web/stream-premium.js',import.meta.url),'utf8');
  const source=await readFile(new URL('../web/sources-admin.js',import.meta.url),'utf8');
  assert.match(html,/id="premiumQueuedCount"/);
  assert.match(premium,/elementText\('premiumQueuedCount'/);
  assert.match(premium,/queued:Boolean\(s\.queued\)/);
  assert.match(source,/queued:Boolean\(item\.queued\)/);
  assert.match(source,/data\.queued\?\.length/);
});
