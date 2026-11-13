import test from 'node:test';
import assert from 'node:assert/strict';
import {runOneMoviePilot} from '../src/one-movie-pilot.mjs';

test('one-movie pilot is off by default and does not request upstream media',async()=>{
 let operations=0;
 const result=await runOneMoviePilot({
  env:{},fetchImpl:async()=>{operations++;throw Error('unexpected network')},
  storage:{health:async()=>{operations++;return {ok:true}}},
  lease:{claimPilotRun:async()=>{operations++;return true}}
 });
 assert.equal(result.ok,false);
 assert.equal(result.code,'pilot_not_enabled');
 assert.equal(operations,0);
});
test('operator enables all independent safety and per-run controls',async()=>{
 let operations=0;
 const env={
  BLOFY_CONTENT_HUB_ONE_MOVIE_ON_BOOT:'1',
  BLOFY_CONTENT_HUB_UPLOAD_ENABLED:'1',
  BLOFY_CONTENT_HUB_STORAGE_RIGHTS_CONFIRMED:'1',
  BLOFY_CONTENT_HUB_SOURCE_QUIET_WINDOW_CONFIRMED:'1',
  BLOFY_CONTENT_HUB_SOURCE_IDLE_CONFIRMED:'1'
 };
 const result=await runOneMoviePilot({
  env,fetchImpl:async()=>{operations++},
  storage:{health:async()=>{operations++}},
  lease:{claimPilotRun:async()=>{operations++}}
 });
 assert.equal(result.ok,false);
 assert.equal(result.code,'pilot_operator_configuration_missing');
 assert.equal(operations,0);
});


test('one licensed movie is copied in sequential private ranges, then verified',async()=>{
 const {createHash}=await import('node:crypto');
 const {MIN_PART_BYTES}=await import('../src/mirror-policy.mjs');
 const size=MIN_PART_BYTES*2;
 const safeRun={
  BLOFY_CONTENT_HUB_ONE_MOVIE_ON_BOOT:'1',
  BLOFY_CONTENT_HUB_UPLOAD_ENABLED:'1',
  BLOFY_CONTENT_HUB_STORAGE_RIGHTS_CONFIRMED:'1',
  BLOFY_CONTENT_HUB_SOURCE_QUIET_WINDOW_CONFIRMED:'1',
  BLOFY_CONTENT_HUB_SOURCE_IDLE_CONFIRMED:'1',
  BLOFY_CONTENT_HUB_PILOT_RUN_ID:'unit_pilot_001',
  BLOFY_CONTENT_HUB_BRIDGE_TOKEN:'x'.repeat(40),
  BLOFY_CONTENT_HUB_EXPECTED_BYTES:String(size),
  BLOFY_CONTENT_HUB_APPROVED_GATEWAY_ID:'123'
 };
 const counts={reads:0,parts:0,claims:0,finishes:0,aborts:0};
 const chunks=[];
 const storage={
  health:async()=>({ok:true}),
  begin:async()=>({uploadId:'upload-0001'}),
  part:async({partNumber,body})=>{
   counts.parts++;chunks[partNumber-1]=Buffer.from(body);
   return {etag:'part-'+partNumber};
  },
  complete:async()=>({ok:true}),
  abort:async()=>{counts.aborts++},
  remove:async()=>{throw Error('unexpected removal')},
  verify:async({expectedBytes,expectedSha256})=>{
   const bytes=Buffer.concat(chunks);
   const sha256=createHash('sha256').update(bytes).digest('hex');
   return {ok:bytes.length===expectedBytes&&sha256===expectedSha256,
    bytes:bytes.length,sha256};
  }
 };
 const lease={
  claimPilotRun:async()=>{counts.claims++;return counts.claims===1},
  finishPilotRun:async()=>{counts.finishes++},
  acquire:async()=>({release:async()=>{}})
 };
 const fetchImpl=async(url,init)=>{
  if(url.endsWith('/describe'))return Response.json({
   sourceName:'saleh',mediaKind:'movie',
   sourceId:'9adc6472-5d4e-4359-83e4-0298cc038ae3',
   mediaId:'314',gatewayId:123,extension:'mkv'
  });
  counts.reads++;
  const match=/^bytes=(\\d+)-(\\d+)$/.exec(init.headers.range);
  assert.ok(match);
  const from=Number(match[1]),to=Number(match[2]);
  const length=to-from+1;
  return new Response(Buffer.alloc(length,80+counts.reads),{
   status:206,headers:{
    'content-range':`bytes ${from}-${to}/${size}`,
    'content-length':String(length),'etag':'"same-version"'
   }
  });
 };
 const outcome=await runOneMoviePilot({env:safeRun,storage,lease,fetchImpl});
 assert.equal(outcome.ok,true,JSON.stringify(outcome));
 assert.equal(outcome.stored,true);
 assert.equal(outcome.customerCutover,false);
 assert.equal(outcome.bytes,size);
 assert.equal(counts.reads,2);
 assert.equal(counts.parts,2);
 assert.equal(counts.aborts,0);
 assert.equal(counts.finishes,1);
 const replay=await runOneMoviePilot({env:safeRun,storage,lease,fetchImpl});
 assert.equal(replay.code,'pilot_run_already_claimed');
 assert.equal(counts.reads,2);
});
