import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {mirrorWorkerReadiness,validateMirrorTransferApproval,
 runMirrorTransferChunk} from '../src/mirror-transfer-worker.mjs';

const UUID='123e4567-e89b-42d3-a456-426614174000',K=8*1024*1024;
const SOURCE_VERSION=createHash('sha256').update('etag:"version-1"','utf8').digest('hex');
const ENV={
 BLOFY_CONTENT_HUB_MIRROR_WORKER_ENABLED:'1',
 BLOFY_CONTENT_HUB_UPLOAD_ENABLED:'1',
 BLOFY_CONTENT_HUB_STORAGE_RIGHTS_CONFIRMED:'1',
 BLOFY_CONTENT_HUB_SOURCE_IDLE_CONFIRMED:'1',
 BLOFY_CONTENT_HUB_SOURCE_QUIET_WINDOW_CONFIRMED:'1',
 BLOFY_CONTENT_HUB_MIRROR_BUDGET_BYTES:String(1024**3),
 BLOFY_CONTENT_HUB_BRIDGE_TOKEN:'x'.repeat(40)
};
const now=1700000000000;
const approval=({
 ok:true,code:'mirror_approval_exact_item',sourceName:'saleh',
 sourceId:UUID,kind:'movie',id:'31415',mediaId:'31415',
 gatewayId:125,extension:'mkv',
 expectedBytes:K+127,rightsEvidenceHash:'a'.repeat(64),
 validatorSha256:SOURCE_VERSION,
 validatorPresent:true,approvedAt:now,
 permissionScope:'licensed-private-vod-copy'
});
function fixture({bytes=K+127,changeValidator=false,
 badStoredHash=false,storageBudget=1024**3,capacityOk=true}={}){
 const output=Buffer.alloc(bytes,0x4f);
 const stored=new Map(),staging=new Map(),runs=new Map();
 const calls={media:[],uploads:[],verified:0,deleted:[],locks:0};
 const storage={
  measurePrivateUsage:async()=>({ok:capacityOk,usageExact:true,
   verifiedPrivateBucket:true,objectCount:stored.size,
   usedBytes:[...stored.values()].reduce((n,b)=>n+b.length,0)}),
  begin:async({key,private:privateOnly})=>{
   assert.equal(privateOnly,true);calls.uploads.push(key);
   return {uploadId:'upload_test'};
  },
  part:async({key,body})=>{
   staging.set(key,Buffer.from(body));return {etag:'"part"'}
  },
  complete:async({key})=>{stored.set(key,staging.get(key));staging.delete(key)},
  abort:async({key})=>{staging.delete(key)},
  remove:async({key})=>{stored.delete(key);calls.deleted.push(key)},
  verify:async({key,expectedBytes,expectedSha256})=>{
   calls.verified++;
   const v=stored.get(key);
   if(!v)return {ok:false,bytes:0};
   const h=createHash('sha256').update(v).digest('hex');
   return {ok:!badStoredHash&&v.byteLength===expectedBytes&&
      h===expectedSha256,bytes:v.byteLength,sha256:h};
  },
  readVerifiedRange:async({key,expectedBytes,from,to})=>{
   const buf=stored.get(key);assert.ok(buf);
   assert.equal(expectedBytes,buf.length);
   return Readable.from([buf.subarray(from,to+1)]);
  }
 };
 const lease={
  acquire:async(name)=>{
   assert.equal(name,'saleh');calls.locks++;
   return {release:async()=>{}};
  },
  loadChunkedRun:async cfg=>{
   let r=runs.get(cfg.runId);
   if(!r){r={state:'staged',parts:[],config:cfg,validator:null};runs.set(cfg.runId,r)}
   else assert.deepEqual(r.config,cfg);
   return {...r,parts:r.parts.map(x=>({...x}))};
  },
  recordChunk:async(runId,part)=>{
   const r=runs.get(runId);
   assert.equal(part.partNumber,r.parts.length+1);
   assert.ok(!r.validator||r.validator===part.validator);
   r.validator=part.validator;r.parts.push(part);
  },
  verifyChunkedRun:async(runId,{sha256})=>{
   const r=runs.get(runId);assert.equal(r.state,'staged');
   r.state='verified';r.sha256=sha256;
  },
  failChunkedRun:async(runId,{code})=>{
   runs.get(runId).state='failed';runs.get(runId).error=code;
  }
 };
 const approvalLoader=async()=>({...approval,expectedBytes:bytes});
 const readRange=async({from,to})=>{
   calls.media.push([from,to]);
   const part=output.subarray(from,to+1);
   const etag=changeValidator&&from>0?'"changed"':'"version-1"';
   return new Response(part,{status:206,headers:{
    'content-range':'bytes '+from+'-'+to+'/'+bytes,
    'content-length':String(part.byteLength),'etag':etag}});
 };
 return {storage,lease,approvalLoader,readRange,calls,runs,stored,output,
  env:{...ENV,BLOFY_CONTENT_HUB_MIRROR_BUDGET_BYTES:String(storageBudget)}};
}
function run(f,opts={}){
 return runMirrorTransferChunk({...f,kind:'movie',id:'31415',
  now:()=>now,...opts});
}

