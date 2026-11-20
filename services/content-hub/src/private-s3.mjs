import {createHash} from 'node:crypto';
import {
 S3Client,CreateMultipartUploadCommand,UploadPartCommand,
 CompleteMultipartUploadCommand,AbortMultipartUploadCommand,
 DeleteObjectCommand,GetObjectCommand,HeadBucketCommand,HeadObjectCommand,
 ListObjectsV2Command,ListMultipartUploadsCommand,GetBucketVersioningCommand
} from '@aws-sdk/client-s3';

const MAX_OBJECT_BYTES=64*1024*1024*1024;
const PRIVATE_PREFIX=/^saleh\/(?:movie|episode)\/[a-f0-9-]{36}\/[A-Za-z0-9_-]{1,128}\.(?:mkv|mp4|ts|avi|mov)$/;
const required=(value,name)=>{
 const x=String(value||'').trim();
 if(!x)throw Error('content_hub_missing_'+name);
 return x;
};
function safeObjectKey(key){
 if(typeof key!=='string'||!PRIVATE_PREFIX.test(key)||key.includes('..'))
  throw Error('content_hub_invalid_object_key');
 return key;
}
export function createPrivateS3Adapter({config=process.env,client=null}={}){
 const bucket=required(config.BLOFY_CONTENT_HUB_S3_BUCKET,'bucket');
 const endpoint=required(config.BLOFY_CONTENT_HUB_S3_ENDPOINT,'endpoint');
 const host=new URL(endpoint);
 if(host.protocol!=='https:'||host.username||host.password||host.search||
   host.hash||!host.hostname.endsWith('.storageapi.dev'))
  throw Error('content_hub_storage_endpoint_not_allowed');
 const accessKeyId=required(config.BLOFY_CONTENT_HUB_S3_ACCESS_KEY_ID,'access_key');
 const secretAccessKey=required(config.BLOFY_CONTENT_HUB_S3_SECRET_ACCESS_KEY,'secret_key');
 const region=required(config.BLOFY_CONTENT_HUB_S3_REGION,'region');
 const s3=client||new S3Client({
  region,endpoint,credentials:{accessKeyId,secretAccessKey},
  forcePathStyle:config.BLOFY_CONTENT_HUB_S3_URL_STYLE==='path',
  maxAttempts:2
 });
 const headers={Bucket:bucket};
 return {
  // Exact current-object usage check for an owner-only STORAGE BUDGET,
  // not a claim that S3 has a fixed physical disk size. Reject any active
  // multipart upload, unexpected versioning, partial pagination or timeout.
  // No object names or URLs leave this private adapter.
  async measurePrivateUsage({signal,maxObjects=10000}={}){
   if(!Number.isSafeInteger(maxObjects)||maxObjects<1||
      maxObjects>10000)
    return {ok:false,code:'private_usage_scan_limit_invalid'};
   try{
    const opts=signal?{abortSignal:signal}:{};
    const versioning=await s3.send(new GetBucketVersioningCommand(headers),opts);
    if(versioning?.Status==='Enabled'||versioning?.Status==='Suspended')
     return {ok:false,code:'private_usage_versioning_unaccounted'};
    const uploads=await s3.send(new ListMultipartUploadsCommand({
     ...headers,MaxUploads:1
    }),opts);
    if(uploads.IsTruncated===true||Array.isArray(uploads.Uploads)&&
       uploads.Uploads.length>0)
     return {ok:false,code:'private_usage_multipart_active'};
    let usedBytes=0,objectCount=0,next=null,pages=0;
    do{
     const page=await s3.send(new ListObjectsV2Command({
      ...headers,MaxKeys:1000,...(next?{ContinuationToken:next}:{})
     }),opts);
     if(++pages>11||!Array.isArray(page.Contents)&&page.Contents!==undefined)
      return {ok:false,code:'private_usage_page_invalid'};
     for(const object of page.Contents||[]){
      if(!Number.isSafeInteger(object.Size)||object.Size<0)
       return {ok:false,code:'private_usage_item_invalid'};
      usedBytes+=object.Size;
      objectCount++;
      if(!Number.isSafeInteger(usedBytes)||objectCount>maxObjects)
       return {ok:false,code:'private_usage_bound_exceeded'};
     }
     if(page.IsTruncated!==true)break;
     const candidate=String(page.NextContinuationToken||'');
     if(!candidate||candidate===next)
      return {ok:false,code:'private_usage_cursor_invalid'};
     next=candidate;
    }while(true);
    return {ok:true,code:'private_usage_objects_counted',
     usedBytes,objectCount,usageExact:true,verifiedPrivateBucket:true,
     providerRequests:0,mediaBytesTransferred:0,customerCutover:false};
   }catch{
    return {ok:false,code:'private_usage_scan_unavailable',
     providerRequests:0,mediaBytesTransferred:0,customerCutover:false};
   }
  },
  async begin({key,private:priv,contentType,metadata}){
   safeObjectKey(key);
   if(priv!==true)throw Error('content_hub_public_upload_forbidden');
   const res=await s3.send(new CreateMultipartUploadCommand({
    ...headers,Key:key,ContentType:contentType||'application/octet-stream',
    Metadata:metadata||{},ServerSideEncryption:'AES256'
   }));
   if(!res.UploadId)throw Error('content_hub_upload_invalid');
   return {uploadId:res.UploadId};
  },
  async part({uploadId,key,partNumber,body}){
   safeObjectKey(key);
   if(!Number.isInteger(partNumber)||partNumber<1||partNumber>10000||
     !Buffer.isBuffer(body)||!body.length||body.length>64*1024*1024)
    throw Error('content_hub_invalid_part');
   const res=await s3.send(new UploadPartCommand({
    ...headers,Key:key,UploadId:required(uploadId,'upload_id'),
    PartNumber:partNumber,Body:body,ContentLength:body.length
   }));
   if(!res.ETag)throw Error('content_hub_upload_invalid');
   return {etag:res.ETag};
  },
  async complete({uploadId,key,parts}){
   safeObjectKey(key);
   if(!Array.isArray(parts)||!parts.length||parts.length>10000)
    throw Error('content_hub_invalid_parts');
   await s3.send(new CompleteMultipartUploadCommand({
    ...headers,Key:key,UploadId:required(uploadId,'upload_id'),
    MultipartUpload:{Parts:parts.map(p=>({PartNumber:p.partNumber,ETag:p.etag}))}
   }));
   return {ok:true};
  },
  async abort({uploadId,key}){
   safeObjectKey(key);
   await s3.send(new AbortMultipartUploadCommand({
    ...headers,Key:key,UploadId:required(uploadId,'upload_id')
   }));
  },
  async remove({key}){
   safeObjectKey(key);
   await s3.send(new DeleteObjectCommand({...headers,Key:key}));
  },
  // HEAD-only verification of one exact, manifest-approved private S3
  // chunk. Checks current object presence and size, NOT its SHA-256 bytes.
  // No provider media requests and no full object download.
  async headVerifiedChunk({key,expectedBytes,signal}={}){
   safeObjectKey(key);
   if(!Number.isSafeInteger(expectedBytes)||expectedBytes<1||
      expectedBytes>8*1024*1024)
    throw Error('content_hub_private_head_invalid');
   try{
    const result=await s3.send(new HeadObjectCommand({
      ...headers,Key:key}),{abortSignal:signal});
    const found=Number(result.ContentLength);
    if(!Number.isSafeInteger(found)||found<0)
     return {ok:false,status:'head_invalid_length'};
    return found===expectedBytes?
      {ok:true,status:'present_size_match',bytes:found}:
      {ok:false,status:'size_mismatch',bytes:found};
   }catch(error){
    if(error?.$metadata?.httpStatusCode===404||
       ['NotFound','NoSuchKey'].includes(error?.name))
      return {ok:false,status:'missing'};
    return {ok:false,status:'head_unavailable'};
   }
  },
  async readVerifiedRange({key,from,to,expectedBytes,signal}){
   safeObjectKey(key);
   if(!Number.isSafeInteger(expectedBytes)||expectedBytes<1||
     expectedBytes>MAX_OBJECT_BYTES||!Number.isSafeInteger(from)||
     !Number.isSafeInteger(to)||from<0||to<from||to>=expectedBytes||
     to-from+1>8*1024*1024)
    throw Error('content_hub_private_range_invalid');
   const obj=await s3.send(new GetObjectCommand({
    ...headers,Key:key,Range:`bytes=${from}-${to}`
   }),{abortSignal:signal});
   const range=String(obj.ContentRange||'');
   if(range!==`bytes ${from}-${to}/${expectedBytes}`||
      Number(obj.ContentLength)!==to-from+1||!obj.Body){
    obj.Body?.destroy?.();
    throw Error('content_hub_private_range_mismatch');
   }
   return obj.Body;
  },
  async verify({key,expectedBytes,expectedSha256,signal}){
   safeObjectKey(key);
   if(!Number.isSafeInteger(expectedBytes)||expectedBytes<1||
      expectedBytes>MAX_OBJECT_BYTES||!/^[a-f0-9]{64}$/.test(expectedSha256))
     throw Error('content_hub_storage_verification_invalid');
   const obj=await s3.send(new GetObjectCommand({...headers,Key:key}),{
     abortSignal:signal
   });
   const hash=createHash('sha256');let size=0;
   try{
    for await(const chunk of obj.Body){
     if(signal?.aborted)throw Error('content_hub_verification_cancelled');
     size+=chunk.byteLength;
     if(size>expectedBytes)throw Error('content_hub_storage_too_large');
     hash.update(chunk);
    }
    const sha256=hash.digest('hex');
    return {ok:size===expectedBytes&&sha256===expectedSha256,
      bytes:size,sha256};
   }finally{obj.Body?.destroy?.()}
  }
 };
}
