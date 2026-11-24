// Isolated 30-second, five-viewer HLS endurance canary.
// Only synthetic MediaMTX generated H264/AAC inside the test project.
// This script never connects to Xtream or production subscriber systems.
import {execFile as callbackExec} from 'node:child_process';
import {promisify} from 'node:util';
import {LAB_PROJECT} from './railway-migration-lab-av-smoke.mjs';

const exec=promisify(callbackExec);
const STREAM='http://blofy-migration-live-lab.railway.internal:8888/canary/index.m3u8';
const DURATION_SECONDS=30;
const CONCURRENT_READERS=5;
const MIN_MEDIA_SECONDS=28;
const MIN_VIDEO_FRAMES=300;
const BASE={synthetic:true,privateOnly:true,providerMediaRequests:0,
 customerCutover:false,automaticCopy:false,devicePlaybackVerified:false,
 requestedViewers:CONCURRENT_READERS,requestedSecondsPerViewer:DURATION_SECONDS};

export function inspectViewerProgress(output){
 const text=String(output||'');
 const times=[...text.matchAll(/^out_time_us=(\d+)\s*$/gm)]
   .map(x=>Number(x[1])).filter(Number.isSafeInteger);
 const frames=[...text.matchAll(/^frame=(\d+)\s*$/gm)]
   .map(x=>Number(x[1])).filter(Number.isSafeInteger);
 const seconds=times.length?Math.max(...times)/1e6:0;
 const frameCount=frames.length?Math.max(...frames):0;
 return {complete:/^progress=end\s*$/m.test(text),
   decodedSeconds:Math.round(seconds*100)/100,
   videoFrames:frameCount,
   ok:/^progress=end\s*$/m.test(text)&&
      seconds>=MIN_MEDIA_SECONDS&&frameCount>=MIN_VIDEO_FRAMES};
}

export async function runEnduranceCanary({env=process.env,run=exec,now=Date.now}={}){
 if(env.RAILWAY_PROJECT_ID!==LAB_PROJECT||
    env.RAILWAY_ENVIRONMENT_NAME!=='test'||
    env.BLOFY_QA_SYNTHETIC_ONLY!=='1'||
    Object.keys(env).some(k=>/^(XTREAM_(USERNAME|PASSWORD)|BLOFY_STREAM_UPSTREAM|BLOFY_XTREAM_|BLOFY_CONTENT_HUB_BRIDGE_TOKEN)/.test(k)))
  return {ok:false,code:'endurance_scope_invalid',...BASE};
 const start=now();
 const args=['-hide_banner','-nostdin','-loglevel','error','-xerror',
   '-rw_timeout','20000000','-i',STREAM,
   '-t',String(DURATION_SECONDS),
   '-map','0:v:0','-map','0:a:0',
   '-progress','pipe:1','-f','null','-'];
 const results=await Promise.allSettled(Array.from({length:CONCURRENT_READERS},
   ()=>run('ffmpeg',args,{timeout:72000,maxBuffer:262144})));
 const samples=results.map(result=>result.status==='fulfilled'?
    inspectViewerProgress(result.value.stdout):
    {ok:false,decodedSeconds:0,videoFrames:0,complete:false});
 const passed=samples.filter(x=>x.ok===true).length;
 const minDecodedSeconds=Math.min(...samples.map(x=>x.decodedSeconds));
 const maxDecodedSeconds=Math.max(...samples.map(x=>x.decodedSeconds));
 const minVideoFrames=Math.min(...samples.map(x=>x.videoFrames));
 return {...BASE,ok:passed===CONCURRENT_READERS,
    code:passed===CONCURRENT_READERS?'endurance_five_viewers_30s_verified':
      'endurance_short_or_failed_reader',
    passedViewers:passed,
    minimumDecodedSeconds:minDecodedSeconds,
    maximumDecodedSeconds:maxDecodedSeconds,
    minimumVideoFrames:minVideoFrames,
    durationProofChecked:true,
    elapsedMs:Math.max(0,now()-start),
    originalSourceConnectionCountVerified:false};
}

if(process.argv[1]?.endsWith('/railway-migration-endurance-smoke.mjs')){
 const result=await runEnduranceCanary();
 console.log('BLOFY_MIGRATION_ENDURANCE_SMOKE '+JSON.stringify(result));
 process.exitCode=result.ok?0:1;
}
