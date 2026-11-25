import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {chromium} from '@playwright/test';
const dir=mkdtempSync(join(tmpdir(),'blofy-browser-live-'));
let browser,server;
try{
 const ff=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=480x270:rate=25','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','48','-c:v','libx264','-preset','ultrafast','-g','50','-keyint_min','50','-sc_threshold','0','-pix_fmt','yuv420p','-c:a','aac','-f','hls','-hls_time','2','-hls_playlist_type','vod','-hls_segment_filename',join(dir,'seg-%06d.ts'),join(dir,'index.m3u8')],{timeout:60000});
 assert.equal(ff.status,0,String(ff.stderr));
 const manifest=readFileSync(join(dir,'index.m3u8'),'utf8');
 const segments=[...manifest.matchAll(/#EXTINF:([0-9.]+),[^\n]*\n(seg-\d{6}\.ts)/g)].map(m=>({duration:m[1],name:m[2]}));
 assert.ok(segments.length>=20);
 const app=readFileSync('app.js','utf8');
 const config=app.match(/var engine=new window\.Hls\((\{enableWorker:hlsRemuxWorkerSupported\(\),lowLatencyMode:false,liveSyncDurationCount:bufferProfile\.sync,[^\n]+?\})\);record\.engine=engine;/)?.[1];
 assert.ok(config,'extract actual deployed live HLS configuration');
 const begin=app.indexOf('function liveBufferProfile('),end=app.indexOf('function resumeLiveHlsNetwork(',begin);
 const helpers=app.slice(begin,end);
 const hls=readFileSync('node_modules/hls.js/dist/hls.min.js');
 const started=Date.now();let injectedAt=0,manifestHits=0,segmentHits=0;
 server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){
  const p=new URL(req.url).pathname;
  if(p==='/')return new Response('<!doctype html><video muted autoplay playsinline></video><script src="/hls.js"></script>',{headers:{'content-type':'text/html'}});
  if(p==='/hls.js')return new Response(hls,{headers:{'content-type':'application/javascript'}});
  if(p==='/live.m3u8'){
   manifestHits++;const elapsed=Date.now()-started;
   if(elapsed>=8000&&!injectedAt){injectedAt=Date.now();return new Response('temporary synthetic source outage',{status:503,headers:{'Retry-After':'1','Cache-Control':'no-store'}})}
   const last=Math.min(segments.length,8+Math.floor(elapsed/2000)),first=Math.max(0,last-8);
   return new Response('#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:'+first+'\n#EXT-X-INDEPENDENT-SEGMENTS\n'+segments.slice(first,last).map(s=>'#EXTINF:'+s.duration+',\n'+s.name).join('\n')+'\n',{headers:{'content-type':'application/vnd.apple.mpegurl','Cache-Control':'no-store'}})
  }
  if(/^\/seg-\d{6}\.ts$/.test(p)&&segments.some(s=>'/'+s.name===p)){segmentHits++;return new Response(Bun.file(join(dir,p.slice(1))),{headers:{'content-type':'video/mp2t','Cache-Control':'no-store'}})}
  return new Response('not found',{status:404})
 }});
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required','--disable-dev-shm-usage']});
 const page=await browser.newPage();
 await page.goto('http://127.0.0.1:'+server.port+'/');
 await page.evaluate(({config,helpers})=>{
  if(!window.Hls||!window.Hls.isSupported())throw Error('MSE/HLS unsupported');
  const video=document.querySelector('video');
  const engine=new Function(helpers+';var preview=false,bufferProfile=liveBufferProfile(preview);function hlsRemuxWorkerSupported(){return !!window.Worker}return new window.Hls('+config+')')();
  window.stats={fatal:0,frames:0,lastTime:0};
  function frame(now,meta){window.stats.frames++;window.stats.lastTime=meta.mediaTime;video.requestVideoFrameCallback(frame)}
  if(video.requestVideoFrameCallback)video.requestVideoFrameCallback(frame);
  engine.on(window.Hls.Events.ERROR,(_,d)=>{if(d.fatal)window.stats.fatal++});
  engine.on(window.Hls.Events.MANIFEST_PARSED,()=>video.play().catch(()=>{}));
  engine.attachMedia(video);engine.loadSource('/live.m3u8');
 },{config,helpers});
 await page.waitForFunction(()=>window.stats?.frames>=35&&document.querySelector('video').videoWidth>0,{},{timeout:20000});
 // Wait for the injected HTTP outage, then require actual fresh decoded frames.
 await page.waitForFunction(()=>window.stats?.frames>=100,{},{timeout:18000});
 while(!injectedAt&&Date.now()-started<24000)await Bun.sleep(250);
 assert.ok(injectedAt,'temporary manifest outage exercised');
 const before=await page.evaluate(()=>({...window.stats}));
 await page.waitForFunction(b=>window.stats.frames>=b.frames+50&&window.stats.lastTime>b.lastTime+1,before,{timeout:18000});
 const after=await page.evaluate(()=>({...window.stats,width:document.querySelector('video').videoWidth}));
 assert.equal(after.fatal,0,'HLS engine should handle a single transient manifest failure');
 assert.ok(segmentHits>=3&&manifestHits>=3&&after.width>0);
 console.log('BLOFY_SYNTHETIC_BROWSER_LIVE_OK',JSON.stringify({frames:after.frames,postOutageFrames:after.frames-before.frames,manifestHits,segmentHits,transient503:1,fatal:after.fatal}));
}finally{
 if(browser)await browser.close();
 if(server)server.stop(true);
 rmSync(dir,{recursive:true,force:true})
}
