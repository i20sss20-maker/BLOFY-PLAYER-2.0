// Resumable, opt-in ONE licensed movie: exactly one or two 8MiB source
// reads per operator request. Completed S3 objects are durable checkpoints.
// Failed/paused transfers are never exposed to customers or media clients.
import {createHash} from 'node:crypto';
import {inspectOneMoviePilot} from './one-movie-pilot.mjs';
import {MIN_PART_BYTES,parseMirrorContentRange} from './mirror-policy.mjs';

const ORIGIN='http://blofy-activation-portal.railway.internal:3000';
const ID=/^[A-Za-z0-9_-]{8,80}$/;
const MAX_BYTES=4*1024**3;
const base={privateOnly:true,customerCutover:false,downloadQueueEnabled:false};
export const CHUNK_BYTES=MIN_PART_BYTES;

export function chunkedPilotEnabled(env){
 return env.BLOFY_CONTENT_HUB_CHUNKED_ENABLED==='1'&&
   env.BLOFY_CONTENT_HUB_UPLOAD_ENABLED==='1'&&
   env.BLOFY_CONTENT_HUB_STORAGE_RIGHTS_CONFIRMED==='1'&&
   env.BLOFY_CONTENT_HUB_SOURCE_QUIET_WINDOW_CONFIRMED==='1'&&
   env.BLOFY_CONTENT_HUB_SOURCE_IDLE_CONFIRMED==='1';
}
function configFromEnv(env){
 const runId=String(env.BLOFY_CONTENT_HUB_BATCH_RUN_ID||'');
 const expectedBytes=Number(env.BLOFY_CONTENT_HUB_EXPECTED_BYTES);
 const gatewayId=Number(env.BLOFY_CONTENT_HUB_APPROVED_GATEWAY_ID);
 const token=String(env.BLOFY_CONTENT_HUB_BRIDGE_TOKEN||'');
 const perBatch=Number(env.BLOFY_CONTENT_HUB_CHUNKS_PER_BATCH||1);
 return ID.test(runId)&&Number.isSafeInteger(expectedBytes)&&
  expectedBytes>=CHUNK_BYTES&&expectedBytes<=MAX_BYTES&&
  Number.isSafeInteger(gatewayId)&&gatewayId>0&&token.length>=32&&
  Number.isInteger(perBatch)&&perBatch>=1&&perBatch<=2?
  {runId,expectedBytes,gatewayId,token,perBatch}:null;
}
// Operator-visible, read-only readiness. Reason codes are intentionally
// bounded and contain no source credentials, media URLs or private S3 keys.
export function chunkedBatchReadiness(env={}){
 const reasons=[];
 if(env.BLOFY_CONTENT_HUB_CHUNKED_ENABLED!=='1')
  reasons.push('batch_not_enabled');
 if(env.BLOFY_CONTENT_HUB_UPLOAD_ENABLED!=='1')
  reasons.push('storage_upload_disabled');
 if(env.BLOFY_CONTENT_HUB_STORAGE_RIGHTS_CONFIRMED!=='1')
  reasons.push('storage_rights_unconfirmed');
 if(env.BLOFY_CONTENT_HUB_SOURCE_QUIET_WINDOW_CONFIRMED!=='1')
  reasons.push('source_quiet_window_unconfirmed');
 if(env.BLOFY_CONTENT_HUB_SOURCE_IDLE_CONFIRMED!=='1')
  reasons.push('source_idle_unconfirmed');
 if(!ID.test(String(env.BLOFY_CONTENT_HUB_BATCH_RUN_ID||'')))
  reasons.push('batch_run_id_missing');
 const exact=Number(env.BLOFY_CONTENT_HUB_EXPECTED_BYTES);
 if(!Number.isSafeInteger(exact)||exact<CHUNK_BYTES||exact>MAX_BYTES)
  reasons.push('movie_size_unconfirmed');
 const movie=Number(env.BLOFY_CONTENT_HUB_APPROVED_GATEWAY_ID);
 if(!Number.isSafeInteger(movie)||movie<1)
  reasons.push('approved_movie_not_selected');
 if(String(env.BLOFY_CONTENT_HUB_BRIDGE_TOKEN||'').length<32)
  reasons.push('source_bridge_not_configured');
 const perBatch=Number(env.BLOFY_CONTENT_HUB_CHUNKS_PER_BATCH||1);
 if(!Number.isInteger(perBatch)||perBatch<1||perBatch>2)
  reasons.push('invalid_batch_limit');
 return {ready:reasons.length===0,blockedBy:reasons,
  movieTrafficChanged:false,providerMediaRequests:0};
}

