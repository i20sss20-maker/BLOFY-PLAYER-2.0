
import { timingSafeEqual, createHmac } from 'node:crypto';
import { mkdirSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const FFMPEG='/usr/bin/ffmpeg';
const SECRET=String(Bun.env.VIDAA_COMPAT_KEY||'');
const BASE='https://blofyplayer.com/api/v1/stream/media/';
let active=0;
const MAX_JOBS=2;

const hlsSessions=new Map();
const hlsRoot=join(tmpdir(),'blofy-vidaa-hls-sessions');
const hardTTL=9*60*1000;
function hlsKey(bearer,kind,id,ext,track){return createHmac('sha256',SECRET).update([bearer,kind,id,ext,track].join('\x00')).digest('hex').slice(0,40)}
function touchHls(session){
 session.lastAccess=Date.now();if(session.idleTimer)clearTimeout(session.idleTimer);
 session.idleTimer=setTimeout(()=>stopHls(session,'idle_timeout'),110000);
 session.idleTimer.unref?.();
}
function stopHls(session,reason){
 if(!session||session.stopped)return;session.stopped=true;
 if(session.idleTimer)clearTimeout(session.idleTimer);
 if(session.hardTimer)clearTimeout(session.hardTimer);
 hlsSessions.delete(session.key);
 try{session.abort.abort()}catch{}
 try{session.proc?.kill()}catch{}
 releaseHls(session);
 try{rmSync(session.dir,{recursive:true,force:true})}catch{}
 if(reason!=='idle_timeout'&&reason!=='session_expired')console.info('VIDAA_HLS_SESSION_END',{kind:session.kind,reason})
}
function releaseHls(session){if(!session.released){session.released=true;active=Math.max(0,active-1)}}
const nap=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function awaitHlsFile(session,filename,limitMs){
 const until=Date.now()+limitMs;
 while(Date.now()<until){
  if(session.stopped)return false;
  if(existsSync(join(session.dir,filename)))return true;
  if(session.finished)return false;
  await nap(220);
 }
 return false;
}
function hlsError(status,error){return json(status,{ok:false,error})}
async function startHls({bearer,kind,id,ext,track,key}){
 if(active>=MAX_JOBS)return {error:'hls_capacity',status:429};
 active++;
 const abort=new AbortController(),dir=join(hlsRoot,key);
 const session={key,kind,id,ext,track,dir,abort,startedAt:Date.now(),stopped:false,released:false,finished:false,proc:null,lastAccess:Date.now(),error:null};
 hlsSessions.set(key,session);
 mkdirSync(dir,{recursive:true});
 touchHls(session);
 session.hardTimer=setTimeout(()=>stopHls(session,'session_expired'),hardTTL);
 session.hardTimer.unref?.();
 const target=BASE+kind+'/'+id+'.'+ext;
 try{
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),16000);
  let upstream;
  try{upstream=await fetch(target,{method:'GET',headers:{Authorization:bearer,Accept:'*/*','accept-encoding':'identity'},redirect:'manual',signal:controller.signal})}
  finally{clearTimeout(timeout)}
  if(!upstream.ok||!upstream.body){const status=upstream.status;stopHls(session,'upstream_'+status);return {error:status===401?'invalid_session':status===404?'media_missing':status>=300&&status<400?'media_redirect_unsupported':'media_upstream_error',status:status===401?401:502}}
  const videoArgs=['-c:v','libx264','-preset','ultrafast','-tune','zerolatency','-profile:v','baseline','-level','3.1','-pix_fmt','yuv420p','-vf','scale=854:480:force_original_aspect_ratio=decrease:force_divisible_by=2,fps=25','-g','25','-keyint_min','25','-sc_threshold','0','-b:v','900k','-maxrate','1100k','-bufsize','1800k'];
  const args=['-hide_banner','-loglevel','warning','-nostdin','-analyzeduration','1200000','-probesize','1200000','-fflags','+genpts',...(kind==='live'?['-re']:[]),'-i','pipe:0',
   '-map','0:v:0','-map','0:a:'+track+'?',...videoArgs,'-c:a','aac','-profile:a','aac_low','-b:a','96k','-ac','2','-ar','48000',
   '-f','hls','-hls_time','1','-hls_segment_type','mpegts','-hls_segment_filename',join(dir,'seg-%06d.ts')];
  if(kind==='live')args.push('-hls_list_size','8','-hls_delete_threshold','24','-hls_flags','delete_segments+independent_segments+temp_file');
  else args.push('-hls_list_size','0','-hls_playlist_type','event','-hls_flags','independent_segments');
  args.push(join(dir,'index.m3u8'));
  const proc=Bun.spawn([FFMPEG,...args],{stdin:upstream.body,stdout:'ignore',stderr:'pipe',signal:abort.signal});
  session.proc=proc;
  (async()=>{try{
   let err='';const stream=proc.stderr?.getReader?.();if(!stream)return;
   while(true){const part=await stream.read();if(part.done)break;if(err.length<3500)err+=new TextDecoder().decode(part.value).slice(0,1000)}
   if(err)session.error=/Stream map|matches no streams/i.test(err)?'source_missing_video':/Invalid data/i.test(err)?'invalid_source_data':/encoder/i.test(err)?'encoder_failure':'transcode_error';
  }catch{}})();
  proc.exited.then(code=>{
   session.finished=true;
   if(code!==0&&!session.stopped)console.warn('VIDAA_HLS_FFMPEG_EXIT',{kind,code,reason:session.error||'nonzero_exit'});
   if(!existsSync(join(dir,'index.m3u8'))){session.error=session.error||'ffmpeg_no_playlist';stopHls(session,session.error)}
   else {releaseHls(session);touchHls(session)}
  }).catch(()=>{session.finished=true;session.error='process_crashed';stopHls(session,session.error)});
  return {session};
 }catch(err){stopHls(session,'fetch_or_spawn_error');return {error:'hls_start_failed',status:502}}
}
async function hlsRequest(req,url){
 if(!SECRET||!secureEquals(req.headers.get('x-compat-secret'),SECRET))return hlsError(403,'forbidden');
 const stop=url.pathname.match(/^\/hls\/(live|movie|series)\/([1-9][0-9]{0,14})\/(ts|mkv|mp4|avi|mov)\/([0-3])\/stop$/);
 if(req.method==='POST'&&stop){
  const bearer=req.headers.get('authorization')||'';
  if(!/^Bearer v1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/.test(bearer))return hlsError(401,'authorization_missing');
  const key=hlsKey(bearer,stop[1],stop[2],stop[3],stop[4]);
  const activeSession=hlsSessions.get(key);if(activeSession)stopHls(activeSession,'viewer_stopped');
  return json(200,{ok:true});
 }
 if(req.method!=='GET')return hlsError(405,'method_not_allowed');
 if(!SECRET||!secureEquals(req.headers.get('x-compat-secret'),SECRET))return hlsError(403,'forbidden');
 const match=url.pathname.match(/^\/hls\/(live|movie|series)\/([1-9][0-9]{0,14})\/(ts|mkv|mp4|avi|mov)\/([0-3])\/(index\.m3u8|seg-[0-9]{6}\.ts)$/);
 if(!match)return hlsError(404,'hls_invalid_resource');
 const bearer=req.headers.get('authorization')||'';
 if(!/^Bearer v1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/.test(bearer))return hlsError(401,'authorization_missing');
 const [whole,kind,id,ext,track,filename]=match;
 const key=hlsKey(bearer,kind,id,ext,track);
 let sess=hlsSessions.get(key);
 if(!sess&&filename!=='index.m3u8')return hlsError(404,'hls_session_missing');
 if(!sess){const start=await startHls({bearer,kind,id,ext,track,key});if(start.error)return hlsError(start.status,start.error);sess=start.session}
 touchHls(sess);
 const ready=await awaitHlsFile(sess,filename,filename==='index.m3u8'?25000:8000);
 if(ready&&filename==='index.m3u8'&&kind==='live'){
  // Avoid exposing an initialized playlist before its first segment is committed.
  const playlistText=readFileSync(join(sess.dir,filename),'utf8');
  const firstSegment=(playlistText.match(/seg-\d{6}\.ts/g)||[])[0];
  if(firstSegment&&!existsSync(join(sess.dir,firstSegment))){
   const available=await awaitHlsFile(sess,firstSegment,4500);
   if(!available)return hlsError(503,'hls_playlist_not_ready');
  }
 }
 if(ready&&/^seg-\d{6}\.ts$/.test(filename)&&!sess.firstSegmentLogged){
  sess.firstSegmentLogged=true;
  console.info('VIDAA_HLS_FIRST_SEGMENT',{kind:sess.kind,elapsedMs:Date.now()-sess.startedAt});
 }
 if(!ready)return hlsError(sess.error?502:504,sess.error||'hls_segment_timeout');
 try{
  const data=readFileSync(join(sess.dir,filename));
  if(!data.length)return hlsError(503,'hls_file_empty');
  const playlist=filename==='index.m3u8';
  const headers={'Content-Type':playlist?'application/vnd.apple.mpegurl':'video/mp2t','Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff'};
  return new Response(data,{status:200,headers});
 }catch{return hlsError(502,'hls_read_failed')}
}

