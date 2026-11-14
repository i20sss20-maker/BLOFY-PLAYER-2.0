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
import {runOneEpisodeChunk,episodeCopyReadiness} from './episode-chunk-pilot.mjs';
import {createContentCatalogStore,validateCuratedMetadata} from './curated-metadata.mjs';
import {createMetadataMatcher,validateMatchRequest,deriveEpisodeTitleHints} from './metadata-matcher.mjs';
import {buildMetadataReview} from './metadata-review.mjs';
import {createSeasonQueueStore,createSeasonQueueController,seasonQueueReadiness,validateSeasonSelection,seasonQueueSummary} from './season-queue.mjs';
import {inspectLicensedSeries,inspectLicensedSeriesEpisodes,inspectLicensedPilotSeries} from './series-catalog.mjs';
import {summarizeSeasonHealth,auditSeasonEpisodeSample} from './season-health.mjs';
import {buildSeasonAnalytics} from './season-analytics.mjs';
import {buildSeasonReport} from './season-report.mjs';
import {buildSeasonAttention} from './season-attention.mjs';
import {checkPrivateReadConcurrency,validateConcurrentReadIds} from './concurrent-private-read.mjs';

const FIXTURE_SOURCE='00000000-0000-4000-8000-000000000000';
const FIXTURE_SIZE=8*1024*1024;
const json=(res,status,payload)=>{
 const body=Buffer.from(JSON.stringify(payload));
 res.writeHead(status,{'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store','content-length':body.length,
  'x-content-type-options':'nosniff','referrer-policy':'no-referrer'});
 res.end(body);
};
async function readSeasonJson(req){
 if(!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type']||'')))
  throw Error('season_json_required');
 const chunks=[];let bytes=0;
 for await(const chunk of req){
  bytes+=chunk.length;
  if(bytes>8192)throw Error('season_json_too_large');
  chunks.push(chunk);
 }
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}
 catch{throw Error('season_json_invalid')}
}
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
 episodeSizeInspector=inspectEpisodeSize,
 episodeChunkRunner=runOneEpisodeChunk,seasonQueueStore=null,catalogStore=null,
 metadataMatcher=createMetadataMatcher({
  token:process.env.BLOFY_TMDB_READ_TOKEN||'',
  commercialLicenseConfirmed:process.env.BLOFY_TMDB_COMMERCIAL_LICENSE_CONFIRMED==='1'
 }),
 seriesCatalogInspector=inspectLicensedSeries,
 pilotSeriesInspector=inspectLicensedPilotSeries,
 seriesEpisodesInspector=inspectLicensedSeriesEpisodes}={}){
 if(!storage||!lease)throw Error('content_hub_private_dependencies_required');
 const started=Date.now();
 let syntheticRunning=false,lastSynthetic=null;
 let pilotRunning=false,lastPilot=null,pilotAbort=null;
 let canaryRunning=false,lastCanary=null;
 let episodeCanaryRunning=false,lastEpisodeCanary=null;
 let previewBuilding=false,previewCache=null,previewThrottleUntil=0;
 let episodeProbeBusy=false,episodeProbeAt=0,lastEpisodeProbe=null;
 let episodeCopyBusy=false,episodeCopyAbort=null,lastEpisodeCopy=null;
 let seasonStorageAuditBusy=false,seasonStorageAuditAt=0;
 let seasonConcurrentReadBusy=false,seasonConcurrentReadAt=0,lastSeasonConcurrentRead=null;
 const copy=createContinuousCopyController({
  runBatch:({signal})=>batchRunner({storage,lease,env:pilotEnv,signal,logger}),
  readiness:()=>chunkedBatchReadiness(pilotEnv),logger
 });
 // Strict single-source sequential episode loop, never concurrent with
 // the movie loop. Operator starts/stops it; no subscriber cutover.
 const episodeCopy=createContinuousCopyController({
  runBatch:({signal})=>episodeChunkRunner({
   env:pilotEnv,storage,lease,signal,logger}),
  readiness:()=>episodeCopyReadiness(pilotEnv),logger,
  delayMs:2200,maxBatches:180,maxDurationMs:45*60*1000
 });
 const seasonQueue=seasonQueueStore?createSeasonQueueController({
  store:seasonQueueStore,storage,lease,env:pilotEnv,
  runner:episodeChunkRunner,logger,
  isSourceBusy:()=>episodeCopyBusy||episodeCopy.isRunning()||
   pilotRunning||copy.isRunning()
 }):null;
 async function runFullPlaybackCanary(runId,mediaKind='movie'){
  const diag=await diagnoseVerifiedMovie({runId,storage,lease,mediaKind});
  if(!diag.ok)return {...diag,seekVerified:false,seeksVerified:0};
  const seek=await verifyPrivateSeekRanges({
    runId,bytes:diag.verifiedMovieBytes,
    port:server.address()?.port,token,mediaKind
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
   let ownerBrowserCheck={confirmed:false,videoConfirmed:false,audioConfirmed:false};
   try{bucket=(await storage.health()).ok===true}catch{}
   try{database=await lease.health()}catch{}
   try{durablePilot=await lease.getPilotStatus?.(
     String(process.env.BLOFY_CONTENT_HUB_PILOT_RUN_ID||''))}catch{}
   try{ownerBrowserCheck=await lease.getEpisodeBrowserPlaybackStatus?.(
     String(pilotEnv.BLOFY_CONTENT_HUB_EPISODE_RUN_ID||''))||ownerBrowserCheck}catch{}
   return json(res,bucket&&database?200:503,{
    ok:bucket&&database,privateBucketAvailable:bucket,
    databaseAvailable:database,downloadQueueEnabled:Boolean(seasonQueue)&&seasonQueueReadiness(pilotEnv).ready,
    seasonQueue:seasonQueue?.status()||null,
    ownerEpisodeBrowserCheck:ownerBrowserCheck,
    syntheticTestEnabled:allowSynthetic,
    lastSynthetic,pilotRunning:pilotRunning||copy.isRunning(),lastPilot,
    lastEpisodeProbe,episodeCopyBusy:episodeCopyBusy||episodeCopy.isRunning(),
    lastEpisodeCopy,episodeContinuousCopy:episodeCopy.status(),
    episodeCopyReadiness:episodeCopyReadiness(pilotEnv),
    canaryRunning,lastCanary,episodeCanaryRunning,lastEpisodeCanary,
    ownerPreviewEnabled:pilotEnv.BLOFY_CONTENT_HUB_OWNER_PREVIEW_ENABLED==='1',
    ownerEpisodePreviewEnabled:pilotEnv.BLOFY_CONTENT_HUB_OWNER_PREVIEW_ENABLED==='1'&&
      pilotEnv.BLOFY_CONTENT_HUB_EPISODE_OWNER_PREVIEW_ENABLED==='1',
    continuousCopy:copy.status(),durablePilot,chunkedBatchEnabled:chunkedBatchReadiness(pilotEnv).ready,
    customerCutover:false,
    licensedRightsRequired:true});
  }
  if(path==='/internal/episodes/playback/confirmation'&&
     req.method==='GET'){
   if(String(req.url||'').includes('?'))
    return json(res,400,{ok:false,code:'episode_browser_query_not_allowed'});
   const runId=String(pilotEnv.BLOFY_CONTENT_HUB_EPISODE_RUN_ID||'');
   try{
    const state=await lease.getEpisodeBrowserPlaybackStatus?.(runId);
    return json(res,200,{ok:true,privateOnly:true,customerCutover:false,
     ...(state||{confirmed:false,videoConfirmed:false,
      audioConfirmed:false})});
   }catch{return json(res,503,{
    ok:false,code:'episode_browser_confirmation_read_failed'})}
  }
  if(path==='/internal/episodes/playback/confirm'&&
     req.method==='POST'){
   if(String(req.url||'').includes('?')||
     req.headers['x-blofy-browser-confirm']!=='owner-saw-and-heard'||
     req.headers['x-blofy-video-confirmed']!=='yes'||
     req.headers['x-blofy-audio-confirmed']!=='yes')
    return json(res,403,{ok:false,code:'episode_browser_manual_confirmation_required'});
   if(pilotEnv.BLOFY_CONTENT_HUB_OWNER_PREVIEW_ENABLED!=='1'||
      pilotEnv.BLOFY_CONTENT_HUB_EPISODE_OWNER_PREVIEW_ENABLED!=='1')
    return json(res,409,{ok:false,code:'episode_owner_preview_disabled'});
   const runId=String(pilotEnv.BLOFY_CONTENT_HUB_EPISODE_RUN_ID||'');
   try{
    const verified=await lease.getVerifiedEpisodeObject?.(runId);
    if(!verified)return json(res,409,{
     ok:false,code:'episode_not_storage_verified'});
    const proof=await lease.confirmEpisodeBrowserPlayback?.(runId);
    if(proof?.confirmed!==true)throw Error('missing_browser_proof');
    return json(res,200,{ok:true,code:'owner_browser_av_confirmed',
     privateOnly:true,customerCutover:false,
     confirmedAt:proof.confirmedAt,runId});
   }catch{return json(res,503,{
    ok:false,code:'episode_browser_confirmation_failed'})}
  }
  if(path==='/internal/series/pilot'&&req.method==='GET'){
   if(String(req.url||'').includes('?'))
    return json(res,400,{ok:false,code:'pilot_series_query_not_allowed'});
   const data=await pilotSeriesInspector({env:pilotEnv});
   return json(res,data.ok?200:503,data);
  }
  if(path==='/internal/series/candidates'&&req.method==='GET'){
   if(String(req.url||'').includes('?'))
    return json(res,400,{ok:false,code:'series_query_not_allowed'});
   const data=await seriesCatalogInspector({env:pilotEnv});
   return json(res,data.ok?200:503,data);
  }
  const seriesInfoRoute=/^\/internal\/series\/episodes\/([1-9][0-9]{0,14})$/.exec(path);
  if(seriesInfoRoute&&req.method==='GET'){
   if(String(req.url||'').includes('?'))
    return json(res,400,{ok:false,code:'series_query_not_allowed'});
   const data=await seriesEpisodesInspector({
    seriesGatewayId:Number(seriesInfoRoute[1]),env:pilotEnv});
   return json(res,data.ok?200:503,data);
  }
  // Exact read-only pagination. Fixed route, no query parameters.
  // Each response only includes 50 individually licensed episode rows;
  // page summaries describe visible rows, while health has global counts.
  const seasonFilteredPageRoute=/^\/internal\/seasons\/queue\/status\/(all|pending|queued|running|paused|verified|failed)\/page\/([1-9][0-9]{0,4})$/.exec(path);
  const seasonPageRoute=/^\/internal\/seasons\/queue\/page\/([1-9][0-9]{0,4})$/.exec(path);
  if((seasonPageRoute||seasonFilteredPageRoute)&&req.method==='GET'){
   if(String(req.url||'').includes('?'))
    return json(res,400,{ok:false,code:'season_queue_page_query_denied'});
   if(!seasonQueueStore?.listPage||!seasonQueue)
    return json(res,503,{ok:false,code:'season_queue_pagination_unavailable'});
   const number=Number(seasonPageRoute?.[1]||seasonFilteredPageRoute?.[2]);
   const state=seasonFilteredPageRoute?.[1]||'all';
   if(number>20000)return json(res,400,{
    ok:false,code:'season_queue_page_out_of_range'});
   try{
    const result=await seasonQueueStore.listPage({page:number,state});
    return json(res,200,{ok:true,privateOnly:true,
     customerCutover:false,readOnly:true,
     readiness:seasonQueueReadiness(pilotEnv),
     worker:seasonQueue.status(),
     page:result.page,seasons:seasonQueueSummary(result.episodes),
     episodes:result.episodes});
   }catch{return json(res,503,{ok:false,
    code:'season_queue_page_unavailable'})}
  }
  // Owner-only queue. It accepts listed, individually licensed episodes
  // and cannot alter customer routes or expose the private bucket.
  if(path==='/internal/seasons/queue'&&req.method==='GET'){
   if(String(req.url||'').includes('?'))
    return json(res,400,{ok:false,code:'season_query_not_allowed'});
   if(!seasonQueueStore)return json(res,503,{
    ok:false,code:'season_queue_unavailable'});
   try{
    const episodes=await seasonQueueStore.list();
    return json(res,200,{ok:true,privateOnly:true,customerCutover:false,
     downloadQueueEnabled:seasonQueueReadiness(pilotEnv).ready,
     readiness:seasonQueueReadiness(pilotEnv),
     worker:seasonQueue.status(),seasons:seasonQueueSummary(episodes),
     episodes});
   }catch{return json(res,503,{ok:false,code:'season_queue_read_failed'})}
  }
  // Read-only exact accounting, no S3 list and no upstream source calls.
  if(path==='/internal/seasons/health'&&req.method==='GET'){
   if(String(req.url||'').includes('?'))
    return json(res,400,{ok:false,code:'season_health_query_not_allowed'});
   if(!seasonQueueStore?.healthStats||!seasonQueueStore?.recentAudits)
    return json(res,503,{ok:false,code:'season_health_unavailable'});
   try{
    const [stats,audits,unresolvedAudits]=await Promise.all([
     seasonQueueStore.healthStats(),seasonQueueStore.recentAudits(),
     seasonQueueStore.unresolvedAuditCounts?.()||{mismatch:0,unavailable:0}]);
    const worker=seasonQueue?.status()||{};
    const currentCheckpoint=worker.active===true&&worker.currentRunId&&
      seasonQueueStore?.currentCheckpoint?
      await seasonQueueStore.currentCheckpoint(worker.currentRunId):null;
    const pilotRunId=String(pilotEnv.BLOFY_CONTENT_HUB_EPISODE_RUN_ID||'');
    let verifiedPilotRunId=null;
    if(/^[A-Za-z0-9_-]{8,80}$/.test(pilotRunId)){
     try{
      if(await lease.getVerifiedEpisodeObject?.(pilotRunId))
       verifiedPilotRunId=pilotRunId;
     }catch{}
    }
    return json(res,200,{
     ...summarizeSeasonHealth({
      stats,audits,unresolvedAudits,worker,currentCheckpoint,
      storageSoftLimitBytes:pilotEnv.BLOFY_CONTENT_HUB_STORAGE_SOFT_LIMIT_BYTES
     }),verifiedPilotRunId,lastConcurrentRead:lastSeasonConcurrentRead});

   }catch{return json(res,503,{ok:false,code:'season_health_database_unavailable'})}
  }
  // Owner-only, read-only season detail; no media or S3 access.
  const detailRoute=/^\/internal\/seasons\/report\/([a-z0-9][a-z0-9_-]{2,63})\/page\/([1-9][0-9]{0,4})$/.exec(path);
  if(detailRoute&&req.method==='GET'){
   if(String(req.url||'').includes('?'))
    return json(res,400,{ok:false,code:'season_report_query_denied'});
   if(!seasonQueueStore?.seasonDetailPage||
      !seasonQueueStore?.seasonTransferEvents)
    return json(res,503,{ok:false,code:'season_report_unavailable'});
   const seasonKey=detailRoute[1],page=Number(detailRoute[2]);
   if(page>20000)return json(res,400,{
    ok:false,code:'season_report_page_invalid'});
   try{
    const [data,events,timing]=await Promise.all([
     seasonQueueStore.seasonDetailPage({seasonKey,page}),
     seasonQueueStore.seasonTransferEvents({seasonKey}),
     seasonQueueStore.seasonTimingStats?.({seasonKey})||{}
    ]);
    if(!data)return json(res,404,{ok:false,code:'season_report_not_found'});
    return json(res,200,buildSeasonReport({
     ...data,events,timing,worker:seasonQueue?.status()||{}
    }));
   }catch{return json(res,503,{ok:false,code:'season_report_database_unavailable'})}
  }
  // Explicit owner human video AND audio check for one storage-verified
  // episode. Neither a video analyzer nor subscriber playback approval.
  if(path==='/internal/seasons/episodes/av/confirm'&&req.method==='POST'){
   if(String(req.url||'').includes('?')||
      req.headers['x-blofy-owner-action']!=='confirm-manual-episode-av'||
      req.headers['x-blofy-video-confirmed']!=='yes'||
      req.headers['x-blofy-audio-confirmed']!=='yes')
    return json(res,403,{ok:false,code:'episode_av_manual_owner_confirmation_required'});
   if(!seasonQueueStore?.confirmEpisodeAv)return json(res,503,{
    ok:false,code:'episode_av_review_unavailable'});
   let body;
   try{body=await readSeasonJson(req)}
   catch{return json(res,400,{ok:false,code:'episode_av_request_invalid'})}
   if(!body||body.confirmed!==true||
      body.videoConfirmed!==true||body.audioConfirmed!==true||
      typeof body.runId!=='string'||
      !/^[A-Za-z0-9_-]{8,80}$/.test(body.runId))
    return json(res,400,{ok:false,code:'episode_av_request_invalid'});
   try{
    const result=await seasonQueueStore.confirmEpisodeAv({
     runId:body.runId});
    return json(res,result.ok?200:409,{
     ...result,privateOnly:true,manualOnly:true,
     customerCutover:false,automaticStart:false,storageRequests:0,
     providerMediaRequests:0});
   }catch{return json(res,503,{ok:false,code:'episode_av_review_database_unavailable'})}
  }
  // Private owner alert triage. The caller gets database snapshots only.
  if(path==='/internal/seasons/attention'&&req.method==='GET'){
   if(String(req.url||'').includes('?'))
    return json(res,400,{ok:false,code:'season_attention_query_forbidden'});
   if(!seasonQueueStore?.attentionRows)
    return json(res,503,{ok:false,code:'season_attention_unavailable'});
   try{
    const rows=await seasonQueueStore.attentionRows({limit:51});
    return json(res,200,buildSeasonAttention({
     rows,limited:rows.length>50,worker:seasonQueue?.status()||{}
    }));
   }catch{return json(res,503,{ok:false,
    code:'season_attention_database_unavailable'})}
  }
  // Manually curated labels and posters, completely separate from media runs.
  if(path==='/internal/library/metadata'&&req.method==='POST'){
   if(String(req.url||'').includes('?')||
      req.headers['x-blofy-owner-action']!=='curate-private-metadata')
    return json(res,403,{ok:false,code:'curated_owner_confirmation_required'});
   if(!catalogStore?.save)
    return json(res,503,{ok:false,code:'curated_metadata_unavailable'});
   let input;
   try{input=await readSeasonJson(req);validateCuratedMetadata(input)}
   catch{return json(res,400,{ok:false,code:'curated_metadata_invalid'})}
   try{
    const result=await catalogStore.save(input);
    return json(res,result.ok?200:404,result);
   }catch{return json(res,503,{ok:false,code:'curated_metadata_database_unavailable'})}
  }
  // Private, strictly owner-clicked match review. A registered media key
  // is mandatory. Local episode title hints work even without TMDB access.
  if(path==='/internal/library/matches'&&req.method==='POST'){
   if(String(req.url||'').includes('?')||
      req.headers['x-blofy-owner-action']!=='match-private-metadata')
    return json(res,403,{ok:false,code:'metadata_match_owner_only'});
   if(!catalogStore?.hasRegisteredKey||!catalogStore?.episodeTitleHints)
    return json(res,503,{ok:false,code:'metadata_match_unavailable'});
   let input;
   try{input=validateMatchRequest(await readSeasonJson(req))}
   catch{return json(res,400,{ok:false,code:'metadata_match_invalid'})}
   let registered=false,hints=[];
   try{
    registered=await catalogStore.hasRegisteredKey(input.key);
    if(registered&&input.kind==='series'){
     hints=deriveEpisodeTitleHints(
      await catalogStore.episodeTitleHints(input.key));
    }
   }catch{return json(res,503,{ok:false,code:'metadata_match_database_unavailable'})}
   if(!registered)return json(res,404,{ok:false,
    code:'metadata_match_media_not_registered'});
   const lookup=await metadataMatcher.suggest(input).catch(()=>({
    ok:false,code:'tmdb_lookup_unavailable',candidates:[]}));
   return json(res,200,{
    ok:true,readOnly:true,privateOnly:true,
    key:input.key,kind:input.kind,query:input.query,
    localHints:hints.slice(0,5),candidates:Array.isArray(lookup.candidates)?
     lookup.candidates.slice(0,8):[],
    tmdbEnabled:metadataMatcher.enabled===true,
    tmdbLookupStatus:lookup.ok===true?
     (lookup.configured===false?'commercial_license_not_configured':'ready'):
     String(lookup.code||'tmdb_lookup_unavailable'),
    tmdbRequests:Number(lookup.tmdbRequests||0),
    providerMediaRequests:0,storageRequests:0,automaticSave:false,
    needsOwnerReview:true,
    tmdbAttribution:'This product uses the TMDB API but is not endorsed or certified by TMDB.',
    commercialLicenseRequired:true,
    artworkUseRequiresRights:true
   });
  }
  // Bounded series details from registered private queue entries only.
  const registeredSeriesRoute=/^\/internal\/library\/series\/([1-9][0-9]{0,14})$/.exec(path);
  if(registeredSeriesRoute&&req.method==='GET'){
   if(String(req.url||'').includes('?')||
      req.headers['x-blofy-owner-action']!=='view-private-series')
    return json(res,403,{ok:false,code:'series_detail_owner_read_required'});
   if(!seasonQueueStore?.registeredSeriesSummary)
    return json(res,503,{ok:false,code:'series_detail_unavailable'});
   try{
    const detail=await seasonQueueStore.registeredSeriesSummary({
     seriesId:registeredSeriesRoute[1]});
    return json(res,200,{ok:true,privateOnly:true,readOnly:true,
     customerCutover:false,...detail});
   }catch{return json(res,503,{ok:false,code:'series_detail_database_unavailable'})}
  }
  // Read-only library search. Owner token and explicit action assertion
  // are required even though this POST never mutates content.
  if(path==='/internal/library/search'&&req.method==='POST'){
   if(String(req.url||'').includes('?')||
      req.headers['x-blofy-owner-action']!=='library-read-only')
    return json(res,403,{ok:false,code:'library_owner_read_required'});
   if(!seasonQueueStore?.librarySearch)
    return json(res,503,{ok:false,code:'library_search_unavailable'});
   let body;
   try{body=await readSeasonJson(req)}
   catch{return json(res,400,{ok:false,code:'library_search_bad_json'})}
   if(!body||typeof body.query!=='string'||body.query.length>80||
      /[\x00-\x1f\x7f]/.test(body.query)||
      !['all','queued','paused','running','verified','failed'].includes(body.state)||
      !Number.isSafeInteger(body.page)||body.page<1||body.page>20000)
    return json(res,400,{ok:false,code:'library_search_invalid'});
   try{
    const seriesMatches=body.query.trim()&&catalogStore?.searchSeriesIds?
     await catalogStore.searchSeriesIds(body.query).catch(()=>({ids:[],limited:true})):
     {ids:[],limited:false};
    const [data,a,b]=await Promise.all([
     seasonQueueStore.librarySearch({
      query:body.query,state:body.state,page:body.page,
      seriesIds:seriesMatches.ids}),
     Promise.resolve().then(()=>lease.listPilotRuns?.({limit:50})||[]),
     Promise.resolve().then(()=>lease.listChunkedRuns?.({limit:50})||[])
    ].map((p,i)=>i===0?p:Promise.resolve(p).catch(()=>null)));
    const norm=(raw,format)=>Array.isArray(raw)?raw.slice(0,50).map(x=>{
     const state=['verified','failed'].includes(x.state)?x.state:
      ['started','staged','running'].includes(x.state)?'running':'unknown';
     const expected=Math.max(0,Number(x.expectedBytes)||0);
     const stored=Math.min(expected,Math.max(0,Number(x.bytesCopied)||0));
     return {runId:String(x.runId||''),format,state,
      expectedBytes:expected,storedBytes:stored,
      percent:expected?Math.min(100,Math.floor(stored*100/expected)):0,
      verified:state==='verified',date:x.finishedAt||x.startedAt||null,
      code:/^[a-z0-9_]{1,80}$/.test(String(x.code||''))?x.code:null};
    }).filter(x=>/^[A-Za-z0-9_-]{8,80}$/.test(x.runId)):[];
    const allMovies=[...norm(a,'legacy'),...norm(b,'chunked')];
    const seriesKey=seasonKey=>{
     const match=/^series_([1-9][0-9]{0,14})_s[0-9]+$/.exec(
      String(seasonKey||''));
     return match?'series:'+match[1]:null;
    };
    const keys=[...new Set([
     ...allMovies.map(m=>'movie:'+m.runId),
     ...(data.seasons||[]).map(s=>seriesKey(s.seasonKey)),
     ...(data.episodes||[]).map(e=>seriesKey(e.seasonKey))
    ].filter(Boolean))];
    let metadataAvailable=Boolean(catalogStore?.find);
    const curated=[];
    if(metadataAvailable){
     try{
      for(let i=0;i<keys.length;i+=150){
       curated.push(...await catalogStore.find(keys.slice(i,i+150)));
      }
     }catch{metadataAvailable=false}
    }
    const byKey=new Map(curated.map(x=>[x.key,x]));
    const seasons=(data.seasons||[]).map(x=>({
     ...x,metadata:byKey.get(seriesKey(x.seasonKey))||null
    }));
    const episodes=(data.episodes||[]).map(x=>({
     ...x,seriesMetadata:byKey.get(seriesKey(x.seasonKey))||null
    }));
    const enrichedMovies=allMovies.map(x=>({
     ...x,metadata:byKey.get('movie:'+x.runId)||null
    }));
    const query=body.query.trim().toLocaleLowerCase();
    const matches=enrichedMovies.filter(x=>
     (!query||x.runId.toLocaleLowerCase().includes(query)||
       x.metadata?.title?.toLocaleLowerCase().includes(query))&&
     (body.state==='all'||x.state===body.state));
    matches.sort((x,y)=>String(y.date||'').localeCompare(String(x.date||'')));
    const visibleMovies=matches.slice((body.page-1)*40,body.page*40);
    const metadataReview=metadataAvailable?buildMetadataReview({
     movies:visibleMovies,seasons,
     moviesSampleLimited:(Array.isArray(a)&&a.length>=50)||
      (Array.isArray(b)&&b.length>=50),
     seasonsHasMore:data.seasonsHasMore===true,page:body.page
    }):null;
    return json(res,200,{ok:true,privateOnly:true,readOnly:true,
     customerCutover:false,automaticStart:false,automaticRetry:false,
     providerMediaRequests:0,storageRequests:0,...data,
     seasons,episodes,metadataAvailable,curatedOnly:true,metadataReview,
     curatedTitleMatchesLimited:seriesMatches.limited===true,
     artworkProvider:'tmdb_manually_selected_poster_path',
     movies:visibleMovies,
     movieHistoryAvailable:a!==null&&b!==null,
     movieHistoryMaybeLimited:(Array.isArray(a)&&a.length>=50)||
       (Array.isArray(b)&&b.length>=50),
     movieScope:'most_recent_50_legacy_and_50_chunked_runs_not_global_search',
     movieHasMore:matches.length>body.page*40,
     searchablePersistedSeasons:true});
   }catch{return json(res,503,{ok:false,code:'library_search_database_unavailable'})}
  }
  // Bounded operator analytics. No source requests, no S3 listing,
  // no control actions and no customer/player-facing routes.
  if(path==='/internal/seasons/analytics'&&req.method==='GET'){
   if(String(req.url||'').includes('?'))
    return json(res,400,{ok:false,code:'season_analytics_query_not_allowed'});
   if(!seasonQueueStore?.analyticsStats||
      !seasonQueueStore?.seasonAnalyticsSummary)
    return json(res,503,{ok:false,code:'season_analytics_unavailable'});
   try{
    const [stats,metrics,seasons,failures,events,audits,unresolved,
     episodeStates]=await Promise.all([
      seasonQueueStore.healthStats(),seasonQueueStore.analyticsStats(),
      seasonQueueStore.seasonAnalyticsSummary(),seasonQueueStore.failureReasons(),
      seasonQueueStore.recentTransferEvents(),seasonQueueStore.recentAudits(),
      seasonQueueStore.unresolvedAuditCounts?.()||{mismatch:0,unavailable:0},
      seasonQueueStore.recentEpisodeStates?.()||[]
     ]);
    const worker=seasonQueue?.status()||{};
    const currentCheckpoint=worker.active&&worker.currentRunId?
     await seasonQueueStore.currentCheckpoint?.(worker.currentRunId):null;
    const health=summarizeSeasonHealth({
     stats,audits,unresolvedAudits:unresolved,worker,currentCheckpoint,
     storageSoftLimitBytes:pilotEnv.BLOFY_CONTENT_HUB_STORAGE_SOFT_LIMIT_BYTES
    });
    return json(res,200,buildSeasonAnalytics({
     health,metrics,seasons,failures,events,worker,episodeStates
    }));
   }catch{
    return json(res,503,{ok:false,code:'season_analytics_database_unavailable'});
   }
  }
  // Explicit operator action only: <=3 S3 objects (<=24MiB total).
  // Verifies against recorded SHA-256, not a generic HEAD or assumed S3
  // capacity. Never reads source Xtream or starts copying content.
  if(path==='/internal/seasons/audit'&&req.method==='POST'){
   if(req.headers['x-blofy-season-confirm']!=='audit-private-verified-chunks'||
      String(req.url||'').includes('?'))
    return json(res,403,{ok:false,code:'season_audit_owner_confirmation_required'});
   if(!seasonQueueStore?.ownsVerifiedRun||!seasonQueueStore?.saveAudit)
    return json(res,503,{ok:false,code:'season_audit_unavailable'});
   if(seasonStorageAuditBusy)return json(res,429,{
    ok:false,code:'season_storage_audit_busy'});
   if(Date.now()-seasonStorageAuditAt<60000)return json(res,429,{
    ok:false,code:'season_storage_audit_cooldown'});
   let payload;
   try{payload=await readSeasonJson(req)}
   catch{return json(res,400,{ok:false,code:'season_storage_audit_bad_json'})}
   const runId=String(payload?.runId||'');
   if(payload?.confirmed!==true||
      !/^[A-Za-z0-9_-]{8,80}$/.test(runId))
    return json(res,400,{ok:false,code:'season_storage_audit_invalid_selection'});
   const pilotRunId=String(pilotEnv.BLOFY_CONTENT_HUB_EPISODE_RUN_ID||'');
   let allowed=false;
   try{
    allowed=(runId===pilotRunId&&pilotRunId.length>=8)||
      await seasonQueueStore.ownsVerifiedRun(runId);
   }catch{return json(res,503,{ok:false,code:'season_storage_audit_lookup_failed'})}
   if(!allowed)return json(res,403,{ok:false,
    code:'season_storage_audit_run_not_approved'});
   seasonStorageAuditBusy=true;seasonStorageAuditAt=Date.now();
   try{
    const result=await auditSeasonEpisodeSample({
     runId,lease,storage,signal:AbortSignal.timeout(65000),logger});
    if([
     'season_storage_sample_verified','season_storage_checksum_mismatch',
     'season_storage_read_unavailable','season_storage_manifest_unavailable'
    ].includes(result.code)){
     await seasonQueueStore.saveAudit(runId,{
      code:result.code,checkedParts:result.checkedParts||0,
      totalParts:result.totalParts||0,checkedBytes:result.checkedBytes||0
     });
    }
    return json(res,result.ok?200:409,{
     ...result,privateOnly:true,customerCutover:false,
     runId,operatorRequested:true});
   }catch{return json(res,503,{
    ok:false,code:'season_storage_audit_unavailable'})}
   finally{seasonStorageAuditBusy=false}
  }
  // Two distinct, fully verified episode manifests, requested explicitly.
  // This measures concurrent PRIVATE S3 reads (not real viewer playback).
  if(path==='/internal/seasons/concurrent-read'&&req.method==='POST'){
   if(String(req.url||'').includes('?')||
      req.headers['x-blofy-season-confirm']!=='two-verified-private-s3-reads')
    return json(res,403,{ok:false,code:'private_read_canary_owner_confirmation_required'});
   if(!seasonQueueStore?.ownsVerifiedRun)return json(res,503,{
    ok:false,code:'private_read_canary_queue_unavailable'});
   if(seasonConcurrentReadBusy)return json(res,429,{
    ok:false,code:'private_read_canary_busy'});
   if(Date.now()-seasonConcurrentReadAt<120000)return json(res,429,{
    ok:false,code:'private_read_canary_cooldown'});
   if(seasonQueue?.isRunning()||copy.isRunning()||
      episodeCopy.isRunning()||episodeCopyBusy||pilotRunning)
    return json(res,409,{ok:false,code:'private_read_canary_source_priority'});
   let runIds;
   try{
    const input=await readSeasonJson(req);
    if(input?.confirmed!==true)throw Error('not_confirmed');
    runIds=validateConcurrentReadIds(input.runIds);
   }catch{return json(res,400,{ok:false,
    code:'private_read_canary_selection_invalid'})}
   const pilotRunId=String(pilotEnv.BLOFY_CONTENT_HUB_EPISODE_RUN_ID||'');
   try{
    for(const runId of runIds){
     const queueVerified=await seasonQueueStore.ownsVerifiedRun(runId);
     if(!queueVerified&&(runId!==pilotRunId||
        !await lease.getVerifiedEpisodeObject(runId)))
       return json(res,403,{ok:false,
        code:'private_read_canary_episode_not_verified'});
    }
   }catch{return json(res,503,{
    ok:false,code:'private_read_canary_validation_unavailable'})}
   seasonConcurrentReadBusy=true;seasonConcurrentReadAt=Date.now();
   try{
    const result=await checkPrivateReadConcurrency({
     runIds,lease,storage,signal:AbortSignal.timeout(45000),logger
    });
    lastSeasonConcurrentRead={code:result.code,ok:result.ok,
     checkedAt:new Date().toISOString(),concurrentReads:2,
     checkedChunks:result.checkedChunks||0};
    return json(res,result.ok?200:409,{...result,
     operatorRequested:true});
   }catch{return json(res,503,{ok:false,
    code:'private_read_canary_unavailable'})}
   finally{seasonConcurrentReadBusy=false}
  }
  // Owner GET: inspect durable checkpoints without reading source/S3
  // or automatically launching any resumed episode transfer.
  if(path==='/internal/seasons/resume/preview'&&req.method==='GET'){
   if(String(req.url||'').includes('?'))
    return json(res,400,{ok:false,code:'season_resume_query_forbidden'});
   if(!seasonQueueStore?.resumePreview)
    return json(res,503,{ok:false,code:'season_resume_unavailable'});
   try{
    const data=await seasonQueueStore.resumePreview();
    return json(res,200,{ok:true,privateOnly:true,readOnly:true,
     customerCutover:false,providerMediaRequests:0,
     ...data,worker:seasonQueue?.status()||{}});
   }catch{return json(res,503,{ok:false,code:'season_resume_database_unavailable'})}
  }
  // Reordering may only change pending episode metadata while the
  // global scheduler is completely idle. It NEVER initiates transfer.
  if(path==='/internal/seasons/priority'&&req.method==='POST'){
   if(String(req.url||'').includes('?')||
      req.headers['x-blofy-season-confirm']!=='owner-reorder-pending')
    return json(res,403,{ok:false,code:'season_priority_confirmation_required'});
   if(!seasonQueueStore?.setPriority)
    return json(res,503,{ok:false,code:'season_priority_unavailable'});
   if(seasonQueue?.isRunning())
    return json(res,409,{ok:false,code:'season_priority_worker_active'});
   let body;
   try{body=await readSeasonJson(req)}
   catch{return json(res,400,{ok:false,code:'season_priority_invalid_body'})}
   if(body?.confirmed!==true||
      !/^[A-Za-z0-9_-]{8,80}$/.test(String(body.runId||''))||
      ![0,1,2].includes(body.priority))
    return json(res,400,{ok:false,code:'season_priority_invalid'});
   try{
    const result=await seasonQueueStore.setPriority({
     runId:body.runId,priority:body.priority});
    return json(res,result.ok?200:409,{
     ...result,readOnly:false,automaticStart:false,
     customerCutover:false});
   }catch{return json(res,503,{ok:false,code:'season_priority_database_unavailable'})}
  }
  // Resubmit ONLY transient failed queue rows. The row's exact source,
  // episode ID and saved checkpoint remain pinned. This never starts a job.
  if(path==='/internal/seasons/retry'&&req.method==='POST'){
   if(String(req.url||'').includes('?')||
      req.headers['x-blofy-season-confirm']!=='manual-review-transient-failure')
    return json(res,403,{ok:false,code:'season_retry_owner_confirmation_required'});
   if(!seasonQueueStore?.retryFailed)return json(res,503,{
    ok:false,code:'season_retry_storage_unavailable'});
   const readiness=seasonQueueReadiness(pilotEnv);
   if(!readiness.ready)return json(res,409,{ok:false,
    code:'season_queue_safety_gates_off',blockedBy:readiness.blockedBy});
   if(seasonQueue?.isRunning()||episodeCopyBusy||
       episodeCopy.isRunning()||copy.isRunning()||pilotRunning)
    return json(res,409,{ok:false,code:'season_retry_worker_active'});
   let request;
   try{request=await readSeasonJson(req)}
   catch{return json(res,400,{ok:false,code:'season_retry_invalid_request'})}
   const runId=String(request?.runId||'');
   if(request?.confirmed!==true||
      request?.licensedStorage!==true||
      request?.sourceIdle!==true||
      !/^[A-Za-z0-9_-]{8,80}$/.test(runId))
    return json(res,400,{ok:false,code:'season_retry_manual_review_required'});
   try{
    const result=await seasonQueueStore.retryFailed(runId);
    return json(res,result.ok?200:409,{...result,
     operatorRequested:true,automaticStart:false,
     customerCutover:false});
   }catch{return json(res,503,{
    ok:false,code:'season_retry_database_unavailable'})}
  }
  if(path==='/internal/seasons/enqueue'&&req.method==='POST'){
   if(!seasonQueueStore)return json(res,503,{
    ok:false,code:'season_queue_unavailable'});
   if(String(req.url||'').includes('?')||
     req.headers['x-blofy-season-confirm']!=='licensed-private-episodes'||
     req.headers['x-blofy-storage-rights-confirm']!=='licensed-persistent-copy')
    return json(res,403,{ok:false,code:'season_queue_owner_confirmation_required'});
   const readiness=seasonQueueReadiness(pilotEnv);
   if(!readiness.ready)return json(res,409,{ok:false,
    code:'season_queue_safety_gates_off',blockedBy:readiness.blockedBy});
   if(seasonQueue.isRunning())return json(res,409,{
    ok:false,code:'season_queue_running'});
   try{
    const request=await readSeasonJson(req);
    let candidates,seasonKey;
    const seriesId=Number(request?.seriesGatewayId);
    if(Number.isSafeInteger(seriesId)&&seriesId>0){
     const seasonNumber=Number(request?.seasonNumber);
     const catalog=await seriesEpisodesInspector({
      seriesGatewayId:seriesId,env:pilotEnv});
     const selected=catalog.seasons?.find(x=>x.seasonNumber===seasonNumber);
     if(!catalog.ok||!selected||!Array.isArray(selected.episodes))
      return json(res,403,{ok:false,code:'season_not_licensed_or_mapped'});
     candidates=selected.episodes;
     seasonKey='series_'+seriesId+'_s'+seasonNumber;
     if(request.episodes?.some?.(e=>{
      const exact=candidates.find(x=>x.gatewayId===Number(e.gatewayId));
      return !exact||Number(e.episodeNumber)!==exact.episodeNumber;
     }))return json(res,403,{ok:false,code:'season_episode_number_mismatch'});
    }else{
     const catalog=await episodeCandidateInspector({env:pilotEnv});
     if(!catalog?.ok||!Array.isArray(catalog.candidates))
      return json(res,503,{ok:false,code:'season_candidate_catalog_unavailable'});
     candidates=catalog.candidates;seasonKey=request?.seasonKey;
    }
    const entries=validateSeasonSelection({
     seasonKey,episodes:request?.episodes,candidates});
    const saved=await seasonQueueStore.enqueue(entries);
    return json(res,201,{ok:true,code:'season_episodes_queued',
     ...saved,seasonKey,privateOnly:true,
     sourceMediaRequests:0,customerCutover:false});
   }catch{return json(res,400,{ok:false,
    code:'season_selection_invalid_or_conflicting',
    customerCutover:false})}
  }
  if(path==='/internal/seasons/start'&&req.method==='POST'){
   if(!seasonQueue)return json(res,503,{ok:false,code:'season_queue_unavailable'});
   if(String(req.url||'').includes('?')||
     req.headers['x-blofy-season-confirm']!=='start-private-sequential')
    return json(res,403,{ok:false,code:'season_start_confirmation_required'});
   if(episodeCopyBusy||episodeCopy.isRunning()||pilotRunning||copy.isRunning())
    return json(res,409,{ok:false,code:'source_writer_busy'});
   let observed=false;
   try{const proof=await lease.getEpisodeBrowserPlaybackStatus?.(
    String(pilotEnv.BLOFY_CONTENT_HUB_EPISODE_RUN_ID||''));
    observed=proof?.confirmed===true}catch{}
   if(!observed)return json(res,409,{ok:false,
    code:'owner_episode_browser_playback_not_confirmed'});
   if(!seasonQueueStore?.unresolvedAuditCounts)return json(res,503,{
    ok:false,code:'season_storage_audit_state_unavailable'});
   try{
    const counts=await seasonQueueStore.unresolvedAuditCounts();
    if(Number(counts.mismatch)>0||Number(counts.unavailable)>0)
     return json(res,409,{ok:false,
      code:'season_storage_integrity_review_required'});
   }catch{return json(res,503,{
    ok:false,code:'season_storage_audit_state_unavailable'})}
   const requestedBudget=req.headers['x-blofy-season-batch-budget'];
   const sessionMaxBatches=requestedBudget===undefined?null:
    Number(requestedBudget);
   if(sessionMaxBatches!==null&&
      ![12,60,120].includes(sessionMaxBatches))
    return json(res,400,{ok:false,code:'season_batch_budget_invalid'});
   const result=seasonQueue.start({sessionMaxBatches});
   return json(res,result.ok?202:409,{...result,privateOnly:true,
    customerCutover:false,maxSourceRangeBytes:CHUNK_BYTES});
  }
  if(path==='/internal/seasons/pause'&&req.method==='POST'){
   if(!seasonQueue)return json(res,503,{ok:false,code:'season_queue_unavailable'});
   if(String(req.url||'').includes('?')||
     req.headers['x-blofy-season-confirm']!=='pause-private-sequential')
    return json(res,403,{ok:false,code:'season_pause_confirmation_required'});
   const result=seasonQueue.stop();
   return json(res,result.ok?202:409,{...result,privateOnly:true,
    customerCutover:false});
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
  if(path==='/internal/episodes/start'&&req.method==='POST'){
   if(String(req.url||'').includes('?')||
     req.headers['x-blofy-episode-copy-confirm']!=='approved-sequential-8mib')
    return json(res,403,{ok:false,code:'episode_start_confirmation_required'});
   const gatewayId=Number(req.headers['x-blofy-episode-gateway-id']),
     approved=Number(pilotEnv.BLOFY_CONTENT_HUB_EPISODE_APPROVED_GATEWAY_ID);
   if(!Number.isSafeInteger(gatewayId)||gatewayId!==approved)
    return json(res,403,{ok:false,code:'episode_start_id_not_approved'});
   if(episodeCopyBusy||pilotRunning||copy.isRunning()||episodeCopy.isRunning()||seasonQueue?.isRunning())
    return json(res,409,{ok:false,code:'episode_source_writer_busy'});
   const result=episodeCopy.start();
   return json(res,result.ok?202:409,{
    ...result,privateOnly:true,customerCutover:false,
    maxSourceRangeBytes:CHUNK_BYTES});
  }
  if(path==='/internal/episodes/pause'&&req.method==='POST'){
   if(String(req.url||'').includes('?')||
      req.headers['x-blofy-episode-copy-confirm']!=='pause-sequential')
    return json(res,403,{ok:false,code:'episode_pause_confirmation_required'});
   const result=episodeCopy.stop();
   return json(res,result.ok?202:409,{
    ...result,privateOnly:true,customerCutover:false});
  }
  // At most ONE explicitly authorized episode chunk per POST. The
  // controller returns 202 immediately and persists progress in PostgreSQL.
  // It is separate from the verified movie worker and client playback.
  if(path==='/internal/episodes/next'&&req.method==='POST'){
   if(String(req.url||'').includes('?')||
      req.headers['x-blofy-episode-copy-confirm']!=='approved-single-8mib')
    return json(res,403,{ok:false,code:'episode_copy_confirmation_required'});
   const gatewayId=Number(req.headers['x-blofy-episode-gateway-id']);
   const approved=Number(pilotEnv.BLOFY_CONTENT_HUB_EPISODE_APPROVED_GATEWAY_ID);
   if(!Number.isSafeInteger(gatewayId)||gatewayId<1||
     gatewayId!==approved)return json(res,403,{
       ok:false,code:'episode_copy_id_not_selected'});
   if(episodeCopyBusy||episodeCopy.isRunning()||pilotRunning||copy.isRunning()||seasonQueue?.isRunning())
    return json(res,409,{ok:false,code:'content_hub_source_writer_busy'});
   const readiness=episodeCopyReadiness(pilotEnv);
   if(!readiness.ready)return json(res,409,{ok:false,
     code:'episode_safety_gates_off',episodeCopyReadiness:readiness});
   episodeCopyBusy=true;
   const abort=episodeCopyAbort=new AbortController();
   const timer=setTimeout(()=>abort.abort(),220000);timer.unref?.();
   lastEpisodeCopy={ok:false,code:'episode_copy_running',gatewayId,
    checkedAt:new Date().toISOString(),customerCutover:false};
   void episodeChunkRunner({env:pilotEnv,storage,lease,signal:abort.signal,
     logger}).then(result=>{
      lastEpisodeCopy={ok:result.ok===true,code:result.code,
       completed:result.completed===true,
       bytes:result.bytesCopied||result.bytes||0,
       gatewayId,checkedAt:new Date().toISOString(),
       customerCutover:false};
      logger('BLOFY_CONTENT_HUB_EPISODE_BATCH_RESULT',lastEpisodeCopy);
     }).catch(()=>{
      lastEpisodeCopy={ok:false,code:'episode_copy_unavailable',
       gatewayId,checkedAt:new Date().toISOString(),
       customerCutover:false};
     }).finally(()=>{
      clearTimeout(timer);episodeCopyBusy=false;episodeCopyAbort=null;
     });
   return json(res,202,{ok:true,code:'episode_batch_accepted',
    gatewayId,maxSourceRangeBytes:CHUNK_BYTES,
    automaticDownload:false,customerCutover:false});
  }
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
    const [legacyRuns,legacyAccounting,batches,batchAccounting,episodeRuns]=await Promise.all([
      lease.listPilotRuns?.({limit:20})||[],
      lease.storageAccounting?.()||null,
      lease.listChunkedRuns?.({limit:20})||[],
      lease.chunkedStorageAccounting?.()||null,
      lease.listEpisodeRuns?.({limit:15})||[]
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
       episodeCanaryRunning,lastEpisodeCanary,
       episodeCopyBusy:episodeCopyBusy||episodeCopy.isRunning(),
       lastEpisodeCopy,episodeRuns,episodeContinuousCopy:episodeCopy.status(),
       episodeCopyReadiness:episodeCopyReadiness(pilotEnv),
       ownerPreviewEnabled:pilotEnv.BLOFY_CONTENT_HUB_OWNER_PREVIEW_ENABLED==='1',
    ownerEpisodePreviewEnabled:pilotEnv.BLOFY_CONTENT_HUB_OWNER_PREVIEW_ENABLED==='1'&&
      pilotEnv.BLOFY_CONTENT_HUB_EPISODE_OWNER_PREVIEW_ENABLED==='1',
       continuousCopy:copy.status(),downloadQueueEnabled:false,
       seasonQueueReady:Boolean(seasonQueue)&&seasonQueueReadiness(pilotEnv).ready,
       seasonQueueReadiness:seasonQueueReadiness(pilotEnv),
       seasonQueueStatus:seasonQueue?.status()||null,
       chunkedBatchEnabled:chunkedBatchReadiness(pilotEnv).ready,
       batchReadiness:chunkedBatchReadiness(pilotEnv)});
   }catch{
    return json(res,503,{ok:false,code:'content_hub_pilot_records_unavailable'});
   }
  }
  // Short MP4 preview exclusively for an authenticated owner in STREAM.
  // Never a public link, signed URL, or subscriber route. No provider call.
  const approvedQueuePreview=/^\/internal\/seasons\/episodes\/([A-Za-z0-9_-]{8,80})\/preview$/.exec(path);
  if((path==='/internal/playback/preview'||
     path==='/internal/episodes/playback/preview'||approvedQueuePreview)&&req.method==='GET'){
   const mediaKind=approvedQueuePreview||path.startsWith('/internal/episodes/')?
    'episode':'movie';
   const expectedHeader=mediaKind==='episode'?
     'operator-episode-only':'operator-only';
   if(String(req.url||'').includes('?')||
      req.headers['x-blofy-owner-preview']!==expectedHeader)
    return json(res,403,{ok:false,code:'owner_preview_confirmation_required'});
   if(pilotEnv.BLOFY_CONTENT_HUB_OWNER_PREVIEW_ENABLED!=='1'||
      (mediaKind==='episode'&&
       pilotEnv.BLOFY_CONTENT_HUB_EPISODE_OWNER_PREVIEW_ENABLED!=='1'))
    return json(res,409,{ok:false,code:'owner_preview_disabled'});
   if(previewBuilding)return json(res,429,{
    ok:false,code:'owner_preview_busy'});
   const runId=String(approvedQueuePreview?
      approvedQueuePreview[1]:mediaKind==='episode'?
      pilotEnv.BLOFY_CONTENT_HUB_EPISODE_RUN_ID||'':
      pilotEnv.BLOFY_CONTENT_HUB_BATCH_RUN_ID||'');
   if(approvedQueuePreview){
    if(!seasonQueueStore?.ownsVerifiedRun)return json(res,503,{
     ok:false,code:'season_verified_episode_catalog_unavailable'});
    try{
     if(!await seasonQueueStore.ownsVerifiedRun(runId))
      return json(res,409,{ok:false,code:'season_episode_not_verified'});
    }catch{return json(res,503,{ok:false,code:'season_verified_episode_lookup_failed'})}
   }
   const cacheHit=previewCache?.runId===runId&&
       previewCache?.mediaKind===mediaKind&&
       previewCache.expiresAt>Date.now();
   if(Date.now()<previewThrottleUntil&&!cacheHit)
    return json(res,429,{ok:false,code:'owner_preview_cooldown'});
   if(!/^[A-Za-z0-9_-]{8,80}$/.test(runId))
    return json(res,409,{ok:false,code:'owner_preview_movie_not_selected'});
   const abort=new AbortController();
   const timer=setTimeout(()=>abort.abort(),75000);timer.unref?.();
   const close=()=>abort.abort();
   res.once('close',close);
   let clip=null;
   try{
    if(cacheHit)clip=previewCache.result;
    else{
     previewBuilding=true;
     // A small cooldown stops repeated video encodes on an authenticated
     // but repeatedly refreshed preview page.
     previewThrottleUntil=Date.now()+30000;
     clip=await previewBuilder({
      runId,storage,lease,signal:abort.signal,mediaKind});
     if(clip.ok){
      previewCache={runId,mediaKind,result:clip,
        expiresAt:Date.now()+120000};
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
  // One verified private episode only; never touches the upstream
  // provider nor updates customer playback. Can only pass after SHA256.
  if(path==='/internal/episodes/playback/diagnose'&&req.method==='POST'){
   if(String(req.url||'').includes('?')||
      req.headers['x-blofy-canary-confirm']!=='verified-private-episode')
    return json(res,400,{ok:false,
     code:'episode_canary_confirmation_required'});
   if(episodeCanaryRunning)return json(res,409,{ok:false,
    code:'episode_canary_already_running'});
   const runId=String(pilotEnv.BLOFY_CONTENT_HUB_EPISODE_RUN_ID||'');
   if(!/^[A-Za-z0-9_-]{8,80}$/.test(runId))
    return json(res,409,{ok:false,code:'episode_canary_run_not_selected'});
   episodeCanaryRunning=true;
   lastEpisodeCanary={ok:false,code:'episode_canary_running',
    startedAt:new Date().toISOString()};
   void runFullPlaybackCanary(runId,'episode').then(result=>{
    lastEpisodeCanary={...result,checkedAt:new Date().toISOString()};
    logger('BLOFY_CONTENT_HUB_EPISODE_PLAYBACK_CANARY',lastEpisodeCanary);
   }).catch(()=>{
    lastEpisodeCanary={ok:false,code:'episode_canary_failed',
     checkedAt:new Date().toISOString(),customerCutover:false};
   }).finally(()=>{episodeCanaryRunning=false});
   return json(res,202,{ok:true,code:'episode_canary_accepted',
    privateOnly:true,customerCutover:false,providerRequests:0});
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
   if(pilotRunning||copy.isRunning()||seasonQueue?.isRunning())
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
   if(pilotRunning||copy.isRunning()||seasonQueue?.isRunning())return json(res,409,{
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
  const playback=/^\/internal\/(pilot|episodes)\/playback\/([A-Za-z0-9_-]{8,80})$/.exec(path);
  if(playback&&['GET','HEAD'].includes(req.method)){
   if(String(req.url||'').includes('?'))
    return json(res,400,{ok:false,code:'pilot_private_query_denied'});
   const episodePlayback=playback[1]==='episodes';
   const playbackId=playback[2];
   let saved=null;
   if(episodePlayback){
    try{saved=await lease.getVerifiedEpisodeObject?.(playbackId)}catch{}
   }else{
    try{saved=await lease.getVerifiedPilotObject?.(playbackId)}catch{}
    if(!saved)try{saved=await lease.getVerifiedChunkedObject?.(
      playbackId)}catch{}
   }
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
  startEpisodeCopy:()=>episodeCopy.start(),
  stopEpisodeCopy:()=>episodeCopy.stop(),
  validateVerifiedEpisode:async()=>{
   const runId=String(pilotEnv.BLOFY_CONTENT_HUB_EPISODE_RUN_ID||'');
   if(!/^[A-Za-z0-9_-]{8,80}$/.test(runId))
    return {ok:false,code:'episode_canary_run_not_selected'};
   if(episodeCanaryRunning||previewBuilding)return {
    ok:false,code:'episode_canary_busy'};
   episodeCanaryRunning=true;
   let canary;
   try{
    canary=await runFullPlaybackCanary(runId,'episode');
    lastEpisodeCanary={...canary,checkedAt:new Date().toISOString()};
    logger('BLOFY_CONTENT_HUB_EPISODE_PLAYBACK_CANARY',lastEpisodeCanary);
   }catch{
    return {ok:false,code:'episode_canary_error',
      providerRequests:0,customerCutover:false};
   }finally{episodeCanaryRunning=false}
   if(!canary.ok)return {ok:false,code:canary.code,
    providerRequests:0,customerCutover:false,
    seekVerified:canary.seekVerified===true};
   if(pilotEnv.BLOFY_CONTENT_HUB_OWNER_PREVIEW_ENABLED!=='1'||
      pilotEnv.BLOFY_CONTENT_HUB_EPISODE_OWNER_PREVIEW_ENABLED!=='1')
    return {ok:false,code:'episode_preview_not_enabled',
     audioVideoDecoded:true,seekVerified:true,
     providerRequests:0,customerCutover:false};
   previewBuilding=true;
   try{
    const preview=await previewBuilder({runId,storage,lease,
      mediaKind:'episode'});
    if(preview.ok&&Buffer.isBuffer(preview.bytes)){
     previewCache={runId,mediaKind:'episode',result:preview,
       expiresAt:Date.now()+120000};
    }
    return {ok:preview.ok===true,code:preview.code,
     audioVideoDecoded:true,seekVerified:true,
     videoCodec:canary.videoCodec,audioCodec:canary.audioCodec,
     width:canary.width,height:canary.height,
     seeksVerified:canary.seeksVerified,
     mp4Bytes:Buffer.isBuffer(preview.bytes)?preview.bytes.length:0,
     sourceSampleBytes:preview.sourceSampleBytes||0,
     providerRequests:0,customerCutover:false};
   }catch{return {ok:false,code:'episode_preview_encode_failed',
    audioVideoDecoded:true,seekVerified:true,
    providerRequests:0,customerCutover:false}}
   finally{previewBuilding=false}
  },
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
 const seasonQueueStore=createSeasonQueueStore({connectionString:process.env.DATABASE_URL});
 const catalogStore=createContentCatalogStore({connectionString:process.env.DATABASE_URL});
 const hub=createContentHubServer({storage,lease,seasonQueueStore,catalogStore,
  token:process.env.BLOFY_CONTENT_HUB_ADMIN_TOKEN||'',
  allowSynthetic:process.env.BLOFY_CONTENT_HUB_SYNTHETIC_TEST_ENABLED==='1',
  logger:(name,payload)=>console.info(name,JSON.stringify(payload))});
 const port=Number(process.env.PORT||3000);
 hub.server.listen(port,'0.0.0.0',()=>{
  const seasonsReady=seasonQueueReadiness(process.env);
  console.info('BLOFY_CONTENT_HUB_READY',JSON.stringify({port,
   privateOnly:true,downloadQueueEnabled:false,
   seasonQueueConfigured:Boolean(seasonQueueStore),
   seasonQueueReady:Boolean(seasonQueueStore)&&seasonsReady.ready,
   seasonQueueBlockedBy:seasonsReady.blockedBy,
   automaticSeasonStartup:false,customerCutover:false}));
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
  // One explicitly authorized, bounded attempt to continue the selected
  // episode. PostgreSQL claims the event before starting, so restarts do
  // not launch a second transfer. The controller caps one session at
  // 180 sequential verified chunks or 45 minutes, whichever comes first.
  if(process.env.BLOFY_CONTENT_HUB_EPISODE_CONTINUOUS_ON_BOOT==='1'&&
     process.env.BLOFY_CONTENT_HUB_EPISODE_CHUNK_ON_BOOT!=='1'){
   const timer=setTimeout(()=>{
    void (async()=>{
     const run=String(process.env.BLOFY_CONTENT_HUB_EPISODE_RUN_ID||'');
     const event=String(process.env.BLOFY_CONTENT_HUB_EPISODE_CONTINUOUS_BOOT_TOKEN||'');
     if(!/^[A-Za-z0-9_-]{8,80}$/.test(event))
      return {ok:false,code:'episode_continuous_boot_token_invalid'};
     const ready=episodeCopyReadiness(process.env);
     if(!ready.ready)return {ok:false,code:'episode_continuous_safety_off',
       blockedBy:ready.blockedBy};
     if(!await lease.claimBatchBootOnce(event,run))
      return {ok:false,code:'episode_continuous_boot_already_claimed'};
     return hub.startEpisodeCopy();
    })().then(result=>console.info('BLOFY_CONTENT_HUB_EPISODE_CONTINUOUS_BOOT',
      JSON.stringify({ok:result.ok===true,code:result.code,
       blockedBy:result.blockedBy||null,customerCutover:false})))
    .catch(()=>console.warn('BLOFY_CONTENT_HUB_EPISODE_CONTINUOUS_BOOT',
      JSON.stringify({ok:false,code:'episode_continuous_boot_failed',
       customerCutover:false})));
   },9500);timer.unref?.();
  }
  // One owner-authorized 8MiB episode part smoke test, at most once.
  // This gate starts NO continuous episode copying and changes NO customers.
  // Its durable PostgreSQL claim prevents repeat on restart or redeploy.
  if(process.env.BLOFY_CONTENT_HUB_EPISODE_CHUNK_ON_BOOT==='1'){
   const timer=setTimeout(()=>{
    void (async()=>{
     const run=String(process.env.BLOFY_CONTENT_HUB_EPISODE_RUN_ID||'');
     const event=String(process.env.BLOFY_CONTENT_HUB_EPISODE_CHUNK_BOOT_TOKEN||'');
     if(!/^[A-Za-z0-9_-]{8,80}$/.test(event))
      return {ok:false,code:'episode_chunk_boot_token_invalid'};
     const ready=episodeCopyReadiness(process.env);
     if(!ready.ready)return {ok:false,code:'episode_chunk_safety_gates_off',
      blockedBy:ready.blockedBy};
     const claimed=await lease.claimBatchBootOnce(event,run);
     if(!claimed)return {ok:false,code:'episode_chunk_boot_already_claimed'};
     return runOneEpisodeChunk({storage,lease,env:process.env,
       logger:(name,payload)=>console.info(name,JSON.stringify(payload))});
    })().then(result=>console.info('BLOFY_CONTENT_HUB_EPISODE_CHUNK_BOOT',
     JSON.stringify({ok:result.ok===true,code:result.code,
      errorStage:result.errorStage||null,
      bytesCopied:result.bytesCopied||result.bytes||0,
      chunksSaved:result.chunksSaved||0,
      completed:result.completed===true,
      blockedBy:result.blockedBy||null,
      customerCutover:false,automaticDownload:false})))
    .catch(()=>console.warn('BLOFY_CONTENT_HUB_EPISODE_CHUNK_BOOT',
     JSON.stringify({ok:false,code:'episode_chunk_boot_failed',
      customerCutover:false,automaticDownload:false})));
   },7000);timer.unref?.();
  }
  // Explicit one-time 4KiB size proof of the FIRST eligible episode
  // from the source-verified review list. No S3 write, no episode copy.
  if(process.env.BLOFY_CONTENT_HUB_EPISODE_PROBE_ON_BOOT==='1'&&
     process.env.BLOFY_CONTENT_HUB_SOURCE_IDLE_CONFIRMED==='1'&&
     process.env.BLOFY_CONTENT_HUB_SOURCE_QUIET_WINDOW_CONFIRMED==='1'){
   const timer=setTimeout(()=>{
    void (async()=>{
     const event=String(process.env.BLOFY_CONTENT_HUB_EPISODE_PROBE_BOOT_TOKEN||'');
     const run=String(process.env.BLOFY_CONTENT_HUB_BATCH_RUN_ID||'');
     if(!/^[A-Za-z0-9_-]{8,80}$/.test(event))
      return {ok:false,code:'episode_boot_token_invalid'};
     if(!await lease.claimBatchBootOnce(event,run))
      return {ok:false,code:'episode_boot_already_claimed'};
     const catalog=await inspectEpisodeCandidates({env:process.env});
     if(!catalog.ok||!catalog.candidates.length)
      return {ok:false,code:'episode_boot_no_candidates'};
     const chosen=catalog.candidates[0].gatewayId;
     return inspectEpisodeSize({gatewayId:chosen,env:process.env});
    })().then(result=>console.info('BLOFY_CONTENT_HUB_EPISODE_SIZE_BOOT',
     JSON.stringify({ok:result.ok===true,code:result.code,
      gatewayId:result.gatewayId||null,
      expectedBytes:result.expectedBytes||null,
      validatorPresent:result.validatorPresent===true,
      probeBytes:result.probeBytes||0,
      automaticDownload:false,stored:false,customerCutover:false})))
    .catch(()=>console.warn('BLOFY_CONTENT_HUB_EPISODE_SIZE_BOOT',
     JSON.stringify({ok:false,code:'episode_size_boot_unavailable',
      automaticDownload:false,stored:false,customerCutover:false})));
   },5000);timer.unref?.();
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
  // Once-only validation of a FULLY verified private episode.
  // Reads S3 only: real video/audio decode, 4 private HTTP seeks, then
  // short H264/AAC owner clip. Requires durable Postgres event claim.
  if(process.env.BLOFY_CONTENT_HUB_EPISODE_VALIDATE_ON_BOOT==='1'){
   const timer=setTimeout(()=>{
    void (async()=>{
     const runId=String(process.env.BLOFY_CONTENT_HUB_EPISODE_RUN_ID||''),
       event=String(process.env.BLOFY_CONTENT_HUB_EPISODE_VALIDATE_TOKEN||'');
     if(!/^[A-Za-z0-9_-]{8,80}$/.test(event))
      return {ok:false,code:'episode_validation_token_invalid'};
     if(!await lease.claimBatchBootOnce(event,runId))
      return {ok:false,code:'episode_validation_already_claimed'};
     return hub.validateVerifiedEpisode();
    })().then(result=>console.info(
     'BLOFY_CONTENT_HUB_EPISODE_VALIDATION',
     JSON.stringify({ok:result.ok===true,code:result.code,
      audioVideoDecoded:result.audioVideoDecoded===true,
      seekVerified:result.seekVerified===true,
      seeksVerified:result.seeksVerified||0,
      videoCodec:result.videoCodec||null,audioCodec:result.audioCodec||null,
      width:result.width||null,height:result.height||null,
      mp4Bytes:result.mp4Bytes||0,sourceSampleBytes:result.sourceSampleBytes||0,
      providerRequests:0,customerCutover:false
     }))).catch(()=>console.warn(
     'BLOFY_CONTENT_HUB_EPISODE_VALIDATION',
     JSON.stringify({ok:false,code:'episode_validation_unavailable',
      providerRequests:0,customerCutover:false})));
   },7000);timer.unref?.();
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
  hub.stopEpisodeCopy();
  hub.server.close(()=>void lease.close());
 };
 process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
}