async function rangeBuffer(response,{from,to,total}){
 const bytes=to-from+1;
 if(response?.status!==206||!response.body||
   !parseMirrorContentRange(response.headers?.get?.('content-range'),
   {from,to,expectedBytes:total})||
   response.headers.get('content-length')!==null&&
   Number(response.headers.get('content-length'))!==bytes)
  throw Error('invalid_range');
 const received=[],reader=response.body.getReader();
 let count=0;
 try{
  while(count<bytes){
   const next=await reader.read();
   if(next.done)throw Error('range_short');
   const chunk=Buffer.from(next.value||[]);
   if(!chunk.byteLength||chunk.byteLength>bytes-count)
    throw Error('range_length_invalid');
   received.push(chunk);count+=chunk.byteLength;
  }
  return Buffer.concat(received,count);
 }finally{
  await reader.cancel().catch(()=>{});
  reader.releaseLock();
 }
}
// Some licensed Xtream origins provide exact 206 byte ranges but no
// ETag/Last-Modified. Double-probe fixed 4KiB boundary blocks before AND
// after each real chunk. This is a sampled change detector (not as strong
// as a provider-supplied full-file version ID). Never use as customer proof.
async function sampleBoundaryFingerprint({cfg,fetchImpl,signal}){
 const digest=createHash('sha256');
 const pairs=[[0,4095],[cfg.expectedBytes-4096,cfg.expectedBytes-1]];
 for(const [from,to] of pairs){
  const r=await fetchImpl(ORIGIN+
    '/internal/blofy-content-hub/source/movie/'+cfg.gatewayId,{
    method:'GET',redirect:'manual',
    headers:{authorization:'Bearer '+cfg.token,
      range:`bytes=${from}-${to}`,'accept-encoding':'identity'},
    signal:signal?AbortSignal.any([signal,AbortSignal.timeout(45000)]):
      AbortSignal.timeout(45000)
   });
  try{
   const bytes=await rangeBuffer(r,{from,to,total:cfg.expectedBytes});
   digest.update(bytes);
  }finally{await r.body?.cancel().catch(()=>{})}
 }
 return 'boundary-sha256:'+digest.digest('hex');
}

async function checkStoredChunks({storage,parts,expectedBytes,signal}){
 const sha=createHash('sha256');
 let offset=0;
 for(const part of parts){
  if(signal?.aborted)throw Error('verification_cancelled');
  if(part.partNumber!==Math.floor(offset/CHUNK_BYTES)+1||
   part.bytes!==Math.min(CHUNK_BYTES,expectedBytes-offset))
   throw Error('checkpoint_invalid');
  const read=await storage.readVerifiedRange({
   key:part.key,from:0,to:part.bytes-1,
   expectedBytes:part.bytes,signal});
  const digest=createHash('sha256');let count=0;
  try{
   for await(const chunk of read){
    count+=chunk.byteLength;
    if(count>part.bytes)throw Error('checkpoint_oversized');
    digest.update(chunk);sha.update(chunk);
   }
  }finally{read.destroy?.()}
  if(count!==part.bytes||digest.digest('hex')!==part.sha256)
   throw Error('checkpoint_hash_mismatch');
  offset+=count;
 }
 if(offset!==expectedBytes)throw Error('checkpoint_incomplete');
 return sha.digest('hex');
}

