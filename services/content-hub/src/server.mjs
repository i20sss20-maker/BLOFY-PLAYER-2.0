import http from 'node:http';
import {once} from 'node:events';
import {randomUUID,randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {createPrivateS3Adapter} from './private-s3.mjs';
import {createSourceLease} from './source-lease.mjs';
import {runPrivateSalehSample} from './real-source-sample.mjs';
import {runOneMoviePilot} from './one-movie-pilot.mjs';

const FIXTURE_SOURCE='00000000-0000-4000-8000-000000000000';
const FIXTURE_SIZE=8*1024*1024;
const json=(res,status,payload)=>{
 const body=Buffer.from(JSON.stringify(payload));
 res.writeHead(status,{'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store','content-length':body.length,
  'x-content-type-options':'nosniff','referrer-policy':'no-referrer'});
 res.end(body);
};
const safeAuth=(header,token)=>{
 if(typeof header!=='string'||!header.startsWith('Bearer ')||
   typeof token!=='string'||token.length<32)return false;
 const candidate=Buffer.from(header.slice(7)),expected=Buffer.from(token);
 return candidate.length===expected.length&&timingSafeEqual(candidate,expected);
};

export async function runSyntheticPrivateStorageCheck({storage}){
 const key='saleh/movie/'+FIXTURE_SOURCE+'/fixture'+randomUUID().replaceAll('-','')+'.mp4';
 const data=randomBytes(FIXTURE_SIZE);
 const digest=createHash('sha256').update(data).digest('hex');
 let uploadId=null,complete=false,verified=false,cleanup=false;
 try{
  const o=await storage.begin({key,private:true,
   contentType:'application/octet-stream',
   metadata:{test:'blofy-content-hub-fixture'}});
  uploadId=o.uploadId;
  const p=await storage.part({key,uploadId,partNumber:1,body:data});
  await storage.complete({key,uploadId,parts:[{partNumber:1,etag:p.etag}]});
  complete=true;uploadId=null;
  const proof=await storage.verify({key,expectedBytes:data.length,
   expectedSha256:digest});
  verified=proof?.ok===true&&proof.bytes===data.length;
 }catch{
  verified=false;
 }finally{
  if(uploadId)await storage.abort({key,uploadId}).catch(()=>{});
  try{await storage.remove({key});cleanup=true}catch{}
  data.fill(0);
 }
 return {ok:verified&&cleanup,
   code:!cleanup?'private_s3_fixture_cleanup_failed':verified?
     'private_s3_roundtrip_verified':'private_s3_roundtrip_failed',
   fixtureBytes:FIXTURE_SIZE,privateOnly:true,providerRequests:0,
   customerTrafficChanged:false,fixtureRemoved:cleanup};
}
export function createContentHubServer({storage,lease,
 token='',allowSynthetic=false,logger=()=>{}}={}){
 if(!storage||!lease)throw Error('content_hub_private_dependencies_required');
 const started=Date.now();
 let syntheticRunning=false,lastSynthetic=null;
 let pilotRunning=false,lastPilot=null;
 const server=http.createServer(async(req,res)=>{
  const path=String(req.url||'').split('?')[0];
  if(path==='/health'&&req.method==='GET')
   return json(res,200,{ok:true,service:'blofy-content-hub',
    privateOnly:true,mode:'licensed_mirror_control_plane',
    automaticSourceDownloads:false,customerCutover:false,
    uptimeSeconds:Math.floor((Date.now()-started)/1000)});
  if(!safeAuth(req.headers.authorization,token))
   return json(res,401,{ok:false,code:'content_hub_auth_required'});
  if(path==='/internal/status'&&req.method==='GET'){
   let bucket=false,database=false,durablePilot=null;
   try{bucket=(await storage.health()).ok===true}catch{}
   try{database=await lease.health()}catch{}
   try{durablePilot=await lease.getPilotStatus?.(
     String(process.env.BLOFY_CONTENT_HUB_PILOT_RUN_ID||''))}catch{}
   return json(res,bucket&&database?200:503,{
    ok:bucket&&database,privateBucketAvailable:bucket,
    databaseAvailable:database,downloadQueueEnabled:false,
    syntheticTestEnabled:allowSynthetic,
    lastSynthetic,pilotRunning,lastPilot,
    durablePilot,customerCutover:false,
    licensedRightsRequired:true});
  }
  // Admin-only and private-network-only canary. No customer cutover.
  const playback=/^\/internal\/pilot\/playback\/([A-Za-z0-9_-]{8,80})$/.exec(path);
  if(playback&&req.method==='GET'){
   if(String(req.url||'').includes('?'))
    return json(res,400,{ok:false,code:'pilot_private_query_denied'});
   const saved=await lease.getVerifiedPilotObject?.(playback[1]).catch(()=>null);
   if(!saved||!Number.isSafeInteger(saved.bytes)||saved.bytes<=0)
    return json(res,404,{ok:false,code:'pilot_verified_media_unavailable'});
   const m=/^bytes=(0|[1-9][0-9]*)-(0|[1-9][0-9]*)$/.exec(
    String(req.headers.range||''));
   const from=Number(m?.[1]),to=Number(m?.[2]);
   if(!m||!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||
      to<from||to>=saved.bytes||to-from+1>8*1024*1024)
    return json(res,416,{ok:false,code:'pilot_bounded_range_required'});
   const type=saved.key.endsWith('.mkv')?'video/x-matroska':
    saved.key.endsWith('.mp4')?'video/mp4':
    saved.key.endsWith('.ts')?'video/mp2t':'video/x-msvideo';
   const abort=new AbortController();
   const timer=setTimeout(()=>abort.abort(),90000);timer.unref?.();
   const onDisconnect=()=>abort.abort();
   res.once('close',onDisconnect);
   let body=null;
   try{
    body=await storage.readVerifiedRange({
      key:saved.key,from,to,expectedBytes:saved.bytes,signal:abort.signal
    });
    res.writeHead(206,{
      'content-type':type,'content-length':String(to-from+1),
      'content-range':`bytes ${from}-${to}/${saved.bytes}`,
      'accept-ranges':'bytes','cache-control':'private,no-store',
      'x-content-type-options':'nosniff','referrer-policy':'no-referrer'
    });
    let count=0;
    for await(const chunk of body){
      count+=chunk.byteLength;
      if(count>to-from+1)throw Error('pilot_media_range_overrun');
      if(!res.write(chunk))await once(res,'drain',{signal:abort.signal});
    }
    if(count!==to-from+1)throw Error('pilot_media_range_short');
    res.end();
   }catch{
    if(res.headersSent){if(!res.destroyed)res.destroy()}
    else if(!res.destroyed)json(res,503,{
      ok:false,code:'pilot_private_media_read_failed'});
   }finally{
    clearTimeout(timer);
    res.off('close',onDisconnect);
    body?.destroy?.();
   }
   return;
  }
  if(path==='/internal/storage/synthetic-check'&&req.method==='POST'){
   if(!allowSynthetic)return json(res,409,{
    ok:false,code:'synthetic_storage_test_disabled'});
   if(syntheticRunning)return json(res,429,{
    ok:false,code:'synthetic_storage_test_busy'});
   syntheticRunning=true;
   try{
    const result=await runSyntheticPrivateStorageCheck({storage});
    lastSynthetic={...result,checkedAt:new Date().toISOString()};
    logger('BLOFY_CONTENT_HUB_SYNTHETIC',lastSynthetic);
    return json(res,result.ok?200:503,result);
   }finally{syntheticRunning=false}
  }
  return json(res,404,{ok:false,code:'content_hub_not_found'});
 });
 return {server,recordPilot:(result)=>{pilotRunning=false;lastPilot={
  ok:result?.ok===true,code:String(result?.code||'pilot_failed'),
  stored:result?.stored===true,bytes:result?.ok?result.bytes:undefined,
  checkedAt:new Date().toISOString()};},
  startPilot:()=>{pilotRunning=true;},runSynthetic:async()=>{
  if(syntheticRunning)return {ok:false,code:'synthetic_storage_test_busy'};
  syntheticRunning=true;
  try{
   const result=await runSyntheticPrivateStorageCheck({storage});
   lastSynthetic={...result,checkedAt:new Date().toISOString()};
   logger('BLOFY_CONTENT_HUB_SYNTHETIC',lastSynthetic);
   return result;
  }finally{syntheticRunning=false}
 }};
}

if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 const storage=createPrivateS3Adapter();
 const lease=createSourceLease({connectionString:process.env.DATABASE_URL});
 const hub=createContentHubServer({storage,lease,
  token:process.env.BLOFY_CONTENT_HUB_ADMIN_TOKEN||'',
  allowSynthetic:process.env.BLOFY_CONTENT_HUB_SYNTHETIC_TEST_ENABLED==='1',
  logger:(name,payload)=>console.info(name,JSON.stringify(payload))});
 const port=Number(process.env.PORT||3000);
 hub.server.listen(port,'0.0.0.0',()=>{
  console.info('BLOFY_CONTENT_HUB_READY',JSON.stringify({port,
   privateOnly:true,downloadQueueEnabled:false,customerCutover:false}));
  if(process.env.BLOFY_CONTENT_HUB_SYNTHETIC_ON_BOOT==='1'){
   const timer=setTimeout(()=>{
    void hub.runSynthetic().catch(()=>{
     console.warn('BLOFY_CONTENT_HUB_SYNTHETIC',
      JSON.stringify({ok:false,code:'synthetic_test_unavailable'}));
    });
   },3000);
   timer.unref?.();
  }
  // Operator-only one-shot full movie pilot; all switches default OFF.
  // Never run alongside the existing small real-source sample.
  if(process.env.BLOFY_CONTENT_HUB_ONE_MOVIE_ON_BOOT==='1'&&
     process.env.BLOFY_CONTENT_HUB_REAL_SAMPLE_ON_BOOT!=='1'){
   const timer=setTimeout(()=>{
    hub.startPilot();
    void runOneMoviePilot({storage,lease,
      logger:(name,payload)=>console.info(name,JSON.stringify(payload))
    }).then(result=>{
      hub.recordPilot(result);
      console.info('BLOFY_CONTENT_HUB_ONE_MOVIE_RESULT',JSON.stringify({
       ok:result.ok,code:result.code,stored:result.stored===true,
       bytes:result.ok?result.bytes:undefined,customerCutover:false
      }));
    }).catch(()=>{
      hub.recordPilot({ok:false,code:'pilot_runner_failed',stored:false});
      console.warn('BLOFY_CONTENT_HUB_ONE_MOVIE_RESULT',JSON.stringify({
       ok:false,code:'pilot_runner_failed',stored:false,customerCutover:false
      }));
    });
   },9000);
   timer.unref?.();
  }
  if(process.env.BLOFY_CONTENT_HUB_REAL_SAMPLE_ON_BOOT==='1'){
   const timer=setTimeout(()=>{
    void runPrivateSalehSample({
      storage,lease,
      bridgeOrigin:process.env.BLOFY_CONTENT_HUB_BRIDGE_URL||'',
      bridgeToken:process.env.BLOFY_CONTENT_HUB_BRIDGE_TOKEN||'',
      enabled:process.env.BLOFY_CONTENT_HUB_STORAGE_RIGHTS_CONFIRMED==='1',
      quietWindowConfirmed:process.env.BLOFY_CONTENT_HUB_SOURCE_QUIET_WINDOW_CONFIRMED==='1'
    }).then(result=>console.info('BLOFY_CONTENT_HUB_REAL_SOURCE_S3_PROOF',
       JSON.stringify(result))).catch(()=>console.warn(
         'BLOFY_CONTENT_HUB_REAL_SOURCE_S3_PROOF',
         JSON.stringify({ok:false,code:'source_proof_unavailable',
           customerTrafficChanged:false,fullFilmDownloaded:false})));
   },6000);
   timer.unref?.();
  }
 });
 const shutdown=()=>hub.server.close(()=>void lease.close());
 process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
}
