import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {createEngineTsCompatibility} from '../src/blofy-engine-ts-compat.mjs';
const g='a'.repeat(32);
const name=n=>'seg-'+String(n).padStart(9,'0')+'.ts';
const manifest=ns=>'#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n'+ns.map(n=>'#EXTINF:2,\n'+name(n)+'\n').join('');
test('legacy TS response follows HLS window without duplicate segments or switching generations',async()=>{
 let manifests=0,parts=[];
 const deliver=createEngineTsCompatibility({enabled:true,pause:async()=>{},fetchPart:async({name:n})=>{
  if(n==='index.m3u8'){
   manifests++;
   const response=new Response(manifest(manifests===1?[0,1,2]:[1,2,3]));
   return Object.assign(response,{generation:manifests>=3?'b'.repeat(32):g});
  }
  parts.push(n);
  const payload=Buffer.alloc(188,Number(n.slice(4,-3)));payload[0]=0x47;
  return Object.assign(new Response(payload,{headers:{'content-type':'video/mp2t','content-length':'188'}}),{generation:g});
 }});
 const server=http.createServer((req,res)=>void deliver(req,res,{generation:g}));
 server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
  await new Promise((resolve,reject)=>{
   const req=http.get('http://127.0.0.1:'+server.address().port,res=>{
    assert.equal(res.headers['content-type'],'video/mp2t');
    res.on('data',()=>{});res.on('aborted',resolve);res.on('end',resolve);res.on('error',resolve);
   });
   req.setTimeout(3000,()=>{req.destroy();reject(Error('timeout'))});req.on('error',reject);
  });
  assert.deepEqual(parts,[0,1,2,3].map(name));
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r))}
});
test('disabled adapter never opens any worker request',async()=>{
 let calls=0;
 const deliver=createEngineTsCompatibility({fetchPart:async()=>{calls++}});
 assert.equal(await deliver({method:'GET'},{},{generation:g}),false);
 assert.equal(calls,0);
});
