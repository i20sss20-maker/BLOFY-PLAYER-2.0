import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../media-worker.ts',import.meta.url),'utf8');
const start=source.indexOf('function touchHls(session){');
const end=source.indexOf('\nfunction stopHls(',start);
assert.ok(start>=0&&end>start,'hls timeout lifecycle is present');
const touchDefinition=source.slice(start,end);

function fakeClock(){
 const timers=new Map(),cleared=[];
 let seq=0,now=0;
 const context={
  Date:{now:()=>now},
  hardTTL:9*60*1000,
  setTimeout:function(fn,ms){const id=++seq;timers.set(id,{fn,ms});return {id,unref(){}}},
  clearTimeout:function(handle){const id=handle&&handle.id;if(id){timers.delete(id);cleared.push(id)}},
  stopHls:function(){throw Error('unexpected stop during touch')}
 };
 const touch=vm.runInNewContext(touchDefinition+';\ntouchHls',context);
 return {touch,timers,cleared,advance:function(ms){now+=ms},
  makeTimer:function(ms){const id=++seq;timers.set(id,{fn:()=>{},ms});return {id,unref(){}}}
 }
}

test('active live HLS refreshes the old nine-minute expiry on every playlist or segment request',()=>{
 const c=fakeClock(),session={legacyHls:true,fullVod:false};
 // startHls installs the initial guard AFTER calling touchHls once.
 c.touch(session);
 session.hardTimer=c.makeTimer(9*60*1000);
 const first=session.hardTimer,firstIdle=session.idleTimer;
 assert.equal(c.timers.get(first.id).ms,9*60*1000);
 assert.equal(c.timers.get(firstIdle.id).ms,110000);
 c.advance(8*60*1000);
 c.touch(session);
 assert.notEqual(session.hardTimer.id,first.id);
 assert.ok(c.cleared.includes(first.id));
 assert.ok(c.cleared.includes(firstIdle.id));
 assert.equal(c.timers.get(session.hardTimer.id).ms,9*60*1000);
 assert.equal(session.lastAccess,8*60*1000);
});

test('non-live VOD keeps separate long-lived hard timeout and twenty-five-minute idle TTL',()=>{
 const c=fakeClock(),manual={id:600,unref(){}},session={fullVod:true,legacyHls:false,hardTimer:manual};
 c.touch(session);
 assert.equal(session.hardTimer,manual);
 assert.equal(c.timers.get(session.idleTimer.id).ms,25*60*1000);
 assert.ok(!c.cleared.includes(manual.id))
});
