'use strict';
let latest=null;
const $=id=>document.getElementById(id);
const make=(tag,cls,value)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(value!==undefined)el.textContent=String(value);return el;};
function showChecks(rows){
  const root=$('checks');root.replaceChildren();
  for(const row of rows){
    const card=make('article','service');
    const top=make('div','service-top');
    const pill=make('span','pill '+row.status,row.status==='healthy'?'استجابة ناجحة':row.status==='reachable'?'مسار محدود':'مشكلة اتصال');
    top.append(make('strong','',row.name),pill);
    card.append(top,make('p','meta',row.tier==='production'?'الإنتاج':'الاختبار'));
    card.append(make('p','',row.note));
    const latency=Number.isFinite(row.latencyMs)?Math.round(row.latencyMs):'—';
    card.append(make('p','meta','HTTP: '+(row.httpStatus??'—')+' · الاستجابة: '+latency+' ms'));
    root.append(card);
  }
}
function showPhases(rows){
  const root=$('phases');root.replaceChildren();
  rows.forEach((row,i)=>{
    const card=make('div','phase');
    const num=make('span','num',i+1);
    const detail=make('div');
    const states={
      available:'موجودة داخل لوحة STREAM الأصلية',
      manual:'تشغيل يدوي وفق صلاحيات المشرف',
      synthetic:'عينات صناعية في مختبر مستقل',
      not_verified:'لم يُثبت تشغيل جميع القنوات على الأجهزة'
    };
    detail.append(make('strong','',row.label),
      make('p','meta',states[row.state]||'الحالة غير مؤكدة'));
    card.append(num,detail);root.append(card);
  });
}
function showOperatorReadiness(report){
  const root=$('operator-readiness');
  const summary=$('operator-readiness-summary');
  root.replaceChildren();
  const checks=Array.isArray(report?.checks)?report.checks:[];
  if(!checks.length){
    summary.textContent='لم تتوفر نتائج فحص وحدات STREAM.';
    $('operator-readiness-time').textContent='لم يتم التحقق';
    return;
  }
  const states={
    connected:['healthy','متصل','ردّ نظام الإدارة بنتيجة سليمة'],
    reachable:['reachable','الواجهة متاحة','HTTP ناجح، لكن لم يُثبت فحص المحتوى'],
    degraded:['reachable','يحتاج مراجعة','ردّ النظام بأنه غير سليم'],
    blocked:['error','التفويض مرفوض','خدمة STREAM رفضت اعتماد ربط الموقع'],
    unavailable:['error','غير متاح','خدمة الإدارة لم تُكمل الطلب'],
    unknown:['offline','غير مؤكد','لم تنجح محاولة التحقق']
  };
  const codes={
    operator_bridge_not_configured:'لم يكتمل إعداد ربط الموقع بالسيرفر',
    operator_backend_auth_denied:'رفض التوثيق بين الموقع ولوحة STREAM',
    operator_backend_error:'ردّ السيرفر بخطأ',
    operator_route_unavailable:'المسار الإداري غير متاح',
    operator_reported_unhealthy:'الواجهة صرحت بوجود خطأ',
    operator_redirect_rejected:'رفض النظام التحويل إلى موقع آخر',
    operator_probe_timeout:'انتهت مهلة الفحص',
    operator_probe_network_error:'تعذر الاتصال بالخدمة',
    operator_http_ok_only:'استجابة HTTP فقط',
    operator_read_ok:'استجابة سليمة من مسار الإدارة'
  };
  const links={overview:'home',sources:'sources',library:'library',
    accounts:'accounts',codes:'codes',distributors:'distributors',
    restream:'restream',security:'diagnostics'};
  let count=0;
  for(const row of checks){
    if(!Object.hasOwn(links,row.id))continue;
    count++;
    const mode=states[row.state]||states.unknown;
    const card=make('article','service');
    const top=make('div','service-top');
    top.append(make('strong','',row.label),
      make('span','pill '+mode[0],mode[1]));
    card.append(top,make('p','meta',mode[2]));
    card.append(make('p','meta',codes[row.code]||'لم يتم التحقق'));
    const http=Number.isInteger(row.httpStatus)?row.httpStatus:'—';
    const latency=Number.isFinite(row.latencyMs)?Math.round(row.latencyMs):'—';
    card.append(make('p','meta','HTTP: '+http+' · الاستجابة: '+latency+' ms'));
    const link=make('a','readiness-link','فتح القسم ←');
    link.href='/admin/control-center#'+links[row.id];
    card.append(link);root.append(card);
  }
  const sums=report?.summary||{};
  summary.textContent='وحدات متصلة: '+Number(sums.connected||0)+
    ' · متاحة دون تحقق كامل: '+Number(sums.reachable||0)+
    ' · تحتاج مراجعة: '+Number(sums.degraded||0)+
    ' · غير متاحة: '+Number(sums.unavailable||0)+
    ' · غير مؤكدة: '+Number(sums.unknown||0)+
    ' · الإجمالي: '+count;
  $('operator-readiness-time').textContent='آخر قراءة من النظام الأصلي: '+
    new Date(report.lastCheckedAt).toLocaleString('ar-SA');
}
function clearOperatorReadiness(){
  $('operator-readiness').replaceChildren();
  $('operator-readiness-summary').textContent='نتائج الفحص السابقة غير معتمدة.';
  $('operator-readiness-time').textContent='غير متاح';
}
async function refresh(){
  const button=$('refresh');button.disabled=true;button.textContent='جارٍ الفحص...';
  try{
    const response=await fetch('/api/v1/admin/control-center/status',{credentials:'same-origin',cache:'no-store'});
    if(response.status===401){
      latest=null;
      $('checked').textContent='انتهت جلسة المشرف. ارجع إلى لوحة الإدارة لتسجيل الدخول.';
      for(const key of ['total','healthy','reachable','failed'])$(key).textContent='—';
      $('checks').replaceChildren();$('phases').replaceChildren();clearOperatorReadiness();
      return;
    }
    if(!response.ok)throw new Error('HTTP '+response.status);
    const data=await response.json();latest=data;
    for(const key of ['total','healthy','reachable','failed'])$(key).textContent=data.summary[key];
    $('checked').textContent='آخر فحص: '+new Date(data.checkedAt).toLocaleString('ar-SA');
    showChecks(data.checks);showPhases(data.phases);
    showOperatorReadiness(data.operatorReadiness);
  }catch{
    latest=null;
    $('checked').textContent='تعذر جلب حالة الخدمات؛ النتائج السابقة لم تعد معتمدة.';
    for(const key of ['total','healthy','reachable','failed'])$(key).textContent='—';
    $('checks').replaceChildren();$('phases').replaceChildren();clearOperatorReadiness();
  }finally{button.disabled=false;button.textContent='↻ تحديث الفحص';}
}
$('refresh').addEventListener('click',refresh);
$('copy').addEventListener('click',async()=>{
  if(!latest)return;
  try{await navigator.clipboard.writeText(JSON.stringify(latest,null,2));$('copy').textContent='تم النسخ';setTimeout(()=>$('copy').textContent='نسخ التقرير',1500);}
  catch{$('copy').textContent='تعذر النسخ';}
});
refresh();
setInterval(refresh,60000);