/* Web VOD seek experiment, separate from LIVE sessions.
 * Session credentials never enter browser URLs or ffmpeg command lines.
 * Seekable localhost proxy forwards byte ranges to first-party authorized gateway.
 */
function vodKey(bearer,kind,id,ext,track,start){
 return createHmac('sha256',SECRET).update([bearer,kind,id,ext,track,start].join('\x00')).digest('hex').slice(0,40)
}
async function localSource(req,url){
 if(req.method!=='GET'&&req.method!=='HEAD')return json(405,{error:'method_not_allowed'});
 const peer=server.requestIP(req)?.address||'';
 if(peer!=='127.0.0.1'&&peer!=='::1'&&peer!=='::ffff:127.0.0.1')return json(403,{error:'local_only'});
 const m=url.pathname.match(/^\/_source\/([a-f0-9]{40})$/);
 if(!m)return json(404,{error:'unknown_source'});
 const session=hlsSessions.get(m[1]);
 if(!session||session.stopped||!session.bearer)return json(410,{error:'source_session_expired'});
 const target=BASE+session.kind+'/'+session.id+'.'+session.ext;
 const headers={Authorization:session.bearer,'Accept':'*/*','accept-encoding':'identity'};
 const range=req.headers.get('Range');if(range&&/^bytes=\d*-\d*$/.test(range))headers.Range=range;
 try{
  const res=await fetch(target,{method:req.method,headers,redirect:'manual',signal:req.signal});
  if(res.status>=300&&res.status<400)return json(502,{error:'upstream_redirect_rejected'});
  const h=new Headers({'Cache-Control':'no-store, private','Content-Type':res.headers.get('content-type')||'application/octet-stream'});
  for(const k of ['content-range','content-length','accept-ranges'])if(res.headers.get(k))h.set(k,res.headers.get(k));
  return new Response(req.method==='HEAD'?null:res.body,{status:res.status,headers:h})
 }catch{return json(502,{error:'upstream_source_unavailable'})}
}
async function startVod({bearer,kind,id,ext,track,start,key}){
 // Replace older positions for this same account/title to avoid wasting transcoding slots.
 for(const s of Array.from(hlsSessions.values()))if(s.vod&&s.bearer===bearer&&s.key!==key)stopHls(s,'title_or_position_changed');
 if(active>=MAX_JOBS)return {status:429,error:'vod_capacity'};
 active++;
 const abort=new AbortController(),dir=join(hlsRoot,key);
 const session={key,vod:true,kind,id,ext,track,start,bearer,dir,abort,startedAt:Date.now(),stopped:false,released:false,finished:false,proc:null,lastAccess:Date.now(),error:null};
 hlsSessions.set(key,session);
 mkdirSync(dir,{recursive:true});touchHls(session);
 session.hardTimer=setTimeout(()=>stopHls(session,'session_expired'),4*60*60*1000);
 session.hardTimer.unref?.();
 try{
  const src='http://127.0.0.1:'+Number(Bun.env.PORT||3000)+'/_source/'+key;
  const args=['-hide_banner','-loglevel','warning','-nostdin','-analyzeduration','2000000','-probesize','2000000',
   '-ss',String(start),'-re','-i',src,
   '-map','0:v:0','-map','0:a:'+track+'?',
   '-c:v','libx264','-preset','ultrafast','-profile:v','baseline','-level','3.1','-pix_fmt','yuv420p',
   '-vf','scale=854:480:force_original_aspect_ratio=decrease:force_divisible_by=2,fps=25',
   '-g','50','-keyint_min','50','-sc_threshold','0','-b:v','900k','-maxrate','1100k','-bufsize','1800k',
   '-c:a','aac','-profile:a','aac_low','-b:a','96k','-ac','2','-ar','48000',
   '-f','hls','-hls_time','2','-hls_segment_type','mpegts',
   '-hls_segment_filename',join(dir,'seg-%06d.ts'),
   '-hls_list_size','12','-hls_delete_threshold','36','-hls_flags','delete_segments+independent_segments+temp_file',
   join(dir,'index.m3u8')];
  const proc=Bun.spawn([FFMPEG,...args],{stdin:'ignore',stdout:'ignore',stderr:'pipe',signal:abort.signal});
  session.proc=proc;
  (async()=>{try{
   let buf='';const reader=proc.stderr.getReader();while(true){const p=await reader.read();if(p.done)break;if(buf.length<2500)buf+=new TextDecoder().decode(p.value).slice(0,500)}
   if(buf&&!existsSync(join(dir,'index.m3u8')))session.error=/404|416|range/i.test(buf)?'vod_source_seek_unsupported':/no streams|invalid data/i.test(buf)?'vod_source_invalid':'vod_encoding_failed'
  }catch{}})();
  proc.exited.then(code=>{session.finished=true;releaseHls(session);if(code!==0&&!session.stopped){console.warn('BLOFY_WEB_VOD_FFMPEG_EXIT',{code,reason:session.error||'nonzero'});if(!existsSync(join(dir,'index.m3u8')))stopHls(session,'vod_no_playlist')}}).catch(()=>stopHls(session,'vod_proc_failed'));
  return {session};
 }catch(e){stopHls(session,'vod_spawn_failed');return {status:502,error:'vod_spawn_failed'}}
}
async function vodRequest(req,url){
 if(!SECRET||!secureEquals(req.headers.get('x-compat-secret'),SECRET))return json(403,{error:'forbidden'});
 const match=url.pathname.match(/^\/vod\/(movie|series)\/([1-9][0-9]{0,14})\/(mkv|mp4|avi|mov|ts)\/([0-3])\/([0-9]{1,6})\/(index\.m3u8|seg-[0-9]{6}\.ts|stop)$/);
 if(!match)return json(404,{error:'invalid_vod_path'});
 const [,kind,id,ext,track,rawStart,file]=match,start=Number(rawStart);
 if(!Number.isSafeInteger(start)||start<0||start>172800)return json(400,{error:'invalid_vod_position'});
 const bearer=req.headers.get('authorization')||'';
 if(!/^Bearer v1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/.test(bearer))return json(401,{error:'authorization_missing'});
 const key=vodKey(bearer,kind,id,ext,track,start);
 if(file==='stop'&&req.method==='POST'){const sess=hlsSessions.get(key);if(sess)stopHls(sess,'user_stopped');return json(200,{ok:true})}
 if(req.method!=='GET')return json(405,{error:'method_not_allowed'});
 let sess=hlsSessions.get(key);
 if(!sess&&file!=='index.m3u8')return json(410,{error:'vod_session_expired'});
 if(!sess){const created=await startVod({bearer,kind,id,ext,track,start,key});if(created.error)return json(created.status||502,{error:created.error});sess=created.session}
 touchHls(sess);
 const success=await awaitHlsFile(sess,file,file==='index.m3u8'?25000:11000);
 if(!success)return json(sess.error?502:504,{error:sess.error||'vod_initial_segment_pending'});
 if(file==='index.m3u8'){
  const manifest=readFileSync(join(sess.dir,'index.m3u8'),'utf8');
  const first=(manifest.match(/seg-\d{6}\.ts/)||[])[0];
  if(first&&!existsSync(join(sess.dir,first)))return json(503,{error:'vod_playlist_not_ready'});
 }
 try{
  const content=readFileSync(join(sess.dir,file));
  return new Response(content,{status:200,headers:{'Content-Type':file.endsWith('.m3u8')?'application/vnd.apple.mpegurl':'video/mp2t','Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff'}})
 }catch{return json(502,{error:'vod_segment_unavailable'})}
}

