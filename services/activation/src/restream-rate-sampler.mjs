// Calculates observed egress bitrate between two snapshots, not capacity or SLA.
// Counter decrease means instance or session reset; never report a negative rate.
export function createRestreamRateSampler({clock=Date.now,minIntervalMs=1000,maxIntervalMs=300000}={}){
 let previous=null;
 return function sample(current){
  const now=clock();
  const bytes=current?.totals?.hlsBytes;
  if(!current?.ok||!Number.isFinite(bytes)||bytes<0)return {ok:false,code:'rate_snapshot_unavailable'};
  const currentPoint={at:now,bytes};
  if(!previous){previous=currentPoint;return {ok:true,measured:false,reason:'needs_second_sample',hlsEgressMbps:null};}
  const elapsed=now-previous.at;
  if(elapsed<minIntervalMs)return {ok:true,measured:false,reason:'sampling_interval_short',hlsEgressMbps:null};
  if(elapsed>maxIntervalMs||bytes<previous.bytes){
   previous=currentPoint;
   return {ok:true,measured:false,reason:'counter_reset_or_expired',hlsEgressMbps:null};
  }
  const delta=bytes-previous.bytes;
  previous=currentPoint;
  return {ok:true,measured:true,intervalMs:elapsed,
    hlsEgressMbps:Math.round(delta*8/elapsed/1000*1000)/1000,
    bytesSentInInterval:delta};
 };
}
