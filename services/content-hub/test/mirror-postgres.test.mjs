import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {Pool} from 'pg';
import {createSourceLease} from '../src/source-lease.mjs';
import {runMirrorTransferChunk} from '../src/mirror-transfer-worker.mjs';

const MB=1024*1024,CHUNK=8*MB;
const SHA=s=>createHash('sha256').update(s).digest('hex');
const SOURCE='00000000-0000-4000-8000-000000000051';
const VERSION=SHA('etag:"synthetic-ci-version"');
const ENV={
 BLOFY_CONTENT_HUB_MIRROR_WORKER_ENABLED:'1',
 BLOFY_CONTENT_HUB_UPLOAD_ENABLED:'1',
 BLOFY_CONTENT_HUB_STORAGE_RIGHTS_CONFIRMED:'1',
 BLOFY_CONTENT_HUB_SOURCE_IDLE_CONFIRMED:'1',
 BLOFY_CONTENT_HUB_SOURCE_QUIET_WINDOW_CONFIRMED:'1',
 BLOFY_CONTENT_HUB_MIRROR_BUDGET_BYTES:String(1024**3),
 BLOFY_CONTENT_HUB_BRIDGE_TOKEN:'offline-test-only-1234567890123456789012'
};
const runSource={kind:'movie',id:'7777777'};
const data=Buffer.alloc(CHUNK+127,0x61);
function createFakeStorage(){
 const objects=new Map(),pending=new Map();
 const calls={source:0,uploads:0,verified:0,deleted:0};
 const adapter={
  measurePrivateUsage:async()=>({
   ok:true,usageExact:true,verifiedPrivateBucket:true,
   usedBytes:[...objects.values()].reduce((x,v)=>x+v.length,0),
   objectCount:objects.size
  }),
  headVerifiedChunk:async({key,expectedBytes})=>{
   const value=objects.get(key);
   if(!value)return {ok:false,status:'missing'};
   return value.length===expectedBytes?
    {ok:true,status:'present_size_match',bytes:value.length}:
    {ok:false,status:'size_mismatch',bytes:value.length};
  },
  begin:async({key,private:priv})=>{
   assert.equal(priv,true);calls.uploads++;
   return {uploadId:'ci-upload'};
  },
  part:async({key,body})=>{
   pending.set(key,Buffer.from(body));return {etag:'"ci-s3-part"'}
  },
  complete:async({key})=>{
   const value=pending.get(key);
   assert.ok(value);
   objects.set(key,value);pending.delete(key);
  },
  abort:async({key})=>{pending.delete(key)},
  remove:async({key})=>{calls.deleted++;objects.delete(key)},
  verify:async({key,expectedBytes,expectedSha256})=>{
   calls.verified++;
   const value=objects.get(key);
   const digest=value?SHA(value):'';
   return {ok:Boolean(value)&&value.length===expectedBytes&&
    digest===expectedSha256,
    bytes:value?.length||0,sha256:digest};
  },
  readVerifiedRange:async({key,from,to,expectedBytes})=>{
   const value=objects.get(key);
   assert.ok(value);assert.equal(value.length,expectedBytes);
   return Readable.from([value.subarray(from,to+1)]);
  }
 };
 const readRange=async({from,to})=>{
  calls.source++;
  const piece=data.subarray(from,to+1);
  return new Response(piece,{status:206,headers:{
   'content-range':'bytes '+from+'-'+to+'/'+data.length,
   'content-length':String(piece.length),
   'etag':'"synthetic-ci-version"'
  }});
 };
 return {adapter,calls,objects,readRange};
}

