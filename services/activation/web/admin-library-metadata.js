// Owner-only editorial form: metadata is never auto-imported or used in
// subscriber endpoints. Artwork loads in the browser only for an approved
// manually pasted TMDb image path; no server fetch or arbitrary domains.
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const dialog=$('libraryMetaDialog');
const allowedKey=/^(?:movie:[A-Za-z0-9_-]{8,80}|series:[1-9][0-9]{0,14})$/;
const allowedPath=/^\/[A-Za-z0-9_-]{5,90}\.(?:jpg|jpeg|png|webp)$/;
let saving=false;
const resetPreview=()=>{
 const box=$('libraryMetaPreview');
 box.replaceChildren();
 const path=$('libraryMetaPoster').value.trim();
 if(!path){box.textContent='بدون صورة';return}
 if(!allowedPath.test(path)){
  box.textContent='أدخل مسار JPG أو PNG أو WebP صحيحًا من TMDb فقط.';
  return;
 }
 const img=document.createElement('img');
 img.src='https://image.tmdb.org/t/p/w342'+path;
 img.loading='lazy';img.decoding='async';
 img.referrerPolicy='no-referrer';
 img.alt='معاينة بوستر اختاره المالك';
 img.addEventListener('error',()=>{
  box.textContent='لم يتم تحميل الصورة. تأكد من المسار أو التصريح.';
 },{once:true});
 box.append(img);
};
const close=()=>{if(!saving)dialog.close()};
$('libraryMetaClose').addEventListener('click',close);
$('libraryMetaCancel').addEventListener('click',close);
$('libraryMetaPoster').addEventListener('input',resetPreview);
document.addEventListener('blofy:edit-library-metadata',event=>{
 const detail=event?.detail||{};
 if(!allowedKey.test(String(detail.key||'')))return;
 const data=detail.metadata||{};
 $('libraryMetaKey').value=detail.key;
 $('libraryMetaName').value=data.title||'';
 $('libraryMetaYear').value=data.year||'';
 $('libraryMetaGenre').value=data.genre||'unspecified';
 $('libraryMetaOverview').value=data.overview||'';
 $('libraryMetaPoster').value=data.posterPath||'';
 $('libraryMetaRights').checked=false;
 $('libraryMetaStatus').textContent='';
 $('libraryMatchQuery').value=data.title||'';
 $('libraryMatchLanguage').value='ar-SA';
 $('libraryMatchStatus').textContent='أدخل الاسم واضغط البحث؛ لا حفظ أو مطابقة تلقائية.';
 $('libraryMatchHints').replaceChildren();
 $('libraryMatchResults').replaceChildren();
 resetPreview();
 dialog.showModal();
 $('libraryMetaName').focus();
});
// Match suggestions remain transient until a separate explicit save.
let matching=false;
const createText=(tag,text,className='')=>{
 const el=document.createElement(tag);
 el.textContent=String(text);
 if(className)el.className=className;
 return el;
};
$('libraryMatchSearch').addEventListener('click',async()=>{
 if(matching||saving||!dialog.open)return;
 const key=$('libraryMetaKey').value,
  query=$('libraryMatchQuery').value.trim();
 if(!allowedKey.test(key)||query.length<2||query.length>100){
  $('libraryMatchStatus').textContent='اكتب اسم العمل من حرفين إلى 100 حرف.';
  return;
 }
 const yearValue=$('libraryMetaYear').value.trim(),
  year=yearValue===''?null:Number(yearValue);
 matching=true;
 $('libraryMatchSearch').disabled=true;
 $('libraryMatchStatus').textContent='جارٍ قراءة تلميحات المحتوى وفحص المطابقات المرخصة…';
 $('libraryMatchHints').replaceChildren();
 $('libraryMatchResults').replaceChildren();
 try{
  const response=await fetch('/api/v1/admin/content-hub/library/matches',{
   method:'POST',credentials:'same-origin',cache:'no-store',
   headers:{'content-type':'application/json',
    'x-blofy-owner-action':'match-private-metadata'},
   body:JSON.stringify({key,query,year,
    language:$('libraryMatchLanguage').value})
  });
  if(response.status===401){location.assign('/admin');return}
  const result=await response.json();
  if(!response.ok||result.ok!==true||result.readOnly!==true||
     result.automaticSave!==false||result.needsOwnerReview!==true)
   throw Error('تعذرت قراءة المطابقات ('+(result.code||response.status)+').');
  if(key!==$('libraryMetaKey').value||!dialog.open)return;
  const hints=Array.isArray(result.localHints)?
   result.localHints.slice(0,5):[];
  const suggestions=Array.isArray(result.candidates)?
   result.candidates.slice(0,8):[];
  $('libraryMatchStatus').textContent=result.tmdbEnabled?
   'ظهرت '+suggestions.length+' مطابقة مقترحة من TMDB، وهي غير مؤكدة؛ اختر بعد المراجعة.':
   'البحث الخارجي غير مفعل: يحتاج ترخيص TMDB التجاري ومفتاح القراءة الخاص. التلميحات المحلية أدناه لا تثبت هوية المسلسل.';
  for(const hint of hints){
   const line=createText('div','', 'library-match-hint');
   const label=createText('span',
    hint.title+' · ورد في '+Number(hint.count||0)+' حلقة مسجلة');
   const button=createText('button','البحث بهذا الاسم');
   button.type='button';
   button.addEventListener('click',()=>{
    $('libraryMatchQuery').value=hint.title;
    $('libraryMatchQuery').focus();
   });
   line.append(label,button);
   $('libraryMatchHints').append(line);
  }
  for(const candidate of suggestions){
   const card=createText('article','', 'library-match-card');
   const cleanPoster=typeof candidate.posterPath==='string'&&
    allowedPath.test(candidate.posterPath)?candidate.posterPath:null;
   if(cleanPoster){
    const img=document.createElement('img');
    img.src='https://image.tmdb.org/t/p/w185'+cleanPoster;
    img.alt='صورة مقترحة: '+String(candidate.title||'');
    img.loading='lazy';img.decoding='async';img.referrerPolicy='no-referrer';
    img.addEventListener('error',()=>img.remove(),{once:true});
    card.append(img);
   }
   const info=createText('div','', 'library-match-info');
   info.append(createText('strong',candidate.title||'بدون عنوان'),
    createText('p','سنة '+(candidate.year||'غير معروفة')+
     ' · درجة تشابه تقريبية '+Number(candidate.confidence||0)+'٪'),
    createText('p',String(candidate.overview||'').slice(0,160)));
   const choose=createText('button','اختيار للمعاينة');
   choose.type='button';
   choose.addEventListener('click',()=>{
    if(!$('libraryMetaDialog').open||key!==$('libraryMetaKey').value)return;
    $('libraryMetaName').value=String(candidate.title||'').slice(0,140);
    $('libraryMetaYear').value=candidate.year||'';
    const existing=[...$('libraryMetaGenre').options].some(
     option=>option.value===candidate.genre);
    $('libraryMetaGenre').value=existing?candidate.genre:'unspecified';
    $('libraryMetaOverview').value=String(candidate.overview||'').slice(0,700);
    $('libraryMetaPoster').value=cleanPoster||'';
    $('libraryMetaRights').checked=false;
    $('libraryMetaStatus').textContent=
     'تم تعبئة الحقول للمراجعة فقط. تحقق من الصورة والمحتوى ثم أكد الحقوق قبل الحفظ.';
    resetPreview();
    $('libraryMetaName').focus();
   });
   info.append(choose);card.append(info);
   $('libraryMatchResults').append(card);
  }
  if(result.tmdbEnabled&&suggestions.length===0)
   $('libraryMatchResults').append(
    createText('p','لم نجد نتائج مطابقة؛ جرب تغيير اللغة أو العنوان.'));
 }catch(e){
  $('libraryMatchStatus').textContent=e.message||'تعذر البحث دون أي تعديل.';
 }finally{matching=false;$('libraryMatchSearch').disabled=false}
});
$('libraryMetaForm').addEventListener('submit',async event=>{
 event.preventDefault();
 if(saving)return;
 const key=$('libraryMetaKey').value,
  poster=$('libraryMetaPoster').value.trim();
 if(!allowedKey.test(key)||poster&&!allowedPath.test(poster)){
  $('libraryMetaStatus').textContent='معرّف السجل أو مسار الصورة غير صالح.';
  return;
 }
 if(!$('libraryMetaRights').checked){
  $('libraryMetaStatus').textContent='يجب تأكيد حق استخدام بيانات المحتوى والصورة.';
  return;
 }
 const year=$('libraryMetaYear').value.trim();
 const body={key,title:$('libraryMetaName').value.trim(),
  year:year===''?null:Number(year),
  genre:$('libraryMetaGenre').value,
  overview:$('libraryMetaOverview').value.trim(),
  posterPath:poster||null,confirmed:true,artworkRightsConfirmed:true};
 saving=true;$('libraryMetaSave').disabled=true;
 $('libraryMetaStatus').textContent='جارٍ حفظ بيانات العرض فقط، دون تعديل المحتوى…';
 try{
  const response=await fetch('/api/v1/admin/content-hub/library/metadata',{
   method:'POST',credentials:'same-origin',cache:'no-store',
   headers:{'content-type':'application/json',
    'x-blofy-owner-action':'curate-private-metadata'},
   body:JSON.stringify(body)
  });
  if(response.status===401){location.assign('/admin');return}
  const result=await response.json();
  if(!response.ok||result.ok!==true)
   throw Error(result.code==='curated_media_not_registered'?
    'السجل ليس موجودًا في قائمة المحتوى المحفوظة.':
    'تعذر حفظ البيانات ('+(result.code||response.status)+').');
  $('libraryMetaStatus').textContent='حُفظ العنوان والصورة في فهرس المالك الخاص.';
  dialog.close();
  $('libraryRefresh').click();
 }catch(error){
  $('libraryMetaStatus').textContent=error.message||
   'تعذر حفظ البيانات دون أي تعديل في الملفات.';
 }finally{
  saving=false;$('libraryMetaSave').disabled=false;
 }
});
})();
