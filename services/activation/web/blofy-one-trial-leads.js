/* BLOFY ONE: private verified trial customers and consent-aware follow-up.
 * Only authorized owner endpoints return names, phones or email. No browser
 * storage, personal-data export, automatic marketing or customer-code exposure.
 */
(() => {
 'use strict';
 const start=()=>{
  const $=id=>document.getElementById(id);
  const root=$('one-trial-leads'),table=$('one-trial-leads-rows'),
   notice=$('one-trial-leads-status'),dialog=$('one-trial-lead-dialog');
  if(!root||!table||!dialog)return;
  const PAGE=25,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
  const states={unactivated:'لم يفعّل',active:'نشط',expired:'منتهي',revoked:'ملغى'};
  const follows={new:'جديد',contacted:'تم التواصل',offer_sent:'عرض مُرسل',
   converted:'أصبح مشتركًا',do_not_contact:'عدم التواصل'};
  let leads=[],selected=null,offset=0,matched=0,nextOffset=null,loading=false,busy=false;
  const el=(tag,content='',className='')=>{
   const node=document.createElement(tag);
   node.textContent=String(content??'');
   if(className)node.className=className;
   return node;
  };
  function date(value){
   const time=value?new Date(value):null;
   return time&&Number.isFinite(time.getTime())?
    time.toLocaleString('ar-SA-u-ca-gregory',{timeZone:'Asia/Riyadh',
      year:'numeric',month:'2-digit',day:'2-digit',
      hour:'2-digit',minute:'2-digit',hourCycle:'h12'}):
    'لم يفعّل';
  }
  async function api(path,body){
   const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
   try{
    const response=await fetch(path,{
     method:'POST',credentials:'same-origin',cache:'no-store',referrerPolicy:'no-referrer',
     headers:{'content-type':'application/json',accept:'application/json'},
     body:JSON.stringify(body),signal:controller.signal
    });
    const result=await response.json().catch(()=>({}));
    if(response.status===401||response.status===403)
     throw Error('جلسة المشرف غير صالحة؛ سجل دخولك من /admin.');
    if(!response.ok||result.ok===false){
     const translations={
      trial_marketing_consent_required:'لا توجد موافقة تسويقية صريحة؛ لا يمكن تسجيل «عرض مرسل» لهذا العميل.',
      trial_do_not_contact:'هذا العميل محدد بعدم التواصل.',
      trial_followup_invalid:'حالة المتابعة أو الملاحظة غير صالحة.',
      trial_leads_filters_invalid:'أدخل حرفين على الأقل أو امسح البحث.',
      trial_lead_not_found:'سجل تجربة العميل غير موجود.'
     };
     throw Error(translations[result.error]||'تعذّر قراءة السجل أو حفظ المتابعة (HTTP '+response.status+').');
    }
    return result;
   }catch(error){
    if(error.name==='AbortError')throw Error('انتهت مهلة اتصال السيرفر. حدّث السجل قبل إعادة المحاولة.');
    throw error;
   }finally{clearTimeout(timeout);}
  }
  function clearDialog(){
   if(busy)return;
   selected=null;
   $('one-trial-lead-info').replaceChildren();
   $('one-trial-lead-followup-note').value='';
   $('one-trial-lead-whatsapp').hidden=true;
   $('one-trial-lead-whatsapp').removeAttribute('href');
   if(dialog.open)dialog.close();
  }
  function render(){
   table.replaceChildren();
   for(const item of leads){
    const row=el('tr'),name=el('td'),email=el('td');
    name.append(el('strong',item.customer?.name||'الاسم غير مسجل'));
    email.append(el('span',item.customer?.phone||'لا يوجد جوال'),
     el('small',item.customer?.email||'لا يوجد بريد'));
    const type=el('td');
    type.append(el('strong',item.channel==='xtream'?'Xtream':'BLOFY STREAM'),
      el('small',item.codeHint||'كود مخفي'));
    const activation=el('td');
    activation.append(el('strong',states[item.state]||'غير معروف'));
    if(item.activatedAt)activation.append(el('small','فُعّل: '+date(item.activatedAt)));
    if(item.expiresAt)activation.append(el('small','ينتهي: '+date(item.expiresAt)));
    const contact=el('td');
    contact.append(el('strong',item.marketingOptIn?
     '✓ موافق على العروض':'لا توجد موافقة عروض'));
    contact.append(el('small','متابعة: '+(follows[item.followupStatus]||'جديد')));
    const action=el('td');
    const open=el('button','👤 ملف وتواصل','one-trial-lead-open');
    open.type='button';
    open.addEventListener('click',()=>openLead(item));
    action.append(open);
    row.append(name,email,type,el('td',date(item.claimedAt)),activation,contact,action);
    table.append(row);
   }
   if(!leads.length){
    const row=el('tr'),cell=el('td','لا توجد طلبات تجريبية مطابقة. لا يشمل هذا الجدول الأكواد الموجودة في المخزون فقط.');
    cell.colSpan=7;row.append(cell);table.append(row);
   }
   $('one-trial-leads-prev').disabled=loading||offset===0;
   $('one-trial-leads-next').disabled=loading||nextOffset===null;
   $('one-trial-leads-page').textContent=matched?
    'عرض '+(offset+1)+'–'+(offset+leads.length)+' من '+matched:
    '0 طلب تجربة';
   if(!loading)notice.textContent='✓ طلبات تجربة مسجلة: '+matched+
    ' · بيانات العملاء من حسابات بريد موثّقة · التوقيت: السعودية.';
  }
  async function load({reset=false}={}){
   if(loading||busy)return;
   if(reset)offset=0;
   const q=$('one-trial-leads-query').value.trim();
   if(q.length===1){notice.textContent='اكتب حرفين على الأقل للبحث أو امسح البحث.';return;}
   loading=true;
   notice.textContent='جارٍ تحميل العملاء الذين طلبوا تجربة فعلية من الموقع…';
   $('one-trial-leads-next').disabled=true;
   $('one-trial-leads-prev').disabled=true;
   try{
    const data=await api('/api/v1/admin/store/trials/leads',{
     q,sku:$('one-trial-leads-sku').value,
     state:$('one-trial-leads-state').value,offset
    });
    if(data.ok!==true||!Array.isArray(data.items)||data.readOnly!==true)
     throw Error('بيانات العملاء التجريبية غير مكتملة.');
    leads=data.items.filter(row=>row&&UUID.test(String(row.voucherId||'')));
    matched=Number(data.matched)||0;nextOffset=data.nextOffset;
    render();
   }catch(error){
    leads=[];matched=0;nextOffset=null;
    table.replaceChildren();
    const tr=el('tr'),td=el('td','تعذّر تحميل بيانات العملاء: '+error.message);
    td.colSpan=7;tr.append(td);table.append(tr);
    notice.textContent='تعذّر تحميل سجل طلبات التجربة؛ لا يعني ذلك عدم وجود عملاء. '+error.message;
    $('one-trial-leads-page').textContent='غير متاح';
   }finally{
    loading=false;
    $('one-trial-leads-prev').disabled=offset===0;
    $('one-trial-leads-next').disabled=nextOffset===null;
   }
  }
  function detail(label,value){
   const node=el('div','','one-trial-lead-detail');
   node.append(el('small',label),el('strong',value||'—'));return node;
  }
  function openLead(row){
   if(busy)return;
   selected=row;
   const person=row.customer||{};
   const info=$('one-trial-lead-info');
   info.replaceChildren(
    detail('الاسم المسجّل',person.name),
    detail('رقم الجوال',person.phone),
    detail('البريد الإلكتروني الموثّق',person.email),
    detail('نوع التجربة',row.channel==='xtream'?'Xtream':'BLOFY STREAM'),
    detail('معرّف الكود المخفي',row.codeHint),
    detail('وقت طلب التجربة · السعودية',date(row.claimedAt)),
    detail('وقت التفعيل',date(row.activatedAt)),
    detail('انتهاء التجربة',date(row.expiresAt)),
    detail('حالة التفعيل',states[row.state]||'غير معروف'),
    detail('العروض التسويقية',row.marketingOptIn?
      'موافقة صريحة مسجلة':'لا توجد موافقة صريحة · لا ترسل عروضًا'),
    detail('آخر متابعة',row.followupUpdatedAt?date(row.followupUpdatedAt):'لم تتم')
   );
   $('one-trial-lead-followup-status').value=follows[row.followupStatus]?
     row.followupStatus:'new';
   $('one-trial-lead-followup-note').value=String(row.followupNote||'');
   $('one-trial-lead-followup-status').querySelector('option[value="offer_sent"]').disabled=
      !row.marketingOptIn||row.followupStatus==='do_not_contact';
   $('one-trial-lead-copy-phone').disabled=!person.phone;
   $('one-trial-lead-copy-email').disabled=!person.email;
   const phone=String(person.phone||'').replace(/\D/g,'');
   const marketingAllowed=row.marketingOptIn&&row.followupStatus!=='do_not_contact';
   const link=$('one-trial-lead-whatsapp');
   // A link never sends a message by itself, and is shown only after opt-in.
   if(marketingAllowed&&/^9665\d{8}$/.test(phone)){
    link.href='https://wa.me/'+phone;
    link.hidden=false;
   }else{link.hidden=true;link.removeAttribute('href');}
   $('one-trial-lead-detail-status').textContent=marketingAllowed?
    'الموافقة التسويقية مسجّلة. استخدام واتساب يدوي فقط، ولا توجد رسائل آلية.':
    'لا توجد موافقة تسويقية نشطة؛ لا تستخدم البيانات لإرسال عروض دعائية.';
   if(!dialog.open)dialog.showModal();
  }
  async function copy(field){
   const value=String(selected?.customer?.[field]||'');
   if(!value)return;
   try{await navigator.clipboard.writeText(value);
    $('one-trial-lead-detail-status').textContent='✓ نُسخت بيانات التواصل لأغراض المتابعة المصرح بها فقط.';}
   catch{$('one-trial-lead-detail-status').textContent='تعذر النسخ التلقائي.';}
  }
  $('one-trial-lead-copy-phone').addEventListener('click',()=>void copy('phone'));
  $('one-trial-lead-copy-email').addEventListener('click',()=>void copy('email'));
  $('one-trial-lead-followup-form').addEventListener('submit',async event=>{
   event.preventDefault();
   if(busy||!selected)return;
   const status=$('one-trial-lead-followup-status').value;
   const note=$('one-trial-lead-followup-note').value.trim();
   if(note.length>250)return;
   if(status==='offer_sent'&&!selected.marketingOptIn){
    $('one-trial-lead-detail-status').textContent='لا يمكن تسجيل إرسال عرض دون موافقة العميل على العروض.';return;
   }
   if(!window.confirm('تأكيد حفظ متابعة تجربة العميل؟ لن يتم إرسال أي رسالة للعميل تلقائيًا.'))return;
   busy=true;$('one-trial-lead-followup-save').disabled=true;
   $('one-trial-lead-detail-status').textContent='جارٍ حفظ المتابعة…';
   const voucherId=selected.voucherId;
   try{
    const result=await api('/api/v1/admin/store/trials/leads/followup',{
     voucherId,followupStatus:status,note
    });
    if(result.ok!==true||result.voucherId!==voucherId||
       result.followupStatus!==status)throw Error('لم يتأكد حفظ المتابعة.');
    $('one-trial-lead-detail-status').textContent='✓ تم حفظ حالة المتابعة دون إرسال رسائل.';
    selected.followupStatus=status;selected.followupNote=note;
    // Refresh after leaving the modal to avoid overwriting a form mid-save.
   }catch(error){$('one-trial-lead-detail-status').textContent='تعذر الحفظ: '+error.message;}
   finally{
    busy=false;$('one-trial-lead-followup-save').disabled=false;
   }
  });
  $('one-trial-lead-close').addEventListener('click',()=>{clearDialog();void load();});
  $('one-trial-lead-followup-cancel').addEventListener('click',()=>{clearDialog();void load();});
  dialog.addEventListener('cancel',e=>{e.preventDefault();clearDialog();});
  $('one-trial-leads-search').addEventListener('submit',e=>{e.preventDefault();void load({reset:true});});
  $('one-trial-leads-refresh').addEventListener('click',()=>void load({reset:true}));
  $('one-trial-leads-sku').addEventListener('change',()=>void load({reset:true}));
  $('one-trial-leads-state').addEventListener('change',()=>void load({reset:true}));
  $('one-trial-leads-prev').addEventListener('click',()=>{
   if(offset<25)return;offset-=PAGE;void load();
  });
  $('one-trial-leads-next').addEventListener('click',()=>{
   if(nextOffset===null)return;offset=nextOffset;void load();
  });
  window.addEventListener('blofy-one:trial-leads-visible',()=>void load({reset:true}));
  if(location.hash==='#one-trial-stock')void load({reset:true});
 };
 if(document.readyState==='loading')
  document.addEventListener('DOMContentLoaded',start,{once:true});
 else start();
})();
