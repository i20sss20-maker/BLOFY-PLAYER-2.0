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
let page=1,working=false,revision=0,lastSnapshot=null;
let qaBusy=false;
const deviceSeasonValid=/^series_[1-9][0-9]{0,14}_s[0-9]{1,3}$/;
const deviceNames={android:'Android',android_tv:'Android TV',windows:'Windows'};
async function downloadPrivateDeviceQa(seasonKey){
 if(qaBusy||!deviceSeasonValid.test(String(seasonKey||'')))return;
 const platform=$('seasonDeviceQaPlatform').value;
 const rawPage=$('seasonDeviceQaPage').value;
 const episodePage=Number(rawPage);
 if(!Object.hasOwn(deviceNames,platform)||!/^\d{1,5}$/.test(rawPage)||
    !Number.isSafeInteger(episodePage)||episodePage<1||episodePage>20000){
  $('seasonDeviceQaStatus').textContent=
   'اختر نوع الجهاز وصفحة حلقات صحيحة بين 1 و20000.';
  return;
 }
 qaBusy=true;
 $('seasonDeviceQaStatus').textContent='جارٍ تجهيز خطة '+deviceNames[platform]+
  ' للموسم '+seasonKey+' من البيانات الخاصة…';
 try{
  const endpoint='/api/v1/admin/content-hub/seasons/device-qa/'+
   platform+'/'+seasonKey+'/page/'+episodePage;
  const response=await fetch(endpoint,{
   method:'GET',credentials:'same-origin',cache:'no-store',
   headers:{'x-blofy-owner-action':'prepare-private-device-qa'},
   signal:AbortSignal.timeout(12000)
  });
  if(response.status===401){location.assign('/admin');return}
  if(!response.ok)throw Error('تعذر قراءة خطة الجهاز ('+response.status+').');
  const data=await response.json();
  if(data?.ok!==true||data.schema!=='blofy.private-device-qa-manifest'||
     data.version!==1||data.readOnly!==true||data.privateOnly!==true||
     data.platform!==platform||data.seasonKey!==seasonKey||
     data.page!==episodePage||data.customerCutover!==false||
     data.playableMediaUrlsIncluded!==false||
     data.releaseToSubscribersApproved!==false||
     data.appIntegrationCompleted!==false||
     !Array.isArray(data.episodes)||data.episodes.length>50)
   throw Error('الخطة المستلمة غير آمنة أو غير مكتملة.');
  const json=JSON.stringify(data,null,2)+'\n';
  const url=URL.createObjectURL(new Blob([json],{
   type:'application/json;charset=utf-8'
  }));
  try{
   const anchor=create('a');
   anchor.href=url;
   anchor.download='BLOFY-private-device-qa-'+platform+'-'+seasonKey+
    '-p'+episodePage+'.json';
   document.body.append(anchor);anchor.click();anchor.remove();
  }finally{setTimeout(()=>URL.revokeObjectURL(url),2000)}
  $('seasonDeviceQaStatus').textContent=
   '✅ تم تجهيز خطة اختبار '+deviceNames[platform]+
   ' لعدد '+fmt(data.totalShown)+' حلقة في الصفحة '+fmt(episodePage)+
   '؛ المرشحة للاختبار الخاص: '+fmt(data.candidateCount)+
   '. لا يحتوي الملف روابط تشغيل أو صلاحيات دخول ولا يربط التطبيق تلقائيًا.';
 }catch(error){
  $('seasonDeviceQaStatus').textContent=error.message||
   'تعذر تجهيز خطة اختبار الأجهزة؛ لم تتغير البيانات.';
 }finally{qaBusy=false}
}

