// Independent, private playback canary for one already SHA256-verified movie.
// NEVER exposes the movie to customer endpoints. No upstream provider access.
// Reads a capped prefix from private S3; ffprobe identifies tracks and ffmpeg
// must actually decode a video frame and audio samples before claiming success.
import {mkdtemp,open,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFile as execFileCallback} from 'node:child_process';
import {promisify} from 'node:util';

const execFile=promisify(execFileCallback);
const SAFE_RUN=/^[A-Za-z0-9_-]{8,80}$/;
const SAFE_CODEC=/^[A-Za-z0-9_.-]{1,40}$/;
const CHUNK_SIZE=8*1024*1024;
const MAX_SAMPLE=32*1024*1024;
const resultBase={privateOnly:true,customerCutover:false,
  providerRequests:0,fullMovieStreamed:false,canaryPrefixOnly:true};
const sanitize=value=>SAFE_CODEC.test(String(value||''))?
 String(value):'unknown';
const countDecodedFrames=output=>
 String(output||'').split('\n').filter(line=>
  /^\s*0,\s*-?[0-9]/.test(line)).length;

async function sampleVerifiedPrefix({object,storage,filename,signal}){
 const manifest=object.parts;
 if(!manifest?.length||!Number.isSafeInteger(object.bytes)||
   object.bytes<CHUNK_SIZE||!/^[a-f0-9]{64}$/.test(String(object.sha256||'')))
  throw Error('canary_manifest_invalid');
 const file=await open(filename,'wx',0o600);
 let length=0,partCount=0;
 try{
  for(const part of manifest){
   if(length>=MAX_SAMPLE)break;
   if(signal?.aborted)throw Error('canary_aborted');
   if(!part.key||!Number.isSafeInteger(part.bytes)||part.bytes<1||
     part.bytes>CHUNK_SIZE||
     !/^[a-f0-9]{64}$/.test(String(part.sha256||''))||
     part.partNumber!==partCount+1||
     (partCount<manifest.length-1&&part.bytes!==CHUNK_SIZE))
    throw Error('canary_part_invalid');
   const stream=await storage.readVerifiedRange({key:part.key,
    from:0,to:part.bytes-1,expectedBytes:part.bytes,signal});
   const hash=createHash('sha256');
   let count=0;
   try{
    for await(const bytes of stream){
     if(signal?.aborted)throw Error('canary_aborted');
     count+=bytes.length;
     if(count>part.bytes)throw Error('canary_part_overflow');
     hash.update(bytes);
     let off=0;
     while(off<bytes.length){
      const result=await file.write(bytes,off,bytes.length-off,length+off);
      if(result.bytesWritten<1)throw Error('canary_file_write_failed');
      off+=result.bytesWritten;
     }
     length+=bytes.length;
    }
   }finally{stream.destroy?.()}
   if(count!==part.bytes||hash.digest('hex')!==part.sha256)
    throw Error('canary_private_sha256_mismatch');
   partCount++;
  }
 }finally{await file.close()}
 if(!length||!partCount)throw Error('canary_sample_empty');
 return {sampleBytes:length,partsChecked:partCount};
}
async function command(program,args){
 return execFile(program,args,{timeout:35000,maxBuffer:512000,
  windowsHide:true,env:{...process.env,
   // Explicitly do not inherit ffmpeg network proxy variables or tokens.
   BLOFY_CONTENT_HUB_BRIDGE_TOKEN:'',
   BLOFY_CONTENT_HUB_ADMIN_TOKEN:'',
   BLOFY_CONTENT_HUB_S3_SECRET_ACCESS_KEY:''
  }});
}

