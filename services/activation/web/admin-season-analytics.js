// Owner-only season reporting: GET only. No automatic start/retry actions.
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const make=(tag,css,text)=>{
 const e=document.createElement(tag);
 if(css)e.className=css;
 if(text!==undefined)e.textContent=String(text);
 return e;
};
const number=n=>Number(n||0).toLocaleString('ar-SA');
const fmt=n=>{
 if(n===null||!Number.isFinite(Number(n)))return 'غير مقاس';
 let x=Number(n);
 for(const unit of ['B','KB','MB','GB','TB']){
  if(x<1024||unit==='TB')return x.toLocaleString('en-US',{
   maximumFractionDigits:unit==='B'?0:2})+' '+unit;
  x/=1024;
 }
};
const date=s=>{
 if(!s)return '—';
 const d=new Date(s);
 return Number.isFinite(d.getTime())?
  d.toLocaleString('ar-SA',{dateStyle:'short',timeStyle:'short'}):'—';
};
const status={episode_checkpoint_saved:'تم حفظ جزء',
 episode_fully_verified:'اكتملت الحلقة',
 episode_retryable_error:'تعثر مؤقت',
 episode_source_busy:'المصدر مشغول',
 episode_already_verified:'مكتمل سابقًا'};
const stage={source_chunk:'قراءة المصدر',boundary_precheck:'فحص المصدر',
 boundary_postcheck:'فحص تطابق المصدر',metadata:'بيانات المصدر',
 s3_begin:'بدء تخزين S3',s3_upload:'رفع S3',
 s3_complete:'إتمام رفع S3',s3_verify:'سلامة التخزين',
 checkpoint:'حفظ النقطة',verify_full_file:'التحقق النهائي',
 manifest:'سجل الأجزاء',lock:'انتظار المصدر'};