test('worker is OFF by default and no source or S3 is contacted',async()=>{
 assert.equal(mirrorWorkerReadiness({}).ready,false);
 const f=fixture();
 const r=await run(f,{env:{}});
 assert.equal(r.ok,false);assert.equal(r.sourceMediaRequests,0);
 assert.equal(r.customerCutover,false);
 assert.equal(f.calls.locks,0);
 assert.equal(f.calls.media.length,0);
});

test('exact source scope, rights evidence, expiry, source validator mandatory',()=>{
 assert.equal(validateMirrorTransferApproval(approval,{kind:'movie',id:'31415',now}),true);
 for(const a of [
  {...approval,sourceId:'bad'},
  {...approval,mediaId:'../../etc'},
  {...approval,validatorPresent:false},
  {...approval,rightsEvidenceHash:''},
  {...approval,validatorSha256:''},
  {...approval,approvedAt:now-3600000},
  {...approval,permissionScope:'public'},
  {...approval,sourceName:'someone else'}
 ])assert.equal(validateMirrorTransferApproval(a,{kind:'movie',id:'31415',now}),false);
});

test('exact one 8 MiB checkpoint per operator call, then full independent S3 digest',async()=>{
 const f=fixture();
 const first=await run(f);
 assert.equal(first.ok,true);assert.equal(first.completed,false);
 assert.equal(first.code,'mirror_worker_checkpoint_saved');
 assert.equal(first.bytesCopied,K);
 assert.equal(first.sourceMediaRequests,1);
 assert.equal(first.storageWrittenBytes,K);
 assert.equal(first.customerCutover,false);
 assert.deepEqual(f.calls.media,[[0,K-1]]);
 const second=await run(f);
 assert.equal(second.ok,true);assert.equal(second.completed,true);
 assert.equal(second.code,'mirror_worker_fully_verified');
 assert.equal(second.bytesCopied,K+127);
 assert.equal(second.storageWrittenBytes,127);
 assert.deepEqual(f.calls.media,[[0,K-1],[K,K+126]]);
 assert.equal(second.verifiedSha256,
   createHash('sha256').update(f.output).digest('hex'));
 assert.equal(f.calls.uploads.length,2);
 const again=await run(f);
 assert.equal(again.code,'mirror_worker_already_verified');
 assert.equal(f.calls.media.length,2);
 assert.equal(f.stored.size,2);
});

test('expired or altered owner approval blocks BEFORE source lock and requests',async()=>{
 const f=fixture();
 const r=await run(f,{approvalLoader:async()=>({
  ...approval,approvedAt:now-3600000})});
 assert.equal(r.ok,false);
 assert.equal(r.code,'mirror_worker_approval_invalid_or_stale');
 assert.equal(f.calls.locks,0);assert.equal(f.calls.media.length,0);
});

test('missing capacity and insufficient budget prevent source requests',async()=>{
 const f=fixture({capacityOk:false});
 const r=await run(f);
 assert.equal(r.code,'mirror_worker_private_capacity_unverified_or_exceeded');
 assert.equal(f.calls.media.length,0);assert.equal(f.calls.uploads.length,0);
 const g=fixture();
 g.storage.measurePrivateUsage=async()=>({ok:true,
  usageExact:true,verifiedPrivateBucket:true,
  usedBytes:1024**3-1000,objectCount:0});
 const r2=await run(g);
 assert.equal(r2.code,'mirror_worker_private_capacity_unverified_or_exceeded');
 assert.equal(g.calls.media.length,0);
});

test('source ETag changes after first part -> terminal fail without second upload',async()=>{
 const f=fixture({changeValidator:true});
 assert.equal((await run(f)).ok,true);
 const r=await run(f);
 assert.equal(r.ok,false);
 assert.equal(r.code,'mirror_source_validator_changed');
 assert.equal(f.calls.uploads.length,1);
 assert.equal([...f.runs.values()][0].state,'failed');
 assert.equal(r.customerCutover,false);
});

test('private S3 SHA mismatch deletes uncheckpointed object and fails run',async()=>{
 const f=fixture({badStoredHash:true});
 const r=await run(f);
 assert.equal(r.ok,false);
 assert.equal(r.code,'mirror_private_part_sha256_mismatch');
 assert.equal(f.stored.size,0);
 assert.equal(f.calls.deleted.length,1);
 assert.equal([...f.runs.values()][0].state,'failed');
});

