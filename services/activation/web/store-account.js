'use strict';
(function(){
 const $=id=>document.getElementById(id);
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 const token=/^[A-Za-z0-9_-]{42,44}$/;
 const base='/api/v1/store/account';
 const returnToCart=new URLSearchParams(location.search).get('next')==='/store/cart';
 const tell=value=>{$('message').textContent=value;};
 const node=(tag,value)=>{const n=document.createElement(tag);if(value!==undefined)n.textContent=value;return n;};
 const money=n=>(Number(n)/100).toLocaleString('ar-SA')+' ر.س';
 let orders=[];
 async function api(path,body){
  const opts={cache:'no-store',credentials:'same-origin',headers:{accept:'application/json'}};
  if(body!==undefined){
   opts.method='POST';opts.headers['content-type']='application/json';opts.body=JSON.stringify(body);
  }
  const response=await fetch(base+path,opts),result=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(new Error(result.error||'service_unavailable'),{status:response.status});
  return result;
 }
 function view(loggedIn){
  $('login').hidden=loggedIn;$('dashboard').hidden=!loggedIn;
 }
 function label(s){
  return ({paid:'مدفوع',pending:'جارٍ تأكيد الدفع',failed:'فشل الدفع',cancelled:'ملغي'})[s]||'قيد المراجعة';
 }
 function statusMessage(e){
  const map={
   customer_accounts_disabled:'حسابات العملاء غير مفعلة بعد. الشراء كزائر متاح.',
   customer_email_not_configured:'خدمة رسائل الدخول لم تُجهّز بعد. يمكنك استرجاع الطلب من رابط الزائر.',
   customer_email_unavailable:'تعذر الاتصال بخدمة البريد حاليًا. أبلغ دعم BLOFY إذا استمرت المشكلة.',
   customer_email_key_invalid:'مفتاح إرسال البريد يحتاج تحديثًا في إعدادات المتجر. تم إبلاغ الإدارة.',
   customer_email_domain_unverified:'نطاق بريد BLOFY لم يُوثق بعد لدى خدمة الإرسال. تم إبلاغ الإدارة.',
   customer_email_sender_restricted:'خدمة البريد ترفض عنوان المرسل أو أن حسابها ما زال في وضع الاختبار. تم إبلاغ الإدارة.',
   customer_email_sender_invalid:'عنوان المرسل في إعدادات البريد يحتاج مراجعة. تم إبلاغ الإدارة.',
   customer_email_provider_rate_limited:'خدمة البريد وصلت إلى حد الإرسال مؤقتًا؛ أعد المحاولة لاحقًا.',
   login_code_incorrect:'الرمز غير صحيح أو انتهت صلاحيته.',
   invalid_email:'تحقق من البريد الإلكتروني.',
   origin_forbidden:'أعد فتح الصفحة من رابط متجر BLOFY الرسمي.',
   rate_limited:'محاولات كثيرة؛ حاول لاحقًا.',
   order_not_found:'تعذر تأكيد ملكية الطلب؛ تحقق من المعرف ومفتاح الرابط.',
   order_already_linked:'هذا الطلب مرتبط بحساب مختلف؛ تواصل مع الدعم.',
   order_delivery_unavailable:'لم نتمكن من عرض الأكواد الآن؛ لا تكرر الدفع وتواصل مع الدعم.'
  };
  return map[e.message]||'تعذر إكمال العملية: '+e.message;
 }
 function addOrderCard(o){
  const wrapper=node('article');wrapper.className='receipt-line';
  const title=node('strong','طلب '+o.orderNumber+' — '+label(o.status));
  const paragraph=node('p',money(o.amountMinor)+' · '+new Date(o.createdAt).toLocaleDateString('ar-SA'));
  wrapper.append(title,paragraph);
  const buttons=node('div');buttons.className='actions';
  const details=node('button','تفاصيل الأكواد');details.type='button';details.className='secondary';
  details.addEventListener('click',()=>void showOrder(o.orderId));
  const support=node('a','الدعم');support.className='secondary';support.target='_blank';
  support.rel='noopener noreferrer';
  support.href='https://wa.me/966568941484?text='+encodeURIComponent('السلام عليكم، أحتاج مساعدة في طلب BLOFY رقم '+o.orderNumber);
  const renew=node('a','تجديد نفس الكود');renew.className='secondary';renew.target='_blank';
  renew.rel='noopener noreferrer';
  renew.href='https://wa.me/966568941484?text='+encodeURIComponent('السلام عليكم، أريد تجديد نفس كود BLOFY المرتبط بطلب '+o.orderNumber+'. أرجو مراجعة حالته.');
  if(o.status==='pending'){
   const verify=node('button','التحقق من حالة الدفع');verify.className='primary';verify.type='button';
   verify.addEventListener('click',async()=>{
    verify.disabled=true;
    try{
     tell('جارٍ الاستعلام عن الدفع من Geidea عبر BLOFY...');
     const result=await api('/orders/'+encodeURIComponent(o.orderId)+'/check',{});
     await load();
     if(result.confirmedPaid){
      tell('تم تأكيد دفع الطلب. تظهر أكواده الآن.');
      await showOrder(o.orderId);
     }else tell(result.providerUnavailable?
      'لم نستطع التواصل مع Geidea الآن. لا تعِد الدفع، وافتح الطلب لاحقًا أو تواصل مع الدعم.':
      'الطلب ما زال قيد التحقق. لم يُسجّل دفع مؤكد حتى الآن؛ لا تكرر الشراء.');
    }catch(e){tell(statusMessage(e));}
    finally{verify.disabled=false;}
   });
   buttons.append(verify);
  }
  buttons.append(details,renew,support);wrapper.append(buttons);return wrapper;
 }
 async function load(){
  try{
   const data=await api('');
   orders=data.orders||[];
   $('account-email').textContent=data.email||'';
   $('reminder-optin').checked=data.alertsOptIn===true;
   $('orders').replaceChildren();
   if(!orders.length)$('orders').append(node('p','لا توجد طلبات مربوطة بعد. أضف طلبك السابق باستخدام الرابط الخاص.'));
   else orders.forEach(o=>$('orders').append(addOrderCard(o)));
   view(true);tell('حسابك جاهز.');
   if(returnToCart){location.replace('/store/cart');return;}
   // A single server-side scoped query returns statuses only, never raw codes.
   const alerts=$('expiry-alerts');alerts.replaceChildren();
   try{
    const result=await api('/alerts');
    for(const c of result.alerts||[]){
     if(!c.status)continue;
     const item=node('p',(c.status==='expired'?'انتهى':'قرب الانتهاء')+
      ' — '+(c.channel==='xtream'?'Xtream':'BLOFY STREAM')+
      ' — طلب '+c.orderNumber+
      (c.expiresAt?' — '+new Date(c.expiresAt).toLocaleDateString('ar-SA'):''));
     item.className='receipt-line';alerts.append(item);
    }
   }catch(_){alerts.append(node('p','تعذر تحديث تنبيهات الاشتراكات. حاول لاحقًا.'));}
   if(!alerts.childElementCount)alerts.append(node('p','لا توجد اشتراكات مرتبطة تستدعي التنبيه خلال 7 أيام.'));
  }catch(err){
   if(err.status===401){view(false);return;}
   view(false);tell(statusMessage(err));
  }
 }
 async function showOrder(id){
  try{
   const data=await api('/orders/'+encodeURIComponent(id));
   $('receipt').hidden=false;$('receipt-title').textContent='أكواد الطلب '+data.orderNumber;
   $('receipt-status').textContent=data.fulfilled?'تم تأكيد الدفع واستلام الأكواد.':
    'الطلب '+label(data.status)+'. لا تكرر الدفع قبل التحقق.';
   const root=$('codes');root.replaceChildren();
   for(const c of data.codes||[]){
    const box=node('div');box.className='code-card';
    box.append(node('b',c.channel==='xtream'?'كود Xtream':'كود BLOFY STREAM'));
    const code=node('code',c.code),meta=node('small','المدة '+c.durationDays+' يومًا'+
      (c.expiresAt?' · ينتهي '+new Date(c.expiresAt).toLocaleDateString('ar-SA'):' · تبدأ عند أول تفعيل'));
    const copy=node('button','نسخ الكود');copy.type='button';copy.className='secondary';
    copy.addEventListener('click',async()=>{
     try{await navigator.clipboard.writeText(c.code);copy.textContent='تم النسخ ✓';}
     catch{copy.textContent='تعذر النسخ';}
    });
    box.append(code,meta,copy);root.append(box);
   }
   $('receipt').scrollIntoView({behavior:'smooth'});
  }catch(err){tell(statusMessage(err));}
 }
 $('request-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const button=$('request-button');button.disabled=true;
  try{
   await api('/request-code',{email:$('email').value.trim()});
   $('verify-form').hidden=false;tell('إذا كان البريد صالحًا فسيصل رمز دخول خلال دقائق.');
  }catch(e){tell(statusMessage(e));}
  finally{button.disabled=false;}
 });
 $('verify-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const button=$('verify-button');button.disabled=true;
  try{
   await api('/verify-code',{email:$('email').value.trim(),code:$('otp').value.trim()});
   $('otp').value='';await load();
  }catch(e){tell(statusMessage(e));}
  finally{button.disabled=false;}
 });
 $('claim-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const id=$('claim-order').value.trim(),access=$('claim-token').value.trim();
  if(!uuid.test(id)||!token.test(access)){tell('أدخل معرّف الطلب ومفتاحه من رابط الاسترجاع.');return;}
  const button=$('claim-button');button.disabled=true;
  try{
   await api('/claim',{orderId:id,accessToken:access});
   $('claim-token').value='';$('claim-order').value='';await load();
   tell('تم ربط الطلب بحسابك بنجاح.');
  }catch(e){tell(statusMessage(e));}
  finally{button.disabled=false;}
 });
 $('reminder-optin').addEventListener('change',async function(){
  this.disabled=true;
  try{
   const response=await api('/preferences',{alertsOptIn:this.checked});
   $('reminder-status').textContent=response.delivery==='email_when_eligible'
    ?'تم حفظ اختيارك. ستصلك رسالة عند دخول أحد الاشتراكات فترة السبعة أيام إذا كان التنبيه مفعّلًا.'
    :'تم حفظ اختيارك، لكن إرسال رسائل البريد الآلية لم يُفعّل بعد. ستظل التنبيهات داخل حسابك.';
  }catch(err){this.checked=!this.checked;$('reminder-status').textContent=statusMessage(err);}
  finally{this.disabled=false;}
 });
 $('logout').addEventListener('click',async()=>{
  try{await api('/logout',{});view(false);orders=[];tell('تم تسجيل الخروج.');}
  catch(e){tell(statusMessage(e));}
 });
 $('close-receipt').addEventListener('click',()=>{$('receipt').hidden=true;$('codes').replaceChildren();});
 if(returnToCart)$('checkout-return').hidden=false;
 // An existing guest token can be transported in the URL fragment, never the server logs.
 const params=new URLSearchParams(location.hash.replace(/^#/,''));
 const id=params.get('order'),secret=params.get('token');
 if(uuid.test(id||'')&&token.test(secret||'')){
  $('claim-order').value=id;$('claim-token').value=secret;
 }
 if(location.hash)history.replaceState(null,'','/store/account');
 void load();
})();
