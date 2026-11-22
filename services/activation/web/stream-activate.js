/* BLOFY universal owner-safe extraction: fresh STREAM/Xtream code redeems
 * once; an activated code reveals only to its verified store/trial owner.
 * Never persist code, passwords or the M3U in browser storage or URLs. */
'use strict';
(function(){
 const $=id=>document.getElementById(id);
 const form=$('form'),input=$('code'),button=$('submit'),
  message=$('message'),section=$('result'),fields=$('fields'),
  agree=$('confirm-start');
 let credentials=null,secretTimer=null,pending=false;
 const SECRET_DISPLAY_MS=90*1000;
 const ERRORS={
  stream_code_invalid:'هذا ليس كود BLOFY صحيحًا. أدخل الكود الأصلي من 8–12 رقمًا أو الكود القديم المعتمد.',
  stream_extraction_confirmation_required:'وافِق أولاً على أن مدة الاشتراك تبدأ عند التفعيل الأول.',
  stream_extraction_origin_invalid:'افتح صفحة الاستخراج من نطاق BLOFY الرسمي.',
  stream_code_rate_limited:'محاولات كثيرة. أعد المحاولة بعد قليل.',
  stream_code_wrong_product:'نوع هذا الكود غير مدعوم للاستخراج.',
  stream_extraction_login_required:'هذا الكود قد يكون مستخدمًا. سجّل الدخول إلى الحساب الموثّق الذي يملك الاشتراك ثم استخرج بياناته مرة أخرى.',
  stream_extraction_not_owned:'هذا الكود غير مرتبط بحسابك الموثّق، أو غير معروف. للدعم اذكر رقم طلبك دون مشاركة كلمة مرور.',
  stream_extraction_not_activated:'الكود لم يُفعّل بعد. ابدأ التفعيل من صفحة الاستخراج.',
  subscription_expired_or_disabled:'الاشتراك منتهي أو ملغى أو متوقف؛ لا يمكن استخراج بيانات فعالة.',
  credential_not_recoverable:'بيانات هذا الاشتراك القديم غير قابلة للاسترجاع؛ تواصل مع الدعم.',
  credential_reveal_rate_limited:'عدد محاولات الاسترجاع كبير. جرّب لاحقًا.',
  xtream_host_not_ready:'رابط السيرفر لم يُجهّز بعد. تواصل مع الدعم.'
 };
 function hideSecrets(){
  if(secretTimer!==null){clearTimeout(secretTimer);secretTimer=null;}
  credentials=null;fields.replaceChildren();section.classList.add('hide');
 }
 function show(text,ok=false){
  message.textContent=text;message.className='status'+(ok?' ok':'');
 }
 function completeHost(raw){
  try{
   const u=new URL(String(raw));
   if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)
    throw Error('invalid_origin');
   return 'https://'+u.hostname+':'+(u.port||'443')+(u.pathname==='/'?'':u.pathname);
  }catch{return String(raw||'');}
 }
 function field(label,value,copy=false){
  const line=document.createElement('div');line.className='row';
  const name=document.createElement('small');name.textContent=label;line.append(name);
  const data=document.createElement('strong');data.textContent=String(value??'—');line.append(data);
  if(copy&&value){
   const c=document.createElement('button');c.type='button';c.className='copy';c.textContent='نسخ';
   c.addEventListener('click',async()=>{
    if(section.classList.contains('hide'))return;
    try{await navigator.clipboard.writeText(String(value));c.textContent='تم النسخ ✓'}
    catch{show('حدد النص وانسخه يدويًا.');}
   });
   line.append(c);
  }
  fields.append(line);
 }
 function saTime(value){
  const d=new Date(value);
  return Number.isFinite(d.getTime())?
   d.toLocaleString('ar-SA-u-ca-gregory',{timeZone:'Asia/Riyadh',
    dateStyle:'medium',timeStyle:'short'}):'—';
 }
 function display(result){
  if(result.ok!==true||result.universalExtraction!==true||
     result.originalVoucherPreserved!==true||!result.credentials||
     !result.account||!result.credentials.username||!result.credentials.password||
     !result.credentials.serverUrl)
   throw Error('لم يتم تأكيد صحة بيانات الاستخراج من السيرفر.');
  const c=result.credentials;
  credentials={
   serverUrl:completeHost(c.serverUrl),username:String(c.username),
   password:String(c.password),m3uUrl:String(c.m3uUrl||'')
  };
  fields.replaceChildren();
  field('Host / رابط السيرفر الكامل',credentials.serverUrl,true);
  field('اسم المستخدم Xtream',credentials.username,true);
  field('كلمة المرور Xtream',credentials.password,true);
  field('رابط M3U',credentials.m3uUrl,true);
  field('مدة الاشتراك الأصلية',String(result.account.durationDays)+' يوم');
  field('تاريخ بدء الاشتراك',saTime(result.account.activatedAt));
  field('تاريخ انتهاء الاشتراك',saTime(result.account.expiresAt));
  const recovered=result.recovered===true;
  $('result-title').textContent=recovered?
   'تم استرجاع بيانات Xtream لنفس اشتراكك ✓':
   'تم تفعيل الكود واستخراج بيانات Xtream ✓';
  $('result-help').textContent=recovered?
   'أُعيد عرض بيانات حساب Xtream الأصلي، دون تجديد أو إنشاء اشتراك جديد.':
   'تم بدء فترة اشتراكك الأصلي لأول مرة. يمكنك استخدام Xtream، مع الحفاظ على إمكانية الدخول إلى تطبيق BLOFY STREAM بالكود نفسه.';
  section.classList.remove('hide');
  input.value='';agree.checked=false;
  show(recovered?'✓ تم استخراج البيانات من حسابك الموثّق دون تغيير المدة.':
    '✓ تم الاستخراج. بدأت المدة مرة واحدة فقط، واحتُفظ بميزة STREAM للكود.',true);
  secretTimer=setTimeout(hideSecrets,SECRET_DISPLAY_MS);
 }
 async function request(path,body,owned=false){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),18000);
  try{
   const r=await fetch(path,{
    method:'POST',
    credentials:owned?'same-origin':'omit',
    cache:'no-store',referrerPolicy:'no-referrer',
    headers:{'content-type':'application/json','accept':'application/json',
     ...(owned?{}:{'x-blofy-extraction':'1'})},
    body:JSON.stringify(body),signal:controller.signal
   });
   const data=await r.json().catch(()=>({}));
   return {status:r.status,ok:r.ok,data};
  }finally{clearTimeout(timer);}
 }
 function normalizeCode(raw){
  return String(raw||'').trim().toUpperCase()
   .replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-0x660))
   .replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-0x6f0))
   .replace(/[\s-]+/g,'');
 }
 form.addEventListener('submit',async event=>{
  event.preventDefault();
  if(pending)return;
  hideSecrets();
  const code=normalizeCode(input.value);
  if(!/^(?:[0-9]{8,12}|[A-F0-9]{24})$/.test(code)){
   show(ERRORS.stream_code_invalid);return;
  }
  if(!agree.checked){show(ERRORS.stream_extraction_confirmation_required);return;}
  pending=true;button.disabled=true;
  show('جارٍ فحص كود BLOFY واستخراج البيانات الآمنة…');
  try{
   // A brand-new code of either product is converted to a shared gateway
   // account ONCE; an already-used code must never anonymously reveal secrets.
   const first=await request('/api/v1/stream/extract',{code,confirmStart:true});
   if(first.ok&&first.data.ok===true){display(first.data);return;}
   if(first.status===409){
    // The same logged-in verified account must own this exact paid/trial code.
    const owned=await request('/api/v1/store/account/extract-xtream',{
     code,acknowledge:true
    },true);
    if(owned.ok&&owned.data.ok===true){display(owned.data);return;}
    const reason=owned.data.error||owned.data.code||'';
    show(ERRORS[reason]||'الكود مستخدم أو غير متاح؛ سجّل الدخول إلى حسابك الموثّق أو تواصل مع الدعم.');
    return;
   }
   const reason=first.data.error||first.data.code||'';
   show(ERRORS[reason]||'تعذّر استخراج البيانات لهذا الكود. تحقق من صحته أو تواصل مع الدعم.');
  }catch(error){
   // A lost response could still mean a successful one-time activation.
   show(error?.name==='AbortError'?
    'انتهت مهلة الاتصال. ربما تم التفعيل بالفعل. سجّل الدخول إلى حسابك وافحص الاشتراك قبل إعادة المحاولة.':
    'انقطع الاتصال. ربما اكتمل التفعيل دون وصول النتيجة؛ تحقّق من حسابك قبل إعادة المحاولة.');
  }finally{pending=false;button.disabled=false;}
 });
 $('copy-all').addEventListener('click',async()=>{
  if(!credentials||section.classList.contains('hide'))return;
  try{
   await navigator.clipboard.writeText('Host: '+credentials.serverUrl+
    '\nUsername: '+credentials.username+'\nPassword: '+credentials.password+
    '\nM3U: '+credentials.m3uUrl);
   show('✓ تم نسخ بيانات Xtream. لا تشاركها إلا مع صاحب الاشتراك.',true);
  }catch{show('تعذر النسخ التلقائي؛ انسخ كل حقل على حدة.');}
 });
 $('hide-result').addEventListener('click',hideSecrets);
 document.addEventListener('visibilitychange',()=>{if(document.hidden)hideSecrets();});
 window.addEventListener('pagehide',hideSecrets);
})();
