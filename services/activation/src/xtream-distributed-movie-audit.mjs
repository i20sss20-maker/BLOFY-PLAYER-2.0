// Operator-only sampling positions. A stratified tiny sample only indicates
// whether failed files are isolated across catalog positions, not global
// playback health. No titles, source IDs, or customer data returned.
export function distributedMovieOffsets(total,{groups=3,perGroup=4}={}){
 if(!Number.isSafeInteger(total)||total<1||
    !Number.isInteger(groups)||groups<1||groups>4||
    !Number.isInteger(perGroup)||perGroup<1||perGroup>4)return [];
 const count=Math.min(groups,Math.ceil(total/perGroup));
 const last=Math.max(0,total-perGroup);
 return [...new Set(Array.from({length:count},(_,i)=>
   Math.max(0,Math.min(last,Math.floor((i+0.5)*last/count)))
 ))];
}
export function summarizeDistributedMovieProbe(probe){
 const checks=(Array.isArray(probe?.checks)?probe.checks:[]).slice(0,4);
 const allowedErrors=new Set(['relay_provider_not_found',
  'relay_first_byte_timeout','relay_transport_connection_reset',
  'relay_transport_timeout','xtream_transport_connection_reset',
  'xtream_transport_timeout','timeout','upstream_unreachable',
  'empty_media','upstream_non_media_response','redirect_invalid']);
 return {
  checked:checks.length,mediaSamples:checks.filter(x=>x?.ok===true).length,
  missingFiles:checks.filter(x=>x?.httpStatus===502&&
    x?.error==='relay_provider_not_found').length,
  otherFailures:checks.filter(x=>!x?.ok&&!(x?.httpStatus===502&&
    x?.error==='relay_provider_not_found')).length,
  results:checks.map(x=>({
   status:Number.isInteger(x?.httpStatus)&&x.httpStatus>=100&&x.httpStatus<=599
     ?x.httpStatus:null,
   ok:x?.ok===true,
   error:allowedErrors.has(x?.error)?x.error:x?.error?'other':null
  })),
  videoDecoded:false,subscriberPlaybackVerified:false
 };
}
