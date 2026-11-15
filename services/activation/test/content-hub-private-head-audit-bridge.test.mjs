import test from 'node:test';
import assert from 'node:assert/strict';
import {forwardStreamS3HeadAudit} from '../src/content-hub-private-head-audit-bridge.mjs';
const SOURCE='123e4567-e89b-42d3-a456-426614174000';
const TOKEN='P'.repeat(44),SHA='f'.repeat(64);
const example={ok:true,code:'private_head_batch_checked',
 sourceId:SOURCE,kind:'movie',id:'1349410',
 manifestSha256:SHA,originalFileBytes:2934023949,
 totalParts:350,partStart:0,partsChecked:8,matchedParts:8,
 failures:0,nextPartStart:8,
 checks:Array.from({length:8},(_,i)=>({
  partNumber:i+1,status:'present_size_match',sizeMatched:true})),
 entireFileHeadCheckedInThisRequest:false,
 contentSha256Recomputed:false,
 currentPhysicalS3ProofType:'HEAD_object_size_only',
 mediaBytesTransferred:0,providerRequests:0,automaticCopyStarted:false,
 customerCutover:false};
test('Portal accepts only bounded owner 8-S3-HEAD proof',async()=>{
 const calls=[];
 const r=await forwardStreamS3HeadAudit({
  sourceId:SOURCE,kind:'movie',id:'1349410',start:0,
  hubToken:TOKEN,fetchImpl:async(url,opts)=>{
   calls.push({url,opts});return Response.json(example)}});
 assert.equal(r.ok,true);
 assert.equal(r.matchedParts,8);
 assert.equal(r.nextPartStart,8);
 assert.equal(r.contentSha256Recomputed,false);
 assert.equal(r.entireFileHeadCheckedInThisRequest,false);
 assert.equal(r.mediaBytesTransferred,0);
 assert.equal(calls[0].url,
  'http://blofy-content-hub.railway.internal:3000/internal/mirror/physical-head-audit');
 assert.equal(calls[0].opts.headers.authorization,'Bearer '+TOKEN);
 assert.equal(calls[0].opts.headers['x-blofy-owner-action'],
  'private-verified-s3-head-audit');
 assert.deepEqual(JSON.parse(calls[0].opts.body),
  {sourceId:SOURCE,kind:'movie',id:'1349410',start:0});
});
test('Portal rejects inconsistent S3 size, duplicate proof or provider media claims',async()=>{
 for(const broken of [
  {...example,sourceId:'00000000-0000-4000-8000-000000000001'},
  {...example,partStart:8},
  {...example,providerRequests:1},
  {...example,mediaBytesTransferred:1},
  {...example,contentSha256Recomputed:true},
  {...example,checks:[example.checks[0],...example.checks.slice(0,7)]},
  {...example,checks:[{...example.checks[0],status:'missing'},
   ...example.checks.slice(1)]},
  {...example,nextPartStart:300}
 ]){
  const out=await forwardStreamS3HeadAudit({
   sourceId:SOURCE,kind:'movie',id:'1349410',start:0,
   hubToken:TOKEN,fetchImpl:async()=>Response.json(broken)});
  assert.equal(out.ok,false,'reject forged '+Object.keys(broken).length);
 }
});
test('Portal refuses untrusted IDs, multipart offsets and network failure',async()=>{
 let n=0;
 const fetchImpl=async()=>{n++;return Response.json(example)};
 for(const args of [
  {kind:'movie',id:'https://attacker.test'},
  {kind:'episode',id:'../../etc/passwd'},
  {kind:'movie',id:'1349410',start:7},
  {kind:'movie',id:'1349410',start:520}
 ]){
  const r=await forwardStreamS3HeadAudit({
    sourceId:SOURCE,hubToken:TOKEN,fetchImpl,...args});
  assert.equal(r.code,'stream_head_selection_invalid');
 }
 assert.equal(n,0);
 const offline=await forwardStreamS3HeadAudit({
  sourceId:SOURCE,kind:'movie',id:'1349410',start:0,
  hubToken:TOKEN,fetchImpl:async()=>{throw Error('network')},
 });
 assert.equal(offline.ok,false);
 assert.equal(offline.code,'stream_head_bridge_failed');
});
test('physical audit is protected behind owner flags on Hub and Portal',async()=>{
 const {readFile}=await import('node:fs/promises');
 const portal=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 const hub=await readFile(new URL('../../content-hub/src/server.mjs',import.meta.url),'utf8');
 assert.match(portal,/BLOFY_STREAM_MIRROR_PHYSICAL_HEAD_AUDIT_ENABLED/);
 assert.match(hub,/BLOFY_CONTENT_HUB_PHYSICAL_HEAD_AUDIT_ENABLED/);
 assert.match(hub,/BLOFY_CONTENT_HUB_STORAGE_RIGHTS_CONFIRMED/);
 assert.match(portal,/stream_head_catalog_item_unavailable/);
 assert.match(hub,/private-verified-s3-head-audit/);
});