test('real disposable PostgreSQL: crash-safe owner mirror checkpoints, SHA and mirror-only history',{
 skip:!process.env.BLOFY_TEST_PG_URL
},async()=>{
 const url=process.env.BLOFY_TEST_PG_URL;
 const pool=new Pool({connectionString:url});
 const lease=createSourceLease({connectionString:url,
  applicationName:'blofy-mirror-pg-ci'});
 const storage=createFakeStorage();
 const startedAt=Date.now();
 const permissionHash=SHA('explicit-synthetic-ci-fixture-only');
 const approval={
  ok:true,code:'mirror_approval_exact_item',
  permissionScope:'licensed-private-vod-copy',
  sourceName:'saleh',sourceId:SOURCE,
  kind:'movie',id:runSource.id,mediaId:runSource.id,
  gatewayId:7777,extension:'mkv',expectedBytes:data.length,
  validatorSha256:VERSION,rightsEvidenceHash:permissionHash,
  validatorPresent:true,approvedAt:startedAt
 };
 const approvalLoader=async()=>({...approval});
 const invoke=async selectedLease=>runMirrorTransferChunk({
  ...runSource,env:ENV,lease:selectedLease,
  storage:storage.adapter,approvalLoader,
  readRange:storage.readRange,now:()=>startedAt,
  logger:()=>{}
 });
 let runId=null;
 try{
  // No remote S3, upstream host, Railway or user/subscriber is contacted.
  const unsafe={...lease,
   recordChunk:async(...args)=>{
    // A real committed PG write followed by a deliberately lost ACK.
    await lease.recordChunk(...args);
    throw Error('synthetic_lost_pg_ack');
   }
  };
  const first=await invoke(unsafe);
  assert.equal(first.ok,false);
  assert.equal(first.code,'mirror_checkpoint_commit_uncertain');
  assert.equal(first.objectRetainedForReconciliation,true);
  assert.equal(storage.calls.source,1);
  assert.equal(storage.calls.uploads,1);
  assert.equal(storage.objects.size,1);
  assert.equal(storage.calls.deleted,0);
  const afterFirst=await lease.listMirrorRuns({limit:24});
  const pending=afterFirst.find(row=>row.kind==='movie'||
   row.mediaKind==='movie');
  assert.ok(pending);
  runId=pending.runId;
  assert.match(runId,/^mirror_[a-f0-9]{32}$/);
  assert.equal(pending.state,'staged');
  assert.equal(pending.bytesCopied,CHUNK);
  const raw=await pool.query([
   'SELECT validator,parts FROM blofy_content_hub_chunk_runs',
   'WHERE run_id=$1'
  ].join(' '),[runId]);
  assert.equal(raw.rows[0].validator,VERSION);
  assert.equal(JSON.stringify(raw.rows[0]).includes('synthetic-ci-version'),false);
  assert.equal(raw.rows[0].parts.length,1);
  // A second run resumes at the next exact 8 MiB boundary.
  const completed=await invoke(lease);
  assert.equal(completed.ok,true);
  assert.equal(completed.completed,true);
  assert.equal(completed.code,'mirror_worker_fully_verified');
  assert.equal(completed.verifiedSha256,SHA(data));
  assert.equal(completed.bytesCopied,CHUNK+127);
  assert.equal(storage.calls.source,2);
  assert.equal(storage.calls.uploads,2);
  assert.equal(storage.objects.size,2);
  assert.equal(storage.calls.deleted,0);
  const manifest=await lease.getVerifiedChunkedObject(runId);
  assert.ok(manifest);
  assert.equal(manifest.bytes,data.length);
  assert.equal(manifest.parts.length,2);
  assert.equal(manifest.sha256,SHA(data));
  const history=await lease.listMirrorRuns({limit:24});
  assert.equal(history.find(row=>row.runId===runId).state,'verified');
  // A confirmed run does not call the source or S3 a second time.
  const again=await invoke(lease);
  assert.equal(again.ok,true);
  assert.equal(again.code,'mirror_worker_already_verified');
  assert.equal(storage.calls.source,2);
  assert.equal(storage.calls.uploads,2);
 }finally{
  if(runId){
   await pool.query('DELETE FROM blofy_content_hub_chunk_runs WHERE run_id=$1',
    [runId]);
  }
  await lease.close();await pool.end();
 }
});
