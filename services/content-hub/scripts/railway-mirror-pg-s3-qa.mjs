// Disposable private QA ONLY: generated movie+episode, local in-process
// "source", real isolated Railway T3 + real *isolated* PostgreSQL.
// No Xtream credentials, subscriber playlist, live Content Hub DB/bucket,
// or customer route. All copies and DB rows are exact-key cleaned up.
import {createHash,randomUUID,randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import {createPrivateS3Adapter} from '../src/private-s3.mjs';
import {createSourceLease} from '../src/source-lease.mjs';
import {runMirrorTransferChunk} from '../src/mirror-transfer-worker.mjs';
import {diagnoseVerifiedMovie} from '../src/playback-diagnostics.mjs';
import {readMirrorHistory} from '../src/mirror-transfer-history.mjs';
import {createContentHubServer} from '../src/server.mjs';
import {generateSyntheticAvFixture} from './railway-isolated-av-smoke.mjs';

const PART=8*1024*1024,SIZE=PART+127;
const sum=x=>createHash('sha256').update(x).digest('hex');
const fail=s=>{throw Error(s)};
const SOURCE_VERSION='"qa-generated-v1"';
const VERSION_HASH=sum('etag:'+SOURCE_VERSION);
const RIGHTS_HASH=sum('SYNTHETIC_ONLY_NO_THIRD_PARTY_COPY');
const BASE={synthetic:true,customerCutover:false,
 sourceRequestsToXtream:0,subscriberRoutesModified:false,
 movieVerified:false,episodeVerified:false,allSha256Verified:false,
 audioVideoDecoded:false,ownerSeekVerified:false,
 dbRowsCleaned:false,s3ObjectsCleaned:false,s3ObjectsAfter:null,
 devicePlaybackVerified:false};
function gate(env){
 if(env.BLOFY_QA_SYNTHETIC_ONLY!=='1'||
    env.BLOFY_QA_SYNTHETIC_AV!=='1'||
    env.BLOFY_QA_ISOLATED_BUCKET!=='1'||
    env.BLOFY_QA_REAL_PG_MIRROR!=='1')
  fail('qa_integration_not_authorized');
 if(env.BLOFY_QA_EXPECTED_BUCKET!=='blofy-mirror-s3-isolated-qa-pkbfbm'||
    env.BLOFY_CONTENT_HUB_S3_BUCKET!=='blofy-mirror-s3-isolated-qa-pkbfbm')
  fail('qa_integration_bucket_not_isolated');
 const url=new URL(env.BLOFY_QA_PG_CONNECTION_URL||'postgres://invalid');
 if(!url.hostname.endsWith('.railway.internal')||
    url.hostname!==env.BLOFY_QA_EXPECTED_PG_HOST||
    !/postgres-ao7c/i.test(url.hostname))
  fail('qa_integration_database_not_isolated');
 const s3=new URL(env.BLOFY_CONTENT_HUB_S3_ENDPOINT||'https://invalid');
 if(!s3.hostname.endsWith('.storageapi.dev')||
    env.BLOFY_CONTENT_HUB_S3_URL_STYLE!=='virtual-host')
  fail('qa_integration_s3_endpoint_invalid');
}
async function buildAv(){
 const original=await generateSyntheticAvFixture();
 if(original.length>=SIZE-8)fail('qa_integration_media_too_large');
 const fill=Buffer.alloc(SIZE-original.length);
 fill.writeUInt32BE(fill.length,0);
 fill.write('free',4,'ascii');
 return Buffer.concat([original,fill],SIZE);
}
export async function runIsolatedMirrorPgS3({
 env=process.env,makeStorage=createPrivateS3Adapter,
 makeLease=createSourceLease,createPool=opts=>new Pool(opts),
 buildMedia=buildAv
}={}){
 const report={ok:false,code:'qa_integration_not_started',...BASE};
 let storage=null,lease=null,pool=null,httpServer=null;
 let bucketInitiallyVerifiedEmpty=false;
 const keys=new Set(),runIds=[];
 try{
  gate(env);
  storage=makeStorage({config:env});
  const initial=await storage.measurePrivateUsage({maxObjects:200});
  if(initial?.ok!==true||initial.objectCount!==0||initial.usedBytes!==0)
   fail('qa_integration_bucket_not_empty');
  bucketInitiallyVerifiedEmpty=true;
  const media=await buildMedia();
  if(!Buffer.isBuffer(media)||media.length!==SIZE)
   fail('qa_integration_bad_synthetic_media');
  const sourceId=randomUUID();
  const now=Date.now();
  pool=createPool({connectionString:env.BLOFY_QA_PG_CONNECTION_URL,
   max:2,application_name:'blofy-isolated-mirror-qa'});
  const dbTest=await pool.query('SELECT current_database() AS name');
  if(dbTest.rows?.length!==1)fail('qa_integration_postgres_unavailable');
  lease=makeLease({connectionString:env.BLOFY_QA_PG_CONNECTION_URL,
   applicationName:'blofy-isolated-mirror-qa'});
  if(await lease.health()!==true)fail('qa_integration_lease_unavailable');
  const originalBegin=storage.begin.bind(storage);
  storage.begin=async args=>{
   const key=String(args?.key||'');
   if(!key.startsWith('saleh/'+
      (key.includes('/episode/')?'episode':'movie')+'/'+sourceId+'/')||
      !key.includes('/batch_')||!key.endsWith('.mp4'))
    fail('qa_integration_object_scope_invalid');
   keys.add(key);
   return originalBegin(args);
  };
  const approvalFor=(kind,id)=>({
   ok:true,code:'mirror_approval_exact_item',
   permissionScope:'licensed-private-vod-copy',
   sourceName:'saleh',sourceId,kind,id,mediaId:kind==='movie'?
    'qa_synthetic_movie_1':'qa_synthetic_episode_2',
   gatewayId:kind==='movie'?9301:9302,
   extension:'mp4',expectedBytes:SIZE,
   rightsEvidenceHash:RIGHTS_HASH,validatorPresent:true,
   validatorSha256:VERSION_HASH,approvedAt:now
  });
  const flags={
   BLOFY_CONTENT_HUB_MIRROR_WORKER_ENABLED:'1',
   BLOFY_CONTENT_HUB_UPLOAD_ENABLED:'1',
   BLOFY_CONTENT_HUB_STORAGE_RIGHTS_CONFIRMED:'1',
   BLOFY_CONTENT_HUB_SOURCE_IDLE_CONFIRMED:'1',
   BLOFY_CONTENT_HUB_SOURCE_QUIET_WINDOW_CONFIRMED:'1',
   BLOFY_CONTENT_HUB_MIRROR_BUDGET_BYTES:String(1024**3),
   BLOFY_CONTENT_HUB_BRIDGE_TOKEN:randomBytes(32).toString('hex')
  };
  const dataHash=sum(media);
  const transfers=[];
  for(const [kind,id] of [['movie','1'],['episode','2']]){
   const approval=approvalFor(kind,id);
   const runId='mirror_'+sum([
    sourceId,kind,id,VERSION_HASH,SIZE,RIGHTS_HASH
   ].join('|')).slice(0,32);
   runIds.push({kind,id:runId});
   let readCount=0;
   const readRange=async({from,to})=>{
    readCount++;
    return new Response(media.subarray(from,to+1),{
     status:206,headers:{
      'content-range':'bytes '+from+'-'+to+'/'+SIZE,
      'content-length':String(to-from+1),
      etag:SOURCE_VERSION
     }
    });
   };
   const execute=()=>runMirrorTransferChunk({
    kind,id,env:flags,storage,lease,now:()=>now,
    approvalLoader:async()=>approval,readRange
   });
   const first=await execute();
   if(first.ok!==true||first.code!=='mirror_worker_checkpoint_saved'||
      first.bytesCopied!==PART)fail('qa_integration_first_checkpoint_failed');
   const second=await execute();
   if(second.ok!==true||second.code!=='mirror_worker_fully_verified'||
      second.verifiedSha256!==dataHash)
    fail('qa_integration_verified_manifest_failed');
   const repeated=await execute();
   if(repeated.code!=='mirror_worker_already_verified'||readCount!==2)
    fail('qa_integration_duplicate_provider_request');
   const canary=await diagnoseVerifiedMovie({
    runId,mediaKind:kind,storage,lease
   });
   if(canary.ok!==true||canary.videoFramesDecoded<1||
      canary.audioFramesDecoded<1||canary.sampleBytes!==SIZE)
    fail('qa_integration_av_decode_failed');
   await lease.recordMirrorAvSample({
    runId,kind,videoFramesDecoded:canary.videoFramesDecoded,
    audioFramesDecoded:canary.audioFramesDecoded
   });
   transfers.push({kind,runId});
   if(kind==='movie')report.movieVerified=true;
   else report.episodeVerified=true;
  }
  report.allSha256Verified=true;
  report.audioVideoDecoded=true;
  const history=await readMirrorHistory({lease,limit:12});
  if(history.ok!==true||transfers.some(({runId})=>{
   const found=history.items.find(x=>x.runId===runId);
   return found?.completed!==true||found.avPrefixDecoded!==true||
    found.ownerDevicePlaybackVerified!==false;
  }))fail('qa_integration_history_missing');
  const ownerToken=randomBytes(32).toString('hex');
  const hub=createContentHubServer({storage,lease,token:ownerToken,
   pilotEnv:{
    BLOFY_CONTENT_HUB_MIRROR_OWNER_RANGE_ENABLED:'1',
    BLOFY_CONTENT_HUB_STORAGE_RIGHTS_CONFIRMED:'1'
   }});
  httpServer=hub.server;
  await new Promise((ok,bad)=>{
   httpServer.once('error',bad);
   httpServer.listen(0,'127.0.0.1',ok);
  });
  const origin='http://127.0.0.1:'+httpServer.address().port;
  for(const {kind,runId} of transfers){
   const url=origin+'/internal/mirror/owner-range/'+kind+'/'+runId;
   const req=await fetch(url,{headers:{
    authorization:'Bearer '+ownerToken,
    'x-blofy-owner-action':'read-verified-private-mirror-range',
    range:'bytes='+(PART-17)+'-'+(PART+17)
   }});
   const bytes=Buffer.from(await req.arrayBuffer());
   if(req.status!==206||!bytes.equals(media.subarray(PART-17,PART+18)))
    fail('qa_integration_owner_seek_failed');
  }
  report.ownerSeekVerified=true;
  report.code='qa_real_pg_s3_synthetic_movie_episode_verified';
  report.ok=true;
 }catch(error){
  report.ok=false;
  const code=String(error?.message||'qa_integration_failed');
  report.code=code.startsWith('qa_')?code:'qa_integration_unexpected_failure';
 }finally{
  if(httpServer){
   try{await new Promise(ok=>httpServer.close(ok))}
   catch{report.ok=false;report.code='qa_integration_http_cleanup_failed'}
  }
  // Only exact media runs generated inside this QA process are deleted.
  if(pool){
   let pgClean=true;
   for(const {kind,id} of runIds){
    try{
     const table=kind==='movie'?'blofy_content_hub_chunk_runs':
      'blofy_content_hub_episode_runs';
     await pool.query('DELETE FROM blofy_content_hub_mirror_av_checks WHERE run_id=$1',[id])
      .catch(e=>{if(e?.code!=='42P01')throw e});
     await pool.query('DELETE FROM '+table+' WHERE run_id=$1',[id])
      .catch(e=>{if(e?.code!=='42P01')throw e});
    }catch{pgClean=false}
   }
   report.dbRowsCleaned=pgClean;
  }
  if(lease)await lease.close().catch(()=>{report.dbRowsCleaned=false});
  if(pool)await pool.end().catch(()=>{report.dbRowsCleaned=false});
  if(storage&&bucketInitiallyVerifiedEmpty){
   let deleted=true;
   for(const key of keys){
    try{await storage.remove({key})}catch{deleted=false}
   }
   try{
    const usage=await storage.measurePrivateUsage({maxObjects:200});
    report.s3ObjectsAfter=usage?.ok===true?usage.objectCount:null;
    report.s3ObjectsCleaned=deleted&&usage?.ok===true&&
     usage.objectCount===0&&usage.usedBytes===0;
   }catch{report.s3ObjectsCleaned=false}
  }
  if((storage&&bucketInitiallyVerifiedEmpty&&!report.s3ObjectsCleaned)||
     (pool&&!report.dbRowsCleaned)){
   report.ok=false;report.code='qa_integration_cleanup_unverified';
  }
 }
 return report;
}
if(process.argv[1]?.endsWith('/railway-mirror-pg-s3-qa.mjs')){
 const result=await runIsolatedMirrorPgS3();
 console.log('BLOFY_RAILWAY_MIRROR_PG_S3_QA '+JSON.stringify(result));
 process.exitCode=result.ok?0:1;
}
