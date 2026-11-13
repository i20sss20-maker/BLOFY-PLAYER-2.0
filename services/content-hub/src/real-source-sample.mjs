// One-shot private verification: ONE source Range (8 MiB) -> private S3
// multipart object -> independent SHA256 check -> permanent deletion.
// This is not a full-film downloader. Neither sample nor credentials are
// exposed through the public site, and no subscriber path is touched.
import {randomUUID,createHash} from 'node:crypto';
import {parseStrictContentRange} from './content-range.mjs';

const S=8*1024*1024;
const ORIGIN='http://blofy-activation-portal.railway.internal:3000';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export async function runPrivateSalehSample({
 storage,lease,fetchImpl=fetch,
 bridgeOrigin=ORIGIN,bridgeToken='',
 enabled=false,quietWindowConfirmed=false
}={}){
 const base={customerTrafficChanged:false,fullFilmDownloaded:false,
  sourceMediaRetained:false,providerRequests:0,privateOnly:true};
 if(!enabled||!quietWindowConfirmed||bridgeOrigin!==ORIGIN||
   !bridgeToken||bridgeToken.length<32)
  return {...base,ok:false,code:'real_source_sample_not_enabled'};
 const lock=await lease.acquire('saleh');
 if(!lock)return {...base,ok:false,code:'content_hub_source_busy'};
 let res,uploadId=null,key=null,stored=false,requests=0,removed=false;
 try{
  const bearer='Bearer '+bridgeToken;
  const metadata=await fetchImpl(ORIGIN+'/internal/blofy-content-hub/describe',{
   method:'GET',headers:{authorization:bearer},
   redirect:'manual',signal:AbortSignal.timeout(7000)});
  if(metadata.status!==200)throw Error('bridge_describe_failed');
  const info=await metadata.json();
  if(info?.sourceName!=='saleh'||info.mediaKind!=='movie'||
    !UUID.test(info.sourceId)||!Number.isSafeInteger(info.gatewayId)||
    info.gatewayId<1||!/^[A-Za-z0-9._-]{1,128}$/.test(String(info.mediaId||'')))
   throw Error('bridge_source_scope_invalid');
  const extension=String(info.extension||'').toLowerCase();
  if(!['mp4','mkv','ts','avi'].includes(extension))
   throw Error('bridge_source_scope_invalid');
  res=await fetchImpl(ORIGIN+
   '/internal/blofy-content-hub/source/movie/'+info.gatewayId,{
   method:'GET',redirect:'manual',
   headers:{authorization:bearer,range:`bytes=0-${S-1}`,
    'accept-encoding':'identity'},
   signal:AbortSignal.timeout(90000)
  });
  requests=1;
  const metadataRange=parseStrictContentRange(res.headers?.get?.('content-range'),0,S-1);
  if(res.status!==206||!metadataRange||!res.body||
    (res.headers.get('content-length')!==null&&
     Number(res.headers.get('content-length'))!==S))
   throw Error('bridge_range_invalid');
  const bytes=Buffer.alloc(S);let current=0;
  const reader=res.body.getReader();
  try{
   while(current<S){
    const part=await reader.read();
    if(part.done)throw Error('bridge_range_incomplete');
    if(part.value?.byteLength>S-current)throw Error('bridge_range_oversized');
    bytes.set(part.value,current);
    current+=part.value.byteLength;
   }
  }finally{
   await reader.cancel().catch(()=>{});
   reader.releaseLock();
  }
  const sha=createHash('sha256').update(bytes).digest('hex');
  key='saleh/movie/'+info.sourceId+'/fixture'+randomUUID().replaceAll('-','')+'.'+extension;
  const opening=await storage.begin({key,private:true,
   contentType:'application/octet-stream',metadata:{test:'authorized-blofy-range'}});
  uploadId=opening.uploadId;
  const part=await storage.part({key,uploadId,partNumber:1,body:bytes});
  await storage.complete({key,uploadId,parts:[{partNumber:1,etag:part.etag}]});
  stored=true;uploadId=null;
  bytes.fill(0);
  const proof=await storage.verify({key,expectedBytes:S,expectedSha256:sha});
  if(!proof?.ok||proof.bytes!==S||proof.sha256!==sha)
   throw Error('bridge_storage_digest_invalid');
  return {...base,ok:true,code:'licensed_source_to_private_s3_verified',
   providerRequests:requests,sourceTotalBytes:metadataRange.totalSize,
   sampleBytesVerified:S};
 }catch{
  return {...base,ok:false,code:'real_source_sample_failed',
   providerRequests:requests};
 }finally{
  if(res?.body&&!res.body.locked)await res.body.cancel().catch(()=>{});
  if(uploadId&&key)await storage.abort({key,uploadId}).catch(()=>{});
  if(key)try{await storage.remove({key});removed=true}catch{}
  await lock.release().catch(()=>{});
 }
}
