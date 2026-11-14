// Owner-only, explainable season transfer attention queue. These are hints
// derived solely from persisted status/checkpoints, never source/S3 checks.
const TRANSIENT=new Set(['episode_retryable_error','episode_source_busy']);
const SAFE=/^[a-z0-9_]{1,80}$/;
const RUN=/^[A-Za-z0-9_-]{8,80}$/;
const SEASON=/^[a-z0-9][a-z0-9_-]{2,63}$/;
const clamp=(n,max)=>Math.max(0,Math.min(max,Math.floor(Number(n)||0)));
const ms=(value)=>{
 const v=new Date(value).getTime();
 return Number.isFinite(v)?v:null;
};
const id=(value,re)=>re.test(String(value||''))?String(value):null;
const code=value=>SAFE.test(String(value||''))?String(value):'unknown';
export function buildSeasonAttention({rows=[],worker={},limited=false,
 now=Date.now()}={}){
 const output=[];
 const source=Array.isArray(rows)?rows.slice(0,50):[];
 for(const row of source){
  const state=String(row.state||'');
  if(!['failed','paused','running','queued'].includes(state))continue;
  const seasonKey=id(row.seasonKey,SEASON),runId=id(row.runId,RUN);
  if(!seasonKey||!runId)continue;
  const updated=ms(row.updatedAt);
  const age=updated===null?null:Math.max(0,now-updated);
  const ageMinutes=age===null?null:Math.floor(age/60000);
  const expected=clamp(row.expectedBytes,4294967296);
  const stored=clamp(row.storedBytes,expected);
  const error=code(row.code),manualRetries=clamp(row.manualRetries,2);
  let severity=null,type=null,advice=null,retryEligible=false;
  if(state==='failed'){
   const transient=TRANSIENT.has(error);
   retryEligible=transient&&manualRetries<2;
   severity=transient?'warning':'critical';
   type=transient?'transient_failure':'needs_manual_integrity_or_rights_review';
   advice=retryEligible?
    'راجع المصدر وصلاحية التخزين أولًا. بعد التأكد من خمول المصدر، يمكنك اعتماد إعادة المحاولة يدويًا. لا يبدأ النقل تلقائيًا.':
    'لا تُعِد النقل تلقائيًا. راجع رمز الفشل وسلامة الملف والترخيص، ثم عالج السبب أولًا.';
  }else if(state==='running'&&age!==null&&age>=20*60000&&
    !(worker?.active===true&&worker?.currentRunId===runId)){
   severity='warning';type='possible_stale_running_state';
   advice='حالة النقل قديمة، لكن قد يعمل عامل آخر على نسخة مختلفة. افحص حالة العمال قبل أي تدخل؛ لا يعتبر هذا إثبات توقف المصدر.';
  }else if(state==='paused'&&age!==null&&age>=30*60000){
   severity='notice';type='paused_for_review';
   advice='الانتظار متعمد إلى أن يتم التحقق من بوابات السلامة، ثم ابدأ الاستكمال يدويًا إذا كان المصدر خاملًا.';
  }else if(state==='queued'&&stored>0&&age!==null&&age>=60*60000){
   severity='info';type='partial_checkpoint_waiting';
   advice='توجد بيانات جزئية مسجلة. لا تحذفها؛ نقاط الاستكمال تبقى محفوظة، والتحقق النهائي يتم أثناء الاستكمال اليدوي.';
  }else continue;
  output.push({
   runId,seasonKey,
   episodeNumber:clamp(row.episodeNumber,500),
   state,type,severity,code:error,
   updatedAt:updated===null?null:new Date(updated).toISOString(),
   ageMinutes,expectedBytes:expected,storedBytes:stored,
   manualRetries,retryEligible,advice,
   automaticRetry:false,automaticStart:false,
   checkpointOnly:true
  });
 }
 const rank={critical:0,warning:1,notice:2,info:3};
 output.sort((a,b)=>{
  const r=(rank[a.severity]??4)-(rank[b.severity]??4);
  if(r)return r;
  return (b.ageMinutes??0)-(a.ageMinutes??0);
 });
 const counts={critical:0,warning:0,notice:0,info:0};
 for(const item of output)counts[item.severity]++;
 return {ok:true,readOnly:true,privateOnly:true,customerCutover:false,
  providerMediaRequests:0,automaticRetry:false,automaticStart:false,
  sourceChecked:false,storageChecked:false,
  snapshotOnly:true,
  items:output,counts,
  shown:output.length,limited:limited===true,
  scope:'latest_50_matching_queue_rows_at_read_time',
  explanation:'Alerts are read-only persisted-state hints, not a diagnosis of source or S3 availability.'};
}
