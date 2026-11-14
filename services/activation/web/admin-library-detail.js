// Owner-only cinematic details for registered private content. The browser
// never queries providers or S3; the backend re-verifies storage before
// streaming a selected canary or rendering a bounded episode preview.
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const dialog=$('libraryDetailDialog'),video=$('libraryDetailPlayer');
const make=(tag,cls,value)=>{
 const n=document.createElement(tag);
 if(cls)n.className=cls;
 if(value!==undefined)n.textContent=String(value);
 return n;
};
const validMovie=/^movie:([A-Za-z0-9_-]{8,80})$/;
const validSeries=/^series:([1-9][0-9]{0,14})$/;
const validSeason=/^series_([1-9][0-9]{0,14})_s[0-9]{1,3}$/;
const validEpisode=/^[A-Za-z0-9_-]{8,80}$/;
const validPoster=/^\/[A-Za-z0-9_-]{5,90}\.(?:jpg|jpeg|png|webp)$/;
const statuses={verified:'مكتمل ومتحقق منه',queued:'بالانتظار',
 running:'قيد النقل',paused:'متوقف',failed:'تعثر النقل',
 unknown:'حالة غير معروفة'};
const genres={drama:'دراما',action:'أكشن',comedy:'كوميديا',
 thriller:'تشويق',romance:'رومانسي',family:'عائلي',
 animation:'رسوم متحركة',documentary:'وثائقي',horror:'رعب',
 science_fiction:'خيال علمي',fantasy:'فانتازيا',crime:'جريمة',
 adventure:'مغامرة',other:'أخرى'};
let item=null,selectedSeason=null,currentPage=1,pages=1,epoch=0;
let verifiedPageEntries=[],previewRunId=null,previewObserved=false,avSaving=false;
const validVerifiedEntry=entry=>entry?.sourceVerified===true&&
 entry.state==='verified'&&validEpisode.test(String(entry.runId||''));
