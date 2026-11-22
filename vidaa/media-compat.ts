
import ffmpegPath from 'ffmpeg-static@5.2.0';
import { timingSafeEqual } from 'node:crypto';
const FFMPEG=String(ffmpegPath||'');
const SECRET=String(Bun.env.VIDAA_COMPAT_KEY||'');
const BASE='https://blofyplayer.com/api/v1/stream/media/';
let active=0;
const MAX_JOBS=2;
function json(status,obj){return new Response(JSON.stringify(obj),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}})}
function secureEquals(a,b){const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&x.length===64&&timingSafeEqual(x,y)}
const server=Bun.serve({port:Number(Bun.env.PORT||3000),idleTimeout:255,async fetch(req){
 const url=new URL(req.url),path=url.pathname;
 if(path==='/health'&&req.method==='GET'){
  let status=false;try{const proc=Bun.spawnSync([FFMPEG,'-version'],{stdout:'pipe',stderr:'ignore',timeout:3000});status=proc.exitCode===0}catch{}
  return json(status&&SECRET.length===64?200:503,{ok:status&&SECRET.length===64,service:'blofy-vidaa-media-compat',ffmpegAvailable:status,activeJobs:active,limit:MAX_JOBS})
 }
 if(req.method!=='GET')return json(405,{error:'method_not_allowed'});
 if(!SECRET||!secureEquals(req.headers.get('x-compat-secret'),SECRET))return json(403,{error:'forbidden'});
 const m=path.match(/^\/convert\/(live|movie|series)\/([1-9][0-9]{0,14})\.(ts|mkv|mp4|avi|mov)$/);
 if(!m)return json(404,{error:'invalid_resource'});
 const bearer=req.headers.get('authorization')||'';
 if(!/^Bearer v1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/.test(bearer))return json(401,{error:'authorization_missing'});
 const [_,kind,id,ext]=m;
 const mode=url.searchParams.get('mode')==='video'?'video':'audio';
 const track=Number(url.searchParams.get('track')||'0');
 if(!Number.isSafeInteger(track)||track<0||track>3)return json(400,{error:'invalid_audio_track'});
 if(active>=MAX_JOBS)return json(429,{error:'compat_capacity',retryAfter:5});
 active++;
 let released=false;const release=()=>{if(!released){released=true;active=Math.max(0,active-1)}};
 const controller=new AbortController();
 const abort=()=>controller.abort();
 req.signal.addEventListener('abort',abort,{once:true});
 let src;
 const target=BASE+kind+'/'+id+'.'+ext;
 try{
  const timeout=setTimeout(()=>controller.abort(),20000);
  try{src=await fetch(target,{method:'GET',headers:{Authorization:bearer,Accept:'*/*','accept-encoding':'identity'},redirect:'manual',signal:controller.signal})}
  finally{clearTimeout(timeout)}
  if(!src.ok||!src.body){const status=src.status;release();return json(status===401?401:status===404?404:502,{error:'protected_media_unavailable',upstreamStatus:status})}
  if(src.status>=300&&src.status<400){release();return json(502,{error:'upstream_redirect_unsupported'})}
  const live=kind==='live';
  const args=['-hide_banner','-loglevel','error','-nostdin','-probesize','4000000','-analyzeduration','4000000','-fflags','+genpts','-i','pipe:0','-map','0:v:0?','-map','0:a:'+String(track)+'?'];
  if(mode==='video')args.push('-c:v','libx264','-preset','ultrafast','-tune','zerolatency','-pix_fmt','yuv420p','-vf','scale=trunc(min(1280\\,iw)/2)*2:-2');
  else args.push('-c:v','copy');
  args.push('-c:a','aac','-b:a','160k','-ac','2','-ar','48000');
  if(live)args.push('-f','mpegts','-mpegts_flags','+resend_headers','pipe:1');
  else args.push('-movflags','+frag_keyframe+empty_moov+default_base_moof','-f','mp4','pipe:1');
  const proc=Bun.spawn([FFMPEG,...args],{stdin:src.body,stdout:'pipe',stderr:'pipe',signal:controller.signal});
  const stderrTask=(async()=>{try{
   const message=(await new Response(proc.stderr).text()).slice(0,1200);
   if(message)console.warn('VIDAA_COMPAT_FFMPEG',{
    kind,mode,code: /Invalid data found|Invalid argument/i.test(message)?'bad_input':
      /Could not find codec|Unknown encoder|Error while opening encoder/i.test(message)?'encoder_error':
      /error decoding|corrupt input|Invalid NAL/i.test(message)?'decode_error':
      /Output file does not contain any stream/i.test(message)?'empty_stream':'ffmpeg_processing_error'});
  }catch(e){}})();
  let stopped=false;
  const cleanup=()=>{if(stopped)return;stopped=true;try{proc.kill()}catch{};controller.abort();release()};
  req.signal.addEventListener('abort',cleanup,{once:true});
  const reader=proc.stdout.getReader();
  let timer=null;
  const first=await Promise.race([
   reader.read(),
   new Promise(resolve=>{timer=setTimeout(()=>resolve({timeout:true}),22000)})
  ]);
  if(timer)clearTimeout(timer);
  if(first.timeout){cleanup();try{await reader.cancel()}catch{};return json(504,{error:'compat_first_byte_timeout'})}
  if(first.done||!first.value||first.value.byteLength===0){
   const exit=await Promise.race([proc.exited,new Promise(resolve=>setTimeout(()=>resolve(-1),1200))]).catch(()=>-1);
   console.warn('VIDAA_COMPAT_ZERO_OUTPUT',{kind,mode,exitCode:exit});
   cleanup();try{await reader.cancel()}catch{};
   return json(422,{error:'compat_zero_output',exitCode:Number.isInteger(exit)?exit:null})
  }
  const body=new ReadableStream({
   start(ctrl){ctrl.enqueue(first.value)},
   async pull(ctrl){try{
     const n=await reader.read();
     if(n.done){ctrl.close();release();controller.abort()}
     else ctrl.enqueue(n.value);
   }catch(err){ctrl.error(err);cleanup()}},
   cancel(){cleanup();try{reader.cancel()}catch{}}
  });
  proc.exited.then(exitCode=>{if(exitCode!==0)console.warn('VIDAA_COMPAT_PROC_EXIT',{kind,mode,code:exitCode});release()}).catch(()=>release());
  return new Response(body,{status:200,headers:{'Content-Type':live?'video/mp2t':'video/mp4','Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','Accept-Ranges':'none','X-Blofy-Compat':'aac-'+mode}});
 }catch(err){controller.abort();release();return json(502,{error:'compat_conversion_failed'})}
}});
console.info('VIDAA media compatibility worker running',server.port,FFMPEG?'ffmpeg resolved':'ffmpeg unresolved');
