import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../media-worker.ts',import.meta.url),'utf8');
const chunk=source.slice(source.indexOf('function fullVodChunk('),source.indexOf('async function fullVodRequest('));
const handler=source.slice(source.indexOf('async function fullVodRequest('),source.indexOf('/* Validate full-VOD seek'));
const stopSource=source.slice(source.indexOf('function stopHls('),source.indexOf('\nconst nap=',source.indexOf('function stopHls(')));
const stopKey='owned-key';
function url(index){
 return new URL('http://worker/vodfull/movie/11/mp4/0/3600/seg-'+String(index).padStart(6,'0')+'.ts?sid='+'a'.repeat(32))
}
const bearer='Bearer v1.00000000-0000-0000-0000-000000000000.'+'A'.repeat(43);
function request(){
 return {method:'GET',headers:{get(k){return k==='x-compat-secret'?'f'.repeat(64):k==='authorization'?bearer:null}},
  signal:{aborted:false}}
}

test('fullVodChunk refuses to release a CPU slot until the previous FFmpeg exited',()=>{
 const fake={finished:false,chunkStart:0,released:false,proc:{kill(){throw Error('must not kill prematurely')}}};
 const fn=vm.runInNewContext(chunk+';fullVodChunk',{active:1,MAX_JOBS:2});
 const r=fn(fake,24);
 assert.equal(r.status,503);
 assert.equal(r.error,'vod_previous_chunk_draining');
 assert.equal(fake.released,false,'the old FFmpeg still holds its transcoding slot');
 assert.equal(fake.chunkStart,0,'do not change session before real process exit');
});

test('distant-seek request kills old FFmpeg once, waits for exit, and only then starts new chunk',async()=>{
 let time=1000,active=1,oldStops=0,newStarts=0,seenActive=[];
 let firstRequestFinished=false,segmentAvailable=false;
 const oldProc={kill(){oldStops++},exited:Promise.resolve()};
 const session={fullVod:true,kind:'movie',id:'11',ext:'mp4',duration:3600,
  dir:'/synthetic',proc:oldProc,chunkStart:0,finished:false,released:false,
  chunkFinishedAt:0,stopped:false};
 const sessions=new Map([[stopKey,session]]);
 const FakeDate={now:()=>time};
 const context={
  SECRET:'f'.repeat(64),secureEquals:()=>true,MAX_JOBS:2,
  Bun:{},hlsSessions:sessions,URL,Response,Date:FakeDate,
  FULL_SEGMENT_SECONDS:4,FULL_CHUNK_SEGMENTS:6,
  hlsRoot:'/synthetic',vodKey:()=>stopKey,
  mkdirSync(){},touchHls(){},Math,Number,
  join:(...parts)=>parts.join('/'),json:(code,body)=>({status:code,body}),
  hlsError:(code,error)=>({status:code,error}),
  existsSync:()=>segmentAvailable,
  nap:async ms=>{
   time+=ms;
   // Mock actual confirmed exit on the *first* process once kill began.
   if(oldStops&&session.proc===oldProc&&!session.finished){
    session.finished=true;session.released=true;active=0;firstRequestFinished=true
   }
   await Promise.resolve()
  },
  fullVodChunk:(s,first)=>{
   seenActive.push(active);
   assert.equal(firstRequestFinished,true,'new FFmpeg cannot spawn until old exits');
   assert.equal(active,0,'old slot is still reserved before confirmed exit');
   active++;newStarts++;s.finished=false;s.released=false;s.chunkStart=first;
   s.proc={kill(){}};segmentAvailable=true;
   return {ok:true}
  },
  streamMediaFile:async()=>new Response('file',{status:200}),
  get active(){return active}
 };
 const respond=vm.runInNewContext(handler+';fullVodRequest',context);
 const results=await Promise.all([respond(request(),url(24)),respond(request(),url(25))]);
 assert.deepEqual(results.map(r=>r.status),[200,200]);
 assert.equal(oldStops,1,'simultaneous segment requests must not repeatedly kill source');
 assert.equal(newStarts,1,'at most one new transcoder per destination chunk');
 assert.deepEqual(seenActive,[0]);
 assert.equal(session.chunkStart,24);
 assert.equal(active,1)
});

