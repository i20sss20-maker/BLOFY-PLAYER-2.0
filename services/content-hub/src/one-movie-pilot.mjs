// One-movie licensed copy pilot. Disabled by default, private-only.
// Never touches customer playback routes or downloads the entire catalog.
import {runLicensedMirrorPilot} from './mirror-pilot.mjs';
import {createHash} from 'node:crypto';
import {MIN_PART_BYTES} from './mirror-policy.mjs';

const ORIGIN='http://blofy-activation-portal.railway.internal:3000';
const MAX_PILOT_BYTES=4*1024*1024*1024;
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SAFE_RUN=/^[A-Za-z0-9_-]{8,80}$/;
const BASE={privateOnly:true,customerCutover:false,customerTrafficChanged:false,automaticCatalogDownload:false};

function isEnabled(env){
 return env.BLOFY_CONTENT_HUB_ONE_MOVIE_ON_BOOT==='1'&&
  env.BLOFY_CONTENT_HUB_UPLOAD_ENABLED==='1'&&
  env.BLOFY_CONTENT_HUB_STORAGE_RIGHTS_CONFIRMED==='1'&&
  env.BLOFY_CONTENT_HUB_SOURCE_QUIET_WINDOW_CONFIRMED==='1'&&
  env.BLOFY_CONTENT_HUB_SOURCE_IDLE_CONFIRMED==='1';
}
function timeoutSignal(signal){
 const timeout=AbortSignal.timeout(90000);
 return signal?AbortSignal.any([signal,timeout]):timeout;
}
function cleanMetadata(item){
 return item?.sourceName==='saleh'&&item?.mediaKind==='movie'&&
  UUID.test(String(item.sourceId||''))&&ID.test(String(item.mediaId||''))&&
  Number.isSafeInteger(item.gatewayId)&&item.gatewayId>0&&
  ['mp4','mkv','ts','avi'].includes(item.extension);
}
async function getMetadata(fetchImpl,token,signal){
 const response=await fetchImpl(ORIGIN+'/internal/blofy-content-hub/describe',{
  method:'GET',redirect:'manual',headers:{authorization:'Bearer '+token},
  signal:timeoutSignal(signal)
 });
 if(response.status!==200)throw Error('pilot_private_bridge_unavailable');
 const data=await response.json();
 if(!cleanMetadata(data))throw Error('pilot_movie_scope_invalid');
 return data;
}

// Read-only metadata check. Does not request even one video byte, cannot
// reserve an upstream feed, never turns on copying or changes customer routes.
export async function inspectOneMoviePilot({
 env=process.env,fetchImpl=fetch,signal
}={}){
 const base={ok:false,privateOnly:true,providerMediaRequests:0,
   customerCutover:false,downloadStarted:false};
 const token=String(env.BLOFY_CONTENT_HUB_BRIDGE_TOKEN||'');
 if(token.length<32)return {...base,code:'pilot_bridge_not_configured'};
 try{
  const scoped=signal?AbortSignal.any([signal,AbortSignal.timeout(6000)]):
   AbortSignal.timeout(6000);
  const media=await getMetadata(fetchImpl,token,scoped);
  const approved=Number(env.BLOFY_CONTENT_HUB_APPROVED_GATEWAY_ID);
  const bytes=Number(env.BLOFY_CONTENT_HUB_EXPECTED_BYTES);
  const exactMovie=Number.isSafeInteger(approved)&&approved>0&&
   approved===media.gatewayId;
  const validSize=Number.isSafeInteger(bytes)&&bytes>=MIN_PART_BYTES&&
   bytes<=MAX_PILOT_BYTES;
  return {...base,ok:true,code:'pilot_metadata_only',sourceName:'saleh',
   sourceId:media.sourceId,mediaId:media.mediaId,
   gatewayId:media.gatewayId,extension:media.extension,
   approvedMovieMatches:exactMovie,
   expectedBytes:validSize?bytes:null,
   storageRightsDeclared:env.BLOFY_CONTENT_HUB_STORAGE_RIGHTS_CONFIRMED==='1',
   sourceQuietDeclared:env.BLOFY_CONTENT_HUB_SOURCE_QUIET_WINDOW_CONFIRMED==='1',
   sourceIdleDeclared:env.BLOFY_CONTENT_HUB_SOURCE_IDLE_CONFIRMED==='1',
   uploadFeatureEnabled:env.BLOFY_CONTENT_HUB_UPLOAD_ENABLED==='1',
   automaticPilotEnabled:env.BLOFY_CONTENT_HUB_ONE_MOVIE_ON_BOOT==='1',
   note:'provider_idle_and_storage_rights_not_independently_verified'};
 }catch{return {...base,code:'pilot_source_metadata_unavailable'}}
}

