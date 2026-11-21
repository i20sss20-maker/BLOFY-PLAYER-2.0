// Bounded, abortable backoff for media requests that failed BEFORE any bytes
// were sent to a viewer. The caller alone decides whether a status or transport
// failure is retryable. This helper never adds retries or switches a source.
// Random jitter prevents synchronized client retries overloading a weak origin.
export function mediaRetryDelayMs(attempt=1,random=Math.random){
 const n=Number.isSafeInteger(attempt)&&attempt>=1?attempt:1;
 const raw= Math.min(1800,700*2**Math.min(n-1,2));
 const sample=Number(random());
 const jitter=Number.isFinite(sample)?Math.min(1,Math.max(0,sample)):0.5;
 return Math.round(raw*(0.7+0.6*jitter));
}

export async function waitXtreamMediaRetry({attempt=1,signal,random=Math.random}={}){
 if(signal?.aborted)return false;
 const delay=mediaRetryDelayMs(attempt,random);
 return new Promise(resolve=>{
  let settled=false;
  const finish=allowed=>{
   if(settled)return;
   settled=true;
   clearTimeout(timer);
   signal?.removeEventListener('abort',cancel);
   resolve(allowed);
  };
  const cancel=()=>finish(false);
  const timer=setTimeout(()=>finish(true),delay);
  signal?.addEventListener('abort',cancel,{once:true});
  if(signal?.aborted)finish(false);
 });
}