test('sequential adjacent chunk never kills a still-encoding FFmpeg',async()=>{
 let time=1000,kills=0,starts=0,available=false,waits=0;
 const proc={kill(){kills++}};
 const session={proc,chunkStart:0,finished:false,released:false,dir:'/synthetic',duration:3600,
  fullVod:true,kind:'movie',stopped:false,chunkFinishedAt:0};
 const ctx={
  SECRET:'f'.repeat(64),secureEquals:()=>true,
  hlsSessions:new Map([[stopKey,session]]),vodKey:()=>stopKey,
  hlsRoot:'/synthetic',FULL_SEGMENT_SECONDS:4,FULL_CHUNK_SEGMENTS:6,MAX_JOBS:2,active:1,
  Date:{now:()=>time},Math,Number,URL,Response,
  mkdirSync(){},touchHls(){},join:(...x)=>x.join('/'),
  json:(code,body)=>({status:code,body}),hlsError:(code,error)=>({status:code,error}),
  existsSync:()=>available,
  nap:async(ms)=>{
   time+=ms;waits++;
   if(waits===3){session.finished=true;session.released=true}
  },
  fullVodChunk:(s,first)=>{
   starts++;assert.equal(first,6);assert.equal(s.finished,true);
   s.chunkStart=6;s.finished=false;s.released=false;available=true;return {ok:true}
  },
  streamMediaFile:async()=>new Response('chunk',{status:200})
 };
 const respond=vm.runInNewContext(handler+';fullVodRequest',ctx);
 const result=await respond(request(),url(6));
 assert.equal(result.status,200);
 assert.equal(kills,0,'forward prefetch should wait for current chunk to finish naturally');
 assert.equal(starts,1)
});

test('live channel STOP also reserves its slot and directory until FFmpeg actually exits',async()=>{
 const map=new Map(),files=[],calls={kill:0,abort:0};
 let resolveExit;
 const exited=new Promise(resolve=>{resolveExit=resolve});
 const session={key:'channel-owned',kind:'live',released:false,finished:false,stopped:false,
  proc:{kill(){calls.kill++},exited},dir:'/tmp/synthetic-channel-1',
  abort:{abort(){calls.abort++}},sourceController:{abort(){calls.abort++}}};
 map.set(session.key,session);
 const ctx={
  hlsSessions:map,active:1,clearTimeout(){},setTimeout(){return {unref(){}}},
  rmSync(path){files.push(path)},recordLiveSourceFailure(){},console:{info(){}}
 };
 const stop=vm.runInNewContext(stopSource+';stopHls',ctx);
 stop(session,'viewer_stopped');
 assert.equal(ctx.active,1,'decoder still exits after HTTP STOP');
 assert.equal(files.length,0,'do not delete playlist while encoder is still writing');
 assert.equal(calls.kill,1);assert.equal(calls.abort,2);
 assert.equal(map.has(session.key),false,'viewer cannot reuse stopped session');
 resolveExit(0);
 await Promise.resolve();await Promise.resolve();await Promise.resolve();
 assert.equal(ctx.active,0);
 assert.deepEqual(files,['/tmp/synthetic-channel-1']);
});

test('viewer STOP retains the full-VOD slot while killed FFmpeg is still exiting',async()=>{
 const map=new Map(),dir='/synthetic/media',calls={kill:0,release:0};
 let resolveExit;
 const exited=new Promise(done=>resolveExit=done);
 const proc={kill(){calls.kill++},exited};
 const session={key:stopKey,fullVod:true,kind:'movie',stopped:false,finished:false,released:false,
  proc,dir,abort:{abort(){}},sourceController:{abort(){}}};
 map.set(stopKey,session);
 const ctx={
  hlsSessions:map,active:1,clearTimeout(){},setTimeout(fn){return {unref(){}}},
  rmSync(){},recordLiveSourceFailure(){},console:{info(){}}
 };
 const stop=vm.runInNewContext(stopSource+';stopHls',ctx);
 stop(session,'viewer_stopped');
 assert.equal(calls.kill,1);
 assert.equal(ctx.active,1,'CPU slot remains reserved after SIGTERM until actual process exit');
 assert.equal(session.stopped,true);
 assert.equal(map.has(stopKey),false,'ended viewer loses ownership instantly');
 resolveExit(0);
 await Promise.resolve();await Promise.resolve();await Promise.resolve();
 assert.equal(ctx.active,0,'actual exit releases capacity once');
 assert.equal(session.released,true);
 stop(session,'duplicate_stop');
 assert.equal(ctx.active,0,'duplicate STOP never decrements a second time');
});
