import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {vodDownloadPath,downloadableResponse,attachmentFilename} from '../vod-download-policy.mjs';
test('only complete single-file VOD transfers are accepted',()=>{
 assert.equal(vodDownloadPath('movie','123','mp4'),'/api/download/movie/123.mp4');
 assert.equal(vodDownloadPath('series','123','mkv'),'/api/download/series/123.mkv');
 for(const args of [['live','123','ts'],['movie','../1','mp4'],['series','123','m3u8']])assert.equal(vodDownloadPath(...args),null);
 assert.equal(downloadableResponse(200,'video/mp4'),true);
 assert.equal(downloadableResponse(206,'video/mp4'),false);
 assert.equal(downloadableResponse(200,'text/html'),false);
 assert.equal(attachmentFilename('movie','123','mp4'),'BLOFY-STREAM-movie-123.mp4');
});
test('downloads remain disabled by default and are not cached or claimed complete',()=>{
 const server=readFileSync('server.ts','utf8'),app=readFileSync('app.js','utf8'),sw=readFileSync('sw.js','utf8');
 assert.ok(server.includes("Bun.env.BLOFY_WEB_VOD_DOWNLOAD_ENABLED!=='1'"));
 assert.ok(server.includes('MAX_VOD_DOWNLOADS=2'));
 assert.ok(server.includes('new ReadableStream'));
 assert.ok(app.includes('هذه القائمة تسجل طلبات التنزيل فقط'));
 assert.ok(app.includes("method:'HEAD'"));
 assert.ok(sw.includes("SHELL.indexOf(url.pathname)<0"));
});

test('download cancellation, per-account guard and file size validation are enforced',()=>{
 const server=readFileSync('server.ts','utf8');
 assert.ok(server.includes('activeVodDownloadAccounts.has(accountKey)'));
 assert.ok(server.includes("ctrl.signal.addEventListener('abort',cancelReader"));
 assert.ok(server.includes('headerTimer=setTimeout(cancel,20000)'));
 assert.ok(server.includes('received!==expected'));
 assert.ok(server.includes("upstream.headers.has('content-range')"));
 assert.ok(server.includes("if(download)download.abort()"));
});

function fixtureRoute(fetchImpl,enabled=true){
 const server=readFileSync('server.ts','utf8'),a=server.indexOf("if(p.startsWith('/api/download/')"),b=server.indexOf("if(p.indexOf('/api/media/')",a);
 assert.ok(a>=0&&b>a);
 const init=new Function('Bun','fetch','vodDownloadPath','downloadableResponse','attachmentFilename','externalAccountKey','ORIGIN','json','noCache',
 'let activeVodDownloads=0;const MAX_VOD_DOWNLOADS=2,activeVodDownloadAccounts=new Map();return {count:()=>activeVodDownloads,handle:async(req,h)=>{const p=new URL(req.url).pathname,method=req.method;'+server.slice(a,b)+'return new Response(null,{status:404})}}');
 return init({env:{BLOFY_WEB_VOD_DOWNLOAD_ENABLED:enabled?'1':'0'}},fetchImpl,vodDownloadPath,downloadableResponse,attachmentFilename,x=>x,'https://fixture.invalid',(status,body,headers)=>new Response(JSON.stringify(body),{status,headers}),x=>x);
}
const fixtureRequest=(kind='movie',method='GET',signal)=>new Request('https://web.invalid/api/download/'+kind+'/123.mp4',{method,signal});
const auth={Authorization:'Bearer fixture-one'};
test('actual download route enforces activation, local gate, full byte integrity and releases capacity',async()=>{
 const bytes=new Uint8Array([0,1,2,3,4,5,6,7]);let calls=0;
 const route=fixtureRoute(async(url,opts)=>{
  calls++;assert.equal(url,'https://fixture.invalid/api/v1/stream/media/movie/123.mp4');
  assert.equal(opts.headers.Authorization,auth.Authorization);assert.equal(opts.redirect,'manual');
  assert.equal(opts.headers.Range,undefined);
  return new Response(bytes,{headers:{'content-type':'video/mp4','content-length':String(bytes.length)}});
 });
 assert.equal((await route.handle(fixtureRequest(),null)).status,401);
 assert.equal((await route.handle(fixtureRequest('live'),auth)).status,400);
 assert.equal((await route.handle(fixtureRequest('movie','HEAD'),auth)).status,200);
 assert.equal(calls,0);
 const response=await route.handle(fixtureRequest(),auth);
 assert.equal(response.status,200);assert.equal(response.headers.get('Content-Disposition'),'attachment; filename="BLOFY-STREAM-movie-123.mp4"');
 assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);
 assert.equal(route.count(),0);assert.equal(calls,1);
 const disabled=fixtureRoute(()=>{throw Error('must not fetch')},false);
 assert.equal((await disabled.handle(fixtureRequest(),auth)).status,503);
});
test('unknown-size, partial, compressed, and truncated files never succeed as complete',async()=>{
 for(const headers of [{'content-type':'video/mp4'},{'content-type':'video/mp4','content-length':'3','content-encoding':'gzip'},{'content-type':'video/mp4','content-length':'3','content-range':'bytes 0-2/10'}]){
  const route=fixtureRoute(async()=>new Response(new Uint8Array([1,2,3]),{headers}));
  assert.equal((await route.handle(fixtureRequest(),auth)).status,502);assert.equal(route.count(),0);
 }
 const route=fixtureRoute(async()=>new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'video/mp4','content-length':'6'}}));
 const response=await route.handle(fixtureRequest(),auth);
 await assert.rejects(response.arrayBuffer());assert.equal(route.count(),0);
});
test('download slots remain bounded and cancellation frees them without requesting another source',async()=>{
 let cancelled=0;
 const route=fixtureRoute(async()=>new Response(new ReadableStream({pull(){return new Promise(()=>{})},cancel(){cancelled++}}),{headers:{'content-type':'video/mp4','content-length':'10'}}));
 const first=await route.handle(fixtureRequest(),auth);
 assert.equal((await route.handle(fixtureRequest(),auth)).status,429);
 const second=await route.handle(fixtureRequest(),{Authorization:'Bearer fixture-two'});
 assert.equal((await route.handle(fixtureRequest(),{Authorization:'Bearer fixture-three'})).status,429);
 await first.body.cancel();await second.body.cancel();assert.equal(route.count(),0);assert.equal(cancelled,2);
});
