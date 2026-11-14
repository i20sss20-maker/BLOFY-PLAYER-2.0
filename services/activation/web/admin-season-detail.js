// Owner-only report viewer. Rendering and CSV export are client-side,
// and all data comes from authenticated bounded read-only GET endpoints.
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const make=(tag,cls,value)=>{
 const node=document.createElement(tag);
 if(cls)node.className=cls;
 if(value!==undefined)node.textContent=String(value);
 return node;
};
const valid=/^[a-z0-9][a-z0-9_-]{2,63}$/;
const amount=n=>{
 if(n===null||n===undefined||!Number.isFinite(Number(n)))return 'غير مقاس';
 let value=Number(n);
 for(const unit of ['B','KB','MB','GB','TB']){
  if(value<1024||unit==='TB')
   return value.toLocaleString('en-US',{maximumFractionDigits:unit==='B'?0:2})+' '+unit;
  value/=1024;
 }
};
const num=n=>Number(n||0).toLocaleString('ar-SA');
const stamp=s=>{
 const d=new Date(s);
 return s&&Number.isFinite(d.getTime())?
  d.toLocaleString('ar-SA',{dateStyle:'short',timeStyle:'short'}):'—';
};
const labels={queued:'بانتظار النقل',paused:'متوقفة',
 running:'جارٍ النقل',verified:'مكتملة',failed:'فشلت',unknown:'غير معروف'};
let currentKey=null,currentPage=1,data=null,loading=false,exporting=false,
 requestSerial=0;
