// Real Chromium decoding using two locally generated, rights-free HLS fixtures.
// Exercises the packaged HLS.js and production handoff function, not the full UI
// or real subscriber authentication. No external media requests are permitted.
import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(process.argv[2]||'qa-fixtures');
const app=readFileSync('app.js','utf8');
const start=app.indexOf('function queueLiveHlsHandoff('),end=app.indexOf('function playHls(',start);
assert.ok(start>=0&&end>start);
const handoff=app.slice(start,end);
const hls=readFileSync('node_modules/hls.js/dist/hls.min.js');
const server=createServer((req,res)=>{
 const p=new URL(req.url,'http://localhost').pathname;
 res.setHeader('Cache-Control','no-store');
 if(p==='/'){res.setHeader('Content-Type','text/html');res.end('<video id="v" muted playsinline autoplay width="640" height="360"></video><script src="/hls.js"></script><script src="/handoff.js"></script>');return}
 if(p==='/hls.js'||p==='/handoff.js'){res.setHeader('Content-Type','application/javascript');res.end(p==='/hls.js'?hls:handoff);return}
 if(!/^\/(red|blue)\/(index\.m3u8|seg-[0-9]+\.ts)$/.test(p)){res.writeHead(404).end();return}
 const file=resolve(root,'.'+p);
 if(!existsSync(file)){res.writeHead(404).end();return}
 res.setHeader('Content-Type',p.endsWith('.m3u8')?'application/vnd.apple.mpegurl':'video/mp2t');res.end(readFileSync(file));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try{
 browser=await chromium.launch({...(process.env.BLOFY_QA_BUNDLED_CHROMIUM==='1'?{}:{channel:'chrome'}),headless:true,args:['--autoplay-policy=no-user-gesture-required']});
 const page=await browser.newPage();
 page.on('console',m=>console.log('browser:',m.text()));
 page.on('pageerror',e=>console.error('browser error:',e.message));
 page.on('requestfailed',r=>console.error('fixture request failed:',new URL(r.url()).pathname,r.failure()?.errorText));
 const origin='http://127.0.0.1:'+server.address().port;
 await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
 await page.goto(origin);
 const result=await page.evaluate(async()=>{
  const video=document.getElementById('v'),state={},starts=[],stops=[],acks=[];
  let engine=null,wanted='red',events=[];
  const pause=ms=>new Promise(r=>setTimeout(r,ms));
  function detach(){if(engine){engine.destroy();engine=null}video.pause();video.removeAttribute('src');video.load()}
  function play(name){starts.push(name);events=[];engine=new Hls({enableWorker:false});engine.on(Hls.Events.ERROR,(_,e)=>{events.push({type:e.type,details:e.details,fatal:e.fatal});if(events.length>20)events.shift()});engine.on(Hls.Events.MANIFEST_PARSED,()=>{video.muted=true;video.play().catch(e=>events.push({play:e.name}))});engine.on(Hls.Events.MEDIA_ATTACHED,()=>engine.loadSource('/'+name+'/index.m3u8'));engine.attachMedia(video)}
  async function picture(name){
   const began=performance.now(),until=began+15000;
   while(performance.now()<until){
    if(video.readyState>=2&&video.videoWidth>0&&video.currentTime>0.4){
     const canvas=document.createElement('canvas');canvas.width=1;canvas.height=1;const c=canvas.getContext('2d');c.drawImage(video,0,0,1,1);const [r,g,b]=c.getImageData(0,0,1,1).data;
     if(name==='red'?r>b+70:b>r+70)return {width:video.videoWidth,time:video.currentTime,observedMs:Math.round(performance.now()-began)};
    }
    await pause(100);
   }
   throw Error('no decoded '+name+' frame '+JSON.stringify({ready:video.readyState,network:video.networkState,time:video.currentTime,width:video.videoWidth,paused:video.paused,mediaError:video.error?.code,codec:MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E,mp4a.40.2"'),events}));
  }
  const ops={detach,current:()=>true,visible:()=>true,matches:r=>r.id===wanted,wait(){},error(){throw Error('handoff failed')},timer:(fn,ms)=>setTimeout(fn,ms),clear:id=>clearTimeout(id),retry:(fn,ms)=>setTimeout(fn,ms),stop:(key,done)=>{stops.push(key);acks.push(done)},start:r=>play(r.id)};
  if(!Hls.isSupported()||!MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E,mp4a.40.2"'))throw Error('Test browser does not support required H.264/AAC MSE');
  play('red');const first=await picture('red');
  wanted='blue';queueLiveHlsHandoff(state,{id:'blue'},'red-sid',ops);
  wanted='red';queueLiveHlsHandoff(state,{id:'red'},null,ops);
  wanted='blue';queueLiveHlsHandoff(state,{id:'blue'},null,ops);
  if(stops.length!==1||starts.length!==1)throw Error('overlapping channel requests');
  acks[0](503);
  await pause(850);
  if(stops.length!==2||stops[1]!=='red-sid'||starts.length!==1)throw Error('incorrect stop retry');
  acks[1](200);
  const second=await picture('blue');
  // Repeat handoffs after the first successful recovery; a single passing
  // switch cannot catch a player that gets stuck on subsequent channels.
  const repeated=[];
  for(const next of ['red','blue','red','blue']){
   wanted=next;const previous=starts[starts.length-1];
   queueLiveHlsHandoff(state,{id:next},previous+'-sid',ops);
   acks[acks.length-1](200);
   repeated.push(await picture(next));
  }
  // The fixture is a finite 12-second HLS playlist. Verify real decoded
  // frames after forward/backward seeks crossing segment boundaries.
  const seeks=[];
  for(const target of [8,2,6]){
   const before=video.getVideoPlaybackQuality().totalVideoFrames;
   video.currentTime=target;
   const began=performance.now();
   while(performance.now()-began<12000){
    const frames=video.getVideoPlaybackQuality().totalVideoFrames;
    if(!video.seeking&&video.readyState>=2&&video.currentTime>=target&&video.currentTime<target+2&&frames>before+1)break;
    if(video.error||events.some(e=>e.fatal))throw Error('seek failed:'+JSON.stringify(events));
    await pause(50)
   }
   const observed=video.currentTime,decoded=video.getVideoPlaybackQuality().totalVideoFrames-before;
   if(video.seeking||observed<target||observed>=target+2||decoded<2)throw Error('seek not confirmed:'+JSON.stringify({target,observed,decoded}));
   seeks.push({target,observed,decoded,observedMs:Math.round(performance.now()-began)})
  }
  detach();
  return {first,second,repeated,starts,stops,seeks};
 });
 assert.deepEqual(result.starts,['red','blue','red','blue','red','blue']);assert.deepEqual(result.stops,['red-sid','red-sid','blue-sid','red-sid','blue-sid','red-sid']);
 assert.equal(result.seeks.length,3);
 console.log('BLOFY_SYNTHETIC_BROWSER_PLAYBACK',JSON.stringify(result));
}finally{await browser?.close();await new Promise(r=>server.close(r))}
