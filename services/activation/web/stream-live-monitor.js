// Read-only operator panel. Uses established httpOnly admin session; no secrets in DOM.
const root=document.getElementById('blofyLiveMonitor');
if(root){
 const $=id=>document.getElementById(id);
 const message=$('blofyLiveMonitorMessage');
 const fields={sessions:$('blofyLiveSessions'),readers:$('blofyLiveReaders'),
  paths:$('blofyLivePaths'),bytes:$('blofyLiveBytes'),rate:$('blofyLiveRate'),alert:$('blofyLiveAlert'),
  starts:$('blofyRealStarts'),failures:$('blofyRealFailures'),p95:$('blofyRealP95')};
 const fmt=n=>Number.isFinite(n)?new Intl.NumberFormat('ar-SA',{maximumFractionDigits:0}).format(n):'—';
 async function load(path){
  const response=await fetch(path,{credentials:'same-origin',cache:'no-store',
   headers:{accept:'application/json'}});
  if(response.status===401)throw Error('unauthorized');
  const result=await response.json();
  if(!response.ok)throw Error(result.code||result.error||'request_failed');
  return result;
 }
 async function refresh(){
  $('blofyLiveRefresh').disabled=true;
  message.textContent='جاري قراءة مقاييس المحرك…';
  try{
   const [metrics,health,gateway]=await Promise.allSettled([
    load('/api/v1/admin/restream-engine/metrics'),
    load('/api/v1/admin/restream-engine/auto-health'),
    load('/api/v1/admin/xtream-gateway/playback-health')
   ]);
   if(metrics.status==='fulfilled'){
    const x=metrics.value;
    fields.sessions.textContent=fmt(x.totals.hlsSessions);
    fields.readers.textContent=fmt(x.totals.readers);
    fields.paths.textContent=fmt(x.pathCount);
    fields.bytes.textContent=fmt(x.totals.hlsBytes);
    fields.rate.textContent=x.rate?.measured?String(x.rate.hlsEgressMbps)+' Mbps':'—';
    const rows=$('blofyLiveMonitorRows');
    rows.replaceChildren();
    for(const p of (x.paths||[]).slice(0,12)){
     const row=document.createElement('tr');
     for(const value of [p.id,p.ready?'متاح':'غير متاح',fmt(p.hlsSessions),fmt(p.readers)]){
      const td=document.createElement('td');td.textContent=value;row.append(td);
     }
     rows.append(row);
    }
    message.textContent='بيانات MediaMTX الحالية. الجلسات ليست عدد مشتركين فريدين.';
   }else{
    const code=metrics.reason?.message||'unavailable';
    message.textContent=code==='restream_metrics_not_enabled'
     ?'المقاييس غير مفعّلة حاليًا. لا يمكن إثبات عدد المشاهدين من هذه الشاشة.'
     :'تعذر قراءة المقاييس: '+({
      restream_metrics_unreachable:'المحرك لا يستجيب على منفذ المراقبة الداخلي',
      restream_metrics_no_samples:'استجابة المحرك لا تحتوي عينات معروفة',
      unauthorized:'يرجى تسجيل الدخول للإدارة'}[code]||'الاتصال أو الإعدادات غير متاحة');
   }
   if(gateway.status==='fulfilled'){
    const m=gateway.value.metrics||{};
    fields.starts.textContent=fmt(m.started);
    fields.failures.textContent=fmt(m.failed);
    fields.p95.textContent=Number.isFinite(m.p95StartMs)?fmt(m.p95StartMs)+' ms':'—';
    const labels={provider_or_auth_denial:'رفض المصدر أو المصادقة',missing_media:'محتوى غير متاح',transient_network:'خطأ شبكة مؤقت',invalid_media:'صيغة أو استجابة غير صالحة',unknown:'بحاجة إلى تشخيص'};
    const issues=gateway.value.recoveryAdvice?.issues||[];
    const box=$('blofyRecoveryAdvice');box.replaceChildren();
    if(!issues.length)box.textContent='لا توجد مشكلات حديثة مصنفة.';
    for(const issue of issues.slice(0,8)){
     const line=document.createElement('li');
     line.textContent=(labels[issue.class]||labels.unknown)+' · '+(issue.action==='cooldown'?'تجنب إعادة المحاولة المتكررة':issue.action==='operator_review'?'تحتاج مراجعة الإدارة':'المصدر يحتاج متابعة')+' · لا يوجد إصلاح تلقائي';
     box.append(line);
    }
   }
   fields.alert.textContent=health.status==='fulfilled'
     ?(health.value.alert?'تنبيه: تكرر فشل الاختبار التجريبي':'لا توجد تنبيهات تجريبية متكررة')
     :'حالة الفحص التجريبي غير متاحة';
  }finally{$('blofyLiveRefresh').disabled=false;}
 }
 $('blofyLiveRefresh').addEventListener('click',()=>{void refresh().catch(()=>{
  message.textContent='تعذر إكمال تحديث مركز المراقبة.';$('blofyLiveRefresh').disabled=false;
 })});
}
