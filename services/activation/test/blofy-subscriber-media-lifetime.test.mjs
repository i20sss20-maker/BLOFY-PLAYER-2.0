import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Writable} from 'node:stream';
import {withSubscriberMediaLifetime,pipeSubscriberMedia,readBoundedSubscriberManifest} from '../src/blofy-subscriber-media-lifetime.mjs';

test('client close aborts outstanding upstream work and removes listeners',async()=>{
 const req=new EventEmitter(),res=new EventEmitter();
 let observed;
 const task=withSubscriberMediaLifetime(req,res,async signal=>{
  observed=signal;
  await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));
 });
 res.emit('close');
 await task;
 assert.equal(observed.aborted,true);
 assert.equal(req.listenerCount('aborted'),0);
 assert.equal(res.listenerCount('close'),0);
});
test('abandoned request does not start an upstream connection',async()=>{
 const req=new EventEmitter(),res=new EventEmitter();req.aborted=true;
 let calls=0;
 await withSubscriberMediaLifetime(req,res,()=>{calls++});
 assert.equal(calls,0);
 assert.equal(req.listenerCount('aborted'),0);
});
test('stream cancellation propagates to upstream reader',async()=>{
 let cancelled=false;
 const source=new ReadableStream({pull(){return new Promise(()=>{})},cancel(){cancelled=true}});
 const sink=new Writable({write(c,e,cb){cb()}});
 const ctl=new AbortController();
 const task=pipeSubscriberMedia(source,sink,{signal:ctl.signal});
 ctl.abort();
 await assert.rejects(task,{name:'AbortError'});
 assert.equal(cancelled,true);
});
test('manifest reader bounds body and releases reader on rejection',async()=>{
 const body=new Response('abcdef').body;
 await assert.rejects(readBoundedSubscriberManifest(body,4),/subscriber_manifest_too_large/);
 assert.equal(body.locked,false);
 assert.equal(await readBoundedSubscriberManifest(new Response('#EXTM3U\n').body),'#EXTM3U\n');
});
