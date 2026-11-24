/* CPU-constrained **synthetic** FFmpeg benchmark. It never contacts Xtream,
 * production Railway, a real customer, or the internet. No real media files.
 *
 * The exact encoder profile helper comes from the production worker source.
 * Compare one, two and three simultaneous software video transcodes on this
 * ephemeral GitHub runner; this is NOT a Railway capacity certification.
 * Times, speed and peak process RSS are printed without subscriber data.
 */
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readdirSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';

const workerSource=readFileSync(new URL('../media-worker.ts',import.meta.url),'utf8');
const start=workerSource.indexOf('function videoQualityProfile(');
const end=workerSource.indexOf('\nconst hlsSessions=',start);
assert.ok(start>0&&end>start,'production video encoder profile must be used');
const env={VIDAA_LIVE_VIDEO_PROFILE:'720',VIDAA_VOD_VIDEO_PROFILE:'1080'};
const profiles=vm.runInNewContext(workerSource.slice(start,end)+';({compatibleVideoArgs,videoQualityProfile})',{
 Bun:{env}
});
const ffmpeg=process.env.FFMPEG_BIN||'ffmpeg';
const help=spawnSync(ffmpeg,['-hide_banner','-version'],{timeout:5000,encoding:'utf8'});
assert.equal(help.status,0,'installed ffmpeg must be runnable');
const base=mkdtempSync(join(tmpdir(),'blofy-ffmpeg-benchmark-'));
const duration=4;
const configs=[
 {kind:'live',size:'1280x720',frequency:400},
 {kind:'movie',size:'1920x1080',frequency:540},
 {kind:'live',size:'1280x720',frequency:660}
];
const timeoutMs=90000;
const round=n=>Math.round(n*100)/100;
function rssMb(pid){
 if(process.platform!=='linux'||!pid)return 0;
 try{
  const m=/VmRSS:\s*(\d+)\s*kB/.exec(readFileSync('/proc/'+pid+'/status','utf8'));
  return m?Number(m[1])/1024:0
 }catch{return 0}
}
function one(spec,id){
 const folder=join(base,'job-'+id);mkdirSync(folder);
 const args=[
  '-hide_banner','-loglevel','error','-nostdin',
  '-f','lavfi','-i','testsrc2=size='+spec.size+':rate=25',
  '-f','lavfi','-i','sine=frequency='+spec.frequency+':sample_rate=48000',
  '-t',String(duration),'-map','0:v:0','-map','1:a:0',
  ...profiles.compatibleVideoArgs(spec.kind,1),
  '-af','aresample=async=1:min_hard_comp=0.100:first_pts=0',
  '-c:a','aac','-profile:a','aac_low','-b:a','160k','-ac','2','-ar','48000',
  '-f','hls','-hls_time','1','-hls_list_size','0','-hls_flags','independent_segments+temp_file',
  '-hls_segment_filename',join(folder,'seg-%06d.ts'),join(folder,'index.m3u8')
 ];
 const child=spawn(ffmpeg,args,{stdio:['ignore','ignore','pipe']});
 let stderr='';
 child.stderr.on('data',buf=>{stderr=(stderr+buf.toString()).slice(-900)});
 const done=new Promise(resolve=>{
  child.once('error',e=>resolve({exit:-99,error:e.code||'spawn_error'}));
  child.once('exit',(code,signal)=>resolve({exit:code,signal}))
 });
 return {child,folder,kind:spec.kind,done,stderr:()=>stderr}
}
async function group(count){
 const runners=Array.from({length:count},(_,i)=>one(configs[i],count+'-'+i));
 const began=performance.now();
 let timedOut=false,peakSumMb=0,peakPerProcessMb=0;
 const poll=setInterval(()=>{
  const samples=runners.map(x=>rssMb(x.child.pid));
  peakSumMb=Math.max(peakSumMb,samples.reduce((a,b)=>a+b,0));
  peakPerProcessMb=Math.max(peakPerProcessMb,...samples)
 },125);
 const timer=setTimeout(()=>{
  timedOut=true;
  for(const p of runners)try{p.child.kill('SIGKILL')}catch{}
 },timeoutMs);
 try{
  const exits=await Promise.all(runners.map(x=>x.done));
  const wallSeconds=(performance.now()-began)/1000;
  const details=[];
  for(let i=0;i<runners.length;i++){
   const x=runners[i],exit=exits[i];
   assert.equal(timedOut,false,'synthetic transcode exceeded bounded deadline');
   assert.equal(exit.exit,0,'synthetic '+x.kind+' FFmpeg failed: '+x.stderr());
   const manifest=readFileSync(join(x.folder,'index.m3u8'),'utf8');
   const files=readdirSync(x.folder).filter(k=>/^seg-\d{6}\.ts$/.test(k));
   assert.ok(manifest.includes('#EXTM3U')&&files.length>=3,
    'HLS must contain a manifest and three TS segments');
   for(const name of files){
    const payload=readFileSync(join(x.folder,name));
    assert.ok(payload.length>188&&payload[0]===0x47,
     'synthetic segment must have MPEG-TS packet sync');
   }
   details.push({kind:x.kind,profile:profiles.videoQualityProfile(x.kind).name,segments:files.length})
  }
  const result={concurrentEncoders:count,source:'CI synthetic lavfi, no customers',
   mediaSecondsEach:duration,wallSeconds:round(wallSeconds),
   perEncoderSpeed:round(duration/wallSeconds),
   combinedOutputRate:round(count*duration/wallSeconds),
   measuredPeakRssMb:round(peakSumMb),
   maxProcessRssMb:round(peakPerProcessMb),outputs:details};
  return result
 }finally{
  clearInterval(poll);clearTimeout(timer);
  for(const x of runners)if(x.child.exitCode===null)try{x.child.kill('SIGKILL')}catch{}
 }
}
try{
 const measurements=[];
 for(const n of [1,2,3]){
  const m=await group(n);
  measurements.push(m);
  console.log('BLOFY_SYNTHETIC_ENCODER_CONCURRENCY',JSON.stringify(m))
 }
 const single=measurements[0],double=measurements[1],triple=measurements[2];
 const comparison={
  environment:'GitHub Ubuntu runner, not the production Railway worker',
  actualProductionLimit:2,recommendIncreasingLimit:false,
  oneAtATimeSeconds:single.wallSeconds,twoTogetherSeconds:double.wallSeconds,
  threeTogetherSeconds:triple.wallSeconds,
  twoEncodersRealtimeOnRunner:double.perEncoderSpeed>=1,
  threeEncodersRealtimeOnRunner:triple.perEncoderSpeed>=1,
  cannotConclude:'CPU quota, network sources, 20-minute device decoder behavior and production memory still need measurement'
 };
 console.log('BLOFY_CAPACITY_INTERPRETATION',JSON.stringify(comparison));
 if(process.env.GITHUB_STEP_SUMMARY){
  const fs=await import('node:fs');
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
   '### Synthetic software encoder benchmark (NOT production capacity)\n'+
   '| Concurrent FFmpeg | Max profile | Elapsed (s) | Per encoder speed | Peak sampled RSS (MiB) |\n'+
   '|---:|---|---:|---:|---:|\n'+
   measurements.map(x=>'| '+x.concurrentEncoders+' | '+x.outputs.map(y=>y.kind+':'+y.profile).join(', ')+
    ' | '+x.wallSeconds+' | '+x.perEncoderSpeed+'× | '+x.measuredPeakRssMb+' |').join('\n')+
   '\n\n**Production remains capped at 2 jobs.** These measurements come from CI and do not prove that 3 will work on Railway.\n')
 }
}finally{
 rmSync(base,{recursive:true,force:true})
}
