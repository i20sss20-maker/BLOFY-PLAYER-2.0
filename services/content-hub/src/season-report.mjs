// Bounded, authenticated owner-only season report; never calls an upstream media URL.
import {forecastSeasonTransfer} from './season-forecast.mjs';
const clamp=(n,max=Number.MAX_SAFE_INTEGER)=>Math.min(max,Math.max(0,Math.floor(Number(n)||0)));
const STR=/^[a-z0-9_]{1,80}$/;
const code=n=>STR.test(String(n||''))?String(n):'unknown';
const date=n=>n?String(n):null;
const allowed=new Set(['queued','paused','running','verified','failed']);
export function buildSeasonReport({page={},totals={},episodes=[],events=[],worker={},timing={}}={}){
 const seasonKey=String(page.seasonKey||'').slice(0,64);
 const expectedBytes=clamp(totals.expected_bytes);
 const storedBytes=clamp(totals.stored_bytes);
 const all=clamp(totals.episode_count,500);
 const verified=clamp(totals.verified_count,all);
 const failed=clamp(totals.failed_count,all);
 const running=clamp(totals.running_count,all);
 const queued=clamp(totals.queued_count,all);
 const paused=clamp(totals.paused_count,all);
 const episodeRows=(Array.isArray(episodes)?episodes:[]).slice(0,50).map(row=>{
  const expected=clamp(row.expectedBytes);
  const copied=Math.min(expected,clamp(row.storedBytes));
  const state=allowed.has(row.state)?row.state:'unknown';
  return {runId:String(row.runId||'').slice(0,80),
   episodeNumber:clamp(row.episodeNumber,500),
   title:String(row.title||'').slice(0,220),state,
   priority:[0,1,2].includes(Number(row.priority))?Number(row.priority):0,
   priorityEditable:state==='queued'||state==='paused',
   sourceVerified:row.verified===true,
   ownerAvConfirmedAt:row.verified===true&&row.ownerAvConfirmedAt?
    date(row.ownerAvConfirmedAt):null,
   videoOwnerConfirmed:row.verified===true&&Boolean(row.ownerAvConfirmedAt),
   audioOwnerConfirmed:row.verified===true&&Boolean(row.ownerAvConfirmedAt),
   avReviewSource:'owner_manual_browser_confirmation_only',
   code:row.code?code(row.code):null,
   expectedBytes:expected,storedBytes:copied,
   percent:expected?Math.floor(100*copied/expected):0,
   updatedAt:date(row.updatedAt),snapshotOnly:true};
 });
 const eventRows=(Array.isArray(events)?events:[]).slice(0,60).map(e=>({
  episodeNumber:clamp(e.episodeNumber,500),
  bytes:clamp(e.bytes,8388608),durationMs:clamp(e.durationMs,3600000),
  code:code(e.code),recordedAt:date(e.recordedAt),
  errorStage:e.stage?code(e.stage):null,
  bytesPerSecond:e.bytes>0&&e.durationMs>0?
   Math.floor(Number(e.bytes)*1000/Number(e.durationMs)):null
 }));
 const samples=clamp(timing.sample_count);
 const activeMs=clamp(timing.active_ms);
 const measuredBytes=clamp(timing.measured_bytes);
 const transferTiming={measuredChunkCount:samples,
  measuredActiveMs:samples>0?activeMs:null,
  measuredBytes:samples>0?measuredBytes:null,
  averageBytesPerSecond:samples>0&&activeMs>0?
   Math.floor(measuredBytes*1000/activeMs):null,
  firstMeasuredAt:date(timing.first_measured_at),
  lastMeasuredAt:date(timing.last_measured_at),
  completeHistory:measuredBytes>=storedBytes&&samples>0,
  scope:'durable_chunk_wall_clock_since_telemetry_enabled'};
 const forecast=forecastSeasonTransfer({
  events:eventRows,expectedBytes,storedBytes,
  episodeCount:all,verifiedCount:verified,failedCount:failed
 });
 const alerts=[];
 if(failed>0)alerts.push({code:'failed_episodes',
  level:'warning',text:failed+' حلقة بحالة فشل. راجع رمز الخطأ قبل إعادة المحاولة.'});
 if(running>0&&!worker?.active)alerts.push({code:'worker_status_unknown',
  level:'warning',text:'حلقات موسومة بأنها قيد النقل والعامل المحلي غير نشط؛ راجع حالة العامل قبل اتخاذ إجراء.'});
 if(eventRows.some(x=>x.bytes>0&&x.durationMs>=90000))
  alerts.push({code:'slow_chunks',level:'notice',
   text:'هناك أجزاء ضمن آخر 60 قياسًا تجاوزت 90 ثانية؛ تحقق من مرحلة التأخير.'});
 if(storedBytes>0&&!eventRows.length)
  alerts.push({code:'history_not_recorded',level:'info',
   text:'توجد بيانات مخزنة قبل بدء القياسات؛ لا تتوفر لها تفاصيل زمن النقل.'});
 if(forecast.recentSlowdown)alerts.push({code:'recent_transfer_slowdown',
  level:'notice',text:'آخر 5 أجزاء مقاسة أبطأ من الخمسة التي سبقتها بأكثر من 35٪. مؤشر يستدعي المراقبة، وليس إثباتًا لخلل بالمصدر.'});
 if(forecast.status==='insufficient_recent_samples')
  alerts.push({code:'forecast_not_ready',level:'info',
   text:'التوقع يحتاج 3 أجزاء حديثة وناجحة على الأقل خلال آخر 24 ساعة؛ لا توجد مدة متبقية موثوقة الآن.'});
 return {ok:true,readOnly:true,privateOnly:true,customerCutover:false,
  providerMediaRequests:0,bucketFreeBytes:null,
  seasonKey,
  page:{number:clamp(page.number,20000),pageSize:50,
   totalEpisodes:all,pages:clamp(page.pages,20000),
   hasPrevious:page.hasPrevious===true,hasNext:page.hasNext===true},
  totals:{episodeCount:all,verifiedCount:verified,failedCount:failed,
   queuedCount:queued,runningCount:running,pausedCount:paused,
   expectedBytes,storedBytes,percent:expectedBytes?
    Math.min(100,Math.floor(100*storedBytes/expectedBytes)):0},
  episodes:episodeRows,recentEvents:eventRows,transferTiming,forecast,
  eventHistoryScope:'newest_60_telemetry_rows_for_selected_season',
  eventsLimited:Array.isArray(events)&&events.length>60,
  alerts,measurementNote:'Chunk wall-clock time includes source, upload, checksum and checkpoint. Older chunks may not have telemetry.',
  snapshotOnly:true};
}
