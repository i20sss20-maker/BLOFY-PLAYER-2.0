/* BLOFY ONE owner-only code lifecycle management.
 * Uses existing protected endpoints. Every write is opt-in, preceded by a
 * live readback of the selected voucher and an explicit confirmation.
 * No credentials, voucher plaintext, buyer details or secrets in storage.
 */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const dialog=$('one-code-manager');
  if(!dialog)return;
  const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
  const root='/api/v1/admin/xtream-gateway/codes';
  const headings={
    sell:'تسجيل بيع يدوي',extend:'تمديد الاشتراك',
    relogin:'دخول بنفس الكود',revoke:'إلغاء غير مستخدم'
  };
  const errors={
    stream_sale_already_recorded_or_missing:'هذا الكود مبيع بالفعل أو لم يعد متاحًا للتسجيل.',
    stream_sale_price_invalid:'السعر المدخل غير صحيح؛ استخدم قيمة من 0 إلى 100000 ريال.',
    stream_sale_phone_invalid:'رقم الجوال غير صحيح. استخدم من 7 إلى 15 رقمًا.',
    stream_extension_unavailable:'لا يمكن تجديد هذا الكود: قد يكون غير مفعل أو ملغيًا.',
    stream_subscription_missing:'حساب Xtream المرتبط غير موجود.',
    stream_relogin_unavailable:'لا يمكن السماح بالدخول لهذا الكود حاليًا؛ تحقق من حالة الجهاز والصلاحية.',
    stream_code_used_or_missing:'الكود استُخدم بالفعل أو أُلغي من مكان آخر.',
    stream_code_id_invalid:'معرف الكود غير صالح.'
  };
  const statusLabels={unused:'لم يستخدم',redeemed:'مفعّل',revoked:'ملغي'};
  const readyActions=['sell','extend','relogin','revoke'];
  let selected=null,offset=0,busy=false,pending=false;
  const lines=Array.from(dialog.querySelectorAll('[data-one-code-action]'));
  const panels=readyActions.map(a=>({id:a,node:$('one-code-panel-'+a)}));
  const status=$('one-code-manager-status');

  function localDate(ms) {
    if(ms===null||ms===undefined||ms==='')return 'لم يبدأ بعد';
    const n=Number(ms);
    return Number.isFinite(n)&&n>0?
      new Date(n).toLocaleDateString('ar-SA',{year:'numeric',month:'long',day:'numeric'}):
      'غير معروف';
  }
  function message(text,error=false){
    status.textContent=text;
    status.classList.toggle('is-error',error);
  }
  function sar(value){
    if(value===null||value===undefined||value==='')return 'غير مسجّل';
    const n=Number(value);
    if(!Number.isFinite(n)||n<0)return 'غير مسجّل';
    return (n/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})+' ر.س';
  }
  function can(action,c){
    if(!c||!UUID.test(String(c.id||''))||c.status==='revoked')return false;
    if(action==='sell')return c.soldAt===null||c.soldAt===undefined;
    if(action==='extend')return c.status==='redeemed'&&Boolean(c.accountId);
    if(action==='relogin')return c.status==='redeemed'&&
      (c.channel==='app'||c.dualAccessEnabled===true)&&
      Boolean(c.accountId)&&c.deviceTransferPending===false&&
      Number(c.expiresAt)>Date.now();
    if(action==='revoke')return c.status==='unused'&&(c.soldAt===null||c.soldAt===undefined);
    return false;
  }
  function render(){
    if(!selected)return;
    $('one-code-manager-name').textContent=String(selected.label||'كود BLOFY').slice(0,100);
    $('one-code-manager-subtitle').textContent='سجل اشتراك فعلي · '+String(selected.codeHint||'كود مخفي').slice(0,48);
    $('one-code-manager-hint').textContent=String(selected.codeHint||'—').slice(0,45);
    $('one-code-manager-state').textContent=statusLabels[selected.status]||'غير معروف';
    $('one-code-manager-expiry').textContent=localDate(selected.expiresAt);
    $('one-code-manager-channel').textContent=selected.channel==='app'?'BLOFY STREAM':'Xtream';
    $('one-code-manager-sold').textContent=
      selected.soldAt?('مسجل · '+sar(selected.salePriceHalalas)):'غير مسجل';
    for(const b of lines){
      const permitted=can(b.dataset.oneCodeAction,selected);
      b.disabled=!permitted||busy;
      b.title=permitted?'':b.dataset.oneCodeAction==='revoke'?
        'لا نلغي كودًا مُفعّلًا أو تم تسجيل بيع عليه':
        'هذا الإجراء غير متاح في حالة الكود الحالية';
    }
    const form=$('one-code-sell-form');
    if(form){
      const sold=selected.soldAt!==null&&selected.soldAt!==undefined;
      $('one-code-buyer-name').value=sold?'':String(selected.buyerName||'').slice(0,80);
      $('one-code-buyer-phone').value=sold?'':String(selected.buyerPhone||'').slice(0,22);
      const suggestions={90:'40',180:'60',365:'100'};
      $('one-code-sell-price').placeholder='مثال: '+(suggestions[selected.durationDays]||'100');
    }
  }
  function selectPanel(action){
    if(!selected||busy)return;
    const allowed=can(action,selected);
    for(const p of panels)p.node.hidden=p.id!==action||!allowed;
    for(const b of lines){
      const active=b.dataset.oneCodeAction===action&&allowed;
      b.classList.toggle('is-active',active);
      b.setAttribute('aria-pressed',String(active));
    }
    if(allowed)message('الإجراء: '+headings[action]+' · يتطلب تأكيدًا قبل تنفيذه.');
    else message('هذا الإجراء غير متاح لحالة الكود الحالية.',true);
  }
  function close(){
    if(busy)return;
    dialog.close();
    selected=null;
    offset=0;
    $('one-code-sell-form').reset();
    $('one-code-extend-form').reset();
    $('one-code-revoke-confirm').value='';
    for(const p of panels)p.node.hidden=true;
    message('اختر إجراءً لعرض تفاصيله.');
  }
  function open(record,position=0){
    if(busy)return;
    if(!record||!UUID.test(String(record.id||'')))return;
    selected={...record};
    offset=Number.isSafeInteger(position)&&position>=0&&position<=100000?position:0;
    render();
    for(const p of panels)p.node.hidden=true;
    const suggested=readyActions.find(action=>can(action,selected));
    if(suggested)selectPanel(suggested);
    else message('هذا الكود لا يقبل أي عملية من العمليات المتاحة؛ راجع بياناته أو الأدوات المتقدمة.',true);
    if(!dialog.open)dialog.showModal();
  }
  async function request(url,{method='GET',payload}={}){
    const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),14000);
    try{
      const response=await fetch(url,{
        method,credentials:'same-origin',cache:'no-store',
        headers:{accept:'application/json',...(payload===undefined?{}:{'content-type':'application/json'})},
        body:payload===undefined?undefined:JSON.stringify(payload),
        signal:ctl.signal
      });
      if(response.status===401)throw Error('انتهت جلسة الإدارة. سجّل الدخول مرة أخرى.');
      if(response.status===429)throw Error('طلبات كثيرة؛ أعد المحاولة لاحقًا بعد مراجعة السجل.');
      const data=await response.json().catch(()=>({}));
      if(!response.ok||data.ok!==true)
        throw Error(errors[data.error||data.code]||'الخدمة لم تؤكد الطلب (HTTP '+response.status+').');
      return data;
    }catch(e){
      if(e.name==='AbortError')throw Error('انتهت مهلة الاتصال؛ راجع السجل قبل أي إعادة إرسال.');
      throw e;
    }finally{clearTimeout(timer);}
  }
  async function readCurrent(id){
    // Direct ID readback is pagination-independent and retains all the same
    // safeguards when the operator found a voucher via global search.
    const data=await request(root+'/'+encodeURIComponent(id));
    if(!data.item||data.item.id!==id)
      throw Error('لم يعد الكود موجودًا أو تغيّر. حدّث سجل الأكواد ثم افتحه مجددًا.');
    return data.item;
  }
  function sameState(a,b){
    return a&&b&&a.id===b.id&&a.status===b.status&&
      a.channel===b.channel&&a.accountId===b.accountId&&
      Number(a.expiresAt||0)===Number(b.expiresAt||0)&&
      Number(a.soldAt||0)===Number(b.soldAt||0)&&
      Number(a.transferCount||0)===Number(b.transferCount||0);
  }
  function actionContext(action,record){
    const hint=String(record.codeHint||record.label||'').slice(0,60);
    const name=String(record.label||'كود BLOFY').slice(0,60);
    return name+' ('+hint+')';
  }
  async function act(action,payload,confirmation,verify){
    if(busy||!selected||!can(action,selected))return;
    busy=true;
    const previous={...selected};
    for(const b of lines)b.disabled=true;
    const submissions=dialog.querySelectorAll('form button[type="submit"], #one-code-relogin-submit, #one-code-revoke-submit');
    for(const b of submissions)b.disabled=true;
    message('جارٍ التحقق من أحدث حالة الكود في السيرفر…');
    let sent=false;
    try{
      const fresh=await readCurrent(previous.id);
      if(!sameState(previous,fresh))
        throw Error('تغيّرت بيانات الكود أثناء فتحها. حدّث جدول الأكواد ثم افتح السجل مرة أخرى.');
      if(!can(action,fresh))
        throw Error('لم يعد الإجراء متاحًا لهذا الكود.');
      if(!window.confirm(confirmation(fresh))){
        message('ألغيت العملية. لم يتم تغيير الاشتراك.');
        return;
      }
      message('جارٍ تنفيذ الطلب في السيرفر؛ لا تُعد الإرسال قبل مراجعة النتيجة…');
      sent=true;
      const result=await request(root+'/'+encodeURIComponent(fresh.id)+'/'+action,{
        method:'POST',payload
      });
      if(result.item?.id!==fresh.id)
        throw Error('استلمنا استجابة غير متطابقة. تحقق من السجل قبل إعادة الطلب.');
      selected={...result.item};
      render();
      message('تم قبول العملية. جارٍ مطابقة التغيير مع سجل الأكواد…');
      try{
        const checked=await readCurrent(fresh.id);
        if(!verify(fresh,checked,result))
          throw Error('لم تُثبت نتيجة التغيير بعد القراءة.');
        selected={...checked};
        render();
        for(const p of panels)p.node.hidden=true;
        message('✓ تم تنفيذ '+headings[action]+' والتحقق منه في السجل. البيانات أمامك محدثة.');
      }catch(e){
        message('قبل السيرفر العملية، لكن لم نستطع تأكيد أحدث سجل: '+e.message+
          ' · لا تُكرر العملية قبل مراجعة الأكواد.',true);
      }
      $('one-stream-refresh')?.click();
    }catch(e){
      message((sent?'لا تُعد إرسال العملية قبل فحص السجل: ':'')+e.message,true);
    }finally{
      busy=false;
      for(const b of submissions)b.disabled=false;
      if(selected)render();
    }
  }
  $('one-code-sell-form').addEventListener('submit',event=>{
    event.preventDefault();
    if(!selected||!can('sell',selected))return;
    const buyerName=$('one-code-buyer-name').value.trim();
    const buyerPhone=$('one-code-buyer-phone').value.trim();
    const price=Number($('one-code-sell-price').value);
    const channel=$('one-code-sell-channel').value;
    if(!buyerName||buyerName.length>80||!/^[+]?[0-9]{7,15}$/.test(buyerPhone)||
      !Number.isFinite(price)||price<0||price>100000||
      Math.abs(Math.round(price*100)/100-price)>1e-7||
      !['manual','whatsapp','store_manual'].includes(channel)){
      message('تحقق من اسم العميل ورقم الجوال والسعر المدخل بالريال.',true);return;
    }
    const data={buyerName,buyerPhone,priceSar:price,channel};
    void act('sell',data,fresh=>'تسجيل بيع يدوي على '+actionContext('sell',fresh)+
      ' بقيمة '+price.toFixed(2)+' ر.س؟\n'+
      'لن يتم الخصم من البطاقة أو التحقق من Geidea؛ سجّل فقط عملية بيع تمت خارج النظام.',
      (before,after,result)=>after.soldAt!=null&&after.salePriceHalalas===Math.round(price*100)&&
        after.status===before.status);
  });
  $('one-code-extend-form').addEventListener('submit',event=>{
    event.preventDefault();
    if(!selected||!can('extend',selected))return;
    const days=Number($('one-code-extend-days').value);
    if(![30,90,180,365].includes(days)){message('مدة التمديد غير معتمدة.',true);return;}
    void act('extend',{days},fresh=>'تمديد اشتراك '+actionContext('extend',fresh)+
      ' بمقدار '+days+' يومًا؟\nيغيّر ذلك انتهاء الكود وحساب Xtream ولا يُسجّل دفعة مالية. التمديد لا يتراجع تلقائيًا.',
      (before,after)=>after.status==='redeemed'&&after.extendedDays>=Number(before.extendedDays||0)+days&&
        Number(after.expiresAt)>Number(before.expiresAt||0));
  });
  $('one-code-relogin-submit').addEventListener('click',()=>{
    if(!selected||!can('relogin',selected))return;
    void act('relogin',undefined,fresh=>'هل تأكدت من صاحب الاشتراك '+actionContext('relogin',fresh)+
      '؟\nسيسمح الكود الأصلي بدخول جهاز جديد لمرة واحدة خلال 10 دقائق دون تمديد المدة.',
      (before,after)=>after.status==='redeemed'&&
        Number(after.adminReloginUntil)>Date.now());
  });
  $('one-code-revoke-submit').addEventListener('click',()=>{
    if(!selected||!can('revoke',selected))return;
    if($('one-code-revoke-confirm').value.trim()!=='إلغاء'){
      message('اكتب كلمة «إلغاء» حرفيًا لتأكيد إلغاء الكود غير المستخدم.',true);return;
    }
    void act('revoke',undefined,fresh=>'إلغاء الكود '+actionContext('revoke',fresh)+
      ' نهائيًا؟\nلن يمكن استخدامه أو استرجاعه بعدها. العملية لكود غير مفعّل وغير مسجّل البيع فقط.',
      (before,after)=>after.status==='revoked');
  });
  for(const button of lines)button.addEventListener('click',()=>selectPanel(button.dataset.oneCodeAction));
  $('one-code-manager-close').addEventListener('click',close);
  $('one-code-manager-done').addEventListener('click',close);
  dialog.addEventListener('cancel',event=>{
    if(busy)event.preventDefault();
    else close();
  });
  window.addEventListener('blofy-one:manage-code',event=>{
    const detail=event.detail||{};
    open(detail.record,detail.offset);
  });
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden&&!busy&&dialog.open)close();
  });
  window.addEventListener('pagehide',()=>{
    if(!busy&&dialog.open)close();
  });
})();
