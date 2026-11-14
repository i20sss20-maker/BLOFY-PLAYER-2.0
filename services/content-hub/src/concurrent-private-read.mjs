// Manually requested two-run S3 read canary: NOT a browser playback or
// multi-subscriber capacity benchmark. No Xtream source calls or downloads.
// One pre-verified 8 MiB chunk per run, at most two in parallel.
const ID=/^[A-Za-z0-9_-]{8,80}$/;
const CAP=8*1024*1024;
export function validateConcurrentReadIds(runIds){
 if(!Array.isArray(runIds)||runIds.length!==2||
    runIds.some(id=>!ID.test(String(id||'')))||
    runIds[0]===runIds[1])throw Error('private_read_canary_selection_invalid');
 return [...runIds];
}
export async function checkPrivateReadConcurrency({
 runIds,lease,storage,signal,now=()=>Date.now(),logger=()=>{}
}={}){
 let ids;
 try{ids=validateConcurrentReadIds(runIds)}
 catch{return {ok:false,code:'private_read_canary_selection_invalid'}}
 if(!lease?.getVerifiedEpisodeObject||!storage?.verify)
  return {ok:false,code:'private_read_canary_dependencies_missing'};
 const parts=[];
 try{
  // Authenticate all metadata BEFORE reading any S3 bytes.
  const manifests=await Promise.all(ids.map(id=>lease.getVerifiedEpisodeObject(id)));
  for(const manifest of manifests){
   const first=manifest?.parts?.[0];
   if(!manifest||!Array.isArray(manifest.parts)||!first||
      !Number.isSafeInteger(first.bytes)||first.bytes<1||
      first.bytes>CAP||!/^[a-f0-9]{64}$/.test(String(first.sha256||''))||
      typeof first.key!=='string'||!first.key)
    return {ok:false,code:'private_read_canary_not_verified'};
   parts.push(first);
  }
 }catch{return {ok:false,code:'private_read_canary_not_verified'}}
 const started=now();
 const settled=await Promise.allSettled(parts.map(p=>storage.verify({
  key:p.key,expectedBytes:p.bytes,expectedSha256:p.sha256,signal})));
 const durationsMs=Math.max(0,now()-started);
 const result=settled.map((x,i)=>{
  if(x.status!=='fulfilled')return {ok:false,code:'private_read_canary_s3_unavailable'};
  if(x.value?.ok!==true||x.value?.bytes!==parts[i].bytes||
     x.value?.sha256!==parts[i].sha256)
   return {ok:false,code:'private_read_canary_checksum_mismatch'};
  return {ok:true,code:'private_read_canary_chunk_verified'};
 });
 const ok=result.every(x=>x.ok);
 const code=ok?'private_read_canary_two_chunks_verified':
  result.some(x=>x.code==='private_read_canary_checksum_mismatch')?
   'private_read_canary_checksum_mismatch':'private_read_canary_s3_unavailable';
 const summary={ok,code,readOnly:true,privateOnly:true,
  concurrentReads:2,checkedChunks:result.filter(x=>x.ok).length,
  requestedBytes:parts.reduce((x,p)=>x+p.bytes,0),
  durationMs:durationsMs,providerMediaRequests:0,
  playbackVerified:false,subscriberCapacityVerified:false,
  customerCutover:false,results:result};
 logger('BLOFY_SEASON_CONCURRENT_PRIVATE_READ',{
  ok,code,readCount:2,checkedChunks:summary.checkedChunks,
  providerMediaRequests:0,customerCutover:false});
 return summary;
}
