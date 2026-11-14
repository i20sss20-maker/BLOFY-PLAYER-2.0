import test from 'node:test';
import assert from 'node:assert/strict';
import {createContentHubServer} from '../src/server.mjs';
const token='T'.repeat(42),filename='approved_private_movie_001';
async function withServer(callback){
 let builds=0;
 const buf=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftyp'),
  Buffer.alloc(3000,0x61)]);
 const hub=createContentHubServer({
  token,storage:{},lease:{},
  pilotEnv:{BLOFY_CONTENT_HUB_OWNER_PREVIEW_ENABLED:'1',
   BLOFY_CONTENT_HUB_BATCH_RUN_ID:filename},
  previewBuilder:async()=>{
   builds++;
   return {ok:true,code:'private_preview_ready',
    bytes:buf,mediaType:'video/mp4',providerRequests:0,
    customerCutover:false};
  }
 });
 hub.server.listen(0,'127.0.0.1');
 await new Promise(resolve=>hub.server.once('listening',resolve));
 const url='http://127.0.0.1:'+hub.server.address().port+
  '/internal/playback/preview';
 try{return await callback({url,buf,builds:()=>builds})}
 finally{await new Promise(resolve=>hub.server.close(resolve))}
}
test('short movie preview requires owner bearer AND private header',async()=>{
 await withServer(async({url,builds})=>{
  const without=await fetch(url);
  assert.equal(without.status,401);
  const bearer=await fetch(url,{headers:{authorization:'Bearer '+token}});
  assert.equal(bearer.status,403);
  const wrong=await fetch(url,{headers:{authorization:'Bearer '+token,
   'x-blofy-owner-preview':'public'}});
  assert.equal(wrong.status,403);
  assert.equal(builds(),0);
 });
});
test('owner private MP4 preview is capped, uncached to browser and reused in memory',async()=>{
 await withServer(async({url,buf,builds})=>{
  const headers={authorization:'Bearer '+token,
   'x-blofy-owner-preview':'operator-only'};
  const first=await fetch(url,{headers});
  assert.equal(first.status,200);
  assert.equal(first.headers.get('content-type'),'video/mp4');
  assert.equal(first.headers.get('cross-origin-resource-policy'),'same-origin');
  assert.equal(first.headers.get('cache-control'),'private,no-store');
  assert.equal(Number(first.headers.get('content-length')),buf.length);
  assert.deepEqual(Buffer.from(await first.arrayBuffer()),buf);
  const second=await fetch(url,{headers});
  assert.equal(second.status,200);
  assert.equal(builds(),1);
  await second.body.cancel();
  const invalid=await fetch(url+'?ticket=secret',{headers});
  assert.equal(invalid.status,403);
 });
});
test('without preview entitlement, no media bytes leak',async()=>{
 const hub=createContentHubServer({token,storage:{},lease:{},
  pilotEnv:{BLOFY_CONTENT_HUB_BATCH_RUN_ID:filename}});
 hub.server.listen(0,'127.0.0.1');
 try{
  await new Promise(resolve=>hub.server.once('listening',resolve));
  const r=await fetch('http://127.0.0.1:'+hub.server.address().port+
   '/internal/playback/preview',{headers:{authorization:'Bearer '+token,
     'x-blofy-owner-preview':'operator-only'}});
  assert.equal(r.status,409);
  const body=await r.json();
  assert.equal(body.code,'owner_preview_disabled');
 }finally{await new Promise(resolve=>hub.server.close(resolve))}
});
