import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';

const source=readFileSync(new URL('../media-worker.ts',import.meta.url),'utf8');
const playerSource=readFileSync(new URL('../app.js',import.meta.url),'utf8');

test('frozen VIDEO at readyState=4 is detected from real pixel/playhead progress',()=>{
 const start=playerSource.indexOf('function livePlaybackProgress(');
 const end=playerSource.indexOf('\nfunction playHls(',start);
 assert.ok(start>0&&end>start,'live progress watchdog helper is present');
 const sample=vm.runInNewContext(playerSource.slice(start,end)+';\nlivePlaybackProgress',{});
 const rec={started:1000,lastProgressAt:1000,lastMediaTime:61,lastVideoFrames:500,bufferSince:2000,stallChecks:2};
 const video={readyState:4,currentTime:61,getVideoPlaybackQuality:()=>({totalVideoFrames:500})};
 assert.equal(sample(rec,video,20000).advanced,false);
 assert.equal(sample(rec,video,20000).idleMs,19000,'readyState=4 does not conceal a frozen frame');
 video.currentTime=62;
 assert.equal(sample(rec,video,21000).advanced,false,'an audio clock without new picture is still frozen');
 video.getVideoPlaybackQuality=()=>({totalVideoFrames:501});
 assert.equal(sample(rec,video,22000).advanced,true,'actual decoded frame advancement restores playback');
 assert.equal(rec.bufferSince,0);
 assert.equal(rec.stallChecks,0);
 video.getVideoPlaybackQuality=()=>({totalVideoFrames:502});
 assert.equal(sample(rec,video,23200).advanced,true,'decoded frames also count if TV playhead is imprecise');
 video.currentTime=80;
 video.getVideoPlaybackQuality=()=>({totalVideoFrames:502});
 assert.equal(sample(rec,video,43000).advanced,false,'audio clock must not hide frozen picture');
 assert.ok(sample(rec,video,43000).idleMs>=19000,'watchdog may recover video even when audio continues');
 video.getVideoPlaybackQuality=()=>({totalVideoFrames:505});
 assert.equal(sample(rec,video,45100).advanced,true,'visual progress resets the freeze timer');
});

test('worker identifies stale live manifests but never expires VOD or healthy live files',()=>{
 const begin=source.indexOf('function staleLiveManifest(');
 const end=source.indexOf('\n/**',begin);
 assert.ok(begin>0&&end>begin);
 let mtime=1000;
 const isStale=vm.runInNewContext(source.slice(begin,end)+';\nstaleLiveManifest',{
  statSync:()=>({mtimeMs:mtime}),Number
 });
 const live={kind:'live',startedAt:1000,stopped:false};
 assert.equal(isStale(live,'/live/index.m3u8',25000),true,'source stopped updating for 24s');
 assert.equal(isStale(live,'/live/index.m3u8',12000),false);
 assert.equal(isStale({...live,kind:'movie'},'/vod/index.m3u8',25000),false);
 assert.equal(isStale({...live,stopped:true},'/live/index.m3u8',25000),false);
 mtime=22000;
 assert.equal(isStale(live,'/live/index.m3u8',25000),false,'playlist still advancing');
});

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
 const map=new Map(),removed=[];
 const context={
  hlsSessions:map,active:1,
  clearTimeout(){},
  rmSync(path){removed.push(path)},
  console:{info(){}}
 };
 const stop=vm.runInNewContext(source.slice(begin,end)+';\nstopHls',context);
 const old={key:'account:channel',abort:{abort(){}},dir:'/old-unique-session'};
 const replacement={key:'account:channel',stopped:false,dir:'/new-unique-session'};
 map.set(old.key,replacement);
 stop(old,'viewer_stopped');
 assert.equal(map.get(old.key),replacement);
 assert.equal(old.stopped,true);
 assert.equal(context.active,0);
 assert.deepEqual(removed,['/old-unique-session'],'late cleanup removes only old decoder directory, not replacement');
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
  randomBytes:()=>Buffer.from('00bb22cc44dd','hex'),
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
 const begin=source.indexOf('function videoQualityProfile(');
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
 assert.equal(full[full.indexOf('-maxrate')+1],'8500k');
 const uhd=funcs.compatibleVideoArgs('live',1,'2160');
 assert.match(uhd[uhd.indexOf('-vf')+1],/min\(iw,3840\)/);
 assert.match(uhd[uhd.indexOf('-vf')+1],/min\(ih,2160\)/);
 assert.equal(uhd[uhd.indexOf('-maxrate')+1],'20000k');
 assert.equal(uhd[uhd.indexOf('-level')+1],'5.2');
 assert.ok(!uhd[uhd.indexOf('-vf')+1].includes('scale=3840:2160'),'do not enlarge SD sources to 4K');
 fakeEnv.VIDAA_LIVE_VIDEO_PROFILE='invalid';
 assert.equal(funcs.videoQualityProfile('live').name,'720');
 assert.equal(funcs.videoQualityProfile('movie').name,'1080');
 assert.equal(funcs.videoQualityProfile('series').name,'1080');
 const vod=funcs.compatibleVideoArgs('movie');
 assert.match(vod[vod.indexOf('-vf')+1],/min\(ih,1080\)/);
 assert.equal(vod[vod.indexOf('-crf')+1],'18');
 assert.equal(vod[vod.indexOf('-preset')+1],'veryfast');
 assert.equal(vod[vod.indexOf('-tune')+1],'film');
 assert.equal(args[args.indexOf('-tune')+1],'zerolatency');
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