export async function diagnoseVerifiedMovie({
 runId,storage,lease,signal,diagnosticRunner=command
}={}){
 if(!SAFE_RUN.test(String(runId||'')))return {
  ...resultBase,ok:false,code:'canary_run_id_invalid'};
 let movie=null;
 try{movie=await lease.getVerifiedChunkedObject(runId)}
 catch{return {...resultBase,ok:false,code:'canary_manifest_unavailable'}}
 if(!movie)return {...resultBase,ok:false,code:'canary_movie_not_verified'};
 if(!['mp4','mkv','avi','ts'].includes(movie.extension))return {
  ...resultBase,ok:false,code:'canary_container_not_supported'};
 let folder=null;
 try{
  folder=await mkdtemp(join(tmpdir(),'blofy-private-canary-'));
  const filename=join(folder,'preview.'+movie.extension);
  const sample=await sampleVerifiedPrefix({
   object:movie,storage,filename,signal});
  let metadata;
  try{
   const result=await diagnosticRunner('ffprobe',[
    '-v','error','-probesize','16000000','-analyzeduration','8000000',
    '-show_entries','stream=codec_type,codec_name,width,height,channels,sample_rate:format=duration,format_name',
    '-of','json',filename]);
   metadata=JSON.parse(result.stdout||'{}');
  }catch{return {...resultBase,ok:false,code:'canary_ffprobe_failed',
   ...sample}}
  const streams=Array.isArray(metadata.streams)?metadata.streams:[];
  const video=streams.filter(x=>x.codec_type==='video');
  const audio=streams.filter(x=>x.codec_type==='audio');
  const subtitles=streams.filter(x=>x.codec_type==='subtitle');
  const details={...resultBase,...sample,
   verifiedMovieBytes:movie.bytes,fullMovieChecksumVerified:true,
   videoTracks:video.length,audioTracks:audio.length,
   subtitleTracks:subtitles.length,videoCodec:sanitize(video[0]?.codec_name),
   audioCodec:sanitize(audio[0]?.codec_name),
   width:Math.max(0,Number(video[0]?.width)||0),
   height:Math.max(0,Number(video[0]?.height)||0),
   durationSeconds:Math.max(0,Number(metadata.format?.duration)||0)};
  if(!video.length||!audio.length)return {...details,ok:false,
   code:'canary_missing_audio_or_video_track',
   videoFramesDecoded:0,audioFramesDecoded:0};
  let videoFramesDecoded=0,audioFramesDecoded=0;
  try{
   const result=await diagnosticRunner('ffmpeg',[
    '-hide_banner','-v','error','-nostdin','-threads','1',
    '-probesize','16000000','-analyzeduration','8000000',
    '-i',filename,'-map','0:v:0','-frames:v','1',
    '-f','framemd5','pipe:1']);
   videoFramesDecoded=countDecodedFrames(result.stdout);
  }catch{return {...details,ok:false,code:'canary_video_decode_failed',
   videoFramesDecoded:0,audioFramesDecoded:0}}
  if(videoFramesDecoded<1)return {...details,ok:false,
   code:'canary_video_no_decoded_frames',
   videoFramesDecoded:0,audioFramesDecoded:0};
  try{
   const result=await diagnosticRunner('ffmpeg',[
    '-hide_banner','-v','error','-nostdin','-threads','1',
    '-probesize','16000000','-analyzeduration','8000000',
    '-i',filename,'-map','0:a:0','-t','2',
    '-f','framemd5','pipe:1']);
   audioFramesDecoded=countDecodedFrames(result.stdout);
  }catch{return {...details,ok:false,code:'canary_audio_decode_failed',
   videoFramesDecoded,audioFramesDecoded:0}}
  if(audioFramesDecoded<1)return {...details,ok:false,
   code:'canary_audio_no_decoded_frames',
   videoFramesDecoded,audioFramesDecoded:0};
  return {...details,ok:true,code:'canary_audio_video_decoded',
   videoFramesDecoded,audioFramesDecoded};
 }catch{return {...resultBase,ok:false,code:'canary_private_read_failed'}}
 finally{if(folder)await rm(folder,{recursive:true,force:true}).catch(()=>{})}
}
