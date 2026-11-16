// One authorized VOD item, ONE 8 MiB private-S3 checkpoint per invocation.
// Not a background scheduler. No subscriber playback switch or public URLs.
// All real provider / S3 I/O is supplied by isolated trusted adapters.
import {createHash} from 'node:crypto';
import {parseMirrorContentRange} from './mirror-policy.mjs';

const CHUNK=8*1024*1024,MAX=4*1024**3;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const EXT=new Set(['mp4','mkv','avi','ts']);
const ITEM=/^[A-Za-z0-9._:-]{1,128}$/;
const HEX64=/^[a-f0-9]{64}$/;
const MIN_BUDGET=1024**3;
const NO_TRAFFIC={privateOnly:true,customerCutover:false,
 automaticDownload:false,subscriberRoutesChanged:false};
const error=(code,extra={})=>({ok:false,code,stored:false,
 sourceMediaRequests:0,storageWrittenBytes:0,...NO_TRAFFIC,...extra});

export function mirrorWorkerReadiness(env={}){
 const blocked=[];
 for(const [key,reason] of [
  ['BLOFY_CONTENT_HUB_MIRROR_WORKER_ENABLED','mirror_worker_disabled'],
  ['BLOFY_CONTENT_HUB_UPLOAD_ENABLED','upload_disabled'],
  ['BLOFY_CONTENT_HUB_STORAGE_RIGHTS_CONFIRMED','storage_rights_unconfirmed'],
  ['BLOFY_CONTENT_HUB_SOURCE_IDLE_CONFIRMED','source_idle_unconfirmed'],
  ['BLOFY_CONTENT_HUB_SOURCE_QUIET_WINDOW_CONFIRMED','quiet_window_unconfirmed']
 ])if(env[key]!=='1')blocked.push(reason);
 const budget=Number(env.BLOFY_CONTENT_HUB_MIRROR_BUDGET_BYTES);
 if(!Number.isSafeInteger(budget)||budget<MIN_BUDGET||
    budget>100*1024**4)blocked.push('mirror_budget_unconfigured');
 if(String(env.BLOFY_CONTENT_HUB_BRIDGE_TOKEN||'').length<32)
  blocked.push('source_bridge_missing');
 return {ready:blocked.length===0,blockedBy:blocked,
  autoStart:false,customerCutover:false,oneChunkPerRequest:true};
}

export function validateMirrorTransferApproval(a,{kind,id,now=Date.now()}={}){
 return Boolean(a?.ok===true&&a.code==='mirror_approval_exact_item'&&
   a.permissionScope==='licensed-private-vod-copy'&&
   a.sourceName==='saleh'&&UUID.test(String(a.sourceId||''))&&
   a.kind===kind&&String(a.id)===String(id)&&
   ITEM.test(String(a.mediaId||''))&&
   (kind==='movie'?/^[A-Za-z0-9_-]{1,128}$/.test(a.mediaId):true)&&
   Number.isSafeInteger(a.gatewayId)&&a.gatewayId>0&&
   EXT.has(a.extension)&&Number.isSafeInteger(a.expectedBytes)&&
   a.expectedBytes>=CHUNK&&a.expectedBytes<=MAX&&
   HEX64.test(String(a.rightsEvidenceHash||''))&&
   a.validatorPresent===true&&HEX64.test(String(a.validatorSha256||''))&&
   Number.isSafeInteger(a.approvedAt)&&
   a.approvedAt<=now&&now-a.approvedAt<=5*60*1000);
}