function tsCodecs(buffer){
 let pmt=-1,video=false,audio=false;
 for(let off=0;off+188<=buffer.length&&off<188*500;off+=188){
  if(buffer[off]!==0x47)break;
  const pid=((buffer[off+1]&31)<<8)|buffer[off+2];
  const ac=(buffer[off+3]>>4)&3;
  if(ac!==1&&ac!==3)continue;
  let at=off+4;
  if(ac===3){const len=buffer[at];at+=1+len}
  if(at>=off+188)continue;
  if(buffer[off+1]&64){const ptr=buffer[at];at+=1+ptr}
  if(at+13>off+188)continue;
  if(pid===0&&buffer[at]===0x00){
   const length=((buffer[at+1]&15)<<8)|buffer[at+2];
   const stop=Math.min(at+3+length-4,off+188);
   for(let k=at+8;k+4<=stop;k+=4){const program=(buffer[k]<<8)|buffer[k+1];if(program){pmt=((buffer[k+2]&31)<<8)|buffer[k+3];break}}
  }
  if(pid===pmt&&buffer[at]===0x02){
   const sl=((buffer[at+1]&15)<<8)|buffer[at+2],pi=((buffer[at+10]&15)<<8)|buffer[at+11];
   const stop=Math.min(at+3+sl-4,off+188);
   for(let k=at+12+pi;k+5<=stop;){const type=buffer[k],es=((buffer[k+3]&15)<<8)|buffer[k+4];if(type===0x1b)video=true;if(type===0x0f)audio=true;k+=5+es}
   if(video&&audio)break
  }
 }
 return {video,audio}
}
function hlsSelfTest(){
 const dir=join(hlsRoot,'selftest');
 try{
  mkdirSync(dir,{recursive:true});
  const args=['-hide_banner','-loglevel','error','-nostdin','-f','lavfi','-i','testsrc=size=320x180:rate=25','-f','lavfi','-i','sine=frequency=440:sample_rate=48000',
   '-t','4','-map','0:v:0','-map','1:a:0','-c:v','libx264','-preset','ultrafast','-profile:v','baseline','-level','3.1','-pix_fmt','yuv420p',
   '-vf','scale=854:480:force_original_aspect_ratio=decrease:force_divisible_by=2,fps=25','-g','50','-keyint_min','50','-sc_threshold','0',
   '-c:a','aac','-b:a','96k','-ac','2','-ar','48000','-f','hls','-hls_time','2','-hls_list_size','0','-hls_playlist_type','vod',
   '-hls_segment_filename',join(dir,'seg-%06d.ts'),join(dir,'index.m3u8')];
  const proc=Bun.spawnSync([FFMPEG,...args],{stdout:'pipe',stderr:'pipe',timeout:20000});
  if(proc.exitCode!==0)return {ok:false,stage:'encoding',exit:proc.exitCode};
  const manifest=readFileSync(join(dir,'index.m3u8'),'utf8');
  const segments=readdirSync(dir).filter(x=>/^seg-\d{6}\.ts$/.test(x));
  if(!manifest.startsWith('#EXTM3U')||segments.length<2)return {ok:false,stage:'manifest_or_segments'};
  const media=tsCodecs(readFileSync(join(dir,segments[0])));
  return {ok:!!media.video&&!!media.audio,stage:'verified_ts',video:media.video?'h264':'missing',audio:media.audio?'aac':'missing',segments:segments.length};
 }catch(e){return {ok:false,stage:'runtime_failure'}}
 finally{try{rmSync(dir,{recursive:true,force:true})}catch{}}
}
let hlsCheck=null;

