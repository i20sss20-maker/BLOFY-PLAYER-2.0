// A bounded, ONE-SHOT owner audit of every private S3 chunk belonging to
// exactly one already SHA-verified movie/episode. Uses S3 HeadObject only:
// physical existence and Content-Length, NEVER downloads file bytes or
// rehashes the current contents. No Xtream/provider media traffic.
const SHA=/^[0-9a-f]{64}$/;
const MAX_PARTS=512;
const MAX_TOTAL_BYTES=4*1024**3;
const STATUSES=['present_size_match','missing','size_mismatch',
  'head_unavailable','head_invalid_length'];
const pause=(ms,signal)=>new Promise((resolve,reject)=>{
  if(signal?.aborted)return reject(Error('full_private_head_aborted'));
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',onAbort);
    resolve()},ms);
  const onAbort=()=>{clearTimeout(timer);
    signal?.removeEventListener('abort',onAbort);
    reject(Error('full_private_head_aborted'))};
  signal?.addEventListener('abort',onAbort,{once:true});
});
export function validatePrivateFullHeadManifest(manifest){
 const parts=manifest?.parts;
 if(!Array.isArray(parts)||parts.length<1||parts.length>MAX_PARTS||
  !Number.isSafeInteger(manifest?.bytes)||manifest.bytes<8192||
  manifest.bytes>MAX_TOTAL_BYTES||!SHA.test(String(manifest.sha256||'')))
  return {ok:false,code:'full_private_head_manifest_invalid'};
 let total=0;
 for(let i=0;i<parts.length;i++){
  const p=parts[i];
  if(p?.partNumber!==i+1||typeof p.key!=='string'||
    !/^saleh\/(?:movie|episode)\/[a-f0-9-]{36}\/[A-Za-z0-9_-]{1,128}\.(?:mkv|mp4|ts|avi|mov)$/.test(p.key)||
    !SHA.test(String(p.sha256||''))||
    !Number.isSafeInteger(p.bytes)||p.bytes<1||p.bytes>8*1024*1024)
   return {ok:false,code:'full_private_head_part_invalid',index:i};
  total+=p.bytes;
 }
 if(total!==manifest.bytes)
  return {ok:false,code:'full_private_head_total_mismatch'};
 return {ok:true,totalParts:parts.length,expectedBytes:total};
}
export async function auditAllVerifiedPrivateS3Chunks({
  kind,runId,lease,storage,signal,
  maxDurationMs=240000,pauseMs=110,
  onProgress=()=>{}
}={}){
 if(!['movie','episode'].includes(kind)||
   !/^[A-Za-z0-9_-]{8,80}$/.test(String(runId||''))||
   !lease||!storage?.headVerifiedChunk||
   !Number.isSafeInteger(maxDurationMs)||maxDurationMs<2000||
   maxDurationMs>300000||
   !Number.isSafeInteger(pauseMs)||pauseMs<0||pauseMs>1000)
  return {ok:false,code:'full_private_head_selection_invalid',
    sourceMediaRequests:0,s3MediaBytesRead:0,customerCutover:false};
 const m=kind==='movie'?await lease.getVerifiedChunkedObject(runId):
   await lease.getVerifiedEpisodeObject(runId);
 const validity=validatePrivateFullHeadManifest(m);
 if(!validity.ok)return {...validity,kind,sourceMediaRequests:0,
   s3MediaBytesRead:0,customerCutover:false};
 const began=Date.now();
 const counts={matched:0,missing:0,mismatch:0,unavailable:0,invalid:0};
 let visited=0,retries=0;
 const timeout=AbortSignal.timeout(maxDurationMs);
 const abort=signal?AbortSignal.any([signal,timeout]):timeout;
 for(const part of m.parts){
  if(abort.aborted)break;
  let proof;
  for(let attempt=0;attempt<2;attempt++){
   try{
    proof=await storage.headVerifiedChunk({
      key:part.key,expectedBytes:part.bytes,
      signal:AbortSignal.any([abort,AbortSignal.timeout(8000)])});
   }catch{proof={ok:false,status:'head_unavailable'}}
   if(!STATUSES.includes(proof?.status))
    proof={ok:false,status:'head_unavailable'};
   if(proof.status!=='head_unavailable'||abort.aborted||attempt===1)
    break;
   retries++;
   try{await pause(450,abort)}catch{break}
  }
  if(abort.aborted)break;
  visited++;
  const status=proof?.status;
  if(status==='present_size_match'&&
     proof?.ok===true&&proof.bytes===part.bytes)counts.matched++;
  else if(status==='missing')counts.missing++;
  else if(status==='size_mismatch')counts.mismatch++;
  else if(status==='head_invalid_length')counts.invalid++;
  else counts.unavailable++;
  if(visited%32===0||visited===m.parts.length){
   onProgress({kind,visited,total:m.parts.length,...counts,retries,
     sourceMediaRequests:0,s3MediaBytesRead:0,customerCutover:false});
  }
  if(visited<m.parts.length&&pauseMs>0){
   try{await pause(pauseMs,abort)}catch{break}
  }
 }
 const full=visited===m.parts.length&&!abort.aborted;
 const allSizesMatch=full&&counts.matched===m.parts.length;
 return {ok:allSizesMatch,
  code:!full?'full_private_head_incomplete':
    allSizesMatch?'full_private_head_all_chunk_sizes_match':
    'full_private_head_needs_attention',
  kind,runId,expectedBytes:m.bytes,
  totalParts:m.parts.length,checkedParts:visited,...counts,retries,
  durationMs:Date.now()-began,
  allPartsHeadChecked:full,
  allPhysicalS3ChunkSizesMatched:allSizesMatch,
  contentSha256Recomputed:false,
  proofType:'S3_HEAD_size_presence',
  sourceMediaRequests:0,s3MediaBytesRead:0,
  transferredMediaBytes:0,automaticCopyStarted:false,
  customerCutover:false};
}
