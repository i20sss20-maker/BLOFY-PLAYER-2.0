import test from 'node:test';
import assert from 'node:assert/strict';
import {readMirrorFileSize206,probeOneAttestedMirrorItem,
 mirrorSizeProbeEnabled} from '../src/xtream-mirror-size-probe.mjs';

const ID='123e4567-e89b-42d3-a456-426614174000';
const sample={source_id:ID,media_kind:'movie',
 gateway_id:123,media_id:'movie_123',extension:'mp4'};
const fileSize=16*1024*1024;
function result({status=206,total=fileSize,length=4096,etag='"v1"'}={}){
 return new Response(new Uint8Array(4096),{
  status,headers:{'content-range':`bytes 0-4095/${total}`,
    'content-length':String(length),'etag':etag}
 });
}
function fakeDb({candidate=sample}={}){
 const calls=[],locks=[];
 const client={async query(sql,args=[]){
   calls.push({sql,args});
   if(sql.includes('pg_try_advisory_lock')){
    locks.push('acquire');return {rows:[{held:true}]}
   }
   if(sql.includes('pg_advisory_unlock')){
    locks.push('release');return {rows:[]}
   }
   if(sql.includes('FROM blofy_xtream_mirror_items q')){
    return {rows:candidate?[candidate]:[]}
   }
   if(sql.includes('UPDATE blofy_xtream_mirror_items')){
    return {rowCount:1,rows:[{gateway_id:123}]}
   }
   throw Error('unexpected SQL: '+sql.slice(0,130));
 },release(){}};
 return {db:{connect:async()=>client},calls,locks};
}

test('size preflight disabled by default and bound to configured source',()=>{
 assert.equal(mirrorSizeProbeEnabled({}),false);
 assert.equal(mirrorSizeProbeEnabled({
  BLOFY_XTREAM_MIRROR_SIZE_PROBE_ENABLED:'1',
  BLOFY_XTREAM_DAILY_CATALOG_SOURCE_ID:'wrong'
 }),false);
 assert.equal(mirrorSizeProbeEnabled({
  BLOFY_XTREAM_MIRROR_SIZE_PROBE_ENABLED:'1',
  BLOFY_XTREAM_DAILY_CATALOG_SOURCE_ID:ID
 }),true);
});

test('exact 4 KiB range validates file size but never copies video file',async()=>{
 const proof=await readMirrorFileSize206(async()=>result());
 assert.equal(proof.ok,true);
 assert.equal(proof.expectedBytes,fileSize);
 assert.equal(proof.probeBytes,4096);
 assert.match(proof.sourceValidatorSha256,/^[a-f0-9]{64}$/);
 assert.equal(proof.stored,false);
 assert.equal(proof.copyStarted,false);
});

test('range ignored, source size mismatch or invalid range body fails closed',async()=>{
 const scenarios=[
  {status:200},{total:12345},{total:5*1024**3},
  {length:4095}
 ];
 for(const opts of scenarios){
  const response=await readMirrorFileSize206(async()=>result(opts));
  assert.equal(response.ok,false);
 }
 const noBody=await readMirrorFileSize206(async()=>null);
 assert.equal(noBody.ok,false);
});

test('probe one rights-reviewed item, commit server-derived size only',async()=>{
 const f=fakeDb(),proof=await probeOneAttestedMirrorItem({
  db:f.db,sourceId:ID,localDay:'2026-11-14',
  resolveSourceMedia:async item=>{
   assert.equal(item.mediaId,'movie_123');
   return {ok:true,fetchOneRange:async()=>result()};
  }
 });
 assert.equal(proof.ok,true);
 assert.equal(proof.code,'mirror_size_4k_range_probed');
 assert.equal(proof.expectedBytes,fileSize);
 assert.equal(proof.providerRequests,1);
 assert.equal(proof.mediaBytesTransferred,0);
 const updated=f.calls.find(x=>x.sql.includes('SET\n    expected_bytes'));
 assert.equal(updated.args[5],fileSize);
 assert.match(updated.sql,/rights_ref_sha256/);
 assert.deepEqual(f.locks,['acquire','release']);
});

test('changed gateway mapping cannot be approved or probed',async()=>{
 const f=fakeDb();
 const proof=await probeOneAttestedMirrorItem({
  db:f.db,sourceId:ID,localDay:'2026-11-14',
  resolveSourceMedia:async()=>({ok:false})
 });
 assert.equal(proof.code,'mirror_size_source_mapping_changed');
 assert.equal(proof.providerRequests,0);
 assert.ok(f.calls.some(x=>x.sql.includes('mapping_conflict=TRUE')));
});

test('no approved item means zero provider requests and zero transfer',async()=>{
 const f=fakeDb({candidate:null});
 const proof=await probeOneAttestedMirrorItem({
  db:f.db,sourceId:ID,localDay:'2026-11-14',
  resolveSourceMedia:()=>{throw Error('never')}
 });
 assert.equal(proof.providerRequests,0);
 assert.equal(proof.mediaBytesTransferred,0);
 await assert.rejects(()=>probeOneAttestedMirrorItem({
  db:f.db,sourceId:'bad',localDay:'2026-11-14',
  resolveSourceMedia:async()=>{}
 }),/mirror_size_scan_request_invalid/);
});
