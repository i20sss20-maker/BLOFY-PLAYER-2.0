// Owner-only private full-timeline segmented playback PILOT. The browser
// requests only 30s MP4 windows from an exact verified private S3 original.
// No Xtream provider traffic, customer cutover, or public origin URLs.
// This is NOT a full uninterrupted viewing proof or public HLS release.
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile as execFileCallback} from 'node:child_process';
import {promisify} from 'node:util';
import {createLoopbackVerifiedMovieReader} from './private-seek-preview.mjs';

const execFile=promisify(execFileCallback);
const SEGMENT_SECONDS=30,MAX_SEGMENTS=1200;
const MAX_MP4=18*1024*1024;
const RUN=/^[A-Za-z0-9_-]{8,80}$/;
const TTL=10*60*1000;
const durationCache=new Map();
const base={privateOnly:true,providerRequests:0,customerCutover:false,
 fullFilePlaybackVerified:false,customerReleaseApproved:false};
function decoderEnv(){return {
 PATH:process.env.PATH||'/usr/local/bin:/usr/bin:/bin',
 HOME:tmpdir(),LANG:'C'};}
function getSignal(signal,ms){
 return signal?AbortSignal.any([signal,AbortSignal.timeout(ms)]):
  AbortSignal.timeout(ms);
}
function validSelection(mediaKind,runId){
 return ['movie','episode'].includes(mediaKind)&&RUN.test(String(runId||''));
}
async function verifiedManifest({mediaKind,runId,lease}){
 const m=mediaKind==='movie'?
   await lease.getVerifiedChunkedObject(runId):
   await lease.getVerifiedEpisodeObject(runId);
 return m?.kind==='chunked'&&
   Number.isSafeInteger(m.bytes)&&m.bytes>1024&&m.bytes<=4*1024**3&&
   /^[a-f0-9]{64}$/.test(String(m.sha256||''))?m:null;
}
async function actualDuration(url,signal){
 const {stdout}=await execFile('ffprobe',[
  '-v','error','-probesize','16000000','-analyzeduration','8000000',
  '-show_entries','format=duration',
  '-of','default=noprint_wrappers=1:nokey=1',url
 ],{signal,timeout:35000,maxBuffer:16384,windowsHide:true,
  env:decoderEnv()});
 return Number(String(stdout||'').trim());
}
async function actualClip({url,output,startSeconds,durationSeconds,signal}){
 await execFile('ffmpeg',[
  '-hide_banner','-loglevel','error','-nostdin','-y',
  '-threads','2','-ss',String(startSeconds),
  '-probesize','16000000','-analyzeduration','8000000',
  '-i',url,'-map','0:v:0','-map','0:a:0',
  '-t',String(durationSeconds),'-vf','scale=-2:720',
  '-c:v','libx264','-preset','ultrafast',
  '-pix_fmt','yuv420p','-b:v','1350k',
  '-maxrate','1700k','-bufsize','3400k',
  '-c:a','aac','-b:a','128k','-ac','2',
  '-movflags','+faststart','-f','mp4',output
 ],{signal,timeout:105000,maxBuffer:131072,windowsHide:true,
  env:decoderEnv()});
}
export const TIMELINE_SECONDS=SEGMENT_SECONDS;
export function validateTimelineSegment(value,segmentCount){
 if(typeof value!=='string'||!/^(0|[1-9][0-9]{0,3})$/.test(value)||
    !Number.isInteger(segmentCount)||segmentCount<1||
    segmentCount>MAX_SEGMENTS)return null;
 const segment=Number(value);
 return segment<segmentCount?segment:null;
}
export function makeTimelinePlan(duration){
 if(!Number.isFinite(duration)||duration<25||
   duration>MAX_SEGMENTS*SEGMENT_SECONDS)return null;
 const segmentCount=Math.ceil(duration/SEGMENT_SECONDS);
 if(segmentCount<1||segmentCount>MAX_SEGMENTS)return null;
 return {durationSeconds:duration,segmentSeconds:SEGMENT_SECONDS,
  segmentCount};
}
export async function inspectPrivateTimeline({
 mediaKind,runId,lease,storage,signal,durationProbe=actualDuration
}={}){
 if(!validSelection(mediaKind,runId))return {
  ...base,ok:false,code:'private_timeline_selection_invalid'};
 let manifest;
 try{manifest=await verifiedManifest({mediaKind,runId,lease})}catch{}
 if(!manifest)return {...base,ok:false,code:'private_timeline_not_verified'};
 const key=mediaKind+':'+runId+':'+manifest.sha256+':'+manifest.bytes;
 const cached=durationCache.get(key);
 if(cached&&cached.expiresAt>Date.now())return {
  ...base,ok:true,code:'private_timeline_metadata_verified',
  mediaKind,runId,...cached.plan,cacheHit:true};
 // Drop stale entries so distinct verified uploads never reuse duration.
 for(const [k,v] of durationCache){
  if(v.expiresAt<Date.now()||durationCache.size>12)durationCache.delete(k);
 }
 let reader=null;
 try{
  reader=await createLoopbackVerifiedMovieReader({
   manifest,storage,signal,maxSourceBytes:48*1024*1024});
  const d=await durationProbe(reader.url,getSignal(signal,38000));
  const plan=makeTimelinePlan(d);
  if(!plan)return {...base,ok:false,code:'private_timeline_duration_invalid'};
  durationCache.set(key,{plan,expiresAt:Date.now()+TTL});
  return {...base,ok:true,code:'private_timeline_metadata_verified',
   mediaKind,runId,...plan,cacheHit:false};
 }catch{return {...base,ok:false,code:'private_timeline_metadata_unavailable'}}
 finally{if(reader)await reader.close().catch(()=>{})}
}
export async function buildPrivateTimelineSegment({
 mediaKind,runId,segment,lease,storage,signal,
 durationProbe=actualDuration,transcoder=actualClip
}={}){
 if(!validSelection(mediaKind,runId))
  return {...base,ok:false,code:'private_timeline_selection_invalid'};
 const metadata=await inspectPrivateTimeline({
  mediaKind,runId,lease,storage,signal,durationProbe});
 if(!metadata.ok)return metadata;
 const number=validateTimelineSegment(String(segment),metadata.segmentCount);
 if(number===null)return {...base,ok:false,code:'private_timeline_segment_invalid'};
 const startSeconds=number*SEGMENT_SECONDS;
 const durationSeconds=Math.min(SEGMENT_SECONDS,
  Math.max(0,metadata.durationSeconds-startSeconds));
 if(durationSeconds<=0)return {...base,ok:false,
  code:'private_timeline_segment_empty'};
 let manifest;
 try{manifest=await verifiedManifest({mediaKind,runId,lease})}catch{}
 if(!manifest)return {...base,ok:false,code:'private_timeline_not_verified'};
 let dir=null,reader=null;
 try{
  const budget=getSignal(signal,118000);
  reader=await createLoopbackVerifiedMovieReader({
   manifest,storage,signal:budget,maxSourceBytes:192*1024*1024});
  dir=await mkdtemp(join(tmpdir(),'blofy-private-timeline-'));
  const output=join(dir,'segment.mp4');
  await transcoder({url:reader.url,output,startSeconds,
   durationSeconds,signal:budget});
  const file=await stat(output);
  if(!file.isFile()||file.size<2048||file.size>MAX_MP4)
   return {...base,ok:false,code:'private_timeline_output_size_invalid'};
  const bytes=await readFile(output);
  if(bytes.length!==file.size||
     bytes.subarray(4,8).toString('ascii')!=='ftyp')
   return {...base,ok:false,code:'private_timeline_mp4_invalid'};
  return {...base,ok:true,code:'private_timeline_segment_ready',
   mediaKind,runId,segmentIndex:number,startSeconds,
   segmentDurationSeconds:durationSeconds,
   originalDurationSeconds:metadata.durationSeconds,
   originalFileBytes:manifest.bytes,
   privateS3BytesRead:reader.stats().readBytes,
   privateS3RangeRequests:reader.stats().requests,
   bytes};
 }catch{return {...base,ok:false,code:'private_timeline_segment_encode_failed'}}
 finally{
  if(reader)await reader.close().catch(()=>{});
  if(dir)await rm(dir,{recursive:true,force:true}).catch(()=>{});
 }
}
