// Private owner-only middle/end browser AV samples from a SHA-verified S3
// manifest. FFprobe/FFmpeg access a LOOPBACK Range server, not Xtream.
// Do not expose this loopback service, source credentials or S3 URLs.
import http from 'node:http';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile as execFileCallback} from 'node:child_process';
import {promisify} from 'node:util';

const execFile=promisify(execFileCallback);
const CHUNK=8*1024*1024,MAX_SOURCE=192*1024*1024;
const MAX_REQUESTS=32,MAX_CLIP=12*1024*1024;
const RUN=/^[A-Za-z0-9_-]{8,80}$/;
const POSITIONS=new Set(['start','middle','near_end']);
const base={privateOnly:true,customerCutover:false,providerRequests:0};
const env=()=>({PATH:process.env.PATH||'/usr/bin:/bin',
 HOME:tmpdir(),LANG:'C'});
const abortSignal=(signal,ms)=>signal?
 AbortSignal.any([signal,AbortSignal.timeout(ms)]):AbortSignal.timeout(ms);

function validManifest(m){
 if(!m||m.kind!=='chunked'||!Number.isSafeInteger(m.bytes)||
    m.bytes<2048||m.bytes>4*1024**3||
    !['mkv','mp4','avi','ts'].includes(m.extension)||
    !/^[a-f0-9]{64}$/.test(String(m.sha256||''))||
    !Array.isArray(m.parts)||m.parts.length<1||m.parts.length>512)
  return false;
 let sum=0;
 for(let i=0;i<m.parts.length;i++){
  const p=m.parts[i];
  if(p.partNumber!==i+1||typeof p.key!=='string'||
     !Number.isSafeInteger(p.bytes)||p.bytes<1||p.bytes>CHUNK||
     !/^[a-f0-9]{64}$/.test(String(p.sha256||''))||
     (i<m.parts.length-1&&p.bytes!==CHUNK))
   return false;
  sum+=p.bytes;
 }
 return sum===m.bytes;
}
function readRange(header,total){
 if(typeof header!=='string'||header.length>90)return null;
 if(!header)return {from:0,to:total-1,partial:false};
 const m=/^bytes=(0|[1-9][0-9]*)-([0-9]*)$/.exec(header);
 if(!m)return null;
 const from=Number(m[1]),to=m[2]?Number(m[2]):total-1;
 if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||
    from<0||from>=total||to<from||to>=total)return null;
 return {from,to,partial:true};
}
export async function createLoopbackVerifiedMovieReader({
 manifest,storage,signal,maxSourceBytes=MAX_SOURCE
}={}){
 if(!validManifest(manifest)||!storage?.readVerifiedRange)
  throw Error('site_qa_verified_manifest_invalid');
 const secret=randomBytes(24).toString('hex');
 const path='/private/'+secret;
 let requests=0,readBytes=0,closed=false;
 const server=http.createServer((req,res)=>{
  if(closed||signal?.aborted||req.url!==path||
     !['HEAD','GET'].includes(req.method)){
    res.writeHead(404);res.end();return;
  }
  const range=readRange(String(req.headers.range||''),manifest.bytes);
  if(!range){res.writeHead(416,{'content-range':'bytes */'+manifest.bytes});res.end();return}
  if(req.method==='HEAD'){
    res.writeHead(200,{'content-length':String(manifest.bytes),
      'accept-ranges':'bytes','content-type':'application/octet-stream',
      'cache-control':'no-store'});res.end();return;
  }
  requests++;
  if(requests>MAX_REQUESTS||readBytes>=maxSourceBytes){
    res.writeHead(429);res.end();return;
  }
  const type=range.partial?206:200;
  res.writeHead(type,{'accept-ranges':'bytes',
    'content-type':'application/octet-stream',
    'content-length':String(range.to-range.from+1),
    'cache-control':'no-store',
    ...(range.partial?{'content-range':
      'bytes '+range.from+'-'+range.to+'/'+manifest.bytes}:{})});
  void (async()=>{
    let index=Math.floor(range.from/CHUNK),position=range.from;
    while(position<=range.to){
      if(closed||signal?.aborted||res.destroyed||
         readBytes>=maxSourceBytes)throw Error('site_qa_reader_ended');
      const part=manifest.parts[index++];
      if(!part)throw Error('site_qa_part_missing');
      const from=position%CHUNK;
      const to=Math.min(part.bytes-1,from+range.to-position);
      if(to<from)throw Error('site_qa_part_range_invalid');
      const source=await storage.readVerifiedRange({
        key:part.key,from,to,expectedBytes:part.bytes,signal});
      let seen=0;
      try{
        for await(const data of source){
          if(closed||signal?.aborted||res.destroyed)
           throw Error('site_qa_reader_ended');
          seen+=data.byteLength;
          readBytes+=data.byteLength;
          if(seen>to-from+1||readBytes>maxSourceBytes)
           throw Error('site_qa_source_budget_exceeded');
          if(!res.write(data))await once(res,'drain',{signal});
        }
      }finally{source.destroy?.()}
      if(seen!==to-from+1)throw Error('site_qa_source_short');
      position+=seen;
    }
    if(!res.destroyed)res.end();
  })().catch(()=>{if(!res.destroyed)res.destroy()});
 });
 try{
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
 }catch(error){server.close();throw error}
 const address=server.address();
 const url='http://127.0.0.1:'+address.port+path;
 const close=async()=>{
  if(closed)return;
  closed=true;server.closeAllConnections?.();
  await new Promise(resolve=>server.close(resolve));
 };
 signal?.addEventListener('abort',()=>{void close()},{once:true});
 return {url,close,stats:()=>({requests,readBytes,
  maxSourceBytes,providerRequests:0})};
}
async function probeDuration(url,signal){
 const output=await execFile('ffprobe',[
  '-v','error','-show_entries','format=duration',
  '-of','default=noprint_wrappers=1:nokey=1',url
 ],{signal,timeout:30000,maxBuffer:16384,
  windowsHide:true,env:env()});
 return Number(String(output.stdout||'').trim());
}
async function encodeClip({url,output,seconds,signal}){
 await execFile('ffmpeg',[
  '-hide_banner','-loglevel','error','-nostdin','-y',
  '-threads','2','-ss',String(seconds),
  '-probesize','16000000','-analyzeduration','8000000',
  '-i',url,'-map','0:v:0','-map','0:a:0',
  '-t','10','-vf','scale=-2:720',
  '-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',
  '-b:v','1300k','-maxrate','1600k','-bufsize','3200k',
  '-c:a','aac','-b:a','128k','-ac','2',
  '-movflags','+faststart','-f','mp4',output
 ],{signal,timeout:65000,maxBuffer:131072,
  windowsHide:true,env:env()});
}
export async function buildStoredMovieSeekPreview({
 runId,mediaKind='movie',position='middle',storage,lease,signal,
 durationProbe=probeDuration,transcoder=encodeClip
}={}){
 if(!RUN.test(String(runId||''))||
    !['movie','episode'].includes(mediaKind)||
    !POSITIONS.has(position))return {...base,ok:false,
     code:'site_qa_seek_selection_invalid'};
 let manifest;
 try{
  manifest=mediaKind==='movie'?
    await lease.getVerifiedChunkedObject(runId):
    await lease.getVerifiedEpisodeObject(runId);
 }catch{return {...base,ok:false,code:'site_qa_seek_manifest_unavailable'}}
 if(!validManifest(manifest))return {...base,ok:false,
   code:'site_qa_seek_unverified_file'};
 let folder=null,proxy=null;
 try{
  folder=await mkdtemp(join(tmpdir(),'blofy-owner-seek-'));
  proxy=await createLoopbackVerifiedMovieReader({
   manifest,storage,signal});
  const timeout=abortSignal(signal,85000);
  const duration=await durationProbe(proxy.url,timeout);
  if(!Number.isFinite(duration)||duration<25||duration>10*60*60)
   return {...base,ok:false,code:'site_qa_seek_duration_unavailable'};
  const seconds=position==='start'?0:
    Math.max(0,Math.min(duration-12,
      position==='middle'?duration/2-5:duration*0.9-5));
  const output=join(folder,'clip.mp4');
  await transcoder({url:proxy.url,output,seconds,signal:timeout,
    mediaKind});
  const meta=await stat(output);
  if(!meta.isFile()||meta.size<2048||meta.size>MAX_CLIP)
   return {...base,ok:false,code:'site_qa_seek_clip_size_invalid'};
  const bytes=await readFile(output);
  if(bytes.length!==meta.size||
      bytes.subarray(4,8).toString('ascii')!=='ftyp')
   return {...base,ok:false,code:'site_qa_seek_invalid_mp4'};
  const stats=proxy.stats();
  return {...base,ok:true,code:'site_qa_seek_private_clip_ready',
    mediaKind,position,durationSeconds:duration,
    clipStartsAtSeconds:seconds,clipDurationSeconds:10,
    privateSourceBytesRead:stats.readBytes,
    privateRangeRequests:stats.requests,
    originalFullFilePlaybackVerified:false,
    sourceCopiedAgain:false,bytes};
 }catch{
  return {...base,ok:false,code:'site_qa_seek_codec_or_private_range_failed'};
 }finally{
  if(proxy)await proxy.close().catch(()=>{});
  if(folder)await rm(folder,{recursive:true,force:true}).catch(()=>{});
 }
}
