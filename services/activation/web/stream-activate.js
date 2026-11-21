'use strict';
(function(){
 const form=document.getElementById('form'),input=document.getElementById('code'),
   button=document.getElementById('submit'),message=document.getElementById('message'),
   section=document.getElementById('result'),fields=document.getElementById('fields');
 let credentials=null,secretTimer=null;
 const SECRET_DISPLAY_MS=90*1000;
 function hideSecrets(){
  if(secretTimer!==null){clearTimeout(secretTimer);secretTimer=null;}
  credentials=null;fields.replaceChildren();section.classList.add('hide');
 }
  // Display a complete standard HTTPS Xtream URL, including its default port.
  const completeHost=raw=>{try{const u=new URL(String(raw));return u.protocol==='https:'
    ?'https://'+u.hostname+':443'+(u.pathname==='/'?'':u.pathname):u.origin;}catch{return String(raw||'');}};

 function show(text,ok){message.textContent=text;message.className='status'+(ok?' ok':'');}
 function field(label,value,copy){
   const row=document.createElement('div');row.className='row';
   const name=document.createElement('small');name.textContent=label;row.appendChild(name);
   const data=document.createElement('strong');data.textContent=String(value||'—');row.appendChild(data);
   if(copy&&value){const btn=document.createElement('button');btn.type='button';btn.className='copy';btn.textContent='نسخ';
     btn.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(String(value));btn.textContent='تم النسخ ✓'}catch{show('حدد النص وانسخه يدويًا.',false)}});
     row.appendChild(btn);}
   fields.appendChild(row);
 }
 form.addEventListener('submit',async function(e){
   e.preventDefault();button.disabled=true;message.className='status hide';hideSecrets();
   const code=input.value.trim().toUpperCase()
     .replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-0x660))
     .replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-0x6f0))
     .replace(/[\s-]+/g,'');
   if(!/^(?:[0-9]{8,12}|[A-F0-9]{24})$/.test(code)){
     show('تحقق من الكود: الأكواد الجديدة أرقام فقط (من 8 إلى 12 خانة).',false);
     button.disabled=false;return;
   }
   try{
     const r=await fetch('/api/v1/stream/redeem',{method:'POST',credentials:'omit',
       headers:{'content-type':'application/json','accept':'application/json'},
       cache:'no-store',body:JSON.stringify({code})});
     const d=await r.json();
     if(!r.ok||!d.ok){
       const text=r.status===429?'محاولات كثيرة. جرّب بعد قليل.':
         r.status===409?'الكود مستخدم مسبقًا أو غير متاح. تواصل مع المسؤول.':
           'تعذر التفعيل. تأكد من الكود وحاول مرة أخرى.';
       show(text,false);return;
     }
     fields.replaceChildren();
     credentials=d.credentials;
     field('Host / رابط السيرفر الكامل',completeHost(d.credentials.serverUrl),true);
     field('اسم المستخدم',d.credentials.username,true);
     field('كلمة المرور (مرة واحدة)',d.credentials.password,true);
     field('رابط M3U',d.credentials.m3uUrl,true);
     field('مدة الاشتراك',String(d.account.durationDays)+' يوم',false);
     field('تاريخ بدء الاشتراك',new Date(d.account.activatedAt).toLocaleString('ar-SA'),false);
     field('تاريخ انتهاء الاشتراك',new Date(d.account.expiresAt).toLocaleString('ar-SA'),false);
     section.classList.remove('hide');input.value='';show('تم التفعيل! بدأت مدة الاشتراك الآن.',true);
     secretTimer=setTimeout(hideSecrets,SECRET_DISPLAY_MS);
     secretTimer?.unref?.();
   }catch{show('تعذر الاتصال بالسيرفر. تحقق من الإنترنت وأعد المحاولة.',false)}
   finally{button.disabled=false}
 });
 document.getElementById('copy-all').addEventListener('click',async()=>{
  if(!credentials)return;
  try{
   await navigator.clipboard.writeText('Host: '+completeHost(credentials.serverUrl)+
     '\nUsername: '+credentials.username+'\nPassword: '+credentials.password+
     '\nM3U: '+credentials.m3uUrl);
   show('تم نسخ بيانات Xtream. احتفظ بها في مكان آمن.',true);
  }catch{show('تعذر النسخ التلقائي؛ يمكنك نسخ كل حقل على حدة.',false);}
 });
 document.getElementById('hide-result').addEventListener('click',hideSecrets);
 // Automatically clear private credentials on tab switch or page exit.
 document.addEventListener('visibilitychange',()=>{if(document.hidden)hideSecrets();});
 window.addEventListener('pagehide',hideSecrets);
})();