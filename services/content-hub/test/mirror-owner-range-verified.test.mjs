import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {readIntegrityCheckedMirrorRange} from '../src/mirror-owner-range-verified.mjs';

const CHUNK=8*1024*1024;
const A=Buffer.alloc(CHUNK,0x23),B=Buffer.from('synthetic-tail-bytes');
const uuid='123e4567-e89b-42d3-a456-426614174000';
const key=(kind,num)=>'saleh/'+kind+'/'+uuid+
 '/batch_000000000000000000000001_part_'+String(num).padStart(6,'0')+'.mp4';
const digest=b=>createHash('sha256').update(b).digest('hex');
const saved=kind=>({
 kind:'chunked',bytes:A.length+B.length,extension:'mp4',
 parts:[{key:key(kind,1),bytes:A.length,sha256:digest(A)},
  {key:key(kind,2),bytes:B.length,sha256:digest(B)}]
});
function adapter({modify=null}={}){
 const calls=[];
 const obj={ [key('movie',1)]:A,[key('movie',2)]:B,
  [key('episode',1)]:A,[key('episode',2)]:B};
 return {calls,readVerifiedRange:async args=>{
  calls.push(args);
  const data=Buffer.from(obj[args.key].subarray(args.from,args.to+1));
  if(modify)modify(data,args);
  return Readable.from([data]);
 }};
}
test('private mirror cross-part range verifies complete part sha before releasing 206 bytes',async()=>{
 for(const kind of ['movie','episode']){
  const storage=adapter();
  const from=CHUNK-9,to=CHUNK+9;
  const result=await readIntegrityCheckedMirrorRange({
   storage,saved:saved(kind),mediaKind:kind,from,to
  });
  assert.equal(result.partsVerified,2);
  assert.deepEqual(result.bytes,
   Buffer.concat([A,B]).subarray(from,to+1));
  assert.equal(storage.calls.length,2);
  assert.equal(storage.calls[0].from,0);
  assert.equal(storage.calls[0].to,CHUNK-1);
  assert.equal(result.sourceRequests,0);
  assert.equal(result.customerCutover,false);
 }
});
test('corrupt part outside requested subspan is rejected before any bytes delivered',async()=>{
 const storage=adapter({modify:(bytes,args)=>{
  if(args.key===key('movie',1))bytes[2]^=0xff;
 }});
 await assert.rejects(readIntegrityCheckedMirrorRange({
  storage,saved:saved('movie'),mediaKind:'movie',
  from:CHUNK-50,to:CHUNK-12
 }),/mirror_private_sha256_mismatch/);
 assert.equal(storage.calls.length,1);
});
test('missing/truncated S3 part never returns even a partial response',async()=>{
 const storage=adapter({modify:(bytes,args)=>{
  if(args.key===key('episode',1))bytes[100]=0;
 }});
 await assert.rejects(readIntegrityCheckedMirrorRange({
  storage,saved:saved('episode'),mediaKind:'episode',
  from:CHUNK-2,to:CHUNK+1
 }),/mirror_private_sha256_mismatch/);
});
test('invalid key/type/sha/total/scope fail without storage requests',async()=>{
 const storage=adapter();
 for(const args of [
  {saved:{...saved('movie'),parts:[
   {...saved('movie').parts[0],sha256:'bad'},saved('movie').parts[1]]
  },mediaKind:'movie',from:0,to:1},
  {saved:saved('movie'),mediaKind:'episode',from:0,to:1},
  {saved:saved('movie'),mediaKind:'movie',from:-1,to:0},
  {saved:saved('movie'),mediaKind:'movie',from:0,to:CHUNK},
 ]){
  await assert.rejects(readIntegrityCheckedMirrorRange({
   storage,...args
  }));
 }
 assert.equal(storage.calls.length,0);
});
