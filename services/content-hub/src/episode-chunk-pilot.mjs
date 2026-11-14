// Strictly scoped ONE licensed saleh episode. Default OFF. A manual
// request copies AT MOST one 8MiB chunk to private S3 and records a durable
// Postgres checkpoint. The full-file SHA256 is verified from S3 before use.
// Movie manifests, source catalogs and subscriber playback remain unchanged.
import {createHash} from 'node:crypto';
import {inspectEpisodeCandidates} from './episode-candidates.mjs';
import {parseMirrorContentRange} from './mirror-policy.mjs';
const CHUNK=8*1024*1024;
const MAX_FILE=4*1024**3;
const ORIGIN='http://blofy-activation-portal.railway.internal:3000';
const RUN=/^[A-Za-z0-9_-]{8,80}$/;
const base={privateOnly:true,customerCutover:false,
  downloadQueueEnabled:false,mediaKind:'episode'};
export function episodeCopyReadiness(env={}){
 const blockedBy=[];
 if(env.BLOFY_CONTENT_HUB_EPISODE_COPY_ENABLED!=='1')
  blockedBy.push('episode_copy_disabled');
 if(env.BLOFY_CONTENT_HUB_UPLOAD_ENABLED!=='1')
  blockedBy.push('storage_upload_disabled');
 if(env.BLOFY_CONTENT_HUB_STORAGE_RIGHTS_CONFIRMED!=='1'||
    env.BLOFY_CONTENT_HUB_EPISODE_RIGHTS_CONFIRMED!=='1')
  blockedBy.push('episode_storage_rights_unconfirmed');
 if(env.BLOFY_CONTENT_HUB_SOURCE_IDLE_CONFIRMED!=='1')
  blockedBy.push('source_idle_unconfirmed');
 if(env.BLOFY_CONTENT_HUB_SOURCE_QUIET_WINDOW_CONFIRMED!=='1')
  blockedBy.push('source_quiet_window_unconfirmed');
 const id=Number(env.BLOFY_CONTENT_HUB_EPISODE_APPROVED_GATEWAY_ID),
   bytes=Number(env.BLOFY_CONTENT_HUB_EPISODE_EXPECTED_BYTES);
 if(!Number.isSafeInteger(id)||id<1)
  blockedBy.push('episode_gateway_id_missing');
 if(!Number.isSafeInteger(bytes)||bytes<CHUNK||bytes>MAX_FILE)
  blockedBy.push('episode_exact_size_missing');
 if(!RUN.test(String(env.BLOFY_CONTENT_HUB_EPISODE_RUN_ID||'')))
  blockedBy.push('episode_run_id_missing');
 if(String(env.BLOFY_CONTENT_HUB_BRIDGE_TOKEN||'').length<32)
  blockedBy.push('source_bridge_not_configured');
 return {ready:blockedBy.length===0,blockedBy,automaticDownload:false,
   customerCutover:false};
}
function config(env){
 if(!episodeCopyReadiness(env).ready)return null;
 return {gatewayId:Number(env.BLOFY_CONTENT_HUB_EPISODE_APPROVED_GATEWAY_ID),
   expectedBytes:Number(env.BLOFY_CONTENT_HUB_EPISODE_EXPECTED_BYTES),
   runId:String(env.BLOFY_CONTENT_HUB_EPISODE_RUN_ID),
   token:String(env.BLOFY_CONTENT_HUB_BRIDGE_TOKEN)};
}
async function exactRange(response,{from,to,total}){
 const needed=to-from+1;
 if(!response?.body||response.status!==206||
   !parseMirrorContentRange(response.headers?.get?.('content-range'),
     {from,to,expectedBytes:total})||
   response.headers.get('content-length')!==null&&
     Number(response.headers.get('content-length'))!==needed)
  throw Error('episode_invalid_provider_range');
 const reader=response.body.getReader(),chunks=[];
 let received=0;
 try{
  while(received<needed){
   const item=await reader.read();
   const len=item.value?.byteLength||0;
   if(item.done||len<1||len>needed-received)
    throw Error('episode_short_or_overlong_range');
   chunks.push(Buffer.from(item.value));received+=len;
  }
  return Buffer.concat(chunks,received);
 }finally{
  try{await reader.cancel()}catch{}
  try{reader.releaseLock()}catch{}
 }
}
async function sourceRange({cfg,fetchImpl,from,to,signal}){
 const request=await fetchImpl(ORIGIN+
    '/internal/blofy-content-hub/source/episode/'+cfg.gatewayId,{
   method:'GET',redirect:'manual',headers:{
    authorization:'Bearer '+cfg.token,
    'x-blofy-episode-transfer':'operator-authorized',
    range:`bytes=${from}-${to}`,'accept-encoding':'identity'
   },
   signal:signal?AbortSignal.any([signal,AbortSignal.timeout(90000)]):
     AbortSignal.timeout(90000)
  });
 try{
  const buffer=await exactRange(request,{from,to,total:cfg.expectedBytes});
  const providerValidator=String(request.headers?.get?.('etag')||
    request.headers?.get?.('last-modified')||'').trim();
  if(providerValidator.length>140||
    /[\r\n]/.test(providerValidator))
   throw Error('episode_invalid_provider_validator');
  return {buffer,providerValidator};
 }finally{if(request?.body&&!request.body.locked)
  await request.body.cancel().catch(()=>{})}
}
async function boundaryFingerprint({cfg,fetchImpl,signal}){
 const sha=createHash('sha256');
 for(const [from,to] of [[0,4095],
   [cfg.expectedBytes-4096,cfg.expectedBytes-1]]){
  const {buffer}=await sourceRange({cfg,fetchImpl,from,to,signal});
  sha.update(buffer);
 }
 return 'boundary-sha256:'+sha.digest('hex');
}
async function verifyStoredEpisode({storage,parts,total,signal}){
 const overall=createHash('sha256');let pos=0;
 for(const [index,part] of parts.entries()){
  if(signal?.aborted)throw Error('episode_cancelled');
  if(part.partNumber!==index+1||
    part.bytes!==Math.min(CHUNK,total-pos))
   throw Error('episode_checkpoint_sequence_invalid');
  const stream=await storage.readVerifiedRange({key:part.key,
    from:0,to:part.bytes-1,expectedBytes:part.bytes,signal});
  let copied=0;const hash=createHash('sha256');
  try{
   for await(const bytes of stream){
    copied+=bytes.byteLength;
    if(copied>part.bytes)throw Error('episode_stored_part_too_long');
    hash.update(bytes);overall.update(bytes);
   }
  }finally{stream.destroy?.()}
  if(copied!==part.bytes||hash.digest('hex')!==part.sha256)
   throw Error('episode_stored_part_hash_mismatch');
  pos+=copied;
 }
 if(pos!==total)throw Error('episode_stored_file_incomplete');
 return overall.digest('hex');
}
export async function runOneEpisodeChunk({
 env=process.env,storage,lease,fetchImpl=fetch,
 candidateInspector=inspectEpisodeCandidates,signal,logger=()=>{}
}={}){
 const cfg=config(env);
 if(!cfg)return {...base,ok:false,code:'episode_safety_gates_off',
   blockedBy:episodeCopyReadiness(env).blockedBy};
 if(!storage||!lease||typeof lease.acquire!=='function'||
   typeof lease.loadEpisodeRun!=='function'||
   typeof lease.recordEpisodeChunk!=='function'||
   typeof storage.begin!=='function'||typeof storage.verify!=='function')
  return {...base,ok:false,code:'episode_storage_adapters_missing'};
 let lock=null,run=null,key=null,uploadId=null,s3Complete=false;
 let hardFailure=false,errorCode='episode_transfer_failed',stage='lock';
 try{
  lock=await lease.acquire('saleh');
  if(!lock)return {...base,ok:false,code:'episode_source_busy'};
  stage='metadata';
  const candidates=await candidateInspector({env,fetchImpl,signal});
  const item=candidates.ok===true&&Array.isArray(candidates.candidates)?
    candidates.candidates.find(x=>x.gatewayId===cfg.gatewayId):null;
  if(!item||item.sourceName!=='saleh'||item.mediaKind!=='episode')
   return {...base,ok:false,code:'episode_mapping_not_approved'};
  const fingerprintKey=createHash('sha256').update(
    cfg.runId+'|'+item.sourceId+'|'+item.mediaId+'|'+cfg.gatewayId
   ).digest('hex').slice(0,24);
  stage='manifest';
  run=await lease.loadEpisodeRun({runId:cfg.runId,
   sourceId:item.sourceId,mediaId:item.mediaId,
   gatewayId:cfg.gatewayId,extension:item.extension,
   expectedBytes:cfg.expectedBytes});
  if(run.state==='verified')return {...base,ok:true,
   code:'episode_already_verified',completed:true,bytes:cfg.expectedBytes};
  if(run.state!=='staged')return {...base,ok:false,
   code:'episode_run_not_resumable'};
  const totalParts=Math.ceil(cfg.expectedBytes/CHUNK);
  const no=run.parts.length+1;
  if(no>totalParts)return {...base,ok:false,
   code:'episode_final_verification_pending'};
  const from=(no-1)*CHUNK,to=Math.min(cfg.expectedBytes,from+CHUNK)-1;
  if(signal?.aborted)throw Error('episode_cancelled');
  stage='boundary_precheck';
  const boundary=await boundaryFingerprint({cfg,fetchImpl,signal});
  if(run.validator&&run.validator!==boundary){
   hardFailure=true;errorCode='episode_source_fingerprint_changed';
   throw Error('episode_source_changed');
  }
  stage='source_chunk';
  const result=await sourceRange({cfg,fetchImpl,from,to,signal});
  const validator=result.providerValidator||boundary;
  if(run.validator&&run.validator!==validator){
   hardFailure=true;errorCode='episode_source_version_changed';
   throw Error('episode_source_version_changed');
  }
  if(!result.providerValidator){
   stage='boundary_postcheck';
   const after=await boundaryFingerprint({cfg,fetchImpl,signal});
   if(after!==boundary){
    hardFailure=true;errorCode='episode_source_fingerprint_changed';
    throw Error('episode_source_changed_during_transfer');
   }
  }
  const sha256=createHash('sha256').update(result.buffer).digest('hex');
  key='saleh/episode/'+item.sourceId+'/batch_'+fingerprintKey+
    '_part_'+String(no).padStart(6,'0')+'.'+item.extension;
  stage='s3_begin';
  const started=await storage.begin({key,private:true,
    contentType:'application/octet-stream',
    metadata:{kind:'licensed-episode-part',part:String(no)}});
  uploadId=started.uploadId;
  stage='s3_upload';
  const uploaded=await storage.part({key,uploadId,
    partNumber:1,body:result.buffer});
  stage='s3_complete';
  await storage.complete({key,uploadId,
    parts:[{partNumber:1,etag:uploaded.etag}]});
  uploadId=null;s3Complete=true;
  stage='s3_verify';
  const proof=await storage.verify({key,expectedBytes:result.buffer.length,
    expectedSha256:sha256,signal});
  if(!proof?.ok||proof.bytes!==result.buffer.length||proof.sha256!==sha256){
   hardFailure=true;errorCode='episode_private_sha256_mismatch';
   throw Error('episode_private_chunk_corrupted');
  }
  stage='checkpoint';
  await lease.recordEpisodeChunk(cfg.runId,{partNumber:no,key,
    bytes:result.buffer.length,sha256,validator});
  run.parts.push({partNumber:no,key,bytes:result.buffer.length,sha256});
  key=null;s3Complete=false;
  logger('BLOFY_CONTENT_HUB_EPISODE_CHUNK_SAVED',{
   runId:cfg.runId,gatewayId:cfg.gatewayId,partNumber:no,totalParts,
   bytesCopied:to+1,expectedBytes:cfg.expectedBytes,
   customerCutover:false});
  if(no!==totalParts)return {...base,ok:true,
   code:'episode_checkpoint_saved',completed:false,
   bytesCopied:to+1,totalParts,chunksSaved:no,
   expectedBytes:cfg.expectedBytes};
  stage='verify_full_file';
  const fullSha=await verifyStoredEpisode({storage,parts:run.parts,
    total:cfg.expectedBytes,signal});
  await lease.verifyEpisodeRun(cfg.runId,{sha256:fullSha});
  return {...base,ok:true,code:'episode_fully_verified',completed:true,
   bytes:cfg.expectedBytes,sha256:fullSha,chunksSaved:no,totalParts};
 }catch{
  if(uploadId&&key)await storage.abort({key,uploadId}).catch(()=>{});
  if(key&&s3Complete)await storage.remove({key}).catch(()=>{});
  if(hardFailure&&run)
   await lease.failEpisodeRun(cfg.runId,{code:errorCode}).catch(()=>{});
  return {...base,ok:false,code:hardFailure?errorCode:
    signal?.aborted?'episode_cancelled':'episode_retryable_error',
    errorStage:stage,checkpointsRetained:run?.parts?.length||0};
 }finally{await lock?.release().catch(()=>{})}
}
