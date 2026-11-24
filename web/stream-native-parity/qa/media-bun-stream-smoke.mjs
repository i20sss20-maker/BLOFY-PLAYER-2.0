/* This integration test runs under real Bun (not Node Blob stubs).
 * Verify file-backed MPEG-TS responses survive several concurrent viewers
 * with independent response bodies and no eager Buffer-based route content.
 * All media bytes are synthetic. No Xtream host or real account is used.
 */
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {streamMediaFile} from '../stream-media-file.mjs';

const dir=mkdtempSync(join(tmpdir(),'blofy-media-stream-smoke-'));
const path=join(dir,'seg-000012.ts');
const length=188*14000,packet=Buffer.alloc(length);
for(let i=0;i<length;i+=188){packet[i]=0x47;packet[i+1]=(i/188)%256}
writeFileSync(path,packet);
let served=0;
const http=Bun.serve({port:0,hostname:'127.0.0.1',fetch:async req=>{
 if(new URL(req.url).pathname!=='/seg')return new Response('not found',{status:404});
 served++;
 const response=await streamMediaFile(path,'video/mp2t','no-store, private');
 return response||new Response('segment unavailable',{status:503})
}});
try{
 const url='http://127.0.0.1:'+http.port+'/seg';
 const connections=8;
 const answers=await Promise.all(Array.from({length:connections},()=>fetch(url)));
 const payloads=await Promise.all(answers.map(res=>res.arrayBuffer()));
 assert.equal(served,connections,'separate viewers receive individual read streams');
 for(let i=0;i<answers.length;i++){
  assert.equal(answers[i].status,200);
  assert.equal(answers[i].headers.get('content-type'),'video/mp2t');
  assert.equal(answers[i].headers.get('cache-control'),'no-store, private');
  const bytes=new Uint8Array(payloads[i]);
  assert.equal(bytes.length,length);
  for(const off of [0,188,188*1000,188*13999]){
   assert.equal(bytes[off],0x47,'transport sync byte at packet boundary');
   assert.equal(bytes[off+1],(off/188)%256)
  }
 }
 const missing=await streamMediaFile(join(dir,'deleted.ts'),'video/mp2t','no-store, private');
 assert.equal(missing,null);
 console.log('BLOFY_SYNTHETIC_STREAMING_SMOKE_OK',JSON.stringify({
  requests:connections,totalBytes:length*connections,missingFileRejected:true
 }));
}finally{
 http.stop(true);
 rmSync(dir,{recursive:true,force:true})
}