function updatePreviewNavigation(){
 const pos=verifiedPageEntries.findIndex(entry=>entry.runId===previewRunId);
 $('libraryDetailPrevVerified').disabled=pos<1;
 $('libraryDetailNextVerified').disabled=verifiedPageEntries.length===0||
  pos>=verifiedPageEntries.length-1;
 $('libraryDetailPreviewPosition').textContent=pos>=0?
  'الحلقة المكتملة '+number(pos+1)+' من '+number(verifiedPageEntries.length)+
   ' في الصفحة الحالية':
  'اختر حلقة مكتملة لمعاينتها · التنقل لا يبدأ التشغيل تلقائيًا';
}
function updateAvButton(){
 $('libraryDetailAvConfirm').disabled=!previewObserved||!previewRunId||
  !validEpisode.test(previewRunId)||avSaving||
  !$('libraryDetailAvVideoCheck').checked||
  !$('libraryDetailAvAudioCheck').checked;
}
function number(x){return Number(x||0).toLocaleString('ar-SA')}
function formatBytes(x){
 const n=Number(x);
 if(!Number.isFinite(n)||n<0)return 'غير معروف';
 let v=n;
 for(const unit of ['B','KB','MB','GB','TB']){
  if(v<1024||unit==='TB')return v.toLocaleString('en-US',
   {maximumFractionDigits:2})+' '+unit;
  v/=1024;
 }
}
function stopPreview(){
 previewRunId=null;previewObserved=false;
 $('libraryDetailAvVideoCheck').checked=false;
 $('libraryDetailAvAudioCheck').checked=false;
 $('libraryDetailAvReview').hidden=true;
 $('libraryDetailAvStatus').textContent='';
 updateAvButton();
 try{
  video.pause();
  video.removeAttribute('src');
  video.load();
 }catch{}
 $('libraryDetailPlayerWrap').hidden=true;
 updatePreviewNavigation();
}
function close(){
 ++epoch;
 stopPreview();
 if(dialog.open)dialog.close();
 item=null;selectedSeason=null;verifiedPageEntries=[];
}
function cover(meta){
 const target=$('libraryDetailArt');
 const value=meta?.posterPath;
 if(meta?.artworkRightsConfirmed===true&&
    typeof value==='string'&&validPoster.test(value)){
  const img=make('img');
  img.alt='البوستر المحفوظ للعمل '+String(meta.title||'');
  img.src='https://image.tmdb.org/t/p/w500'+value;
  img.loading='lazy';img.decoding='async';
  img.referrerPolicy='no-referrer';
  img.addEventListener('error',()=>{
   target.replaceChildren(make('span','muted','بوستر غير متاح حاليًا'));
  },{once:true});
  target.replaceChildren(img);
 }else target.replaceChildren(
  make('div','library-detail-cover-fallback','BLOFY'),
  make('span','muted','لا توجد صورة مصرّح باستخدامها'));
}
function showPreview(kind,runId){
 if(!dialog.open||!item||!validEpisode.test(String(runId||'')))return;
 // This only sets a protected URL after a human click. The Hub checks the
 // durable verified media manifest again on each request.
 const movie=kind==='movie';
 if(movie&&!(item.kind==='movie'&&item.state==='verified'))return;
 if(!movie&&!(
   (item.kind==='episode'&&item.verified===true&&item.key===runId)||
   verifiedPageEntries.some(entry=>entry.runId===runId&&
    validVerifiedEntry(entry))))return;
 const url=movie?
  '/api/v1/admin/content-hub/canary/'+runId:
  '/api/v1/admin/content-hub/seasons/episodes/'+runId+'/preview';
 stopPreview();
 if(!movie)previewRunId=runId;
 $('libraryDetailPlayerWrap').hidden=false;
 $('libraryDetailAvStatus').textContent='بانتظار تشغيل المقطع ومراجعة الصورة والصوت.';
 updatePreviewNavigation();
 video.src=url;
 video.load();
 $('libraryDetailStatus').textContent='تم تجهيز معاينة '+(movie?'الفيلم':'الحلقة')+
  ' الخاصة. اضغط تشغيل في المشغل لمراجعة الصورة والصوت؛ إذا فشل التحقق من الملف فلن يسمح الخادم بالتشغيل.';
}
function showVideoButton(kind,runId,isVerified){
 const btn=$('libraryDetailPlay');
 const eligible=isVerified===true&&
  validEpisode.test(String(runId||''))&&
  (kind==='movie'||kind==='episode');
 btn.hidden=!eligible;
 if(!eligible){btn.onclick=null;return}
 btn.textContent=kind==='movie'?'▶ معاينة الفيلم المتحقق منه':
  '▶ معاينة الحلقة المتحقق منها';
 btn.onclick=()=>showPreview(kind,runId);
}
function reportSeason(season){
 if(!validSeason.test(String(season||'')))return;
 close();
 document.dispatchEvent(new CustomEvent('blofy:open-season-report',{
  detail:{seasonKey:season}}));
}
function editor(){
 if(!item?.editKey||!(
  validMovie.test(item.editKey)||validSeries.test(item.editKey)))return;
 const data={key:item.editKey,metadata:item.meta||null};
 close();
 document.dispatchEvent(new CustomEvent('blofy:edit-library-metadata',{
  detail:data}));
}
async function requestJson(url,{header=null}={}){
 const response=await fetch(url,{
  method:'GET',credentials:'same-origin',cache:'no-store',
  headers:header?{'x-blofy-owner-action':header}:{},
  signal:AbortSignal.timeout(12000)
 });
 if(response.status===401){location.assign('/admin');throw Error('غير مصرح')}
 if(!response.ok)throw Error('تعذر قراءة البيانات المحفوظة ('+
  response.status+').');
 const data=await response.json();
 if(data?.ok!==true||data.readOnly!==true||
    data.privateOnly!==true)throw Error('البيانات لم تحقق شروط القراءة الخاصة.');
 return data;
}
function selectSeasonButton(season){
 const btn=make('button','library-detail-season-button');
 btn.type='button';
 btn.textContent=season.seasonKey+' · '+number(season.verifiedCount)+
  '/'+number(season.episodeCount)+' حلقة · '+
  (season.fullyVerifiedInQueue?'مكتمل ضمن السجلات':
   number(season.failedCount)+' تعثر');
 if(season.seasonKey===selectedSeason)btn.classList.add('selected');
 btn.addEventListener('click',()=>{void loadSeason(season.seasonKey,1)});
 return btn;
}
async function loadSeries(id){
 if(!validSeries.test('series:'+id))return;
 const requestEpoch=epoch;
 $('libraryDetailStatus').textContent='جارٍ جلب المواسم المسجلة من PostgreSQL…';
 try{
  const detail=await requestJson(
   '/api/v1/admin/content-hub/library/series/'+id,{
    header:'view-private-series'});
  if(requestEpoch!==epoch||!dialog.open)return;
  if(detail.seriesId!==id||!Array.isArray(detail.seasonSummaries)||
     detail.automaticStart!==false)
   throw Error('رد مواسم المسلسل غير متوافق.');
  const seasons=detail.seasonSummaries.filter(
   s=>validSeason.test(String(s.seasonKey||''))&&
    String(s.seasonKey).startsWith('series_'+id+'_s')).slice(0,50);
  $('libraryDetailSeasons').replaceChildren(...(seasons.length?
   seasons.map(selectSeasonButton):[
    make('p','muted','لا توجد مواسم مسجلة لهذا المسلسل في نظام النسخ الخاص.')]));
  $('libraryDetailSeriesScope').textContent=
   'هذه مواسم المسلسل المسجلة في BLOFY فقط'+
   (detail.hasMoreSeasons?' · يوجد أكثر من 50 موسمًا؛ عرضنا أول 50 فقط.':
    ' · ليست بالضرورة كل مواسم المصدر.');
  $('libraryDetailStatus').textContent=
   'تم العثور على '+number(seasons.length)+' موسم مسجل.';
  if(seasons.length)void loadSeason(seasons[0].seasonKey,1);
 }catch(err){
  if(requestEpoch!==epoch||!dialog.open)return;
  $('libraryDetailStatus').textContent=err.message||
   'تعذر جلب مواسم المسلسل. لم يتم تغيير أي ملفات.';
 }
}
async function loadSeason(key,page){
 if(!validSeason.test(String(key||''))||
    !Number.isSafeInteger(page)||page<1||page>20000||!dialog.open)return;
 ++epoch;
 const requestEpoch=epoch;
 selectedSeason=key;currentPage=page;
 verifiedPageEntries=[];
 stopPreview();
 showVideoButton(null,null,false);
 $('libraryDetailStatus').textContent='جارٍ عرض الحلقات المحفوظة…';
 $('libraryDetailEpisodes').replaceChildren();
 $('libraryDetailPrev').disabled=true;$('libraryDetailNext').disabled=true;
 $('libraryDetailSeasons').querySelectorAll?.('button').forEach(btn=>{
  btn.classList.toggle('selected',btn.textContent.startsWith(key+' ·'));
 });
 try{
  const report=await requestJson(
   '/api/v1/admin/content-hub/seasons/report/'+key+'/page/'+page);
  if(requestEpoch!==epoch||!dialog.open||selectedSeason!==key)return;
  if(report.seasonKey!==key||!Array.isArray(report.episodes)||
     report.page?.number!==page)
   throw Error('محتوى تقرير الموسم لا يطابق الطلب.');
  pages=Math.max(1,Math.min(20000,Number(report.page.pages)||1));
  const entries=report.episodes.slice(0,50);
  verifiedPageEntries=entries.filter(validVerifiedEntry);
  updatePreviewNavigation();
  const cards=entries.map(entry=>{
   const row=make('article','library-detail-episode');
   const head=make('div','library-detail-episode-top');
   const name=make('strong','',
    'الحلقة '+number(entry.episodeNumber)+' · '+(entry.title||'بلا عنوان'));
   const verified=entry.sourceVerified===true&&entry.state==='verified';
   const label=make('span','chip'+(verified?' ok':''),
    verified?'متحقق منها':statuses[entry.state]||'غير معروف');
   head.append(name,label);
   const reviewed=verified&&entry.videoOwnerConfirmed===true&&
    entry.audioOwnerConfirmed===true&&Boolean(entry.ownerAvConfirmedAt);
   const avState=make('p','library-detail-episode-av'+
    (reviewed?' reviewed':''),
    verified?(reviewed?
     'الصورة: أكدها المالك يدويًا ✅ · الصوت: أكده المالك يدويًا ✅':
     'الصورة: لم يراجعها المالك · الصوت: لم يراجعه المالك'):
     'الملف غير متحقق من التخزين؛ لا يوجد فحص تشغيل معتمد');
   const expected=Number(entry.expectedBytes)||0,
    stored=Math.min(expected,Number(entry.storedBytes)||0);
   row.append(head,avState,make('p','muted',
    'المسجل: '+formatBytes(stored)+' / '+formatBytes(expected)));
   const meter=make('div','meter'),bar=make('div','fill');
   bar.style.width=expected?
    Math.max(0,Math.min(100,Math.floor(100*stored/expected)))+'%':'0%';
   meter.append(bar);row.append(meter);
   if(verified&&validEpisode.test(String(entry.runId||''))){
    const play=make('button','library-detail-episode-play',
     '▶ معاينة الحلقة المتحقق منها');
    play.type='button';
    play.addEventListener('click',()=>showPreview('episode',entry.runId));
    row.append(play);
   }
   return row;
  });
  $('libraryDetailEpisodes').replaceChildren(...(cards.length?cards:[
   make('p','muted','لا توجد حلقات في هذه الصفحة.')]));
  $('libraryDetailPageLabel').textContent=
   'الموسم '+key+' · الصفحة '+number(page)+' من '+number(pages)+
   ' · '+number(report.page.totalEpisodes)+' حلقة مدرجة';
  $('libraryDetailPrev').disabled=page<=1;
  $('libraryDetailNext').disabled=page>=pages;
  $('libraryDetailReport').hidden=false;
  $('libraryDetailStatus').textContent=
   'الحلقات مكتملة في هذا الموسم: '+number(report.totals?.verifiedCount)+
   ' / '+number(report.totals?.episodeCount)+
   '. لا يبدأ أي نقل من شاشة التفاصيل.';
 }catch(err){
  if(requestEpoch!==epoch||!dialog.open)return;
  $('libraryDetailStatus').textContent=err.message||
   'تعذر عرض الحلقة، ولم يبدأ أي نقل.';
 }
}
function show(itemInput){
 if(!itemInput||!['movie','series','season','episode'].includes(itemInput.kind))
  return;
 if(dialog.open)close();
 const kind=itemInput.kind,key=String(itemInput.key||'');
 if(kind==='movie'&&!validMovie.test(key)||
    kind==='series'&&!validSeries.test(key)||
    kind==='season'&&!validSeason.test(key)||
    kind==='episode'&&!validEpisode.test(key))return;
 item={
  kind,key,title:String(itemInput.title||'').slice(0,220),
  meta:itemInput.meta||null,
  state:String(itemInput.state||'unknown'),
  verified:itemInput.verified===true,
  editKey:itemInput.editKey||null,
  seasonKey:itemInput.seasonKey||null,
  caption:String(itemInput.caption||'').slice(0,300)
 };
 ++epoch;currentPage=1;pages=1;selectedSeason=null;
 verifiedPageEntries=[];
 if(kind==='episode'&&itemInput.verified===true&&validEpisode.test(key))
  verifiedPageEntries=[{runId:key,sourceVerified:true,state:'verified'}];
 stopPreview();
 $('libraryDetailKind').textContent=
  {movie:'فيلم محفوظ',series:'مسلسل محفوظ',season:'موسم مسجل',
   episode:'حلقة مسجلة'}[kind];
 $('libraryDetailTitle').textContent=item.title;
 $('libraryDetailMeta').textContent=[
  item.meta?.year||null,
  item.meta?.genre||null,
  statuses[item.state]||'غير معروف'].filter(Boolean).join(' · ');
 $('libraryDetailDescription').textContent=String(
  item.meta?.overview||'لم يضف وصف لهذا العمل بعد.').slice(0,700);
 $('libraryDetailFacts').textContent=item.caption;
 cover(item.meta);
 $('libraryDetailEpisodes').replaceChildren();
 $('libraryDetailSeasons').replaceChildren();
 $('libraryDetailSeriesScope').textContent='';
 $('libraryDetailPageLabel').textContent='—';
 $('libraryDetailPrev').disabled=true;$('libraryDetailNext').disabled=true;
 $('libraryDetailReport').hidden=!validSeason.test(item.seasonKey||'');
 $('libraryDetailEdit').hidden=!(
  item.editKey&&(validMovie.test(item.editKey)||validSeries.test(item.editKey)));
 $('libraryDetailStatus').textContent=
  'التفاصيل خاصة بالمالك؛ المعاينة لا تعمل تلقائيًا.';
 showVideoButton(kind,kind==='movie'?key.slice(6):key,
  kind==='movie'?item.state==='verified':item.verified);
 dialog.showModal();
 const registered=$('libraryDetailSeasons').parentElement,
  episodes=$('libraryDetailEpisodes').parentElement;
 registered.hidden=kind==='movie'||kind==='episode';
 episodes.hidden=kind==='movie';
 if(kind==='series')void loadSeries(key.slice(7));
 else if(kind==='season')void loadSeason(key,1);
 else if(kind==='episode'&&validSeason.test(item.seasonKey||'')){
  // One episode is visible from the owner's already authenticated page.
  episodes.hidden=false;
  const info=make('p','muted',item.caption);
  $('libraryDetailEpisodes').replaceChildren(info);
 }
 $('libraryDetailClose').focus();
}
// Viewing an actual playback attempt only unlocks optional human
// attestation controls. It never automatically marks video/audio valid.
video.addEventListener('playing',()=>{
 if(!previewRunId||!dialog.open)return;
 previewObserved=true;
 $('libraryDetailAvReview').hidden=false;
 $('libraryDetailAvStatus').textContent=
  'إذا شاهدت الصورة فعلاً وسمعت الصوت، أكد كل واحدة بنفسك. لم يُحفظ أي فحص بعد.';
 updateAvButton();
});
for(const id of ['libraryDetailAvVideoCheck','libraryDetailAvAudioCheck']){
 $(id).addEventListener('change',updateAvButton);
}
$('libraryDetailAvConfirm').addEventListener('click',async()=>{
 const runId=previewRunId,openedAt=epoch;
 if(!previewObserved||!dialog.open||avSaving||!runId||
    !validEpisode.test(runId)||!$('libraryDetailAvVideoCheck').checked||
    !$('libraryDetailAvAudioCheck').checked)return;
 if(!(item?.kind==='episode'&&item.verified===true&&item.key===runId||
      verifiedPageEntries.some(entry=>entry.runId===runId&&validVerifiedEntry(entry))))
  return;
 avSaving=true;updateAvButton();
 $('libraryDetailAvStatus').textContent='جارٍ حفظ تأكيدك اليدوي لهذه الحلقة فقط…';
 try{
  const response=await fetch(
   '/api/v1/admin/content-hub/seasons/episodes/av/confirm',{
    method:'POST',credentials:'same-origin',cache:'no-store',
    headers:{'content-type':'application/json',
     'x-blofy-owner-action':'confirm-manual-episode-av'},
    body:JSON.stringify({runId,confirmed:true,
     videoConfirmed:true,audioConfirmed:true}),
    signal:AbortSignal.timeout(12000)
   });
  if(response.status===401){location.assign('/admin');return}
  const result=await response.json();
  if(!response.ok||result.ok!==true||result.manualOnly!==true||
     result.runId!==runId||!result.confirmedAt)
   throw Error('رفض الخادم اعتماد المراجعة. تأكد من تحقق النسخة في التخزين.');
  if(epoch!==openedAt||previewRunId!==runId||!dialog.open)return;
  $('libraryDetailAvStatus').textContent=
   '✅ سُجل تأكيدك الشخصي للصورة والصوت. هذا لا يعني فحصًا آليًا أو نشرًا للعملاء.';
  if(selectedSeason)void loadSeason(selectedSeason,currentPage);
  else $('libraryDetailStatus').textContent=
   'سُجلت مراجعتك اليدوية لهذه الحلقة. لا توجد تغييرات في تشغيل العملاء.';
 }catch(error){
  if(epoch===openedAt&&dialog.open)
   $('libraryDetailAvStatus').textContent=error.message||
    'تعذر حفظ المراجعة؛ لم تتغير حالة الحلقة.';
 }finally{avSaving=false;updateAvButton()}
});
$('libraryDetailPrevVerified').addEventListener('click',()=>{
 const index=verifiedPageEntries.findIndex(e=>e.runId===previewRunId);
 if(index>0)showPreview('episode',verifiedPageEntries[index-1].runId);
});
$('libraryDetailNextVerified').addEventListener('click',()=>{
 const index=verifiedPageEntries.findIndex(e=>e.runId===previewRunId);
 if(index+1<verifiedPageEntries.length)
  showPreview('episode',verifiedPageEntries[index+1].runId);
});
$('libraryDetailClose').addEventListener('click',close);
$('libraryDetailStop').addEventListener('click',stopPreview);
$('libraryDetailPrev').addEventListener('click',()=>{
 if(selectedSeason&&currentPage>1)void loadSeason(selectedSeason,currentPage-1);
});
$('libraryDetailNext').addEventListener('click',()=>{
 if(selectedSeason&&currentPage<pages)
  void loadSeason(selectedSeason,currentPage+1);
});
$('libraryDetailEdit').addEventListener('click',editor);
$('libraryDetailReport').addEventListener('click',()=>{
 if(validSeason.test(selectedSeason||item?.seasonKey||''))
  reportSeason(selectedSeason||item.seasonKey);
});
dialog.addEventListener('close',()=>{
 ++epoch;stopPreview();item=null;selectedSeason=null;
});
document.addEventListener('visibilitychange',()=>{
 if(document.hidden)stopPreview();
});
document.addEventListener('blofy:open-library-detail',event=>{
 show(event?.detail?.item);
});
})();
