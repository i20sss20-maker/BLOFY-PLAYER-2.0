import {pathToFileURL} from 'node:url';
/**
 * Fixed-domain, bounded public smoke checks for the BLOFY launch.
 *
 * Never logs private body, customer details, provider credentials, subscriber
 * source URLs or redirect targets. Checks HTTP readiness and a 32-byte
 * immutable signed APK Range canary, NOT playback or payment settlement.
 * Run periodically from GitHub Actions, never as high-volume load testing.
 */
const ROOTS=Object.freeze([
  {key:'activation',url:'https://blofyplayer.com/health'},
  {key:'downloads',url:'https://updates.blofyplayer.com/health'},
  {key:'streamControl',url:'https://blofy-stream-api-production.up.railway.app/health'},
  {key:'signedApkEdge',url:'https://blofy-signed-apk-edge-production.up.railway.app/health'}
]);
const PINNED_FILE='BLOFY-STREAM-56.0-CATALOG-TV-CONTROLS-FIX-OWNER-SIGNED.apk';
const SAMPLE='https://blofy-signed-apk-edge-production.up.railway.app/files/releases/'+PINNED_FILE;
const TIMEOUT=12000;
const sleep=n=>new Promise(resolve=>setTimeout(resolve,n));
export function checks(){
  return [...ROOTS,{key:'signedApkRange32',url:SAMPLE,range:'bytes=0-31'}];
}
export async function checkOne(check,{fetchImpl=fetch,clock=Date.now}={}){
  const started=clock();
  for(let attempt=1;attempt<=2;attempt++){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),TIMEOUT);
    try{
      const response=await fetchImpl(check.url,{
        method:'GET',redirect:'manual',
        headers:check.range?{'range':check.range,accept:'application/vnd.android.package-archive'}:{accept:'application/json'},
        cache:'no-store',signal:controller.signal
      });
      if(check.range){
        const valid=response.status===206&&
          response.headers.get('content-range')==='bytes 0-31/135783643'&&
          Number(response.headers.get('content-length'))===32&&
          /no-store/.test(String(response.headers.get('cache-control')||''));
        if(valid){
          const bytes=Buffer.from(await response.arrayBuffer());
          if(bytes.length===32&&bytes[0]===0x50&&bytes[1]===0x4b)
            return {key:check.key,ok:true,httpStatus:206,elapsedMs:clock()-started,attempt};
        }
      }else if(response.status===200){
        const body=await response.json().catch(()=>null);
        if(body?.ok===true)
          return {key:check.key,ok:true,httpStatus:200,elapsedMs:clock()-started,attempt};
      }
    }catch{}finally{clearTimeout(timer)}
    if(attempt===1)await sleep(600);
  }
  return {key:check.key,ok:false,httpStatus:null,elapsedMs:clock()-started,attempt:2};
}
export async function smoke({fetchImpl=fetch,clock=Date.now}={}){
  const rows=await Promise.all(checks().map(check=>checkOne(check,{fetchImpl,clock})));
  return {ok:rows.every(x=>x.ok),mode:'read_only_public_smoke',
    customerTrafficChanged:false,paymentsCaptured:0,providerMediaRequests:0,
    checkedAt:new Date(clock()).toISOString(),checks:rows};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const result=await smoke();
  process.stdout.write(JSON.stringify(result)+'\n');
  if(!result.ok)process.exitCode=1;
}
