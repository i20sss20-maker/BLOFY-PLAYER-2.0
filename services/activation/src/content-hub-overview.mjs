// Unified owner-only operations snapshot. This combines existing private
// read-only data only; it never scans provider media or S3 objects.
// Accounting is logical/recorded, not billed bucket usage or free capacity.
const clamp=(n,max=Number.MAX_SAFE_INTEGER)=>{
 const v=Number(n);
 return Number.isFinite(v)?Math.max(0,Math.min(max,Math.floor(v))):0;
};
const readable=(x)=>x&&typeof x==='object'&&!Array.isArray(x)&&x.ok===true;
const SEASON=/^[a-z0-9][a-z0-9_-]{2,63}$/;
const CODE=/^[a-z0-9_]{1,80}$/;
const safeCode=x=>CODE.test(String(x||''))?String(x):'unknown';
const clampDate=x=>{
 if(!x)return null;
 const d=new Date(x);
 return Number.isFinite(d.getTime())?d.toISOString():null;
};
const moviePart=x=>{
 if(!readable(x))return {available:false,verifiedCount:null,
  verifiedBytes:null,activeCount:null,failedCount:null,partialBytes:null};
 const a=x.accounting||{};
 return {available:true,verifiedCount:clamp(a.verifiedCount),
  verifiedBytes:clamp(a.verifiedBytes),activeCount:clamp(a.activeCount),
  failedCount:clamp(a.failedCount),partialBytes:clamp(a.stagedChunkBytes),
  accountingScope:'verified_private_movie_pilot_objects_only',
  pilotRunning:x.pilotRunning===true};
};
const episodePart=x=>{
 if(!readable(x))return {available:false,episodeCount:null,
  seasonCount:null,seriesCount:null,verifiedCount:null,
  failedCount:null,queuedCount:null,pausedCount:null,
  runningCount:null,storedBytes:null,expectedBytes:null};
 const t=x.totals||{},seasons=Array.isArray(x.seasonSummaries)?
  x.seasonSummaries.slice(0,100):[];
 const ids=new Set();
 for(const item of seasons){
  const match=/^series_([1-9][0-9]{0,14})_s([0-9]{1,3})$/.exec(
   String(item.seasonKey||''));
  if(match)ids.add(match[1]);
 }
 const count=clamp(t.episodeCount);
 return {available:true,episodeCount:count,
  seasonCount:clamp(t.seasonCount),
  seriesCount:ids.size,seriesCountPartial:x.seasonSummariesLimited===true||
    seasons.length<clamp(t.seasonCount),
  verifiedCount:clamp(t.verifiedCount,count),
  failedCount:clamp(t.failedCount,count),
  queuedCount:clamp(t.queuedCount,count),
  pausedCount:clamp(t.pausedCount,count),
  runningCount:clamp(t.runningCount,count),
  storedBytes:clamp(t.storedBytes),verifiedBytes:clamp(t.verifiedBytes),
  expectedBytes:clamp(t.expectedBytes),
  transferBytesMeasured:clamp(t.transferBytesMeasured),
  transferSamples:clamp(t.transferSamples),
  averageBytesPerSecond:t.averageBytesPerSecond===null||
   t.averageBytesPerSecond===undefined?null:clamp(t.averageBytesPerSecond),
  workerActive:x.worker?.active===true,
  workerState:String(x.worker?.state||'unknown').slice(0,32),
  seasonSummaries:seasons.filter(s=>SEASON.test(String(s.seasonKey||'')))
   .slice(0,12).map(s=>({
    seasonKey:s.seasonKey,episodeCount:clamp(s.episodeCount),
    verifiedCount:clamp(s.verifiedCount),failedCount:clamp(s.failedCount),
    storedBytes:clamp(s.storedBytes),expectedBytes:clamp(s.expectedBytes),
    percent:clamp(s.percent,100)
   })),
  seasonSummariesLimited:x.seasonSummariesLimited===true||
   seasons.length>12,
  accountingScope:'postgres_episode_manifests_in_season_queue'};
};
const attentionPart=x=>{
 if(!readable(x))return {available:false,counts:null,items:[],
  limited:null};
 const rows=Array.isArray(x.items)?x.items.slice(0,50):[];
 const safe=/^[A-Za-z0-9_-]{8,80}$/;
 const severity=new Set(['critical','warning','notice','info']);
 const types=new Set(['transient_failure',
  'needs_manual_integrity_or_rights_review',
  'possible_stale_running_state','paused_for_review',
  'partial_checkpoint_waiting']);
 return {available:true,counts:{
  critical:clamp(x.counts?.critical,50),
  warning:clamp(x.counts?.warning,50),
  notice:clamp(x.counts?.notice,50),
  info:clamp(x.counts?.info,50)
 },items:rows.filter(a=>SEASON.test(String(a.seasonKey||''))&&
    safe.test(String(a.runId||''))&&severity.has(a.severity)&&
    types.has(a.type)).slice(0,8).map(a=>({
   seasonKey:a.seasonKey,runId:a.runId,
   episodeNumber:clamp(a.episodeNumber,500),
   severity:a.severity,type:a.type,
   code:safeCode(a.code),
   retryEligible:a.retryEligible===true,
   ageMinutes:a.ageMinutes===null?null:clamp(a.ageMinutes),
   updatedAt:clampDate(a.updatedAt)
  })),
  limited:x.limited===true,
  visibleRows:rows.length,
  scope:'bounded_recent_attention_rows'};
};
export function buildUnifiedOpsOverview({
 status=null,pilots=null,analytics=null,attention=null,
 checkedAt=new Date().toISOString()
}={}){
 const health=readable(status)?{
  available:true,privateBucketAvailable:status.privateBucketAvailable===true,
  databaseAvailable:status.databaseAvailable===true,
  movieWorkerActive:status.pilotRunning===true,
  episodeCopyActive:status.episodeCopyBusy===true
 }:{available:false,privateBucketAvailable:null,databaseAvailable:null,
   movieWorkerActive:null,episodeCopyActive:null};
 const movie=moviePart(pilots),episode=episodePart(analytics),
  alerts=attentionPart(attention);
 const sources={health:health.available,movies:movie.available,
  seasons:episode.available,alerts:alerts.available};
 const unavailable=Object.entries(sources).filter(([,ok])=>!ok)
  .map(([name])=>name);
 const componentsAvailable=movie.available&&episode.available;
 const storage={
  recordedMovieVerifiedBytes:movie.verifiedBytes,
  recordedEpisodeBytes:episode.storedBytes,
  combinedKnownBytes:componentsAvailable?
   clamp(movie.verifiedBytes+episode.storedBytes):null,
  combinedKnownBytesAvailable:componentsAvailable,
  completeBucketUsage:false,bucketCapacityBytes:null,bucketFreeBytes:null,
  warning:'Known logical copy counts only; not physical S3 usage or free space.',
  partialMovieBytesExcluded:true,
  episodeVerifiedBytes:episode.available?episode.verifiedBytes:null
 };
 const incidents=[];
 if(health.available&&(!health.privateBucketAvailable||
     !health.databaseAvailable))
  incidents.push({level:'critical',code:'private_storage_unhealthy'});
 if(episode.available&&episode.failedCount>0)
  incidents.push({level:'warning',code:'season_failed_episodes',
   count:episode.failedCount});
 if(movie.available&&movie.failedCount>0)
  incidents.push({level:'warning',code:'movie_failed_copies',
   count:movie.failedCount});
 if(alerts.available&&alerts.counts.critical>0)
  incidents.push({level:'critical',code:'critical_episode_attention',
   count:alerts.counts.critical});
 if(unavailable.length)incidents.push({level:'notice',
  code:'some_sources_unavailable',count:unavailable.length});
 const available=Object.values(sources).some(Boolean);
 return {ok:available,readOnly:true,privateOnly:true,
  customerCutover:false,providerMediaRequests:0,
  automaticDownload:false,automaticRetry:false,
  checkedAt:clampDate(checkedAt),
  partial:unavailable.length>0,unavailableSources:unavailable,
  sources,health,movies:movie,seasons:episode,storage,attention:alerts,
  incidents:incidents.slice(0,10),
  accountingExplanation:'Movies count only verified private pilot copies. Episode bytes represent season queue database checkpoint snapshots. The sum is a known logical subset, not billed S3 usage, quota or free space.'};
}
