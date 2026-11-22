'use strict';
(function(){
 const $=id=>document.getElementById(id);
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 const token=/^[A-Za-z0-9_-]{42,44}$/;
 const base='/api/v1/store/account';
 const query=new URLSearchParams(location.search);
 const returnToCart=query.get('next')==='/store/cart';
 const returnedRenewal=query.get('renewal_order_id');
 const tell=value=>{$('message').textContent=value;};
 const node=(tag,value)=>{const n=document.createElement(tag);if(value!==undefined)n.textContent=value;return n;};
 const money=n=>(Number(n)/100).toLocaleString('ar-SA')+' ر.س';
 let orders=[],receiptTimer=null,receiptGeneration=0,returnChecked=false,paymentReceiptGeneration=0;
 let lastSubscriptionData=null;
 let privateLogin=null,privateLoginTimeout=null;
 const PRIVATE_DISPLAY_MS=90*1000;
 function hidePrivateLogin(){
  if(privateLoginTimeout!==null){clearTimeout(privateLoginTimeout);privateLoginTimeout=null;}
  privateLogin?.remove();privateLogin=null;
 }
  const completeHost=raw=>{try{const u=new URL(String(raw));return u.protocol==='https:'
    ?'https://'+u.hostname+':443'+(u.pathname==='/'?'':u.pathname):u.origin;}catch{return String(raw||'');}};

 function clearPaymentReceipt(){
  paymentReceiptGeneration++;
  $('payment-receipt').hidden=true;
  $('payment-receipt-details').replaceChildren();
 }
 function clearReceipt(){
  hidePrivateLogin();
  receiptGeneration++;
  if(receiptTimer!==null){clearTimeout(receiptTimer);receiptTimer=null;}
  $('receipt').hidden=true;
  $('codes').replaceChildren();
 }
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
 function showProfileRequired(data){
  const missing=data.profileRequired===true&&data.profileComplete!==true;
  const form=$('profile-required');form.hidden=!missing;
  $('profile-name').value=String(data.fullName||'');
  $('profile-phone').value=String(data.phone||'');
  const dash=$('dashboard');
  for(const child of dash.children){
    if(child===form||child.classList?.contains('account-dashboard-head'))continue;
    child.hidden=missing;
  }
  return missing;
 }
 $('profile-form').addEventListener('submit',async event=>{
  event.preventDefault();const btn=$('profile-save');btn.disabled=true;
  $('profile-feedback').textContent='جارٍ حفظ البيانات…';
  try{
   const data=await api('/profile',{fullName:$('profile-name').value,phone:$('profile-phone').value});
   if(data.ok!==true||data.profileComplete!==true)throw Error('invalid_customer_profile');
   $('profile-feedback').textContent='✓ تم الحفظ. بريدك موثّق وبياناتك مكتملة.';
   await load();
  }catch(e){$('profile-feedback').textContent=statusMessage(e);}
  finally{btn.disabled=false;}
 });
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
   order_delivery_unavailable:'لم نتمكن من عرض الأكواد الآن؛ لا تكرر الدفع وتواصل مع الدعم.',
   customer_profile_required:'أكمل الاسم ورقم الجوال أولًا قبل طلب تجربة أو الدفع.',
   invalid_customer_profile:'أدخل اسمًا صحيحًا ورقم جوال سعودي يبدأ بـ05 أو +9665.',
   customer_phone_in_use:'رقم الجوال مستخدم بحساب BLOFY آخر. استرجع الحساب الأول أو تواصل مع الدعم.'
  };
  return map[e.message]||'تعذر إكمال العملية: '+e.message;
 }
 function updateOrderOverview(){
  $('overview-paid').textContent=String(orders.filter(o=>o?.status==='paid').length);
  $('overview-pending').textContent=String(orders.filter(o=>o?.status==='pending').length);
 }
 function updateSubscriptionOverview(subs){
  if(!Array.isArray(subs)){
   $('overview-active').textContent='—';
   $('overview-expiring').textContent='—';
   return;
  }
  const now=Date.now(),week=7*86400000;
  const live=subs.filter(item=>{
   // Unactivated, revoked, expired or unknown-expiry vouchers must never be
   // counted as active. Only verified account-scoped summaries are used.
   if(item?.redeemed!==true||item.reason==='revoked'||item.accountEnabled===false||!item.expiresAt)return false;
   const expiry=Date.parse(item.expiresAt);
   return Number.isFinite(expiry)&&expiry>now;
  });
  $('overview-active').textContent=String(live.length);
  $('overview-expiring').textContent=String(live.filter(item=>Date.parse(item.expiresAt)<=now+week).length);
 }
 function renderOrders(){
  const root=$('orders');root.replaceChildren();
  const query=String($('orders-search').value||'').trim().toLowerCase();
  const filter=$('orders-filter').value;
  const matches=orders.filter(o=>{
   if(!o||typeof o!=='object')return false;
   const status=String(o.status||'');
   if(filter==='paid'&&status!=='paid')return false;
   if(filter==='pending'&&status!=='pending')return false;
   if(filter==='other'&&!['failed','cancelled'].includes(status))return false;
   if(query&&!String(o.orderNumber||'').toLowerCase().includes(query))return false;
   return true;
  });
  $('orders-result-count').textContent=orders.length?
   'عرض '+matches.length+' من '+orders.length+' طلب':'لا توجد طلبات مرتبطة بحسابك بعد.';
  if(!orders.length)
   root.append(node('p','لا توجد طلبات مربوطة بعد. تستطيع إضافة طلب سابق باستخدام رابطه الخاص.'));
  else if(!matches.length)
   root.append(node('p','لا توجد طلبات تطابق البحث أو الحالة. جرّب تغيير التصفية.'));
  else for(const o of matches)root.append(addOrderCard(o));
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
  renew.textContent='مساعدة في التجديد';
  renew.href='https://wa.me/966568941484?text='+encodeURIComponent('السلام عليكم، أريد مساعدة في تجديد كود BLOFY المرتبط بطلب '+o.orderNumber+'. أرجو مراجعة حالته.');
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
  if(o.status==='paid'){
   const payment=node('button','إيصال الدفع');payment.className='secondary';payment.type='button';
   payment.addEventListener('click',()=>void showPaymentReceipt(o.orderId));
   buttons.append(payment);
  }
  buttons.append(details,renew,support);wrapper.append(buttons);return wrapper;
 }

 const renewalHost=sessionId=>uuid.test(sessionId||'')?
   'https://www.ksamerchant.geidea.net/hpp/checkout/?'+encodeURIComponent(sessionId):null;
 async function renewalRequest(path,body){
  const response=await fetch('/api/v1/store/renewals/'+path,{
   method:'POST',credentials:'same-origin',cache:'no-store',
   headers:{'content-type':'application/json',accept:'application/json'},
   body:JSON.stringify(body)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(Error(data.error||'store_renewal_unavailable'),
   {status:response.status});
  return data;
 }
 function expiryText(s){
  if(!s.expiresAt)return s.redeemed?'انتهاء الاشتراك غير معروف':'الكود لم يُفعّل';
  const expiry=new Date(s.expiresAt);
  return 'ينتهي: '+expiry.toLocaleDateString('ar-SA')+
    (expiry.getTime()<Date.now()?' · منتهي':'');
 }
 async function renewVoucher(v,sku,button){
  if(!uuid.test(v.voucherId||'')||typeof sku!=='string')return;
  button.disabled=true;
  try{
   const payload={voucherId:v.voucherId,planSku:sku};
   tell('جارٍ التحقق من التجديد السابق لنفس الكود...');
   const older=await renewalRequest('pending',{voucherId:v.voucherId});
   if(older.pending){
    const original=renewalHost(older.sessionId);
    if(original){
     tell('وجدنا جلسة دفع سابقة لنفس الكود؛ جارٍ فتحها مجددًا دون إصدار فاتورة ثانية.');
     location.assign(original);
    }else tell('لديك طلب تجديد سابق قيد التحقق لدى Geidea. افتح طلباتك أو تواصل مع الدعم قبل إعادة الدفع.');
    return;
   }
   const plan=await api('/subscriptions');
   const offered=plan.plans?.find(p=>p.sku===sku&&p.channel===v.channel);
   if(!offered)throw Error('store_invalid_renewal_plan');
   const riyals=(offered.priceMinor/100).toLocaleString('ar-SA')+' ريال';
   if(!confirm('تجديد نفس الكود '+v.codeHint+' لمدة '+offered.durationDays+
    ' يومًا مقابل '+riyals+'؟ لن تُضاف الأيام إلا بعد تأكيد الدفع.'))return;
   tell('جارٍ إنشاء جلسة Geidea لتجديد الكود الحالي...');
   const created=await renewalRequest('checkout',payload);
   if(created.sku!=='renewal'||created.voucherId!==v.voucherId||
     !uuid.test(created.sessionId||'')||!uuid.test(created.orderId||'')||
     created.priceMinor!==offered.priceMinor||created.currency!=='SAR')
    throw Error('store_renewal_quote_mismatch');
   const url=renewalHost(created.sessionId);
   if(!url)throw Error('store_renewal_session_invalid');
   tell('تم إنشاء طلب التجديد. جارٍ فتح بوابة Geidea الرسمية...');
   location.assign(url);
  }catch(e){
   // Checkout may have succeeded server-side despite a lost HTTP response.
   // Reuse the SAME pending Geidea session; never blindly retry a charge.
   try{
    const previous=await renewalRequest('pending',{voucherId:v.voucherId});
    if(previous.pending){
     const url=renewalHost(previous.sessionId);
     if(url){
      tell('استرجعنا جلسة التجديد الموجودة. لن نصدر فاتورة ثانية.');
      location.assign(url);
     }else tell('جلسة التجديد السابقة قيد التحقق، ولا يمكن إعادة فتحها. راجع حسابك أو الدعم قبل المحاولة.');
     return;
    }
   }catch(_){}
   tell(statusMessage(e));
  }finally{button.disabled=false;}
 }
 async function revealOwnedXtream(voucherId,article,trigger){
  if(!uuid.test(voucherId))return;
  if(!confirm('عرض بيانات Xtream الخاصة باشتراكك؟ لا تشارك كلمة المرور أو رابط M3U مع أحد.'))return;
  hidePrivateLogin();trigger.disabled=true;
  try{
   const payload=await api('/subscriptions/'+voucherId+'/xtream',{acknowledge:true});
   const c=payload.credentials||{};
   if(!payload.ok||!payload.subscriptionUnchanged||!c.serverUrl||!c.username||!c.password||!c.m3uUrl)
    throw Error('credential_not_recoverable');
   const secret=node('div');secret.className='code-card';
   for(const [name,value] of [['Host / رابط السيرفر الكامل',completeHost(c.serverUrl)],['Username',c.username],
     ['Password',c.password],['M3U',c.m3uUrl]]){
    const nameNode=node('small',name),text=node('code',String(value));
    text.setAttribute('dir','ltr');secret.append(nameNode,text);
   }
   const copy=node('button','نسخ جميع بيانات Xtream');copy.className='secondary';copy.type='button';
   copy.addEventListener('click',async()=>{
    try{
     await navigator.clipboard.writeText('Host: '+completeHost(c.serverUrl)+
      '\nUsername: '+c.username+
      '\nPassword: '+c.password+'\nM3U: '+c.m3uUrl);
     copy.textContent='تم النسخ ✓';
    }catch{copy.textContent='تعذر النسخ';}
   });
   const hide=node('button','إخفاء البيانات');hide.className='secondary';hide.type='button';
   hide.addEventListener('click',hidePrivateLogin);
   secret.append(copy,hide);article.append(secret);
   privateLogin=secret;
   privateLoginTimeout=setTimeout(hidePrivateLogin,PRIVATE_DISPLAY_MS);
   privateLoginTimeout?.unref?.();
   tell('بيانات Xtream ظاهرة مؤقتًا لمدة 90 ثانية ثم تُخفى لحمايتك. اضغط الكشف مجددًا عند الحاجة. تاريخ الاشتراك لم يتغير.');
  }catch(e){tell(statusMessage(e));}
  finally{trigger.disabled=false;}
 }
 function subscriptionState(s){
  if(s?.reason==='revoked')return 'revoked';
  if(!s?.redeemed)return 'unused';
  if(s.accountEnabled===false)return 'disabled';
  const deadline=Date.parse(s?.expiresAt||'');
  if(!Number.isFinite(deadline))return 'unknown';
  if(deadline<=Date.now())return 'expired';
  return deadline<=Date.now()+7*86400000?'expiring':'active';
 }
 async function loadSubscriptions({fromCache=false}={}){
  const box=$('subscriptions');
  hidePrivateLogin();box.replaceChildren();
  try{
   const data=fromCache&&lastSubscriptionData?lastSubscriptionData:await api('/subscriptions');
   lastSubscriptionData=data;
   const subs=Array.isArray(data.subscriptions)?data.subscriptions:[];
   const filter=$('subscriptions-filter').value,needle=$('subscriptions-search').value.trim().toLowerCase();
   const labels={active:'نشط',expiring:'قرب الانتهاء',unused:'لم يُفعّل',expired:'منتهي',revoked:'ملغى',disabled:'موقوف',unknown:'بحاجة مراجعة'};
   const matching=subs.filter(s=>{
    if(filter!=='all'&&!(filter==='active'&&['active','expiring'].includes(subscriptionState(s)))
      &&subscriptionState(s)!==filter)return false;
    if(needle&&!String(s.codeHint||'').toLowerCase().includes(needle)&&
     !(s.channel==='xtream'?'xtream':'stream').includes(needle))return false;
    return true;
   }).sort((a,b)=>{
    const order={expiring:0,unused:1,active:2,disabled:3,unknown:4,expired:5,revoked:6};
    return (order[subscriptionState(a)]??9)-(order[subscriptionState(b)]??9)||
     ((Date.parse(a.expiresAt||'')||0)-(Date.parse(b.expiresAt||'')||0));
   });
   $('subscriptions-count').textContent='عرض '+matching.length+' من '+subs.length+' اشتراك';
   updateSubscriptionOverview(subs);
   $('subscriptions-note').textContent=subs.length?
    'يمكنك تجديد الكود الحالي دون استبداله، فقط بعد دفع مؤكد.':
    'لا توجد أكواد مشتراة ومرتبطة بحسابك بعد. قد تحتاج إضافة طلبك السابق.';
   for(const s of matching){
    const article=node('article');article.className='receipt-line';
    const label=s.channel==='xtream'?'Xtream BLOFY':'BLOFY STREAM';
    const state=subscriptionState(s);
    const chip=node('span',labels[state]||'بحاجة مراجعة');
    chip.className='subscription-state subscription-state-'+state;
    const end=Date.parse(s.expiresAt||'');
    const days=Number.isFinite(end)&&end>Date.now()?Math.ceil((end-Date.now())/86400000):null;
    const remaining=days!==null?' · متبقي '+days+' يوم':'';
    article.append(node('strong',label+' · '+s.codeHint),chip,
      node('p',expiryText(s)+remaining));
    const status=node('p',s.canRenew?'يمكن تجديد نفس الكود دون تغيير بيانات الدخول':
      s.reason==='not_activated'?'يلزم تفعيل الكود قبل تجديده':
      s.reason==='revoked'?'الكود ملغى وغير قابل للتجديد':
      'هذا الاشتراك يحتاج مراجعة مع الدعم قبل التجديد');
    article.append(status);
    const actions=node('div');actions.className='actions';
    if(s.channel==='xtream'){
     if(!s.redeemed&&s.reason!=='revoked'){
      const redeem=node('a','تفعيل واستخراج Xtream');
      redeem.href='/redeem';redeem.className='primary';actions.append(redeem);
     }else if(s.redeemed&&s.expiresAt&&Date.parse(s.expiresAt)>Date.now()&&s.reason!=='revoked'){
      const restore=node('button','عرض بيانات Xtream');restore.type='button';
      restore.className='secondary';
      restore.addEventListener('click',()=>void revealOwnedXtream(s.voucherId,article,restore));
      actions.append(restore);
     }
    }else if(s.channel==='app'&&!s.redeemed){
     actions.append(node('small','أدخل الكود داخل تطبيق BLOFY STREAM لبدء مدة الاشتراك.'));
    }
    if(actions.childNodes.length)article.append(actions);
    if(s.canRenew){
     const controls=node('div');controls.className='actions';
     const select=node('select');
     select.setAttribute('aria-label','مدة تجديد '+label);
     const offers=(data.plans||[]).filter(p=>p.channel===s.channel&&
       [90,180,365].includes(p.durationDays));
     for(const p of offers){
      const opt=node('option',p.durationDays+' يومًا · '+money(p.priceMinor));
      opt.value=p.sku;select.append(opt);
     }
     const pay=node('button','تجديد نفس الكود عبر Geidea');pay.type='button';pay.className='primary';
     pay.disabled=!data.renewalsAvailable||!offers.length;
     pay.addEventListener('click',()=>void renewVoucher(s,select.value,pay));
     controls.append(select,pay);article.append(controls);
     if(!data.renewalsAvailable)article.append(node('small','التجديد الإلكتروني غير مفعّل حاليًا؛ استخدم الدعم.'));
    }
    box.append(article);
   }
  }catch(_){
   lastSubscriptionData=null;
   $('subscriptions-count').textContent='تعذّر قراءة عدد الاشتراكات.';
   updateSubscriptionOverview(null);
   $('subscriptions-note').textContent='تعذّر تحميل اشتراكاتك. حدّث الصفحة أو تواصل مع الدعم.';
  }
 }

 $('subscriptions-refresh').addEventListener('click',()=>void loadSubscriptions());
 $('subscriptions-filter').addEventListener('change',()=>void loadSubscriptions({fromCache:true}));
 $('subscriptions-search').addEventListener('input',()=>void loadSubscriptions({fromCache:true}));
 async function load(){
  clearReceipt();clearPaymentReceipt();
  try{
   const data=await api('');
   orders=Array.isArray(data.orders)?data.orders:[];
   $('account-email').textContent=data.email||'';
   view(true);
   if(showProfileRequired(data)){tell('أكمل الاسم ورقم الجوال للمتابعة.');return;}
   $('reminder-optin').checked=data.alertsOptIn===true;
   $('account-marketing-optin').checked=data.marketingOptIn===true;
   updateOrderOverview();
   renderOrders();
   view(true);tell('حسابك جاهز.');
   if(returnToCart){location.replace('/store/cart');return;}
   await loadSubscriptions();
   if(!returnChecked&&uuid.test(returnedRenewal||'')){
    returnChecked=true;
    history.replaceState(null,'','/store/account');
    const found=orders.some(o=>o.orderId===returnedRenewal);
    if(found)try{
     const verified=await api('/orders/'+encodeURIComponent(returnedRenewal)+'/check',{});
     if(verified.confirmedPaid){
      tell('تم تأكيد تجديد الكود من Geidea. هذه تفاصيل اشتراكك بعد التمديد.');
      await showOrder(returnedRenewal);
      await loadSubscriptions();
     }else tell('رجعنا من Geidea، والطلب لا يزال قيد التحقق. استخدم زر «التحقق من حالة الدفع» قبل أي محاولة جديدة.');
    }catch(_){tell('تعذر تأكيد تجديدك الآن. راجع حالة الطلب من القائمة ولا تكرر الدفع.');}
   }
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
 async function showPaymentReceipt(id){
  clearPaymentReceipt();
  const serial=paymentReceiptGeneration;
  try{
   const receipt=await api('/orders/'+encodeURIComponent(id)+'/payment-receipt');
   if(serial!==paymentReceiptGeneration||document.visibilityState==='hidden')return;
   if(receipt.kind!=='payment_receipt'||receipt.status!=='paid'||
     receipt.currency!=='SAR'||!Array.isArray(receipt.items)||receipt.isTaxInvoice!==false)
     throw Error('receipt_not_available');
   const section=$('payment-receipt-details');section.replaceChildren();
   section.append(node('p','رقم الإيصال: '+receipt.receiptNumber),
    node('p','رقم الطلب: '+receipt.orderNumber),
    node('p','تاريخ الدفع: '+new Date(receipt.paidAt).toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'})),
    node('p','وسيلة الدفع: Geidea'),node('h3','المشتريات'));
   for(const item of receipt.items)
    section.append(node('p',(item.description||'اشتراك BLOFY')+' × '+item.quantity));
   section.append(node('p','المجموع قبل الخصم: '+money(receipt.subtotalMinor)),
    node('p','الخصم: '+money(receipt.discountMinor)),
    node('strong','الإجمالي المدفوع: '+money(receipt.totalMinor)),
    node('p',receipt.legalNotice||'هذا ليس فاتورة ضريبية.'),
    node('p','للاطلاع على أكواد الاشتراك، افتح تفاصيل طلبك من حسابك.'));
   $('payment-receipt').hidden=false;
   $('payment-receipt').scrollIntoView({behavior:'smooth'});
  }catch(e){if(serial===paymentReceiptGeneration)tell(statusMessage(e));}
 }
 function appendActivationGuide(box,c){
  const guide=node('div');guide.className='blofy-activation-guide';
  const format=value=>new Date(value).toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'});
  guide.append(node('h4',c.channel==='xtream'?'خطوات تفعيل واستخراج Xtream':'خطوات تشغيل BLOFY STREAM'),
    node('p',c.activatedAt?'بدأ الاشتراك: '+format(c.activatedAt):
      'الكود غير مفعّل: لن تبدأ مدة الاشتراك إلا بعد أول تفعيل ناجح.'),
    node('p',c.expiresAt?'تاريخ الانتهاء: '+format(c.expiresAt):
      'لا يوجد تاريخ انتهاء حتى أول تفعيل ناجح؛ سيظهر بعدها.'));
  const list=node('ol');
  const steps=c.channel==='xtream'
   ?['انسخ كود Xtream أعلاه.','افتح صفحة التفعيل وأدخل الكود.',
      'استخرج رابط Host الكامل واسم المستخدم وكلمة المرور.',
      'أضف بيانات Xtream في تطبيق BLOFY PLAYER أو مشغّل متوافق.']
   :['حمّل تطبيق BLOFY STREAM من مركز التحميل الرسمي.',
      'افتح التطبيق ثم اختر إدخال كود الاشتراك.',
      'الصق الكود الموجود في تفاصيل الطلب لتفعيله.',
      'تبدأ مدة الاشتراك من أول تفعيل ناجح فقط.'];
  for(const step of steps)list.append(node('li',step));
  guide.append(list);
  const link=node('a',c.channel==='xtream'?'فتح صفحة تفعيل Xtream ↗':'تحميل BLOFY STREAM ↗');
  link.className='secondary';link.href=c.channel==='xtream'?'/stream/activate':'/downloads';
  guide.append(link);
  if(c.channel==='xtream'){
   const recover=node('a','استخراج / استرجاع بيانات Xtream ↗');
   recover.href='/redeem';recover.className='secondary';guide.append(recover);
  }
  box.append(guide);
 }
 async function showOrder(id){
  clearReceipt();
  const generation=receiptGeneration;
  try{
   const data=await api('/orders/'+encodeURIComponent(id));
   // Ignore an old response after the user closed details, signed out, or
   // opened another order. Codes must not repopulate a hidden tab.
   if(generation!==receiptGeneration||document.visibilityState==='hidden')return;
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
    box.append(code,meta,copy);
    if(c.channel==='xtream'){
     const link=node('a',c.expiresAt?'عرض اشتراكي من حسابي':'تفعيل واستخراج Xtream');
     link.className='secondary';link.href=c.expiresAt?'#account-subscriptions':'/redeem';
     box.append(link);
    }else box.append(node('small','فعّل الكود داخل تطبيق BLOFY STREAM لبدء مدة الاشتراك.'));
    appendActivationGuide(box,c);
    root.append(box);
   }
   $('receipt').scrollIntoView({behavior:'smooth'});
   // Verified paid-order codes stay visible until the customer hides the receipt.
  }catch(err){if(generation===receiptGeneration)tell(statusMessage(err));}
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
 $('account-marketing-optin').addEventListener('change',async function(){
  this.disabled=true;
  const chosen=this.checked;
  const display=$('account-marketing-status');
  display.textContent='جارٍ حفظ اختيار استقبال العروض…';
  try{
   const updated=await api('/marketing-preferences',{marketingOptIn:chosen});
   if(updated.ok!==true||updated.marketingOptIn!==chosen)
    throw Error('تعذر التأكد من حفظ التفضيل.');
   display.textContent=chosen?
    '✓ تم حفظ موافقتك الاختيارية. يمكنك إيقاف عروض BLOFY من هنا متى شئت.':
    '✓ تم إلغاء الموافقة على عروض BLOFY. لن تُعتبر موافقًا على التواصل التسويقي.';
  }catch(error){
   this.checked=!chosen;
   display.textContent=statusMessage(error);
  }finally{this.disabled=false;}
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
 $('orders-search').addEventListener('input',renderOrders);
 $('orders-filter').addEventListener('change',renderOrders);
 $('refresh-orders').addEventListener('click',async()=>{
  const button=$('refresh-orders');button.disabled=true;
  try{
   tell('جارٍ تحديث الطلبات والاشتراكات من حسابك...');
   await load();
  }finally{button.disabled=false;}
 });
 $('logout').addEventListener('click',async()=>{
  try{
   await api('/logout',{});
   clearReceipt();clearPaymentReceipt();
   // Do not carry this verified customer's basket or receipt tokens to
   // the next person who signs in from the same shared browser.
   try{
    localStorage.removeItem('blofy.shop.cart.v1');
    localStorage.removeItem('blofy.shop.cart.owner.v1');
   }catch(_){}
   try{
    sessionStorage.removeItem('blofy.shop.pending-checkout.v1');
    sessionStorage.removeItem('blofy.shop.last-order');
    for(const order of orders){
     if(!uuid.test(order?.orderId||''))continue;
     sessionStorage.removeItem('blofy.shop.order.'+order.orderId);
     sessionStorage.removeItem('blofy.shop.cart.checkout.'+order.orderId);
    }
   }catch(_){}
   view(false);orders=[];lastSubscriptionData=null;
   $('orders').replaceChildren();
   $('orders-search').value='';$('orders-filter').value='all';
   $('overview-paid').textContent='—';$('overview-pending').textContent='—';
   updateSubscriptionOverview(null);
   tell('تم تسجيل الخروج، وإخفاء السلة وروابط الطلبات الخاصة بهذا الحساب على هذا الجهاز.');
  }catch(e){tell(statusMessage(e));}
 });
 $('payment-receipt-close').addEventListener('click',clearPaymentReceipt);
 $('payment-receipt-print').addEventListener('click',()=>{if(!$('payment-receipt').hidden)window.print();});
 $('close-receipt').addEventListener('click',clearReceipt);
 // Keep paid receipts intact; protect recovered credentials when the tab is hidden.
 document.addEventListener('visibilitychange',()=>{if(document.hidden)hidePrivateLogin();});
 window.addEventListener('pagehide',()=>{clearReceipt();clearPaymentReceipt();hidePrivateLogin();});
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
