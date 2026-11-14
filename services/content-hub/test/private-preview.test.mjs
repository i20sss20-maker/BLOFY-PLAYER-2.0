import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFile,access} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {buildPrivateBrowserPreview} from '../src/private-preview.mjs';

function fixture(verified=true){
 const buf=Buffer.alloc(8*1024*1024,0x42),
       sha256=createHash('sha256').update(buf).digest('hex');
 let reads=0,encodeCalls=0;
 const lease={getVerifiedChunkedObject:async()=>verified?{
  kind:'chunked',extension:'mkv',bytes:buf.length,
  sha256:'b'.repeat(64),parts:[{
   partNumber:1,key:'fake-private-storage-part',
   bytes:buf.length,sha256
  }]}:null};
 const storage={readVerifiedRange:async args=>{
  reads++;assert.equal(args.key,'fake-private-storage-part');
  return Readable.from([buf])}};
 const transcoder=async({input,output})=>{
  encodeCalls++;
  await access(input);
  await writeFile(output,Buffer.concat([
   Buffer.from([0,0,0,24]),Buffer.from('ftyp'),
   Buffer.alloc(2500,0x43)
  ]));
 };
 return {lease,storage,transcoder,
  getReads:()=>reads,getEncodes:()=>encodeCalls};
}
test('verified S3 movie creates a bounded owner-only MP4 preview',async()=>{
 const f=fixture();
 const result=await buildPrivateBrowserPreview({runId:'approved_movie_001',...f});
 assert.equal(result.ok,true,result.code);
 assert.equal(result.mediaType,'video/mp4');
 assert.equal(result.bytes.subarray(4,8).toString('ascii'),'ftyp');
 assert.equal(result.durationSeconds,12);
 assert.equal(result.sourceSampleBytes,8*1024*1024);
 assert.equal(result.providerRequests,0);
 assert.equal(result.customerCutover,false);
 assert.equal(f.getReads(),1);
 assert.equal(f.getEncodes(),1);
});
test('unverified movie cannot be read or previewed',async()=>{
 const f=fixture(false);
 const result=await buildPrivateBrowserPreview({runId:'approved_movie_001',...f});
 assert.equal(result.ok,false);
 assert.equal(result.code,'private_preview_movie_not_verified');
 assert.equal(f.getReads(),0);
 assert.equal(f.getEncodes(),0);
});
test('preview rejects outputs above 12 MiB',async()=>{
 const f=fixture();
 f.transcoder=async({output})=>{
  await writeFile(output,Buffer.alloc(12*1024*1024+1));
 };
 const result=await buildPrivateBrowserPreview({runId:'approved_movie_001',...f});
 assert.equal(result.ok,false);
 assert.equal(result.code,'private_preview_output_size_invalid');
});
test('corrupt S3 data fails verification before ffmpeg runs',async()=>{
 const f=fixture();
 f.storage.readVerifiedRange=async()=>Readable.from([
  Buffer.alloc(8*1024*1024,0x99)
 ]);
 const result=await buildPrivateBrowserPreview({runId:'approved_movie_001',...f});
 assert.equal(result.ok,false);
 assert.equal(result.code,'private_preview_encode_failed');
 assert.equal(f.getEncodes(),0);
});
