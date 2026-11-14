// Owner-only advisory forecasts. No provider probes, restart or copy actions.
// Estimates represent exclusively observed active *chunk* wall-clock time,
// including source, upload, checksum, DB checkpoint and not queue wait.
const nonnegative=n=>Number.isFinite(Number(n))?
 Math.max(0,Number(n)):0;
const CHUNK=8*1024*1024;
const DAY=86400000;
const WINDOW=24*60*60*1000;
const MAX_FORECAST_SECONDS=30*24*60*60;
const safeRound=n=>Math.min(Number.MAX_SAFE_INTEGER,
 Math.max(0,Math.floor(n||0)));
const output=(status,rest={})=>({
 status,
 kind:'measured_active_chunk_duration_only',
 estimatedActiveSeconds:null,
 observedSamples:0,
 observedBytes:0,
 observedDurationMs:0,
 observedBytesPerSecond:null,
 recentSlowdown:false,
 estimatedCompletionAt:null,
 excludesQueueWait:true,
 excludesOfflineTime:true,
 customerCutover:false,
 ...rest
});
export function forecastSeasonTransfer({
 events=[],expectedBytes=0,storedBytes=0,
 episodeCount=0,verifiedCount=0,failedCount=0,
 now=Date.now()
}={}){
 const expected=nonnegative(expectedBytes);
 const stored=Math.min(expected,nonnegative(storedBytes));
 const remaining=Math.max(0,expected-stored);
 const episodes=safeRound(episodeCount),verified=safeRound(verifiedCount);
 if(!Number.isSafeInteger(expected)||!Number.isSafeInteger(stored)||
    !Number.isFinite(now))
  return output('invalid_accounting');
 if(episodes===0||expected===0)return output('empty_season',{remainingBytes:remaining});
 if(verified===episodes)return output('completed',{remainingBytes:0});
 if(remaining===0)return output('awaiting_full_verification',{remainingBytes:0});
 if(nonnegative(failedCount)>0)
  return output('blocked_by_failed_episodes',{remainingBytes:remaining});
 const recent=(Array.isArray(events)?events:[])
  .filter(e=>{
   const bytes=Number(e?.bytes),duration=Number(e?.durationMs);
   const timestamp=new Date(e?.recordedAt).getTime();
   return Number.isSafeInteger(bytes)&&bytes>0&&bytes<=CHUNK&&
    Number.isSafeInteger(duration)&&duration>0&&duration<=3600000&&
    Number.isFinite(timestamp)&&timestamp<=now+60000&&
    timestamp>=now-WINDOW;
  })
  .sort((a,b)=>new Date(b.recordedAt)-new Date(a.recordedAt))
  .slice(0,20);
 if(recent.length<3)return output('insufficient_recent_samples',{
  observedSamples:recent.length,remainingBytes:remaining
 });
 const measuredBytes=recent.reduce((a,e)=>a+Number(e.bytes),0);
 const durationMs=recent.reduce((a,e)=>a+Number(e.durationMs),0);
 if(measuredBytes<CHUNK||durationMs<=0)
  return output('insufficient_sample_bytes',{
   observedSamples:recent.length,remainingBytes:remaining
  });
 const speed=measuredBytes*1000/durationMs;
 if(!Number.isFinite(speed)||speed<1024)
  return output('insufficient_throughput',{
   observedSamples:recent.length,remainingBytes:remaining
  });
 const seconds=Math.ceil(remaining/speed);
 if(!Number.isFinite(seconds)||seconds>MAX_FORECAST_SECONDS)
  return output('forecast_out_of_range',{
   observedSamples:recent.length,remainingBytes:remaining
  });
 let slowdown=false;
 if(recent.length>=10){
  const speedOf=rows=>{
   const bytes=rows.reduce((a,e)=>a+Number(e.bytes),0),
    ms=rows.reduce((a,e)=>a+Number(e.durationMs),0);
   return ms?bytes*1000/ms:0;
  };
  const latest=speedOf(recent.slice(0,5)),
   previous=speedOf(recent.slice(5,10));
  slowdown=previous>0&&latest<previous*.65;
 }
 return output('estimate_available',{
  estimatedActiveSeconds:safeRound(seconds),
  observedSamples:recent.length,observedBytes:safeRound(measuredBytes),
  observedDurationMs:safeRound(durationMs),
  observedBytesPerSecond:safeRound(speed),
  remainingBytes:safeRound(remaining),recentSlowdown:slowdown,
  sampleWindowHours:24
 });
}