// Re-entry is safe: a durable PG manifest advances only AFTER each S3
// chunk is stored and SHA256-verified, so previous chunks aren't re-fetched.
export async function runChunkedMovieBatch({
 env=process.env,storage,lease,fetchImpl=fetch,signal,logger=()=>{}
}={}){
 if(!chunkedPilotEnabled(env))
  return {...base,ok:false,code:'batch_safety_gates_off'};
 const cfg=configFromEnv(env);
 if(!cfg)return {...base,ok:false,code:'batch_configuration_incomplete'};
 if(!storage||!lease||typeof lease.acquire!=='function'||
  typeof lease.loadChunkedRun!=='function'||
  typeof lease.recordChunk!=='function'||typeof storage.verify!=='function'||
  typeof storage.readVerifiedRange!=='function')
  return {...base,ok:false,code:'batch_adapters_unavailable'};
 let exclusive=null,run=null,activeKey=null,uploadId=null,complete=false;
 let lastFailure='batch_failed',irrecoverable=false,stage='lock';
 try{
  exclusive=await lease.acquire('saleh');
  if(!exclusive)return {...base,ok:false,code:'batch_source_busy'};
  stage='metadata';
  const info=await inspectOneMoviePilot({env,fetchImpl,signal});
  if(!info.ok||info.sourceName!=='saleh'||info.gatewayId!==cfg.gatewayId)
   return {...base,ok:false,code:'batch_movie_mapping_mismatch'};
  const privateRunKey=createHash('sha256')
   .update(cfg.runId+'|'+info.sourceId+'|'+info.mediaId+'|'+info.gatewayId)
   .digest('hex').slice(0,24);
  stage='manifest';
  run=await lease.loadChunkedRun({
   runId:cfg.runId,sourceId:info.sourceId,mediaId:info.mediaId,
   gatewayId:info.gatewayId,extension:info.extension,
   expectedBytes:cfg.expectedBytes
  });
  if(!run||!['staged','verified'].includes(run.state))
   return {...base,ok:false,code:'batch_not_resumable'};
  if(run.state==='verified')
   return {...base,ok:true,code:'batch_already_verified',
    bytes:cfg.expectedBytes,completed:true};
  const totalParts=Math.ceil(cfg.expectedBytes/CHUNK_BYTES);
  const limit=Math.min(totalParts,run.parts.length+cfg.perBatch);
  for(let no=run.parts.length+1;no<=limit;no++){
   if(signal?.aborted)throw Error('batch_cancelled');
   const from=(no-1)*CHUNK_BYTES;
   const to=Math.min(from+CHUNK_BYTES,cfg.expectedBytes)-1;
   // Always check sampled source boundaries before a new piece. Unlike
   // an ETag this is only a sampled consistency guard, not a full proof.
   stage='boundary_precheck';
   const fingerprint=await sampleBoundaryFingerprint({
    cfg,fetchImpl,signal});
   if(run.validator?.startsWith('boundary-sha256:')&&
      run.validator!==fingerprint){
    irrecoverable=true;lastFailure='batch_source_fingerprint_changed';
    throw Error('source_boundary_changed');
   }
   stage='source_chunk';
   const response=await fetchImpl(ORIGIN+
      '/internal/blofy-content-hub/source/movie/'+cfg.gatewayId,{
     method:'GET',redirect:'manual',
     headers:{authorization:'Bearer '+cfg.token,
       range:'bytes='+from+'-'+to,'accept-encoding':'identity'},
     signal:signal?AbortSignal.any([signal,AbortSignal.timeout(90000)]):
      AbortSignal.timeout(90000)
   });
   if(response?.status!==206||!parseMirrorContentRange(
     response.headers?.get?.('content-range'),{
       from,to,expectedBytes:cfg.expectedBytes
     })){
     await response?.body?.cancel().catch(()=>{});
     throw Error('source_range_retryable');
   }
   const providerValidator=String(response.headers?.get?.('etag')||
     response.headers?.get?.('last-modified')||'').trim();
   const validator=providerValidator||fingerprint;
   if(validator.length>140||run.validator&&run.validator!==validator){
    irrecoverable=true;lastFailure='batch_source_version_changed';
    await response.body?.cancel().catch(()=>{});
    throw Error('source_version_changed');
   }
   const bytes=await rangeBuffer(response,{from,to,total:cfg.expectedBytes});
   // With no provider ETag/Last-Modified, verify that sampled boundaries
   // have not changed during the actual 8MiB source read.
   if(!providerValidator){
    stage='boundary_postcheck';
    const after=await sampleBoundaryFingerprint({cfg,fetchImpl,signal});
    if(after!==fingerprint){
     irrecoverable=true;lastFailure='batch_source_fingerprint_changed';
     throw Error('source_boundary_changed_during_chunk');
    }
   }
   const sha256=createHash('sha256').update(bytes).digest('hex');
   activeKey='saleh/movie/'+info.sourceId+'/batch_'+privateRunKey+
     '_part_'+String(no).padStart(6,'0')+'.'+info.extension;
   stage='s3_begin';
   const opened=await storage.begin({key:activeKey,private:true,
    contentType:'application/octet-stream',
    metadata:{kind:'licensed-batch',part:String(no)}});
   uploadId=opened.uploadId;
   stage='s3_upload';
   const uploaded=await storage.part({key:activeKey,uploadId,
    partNumber:1,body:bytes});
   stage='s3_complete';
   await storage.complete({key:activeKey,uploadId,
    parts:[{partNumber:1,etag:uploaded.etag}]});
   uploadId=null;complete=true;
   stage='s3_verify';
   const proof=await storage.verify({
    key:activeKey,expectedBytes:bytes.length,expectedSha256:sha256,signal});
   if(!proof?.ok||proof.bytes!==bytes.length||proof.sha256!==sha256){
    irrecoverable=true;lastFailure='batch_storage_hash_mismatch';
    throw Error('private_chunk_verification_failed');
   }
   stage='checkpoint';
   const persisted=await lease.recordChunk(cfg.runId,{
    partNumber:no,key:activeKey,bytes:bytes.length,sha256,validator
   });
   if(!persisted)throw Error('chunk_checkpoint_not_persisted');
   activeKey=null;complete=false;
   run.parts.push({partNumber:no,key:persisted.key||'saleh/movie/'+info.sourceId+
     '/batch_'+privateRunKey+'_part_'+String(no).padStart(6,'0')+'.'+info.extension,
     bytes:bytes.length,sha256});
   run.validator=validator;
   logger('BLOFY_CONTENT_HUB_CHUNK_SAVED',{
    runId:cfg.runId,partNumber:no,totalParts,
    bytesCopied:Math.min(no*CHUNK_BYTES,cfg.expectedBytes),
    expectedBytes:cfg.expectedBytes,sourceConnections:1,
    customerCutover:false
   });
  }
  if(run.parts.length<totalParts)return {...base,ok:true,
    code:'batch_checkpoint_saved',completed:false,
    bytesCopied:Math.min(run.parts.length*CHUNK_BYTES,cfg.expectedBytes),
    expectedBytes:cfg.expectedBytes,
    chunksSaved:run.parts.length,totalChunks:totalParts};
  const sha256=await checkStoredChunks({
   storage,parts:run.parts,expectedBytes:cfg.expectedBytes,signal});
  await lease.verifyChunkedRun(cfg.runId,{sha256});
  return {...base,ok:true,code:'batch_movie_fully_verified',
   completed:true,bytes:cfg.expectedBytes,sha256,chunksSaved:totalParts,
   totalChunks:totalParts};
 }catch{
  if(uploadId&&activeKey)await storage.abort({
   key:activeKey,uploadId}).catch(()=>{});
  if(activeKey&&complete)await storage.remove({key:activeKey}).catch(()=>{});
  if(irrecoverable&&run)
   await lease.failChunkedRun(cfg.runId,{code:lastFailure}).catch(()=>{});
  return {...base,ok:false,code:irrecoverable?lastFailure:
   signal?.aborted?'batch_cancelled':'batch_retryable_error',
   checkpointsRetained:run?.parts?.length||0,errorStage:stage};
 }finally{
  await exclusive?.release().catch(()=>{});
 }
}
