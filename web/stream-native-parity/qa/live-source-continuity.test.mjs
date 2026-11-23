import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {allowedSingleViewerLiveTsContinuity,liveTsSameSourceContinuity}
 from '../live-source-continuity.mjs';

const access='937ba740-b1dd-44cf-9ff4-55b99e4ca15a';
const other='4e0ce9b3-1b26-4405-af70-86be533e2ffc';
const bearer='Bearer v1.'+access+'.'+'A'.repeat(43);
const channel='1312445';
function ts(){const b=new Uint8Array(564);b[0]=b[188]=b[376]=0x47;return b}
function body(parts=[ts()]){
 return new ReadableStream({start(c){for(const part of parts)c.enqueue(part);c.close()}});
}
function reply(parts=[ts()],opts={}){
 return new Response(body(parts),{status:opts.status||200,
  headers:{'content-type':'video/mp2t',...opts.headers}})
}
const instant=async(_ms,signal)=>!signal?.aborted;

test('live continuation can only activate for one exact approved channel AND access ID',()=>{
 const ok={enabled:true,kind:'live',id:channel,ext:'ts',bearer,
  approvedChannelId:channel,approvedAccessId:access};
 assert.equal(allowedSingleViewerLiveTsContinuity(ok),true);
 for(const change of [{enabled:false},{kind:'movie'},{kind:'series'},
  {ext:'m3u8'},{ext:'mkv'},{id:'313'},{approvedChannelId:'313'},
  {approvedChannelId:'*'},{approvedAccessId:other},{approvedAccessId:'*'},
  {approvedAccessId:''},{bearer:'Bearer fake'},
  {bearer:'Bearer v1.'+other+'.'+'A'.repeat(43)}])
  assert.equal(allowedSingleViewerLiveTsContinuity({...ok,...change}),false,
   JSON.stringify(change));
 assert.equal(allowedSingleViewerLiveTsContinuity({...ok,enabled:undefined}),false);
});

test('one clean MPEG-TS EOF reconnects the same authenticated source without replaying bytes',async()=>{
 let calls=0,time=10000;
 const evt=[],ctl=new AbortController();
 const stream=liveTsSameSourceContinuity({
  firstBody:body(),clientSignal:ctl.signal,now:()=>time,sleep:instant,
  fetchSameSource:async()=>{
   calls++;time+=450;return reply()
  },onEvent:e=>evt.push(e)
 });
 const reader=stream.getReader();
 assert.deepEqual((await reader.read()).value,ts());
 time+=65000;
 assert.deepEqual((await reader.read()).value,ts());
 assert.equal(calls,1,'one source reconnection only, never prefetch a second');
 assert.deepEqual(evt,[
  {phase:'source_drop',cause:'eof',lifetimeSeconds:70},
  {phase:'source_recovered',cause:'eof',attempt:1,gapMs:500}
 ]);
 await reader.cancel();
 assert.equal(calls,1);
});

test('TS probe handles split 188-byte packets while preserving all original bytes',async()=>{
 const source=ts(),chunks=[source.subarray(0,100),source.subarray(100,200),source.subarray(200)];
 let calls=0;
 const reader=liveTsSameSourceContinuity({
  firstBody:body(),clientSignal:new AbortController().signal,sleep:instant,
  fetchSameSource:async()=>{calls++;return reply(chunks)}
 }).getReader();
 await reader.read();
 assert.deepEqual((await reader.read()).value,source);
 assert.equal(calls,1);
 await reader.cancel()
});

test('upstream 503 gets at most one bounded retry followed by valid TS',async()=>{
 let calls=0;
 const reader=liveTsSameSourceContinuity({
  firstBody:body(),clientSignal:new AbortController().signal,sleep:instant,
  fetchSameSource:async()=>{calls++;return calls===1?
   new Response('temporary',{status:503}):reply()}
 }).getReader();
 await reader.read();
 assert.deepEqual((await reader.read()).value,ts());
 assert.equal(calls,2);
 await reader.cancel()
});

