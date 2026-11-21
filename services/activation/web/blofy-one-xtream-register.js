/* BLOFY ONE: existing Xtream accounts belong inside the unified code center.
 * Read-only account list plus explicit re-reveal of the SAME credentials.
 * No creation, extension, reset, rotation, browser storage or credential URLs. */
(() => {
 'use strict';
 const start=()=>{
  const $=id=>document.getElementById(id);
  const root=$('one-xtream-register'),rows=$('one-xtream-register-rows'),
    status=$('one-xtream-register-status'),dialog=$('one-xtream-register-dialog'),
    detailStatus=$('one-xtream-register-detail-status'),
    credsBox=$('one-xtream-register-credentials');
  if(!root||!rows||!dialog)return;
  const fields={
   host:$('one-xtream-register-host'),user:$('one-xtream-register-user'),
   password:$('one-xtream-register-password'),m3u:$('one-xtream-register-m3u')
  };
  const buttons={
   copy:$('one-xtream-register-copy'),m3u:$('one-xtream-register-copy-m3u'),
   prev:$('one-xtream-register-prev'),next:$('one-xtream-register-next')
  };
  const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
  const PAGE=25;
  let items=[],loaded=false,loading=false,loadSeq=0,offset=0,
    selected=null,secretSeq=0,secretTimer=null,extracting=false;
  const text=value=>String(value??'');
  const node=(tag,value,className)=>{
   const el=document.createElement(tag);el.textContent=text(value);
   if(className)el.className=className;
   return el;
  };
  const date=value=>{
   if(value===null||value===undefined||value==='')return 'لم يحدد';
   const number=new Date(value).getTime();
   return Number.isFinite(number)?
    new Date(number).toLocaleString('ar-SA',{timeZone:'Asia/Riyadh',dateStyle:'medium'}):
    'غير معروف';
  };
  function state(a){
   if(!a.enabled)return {key:'disabled',label:'موقوف'};
   if(a.expiresAt===null||a.expiresAt===undefined)return {key:'unknown',label:'بلا انتهاء'};
   const expires=Number(a.expiresAt);
   if(!Number.isFinite(expires))return {key:'unknown',label:'انتهاء غير معروف'};
   return expires<=Date.now()?{key:'expired',label:'منتهي'}:{key:'active',label:'نشط'};
  }
  function filtered(){
   const q=$('one-register-query').value.trim().toLocaleLowerCase('ar');
   const selectedState=$('one-xtream-register-state').value;
   return items.filter(a=>(selectedState==='all'||state(a).key===selectedState)&&
    (!q||[a.label,a.username,a.id].join(' ').toLocaleLowerCase('ar').includes(q)));
  }
  function clearSecrets(){
   secretSeq++;
   if(secretTimer)clearTimeout(secretTimer);
   secretTimer=null;
   for(const field of Object.values(fields))field.textContent='';
   credsBox.hidden=true;
   buttons.copy.disabled=true;buttons.m3u.disabled=true;
  }
  function close(){
   clearSecrets();selected=null;
   if(dialog.open)dialog.close();
  }
  async function fetchJson(path){
   const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),15000);
   try{
    const r=await fetch(path,{
     method:'GET',credentials:'same-origin',cache:'no-store',referrerPolicy:'no-referrer',
     headers:{accept:'application/json'},signal:ctl.signal
    });
    const data=await r.json().catch(()=>({}));
    if(r.status===401||r.status===403)throw Error('انتهت جلسة المشرف أو صلاحية الحساب.');
    if(!r.ok||data.ok===false){
     if(data.error==='xtream_gateway_password_not_recoverable')
      throw Error('بيانات حساب Xtream القديم غير محفوظة بشكل قابل للاسترجاع. لن نغيّر كلمة مرور العميل تلقائيًا.');
     if(data.error==='xtream_gateway_account_not_found')
      throw Error('حساب Xtream لم يعد موجودًا، حدّث السجل.');
     throw Error('لم تكتمل العملية (HTTP '+r.status+').');
    }
    return data;
   }catch(e){
    if(e.name==='AbortError')throw Error('انتهت مهلة الاتصال. حدّث السجل وحاول مرة أخرى.');
    throw e;
   }finally{clearTimeout(timer);}
  }
  function render(){
   const matching=filtered();
   offset=Math.min(offset,Math.max(0,Math.ceil(matching.length/PAGE)-1)*PAGE);
   rows.replaceChildren();
   for(const account of matching.slice(offset,offset+PAGE)){
    const tr=node('tr',''),cstate=state(account);
    const name=node('td','');
    name.append(node('strong',text(account.label||'حساب Xtream').slice(0,110)));
    name.append(node('small','Xtream · '+(account.sourceId?'مصدر محدد':'المصادر المنشورة')));
    const username=node('td','');
    username.append(node('code',text(account.username||'—').slice(0,110)));
    const current=node('td','');
    current.append(node('b',cstate.label,'one-xtream-state one-xtream-'+cstate.key));
    const action=node('td','');
    const extract=node('button','⇄ استخراج / إعادة استخراج Xtream','one-register-open');
    extract.type='button';
    extract.addEventListener('click',()=>void reveal(account,extract));
    const change=node('button','🔐 تغيير المستخدم / كلمة المرور','one-xtream-change-button');
    change.type='button';
    change.addEventListener('click',()=>{
     clearSecrets();
     window.dispatchEvent(new CustomEvent('blofy-one:xtream-change',{
       detail:{id:account.id,label:account.label,username:account.username,
        updatedAt:account.updatedAt,expiresAt:account.expiresAt}
     }));
    });
    action.append(extract,change);
    tr.append(name,username,current,node('td',date(account.expiresAt)),
      node('td',Number(account.maxConnections)||1),action);
    rows.append(tr);
   }
   if(!matching.length){
    const tr=node('tr',''),td=node('td',loaded?'لا توجد حسابات Xtream تطابق البحث.':'لم تُحمّل حسابات Xtream بعد.');
    td.colSpan=6;tr.append(td);rows.append(tr);
   }
   buttons.prev.disabled=loading||offset===0;
   buttons.next.disabled=loading||offset+PAGE>=matching.length;
   $('one-xtream-register-page').textContent=matching.length?
    'عرض '+(offset+1)+'–'+Math.min(matching.length,offset+PAGE)+' من '+matching.length:
    '0 حساب';
   if(loaded&&!loading)status.textContent='✓ حسابات Xtream الفعلية: '+items.length+
    ' · المطابقة للبحث: '+matching.length+
    ' · كلمة المرور مخفية حتى تطلب الاستخراج لحساب معيّن.';
  }
  async function load(){
   if(loading)return;
   const seq=++loadSeq;loading=true;
   status.textContent='جارٍ قراءة كل حسابات Xtream المباشرة والمرتبطة…';
   buttons.prev.disabled=true;buttons.next.disabled=true;
   try{
    const data=await fetchJson('/api/v1/admin/xtream-gateway');
    if(seq!==loadSeq)return;
    if(!Array.isArray(data.items))throw Error('السيرفر لم يُرجع قائمة حسابات Xtream.');
    items=data.items.filter(a=>a&&UUID.test(text(a.id))&&
      typeof a.username==='string');
    loaded=true;offset=0;
    render();
    status.textContent='✓ حسابات Xtream الفعلية: '+items.length+
     ' · يمكنك البحث عن الحساب واستخراج بياناته مجددًا.';
   }catch(e){
    if(seq!==loadSeq)return;
    loaded=false;items=[];rows.replaceChildren();
    const tr=node('tr',''),td=node('td','تعذر تحميل حسابات Xtream: '+e.message);
    td.colSpan=6;tr.append(td);rows.append(tr);
    $('one-xtream-register-page').textContent='تعذر التحميل';
    status.textContent='تعذر جلب حسابات Xtream من السيرفر: '+e.message+
     ' · هذا ليس دليلًا على عدم وجود حسابات. لا تُنشئ حسابات بديلة قبل التحقق.';
   }finally{if(seq===loadSeq){loading=false;buttons.prev.disabled=!loaded||offset===0;
    buttons.next.disabled=!loaded||offset+PAGE>=filtered().length;}}
  }
  function fullHost(raw){
   const u=new URL(text(raw));
   if(u.protocol!=='https:'||u.username||u.password||u.hash||u.search||
      (u.pathname!==''&&u.pathname!=='/'))
    throw Error('بيانات Host المسترجعة غير صالحة.');
   return 'https://'+u.hostname+':'+(u.port||'443');
  }
  async function reveal(account,button){
   if(extracting||!UUID.test(text(account.id)))return;
   if(!window.confirm('هل تريد استخراج بيانات Xtream الأصلية لنفس حساب '+text(account.label||account.username).slice(0,70)+
      '؟ العملية للقراءة فقط ولا تُنشئ حسابًا أو تغيّر كلمة المرور أو تاريخ الانتهاء. تأكد من هوية العميل قبل التسليم.'))return;
   clearSecrets();selected=account;extracting=true;button.disabled=true;
   $('one-xtream-register-info').textContent='Xtream · '+text(account.label||'حساب')+
    ' · '+state(account).label+' · ينتهي: '+date(account.expiresAt);
   detailStatus.textContent='جارٍ استخراج بيانات نفس الحساب من المخزن المشفّر…';
   if(!dialog.open)dialog.showModal();
   const serial=secretSeq;
   try{
    const data=await fetchJson('/api/v1/admin/xtream-gateway/accounts/'+encodeURIComponent(account.id)+'/credentials');
    if(!dialog.open||document.hidden||selected?.id!==account.id||secretSeq!==serial)return;
    const c=data.credentials||{};
    if(text(c.username)!==text(account.username)||!c.password||!c.serverUrl)
     throw Error('حساب Xtream أو اسم المستخدم غير مطابق لسجل العميل.');
    const host=fullHost(c.serverUrl),username=text(c.username),password=text(c.password);
    const m3u=host+'/get.php?'+new URLSearchParams({
     username,password,type:'m3u_plus',output:'ts'}).toString();
    fields.host.textContent=host;fields.user.textContent=username;
    fields.password.textContent=password;fields.m3u.textContent=m3u;
    credsBox.hidden=false;buttons.copy.disabled=false;buttons.m3u.disabled=false;
    detailStatus.textContent='✓ تم استخراج نفس حساب Xtream دون تعديل بيانات الاشتراك. تُخفى الأسرار بعد 30 ثانية، ويمكن إعادة استخراجها لاحقًا.';
    secretTimer=setTimeout(()=>{if(secretSeq===serial)clearSecrets();},30000);
   }catch(error){
    if(dialog.open&&selected?.id===account.id&&serial===secretSeq){
     clearSecrets();
     detailStatus.textContent='تعذر استخراج الحساب: '+error.message;
    }
   }finally{extracting=false;button.disabled=false;}
  }
  async function copy(value,which){
   if(credsBox.hidden||!value)return;
   try{await navigator.clipboard.writeText(value);
    detailStatus.textContent='✓ نُسخ '+which+'. شاركه مع صاحب الحساب فقط.';
   }catch{detailStatus.textContent='تعذر النسخ الآلي، يمكنك نسخ القيمة من الحقل مباشرة.';}
  }
  buttons.copy.addEventListener('click',()=>void copy(
   'Host: '+fields.host.textContent+'\nUsername: '+fields.user.textContent+
   '\nPassword: '+fields.password.textContent,'بيانات Xtream'));
  buttons.m3u.addEventListener('click',()=>void copy(fields.m3u.textContent,'رابط M3U'));
  $('one-xtream-register-hide').addEventListener('click',clearSecrets);
  $('one-xtream-register-close').addEventListener('click',close);
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  dialog.addEventListener('close',()=>{clearSecrets();selected=null;});
  buttons.prev.addEventListener('click',()=>{offset=Math.max(0,offset-PAGE);render();});
  buttons.next.addEventListener('click',()=>{offset+=PAGE;render();});
  $('one-xtream-register-state').addEventListener('change',()=>{offset=0;render();});
  $('one-register-search-form').addEventListener('submit',()=>{offset=0;if(loaded)render();});
  $('one-register-refresh').addEventListener('click',()=>void load());
  window.addEventListener('blofy-one:code-register-visible',()=>void load());
  window.addEventListener('blofy-one:xtream-credentials-updated',()=>{
   close();void load();
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden)clearSecrets();});
  window.addEventListener('pagehide',clearSecrets);
  if(location.hash==='#one-code-register')void load();
  render();
 };
 if(document.readyState==='loading')
  document.addEventListener('DOMContentLoaded',start,{once:true});
 else start();
})();
