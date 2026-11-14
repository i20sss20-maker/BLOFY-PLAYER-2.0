// Owner-only read-only readiness of the entire *registered* episode queue.
// Never infer upstream source completeness or codec/audio validity from DB.
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const create=(tag,className,text)=>{
 const node=document.createElement(tag);
 if(className)node.className=className;
 if(text!==undefined)node.textContent=String(text);
 return node;
};
const fmt=value=>Number(value||0).toLocaleString('ar-SA');
const seasonValid=/^[a-z0-9][a-z0-9_-]{2,63}$/;
let page=1,working=false,revision=0;
function tile(label,value,attention=false){
 const box=create('article','season-readiness-tile'+
  (attention?' season-readiness-attention':''));
 box.append(create('small','',label),create('strong','',fmt(value)));
 return box;
}
function showIssues(data){
 const items=[],g=data.global;
 if(!data.manifestStateAvailable)
  items.push('سجل التحقق من النسخ غير متاح؛ لا يمكن تحديد الحلقات التي اكتمل تحقق ملفاتها.');
 if(!data.ownerReviewSchemaAvailable)
  items.push('لم يُنشأ سجل مراجعة الصورة والصوت بعد، أو تعذرت قراءته. لا نعتبر أي مراجعة مؤكدة.');
 if(g.inconsistentVerifiedQueueEpisodes>0)
  items.push('يوجد '+fmt(g.inconsistentVerifiedQueueEpisodes)+
   ' حلقة موسومة مكتملة في قائمة النقل، لكن تأكيد النسخة المقابل غير موجود أو غير مكتمل.');
 if(g.failedEpisodes>0)
  items.push('توجد '+fmt(g.failedEpisodes)+' حلقة فشلت في قائمة النقل، وتحتاج مراجعة السبب.');
 if(g.verifiedAwaitingOwnerAv>0)
  items.push('توجد '+fmt(g.verifiedAwaitingOwnerAv)+
   ' حلقة محفوظة ومتحقق منها لكنها لم تُراجع للصورة والصوت يدويًا.');
 if(!g.registeredEpisodes)
  items.push('لا توجد حلقات مدرجة في قائمة النقل الخاصة حتى الآن.');
 $('seasonReadinessWarnings').replaceChildren(...(items.length?
  items.map(t=>create('p','season-readiness-warning',t)):
  [create('p','muted','لا توجد تحذيرات في سجلات الحلقات المدرجة حاليًا.')]));
}
function seasonTile(row){
 const container=create('article','season-readiness-row');
 const head=create('div','season-readiness-row-head');
 head.append(create('strong','',row.seasonKey),
  create('span','',
   fmt(row.storageVerifiedEpisodes)+'/'+fmt(row.registeredEpisodes)+
   ' حلقة متحقق من تخزينها'));
 const stats=create('div','season-readiness-row-stats');
 const items=[
  ['مراجعة الصورة والصوت',fmt(row.ownerAvReviewedEpisodes)+'/'+
   fmt(row.storageVerifiedEpisodes)+' من المكتملة'],
  ['تنتظر مراجعة يدوية',fmt(row.verifiedAwaitingOwnerAv)],
  ['فشلت',fmt(row.failedEpisodes)],
  ['قيد النقل أو تنتظر',fmt(row.queuedEpisodes+
   row.pausedEpisodes+row.runningEpisodes)],
  ['تعارض حالة التخزين',fmt(row.inconsistentVerifiedQueueEpisodes)]
 ];
 for(const [label,value] of items){
  const segment=create('span','');
  segment.append(create('small','',label),create('b','',value));
  stats.append(segment);
 }
 const track=create('div','season-readiness-progress');
 const fill=create('div','season-readiness-progress-fill');
 fill.style.width=Math.max(0,Math.min(100,Number(row.storageVerificationPercent)||0))+'%';
 track.setAttribute('role','progressbar');
 track.setAttribute('aria-valuemin','0');
 track.setAttribute('aria-valuemax','100');
 track.setAttribute('aria-valuenow',String(row.storageVerificationPercent));
 track.setAttribute('aria-label','نسبة اكتمال التحقق من الحلقات المدرجة');
 track.append(fill);
 const actions=create('div','season-readiness-row-actions');
 const report=create('button','','تقرير الموسم والحلقات');
 report.type='button';
 report.addEventListener('click',()=>{
  if(!seasonValid.test(String(row.seasonKey||'')))return;
  document.dispatchEvent(new CustomEvent('blofy:open-season-report',{
   detail:{seasonKey:row.seasonKey}}));
 });
 actions.append(report);
 if(row.verifiedAwaitingOwnerAv>0){
  actions.append(create('span','season-readiness-review-hint',
   'افتح تفاصيل الحلقة المكتملة لمراجعة الصورة والصوت يدويًا.'));
 }
 if(row.failedEpisodes>0){
  actions.append(create('span','season-readiness-failed-hint',
   'ابدأ بمراجعة فشل النقل قبل اختيار أي إجراء.'));
 }
 container.append(head,stats,track,actions);
 return container;
}
async function load(targetPage=page){
 if(working||!Number.isSafeInteger(targetPage)||targetPage<1||
    targetPage>10000)return;
 working=true;const serial=++revision;
 const buttons=['seasonReadinessRefresh','seasonReadinessPrev',
  'seasonReadinessNext'];
 for(const id of buttons)$(id).disabled=true;
 $('seasonReadinessStatus').textContent='جارٍ جمع إحصائية الحلقات المدرجة من PostgreSQL…';
 try{
  const response=await fetch(
   '/api/v1/admin/content-hub/seasons/readiness/page/'+targetPage,{
    method:'GET',credentials:'same-origin',cache:'no-store',
    headers:{'x-blofy-owner-action':'review-private-seasons'},
    signal:AbortSignal.timeout(12000)
   });
  if(response.status===401){location.assign('/admin');return}
  if(!response.ok)throw Error('تعذر قراءة تقرير الجاهزية ('+response.status+').');
  const data=await response.json();
  if(data.ok!==true||data.readOnly!==true||data.privateOnly!==true||
     data.databaseSnapshotOnly!==true||
     data.scope!=='all_registered_private_season_queue_episodes_only'||
     !data.global||!Array.isArray(data.seasons)||data.page!==targetPage||
     data.automaticStart!==false||data.providerMediaRequests!==0||
     data.storageRequests!==0||data.seasons.length>20)
   throw Error('بيانات الجاهزية ناقصة أو خارج نطاق المكتبة الخاصة.');
  if(serial!==revision)return;
  page=targetPage;
  const g=data.global;
  $('seasonReadinessKpis').replaceChildren(
   tile('المواسم المسجلة',g.registeredSeasons),
   tile('الحلقات المدرجة',g.registeredEpisodes),
   tile('متحقق من حفظها',g.storageVerifiedEpisodes),
   tile('الصورة والصوت راجعهما المالك يدويًا',g.ownerAvReviewedEpisodes),
   tile('بانتظار مراجعة الصورة والصوت',g.verifiedAwaitingOwnerAv,
    g.verifiedAwaitingOwnerAv>0),
   tile('فشلت أو تعثرت',g.failedEpisodes,g.failedEpisodes>0),
   tile('حالات تخزين غير متطابقة',g.inconsistentVerifiedQueueEpisodes,
    g.inconsistentVerifiedQueueEpisodes>0));
  showIssues(data);
  const validRows=data.seasons.filter(row=>seasonValid.test(
   String(row?.seasonKey||''))).slice(0,20);
  $('seasonReadinessRows').replaceChildren(...(validRows.length?
   validRows.map(seasonTile):
   [create('p','muted','لا توجد مواسم أخرى في الصفحة الحالية.')]));
  $('seasonReadinessPage').textContent='الصفحة '+fmt(page)+
   ' · '+fmt(data.perPage)+' موسم كحد أقصى لكل صفحة';
  $('seasonReadinessScope').textContent=
   'الفحص يغطي '+fmt(g.registeredEpisodes)+' حلقة مدرجة في '+
   fmt(g.registeredSeasons)+' موسم مسجل، وليس مكتبة المصدر الكاملة.';
  $('seasonReadinessPrev').disabled=!data.hasPrevious;
  $('seasonReadinessNext').disabled=!data.hasNext;
  $('seasonReadinessStatus').textContent=
   'تقرير جاهزية قاعدة البيانات مُحدّث. التقييم لا يشمل فحص ملفات الصوت والفيديو آليًا ولا يعني جاهزية نشرها في التطبيقات.';
 }catch(error){
  if(serial!==revision)return;
  $('seasonReadinessStatus').textContent=error.message||
   'تعذر قراءة تقرير الجاهزية دون تغيير أي بيانات.';
 }finally{
  working=false;
  $('seasonReadinessRefresh').disabled=false;
 }
}
$('seasonReadinessRefresh').addEventListener('click',()=>load(page));
$('seasonReadinessPrev').addEventListener('click',()=>load(page-1));
$('seasonReadinessNext').addEventListener('click',()=>load(page+1));
// No background polling, no automatic media reads or writes.
void load(1);
})();
