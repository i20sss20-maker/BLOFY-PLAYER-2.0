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
const FIXTURE_ORIGIN='https://blofy-migration-device-preview-test.up.railway.app';
const FIXTURE_USER='synthetic-lab',FIXTURE_PASS='public-sample-only';
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
 const ts=join(dir,'live.ts');
 await execFile('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-i',result.get('/movie.mp4').file,
  '-c','copy','-f','mpegts','-y',ts],{timeout:45000,maxBuffer:60000});
 const details=await stat(ts);
 if(details.size<1024||details.size>12*1024*1024)throw Error('synthetic_ts_invalid_size');
 result.set('/live.ts',{file:ts,bytes:details.size,type:'video/mp2t'});
 return result;
}
function fixtureJson(res,status,value){
 const body=JSON.stringify(value);
 res.writeHead(status,{'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(body),
  'cache-control':'no-store, private','referrer-policy':'no-referrer'});res.end(body);
}
async function syntheticRedeem(req,res){
 if(req.method!=='POST'||req.url!=='/api/v1/stream/app/unified-redeem'||
  !/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type']||''))){
  req.resume();return fixtureJson(res,400,{ok:false,error:'fixture_invalid'});
 }
 if(Number(req.headers['content-length']||0)>1024){req.resume();return fixtureJson(res,413,{ok:false});}
 let bytes=0;const chunks=[];
 try{
  for await(const chunk of req){bytes+=chunk.length;if(bytes>1024){res.destroy();return;}chunks.push(chunk);}
  const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  // Only an explicitly public synthetic code and dummy binding. Never accept
  // actual subscriber credentials or a real installation key.
  if(data?.code!=='00000000'||data?.deviceKey!=='0'.repeat(64))return fixtureJson(res,409,{ok:false,error:'fixture_only'});
  return fixtureJson(res,201,{ok:true,type:'external_xtream',providerVerified:false,
   credentials:{host:FIXTURE_ORIGIN,username:FIXTURE_USER,password:FIXTURE_PASS}});
 }catch{if(!res.destroyed&&!res.writableEnded)fixtureJson(res,400,{ok:false});}
}
function fixtureCatalog(query){
 if(query.get('username')!==FIXTURE_USER||query.get('password')!==FIXTURE_PASS)return null;
 const category=[{category_id:'1',category_name:'Synthetic QA'}];
 const movie={stream_id:201,category_id:'1',name:'Synthetic QA Movie',container_extension:'mp4'};
 const series={series_id:301,category_id:'1',name:'Synthetic QA Series'};
 switch(query.get('action')){
  case null:return {user_info:{auth:1,status:'Active',exp_date:'',max_connections:'1'}};
  case 'get_live_categories':case 'get_vod_categories':case 'get_series_categories':return category;
  case 'get_live_streams':return [{stream_id:101,category_id:'1',name:'Synthetic QA Live',stream_type:'live'}];
  case 'get_vod_streams':return [movie];
  case 'get_series':return [series];
  case 'get_vod_info':return {info:{name:movie.name,plot:'Generated test pattern; no provider media.'},movie_data:movie};
  case 'get_series_info':return {info:{name:series.name,plot:'Synthetic test series'},seasons:[{season_number:1,name:'Season 1'}],
   episodes:{'1':[{id:'401',episode_num:1,title:'Synthetic QA Episode',container_extension:'mp4',season:1,info:{duration_secs:11}}]}};
  case 'get_short_epg':case 'get_simple_data_table':return {epg_listings:[]};
  default:return null;
 }
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
   const parsed=new URL(req.url||'/','http://localhost');
   const url=parsed.pathname;
   if(url==='/api/v1/stream/app/unified-redeem'){void syntheticRedeem(req,res);return;}
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
   if(url==='/player_api.php'){
    const data=fixtureCatalog(parsed.searchParams);
    return fixtureJson(res,data===null?403:200,data??{user_info:{auth:0,status:'Disabled'}});
   }
   const aliases={
    ['/movie/'+FIXTURE_USER+'/'+FIXTURE_PASS+'/201.mp4']:'/movie.mp4',
    ['/series/'+FIXTURE_USER+'/'+FIXTURE_PASS+'/401.mp4']:'/episode.mp4',
    ['/live/'+FIXTURE_USER+'/'+FIXTURE_PASS+'/101.ts']:'/live.ts'
   };
   if(url==='/live/'+FIXTURE_USER+'/'+FIXTURE_PASS+'/101.m3u8'){
    const body='#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:8\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:8.0,\n101.ts\n#EXT-X-ENDLIST\n';
    res.writeHead(200,{'content-type':'application/vnd.apple.mpegurl','content-length':Buffer.byteLength(body)});
    res.end(req.method==='HEAD'?'':body);return;
   }
   const item=files.get(aliases[url]||url);
   if(!item){res.writeHead(404);res.end();return;}
   const range=parseMp4Range(req.headers.range,item.bytes);
   if(!range.ok){
    res.writeHead(416,{'content-range':'bytes */'+item.bytes,'accept-ranges':'bytes'});
    res.end();return;
   }
   const headers={'content-type':item.type||'video/mp4','accept-ranges':'bytes',
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
