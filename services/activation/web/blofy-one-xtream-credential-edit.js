/* BLOFY ONE: deliberate admin change of ONE Xtream username/password.
 * Each credential independently supports keep, manual entry or secure system
 * generation. No automatic changes on viewing, searching or recovering codes. */
(() => {
 'use strict';
 const start=()=>{
  const $=id=>document.getElementById(id),dialog=$('one-xtream-edit-dialog'),
   form=$('one-xtream-edit-form'),status=$('one-xtream-edit-status'),
   resultBox=$('one-xtream-edit-result');
  if(!dialog||!form||!resultBox)return;
  const ui={
   userMode:$('one-xtream-edit-username-mode'),passMode:$('one-xtream-edit-password-mode'),
   userField:$('one-xtream-edit-username-field'),passField:$('one-xtream-edit-password-field'),
   user:$('one-xtream-edit-username'),pass:$('one-xtream-edit-password'),
   ack:$('one-xtream-edit-ack'),submit:$('one-xtream-edit-submit'),
   close:$('one-xtream-edit-close'),cancel:$('one-xtream-edit-cancel'),
   info:$('one-xtream-edit-account'),
   host:$('one-xtream-edit-host'),outUser:$('one-xtream-edit-user'),
   outPass:$('one-xtream-edit-pass'),m3u:$('one-xtream-edit-m3u'),
   copy:$('one-xtream-edit-copy'),copyM3u:$('one-xtream-edit-copy-m3u')
  };
  const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
  let account=null,busy=false,serial=0,secretTimer=null,retryBlocked=false;
  function clearSecrets(){
   serial++;
   if(secretTimer)clearTimeout(secretTimer);
   secretTimer=null;
   ui.host.textContent='';ui.outUser.textContent='';
   ui.outPass.textContent='';ui.m3u.textContent='';
   resultBox.hidden=true;ui.copy.disabled=true;ui.copyM3u.disabled=true;
  }
  function hideInputIfNotManual(mode,field,input){
   const manual=mode.value==='manual';
   field.hidden=!manual;
   input.required=manual;
   if(!manual)input.value='';
  }
  function syncModes(){
   hideInputIfNotManual(ui.userMode,ui.userField,ui.user);
   hideInputIfNotManual(ui.passMode,ui.passField,ui.pass);
   ui.submit.disabled=busy||retryBlocked||
     (ui.userMode.value==='keep'&&ui.passMode.value==='keep');
  }
  function reset(){
   clearSecrets();ui.user.value='';ui.pass.value='';form.reset();
   ui.userMode.value='keep';ui.passMode.value='keep';
   ui.ack.checked=false;form.hidden=false;
   retryBlocked=false;syncModes();
  }
  function close(){
   if(busy)return;
   clearSecrets();ui.user.value='';ui.pass.value='';
   account=null;
   if(dialog.open)dialog.close();
  }
  function fullHost(raw){
   const u=new URL(String(raw||''));
   if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||
      !['','/'].includes(u.pathname))throw Error('رابط السيرفر غير صالح.');
   return 'https://'+u.hostname+':'+(u.port||'443');
  }
  function explain(error){
   const errors={
    xtream_gateway_change_requires_confirmation:'يلزم تأكيد توقف بيانات الدخول القديمة.',
    xtream_gateway_change_modes_invalid:'اختر تغيير اسم المستخدم أو كلمة المرور على الأقل.',
    xtream_gateway_username_invalid:'المستخدم: 4–32 حرفًا لاتينيًا أو رقمًا أو _ فقط.',
    xtream_gateway_password_invalid:'كلمة المرور: 8–64 حرفًا لاتينيًا أو رقمًا أو _ أو -.',
    xtream_gateway_change_account_modified:'تغيّر الحساب من جلسة أخرى. حدّث القائمة وافتح الحساب من جديد.',
    xtream_gateway_username_exists:'اسم المستخدم مستخدم مسبقًا. اختر اسمًا آخر.',
    xtream_gateway_password_not_recoverable:'كلمة المرور القديمة غير قابلة للاسترجاع. اختر كلمة مرور يدوية أو توليد تلقائي.',
    xtream_gateway_change_nothing_changed:'البيانات الجديدة مطابقة للبيانات السابقة.',
    xtream_gateway_change_expected_revision_invalid:'نسخة بيانات الحساب غير معروفة. حدّث القائمة أولًا.',
    xtream_gateway_change_generation_invalid:'تعذر توليد بيانات آمنة. أعد تحميل الحساب.',
    xtream_gateway_account_not_found:'الحساب غير موجود. حدّث القائمة.',
    xtream_gateway_change_unexpected_secret:'امسح الحقول اليدوية غير المحددة.'
   };
   return errors[error]||'تعذّر تعديل بيانات الدخول. راجع السجل قبل محاولة جديدة.';
  }
  async function submit(event){
   event.preventDefault();
   if(busy||retryBlocked||!account||!dialog.open)return;
   syncModes();
   const um=ui.userMode.value,pm=ui.passMode.value;
   if(um==='keep'&&pm==='keep'){
    status.textContent='حدد ما تريد تغييره أولًا.';return;
   }
   if(!ui.ack.checked){status.textContent='يجب تأكيد انقطاع الدخول القديم أولًا.';return;}
   const username=um==='manual'?ui.user.value.trim():'';
   const password=pm==='manual'?ui.pass.value.trim():'';
   if((um==='manual'&&!/^[A-Za-z0-9_]{4,32}$/.test(username))||
      (pm==='manual'&&!/^[A-Za-z0-9_-]{8,64}$/.test(password))){
    status.textContent='تحقق من صيغة اسم المستخدم وكلمة المرور.';return;
   }
   if(!window.confirm('تأكيد نهائي: تغيير بيانات Xtream للحساب '+account.label+
     '؟ ستتوقف البيانات السابقة فورًا، وسيحتاج العميل إلى البيانات الجديدة. لن تتغير مدة الاشتراك أو الكود.'))return;
   busy=true;ui.close.disabled=true;ui.cancel.disabled=true;syncModes();
   clearSecrets();
   status.textContent='جارٍ تحديث بيانات نفس الحساب وحفظها دون تجديد الاشتراك…';
   const chosen={...account},generation=serial,body={
    usernameMode:um,passwordMode:pm,expectedUsername:account.username,
    expectedUpdatedAt:account.updatedAt,acknowledgeDisconnect:true,
    ...(um==='manual'?{username}:{}),...(pm==='manual'?{password}:{})
   };
   // Remove plaintext manual entry immediately; server receives it only in
   // the authenticated POST body and never in URL, analytics or browser storage.
   ui.user.value='';ui.pass.value='';
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
   let sent=false;
   try{
    sent=true;
    const response=await fetch('/api/v1/admin/xtream-gateway/accounts/'+
      encodeURIComponent(chosen.id)+'/change-credentials',{
       method:'POST',credentials:'same-origin',cache:'no-store',
       referrerPolicy:'no-referrer',
       headers:{accept:'application/json','content-type':'application/json'},
       body:JSON.stringify(body),signal:controller.signal
    });
    const data=await response.json().catch(()=>({}));
    if(response.status===401||response.status===403)
      throw Error('انتهت جلسة الإدارة، سجّل الدخول مرة أخرى.');
    if(!response.ok)throw Error(explain(data.error||data.code));
    if(!dialog.open||!account||account.id!==chosen.id||serial!==generation)return;
    const c=data.credentials||{};
    if(data.accountId!==chosen.id||data.subscriptionUnchanged!==true||
      data.oldCredentialsDisabled!==true||!data.item||
      data.item.id!==chosen.id||data.item.username!==c.username||
      !c.serverUrl||!c.username||!c.password)
      throw Error('السيرفر لم يؤكد سلامة بيانات الحساب. راجع السجل.');
    const host=fullHost(c.serverUrl),user=String(c.username),pass=String(c.password);
    ui.host.textContent=host;ui.outUser.textContent=user;ui.outPass.textContent=pass;
    ui.m3u.textContent=host+'/get.php?'+new URLSearchParams({
      username:user,password:pass,type:'m3u_plus',output:'ts'}).toString();
    form.hidden=true;resultBox.hidden=false;ui.copy.disabled=false;ui.copyM3u.disabled=false;
    status.textContent='✓ تم التغيير. البيانات القديمة توقفت، والاشتراك لم يتغير. انسخ البيانات الجديدة وأرسلها للعميل. ستُخفى بعد 30 ثانية.';
    retryBlocked=true;
    window.dispatchEvent(new CustomEvent('blofy-one:xtream-credentials-updated',{
      detail:{id:chosen.id}
    }));
    secretTimer=setTimeout(()=>{if(dialog.open&&serial===generation)clearSecrets();},30000);
   }catch(error){
    if(dialog.open&&account?.id===chosen.id){
     clearSecrets();
     // When a write may have reached the server we MUST NOT resend it
     // blindly: a second request could change a password twice.
     retryBlocked=sent&&(
      error.name==='AbortError'||/fetch|network|server|السيرفر|الاتصال|HTTP 5/i.test(error.message));
     const message=error.name==='AbortError'?
       'انتهت مهلة الاتصال. ربما حُفظ التغيير بالفعل؛ حدّث السجل وافحص البيانات قبل إعادة المحاولة.':
       error.message;
     status.textContent='تعذر تأكيد التغيير: '+message+
       (retryBlocked?' لا تُكرر الحفظ قبل التحقق من الحساب.':'');
    }
   }finally{
    clearTimeout(timer);
    busy=false;ui.close.disabled=false;ui.cancel.disabled=false;syncModes();
   }
  }
  window.addEventListener('blofy-one:xtream-change',event=>{
   if(busy)return;
   const raw=event.detail||{};
   if(!UUID.test(String(raw.id||''))||
      !Number.isSafeInteger(Number(raw.updatedAt))||Number(raw.updatedAt)<=0||
      typeof raw.username!=='string'||!raw.username)return;
   reset();
   account={id:raw.id,username:raw.username,label:String(raw.label||raw.username).slice(0,100),
    updatedAt:Number(raw.updatedAt)};
   ui.info.textContent='الحساب: '+account.label+' · اسم المستخدم الحالي: '+account.username+
    ' · سيبقى الحساب نفسه وتاريخ انتهائه دون تغيير.';
   status.textContent='اختر يدويًا أو من النظام لكل حقل، ثم وافق على إيقاف البيانات القديمة.';
   if(!dialog.open)dialog.showModal();
  });
  ui.userMode.addEventListener('change',syncModes);
  ui.passMode.addEventListener('change',syncModes);
  form.addEventListener('submit',event=>void submit(event));
  ui.close.addEventListener('click',close);ui.cancel.addEventListener('click',close);
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  dialog.addEventListener('close',()=>{clearSecrets();if(!busy)account=null;});
  async function copy(value,label){
   if(resultBox.hidden||!value)return;
   try{await navigator.clipboard.writeText(value);
    status.textContent='✓ نُسخت '+label+'. سلّمها لصاحب الاشتراك فقط.';}
   catch{status.textContent='تعذر النسخ التلقائي؛ انسخها يدويًا من الحقول.';}
  }
  ui.copy.addEventListener('click',()=>void copy('Host: '+ui.host.textContent+
   '\nUsername: '+ui.outUser.textContent+'\nPassword: '+ui.outPass.textContent,'بيانات Xtream'));
  ui.copyM3u.addEventListener('click',()=>void copy(ui.m3u.textContent,'رابط M3U'));
  $('one-xtream-edit-hide').addEventListener('click',clearSecrets);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)clearSecrets();});
  window.addEventListener('pagehide',clearSecrets);
  reset();
 };
 if(document.readyState==='loading')
   document.addEventListener('DOMContentLoaded',start,{once:true});
 else start();
})();