async function syntheticPipeTest(){
 const dir=join(tmpdir(),'blofy-vidaa-pipetest');
 mkdirSync(dir,{recursive:true});const src=join(dir,'input.ts'),out=join(dir,'test.m3u8');
 try{
  const seed=Bun.spawnSync([FFMPEG,'-hide_banner','-loglevel','error','-nostdin','-f','lavfi','-i','testsrc=size=320x180:rate=25','-f','lavfi','-i','sine=frequency=660:sample_rate=48000','-t','3','-map','0:v:0','-map','1:a:0','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-f','mpegts',src],{stdout:'pipe',stderr:'pipe',timeout:20000});
  if(seed.exitCode!==0)return {ok:false,stage:'seed_failed',exit:seed.exitCode};
  const bytes=readFileSync(src);
  const input=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(bytes));controller.close()}});
  const stderr=[];
  const args=['-hide_banner','-loglevel','error','-nostdin','-i','pipe:0','-map','0:v:0','-map','0:a:0','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-b:a','96k','-ac','2','-f','hls','-hls_time','1','-hls_segment_filename',join(dir,'p-%06d.ts'),out];
    const proc=Bun.spawn([FFMPEG,...args],{stdin:input,stdout:'ignore',stderr:'ignore'});
  const exit=await Promise.race([proc.exited,new Promise(resolve=>setTimeout(()=>resolve(-999),16000))]).catch(()=>-998);
  if(exit===-999)try{proc.kill()}catch(e){}
  const messages='';
  const created=existsSync(out),size=created?readFileSync(out).length:0;
  const error=/Segmentation fault|signal 11/i.test(messages)?'segfault':/Invalid data/i.test(messages)?'invalid_input':/Could not find|matches no streams/i.test(messages)?'stream_map':'other_or_none';
  return {ok:exit===0&&created&&size>30&&readdirSync(dir).some(f=>/^p-\d{6}\.ts$/.test(f)),stage:'async_stream_decode_to_hls',exit,signal:proc.signalCode??null,created,size,sourceBytes:bytes.length,error};
 }catch(e){return {ok:false,stage:'pipe_test_failed',error:String(e?.name||'runtime_error')}}
 finally{try{rmSync(dir,{recursive:true,force:true})}catch{}}
}

