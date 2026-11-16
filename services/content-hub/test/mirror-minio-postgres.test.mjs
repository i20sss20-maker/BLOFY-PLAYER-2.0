import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {S3Client,CreateBucketCommand,DeleteBucketCommand}
 from '@aws-sdk/client-s3';
import {createPrivateS3Adapter} from '../src/private-s3.mjs';
import {createSourceLease} from '../src/source-lease.mjs';
import {runMirrorTransferChunk} from '../src/mirror-transfer-worker.mjs';

// Disposable MinIO + PostgreSQL integration only. All media bytes are made
// IN THIS TEST; absolutely no real Xtream, customer data or paid S3 is used.
const SIZE=8*1024*1024+127;
const SOURCE='00000000-0000-4000-8000-000000000053';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const VERSION=sha('etag:"ci-private-minio-source-v1"');
const BYTE_SAMPLE=Buffer.alloc(SIZE,0x47);
const RIGHTS=sha('CI-generated-synthetic-video-bytes-only');
const FLAGS={
 BLOFY_CONTENT_HUB_MIRROR_WORKER_ENABLED:'1',
 BLOFY_CONTENT_HUB_UPLOAD_ENABLED:'1',
 BLOFY_CONTENT_HUB_STORAGE_RIGHTS_CONFIRMED:'1',
 BLOFY_CONTENT_HUB_SOURCE_IDLE_CONFIRMED:'1',
 BLOFY_CONTENT_HUB_SOURCE_QUIET_WINDOW_CONFIRMED:'1',
 BLOFY_CONTENT_HUB_MIRROR_BUDGET_BYTES:String(1024**3),
 BLOFY_CONTENT_HUB_BRIDGE_TOKEN:'test-only-minio-to-postgres-token-123456789'
};

