'use strict';
const $=id=>document.getElementById(id);
let loaded=false,busy=false,pilotActive=false,selected='';
const formatBytes=n=>{
 const bytes=Number(n||0);
 if(!Number.isFinite(bytes)||bytes<0)return '—';
 if(bytes<1024)return bytes.toLocaleString('en-US')+' B';
 const labels=['KB','MB','GB','TB'];
 let size=bytes,index=-1;
 do{size/=1024;index++}while(size>=1024&&index<labels.length-1);
 return size.toFixed(size>=10?1:2)+' '+labels[index];
};
function stateLabel(s){
 return {verified:'مكتمل ومتحقق منه',started:'جارٍ النقل',
  failed:'لم يكتمل'}[s]||'غير معروف';
}
function div(className,text){
 const el=document.createElement('div');
 el.className=className;
 if(text!==undefined)el.textContent=text;
 return el;
}
function jobCard(entry){
 const btn=document.createElement('button');
 btn.type='button';btn.className='job';btn.disabled=entry.state!=='verified';
 const top=div('jobtop');
 const title=document.createElement('strong');
 title.textContent=String(entry.runId||'عملية');
 const status=div('chip'+(entry.state==='verified'?' ok':
   entry.state==='failed'?' error':''),stateLabel(entry.state));
 top.append(title,status);btn.append(top);
 const progress=Math.min(100,Math.max(0,Number(entry.percent||0)));
 const meter=div('meter');const fill=div('fill');
 fill.style.width=progress+'%';meter.append(fill);btn.append(meter);
 const row=div('row');
 row.append(div('',progress+'%'),div('',
   formatBytes(entry.bytesCopied)+' / '+formatBytes(entry.expectedBytes)));
 btn.append(row);
 if(entry.state==='verified'){
  btn.setAttribute('aria-label','اختبار تشغيل النسخة المؤكدة: '+entry.runId);
  btn.onclick=()=>selectMovie(entry.runId);
 }
 return btn;
}
function selectMovie(id){
 if(!/^[A-Za-z0-9_-]{8,80}$/.test(id))return;
 selected=id;
 const video=$('player');
 video.pause();
 video.removeAttribute('src');
 video.load();
 video.src='/api/v1/admin/content-hub/canary/'+encodeURIComponent(id);
 video.load();
 $('playerNote').textContent='نسخة خاصة قيد الاختبار · '+id+
  ' · تأكد من وجود صورة وصوت قبل اعتماد التشغيل للعملاء.';
}
async function reload(){
 if(busy)return;busy=true;
 try{
  const response=await fetch('/api/v1/admin/content-hub/status',{
   cache:'no-store',credentials:'same-origin'});
  if(response.status===401){window.location.assign('/admin');return}
  if(!response.ok)throw Error('content_hub_unavailable');
  const data=await response.json();
  const online=data.service==='online'&&data.privateBucketAvailable&&
   data.databaseAvailable;
  $('health').textContent=online?'الخادم متصل':'تحتاج الخدمة إلى فحص';
  $('health').className='badge '+(online?'online':'offline');
  const accounting=data.accounting||{};
  $('verified').textContent=Number(accounting.verifiedCount||0).toLocaleString('en-US');
  $('used').textContent=formatBytes(accounting.verifiedBytes);
  $('active').textContent=Number(accounting.activeCount||0).toLocaleString('en-US');
  $('failed').textContent=Number(accounting.failedCount||0).toLocaleString('en-US');
  pilotActive=data.pilotRunning===true;
  $('cancel').disabled=!pilotActive;
  const entries=Array.isArray(data.runs)?data.runs:[];
  $('runs').replaceChildren(...(entries.length?
    entries.map(jobCard):[div('placeholder','لا توجد عمليات نقل مسجلة حتى الآن.')]));
  $('notice').textContent=pilotActive?'يوجد نقل جارٍ على الخادم.':'لم يتم تفعيل التنزيل الجماعي.';
  loaded=true;
 }catch{
  $('health').textContent='تعذر جلب حالة الخادم';
  $('health').className='badge offline';
  if(!loaded)$('runs').replaceChildren(div('placeholder',
   'لم نتمكن من الاتصال بحالة التخزين الخاص.'));
 }finally{busy=false}
}
$('refresh').addEventListener('click',reload);
$('cancel').addEventListener('click',async()=>{
 if(!pilotActive||!window.confirm('إيقاف النسخ الجاري؟ لن يؤثر ذلك على القنوات، لكن عملية النسخ الحالية ستُلغى.'))return;
 $('cancel').disabled=true;
 try{
  const res=await fetch('/api/v1/admin/content-hub/cancel',{
   method:'POST',credentials:'same-origin',
   headers:{'content-type':'application/json'},body:'{}'});
  $('notice').textContent=res.status===202?
    'تم إرسال طلب الإيقاف. جارٍ تحرير الموارد.':
    'لم يتم العثور على عملية جارية.';
 }catch{$('notice').textContent='فشل إرسال طلب الإيقاف.'}
 await reload();
});
$('player').addEventListener('error',()=>{
 if(selected)$('playerNote').textContent=
  'تعذر تشغيل هذا الملف في المتصفح. قد تكون صيغة الفيلم غير مدعومة، أو أن النسخة ليست جاهزة.';
});
reload();setInterval(()=>{if(!document.hidden)reload()},10000);
