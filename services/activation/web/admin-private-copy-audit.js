// Owner-only, explicitly requested, ONE stored private file SHA-256 audit.
// This page only polls a protected status route; it never starts a media copy.
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const base='/api/v1/admin/content-hub/private-copy/audit-full';
const headers={'x-blofy-owner-action':'audit-one-stored-private-copy'};
const select=$('privateCopyAuditKind');
const confirmed=$('privateCopyAuditConfirm');
const button=$('privateCopyAuditStart');
const refresh=$('privateCopyAuditRefresh');
const state=$('privateCopyAuditStatus');
let available=false,running=false,working=false,timer=null;
const valid=/^[A-Za-z0-9_-]{8,80}$/;
const fmt=n=>Number(n||0).toLocaleString('en-US');
function updateButton(){
 button.disabled=!available||running||working||!confirmed.checked||
  !select.value||!valid.test(select.value.split(':').slice(1).join(':'));
}
function schedule(){
 if(timer!==null)clearTimeout(timer);
 timer=running?setTimeout(()=>{if(!document.hidden)void load();
  else schedule()},5000):null;
}
async function load(){
 if(working)return;
 working=true;refresh.disabled=true;
 try{
  const response=await fetch(base+'/status',{
   method:'GET',credentials:'same-origin',cache:'no-store',
   headers,signal:AbortSignal.timeout(12000)});
  if(response.status===401){location.assign('/admin');return}
  if(response.status===404){
   available=false;running=false;
   state.textContent='الفحص الشامل غير مفعّل حاليًا في الخادم. لم يبدأ أي نقل أو قراءة S3.';
   select.replaceChildren(new Option('الفحص غير متاح',''));
   return;
  }
  if(!response.ok)throw Error('تعذر قراءة حالة الفحص ('+response.status+').');
  const data=await response.json();
  if(data?.ok!==true||data.privateOnly!==true||
     data.readOnly!==true||data.customerCutover!==false||
     data.providerRequests!==0||data.automaticCopyStarted!==false)
   throw Error('حالة الفحص المستلمة غير معتمدة.');
  const prev=select.value;
  const options=[];
  for(const [kind,label] of [['episode','الحلقة المحفوظة'],
    ['movie','الفيلم المحفوظ']]){
   const id=data.configuredRuns?.[kind];
   if(valid.test(String(id||'')))options.push(new Option(
    label+' · '+id,kind+':'+id));
  }
  select.replaceChildren(new Option(
   options.length?'اختر ملفًا محفوظًا للفحص':'لا توجد ملفات مهيأة للفحص',''),
   ...options);
  select.value=options.some(x=>x.value===prev)?prev:'';
  available=options.length>0;select.disabled=!available;
  const result=data.status||{};
  running=result.state==='running';
  if(running)state.textContent='جارٍ فحص '+String(result.kind||'')+
    ' من التخزين الخاص… لا تحتاج لإبقاء الصفحة مفتوحة.';
  else if(result.state==='verified'&&result.fullSha256Verified===true)
   state.textContent='✅ تحقق الملف كاملًا: '+fmt(result.checkedParts)+
    ' جزء، '+fmt(result.bytesRead)+' بايت. راجع الصوت والصورة على جهازك بشكل منفصل.';
  else if(result.state==='failed')state.textContent=
    '⚠️ لم يكتمل فحص الملف. الرمز: '+String(result.code||'unknown')+
    '. لا تعتبر النسخة مؤكدة بهذا الفحص.';
  else state.textContent='الفحص الخاص جاهز. اختر ملفًا واحدًا ثم أكّد القراءة يدويًا.';
 }catch(error){
  available=false;running=false;
  state.textContent=error.message||'تعذّر الاتصال بفحص التخزين الخاص.';
 }finally{
  working=false;refresh.disabled=false;updateButton();schedule();
 }
}
button.addEventListener('click',async()=>{
 if(working||running||!available||!confirmed.checked)return;
 const [kind,runId,...extra]=select.value.split(':');
 if(extra.length||!['episode','movie'].includes(kind)||!valid.test(runId))return;
 working=true;updateButton();
 state.textContent='جارٍ طلب فحص الملف المحفوظ فقط…';
 try{
  const response=await fetch(base,{
   method:'POST',credentials:'same-origin',cache:'no-store',
   headers:{...headers,'content-type':'application/json'},
   body:JSON.stringify({kind,runId,confirmed:true}),
   signal:AbortSignal.timeout(12000)});
  if(response.status===401){location.assign('/admin');return}
  const data=await response.json();
  if(response.status!==202||data?.ok!==true||
     data.customerCutover!==false||data.automaticCopyStarted!==false)
   throw Error(response.status===429?
     'الفحص مشغول أو ما زالت مهلة إعادة الفحص سارية.':
     'تعذّر بدء الفحص الآمن ('+response.status+').');
  running=true;
  state.textContent='✅ بدأ فحص بايتات الملف المخزن فقط. لا يوجد نقل من Xtream.';
  confirmed.checked=false;
 }catch(error){state.textContent=error.message||'فشل إرسال طلب الفحص.'}
 finally{working=false;updateButton();schedule()}
});
select.addEventListener('change',updateButton);
confirmed.addEventListener('change',updateButton);
refresh.addEventListener('click',()=>void load());
void load();
})();