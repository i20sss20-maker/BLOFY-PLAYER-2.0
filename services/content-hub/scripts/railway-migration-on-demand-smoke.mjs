// Single-ingest / two-viewer CANARY over private Railway HLS.
// Generated FFmpeg video/audio ONLY; no Xtream provider or customer access.
import {execFile as cb} from 'node:child_process';
import {promisify} from 'node:util';
import {LAB_PROJECT} from './railway-migration-lab-av-smoke.mjs';
const exec=promisify(cb);
const URI='http://blofy-migration-live-lab.railway.internal:8888/canary/index.m3u8';
export async function checkOnDemandFanout({env=process.env,run=exec}={}){
 const b={synthetic:true,sourceMediaRequests:0,customerCutover:false,
  automaticCopy:false,viewersTested:0};
 if(env.RAILWAY_PROJECT_ID!==LAB_PROJECT||
    env.RAILWAY_ENVIRONMENT_NAME!=='test'||
    env.BLOFY_QA_SYNTHETIC_ONLY!=='1')
  return {ok:false,code:'canary_scope_invalid',...b};
 // Parallel FFmpeg readers each demand 2s of video + audio. The
 // MediaMTX runOnDemand hook is a single publisher for both consumers.
 const args=['-hide_banner','-loglevel','error','-nostdin','-y',
  '-rw_timeout','20000000','-i',URI,'-t','2','-map','0:v:0','-map','0:a:0',
  '-f','null','-'];
 try{
  const results=await Promise.allSettled([
   run('ffmpeg',args,{timeout:60000,maxBuffer:250000}),
   run('ffmpeg',args,{timeout:60000,maxBuffer:250000})
  ]);
  const passes=results.filter(x=>x.status==='fulfilled').length;
  return {ok:passes===2,code:passes===2?'canary_two_viewers_decoded':
   'canary_parallel_decode_failed',...b,
   viewersTested:2,passedViewers:passes,hasDecodedAudioVideo:passes===2,
   onePublisherExpected:true,actualPublisherCountVerified:false};
 }catch{return {ok:false,code:'canary_executor_failed',...b}}
}
if(process.argv[1]?.endsWith('/railway-migration-on-demand-smoke.mjs')){
 const result=await checkOnDemandFanout();
 console.log('BLOFY_MIGRATION_ON_DEMAND_SMOKE '+JSON.stringify(result));
 process.exitCode=result.ok?0:1;
}
