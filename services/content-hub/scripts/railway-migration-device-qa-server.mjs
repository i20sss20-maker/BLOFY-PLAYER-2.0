// Self-contained synthetic device testing site. No provider/copyrighted media.
import http from 'node:http';
import {execFile as execFileCb} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,stat,rm,readFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const execFile=promisify(execFileCb);
export const LAB_PROJECT='538a56fa-cdbb-49ba-9620-d350dcdc6aa4';
const SAMPLES=[
 {path:'/movie.mp4',seconds:8,frequency:440},
 {path:'/episode.mp4',seconds:11,frequency:660}
];

export function parseMp4Range(value,size){
 if(!Number.isSafeInteger(size)||size<1)return {ok:false,status:416};
 if(value==null)return {ok:true,status:200,from:0,to:size-1};
 if(typeof value!=='string')return {ok:false,status:416};
 const match=/^bytes=(\d*)-(\d*)$/.exec(value);
 if(!match||(!match[1]&&!match[2]))return {ok:false,status:416};
 let from,to;
 if(match[1]){
  from=Number(match[1]);to=match[2]?Number(match[2]):size-1;
 }else{
  const suffix=Number(match[2]);
  if(!Number.isSafeInteger(suffix)||suffix<1)return {ok:false,status:416};
  from=Math.max(0,size-suffix);to=size-1;
 }
 if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||
    from<0||from>=size||to<from)return {ok:false,status:416};
 return {ok:true,status:206,from,to:Math.min(to,size-1)};
}
export function assertSyntheticLabEnvironment(env){
 if(env.RAILWAY_PROJECT_ID!==LAB_PROJECT||
    env.RAILWAY_ENVIRONMENT_NAME!=='test'||
    env.BLOFY_QA_SYNTHETIC_ONLY!=='1'||
    Object.keys(env).some(k=>/^(XTREAM_(USERNAME|PASSWORD)|BLOFY_XTREAM_|BLOFY_STREAM_UPSTREAM|BLOFY_CONTENT_HUB_S3_SECRET_ACCESS_KEY|BLOFY_CONTENT_HUB_BRIDGE_TOKEN)/.test(k)))
  throw Error('device_qa_not_isolated');
}
async function generateSamples(dir){
 const result=new Map();
 for(const item of SAMPLES){
  const file=join(dir,item.path.slice(1));
  await execFile('ffmpeg',[
   '-hide_banner','-loglevel','error','-nostdin',
   '-f','lavfi','-i','testsrc2=size=320x180:rate=12:duration='+item.seconds,
   '-f','lavfi','-i','sine=frequency='+item.frequency+':sample_rate=44100:duration='+item.seconds,
   '-map','0:v:0','-map','1:a:0',
   '-c:v','libx264','-profile:v','baseline','-level','3.0',
   '-preset','ultrafast','-crf','30','-pix_fmt','yuv420p',
   '-c:a','aac','-b:a','64k','-movflags','+faststart',
   '-shortest','-y',file
  ],{timeout:45000,maxBuffer:60000});
  const details=await stat(file);
  if(details.size<1024||details.size>12*1024*1024)
   throw Error('synthetic_file_invalid_size');
  result.set(item.path,{file,bytes:details.size});
 }
 return result;
}
export async function startSyntheticDeviceQa({env=process.env,logger=console.log}={}){
 assertSyntheticLabEnvironment(env);
 const port=Number(env.PORT||3000);
 if(!Number.isSafeInteger(port)||port<1||port>65535)throw Error('device_qa_invalid_port');
 const dir=await mkdtemp(join(tmpdir(),'blofy-device-qa-'));
 let server=null;
 try{
  const files=await generateSamples(dir);
  const html=await readFile(new URL('./railway-migration-device-qa.html',import.meta.url),'utf8');
  server=http.createServer((req,res)=>{
   res.setHeader('x-content-type-options','nosniff');
   res.setHeader('cache-control','no-store');
   const url=(req.url||'').split('?')[0];
   if(!['GET','HEAD'].includes(req.method)){
    res.writeHead(405,{'allow':'GET, HEAD'});res.end();return;
   }
   if(url==='/health'){
    const body=JSON.stringify({ok:true,synthetic:true,providerRequests:0,
      customerCutover:false,samples:[...files.keys()]});
    res.writeHead(200,{'content-type':'application/json; charset=utf-8',
      'content-length':Buffer.byteLength(body)});
    res.end(req.method==='HEAD'?'':body);return;
   }
   if(url==='/'){
    res.writeHead(200,{'content-type':'text/html; charset=utf-8',
      'content-length':Buffer.byteLength(html)});
    res.end(req.method==='HEAD'?'':html);return;
   }
   const item=files.get(url);
   if(!item){res.writeHead(404);res.end();return;}
   const range=parseMp4Range(req.headers.range,item.bytes);
   if(!range.ok){
    res.writeHead(416,{'content-range':'bytes */'+item.bytes,'accept-ranges':'bytes'});
    res.end();return;
   }
   const headers={'content-type':'video/mp4','accept-ranges':'bytes',
     'content-length':range.to-range.from+1};
   if(range.status===206)
    headers['content-range']='bytes '+range.from+'-'+range.to+'/'+item.bytes;
   res.writeHead(range.status,headers);
   if(req.method==='HEAD'){res.end();return;}
   createReadStream(item.file,{start:range.from,end:range.to})
    .on('error',()=>res.destroy()).pipe(res);
  });
  await new Promise((resolve,reject)=>{
   server.once('error',reject);
   server.listen(port,'0.0.0.0',resolve);
  });
  logger('BLOFY_MIGRATION_DEVICE_QA_READY '+JSON.stringify({
   ok:true,synthetic:true,port,sampleCount:files.size,
   movieBytes:files.get('/movie.mp4').bytes,
   episodeBytes:files.get('/episode.mp4').bytes,
   providerMediaRequests:0,customerCutover:false
  }));
  const cleanup=async()=>{
   await new Promise(resolve=>server.close(()=>resolve()));
   await rm(dir,{recursive:true,force:true});
  };
  return {server,cleanup};
 }catch(e){
  if(server)server.close();
  await rm(dir,{recursive:true,force:true});
  throw e;
 }
}
if(process.argv[1]?.endsWith('/railway-migration-device-qa-server.mjs')){
 const {cleanup}=await startSyntheticDeviceQa();
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{
   cleanup().then(()=>process.exit(0)).catch(()=>process.exit(1));
 });
}
