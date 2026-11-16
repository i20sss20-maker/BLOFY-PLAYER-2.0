// Independently inspect synthetic MP4 serving over actual Railway private HTTP.
// No Xtream, no subscriber traffic, and no protected S3 access.
import {execFile as callbackExec} from 'node:child_process';
import {promisify} from 'node:util';
import {LAB_PROJECT} from './railway-migration-lab-av-smoke.mjs';

const exec=promisify(callbackExec);
const BASE='http://blofy-migration-device-preview.railway.internal:3000';
const FILES=['/movie.mp4','/episode.mp4'];
const FLAGS={synthetic:true,providerMediaRequests:0,
 customerCutover:false,automaticCopy:false,devicePlaybackVerified:false};
export function allowedScope(env){
 return env.RAILWAY_PROJECT_ID===LAB_PROJECT &&
  env.RAILWAY_ENVIRONMENT_NAME==='test' &&
  env.BLOFY_QA_SYNTHETIC_ONLY==='1' &&
  !Object.keys(env).some(k=>/^(XTREAM_(USERNAME|PASSWORD)|BLOFY_XTREAM_|BLOFY_STREAM_UPSTREAM|BLOFY_CONTENT_HUB_BRIDGE_TOKEN)/.test(k));
}
async function ffmpegCheck(url,run){
 const check=await run('ffprobe',[
   '-v','error','-rw_timeout','15000000',
   '-show_entries','stream=codec_type','-of','json',url
 ],{timeout:22000,maxBuffer:262144});
 const streams=JSON.parse(check.stdout||'{}').streams||[];
 if(!streams.some(s=>s.codec_type==='audio')||
    !streams.some(s=>s.codec_type==='video'))
   throw Error('audio_video_tracks_missing');
 await run('ffmpeg',[
   '-hide_banner','-loglevel','error','-nostdin','-xerror',
   '-rw_timeout','15000000','-i',url,
   '-t','2','-map','0:v:0','-map','0:a:0','-f','null','-'
 ],{timeout:23000,maxBuffer:262144});
 await run('ffmpeg',[
   '-hide_banner','-loglevel','error','-nostdin','-xerror',
   '-rw_timeout','15000000','-ss','2','-i',url,
   '-frames:v','1','-map','0:v:0','-f','null','-'
 ],{timeout:23000,maxBuffer:262144});
 return true;
}
export async function runDeviceRangeSmoke({env=process.env,
 fetchImpl=fetch,run=exec}={}){
 if(!allowedScope(env))
  return {ok:false,code:'device_qa_probe_scope_invalid',...FLAGS};
 let stage='health';
 try{
  const health=await fetchImpl(BASE+'/health',{signal:AbortSignal.timeout(12000)});
  if(health.status!==200)throw Error('health_unavailable');
  const ready=await health.json();
  if(ready.ok!==true||ready.synthetic!==true||ready.customerCutover!==false||
      ready.providerRequests!==0||!Array.isArray(ready.samples)||
      !FILES.every(path=>ready.samples.includes(path)))
   throw Error('health_not_synthetic');
  const results=[];
  for(const path of FILES){
   stage=path;
   const url=BASE+path;
   const head=await fetchImpl(url,{method:'HEAD',signal:AbortSignal.timeout(12000)});
   const len=Number(head.headers.get('content-length'));
   if(head.status!==200||!Number.isSafeInteger(len)||len<1000||
      len>12*1024*1024||head.headers.get('accept-ranges')!=='bytes'||
      head.headers.get('content-type')!=='video/mp4')
    throw Error('media_head_invalid');
   const first=await fetchImpl(url,{headers:{Range:'bytes=0-1023'},
     signal:AbortSignal.timeout(12000)});
   const prefix=Buffer.from(await first.arrayBuffer());
   if(first.status!==206||prefix.length!==1024||
      first.headers.get('content-range')!=='bytes 0-1023/'+len||
      prefix.toString('ascii',4,8)!=='ftyp')
    throw Error('media_range_invalid');
   const suffix=await fetchImpl(url,{headers:{Range:'bytes=-64'},
     signal:AbortSignal.timeout(12000)});
   if(suffix.status!==206||
      Buffer.from(await suffix.arrayBuffer()).length!==64)
    throw Error('media_suffix_invalid');
   const invalid=await fetchImpl(url,{headers:{Range:'bytes='+len+'-'},
     signal:AbortSignal.timeout(12000)});
   if(invalid.status!==416)throw Error('media_416_not_enforced');
   stage=path+'_decode';
   await ffmpegCheck(url,run);
   results.push({kind:path.slice(1,-4),bytes:len,range206:true,
     invalidRange416:true,audioVideoDecoded:true,seekFrameDecoded:true});
  }
  return {ok:true,code:'device_qa_private_http_playback_verified',
   ...FLAGS,results,videoFilesVerified:results.length,
   browserDevicePlaybackNotYetConfirmed:true};
 }catch{
  return {ok:false,code:'device_qa_private_http_test_failed',
   stage,...FLAGS,videoFilesVerified:0};
 }
}
if(process.argv[1]?.endsWith('/railway-migration-device-range-smoke.mjs')){
 const result=await runDeviceRangeSmoke();
 console.log('BLOFY_MIGRATION_DEVICE_HTTP_SMOKE '+JSON.stringify(result));
 process.exitCode=result.ok?0:1;
}
