import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createContentHubServer} from '../src/server.mjs';

const token='T'.repeat(40);
const mirror='mirror_'+'a'.repeat(40);
const legacy='pilot_older_verified_123';
const origin='123e4567-e89b-42d3-a456-426614174000';
const partKey='saleh/movie/'+origin+
 '/batch_'+'b'.repeat(24)+'_part_000001.mp4';

test('owner mirror movie Range MUST use private reviewed chunk manifest even when a pilot run has same ID',async()=>{
 let pilot=0,chunked=0,reads=0;
 const lease={
  getVerifiedPilotObject:async()=>{pilot++;return {
   key:'saleh/movie/'+origin+'/old_pilot.mp4',bytes:16
  }},
  getVerifiedChunkedObject:async id=>{
   chunked++;assert.equal(id,mirror);
   return {kind:'chunked',mediaKind:'movie',sourceId:origin,
    mediaId:'movie_12',gatewayId:12,extension:'mp4',
    sha256:'a'.repeat(64),bytes:16,
    parts:[{key:partKey,partNumber:1,bytes:16,
     sha256:'a'.repeat(64)}]};
  }
 };
 const storage={readVerifiedRange:async args=>{
  reads++;assert.equal(args.key,partKey);
  assert.equal(args.expectedBytes,16);
  return Readable.from([Buffer.from('ABCD')]);
 }};
 const hub=createContentHubServer({token,lease,storage});
 await new Promise(resolve=>hub.server.listen(0,'127.0.0.1',resolve));
 try{
  const url='http://127.0.0.1:'+hub.server.address().port+
   '/internal/pilot/playback/'+mirror;
  const headers={authorization:'Bearer '+token,range:'bytes=0-3'};
  const response=await fetch(url,{headers});
  assert.equal(response.status,206);
  assert.equal(response.headers.get('content-range'),'bytes 0-3/16');
  assert.equal(response.headers.get('content-type'),'video/mp4');
  assert.equal(await response.text(),'ABCD');
  assert.equal(pilot,0,'legacy file must never shadow mirror');
  assert.equal(chunked,1);
  assert.equal(reads,1);
 }finally{await new Promise(resolve=>hub.server.close(resolve))}
});

test('owner mirror movie cannot fall back to same-ID pilot if verified S3 manifest is absent',async()=>{
 let pilot=0;
 const lease={
  getVerifiedPilotObject:async()=>{pilot++;return {
   key:'old_pilot.mp4',bytes:16
  }},
  getVerifiedChunkedObject:async()=>null
 };
 const hub=createContentHubServer({token,lease,storage:{}});
 await new Promise(resolve=>hub.server.listen(0,'127.0.0.1',resolve));
 try{
  const url='http://127.0.0.1:'+hub.server.address().port+
   '/internal/pilot/playback/'+mirror;
  const response=await fetch(url,{method:'HEAD',headers:{
   authorization:'Bearer '+token}});
  assert.equal(response.status,404);
  assert.equal(pilot,0);
 }finally{await new Promise(resolve=>hub.server.close(resolve))}
});

test('previously verified standalone pilot playback remains available for legacy non-mirror runs',async()=>{
 let pilot=0,chunked=0;
 const lease={
  getVerifiedPilotObject:async id=>{pilot++;assert.equal(id,legacy);
   return {key:'saleh/movie/'+origin+'/pilot.mp4',bytes:16}},
  getVerifiedChunkedObject:async()=>{chunked++;return null}
 };
 const hub=createContentHubServer({token,lease,storage:{}});
 await new Promise(resolve=>hub.server.listen(0,'127.0.0.1',resolve));
 try{
  const url='http://127.0.0.1:'+hub.server.address().port+
   '/internal/pilot/playback/'+legacy;
  assert.equal((await fetch(url,{method:'HEAD',headers:{
   authorization:'Bearer '+token}})).status,200);
  assert.equal(pilot,1);
  assert.equal(chunked,0);
 }finally{await new Promise(resolve=>hub.server.close(resolve))}
});