test('private real S3 protocol and PostgreSQL copy: two verified chunks, SHA, locked source, no provider calls',{
 skip:!(process.env.BLOFY_TEST_PG_URL&&process.env.BLOFY_TEST_MINIO_URL),
 timeout:110000
},async()=>{
 const bucket='blofy-ci-'+randomUUID().replaceAll('-','').slice(0,26);
 const client=new S3Client({
  endpoint:process.env.BLOFY_TEST_MINIO_URL,region:'us-east-1',
  forcePathStyle:true,maxAttempts:2,
  credentials:{accessKeyId:'blofyci_testkey',
   secretAccessKey:'blofyci_testsecret123456'}
 });
 const pool=new Pool({connectionString:process.env.BLOFY_TEST_PG_URL});
 const lease=createSourceLease({connectionString:process.env.BLOFY_TEST_PG_URL,
  applicationName:'blofy-mirror-s3-ci'});
 const objectKeys=new Set(),uploads=[];
 const now=Date.now();
 const approval={ok:true,code:'mirror_approval_exact_item',
  sourceName:'saleh',sourceId:SOURCE,
  kind:'movie',id:'ci_5497',mediaId:'ci_5497',
  gatewayId:5497,extension:'mkv',expectedBytes:SIZE,
  rightsEvidenceHash:RIGHTS,validatorPresent:true,validatorSha256:VERSION,
  approvedAt:now,permissionScope:'licensed-private-vod-copy'};
 let created=false,runId=null,sourceCalls=0;
 try{
  await client.send(new CreateBucketCommand({Bucket:bucket}));
  created=true;
  const storage=createPrivateS3Adapter({
   // Approved production host policy remains unchanged; only the injected
   // S3Client connects to the isolated localhost MinIO service in CI.
   config:{
    BLOFY_CONTENT_HUB_S3_BUCKET:bucket,
    BLOFY_CONTENT_HUB_S3_ENDPOINT:'https://ci.storageapi.dev',
    BLOFY_CONTENT_HUB_S3_ACCESS_KEY_ID:'blofyci_testkey',
    BLOFY_CONTENT_HUB_S3_SECRET_ACCESS_KEY:'blofyci_testsecret123456',
    BLOFY_CONTENT_HUB_S3_REGION:'us-east-1',
    BLOFY_CONTENT_HUB_S3_URL_STYLE:'path'
   },client
  });
  const approvalLoader=async()=>approval;
  const readRange=async({from,to})=>{
   sourceCalls++;
   const bytes=BYTE_SAMPLE.subarray(from,to+1);
   return new Response(bytes,{status:206,headers:{
    'content-range':'bytes '+from+'-'+to+'/'+SIZE,
    'content-length':String(bytes.byteLength),
    'etag':'"ci-private-minio-source-v1"'
   }});
  };
  const execute=()=>runMirrorTransferChunk({
   kind:'movie',id:'ci_5497',storage,lease,
   env:FLAGS,approvalLoader,readRange,now:()=>now
  });
  const first=await execute();
  assert.equal(first.ok,true,JSON.stringify(first));
  assert.equal(first.code,'mirror_worker_checkpoint_saved');
  assert.equal(first.bytesCopied,8*1024*1024);
  runId=first.runId;
  const halfway=await lease.listMirrorRuns({limit:24});
  assert.equal(halfway.find(x=>x.runId===runId).state,'staged');
  const usage=await storage.measurePrivateUsage({maxObjects:1000});
  assert.equal(usage.ok,true,JSON.stringify(usage));
  assert.equal(usage.usedBytes,8*1024*1024);
  assert.equal(usage.objectCount,1);
  const second=await execute();
  assert.equal(second.ok,true,JSON.stringify(second));
  assert.equal(second.code,'mirror_worker_fully_verified');
  assert.equal(second.completed,true);
  assert.equal(second.verifiedSha256,sha(BYTE_SAMPLE));
  assert.equal(second.bytesCopied,SIZE);
  assert.equal(second.storageWrittenBytes,127);
  const manifest=await lease.getVerifiedChunkedObject(runId);
  assert.equal(manifest.sha256,sha(BYTE_SAMPLE));
  assert.equal(manifest.bytes,SIZE);
  assert.equal(manifest.parts.length,2);
  for(const part of manifest.parts){
   objectKeys.add(part.key);
   const proof=await storage.verify({key:part.key,
    expectedBytes:part.bytes,expectedSha256:part.sha256});
   assert.equal(proof.ok,true,JSON.stringify(proof));
  }
  const after=await storage.measurePrivateUsage({maxObjects:1000});
  assert.equal(after.ok,true,JSON.stringify(after));
  assert.equal(after.usedBytes,SIZE);
  assert.equal(after.objectCount,2);
  const already=await execute();
  assert.equal(already.code,'mirror_worker_already_verified');
  assert.equal(sourceCalls,2);
  assert.equal((await lease.listMirrorRuns({limit:24}))
   .find(x=>x.runId===runId).state,'verified');
  const lock=await lease.acquire('saleh');
  assert.ok(lock);
  try{
   const busy=await execute();
   assert.equal(busy.ok,false);
   assert.equal(busy.code,'mirror_worker_source_busy');
   assert.equal(sourceCalls,2);
  }finally{await lock.release()}
 }finally{
  if(runId){
   const copied=await pool.query([
    'SELECT parts FROM blofy_content_hub_chunk_runs WHERE run_id=$1'
   ].join(' '),[runId]).catch(()=>({rows:[]}));
   for(const part of copied.rows?.[0]?.parts||[])objectKeys.add(part.key);
   await pool.query('DELETE FROM blofy_content_hub_chunk_runs WHERE run_id=$1',
    [runId]).catch(()=>{});
  }
  // Delete only exact keys generated in this throwaway bucket.
  const storageForCleanup=created?createPrivateS3Adapter({
   config:{BLOFY_CONTENT_HUB_S3_BUCKET:bucket,
    BLOFY_CONTENT_HUB_S3_ENDPOINT:'https://ci.storageapi.dev',
    BLOFY_CONTENT_HUB_S3_ACCESS_KEY_ID:'blofyci_testkey',
    BLOFY_CONTENT_HUB_S3_SECRET_ACCESS_KEY:'blofyci_testsecret123456',
    BLOFY_CONTENT_HUB_S3_REGION:'us-east-1'},client
  }):null;
  for(const key of objectKeys)await storageForCleanup.remove({key}).catch(()=>{});
  if(created)await client.send(new DeleteBucketCommand({Bucket:bucket}))
   .catch(()=>{});
  await lease.close();await pool.end();client.destroy();
 }
});