test('HTTP 200 full file ignores range -> fail closed with no S3 writes',async()=>{
 const f=fixture();
 const r=await run(f,{readRange:async()=>new Response('wrong',{status:200})});
 assert.equal(r.ok,false);
 assert.equal(r.code,'mirror_worker_retryable_failure');
 assert.equal(r.sourceMediaRequests,1);
 assert.equal(f.calls.uploads.length,0);
 assert.equal([...f.runs.values()][0].state,'staged');
});

test('worker source lease busy means no source media requests',async()=>{
 const f=fixture();
 const result=await run(f,{lease:{...f.lease,acquire:async()=>null}});
 assert.equal(result.code,'mirror_worker_source_busy');
 assert.equal(f.calls.media.length,0);
});


test('S3 timeout after final checkpoint is recoverable with zero new upstream requests',async()=>{
 const f=fixture();
 const original=f.storage.readVerifiedRange;
 let breakOnce=true;
 f.storage.readVerifiedRange=async args=>{
   if(breakOnce){
    breakOnce=false;
    throw Error('temporary_private_s3_unavailable');
   }
   return original(args);
 };
 assert.equal((await run(f)).code,'mirror_worker_checkpoint_saved');
 const failure=await run(f);
 assert.equal(failure.ok,false);
 assert.equal(failure.code,'mirror_worker_retryable_failure');
 assert.equal(failure.stage,'final_verification');
 assert.equal(f.calls.media.length,2);
 assert.equal(f.calls.uploads.length,2);
 assert.equal([...f.runs.values()][0].state,'staged');
 assert.equal([...f.runs.values()][0].parts.length,2);
 const recovered=await run(f);
 assert.equal(recovered.ok,true);
 assert.equal(recovered.completed,true);
 assert.equal(recovered.code,'mirror_worker_fully_verified');
 assert.equal(recovered.sourceMediaRequests,0);
 assert.equal(recovered.storageWrittenBytes,0);
 assert.equal(recovered.bytesCopied,K+127);
 assert.equal(recovered.verifiedSha256,
  createHash('sha256').update(f.output).digest('hex'));
 assert.equal(f.calls.media.length,2);
 assert.equal(f.calls.uploads.length,2);
 assert.equal([...f.runs.values()][0].state,'verified');
});

test('zero-byte S3 re-verification succeeds even when capacity scanner is offline',async()=>{
 const f=fixture();
 assert.equal((await run(f)).code,'mirror_worker_checkpoint_saved');
 const original=f.storage.readVerifiedRange;
 let transient=true;
 f.storage.readVerifiedRange=async args=>{
  if(transient){transient=false;throw Error('offline_s3_read')}
  return original(args);
 };
 await run(f);
 f.storage.measurePrivateUsage=async()=>({ok:false,code:'offline'});
 const result=await run(f);
 assert.equal(result.ok,true);
 assert.equal(result.sourceMediaRequests,0);
 assert.equal(result.storageWrittenBytes,0);
});

test('new ETag version makes a distinct run instead of treating old copy as current',async()=>{
 const f=fixture();
 const first=await run(f);
 assert.equal(first.ok,true);
 const runIdBefore=first.runId;
 const v2=createHash('sha256').update('etag:"version-2"','utf8').digest('hex');
 const v2Data=Buffer.alloc(K+127,0x63);
 const approvalLoader=async()=>({...approval,
   validatorSha256:v2,expectedBytes:K+127});
 const readRange=async({from,to})=>{
  f.calls.media.push([from,to]);
  const part=v2Data.subarray(from,to+1);
  return new Response(part,{status:206,headers:{
   'content-range':'bytes '+from+'-'+to+'/'+(K+127),
   'content-length':String(part.byteLength),'etag':'"version-2"'
  }});
 };
 const second=await run(f,{approvalLoader,readRange});
 assert.equal(second.ok,true);
 assert.notEqual(second.runId,runIdBefore);
 assert.equal(f.runs.size,2);
 assert.equal(second.sourceMediaRequests,1);
});
test('mismatched preflight ETag stops before private S3 writes',async()=>{
 const f=fixture();
 const wrong=await run(f,{approvalLoader:async()=>({
   ...approval,validatorSha256:'f'.repeat(64)
 })});
 assert.equal(wrong.ok,false);
 assert.equal(wrong.code,'mirror_source_validator_changed');
 assert.equal(wrong.sourceMediaRequests,1);
 assert.equal(f.calls.uploads.length,0);
 assert.equal([...f.runs.values()][0].state,'failed');
});
