import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {createContentHubServer} from '../src/server.mjs';
import {verifyPrivateSeekRanges} from '../src/seek-diagnostics.mjs';
import {diagnoseVerifiedMovie} from '../src/playback-diagnostics.mjs';

const chunk=8*1024*1024;
const token='Q'.repeat(40),episodeId='licensed_episode_run_001';
const blobs=[Buffer.alloc(chunk,65),Buffer.alloc(10240,66)];
const parts=blobs.map((bytes,i)=>({
  partNumber:i+1,key:'private_episode_chunk_'+i,bytes:bytes.length,
  sha256:createHash('sha256').update(bytes).digest('hex')
}));
const movie={
 kind:'chunked',mediaKind:'episode',extension:'mkv',
 bytes:blobs.reduce((sum,buf)=>sum+buf.length,0),
 sha256:createHash('sha256').update(Buffer.concat(blobs)).digest('hex'),
 parts
};
function fixture({verified=true}={}){
 let sourceRequests=0,objects=0;
 const storage={readVerifiedRange:async({key,from,to,expectedBytes})=>{
   objects++;const index=parts.findIndex(x=>x.key===key);
   assert.ok(index>=0);
   assert.equal(expectedBytes,blobs[index].length);
   return Readable.from([blobs[index].subarray(from,to+1)]);
 }};
 const lease={
  getVerifiedPilotObject:async()=>null,
  getVerifiedChunkedObject:async()=>null,
  getVerifiedEpisodeObject:async id=>verified&&id===episodeId?movie:null
 };
 return {storage,lease,
  sourceRequests:()=>sourceRequests,objectReads:()=>objects};
}
test('private verified episode has exact HEAD and four authenticated 206 seeks',async()=>{
 const f=fixture();
 const hub=createContentHubServer({token,storage:f.storage,lease:f.lease});
 hub.server.listen(0,'127.0.0.1');
 try{
  await new Promise(resolve=>hub.server.once('listening',resolve));
  const base='http://127.0.0.1:'+hub.server.address().port;
  const url=base+'/internal/episodes/playback/'+episodeId;
  assert.equal((await fetch(url,{method:'HEAD'})).status,401);
  assert.equal((await fetch(url.replace('/episodes/','/pilot/'),{
   method:'HEAD',headers:{authorization:'Bearer '+token}})).status,404);
  const result=await verifyPrivateSeekRanges({
   runId:episodeId,bytes:movie.bytes,
   port:hub.server.address().port,token,mediaKind:'episode'
  });
  assert.equal(result.ok,true,result.code);
  assert.equal(result.seeksVerified,4);
  assert.equal(result.unauthorizedDenied,true);
  assert.equal(result.providerRequests,0);
  assert.equal(result.customerCutover,false);
  assert.ok(f.objectReads()>=4);
  assert.equal(f.sourceRequests(),0);
 }finally{await new Promise(resolve=>hub.server.close(resolve))}
});
test('unverified episode is never exposed through private playback routes',async()=>{
 const f=fixture({verified:false});
 const hub=createContentHubServer({token,storage:f.storage,lease:f.lease,
   pilotEnv:{BLOFY_CONTENT_HUB_EPISODE_RUN_ID:episodeId}});
 hub.server.listen(0,'127.0.0.1');
 try{
  await new Promise(resolve=>hub.server.once('listening',resolve));
  const url='http://127.0.0.1:'+hub.server.address().port;
  const headers={authorization:'Bearer '+token};
  const r=await fetch(url+'/internal/episodes/playback/'+episodeId,{
   method:'HEAD',headers});
  assert.equal(r.status,404);
  assert.equal(f.objectReads(),0);
  const start=await fetch(url+'/internal/episodes/playback/diagnose',{
   method:'POST',headers});
  assert.equal(start.status,400);
  assert.equal(f.sourceRequests(),0);
 }finally{await new Promise(resolve=>hub.server.close(resolve))}
});
test('isolated verified episode ffprobe and ffmpeg diagnostics use only S3 prefix',async()=>{
 const f=fixture();
 const executed=[];
 const result=await diagnoseVerifiedMovie({
  runId:episodeId,mediaKind:'episode',storage:f.storage,lease:f.lease,
  diagnosticRunner:async(program,args)=>{
   executed.push(program);
   if(program==='ffprobe')return {stdout:JSON.stringify({
    streams:[{codec_type:'video',codec_name:'h264',width:1920,height:1080},
      {codec_type:'audio',codec_name:'ac3'}],
    format:{duration:'2600',format_name:'matroska,webm'}
   })};
   return {stdout:'# framemd5\n0, 0, 0, 1, 128, abc123\n'};
  }
 });
 assert.equal(result.ok,true,result.code);
 assert.equal(result.videoCodec,'h264');
 assert.equal(result.audioCodec,'ac3');
 assert.equal(result.videoFramesDecoded,1);
 assert.equal(result.audioFramesDecoded,1);
 assert.deepEqual(executed,['ffprobe','ffmpeg','ffmpeg']);
 assert.equal(result.customerCutover,false);
 assert.equal(result.providerRequests,0);
});
