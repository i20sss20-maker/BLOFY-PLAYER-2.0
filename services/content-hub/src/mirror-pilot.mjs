// BLOFY licensed VOD mirror worker (code-only; NOT wired to production).
// One authorized Xtream movie/episode -> a private multipart object.
// No concurrent upstream feeds, no redirect guessing, no public URLs.
// External adapters MUST enforce source origin allowlist, IAM and a durable
// exclusive lease for 'saleh'. Media is NOT published until independent
// object hash and size verification succeeds.
import {createHash} from 'node:crypto';
import {authorizeMirrorJob,parseMirrorContentRange,rangeParts}
 from './mirror-policy.mjs';

async function exactResponseBytes(response,length){
 if(!response||response.status!==206||!response.body)
  throw Error('content_hub_range_rejected');
 const declared=response.headers.get('content-length');
 if(declared!=null&&declared!==''&&Number(declared)!==length)
  throw Error('content_hub_range_mismatch');
 const reader=response.body.getReader();
 const chunks=[];let size=0;
 try{
  while(size<length){
   const part=await reader.read();
   if(part.done)throw Error('content_hub_body_incomplete');
   const bytes=part.value?.byteLength||0;
   if(bytes>length-size)throw Error('content_hub_overlong_range');
   const data=Buffer.from(part.value||[]);
   size+=bytes;chunks.push(data);
  }
  // A server may hold the connection open after a complete Range. Abort at
  // exactly the advertised Content-Range length, never wait for another read.
  return Buffer.concat(chunks,size);
 }finally{
  try{await reader.cancel()}catch{}
  try{reader.releaseLock()}catch{}
 }
}
const safeErrorCode=error=>{
 const code=String(error?.message||'');
 const allowed=new Set(['content_hub_range_rejected','content_hub_body_incomplete',
  'content_hub_overlong_range','content_hub_range_mismatch',
  'content_hub_source_changed','content_hub_upload_invalid',
  'content_hub_storage_verification_failed']);
 return allowed.has(code)?code:'content_hub_worker_failed';
};

export async function runLicensedMirrorPilot({env={},job,privateBucket,
  readRange,storage,lease,verifyStoredObject,
  signal,partBytes}={}){
 const permit=authorizeMirrorJob({...job,env,privateBucket});
 if(!permit.allowed)return {ok:false,code:'content_hub_not_authorized',
  reasons:permit.codes,customerCutover:false,stored:false};
 if(typeof readRange!=='function'||typeof verifyStoredObject!=='function'||
   !storage||!lease||typeof lease.acquire!=='function'||
   typeof storage.begin!=='function'||typeof storage.part!=='function'||
   typeof storage.complete!=='function'||typeof storage.abort!=='function'||
   typeof storage.remove!=='function')
   return {ok:false,code:'content_hub_missing_private_adapters',
     customerCutover:false,stored:false};
 const segments=rangeParts(permit.expectedBytes,{partBytes});
 const exclusive=await lease.acquire('saleh');
 if(!exclusive||typeof exclusive.release!=='function')
   return {ok:false,code:'content_hub_source_busy',
     customerCutover:false,stored:false};
 let activeUploadId=null,completedObject=false,partsUploaded=0,sourceValidator=null;
 const digest=createHash('sha256');
 try{
  const opened=await storage.begin({
   key:permit.objectKey,private:true,contentType:'application/octet-stream',
   metadata:{source:'saleh',kind:job.mediaKind}});
  if(typeof opened?.uploadId!=='string'||opened.uploadId.length<4)
   throw Error('content_hub_upload_invalid');
  activeUploadId=opened.uploadId;
  const receipt=[];
  for(const segment of segments){
   if(signal?.aborted)throw Error('content_hub_worker_failed');
   // A time-limited readRange adapter must validate the real provider URL
   // against private source records and must never open parallel connections.
   const response=await readRange({sourceId:job.sourceId,
     mediaKind:job.mediaKind,mediaId:job.mediaId,
     extension:job.extension,from:segment.from,to:segment.to,signal});
   try{
    if(!parseMirrorContentRange(response?.headers?.get?.('content-range'),
       {from:segment.from,to:segment.to,expectedBytes:permit.expectedBytes}))
      throw Error('content_hub_range_mismatch');
    const etag=String(response.headers.get('etag')||'').trim();
    const modified=String(response.headers.get('last-modified')||'').trim();
    const validator=etag||modified;
    // A stable source version is essential: if provider changes a movie
    // mid-upload, do NOT assemble different versions into a corrupt file.
    if(!validator||validator.length>140)
      throw Error('content_hub_source_changed');
    if(sourceValidator&&sourceValidator!==validator)
      throw Error('content_hub_source_changed');
    sourceValidator=validator;
    const chunk=await exactResponseBytes(response,segment.to-segment.from+1);
    digest.update(chunk);
    const uploaded=await storage.part({
     uploadId:activeUploadId,key:permit.objectKey,
     partNumber:segment.partNumber,body:chunk
    });
    if(typeof uploaded?.etag!=='string'||!uploaded.etag)
     throw Error('content_hub_upload_invalid');
    receipt.push({partNumber:segment.partNumber,etag:uploaded.etag});
    partsUploaded++;
   }finally{
    if(response?.body&&!response.body.locked)
     await response.body.cancel().catch(()=>{});
   }
  }
  const hash=digest.digest('hex');
  await storage.complete({uploadId:activeUploadId,
    key:permit.objectKey,parts:receipt});
  activeUploadId=null;completedObject=true;
  // Independent verification reads the private stored object and MUST
  // recompute sha256 itself; S3 multipart ETag is NOT a content checksum.
  const verified=await verifyStoredObject({key:permit.objectKey,
    expectedBytes:permit.expectedBytes,expectedSha256:hash,signal});
  if(verified?.ok!==true||verified.bytes!==permit.expectedBytes||
    verified.sha256!==hash)
   throw Error('content_hub_storage_verification_failed');
  return {ok:true,code:'private_movie_mirror_verified',
    bytes:permit.expectedBytes,parts:partsUploaded,
    stored:true,privateOnly:true,customerCutover:false,
    accessURLCreated:false,externalSourceConnections:1};
 }catch(error){
  if(activeUploadId){
   try{await storage.abort({uploadId:activeUploadId,key:permit.objectKey})}catch{}
  }
  if(completedObject){
   try{await storage.remove({key:permit.objectKey})}catch{}
  }
  return {ok:false,code:safeErrorCode(error),
   partsUploaded,privateOnly:true,customerCutover:false,
   stored:false,accessURLCreated:false};
 }finally{
  await exclusive.release().catch(()=>{});
 }
}
