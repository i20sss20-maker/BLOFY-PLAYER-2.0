'use strict';
(() => {
 const $=id=>document.getElementById(id);
 const loginPanel=$('login-panel'),workspace=$('reseller-workspace'),notice=$('reseller-notice');
 let account=null,codeOffset=0,nextCodeOffset=null,codesVersion=0;
 let issueRetry=null,renewRetry=null,detailText='';
 const messages={
  reseller_login_required:'انتهت جلسة الدخول. سجّل دخولك من جديد.',
  distributor_login_failed:'اسم المستخدم أو كلمة المرور غير صحيحة.',
  distributor_session_expired:'انتهت جلسة الموزع. سجّل الدخول مجددًا.',
  distributor_unauthorized:'ليس لديك صلاحية لهذا الطلب.',
  distributor_issue_missing:'لم يُعثر على هذا الاشتراك ضمن حسابك.',
  distributor_issue_not_ready:'الاشتراك لم يصبح جاهزًا للإظهار بعد.',
  distributor_password_current_invalid:'كلمة المرور الحالية غير صحيحة.',
  distributor_password_strength_invalid:'اختر كلمة مرور أقوى: 14 حرفًا مع حرف كبير وصغير ورقم.',
  distributor_password_reused:'كلمة المرور الجديدة مطابقة للحالية.',
  distributor_rotation_cooldown:'لا يمكن تغيير بيانات الاتصال بهذه السرعة.',
  rate_limited:'عدد محاولات كبير. حاول بعد قليل.',
  reseller_service_not_configured:'بوابة الموزعين غير مفعّلة على الخادم حاليًا.',
  reseller_temporarily_unavailable:'تعذر الاتصال بخدمة الموزعين. تحقق من السجل قبل إعادة إصدار كود.',
  reseller_request_failed:'تعذّر تنفيذ العملية. راجع الرصيد والصلاحيات والمحاولات السابقة.',
  invalid_json:'البيانات المرسلة غير صالحة.'
 };
 const labels={app:'STREAM',xtream:'Xtream',active:'نشط',unused:'لم يُفعّل',
  expiring:'قارب الانتهاء',expired:'منتهي',disabled:'معطّل',
  pending:'قيد الإجراء',review:'تحت المراجعة',failed:'تعذّر الإصدار',
  done:'مكتمل',opening:'رصيد افتتاحي',adjustment:'تعديل رصيد',
  issue:'إصدار اشتراك',renew:'تجديد',refund:'استرجاع رصيد',relogin:'إعادة دخول'};
 const asText=v=>String(v??'');
 const number=v=>Number.isFinite(Number(v))?Number(v).toLocaleString('ar-SA'):'—';
 const time=epoch=>{
  if(!epoch)return '—';
  const t=new Date(epoch);
  return Number.isFinite(t.getTime())?t.toLocaleDateString('ar-SA',
   {timeZone:'Asia/Riyadh',year:'numeric',month:'short',day:'numeric'}):'—';
 };
 function say(message,kind='info'){
  notice.hidden=false;notice.className='notice '+(kind==='error'?'error':kind==='success'?'success':'');
  notice.textContent=message;
 }
 function clearNotice(){notice.textContent='';notice.hidden=true;}
 function buttonBusy(button,busy){if(button)button.disabled=busy;}
 const el=(tag,text='',className='')=>{
  const node=document.createElement(tag);node.textContent=asText(text);
  if(className)node.className=className;return node;
 };
 async function api(command,payload={}){
  const response=await fetch('/api/v1/store/reseller/'+command,{
   method:'POST',credentials:'same-origin',cache:'no-store',
   headers:{'content-type':'application/json','x-blofy-reseller':'1',accept:'application/json'},
   body:JSON.stringify(payload)
  });
  let result={};try{result=await response.json();}catch(_){}
  if(!response.ok||result?.ok!==true){
   const reason=result?.error||'reseller_temporarily_unavailable';
   const error=Error(messages[reason]||messages.reseller_request_failed);
   error.code=reason;error.status=response.status;
   throw error;
  }
  return result;
 }
 function showLoggedIn(item){
  account=item;
  $('reseller-name').textContent=item?.name||'الموزع';
  $('reseller-username').textContent=item?.username||'';
  $('stat-credits').textContent=number(item?.credits);
  $('stat-limit').textContent=number(item?.dailyLimit);
  loginPanel.hidden=true;workspace.hidden=false;
 }
 function showLoggedOut(){
  account=null;detailText='';issueRetry=null;renewRetry=null;
  $('issue-result').hidden=true;$('issue-result-fields').replaceChildren();
  workspace.hidden=true;loginPanel.hidden=false;
 }
 function handleError(error){
  say(error?.message||messages.reseller_temporarily_unavailable,'error');
  if(error?.status===401||error?.code==='reseller_login_required')showLoggedOut();
 }
 function switchTab(tab){
  const allow=new Set(['overview','issue','codes','customers','account']);
  if(!allow.has(tab))return;
  for(const b of document.querySelectorAll('[data-tab]')){
   b.setAttribute('aria-selected',String(b.dataset.tab===tab));
  }
  for(const section of document.querySelectorAll('.view'))
   section.hidden=section.id!=='view-'+tab;
  if(tab==='overview')void refreshOverview();
  if(tab==='codes')void refreshCodes(true);
  if(tab==='customers')void refreshCustomers();
 }
 async function refreshOverview(){
  try{
   const [me,report,activity]=await Promise.all([
    api('me'),api('analytics'),api('activity',{offset:0})]);
   showLoggedIn(me.item);
   const a=report.stats||{};
   $('stat-today').textContent=number(a.today);
   $('stat-month').textContent=number(a.month);
   $('stat-limit').textContent=number(a.dailyLimit??me.item.dailyLimit);
   const container=$('activity-list');container.replaceChildren();
   if(!Array.isArray(activity.items)||!activity.items.length){
    container.append(el('p','لا توجد عمليات مسجلة حتى الآن.','muted'));return;
   }
   for(const item of activity.items.slice(0,12)){
    const row=el('div','','activity-row');
    const desc=el('div');
    desc.append(el('b',labels[item.type]||'حركة رصيد'),
      el('small',time(item.date)));
    const delta=Number(item.delta);
    const amount=el('span',(delta>0?'+':'')+number(delta),
      delta<0?'amount negative':'amount');
    row.append(desc,amount);container.append(row);
   }
  }catch(e){handleError(e)}
 }
 function resultFields(title,entries){
  const fields=$('issue-result-fields');fields.replaceChildren();
  $('issue-result-title').textContent=title;
  detailText=entries.map(([label,value])=>label+': '+asText(value)).join('\n');
  for(const [label,value] of entries){
   if(value==null||value==='')continue;
   const wrap=el('div','','result-line'),desc=el('small',label),code=el('code',value);
   wrap.append(desc,code);fields.append(wrap);
  }
  $('issue-result').hidden=false;
  $('issue-copy').hidden=!detailText;
 }
 function showResult(result){
  const credentials=result.credentials||{};
  const fields=result.code?
   [['كود BLOFY STREAM',result.code]]:
   [['الرابط الكامل',credentials.serverUrl||''],
    ['اسم المستخدم',credentials.username||''],
    ['كلمة المرور',credentials.password||''],
    ['رابط M3U',credentials.m3uUrl||'']];
  if(result.issue?.id)fields.unshift(['معرّف اشتراكك',result.issue.id]);
  resultFields(result.issue?.status==='done'||result.code||result.credentials?
   'تم إصدار الاشتراك بنجاح':'تم استلام الطلب ويحتاج متابعة',fields);
 }
 async function refreshCodes(reset=false){
  if(reset){codeOffset=0;nextCodeOffset=null;$('codes-rows').replaceChildren();}
  const version=++codesVersion;
  const payload={offset:codeOffset,q:$('codes-search').value.trim(),
    status:$('codes-status').value};
  const body=$('codes-rows');
  try{
   const result=await api('list',payload);
   if(version!==codesVersion)return;
   if(reset)body.replaceChildren();
   const items=Array.isArray(result.items)?result.items:[];
   if(!items.length&&codeOffset===0){
    const tr=document.createElement('tr'),td=el('td','لا توجد أكواد مطابقة.');
    td.colSpan=5;tr.append(td);body.append(tr);
   }
   for(const item of items){
    const tr=document.createElement('tr');
    const name=el('td',item.label||'BLOFY');
    name.append(el('small',item.customerName||''));
    const kind=el('td',(labels[item.type]||item.type)+' / '+number(item.days)+' يوم');
    const badge=el('span',labels[item.subscriptionStatus]||item.subscriptionStatus,
      'badge '+(item.subscriptionStatus||''));
    const status=el('td');status.append(badge);
    const expiry=el('td',time(item.expiresAt));
    const actions=el('td','','row-actions');
    const reveal=el('button','إظهار');
    reveal.type='button';reveal.className='ghost small';
    reveal.addEventListener('click',()=>void revealIssue(item.id));
    actions.append(reveal);
    if(item.status==='done'){
     const renew=el('button','تجديد');
     renew.type='button';renew.className='ghost small';
     renew.addEventListener('click',()=>prepareRenew(item.id));
     actions.append(renew);
    }
    if(item.canRelogin){
     const relogin=el('button','إعادة دخول');
     relogin.type='button';relogin.className='ghost small';
     relogin.addEventListener('click',()=>void enableRelogin(item.id,relogin));
     actions.append(relogin);
    }
    tr.append(name,kind,status,expiry,actions);body.append(tr);
   }
   nextCodeOffset=result.nextOffset??null;
   $('codes-next').hidden=nextCodeOffset==null;
   $('codes-page').textContent='المعروض: '+body.children.length+' اشتراك';
  }catch(e){handleError(e)}
 }
 async function refreshCustomers(){
  try{
   const data=await api('clients',{q:$('customers-search').value.trim()});
   const rows=$('customers-rows');rows.replaceChildren();
   if(!data.items?.length){const tr=el('tr'),td=el('td','لا توجد سجلات مطابقة.');td.colSpan=4;tr.append(td);rows.append(tr);return;}
   for(const entry of data.items){
    const tr=el('tr');
    tr.append(el('td',entry.name||'—'),el('td',entry.phone||'—'),
      el('td',number(entry.subscriptions)),el('td',time(entry.latest)));
    rows.append(tr);
   }
  }catch(e){handleError(e)}
 }
 async function revealIssue(id){
  clearNotice();
  try{
   const result=await api('reveal',{issueId:id});
   showResult(result);
   switchTab('issue');$('issue-result').scrollIntoView({block:'nearest'});
   say('ظهرت بيانات اشتراكك؛ لا تشاركها إلا مع صاحب الاشتراك.','success');
  }catch(e){handleError(e)}
 }
 function prepareRenew(id){
  renewRetry=null;$('renew-target').value=id;$('renew-box').hidden=false;
  switchTab('issue');
  $('renew-box').scrollIntoView({block:'nearest'});
 }
 async function enableRelogin(issueId,button){
  if(!window.confirm('السماح بإعادة دخول هذا الكود لفترة قصيرة؟'))return;
  buttonBusy(button,true);
  try{
   const result=await api('relogin',{issueId,requestId:crypto.randomUUID()});
   say(result.allowedUntil?
    'تم السماح بإعادة الدخول حتى '+new Date(result.allowedUntil).toLocaleTimeString('ar-SA') :
    'تم تنفيذ طلب إعادة الدخول.','success');
   await refreshCodes(true);
  }catch(e){handleError(e)}finally{buttonBusy(button,false)}
 }
 async function start(){
  try{const data=await api('me');showLoggedIn(data.item);switchTab('overview');}
  catch(error){showLoggedOut();if(error?.status!==401&&error?.code!=='reseller_login_required')handleError(error);}
 }
 $('login-form').addEventListener('submit',async event=>{
  event.preventDefault();clearNotice();
  const button=$('login-button');buttonBusy(button,true);
  try{
   const result=await api('login',{
    username:$('login-username').value.trim(),
    password:$('login-password').value
   });
   $('login-password').value='';
   showLoggedIn(result.item);switchTab('overview');
   say('تم تسجيل الدخول بنجاح.','success');
  }catch(e){$('login-password').value='';handleError(e)}
  finally{buttonBusy(button,false)}
 });
 $('logout-button').addEventListener('click',async()=>{
  try{await api('logout');showLoggedOut();clearNotice();}
  catch(e){handleError(e)}
 });
 document.querySelectorAll('[data-tab]').forEach(btn=>
  btn.addEventListener('click',()=>{clearNotice();switchTab(btn.dataset.tab)}));
 document.querySelectorAll('[data-open-tab]').forEach(a=>
  a.addEventListener('click',e=>{e.preventDefault();switchTab(a.dataset.openTab)}));
 $('activity-refresh').addEventListener('click',()=>void refreshOverview());
 $('codes-refresh').addEventListener('click',()=>void refreshCodes(true));
 $('codes-search-form').addEventListener('submit',e=>{e.preventDefault();void refreshCodes(true)});
 $('codes-next').addEventListener('click',()=>{if(nextCodeOffset==null)return;codeOffset=nextCodeOffset;void refreshCodes()});
 $('customers-refresh').addEventListener('click',()=>void refreshCustomers());
 $('customers-search-form').addEventListener('submit',e=>{e.preventDefault();void refreshCustomers()});
 $('issue-days').addEventListener('change',()=>{
  const plan={30:1,90:3,180:6,365:12};
  $('issue-cost-note').textContent='التكلفة: '+number(plan[$('issue-days').value])+' رصيد';
 });
 $('issue-form').addEventListener('submit',async event=>{
  event.preventDefault();clearNotice();
  const button=$('issue-button');
  const payload={kind:$('issue-kind').value,durationDays:Number($('issue-days').value),
   label:$('issue-label').value.trim(),customerName:$('issue-customer').value.trim(),
   customerPhone:$('issue-phone').value.trim()};
  const fingerprint=JSON.stringify(payload);
  if(!issueRetry||issueRetry.fingerprint!==fingerprint)
   issueRetry={fingerprint,requestId:crypto.randomUUID()};
  if(!window.confirm('تأكيد إصدار الاشتراك وخصم الرصيد المحدد من حسابك؟'))return;
  buttonBusy(button,true);
  try{
   const result=await api('issue',{...payload,requestId:issueRetry.requestId});
   showResult(result);issueRetry=null;
   say('تم استلام نتيجة الإصدار من الخادم.','success');
   const me=await api('me');showLoggedIn(me.item);
  }catch(e){handleError(e);if(e?.status!==503)issueRetry=null}
  finally{buttonBusy(button,false)}
 });
 $('renew-form').addEventListener('submit',async event=>{
  event.preventDefault();clearNotice();
  const issueId=$('renew-target').value,days=Number($('renew-days').value);
  const fingerprint=issueId+':'+days;
  if(!renewRetry||renewRetry.fingerprint!==fingerprint)
   renewRetry={fingerprint,requestId:crypto.randomUUID()};
  if(!window.confirm('تأكيد تجديد هذا الاشتراك وخصم الرصيد؟'))return;
  const button=$('renew-button');buttonBusy(button,true);
  try{
   const data=await api('renew',{issueId,days,requestId:renewRetry.requestId});
   renewRetry=null;$('renew-box').hidden=true;
   resultFields('تم التجديد',[['معرّف الاشتراك',issueId],
    ['تاريخ الانتهاء الجديد',time(data.expiresAt)]]);
   say('تم تجديد الاشتراك من خادم الموزعين.','success');
   const me=await api('me');showLoggedIn(me.item);
  }catch(e){handleError(e);if(e?.status!==503)renewRetry=null}
  finally{buttonBusy(button,false)}
 });
 $('renew-cancel').addEventListener('click',()=>{$('renew-box').hidden=true;renewRetry=null});
 $('issue-copy').addEventListener('click',async()=>{
  if(!detailText)return;
  try{await navigator.clipboard.writeText(detailText);say('تم نسخ بيانات الاشتراك.','success')}
  catch(_){say('حدد النص الظاهر وانسخه يدويًا.')}
 });
 $('password-form').addEventListener('submit',async event=>{
  event.preventDefault();clearNotice();
  const currentPassword=$('password-current').value;
  const newPassword=$('password-new').value;
  if(!/^(?=.{14,128}$)(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[!-~]+$/.test(newPassword)){
   say('كلمة المرور الجديدة يجب أن تشمل حرفًا كبيرًا وصغيرًا ورقمًا، و14 حرفًا على الأقل.','error');return;
  }
  const button=$('password-button');buttonBusy(button,true);
  try{
   await api('change-password',{currentPassword,newPassword});
   $('password-current').value='';$('password-new').value='';
   say('تغيّرت كلمة المرور، وأُلغيت الجلسات الأخرى.','success');
  }catch(e){handleError(e)}finally{buttonBusy(button,false)}
 });
 void start();
})();