const setMessage=s=>{$('analyticsReportStatus').textContent=s};
const updateButtons=()=>{
 $('analyticsExportSeason').disabled=!data||loading||exporting;
 $('analyticsReportPrev').disabled=!data||loading||exporting||
  !data.page.hasPrevious;
 $('analyticsReportNext').disabled=!data||loading||exporting||
  !data.page.hasNext;
};
async function getReport(key,page){
 const response=await fetch(
  '/api/v1/admin/content-hub/seasons/report/'+key+'/page/'+page,{
   credentials:'same-origin',cache:'no-store'});
 if(response.status===401){location.assign('/admin');throw Error('login')}
 if(response.status===404)throw Error('الموسم غير موجود في قاعدة البيانات.');
 if(!response.ok)throw Error('تعذر قراءة تقرير الموسم من الخادم.');
 const out=await response.json();
 if(out.ok!==true||out.readOnly!==true||out.seasonKey!==key||
    out.page?.number!==page||!Array.isArray(out.episodes))
  throw Error('بيانات التقرير غير مكتملة.');
 return out;
}
function showTotals(t){
 const fields=[
  ['الحلقات',num(t.episodeCount)],
  ['مكتملة',num(t.verifiedCount)],
  ['فاشلة',num(t.failedCount)],
  ['قيد النقل',num(t.runningCount)],
  ['بانتظار النقل',num(t.queuedCount)],
  ['منجزة من الحجم المعلن',num(t.percent)+'%'],
  ['محفوظ في قاعدة البيانات',amount(t.storedBytes)],
  ['الحجم المعلن',amount(t.expectedBytes)]
 ];
 $('analyticsReportTotals').replaceChildren(...fields.map(([label,value])=>{
  const box=make('div','season-report-tile');
  box.append(make('small','',label),make('strong','',value));
  return box;
 }));
}
function showAlerts(alerts){
 const list=$('analyticsReportAlerts'),items=Array.isArray(alerts)?alerts:[];
 list.replaceChildren(...(items.length?
  items.map(a=>make('p','analytics-record season-report-alert',a.text)):
  [make('p','muted','لا توجد تنبيهات للموسم في بيانات التقرير الحالية.')]));
}
function showEpisodeChart(rows){
 const el=$('analyticsReportBars');
 if(!rows.length){
  el.replaceChildren(make('p','muted','لا توجد حلقات في هذه الصفحة.'));return;
 }
 el.replaceChildren(...rows.map(e=>{
  const box=make('div','season-report-bar');
  const track=make('div','season-report-track'),
   fill=make('div','season-report-fill');
  fill.style.height=Math.max(0,Math.min(100,Number(e.percent)||0))+'%';
  track.append(fill);
  box.title='الحلقة '+e.episodeNumber+': '+e.percent+'%';
  box.setAttribute('aria-label',box.title);
  box.append(make('span','season-report-percentage',e.percent+'%'),
   track,make('small','',e.episodeNumber));
  return box;
 }));
}
function showSpeedChart(events){
 const list=(Array.isArray(events)?events:[]).filter(e=>
  e.bytes>0&&e.bytesPerSecond!==null&&e.bytesPerSecond>0)
  .slice(0,18).reverse();
 const el=$('analyticsReportSpeed');
 if(!list.length){
  el.replaceChildren(make('p','muted',
   'لم تتوفر قياسات فعلية لسرعة الأجزاء في هذا الموسم بعد.'));return;
 }
 const max=Math.max(1,...list.map(e=>e.bytesPerSecond));
 el.replaceChildren(...list.map(e=>{
  const bar=make('div','season-report-speed-bar');
  const track=make('div','season-report-speed-track');
  track.style.height=Math.max(3,Math.round(100*e.bytesPerSecond/max))+'%';
  bar.title='الحلقة '+e.episodeNumber+' · '+amount(e.bytesPerSecond)+'/ث · '+
   stamp(e.recordedAt);
  bar.setAttribute('aria-label',bar.title);
  bar.append(track,make('small','',e.episodeNumber));
  return bar;
 }));
}
function showRows(episodes){
 const body=$('analyticsReportRows');
 if(!episodes.length){
  const tr=make('tr'),td=make('td','','لا توجد حلقات في هذه الصفحة.');
  td.colSpan=6;tr.append(td);body.replaceChildren(tr);return;
 }
 body.replaceChildren(...episodes.map(e=>{
  const tr=make('tr');
  for(const v of [
   'الحلقة '+num(e.episodeNumber)+(e.title?' · '+e.title:''),
   labels[e.state]||'غير معروف',num(e.percent)+'%',
   amount(e.storedBytes)+' / '+amount(e.expectedBytes),
   stamp(e.updatedAt),e.state==='failed'?(e.code||'غير محدد'):'—'
  ])tr.append(make('td','',v));
  return tr;
 }));
}
function display(report){
 data=report;currentPage=report.page.number;
 showTotals(report.totals);
 showAlerts(report.alerts);
 showEpisodeChart(report.episodes);
 showSpeedChart(report.recentEvents);
 showRows(report.episodes);
 $('analyticsReportPage').textContent='صفحة '+num(report.page.number)+
  ' من '+num(report.page.pages)+' · '+num(report.page.totalEpisodes)+' حلقة';
 setMessage('آخر تحديث '+stamp(new Date().toISOString())+
  ' · الحالات المحفوظة لقطة حالية وليست سجل أحداث كامل'+
  (report.eventsLimited?' · أحدث 60 حدث نقل فقط':'')+
  ' · دون أي تنزيل من المصدر');
}
async function load(page=1){
 if(!currentKey||!valid.test(currentKey)||loading||exporting)return;
 const key=currentKey,serial=++requestSerial;
 loading=true;updateButtons();setMessage('جارٍ قراءة تقرير الموسم…');
 try{
  const report=await getReport(key,page);
  if(serial===requestSerial&&key===currentKey)display(report);
 }catch(e){
  if(serial===requestSerial)setMessage(e.message||'تعذر قراءة التقرير.');
 }finally{if(serial===requestSerial){loading=false;updateButtons()}}
}
function exportCell(value){
 let v=String(value??'').replace(/[\r\n]/g,' ');
 // Protect Excel / LibreOffice from formula injection in provider-supplied titles.
 if(/^[\s]*[=+\-@]/.test(v))v="'"+v;
 return '"'+v.replace(/"/g,'""')+'"';
}
async function exportCsv(){
 if(!currentKey||!data||loading||exporting)return;
 const key=currentKey,numberOfPages=Number(data.page.pages);
 if(!Number.isInteger(numberOfPages)||numberOfPages<1||
    numberOfPages>10){
  setMessage('يتطلب تصدير البيانات الكاملة مراجعة عدد صفحات الموسم.');return;
 }
 exporting=true;updateButtons();
 try{
  const all=[];
  for(let page=1;page<=numberOfPages;page++){
   setMessage('جمع بيانات التصدير: صفحة '+page+' من '+numberOfPages);
   const report=await getReport(key,page);
   if(currentKey!==key||report.page.pages!==numberOfPages)
    throw Error('تغير الموسم أثناء التصدير؛ لم يُنشأ ملف غير مكتمل.');
   all.push(...report.episodes);
  }
  if(all.length!==data.page.totalEpisodes)
   throw Error('البيانات غير مكتملة؛ لم يتم تصدير ملف ناقص.');
  const headers=['الموسم','الحلقة','عنوان الحلقة','الحالة','نسبة النقل',
   'الحجم المسجل بالبايت','الحجم المتوقع بالبايت','التحقق مكتمل','آخر تحديث','رمز الخطأ'];
  const rows=all.map(e=>[key,e.episodeNumber,e.title,e.state,e.percent,
   e.storedBytes,e.expectedBytes,e.sourceVerified?'نعم':'لا',
   e.updatedAt,e.code||'']);
  const csv='\uFEFF'+[headers,...rows]
   .map(row=>row.map(exportCell).join(',')).join('\r\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
  const link=document.createElement('a'),url=URL.createObjectURL(blob);
  link.href=url;link.download='BLOFY-season-'+key+'-'+
   new Date().toISOString().slice(0,10)+'.csv';
  document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  setMessage('تم إنشاء CSV من '+num(all.length)+' حلقة محفوظة، دون الاتصال بالمصدر.');
 }catch(e){setMessage(e.message||'فشل التصدير دون تغيير أي بيانات.')}
 finally{exporting=false;updateButtons()}
}
document.addEventListener('blofy:open-season-report',event=>{
 if(exporting){setMessage('التصدير جارٍ؛ أكمله قبل فتح موسم آخر.');return}
 const key=event?.detail?.seasonKey;
 if(!valid.test(String(key||'')))return;
 currentKey=key;currentPage=1;data=null;loading=false;
 requestSerial++;
 $('analyticsReportPanel').hidden=false;
 $('analyticsReportTitle').textContent='تقرير الموسم · '+key;
 $('analyticsReportPage').textContent='—';
 $('analyticsReportBars').replaceChildren();
 $('analyticsReportSpeed').replaceChildren();
 $('analyticsReportRows').replaceChildren();
 updateButtons();void load(1);
 $('analyticsReportPanel').scrollIntoView({block:'start',behavior:'smooth'});
});
$('analyticsCloseReport').addEventListener('click',()=>{
 if(exporting)return;
 currentKey=null;data=null;requestSerial++;loading=false;
 $('analyticsReportPanel').hidden=true;updateButtons();
});
$('analyticsReportPrev').addEventListener('click',()=>void load(currentPage-1));
$('analyticsReportNext').addEventListener('click',()=>void load(currentPage+1));
$('analyticsExportSeason').addEventListener('click',()=>void exportCsv());
})();
