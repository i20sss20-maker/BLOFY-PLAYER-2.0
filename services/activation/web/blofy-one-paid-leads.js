/* Private paid-customer desk in BLOFY ONE. No automatic outreach or secrets. */
(()=>{
 'use strict';
 const $=id=>document.getElementById(id);
 const list=$('one-paid-leads-rows'),dialog=$('one-paid-lead-dialog');
 if(!list||!dialog)return;
 const PAGE=25,UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 const statuses={new:'جديد',contacted:'تم التواصل',offer_sent:'عرض مرسل',
  converted:'تم التجديد',do_not_contact:'عدم التواصل'};
 const number=new Intl.NumberFormat('en-US');
 let rows=[],offset=0,matched=0,nextOffset=null,loading=false,busy=false,selected=null;
 const cell=(tag,text='',cls='')=>{
  const e=document.createElement(tag);e.textContent=String(text??'');
  if(cls)e.className=cls;return e;
 };
 function when(value){
  const dt=value?new Date(value):null;
  return dt&&Number.isFinite(dt.getTime())?
   dt.toLocaleString('ar-SA-u-ca-gregory',{timeZone:'Asia/Riyadh',
    year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',hourCycle:'h12'}):'غير مسجل';
 }
 function money(minor){
  if(!Number.isSafeInteger(Number(minor))||Number(minor)<0)return '—';
  return (Number(minor)/100).toLocaleString('en-US',{minimumFractionDigits:2,
   maximumFractionDigits:2})+' ر.س';
 }
 async function api(route,payload){
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),18000);
  try{
   const res=await fetch(route,{
    method:'POST',credentials:'same-origin',cache:'no-store',referrerPolicy:'no-referrer',
    headers:{'content-type':'application/json',accept:'application/json'},
    body:JSON.stringify(payload),signal:controller.signal
   });
   const body=await res.json().catch(()=>({}));
   if(res.status===401||res.status===403)throw Error('صلاحية لوحة الإدارة انتهت، ادخل من /admin.');
   if(!res.ok||body.ok===false){
    const explanations={
     paid_leads_filters_invalid:'البحث يجب أن يكون حرفين على الأقل أو بدون نص.',
     paid_lead_followup_invalid:'حالة المتابعة أو نص الملاحظة غير صالح.',
     paid_lead_not_found:'الطلب لم يعد مسجلًا مدفوعًا.',
     paid_lead_marketing_consent_required:'لا توجد موافقة صريحة على عروض BLOFY.',
     paid_lead_do_not_contact:'العميل محدد بعدم التواصل.'
    };
    throw Error(explanations[body.error]||
     'تعذر إكمال العملية (HTTP '+res.status+').');
   }
   return body;
  }catch(e){
   if(e.name==='AbortError')throw Error('انتهت مهلة الاتصال. حدّث القائمة قبل تكرار الطلب.');
   throw e;
  }finally{clearTimeout(timeout);}
 }
 function render(){
  list.replaceChildren();
  for(const buyer of rows){
   const tr=cell('tr'),who=cell('td'),contacts=cell('td'),product=cell('td'),
    activation=cell('td'),action=cell('td');
   who.append(cell('strong',buyer.customer?.name||'طلب بدون حساب عميل مرتبط'));
   contacts.append(cell('span',buyer.customer?.phone||'لا يوجد جوال مرتبط'),
    cell('small',buyer.customer?.email||'لا يوجد بريد موثّق مرتبط'));
   product.append(cell('strong',buyer.orderNumber||buyer.orderId),
    cell('small',buyer.sku==='cart'?'سلة متعددة منتجات':buyer.sku==='renewal'?
      'تجديد الاشتراك':buyer.sku==='bundle-2y'?'باقة مشتركة':
      buyer.channel==='xtream'?'Xtream':'BLOFY STREAM'));
   activation.append(cell('strong',buyer.codeCount?
    'أكواد مرتبطة: '+number.format(buyer.codeCount):
    'لا يوجد كود مرتبط مؤكّد'));
   activation.append(cell('small',buyer.activatedCount?
    'تم تفعيل '+number.format(buyer.activatedCount):
    'لم يُسجّل تفعيل مرتبط'));
   if(buyer.expiresAt)activation.append(cell('small','آخر انتهاء: '+when(buyer.expiresAt)));
   activation.append(cell('small','متابعة: '+(statuses[buyer.followupStatus]||'جديد')));
   const btn=cell('button','👤 بيانات وتواصل','one-paid-lead-open');
   btn.type='button';btn.addEventListener('click',()=>void open(buyer));
   action.append(btn);
   tr.append(who,contacts,product,
    cell('td',buyer.currency==='SAR'?money(buyer.amountMinor):'عملة غير معروفة'),
    cell('td',when(buyer.paidAt||buyer.createdAt)),activation,action);
   list.append(tr);
  }
  if(!rows.length){
   const row=cell('tr'),c=cell('td','لا توجد مشتريات مدفوعة تطابق البحث.');
   c.colSpan=7;row.append(c);list.append(row);
  }
  $('one-paid-leads-prev').disabled=loading||offset===0;
  $('one-paid-leads-next').disabled=loading||nextOffset===null;
  $('one-paid-leads-page').textContent=matched?
   'عرض '+(offset+1)+'–'+(offset+rows.length)+' من '+matched:'0 طلب';
 }
 async function load({first=false}={}){
  if(loading||busy)return;
  if(first)offset=0;
  const q=$('one-paid-leads-query').value.trim();
  if(q.length===1){$('one-paid-leads-status').textContent='اكتب حرفين للبحث أو امسح الحقل.';return;}
  loading=true;
  $('one-paid-leads-refresh').disabled=true;
  $('one-paid-leads-status').textContent='جارٍ قراءة الطلبات المسجلة مدفوعة مع بيانات أصحابها…';
  try{
   const data=await api('/api/v1/admin/store/paid-leads',{
    q,channel:$('one-paid-leads-channel').value,
    followup:$('one-paid-leads-followup').value,offset
   });
   if(data.ok!==true||!Array.isArray(data.items)||data.readOnly!==true)
    throw Error('استجابة المشترين غير مكتملة.');
   rows=data.items.filter(row=>row&&UUID.test(String(row.orderId||'')));
   matched=Number(data.matched)||0;nextOffset=data.nextOffset;
   render();
   $('one-paid-leads-status').textContent='✓ '+number.format(matched)+
    ' طلب مسجل مدفوع · بيانات الحسابات الموثّقة فقط · توقيت السعودية.';
  }catch(error){
   rows=[];matched=0;nextOffset=null;list.replaceChildren();
   const row=cell('tr'),td=cell('td','تعذر قراءة المشترين: '+error.message);
   td.colSpan=7;row.append(td);list.append(row);
   $('one-paid-leads-page').textContent='غير متاح';
   $('one-paid-leads-status').textContent='فشل جلب المشترين، ولا يعني هذا عدم وجود مبيعات. '+error.message;
  }finally{
   loading=false;$('one-paid-leads-refresh').disabled=false;
   $('one-paid-leads-prev').disabled=offset===0;
   $('one-paid-leads-next').disabled=nextOffset===null;
  }
 }
 function detail(name,value){
  const d=cell('div','','one-paid-lead-detail');
  d.append(cell('small',name),cell('strong',value||'—'));return d;
 }
 async function open(snapshot){
  if(busy)return;
  // Fetch the latest consent/status on every open; the list may be stale.
  let buyer;
  try{
   const current=await api('/api/v1/admin/store/paid-leads',{
    q:snapshot.orderId,channel:'all',followup:'all',offset:0
   });
   buyer=current.items?.find(item=>item.orderId===snapshot.orderId);
   if(!buyer||buyer.recordedPaid!==true)throw Error('لم يمكن التحقق من حالة الدفع الحالية.');
  }catch(error){
   $('one-paid-leads-status').textContent='تعذر فتح الملف: '+error.message;
   return;
  }
  if(busy)return;
  selected=buyer;
  const c=buyer.customer||{};
  $('one-paid-lead-detail-grid').replaceChildren(
   detail('اسم العميل',c.name||'لا يوجد حساب مرتبط'),
   detail('رقم الجوال',c.phone),
   detail('البريد الإلكتروني الموثق',c.email),
   detail('رقم الطلب',buyer.orderNumber||buyer.orderId),
   detail('المنتج',buyer.sku),detail('القيمة',money(buyer.amountMinor)),
   detail('وقت طلب الشراء',when(buyer.createdAt)),
   detail('وقت تسجيل الدفع',when(buyer.paidAt)),
   detail('التفعيل',buyer.codeCount?
    'مرتبط '+buyer.codeCount+' كود · المفعّل '+buyer.activatedCount:
    'لا يوجد كود مثبت التسليم في بيانات هذا الطلب'),
   detail('آخر تاريخ انتهاء مرتبط',buyer.expiresAt?when(buyer.expiresAt):'غير متوفر'),
   detail('التواصل بالعروض',buyer.marketingOptIn?'موافق صراحة':'لم يوافق أو ألغى الموافقة'),
   detail('آخر تحديث متابعة',buyer.followupUpdatedAt?when(buyer.followupUpdatedAt):'لا يوجد')
  );
  $('one-paid-lead-copy-phone').disabled=!c.phone;
  $('one-paid-lead-copy-email').disabled=!c.email;
  $('one-paid-lead-followup-state').value=statuses[buyer.followupStatus]?
   buyer.followupStatus:'new';
  $('one-paid-lead-note').value=buyer.followupNote||'';
  $('one-paid-lead-followup-state').querySelector('option[value="offer_sent"]').disabled=
   !buyer.marketingOptIn||buyer.followupStatus==='do_not_contact';
  const whatsapp=$('one-paid-lead-whatsapp'),phone=String(c.phone||'').replace(/\D/g,'');
  if(buyer.marketingOptIn&&buyer.followupStatus!=='do_not_contact'&&/^9665\d{8}$/.test(phone)){
   whatsapp.href='https://wa.me/'+phone;whatsapp.hidden=false;
  }else{whatsapp.hidden=true;whatsapp.removeAttribute('href');}
  $('one-paid-lead-detail-status').textContent=buyer.marketingOptIn?
   'الموافقة التسويقية مسجلة. إرسال أي رسالة يدوي فقط، وليس من النظام.':
   'لم يسجل العميل موافقة على العروض؛ لا ترسل عروضًا تسويقية.';
  if(!dialog.open)dialog.showModal();
 }
 function close(){
  if(busy)return;
  selected=null;$('one-paid-lead-detail-grid').replaceChildren();
  $('one-paid-lead-note').value='';
  const whats=$('one-paid-lead-whatsapp');whats.hidden=true;whats.removeAttribute('href');
  if(dialog.open)dialog.close();
 }
 async function copy(field){
  const val=String(selected?.customer?.[field]||'');
  if(!val)return;
  try{await navigator.clipboard.writeText(val);
   $('one-paid-lead-detail-status').textContent='✓ تم النسخ للمتابعة المصرح بها فقط.';}
  catch{$('one-paid-lead-detail-status').textContent='تعذر النسخ تلقائيًا.';}
 }
 $('one-paid-lead-copy-phone').addEventListener('click',()=>void copy('phone'));
 $('one-paid-lead-copy-email').addEventListener('click',()=>void copy('email'));
 $('one-paid-lead-followup-form').addEventListener('submit',async event=>{
  event.preventDefault();
  if(busy||!selected)return;
  const followupStatus=$('one-paid-lead-followup-state').value,
   note=$('one-paid-lead-note').value.trim(),orderId=selected.orderId;
  if(note.length>250)return;
  if(followupStatus==='offer_sent'&&!selected.marketingOptIn){
   $('one-paid-lead-detail-status').textContent='لا يمكنك تسجيل عرض مرسل دون موافقة العميل.';return;
  }
  if(!window.confirm('حفظ حالة متابعة هذا الطلب؟ لا تُرسل أي رسائل للعميل من هنا.'))return;
  busy=true;$('one-paid-lead-save').disabled=true;
  $('one-paid-lead-detail-status').textContent='جارٍ حفظ المتابعة…';
  try{
   const result=await api('/api/v1/admin/store/paid-leads/followup',{
    orderId,followupStatus,note
   });
   if(result.ok!==true||result.orderId!==orderId||
      result.followupStatus!==followupStatus)throw Error('لم يتأكد الحفظ.');
   selected.followupStatus=followupStatus;selected.followupNote=note;
   $('one-paid-lead-detail-status').textContent='✓ حُفظت المتابعة. لم تُرسل أي رسالة.';
   if(followupStatus==='do_not_contact'){
    const what=$('one-paid-lead-whatsapp');what.hidden=true;what.removeAttribute('href');
    $('one-paid-lead-followup-state').querySelector('option[value="offer_sent"]').disabled=true;
   }
  }catch(error){$('one-paid-lead-detail-status').textContent='لم تُحفظ المتابعة: '+error.message;}
  finally{busy=false;$('one-paid-lead-save').disabled=false;}
 });
 $('one-paid-lead-close').addEventListener('click',()=>{close();void load();});
 $('one-paid-lead-cancel').addEventListener('click',()=>{close();void load();});
 dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
 $('one-paid-leads-search-form').addEventListener('submit',e=>{e.preventDefault();void load({first:true});});
 $('one-paid-leads-channel').addEventListener('change',()=>void load({first:true}));
 $('one-paid-leads-followup').addEventListener('change',()=>void load({first:true}));
 $('one-paid-leads-refresh').addEventListener('click',()=>void load({first:true}));
 $('one-paid-leads-prev').addEventListener('click',()=>{if(offset>=PAGE){offset-=PAGE;void load();}});
 $('one-paid-leads-next').addEventListener('click',()=>{if(nextOffset!==null){offset=nextOffset;void load();}});
 void load({first:true});
})();
