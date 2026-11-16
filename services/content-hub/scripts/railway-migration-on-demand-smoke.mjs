// Isolated bounded fan-out proof on SYNTHETIC (not Xtream) live content.
// Tests five simultaneous HLS viewers with audio/video for 8 seconds.
// No customer app, provider credentials, or full-catalog media requests.
import {execFile as cb} from 'node:child_process';
import {promisify} from 'node:util';
import {LAB_PROJECT} from './railway-migration-lab-av-smoke.mjs';

const exec=promisify(cb);
const URL='http://blofy-migration-live-lab.railway.internal:8888/canary/index.m3u8';
const VIEWERS=5;
const base={synthetic:true,sourceMediaRequests:0,customerCutover:false,
 automaticCopy:false,viewersTested:0,independentPublisherCountVerified:false};

export async function checkOnDemandFanout({env=process.env,run=exec,now=Date.now}={}){
 if(env.RAILWAY_PROJECT_ID!==LAB_PROJECT||
    env.RAILWAY_ENVIRONMENT_NAME!=='test'||
    env.BLOFY_QA_SYNTHETIC_ONLY!=='1'||
    Object.keys(env).some(k=>/^(XTREAM_(USERNAME|PASSWORD)|BLOFY_STREAM_UPSTREAM|BLOFY_XTREAM_)/.test(k)))
  return {ok:false,code:'canary_scope_invalid',...base};
 const start=now();
 const args=['-hide_banner','-loglevel','error','-nostdin',
   '-rw_timeout','20000000',
   '-i',URL,
   '-t','8','-map','0:v:0','-map','0:a:0','-f','null','-'];
 try{
  // Promise.allSettled ensures all bounded readers are observed even if one
  // fails. Each requires both audio and video maps to exist.
  const results=await Promise.allSettled(
   Array.from({length:VIEWERS},()=>run('ffmpeg',args,
    {timeout:65000,maxBuffer:256000})));
  const passed=results.filter(x=>x.status==='fulfilled').length;
  return {ok:passed===VIEWERS,
    code:passed===VIEWERS?'canary_five_viewers_decoded':
      'canary_parallel_decode_failed',
    ...base,viewersTested:VIEWERS,passedViewers:passed,
    audioVideoDecodedForAll:passed===VIEWERS,
    elapsedMs:Math.max(0,now()-start),
    expectedPublisherCount:1,
    // This script does not read MediaMTX control-plane state. Check
    // independent server logs before claiming one active publisher.
    independentPublisherCountVerified:false};
 }catch{
  return {ok:false,code:'canary_executor_failed',...base,
    viewersTested:VIEWERS,passedViewers:0};
 }
}

if(process.argv[1]?.endsWith('/railway-migration-on-demand-smoke.mjs')){
 const result=await checkOnDemandFanout();
 console.log('BLOFY_MIGRATION_ON_DEMAND_SMOKE '+JSON.stringify(result));
 process.exitCode=result.ok?0:1;
}
