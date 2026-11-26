import {createHmac,timingSafeEqual} from 'node:crypto';
import {createAudioSlots,audioContainer} from './audio-worker-policy.mjs';
const FFMPEG='/usr/bin/ffmpeg';
const SECRET=String(Bun.env.VIDAA_AUDIO_KEY||'');
const BASE='https://blofyplayer.com/api/v1/stream/media/';
const slots=createAudioSlots(1);
function json(status,body,extra={}){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra}})}
function secureEquals(a,b){const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return /^[a-f0-9]{64}$/i.test(b)&&x.length===y.length&&timingSafeEqual(x,y)}
const selftest=Bun.spawnSync([FFMPEG,'-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=440:sample_rate=44100','-t','0.2','-c:a','libmp3lame','-f','mp3','pipe:1'],{stdout:'pipe',stderr:'ignore',timeout:5000});
const ready=selftest.exitCode===0&&selftest.stdout.byteLength>100&&/^[a-f0-9]{64}$/i.test(SECRET);
Bun.serve({port:Number(Bun.env.PORT||8080),idleTimeout:60,async fetch(req){
 const path=new URL(req.url).pathname;
 if(path==='/health'&&req.method==='GET')return json(ready?200:503,{ok:ready,service:'blofy-stream-web-audio'});
 if(!ready)return json(503,{error:'audio_worker_unavailable'});
 if(path==='/internal/metrics'&&req.method==='GET'&&secureEquals(req.headers.get('x-compat-secret'),SECRET))return json(200,slots.snapshot());
 if(path.startsWith('/audio-compat/')){
  if(req.method!=='GET')return json(405,{error:'method_not_allowed'});
  if(!SECRET||!secureEquals(req.headers.get('x-compat-secret'),SECRET))return json(403,{error:'forbidden'});
  const match=path.match(/^\/audio-compat\/(anis-[a-z0-9-]{1,54})$/);
  const bearer=req.headers.get('authorization')||'';
  if(!match)return json(404,{error:'invalid_audio_track'});
  if(!/^Bearer v1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/.test(bearer))return json(401,{error:'authorization_missing'});
  const releaseSlot=slots.acquire(createHmac('sha256',SECRET).update(bearer).digest('hex'));
  if(!releaseSlot)return json(429,{error:'audio_capacity'},{'Retry-After':'3'});
  const controller=new AbortController();
  let proc=null,released=false,timer=null,reader=null;
  const release=()=>{if(!released){released=true;releaseSlot();req.signal.removeEventListener('abort',stop)}};
  const stop=()=>{if(timer)clearTimeout(timer);controller.abort();if(proc){try{proc.kill()}catch{}}else release()};
  req.signal.addEventListener('abort',stop,{once:true});
  try{
   if(req.signal.aborted){stop();return json(410,{error:'audio_cancelled'})}
   timer=setTimeout(stop,12000);
   const source=await fetch(BASE+'audio/'+match[1],{headers:{Authorization:bearer,Accept:'audio/*,video/mp2t'},redirect:'manual',signal:controller.signal});
   if(!source.ok||!source.body){try{await source.body?.cancel()}catch{};stop();return json([401,403,429].includes(source.status)?source.status:502,{error:'audio_source_unavailable'})}
   const mime=audioContainer(source.headers.get('content-type'));
   if(!mime){await source.body.cancel();stop();return json(415,{error:'unsupported_audio_container'})}
   proc=Bun.spawn([FFMPEG,'-hide_banner','-loglevel','error','-nostdin','-probesize','1000000','-analyzeduration','1500000','-i','pipe:0','-map','0:a:0','-vn','-sn','-dn','-threads','1','-c:a','libmp3lame','-b:a','128k','-ac','2','-ar','44100','-f','mp3','pipe:1'],{stdin:source.body,stdout:'pipe',stderr:'ignore',signal:controller.signal});
   proc.exited.then(()=>{release();controller.abort()},()=>{release();controller.abort()});
   reader=proc.stdout.getReader();
   const first=await reader.read();
   clearTimeout(timer);timer=null;
   if(first.done||!first.value?.byteLength){stop();return json(502,{error:'audio_no_output'})}
   return new Response(new ReadableStream({
    start(c){c.enqueue(first.value)},
    async pull(c){try{const n=await reader.read();if(n.done){c.close();stop()}else c.enqueue(n.value)}catch(e){c.error(e);stop()}},
    cancel(){stop();try{return reader.cancel()}catch{}}
   }),{headers:{'Content-Type':'audio/mpeg','Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','Accept-Ranges':'none'}});
  }catch{stop();return json(502,{error:'audio_conversion_failed'})}
 }

 return json(404,{error:'not_found'})
}});
