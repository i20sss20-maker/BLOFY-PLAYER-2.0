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
    detail.append(make('strong','',row.label),make('p','meta',row.state==='pilot'?'نسخة تجريبية':'لم ينفذ بعد'));
    card.append(num,detail);root.append(card);
  });
}
async function refresh(){
  const button=$('refresh');button.disabled=true;button.textContent='جارٍ الفحص...';
  try{
    const response=await fetch('/api/v1/admin/control-center/status',{credentials:'same-origin',cache:'no-store'});
    if(response.status===401){$('checked').textContent='انتهت الجلسة: سجّل الدخول من /admin';return;}
    if(!response.ok)throw new Error('HTTP '+response.status);
    const data=await response.json();latest=data;
    for(const key of ['total','healthy','reachable','failed'])$(key).textContent=data.summary[key];
    $('checked').textContent='آخر فحص: '+new Date(data.checkedAt).toLocaleString('ar-SA');
    showChecks(data.checks);showPhases(data.phases);
  }catch{
    $('checked').textContent='تعذر جلب حالة الخدمات؛ حاول مجددًا';
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