let busy=false;
function placeholder(id,message){
 $(id).replaceChildren(make('p','muted',message));
}
function setKpis(t){
 for(const [id,val] of [
  ['analyticsEpisodes',number(t.episodeCount)],
  ['analyticsVerified',number(t.verifiedCount)],
  ['analyticsFailed',number(t.failedCount)],
  ['analyticsQueued',number(t.queuedCount)],
  ['analyticsStorage',fmt(t.storedBytes)],
  ['analyticsSpeed',t.averageBytesPerSecond===null?
   'لا توجد قياسات':fmt(t.averageBytesPerSecond)+' /ث']
 ])$(id).textContent=val;
}
function renderSeason(s){
 const card=make('article','analytics-record');
 const head=make('div','jobtop');
 head.append(make('strong','',s.seasonKey),
  make('span','chip',number(s.verifiedCount)+' / '+number(s.episodeCount)));
 const meter=make('div','meter'),fill=make('div','fill');
 fill.style.width=Math.max(0,Math.min(100,s.percent||0))+'%';
 meter.append(fill);
 const details=make('div','muted',
  'مكتملة '+number(s.verifiedCount)+
  ' · فاشلة '+number(s.failedCount)+
  ' · انتظار '+number(s.queuedCount)+
  ' · جارٍ '+number(s.runningCount)+
  ' · متوقفة '+number(s.pausedCount));
 const amount=make('div','row',fmt(s.storedBytes)+' / '+fmt(s.expectedBytes));
 card.append(head,meter,amount,details);
 return card;
}
function renderStages(rows,samples){
 const box=$('analyticsStages');
 const labels={source:'قراءة وفحص المصدر',storage:'رفع التخزين S3',
  verification:'التحقق من سلامة الملف',other:'القفل والبيانات والحفظ'};
 const items=Array.isArray(rows)?rows:[];
 box.replaceChildren(...(items.length?items.map(item=>{
  const card=make('div','analytics-record'),head=make('div','jobtop');
  head.append(make('strong','',labels[item.stage]||item.stage),
   make('span','chip',number(item.sharePercent)+'%'));
  const meter=make('div','meter'),fill=make('div','fill');
  fill.style.width=Math.max(0,Math.min(100,item.sharePercent||0))+'%';
  meter.append(fill);
  card.append(head,meter,make('div','muted',
   (item.durationMs/1000).toLocaleString('ar-SA',{
    maximumFractionDigits:1})+' ثانية من زمن الأجزاء المسجلة'));
  return card;
 }):[make('p','muted','يظهر توزيع الوقت بعد نقل الأجزاء الجديدة وقياس مراحلها.')]));
 if(samples>0&&samples<3)box.append(make('p','hint',
  'العينة صغيرة حتى الآن؛ لا يمكن تأكيد سبب البطء منها وحدها.'));
}
function renderDiagnostics(rows){
 const box=$('analyticsDiagnostics');
 const items=Array.isArray(rows)?rows:[];
 box.replaceChildren(...(items.length?
  items.map(i=>make('div','analytics-record analytics-warning',i.text)):
  [make('p','muted','لا توجد مؤشرات بطء أو تحذيرات في السجل الحالي.')]));
}
function renderFailures(rows){
 const box=$('analyticsFailures');
 const items=Array.isArray(rows)?rows:[];
 box.replaceChildren(...(items.length?
  items.map(i=>make('div','analytics-record',
   number(i.count)+' حلقة · '+i.explanation)):
  [make('p','muted','لا توجد حلقات فاشلة حاليًا.')]));
}
function renderHistory(rows){
 const body=$('analyticsHistory');
 const items=Array.isArray(rows)?rows:[];
 if(!items.length){
  const row=make('tr'),cell=make('td','',
   'لا توجد قياسات نقل مسجلة بعد. ستظهر الأجزاء الجديدة هنا بعد تفعيل الإصدار.');
  cell.colSpan=6;row.append(cell);body.replaceChildren(row);return;
 }
 const records=items.map(e=>{
  const row=make('tr');
  const data=[date(e.recordedAt),
   e.seasonKey+' · '+number(e.episodeNumber),
   status[e.code]||e.code,
   e.bytes?fmt(e.bytes):'—',
   (e.durationMs/1000).toLocaleString('ar-SA',{maximumFractionDigits:1})+' ث',
   stage[e.stage]||e.stage||'—'];
  for(const item of data)row.append(make('td','',item));
  return row;
 });
 body.replaceChildren(...records);
}
async function reloadAnalytics(){
 if(busy||document.hidden)return;
 busy=true;$('analyticsRefresh').disabled=true;
 try{
  const response=await fetch('/api/v1/admin/content-hub/seasons/analytics',{
   credentials:'same-origin',cache:'no-store'});
  if(response.status===401){location.assign('/admin');return}
  if(!response.ok)throw Error('private_season_analytics_unavailable');
  const data=await response.json();
  if(data.ok!==true||data.readOnly!==true||!data.totals)
   throw Error('invalid_analytics_response');
  setKpis(data.totals);
  const seasons=Array.isArray(data.seasonSummaries)?data.seasonSummaries:[];
  $('analyticsSeasons').replaceChildren(...(seasons.length?
   seasons.map(renderSeason):[make('p','muted','لم تتم إضافة مواسم بعد.')]));
  renderStages(data.timingBreakdown,data.stageSamples);
  renderDiagnostics(data.diagnostics);
  renderFailures(data.failureReasons);
  renderHistory(data.recentEvents);
  const from=data.recordedFrom?date(data.recordedFrom):'لم يبدأ القياس بعد';
  $('analyticsScope').textContent=
   'التخزين المسجل '+fmt(data.totals.storedBytes)+
   '، والملفات المكتملة المتحقق منها '+fmt(data.totals.verifiedBytes)+
   '. السرعة: متوسط وقت كل جزء (قراءة + رفع + تحقق + حفظ)، وليست سرعة الإنترنت اللحظية.'+
   ' بداية قياس السرعة: '+from+'. المساحة المتبقية الفعلية في S3 غير معروفة.';
  $('analyticsStatus').textContent=
   'آخر تحديث '+date(new Date().toISOString())+
   ' · '+number(data.totals.seasonCount)+' موسم · '+
   number(data.totals.transferSamples)+' قياس سرعة'+
   (data.seasonSummariesLimited?' · المعروض أول 100 موسم':'')+
   ' · دون إجراء أي تنزيل';
 }catch{
  $('analyticsStatus').textContent=
   'تعذر قراءة الإحصائيات الآن. عمليات النقل وتشغيل العملاء لم تتغير.';
  if($('analyticsSeasons').childElementCount===0)
   placeholder('analyticsSeasons','الخدمة غير متاحة حاليًا.');
 }finally{busy=false;$('analyticsRefresh').disabled=false}
}
$('analyticsRefresh').addEventListener('click',reloadAnalytics);
reloadAnalytics();
setInterval(reloadAnalytics,30000);
})();