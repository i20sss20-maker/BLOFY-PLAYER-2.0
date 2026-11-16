import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile as execFileCb} from 'node:child_process';
import {promisify} from 'node:util';
import {diagnoseVerifiedMovie} from '../src/playback-diagnostics.mjs';
import {Pool} from 'pg';
import {S3Client,CreateBucketCommand,DeleteBucketCommand,HeadObjectCommand,PutObjectCommand}
 from '@aws-sdk/client-s3';
import {createPrivateS3Adapter} from '../src/private-s3.mjs';
import {createSourceLease} from '../src/source-lease.mjs';
import {runMirrorTransferChunk} from '../src/mirror-transfer-worker.mjs';
import {createContentHubServer} from '../src/server.mjs';

// Disposable MinIO + PostgreSQL integration only. All media bytes are made
// IN THIS TEST; absolutely no real Xtream, customer data or paid S3 is used.
const SIZE=8*1024*1024+127;
const SOURCE='00000000-0000-4000-8000-000000000053';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const VERSION=sha('etag:"ci-private-minio-source-v1"');
const execFile=promisify(execFileCb);
// Produce a REAL independently decodable video+audio sample with no
// third-party footage. MP4 "free" atom pads it past the 8MiB chunk
// boundary while keeping the entire file standards-compliant.
async function generateSyntheticAv(){
 const folder=await mkdtemp(join(tmpdir(),'blofy-ci-av-'));
 try{
  const filename=join(folder,'synthetic.mp4');
  await execFile('ffmpeg',[
   '-hide_banner','-loglevel','error','-nostdin',
   '-f','lavfi','-i','testsrc2=size=320x180:rate=12:duration=2',
   '-f','lavfi','-i','sine=frequency=880:sample_rate=44100:duration=2',
   '-c:v','mpeg4','-q:v','5','-c:a','aac','-b:a','96k',
   '-shortest','-movflags','+faststart','-y',filename
  ],{timeout:35000,maxBuffer:256000});
  const media=await readFile(filename);
  const remaining=SIZE-media.length;
  if(remaining<8||remaining>0xffffffff)throw Error('ci_video_too_large');
  const atom=Buffer.alloc(remaining);
  atom.writeUInt32BE(remaining,0);
  atom.write('free',4,'ascii');
  return Buffer.concat([media,atom],SIZE);
 }finally{await rm(folder,{recursive:true,force:true})}
}
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

