// Owner-only 12-second browser preview of a SHA-verified private movie.
// Reads <=32MiB from S3 with per-chunk hashes. Does not access Xtream,
// create customer links, store preview in the bucket, or change playback.
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {execFile as callbackExecFile} from 'node:child_process';
import {sampleVerifiedPrefix} from './playback-diagnostics.mjs';

const execFile=promisify(callbackExecFile);
const RUN=/^[A-Za-z0-9_-]{8,80}$/;
const MAX_BYTES=12*1024*1024;
const base={privateOnly:true,customerCutover:false,providerRequests:0};

async function ffmpegPreview({input,output,signal,mediaKind='movie'}){
 // Episode source codecs may not be HTML5-compatible; cap its preview
 // to 720p H.264/AAC. Movie preview keeps the already tested H.264 copy.
 const videoArgs=mediaKind==='episode'?
  ['-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',
   '-vf','scale=-2:720','-b:v','1500k','-maxrate','1800k','-bufsize','3600k']:
  ['-c:v','copy'];
 await execFile('ffmpeg',[
  '-hide_banner','-loglevel','error','-nostdin','-y',
  '-threads','1','-probesize','16000000','-analyzeduration','8000000',
  '-i',input,
  '-map','0:v:0','-map','0:a:0',
  '-t','12',...videoArgs,'-c:a','aac','-b:a','128k',
  '-ac','2','-movflags','+faststart','-f','mp4',output
 ],{
  timeout:50000,maxBuffer:262144,signal,windowsHide:true,
  env:{PATH:process.env.PATH||'/usr/bin:/bin',HOME:tmpdir(),LANG:'C'}
 });
}
export async function buildPrivateBrowserPreview({
 runId,lease,storage,signal,transcoder=ffmpegPreview,
 mediaKind='movie'
}={}){
 if(!['movie','episode'].includes(mediaKind))return {
  ...base,ok:false,code:'private_preview_media_kind_invalid'};
 if(!RUN.test(String(runId||'')))return {...base,ok:false,
  code:'private_preview_invalid_run'};
 let manifest=null;
 try{
  manifest=mediaKind==='episode'?
    await lease.getVerifiedEpisodeObject(runId):
    await lease.getVerifiedChunkedObject(runId);
 }catch{return {...base,ok:false,code:'private_preview_manifest_unavailable'}}
 if(!manifest)return {...base,ok:false,code:'private_preview_movie_not_verified'};
 if(!['mkv','mp4','ts','avi'].includes(manifest.extension))return {
  ...base,ok:false,code:'private_preview_unsupported_container'};
 let folder=null;
 try{
  folder=await mkdtemp(join(tmpdir(),'blofy-owner-preview-'));
  const input=join(folder,'source.'+manifest.extension),
        output=join(folder,'preview.mp4');
  const sampled=await sampleVerifiedPrefix({
   object:manifest,storage,filename:input,signal});
  await transcoder({input,output,signal,mediaKind});
  const meta=await stat(output);
  if(!meta.isFile()||meta.size<2048||meta.size>MAX_BYTES)
   return {...base,ok:false,code:'private_preview_output_size_invalid'};
  const bytes=await readFile(output);
  if(bytes.length!==meta.size||
     bytes.subarray(4,8).toString('ascii')!=='ftyp')
   return {...base,ok:false,code:'private_preview_invalid_mp4'};
  return {...base,ok:true,code:'private_preview_ready',
   mediaType:'video/mp4',durationSeconds:12,
   bytes,sourceSampleBytes:sampled.sampleBytes};
 }catch{return {...base,ok:false,code:'private_preview_encode_failed'}}
 finally{if(folder)await rm(folder,{recursive:true,force:true}).catch(()=>{})}
}
