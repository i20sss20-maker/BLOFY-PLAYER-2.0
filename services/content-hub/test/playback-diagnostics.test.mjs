import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {access} from 'node:fs/promises';
import {diagnoseVerifiedMovie} from '../src/playback-diagnostics.mjs';
const make=({invalidHash=false,notVerified=false,missingAudio=false}={})=>{
 const bytes=Buffer.alloc(8*1024*1024,66);
 const digest=createHash('sha256').update(bytes).digest('hex');
 const calls=[],files=[];
 const lease={getVerifiedChunkedObject:async id=>
  notVerified?null:{
   kind:'chunked',extension:'mkv',bytes:bytes.length,
   sha256:'7'.repeat(64),
   parts:[{key:'fake_private_part_1',bytes:bytes.length,
     partNumber:1,sha256:invalidHash?'f'.repeat(64):digest}]
  }};
 const storage={readVerifiedRange:async args=>{
  calls.push(args);
  return (await import('node:stream')).Readable.from([bytes]);
 }};
 const diagnosticRunner=async(program,args)=>{
  files.push(args.at(-1));
  if(program==='ffprobe')return {stdout:JSON.stringify({
   streams:[{codec_type:'video',codec_name:'h264',width:1280,height:720},
     ...missingAudio?[]:[{codec_type:'audio',codec_name:'aac',
      channels:2,sample_rate:'48000'}],
     {codec_type:'subtitle',codec_name:'subrip'}],
   format:{duration:'102.4',format_name:'matroska,webm'}
  })};
  if(program==='ffmpeg')return {
   stdout:'# framemd5\n#stream,index\n0,        0,  0,  1, 2048, abcdef\n'
  };
  throw Error('unexpected program');
 };
 return {lease,storage,diagnosticRunner,calls,files};
};
test('canary reads only verified private S3 sample, identifies real tracks and requires decoded audio+video',async()=>{
 const a=make();
 const result=await diagnoseVerifiedMovie({
  runId:'private_run_001',...a});
 assert.equal(result.ok,true,result.code);
 assert.equal(result.code,'canary_audio_video_decoded');
 assert.equal(result.videoTracks,1);
 assert.equal(result.audioTracks,1);
 assert.equal(result.subtitleTracks,1);
 assert.equal(result.videoCodec,'h264');
 assert.equal(result.audioCodec,'aac');
 assert.equal(result.videoFramesDecoded,1);
 assert.equal(result.audioFramesDecoded,1);
 assert.equal(result.sampleBytes,8*1024*1024);
 assert.equal(result.providerRequests,0);
 assert.equal(result.customerCutover,false);
 assert.equal(a.calls.length,1);
 assert.equal(a.calls[0].from,0);
 assert.equal(a.calls[0].to,8*1024*1024-1);
 for(const filename of a.files)await assert.rejects(
   access(filename),{code:'ENOENT'});
});
test('canary refuses incomplete private movie without reading anything',async()=>{
 const a=make({notVerified:true});
 const res=await diagnoseVerifiedMovie({runId:'private_run_001',...a});
 assert.equal(res.ok,false);
 assert.equal(res.code,'canary_movie_not_verified');
 assert.equal(a.calls.length,0);
 assert.equal(a.files.length,0);
});
test('canary detects altered stored byte stream and does not call ffprobe',async()=>{
 const a=make({invalidHash:true});
 const res=await diagnoseVerifiedMovie({runId:'private_run_001',...a});
 assert.equal(res.ok,false);
 assert.equal(res.code,'canary_private_read_failed');
 assert.equal(a.files.length,0);
});
test('canary reports missing audio tracks rather than claiming playable media',async()=>{
 const a=make({missingAudio:true});
 const res=await diagnoseVerifiedMovie({runId:'private_run_001',...a});
 assert.equal(res.ok,false);
 assert.equal(res.code,'canary_missing_audio_or_video_track');
 assert.equal(res.videoTracks,1);
 assert.equal(res.audioTracks,0);
 assert.equal(res.providerRequests,0);
});
