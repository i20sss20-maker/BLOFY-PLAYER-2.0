/* Owner-authenticated BLOFY STORE sales desk, strictly read-only. */
(()=>{
 'use strict';
 const $=id=>document.getElementById(id);
 if(!$('one-store-sales-form'))return;
 const form=$('one-store-sales-form'),filter=$('one-store-sales-filter'),
  search=$('one-store-sales-search'),refresh=$('one-store-sales-refresh'),
  prev=$('one-store-sales-prev'),next=$('one-store-sales-next'),
  rows=$('one-store-sales-rows'),status=$('one-store-sales-status'),
  pageLabel=$('one-store-sales-page');
 const fmt=new Intl.NumberFormat('en-US');
 const statusText={paid:'مدفوع (مسجل)',pending:'قيد تأكيد الدفع',
  failed:'فشل الدفع',cancelled:'ملغي'};
 const productText={'cart':'سلة متعددة المنتجات','bundle-2y':'باقة مشتركة',
  renewal:'تجديد الكود الحالي'};
 let page=1,pageSize=25,matched=0,version=0,controller=null;
 function money(value){
  const text=String(value??'');
  if(!/^\d{1,20}$/.test(text))return '—';
  const cents=BigInt(text);
  return fmt.format(cents/100n)+'.'+String(cents%100n).padStart(2,'0')+' ر.س';
 }
 function count(value){
  const n=Number(value);
  return Number.isSafeInteger(n)&&n>=0?fmt.format(n):'—';
 }
 function day(value){
  if(!value)return '—';
  const date=new Date(value);
  return Number.isFinite(date.getTime())?
   date.toLocaleString('ar-SA',{timeZone:'Asia/Riyadh',year:'numeric',
    month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
 }
 function cell(tag,value){
  const el=document.createElement(tag);el.textContent=String(value??'—');return el;
 }
 function clearSummary(){
  for(const id of ['gross','30d','paid','pending','overdue','failed'])
   $('one-store-sales-'+id).textContent='—';
 }
 function showSummary(data){
  $('one-store-sales-gross').textContent=money(data.paidAmountMinor);
  $('one-store-sales-30d').textContent=money(data.paidLast30Minor);
  $('one-store-sales-paid').textContent=count(data.paid);
  $('one-store-sales-pending').textContent=count(data.pending);
  $('one-store-sales-overdue').textContent=count(data.pendingOver20m);
  const failed=Number(data.failed),cancelled=Number(data.cancelled);
  $('one-store-sales-failed').textContent=
   Number.isSafeInteger(failed)&&Number.isSafeInteger(cancelled)&&failed>=0&&cancelled>=0?
    count(failed+cancelled):'—';
 }
 function showStatus(text,error=false){
  status.textContent=text;status.dataset.error=String(error);
 }
 function showRows(data){
  rows.replaceChildren();
  const items=Array.isArray(data.items)?data.items:[];
  matched=Number.isSafeInteger(Number(data.matched))?Number(data.matched):0;
  pageSize=Number.isSafeInteger(Number(data.pageSize))&&Number(data.pageSize)>0?
   Number(data.pageSize):25;
  for(const item of items){
   const tr=document.createElement('tr');
   const who=cell('td',item.orderNumber||item.orderId||'—');
   who.append(cell('small',item.email||'طلب بدون بريد مرتبط'));
   const product=cell('td',productText[item.sku]||
    (item.channel==='xtream'?'Xtream BLOFY':'BLOFY STREAM'));
   const state=cell('td',statusText[item.status]||'غير معروف');
   const pendingTooLong=item.status==='pending'&&item.createdAt&&
    Date.now()-new Date(item.createdAt).getTime()>=20*60000;
   state.dataset.state=pendingTooLong?'overdue':item.status;
   if(pendingTooLong)state.append(cell('small','معلّق أكثر من 20 دقيقة'));
   tr.append(who,product,state,
    cell('td',item.currency==='SAR'?money(item.amountMinor):'عملة غير معروفة'),
    cell('td',day(item.paidAt||item.createdAt)));
   rows.append(tr);
  }
  if(!items.length){
   const tr=document.createElement('tr');
   const td=cell('td','لا توجد طلبات مطابقة لهذه الفلاتر.');
   td.colSpan=5;tr.append(td);rows.append(tr);
  }
  pageLabel.textContent='الصفحة '+count(page)+' · '+count(matched)+' طلب مطابق';
  prev.disabled=page<=1;next.disabled=page*pageSize>=matched;
 }
 async function load(){
  const serial=++version;
  controller?.abort();
  controller=new AbortController();
  const current=controller;
  refresh.disabled=true;prev.disabled=true;next.disabled=true;
  showStatus('جارٍ قراءة الطلبات المسجلة في متجر BLOFY…');
  try{
   const query=new URLSearchParams({view:'sales',status:filter.value,
    q:search.value.trim(),page:String(page)});
   const timer=window.setTimeout(()=>current.abort(),12000);
   let response;
   try{
    response=await fetch('/api/v1/admin/store/subscription-operations?'+query,{
     method:'GET',credentials:'same-origin',cache:'no-store',
     headers:{accept:'application/json'},signal:current.signal});
   }finally{window.clearTimeout(timer);}
   if(response.status===401)throw Error('انتهت جلسة المشرف. سجّل الدخول من /admin.');
   if(!response.ok)throw Error('تعذر الاتصال بسجل طلبات المتجر (HTTP '+response.status+').');
   const data=await response.json();
   if(!data||data.ok!==true||data.view!=='sales'||data.readOnly!==true||
      !data.sales||!Array.isArray(data.items))
    throw Error('الاستجابة الواردة من قاعدة المبيعات غير مكتملة.');
   if(serial!==version)return;
   showSummary(data.sales);showRows(data);
   showStatus('آخر تحديث '+new Date().toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'})+
    ' · قراءة فقط من سجلات طلبات المتجر'+
    (Number(data.sales.pendingOver20m)>0?
     ' · '+count(data.sales.pendingOver20m)+' طلب معلق أكثر من 20 دقيقة؛ راجع Geidea قبل إعادة الدفع.':''));
  }catch(error){
   if(serial!==version)return;
   clearSummary();matched=0;rows.replaceChildren();
   const tr=document.createElement('tr'),
    td=cell('td','تعذر قراءة البيانات؛ نتائج العرض السابقة غير معتمدة.');
   td.colSpan=5;tr.append(td);rows.append(tr);
   pageLabel.textContent='غير متاح';prev.disabled=true;next.disabled=true;
   showStatus(error?.name==='AbortError'?'انتهت مهلة قراءة الطلبات. أعد المحاولة.':
    String(error?.message||'تعذر الاتصال.'),true);
  }finally{
   if(serial===version){controller=null;refresh.disabled=false;}
  }
 }
 form.addEventListener('submit',event=>{event.preventDefault();page=1;void load();});
 filter.addEventListener('change',()=>{page=1;void load();});
 refresh.addEventListener('click',()=>void load());
 prev.addEventListener('click',()=>{if(page>1){page--;void load();}});
 next.addEventListener('click',()=>{if(page*pageSize<matched){page++;void load();}});
 window.addEventListener('pagehide',()=>controller?.abort());
 void load();
})();
