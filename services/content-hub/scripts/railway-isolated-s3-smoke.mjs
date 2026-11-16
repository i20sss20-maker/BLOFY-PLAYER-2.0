// Isolated Railway S3 QA, synthetic bytes only. No Xtream or subscriber access.
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {S3Client,HeadObjectCommand} from '@aws-sdk/client-s3';
import {createPrivateS3Adapter} from '../src/private-s3.mjs';

const M=5*1024*1024;
const digest=b=>createHash('sha256').update(b).digest('hex');
const err=s=>{throw Error(s)};
const safeName=e=>String(e?.name||e?.code||'unknown').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,60);
export async function runIsolatedS3Smoke({
 env=process.env,makeStorage=createPrivateS3Adapter,
 makeS3=opts=>new S3Client(opts),generate=()=>randomBytes(M+127),
 now=()=>Date.now()
}={}){
 const start=now();
 const out={ok:false,code:'qa_not_started',synthetic:true,privateOnly:true,
  sourceRequests:0,customerCutover:false,automaticCopy:false,
  writtenBytes:0,cleanedUp:false,encrypted:false,
  objectCountAfter:null,fullShaVerified:false,rangeVerified:false};
 let storage=null,key=null,uploadId=null,s3=null;
 try{
  if(env.BLOFY_QA_SYNTHETIC_ONLY!=='1'||
     env.BLOFY_QA_ISOLATED_BUCKET!=='1')
   err('qa_isolation_flags_missing');
  if(!env.BLOFY_QA_EXPECTED_BUCKET||
     env.BLOFY_QA_EXPECTED_BUCKET!==env.BLOFY_CONTENT_HUB_S3_BUCKET)
   err('qa_bucket_identity_mismatch');
  if(env.BLOFY_CONTENT_HUB_S3_URL_STYLE!=='virtual-host')
   err('qa_requires_virtual_host');
  storage=makeStorage({config:env});
  const before=await storage.measurePrivateUsage({maxObjects:1000});
  if(before?.ok!==true)err('qa_inventory_unavailable');
  if(before.usedBytes!==0||before.objectCount!==0)
   err('qa_bucket_not_empty');
  const data=generate();
  if(!Buffer.isBuffer(data)||data.length!==M+127)
   err('qa_payload_invalid');
  const uid=randomUUID().toLowerCase();
  key='saleh/movie/'+uid+'/qa_synthetic_'+uid.replaceAll('-','')+'.mp4';
  const expectedHash=digest(data);
  let stage='begin';
  try{
   const opened=await storage.begin({key,private:true,
    contentType:'application/octet-stream',
    metadata:{purpose:'qa-synthetic',notcustomer:'true'}});
   uploadId=opened.uploadId;
   stage='first_part';
   const first=await storage.part({key,uploadId,partNumber:1,
    body:data.subarray(0,M)});
   stage='last_part';
   const last=await storage.part({key,uploadId,partNumber:2,
    body:data.subarray(M)});
   stage='complete';
   await storage.complete({key,uploadId,parts:[
    {partNumber:1,etag:first.etag},{partNumber:2,etag:last.etag}
   ]});
   uploadId=null;out.writtenBytes=data.length;
   stage='head';
   const head=await storage.headVerifiedChunk({
    key,expectedBytes:data.length});
   if(head?.ok!==true)err('qa_head_mismatch');
   stage='sha';
   const verified=await storage.verify({
    key,expectedBytes:data.length,expectedSha256:expectedHash});
   if(verified?.ok!==true||verified.sha256!==expectedHash)
    err('qa_sha256_mismatch');
   out.fullShaVerified=true;
   stage='range';
   const from=M-16,to=M+15;
   const stream=await storage.readVerifiedRange({key,from,to,
    expectedBytes:data.length});
   const chunks=[];
   for await(const buf of stream)chunks.push(Buffer.from(buf));
   if(!Buffer.concat(chunks).equals(data.subarray(from,to+1)))
    err('qa_range_bytes_mismatch');
   out.rangeVerified=true;
   stage='sse';
   s3=makeS3({region:env.BLOFY_CONTENT_HUB_S3_REGION,
    endpoint:env.BLOFY_CONTENT_HUB_S3_ENDPOINT,
    forcePathStyle:false,maxAttempts:2,
    credentials:{
     accessKeyId:env.BLOFY_CONTENT_HUB_S3_ACCESS_KEY_ID,
     secretAccessKey:env.BLOFY_CONTENT_HUB_S3_SECRET_ACCESS_KEY
    }});
   const info=await s3.send(new HeadObjectCommand({
    Bucket:env.BLOFY_CONTENT_HUB_S3_BUCKET,Key:key}));
   if(info.ServerSideEncryption!=='AES256')
    err('qa_sse_not_proven');
   out.encrypted=true;
   stage='usage';
   const during=await storage.measurePrivateUsage({maxObjects:1000});
   if(during?.ok!==true||during.objectCount!==1||
      during.usedBytes!==data.length)
    err('qa_usage_mismatch');
   out.ok=true;out.code='qa_isolated_s3_verified';
  }catch(error){
   out.code=String(error?.message||'').startsWith('qa_')?
    String(error.message).slice(0,70):'qa_s3_api_failed_'+stage;
   out.errorType=safeName(error);
  }
 }catch(error){
  out.code=String(error?.message||'').startsWith('qa_')?
   String(error.message).slice(0,70):'qa_initialization_failed';
  out.errorType=safeName(error);
 }finally{
  if(storage&&key&&uploadId)
   await storage.abort({key,uploadId}).catch(()=>{});
  if(storage&&key){
   try{await storage.remove({key});out.cleanedUp=true}
   catch{out.ok=false;out.code='qa_cleanup_failed'}
   try{
    const after=await storage.measurePrivateUsage({maxObjects:1000});
    out.objectCountAfter=after?.ok===true?after.objectCount:null;
    if(after?.ok!==true||after.objectCount!==0||after.usedBytes!==0){
     out.ok=false;out.code='qa_empty_bucket_unverified';
    }
   }catch{out.ok=false;out.code='qa_cleanup_inventory_failed'}
  }
  s3?.destroy?.();
  out.elapsedMs=Math.max(0,now()-start);
 }
 return out;
}
if(process.argv[1]?.endsWith('/railway-isolated-s3-smoke.mjs')){
 const result=await runIsolatedS3Smoke();
 console.log('BLOFY_RAILWAY_ISOLATED_S3_SMOKE '+JSON.stringify(result));
 process.exitCode=result.ok===true?0:1;
}