const reasonNames={
 no_registered_episodes:'لا توجد حلقات مدرجة',
 manifest_status_unavailable:'بيانات إثبات التخزين غير متاحة',
 owner_av_reviews_unavailable:'سجل مراجعة الصورة والصوت غير متاح',
 registered_episode_failures:'توجد حلقات فشلت',
 registered_episodes_not_finished:'يوجد نقل أو انتظار لم يكتمل',
 storage_state_inconsistent:'تعارض بين حالة الملف وقائمة النقل',
 not_all_registered_episodes_storage_verified:'لم يتحقق تخزين جميع الحلقات المدرجة',
 owner_av_review_incomplete:'توجد حلقات لم تراجع صورتها وصوتها يدويًا',
 invalid_database_accounting:'أرقام قاعدة البيانات غير متطابقة'
};
function gateLabel(gate){
 return gate?.canConsiderPrivateDeviceTest===true&&
  gate.customerReleaseApproved===false&&
  gate.publishToSubscribers===false?
  '✅ مرشح لاختبار الأجهزة الخاص فقط (وليس للإطلاق)':
  '⛔ يحتاج مراجعات قبل اختبار الأجهزة';
}
function renderDecision(data){
 const gate=data.global?.privateDeviceTestGate;
 const label=gateLabel(gate);
 const reasons=Array.isArray(gate?.blockingReasons)?
  gate.blockingReasons.slice(0,12).map(x=>
   reasonNames[x]||'سبب آخر يتطلب المراجعة'):['بيانات قرار الاختبار غير متاحة'];
 $('seasonReadinessDecision').textContent=label+' — '+
  (reasons.length?reasons.join('، '):
   'الملفات المدرجة راجعها المالك يدويًا وفق السجلات، لكن يلزم اختبار الأجهزة وحقوق العرض.');
}
// Exports only the already-loaded, owner-only current page. Never tries to
// fetch the provider catalog or claim that the CSV covers every season.
function csvCell(value){
 const raw=String(value??'').replace(/[\r\n\t]/g,' ');
 const safe=/^\s*[=+\-@]/u.test(raw)?"'"+raw:raw;
 return '"'+safe.replace(/"/g,'""')+'"';
}
function exportCurrentPage(){
 if(working||!lastSnapshot)return;
 const data=lastSnapshot;
 if(data.readOnly!==true||data.customerReleaseApproved!==false||
    data.privateDeviceTestingOnly!==true)return;
 const cols=['record_type','season_key','registered_episodes',
  'storage_verified','owner_av_manual_reviewed',
  'awaiting_manual_av_review','failed','queued','paused','running',
  'inconsistent_storage_state','private_device_test_candidate',
  'customer_release_approved','review_reasons','report_page',
  'more_season_pages_exist','coverage_scope','snapshot_at'];
 const format=(row,type,key)=>[
  type,key,row.registeredEpisodes,row.storageVerifiedEpisodes,
  row.ownerAvReviewedEpisodes,row.verifiedAwaitingOwnerAv,
  row.failedEpisodes,row.queuedEpisodes,row.pausedEpisodes,
  row.runningEpisodes,row.inconsistentVerifiedQueueEpisodes,
  row.privateDeviceTestGate?.canConsiderPrivateDeviceTest===true?'yes':'no',
  'no',(row.privateDeviceTestGate?.blockingReasons||[]).join(';'),
  data.page,data.hasNext?'yes':'no',
  'registered_private_queue_only',data.snapshotAt||'unknown'
 ];
 const entries=[format(data.global,'global_totals','all_registered_seasons'),
  ...data.seasons.filter(row=>seasonValid.test(
   String(row?.seasonKey||''))).slice(0,20).map(row=>
   format(row,'season',row.seasonKey))];
 const csv='\ufeff'+[cols,...entries].map(
  row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
 const objectUrl=URL.createObjectURL(new Blob([csv],{
  type:'text/csv;charset=utf-8'
 }));
 try{
  const a=create('a');
  a.href=objectUrl;
  a.download='BLOFY-private-readiness-page-'+data.page+'.csv';
  document.body.append(a);
  a.click();
  a.remove();
 }finally{
  // Browser downloads can continue asynchronously after the click event.
  // Release the local blob URL after the browser has begun the download.
  setTimeout(()=>URL.revokeObjectURL(objectUrl),2000);
 }
 $('seasonReadinessStatus').textContent=
  'تم تجهيز CSV لصفحة '+fmt(data.page)+
  ' فقط، إضافة إلى الإجماليات المسجلة. التقرير لا يمنح موافقة نشر.';
}
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
 if(deviceSeasonValid.test(String(row.seasonKey||''))){
  const qaButton=create('button','season-device-qa-button',
   'تجهيز ملف اختبار الجهاز');
  qaButton.type='button';
  qaButton.addEventListener('click',()=>{void downloadPrivateDeviceQa(row.seasonKey)});
  actions.append(qaButton);
 }
 const decision=create('span','season-readiness-gate-label',
  gateLabel(row.privateDeviceTestGate));
 actions.append(decision);
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
 working=true;lastSnapshot=null;const serial=++revision;
 const buttons=['seasonReadinessRefresh','seasonReadinessPrev',
  'seasonReadinessNext'];
 for(const id of buttons)$(id).disabled=true;
 $('seasonReadinessExport').disabled=true;
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
     data.storageRequests!==0||data.seasons.length>20||
     data.privateDeviceTestingOnly!==true||
     data.customerReleaseApproved!==false)
   throw Error('بيانات الجاهزية ناقصة أو خارج نطاق المكتبة الخاصة.');
  if(serial!==revision)return;
  page=targetPage;
  lastSnapshot=data;
  const g=data.global;
  renderDecision(data);
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
   'تقرير جاهزية قاعدة البيانات مُحدّث. أي ترشيح لاختبار الأجهزة خاص فقط، ولا يمثل موافقة للنشر أو تحقق حقوق التوزيع.';
 }catch(error){
  if(serial!==revision)return;
  $('seasonReadinessStatus').textContent=error.message||
   'تعذر قراءة تقرير الجاهزية دون تغيير أي بيانات.';
 }finally{
  working=false;
  $('seasonReadinessRefresh').disabled=false;
  $('seasonReadinessExport').disabled=working||!lastSnapshot;
 }
}
$('seasonReadinessExport').addEventListener('click',exportCurrentPage);
$('seasonReadinessRefresh').addEventListener('click',()=>load(page));
$('seasonReadinessPrev').addEventListener('click',()=>load(page-1));
$('seasonReadinessNext').addEventListener('click',()=>load(page+1));
// No background polling, no automatic media reads or writes.
void load(1);
})();
