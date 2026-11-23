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


test('late stop of an old stream never deletes the replacement session with the same key',()=>{
 const begin=source.indexOf('function stopHls(session,reason){');
 const end=source.indexOf('\nconst nap=',begin);
 assert.ok(begin>=0&&end>begin);
 const map=new Map();
 const context={
  hlsSessions:map,active:1,
  clearTimeout(){},
  rmSync(){},
  console:{info(){}}
 };
 const stop=vm.runInNewContext(source.slice(begin,end)+';\nstopHls',context);
 const old={key:'account:channel',abort:{abort(){}},dir:'/fake-old'};
 const replacement={key:'account:channel',stopped:false};
 map.set(old.key,replacement);
 stop(old,'viewer_stopped');
 assert.equal(map.get(old.key),replacement);
 assert.equal(old.stopped,true);
 assert.equal(context.active,0);
});

test('cancelled upstream header fetch cannot start FFmpeg after a viewer stops watching',async()=>{
 const begin=source.indexOf('async function startHls({');
 const end=source.indexOf('\nasync function hlsRequest(',begin);
 assert.ok(begin>=0&&end>begin);
 let resolveFetch,spawnCount=0,bodyCancelled=false;
 const map=new Map();
 const context={
  MAX_JOBS:2,active:0,hlsSessions:map,hlsRoot:'/fake',hardTTL:540000,
  BASE:'https://example.invalid/source/',
  join:(...args)=>args.join('/'),
  mkdirSync(){},touchHls(){},clearTimeout(){},
  setTimeout(){return{unref(){}}},
  AbortController,
  fetch:async()=>new Promise(resolve=>{resolveFetch=resolve}),
  stopHls(session){session.stopped=true;session.abort.abort();if(map.get(session.key)===session)map.delete(session.key)},
  Bun:{spawn(){spawnCount++;throw Error('decoder must not start')}},
 };
 const startHls=vm.runInNewContext(source.slice(begin,end)+';\nstartHls',context);
 const task=startHls({bearer:'test',kind:'live',id:'12',ext:'ts',track:0,key:'test-key'});
 await Promise.resolve();
 const old=map.get('test-key');
 assert.ok(old);
 old.stopped=true;old.abort.abort();
 map.delete('test-key');
 assert.equal(typeof resolveFetch,'function');
 resolveFetch({ok:true,body:{cancel:async()=>{bodyCancelled=true}}});
 const result=await task;
 assert.equal(result.status,409);
 assert.equal(spawnCount,0);
 assert.equal(bodyCancelled,true);
});


test('HD fallback keeps source dimensions without upscaling and has a bounded bitrate',()=>{
 const begin=source.indexOf('function videoQualityProfile(kind){');
 const end=source.indexOf('\nconst hlsSessions=',begin);
 assert.ok(begin>=0&&end>begin,'HD profile helper is part of the worker');
 const code=source.slice(begin,end);
 const fakeEnv={};
 const funcs=vm.runInNewContext(code+';\n({videoQualityProfile,compatibleVideoArgs})',
  {Bun:{env:fakeEnv}});
 const hd=funcs.videoQualityProfile('live');
 assert.equal(hd.name,'720');
 const args=funcs.compatibleVideoArgs('live');
 const vf=args[args.indexOf('-vf')+1];
 assert.match(vf,/min\(iw,1280\)/);
 assert.match(vf,/min\(ih,720\)/);
 assert.ok(!vf.includes('fps=25'),'do not distort source frame rate');
 assert.equal(args[args.indexOf('-maxrate')+1],'3400k');
 assert.ok(!args.join(' ').includes('900k'));
 fakeEnv.VIDAA_LIVE_VIDEO_PROFILE='1080';
 const full=funcs.compatibleVideoArgs('live');
 assert.match(full[full.indexOf('-vf')+1],/min\(ih,1080\)/);
 assert.equal(full[full.indexOf('-maxrate')+1],'5800k');
 fakeEnv.VIDAA_LIVE_VIDEO_PROFILE='invalid';
 assert.equal(funcs.videoQualityProfile('live').name,'720');
 fakeEnv.VIDAA_VOD_VIDEO_PROFILE='480';
 assert.equal(funcs.videoQualityProfile('movie').name,'480');
});


test('source-preserving live H264 TS probe keeps ALL incoming bytes and chooses copy',async()=>{
 const begin=source.indexOf('async function selectSourcePreservingInput(');
 const end=source.indexOf('\nasync function startHls(',begin);
 const parse=source.indexOf('function tsCodecs(buffer){');
 const parseEnd=source.indexOf('\nfunction hlsSelfTest(',parse);
 assert.ok(begin>0&&end>begin&&parse>0&&parseEnd>parse);
 const sandbox={ReadableStream,Uint8Array};
 const select=vm.runInNewContext(source.slice(parse,parseEnd)+'\n'+source.slice(begin,end)+
  '\nselectSourcePreservingInput',sandbox);
 const makePacket=(pid,table)=>{
  const bytes=new Uint8Array(188).fill(255);
  bytes[0]=0x47;bytes[1]=0x40|((pid>>8)&31);bytes[2]=pid&255;bytes[3]=0x10;
  bytes[4]=0;bytes.set(table,5);return bytes
 };
 function sourceBytes(codec){
  const pat=makePacket(0,new Uint8Array([0,0xb0,13,0,1,0xc1,0,0,0,1,0xe1,0,0,0,0,0]));
  const pmt=makePacket(256,new Uint8Array([
   2,0xb0,23,0,1,0xc1,0,0,0xe1,1,0xf0,0,
   codec,0xe1,1,0xf0,0,0x0f,0xe1,2,0xf0,0,
   0,0,0,0
  ]));
  const packets=[pat,pmt,new Uint8Array(188).fill(0)];
  packets[2][0]=0x47;packets[2][1]=0x01;packets[2][2]=0x01;packets[2][3]=0x10;
  const bytes=new Uint8Array(packets.reduce((a,x)=>a+x.byteLength,0));
  let o=0;for(const p of packets){bytes.set(p,o);o+=p.length}
  return bytes
 }
 async function run(codec){
  const bytes=sourceBytes(codec);
  const src=new ReadableStream({start(ctrl){
   ctrl.enqueue(bytes.slice(0,188));
   ctrl.enqueue(bytes.slice(188,376));
   ctrl.enqueue(bytes.slice(376));
   ctrl.close()
  }});
  const result=await select(src,true);
  const reader=result.input.getReader(),segments=[];
  for(;;){const item=await reader.read();if(item.done)break;segments.push(item.value)}
  const actual=new Uint8Array(segments.reduce((a,x)=>a+x.length,0));
  let at=0;for(const part of segments){actual.set(part,at);at+=part.length}
  assert.deepEqual(Array.from(actual),Array.from(bytes),'TS sniff must never discard or reorder source data');
  return result
 }
 const h264=await run(0x1b);
 assert.equal(h264.copyVideo,true,'H264 from PMT should use original quality without re-encoding');
 assert.equal(h264.detected,'h264_transport');
 const hevc=await run(0x24);
 assert.equal(hevc.copyVideo,false,'HEVC must keep compatibility fallback on unsupported browsers');
 assert.equal(hevc.detected,'needs_transcode');
 const raw=await select(new ReadableStream({start(c){c.enqueue(new Uint8Array([1,2,3]));c.close()}}),false);
 assert.equal(raw.copyVideo,false)
});
