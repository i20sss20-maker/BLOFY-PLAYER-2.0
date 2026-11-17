// Read-only, owner-initiated full S3 re-verification of an already-verified
// private movie or episode. No provider request, DB mutation or subscriber path.
import {createHash} from 'node:crypto';

const RUN=/^[A-Za-z0-9_-]{8,80}$/;
const HEX=/^[a-f0-9]{64}$/;
const CHUNK=8*1024*1024;
const MAX_PARTS=512;
const MAX_BYTES=4*1024**3;
const base={privateOnly:true,readOnly:true,providerRequests:0,
 automaticCopyStarted:false,customerCutover:false,
 devicePlaybackVerified:false};

function validateManifest(manifest,kind){
 if(!manifest||!Array.isArray(manifest.parts)||
    manifest.parts.length<1||manifest.parts.length>MAX_PARTS||
    !Number.isSafeInteger(manifest.bytes)||manifest.bytes<1||
    manifest.bytes>MAX_BYTES||!HEX.test(String(manifest.sha256||'')))
  return false;
 let total=0;
 const keyPattern=new RegExp('^saleh/'+kind+
   '/[a-f0-9-]{36}/batch_[a-f0-9]{24}_part_[0-9]{6}\\.(?:mkv|mp4|ts|avi)$');
 for(const [index,part] of manifest.parts.entries()){
  if(part?.partNumber!==index+1||
     !keyPattern.test(String(part.key||''))||
     !HEX.test(String(part.sha256||''))||
     !Number.isSafeInteger(part.bytes)||part.bytes<1||
     part.bytes>CHUNK||
     (index<manifest.parts.length-1&&part.bytes!==CHUNK))return false;
  total+=part.bytes;
 }
 return total===manifest.bytes;
}

export async function auditVerifiedPrivateCopy({kind,runId,lease,storage,
 signal,maxDurationMs=300000}={}){
 if(!['movie','episode'].includes(kind)||!RUN.test(String(runId||''))||
    !lease||typeof storage?.readVerifiedRange!=='function'||
    !Number.isInteger(maxDurationMs)||maxDurationMs<1000||
    maxDurationMs>300000)
  return {...base,ok:false,code:'private_copy_audit_invalid_request'};
 let manifest;
 try{
  manifest=kind==='movie'?
    await lease.getVerifiedChunkedObject(runId):
    await lease.getVerifiedEpisodeObject(runId);
 }catch{return {...base,ok:false,code:'private_copy_audit_manifest_unavailable'}}
 if(!validateManifest(manifest,kind))
  return {...base,ok:false,code:'private_copy_audit_manifest_invalid'};
 const timeout=AbortSignal.timeout(maxDurationMs);
 const abort=signal?AbortSignal.any([signal,timeout]):timeout;
 const overall=createHash('sha256');
 let bytesRead=0,checkedParts=0;
 try{
  for(const part of manifest.parts){
   if(abort.aborted)return {...base,ok:false,
    code:'private_copy_audit_interrupted',checkedParts,bytesRead};
   const reader=await storage.readVerifiedRange({
    key:part.key,from:0,to:part.bytes-1,expectedBytes:part.bytes,
    signal:abort});
   const partHash=createHash('sha256');let seen=0;
   try{
    for await(const chunk of reader){
     if(abort.aborted)return {...base,ok:false,
      code:'private_copy_audit_interrupted',checkedParts,bytesRead};
     if(!chunk?.byteLength||seen+chunk.byteLength>part.bytes)
      return {...base,ok:false,code:'private_copy_audit_size_mismatch',
       checkedParts,bytesRead};
     seen+=chunk.byteLength;partHash.update(chunk);overall.update(chunk);
     bytesRead+=chunk.byteLength;
    }
   }finally{reader.destroy?.()}
   if(seen!==part.bytes)return {...base,ok:false,
    code:'private_copy_audit_size_mismatch',checkedParts,bytesRead};
   if(partHash.digest('hex')!==part.sha256)
    return {...base,ok:false,code:'private_copy_audit_chunk_hash_mismatch',
     checkedParts,bytesRead};
   checkedParts++;
  }
 }catch{return {...base,ok:false,
  code:abort.aborted?'private_copy_audit_interrupted':
    'private_copy_audit_storage_unavailable',checkedParts,bytesRead}}
 if(bytesRead!==manifest.bytes||overall.digest('hex')!==manifest.sha256)
  return {...base,ok:false,code:'private_copy_audit_full_hash_mismatch',
   checkedParts,bytesRead};
 return {...base,ok:true,code:'private_copy_audit_full_sha256_verified',
  mediaKind:kind,checkedParts,bytesRead,
  fullFileReadBackVerified:true,chunkSha256Verified:true,
  fullSha256Verified:true,verifiedAt:new Date().toISOString(),
  ownerAudioVideoConfirmed:false};
}
