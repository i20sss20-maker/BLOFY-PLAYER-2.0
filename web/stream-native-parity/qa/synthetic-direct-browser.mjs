import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {chromium} from '@playwright/test';
const dir=mkdtempSync(join(tmpdir(),'blofy-direct-browser-'));
let browser,server;
try{
 const ff=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=480x270:rate=25','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','36','-c:v','libx264','-preset','ultrafast','-g','50','-keyint_min','50','-sc_threshold','0','-pix_fmt','yuv420p','-c:a','aac','-f','segment','-segment_time','2','-segment_format','mpegts','-reset_timestamps','0',join(dir,'seg-%03d.ts')],{timeout:60000});
 assert.equal(ff.status,0,String(ff.stderr));
 const chunks=Array.from({length:18},(_,i)=>readFileSync(join(dir,'seg-'+String(i).padStart(3,'0')+'.ts')));
 const app=readFileSync('app.js','utf8');
 const configuration=app.match(/var transport=window\.mpegts\.createPlayer\(\{[\s\S]*?url:'\/api\/media\/live\/'\+enc\(id\)\+'\.ts'\s*\},(\{[\s\S]*?\})\);/)?.[1];
 assert.ok(configuration,'extract actual direct MPEG-TS config');
 const js=readFileSync('node_modules/mpegts.js/dist/mpegts.js');
 let requests=0,delivered=0,gapAt=0,cancelled=false,closed=false,timer;
 server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){
  const path=new URL(req.url).pathname;
  if(path==='/')return new Response('<!doctype html><video muted autoplay playsinline></video><script src="/mpegts.js"></script>',{headers:{'content-type':'text/html'}});
  if(path==='/mpegts.js')return new Response(js,{headers:{'content-type':'application/javascript'}});
  if(path!=='/stream.ts')return new Response('not found',{status:404});
  requests++;
  const body=new ReadableStream({
   start(controller){
    function send(){
     if(cancelled)return;
     if(delivered>=chunks.length){closed=true;controller.close();return}
     try{controller.enqueue(chunks[delivered++])}catch(e){closed=true;return}
     // Realistic short source stall, keeping the authenticated transport open.
     const delay=delivered===5?3500:1600;
     if(delivered===5)gapAt=Date.now();
     timer=setTimeout(send,delay);
    }
    send()
   },
   cancel(){cancelled=true;clearTimeout(timer)}
  });
  return new Response(body,{headers:{'content-type':'video/mp2t','cache-control':'no-store'}})
 }});
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required','--disable-dev-shm-usage']});
 const page=await browser.newPage();
 await page.goto('http://127.0.0.1:'+server.port+'/');
 await page.evaluate(config=>{
  if(!window.mpegts||!mpegts.isSupported())throw Error('MPEGTS/MSE unavailable');
  const video=document.querySelector('video');
  window.stats={frames:0,time:0,errors:0};
  function frame(now,meta){window.stats.frames++;window.stats.time=meta.mediaTime;video.requestVideoFrameCallback(frame)}
  video.requestVideoFrameCallback(frame);
  const transport=window.mpegts.createPlayer({type:'mpegts',isLive:true,url:'/stream.ts'},new Function('return '+config)());
  window.transport=transport;
  transport.on(mpegts.Events.ERROR,()=>window.stats.errors++);
  transport.attachMediaElement(video);transport.load();transport.play().catch(()=>{});
 },configuration);
 await page.waitForFunction(()=>window.stats.frames>=50&&document.querySelector('video').videoWidth>0,{},{timeout:22000});
 const deadline=Date.now()+15000;
 while(!gapAt&&Date.now()<deadline)await Bun.sleep(200);
 assert.ok(gapAt,'source gap exercised');
 while(delivered<6&&Date.now()<deadline)await Bun.sleep(200);
 assert.ok(delivered>=6,'source resumed');
 const before=await page.evaluate(()=>({...window.stats}));
 await page.waitForFunction(b=>window.stats.frames>=b.frames+50&&window.stats.time>b.time+1,before,{timeout:18000});
 const after=await page.evaluate(()=>({...window.stats}));
 assert.equal(after.errors,0);
 assert.equal(requests,1,'single direct stream connection before and after transient source gap');
 await page.evaluate(()=>{window.transport.destroy();window.transport=null});
 await browser.close();browser=null;
 console.log('BLOFY_SYNTHETIC_DIRECT_TS_OK',JSON.stringify({frames:after.frames,postGapFrames:after.frames-before.frames,requests,delivered,errors:after.errors}));
}finally{
 clearTimeout(timer);
 if(browser)await browser.close();
 if(server)server.stop(true);
 rmSync(dir,{recursive:true,force:true})
}