// One exact 4KiB source range identifies current total size and validator.
// Explicit operator opt-in only. No private S3 storage or subscriber cutover.
export async function probeApprovedMovieRange({
 env=process.env,fetchImpl=fetch,signal
}={}){
 const base={ok:false,customerTrafficChanged:false,customerCutover:false,
   fullFilmDownloaded:false,stored:false,probeBytes:0,providerRequests:0};
 const token=String(env.BLOFY_CONTENT_HUB_BRIDGE_TOKEN||'');
 if(token.length<32)return {...base,code:'source_bridge_not_configured'};
 let response=null;
 try{
  const metadata=await getMetadata(fetchImpl,token,signal);
  const requestSignal=signal?AbortSignal.any([signal,AbortSignal.timeout(45000)]):
   AbortSignal.timeout(45000);
  response=await fetchImpl(ORIGIN+
   '/internal/blofy-content-hub/source/movie/'+metadata.gatewayId,{
    method:'GET',redirect:'manual',
    headers:{authorization:'Bearer '+token,range:'bytes=0-4095',
      'accept-encoding':'identity'},
    signal:requestSignal
   });
  const m=/^bytes 0-4095\/([1-9][0-9]*)$/.exec(
   String(response.headers.get('content-range')||'').trim());
  const total=Number(m?.[1]);
  if(response.status!==206||!Number.isSafeInteger(total)||
   total<MIN_PART_BYTES||total>MAX_PILOT_BYTES||
   !response.body||Number(response.headers.get('content-length'))!==4096)
   return {...base,code:'provider_range_invalid',providerRequests:1};
  const reader=response.body.getReader();let count=0;
  try{
   while(count<4096){
    const next=await reader.read();
    if(next.done||!next.value||count+next.value.byteLength>4096)
     return {...base,code:'provider_range_short',providerRequests:1};
    count+=next.value.byteLength;
   }
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
  const validator=String(response.headers.get('etag')||
    response.headers.get('last-modified')||'');
  return {...base,ok:true,code:'source_range_4k_verified',
   providerRequests:1,probeBytes:4096,
   gatewayId:metadata.gatewayId,extension:metadata.extension,
   expectedBytes:total,validatorPresent:validator.length>0&&
    validator.length<=140&&!/[\r\n]/.test(validator)};
 }catch{
  return {...base,code:'provider_range_unavailable'};
 }finally{
  if(response?.body&&!response.body.locked)
   await response.body.cancel().catch(()=>{});
 }
}

// Only run this from a private operator-controlled process. No public route.
export async function runOneMoviePilot({
 env=process.env,storage,lease,fetchImpl=fetch,signal,logger=()=>{}
}={}){
 if(!isEnabled(env))return {...BASE,ok:false,code:'pilot_not_enabled',stored:false};
 const runId=String(env.BLOFY_CONTENT_HUB_PILOT_RUN_ID||'');
 const token=String(env.BLOFY_CONTENT_HUB_BRIDGE_TOKEN||'');
 const expectedBytes=Number(env.BLOFY_CONTENT_HUB_EXPECTED_BYTES);
 const approvedGatewayId=Number(env.BLOFY_CONTENT_HUB_APPROVED_GATEWAY_ID);
 if(!SAFE_RUN.test(runId)||token.length<32||
  !Number.isSafeInteger(expectedBytes)||expectedBytes<MIN_PART_BYTES||
  expectedBytes>MAX_PILOT_BYTES||!Number.isSafeInteger(approvedGatewayId)||
  approvedGatewayId<1)
  return {...BASE,ok:false,code:'pilot_operator_configuration_missing',stored:false};
 if(!storage||!lease||typeof lease.claimPilotRun!=='function'||
   typeof lease.finishPilotRun!=='function'||typeof storage.health!=='function')
  return {...BASE,ok:false,code:'pilot_private_dependencies_missing',stored:false};
 const bucket=await storage.health().catch(()=>({ok:false}));
 if(bucket?.ok!==true)
  return {...BASE,ok:false,code:'pilot_private_bucket_unavailable',stored:false};
 // Durable one-shot claim: a container restart can never repeat the same run ID.
 const claimed=await lease.claimPilotRun(runId,{expectedBytes});
 if(!claimed)return {...BASE,ok:false,code:'pilot_run_already_claimed',stored:false};
 const deadline=AbortSignal.timeout(2*60*60*1000);
 const combined=signal?AbortSignal.any([signal,deadline]):deadline;
 let result={...BASE,ok:false,code:'pilot_failed',stored:false};
 let objectKey=null;
 try{
  const meta=await getMetadata(fetchImpl,token,combined);
  if(approvedGatewayId!==meta.gatewayId)
   throw Error('pilot_movie_not_approved');
  // Versioned private object key: never overwrite a previous verified copy.
  const objectName='pilot_'+createHash('sha256')
    .update(runId+'\\0'+meta.sourceId+'\\0'+meta.mediaId)
    .digest('hex').slice(0,32);
  objectKey=`saleh/movie/${meta.sourceId}/${objectName}.${meta.extension}`;
  const approved={
   sourceName:meta.sourceName,sourceId:meta.sourceId,
   mediaKind:'movie',mediaId:meta.mediaId,extension:meta.extension,
   privateObjectName:objectName,
   expectedBytes,activeUpstreamFeeds:0,
   // Per-run explicit approval, not derived from the upstream restreamer flag.
   licenseEvidence:{storagePermitted:true,scope:'saleh-vod-persistent-copy'}
  };
  const readRange=async({from,to,signal:chunkSignal})=>{
   // Range bridge validates the upstream URL, response length and redirects.
   const headers={
    authorization:'Bearer '+token,
    range:`bytes=${from}-${to}`,'accept-encoding':'identity'
   };
   return fetchImpl(ORIGIN+
    '/internal/blofy-content-hub/source/movie/'+meta.gatewayId,{
    method:'GET',redirect:'manual',headers,
    signal:timeoutSignal(chunkSignal||combined)
   });
  };
  const work=await runLicensedMirrorPilot({
   env,job:approved,privateBucket:{private:true,configured:true},
   readRange,storage,lease,verifyStoredObject:args=>storage.verify(args),
   signal:combined,partBytes:MIN_PART_BYTES,
   onProgress:async({bytesUploaded,partsUploaded})=>{
    if(typeof lease.progressPilotRun==='function')
     await lease.progressPilotRun(runId,{bytesUploaded,partsUploaded});
   }
  });
  result=!work.ok&&combined.aborted?{...BASE,ok:false,stored:false,
    code:'pilot_cancelled'}:{...BASE,...work};
  logger('BLOFY_CONTENT_HUB_ONE_MOVIE_PILOT',{
   ok:result.ok,code:result.code,stored:result.stored===true,
   bytes:result.ok?result.bytes:undefined,parts:result.ok?result.parts:undefined,
   customerCutover:false
  });
 }catch{
  result={...BASE,ok:false,code:combined.aborted?'pilot_cancelled':
    'pilot_source_or_job_failed',stored:false};
 }
 // Never claim success if the object cannot be recorded durably.
 try{
  await lease.finishPilotRun(runId,{
   status:result.ok?'verified':'failed',code:result.code,
   bytes:result.ok?result.bytes:undefined,
   sha256:result.ok?result.sha256:undefined,
   objectKey:result.ok?objectKey:undefined
  });
 }catch{
  if(result.ok&&objectKey)await storage.remove({key:objectKey}).catch(()=>{});
  return {...BASE,ok:false,code:'pilot_finalize_failed',stored:false};
 }
 return result;
}
