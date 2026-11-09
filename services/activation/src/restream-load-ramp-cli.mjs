// Manual-only, staging-only. Explicit invocation:
// BLOFY_RESTREAM_LOAD_TEST=isolated RAILWAY_ENVIRONMENT_NAME=staging \
// BLOFY_RESTREAM_ENGINE_URL=http://restream.railway.internal:8888 \
// node src/restream-load-ramp-cli.mjs
// Never run in production; never accepts a provider URL or playlist.
import {runSyntheticHlsRamp} from './restream-load-ramp.mjs';
import {verifyRestreamSmoke} from './restream-smoke.mjs';
import {normalizePrivateRestreamOrigin} from './restream-engine-core.mjs';
if(process.env.BLOFY_RESTREAM_LOAD_TEST!=='isolated'||
   String(process.env.RAILWAY_ENVIRONMENT_NAME||'').toLowerCase()!=='staging'){
 console.error('isolated_staging_required');
 process.exitCode=2;
}else{
 const origin=normalizePrivateRestreamOrigin(process.env.BLOFY_RESTREAM_ENGINE_URL||'');
 if(!origin){console.error('private_engine_required');process.exitCode=2;}
 else{
  const report=await runSyntheticHlsRamp({assertIsolated:true,
   probe:()=>verifyRestreamSmoke(origin),
   delay:()=>new Promise(resolve=>setTimeout(resolve,2000))});
  console.log(JSON.stringify(report));
  if(!report.ok)process.exitCode=1;
 }
}