test('source H264 and forced VIDAA compatibility HLS use isolated subscriber session keys',()=>{
 const begin=source.indexOf('function hlsKey(');
 const end=source.indexOf('\nfunction touchHls(',begin);
 assert.ok(begin>0&&end>begin);
 const {createHmac}=crypto;
 const key=vm.runInNewContext(source.slice(begin,end)+';\nhlsKey',
  {createHmac,SECRET:'a'.repeat(64)});
 const original=key('Bearer customer-A','live','31','ts','0');
 const legacy=key('Bearer customer-A','live','31','ts','0',false);
 const compatible=key('Bearer customer-A','live','31','ts','0',true);
 assert.equal(original,legacy,'existing original-video sessions preserve their key');
 assert.notEqual(original,compatible,'transcoder may not share the source-copy segment files');
 assert.notEqual(compatible,key('Bearer customer-B','live','31','ts','0',true));
 assert.equal(original.length,40);
 assert.equal(compatible.length,40);
});


test('stopping a live HLS session closes the upstream stream after fetch headers arrived',()=>{
 const begin=source.indexOf('function stopHls(session,reason){');
 const end=source.indexOf('\nconst nap=',begin);
 const code=source.slice(begin,end);
 const map=new Map(),ctx={
  hlsSessions:map,active:1,clearTimeout(){},rmSync(){},console:{info(){}}
 };
 const stop=vm.runInNewContext(code+';\nstopHls',ctx);
 const upstream=new AbortController(),worker=new AbortController(),key='active-h264';
 const session={key,kind:'live',dir:'/fake',abort:worker,sourceController:upstream,released:false};
 map.set(key,session);
 stop(session,'viewer_stopped');
 assert.equal(upstream.signal.aborted,true,'provider must disconnect even after its response headers');
 assert.equal(worker.signal.aborted,true,'encoding must also stop');
 assert.equal(map.has(key),false);
 assert.equal(ctx.active,0);
});


