/* Owner-only support ledger. No voucher plaintext or customer PII in storage,
   browser URL, telemetry, HTML templates or automatic bulk responses. */
(() => {
 'use strict';
 const start=()=>{
  const $=id=>document.getElementById(id);
  if(!$('one-code-register'))return;
  const table=$('one-register-rows'),status=$('one-register-status'),
    dialog=$('one-register-dialog'),details=$('one-register-detail'),
    modalStatus=$('one-register-detail-status'),secret=$('one-register-secret'),
    codeBox=$('one-register-secret-code');
  let offset=0,matched=0,rows=[],selected=null,loading=false,secretTimeout=null,
    fetchAbort=null,loaded=false;
  const PAGE=25,UUID=/^[0-9a-f-]{36}$/i;
  const labels={trial:'تجريبي مجاني',paid:'مدفوع / مخزون',manual:'يدوي أو قديم',
    ready:'متوفر',delivered:'تم التسليم (لم يُفعّل)',active:'مفعّل',expired:'منتهي',revoked:'ملغى'};
  const dates=value=>value?new Date(value).toLocaleString('ar-SA',{
   dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Riyadh'
  }):'لم يبدأ بعد';
  const str=value=>String(value??'');
  function node(tag,text='',className){
   const element=document.createElement(tag);
   element.textContent=str(text);
   if(className)element.className=className;
   return element;
  }
  function addText(parent,text,style=''){
   const p=node('p',text,style);
   parent.append(p);return p;
  }
  function hideSecret(){
   if(secretTimeout)clearTimeout(secretTimeout);
   secretTimeout=null;codeBox.textContent='';secret.hidden=true;
   $('one-register-copy').disabled=true;
  }
  function resetPrivate(){
   hideSecret();details.replaceChildren();selected=null;modalStatus.textContent='';
  }
  function closeDialog(){
   hideSecret();
   if(dialog.open)dialog.close();
   resetPrivate();
  }
  async function request(path,{payload,signal}={}){
   const options={method:payload===undefined?'GET':'POST',
     credentials:'same-origin',cache:'no-store',
     headers:{accept:'application/json',
       ...(payload===undefined?{}:{'content-type':'application/json'})},
     body:payload===undefined?undefined:JSON.stringify(payload),signal};
   const response=await fetch(path,options);
   const result=await response.json().catch(()=>({}));
   if(!response.ok||result.ok!==true){
    const errors={
      code_register_filters_invalid:'فلتر البحث غير صحيح. أدخل اسمًا أو رقمًا صالحًا.',
      code_reveal_rate_limited:'تم بلوغ حد كشف الأكواد. أعد المحاولة لاحقًا.',
      code_reveal_unavailable:'الكود قديم أو ملغي ولا يمكن كشف أصله من المخزن.',
      code_reveal_integrity_failed:'فشل التحقق من سلامة الكود المشفّر، لم يُكشف شيء.',
      code_reveal_request_invalid:'بيانات طلب الكشف غير صالحة.'
    };
    throw Error(response.status===401||response.status===403?
      'انتهت جلسة المشرف أو لا تملك صلاحية عرض بيانات العملاء.':
      errors[result.error]||'تعذّر إكمال الطلب (HTTP '+response.status+').');
   }
   return result;
  }
  function makeCell(row,contents){
   const td=document.createElement('td');
   for(const n of contents){if(typeof n==='string')td.append(document.createTextNode(n));else td.append(n);}
   row.append(td);
   return td;
  }
  function render(){
   table.replaceChildren();
   if(!rows.length){
    const tr=document.createElement('tr');
    const td=node('td','لا توجد أكواد تطابق البحث.');td.colSpan=5;tr.append(td);
    table.append(tr);
   }
   for(const item of rows){
    const tr=document.createElement('tr');
    const title=node('strong',labels[item.kind]+' · '+(item.sku||item.label||'BLOFY'));
    const hint=node('small','الكود: '+str(item.codeHint)+' · '+item.durationDays+' يوم');
    const a=document.createElement('div');a.append(title,hint);makeCell(tr,[a]);
    const identity=document.createElement('div');
    identity.append(node('b',item.customer?.name||item.manualCustomer?.name||'غير مخصص لعميل'));
    if(item.customer?.email)identity.append(node('small',item.customer.email));
    if(item.customer?.phone||item.manualCustomer?.phone)
      identity.append(node('small',item.customer?.phone||item.manualCustomer?.phone));
    makeCell(tr,[identity]);
    const delivery=document.createElement('div');
    delivery.append(node('b',labels[item.status]||'غير معروف'));
    delivery.append(node('small',item.deliveredAt?'استلام: '+dates(item.deliveredAt):
      'لم يُسلَّم من المخزون'));
    makeCell(tr,[delivery]);
    makeCell(tr,[node('small',item.activatedAt?
      'تفعيل: '+dates(item.activatedAt)+'\nانتهاء: '+dates(item.expiresAt):
      'المدة لم تبدأ بعد')]);
    const button=node('button','عرض التفاصيل / إدارة','one-register-open');
    button.type='button';button.addEventListener('click',()=>openDetails(item));
    makeCell(tr,[button]);
    table.append(tr);
   }
   $('one-register-page').textContent=matched?
    'عرض '+(offset+1)+'–'+(offset+rows.length)+' من '+matched:'لا توجد نتائج';
   $('one-register-prev').disabled=offset===0||loading;
   $('one-register-next').disabled=offset+rows.length>=matched||loading;
  }
  async function load(reset=false){
   if(loading){if(fetchAbort)fetchAbort.abort();}
   if(reset)offset=0;
   loading=true;loaded=true;status.textContent='جارٍ قراءة أكواد العملاء والمخزون من قاعدة البيانات…';
   const ctl=new AbortController();fetchAbort=ctl;
   const qs=new URLSearchParams({
      q:$('one-register-query').value.trim(),kind:$('one-register-kind').value,
      state:$('one-register-state').value,offset:String(offset)
   });
   try{
    const data=await request('/api/v1/admin/store/codes/register?'+qs.toString(),{
      signal:ctl.signal
    });
    if(!Array.isArray(data.items)||!Number.isSafeInteger(Number(data.matched)))
      throw Error('استجابة سجل الأكواد غير مكتملة.');
    rows=data.items;matched=Number(data.matched)||0;
    render();
    status.textContent='✓ السجل من الخادم: '+matched+' كود يطابق الفلاتر. '+
      'الأكواد الأصلية مخفية حتى فتح سجل العميل وتأكيد الكشف.';
   }catch(error){
    if(error.name!=='AbortError'){
     rows=[];matched=0;render();
     status.textContent='تعذّر قراءة الأكواد: '+error.message+
       ' لا تُنشئ أكواد بديلة أو تسمح بإعادة دخول حتى تتأكد من السجل.';
    }
   }finally{
    if(fetchAbort===ctl){fetchAbort=null;loading=false;render();}
   }
  }
  function openDetails(item){
   if(!item||!UUID.test(item.voucherId))return;
   resetPrivate();selected=item;
   const group=node('div','','one-register-detail-fields');
   const fields=[
    ['نوع الكود',labels[item.kind]||item.kind],
    ['الباقة',item.sku||item.label||'قديم / غير محدد'],
    ['الكود المخفي',item.codeHint],
    ['الحالة',labels[item.status]||item.status],
    ['العميل',item.customer?.name||item.manualCustomer?.name||'لم يُسجل مشترٍ'],
    ['البريد الموثّق',item.customer?.email||'غير موجود في حساب الموقع'],
    ['الجوال المسجل',item.customer?.phone||item.manualCustomer?.phone||'غير مسجل'],
    ['حالة الملف',item.customer?(item.customer.profileComplete?'الاسم والجوال مكتملان':'ملف العميل غير مكتمل'):'لم يُربط بحساب بريد موثّق'],
    ['الطلب',item.order?.number||item.order?.id||'لا يوجد طلب مرتبط'],
    ['حالة الطلب',item.order?.status||'—'],
    ['إنشاء الكود',dates(item.createdAt)],
    ['تسليم الكود',item.deliveredAt?dates(item.deliveredAt):'لم يُسلّم'],
    ['أول تفعيل',dates(item.activatedAt)],
    ['انتهاء الاشتراك',item.expiresAt?dates(item.expiresAt):'لم يبدأ احتساب المدة'],
    ['المدة',item.durationDays+' يوم'],
    ['الحد المتزامن',item.maxConnections+' اتصال']
   ];
   for(const [label,value] of fields){
    const block=node('div','','one-register-detail-field');
    block.append(node('small',label),node('strong',value));group.append(block);
   }
   details.append(group);
   if(item.kind==='trial')addText(details,
    'هذا كود تجربة واحد لحساب العميل، ولا تُصدر تجربة ثانية لنفس الحساب حتى لو اختار Xtream بدل STREAM.');
   if(item.status==='ready')addText(details,
    'الكود لا يزال في المخزون؛ لا تستخدم أمر «تسجيل بيع» لمجرد عرضه.');
   if(item.kind==='paid'&&item.order?.status!=='paid'&&item.assigned)addText(details,
    'راجع حالة الدفع قبل التواصل مع العميل. لا تعتبِر هذا السجل وحده إثبات تسوية مالية.');
   $('one-register-reveal').disabled=!item.canReveal;
   $('one-register-manage').disabled=!item.manager;
   $('one-register-manage').textContent=item.canRelogin?
     '↻ إدارة الكود / السماح بالدخول بنفسه':'▤ عرض إدارة الكود';
   $('one-register-xtream').hidden=item.channel!=='xtream';
   modalStatus.textContent=item.canRelogin?
     'يمكنك السماح بدخول جهاز آخر مرة واحدة خلال 10 دقائق بعد التحقق من صاحب الاشتراك.':
     item.status==='active'&&item.channel==='xtream'?
       'Xtream يستخدم بيانات التفعيل الخاصة بالحساب. استرجاع الحساب يختلف عن دخول STREAM بالجهاز.':
       'الكود لم يفعّل أو انتهى؛ لن نبدأ اشتراكًا جديدًا أو نغيّر تاريخ انتهائه.';
   if(!dialog.open)dialog.showModal();
  }
  $('one-register-search-form').addEventListener('submit',event=>{
   event.preventDefault();void load(true);
  });
  $('one-register-kind').addEventListener('change',()=>void load(true));
  $('one-register-state').addEventListener('change',()=>void load(true));
  $('one-register-refresh').addEventListener('click',()=>void load(false));
  $('one-register-prev').addEventListener('click',()=>{
   offset=Math.max(0,offset-PAGE);void load();
  });
  $('one-register-next').addEventListener('click',()=>{
   offset+=PAGE;void load();
  });
  $('one-register-close').addEventListener('click',closeDialog);
  dialog.addEventListener('cancel',event=>{event.preventDefault();closeDialog();});
  $('one-register-hide').addEventListener('click',hideSecret);
  $('one-register-copy').addEventListener('click',async()=>{
   if(!codeBox.textContent)return;
   try{
    await navigator.clipboard.writeText(codeBox.textContent);
    modalStatus.textContent='✓ نُسخ الكود. لا تشاركه إلا مع صاحب الاشتراك بعد التأكد من هويته.';
   }catch{modalStatus.textContent='تعذّر النسخ الآلي؛ يمكنك تحديد الكود ونسخه يدويًا.';}
  });
  let revealing=false;
  $('one-register-reveal').addEventListener('click',async()=>{
    if(!selected||!selected.canReveal||revealing)return;
    if(!window.confirm('إظهار الكود الأصلي لهذا السجل للدعم؟ سيتم تسجيل عملية الكشف في سجل الأكواد ولن يتغيّر الاشتراك.'))
     return;
    revealing=true;const id=selected.voucherId;
    $('one-register-reveal').disabled=true;modalStatus.textContent='جارٍ استرجاع الكود المشفّر والتحقق منه…';
    try{
      const response=await request('/api/v1/admin/store/codes/reveal',{
       payload:{voucherId:id,purpose:'customer_support'}});
      if(!selected||selected.voucherId!==response.voucherId||!dialog.open)return;
      hideSecret();codeBox.textContent=response.code;secret.hidden=false;
      $('one-register-copy').disabled=false;
      modalStatus.textContent='✓ الكود معروض مؤقتًا، ويُخفى تلقائيًا بعد 30 ثانية.';
      secretTimeout=setTimeout(hideSecret,30000);
    }catch(error){modalStatus.textContent='تعذر الكشف: '+error.message;}
    finally{revealing=false;if(selected)$('one-register-reveal').disabled=!selected.canReveal;}
  });
  $('one-register-manage').addEventListener('click',()=>{
    const item=selected;
    if(!item?.manager)return;
    if(item.canRelogin&&!window.confirm(
      'هل راجعت البريد والجوال أو وثائق ملكية الاشتراك؟ ستفتح الآن نافذة إدارة الكود. الإذن بالدخول يحتاج تأكيدًا إضافيًا.'))return;
    closeDialog();
    window.dispatchEvent(new CustomEvent('blofy-one:manage-code',{
      detail:{record:item.manager,offset:0}
    }));
  });
  $('one-register-xtream').addEventListener('click',()=>{
    window.open('/stream/activate','_blank','noopener,noreferrer');
  });
  window.addEventListener('blofy-one:code-register-visible',()=>void load(false));
  document.addEventListener('visibilitychange',()=>{if(document.hidden)hideSecret();});
  window.addEventListener('pagehide',hideSecret);
  if(location.hash==='#one-code-register')void load(true);
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
 else start();
})();
