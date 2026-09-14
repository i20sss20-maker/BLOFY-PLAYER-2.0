'use strict';
const form=document.getElementById('privacy-form'), result=document.getElementById('result');
let busy=false;
form.addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;
  const action=event.submitter?.value, fields=new FormData(form);
  if(action!=='delete'&&action!=='support')return;
  if(action==='delete'&&!fields.has('confirmDelete')){result.textContent='اقرأ أثر الحذف وفعّل خانة التأكيد أولًا.';return;}
  if(action==='support'&&!String(fields.get('message')||'').trim()){result.textContent='اكتب استفسارك أولًا.';return;}
  if(action==='delete'&&!window.confirm('سيُلغى التفعيل وتُحذف بيانات هذا الجهاز. متابعة الحذف؟'))return;
  busy=true;form.querySelectorAll('button').forEach(button=>button.disabled=true);result.textContent='جارٍ تنفيذ الطلب…';
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
  try{
    const response=await fetch('/api/v1/privacy/'+(action==='delete'?'delete':'support'),{
      method:'POST',credentials:'omit',redirect:'error',headers:{'content-type':'application/json'},signal:controller.signal,
      body:JSON.stringify({deviceId:String(fields.get('deviceId')||'').trim(),activationCode:String(fields.get('activationCode')||''),
        confirmation:action==='delete'?'DELETE':undefined,message:String(fields.get('message')||'').trim()})});
    if(!response.ok)throw new Error(response.status===429?'محاولات كثيرة. حاول لاحقًا.':'تعذر التحقق أو تنفيذ الطلب. راجع البيانات وحاول لاحقًا.');
    result.textContent=action==='delete'?'حُذفت بيانات الخدمة وأُلغي تفعيل الجهاز. امسح بيانات التطبيق المحلية من إعدادات Android.':'وصل استفسارك إلى دعم BLOFY.';
    if(action==='delete')form.reset();else form.elements.message.value='';
  }catch(error){result.textContent=error.name==='AbortError'?'انتهت مهلة الطلب. حدّث الحالة قبل تكرار العملية.':error.message;}
  finally{clearTimeout(timeout);busy=false;form.querySelectorAll('button').forEach(button=>button.disabled=false);}
});