test('401/403/404/429/456/509 cannot be retried or bypassed by new origin GETs',async()=>{
 for(const code of [401,403,404,429,456,509]){
  let calls=0,events=[];
  const reader=liveTsSameSourceContinuity({
   firstBody:body(),clientSignal:new AbortController().signal,sleep:instant,
   onEvent:e=>events.push(e),
   fetchSameSource:async()=>{calls++;return new Response(null,{status:code})}
  }).getReader();
  await reader.read();
  await assert.rejects(async()=>reader.read(),/live_source_continuity_ended/);
  assert.equal(calls,1,'terminal provider status '+code);
  assert.equal(events.at(-1).phase,'source_exhausted');
 }
});

test('invalid MIME, compressed or non-TS responses cannot be spliced into FFmpeg',async()=>{
 for(const response of [
  new Response(body([new Uint8Array(564)]),{status:200,headers:{'content-type':'video/mp2t'}}),
  new Response(body(),{status:200,headers:{'content-type':'text/html'}}),
  new Response(body(),{status:200,headers:{'content-encoding':'gzip'}}),
  new Response(body(),{status:200,headers:{'content-length':'564'}})
 ]){
  let count=0;
  const reader=liveTsSameSourceContinuity({
   firstBody:body(),clientSignal:new AbortController().signal,sleep:instant,
   fetchSameSource:async()=>{count++;return response}
  }).getReader();
  await reader.read();
  await assert.rejects(async()=>reader.read(),/live_source_continuity_ended/);
  assert.ok(count<=2);
 }
});

test('aborting the viewer during retry backoff opens no new connection',async()=>{
 const ctl=new AbortController();let fetches=0;
 const reader=liveTsSameSourceContinuity({
  firstBody:body(),clientSignal:ctl.signal,
  sleep:async()=>{ctl.abort();return false},
  fetchSameSource:async()=>{fetches++;return reply()}
 }).getReader();
 await reader.read();
 await assert.rejects(async()=>reader.read(),/live_source_continuity_ended/);
 assert.equal(fetches,0)
});

test('per-viewer rolling window limits continuous EOF reopen loops',async()=>{
 let calls=0;
 const events=[];
 const reader=liveTsSameSourceContinuity({
  firstBody:body(),clientSignal:new AbortController().signal,
  now:()=>10000,sleep:instant,
  fetchSameSource:async()=>{calls++;return reply()},
  onEvent:e=>events.push(e)
 }).getReader();
 for(let n=0;n<5;n++)assert.deepEqual((await reader.read()).value,ts());
 await assert.rejects(async()=>reader.read(),/live_source_continuity_ended/);
 assert.equal(calls,4,'no fifth connection inside 120-second source quota');
 assert.equal(events.at(-1).phase,'source_exhausted');
});

test('a failed telemetry callback never alters playback or opens extra sources',async()=>{
 let fetches=0;
 const reader=liveTsSameSourceContinuity({
  firstBody:body(),clientSignal:new AbortController().signal,sleep:instant,
  onEvent:()=>{throw Error('telemetry failure')},
  fetchSameSource:async()=>{fetches++;return reply()}
 }).getReader();
 await reader.read();
 assert.deepEqual((await reader.read()).value,ts());
 assert.equal(fetches,1);
 await reader.cancel()
});

test('worker and Docker only expose isolated one-viewer pilot; no credential-bearing logs',async()=>{
 const worker=await readFile(new URL('../media-worker.ts',import.meta.url),'utf8');
 const docker=await readFile(new URL('../Dockerfile.media',import.meta.url),'utf8');
 assert.match(docker,/COPY live-source-continuity\.mjs/);
 assert.match(worker,/allowedSingleViewerLiveTsContinuity\(/);
 assert.match(worker,/VIDAA_LIVE_TS_CONTINUITY_PILOT==='1'/);
 assert.match(worker,/VIDAA_LIVE_TS_CONTINUITY_CHANNEL_ID/);
 assert.match(worker,/VIDAA_LIVE_TS_CONTINUITY_ACCESS_ID/);
 assert.match(worker,/firstBody:upstream\.body,clientSignal:controller\.signal/);
 const segment=worker.slice(worker.indexOf("onEvent:event=>console.info('VIDAA_LIVE_TS_CONTINUITY'"),
  worker.indexOf('}):upstream.body;',worker.indexOf("onEvent:event=>console.info('VIDAA_LIVE_TS_CONTINUITY'")));
 assert.doesNotMatch(segment,/bearer|Authorization|password|URL|target|sourceId/);
});
