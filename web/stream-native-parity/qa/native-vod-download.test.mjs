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
 assert.ok(app.includes('الملفات المحفوظة بالكامل للمشاهدة دون إنترنت'));
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
 const init=new Function('Bun','fetch','vodDownloadPath','downloadableResponse','attachmentFilename','externalAccountKey','downloadAccountKey','ORIGIN','json','noCache',
 'let activeVodDownloads=0;const MAX_VOD_DOWNLOADS=2,activeVodDownloadAccounts=new Map(),activeVodDownloadTokens=new Map();return {count:()=>activeVodDownloads,cancel:owner=>activeVodDownloadTokens.get(owner)?.abort(),handle:async(req,h)=>{const p=new URL(req.url).pathname,method=req.method;'+server.slice(a,b)+'return new Response(null,{status:404})}}');
 return init({env:{BLOFY_WEB_VOD_DOWNLOAD_ENABLED:enabled?'1':'0'}},fetchImpl,vodDownloadPath,downloadableResponse,attachmentFilename,x=>x,x=>x.replace(/-rotated$/,''),'https://fixture.invalid',(status,body,headers)=>new Response(JSON.stringify(body),{status,headers}),x=>x);
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
 assert.equal((await route.handle(fixtureRequest(),{Authorization:'Bearer fixture-one-rotated'})).status,429);
 route.cancel('Bearer fixture-one-rotated');assert.equal(route.count(),1);
 const second=await route.handle(fixtureRequest(),{Authorization:'Bearer fixture-two'});
 assert.equal((await route.handle(fixtureRequest(),{Authorization:'Bearer fixture-three'})).status,429);
 route.cancel(auth.Authorization);assert.equal(route.count(),1);
 await first.body.cancel();await second.body.cancel();assert.equal(route.count(),0);assert.equal(cancelled,2);
});

test('web download UI permits one pending preflight and ignores stale account responses',async()=>{
 const source=readFileSync('app.js','utf8'),a=source.indexOf('function requestWebDownload('),b=source.indexOf('function favoritesScreen(',a);
 const S={accountEpoch:1,userVerified:true,route:'detail',downloadPending:null},message={textContent:''},pending=[],saved=[],clicks=[],timers=new Map();
 const document={getElementById:()=>message,createElement:()=>({click(){clicks.push(this.href)},remove(){}}),body:{appendChild(){}}};
 let tick=0;
 const request=new Function('S','document','webDownloadPath','fetch','setTimeout','clearTimeout','webDownloadHistory','profileSave','downloadsScreen',source.slice(a,b)+';return requestWebDownload')(
 S,document,vodDownloadPath,()=>new Promise(resolve=>pending.push(resolve)),fn=>{timers.set(++tick,fn);return tick},id=>timers.delete(id),()=>[],(_,rows)=>saved.push(rows),()=>{});
 request('movie','123','mp4','One');request('movie','124','mp4','Two');
 assert.equal(pending.length,1);
 S.accountEpoch++;S.downloadPending=null;
 request('movie','124','mp4','Two');assert.equal(pending.length,2);
 pending[0]({ok:true});await Promise.resolve();await Promise.resolve();
 assert.equal(clicks.length,0);
 pending[1]({ok:true});await Promise.resolve();await Promise.resolve();
 assert.deepEqual(clicks,['/api/download/movie/124.mp4']);assert.equal(saved.length,1);assert.equal(S.downloadPending,null);
 request('movie','125','mp4','Three');
 const expire=[...timers.values()][0];expire();
 assert.equal(S.downloadPending,null);
 pending[2]({ok:true});await Promise.resolve();await Promise.resolve();
 assert.equal(clicks.length,1);
});

test('touch browsers get a real save link after the asynchronous authorization check',async()=>{
 const source=readFileSync('app.js','utf8'),a=source.indexOf('function requestWebDownload('),b=source.indexOf('function favoritesScreen(',a);
 const S={accountEpoch:1,userVerified:true,route:'detail'},saved=[];let link,clicks=0;
 const message={textContent:'',appendChild(node){link=node}};
 const doc={documentElement:{getAttribute:()=> 'touch'},getElementById:()=>message,createElement:()=>({click(){clicks++},remove(){},isConnected:false})};
 const request=new Function('S','document','webDownloadPath','fetch','setTimeout','clearTimeout','webDownloadHistory','profileSave','downloadsScreen',source.slice(a,b)+';return requestWebDownload')(S,doc,vodDownloadPath,async()=>({ok:true}),()=>1,()=>{},()=>[],(_,rows)=>saved.push(rows),()=>{});
 request('movie','123','mp4','Fixture');await Promise.resolve();await Promise.resolve();
 assert.equal(clicks,0);assert.equal(saved.length,0);assert.equal(link.href,'/api/download/movie/123.mp4');
 link.onclick({preventDefault(){throw Error('unexpected rejection')}});assert.equal(saved.length,1);
 S.accountEpoch++;let blocked=false;link.onclick({preventDefault(){blocked=true}});assert.equal(blocked,true);assert.equal(saved.length,1);
});

test('offline playback lease is limited to verified profile, 24 hours and subscription expiry',()=>{
 const app=readFileSync('app.js','utf8'),a=app.indexOf('function offlineGrantValid('),b=app.indexOf('function offlineGrant()',a);
 const valid=new Function(app.slice(a,b)+';return offlineGrantValid')();
 const now=1700000000000,grant={profile:'a'.repeat(24),verifiedAt:now,until:now+86400000};
 assert.equal(valid(grant,now+1000),true);assert.equal(valid(grant,now+86400000),false);
 assert.equal(valid(grant,now-1),false);assert.equal(valid({...grant,until:now+86400001},now),false);
 assert.equal(valid({...grant,profile:'other'},now),false);
 assert.match(app,/written!==total/);assert.match(app,/saved.size!==total/);
 assert.match(app,/if\(!committed&&folder&&fileName\)/);
 assert.match(app,/navigator.onLine===false&&offlineOnlyScreen\(\)/);
 assert.match(app,/URL.createObjectURL\(file.slice/);
});
