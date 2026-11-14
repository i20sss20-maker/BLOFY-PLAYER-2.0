// Private, read-only season reporting. All numbers are derived from
// durable Postgres checkpoints and optional per-chunk transfer telemetry.
// Never infer physical S3 bucket capacity from manifest accounting.
const count=n=>Math.max(0,Math.floor(Number(n)||0));
const number=n=>Math.max(0,Number(n)||0);
const CODE=/^[a-z0-9_]{1,80}$/;
const safeCode=s=>CODE.test(String(s||''))?String(s):'unknown';
const ISO=s=>s?String(s):null;
const reasonMap={
 episode_source_busy:'المصدر مشغول؛ النقل ينتظر توفر الاتصال',
 episode_retryable_error:'تعثر مؤقت في الشبكة أو التخزين؛ راجع السجلات',
 episode_source_version_changed:'تغيرت نسخة الملف أثناء النقل',
 episode_source_fingerprint_changed:'تغيّر بصمة المصدر؛ تم إيقاف النسخ للحماية',
 episode_private_sha256_mismatch:'فشل التحقق من سلامة الجزء المخزن',
 episode_safety_gates_off:'شروط الأمان أو صلاحية التخزين غير مكتملة',
 episode_cancelled:'أوقف المسؤول العملية',
 season_queue_paused:'تم إيقاف جلسة النقل',
 season_job_failed:'فشل نقل حلقة ويحتاج مراجعة',
 season_queue_controller_failed:'تعثر متحكم قائمة الانتظار',
 unknown:'سبب غير محدد؛ راجع سجل الخادم'
};
export function seasonTransferReason(code){
 return reasonMap[safeCode(code)]||'فشل مسجل ('+safeCode(code)+')؛ افحص السجلات قبل إعادة المحاولة';
}
export function buildSeasonAnalytics({
 health={},metrics={},seasons=[],failures=[],events=[],worker={}
}={}){
 const moved=number(metrics.transfer_bytes);
 const milliseconds=number(metrics.active_ms);
 const samples=count(metrics.sample_count);
 // Includes download, private S3 upload, checksum and checkpoint.
 // Not an instantaneous network bandwidth measurement.
 const averageBytesPerSecond=samples>0&&milliseconds>0?
  Math.floor(moved*1000/milliseconds):null;
 const items=(Array.isArray(seasons)?seasons:[]).slice(0,100).map(s=>{
  const expected=number(s.expected_bytes),stored=number(s.stored_bytes);
  return {seasonKey:String(s.season_key||'').slice(0,64),
   episodeCount:count(s.episode_count),verifiedCount:count(s.verified_count),
   failedCount:count(s.failed_count),queuedCount:count(s.queued_count),
   runningCount:count(s.running_count),pausedCount:count(s.paused_count),
   expectedBytes:expected,storedBytes:stored,
   percent:expected?Math.min(100,Math.floor(stored*100/expected)):0};
 });
 const reasons=(Array.isArray(failures)?failures:[]).slice(0,15).map(r=>({
  code:safeCode(r.code),count:count(r.total),
  explanation:seasonTransferReason(r.code)
 }));
 const history=(Array.isArray(events)?events:[]).slice(0,30).map(r=>({
  runId:String(r.runId||''),seasonKey:String(r.seasonKey||'').slice(0,64),
  episodeNumber:count(r.episodeNumber),bytes:Math.min(8388608,number(r.bytes)),
  durationMs:Math.min(3600000,count(r.durationMs)),
  code:safeCode(r.code),stage:r.stage?safeCode(r.stage):null,
  recordedAt:ISO(r.recordedAt)
 }));
 const alerts=Array.isArray(health.alerts)?health.alerts:[];
 const diagnostics=[];
 if(alerts.some(a=>a.code==='season_checkpoint_no_progress'))
  diagnostics.push({code:'checkpoint_stalled',
   text:'توقف تقدم نقطة الحفظ أكثر من 3 دقائق: افحص المصدر والشبكة والتخزين.'});
 if(alerts.some(a=>a.code==='season_storage_budget_near_threshold'))
  diagnostics.push({code:'storage_budget_near_limit',
   text:'اقتربت النسخ المسجلة من حد التخطيط المخصص؛ لا يمثل سعة S3 الفعلية.'});
 if(alerts.some(a=>a.code==='season_storage_integrity_mismatch'))
  diagnostics.push({code:'checksum_failure',
   text:'فشل تحقق SHA-256 لأجزاء مخزنة؛ لا تعاود النسخ قبل التحقيق.'});
 if(alerts.some(a=>a.code==='season_worker_interrupted'))
  diagnostics.push({code:'worker_interrupted',
   text:'توجد حلقات بحالة جاري النقل لكن العامل غير نشط.'});
 const slow=history.filter(e=>e.bytes>0&&e.durationMs>=90000).length;
 if(slow)diagnostics.push({code:'slow_recent_chunks',
  text:'بعض الأجزاء استغرقت 90 ثانية أو أكثر، والمدة تشمل النقل والرفع والتحقق.'});
 if(reasons.length)diagnostics.push({code:'failed_jobs',
  text:'توجد أسباب فشل مسجلة. التفاصيل أدناه مؤشرات أولية وليست تشخيصًا قاطعًا.'});
 if(!samples)diagnostics.push({code:'speed_not_measured',
  text:'لم تُجمع قياسات سرعة للأجزاء بعد؛ لن نعرض سرعة تقديرية غير موثوقة.'});
 return {
  ok:true,readOnly:true,privateOnly:true,customerCutover:false,
  providerMediaRequests:0,
  accountingScope:'postgres_episode_manifests',
  bucketCapacityKnown:false,bucketFreeBytes:null,
  totals:{episodeCount:count(health.episodeCount),verifiedCount:count(health.verifiedCount),
   failedCount:count(health.failedCount),queuedCount:count(health.queuedCount),
   runningCount:count(health.runningCount),pausedCount:count(health.pausedCount),
   storedBytes:number(health.storedBytes),verifiedBytes:number(health.verifiedBytes),
   expectedBytes:number(health.expectedBytes),
   seasonCount:count(health.seasonCount)||items.length,
   transferBytesMeasured:moved,transferSamples:samples,
   averageBytesPerSecond,
   throughputScope:'chunk_wall_clock_including_s3_integrity_and_checkpoint',
   speedHistoryIncomplete:health.episodeCount>0&&samples===0},
  worker:{active:worker?.active===true,
   state:String(worker?.state||'idle').slice(0,32),
   currentRunId:worker?.currentRunId||null},
  seasonSummaries:items,seasonSummariesLimited:Array.isArray(seasons)&&seasons.length>100,
  failureReasons:reasons,recentEvents:history,
  diagnostics,recordedFrom:ISO(metrics.first_recorded_at),
  lastRecordedAt:ISO(metrics.last_recorded_at)
 };
}