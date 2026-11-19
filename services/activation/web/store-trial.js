'use strict';(()=>{
 const $=id=>document.getElementById(id);
 let available=false,owned=null,busy=false;
 const products=new Map();
 const messages={
  trial_login_required:'سجّل دخولك إلى حساب BLOFY بالبريد ورمز التحقق قبل طلب التجربة.',
  trial_out_of_stock:'نفد مخزون هذا النوع حاليًا. راجع التوفر لاحقًا أو تواصل مع الدعم.',
  trial_daily_quota_reached:'اكتملت حصة التجارب اليومية. جرّب لاحقًا.',
  trial_rate_limited:'عدد محاولات مرتفع. يرجى إعادة المحاولة لاحقًا.',
  trial_already_claimed:'لديك كود تجريبي سابق. استخدم زر استرجاع كودك.',
  trial_product_invalid:'نوع التجربة غير صحيح.',
  trial_origin_invalid:'تعذر التحقق من مصدر طلبك. حدّث الصفحة من الموقع الرسمي.',
  trials_unavailable:'التجارب غير متاحة من الموقع الآن. تواصل مع الدعم.',
  trial_code_unavailable:'تعذر إظهار الكود؛ تواصل مع الدعم.',
  trial_code_integrity_unavailable:'تعذر التحقق من سلامة الكود؛ تواصل مع الدعم.'
 };
 function notice(message,kind=''){
  const n=$('trial-notice');n.textContent=message;n.className='trial-notice '+kind;n.hidden=false;
 }
 function clearNotice(){$('trial-notice').hidden=true;$('trial-notice').textContent=''}
 function buttons(enabled){
  for(const button of document.querySelectorAll('[data-trial-claim]')){
   const sku=button.dataset.trialClaim;
   button.disabled=busy||!enabled||(products.get(sku)||0)<=0||!!owned;
  }
 }
 async function api(path,options={}){
  const result=await fetch(path,{credentials:'same-origin',cache:'no-store',
   headers:{accept:'application/json',...(options.method?{
    'content-type':'application/json','x-blofy-trial':'1'}:{})},
   ...options});
  const body=await result.json().catch(()=>({}));
  if(!result.ok){
   const reason=body.error||'trial_request_unavailable';
   const e=new Error(messages[reason]||'تعذر التحقق من مخزون التجارب؛ حاول لاحقًا.');
   e.status=result.status;e.code=reason;throw e;
  }
  return body;
 }
 function formatDate(value){
  if(!value)return '';
  const date=new Date(value);
  if(!Number.isFinite(date.getTime()))return '';
  return date.toLocaleString('ar-SA',{timeZone:'Asia/Riyadh',dateStyle:'medium',timeStyle:'short'});
 }
 function showOwned(trial){
  if(!trial||typeof trial.code!=='string')return;
  owned=trial;
  $('trial-result-code').textContent=trial.code;
  $('trial-result-channel').textContent=trial.channel==='app'?'BLOFY STREAM':'Xtream';
  $('trial-result-message').textContent=trial.alreadyClaimed?
   'هذا هو كود تجربتك الذي حصلت عليه سابقًا. لن يتم إنشاء تجربة جديدة.':
   'تم حجز الكود من المخزون بنجاح، دون دفع.';
  $('trial-result-dates').textContent=trial.expiresAt?
   'تم التفعيل؛ تاريخ انتهاء التجربة: '+formatDate(trial.expiresAt):
   'تبدأ مدة اليوم الواحد عند أول تفعيل ناجح فقط.';
  $('trial-xtream-link').hidden=trial.channel!=='xtream';
  $('trial-result').hidden=false;
  buttons(false);
  if(!trial.alreadyClaimed)notice('تم تخصيص كود تجريبي لحسابك. يمكنك نسخه الآن.','success');
 }
 async function refresh(){
  try{
   const data=await api('/api/v1/store/trials/availability');
   available=data.enabled===true;
   for(const p of Array.isArray(data.products)?data.products:[]){
    const n=Math.max(0,Number(p.available)||0);
    products.set(p.sku,n);
    const el=$(p.sku==='trial-stream-1d'?'trial-stream-stock':
      p.sku==='trial-xtream-1d'?'trial-xtream-stock':'');
    if(el)el.textContent=available?(n>0?n+' كود جاهز':'غير متوفر الآن'):'التجربة غير مفعلة';
   }
   if(!available){
    buttons(false);
    notice('خدمة تسليم التجارب من الموقع غير مفعلة حاليًا. يمكنك الاستفسار عبر صفحة الدعم.');
    return;
   }
   buttons(true);
   try{
    const mine=await api('/api/v1/store/trials/mine');
    if(mine?.claimed&&mine.trial)showOwned(mine.trial);
    else if(!owned)clearNotice();
   }catch(e){
    if(e.status===401){
     notice('للحصول على كود تجريبي، سجّل الدخول أولًا من «حسابي» ثم ارجع لهذه الصفحة.');
    }else notice(e.message,'error');
   }
  }catch(e){available=false;buttons(false);notice(e.message,'error')}
 }
 async function claim(sku){
  if(!available||busy||owned||(products.get(sku)||0)<=0)return;
  const channel=sku==='trial-stream-1d'?'BLOFY STREAM':'Xtream';
  if(!window.confirm('تأكيد تجربة '+channel+' ليوم واحد؟ يمكنك الحصول على تجربة واحدة فقط لحسابك، ولا يوجد دفع.'))return;
  busy=true;buttons(false);notice('جارٍ تخصيص كود تجريبي لحسابك...');
  try{
   const result=await api('/api/v1/store/trials/claim',{
    method:'POST',body:JSON.stringify({sku})
   });
   if(result.ok&&result.code)showOwned(result);
   else notice('لم يتم تأكيد تخصيص الكود؛ راجع الحساب أو تواصل مع الدعم.','error');
  }catch(e){
   notice(e.message,'error');
   if(e.status===401)notice('سجّل دخولك إلى الحساب بالبريد أولًا ثم ارجع لطلب التجربة.','error');
   if(e.status===409&&e.code==='trial_already_claimed'){
    try{const mine=await api('/api/v1/store/trials/mine');if(mine.trial)showOwned(mine.trial)}catch(_){}
   }
  }finally{busy=false;buttons(true);if(owned)buttons(false)}
 }
 document.querySelectorAll('[data-trial-claim]').forEach(b=>
  b.addEventListener('click',()=>void claim(b.dataset.trialClaim)));
 $('trial-copy').addEventListener('click',async()=>{
  const code=$('trial-result-code').textContent;
  if(!code)return;
  try{await navigator.clipboard.writeText(code);
   notice('تم نسخ كود التجربة.','success')}
  catch(_){notice('حدد الكود المعروض لنسخه يدويًا.')}
 });
 $('trial-refresh').addEventListener('click',()=>void refresh());
 void refresh();
})();