
import { timingSafeEqual, createHmac, randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {allowedSingleViewerLiveTsContinuity,liveTsSameSourceContinuity}
 from './live-source-continuity.mjs';
import {streamMediaFile} from './stream-media-file.mjs';
const FFMPEG='/usr/bin/ffmpeg';
const SECRET=String(Bun.env.VIDAA_COMPAT_KEY||'');
const BASE='https://blofyplayer.com/api/v1/stream/media/';
let active=0;
// Never raise this from a synthetic CI benchmark. Only a measured Railway
// resource profile + real subscribed-source long-play can justify scaling.
const MAX_JOBS=2;
// Optional rolling DVR window. Default remains unchanged.
function liveWindowSegments(raw){
 const n=Number(raw);return Number.isSafeInteger(n)&&n>=8&&n<=120?n:8
}
const LIVE_WINDOW_SEGMENTS=liveWindowSegments(Bun.env.BLOFY_WEB_LIVE_WINDOW_SEGMENTS);
/* Pilot quality profiles: never enlarge a low-resolution source.
 * The previous forced 854x480 / 900 kbit/s severely degraded every HD film
 * and channel. Live compatibility defaults to 720p; movies/series on the
 * isolated preview worker default to 1080p (reversible by environment).
 * Both have bounded CRF+VBV to avoid unlimited bitrate spikes.
 * Final release still requires per-device CPU/decoder and long-play testing.
 */
function videoQualityProfile(kind, override){
 const envName=kind==='live'?'VIDAA_LIVE_VIDEO_PROFILE':'VIDAA_VOD_VIDEO_PROFILE';
 // Source-copy handles supported H.264 live video without re-encoding.
 // VOD compatibility must not force a 1080p film into 720p by default.
 const requested=String(override||Bun.env[envName]||(kind==='live'?'720':'1080')).trim();
 const name=requested==='2160'?'2160':requested==='1080'?'1080':requested==='480'?'480':'720';
 // UHD conversion is strictly opt-in in the isolated preview: at most one 4K
 // encoder, and no upscaling low-resolution sources. Original H264 copy does
 // not require UHD transcoding and keeps true 4K/8K frames if supported.
 return name==='2160'?{name,width:3840,height:2160,maxrate:'20000k',bufsize:'36000k',crf:'18',level:'5.2'}:
  name==='1080'?{name,width:1920,height:1080,maxrate:'8500k',bufsize:'14000k',crf:'18',level:'4.1'}:
  name==='480'?{name,width:854,height:480,maxrate:'1700k',bufsize:'3100k',crf:'21',level:'3.1'}:
  {name,width:1280,height:720,maxrate:'3400k',bufsize:'6400k',crf:'20',level:'4.0'}
}
function compatibleVideoArgs(kind,gopSeconds=1,profileOverride){
 const quality=videoQualityProfile(kind,profileOverride);
 // min(iw)/min(ih) avoids fake upscaling if the source is only SD.
 const filter="scale=w='min(iw,"+quality.width+")':h='min(ih,"+quality.height+")':force_original_aspect_ratio=decrease:force_divisible_by=2";
 return ['-c:v','libx264','-preset',kind==='live'?'superfast':'veryfast',
  '-tune',kind==='live'?'zerolatency':'film',
  '-profile:v','main',...(kind==='live'?['-level',quality.level]:[]),'-pix_fmt','yuv420p',
  '-vf',filter,'-g',String(gopSeconds*25),'-keyint_min',String(gopSeconds*25),
  '-sc_threshold','0','-crf',quality.crf,'-maxrate',quality.maxrate,
  '-bufsize',quality.bufsize]
}


const hlsSessions=new Map();
 // Guarded pilot fan-out: only reuse one source/transcode for viewers who
 // possess exactly the same authenticated bearer, channel, track and mode.
 // Disabled by default; do not combine distinct subscriber credentials.
const sharedLiveGroups=new Map();
 // Pending registrations are per authorized SID. A viewer leaving during
 // upstream-header wait must not be resurrected after the delayed fetch.
const pendingSharedLiveViewers=new Map();
// Per authorized origin/channel failure budget. These identifiers are HMACs
// (not subscriber names, codes or upstream URLs), expire quickly and are capped.
const liveSourceFailureWindows=new Map();
const MAX_LIVE_SOURCE_WINDOWS=256;
const MAX_SHARED_LIVE_VIEWERS=4;
const hlsRoot=join(tmpdir(),'blofy-vidaa-hls-sessions');
/* Anonymous rolling one-minute saturation metrics. Do not store stream IDs,
 * subscriber credentials, hostnames or device identifiers in diagnostics.
 * Health remains HTTP 200 even when capacity is fully occupied; a busy
 * transcoder is not a failed service and must never cause Railway restart.
 */
const encoderCapacityWindow={startedAt:Date.now(),denied:0};
function capacityWindowDenied(now=Date.now()){
 if(now-encoderCapacityWindow.startedAt>=60000||now<encoderCapacityWindow.startedAt){
  encoderCapacityWindow.startedAt=now;encoderCapacityWindow.denied=0
 }
 return encoderCapacityWindow.denied
}
function noteEncoderCapacityDenied(){
 capacityWindowDenied();
 encoderCapacityWindow.denied=Math.min(100000,encoderCapacityWindow.denied+1)
}
function encoderCapacitySnapshot(now=Date.now()){
 const counts={live:0,legacyVod:0,fullVod:0,compatible:0};
 for(const session of hlsSessions.values()){
  if(session.stopped||session.released||session.sharedAlias)continue;
  if(session.fullVod)counts.fullVod++;
  else if(session.kind==='live')counts.live++;
  else counts.legacyVod++
 }
 // The direct /convert path deliberately does not retain access tokens in
 // session maps. Its active slots are the residual, not a customer counter.
 counts.compatible=Math.max(0,active-counts.live-counts.legacyVod-counts.fullVod);
 return {
  activeJobs:active,limit:MAX_JOBS,
  freeSlots:Math.max(0,MAX_JOBS-active),
  busy:active>=MAX_JOBS,
  deniedLastMinute:capacityWindowDenied(now),
  jobKinds:counts
 }
}
const hardTTL=9*60*1000;
function hlsKey(bearer,kind,id,ext,track,forceCompat,ultra=false,viewerSid=''){
 const fields=[bearer,kind,id,ext,track];
 // Each authorized viewer owns only its own HLS decoder. Without an SID,
 // stopping one tab with the same subscription kills the other tab's stream.
 // Empty SID preserves old preview clients without breaking existing URLs.
 if(viewerSid)fields.push('sid:'+viewerSid);
 if(ultra)fields.push('ultra');
 else if(forceCompat)fields.push('compat');
 return createHmac('sha256',SECRET).update(fields.join('\x00')).digest('hex').slice(0,40)
}
function liveSourceIdentity(bearer,kind,id,ext,track,forceCompat,ultra){
 return hlsKey(bearer,kind,id,ext,track,forceCompat,ultra,'');
}
function liveSourceRetryMs(identity,now=Date.now()){
 const entry=liveSourceFailureWindows.get(identity);
 if(!entry)return 0;
 if(now-entry.lastAt>120000){
  liveSourceFailureWindows.delete(identity);
  return 0
 }
 return Math.max(0,entry.retryAt-now)
}
function recordLiveSourceFailure(session,reason,now=Date.now()){
 if(session.kind!=='live'||!session.sourceIdentity)return;
 if(!['live_source_finished','stale_manifest','ffmpeg_no_playlist','process_crashed',
  'fetch_or_spawn_error','hls_source_failed','live_no_initial_segment'].includes(reason)&&!/^upstream_5[0-9]{2}$/.test(reason))return;
 const key=session.sourceIdentity,old=liveSourceFailureWindows.get(key);
 const repeated=old&&now-old.lastAt<120000&&now-session.startedAt<90000;
 const failures=repeated?Math.min(6,old.failures+1):1;
 const delay=Math.min(30000,1600*Math.pow(2,failures-1));
 if(liveSourceFailureWindows.has(key))liveSourceFailureWindows.delete(key);
 liveSourceFailureWindows.set(key,{failures,lastAt:now,retryAt:now+delay});
 // A bounded memory budget prevents huge catalogs from retaining per-code keys.
 if(liveSourceFailureWindows.size>MAX_LIVE_SOURCE_WINDOWS)
  liveSourceFailureWindows.delete(liveSourceFailureWindows.keys().next().value)
}
function noteLiveSourceHealthy(session,now=Date.now()){
 if(session.kind==='live'&&session.sourceIdentity&&now-session.startedAt>90000)
  liveSourceFailureWindows.delete(session.sourceIdentity)
}
function touchHls(session){
 session.lastAccess=Date.now();if(session.idleTimer)clearTimeout(session.idleTimer);
 // The old fixed 9-minute timer killed active live streams even as viewers
 // kept fetching HLS segments. Refresh the guard only for legacy HLS sessions;
 // idle timeout still releases abandoned sessions after 110 seconds.
 if(session.legacyHls&&session.hardTimer){
  clearTimeout(session.hardTimer);
  session.hardTimer=setTimeout(()=>stopHls(session,'session_expired'),hardTTL);
  session.hardTimer.unref?.();
 }
 // Full-duration VOD generates chunks only on demand. Pausing longer than
 // two minutes must not invalidate its segment URL when playback resumes.
 const idleMs=session.fullVod?25*60*1000:110000;
 session.idleTimer=setTimeout(()=>stopHls(session,'idle_timeout'),idleMs);
 session.idleTimer.unref?.();
}
function stopHls(session,reason){
 if(!session||session.stopped)return;
 if(!session.sharedAlias)recordLiveSourceFailure(session,reason);
 if(session.sharedAlias){
  // A viewer-specific stop drops one ref, NEVER another viewer's decoder.
  session.stopped=true;
  if(session.idleTimer)clearTimeout(session.idleTimer);
  if(session.hardTimer)clearTimeout(session.hardTimer);
  if(hlsSessions.get(session.key)===session)hlsSessions.delete(session.key);
  const group=session.sharedGroup;
  if(group){
   group.viewers.delete(session.key);
   if(!group.stopping&&group.viewers.size===0&&(!group.pendingViewers||group.pendingViewers.size===0)&&group.producer){
    stopHls(group.producer,'last_shared_viewer')
   }
  }
  return
 }
 if(session.sharedProducerRoot){
  const group=session.sharedGroup;
  if(group){
   // Stale-source detection / worker exit evicts all aliases exactly once.
   group.stopping=true;
   if(sharedLiveGroups.get(group.key)===group)sharedLiveGroups.delete(group.key);
   for(const pending of group.pendingViewers||[]){
    pending.cancelled=true;
    if(pendingSharedLiveViewers.get(pending.key)===pending)pendingSharedLiveViewers.delete(pending.key)
   }
   if(group.pendingViewers)group.pendingViewers.clear();
   for(const viewerKey of Array.from(group.viewers)){
    const viewer=hlsSessions.get(viewerKey);
    if(viewer&&viewer.sharedGroup===group)stopHls(viewer,'shared_source_ended')
   }
   group.viewers.clear()
  }
 }
 session.stopped=true;
 if(session.idleTimer)clearTimeout(session.idleTimer);
 if(session.hardTimer)clearTimeout(session.hardTimer);
 if(session.chunkTimer){clearTimeout(session.chunkTimer);session.chunkTimer=null}
 // A delayed stop can race a newer same-key session. The map belongs to
 // the newer session, while this session's uniquely named temp dir remains
 // safe to clean independently.
 const ownsKey=hlsSessions.get(session.key)===session;
 if(ownsKey)hlsSessions.delete(session.key);
 try{session.abort.abort()}catch{}
 try{session.sourceController?.abort()}catch{}
 // All real FFmpeg jobs (live, VOD and compatibility HLS) own their
 // CPU slot until the process actually exits. Releasing just after SIGTERM
 // lets rapid stop/reopen churn exceed MAX_JOBS while old encoders linger.
 const running=session.proc&&!session.finished&&!session.released?session.proc:null;
 try{session.proc?.kill()}catch{}
 const cleanup=()=>{
  releaseHls(session);
  // Do not remove a chunk directory while its encoder might still be
  // writing into it. Access is already denied because the SID is removed.
  try{rmSync(session.dir,{recursive:true,force:true})}catch{}
 };
 if(running&&running.exited&&typeof running.exited.then==='function'){
  // If FFmpeg ignores SIGTERM, escalate, but never declare capacity free
  // while its process could still be alive.
  const killTimer=setTimeout(()=>{
   try{running.kill(9)}catch{}
  },2500);killTimer.unref?.();
  Promise.resolve(running.exited).then(()=>{
   clearTimeout(killTimer);cleanup()
  },()=>{
   clearTimeout(killTimer);cleanup()
  });
 }else cleanup();
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
function hlsError(status,error,retryAfterSeconds=0){
 const seconds=Math.max(0,Math.min(30,Number(retryAfterSeconds)||0));
 if(seconds)return new Response(JSON.stringify({ok:false,error,retryAfterSeconds:seconds}),
  {status,headers:{'Content-Type':'application/json','Cache-Control':'no-store, private','Retry-After':String(seconds)}});
 return json(status,{ok:false,error})
}
/* An FFmpeg pipe can stay open after upstream stops emitting packets.
 * The previous playlist keeps returning 200 and fools a TV into waiting
 * indefinitely. Detect stale LIVE output, then close its source and encoder;
 * the next authenticated manifest GET creates a fresh session.
 * Do not affect finite movie/series manifests or healthy live streams.
 */
/* MPEG-TS HLS has a sliding playlist. Waiting 8 seconds for a segment
 * which is already older than #EXT-X-MEDIA-SEQUENCE cannot succeed.
 * Return 410 promptly so the browser can jump to the live edge; don't
 * confuse this condition with a dead upstream or restart FFmpeg.
 */
function expiredLiveSegment(session,filename){
 if(!session||session.kind!=='live'||session.stopped||!/^seg-[0-9]{6}\.ts$/.test(filename))return false;
 try{
  if(existsSync(join(session.dir,filename)))return false;
  const manifestPath=join(session.dir,'index.m3u8');
  if(!existsSync(manifestPath))return false;
  const playlist=String(readFileSync(manifestPath,'utf8'));
  const seq=playlist.match(/^#EXT-X-MEDIA-SEQUENCE:\s*([0-9]+)\s*$/m);
  const first=playlist.match(/seg-([0-9]{6})\.ts/);
  const earliest=seq?Number(seq[1]):first?Number(first[1]):NaN;
  return Number.isSafeInteger(earliest)&&Number(filename.slice(4,10))<earliest
 }catch{return false}
}
/* HLS.js cannot render a video from a bare #EXTM3U without any playable TS
 * chunk. FFmpeg sometimes writes an initial index before the first segment
 * has been atomically renamed out of *.tmp, or keeps an empty index while
 * the upstream source sends no packets. Never return 200 for such an index.
 * The first playable TS is bounded by the original manifest request's
 * deadline; we do not wait 25s a second time after awaitHlsFile().
 */
function liveManifestHasPlayableSegment(session){
 if(!session||session.stopped)return false;
 const path=join(session.dir,'index.m3u8');
 try{
  if(!existsSync(path))return false;
  const playlist=String(readFileSync(path,'utf8'));
  if(!playlist.startsWith('#EXTM3U'))return false;
  const lines=playlist.split(/\r?\n/);
  // Only complete standalone relative TS lines produced by this worker.
  // Ignore HLS comments and an incomplete .ts.tmp being written by FFmpeg.
  return lines.some(line=>/^seg-[0-9]{6}\.ts$/.test(line)&&existsSync(join(session.dir,line)))
 }catch{return false}
}
async function awaitPlayableLiveManifest(session,signal,deadlineMs){
 while(Date.now()<deadlineMs){
  if(session.stopped||signal?.aborted)return 'cancelled';
  if(liveManifestHasPlayableSegment(session))return 'ready';
  if(session.finished)return 'finished';
  await nap(180)
 }
 if(session.stopped||signal?.aborted)return 'cancelled';
 return liveManifestHasPlayableSegment(session)?'ready':session.finished?'finished':'timeout'
}
function staleLiveManifest(session,filename,now){
 if(!session||session.kind!=='live'||session.stopped||!filename)return false;
 try{
  const timestamp=statSync(filename).mtimeMs;
  return Number.isFinite(timestamp)&&now-Math.max(timestamp,session.startedAt)>23000
 }catch{return false}
}
/**
 * Inspect a small, bounded TS prefix without consuming or discarding packets.
 * H.264 can be repackaged into HLS MPEG-TS without changing a single frame.
 * Non-TS/HEVC/unknown inputs still take the compatibility transcoder.
 * The input returned here replays every prefetched byte before continuing.
 */
async function selectSourcePreservingInput(body,allowCopy){
 if(!allowCopy||!body||typeof body.getReader!=='function')
  return {input:body,copyVideo:false,detected:'not_applicable'};
 const reader=body.getReader(),prefix=[];
 let bytes=0,readCount=0,codec={video:false,audio:false},ended=false;
 try{
  while(bytes<188*320&&readCount<24){
   const part=await reader.read();readCount++;
   if(part.done){ended=true;break}
   if(part.value&&part.value.byteLength){
    prefix.push(part.value);bytes+=part.value.byteLength;
    codec=tsCodecs(concatTsProbe(prefix,bytes));
    if(codec.video)break
   }
  }
 }catch(e){
  // Do not discard the prefix even if the upstream stream stops abruptly.
  ended=true
 }
 let next=0;
 const input=new ReadableStream({
  async pull(controller){
   if(next<prefix.length){controller.enqueue(prefix[next++]);return}
   if(ended){controller.close();return}
   try{
    const part=await reader.read();
    if(part.done){ended=true;controller.close();return}
    controller.enqueue(part.value)
   }catch(e){controller.error(e)}
  },
  cancel(reason){return reader.cancel(reason).catch(()=>{})}
 });
 return {input,copyVideo:!!codec.video,detected:codec.video?'h264_transport':'needs_transcode'}
}
function concatTsProbe(chunks,total){
 const out=new Uint8Array(total);let offset=0;
 for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.byteLength}
 return out
}

/* Source resolution is measured from FFmpeg's input stream declaration,
 * NOT guessed from a channel label or the transcoded output. Only a numeric,
 * sanitized width × height is ever forwarded to the browser.
 */
function streamInputVideoDimensions(log){
 const input=String(log||'').split(/Output #0|Stream mapping:/)[0];
 const lines=input.split(/\r?\n/);
 for(const line of lines){
  if(!/Stream #0:\d+.*Video:/i.test(line))continue;
  const match=line.match(/(?:^|[,\s])(\d{2,4})x(\d{2,4})(?:[\s,\[]|$)/);
  if(!match)continue;
  const w=Number(match[1]),h=Number(match[2]);
  if(w>=160&&w<=8192&&h>=120&&h<=4320)return w+'x'+h
 }
 return ''
}

async function startHls({bearer,kind,id,ext,track,key,forceCompat=false,ultra=false}){
 if(active>=MAX_JOBS){noteEncoderCapacityDenied();return {error:'hls_capacity',status:429}}
 // A 4K software encoder can exhaust CPU and harm other preview viewers.
 // The full server has only two encoding slots; allow one UHD job at a time.
 if(ultra&&Array.from(hlsSessions.values()).some(s=>s.ultra&&!s.stopped)){
  noteEncoderCapacityDenied();return {error:'ultra_capacity',status:429}
 }
 // One unique directory per decoder instance; a retired FFmpeg process
 // cannot overwrite a fresh channel playlist while it is shutting down.
 const abort=new AbortController(),dir=join(hlsRoot,key+'-'+randomBytes(6).toString('hex'));
 // A failed directory allocation must not consume an encoder slot.
 try{mkdirSync(dir,{recursive:true})}catch{return {error:'hls_storage_unavailable',status:503}}
 active++;
 const session={key,kind,id,ext,track,dir,abort,ultra:!!ultra,startedAt:Date.now(),stopped:false,released:false,finished:false,proc:null,lastAccess:Date.now(),error:null,legacyHls:true,
  sourceIdentity:kind==='live'?liveSourceIdentity(bearer,kind,id,ext,track,forceCompat,ultra):''};
 hlsSessions.set(key,session);
 touchHls(session);
 session.hardTimer=setTimeout(()=>stopHls(session,'session_expired'),hardTTL);
 session.hardTimer.unref?.();
 const target=BASE+kind+'/'+id+'.'+ext;
 try{
  const controller=new AbortController();session.sourceController=controller;
  // A stop during the upstream header wait must cancel that fetch as well.
  // Without this, a late response can spawn FFmpeg after the viewer leaves.
  const abortSource=()=>controller.abort();
  session.abort.signal.addEventListener('abort',abortSource,{once:true});
  const timeout=setTimeout(()=>controller.abort(),16000);
  let upstream;
  try{upstream=await fetch(target,{method:'GET',headers:{Authorization:bearer,Accept:'*/*','accept-encoding':'identity'},redirect:'manual',signal:controller.signal})}
  finally{clearTimeout(timeout)}
  if(session.stopped||hlsSessions.get(key)!==session){
   try{await upstream.body?.cancel()}catch{}
   return {error:'hls_start_cancelled',status:409}
  }
  if(!upstream.ok||!upstream.body){const status=upstream.status;try{await upstream.body?.cancel()}catch{};stopHls(session,'upstream_'+status);return {error:status===401?'invalid_session':status===404?'media_missing':status>=300&&status<400?'media_redirect_unsupported':'media_upstream_error',status:status===401?401:502}}
  // Experimental continuity for ONE preapproved channel + bearer access ID.
  // All subsequent requests use the exact same first-party authorized URL.
  // Disabled in normal previews; strict guard prevents a single env flag
  // from turning on extra provider connections for every subscriber.
  const resumePilot=allowedSingleViewerLiveTsContinuity({
   enabled:Bun.env.VIDAA_LIVE_TS_CONTINUITY_PILOT==='1',
   kind,id,ext,bearer,
   approvedChannelId:Bun.env.VIDAA_LIVE_TS_CONTINUITY_CHANNEL_ID||'',
   approvedAccessId:Bun.env.VIDAA_LIVE_TS_CONTINUITY_ACCESS_ID||''
  });
  const sourceBody=resumePilot?liveTsSameSourceContinuity({
   firstBody:upstream.body,clientSignal:controller.signal,
   fetchSameSource:signal=>fetch(target,{method:'GET',headers:{
    Authorization:bearer,Accept:'*/*','accept-encoding':'identity'
   },redirect:'manual',signal}),
   onEvent:event=>console.info('VIDAA_LIVE_TS_CONTINUITY',
    JSON.stringify({phase:event.phase,cause:event.cause,
     lifetimeSeconds:event.lifetimeSeconds??null,
     gapMs:event.gapMs??null,attempt:event.attempt??null}))
  }):upstream.body;
  // Some providers respond with HTTP 200 headers but never deliver a TS
  // packet. The H.264 prefix probe would otherwise await reader.read()
  // forever, pinning a worker slot and keeping the client's manifest open.
  // Use the same bounded startup budget as Hls.js; do not launch FFmpeg
  // after the source was explicitly aborted.
  const probeMs=kind==='live'?Math.max(500,27000-(Date.now()-session.startedAt)):27000;
  const probeTimer=setTimeout(()=>controller.abort(),probeMs);
  probeTimer.unref?.();
  let sourceInput;
  try{sourceInput=await selectSourcePreservingInput(sourceBody,!forceCompat&&kind==='live'&&ext==='ts')}
  finally{clearTimeout(probeTimer)}
  if(controller.signal.aborted){
   try{await sourceInput.input.cancel()}catch{}
   stopHls(session,'live_no_initial_segment');
   return {error:'hls_source_probe_timeout',status:503}
  }
  if(session.stopped||hlsSessions.get(key)!==session){
   try{await sourceInput.input.cancel()}catch{}
   return {error:'hls_start_cancelled',status:409}
  }
  // Stream-copy genuine H.264 live video; it avoids the 720p ceiling and
  // removes the lossy second encoding. Only AAC needs compatibility encoding.
  const losslessVideo=!forceCompat&&sourceInput.copyVideo;
  session.videoMode=losslessVideo?'source_copy':ultra?'ultra_transcode':'compatibility_transcode';
  const videoArgs=losslessVideo?['-c:v','copy']:compatibleVideoArgs(kind,1,ultra?'2160':undefined);
  const args=['-hide_banner','-loglevel','info','-nostats','-nostdin','-analyzeduration','1200000','-probesize','1200000','-fflags','+genpts','-i','pipe:0',
   '-map','0:v:0','-map','0:a:'+track+'?',...videoArgs,
   // Correct audio PTS discontinuities by inserting/dropping samples rather
   // than changing playback rate and making speech sound oddly pitched.
   '-af','aresample=async=1:min_hard_comp=0.100:first_pts=0',
   '-c:a','aac','-profile:a','aac_low','-b:a','160k','-ac','2','-ar','48000',
   '-f','hls','-hls_time','1','-hls_segment_type','mpegts','-hls_segment_filename',join(dir,'seg-%06d.ts')];
  if(kind==='live')args.push('-hls_list_size',String(LIVE_WINDOW_SEGMENTS),'-hls_delete_threshold','24','-hls_flags','delete_segments+independent_segments+temp_file');
  else args.push('-hls_list_size','0','-hls_playlist_type','event','-hls_flags','independent_segments');
  args.push(join(dir,'index.m3u8'));
  if(session.stopped||hlsSessions.get(key)!==session){
   try{await upstream.body?.cancel()}catch{}
   return {error:'hls_start_cancelled',status:409}
  }
  const proc=Bun.spawn([FFMPEG,...args],{stdin:sourceInput.input,stdout:'ignore',stderr:'pipe',signal:abort.signal});
  console.info('BLOFY_LIVE_VIDEO_MODE',{kind,mode:session.videoMode,sourceCodec:sourceInput.detected});
  session.proc=proc;
  (async()=>{try{
   const stream=proc.stderr?.getReader?.();if(!stream)return;
   const decoder=new TextDecoder();
   while(true){
    const part=await stream.read();if(part.done)break;
    if(session.ffmpegInfo&&session.ffmpegInfo.length>=18000)continue;
    session.ffmpegInfo=(session.ffmpegInfo||'')+decoder.decode(part.value,{stream:true});
    if(session.ffmpegInfo.length>18000)session.ffmpegInfo=session.ffmpegInfo.slice(0,18000);
    if(!session.sourceDimensions)session.sourceDimensions=streamInputVideoDimensions(session.ffmpegInfo)
   }
  }catch{}})();
  proc.exited.then(code=>{
   session.abort.signal.removeEventListener('abort',abortSource);
   try{controller.abort()}catch{}
   session.sourceController=null;
   session.finished=true;
   if(session.stopped||hlsSessions.get(key)!==session){releaseHls(session);return}
   if(code!==0){
    const err=session.ffmpegInfo||'';
    session.error=/Stream map|matches no streams/i.test(err)?'source_missing_video':/Invalid data/i.test(err)?'invalid_source_data':/encoder/i.test(err)?'encoder_failure':'transcode_error';
    console.warn('VIDAA_HLS_FFMPEG_EXIT',{kind,code,reason:session.error})
   }
   if(!existsSync(join(dir,'index.m3u8'))){session.error=session.error||'ffmpeg_no_playlist';stopHls(session,session.error)}
   else {releaseHls(session);touchHls(session)}
  }).catch(()=>{session.finished=true;session.error='process_crashed';stopHls(session,session.error)});
  return {session};
 }catch(err){stopHls(session,'fetch_or_spawn_error');return {error:'hls_start_failed',status:502}}
}

/* Preview-only fan-out with per-bearer authorization boundaries. Each viewer
 * has an independent HLS URL/SID, idle timer, and STOP, but the same
 * authorized account/channel/mode can read one shared on-disk HLS producer.
 * Never share across different bearers, audio tracks or conversion modes.
 * Opt in explicitly using VIDAA_LIVE_SHARE_SAME_BEARER=1; off by default.
 */
function liveShareGroupKey(bearer,kind,id,ext,track,forceCompat,ultra){
 return hlsKey(bearer,kind,id,ext,track,forceCompat,ultra,'')+'-shared-producer'
}
function liveShareAllowed(kind,viewerSid){
 return kind==='live'&&/^[a-f0-9]{32}$/.test(viewerSid||'')&&
  String(Bun.env.VIDAA_LIVE_SHARE_SAME_BEARER||'')==='1'
}
function attachSharedLiveViewer(group,{key,kind,id,ext,track}){
 if(group.stopping||!group.producer||group.producer.stopped)return {error:'shared_source_unavailable',status:503};
 // Two concurrent initial manifests for one SID must reuse the same alias.
 // Replacing it would let its old idle timer evict this newer valid viewer.
 const existing=hlsSessions.get(key);
 if(existing&&!existing.stopped&&existing.sharedGroup===group){
  touchHls(existing);touchHls(group.producer);
  return {session:existing}
 }
 if(group.viewers.size>=MAX_SHARED_LIVE_VIEWERS)return {error:'shared_viewers_capacity',status:429};
 const owner=group.producer;
 const session={key,kind,id,ext,track,dir:owner.dir,startedAt:Date.now(),
  stopped:false,sharedAlias:true,sharedGroup:group,sharedProducer:owner,legacyHls:false,
  firstSegmentLogged:false,lastAccess:Date.now()};
 hlsSessions.set(key,session);
 group.viewers.add(key);
 touchHls(session);
 touchHls(owner);
 return {session}
}
function cancelPendingSharedLiveViewer(key){
 const registration=pendingSharedLiveViewers.get(key);
 if(!registration)return false;
 registration.cancelled=true;
 pendingSharedLiveViewers.delete(key);
 const group=registration.group;
 group.pendingViewers.delete(registration);
 // Close a pending source immediately if nobody else is still watching
 // or joining. Abort the upstream-header fetch rather than waiting 16 sec.
 if(!group.stopping&&group.viewers.size===0&&group.pendingViewers.size===0){
  group.stopping=true;
  if(sharedLiveGroups.get(group.key)===group)sharedLiveGroups.delete(group.key);
  const producer=group.producer||hlsSessions.get(group.key);
  if(producer)stopHls(producer,'last_pending_viewer')
 }
 return true
}
async function startSharedLiveViewer({bearer,kind,id,ext,track,key,viewerSid,forceCompat=false,ultra=false}){
 if(!liveShareAllowed(kind,viewerSid))return {error:'sharing_disabled',status:503};
 const groupKey=liveShareGroupKey(bearer,kind,id,ext,track,forceCompat,ultra);
 let group=sharedLiveGroups.get(groupKey);
 if(group&&group.producer&&(group.producer.finished||group.producer.stopped)){
  // A detached FFmpeg process must never be inherited by a fresh viewer.
  stopHls(group.producer,'shared_source_finished');
  group=null
 }
 if(!group){
  group={key:groupKey,viewers:new Set(),pendingViewers:new Set(),producer:null,stopping:false,pending:null};
  sharedLiveGroups.set(groupKey,group);
  // Register the pending promise BEFORE awaiting headers from the upstream.
  // Concurrent viewers must never start two FFmpeg jobs for one group.
  group.pending=startHls({bearer,kind,id,ext,track,key:groupKey,forceCompat,ultra})
   .then(result=>{
    if(result.error||!result.session||result.session.stopped){
     if(sharedLiveGroups.get(groupKey)===group)sharedLiveGroups.delete(groupKey);
     return result.error?result:{error:'shared_source_stopped',status:503}
    }
    group.producer=result.session;
    group.producer.sharedProducerRoot=true;
    group.producer.sharedGroup=group;
    return result
   }).catch(()=>{
    if(sharedLiveGroups.get(groupKey)===group)sharedLiveGroups.delete(groupKey);
    return {error:'shared_source_failed',status:502}
   })
 }
 // Multiple requests by the same SID share one pending cancellation handle.
 // Cap queued joiners too, not just attached viewers, against request floods.
 let registration=pendingSharedLiveViewers.get(key);
 if(!registration||registration.group!==group){
  if(group.viewers.size+group.pendingViewers.size>=MAX_SHARED_LIVE_VIEWERS)
   return {error:'shared_viewers_capacity',status:429};
  registration={key,group,cancelled:false};
  pendingSharedLiveViewers.set(key,registration);
  group.pendingViewers.add(registration)
 }
 const started=await group.pending;
 group.pendingViewers.delete(registration);
 if(pendingSharedLiveViewers.get(key)===registration)pendingSharedLiveViewers.delete(key);
 if(registration.cancelled||group.stopping||started.error){
  if(!group.stopping&&group.viewers.size===0&&group.pendingViewers.size===0&&group.producer)
   stopHls(group.producer,'no_shared_viewers');
  return registration.cancelled?{error:'hls_start_cancelled',status:409}:
   started.error?started:{error:'shared_source_stopped',status:503}
 }
 return attachSharedLiveViewer(group,{key,kind,id,ext,track})
}

async function hlsRequest(req,url){
 if(!SECRET||!secureEquals(req.headers.get('x-compat-secret'),SECRET))return hlsError(403,'forbidden');
 const stop=url.pathname.match(/^\/hls\/(live|movie|series)\/([1-9][0-9]{0,14})\/(ts|mkv|mp4|avi|mov)\/([0-3])\/(?:sid-([a-f0-9]{32})\/)?(?:(compat|ultra)\/)?stop$/);
 if(req.method==='POST'&&stop){
  const bearer=req.headers.get('authorization')||'';
  if(!/^Bearer v1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/.test(bearer))return hlsError(401,'authorization_missing');
  const key=hlsKey(bearer,stop[1],stop[2],stop[3],stop[4],!!stop[6],stop[6]==='ultra',stop[5]||'');
  const activeSession=hlsSessions.get(key);
  if(activeSession)stopHls(activeSession,'viewer_stopped');
  else cancelPendingSharedLiveViewer(key);
  return json(200,{ok:true});
 }
 if(req.method!=='GET')return hlsError(405,'method_not_allowed');
 if(!SECRET||!secureEquals(req.headers.get('x-compat-secret'),SECRET))return hlsError(403,'forbidden');
 const match=url.pathname.match(/^\/hls\/(live|movie|series)\/([1-9][0-9]{0,14})\/(ts|mkv|mp4|avi|mov)\/([0-3])\/(?:sid-([a-f0-9]{32})\/)?(?:(compat|ultra)\/)?(index\.m3u8|seg-[0-9]{6}\.ts)$/);
 if(!match)return hlsError(404,'hls_invalid_resource');
 const bearer=req.headers.get('authorization')||'';
 if(!/^Bearer v1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/.test(bearer))return hlsError(401,'authorization_missing');
 const [whole,kind,id,ext,track,viewerSid,compat,filename]=match;
 // The browser sets 30s for manifests; include source headers, FFmpeg
 // startup, index creation AND a real TS chunk in one 27.5s deadline.
 const manifestDeadline=kind==='live'&&filename==='index.m3u8'?Date.now()+27500:0;
 const key=hlsKey(bearer,kind,id,ext,track,!!compat,compat==='ultra',viewerSid||'');
 let sess=hlsSessions.get(key);
 if(!sess&&filename!=='index.m3u8')return hlsError(404,'hls_session_missing');
 if(!sess){
  const args={bearer,kind,id,ext,track,key,viewerSid,forceCompat:!!compat,ultra:compat==='ultra'};
  // Prevent a source that closes immediately from being reopened dozens
  // of times a minute. Other accounts/channels are never throttled.
  const group=liveShareAllowed(kind,viewerSid)?
   sharedLiveGroups.get(liveShareGroupKey(bearer,kind,id,ext,track,!!compat,compat==='ultra')):null;
  if(kind==='live'&&!group){
   const wait=liveSourceRetryMs(liveSourceIdentity(bearer,kind,id,ext,track,!!compat,compat==='ultra'));
   if(wait>0)return hlsError(503,'hls_origin_backoff',Math.ceil(wait/1000))
  }
  const start=liveShareAllowed(kind,viewerSid)?await startSharedLiveViewer(args):await startHls(args);
  if(start.error)return hlsError(start.status,start.error,start.status===429?5:0);
  sess=start.session
 }
 // Aliases have their own auth/SID and idle timer; only the producer owns
 // FFmpeg, its playlist/segment files and source/decoder errors.
 const owner=sess.sharedProducer||sess;
 touchHls(sess);
 if(owner!==sess)touchHls(owner);
 if(kind==='live'&&expiredLiveSegment(owner,filename))
  return hlsError(410,'hls_segment_evicted');
 const ready=await awaitHlsFile(owner,filename,manifestDeadline?
  Math.max(0,manifestDeadline-Date.now()):
  filename==='index.m3u8'?25000:8000);
 if(ready&&manifestDeadline){
  const playable=await awaitPlayableLiveManifest(owner,req.signal,manifestDeadline);
  if(playable!=='ready'){
   if(req.signal?.aborted)return hlsError(410,'hls_request_cancelled');
   if(playable==='cancelled')return hlsError(503,'hls_session_closed',2);
   if(!owner.stopped){
    // A new source that never delivered even one playable segment may
    // otherwise occupy an FFmpeg slot indefinitely as the TV keeps polling.
    if(!owner.hadPlayableLiveManifest)
     stopHls(owner,playable==='finished'?'live_source_finished':'live_no_initial_segment');
    else if(staleLiveManifest(owner,join(owner.dir,filename),Date.now()))
     stopHls(owner,'stale_manifest')
   }
   return hlsError(503,playable==='finished'?'hls_source_finished':
    'hls_live_segment_not_ready',2)
  }
  owner.hadPlayableLiveManifest=true
 }
 if(ready&&/^seg-\d{6}\.ts$/.test(filename)&&!sess.firstSegmentLogged){
  sess.firstSegmentLogged=true;
  console.info('VIDAA_HLS_FIRST_SEGMENT',{kind:sess.kind,elapsedMs:Date.now()-sess.startedAt});
 }
 if(!ready){
  if(manifestDeadline&&req.signal?.aborted)return hlsError(410,'hls_request_cancelled');
  if(manifestDeadline&&!owner.stopped&&!owner.hadPlayableLiveManifest){
   // Covers an upstream HTTP stream that never produced even index.m3u8.
   // Once the first playable-video deadline passes, free its slot and
   // apply the same source-specific backoff as a bare/empty manifest.
   stopHls(owner,'live_no_initial_segment');
   return hlsError(503,'hls_live_segment_not_ready',2)
  }
  if(kind==='live'&&expiredLiveSegment(owner,filename))
   return hlsError(410,'hls_segment_evicted');
  return hlsError(owner.error?502:504,owner.error||'hls_segment_timeout')
 }
 if(filename==='index.m3u8'&&kind==='live'&&owner.finished){
  stopHls(owner,'live_source_finished');
  return hlsError(503,'hls_source_finished')
 }
 if(filename==='index.m3u8'&&staleLiveManifest(owner,join(owner.dir,filename),Date.now())){
  console.warn('VIDAA_LIVE_MANIFEST_STALLED',{kind:owner.kind,mode:owner.videoMode||'unknown'});
  stopHls(owner,'stale_manifest');
  return hlsError(503,'hls_source_stalled');
 }
 try{
  const path=join(owner.dir,filename),playlist=filename==='index.m3u8';
  const statusHeaders={'X-Blofy-Video-Mode':owner.videoMode||'unknown',
   'X-Blofy-Source-Resolution':owner.sourceDimensions||'unknown'};
  if(!playlist){
   const streamed=await streamMediaFile(path,'video/mp2t','no-store, private',statusHeaders);
   if(streamed&&kind==='live')noteLiveSourceHealthy(owner);
   return streamed||hlsError(503,'hls_segment_unavailable')
  }
  const data=readFileSync(path);
  if(!data.length)return hlsError(503,'hls_file_empty');
  return new Response(data,{status:200,headers:{
   'Content-Type':'application/vnd.apple.mpegurl','Cache-Control':'no-store, private',
   'X-Content-Type-Options':'nosniff',...statusHeaders
  }})
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
 // Some upstream servers stall before responding with headers. Only bound
 // the header wait; an active 24-second chunk must stream without a fixed
 // total response deadline.
 const controller=new AbortController();
 req.signal.addEventListener('abort',()=>controller.abort(),{once:true});
 const headerDeadline=setTimeout(()=>controller.abort(),17000);
 let res;
 try{
  res=await fetch(target,{method:req.method,headers,redirect:'manual',signal:controller.signal});
 }catch(e){
  return json(502,{error:controller.signal.aborted&&!req.signal.aborted?'upstream_source_headers_timeout':'upstream_source_unavailable'})
 }finally{clearTimeout(headerDeadline)}
 try{
  if(res.status>=300&&res.status<400){try{await res.body?.cancel()}catch{};return json(502,{error:'upstream_redirect_rejected'})}
  if(!res.ok){try{await res.body?.cancel()}catch{}
   return json(res.status===416?416:res.status===401||res.status===403?res.status:502,
    {error:res.status===416?'vod_source_range_unavailable':res.status===401||res.status===403?'source_authorization_failed':'upstream_source_unavailable'})
  }
  // Do not pretend a seek succeeded if the source ignored a nonzero byte-range.
  // It would otherwise replay the beginning while the UI shows a later timestamp.
  const offset=range&&/^bytes=(\d+)-/.exec(range);
  if(offset&&Number(offset[1])>0){
   if(res.status!==206){try{res.body?.cancel()}catch{};return json(416,{error:'vod_source_range_unavailable'})}
   const contentRange=res.headers.get('content-range')||'';
   if(!contentRange.startsWith('bytes '+offset[1]+'-')){try{res.body?.cancel()}catch{};return json(502,{error:'vod_source_range_mismatch'})}
  }
  const h=new Headers({'Cache-Control':'no-store, private','Content-Type':res.headers.get('content-type')||'application/octet-stream'});
  for(const k of ['content-range','content-length','accept-ranges'])if(res.headers.get(k))h.set(k,res.headers.get(k));
  return new Response(req.method==='HEAD'?null:res.body,{status:res.status,headers:h})
 }catch{return json(502,{error:'upstream_source_unavailable'})}
}
/* VOD duration is parsed from the SAME FFmpeg input stream that feeds playback.
 * An extra ffprobe connection can cause some providers to close the movie stream.
 * The /meta request therefore shares one authorized upstream connection with HLS.
 */
async function startVod({bearer,kind,id,ext,track,start,key}){
 // Replace old legacy transcodes for the SAME title only; never terminate
 // another movie, or a VOD session in use on another page/device.
 for(const s of Array.from(hlsSessions.values())){
  if(!s.vod||s.fullVod||s.key===key||s.bearer!==bearer)continue;
  if(s.kind===kind&&String(s.id)===String(id)&&s.track===track)
   stopHls(s,'legacy_position_changed')
 }
 if(active>=MAX_JOBS){noteEncoderCapacityDenied();return {status:429,error:'vod_capacity'}}
 const abort=new AbortController(),dir=join(hlsRoot,key+'-'+randomBytes(6).toString('hex'));
 // A retired encoder must never delete files belonging to its replacement.
 try{mkdirSync(dir,{recursive:true})}catch{return {error:'vod_storage_unavailable',status:503}}
 active++;
 const session={key,vod:true,kind,id,ext,track,start,bearer,dir,abort,startedAt:Date.now(),stopped:false,released:false,finished:false,proc:null,lastAccess:Date.now(),error:null};
 hlsSessions.set(key,session);
 touchHls(session);
 session.hardTimer=setTimeout(()=>stopHls(session,'session_expired'),4*60*60*1000);
 session.hardTimer.unref?.();
 try{
  const src='http://127.0.0.1:'+Number(Bun.env.PORT||3000)+'/_source/'+key;
  const args=['-hide_banner','-loglevel','info','-nostats','-nostdin','-analyzeduration','2000000','-probesize','2000000',
   '-reconnect','1','-reconnect_streamed','1','-reconnect_on_network_error','1','-reconnect_delay_max','2',
   '-ss',String(start),'-readrate','2','-i',src,
   '-map','0:v:0','-map','0:a:'+track+'?',
   ...compatibleVideoArgs(kind),
   '-c:a','aac','-profile:a','aac_low','-b:a','160k','-ac','2','-ar','48000',
   '-f','hls','-hls_time','1','-hls_segment_type','mpegts',
   '-hls_segment_filename',join(dir,'seg-%06d.ts'),
   '-hls_list_size','0','-hls_playlist_type','event','-hls_flags','independent_segments+temp_file',
   join(dir,'index.m3u8')];
  const proc=Bun.spawn([FFMPEG,...args],{stdin:'ignore',stdout:'ignore',stderr:'pipe',signal:abort.signal});
  session.proc=proc;
  (async()=>{try{
   let buf='';const reader=proc.stderr.getReader();while(true){
    const part=await reader.read();if(part.done)break;
    buf=(buf+new TextDecoder().decode(part.value)).slice(-6000);
    if(!session.sourceDuration){
     const m=/Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(buf);
     if(m){const seconds=Number(m[1])*3600+Number(m[2])*60+Number(m[3]);if(seconds>0&&seconds<172800)session.sourceDuration=Math.round(seconds)}
    }
   }
   if(buf){
    session.error=/Connection reset|ECONNRESET|Connection timed out|Error in the pull function|End of file|premature/i.test(buf)?'vod_upstream_interrupted':
     /404|416|range/i.test(buf)?'vod_source_seek_unsupported':
     /no streams|Invalid data/i.test(buf)?'vod_source_invalid':'vod_encoding_failed'
   }
  }catch{}})();
  proc.exited.then(code=>{
   session.finished=true;session.exitCode=code;releaseHls(session);
   if(code!==0&&!session.stopped){
    console.warn('BLOFY_WEB_VOD_FFMPEG_EXIT',{kind:session.kind,code,reason:session.error||'vod_processing_interrupted'});
    if(!existsSync(join(dir,'index.m3u8')))stopHls(session,'vod_no_playlist')
   }
  }).catch(()=>stopHls(session,'vod_proc_failed'));
  return {session};
 }catch(e){stopHls(session,'vod_spawn_failed');return {status:502,error:'vod_spawn_failed'}}
}
async function vodRequest(req,url){
 if(!SECRET||!secureEquals(req.headers.get('x-compat-secret'),SECRET))return json(403,{error:'forbidden'});
 const match=url.pathname.match(/^\/vod\/(movie|series)\/([1-9][0-9]{0,14})\/(mkv|mp4|avi|mov|ts)\/([0-3])\/([0-9]{1,6})\/(index\.m3u8|seg-[0-9]{6}\.ts|meta|stop)$/);
 if(!match)return json(404,{error:'invalid_vod_path'});
 const [,kind,id,ext,track,rawStart,file]=match,start=Number(rawStart);
 if(!Number.isSafeInteger(start)||start<0||start>172800)return json(400,{error:'invalid_vod_position'});
 const bearer=req.headers.get('authorization')||'';
 if(!/^Bearer v1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/.test(bearer))return json(401,{error:'authorization_missing'});
 const key=vodKey(bearer,kind,id,ext,track,start);
 if(file==='stop'&&req.method==='POST'){const sess=hlsSessions.get(key);if(sess)stopHls(sess,'user_stopped');return json(200,{ok:true})}
 if(req.method!=='GET')return json(405,{error:'method_not_allowed'});
 let sess=hlsSessions.get(key);
 // Recover the same playback position if a previous source connection ended.
 if((file==='index.m3u8'||file==='meta')&&sess&&sess.finished&&sess.exitCode!==0){
  stopHls(sess,'vod_retry_after_interruption');sess=null
 }
 if(!sess&&file!=='index.m3u8'&&file!=='meta')return json(410,{error:'vod_session_expired'});
 if(!sess){const created=await startVod({bearer,kind,id,ext,track,start,key});if(created.error)return created.status===429?hlsError(429,created.error,5):json(created.status||502,{error:created.error});sess=created.session}
 touchHls(sess);
 if(file==='meta'){
  const until=Date.now()+6500;
  while(!sess.sourceDuration&&!sess.finished&&!sess.stopped&&Date.now()<until)await nap(180);
  return json(200,{ok:true,durationSec:sess.sourceDuration||null,reason:sess.sourceDuration?'source_demuxer':'duration_not_available'})
 }
 const success=await awaitHlsFile(sess,file,file==='index.m3u8'?25000:11000);
 if(!success)return json(sess.error?502:504,{error:sess.error||'vod_initial_segment_pending'});
 if(file==='index.m3u8'){
  if(sess.finished&&sess.exitCode!==0)return json(502,{error:sess.error||'vod_processing_interrupted'});
   const manifest=readFileSync(join(sess.dir,'index.m3u8'),'utf8');
  if(!sess.firstSegmentLogged&&/seg-\d{6}\.ts/.test(manifest)){
   sess.firstSegmentLogged=true;
   console.info('BLOFY_WEB_VOD_FIRST_PLAYLIST',{kind:sess.kind,elapsedMs:Date.now()-sess.startedAt});
  }
  const first=(manifest.match(/seg-\d{6}\.ts/)||[])[0];
  if(first&&!existsSync(join(sess.dir,first)))return json(503,{error:'vod_playlist_not_ready'});
 }
 try{
  const path=join(sess.dir,file);
  if(file.endsWith('.ts')){
   const streamed=await streamMediaFile(path,'video/mp2t','no-store, private');
   return streamed||json(503,{error:'vod_segment_unavailable'})
  }
  const content=readFileSync(path);
  return new Response(content,{status:200,headers:{
   'Content-Type':'application/vnd.apple.mpegurl',
   'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff'
  }})
 }catch{return json(502,{error:'vod_segment_unavailable'})}
}


/* Full-length VOD: fixed VOD playlist, indexed on-demand transcoding.
 * Synthetic timeline includes true duration, not a live growing HLS window.
 */
const FULL_SEGMENT_SECONDS=4, FULL_CHUNK_SEGMENTS=6;
function fullVodManifest(duration,sid){
 const count=Math.ceil(duration/FULL_SEGMENT_SECONDS);
 const lines=['#EXTM3U','#EXT-X-VERSION:3','#EXT-X-TARGETDURATION:4',
  '#EXT-X-MEDIA-SEQUENCE:0','#EXT-X-PLAYLIST-TYPE:VOD','#EXT-X-INDEPENDENT-SEGMENTS'];
 for(let i=0;i<count;i++){
  lines.push('#EXTINF:'+Math.min(FULL_SEGMENT_SECONDS,duration-i*FULL_SEGMENT_SECONDS).toFixed(3)+',');
  lines.push('seg-'+String(i).padStart(6,'0')+'.ts'+(sid?'?sid='+sid:''))
 }
 lines.push('#EXT-X-ENDLIST');
 return lines.join('\n')+'\n'
}
function pruneFullVod(session,near){
 // Retain the previous two minutes and next four minutes of transcoded media.
 // The source can be revisited on an absolute seek without storing entire films.
 if(session.prunedAt&&Date.now()-session.prunedAt<10000)return;
 session.prunedAt=Date.now();
 try{
  const min=Math.max(0,near-36),max=near+60;
  for(const file of readdirSync(session.dir)){
   const match=/^seg-(\d{6})\.ts$/.exec(file);
   if(!match)continue;
   const n=Number(match[1]);
   if(n<min||n>max)try{rmSync(join(session.dir,file),{force:true})}catch{}
  }
 }catch{}
}
function scheduleFullVodPrefetch(session,finishedChunk){
 const next=finishedChunk+FULL_CHUNK_SEGMENTS;
 if(session.stopped||session.prefetchNext!==next||!session.finished||
  session.chunkStart!==finishedChunk||session.exitCode!==0||session.error||
  next*FULL_SEGMENT_SECONDS>=session.duration||active>=MAX_JOBS||
  session.prefetchScheduled===next)return false;
 // Avoid speculative source opens while the current encoder is still writing.
 // Trigger at most one adjacent chunk. The viewer must have requested
 // segment 4 or 5 to arm prefetch, so paused titles don't keep converting.
 const last=join(session.dir,'seg-'+String(next-1).padStart(6,'0')+'.ts');
 if(!existsSync(last))return false;
 session.prefetchScheduled=next;
 setTimeout(()=>{
  if(session.prefetchScheduled!==next)return;
  session.prefetchScheduled=null;
  if(session.stopped||session.chunkStart!==finishedChunk||!session.finished||
   session.exitCode!==0||session.error||active>=MAX_JOBS)return;
  const started=fullVodChunk(session,next);
  if(started.error)console.warn('BLOFY_FULL_VOD_PREFETCH_SKIPPED',{kind:session.kind,reason:started.error});
  else console.info('BLOFY_FULL_VOD_PREFETCH',{kind:session.kind,first:next})
 },0);
 return true
}
function fullVodChunk(session,first){
 if(session.proc&&!session.finished&&session.chunkStart===first)return {ok:true};
 // Never "release" a slot on kill() before FFmpeg has actually exited.
 // The active request handler retires a remote-seek encoder and waits for
 // its exit; adjacent prefetch never preempts an unfinished chunk.
 if(session.proc&&!session.finished)
  return {status:503,error:'vod_previous_chunk_draining'};
 if(active>=MAX_JOBS){noteEncoderCapacityDenied();return {status:429,error:'vod_capacity'}}
 const begin=first*FULL_SEGMENT_SECONDS;
 const seconds=Math.min(session.duration-begin,FULL_CHUNK_SEGMENTS*FULL_SEGMENT_SECONDS);
 if(!(seconds>0))return {status:416,error:'vod_out_of_bounds'};
 session.released=false;active++;
 session.finished=false;session.chunkStart=first;session.error=null;session.exitCode=null;session.chunkFinishedAt=0;
 session.retiringProc=null;session.retireEscalated=false;session.retireStartedAt=0;
 session.prefetchNext=null;session.prefetchScheduled=null;
 if(session.chunkTimer){clearTimeout(session.chunkTimer);session.chunkTimer=null}
 pruneFullVod(session,first);
 session.abort=new AbortController();
 const source='http://127.0.0.1:'+Number(Bun.env.PORT||3000)+'/_source/'+session.key;
 const args=['-hide_banner','-loglevel','warning','-nostats','-nostdin','-analyzeduration','2000000','-probesize','2000000',
 '-reconnect','1','-reconnect_streamed','1','-reconnect_on_network_error','1','-reconnect_delay_max','2',
 '-ss',String(begin),'-i',source,'-t',String(seconds),
 '-map','0:v:0','-map','0:a:'+session.track+'?',
 ...compatibleVideoArgs(session.kind,4),'-force_key_frames','expr:gte(t,n_forced*4)',
 '-c:a','aac','-b:a','160k','-ac','2','-ar','48000',
 '-output_ts_offset',String(begin),'-f','hls','-hls_time','4','-hls_segment_type','mpegts',
 '-hls_list_size','0','-hls_playlist_type','vod','-start_number',String(first),
 '-hls_flags','independent_segments+temp_file',
 '-hls_segment_filename',join(session.dir,'seg-%06d.ts'),join(session.dir,'chunk-'+first+'.m3u8')];
 try{
  const proc=Bun.spawn([FFMPEG,...args],{stdin:'ignore',stdout:'ignore',stderr:'pipe',signal:session.abort.signal});
  session.proc=proc;const began=Date.now();
  // Bound a hung upstream or FFmpeg process; two stalled conversions
  // otherwise exhaust the entire pilot's capacity.
  session.chunkTimer=setTimeout(()=>{
   if(session.stopped||session.proc!==proc||session.finished)return;
   session.error='vod_chunk_deadline_exceeded';
   console.warn('BLOFY_FULL_VOD_CHUNK_TIMEOUT',{kind:session.kind,first});
   try{proc.kill()}catch{}
  },75000);
  session.chunkTimer.unref?.();
  (async()=>{try{let buf='';const reader=proc.stderr.getReader();
   while(true){const next=await reader.read();if(next.done)break;buf=(buf+new TextDecoder().decode(next.value)).slice(-2800)}
   if(buf&&session.proc===proc&&!session.error)session.error=/Connection reset|ECONNRESET|end of file|timed out/i.test(buf)?'vod_source_connection_lost':
    /\b416\b|range not satisfiable|source_range_unavailable/i.test(buf)?'vod_source_seek_unsupported':'vod_chunk_processing_failed'
  }catch{}})();
  proc.exited.then(code=>{
   if(session.proc!==proc)return;
   if(session.chunkTimer){clearTimeout(session.chunkTimer);session.chunkTimer=null}
   const retiredOnSeek=session.retiringProc===proc;
   session.retiringProc=null;session.retireStartedAt=0;session.retireEscalated=false;
   session.finished=true;session.exitCode=code;session.chunkFinishedAt=Date.now();
   // The retired chunk is intentionally discarded after a distant seek;
   // do not retry its segment or prefetch from an obsolete position.
   if(retiredOnSeek){
    session.error='vod_chunk_replaced';
    releaseHls(session);
    return
   }
   // Source metadata can overstate runtime. A seek producing no TS segment
   // after a successful exit is not a recoverable HTTP buffering condition.
   const firstSegment=join(session.dir,'seg-'+String(first).padStart(6,'0')+'.ts');
   if(code===0&&!existsSync(firstSegment)&&!session.error)session.error='vod_source_position_unavailable';
   releaseHls(session);
   if((code!==0||session.error)&&!session.stopped)console.warn('BLOFY_FULL_VOD_CHUNK_ERROR',{kind:session.kind,code,reason:session.error||'vod_chunk_interrupted'});
   else if(!session.stopped){
    const elapsedMs=Math.max(1,Date.now()-began);
    const outputSeconds=seconds;
    const mediaSpeed=Math.round(outputSeconds*1000/elapsedMs*100)/100;
    // Never include source URL, stream ID or subscription credentials.
    // End-to-end throughput includes source waiting and encoding time.
    const info={kind:session.kind,profile:videoQualityProfile(session.kind).name,elapsedMs,mediaSeconds:outputSeconds,speed:mediaSpeed};
    if(mediaSpeed<0.85)console.warn('BLOFY_FULL_VOD_SLOW',info);
    else console.info('BLOFY_FULL_VOD_CHUNK_OK',info)
   }
   if(code===0)scheduleFullVodPrefetch(session,first)
  }).catch(()=>{if(session.proc===proc){
   if(session.chunkTimer){clearTimeout(session.chunkTimer);session.chunkTimer=null}
   session.finished=true;session.chunkFinishedAt=Date.now();session.error='vod_chunk_crashed';releaseHls(session)
  }});
  return {ok:true}
 }catch{session.finished=true;session.error='vod_chunk_start_failed';releaseHls(session);return {status:502,error:'vod_chunk_start_failed'}}
}
async function fullVodRequest(req,url){
 if(!SECRET||!secureEquals(req.headers.get('x-compat-secret'),SECRET))return json(403,{error:'forbidden'});
 const m=url.pathname.match(/^\/vodfull\/(movie|series)\/([1-9][0-9]{0,14})\/(mkv|mp4|avi|mov|ts)\/([0-3])\/([0-9]{3,5})\/(index\.m3u8|seg-[0-9]{6}\.ts|stop)$/);
 if(!m)return json(404,{error:'invalid_full_vod_path'});
 const [all,kind,id,ext,rawTrack,rawDuration,file]=m,track=Number(rawTrack),duration=Number(rawDuration);
 if(!Number.isInteger(duration)||duration<120||duration>21600)return json(400,{error:'invalid_vod_duration'});
 const requestedSid=url.searchParams.get('sid')||'';
 if(requestedSid&&!/^[a-f0-9]{24,32}$/i.test(requestedSid))return json(400,{error:'invalid_vod_session'});
 const sid=requestedSid.toLowerCase();
 const bearer=req.headers.get('authorization')||'';
 if(!/^Bearer v1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/.test(bearer))return json(401,{error:'authorization_missing'});
 // Do not let two screens using the same subscription terminate or seek
 // each other's transcoder. Credentials remain mandatory for all requests.
 const key=vodKey(bearer,kind,id,ext,track,'full-'+duration+(sid?'-'+sid:''));
 if(file==='stop'){
  if(req.method!=='POST')return json(405,{error:'method_not_allowed'});
  const existing=hlsSessions.get(key);if(existing)stopHls(existing,'viewer_stopped');
  return json(200,{ok:true})
 }
 if(req.method!=='GET')return json(405,{error:'method_not_allowed'});
 let session=hlsSessions.get(key);
 if(!session){
  const dir=join(hlsRoot,key);mkdirSync(dir,{recursive:true});
  session={key,vod:true,fullVod:true,kind,id,ext,track,duration,bearer,dir,abort:new AbortController(),
   proc:null,chunkStart:-1,stopped:false,released:true,finished:true,exitCode:0,lastAccess:Date.now()};
  hlsSessions.set(key,session);
  session.hardTimer=setTimeout(()=>stopHls(session,'session_expired'),4*60*60*1000);session.hardTimer.unref?.()
 }
 touchHls(session);
 if(file==='index.m3u8'){
  const atText=url.searchParams.get('at')||'0';
  const at=/^\d{1,6}$/.test(atText)?Number(atText):0;
  // A first manifest identifies the initial seek position. Start preparation
  // before the browser requests its first segment, without opening another
  // connection to the provider or restarting an already active session.
  if(session.chunkStart<0&&active<MAX_JOBS){
   const first=Math.floor(Math.min(duration-1,at)/(FULL_SEGMENT_SECONDS*FULL_CHUNK_SEGMENTS))*FULL_CHUNK_SEGMENTS;
   const result=fullVodChunk(session,first);
   if(result.error)console.warn('BLOFY_FULL_VOD_PREFETCH_SKIPPED',{kind,reason:result.error})
  }
  return new Response(fullVodManifest(duration,sid),{status:200,
   headers:{'Content-Type':'application/vnd.apple.mpegurl','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}})
 }
 const index=Number(file.slice(4,10));
 if(!Number.isSafeInteger(index)||index>=Math.ceil(duration/FULL_SEGMENT_SECONDS))return json(416,{error:'vod_segment_outside_duration'});
 const filename=join(session.dir,file);
 if(!existsSync(filename)){
  const first=Math.floor(index/FULL_CHUNK_SEGMENTS)*FULL_CHUNK_SEGMENTS;
  // Avoid immediately re-encoding the same missing fragment on each HLS
  // retry. Cool down until the source may have recovered.
  if(session.chunkStart===first&&session.finished&&session.chunkFinishedAt&&
   Date.now()-session.chunkFinishedAt<15000){
   const reason=session.error||'vod_segment_not_in_source';
   const status=reason==='vod_source_seek_unsupported'?416:
    reason==='vod_source_position_unavailable'||reason==='vod_segment_not_in_source'?422:502;
   return json(status,{error:reason})
  }
  if(session.chunkStart!==first||session.finished){
   // Hls.js can prefetch next 24 seconds before the previous encoder exits.
   // Never kill a still-encoding adjacent chunk; that can corrupt a segment
   // that is already being fetched, causing an avoidable black screen.
   if(session.proc&&!session.finished){
    const old=session.proc;
    const adjacent=first===session.chunkStart+FULL_CHUNK_SEGMENTS;
    if(!adjacent&&session.retiringProc!==old){
     // A distant seek needs a new ffmpeg source. Kill the old job only
     // once, but hold its slot until proc.exited confirms termination.
     session.retiringProc=old;session.retireStartedAt=Date.now();session.retireEscalated=false;
     try{old.kill()}catch{}
    }
    const deadline=Date.now()+(adjacent?26000:5000);
    while(session.proc===old&&!session.finished&&!session.stopped&&!req.signal.aborted&&Date.now()<deadline){
     // A stalled FFmpeg can ignore SIGTERM. Escalate once after 2.2s,
     // never repeatedly kill on simultaneous Hls.js segment retries.
     if(!adjacent&&session.retiringProc===old&&!session.retireEscalated&&
      Date.now()-session.retireStartedAt>=2200){
      session.retireEscalated=true;
      try{old.kill(9)}catch{}
     }
     await nap(160)
    }
    if(session.stopped||req.signal.aborted)return json(410,{error:'vod_request_cancelled'});
    if(session.proc===old&&!session.finished){
     return hlsError(503,adjacent?'vod_previous_chunk_still_encoding':
      'vod_previous_chunk_draining',2)
    }
   }
   if(session.stopped||req.signal.aborted)return json(410,{error:'vod_request_cancelled'});
   // Capacity bursts should queue briefly instead of immediately failing the
   // film. Never exceed the two encoder slots or wait beyond Hls.js timeout.
   if(active>=MAX_JOBS&&session.released){
    const until=Date.now()+4000;
    while(active>=MAX_JOBS&&!session.stopped&&!req.signal.aborted&&Date.now()<until)await nap(160);
    if(session.stopped||req.signal.aborted)return json(410,{error:'vod_request_cancelled'})
   }
   if(session.chunkStart!==first||session.finished){
    if(req.signal.aborted)return json(410,{error:'vod_request_cancelled'});
    const started=fullVodChunk(session,first);
    if(started.error)return started.status===429?hlsError(429,started.error,5):json(started.status||502,{error:started.error})
   }
  }
  const until=Date.now()+28000;
  while(!existsSync(filename)&&!session.stopped&&!req.signal.aborted&&session.chunkStart===first&&!session.finished&&Date.now()<until)await nap(170);
  if(req.signal.aborted)return json(410,{error:'vod_request_cancelled'});
  if(!existsSync(filename)){
   const why=session.chunkStart!==first?'vod_chunk_replaced':session.error||'vod_segment_not_ready';
   const code=why==='vod_source_seek_unsupported'?416:
    why==='vod_source_position_unavailable'?422:session.finished?502:504;
   return json(code,{error:why})
  }
 }
 // Hls.js normally buffers several fragments in advance. When it reaches
 // the final two fragments of a group, schedule just the next 24 seconds.
 // No overlapping FFmpeg connection is opened for a given subscriber.
 const loadedChunk=Math.floor(index/FULL_CHUNK_SEGMENTS)*FULL_CHUNK_SEGMENTS;
 const nextChunk=loadedChunk+FULL_CHUNK_SEGMENTS;
 if(session.chunkStart===loadedChunk&&index>=nextChunk-2&&
  nextChunk*FULL_SEGMENT_SECONDS<session.duration){
  session.prefetchNext=nextChunk;
  if(session.finished)scheduleFullVodPrefetch(session,loadedChunk)
 }
 const response=await streamMediaFile(filename,'video/mp2t','private, max-age=3600');
 return response||json(503,{error:'vod_segment_unavailable'})
}


/* Validate full-VOD seek on synthetic files only; no customer data is used. */
function fullVodSeekSelfTest(){
 const dir=join(hlsRoot,'full-vod-selftest');
 try{
  mkdirSync(dir,{recursive:true});const input=join(dir,'test.mkv');
  const seed=Bun.spawnSync([FFMPEG,'-hide_banner','-loglevel','error','-nostdin','-f','lavfi','-i',
   'testsrc=size=320x180:rate=25','-f','lavfi','-i','sine=frequency=440:sample_rate=48000',
   '-t','32','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',
   '-c:a','aac','-b:a','96k',input],{stdout:'pipe',stderr:'pipe',timeout:20000});
  if(seed.exitCode!==0)return {ok:false,stage:'synthetic_source'};
  for(const start of [0,8,20,24]){
   const args=['-hide_banner','-loglevel','error','-nostdin','-ss',String(start),'-i',input,
    '-t','4','-map','0:v:0','-map','0:a:0?','-c:v','libx264','-preset','ultrafast',
    '-profile:v','baseline','-level','3.1','-pix_fmt','yuv420p',
    '-vf','scale=854:480:force_original_aspect_ratio=decrease:force_divisible_by=2,fps=25',
    '-g','100','-keyint_min','100','-sc_threshold','0',
    '-force_key_frames','expr:gte(t,n_forced*4)','-c:a','aac','-b:a','96k','-ac','2','-ar','48000',
    '-output_ts_offset',String(start),'-f','hls','-hls_time','4',
    '-hls_segment_type','mpegts','-hls_list_size','0','-hls_playlist_type','vod',
    '-start_number',String(start/4),'-hls_flags','independent_segments+temp_file',
    '-hls_segment_filename',join(dir,'seg-%06d.ts'),join(dir,'chunk-'+start+'.m3u8')];
   const chunk=Bun.spawnSync([FFMPEG,...args],{stdout:'pipe',stderr:'pipe',timeout:20000});
   if(chunk.exitCode!==0)return {ok:false,stage:'seek_chunk_'+start}
  }
  const first=join(dir,'seg-000000.ts'),seek=join(dir,'seg-000002.ts'),
   previousChunkLast=join(dir,'seg-000005.ts'),nextChunk=join(dir,'seg-000006.ts');
  if(!existsSync(first)||!existsSync(seek)||!existsSync(previousChunkLast)||!existsSync(nextChunk))
   return {ok:false,stage:'missing_segment'};
  const readTimestamp=file=>{
   const pr=Bun.spawnSync(['/usr/bin/ffprobe','-v','error','-show_entries',
    'format=start_time','-of','default=noprint_wrappers=1:nokey=1',file],
    {stdout:'pipe',stderr:'ignore',timeout:8000});
   return pr.exitCode===0?Number(new TextDecoder().decode(pr.stdout).trim()):NaN
  };
  const startTime=readTimestamp(first),seekTime=readTimestamp(seek),
   previousChunkTime=readTimestamp(previousChunkLast),crossChunkTime=readTimestamp(nextChunk);
  const manifest=fullVodManifest(32);
  const correct=Number.isFinite(startTime)&&Number.isFinite(seekTime)&&
   Number.isFinite(previousChunkTime)&&Number.isFinite(crossChunkTime)&&
   Math.abs((seekTime-startTime)-8)<2&&Math.abs((crossChunkTime-startTime)-24)<2&&
   Math.abs((crossChunkTime-previousChunkTime)-4)<1.5&&
   manifest.includes('#EXT-X-ENDLIST')&&(manifest.match(/#EXTINF:/g)||[]).length===8&&
   tsCodecs(readFileSync(first)).video&&tsCodecs(readFileSync(seek)).audio&&
   tsCodecs(readFileSync(previousChunkLast)).video&&tsCodecs(readFileSync(previousChunkLast)).audio&&
   tsCodecs(readFileSync(nextChunk)).video&&tsCodecs(readFileSync(nextChunk)).audio;
  return {ok:correct,stage:correct?'verified_vod_seek_across_chunks':'timeline_error',
   segments:8,offsetSeconds:Number((seekTime-startTime).toFixed(1)),
   crossChunkOffsetSeconds:Number((crossChunkTime-startTime).toFixed(1)),
   adjacentGapSeconds:Number((crossChunkTime-previousChunkTime).toFixed(1))}
 }catch{return {ok:false,stage:'synthetic_test_failed'}}
 finally{try{rmSync(dir,{recursive:true,force:true})}catch{}}
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
   '-t','4','-map','0:v:0','-map','1:a:0',...compatibleVideoArgs('live',2),
   '-c:a','aac','-b:a','160k','-ac','2','-ar','48000','-f','hls','-hls_time','2','-hls_list_size','0','-hls_playlist_type','vod',
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
let vodSeekCheck=null;

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
 if(path.startsWith('/vodfull/'))return fullVodRequest(req,url);
 if(path==='/internal-pipe-test'&&req.method==='GET'){
 if(!SECRET||!secureEquals(req.headers.get('x-compat-secret'),SECRET))return json(403,{error:'forbidden'});
 const check=await syntheticPipeTest();console.info('VIDAA_SYNTHETIC_PIPE_TEST',check);return json(check.ok?200:503,check)
 }
 if(path==='/health'&&req.method==='GET'){
  let status=false;try{const proc=Bun.spawnSync([FFMPEG,'-version'],{stdout:'pipe',stderr:'ignore',timeout:3000});status=proc.exitCode===0}catch{}
  if(!hlsCheck&&status){hlsCheck=hlsSelfTest();console.info('VIDAA_HLS_SELFTEST',hlsCheck)}
  if(!vodSeekCheck&&status&&hlsCheck?.ok){vodSeekCheck=fullVodSeekSelfTest();console.info('BLOFY_FULL_VOD_SELFTEST',vodSeekCheck)}
  const ok=status&&SECRET.length===64&&!!hlsCheck?.ok&&!!vodSeekCheck?.ok;
  // Aggregate anonymous origin stability counters: no source IDs, tokens,
  // hostnames, viewer identifiers or channel names leave the worker.
  const now=Date.now();
  for(const [key,event] of liveSourceFailureWindows){
   if(now-event.lastAt>120000)liveSourceFailureWindows.delete(key)
  }
  const coolingSources=Array.from(liveSourceFailureWindows.values())
   .filter(event=>event.retryAt>now).length;
  return json(ok?200:503,{ok,service:'blofy-vidaa-media-compat',ffmpegAvailable:status,
   hls:hlsCheck,vodSeek:vodSeekCheck,activeJobs:active,limit:MAX_JOBS,liveWindowSegments:LIVE_WINDOW_SEGMENTS,liveQuality:videoQualityProfile('live').name,vodQuality:videoQualityProfile('movie').name,
   sharedLive:{enabled:String(Bun.env.VIDAA_LIVE_SHARE_SAME_BEARER||'')==='1',
    groups:sharedLiveGroups.size,viewers:Array.from(sharedLiveGroups.values())
     .reduce((sum,group)=>sum+group.viewers.size,0),
    pending:Array.from(sharedLiveGroups.values())
     .reduce((sum,group)=>sum+(group.pendingViewers?.size||0),0),
    maxPerGroup:MAX_SHARED_LIVE_VIEWERS},
   originStability:{coolingSources,recentSources:liveSourceFailureWindows.size},
   encoderCapacity:encoderCapacitySnapshot(now)})
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
 if(active>=MAX_JOBS){noteEncoderCapacityDenied();return json(429,{error:'compat_capacity',retryAfter:5})}
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
