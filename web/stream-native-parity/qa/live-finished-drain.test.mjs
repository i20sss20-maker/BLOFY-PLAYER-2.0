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