test('authenticated compatibility HLS GET and STOP stay isolated from source-copy session',async()=>{
 const begin=source.indexOf('async function hlsRequest(req,url){');
 const end=source.indexOf('\n/* Web VOD seek experiment',begin);
 const hashBegin=source.indexOf('function hlsKey('),hashEnd=source.indexOf('\nfunction touchHls(',hashBegin);
 assert.ok(begin>=0&&end>begin&&hashBegin>=0&&hashEnd>hashBegin);
 const secret='f'.repeat(64),hmac=vm.runInNewContext(source.slice(hashBegin,hashEnd)+';\nhlsKey',
  {createHmac:crypto.createHmac,SECRET:secret});
 const bearer='Bearer v1.00000000-0000-0000-0000-000000000000.'+'A'.repeat(43);
 const originalKey=hmac(bearer,'live','31','ts','0'),compatKey=hmac(bearer,'live','31','ts','0',true);
 const map=new Map(),started=[],stopped=[];
 const ctx={
  SECRET:secret,hlsSessions:map,hlsKey:hmac,Buffer,Response,
  secureEquals:()=>true,join:(...args)=>args.join('/'),
  readFileSync:(file,encoding)=>encoding==='utf8'?'#EXTM3U\n#EXT-X-VERSION:3\n':Buffer.from('#EXTM3U\n#EXT-X-VERSION:3\n'),
  existsSync:()=>true,touchHls(){},awaitHlsFile:async()=>true,staleLiveManifest:()=>false,
  hlsError:(status,error)=>({status,error}),
  json:(status,value)=>({status,value}),
  startHls:async args=>{
   started.push(args);
   const session={key:args.key,kind:args.kind,dir:'/fake',videoMode:args.forceCompat?'compatibility_transcode':'source_copy'};
   map.set(session.key,session);
   return {session}
  },
  stopHls:(session)=>{stopped.push(session.key);map.delete(session.key)}
 };
 const worker=vm.runInNewContext(source.slice(begin,end)+';\nhlsRequest',ctx);
 const headers={get(name){if(name==='authorization')return bearer;if(name==='x-compat-secret')return secret;return null}};
 map.set(originalKey,{key:originalKey,kind:'live',dir:'/fake',videoMode:'source_copy'});
 const get=await worker({method:'GET',headers},new URL('http://worker/hls/live/31/ts/0/compat/index.m3u8'));
 assert.equal(get.status,200);
 assert.equal(get.headers.get('x-blofy-video-mode'),'compatibility_transcode');
 assert.equal(started.length,1);
 assert.equal(started[0].forceCompat,true);
 assert.equal(started[0].key,compatKey);
 assert.equal(map.has(originalKey),true,'compatibility must not replace original-video session');
 const stop=await worker({method:'POST',headers},new URL('http://worker/hls/live/31/ts/0/compat/stop'));
 assert.equal(stop.status,200);
 assert.deepEqual(stopped,[compatKey]);
 assert.equal(map.has(originalKey),true,'compatibility stop must not terminate original-video playback');
});


test('active live playlist requests survive 12 simulated minutes without the old nine-minute cutoff',()=>{
 const c=fakeClock(),session={legacyHls:true,fullVod:false};
 c.touch(session);session.hardTimer=c.makeTimer(540000);
 for(let minute=1;minute<=12;minute++){
  const old=session.hardTimer;
  c.advance(60*1000);
  c.touch(session);
  assert.ok(c.cleared.includes(old.id),'the previous hard timer must be cancelled');
  assert.equal(c.timers.get(session.hardTimer.id).ms,9*60*1000);
  assert.equal(session.lastAccess,minute*60*1000)
 }
});

test('live FFmpeg maintains the normal audio clock without pitch-shifting the commentator',()=>{
 const start=source.indexOf('async function startHls({');
 const end=source.indexOf('\nasync function hlsRequest(',start);
 assert.ok(start>0&&end>start);
 const live=source.slice(start,end);
 assert.ok(live.includes("aresample=async=1:min_hard_comp=0.100:first_pts=0"),
   'audio should correct timestamp gaps by sample insertion/trimming rather than speed stretch');
 assert.ok(live.includes("'-ar','48000'"),'AAC output is a stable 48kHz clock');
 assert.ok(live.includes("'-b:a','160k'"),'preserve useful speech and broadcast audio bitrate');
});


test('FFmpeg log parsing identifies upstream SD vs FHD without exposing input URLs or credentials',()=>{
 const start=source.indexOf('function streamInputVideoDimensions(log){');
 const end=source.indexOf('\nasync function startHls(',start);
 assert.ok(start>0&&end>start,'source resolution parser must exist');
 const parse=vm.runInNewContext(source.slice(start,end)+';\nstreamInputVideoDimensions');
 const sd="Input #0, mpegts, from 'pipe:0':\n    Stream #0:0[0x100]: Video: h264 (High), yuv420p(tv), 854x480 [SAR 1:1 DAR 427:240], 25 fps\nOutput #0, hls, to '/tmp/file':\n    Stream #0:0: Video: h264, yuv420p, 1280x720";
 assert.equal(parse(sd),'854x480','must report source SD, never transcoded 720p');
 assert.equal(parse("Input #0, mpegts, from 'pipe:0':\n Stream #0:0: Video: h264, 1920x1080, 50 fps"),'1920x1080');
 assert.equal(parse("Input #0\n Stream #0:0: Audio: aac, 48000 Hz"),'');
 assert.equal(parse("Input #0\n Stream #0:0: Video: hevc, 9999x9999"),'','reject implausible dimensions');
});
