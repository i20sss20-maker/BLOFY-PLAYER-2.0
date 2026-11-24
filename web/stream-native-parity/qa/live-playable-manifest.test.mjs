import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../media-worker.ts',import.meta.url),'utf8');
const helperStart=source.indexOf('function liveManifestHasPlayableSegment(');
const helperEnd=source.indexOf('\nfunction staleLiveManifest(',helperStart);
const requestStart=source.indexOf('async function hlsRequest(');
const requestEnd=source.indexOf('\n/* Web VOD seek experiment',requestStart);
assert.ok(helperStart>0&&helperEnd>helperStart&&requestStart>helperEnd&&requestEnd>requestStart);
const helperCode=source.slice(helperStart,helperEnd);
const requestCode=source.slice(requestStart,requestEnd);

function harness(){
 let now=100000,manifest='#EXTM3U\n#EXT-X-VERSION:3\n';
 let polls=0,stops=0,starts=0,owner=null,healthy=0,backoffMs=0;
 const present=new Set(['/live/index.m3u8']);
 const secret='f'.repeat(64);
 const bearer='Bearer v1.00000000-0000-0000-0000-000000000000.'+'A'.repeat(43);
 const sessions=new Map();
 const signal={aborted:false};
 const headers={get(k){return k==='x-compat-secret'?secret:k==='authorization'?bearer:null}};
 const DateMock={now:()=>now};
 const ctx={
  SECRET:secret,secureEquals:()=>true,Buffer,Response,Math,Number,Date:DateMock,
  hlsSessions:sessions,
  hlsKey:()=> 'live-one',
  liveSourceIdentity:()=> 'private-mac',
  liveSourceRetryMs:()=>backoffMs,
  liveShareAllowed:()=>false,
  expiredLiveSegment:()=>false,
  staleLiveManifest:()=>false,
  noteLiveSourceHealthy:()=>healthy++,
  touchHls(){},
  awaitHlsFile:async()=>true,
  streamMediaFile:async()=>new Response('TS',{status:200,headers:{'Content-Type':'video/mp2t'}}),
  join:(...paths)=>paths.join('/'),
  existsSync:path=>present.has(path),
  readFileSync:(path,enc)=>{
   assert.equal(path,'/live/index.m3u8');
   return enc==='utf8'?manifest:Buffer.from(manifest)
  },
  nap:async milliseconds=>{now+=milliseconds;polls++;if(typeof onPoll==='function')onPoll()},
  json:(status,body)=>({status,body}),
  hlsError:(status,error,retrySeconds=0)=>({status,error,retrySeconds}),
  startHls:async({key})=>{
   starts++;
   owner={key,kind:'live',dir:'/live',startedAt:now,stopped:false,finished:false,
    sourceIdentity:'private-mac',videoMode:'source_copy'};
   sessions.set(key,owner);
   return {session:owner}
  },
  stopHls:(session,reason)=>{stops++;session.stopped=true;session.stopReason=reason;sessions.delete(session.key)}
 };
 let onPoll;
 const runner=vm.runInNewContext(helperCode+'\n'+requestCode+
  ';({liveManifestHasPlayableSegment,awaitPlayableLiveManifest,hlsRequest})',ctx);
 return {
  runner,signal,ctx,
  request:()=>({method:'GET',headers,signal}),
  url:file=>new URL('http://worker/hls/live/22/ts/0/'+file),
  start:()=>new Promise(resolve=>resolve()),
  time:()=>now,polls:()=>polls,stops:()=>stops,starts:()=>starts,owner:()=>owner,healthy:()=>healthy,
  setManifest:v=>{manifest=v},add:path=>present.add(path),remove:path=>present.delete(path),
  setPoll:callback=>{onPoll=callback},setBackoff:v=>{backoffMs=v}
 }
}

test('a bare #EXTM3U, invalid playlist, comment and .tmp must not be treated as rendered TS',()=>{
 const h=harness(),owner={kind:'live',dir:'/live',stopped:false};
 const has=h.runner.liveManifestHasPlayableSegment;
 assert.equal(has(owner),false);
 h.setManifest('NOT_HLS\nseg-000001.ts\n');
 h.add('/live/seg-000001.ts');
 assert.equal(has(owner),false,'invalid HLS header is never media-ready');
 h.setManifest('#EXTM3U\n#EXT-X-COMMENT:seg-000001.ts\nseg-000002.ts.tmp\n');
 assert.equal(has(owner),false,'comments and unfinished segments do not count');
 h.setManifest('#EXTM3U\n#EXTINF:1.0,\nseg-000001.ts\n');
 assert.equal(has(owner),true);
 h.remove('/live/seg-000001.ts');
 assert.equal(has(owner),false,'playlist entry without committed file is not ready');
 assert.equal(has({...owner,stopped:true}),false);
});

