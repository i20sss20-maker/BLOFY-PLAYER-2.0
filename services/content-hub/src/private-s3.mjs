import {createHash} from 'node:crypto';
import {
 S3Client,CreateMultipartUploadCommand,UploadPartCommand,
 CompleteMultipartUploadCommand,AbortMultipartUploadCommand,
 DeleteObjectCommand,GetObjectCommand,HeadBucketCommand
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
  async health(){
   await s3.send(new HeadBucketCommand(headers));
   return {ok:true,private:true,configured:true};
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
