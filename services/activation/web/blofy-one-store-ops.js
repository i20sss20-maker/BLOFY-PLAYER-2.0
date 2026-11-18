/* BLOFY ONE subscriptions and same-code renewals: private read-only staff view. */
(() => {
 'use strict';
 const $=id=>document.getElementById(id);
 if(!$('one-renewal-ops-form'))return;
 const form=$('one-renewal-ops-form'),view=$('one-renewal-view');
 const filter=$('one-renewal-filter'),search=$('one-renewal-search');
 const refresh=$('one-renewal-ops-refresh'),prev=$('one-renewal-prev'),next=$('one-renewal-next');
 const status=$('one-renewal-status'),tbody=$('one-renewal-rows'),heading=$('one-renewal-head');
 const pageLabel=$('one-renewal-page');
 const formats=new Intl.NumberFormat('en-US');
 const statusNames={
  active:'نشط',expiring:'ينتهي قريبًا',expired:'منتهي',unused:'لم يُفعّل',
  revoked:'ملغى',disabled:'يحتاج مراجعة',paid:'مدفوع',pending:'قيد الدفع',
  failed:'فشل',cancelled:'ملغى'
 };
 let page=1,matched=0,size=25,requestVersion=0,loading=false;
 const cell=(tag,value)=>{
  const e=document.createElement(tag);
  e.textContent=String(value??'—');
  return e;
 };
 const day=v=>{
  if(!v)return '—';const d=new Date(v);
  return Number.isFinite(d.getTime())?d.toLocaleDateString('ar-SA',
   {timeZone:'Asia/Riyadh',year:'numeric',month:'short',day:'numeric'}):'—';
 };
 const money=minor=>Number.isSafeInteger(minor)&&minor>=0
  ?(minor/100).toLocaleString('ar-SA',{minimumFractionDigits:2,maximumFractionDigits:2})+' ر.س':'—';
 const int=v=>Number.isSafeInteger(Number(v))&&Number(v)>=0?formats.format(Number(v)):'—';
 function setStatus(text,error=false){
  status.textContent=text;status.dataset.error=String(error);
 }
 function updateStatuses(){
  const all=view.value==='renewals';
  const options=all?
   [['all','كل الحالات'],['paid','مدفوع'],['pending','قيد الدفع'],
    ['failed','فشل'],['cancelled','ملغى']]:
   [['all','كل الحالات'],['active','نشط'],['expiring','ينتهي خلال 7 أيام'],
    ['expired','منتهي'],['unused','لم يُفعّل'],
    ['revoked','ملغى'],['disabled','يحتاج مراجعة']];
  filter.replaceChildren(...options.map(([value,title])=>{
   const item=cell('option',title);item.value=value;return item;
  }));
  heading.replaceChildren(...(all?
   ['الطلب / العميل','الكود المخفي','نوع التجديد','حالة الدفع','تاريخ الطلب / المدفوع']:
   ['بريد العميل','الكود المخفي','المنتج','الحالة','انتهاء الاشتراك']
  ).map(v=>cell('th',v)));
 }
 function render(data){
  tbody.replaceChildren();
  const rows=Array.isArray(data.items)?data.items:[];
  matched=Number(data.matched)||0;
  size=Number(data.pageSize)||25;
  for(const item of rows){
   const tr=document.createElement('tr');
   if(view.value==='renewals'){
    const order=cell('td',item.orderNumber||item.orderId);
    order.append(cell('small',item.email||''));
    const paid=cell('td',statusNames[item.status]||item.status);
    paid.dataset.state=item.status==='pending'&&
      item.createdAt&&Date.now()-new Date(item.createdAt).getTime()>20*60000
      ?'overdue':item.status;
    const details=cell('td',(item.channel==='app'?'STREAM':'Xtream')+' · '+item.durationDays+' يومًا');
    details.append(cell('small',money(item.amountMinor)));
    tr.append(order,cell('td',item.codeHint),details,paid,
      cell('td',day(item.paidAt||item.createdAt)));
   }else{
    const name=cell('td',item.email);
    const badge=cell('td',statusNames[item.status]||item.status);
    badge.dataset.state=item.status;
    tr.append(name,cell('td',item.codeHint),
      cell('td',item.channel==='app'?'BLOFY STREAM':'Xtream'),
      badge,cell('td',day(item.expiresAt)));
   }
   tbody.append(tr);
  }
  if(!rows.length){
   const tr=document.createElement('tr'),td=cell('td','لا توجد سجلات مطابقة لهذه الفلاتر.');
   td.colSpan=5;tr.append(td);tbody.append(tr);
  }
  pageLabel.textContent='الصفحة '+int(page)+' · '+int(matched)+' نتيجة مطابقة';
  prev.disabled=page<=1;
  next.disabled=page*size>=matched;
 }
 async function load(){
  if(loading)return;
  loading=true;const serial=++requestVersion;
  refresh.disabled=true;prev.disabled=true;next.disabled=true;
  setStatus('جارٍ فحص الاشتراكات والتجديدات من قاعدة المتجر الموثّقة…');
  try{
   const params=new URLSearchParams({
    view:view.value,status:filter.value,q:search.value.trim(),page:String(page)
   });
   const controller=new AbortController();
   const timer=window.setTimeout(()=>controller.abort(),12000);
   let response;
   try{response=await fetch('/api/v1/admin/store/subscription-operations?'+params,
     {method:'GET',cache:'no-store',credentials:'same-origin',
      headers:{accept:'application/json'},signal:controller.signal});}
   finally{window.clearTimeout(timer);}
   if(response.status===401)throw Error('انتهت جلسة المشرف. افتح /admin وسجّل الدخول.');
   if(!response.ok)throw Error('تعذّر قراءة قاعدة المتجر (HTTP '+response.status+').');
   const data=await response.json();
   if(!data||data.ok!==true||data.view!==view.value||!data.readOnly)
    throw Error('رد غير متوقع من خدمة الاشتراكات.');
   if(serial!==requestVersion)return;
   const r=data.renewals||{};
   $('one-renewal-paid').textContent=int(r.paid);
   $('one-renewal-pending').textContent=int(r.pending);
   $('one-renewal-overdue').textContent=int(r.pendingOver20m);
   if(data.subscriptions)
    $('one-renewal-expiring').textContent=int(data.subscriptions.expiring);
   render(data);
   const overdue=Number(r.pendingOver20m)||0;
   setStatus('آخر تحديث '+new Date().toLocaleString('ar-SA')+
     ' · قراءة فقط من سجلات Geidea واشتراكات المتجر'+
     (overdue>0?' · تنبيه: '+int(overdue)+' تجديدًا معلّقًا لأكثر من 20 دقيقة، تحقق من دفعه قبل أي إجراء.':''));
  }catch(e){
   if(serial!==requestVersion)return;
   tbody.replaceChildren();
   const tr=document.createElement('tr'),td=cell('td','تعذّر تحميل البيانات. استخدم زر التحديث.');
   td.colSpan=5;tr.append(td);tbody.append(tr);
   setStatus(e.name==='AbortError'?'انتهت مهلة فحص السجلات. أعد المحاولة.':e.message,true);
  }finally{loading=false;refresh.disabled=false;}
 }
 view.addEventListener('change',()=>{page=1;updateStatuses();void load();});
 form.addEventListener('submit',e=>{e.preventDefault();page=1;void load();});
 refresh.addEventListener('click',()=>void load());
 prev.addEventListener('click',()=>{if(page>1){page--;void load();}});
 next.addEventListener('click',()=>{if(page*size<matched){page++;void load();}});
 updateStatuses();void load();
})();
