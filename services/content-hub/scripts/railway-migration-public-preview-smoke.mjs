// Verify public HTTPS ingress for the exact isolated device-preview host.
// Synthetic content only; no Xtream, customer data or arbitrary domains.
import {LAB_PROJECT} from './railway-migration-lab-av-smoke.mjs';

const ORIGIN='https://blofy-migration-device-preview-test.up.railway.app';
const files=['/movie.mp4','/episode.mp4'];
const BASE={synthetic:true,providerMediaRequests:0,customerCutover:false,
 automaticCopy:false,publicHttpsVerified:false,devicePlaybackVerified:false};

export async function checkPublicSyntheticPreview({env=process.env,request=fetch}={}){
 if(env.RAILWAY_PROJECT_ID!==LAB_PROJECT||
    env.RAILWAY_ENVIRONMENT_NAME!=='test'||
    env.BLOFY_QA_SYNTHETIC_ONLY!=='1'||
    Object.keys(env).some(k=>/^(XTREAM_(USERNAME|PASSWORD)|BLOFY_XTREAM_|BLOFY_STREAM_UPSTREAM|BLOFY_CONTENT_HUB_BRIDGE_TOKEN)/.test(k)))
  return {ok:false,code:'public_preview_scope_invalid',...BASE};
 let stage='health';
 try{
  const health=await request(ORIGIN+'/health',{redirect:'error',
   signal:AbortSignal.timeout(12000)});
  if(health.status!==200)throw Error('not_http_200');
  const j=await health.json();
  if(j.ok!==true||j.synthetic!==true||j.providerRequests!==0||
     j.customerCutover!==false)throw Error('not_isolated');
  stage='page';
  const page=await request(ORIGIN+'/',{redirect:'error',
   signal:AbortSignal.timeout(12000)});
  if(page.status!==200||!(await page.text()).includes('مختبر تشغيل BLOFY STREAM'))
    throw Error('page_missing');
  for(const path of files){
   stage=path;
   const head=await request(ORIGIN+path,{method:'HEAD',redirect:'error',
    signal:AbortSignal.timeout(12000)});
   const length=Number(head.headers.get('content-length'));
   if(head.status!==200||!Number.isSafeInteger(length)||length<1000||
      head.headers.get('accept-ranges')!=='bytes')
    throw Error('mp4_head_unavailable');
   const r=await request(ORIGIN+path,{redirect:'error',
    headers:{Range:'bytes=0-1023'},signal:AbortSignal.timeout(12000)});
   if(r.status!==206||Buffer.from(await r.arrayBuffer()).length!==1024||
      r.headers.get('content-range')!=='bytes 0-1023/'+length)
    throw Error('mp4_https_range_unavailable');
  }
  return {ok:true,code:'public_synthetic_https_preview_verified',...BASE,
   publicHttpsVerified:true,previewPageVerified:true,mp4RangesVerified:2};
 }catch{
  return {ok:false,code:'public_synthetic_https_preview_unavailable',stage,...BASE};
 }
}
if(process.argv[1]?.endsWith('/railway-migration-public-preview-smoke.mjs')){
 const result=await checkPublicSyntheticPreview();
 console.log('BLOFY_MIGRATION_PUBLIC_HTTPS_SMOKE '+JSON.stringify(result));
 process.exitCode=result.ok?0:1;
}
