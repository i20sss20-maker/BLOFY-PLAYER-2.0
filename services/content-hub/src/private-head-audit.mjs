// Owner-initiated bounded PRIVATE S3 HEAD audit, not a provider read or
// streamed file verification. A HEAD proves object presence/size at request
// time only, NEVER current SHA-256 byte content. Avoid stored-key disclosure.
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const MOVIE=/^[A-Za-z0-9._:-]{1,128}$/;
const EPISODE=/^[1-9][0-9]{0,9}$/;
export const PRIVATE_HEAD_BATCH=8;
const OUTCOMES=new Set(['present_size_match','missing',
 'size_mismatch','head_unavailable','head_invalid_length']);
export function validatePrivateHeadSelection({sourceId,kind,id,start}={}){
 return UUID.test(String(sourceId||''))&&
  ['movie','episode'].includes(kind)&&
  (kind==='movie'?MOVIE:EPISODE).test(String(id||''))&&
  Number.isSafeInteger(start)&&start>=0&&start<=504&&
  start%PRIVATE_HEAD_BATCH===0;
}
export async function auditPrivateHeadBatch({
 sourceId,kind,id,start=0,lease,storage,signal,
 maxTimeMs=10500
}={}){
 if(!validatePrivateHeadSelection({sourceId,kind,id,start})||
    !lease?.getVerifiedManifestForPhysicalAudit||
    !storage?.headVerifiedChunk||
    !Number.isInteger(maxTimeMs)||maxTimeMs<1000||maxTimeMs>11500)
  return {ok:false,code:'private_head_selection_invalid',
   sourceBytesRead:0,providerRequests:0,customerCutover:false};
 const scoped=await lease.getVerifiedManifestForPhysicalAudit({
  sourceId,kind,id});
 if(!scoped)return {ok:false,code:'private_head_verified_manifest_missing',
  sourceBytesRead:0,providerRequests:0,customerCutover:false};
 const {manifest}=scoped;
 const parts=manifest.parts;
 if(!Array.isArray(parts)||parts.length<1||parts.length>512||
   start>=parts.length)return {ok:false,code:'private_head_start_out_of_range',
   sourceBytesRead:0,providerRequests:0,customerCutover:false};
 const timeout=AbortSignal.timeout(maxTimeMs);
 const combined=signal?AbortSignal.any([signal,timeout]):timeout;
 const examined=[];
 let failures=0;
 for(let index=start;index<Math.min(parts.length,start+PRIVATE_HEAD_BATCH);index++){
  if(combined.aborted){failures++;examined.push({
   partNumber:index+1,status:'head_unavailable',sizeMatched:false});
   break;}
  const p=parts[index];
  if(!p||p.partNumber!==index+1||
     typeof p.key!=='string'||!/^[a-f0-9]{64}$/.test(String(p.sha256||''))||
     !Number.isSafeInteger(p.bytes)||p.bytes<1||p.bytes>8*1024*1024){
   failures++;examined.push({partNumber:index+1,
    status:'head_invalid_length',sizeMatched:false});continue;
  }
  let proof;
  try{proof=await storage.headVerifiedChunk({
   key:p.key,expectedBytes:p.bytes,signal:combined});}
  catch{proof={ok:false,status:'head_unavailable'};}
  const status=OUTCOMES.has(proof?.status)?proof.status:'head_unavailable';
  const matched=proof?.ok===true&&status==='present_size_match'&&
   proof.bytes===p.bytes;
  if(!matched)failures++;
  examined.push({partNumber:index+1,status,sizeMatched:matched});
 }
 const last=start+examined.length>=parts.length;
 const next=last?null:start+PRIVATE_HEAD_BATCH;
 return {
  ok:true,code:failures?'private_head_batch_needs_attention':
    'private_head_batch_checked',
  kind,id,sourceId,
  manifestSha256:manifest.sha256,
  originalFileBytes:manifest.bytes,
  totalParts:parts.length,
  partStart:start,
  partsChecked:examined.length,
  matchedParts:examined.filter(x=>x.sizeMatched).length,
  failures,
  checks:examined,nextPartStart:next,
  currentBatchAllSizesMatched:failures===0&&examined.length>0,
  // One HTTP request cannot claim all 350 movie parts were checked.
  entireFileHeadCheckedInThisRequest:start===0&&next===null&&
   examined.length===parts.length&&failures===0,
  contentSha256Recomputed:false,
  currentPhysicalS3ProofType:'HEAD_object_size_only',
  privateOnly:true,mediaBytesTransferred:0,
  providerRequests:0,customerCutover:false,
  automaticCopyStarted:false
 };
}
