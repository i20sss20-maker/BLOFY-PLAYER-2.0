import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {verifiedVodResumePlan,resumeVerifiedVodBytes,allowedVodResumePilot} from '../src/xtream-vod-range-resume.mjs';

const etag='"stable-provider-file-revision-2026"';
const url='https://licensed-provider.example/movie/SAFE_PRIVATE_SESSION/98765.mp4';
function mockHeaders(extra={}){
 return new Headers({
  'content-length':'8192','accept-ranges':'bytes',
  'content-type':'video/mp4',etag,...extra
 });
}
function plan(extra={}){
 return verifiedVodResumePlan({
  enabled:true,kind:'movie',status:200,method:'GET',format:'mp4',
  headers:mockHeaders(),...extra
 });
}
test('one-time resume is opt-in and only a strong ETag / exact direct noncompressed VOD',()=>{
 assert.equal(verifiedVodResumePlan({kind:'movie',headers:mockHeaders()}),null);
 assert.equal(plan()?.total,8192);
 assert.equal(plan()?.etag,etag);
 assert.equal(plan({kind:'series',format:'mkv'})?.total,8192);
 for(const input of [
  {kind:'live'}, {kind:'audio'}, {method:'HEAD'},
  {status:206},{status:302},{requestRange:'bytes=0-1024'},
  {status:200,requestRange:'bytes=0-'},
  {status:206,requestRange:'bytes=0-1024',
   headers:mockHeaders({'content-range':'bytes 0-8191/8192'})},
  {status:206,requestRange:'bytes=400-',
   headers:mockHeaders({'content-range':'bytes 0-8191/8192'})},
  {status:206,requestRange:'bytes=0-',
   headers:mockHeaders({'content-range':'bytes 1-8191/8192'})},
  {status:206,requestRange:'bytes=0-',
   headers:mockHeaders({'content-range':'bytes 0-8191/8193'})},
  {status:200,headers:mockHeaders({'content-range':'bytes 0-8191/8192'})},
  {usingIndependentRelay:true},{format:'ts'},{format:'hls'},
  {headers:mockHeaders({'etag':'W/"weak"'} )},
  {headers:mockHeaders({'etag':''})},
  {headers:mockHeaders({'accept-ranges':'none'})},
  {headers:mockHeaders({'content-length':'0'})},
  {headers:mockHeaders({'content-encoding':'gzip'})}
 ])assert.equal(plan(input),null,JSON.stringify(input));
});
test('a broken MP4 continues at exactly the next unforwarded byte, never replaying already sent bytes',async()=>{
 const total=8192,delivered=3100,rest=Buffer.alloc(total-delivered,0x6a);
 let calls=0,received=Buffer.alloc(0);
 const fetchImpl=async(target,opts)=>{
  calls++;
  assert.equal(String(target),url);
  assert.equal(opts.method,'GET');
  assert.equal(opts.headers['range'],'bytes=3100-8191');
  assert.equal(opts.headers['if-range'],etag);
  assert.equal(opts.headers['accept-encoding'],'identity');
  assert.ok(opts.signal);
  return new Response(new ReadableStream({start(controller){
   controller.enqueue(rest.subarray(0,103));
   controller.enqueue(rest.subarray(103));
   controller.close();
  }}),{status:206,headers:{
   'content-range':'bytes 3100-8191/8192',
   'content-length':String(rest.length),
   etag
  }});
 };
 for await(const part of resumeVerifiedVodBytes({
   plan:plan(),forwarded:delivered,url,
   fetchImpl,headers:{'user-agent':'BLOFY-QA'},clientSignal:new AbortController().signal
 }))received=Buffer.concat([received,Buffer.from(part)]);
 assert.equal(calls,1);
 assert.deepEqual(received,rest);
});
test('wrong status/range/ETag/length all refuse stitching incompatible media into client playback',async()=>{
 const variants=[
  {status:200,headers:{'content-range':'bytes 3100-8191/8192',
    'content-length':'5092',etag}},
  {status:206,headers:{'content-range':'bytes 3101-8191/8192',
    'content-length':'5092',etag}},
  {status:206,headers:{'content-range':'bytes 3100-8191/8192',
    'content-length':'5092',etag:'"changed-provider-file"'}},
  {status:206,headers:{'content-range':'bytes 3100-8191/8192',
    'content-length':'5091',etag}},
  {status:429,headers:{'content-range':'bytes 3100-8191/8192',
    'content-length':'5092',etag}}
 ];
 for(const v of variants){
  let calls=0;
  const fetchImpl=async()=>{
   calls++;return new Response(null,{status:v.status,headers:v.headers});
  };
  await assert.rejects(async()=>{
   for await(const _ of resumeVerifiedVodBytes({
     plan:plan(),forwarded:3100,url,fetchImpl})){}
  },/vod_resume_range_contract_denied/);
  assert.equal(calls,1,'never retry 200, 403 or 429 or changed ETag');
 }
});
test('truncated/oversized body is detected and never reported as a complete recovery',async()=>{
 for(const amount of [5091,5093]){
  const fetchImpl=async()=>new Response(Buffer.alloc(amount),{
   status:206,headers:{etag,
    'content-range':'bytes 3100-8191/8192',
    'content-length':'5092'}
  });
  await assert.rejects(async()=>{
   for await(const _ of resumeVerifiedVodBytes({
    plan:plan(),forwarded:3100,url,fetchImpl})){}
  },/vod_resume_(truncated|overshoot)/);
 }
});
test('cancelled customers and impossible byte offsets cannot cause new provider connections',async()=>{
 let calls=0;const fetchImpl=async()=>{calls++;throw Error('must never call source')};
 for(const forwarded of [0,-1,8192,9999,NaN]){
  await assert.rejects(async()=>{
   for await(const _ of resumeVerifiedVodBytes({
    plan:plan(),forwarded,url,fetchImpl})){}
  },/vod_resume_invalid_request/);
 }
 const controller=new AbortController();controller.abort();
 await assert.rejects(async()=>{
  for await(const _ of resumeVerifiedVodBytes({
   plan:plan(),forwarded:3100,url,fetchImpl,clientSignal:controller.signal})){}
 },/vod_resume_client_cancelled/);
 assert.equal(calls,0);
});
test('customer VOD integration remains disabled by default; no reconnect on live or relay tickets',async()=>{
 const gateway=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
 const block=gateway.slice(gateway.indexOf('async function proxyMedia('),
  gateway.indexOf('async function handleAuthorizedXtreamHls('));
 assert.match(block,/BLOFY_XTREAM_VOD_RANGE_RESUME_ENABLED==='1'/);
 assert.match(block,/resumeVerifiedVodBytes\(/);
 assert.match(block,/if\(!vodPlan\|\|client\.signal\.aborted/);
 assert.match(block,/controller\.abort\(\);[\s\S]*await reader\.cancel\(\)/);
 assert.match(block,/resumedVod/);
 assert.doesNotMatch(block,/\.replace\(\/movie\//);
});

test('only a named QA account and licensed source can activate the guarded recovery',()=>{
 const sourceId='f2631a8b-37e4-4b37-ab7b-3f3fe2de912f';
 const accountId='937ba740-b1dd-44cf-9ff4-55b99e4ca15a';
 const other='4e0ce9b3-1b26-4405-af70-86be533e2ffc';
 const allowed={enabled:true,sourceId,accountId,
  pilotAccountId:accountId,pilotSourceId:sourceId};
 assert.equal(allowedVodResumePilot(allowed),true);
 for(const data of [
  {enabled:false},{pilotAccountId:undefined},{pilotSourceId:''},
  {accountId:other},{sourceId:other},{pilotSourceId:other},
  {pilotAccountId:other},{pilotAccountId:'*'},{pilotSourceId:'all'},
  {pilotAccountId:'not-a-uuid'},{accountId:undefined}
 ]){
  assert.equal(allowedVodResumePilot({...allowed,...data}),false,JSON.stringify(data));
 }
});

test('production gateway cannot turn on VOD resume without exact account and source IDs',async()=>{
 const gateway=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
 const marker=gateway.slice(gateway.indexOf('const vodPlan=verifiedVodResumePlan({'),
  gateway.indexOf('let resumedVod=false;'));
 assert.match(marker,/enabled:authorizedMediaRecoveryRelease\(/);
 assert.match(marker,/BLOFY_XTREAM_VOD_RANGE_RESUME_PRODUCTION/);
 assert.match(marker,/allowedVodResumePilot\(/);
 assert.match(marker,/accountId:String\(account\.id\|\|''\)/);
 assert.match(marker,/sourceId:String\(row\.server_id\|\|''\)/);
 assert.match(marker,/BLOFY_XTREAM_VOD_RANGE_RESUME_PILOT_ACCOUNT_ID/);
 assert.match(marker,/BLOFY_XTREAM_VOD_RANGE_RESUME_PILOT_SOURCE_ID/);
 assert.doesNotMatch(marker,/enabled:process\.env\.BLOFY_XTREAM_VOD_RANGE_RESUME_ENABLED==='1',\s*kind/);
});


test('zero-offset unbounded Range 206 can resume only with exact full-file contract',async()=>{
 const full=plan({status:206,requestRange:'bytes=0-',
  headers:mockHeaders({'content-range':'bytes 0-8191/8192'})});
 assert.equal(full?.total,8192);
 let called=0,received=Buffer.alloc(0);
 const fetchImpl=async(target,opts)=>{
  called++;assert.equal(String(target),url);
  assert.equal(opts.headers.range,'bytes=3100-8191');
  assert.equal(opts.headers['if-range'],etag);
  return new Response(Buffer.alloc(5092,0x6a),{status:206,headers:{
   'content-range':'bytes 3100-8191/8192',
   'content-length':'5092',etag
  }});
 };
 for await(const bytes of resumeVerifiedVodBytes({plan:full,forwarded:3100,
  url,fetchImpl,clientSignal:new AbortController().signal})){
  received=Buffer.concat([received,Buffer.from(bytes)]);
 }
 assert.equal(received.length,5092);
 assert.equal(called,1);
});

test('an exact bounded MKV seek range reconnects the remaining requested bytes only',async()=>{
 const headers=mockHeaders({
  'content-length':'4096','content-range':'bytes 4096-8191/16384',
  'content-type':'video/x-matroska'
 });
 const verified=plan({kind:'series',status:206,format:'mkv',
  requestRange:'bytes=4096-8191',headers});
 assert.equal(verified?.total,4096);
 assert.equal(verified?.rangeStart,4096);
 assert.equal(verified?.rangeEnd,8191);
 assert.equal(verified?.fileTotal,16384);
 let calls=0,result=Buffer.alloc(0);
 const fetchImpl=async(target,options)=>{
  calls++;
  assert.equal(String(target),url);
  assert.equal(options.headers['range'],'bytes=6096-8191');
  assert.equal(options.headers['if-range'],etag);
  assert.equal(options.headers['accept-encoding'],'identity');
  return new Response(Buffer.alloc(2096,0x7c),{status:206,headers:{
   'content-range':'bytes 6096-8191/16384',
   'content-length':'2096',etag
  }});
 };
 for await(const bytes of resumeVerifiedVodBytes({plan:verified,
  forwarded:2000,url,fetchImpl})){
   result=Buffer.concat([result,Buffer.from(bytes)]);
 }
 assert.equal(calls,1);
 assert.equal(result.length,2096);
 assert.equal(result[0],0x7c);
});
test('open ended nonzero MKV seek can finish the same file, never from offset zero',async()=>{
 const hdr=mockHeaders({
  'content-length':'12288','content-range':'bytes 4096-16383/16384'
 });
 const p=plan({kind:'series',status:206,format:'mkv',
  requestRange:'bytes=4096-',headers:hdr});
 assert.equal(p?.total,12288);
 assert.equal(p?.fileTotal,16384);
 let fetched=0;
 for await(const bytes of resumeVerifiedVodBytes({
  plan:p,forwarded:10240,url,fetchImpl:async(_,req)=>{
   fetched++;
   assert.equal(req.headers.range,'bytes=14336-16383');
   return new Response(Buffer.alloc(2048),{status:206,headers:{
    etag,'content-length':'2048',
    'content-range':'bytes 14336-16383/16384'
   }});
  }
 }))assert.equal(bytes.length,2048);
 assert.equal(fetched,1);
});
test('seeks reject off-by-one, multipart, unauthorized extension and short 206 spans',()=>{
 const options={status:206,kind:'series',format:'mkv'};
 const validHdr=mockHeaders({'content-length':'4096',
  'content-range':'bytes 4096-8191/16384'});
 for(const params of [
  {requestRange:'bytes=4096-8192',headers:validHdr},
  {requestRange:'bytes=4095-8191',headers:validHdr},
  {requestRange:'bytes=4096-',headers:validHdr},
  {requestRange:'bytes=4096-8191,12288-16383',headers:validHdr},
  {requestRange:'bytes=8192-4096',headers:validHdr},
  {requestRange:'bytes=0004096-8191',headers:validHdr},
  {requestRange:'bytes=-4096',headers:validHdr},
  {requestRange:'bytes=4096-9999999999999999',headers:validHdr},
  {requestRange:'bytes=4096-8191',headers:mockHeaders({
   'content-length':'4095','content-range':'bytes 4096-8191/16384'
  })},
  {requestRange:'bytes=4096-8191',headers:mockHeaders({
   'content-length':'4096','content-range':'bytes 4096-8190/16384'
  })},
  {requestRange:'bytes=4096-8191',headers:mockHeaders({
   'content-length':'4096','content-range':'bytes 4096-8191/8191'
  })},
  {requestRange:'bytes=4096-8191',usingIndependentRelay:true,headers:validHdr},
  {requestRange:'bytes=4096-8191',headers:mockHeaders({
   'content-length':'4096','content-range':'bytes 4096-8191/16384',
   'etag':'W/"weak"'
  })}
 ])assert.equal(plan({...options,...params}),null,JSON.stringify(params));
});
test('resume reply refuses compressed response even with matching Range and ETag',async()=>{
 const p=plan({status:206,kind:'series',format:'mkv',
  requestRange:'bytes=4096-8191',headers:mockHeaders({
   'content-length':'4096','content-range':'bytes 4096-8191/16384'
  })});
 await assert.rejects(async()=>{
  for await(const _ of resumeVerifiedVodBytes({
   plan:p,forwarded:1000,url,fetchImpl:async()=>new Response(null,{status:206,headers:{
    'content-range':'bytes 5096-8191/16384','content-length':'3096',
    'content-encoding':'gzip',etag
   }})
  })){}
 },/vod_resume_range_contract_denied/);
});

test('a selected Range is never extended beyond the final byte the viewer requested',()=>{
 const bounded=plan({kind:'series',status:206,format:'mkv',
  requestRange:'bytes=8192-12287',headers:mockHeaders({
   'content-length':'4096','content-range':'bytes 8192-12287/65536'
  })});
 assert.equal(bounded?.rangeStart,8192);
 assert.equal(bounded?.rangeEnd,12287);
 assert.equal(bounded?.fileTotal,65536);
 assert.equal(bounded?.total,4096);
 assert.equal(plan({kind:'series',status:206,format:'mkv',
  requestRange:'bytes=8192-',headers:mockHeaders({
   'content-length':'4096','content-range':'bytes 8192-12287/65536'
  })}),null,'partial origin response cannot fake whole open-ended seek');
});
