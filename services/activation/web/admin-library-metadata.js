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
 resetPreview();
 dialog.showModal();
 $('libraryMetaName').focus();
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