async function checkedChunk(response,{from,to,total,signal}){
 const length=to-from+1;
 if(response?.status!==206||!response.body||
    !parseMirrorContentRange(response.headers?.get?.('content-range'),{
      from,to,expectedBytes:total
    })||
    Number(response.headers.get('content-length'))!==length)
  throw Error('mirror_source_range_invalid');
 const etag=String(response.headers.get('etag')||'').trim();
 const lastModified=String(response.headers.get('last-modified')||'').trim();
 const validator=etag&&!/^W\//i.test(etag)?'etag:'+etag:
   lastModified?'modified:'+lastModified:'';
 if(!validator||validator.length>140||/[\r\n]/.test(validator))
  throw Error('mirror_source_validator_missing');
 const reader=response.body.getReader(),chunks=[];
 let bytes=0;
 try{
  while(bytes<length){
   if(signal?.aborted)throw Error('mirror_transfer_aborted');
   const piece=await reader.read();
   if(piece.done||!piece.value||piece.value.byteLength<1||
      piece.value.byteLength>length-bytes)
    throw Error('mirror_source_chunk_truncated');
   const buf=Buffer.from(piece.value);
   chunks.push(buf);bytes+=buf.byteLength;
  }
  return {buffer:Buffer.concat(chunks,length),validator,
   validatorSha256:createHash('sha256').update(validator,'utf8').digest('hex')};
 }finally{
  await reader.cancel().catch(()=>{});
  reader.releaseLock();
 }
}
async function independentlyVerifyFile({storage,parts,expectedBytes,signal}){
 const full=createHash('sha256');let copied=0;
 for(let i=0;i<parts.length;i++){
  const part=parts[i];
  const expected=Math.min(CHUNK,expectedBytes-copied);
  if(part.partNumber!==i+1||part.bytes!==expected||
     !HEX64.test(String(part.sha256||'')))
   throw Error('mirror_checkpoint_manifest_invalid');
  const stream=await storage.readVerifiedRange({
   key:part.key,from:0,to:part.bytes-1,expectedBytes:part.bytes,signal
  });
  let size=0;const partHash=createHash('sha256');
  try{
   for await(const bytes of stream){
    if(signal?.aborted)throw Error('mirror_transfer_aborted');
    size+=bytes.byteLength;
    if(size>part.bytes)throw Error('mirror_checkpoint_too_large');
    partHash.update(bytes);full.update(bytes);
   }
  }finally{stream.destroy?.()}
  if(size!==part.bytes||partHash.digest('hex')!==part.sha256)
   throw Error('mirror_checkpoint_hash_mismatch');
  copied+=size;
 }
 if(copied!==expectedBytes)
  throw Error('mirror_checkpoint_file_incomplete');
 return full.digest('hex');
}

