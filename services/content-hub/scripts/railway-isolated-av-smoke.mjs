// Real, isolated Railway T3 audio + video smoke using ONLY generated
// synthetic frames and tone. NEVER reads Xtream, customer objects or codes.
// The disposable QA bucket must be empty before any write is attempted.
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile as execFileCb} from 'node:child_process';
import {promisify} from 'node:util';
import {runIsolatedS3Smoke} from './railway-isolated-s3-smoke.mjs';

const execFile=promisify(execFileCb);
const SIZE=5*1024*1024+127;
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
async function runCodec(binary,args){
 await execFile(binary,args,{timeout:35000,maxBuffer:256000});
}
export async function generateSyntheticAvFixture(){
 const folder=await mkdtemp(join(tmpdir(),'blofy-railway-qa-make-'));
 try{
  const file=join(folder,'generated.mp4');
  await runCodec('ffmpeg',[
   '-hide_banner','-loglevel','error','-nostdin',
   '-f','lavfi','-i','testsrc2=size=320x180:rate=12:duration=2',
   '-f','lavfi','-i','sine=frequency=880:sample_rate=44100:duration=2',
   '-c:v','mpeg4','-q:v','5','-c:a','aac','-b:a','96k',
   '-shortest','-movflags','+faststart','-y',file
  ]);
  const original=await readFile(file);
  const padBytes=SIZE-original.length;
  if(padBytes<8||padBytes>0xffffffff)
   throw Error('qa_av_generated_size_invalid');
  // A valid MP4 free atom extends the file past the 5 MiB multipart
  // boundary without modifying or reproducing third-party video.
  const padding=Buffer.alloc(padBytes);
  padding.writeUInt32BE(padBytes,0);
  padding.write('free',4,'ascii');
  return Buffer.concat([original,padding],SIZE);
 }finally{await rm(folder,{recursive:true,force:true})}
}
export async function verifySyntheticAvOnPrivateS3({
 storage,key,expectedBytes,expectedSha256
}={}){
 if(!storage||typeof key!=='string'||
    expectedBytes!==SIZE||!/^[a-f0-9]{64}$/.test(expectedSha256))
  throw Error('qa_av_verify_scope_invalid');
 const folder=await mkdtemp(join(tmpdir(),'blofy-railway-qa-verify-'));
 try{
  // These bytes are read FROM THE REAL PRIVATE S3 OBJECT, not reused
  // from the generated input. Strict 8-MiB bounded Range and SHA-256.
  const received=[];
  const body=await storage.readVerifiedRange({
   key,from:0,to:expectedBytes-1,expectedBytes
  });
  let length=0;
  for await(const chunk of body){
   length+=chunk.byteLength;
   if(length>SIZE)throw Error('qa_av_s3_oversize');
   received.push(Buffer.from(chunk));
  }
  const bytes=Buffer.concat(received);
  if(bytes.length!==SIZE||sha256(bytes)!==expectedSha256)
   throw Error('qa_av_s3_sha256_mismatch');
  const file=join(folder,'from-private-s3.mp4');
  await writeFile(file,bytes,{flag:'wx',mode:0o600});
  const {stdout}=await execFile('ffprobe',[
   '-v','error','-count_frames',
   '-show_entries','stream=codec_type,nb_read_frames',
   '-of','json',file
  ],{timeout:35000,maxBuffer:262144});
  let metadata;
  try{metadata=JSON.parse(stdout)}
  catch{throw Error('qa_av_probe_json_invalid')}
  const streams=Array.isArray(metadata?.streams)?metadata.streams:[];
  const video=streams.find(x=>x.codec_type==='video'&&
   Number(x.nb_read_frames)>0);
  const audio=streams.find(x=>x.codec_type==='audio'&&
   Number(x.nb_read_frames)>0);
  if(!video||!audio)throw Error('qa_av_video_or_audio_missing');
  await runCodec('ffmpeg',[
   '-hide_banner','-loglevel','error','-nostdin','-xerror',
   '-i',file,'-map','0:v:0','-an','-f','null','-'
  ]);
  await runCodec('ffmpeg',[
   '-hide_banner','-loglevel','error','-nostdin','-xerror',
   '-i',file,'-map','0:a:0','-vn','-f','null','-'
  ]);
  return {ok:true,sha256Verified:true,audioDecoded:true,
   videoDecoded:true,audioFrames:Number(audio.nb_read_frames),
   videoFrames:Number(video.nb_read_frames),
   synthetic:true,customerCutover:false,sourceRequests:0,
   devicePlaybackVerified:false};
 }finally{await rm(folder,{recursive:true,force:true})}
}
export async function runRailwaySyntheticAvSmoke(args={}){
 const result=await runIsolatedS3Smoke({
  ...args,generate:generateSyntheticAvFixture,
  verifyAvFromS3:verifySyntheticAvOnPrivateS3
 });
 return {...result,mediaKind:'synthetic_mp4_mpeg4_aac',
  independentS3AudioVideoDecoded:result.avVerified===true,
  devicePlaybackVerified:false,sourceRequests:0};
}
if(process.argv[1]?.endsWith('/railway-isolated-av-smoke.mjs')){
 const result=await runRailwaySyntheticAvSmoke();
 console.log('BLOFY_RAILWAY_ISOLATED_AV_SMOKE '+JSON.stringify(result));
 process.exitCode=result.ok===true?0:1;
}