test('real encrypted S3+PG+FFmpeg: lost ACK recovery and SHA/AV for movie and episode',{
 skip:!(process.env.BLOFY_TEST_PG_URL&&process.env.BLOFY_TEST_MINIO_URL),
 timeout:110000
},async()=>{
 // Isolated container per CI job. Stable name permits one deliberate
 // virtual-host DNS entry (bucket.localhost) without production DNS.
 const bucket='blofy-ci-virtualhost';
 const client=new S3Client({
  endpoint:process.env.BLOFY_TEST_MINIO_VIRTUAL_URL||
   process.env.BLOFY_TEST_MINIO_URL,region:'us-east-1',
  forcePathStyle:false,maxAttempts:2,
  credentials:{accessKeyId:'blofyci_testkey',
   secretAccessKey:'blofyci_testsecret123456'}
 });
 const virtualHostCommands=[];
 const requiredVirtualHost=new Set([
  'CreateMultipartUploadCommand','UploadPartCommand',
  'CompleteMultipartUploadCommand','GetObjectCommand',
  'HeadObjectCommand','ListObjectsV2Command'
 ]);
 // Prove the AWS SDK uses bucket.localhost, not just that an S3 server
 // accepted the request under path-style compatibility.
 client.middlewareStack.add((next,context)=>async args=>{
  if(requiredVirtualHost.has(context.commandName)){
   assert.equal(args.request?.hostname,bucket+'.localhost',
    'S3 must use Railway production virtual-host addressing');
   virtualHostCommands.push(context.commandName);
  }
  return next(args);
 },{step:'build',name:'assertRailwayStyleVirtualHost'});
 const pool=new Pool({connectionString:process.env.BLOFY_TEST_PG_URL});
 const lease=createSourceLease({connectionString:process.env.BLOFY_TEST_PG_URL,
  applicationName:'blofy-mirror-s3-ci'});
 const objectKeys=new Set(),uploads=[];
 const now=Date.now();
 const approval={ok:true,code:'mirror_approval_exact_item',
  sourceName:'saleh',sourceId:SOURCE,
  kind:'movie',id:'ci_5497',mediaId:'ci_5497',
  gatewayId:5497,extension:'mp4',expectedBytes:SIZE,
  rightsEvidenceHash:RIGHTS,validatorPresent:true,validatorSha256:VERSION,
  approvedAt:now,permissionScope:'licensed-private-vod-copy'};
 let created=false,runId=null,episodeRunId=null,sourceCalls=0;
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
    BLOFY_CONTENT_HUB_S3_URL_STYLE:'virtual-host'
   },client
  });
  let adapterError=null;
  for(const method of ['begin','part','complete','verify']){
   const original=storage[method].bind(storage);
   storage[method]=async (...args)=>{
    try{return await original(...args)}catch(error){
     adapterError={method,name:String(error?.name||''),
      code:String(error?.Code||error?.code||'').slice(0,80),
      status:Number(error?.$metadata?.httpStatusCode||0),
      detail:String(error?.message||'').slice(0,120)};
     throw error;
    }
   };
  }
  const BYTE_SAMPLE=await generateSyntheticAv();
  assert.equal(BYTE_SAMPLE.length,SIZE);
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
  const execute=(activeLease=lease)=>runMirrorTransferChunk({
   kind:'movie',id:'ci_5497',storage,lease:activeLease,
   env:FLAGS,approvalLoader,readRange,now:()=>now
  });
  // Real PG transaction commits but we deliberately discard the ACK.
  // The S3 part must remain untouched, then resume at the next byte.
  const lostAckLease={...lease,recordChunk:async(...args)=>{
   await lease.recordChunk(...args);
   throw Error('ci_simulated_lost_database_ack_after_commit');
  }};
  const first=await execute(lostAckLease);
  assert.equal(first.ok,false,JSON.stringify({first,adapterError}));
  assert.equal(first.code,'mirror_checkpoint_commit_uncertain');
  assert.equal(first.objectRetainedForReconciliation,true);
  assert.equal(first.storageWrittenBytes,8*1024*1024);
  assert.equal(sourceCalls,1);
  const halfway=await lease.listMirrorRuns({limit:24});
  assert.equal(halfway.length,1);
  runId=halfway[0].runId;
  assert.equal(halfway[0].state,'staged');
  assert.equal(halfway[0].bytesCopied,8*1024*1024);
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
   const info=await client.send(new HeadObjectCommand({
    Bucket:bucket,Key:part.key
   }));
   assert.equal(info.ServerSideEncryption,'AES256',
    'actual stored S3 multipart object must remain encrypted');
  }
  const after=await storage.measurePrivateUsage({maxObjects:1000});
  assert.equal(after.ok,true,JSON.stringify(after));
  assert.equal(after.usedBytes,SIZE);
  assert.equal(after.objectCount,2);

  // Actual end-to-end A/V proof, not an FFmpeg mock: independently read
  // the verified private S3 parts and decode video frames + audio samples.
  const canary=await diagnoseVerifiedMovie({
   runId,storage,lease,mediaKind:'movie'
  });
  assert.equal(canary.ok,true,JSON.stringify({
   code:canary.code,videoTracks:canary.videoTracks,
   audioTracks:canary.audioTracks,
   videoFramesDecoded:canary.videoFramesDecoded,
   audioFramesDecoded:canary.audioFramesDecoded,
   sampleBytes:canary.sampleBytes
  }));
  assert.equal(canary.code,'canary_audio_video_decoded');
  assert.ok(canary.videoFramesDecoded>=1);
  assert.ok(canary.audioFramesDecoded>=1);
  assert.equal(canary.providerRequests,0);
  assert.equal(canary.customerCutover,false);
  assert.equal(canary.sampleBytes,SIZE);
  assert.equal(sourceCalls,2);

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
  // Mirror episode using the REAL same storage protocol, but a distinct
  // isolated PostgreSQL episode table and exact private S3 namespace.
  const episodeApproval={
   ...approval,kind:'episode',id:'5498',
   mediaId:'ci_episode_5498',gatewayId:5498
  };
  const nextEpisode=()=>runMirrorTransferChunk({
   kind:'episode',id:'5498',storage,lease,env:FLAGS,
   approvalLoader:async()=>episodeApproval,
   readRange,now:()=>now
  });
  const epFirst=await nextEpisode();
  assert.equal(epFirst.ok,true,JSON.stringify(epFirst));
  assert.equal(epFirst.code,'mirror_worker_checkpoint_saved');
  episodeRunId=epFirst.runId;
  assert.notEqual(episodeRunId,runId);
  const epLast=await nextEpisode();
  assert.equal(epLast.ok,true,JSON.stringify(epLast));
  assert.equal(epLast.code,'mirror_worker_fully_verified');
  assert.equal(epLast.verifiedSha256,sha(BYTE_SAMPLE));
  const episodeManifest=await lease.getVerifiedEpisodeObject(episodeRunId);
  assert.ok(episodeManifest);
  assert.equal(episodeManifest.sha256,sha(BYTE_SAMPLE));
  assert.equal(episodeManifest.parts.length,2);
  for(const part of episodeManifest.parts){
   assert.match(part.key,/^saleh\/episode\//);
   objectKeys.add(part.key);
  }
  const episodeAv=await diagnoseVerifiedMovie({
   runId:episodeRunId,mediaKind:'episode',storage,lease
  });
  assert.equal(episodeAv.ok,true,JSON.stringify({
   code:episodeAv.code,videoTracks:episodeAv.videoTracks,
   audioTracks:episodeAv.audioTracks,
   videoFramesDecoded:episodeAv.videoFramesDecoded,
   audioFramesDecoded:episodeAv.audioFramesDecoded
  }));
  assert.ok(episodeAv.videoFramesDecoded>=1);
  assert.ok(episodeAv.audioFramesDecoded>=1);
  assert.equal(episodeAv.providerRequests,0);
  assert.equal(episodeAv.customerCutover,false);
  const combined=await lease.listMirrorRuns({limit:24});
  assert.equal(combined.find(x=>x.runId===runId).mediaKind,'movie');
  assert.equal(combined.find(x=>x.runId===episodeRunId).mediaKind,'episode');
  assert.equal(combined.find(x=>x.runId===episodeRunId).state,'verified');
  assert.equal(sourceCalls,4);
  assert.equal((await storage.measurePrivateUsage({maxObjects:1000}))
    .objectCount,4);
  // The owner route serves ONLY an already verified private manifest.
  // Test genuine S3-backed HTTP ranges (including an 8MiB boundary),
  // separate movie/episode selection, 401 auth, 404 consent/flag, 416
  // malformed/oversized ranges, and no source traffic during playback.
  const qaToken='ci_mirror_private_range_owner_token_12345678';
  const qa=createContentHubServer({
   storage,lease,token:qaToken,
   pilotEnv:{BLOFY_CONTENT_HUB_MIRROR_OWNER_RANGE_ENABLED:'1',
    BLOFY_CONTENT_HUB_MIRROR_AV_CANARY_ENABLED:'1',
    BLOFY_CONTENT_HUB_STORAGE_RIGHTS_CONFIRMED:'1'}
  });
  try{
   await new Promise((resolve,reject)=>{
    qa.server.once('error',reject);
    qa.server.listen(0,'127.0.0.1',resolve);
   });
   const endpoint='http://127.0.0.1:'+
    qa.server.address().port+'/internal/mirror/owner-range/';
   const endpointMovie=endpoint+'movie/'+runId;
   const endpointEpisode=endpoint+'episode/'+episodeRunId;
   const headers={
    authorization:'Bearer '+qaToken,
    'x-blofy-owner-action':'read-verified-private-mirror-range'
   };
   const denial=await fetch(endpointMovie,{method:'HEAD'});
   assert.equal(denial.status,401);
   const noConsent=await fetch(endpointMovie,{
    method:'HEAD',headers:{authorization:'Bearer '+qaToken}
   });
   assert.equal(noConsent.status,404);
   const oldRoute=await fetch('http://127.0.0.1:'+
    qa.server.address().port+'/internal/pilot/playback/'+runId,{
    method:'GET',headers:{...headers,range:'bytes=0-63'}
   });
   assert.equal(oldRoute.status,404,'legacy route must not bypass owner mirror opt-in');
   const head=await fetch(endpointMovie,{method:'HEAD',headers});
   assert.equal(head.status,200);
   assert.equal(head.headers.get('content-length'),String(SIZE));
   assert.equal(head.headers.get('x-blofy-mirror-private'),'owner-only');
   assert.equal(head.headers.get('cross-origin-resource-policy'),'same-origin');
   assert.equal(head.headers.get('accept-ranges'),'bytes');
   const start=8*1024*1024-8,end=8*1024*1024+9;
   const crossing=await fetch(endpointMovie,{
    headers:{...headers,range:'bytes='+start+'-'+end}
   });
   assert.equal(crossing.status,206);
   assert.equal(crossing.headers.get('content-range'),
    'bytes '+start+'-'+end+'/'+SIZE);
   assert.deepEqual(Buffer.from(await crossing.arrayBuffer()),
    BYTE_SAMPLE.subarray(start,end+1));
   const episode=await fetch(endpointEpisode,{
    headers:{...headers,range:'bytes=0-2047'}
   });
   assert.equal(episode.status,206);
   assert.deepEqual(Buffer.from(await episode.arrayBuffer()),
    BYTE_SAMPLE.subarray(0,2048));
   const missingRange=await fetch(endpointMovie,{headers});
   assert.equal(missingRange.status,206);
   assert.equal(missingRange.headers.get('content-length'),String(8*1024*1024));
   assert.deepEqual(Buffer.from(await missingRange.arrayBuffer()),
    BYTE_SAMPLE.subarray(0,8*1024*1024));
   const openEnded=await fetch(endpointMovie,{
    headers:{...headers,range:'bytes=0-'}
   });
   assert.equal(openEnded.status,206);
   assert.equal(openEnded.headers.get('content-length'),
    String(8*1024*1024));
   assert.deepEqual(Buffer.from(await openEnded.arrayBuffer()),
    BYTE_SAMPLE.subarray(0,8*1024*1024));
   const suffix=await fetch(endpointEpisode,{
    headers:{...headers,range:'bytes=-64'}
   });
   assert.equal(suffix.status,206);
   assert.deepEqual(Buffer.from(await suffix.arrayBuffer()),
    BYTE_SAMPLE.subarray(SIZE-64,SIZE));
   const tooLong=await fetch(endpointMovie,{
    headers:{...headers,range:'bytes=0-8388608'}
   });
   assert.equal(tooLong.status,416);
   const multi=await fetch(endpointMovie,{
    headers:{...headers,range:'bytes=0-63,128-255'}
   });
   assert.equal(multi.status,416);
   const wrongKind=await fetch(endpoint+'episode/'+runId,{
    headers:{...headers,range:'bytes=0-63'}
   });
   assert.equal(wrongKind.status,404);
   // Owner decodes actual S3 media; persisted A/V proof is bound to a
   // verified manifest SHA, but explicitly NOT to Android/Windows QA.
   const canaryUrl='http://127.0.0.1:'+
    qa.server.address().port+'/internal/mirror/copy/canary';
   for(const [kind,selectedId] of [['movie',runId],['episode',episodeRunId]]){
    const saved=await fetch(canaryUrl,{
     method:'POST',
     headers:{authorization:'Bearer '+qaToken,
      'content-type':'application/json',
      'x-blofy-owner-action':'verify-private-mirror-audio-video'},
     body:JSON.stringify({runId:selectedId,kind,ownerConfirmed:true})
    });
    assert.equal(saved.status,200);
    const proof=await saved.json();
    assert.equal(proof.ok,true);
    assert.equal(proof.avSamplePersisted,true);
    assert.equal(proof.avSampleOnly,true);
    assert.equal(proof.devicePlaybackVerified,false);
    assert.ok(proof.videoFramesDecoded>=1);
    assert.ok(proof.audioFramesDecoded>=1);
   }
   const savedProofs=await lease.listMirrorAvSamples({
    runIds:[runId,episodeRunId]});
   assert.equal(savedProofs.length,2);
   const historyResponse=await fetch(
    'http://127.0.0.1:'+qa.server.address().port+
      '/internal/mirror/copy/history',{
     headers:{authorization:'Bearer '+qaToken,
      'x-blofy-owner-action':'private-mirror-copy-history'}
    });
   assert.equal(historyResponse.status,200);
   const history=await historyResponse.json();
   for(const selectedId of [runId,episodeRunId]){
    const item=history.items.find(x=>x.runId===selectedId);
    assert.equal(item.avPrefixDecoded,true);
    assert.ok(item.avSampleCheckedAt);
    assert.equal(item.ownerDevicePlaybackVerified,false);
    assert.equal(item.fullLengthPlaybackVerified,false);
    assert.equal(item.completed,true);
   }
   assert.equal(sourceCalls,4,'owner playback and A/V must read S3 only');
  }finally{await new Promise(resolve=>qa.server.close(resolve))}
  // Deliberately tamper with one completed episode S3 object AFTER the
  // verified database manifest. A fresh canary must detect this, never
  // report valid audio/video or request upstream media again.
  const tampered=episodeManifest.parts[0];
  await client.send(new PutObjectCommand({
   Bucket:bucket,Key:tampered.key,
   Body:Buffer.alloc(tampered.bytes,0x77),
   ContentLength:tampered.bytes,ServerSideEncryption:'AES256'
  }));
  const broken=await diagnoseVerifiedMovie({
   runId:episodeRunId,mediaKind:'episode',storage,lease
  });
  assert.equal(broken.ok,false,'tampered S3 must never pass A/V canary');
  assert.equal(broken.code,'canary_private_sha256_mismatch');
  // Call the actual private HTTP owner-canary route (not a mock):
  // bad caller denied; authorized call must quarantine the corrupted
  // episode manifest atomically before returning its 409 result.
  const ownerToken='blofy_ci_only_mirror_owner_token_12345678';
  const hub=createContentHubServer({
   storage,lease,token:ownerToken,allowSynthetic:false,
   pilotEnv:{BLOFY_CONTENT_HUB_MIRROR_OWNER_RANGE_ENABLED:'1',
    BLOFY_CONTENT_HUB_MIRROR_AV_CANARY_ENABLED:'1',
    BLOFY_CONTENT_HUB_STORAGE_RIGHTS_CONFIRMED:'1'}
  });
  try{
   await new Promise((resolve,reject)=>{
    hub.server.once('error',reject);
    hub.server.listen(0,'127.0.0.1',resolve);
   });
   const port=hub.server.address().port;
   const url='http://127.0.0.1:'+port+'/internal/mirror/copy/canary';
   const body=JSON.stringify({
    runId:episodeRunId,kind:'episode',ownerConfirmed:true
   });
   const unauthorized=await fetch(url,{
    method:'POST',headers:{'content-type':'application/json'},body
   });
   assert.equal(unauthorized.status,401);
   const wrongAction=await fetch(url,{method:'POST',
    headers:{authorization:'Bearer '+ownerToken,
     'content-type':'application/json'},body});
   assert.equal(wrongAction.status,403);
   const checked=await fetch(url,{method:'POST',
    headers:{authorization:'Bearer '+ownerToken,
     'content-type':'application/json',
     'x-blofy-owner-action':'verify-private-mirror-audio-video'},
    body});
   assert.equal(checked.status,409);
   const report=await checked.json();
   assert.equal(report.ok,false);
   assert.equal(report.code,'canary_private_sha256_mismatch');
   assert.equal(report.quarantinedOnHashMismatch,true);
   assert.equal(report.providerRequests,0);
   assert.equal(report.customerCutover,false);
   const blocked=await fetch(
    'http://127.0.0.1:'+port+'/internal/mirror/owner-range/episode/'+
    episodeRunId,{
     headers:{authorization:'Bearer '+ownerToken,
      'x-blofy-owner-action':'read-verified-private-mirror-range',
      range:'bytes=0-63'}
    });
   assert.equal(blocked.status,404,
    'a corrupted S3 episode cannot remain owner-playable after quarantine');
   const remaining=await fetch(
    'http://127.0.0.1:'+port+'/internal/mirror/copy/history',{
     headers:{authorization:'Bearer '+ownerToken,
      'x-blofy-owner-action':'private-mirror-copy-history'}
    });
   assert.equal(remaining.status,200);
   const remainingHistory=await remaining.json();
   const excluded=remainingHistory.items.find(x=>x.runId===episodeRunId);
   assert.equal(excluded.state,'failed');
   assert.equal(excluded.avPrefixDecoded,false);
   assert.equal(excluded.ownerDevicePlaybackVerified,false);
  }finally{
   await new Promise(resolve=>hub.server.close(resolve));
  }
  assert.equal((await lease.listMirrorRuns({limit:24}))
   .find(x=>x.runId===episodeRunId).state,'failed');
  assert.equal(await lease.getVerifiedEpisodeObject(episodeRunId),null);
  assert.equal((await lease.quarantineMirrorRun({
   runId:episodeRunId,kind:'episode'})).ok,false);
  assert.equal(broken.providerRequests,0);
  assert.equal(broken.customerCutover,false);
  assert.equal(sourceCalls,4,'corruption check must not reread Xtream');
  for(const command of [
   'CreateMultipartUploadCommand','UploadPartCommand',
   'CompleteMultipartUploadCommand','GetObjectCommand',
   'HeadObjectCommand','ListObjectsV2Command'
  ])assert.ok(virtualHostCommands.includes(command),
   'virtual-host proof missing for '+command);
 }finally{
  if(episodeRunId){
   const copied=await pool.query(
    'SELECT parts FROM blofy_content_hub_episode_runs WHERE run_id=$1',
    [episodeRunId]).catch(()=>({rows:[]}));
   for(const part of copied.rows?.[0]?.parts||[])objectKeys.add(part.key);
   await pool.query('DELETE FROM blofy_content_hub_episode_runs WHERE run_id=$1',
    [episodeRunId]).catch(()=>{});
  }
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
