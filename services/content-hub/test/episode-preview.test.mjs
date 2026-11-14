import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {createContentHubServer} from '../src/server.mjs';
import {buildPrivateBrowserPreview} from '../src/private-preview.mjs';

const secret='S'.repeat(40),id='saleh_episode_verified_127434';
const buf=Buffer.alloc(8*1024*1024,41);
const manifest={kind:'chunked',mediaKind:'episode',extension:'mkv',
 bytes:buf.length,sha256:'a'.repeat(64),
 parts:[{partNumber:1,key:'private_ep_1',bytes:buf.length,
 sha256:createHash('sha256').update(buf).digest('hex')}]};
test('episode browser preview requires independent flag and verified manifest',async()=>{
 let builds=0;
 const hub=createContentHubServer({token:secret,storage:{},lease:{},
  pilotEnv:{BLOFY_CONTENT_HUB_OWNER_PREVIEW_ENABLED:'1',
   BLOFY_CONTENT_HUB_EPISODE_RUN_ID:id},
  previewBuilder:async()=>{builds++;return {
    ok:true,bytes:Buffer.concat([Buffer.alloc(4),Buffer.from('ftyp'),
      Buffer.alloc(3100)])
  }}});
 hub.server.listen(0,'127.0.0.1');
 try{
  await new Promise(resolve=>hub.server.once('listening',resolve));
  const url='http://127.0.0.1:'+hub.server.address().port+
    '/internal/episodes/playback/preview';
  assert.equal((await fetch(url)).status,401);
  const auth={authorization:'Bearer '+secret};
  assert.equal((await fetch(url,{headers:auth})).status,403);
  assert.equal((await fetch(url,{headers:{...auth,
   'x-blofy-owner-preview':'operator-only'}})).status,403);
  const r=await fetch(url,{headers:{...auth,
   'x-blofy-owner-preview':'operator-episode-only'}});
  assert.equal(r.status,409);
  assert.equal((await r.json()).code,'owner_preview_disabled');
  assert.equal(builds,0);
 }finally{await new Promise(resolve=>hub.server.close(resolve))}
});
test('only verified episode manifest produces a 12s H264/AAC preview from private S3',async()=>{
 let reads=0,encoded=0;
 const lease={
  getVerifiedEpisodeObject:async key=>key===id?manifest:null,
  getVerifiedChunkedObject:async()=>{throw Error('must not read film')}
 };
 const storage={readVerifiedRange:async()=>{
  reads++;return Readable.from([buf])
 }};
 const data=await buildPrivateBrowserPreview({runId:id,mediaKind:'episode',
  lease,storage,transcoder:async({input,output,mediaKind})=>{
   encoded++;assert.equal(mediaKind,'episode');
   const {stat,writeFile}=await import('node:fs/promises');
   assert.equal((await stat(input)).size,buf.length);
   await writeFile(output,Buffer.concat([Buffer.alloc(4),
    Buffer.from('ftyp'),Buffer.alloc(3100)]));
  }});
 assert.equal(data.ok,true,data.code);
 assert.equal(data.providerRequests,0);
 assert.equal(data.customerCutover,false);
 assert.equal(reads,1);
 assert.equal(encoded,1);
});
test('incomplete episode cannot be previewed or read from S3',async()=>{
 let reads=0;
 const result=await buildPrivateBrowserPreview({
  runId:id,mediaKind:'episode',
  lease:{getVerifiedEpisodeObject:async()=>null},
  storage:{readVerifiedRange:async()=>{reads++}}
 });
 assert.equal(result.ok,false);
 assert.equal(result.code,'private_preview_movie_not_verified');
 assert.equal(reads,0);
});
