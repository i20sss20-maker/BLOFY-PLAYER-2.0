// Unified, owner-authenticated, read-only operations dashboard.
// It never starts jobs, retries failures or probes upstream media.
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const node=(tag,cls,value)=>{
 const n=document.createElement(tag);
 if(cls)n.className=cls;
 if(value!==undefined)n.textContent=String(value);
 return n;
};
const number=value=>value===null||value===undefined?'—':
 Number(value).toLocaleString('en-US');
const byteSize=value=>{
 if(value===null||value===undefined||!Number.isFinite(Number(value)))
  return 'غير متاح';
 let n=Number(value);
 for(const u of ['B','KB','MB','GB','TB']){
  if(n<1024||u==='TB')return n.toLocaleString('en-US',{
   maximumFractionDigits:u==='B'?0:2})+' '+u;
  n/=1024;
 }
};
const descriptions={
 private_storage_unhealthy:'تعذر التحقق من التخزين الخاص أو قاعدة البيانات.',
 season_failed_episodes:'حلقات مسجلة بحالة فشل وتحتاج مراجعة.',
 movie_failed_copies:'عمليات أفلام غير مكتملة في السجلات.',
 critical_episode_attention:'حلقات تتطلب مراجعة هامة للسلامة أو الترخيص.',
 some_sources_unavailable:'بيانات بعض الأقسام غير متاحة؛ الأرقام المعروضة جزئية.'
};
const alertNames={
 transient_failure:'تعثر مؤقت',needs_manual_integrity_or_rights_review:
  'مراجعة سلامة أو ترخيص',possible_stale_running_state:'حالة عامل قديمة',
 paused_for_review:'توقف للمراجعة',partial_checkpoint_waiting:'حفظ جزئي في الانتظار'
};
const tiers={critical:'critical',warning:'warning',notice:'notice',info:'info'};
let pending=false,lastSuccess=0;
function setBadge(id,label,state){
 const el=$(id);
 el.textContent=label;
 el.className='badge '+(state===true?'online':state===false?'offline':'pending');
}
function percent(s){
 const value=Number(s?.percent);
 return Number.isFinite(value)?Math.max(0,Math.min(100,value)):0;
}
function showStorage(storage){
 const panel=$('opsStorageBreakdown');
 if(!storage||!storage.combinedKnownBytesAvailable){
  panel.replaceChildren(node('p','muted',
   'جزء من سجلات التخزين غير متاح؛ لن نعرض مجموعًا غير مكتمل.'));
  return;
 }
 const total=Number(storage.combinedKnownBytes)||0;
 const categories=[
  ['أفلام متحقق منها',Number(storage.recordedMovieVerifiedBytes)||0],
  ['أجزاء حلقات مسجلة',Number(storage.recordedEpisodeBytes)||0]
 ];
 panel.replaceChildren(...categories.map(([label,bytes])=>{
  const row=node('div','ops-storage-row'),head=node('div','jobtop');
  head.append(node('span','',label),node('strong','',byteSize(bytes)));
  const bar=node('div','meter'),fill=node('div','fill');
  fill.style.width=(total?Math.round(bytes*100/total):0)+'%';
  bar.append(fill);row.append(head,bar);
  return row;
 }));
}
function openSeason(key){
 document.dispatchEvent(new CustomEvent('blofy:open-season-report',{
  detail:{seasonKey:key}}));
}
function showAlerts(data){
 const box=$('opsTopAlerts');
 const entries=[];
 for(const e of (Array.isArray(data?.incidents)?data.incidents:[]).slice(0,6)){
  if(!tiers[e.level])continue;
  entries.push({level:e.level,text:(descriptions[e.code]||'مراجعة السجلات')+
   (e.count?' ('+number(e.count)+')':'')});
 }
 for(const a of (data?.attention?.items||[]).slice(0,6)){
  if(!tiers[a.severity])continue;
  entries.push({level:a.severity,
   text:(alertNames[a.type]||'حالة تحتاج مراجعة')+' · '+a.seasonKey+
    ' · حلقة '+number(a.episodeNumber),
   seasonKey:a.seasonKey});
 }
 entries.sort((a,b)=>['critical','warning','notice','info'].indexOf(a.level)-
   ['critical','warning','notice','info'].indexOf(b.level));
 const limited=entries.slice(0,6);
 box.replaceChildren(...(limited.length?limited.map(item=>{
  const row=node('div','ops-alert ops-alert-'+item.level);
  row.append(node('span','',item.text));
  if(item.seasonKey){
   const button=node('button','','فتح التقرير');
   button.type='button';
   button.addEventListener('click',()=>openSeason(item.seasonKey));
   row.append(button);
  }
  return row;
 }):[node('p','muted',
   data?.partial?'لا تتوفر جميع مصادر التنبيهات.':
    'لا توجد تنبيهات مسجلة في العينة الحالية.')]));
}
function showSeasons(episodes){
 const box=$('opsSeasons');
 if(!episodes?.available){
  box.replaceChildren(node('p','muted',
   'تعذر قراءة ملخص المواسم من قاعدة البيانات.'));return;
 }
 const seasons=Array.isArray(episodes.seasonSummaries)?
  episodes.seasonSummaries.slice(0,8):[];
 box.replaceChildren(...(seasons.length?seasons.map(s=>{
  const card=node('article','ops-season-item');
  const head=node('div','jobtop');
  head.append(node('strong','',s.seasonKey),
   node('span','chip',number(s.verifiedCount)+' / '+
    number(s.episodeCount)+' حلقة'));
  const track=node('div','meter'),fill=node('div','fill');
  fill.style.width=percent(s)+'%';track.append(fill);
  const foot=node('div','row');
  foot.append(node('span','',number(percent(s))+'% من الحجم المعلن'),
   node('span','',byteSize(s.storedBytes)+' / '+byteSize(s.expectedBytes)));
  const btn=node('button','ops-season-open','عرض الموسم');
  btn.type='button';btn.addEventListener('click',()=>openSeason(s.seasonKey));
  card.append(head,track,foot);
  if(Number(s.failedCount)>0)card.append(
   node('p','ops-season-warning',
    number(s.failedCount)+' حلقة بحالة فشل'));
  card.append(btn);return card;
 }):[node('p','muted','لا توجد مواسم مسجلة حاليًا.')]));
}
function render(data){
 const movies=data.movies||{},seasons=data.seasons||{};
 $('opsMoviesVerified').textContent=number(movies.verifiedCount);
 $('opsEpisodesVerified').textContent=seasons.available?
  number(seasons.verifiedCount)+' / '+number(seasons.episodeCount):'—';
 $('opsSeasonsCount').textContent=number(seasons.seasonCount);
 $('opsSeriesCount').textContent=seasons.available?
  number(seasons.seriesCount)+(seasons.seriesCountPartial?' +':''):'—';
 $('opsFailedEpisodes').textContent=number(seasons.failedCount);
 $('opsKnownStorage').textContent=byteSize(
  data.storage?.combinedKnownBytes);
 const health=data.health||{};
 setBadge('opsPrivateStore',!health.available?'التخزين: بيانات غير متاحة':
  health.privateBucketAvailable?'التخزين: يستجيب':'التخزين: يحتاج فحصًا',
  health.available?health.privateBucketAvailable:null);
 setBadge('opsDatabase',!health.available?'قاعدة البيانات: غير معروفة':
  health.databaseAvailable?'قاعدة البيانات: تعمل':'قاعدة البيانات: تحتاج فحصًا',
  health.available?health.databaseAvailable:null);
 setBadge('opsMovieWorker',!health.available?'نقل الأفلام: غير معروف':
  health.movieWorkerActive?'نقل الأفلام: جارٍ':'نقل الأفلام: متوقف',
  !health.available?null:health.movieWorkerActive?true:null);
 setBadge('opsSeasonWorker',!seasons.available?'نقل المواسم: غير معروف':
  seasons.workerActive?'نقل المواسم: جارٍ':'نقل المواسم: متوقف',
  !seasons.available?null:seasons.workerActive?true:null);
 showStorage(data.storage);
 showAlerts(data);
 showSeasons(seasons);
 $('opsScope').textContent=seasons.seriesCountPartial?
  'عدد المسلسلات الظاهر محسوب من عينة المواسم التي أعادتها الخدمة، وقد توجد مسلسلات أخرى خارج العينة. لم نستخدم بيانات تقديرية لإكمال العدد.':
  'الأفلام من سجل النسخ الخاصة المتحقق منها، والحلقات والمواسم من PostgreSQL. الأرقام لا تشمل مكتبة المصدر بكاملها أو الملفات خارج نطاق النظام التجريبي.';
 const incomplete=data.partial===true;
 $('opsStatus').textContent=(incomplete?'بيانات جزئية · ':'جميع الأقسام متاحة · ')+
  'آخر تحديث '+new Date(data.checkedAt||Date.now())
   .toLocaleTimeString('ar-SA')+
  (incomplete?' · مصادر غير متاحة: '+(data.unavailableSources||[]).join('، '):'')+
  ' · قراءة فقط، دون بدء نقل أو فحص مصادر الفيديو';
}
async function refresh(){
 if(pending||document.hidden)return;
 pending=true;$('opsRefresh').disabled=true;
 $('opsStatus').textContent='جارٍ تحديث لوحة المتابعة الموحدة…';
 try{
  const response=await fetch('/api/v1/admin/content-hub/overview',{
   credentials:'same-origin',cache:'no-store'});
  if(response.status===401){location.assign('/admin');return}
  if(!response.ok)throw Error('لم تتوفر بيانات لوحة المتابعة حاليًا.');
  const data=await response.json();
  if(data.ok!==true||data.readOnly!==true||
     data.automaticDownload!==false||
     data.automaticRetry!==false)
   throw Error('رد لوحة المتابعة غير مكتمل.');
  render(data);lastSuccess=Date.now();
 }catch(e){
  $('opsStatus').textContent=e.message||
   'تعذر الاتصال بلوحة المتابعة؛ بيانات العرض السابقة قديمة.';
 }finally{pending=false;$('opsRefresh').disabled=false}
}
$('opsRefresh').addEventListener('click',()=>void refresh());
document.addEventListener('visibilitychange',()=>{
 if(!document.hidden&&Date.now()-lastSuccess>60000)void refresh();
});
setInterval(()=>{if(!document.hidden)void refresh()},60000);
void refresh();
})();
