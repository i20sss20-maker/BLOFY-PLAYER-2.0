// The browser polls a small owner-only read-only advisory index.
// Every retry requires an explicit owner click; never auto-queues or starts.
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const make=(tag,cls,label)=>{
 const node=document.createElement(tag);
 if(cls)node.className=cls;
 if(label!==undefined)node.textContent=String(label);
 return node;
};
const severity={critical:'مراجعة مهمة',warning:'انتباه',notice:'مراجعة',
 info:'معلومة'};
const types={transient_failure:'خطأ مؤقت',
 needs_manual_integrity_or_rights_review:'فحص الصلاحية أو السلامة',
 possible_stale_running_state:'حالة نقل قديمة',
 paused_for_review:'نقل متوقف',
 partial_checkpoint_waiting:'بيانات جزئية محفوظة'};
const labels={failed:'فشلت',paused:'متوقفة',running:'جارٍ النقل',queued:'انتظار'};
const n=x=>Number(x||0).toLocaleString('ar-SA');
const size=x=>{
 let v=Number(x);
 if(!Number.isFinite(v)||v<0)return 'غير معروف';
 for(const unit of ['B','KB','MB','GB','TB']){
  if(v<1024||unit==='TB')
   return v.toLocaleString('en-US',{maximumFractionDigits:2})+' '+unit;
  v/=1024;
 }
};
let list=[],busy=false,retryBusy=false,sourceTruncated=false,lastLoad=null;
function message(text){$('attentionStatus').textContent=text}
function render(){
 const level=$('attentionLevel').value;
 const items=list.filter(a=>level==='all'||a.severity===level);
 const box=$('attentionList');
 box.replaceChildren(...(items.length?items.map(a=>{
  const card=make('article','season-attention-item season-attention-'+a.severity);
  const top=make('div','jobtop');
  top.append(make('strong','',types[a.type]||'تحتاج مراجعة'),
   make('span','chip',severity[a.severity]||'تنبيه'));
  card.append(top,make('p','season-attention-name',
   a.seasonKey+' · الحلقة '+n(a.episodeNumber)+
   ' · '+(labels[a.state]||'غير معروف')));
  card.append(make('p','muted',
   'السبب المسجل: '+a.code+' · المحفوظ '+size(a.storedBytes)+
   ' / '+size(a.expectedBytes)+
   (a.ageMinutes===null?'':' · آخر تغيير منذ '+n(a.ageMinutes)+' دقيقة')));
  card.append(make('p','muted',a.advice));
  const controls=make('div','season-attention-buttons');
  const open=make('button','','عرض تفاصيل الموسم');
  open.type='button';
  open.addEventListener('click',()=>document.dispatchEvent(
   new CustomEvent('blofy:open-season-report',
    {detail:{seasonKey:a.seasonKey}})));
  controls.append(open);
  if(a.retryEligible){
   const retry=make('button','season-attention-retry','اعتماد إعادة المحاولة');
   retry.type='button';retry.disabled=retryBusy;
   retry.addEventListener('click',()=>void manualRetry(a));
   controls.append(retry);
  }
  card.append(controls);return card;
 }):[make('p','muted','لا توجد تنبيهات من هذا المستوى ضمن العينة المعروضة.')]));
 $('attentionSummary').replaceChildren(...['critical','warning','notice','info']
  .map(level=>{
   const count=list.filter(a=>a.severity===level).length;
   const chip=make('span','chip season-attention-count',
    (severity[level]||level)+' · '+n(count));
   return chip;
  }));
 if(sourceTruncated)box.append(make('p','hint',
  'النتيجة محدودة بأحدث 50 سجلًا مطابقًا. لا تستنتج أن بقية الحلقات خالية من المشكلات.'));
}
async function load(){
 if(busy||retryBusy||document.hidden)return;
 busy=true;$('attentionRefresh').disabled=true;
 message('جارٍ قراءة آخر الحالات المسجلة في قاعدة البيانات…');
 try{
  const response=await fetch('/api/v1/admin/content-hub/seasons/attention',{
   credentials:'same-origin',cache:'no-store'});
  if(response.status===401){location.assign('/admin');return}
  if(!response.ok)throw Error('تعذرت قراءة التنبيهات حاليًا.');
  const data=await response.json();
  if(data.ok!==true||data.readOnly!==true||
     data.automaticRetry!==false||!Array.isArray(data.items))
   throw Error('رد غير مكتمل من خدمة التنبيهات.');
  list=data.items.slice(0,50);sourceTruncated=data.limited===true;
  lastLoad=new Date();render();
  message('تم تحديث '+n(list.length)+' حالة للمراجعة · آخر تحديث '+
   lastLoad.toLocaleTimeString('ar-SA')+
   ' · لا توجد إعادة محاولة أو تنزيلات تلقائية');
 }catch(e){message(e.message||'تعذرت قراءة التنبيهات.')}
 finally{busy=false;$('attentionRefresh').disabled=false}
}
async function manualRetry(item){
 if(retryBusy||busy||!item.retryEligible)return;
 const confirmOne=confirm(
  'الحلقة '+n(item.episodeNumber)+' من '+item.seasonKey+
  ': هل تحققت بنفسك من صلاحية الاحتفاظ بالمحتوى وأن مصدره خامل الآن؟');
 if(!confirmOne)return;
 if(!confirm(
  'تأكيد نهائي: إعادة إدراج الحلقة الفاشلة في قائمة الانتظار دون بدء نقل. لن تُحذف الأجزاء السليمة. هل تريد الاعتماد؟'))return;
 retryBusy=true;render();$('attentionRefresh').disabled=true;
 message('جارٍ اعتماد إعادة المحاولة اليدوية دون بدء تشغيل…');
 try{
  const response=await fetch('/api/v1/admin/content-hub/seasons/retry',{
   method:'POST',credentials:'same-origin',cache:'no-store',
   headers:{'content-type':'application/json',
    'x-blofy-owner-action':'season-library'},
   body:JSON.stringify({runId:item.runId,confirmed:true,
    licensedStorage:true,sourceIdle:true})
  });
  if(response.status===401){location.assign('/admin');return}
  const result=await response.json();
  if(!response.ok||result.ok!==true)
   throw Error('لم يُعتمد الطلب ('+(result.code||response.status)+
    '). قد يكون عامل النقل نشطًا أو استُنفدت المحاولات.');
  message('تم إرجاع الحلقة '+n(item.episodeNumber)+
   ' لقائمة الانتظار بعد التأكيد. لم يبدأ أي تنزيل أو نقل.');
  $('analyticsRefresh').click();
  $('refreshSeasons').click();
 }catch(e){message(e.message||'فشل الطلب؛ لم يبدأ أي نقل.')}
 finally{retryBusy=false;$('attentionRefresh').disabled=false;
  // Refresh is read-only. Preserve operation message if the refresh fails.
  void load()}
}
$('attentionRefresh').addEventListener('click',()=>void load());
$('attentionLevel').addEventListener('change',render);
document.addEventListener('visibilitychange',()=>{
 if(!document.hidden&&lastLoad&&Date.now()-lastLoad.getTime()>60000)
  void load();
});
setInterval(()=>{if(!document.hidden)void load()},60000);
void load();
})();
