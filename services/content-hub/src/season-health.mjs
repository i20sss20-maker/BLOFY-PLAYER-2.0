// Safe read-only storage monitoring and operator-initiated S3 spot-checks.
// A successful sample proves ONLY selected chunks, not the entire episode
// or physical bucket capacity. No Xtream/media source requests or auto-copy.
const RUN=/^[A-Za-z0-9_-]{8,80}$/;
const MAX_SAMPLE_BYTES=24*1024*1024;
const allowedCodes=new Set([
 'season_storage_sample_verified','season_storage_checksum_mismatch',
 'season_storage_read_unavailable','season_storage_manifest_unavailable'
]);
export function seasonStorageSamplePositions(partCount){
 if(!Number.isSafeInteger(partCount)||partCount<1||partCount>1024)
  throw Error('season_storage_part_count_invalid');
 return [...new Set([0,Math.floor((partCount-1)/2),partCount-1])];
}
const count=n=>Math.max(0,Math.floor(Number(n)||0));
const bytes=n=>Math.max(0,Number(n)||0);
export function summarizeSeasonHealth({
 stats={},audits=[],worker={},storageSoftLimitBytes=null,now=Date.now()
}={}){
 const episodes=count(stats.episode_count);
 const verified=count(stats.verified_count);
 const queued=count(stats.queued_count);
 const failed=count(stats.failed_count);
 const running=count(stats.running_count);
 const paused=count(stats.paused_count);
 const expected=bytes(stats.expected_bytes);
 const stored=bytes(stats.stored_bytes);
 const verifiedBytes=bytes(stats.verified_bytes);
 const softLimit=Number(storageSoftLimitBytes);
 const usableLimit=Number.isSafeInteger(softLimit)&&softLimit>0?
   softLimit:null;
 const alerts=[];
 if(failed)alerts.push({code:'season_episodes_failed',
   severity:'error',count:failed});
 if(running&&!worker.active)alerts.push({
   code:'season_worker_interrupted',severity:'warning',count:running});
 if(usableLimit&&stored>=Math.floor(usableLimit*.85))
  alerts.push({code:'season_storage_budget_near_threshold',
   severity:stored>usableLimit?'error':'warning',count:1});
 let confirmedFailures=0,unavailable=0;
 const recent=[];
 for(const record of (Array.isArray(audits)?audits:[]).slice(0,20)){
  if(!RUN.test(String(record.runId||''))||
     !allowedCodes.has(record.code))continue;
  const entry={runId:record.runId,code:record.code,
   checkedAt:record.checkedAt,
   checkedParts:count(record.checkedParts),
   totalParts:count(record.totalParts),
   checkedBytes:bytes(record.checkedBytes)};
  recent.push(entry);
  if(entry.code==='season_storage_checksum_mismatch')confirmedFailures++;
  if(entry.code==='season_storage_read_unavailable')unavailable++;
 }
 if(confirmedFailures)alerts.push({
  code:'season_storage_integrity_mismatch',
  severity:'error',count:confirmedFailures});
 if(unavailable)alerts.push({
  code:'season_storage_audit_unavailable',
  severity:'warning',count:unavailable});
 // The configured limit is a private planning limit, NOT S3 free space.
 return {ok:true,readOnly:true,privateOnly:true,customerCutover:false,
  providerMediaRequests:0,checkedAt:new Date(now).toISOString(),
  accountingScope:'postgres_episode_manifests',
  bucketFreeBytes:null,bucketCapacityKnown:false,
  episodeCount:episodes,verifiedCount:verified,
  failedCount:failed,queuedCount:queued,runningCount:running,
  pausedCount:paused,storedBytes:stored,verifiedBytes,
  expectedBytes:expected,
  percent:expected?Math.min(100,Math.floor(100*stored/expected)):0,
  budgetBytes:usableLimit,budgetUtilization:usableLimit?
   Math.round(stored/usableLimit*100):null,
  alerts,latestAudits:recent};
}
export async function auditSeasonEpisodeSample({
 runId,lease,storage,signal,logger=()=>{}
}={}){
 if(!RUN.test(String(runId||'')))return {
  ok:false,code:'season_storage_run_invalid'};
 if(!lease?.getVerifiedEpisodeObject||
   !storage?.verify)return {ok:false,code:'season_storage_dependencies_missing'};
 let manifest;
 try{manifest=await lease.getVerifiedEpisodeObject(runId)}
 catch{return {ok:false,code:'season_storage_manifest_unavailable'}}
 if(!manifest||!Array.isArray(manifest.parts)||
    manifest.parts.length<1||manifest.parts.length>1024)
  return {ok:false,code:'season_storage_manifest_unavailable'};
 const {parts}=manifest;
 let positions;
 try{positions=seasonStorageSamplePositions(parts.length)}
 catch{return {ok:false,code:'season_storage_manifest_unavailable'}}
 let sampledBytes=0,checkedParts=0;
 for(const pos of positions){
  const part=parts[pos];
  if(!part||!Number.isSafeInteger(part.bytes)||part.bytes<1||
    part.bytes>8*1024*1024||!(/^[a-f0-9]{64}$/).test(part.sha256)||
    sampledBytes+part.bytes>MAX_SAMPLE_BYTES)
   return {ok:false,code:'season_storage_manifest_unavailable'};
  sampledBytes+=part.bytes;
  try{
   const verified=await storage.verify({
    key:part.key,expectedBytes:part.bytes,
    expectedSha256:part.sha256,signal
   });
   checkedParts++;
   if(verified?.ok!==true||verified.bytes!==part.bytes||
      verified.sha256!==part.sha256){
    const result={ok:false,code:'season_storage_checksum_mismatch',
     checkedParts,totalParts:parts.length,checkedBytes:sampledBytes};
    logger('BLOFY_SEASON_STORAGE_AUDIT',{
     code:result.code,checkedParts,mediaKind:'episode',
     providerMediaRequests:0,customerCutover:false});
    return result;
   }
  }catch{
   return {ok:false,code:'season_storage_read_unavailable',
    checkedParts,totalParts:parts.length,checkedBytes:sampledBytes};
  }
 }
 const result={ok:true,code:'season_storage_sample_verified',
  checkedParts,totalParts:parts.length,checkedBytes:sampledBytes,
  sampledOnly:checkedParts<parts.length,fullFileVerifiedNow:false,
  providerMediaRequests:0,customerCutover:false};
 logger('BLOFY_SEASON_STORAGE_AUDIT',{
  code:result.code,checkedParts:result.checkedParts,
  providerMediaRequests:0,customerCutover:false});
 return result;
}
