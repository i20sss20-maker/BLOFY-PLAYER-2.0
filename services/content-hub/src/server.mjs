import http from 'node:http';
import {once} from 'node:events';
import {randomUUID,randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {createPrivateS3Adapter} from './private-s3.mjs';
import {createSourceLease} from './source-lease.mjs';
import {runPrivateSalehSample} from './real-source-sample.mjs';
import {runOneMoviePilot,inspectOneMoviePilot,probeApprovedMovieRange} from './one-movie-pilot.mjs';
import {runChunkedMovieBatch,chunkedPilotEnabled,chunkedBatchReadiness,CHUNK_BYTES} from './chunked-pilot.mjs';
import {createContinuousCopyController} from './continuous-copy.mjs';
import {diagnoseVerifiedMovie} from './playback-diagnostics.mjs';
import {verifyPrivateSeekRanges} from './seek-diagnostics.mjs';
import {buildPrivateBrowserPreview} from './private-preview.mjs';
import {inspectEpisodeCandidates} from './episode-candidates.mjs';
import {inspectEpisodeSize} from './episode-probe.mjs';

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
 token='',allowSynthetic=false,logger=()=>{},
 pilotPreflight=inspectOneMoviePilot,pilotEnv=process.env,
 batchRunner=runChunkedMovieBatch,previewBuilder=buildPrivateBrowserPreview,
 episodeCandidateInspector=inspectEpisodeCandidates,
 episodeSizeInspector=inspectEpisodeSize}={}){
 if(!storage||!lease)throw Error('content_hub_private_dependencies_required');
 const started=Date.now();
 let syntheticRunning=false,lastSynthetic=null;
 let pilotRunning=false,lastPilot=null,pilotAbort=null;
 let canaryRunning=false,lastCanary=null;
 let previewBuilding=false,previewCache=null,previewThrottleUntil=0;
 let episodeProbeBusy=false,episodeProbeAt=0,lastEpisodeProbe=null;
 const copy=createContinuousCopyController({
  runBatch:({signal})=>batchRunner({storage,lease,env:pilotEnv,signal,logger}),
  readiness:()=>chunkedBatchReadiness(pilotEnv),logger
 });
 async function runFullPlaybackCanary(runId){
  const diag=await diagnoseVerifiedMovie({runId,storage,lease});
  if(!diag.ok)return {...diag,seekVerified:false,seeksVerified:0};
  const seek=await verifyPrivateSeekRanges({
    runId,bytes:diag.verifiedMovieBytes,
    port:server.address()?.port,token
  });
  return {...diag,ok:seek.ok===true,
    code:seek.ok?'canary_audio_video_and_seeks_verified':
      'canary_private_seek_failed',
    seekVerified:seek.ok===true,
    seeksVerified:seek.seeksVerified,
    seekErrorCode:seek.ok?null:seek.code,
    unauthenticatedAccessDenied:seek.unauthorizedDenied===true,
    providerRequests:0,customerCutover:false};
 }
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
    lastSynthetic,pilotRunning:pilotRunning||copy.isRunning(),lastPilot,
    lastEpisodeProbe,
    canaryRunning,lastCanary,
    ownerPreviewEnabled:pilotEnv.BLOFY_CONTENT_HUB_OWNER_PREVIEW_ENABLED==='1',
    continuousCopy:copy.status(),durablePilot,chunkedBatchEnabled:chunkedBatchReadiness(pilotEnv).ready,
    customerCutover:false,
    licensedRightsRequired:true});
  }
  if(path==='/internal/pilot/preflight'&&req.method==='GET'){
   try{
    const result=await pilotPreflight({env:pilotEnv});
    return json(res,result.ok?200:503,result);
   }catch{
    return json(res,503,{ok:false,code:'pilot_preflight_unavailable',
     providerMediaRequests:0,downloadStarted:false});
   }
  }
  if(path==='/internal/episodes/candidates'&&req.method==='GET'){
   if(String(req.url||'').includes('?'))
    return json(res,400,{ok:false,code:'episode_query_not_allowed',
     providerMediaRequests:0,customerCutover:false});
   try{
    const result=await episodeCandidateInspector({env:pilotEnv});
    return json(res,result.ok?200:503,result);
   }catch{return json(res,503,{ok:false,
     code:'episode_catalog_preflight_failed',readOnly:true,
     providerMediaRequests:0,automaticDownload:false,
     customerCutover:false})}
  }
  // Only operator-confirmed low-impact 4KiB source probe.
  // It cannot start episode storage/copy, even with a valid bearer token.
  if(path==='/internal/episodes/probe'&&req.method==='POST'){
   if(String(req.url||'').includes('?')||
      req.headers['x-blofy-episode-probe-confirm']!=='operator-approved-probe')
    return json(res,403,{ok:false,code:'episode_probe_confirmation_required'});
   const gatewayId=Number(req.headers['x-blofy-episode-gateway-id']);
   if(!Number.isSafeInteger(gatewayId)||gatewayId<1)
    return json(res,400,{ok:false,code:'episode_probe_id_invalid'});
   if(episodeProbeBusy)return json(res,429,{
    ok:false,code:'episode_probe_busy'});
   if(Date.now()-episodeProbeAt<15000)return json(res,429,{
    ok:false,code:'episode_probe_cooldown'});
   episodeProbeAt=Date.now();episodeProbeBusy=true;
   try{
    const result=await episodeSizeInspector({gatewayId,env:pilotEnv});
    lastEpisodeProbe={...result,checkedAt:new Date().toISOString()};
    logger('BLOFY_CONTENT_HUB_EPISODE_PROBE',{
     ok:result.ok===true,code:result.code,
     gatewayId,expectedBytes:result.expectedBytes||null,
     probeBytes:result.probeBytes||0,
     customerCutover:false,stored:false
    });
    return json(res,result.ok?200:503,lastEpisodeProbe);
   }catch{
    return json(res,503,{ok:false,code:'episode_probe_failed',
     providerMediaRequests:0,stored:false,customerCutover:false});
   }finally{episodeProbeBusy=false}
  }
  if(path==='/internal/pilots'&&req.method==='GET'){
   if(String(req.url||'').includes('?'))
    return json(res,400,{ok:false,code:'content_hub_query_not_allowed'});
   try{
    const [legacyRuns,legacyAccounting,batches,batchAccounting]=await Promise.all([
      lease.listPilotRuns?.({limit:20})||[],
      lease.storageAccounting?.()||null,
      lease.listChunkedRuns?.({limit:20})||[],
      lease.chunkedStorageAccounting?.()||null
    ]);
    const runs=[...batches,...legacyRuns].sort((a,b)=>
      String(b.startedAt||'').localeCompare(String(a.startedAt||''))).slice(0,25);
    const accounting={
      verifiedCount:(legacyAccounting?.verifiedCount||0)+
        (batchAccounting?.verifiedCount||0),
      verifiedBytes:(legacyAccounting?.verifiedBytes||0)+
        (batchAccounting?.verifiedBytes||0),
      activeCount:(legacyAccounting?.activeCount||0)+
        (batchAccounting?.activeCount||0),
      failedCount:(legacyAccounting?.failedCount||0)+
        (batchAccounting?.failedCount||0),
      stagedChunkBytes:batchAccounting?.storedBytes||0,
      scope:'private_pilot_objects_only'
    };
    return json(res,200,{ok:true,privateOnly:true,customerCutover:false,
       accounting,runs,pilotRunning:pilotRunning||copy.isRunning(),
       canaryRunning,lastCanary,lastEpisodeProbe,
       ownerPreviewEnabled:pilotEnv.BLOFY_CONTENT_HUB_OWNER_PREVIEW_ENABLED==='1',
       continuousCopy:copy.status(),downloadQueueEnabled:false,
       chunkedBatchEnabled:chunkedBatchReadiness(pilotEnv).ready,
       batchReadiness:chunkedBatchReadiness(pilotEnv)});
   }catch{
    return json(res,503,{ok:false,code:'content_hub_pilot_records_unavailable'});
   }
  }
  // Short MP4 preview exclusively for an authenticated owner in STREAM.
  // Never a public link, signed URL, or subscriber route. No provider call.
  if(path==='/internal/playback/preview'&&req.method==='GET'){
   if(String(req.url||'').includes('?')||
      req.headers['x-blofy-owner-preview']!=='operator-only')
    return json(res,403,{ok:false,code:'owner_preview_confirmation_required'});
   if(pilotEnv.BLOFY_CONTENT_HUB_OWNER_PREVIEW_ENABLED!=='1')
    return json(res,409,{ok:false,code:'owner_preview_disabled'});
   if(previewBuilding)return json(res,429,{
    ok:false,code:'owner_preview_busy'});
   if(Date.now()<previewThrottleUntil&&!previewCache)
    return json(res,429,{ok:false,code:'owner_preview_cooldown'});
   const runId=String(pilotEnv.BLOFY_CONTENT_HUB_BATCH_RUN_ID||'');
   if(!/^[A-Za-z0-9_-]{8,80}$/.test(runId))
    return json(res,409,{ok:false,code:'owner_preview_movie_not_selected'});
   const abort=new AbortController();
   const timer=setTimeout(()=>abort.abort(),75000);timer.unref?.();
   const close=()=>abort.abort();
   res.once('close',close);
   let clip=null;
   try{
    if(previewCache?.runId===runId&&previewCache.expiresAt>Date.now())
     clip=previewCache.result;
    else{
     previewBuilding=true;
     // A small cooldown stops repeated video encodes on an authenticated
     // but repeatedly refreshed preview page.
     previewThrottleUntil=Date.now()+30000;
     clip=await previewBuilder({
      runId,storage,lease,signal:abort.signal});
     if(clip.ok){
      previewCache={runId,result:clip,expiresAt:Date.now()+120000};
     }
    }
    if(!clip.ok||!Buffer.isBuffer(clip.bytes))
     return json(res,503,{ok:false,code:clip.code||
      'owner_preview_unavailable',customerCutover:false});
    if(abort.signal.aborted)return;
    res.writeHead(200,{
     'content-type':'video/mp4',
     'content-length':String(clip.bytes.length),
     'content-disposition':'inline; filename="blofy-private-preview.mp4"',
     'cache-control':'private,no-store',
     'cross-origin-resource-policy':'same-origin',
     'x-content-type-options':'nosniff',
     'referrer-policy':'no-referrer'
    });
    return res.end(clip.bytes);
   }catch{
    if(!res.headersSent&&!res.destroyed)
     return json(res,503,{ok:false,code:'owner_preview_unavailable'});
    if(!res.destroyed)res.destroy();
   }finally{
    previewBuilding=false;
    clearTimeout(timer);
    res.off('close',close);
   }
   return;
  }
  if(path==='/internal/playback/diagnose'&&req.method==='POST'){
   if(String(req.headers['x-blofy-canary-confirm']||'')!=='verified-private')
    return json(res,400,{ok:false,code:'playback_canary_confirmation_required'});
   if(canaryRunning)return json(res,409,{
    ok:false,code:'playback_canary_already_running'});
   const runId=String(pilotEnv.BLOFY_CONTENT_HUB_BATCH_RUN_ID||'');
   if(!/^[A-Za-z0-9_-]{8,80}$/.test(runId))
    return json(res,409,{ok:false,code:'playback_canary_run_not_selected'});
   canaryRunning=true;
   lastCanary={ok:false,code:'playback_canary_running',
    startedAt:new Date().toISOString()};
   void runFullPlaybackCanary(runId).then(result=>{
    lastCanary={...result,checkedAt:new Date().toISOString()};
    logger('BLOFY_CONTENT_HUB_PLAYBACK_CANARY',lastCanary);
   }).catch(()=>{
    lastCanary={ok:false,code:'playback_canary_failed',
     checkedAt:new Date().toISOString(),customerCutover:false};
   }).finally(()=>{canaryRunning=false});
   return json(res,202,{ok:true,code:'playback_canary_accepted',
    privateOnly:true,customerCutover:false,providerRequests:0});
  }
  if(path==='/internal/batch/start'&&req.method==='POST'){
   if(String(req.headers['x-blofy-batch-confirm']||'')!=='approved-8mib-batch')
    return json(res,400,{ok:false,code:'batch_operator_confirmation_required'});
   if(pilotRunning||copy.isRunning())
    return json(res,409,{ok:false,code:'batch_writer_busy'});
   const result=copy.start();
   return json(res,result.ok?202:409,{
    ...result,privateOnly:true,customerCutover:false,
    downloadQueueEnabled:false});
  }
  if(path==='/internal/batch/pause'&&req.method==='POST'){
   const result=copy.stop();
   return json(res,result.ok?202:409,{
    ...result,privateOnly:true,customerCutover:false});
  }
  if(path==='/internal/batch/next'&&req.method==='POST'){
   // Explicit per-batch admin operation, never an automatic source retry.
   if(String(req.headers['x-blofy-batch-confirm']||'')!=='approved-8mib-batch')
    return json(res,400,{ok:false,code:'batch_operator_confirmation_required'});
   if(pilotRunning||copy.isRunning())return json(res,409,{
    ok:false,code:'batch_writer_busy'});
   const readiness=chunkedBatchReadiness(pilotEnv);
   if(!readiness.ready)return json(res,409,{
    ok:false,code:'batch_safety_gates_off',
    batchReadiness:readiness});
   const signal=pilotAbort=new AbortController();
   pilotRunning=true;
   void batchRunner({storage,lease,env:pilotEnv,signal:signal.signal,
      logger
    }).then(result=>{
      pilotRunning=false;pilotAbort=null;
      lastPilot={ok:result.ok,code:result.code,stored:result.completed===true,
        bytes:result.bytesCopied||result.bytes||0,
        checkedAt:new Date().toISOString()};
      logger('BLOFY_CONTENT_HUB_BATCH_RESULT',{ok:result.ok,
        code:result.code,bytes:result.bytesCopied||result.bytes||0,
        completed:result.completed===true,customerCutover:false});
    }).catch(()=>{
      pilotRunning=false;pilotAbort=null;
      lastPilot={ok:false,code:'batch_worker_unavailable',
        checkedAt:new Date().toISOString()};
    });
   return json(res,202,{ok:true,code:'batch_accepted',
     maxSourceRangeBytes:CHUNK_BYTES,automaticDownload:false,
     customerCutover:false});
  }
  if(path==='/internal/pilot/cancel'&&req.method==='POST'){
   if(copy.isRunning()){
    const result=copy.stop();
    return json(res,202,{...result,privateOnly:true,customerCutover:false});
   }
   if(!pilotRunning||!pilotAbort)
    return json(res,409,{ok:false,code:'content_hub_pilot_not_running'});
   pilotAbort.abort();
   return json(res,202,{ok:true,code:'content_hub_pilot_cancellation_requested',
      privateOnly:true,customerCutover:false});
  }
  // Admin-only and private-network-only canary. No customer cutover.
  const playback=/^\/internal\/pilot\/playback\/([A-Za-z0-9_-]{8,80})$/.exec(path);
  if(playback&&['GET','HEAD'].includes(req.method)){
   if(String(req.url||'').includes('?'))
    return json(res,400,{ok:false,code:'pilot_private_query_denied'});
   let saved=null;
   try{saved=await lease.getVerifiedPilotObject?.(playback[1])}catch{}
   if(!saved)try{saved=await lease.getVerifiedChunkedObject?.(
     playback[1])}catch{}
   if(!saved||!Number.isSafeInteger(saved.bytes)||saved.bytes<=0)
    return json(res,404,{ok:false,code:'pilot_verified_media_unavailable'});
   const ext=saved.kind==='chunked'?saved.extension:
      String(saved.key||'').split('.').pop();
   const type=ext==='mkv'?'video/x-matroska':
    ext==='mp4'?'video/mp4':
    ext==='ts'?'video/mp2t':'video/x-msvideo';
   if(req.method==='HEAD'){
    res.writeHead(200,{
      'content-type':type,'content-length':String(saved.bytes),
      'accept-ranges':'bytes','cache-control':'private,no-store',
      'x-content-type-options':'nosniff','referrer-policy':'no-referrer'
    });
    return res.end();
   }
   const m=/^bytes=(0|[1-9][0-9]*)-(0|[1-9][0-9]*)$/.exec(
    String(req.headers.range||''));
   const from=Number(m?.[1]),to=Number(m?.[2]);
   if(!m||!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||
      to<from||to>=saved.bytes||to-from+1>8*1024*1024)
    return json(res,416,{ok:false,code:'pilot_bounded_range_required'});
   const abort=new AbortController();
   const timer=setTimeout(()=>abort.abort(),90000);timer.unref?.();
   const onDisconnect=()=>abort.abort();
   res.once('close',onDisconnect);
   let body=null;
   try{
    if(saved.kind==='chunked'){
      const part=saved.parts[Math.floor(from/CHUNK_BYTES)];
      const start=from%CHUNK_BYTES;
      const firstTo=Math.min(part.bytes-1,start+to-from);
      body=await storage.readVerifiedRange({
        key:part.key,from:start,to:firstTo,
        expectedBytes:part.bytes,signal:abort.signal});
    }else body=await storage.readVerifiedRange({
      key:saved.key,from,to,expectedBytes:saved.bytes,signal:abort.signal
    });
    res.writeHead(206,{
      'content-type':type,'content-length':String(to-from+1),
      'content-range':`bytes ${from}-${to}/${saved.bytes}`,
      'accept-ranges':'bytes','cache-control':'private,no-store',
      'x-content-type-options':'nosniff','referrer-policy':'no-referrer'
    });
    let count=0;
    const streamPart=async(stream,expected)=>{
      let local=0;
      for await(const chunk of stream){
        local+=chunk.byteLength;
        if(local>expected)throw Error('pilot_media_range_overrun');
        if(!res.write(chunk))await once(res,'drain',{signal:abort.signal});
      }
      if(local!==expected)throw Error('pilot_media_range_short');
      count+=local;
    };
    if(saved.kind==='chunked'){
      let position=from;
      while(position<=to){
        const index=Math.floor(position/CHUNK_BYTES);
        const part=saved.parts[index];
        if(!part)throw Error('pilot_chunk_missing');
        const offset=position%CHUNK_BYTES;
        const right=Math.min(part.bytes-1,offset+to-position);
        if(position!==from){
          body=await storage.readVerifiedRange({key:part.key,
            from:offset,to:right,expectedBytes:part.bytes,signal:abort.signal});
        }
        await streamPart(body,right-offset+1);
        body.destroy?.();
        position+=right-offset+1;
      }
    }else await streamPart(body,to-from+1);
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
 return {server,
  runPreviewSelfCheck:async()=>{
   if(pilotEnv.BLOFY_CONTENT_HUB_OWNER_PREVIEW_ENABLED!=='1')
    return {ok:false,code:'owner_preview_disabled',providerRequests:0};
   if(previewBuilding)return {ok:false,code:'owner_preview_busy',
    providerRequests:0};
   const runId=String(pilotEnv.BLOFY_CONTENT_HUB_BATCH_RUN_ID||'');
   if(!/^[A-Za-z0-9_-]{8,80}$/.test(runId))
    return {ok:false,code:'owner_preview_movie_not_selected',
     providerRequests:0};
   previewBuilding=true;
   try{
    const result=await previewBuilder({runId,storage,lease});
    if(result.ok&&Buffer.isBuffer(result.bytes)){
     previewCache={runId,result,expiresAt:Date.now()+120000};
    }
    return {ok:result.ok===true,code:result.code,
     mp4Bytes:Buffer.isBuffer(result.bytes)?result.bytes.length:0,
     durationSeconds:result.durationSeconds||0,
     sourceSampleBytes:result.sourceSampleBytes||0,providerRequests:0,
     customerCutover:false};
   }catch{return {ok:false,code:'owner_preview_self_check_failed',
    providerRequests:0,customerCutover:false}}
   finally{previewBuilding=false}
  },
  runPlaybackCanary:async()=>{
    if(canaryRunning)return {ok:false,code:'playback_canary_already_running'};
    canaryRunning=true;
    const runId=String(process.env.BLOFY_CONTENT_HUB_BATCH_RUN_ID||'');
    try{
      const result=await runFullPlaybackCanary(runId);
      lastCanary={...result,checkedAt:new Date().toISOString()};
      logger('BLOFY_CONTENT_HUB_PLAYBACK_CANARY',lastCanary);
      return lastCanary;
    }finally{canaryRunning=false}
  },
  startContinuousCopy:()=>pilotRunning?
    {ok:false,code:'batch_writer_busy'}:copy.start(),
  stopContinuousCopy:()=>copy.stop(),
  recordPilot:(result)=>{pilotRunning=false;pilotAbort=null;lastPilot={
  ok:result?.ok===true,code:String(result?.code||'pilot_failed'),
  stored:result?.stored===true,bytes:result?.ok?result.bytes:undefined,
  checkedAt:new Date().toISOString()};},
  startPilot:()=>{pilotAbort=new AbortController();pilotRunning=true;
    return pilotAbort.signal;},runSynthetic:async()=>{
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
  // One-off read-only mapping discovery. No source media is fetched and no
  // customer path is modified; only sanitized gateway ID and extension log.
  if(process.env.BLOFY_CONTENT_HUB_PREFLIGHT_ON_BOOT==='1'){
   const timer=setTimeout(()=>{
    void inspectOneMoviePilot().then(info=>{
      console.info('BLOFY_CONTENT_HUB_PREFLIGHT',JSON.stringify({
       ok:info.ok===true,code:info.code,
       gatewayId:info.ok?info.gatewayId:null,
       extension:info.ok?info.extension:null,
       providerMediaRequests:0,customerCutover:false
      }));
    }).catch(()=>console.warn('BLOFY_CONTENT_HUB_PREFLIGHT',
     JSON.stringify({ok:false,code:'metadata_unavailable',providerMediaRequests:0})));
   },2500);timer.unref?.();
  }
  if(process.env.BLOFY_CONTENT_HUB_PROBE_ON_BOOT==='1'){
   const timer=setTimeout(()=>{
    void probeApprovedMovieRange().then(result=>{
      console.info('BLOFY_CONTENT_HUB_RANGE_PREFLIGHT',JSON.stringify({
       ok:result.ok,code:result.code,providerRequests:result.providerRequests,
       probeBytes:result.probeBytes,
       gatewayId:result.ok?result.gatewayId:null,
       expectedBytes:result.ok?result.expectedBytes:null,
       extension:result.ok?result.extension:null,
       validatorPresent:result.ok?result.validatorPresent:false,
       customerCutover:false,stored:false
      }));
    }).catch(()=>console.warn('BLOFY_CONTENT_HUB_RANGE_PREFLIGHT',
      JSON.stringify({ok:false,code:'range_probe_failed',
       stored:false,customerCutover:false})));
   },3500);timer.unref?.();
  }
  if(process.env.BLOFY_CONTENT_HUB_SYNTHETIC_ON_BOOT==='1'){
   const timer=setTimeout(()=>{
    void hub.runSynthetic().catch(()=>{
     console.warn('BLOFY_CONTENT_HUB_SYNTHETIC',
      JSON.stringify({ok:false,code:'synthetic_test_unavailable'}));
    });
   },3000);
   timer.unref?.();
  }
  // User-authorized transfer of exactly ONE 8MiB chunk. This startup
  // control never repeats after a restart because PostgreSQL claims
  // the boot event before the first upstream media request.
  if(process.env.BLOFY_CONTENT_HUB_CHUNKED_ON_BOOT==='1'){
   const timer=setTimeout(()=>{
    void (async()=>{
     const env=process.env;
     const runId=String(env.BLOFY_CONTENT_HUB_BATCH_RUN_ID||'');
     const eventToken=String(env.BLOFY_CONTENT_HUB_BATCH_BOOT_TOKEN||'');
     const ready=chunkedBatchReadiness(env);
     if(!ready.ready)return {ok:false,code:'batch_safety_gates_off',
       blockedBy:ready.blockedBy,customerCutover:false};
     const burst=Number(env.BLOFY_CONTENT_HUB_BATCH_BOOT_BURST||1);
     if(!Number.isSafeInteger(burst)||burst<1||burst>4||
       String(env.BLOFY_CONTENT_HUB_CHUNKS_PER_BATCH||1)!=='1')
      return {ok:false,code:'batch_boot_burst_limit_invalid',
        customerCutover:false};
     const claimed=await lease.claimBatchBootOnce(eventToken,runId);
     if(!claimed)return {ok:false,code:'batch_boot_already_claimed',
       customerCutover:false};
     const signal=hub.startPilot();
     let output={ok:false,code:'batch_not_run',customerCutover:false};
     let executed=0;
     try{
      for(let i=0;i<burst;i++){
       if(signal.aborted)break;
       output=await runChunkedMovieBatch({storage,lease,env,signal,
        logger:(name,payload)=>console.info(name,JSON.stringify(payload))});
       executed++;
       if(!output.ok||output.completed===true)break;
      }
      return {...output,executedBatches:executed};
     }finally{hub.recordPilot({ok:output.ok,code:output.code,
       stored:output.completed===true,bytes:output.bytesCopied||0})}
    })().then(result=>{
     console.info('BLOFY_CONTENT_HUB_BATCH_BOOT',JSON.stringify({
      ok:result.ok===true,code:result.code,blockedBy:result.blockedBy,
      errorStage:result.errorStage||null,
      executedBatches:result.executedBatches||0,
      bytesCopied:result.bytesCopied||0,chunksSaved:result.chunksSaved||0,
      completed:result.completed===true,customerCutover:false
     }));
    }).catch(()=>console.warn('BLOFY_CONTENT_HUB_BATCH_BOOT',
     JSON.stringify({ok:false,code:'batch_boot_unavailable',
      customerCutover:false})));
   },6500);timer.unref?.();
  }
  // One explicit, durable operator-authorized CONTINUOUS copy attempt.
  // No restart loop: the PostgreSQL event token is claimed once before
  // contacting the provider. Manual start/stop remains available from STREAM.
  if(process.env.BLOFY_CONTENT_HUB_CONTINUOUS_ON_BOOT==='1'&&
     process.env.BLOFY_CONTENT_HUB_CHUNKED_ON_BOOT!=='1'){
   const timer=setTimeout(()=>{
    void (async()=>{
     const env=process.env;
     const runId=String(env.BLOFY_CONTENT_HUB_BATCH_RUN_ID||'');
     const token=String(env.BLOFY_CONTENT_HUB_CONTINUOUS_BOOT_TOKEN||'');
     if(!/^[A-Za-z0-9_-]{8,80}$/.test(token))
      return {ok:false,code:'continuous_boot_token_invalid'};
     const ready=chunkedBatchReadiness(env);
     if(!ready.ready)return {ok:false,code:'continuous_safety_gates_off',
       blockedBy:ready.blockedBy};
     const claimed=await lease.claimBatchBootOnce(token,runId);
     if(!claimed)return {ok:false,code:'continuous_boot_already_claimed'};
     return hub.startContinuousCopy();
    })().then(result=>console.info('BLOFY_CONTENT_HUB_CONTINUOUS_BOOT',
     JSON.stringify({ok:result.ok,code:result.code,
      customerCutover:false,privateOnly:true}))).catch(()=>
     console.warn('BLOFY_CONTENT_HUB_CONTINUOUS_BOOT',JSON.stringify({
      ok:false,code:'continuous_boot_failed',customerCutover:false})));
   },8500);timer.unref?.();
  }
  // One-time read-only catalog snapshot for the first episode pilot.
  // No upstream media connection, S3 write, customer route, or batch copy.
  if(process.env.BLOFY_CONTENT_HUB_EPISODE_PREFLIGHT_ON_BOOT==='1'){
   const timer=setTimeout(()=>{
    void inspectEpisodeCandidates({env:process.env}).then(result=>{
     console.info('BLOFY_CONTENT_HUB_EPISODE_PREFLIGHT',JSON.stringify({
      ok:result.ok===true,code:result.code,
      candidates:Array.isArray(result.candidates)?result.candidates.length:0,
      providerMediaRequests:0,automaticDownload:false,
      customerCutover:false
     }));
    }).catch(()=>console.warn('BLOFY_CONTENT_HUB_EPISODE_PREFLIGHT',
     JSON.stringify({ok:false,code:'episode_catalog_unavailable',
      providerMediaRequests:0,automaticDownload:false})));
   },4000);timer.unref?.();
  }
  // One-time real browser MP4 transcode smoke check. Only S3 bytes,
  // no Xtream/requests to customers. Durable token prevents boot replays.
  if(process.env.BLOFY_CONTENT_HUB_PREVIEW_TEST_ON_BOOT==='1'){
   const timer=setTimeout(()=>{
    void (async()=>{
     const runId=String(process.env.BLOFY_CONTENT_HUB_BATCH_RUN_ID||''),
       event=String(process.env.BLOFY_CONTENT_HUB_PREVIEW_BOOT_TOKEN||'');
     if(!/^[A-Za-z0-9_-]{8,80}$/.test(event))
      return {ok:false,code:'owner_preview_event_invalid'};
     if(!await lease.claimBatchBootOnce(event,runId))
      return {ok:false,code:'owner_preview_event_already_claimed'};
     return hub.runPreviewSelfCheck();
    })().then(result=>console.info('BLOFY_CONTENT_HUB_PRIVATE_PREVIEW',
      JSON.stringify(result))).catch(()=>console.warn(
       'BLOFY_CONTENT_HUB_PRIVATE_PREVIEW',
       JSON.stringify({ok:false,code:'owner_preview_boot_unavailable',
        providerRequests:0,customerCutover:false})));
   },5000);timer.unref?.();
  }
  // Independently decode a verified PRIVATE movie sample with FFprobe
  // and FFmpeg once. This NEVER touches the Xtream source or subscriber.
  if(process.env.BLOFY_CONTENT_HUB_CANARY_ON_BOOT==='1'){
   const timer=setTimeout(()=>{
    void (async()=>{
     const runId=String(process.env.BLOFY_CONTENT_HUB_BATCH_RUN_ID||'');
     const token=String(process.env.BLOFY_CONTENT_HUB_CANARY_BOOT_TOKEN||'');
     if(!/^[A-Za-z0-9_-]{8,80}$/.test(token))
      return {ok:false,code:'canary_boot_token_invalid'};
     if(!await lease.claimBatchBootOnce(token,runId))
      return {ok:false,code:'canary_boot_already_claimed'};
     return hub.runPlaybackCanary();
    })().then(result=>{
      console.info('BLOFY_CONTENT_HUB_PLAYBACK_CANARY_BOOT',JSON.stringify({
       ok:result.ok,code:result.code,customerCutover:false,
       providerRequests:0
      }));
    }).catch(()=>console.warn('BLOFY_CONTENT_HUB_PLAYBACK_CANARY_BOOT',
     JSON.stringify({ok:false,code:'canary_boot_failed',
      customerCutover:false,providerRequests:0})));
   },7000);timer.unref?.();
  }
  // Operator-only one-shot full movie pilot; all switches default OFF.
  // Never run alongside the existing small real-source sample.
  if(process.env.BLOFY_CONTENT_HUB_ONE_MOVIE_ON_BOOT==='1'&&
     process.env.BLOFY_CONTENT_HUB_REAL_SAMPLE_ON_BOOT!=='1'){
   const timer=setTimeout(()=>{
    const signal=hub.startPilot();
    void runOneMoviePilot({storage,lease,signal,
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
 const shutdown=()=>{
  hub.stopContinuousCopy();
  hub.server.close(()=>void lease.close());
 };
 process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
}
