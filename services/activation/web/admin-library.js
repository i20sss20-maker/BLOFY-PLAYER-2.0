// Owner-only library explorer. All queries are scoped to stored private
// metadata; there are no provider-media reads or automatic queue actions.
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const make=(tag,cls,text)=>{
 const el=document.createElement(tag);
 if(cls)el.className=cls;
 if(text!==undefined)el.textContent=String(text);
 return el;
};
const num=value=>Number(value||0).toLocaleString('ar-SA');
const bytes=x=>{
 if(x===null||x===undefined||!Number.isFinite(Number(x)))return 'غير مقاس';
 let n=Math.max(0,Number(x));
 for(const unit of ['B','KB','MB','GB','TB']){
  if(n<1024||unit==='TB')
   return n.toLocaleString('en-US',{maximumFractionDigits:2})+' '+unit;
  n/=1024;
 }
};
const states={verified:'مكتمل',queued:'بالانتظار',running:'جارٍ النقل',
 paused:'متوقف',failed:'فشل',unknown:'غير محدد'};
let current=null,page=1,busy=false,loadingSerial=0;
const options={kind:'all',state:'all',query:''};
function summaryBadge(label,value){
 const badge=make('div','library-mini-stat');
 badge.append(make('small','',label),make('strong','',value));
 return badge;
}
function entryCard(title,kind,description,progress,seasonKey=null,extra=null,
 metadata=null,editKey=null){
 const card=make('article','library-item');
 if(metadata?.posterPath&&/^\/[A-Za-z0-9_-]{5,90}\.(?:jpg|jpeg|png|webp)$/.test(
  metadata.posterPath)){
  const poster=make('img','library-poster');
  poster.src='https://image.tmdb.org/t/p/w342'+metadata.posterPath;
  poster.alt='بوستر '+(metadata.title||title);
  poster.loading='lazy';poster.referrerPolicy='no-referrer';
  poster.decoding='async';
  poster.addEventListener('error',()=>poster.remove(),{once:true});
  card.append(poster);
 }
 const head=make('div','jobtop');
 head.append(make('strong','',title),make('span','chip',kind));
 card.append(head,make('p','muted',description));
 if(progress!==null&&Number.isFinite(Number(progress))){
  const track=make('div','meter'),fill=make('div','fill');
  fill.style.width=Math.max(0,Math.min(100,Number(progress)))+'%';
  track.append(fill);
  card.append(track,make('p','library-progress',num(progress)+'% من الحجم المعلن'));
 }
 if(extra)card.append(make('p','hint',extra));
 if(metadata?.overview)card.append(
  make('p','library-overview',metadata.overview));
 if(metadata?.year||metadata?.genre&&metadata.genre!=='unspecified')
  card.append(make('p','library-meta-badge',
   (metadata.year?String(metadata.year)+' · ':'')+
   (metadata.genre&&metadata.genre!=='unspecified'?metadata.genre:'')));
 if(editKey){
  const edit=make('button','library-edit','تعديل الاسم والصورة');
  edit.type='button';
  edit.addEventListener('click',()=>document.dispatchEvent(
   new CustomEvent('blofy:edit-library-metadata',
    {detail:{key:editKey,metadata}})));
  card.append(edit);
 }
 if(seasonKey){
  const button=make('button','library-open-season','عرض تقرير الموسم');
  button.type='button';
  button.addEventListener('click',()=>document.dispatchEvent(
   new CustomEvent('blofy:open-season-report',
    {detail:{seasonKey}})));
  card.append(button);
 }
 return card;
}
function render(){
 if(!current)return;
 const data=current,category=options.kind;
 const movies=Array.isArray(data.movies)?data.movies:[],
  seasons=Array.isArray(data.seasons)?data.seasons:[],
  episodes=Array.isArray(data.episodes)?data.episodes:[];
 const board=$('libraryResults');
 const groups=[];
 const appendGroup=(title,items)=>{
  const section=make('section','library-group');
  section.append(make('h3','',title));
  const rows=make('div','library-cards');
  rows.append(...(items.length?items:[make('p','muted',
   'لا توجد نتائج مطابقة ضمن هذه الصفحة.')]));
  section.append(rows);groups.push(section);
 };
 if(['all','movie'].includes(category)){
  appendGroup('الأفلام الخاصة · '+num(movies.length),movies.map(m=>
   entryCard(m.metadata?.title||'معرّف الفيلم · '+m.runId,'فيلم',
    (states[m.state]||'غير معروف')+' · '+bytes(m.storedBytes)+
    ' / '+bytes(m.expectedBytes)+
    ' · '+(m.format==='chunked'?'نقل بأجزاء':'نسخة تقليدية'),
    m.percent,null,m.verified?'تم التحقق من الملف في السجل الخاص.':
     'الحالة الحالية من السجل فقط؛ لا تثبت سلامة مصدر الفيديو.',
    m.metadata,'movie:'+m.runId)));
 }
 if(['all','series'].includes(category)){
  const groupsBySeries=new Map();
  for(const season of seasons){
   const match=/^series_([1-9][0-9]{0,14})_s([0-9]{1,3})$/.exec(
    String(season.seasonKey||''));
   if(!match)continue;
   const id=match[1],group=groupsBySeries.get(id)||{seasons:[],ok:0,total:0};
   group.seasons.push(season);
   if(season.metadata)group.metadata=season.metadata;
   group.ok+=Number(season.verifiedCount)||0;
   group.total+=Number(season.episodeCount)||0;
   groupsBySeries.set(id,group);
  }
  appendGroup('المسلسلات الظاهرة · '+num(groupsBySeries.size),
   [...groupsBySeries].map(([id,g])=>
    entryCard(g.metadata?.title||'مسلسل رقم '+id,'مسلسل',
     num(g.seasons.length)+' موسم معروض · '+num(g.ok)+' / '+
     num(g.total)+' حلقة مكتملة ضمن المواسم المعروضة',
     null,g.seasons.length===1?g.seasons[0].seasonKey:null,
     'المسلسلات مشتقة من مفاتيح المواسم المسجلة فقط، وقد توجد مواسم أخرى خارج صفحة النتائج.',
     g.metadata,'series:'+id)));
 }
 if(['all','season'].includes(category)){
  appendGroup('المواسم · '+num(seasons.length),seasons.map(s=>
   entryCard((s.metadata?.title?s.metadata.title+' · ':'')+s.seasonKey,'موسم',
    num(s.verifiedCount)+' / '+num(s.episodeCount)+
    ' حلقة مكتملة · '+num(s.failedCount)+' فاشلة · '+
    bytes(s.storedBytes)+' / '+bytes(s.expectedBytes),
    s.percent,s.seasonKey,
    s.fullyVerifiedInQueue?'كل حلقات هذا الموسم المدرجة بالنظام متحقق منها.':
     'الموسم غير مكتمل ضمن الحلقات المدرجة بالنظام؛ لا نفترض إجمالي حلقات المصدر.',
    s.metadata,/^series_([1-9][0-9]{0,14})_s[0-9]+$/.test(s.seasonKey)?
     'series:'+s.seasonKey.match(/^series_([1-9][0-9]{0,14})_s/)[1]:null)));
 }
 if(['all','episode'].includes(category)){
  appendGroup('الحلقات · '+num(episodes.length),episodes.map(e=>
   entryCard('الحلقة '+num(e.episodeNumber)+' · '+(e.title||'دون عنوان'),'حلقة',
    e.seasonKey+' · '+(states[e.state]||'غير معروف')+
    ' · '+bytes(e.storedBytes)+' / '+bytes(e.expectedBytes),
    e.percent,e.seasonKey,
    e.verified?'الحلقة متحقق منها في سجل PostgreSQL.':
     'الحالة من آخر نقطة حفظ، ولا تعني تأكيد تشغيل الصورة والصوت.',
    null,null)));
 }
 board.replaceChildren(...groups);
 const total=movies.length+seasons.length+episodes.length;
 $('librarySummary').replaceChildren(
  summaryBadge('أفلام في الصفحة',num(movies.length)),
  summaryBadge('مواسم في الصفحة',num(seasons.length)),
  summaryBadge('حلقات في الصفحة',num(episodes.length)),
  summaryBadge('حالة فشل ضمن الحلقات',num(episodes.filter(e=>e.state==='failed').length)));
 const more=category==='movie'?data.movieHasMore:
  category==='series'||category==='season'?data.seasonsHasMore:
  category==='episode'?data.episodesHasMore:
   data.seasonsHasMore||data.episodesHasMore||data.movieHasMore;
 $('libraryPrev').disabled=busy||page<=1;
 $('libraryNext').disabled=busy||!more;
 $('libraryPage').textContent='الصفحة '+num(page)+
  ' · قد توجد نتائج إضافية'+(more?' في الصفحة التالية':'');
 $('libraryStatus').textContent='تم عرض '+num(total)+
  ' سجل (قد يتكرر نفس الموسم عبر مجموعات التصنيف) · '+
  'بحث حلقات المواسم والمواسم في قاعدة البيانات كلها؛ '+
  (data.movieHistoryAvailable===false?'تعذر جلب أحد سجلات الأفلام · ':
   'الأفلام ضمن أحدث عينة محفوظة فقط · ')+
  'لم يبدأ أي تنزيل'+
  (data.curatedTitleMatchesLimited?' · البحث بأسماء المسلسلات المعدلة محدود بأول 120 نتيجة':'');
 $('libraryScope').textContent=
  'نتائج المواسم والحلقات من كافة سجلات قائمة الانتظار، 40 لكل نوع في الصفحة. '+
  'الأفلام من أحدث 50 سجلًا تقليديًا و50 سجلًا مجزأً فقط'+
  (data.movieHistoryMaybeLimited?' وقد يكون هناك أفلام أقدم خارج العينة.':
   '، ولا يمثل ذلك بالضرورة المكتبة الكاملة.')+
  ' معيار اكتمال الموسم = اكتمال الحلقات المدرجة فقط، وليس كل حلقات المصدر.';
}
async function search(pageNumber=1){
 if(busy||document.hidden)return;
 const nextQuery=$('libraryText').value.trim();
 if(nextQuery.length>80)return;
 const nextState=$('libraryState').value,
  nextKind=$('libraryKind').value;
 if(!['all','verified','failed','queued','running','paused'].includes(nextState)||
    !['all','movie','series','season','episode'].includes(nextKind))return;
 busy=true;loadingSerial++;
 const serial=loadingSerial;
 $('librarySearch').disabled=true;$('libraryRefresh').disabled=true;
 $('libraryPrev').disabled=true;$('libraryNext').disabled=true;
 $('libraryStatus').textContent='جارٍ البحث في السجلات المحفوظة…';
 try{
  const response=await fetch('/api/v1/admin/content-hub/library/search',{
   method:'POST',credentials:'same-origin',cache:'no-store',
   headers:{'content-type':'application/json',
    'x-blofy-owner-action':'library-read-only'},
   body:JSON.stringify({query:nextQuery,state:nextState,page:pageNumber})
  });
  if(response.status===401){location.assign('/admin');return}
  if(!response.ok)throw Error('تعذر جلب نتائج المكتبة من الخادم.');
  const result=await response.json();
  if(!result||result.ok!==true||result.readOnly!==true||
     result.automaticStart!==false||
     result.automaticRetry!==false||
     result.page!==pageNumber||!Array.isArray(result.episodes)||
     !Array.isArray(result.seasons)||!Array.isArray(result.movies))
   throw Error('نتائج البحث غير مكتملة.');
  if(serial!==loadingSerial)return;
  current=result;page=pageNumber;
  options.query=nextQuery;options.state=nextState;options.kind=nextKind;
  render();
 }catch(e){$('libraryStatus').textContent=e.message||
  'تعذرت قراءة المكتبة دون أي تغيير للملفات.'}
 finally{busy=false;$('librarySearch').disabled=false;
  $('libraryRefresh').disabled=false;
  if(current)render();}
}
$('librarySearch').addEventListener('click',()=>void search(1));
$('libraryRefresh').addEventListener('click',()=>void search(1));
$('libraryKind').addEventListener('change',()=>{
 if(!current)return;
 options.kind=$('libraryKind').value;
 render();
});
$('libraryText').addEventListener('keydown',event=>{
 if(event.key==='Enter'){event.preventDefault();void search(1)}
});
$('libraryState').addEventListener('change',()=>void search(1));
$('libraryPrev').addEventListener('click',()=>{if(page>1)void search(page-1)});
$('libraryNext').addEventListener('click',()=>{
 const hasMore=current&&(current.movieHasMore||
  current.seasonsHasMore||current.episodesHasMore);
 if(hasMore)void search(page+1);
});
void search(1);
})();