export async function runMirrorTransferChunk({kind,id,env={},
 approvalLoader,readRange,storage,lease,signal,
 logger=()=>{},now=Date.now}={}){
 const ready=mirrorWorkerReadiness(env);
 if(!ready.ready)return error('mirror_worker_safety_gates_off',{
  blockedBy:ready.blockedBy});
 if(!['movie','episode'].includes(kind)||
    !(kind==='movie'?ITEM:/^[1-9][0-9]{0,9}$/).test(String(id||'')))
  return error('mirror_worker_item_invalid');
 if(typeof approvalLoader!=='function'||typeof readRange!=='function'||
    typeof storage?.measurePrivateUsage!=='function'||
    typeof storage?.headVerifiedChunk!=='function'||
    typeof storage?.verify!=='function'||
    typeof storage?.readVerifiedRange!=='function'||
    typeof lease?.acquire!=='function')
  return error('mirror_worker_private_adapters_missing');
 let approval;
 try{approval=await approvalLoader({kind,id,signal})}
 catch{return error('mirror_worker_approval_unavailable')}
 if(!validateMirrorTransferApproval(approval,{kind,id,now:now()}))
  return error('mirror_worker_approval_invalid_or_stale');
 let exclusive=null,run=null,key=null,uploadId=null,uploaded=false;
 let checkpointWriteAttempted=false,completionAttempted=false;
 let providerRequests=0,stage='lock',hardFail=false,hardCode=null;
 let storageWrittenBytes=0;
 const runId='mirror_'+createHash('sha256')
  .update([approval.sourceId,kind,id,approval.validatorSha256,
   approval.expectedBytes,approval.rightsEvidenceHash].join('|'))
  .digest('hex').slice(0,32);
 const digest=createHash('sha256')
  .update(runId+'|'+approval.sourceId+'|'+approval.mediaId+'|'+approval.gatewayId)
  .digest('hex').slice(0,24);
 const config={runId,sourceId:approval.sourceId,mediaId:approval.mediaId,
  gatewayId:approval.gatewayId,extension:approval.extension,
  expectedBytes:approval.expectedBytes};
 const load=kind==='movie'?'loadChunkedRun':'loadEpisodeRun',
  record=kind==='movie'?'recordChunk':'recordEpisodeChunk',
  finish=kind==='movie'?'verifyChunkedRun':'verifyEpisodeRun',
  fail=kind==='movie'?'failChunkedRun':'failEpisodeRun';
 try{
  exclusive=await lease.acquire('saleh');
  if(!exclusive)return error('mirror_worker_source_busy');
  if([load,record,finish,fail].some(k=>typeof lease[k]!=='function'))
   return error('mirror_worker_checkpoint_adapter_missing');
  stage='manifest';
  run=await lease[load](config);
  if(run.state==='verified')return {...NO_TRAFFIC,ok:true,
   code:'mirror_worker_already_verified',completed:true,
   expectedBytes:approval.expectedBytes,bytesCopied:approval.expectedBytes};
  if(run.state!=='staged'||!Array.isArray(run.parts))
   return error('mirror_worker_run_not_resumable');
  const totalParts=Math.ceil(approval.expectedBytes/CHUNK);
  const verifyAndFinish=async()=>{
   stage='final_verification';
   let fullSha;
   try{
    fullSha=await independentlyVerifyFile({
     storage,parts:run.parts,expectedBytes:approval.expectedBytes,signal});
   }catch(error){
    // A temporary S3 read/timeout must NOT poison all completed
    // checkpoints. Actual hash/manifest integrity mismatches are terminal.
    const reason=String(error?.message||'');
    if(['mirror_checkpoint_hash_mismatch',
        'mirror_checkpoint_manifest_invalid',
        'mirror_checkpoint_too_large',
        'mirror_checkpoint_file_incomplete'].includes(reason)){
     hardFail=true;hardCode='mirror_private_full_sha256_mismatch';
    }
    throw error;
   }
   await lease[finish](runId,{sha256:fullSha});
   return {...NO_TRAFFIC,ok:true,code:'mirror_worker_fully_verified',
    completed:true,runId,expectedBytes:approval.expectedBytes,
    bytesCopied:approval.expectedBytes,totalParts,
    partsSaved:run.parts.length,verifiedSha256:fullSha,
    sourceMediaRequests:providerRequests,storageWrittenBytes};
  };
  const copied=run.parts.reduce((a,b)=>a+Number(b.bytes||0),0);
  const total=approval.expectedBytes;
  if(!Number.isSafeInteger(copied)||copied>total||
     run.parts.length>Math.ceil(total/CHUNK))
   return error('mirror_worker_manifest_invalid');
  stage='capacity';
  // Final verification does not write source/S3 bytes and is safe to
  // attempt even if a new capacity scan is temporarily unavailable.
  if(copied===total){
   if(run.parts.length!==totalParts)
    return error('mirror_worker_manifest_invalid');
   return await verifyAndFinish();
  }
  const usage=await storage.measurePrivateUsage({signal,maxObjects:10000});
  const budget=Number(env.BLOFY_CONTENT_HUB_MIRROR_BUDGET_BYTES);
  const margin=Math.max(64*1024*1024,Math.ceil(total*0.05));
  // Count remaining bytes because already completed chunks are in S3 usage.
  if(usage?.ok!==true||usage.usageExact!==true||
     usage.verifiedPrivateBucket!==true||
     !Number.isSafeInteger(usage.usedBytes)||usage.usedBytes<0||
     !Number.isSafeInteger(usage.objectCount)||
     usage.usedBytes+(total-copied)+margin>budget)
   return error('mirror_worker_private_capacity_unverified_or_exceeded');
  const no=run.parts.length+1;
  if(no>totalParts)return error('mirror_worker_manifest_invalid');
  if(signal?.aborted)return error('mirror_worker_cancelled');
  const from=(no-1)*CHUNK,to=Math.min(from+CHUNK,total)-1;
  stage='source_read';
  providerRequests++;
  const response=await readRange({approval,from,to,signal});
  let chunk;
  try{chunk=await checkedChunk(response,{from,to,total,signal})}
  finally{if(response?.body&&!response.body.locked)
    await response.body.cancel().catch(()=>{})}
  if(chunk.validatorSha256!==approval.validatorSha256||
     run.validator&&run.validator!==chunk.validatorSha256){
   hardFail=true;hardCode='mirror_source_validator_changed';
   throw Error('mirror_source_validator_changed');
  }
  const sha256=createHash('sha256').update(chunk.buffer).digest('hex');
  key='saleh/'+kind+'/'+approval.sourceId+'/batch_'+digest+
   '_part_'+String(no).padStart(6,'0')+'.'+approval.extension;
  // Durable checkpoint writes can commit even if the database response is
  // lost. Never blindly overwrite an already saved private object.
  stage='s3_head';
  const found=await storage.headVerifiedChunk({
   key,expectedBytes:chunk.buffer.length,signal});
  if(found?.ok!==true&&found?.status!=='missing')
   return error('mirror_private_existing_object_unverified',{
    sourceMediaRequests:providerRequests,stage,priorCheckpoints:no-1});
  if(found?.ok!==true){
   stage='s3_upload';
   const opened=await storage.begin({key,private:true,
    contentType:'application/octet-stream',
    metadata:{kind:'licensed-mirror-part',part:String(no)}});
   uploadId=opened.uploadId;
   const sent=await storage.part({key,uploadId,
    partNumber:1,body:chunk.buffer});
   completionAttempted=true;
   await storage.complete({key,uploadId,
    parts:[{partNumber:1,etag:sent.etag}]});
   uploadId=null;uploaded=true;
   storageWrittenBytes=chunk.buffer.length;
  }
  // Even when S3 HEAD says the deterministic object already exists,
  // independently hash its complete bytes before reusing it. A mismatch
  // cannot be overwritten into a potentially committed checkpoint.
  stage='s3_verify';
  const proof=await storage.verify({key,
   expectedBytes:chunk.buffer.length,expectedSha256:sha256,signal});
  if(proof?.ok!==true||proof.bytes!==chunk.buffer.length||
     proof.sha256!==sha256){
   hardFail=true;hardCode='mirror_private_part_sha256_mismatch';
   throw Error('mirror_private_part_sha256_mismatch');
  }
  stage='checkpoint';
  checkpointWriteAttempted=true;
  await lease[record](runId,{partNumber:no,key,bytes:chunk.buffer.length,
   sha256,validator:chunk.validatorSha256});
  checkpointWriteAttempted=false; // PostgreSQL returned definitive ACK.
  run.parts.push({partNumber:no,key,bytes:chunk.buffer.length,sha256});
  key=null;uploaded=false;
  const bytesCopied=copied+chunk.buffer.length;
  logger('BLOFY_CONTENT_HUB_MIRROR_CHUNK',{kind,id,
   runId,partNumber:no,totalParts,bytesCopied,expectedBytes:total,
   customerCutover:false});
  if(no<totalParts)return {...NO_TRAFFIC,ok:true,
   code:'mirror_worker_checkpoint_saved',completed:false,
   runId,expectedBytes:total,bytesCopied,totalParts,partsSaved:no,
   sourceMediaRequests:providerRequests,storageWrittenBytes};
  return await verifyAndFinish();
 }catch{
  // Unknown database acknowledgement means the checkpoint MAY already be
  // committed. Deleting that S3 key would corrupt a durable manifest.
  // Leave the verified deterministic private object for reconciliation.
  if(key&&uploadId)await storage.abort({key,uploadId}).catch(()=>{});
  if(key&&uploaded&&!checkpointWriteAttempted)
   await storage.remove({key}).catch(()=>{});
  if(hardFail&&run)await lease[fail](runId,{code:hardCode}).catch(()=>{});
  return error(hardFail?hardCode:
    checkpointWriteAttempted?'mirror_checkpoint_commit_uncertain':
    signal?.aborted?'mirror_worker_cancelled':'mirror_worker_retryable_failure',{
    sourceMediaRequests:providerRequests,stage,
    storageWrittenBytes,
    objectRetainedForReconciliation:Boolean(
     key&&(checkpointWriteAttempted||completionAttempted)),
    priorCheckpoints:run?.parts?.length||0});
 }finally{await exclusive?.release().catch(()=>{})}
}
