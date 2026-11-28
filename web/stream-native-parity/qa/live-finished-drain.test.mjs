import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../media-worker.ts',import.meta.url),'utf8');
const begin=source.indexOf('async function hlsRequest(req,url){'),end=source.indexOf('\n/* Web VOD seek experiment',begin);
assert.ok(begin>=0&&end>begin);
function harness(served){
 const session={kind:'live',key:'viewer',dir:'/synthetic',finished:true,servedLiveManifest:served,hadPlayableLiveManifest:served,released:true};
 const map=new Map([['viewer',session]]),timers=[],stops=[];
 const ctx={SECRET:'f'.repeat(64),secureEquals:()=>true,hlsSessions:map,hlsKey:()=> 'viewer',
  liveShareAllowed:()=>false,cancelPendingSharedLiveViewer:()=>false,liveSourceIdentity:()=> 'source',liveSourceRetryMs:()=>0,
  touchHls(){},expiredLiveSegment:()=>false,awaitHlsFile:async()=>true,awaitPlayableLiveManifest:async()=> 'ready',
  existsSync:()=>true,staleLiveManifest:()=>false,join:(...p)=>p.join('/'),
  noteLiveSourceHealthy(){throw Error('ended source is not healthy')},
  startHls:async()=>{throw Error('must not reopen a source during drain')},
  readFileSync:()=>Buffer.from('#EXTM3U\nseg-000001.ts\n'),Response,console,
  streamMediaFile:async()=>new Response('synthetic segment',{status:200}),
  hlsError:(status,error,retry)=>({status,error,retry}),json:(status,value)=>({status,value}),
  stopHls(s,reason){s.stopped=true;map.delete(s.key);stops.push(reason)},
  setTimeout(fn,ms){const t={fn,ms,unref(){}};timers.push(t);return t}};
 const run=vm.runInNewContext(source.slice(begin,end)+';hlsRequest',ctx);
 const headers={get(n){return n==='authorization'?'Bearer v1.00000000-0000-0000-0000-000000000000.'+'A'.repeat(43):'f'.repeat(64)}};
 const get=filename=>run({method:'GET',headers},new URL('http://worker/hls/live/31/ts/0/'+filename));
 return {get,timers,stops,map};
}
test('already advertised segments remain readable briefly after live EOF; manifest is not falsely healthy',async()=>{
 const h=harness(true);
 const a=await h.get('index.m3u8');assert.equal(a.status,503);assert.equal(a.retry,5);
 assert.equal(h.timers.length,1);assert.equal(h.timers[0].ms,5000);
 assert.equal((await h.get('seg-000001.ts')).status,200);
 assert.equal((await h.get('index.m3u8')).status,503);
 assert.equal(h.timers.length,1,'polling cannot extend the drain');
 h.timers[0].fn();assert.deepEqual(h.stops,['live_source_finished']);
 assert.equal((await h.get('seg-000001.ts')).status,404);
});
test('never retain a session that failed before advertising media',async()=>{
 const h=harness(false);
 assert.equal((await h.get('index.m3u8')).status,503);
 assert.equal(h.timers.length,0);assert.deepEqual(h.stops,['live_source_finished']);
});
test('explicit STOP cancels drain and served manifests are tracked only after reading',()=>{
 assert.match(source,/if\(session\.finishedDrainTimer\)\{clearTimeout\(session\.finishedDrainTimer\)/);
 assert.match(source,/if\(!data\.length\)return hlsError\(503,'hls_file_empty'\);\s*if\(kind==='live'\)owner\.servedLiveManifest=true/);
});

test('retired live SID registry is bounded and expires without exposing credentials',()=>{
 const a=source.indexOf('const retiredLiveSids='),b=source.indexOf(' // Guarded pilot fan-out',a);
 const {retireLiveSid,liveSidRetired,retiredLiveSids}=new Function(source.slice(a,b)+';return {retireLiveSid,liveSidRetired,retiredLiveSids}')();
 retireLiveSid('old-hmac',100);
 assert.equal(liveSidRetired('old-hmac',179999),true);
 assert.equal(liveSidRetired('old-hmac',180100),false);
 for(let i=0;i<4100;i++)retireLiveSid('hmac-'+i,100);
 assert.equal(retiredLiveSids.size,4096);
 assert.equal(liveSidRetired('hmac-0',101),false);
 assert.equal(liveSidRetired('hmac-4099',101),true);
});
test('late manifest GET cannot reopen an explicitly stopped live SID',async()=>{
 const retired=new Set(),sessions=new Map(),opens=[];
 const ctx={SECRET:'f'.repeat(64),secureEquals:()=>true,hlsSessions:sessions,hlsKey:()=> 'viewer',
  retireLiveSid:key=>retired.add(key),liveSidRetired:key=>retired.has(key),
  cancelPendingSharedLiveViewer:()=>false,liveShareAllowed:()=>false,
  liveSourceIdentity:()=> 'source',liveSourceRetryMs:()=>0,
  startHls:async()=>{opens.push(1);return {error:'unexpected_start',status:500}},
  json:(status,value)=>({status,value}),hlsError:(status,error,retry)=>({status,error,retry})};
 const run=vm.runInNewContext(source.slice(begin,end)+';hlsRequest',ctx);
 const headers={get:n=>n==='authorization'?'Bearer v1.00000000-0000-0000-0000-000000000000.'+'A'.repeat(43):'f'.repeat(64)};
 const call=(method,file)=>run({method,headers},new URL('http://worker/hls/live/31/ts/0/sid-'+ 'a'.repeat(32)+'/'+file));
 assert.equal((await call('POST','stop')).status,200);
 assert.equal((await call('GET','index.m3u8')).status,503);
 assert.equal((await call('GET','seg-000001.ts')).status,404);
 assert.equal(opens.length,0);
});

test('live admission failure preserves 429/503 and bounded Retry-After while VOD remains unchanged',async()=>{
 const {classifyWebMediaAdmission:classify}=await import('../web-media-admission.mjs');
 assert.deepEqual(classify('live',503,'12'),{error:'live_source_unavailable',status:503,retryAfterSeconds:12});
 assert.equal(classify('live',429,'999').retryAfterSeconds,5);
 assert.equal(classify('live',401,'12').status,401);
 assert.equal(classify('movie',503,'12').status,502);
 assert.match(source,/start\.retryAfterSeconds\?\?\(start\.status===429\?5:0\)/);
});


test('full VOD exit ignores warnings only with successful exit and expected media',()=>{
 const a=source.indexOf('function fullVodExitReason('),b=source.indexOf('function fullVodChunk(',a);
 const reason=new Function(source.slice(a,b)+';return fullVodExitReason')();
 assert.equal(reason(0,'Non-monotonous DTS warning',null,true,true),null);
 assert.equal(reason(0,'',null,false,false),'vod_source_position_unavailable');
 assert.equal(reason(0,'',null,true,false),'vod_chunk_incomplete');
 assert.equal(reason(1,'Connection reset',null,true,false),'vod_source_connection_lost');
 assert.equal(reason(1,'HTTP 416',null,false,false),'vod_source_seek_unsupported');
 assert.equal(reason(1,'','vod_chunk_deadline_exceeded',true,true),'vod_chunk_deadline_exceeded');
 assert.equal(reason(1,'other',null,true,true),'vod_chunk_processing_failed');
});

test('retiring a live source explicitly cancels a pending locked probe exactly once',async()=>{
 const a=source.indexOf('async function selectSourcePreservingInput('),b=source.indexOf('function concatTsProbe(',a);
 const select=new Function(source.slice(a,b)+';return selectSourcePreservingInput')();
 const controller=new AbortController();let calls=0,finishRead;
 const body={getReader:()=>({read:()=>new Promise(resolve=>{finishRead=resolve}),cancel:async()=>{calls++;finishRead?.({done:true})}})};
 const pending=select(body,true,controller.signal);
 controller.abort();
 const result=await pending;
 await result.input.cancel();
 assert.equal(calls,1);
 assert.equal(result.copyVideo,false);
});
test('live abandoned sessions expire sooner without changing VOD idle policy',()=>{
 assert.match(source,/session\.fullVod\?25\*60\*1000:session\.kind==='live'\?60000:110000/);
 assert.match(source,/selectSourcePreservingInput\(sourceBody,!forceCompat&&kind==='live'&&ext==='ts',controller\.signal\)/);
});

test('source channel quota refusal is not an origin outage',async()=>{
 const {classifyWebMediaAdmission:classify}=await import('../web-media-admission.mjs');
 assert.deepEqual(classify('live',503,'2','fanout_source_channel_limit'),{status:503,error:'live_source_channel_limit',retryAfterSeconds:2});
 assert.equal(classify('live',503,'2','untrusted').error,'live_source_unavailable');
 assert.equal(classify('movie',503,'2','fanout_source_channel_limit').status,502);
 assert.match(source,/denial\.error==='live_source_channel_limit'\?'source_channel_limit':'upstream_'\+status/);
});

 test('rolling live history is bounded and defaults to the established window',()=>{
 const a=source.indexOf('function liveWindowSegments('),b=source.indexOf('const LIVE_WINDOW_SEGMENTS=',a);
 const limit=new Function(source.slice(a,b)+';return liveWindowSegments')();
 for(const value of [undefined,null,'',0,7,121,60.5,'invalid'])assert.equal(limit(value),8);
 assert.equal(limit('60'),60);assert.equal(limit(120),120);
 assert.match(source,/-hls_list_size',String\(LIVE_WINDOW_SEGMENTS\),'-hls_delete_threshold','24'/);
 });


test('web worker allows a configured third job but never an unbounded limit',()=>{
 const begin=source.indexOf('function mediaJobLimit('),end=source.indexOf('const MAX_JOBS=',begin);
 assert.ok(begin>=0&&end>begin);
 const limit=vm.runInNewContext(source.slice(begin,end)+';mediaJobLimit');
 assert.equal(limit(undefined),2);assert.equal(limit('2'),2);assert.equal(limit('3'),3);
 for(const invalid of ['0','1','4','150','NaN','2.5'])assert.equal(limit(invalid),2);
});
