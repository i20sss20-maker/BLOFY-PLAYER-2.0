// Isolated-environment synthetic HLS request ramp. NEVER run automatically
// and NEVER against provider/customer URLs. This confirms bounded manifest
// and segment transport only, not video decoding or 100 continuous viewers.
const STEPS=[2,10,25,50,100];
export async function runSyntheticHlsRamp({probe,assertIsolated=false,
 ramp=STEPS,delay=async()=>{},now=Date.now}={}){
 if(assertIsolated!==true)return {ok:false,code:'load_test_isolation_required'};
 if(typeof probe!=='function')throw TypeError('probe_required');
 if(!Array.isArray(ramp)||ramp.length<1||ramp.length>5||
    ramp.some(n=>!Number.isInteger(n)||n<1||n>100)||
    !ramp.every((n,i)=>i===0||n>ramp[i-1]))
  return {ok:false,code:'load_ramp_invalid'};
 const report=[];
 for(const count of ramp){
  const start=now();
  const completed=await Promise.all(Array.from({length:count},async()=>{
   try{const result=await probe();
    return {ok:result?.ok===true&&result?.mediaVerified===true,
      ms:Number.isFinite(result?.elapsedMs)?result.elapsedMs:null};}
   catch{return {ok:false,ms:null};}
  }));
  const ok=completed.filter(x=>x.ok).length;
  const times=completed.map(x=>x.ms).filter(Number.isFinite).sort((a,b)=>a-b);
  const percentile=p=>times.length?times[Math.max(0,Math.ceil(times.length*p)-1)]:null;
  report.push({requests:count,passed:ok,failed:count-ok,
    p50Ms:percentile(.5),p95Ms:percentile(.95),wallMs:now()-start});
  // Failure stops the ramp before adding load at the next level.
  if(ok!==count)return {ok:false,scope:'isolated_synthetic_hls',stopReason:'failed_step',
    realSourceVerified:false,continuousViewersVerified:false,steps:report};
  await delay();
 }
 return {ok:true,scope:'isolated_synthetic_hls',
  realSourceVerified:false,continuousViewersVerified:false,steps:report};
}
