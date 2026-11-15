'use strict';
// Admin-only, READ-ONLY Xtream mirror dashboard.
// No source URLs, provider credentials, owner HMAC tokens, media bytes,
// background transfer requests or browser persistence.
(()=>{
 const el=id=>document.getElementById(id);
 const source=el('mirrorSource'),kind=el('mirrorKind'),state=el('mirrorState');
 if(!source||!kind||!state)return;
 const status=el('mirrorStatus'),stats=el('mirrorStats'),
  rows=el('mirrorRows'),paging=el('mirrorPage'),
  prev=el('mirrorPrev'),next=el('mirrorNext'),
  scans=el('mirrorScan'),transfers=el('mirrorTransfers'),
  preflight=el('mirrorDeploymentPreflight');
 const REF=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
 const PAGE=25;let cursor=0,history=[],nextCursor=null,busy=false;
 const stateLabels={
  needs_review:'بانتظار مراجعة حق التخزين',
  approved:'مراجع وحجمه مفحوص — لم يكتمل النسخ',
  copying:'نقل خاص جارٍ',
  verified:'نسخة محفوظة ببصمة تحقق',
  failed:'تعثر — يتطلب مراجعة'
 };
 const fmtBytes=n=>{
  const value=Number(n);
  if(!Number.isSafeInteger(value)||value<0)return 'غير معروف';
  if(value<1024)return value+' B';
  let num=value,idx=-1;
  const units=['KB','MB','GB','TB'];
  do{num/=1024;idx++}while(num>=1024&&idx<3);
  return num.toFixed(num>=10?1:2)+' '+units[idx];
 };
 const count=n=>(Number.isSafeInteger(Number(n))&&Number(n)>=0?
  Number(n):0).toLocaleString('en-US');
 const field=(label,value)=>{
  const article=document.createElement('article');
  const small=document.createElement('small');
  small.textContent=label;
  const strong=document.createElement('strong');
  strong.textContent=String(value);
  article.append(small,strong);return article;
 };
 const node=(className,value)=>{
  const div=document.createElement('div');
  div.className=className;div.textContent=String(value);return div;
 };
 async function get(url){
  const response=await fetch(url,{cache:'no-store',
   credentials:'same-origin',redirect:'error'});
  if(response.status===401){
   location.assign('/admin');throw Error('owner_session_required');
  }
  if(!response.ok)throw Error('admin_request_'+response.status);
  return response.json();
 }
 async function loadSources(){
  source.replaceChildren(new Option('مصدر saleh المصرّح فقط',''));
  try{
   const result=await get('/api/v1/admin/xtream/servers');
   const matches=(Array.isArray(result.items)?result.items:[]).filter(
    item=>String(item.name||'').trim().toLowerCase()==='saleh'&&
      REF.test(String(item.id||''))&&item.enabled!==false);
   for(const item of matches){
    const text='saleh · '+String(item.status||'غير معروف')+
      ' · '+String(item.id).slice(0,8);
    source.add(new Option(text,String(item.id)));
   }
   if(matches.length===1){
    source.value=String(matches[0].id);
    await refresh();
   }else if(!matches.length){
    status.textContent='لم يُعثر على مصدر saleh متاح. راجع إعدادات مصادر Xtream.';
   }else status.textContent='يوجد أكثر من مصدر saleh. اختر المصدر المعتمد دون تخمين.';
  }catch{
   status.textContent='تعذر قراءة المصادر. لن يبدأ أي نقل أو فحص للمصدر.';
  }
 }
 function clearResults(){
  stats.replaceChildren();
  rows.replaceChildren(node('placeholder','لم تُقرأ قائمة الملفات بعد.'));
  scans.textContent='لم تبدأ قراءة حالة الفهرسة.';
  transfers.textContent='لم تبدأ قراءة حدود النقل.';
  preflight.textContent='توافق قاعدة Xtream وContent Hub لم يُفحص بعد.';
  preflight.dataset.ready='false';
  paging.textContent='الصفحة 1';prev.disabled=true;next.disabled=true;
 }
 function selectedSource(){
  const value=source.value.trim();
  return REF.test(value)?value:null;
 }
 async function loadSummary(id){
  const [queue,series,movie,episode,readiness]=await Promise.allSettled([
   get('/api/v1/admin/xtream/mirror/queue/status?sourceId='+id),
   get('/api/v1/admin/xtream/mirror/series-status?sourceId='+id),
   get('/api/v1/admin/content-hub/mirror/movie/status'),
   get('/api/v1/admin/content-hub/mirror/episode/status'),
   get('/api/v1/admin/content-hub/mirror/deployment/preflight')
  ]);
  // Content Hub and activation can each have DATABASE_URL yet still
  // point to DIFFERENT PostgreSQL databases. Never confuse online
  // services or recorded manifest bytes with shared source access.
  const preflightData=readiness.status==='fulfilled'?
   readiness.value:null;
  const sameSource=preflightData?.sourceId===id;
  const checks=preflightData?.checks||{};
  const compatible=sameSource&&
    preflightData?.technicalPreflightPassed===true;
  preflight.dataset.ready=compatible?'technical-only':'false';
  if(!preflightData?.ok){
   preflight.textContent='⚠️ فحص توافق قواعد البيانات والتخزين غير متاح. '+
    'لا تشغّل النقل الآلي إلى أن يُثبت اتصال مصدر Xtream وContent Hub.';
  }else if(!sameSource){
   preflight.textContent='⛔ المصدر المعروض في إدارة Xtream لا يطابق المصدر '+
    'المثبت في خدمة Content Hub. النقل غير جاهز ويحتاج مراجعة ربط البيانات.';
  }else if(!compatible){
   const reasons=[];
   if(!checks.catalogVisibleOnHubConnection)reasons.push(
    'جداول Xtream أو طابور الملفات غير موجودة على اتصال قاعدة Content Hub');
   if(!checks.privateManifestTablesVisible)reasons.push(
    'جداول إثبات الملفات المحفوظة غير متاحة');
   if(!checks.sharedBudgetVisible)reasons.push(
    'جدول حصة النقل المشتركة لم يجهّز بعد');
   if(!checks.sourceOnline||!checks.sourceFresh)reasons.push(
    'المصدر غير متصل أو آخر فهرسة قديمة');
   if(!checks.privateStorageAccessible)reasons.push(
    'التخزين الخاص S3 غير جاهز');
   preflight.textContent='⛔ النقل غير جاهز تقنيًا: '+
    (reasons.join('؛ ')||'توجد شروط غير مستوفاة')+
    '. جميع عمليات النقل تبقى معطّلة حتى معالجة الأسباب.';
  }else{
   preflight.textContent='🟡 قاعدة Xtream والطابور وسجل نسخ S3 تبدو '+
    'متاحة من Content Hub. هذه نتيجة تقنية للقراءة فقط، وليست '+
    'موافقة على حقوق تخزين المحتوى أو تفعيل النقل للعملاء.';
  }
  if(queue.status==='fulfilled'&&queue.value?.ok===true){
   const data=queue.value,items=Array.isArray(data.queue)?data.queue:[];
   const total=items.reduce((n,x)=>n+Number(x.total||0),0);
   const verified=items.filter(x=>x.state==='verified')
    .reduce((n,x)=>n+Number(x.total||0),0);
   const stored=items.reduce((n,x)=>n+Number(x.verifiedBytes||0),0);
   const conflicts=items.reduce((n,x)=>n+Number(x.mappingConflicts||0),0);
   const failed=items.filter(x=>x.state==='failed')
    .reduce((n,x)=>n+Number(x.total||0),0);
   stats.replaceChildren(field('مرشحات مفهرسة',count(total)),
    field('ملفات سجلها مكتمل',count(verified)),
    field('حجم نسخ مؤكدة بالسجل',fmtBytes(stored)),
    field('بحاجة لمراجعة فشل / ارتباط',count(failed+conflicts)));
   const scansList=Array.isArray(data.scans)?data.scans:[];
   const scanRows=scansList.map(x=>
    (x.mediaKind==='movie'?'الأفلام':'الحلقات المفهرسة')+
    ': آخر معرّف '+count(x.cursor)+
    (x.completedDay?'، اكتمل المسح '+String(x.completedDay).slice(0,10):
     '، الفهرسة لم تكتمل')).join(' | ');
   scans.textContent=scanRows||'لم تُسجل دورة فهرسة بعد.';
  }else{
   stats.replaceChildren(field('حالة الطابور','غير متاح'));
   scans.textContent='تعذر قراءة حالة الفهرسة من الخدمة.';
  }
  if(series.status==='fulfilled'&&series.value?.ok){
   const x=series.value;
   const headline=x.code==='mirror_series_scan_not_started'?
    'لم تبدأ فهرسة الحلقات لكل مسلسل':
    'آخر مسلسل مفهرس #'+count(x.lastGatewayId)+
    (x.finishedLocalDay?' · آخر دورة '+x.finishedLocalDay:' · جارٍ الاستكمال');
   scans.textContent+=' | '+headline;
  }
  const active=[movie,episode].map((r,index)=>{
   const label=index===0?'الأفلام':'الحلقات';
   if(r.status!=='fulfilled'||r.value?.ok!==true)
    return label+': النقل التلقائي غير مفعّل أو الخدمة غير متاحة';
   const list=Array.isArray(r.value.dailyBudgets)?r.value.dailyBudgets:[];
   const latest=list[0];
   return label+': '+(r.value.running?'مشغول':'غير مشغول')+
    (latest?' · المحجوز آخر يوم '+fmtBytes(latest.bytesReserved||
      latest.reservedBytes||0):' · لم تُحجز دفعات بعد');
  });
  transfers.textContent=active.join(' | ')+
   ' — الحجز لا يعني نسخ تلك البايتات فعليًا.';
 }
 async function loadItems(id){
  const params=new URLSearchParams({sourceId:id,mediaKind:kind.value,
   state:state.value,afterGatewayId:String(cursor),limit:String(PAGE)});
  const data=await get('/api/v1/admin/xtream/mirror/queue/items?'+params);
  if(!data?.ok||!Array.isArray(data.items))throw Error('queue_invalid');
  const rendered=data.items.map(item=>{
   const row=node('mirror-row','');
   const title=document.createElement('strong');
   title.textContent=(item.title||'غير معنون')+' · #'+count(item.gatewayId);
   const progress=Number(item.copiedParts||0)*8*1024*1024;
   const copied=item.state==='verified'?Number(item.expectedBytes||0):
    Math.min(Number(item.expectedBytes)||0,progress);
   const desc=node('muted',(stateLabels[item.state]||'غير معروف')+
    ' · '+fmtBytes(item.expectedBytes)+' · أجزاء مسجلة '+
    count(item.copiedParts)+(item.expectedBytes?
    ' · '+Math.floor(copied*100/item.expectedBytes)+'%':''));
   row.append(title,desc);
   if(item.nextAttemptAfter&&item.state==='approved'){
    const parsed=new Date(item.nextAttemptAfter);
    if(Number.isFinite(parsed.getTime()))
     row.append(node('mirror-retry','اتصال المصدر تعثّر مؤقتًا · محاولة '+
      count(item.transientAttempts)+' من 3، التالية بعد '+
      parsed.toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'})));
   }
   if(item.mappingConflict===true)row.append(node('mirror-alert',
    'تحذير: تغيّر ارتباط معرّف الملف في المصدر. يتطلب مراجعة.'));
   if(item.copyError)row.append(node('mirror-alert',
    'سبب آخر تعثر: '+String(item.copyError).slice(0,100)));
   if(item.lastProbeError)row.append(node('mirror-alert',
    'فحص المصدر: '+String(item.lastProbeError).slice(0,100)));
   return row;
  });
  rows.replaceChildren(...(rendered.length?rendered:
   [node('placeholder','لا توجد ملفات تطابق الحالة المختارة في هذه الصفحة.')]));
  nextCursor=data.hasMore===true&&Number.isSafeInteger(data.nextCursor)?
   data.nextCursor:null;
  prev.disabled=history.length===0;next.disabled=nextCursor===null;
  paging.textContent='الصفحة '+count(history.length+1);
 }
 async function refresh({onlyItems=false}={}){
  const id=selectedSource();
  if(!id){clearResults();status.textContent='اختر مصدر saleh المعتمد أولًا.';return}
  if(busy)return;busy=true;
  el('mirrorRefresh').disabled=true;
  status.textContent='جارٍ قراءة سجلات PostgreSQL الخاصة دون الاتصال بوسائط Xtream…';
  try{
   if(!onlyItems)await loadSummary(id);
   await loadItems(id);
   status.textContent='تم تحديث سجلات الطابور للقراءة فقط. لا نقل أو اختبار وسائط.';
  }catch(error){
   status.textContent='تعذر قراءة بيانات الطابور، ربما الميزة غير منشورة أو الخدمة غير متاحة.';
   if(!onlyItems)clearResults();
  }finally{busy=false;el('mirrorRefresh').disabled=false}
 }
 function reset(){history=[];cursor=0;nextCursor=null;void refresh()}
 source.addEventListener('change',reset);
 kind.addEventListener('change',reset);
 state.addEventListener('change',reset);
 el('mirrorRefresh').addEventListener('click',()=>void refresh());
 prev.addEventListener('click',()=>{
  if(!history.length||busy)return;
  cursor=history.pop();void refresh({onlyItems:true});
 });
 next.addEventListener('click',()=>{
  if(nextCursor===null||busy)return;
  history.push(cursor);cursor=nextCursor;void refresh({onlyItems:true});
 });
 clearResults();void loadSources();
})();