test('live manifest waits for the actual first TS and honors only one 27.5s request budget',async()=>{
 const h=harness(),t0=h.time();
 h.setPoll(()=>{
  if(h.polls()===5){
   h.setManifest('#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nseg-000001.ts\n');
   // FFmpeg still writes seg-000001.ts.tmp, not a playable segment.
  }
  if(h.polls()===11)h.add('/live/seg-000001.ts')
 });
 const resp=await h.runner.hlsRequest(h.request(),h.url('index.m3u8'));
 assert.equal(resp.status,200,'only an actual committed first segment permits 200');
 assert.ok(h.time()-t0>=11*180);
 assert.ok(h.time()-t0<27500);
 assert.equal(h.stops(),0);
 assert.equal(h.starts(),1);
 assert.equal(h.owner().hadPlayableLiveManifest,true)
});

test('a permanently empty live index returns 503 and closes one stuck source; never optimistic 200',async()=>{
 const h=harness();
 const response=await h.runner.hlsRequest(h.request(),h.url('index.m3u8'));
 assert.equal(response.status,503);
 assert.equal(response.error,'hls_live_segment_not_ready');
 assert.equal(response.retrySeconds,2);
 assert.equal(h.stops(),1);
 assert.equal(h.owner().stopReason,'live_no_initial_segment');
 assert.equal(h.time()>=100000+27500,true,'start never waits beyond original manifest deadline');
 assert.equal(h.starts(),1);
 h.setBackoff(2300);
 const denied=await h.runner.hlsRequest(h.request(),h.url('index.m3u8'));
 assert.equal(denied.status,503);
 assert.equal(denied.error,'hls_origin_backoff');
 assert.equal(h.starts(),1,'origin backoff prevents repeated new FFmpeg on a dead source');
});

test('a source that exited before producing TS gives 503 immediately without a 27s stall',async()=>{
 const h=harness();
 h.setPoll(()=>{if(h.polls()===2)h.owner().finished=true});
 const res=await h.runner.hlsRequest(h.request(),h.url('index.m3u8'));
 assert.equal(res.status,503);
 assert.equal(res.error,'hls_source_finished');
 assert.equal(h.stops(),1);
 assert.ok(h.polls()<=2,'known dead encoder returns immediately');
});

test('cancelled viewer does not stop another subscribed viewer in shared or normal sessions',async()=>{
 const h=harness();
 h.setPoll(()=>{if(h.polls()===2)h.signal.aborted=true});
 const res=await h.runner.hlsRequest(h.request(),h.url('index.m3u8'));
 assert.equal(res.status,410);
 assert.equal(res.error,'hls_request_cancelled');
 assert.equal(h.stops(),0,'request cancellation is not an upstream failure');
});

test('healthy-source cooldown resets only after a real served segment, not on empty manifest polling',async()=>{
 const h=harness();
 h.setManifest('#EXTM3U\n#EXTINF:1,\nseg-000019.ts\n');
 h.add('/live/seg-000019.ts');
 const manifest=await h.runner.hlsRequest(h.request(),h.url('index.m3u8'));
 assert.equal(manifest.status,200);
 assert.equal(h.healthy(),0,'index alone cannot prove decoded frames or data delivery');
 const ts=await h.runner.hlsRequest(h.request(),h.url('seg-000019.ts'));
 assert.equal(ts.status,200);
 assert.equal(h.healthy(),1,'actual available TS evidence may clear source cooldown');
 assert.equal(h.starts(),1)
});

test('sliding HLS playlist is ready if newest TS exists even if oldest has been pruned',()=>{
 const h=harness(),owner={kind:'live',dir:'/live',stopped:false};
 h.setManifest('#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:210\n#EXTINF:1,\nseg-000210.ts\n#EXTINF:1,\nseg-000211.ts\n');
 h.add('/live/seg-000211.ts');
 assert.equal(h.runner.liveManifestHasPlayableSegment(owner),true,
  'do not stall the whole live channel when previous TS has legitimately expired')
});