function json(status,obj){return new Response(JSON.stringify(obj),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}})}
function secureEquals(a,b){const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&x.length===64&&timingSafeEqual(x,y)}
const server=Bun.serve({port:Number(Bun.env.PORT||3000),idleTimeout:255,async fetch(req){
 const url=new URL(req.url),path=url.pathname;
 if(path.startsWith('/_source/'))return localSource(req,url);
 if(path.startsWith('/vod/'))return vodRequest(req,url);
 if(path==='/internal-pipe-test'&&req.method==='GET'){
 if(!SECRET||!secureEquals(req.headers.get('x-compat-secret'),SECRET))return json(403,{error:'forbidden'});
 const check=await syntheticPipeTest();console.info('VIDAA_SYNTHETIC_PIPE_TEST',check);return json(check.ok?200:503,check)
 }
 if(path==='/health'&&req.method==='GET'){
  let status=false;try{const proc=Bun.spawnSync([FFMPEG,'-version'],{stdout:'pipe',stderr:'ignore',timeout:3000});status=proc.exitCode===0}catch{}
  if(!hlsCheck&&status){hlsCheck=hlsSelfTest();console.info('VIDAA_HLS_SELFTEST',hlsCheck)}
  return json(status&&SECRET.length===64&&hlsCheck?.ok?200:503,{ok:status&&SECRET.length===64&&!!hlsCheck?.ok,service:'blofy-vidaa-media-compat',ffmpegAvailable:status,hls:hlsCheck,activeJobs:active,limit:MAX_JOBS})
 }
 if(path.startsWith('/hls/'))return hlsRequest(req,url);
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
