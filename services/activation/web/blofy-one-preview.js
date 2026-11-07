// Demonstration only: browser uses existing admin cookie on same-origin requests.
const manifest='/api/v1/admin/restream-engine/demo/smoke/index.m3u8';
const video=document.getElementById('one-preview-video');
const status=document.getElementById('one-preview-status');
const play=document.getElementById('one-preview-play');
const check=document.getElementById('one-preview-check');
async function verify(){
  check.disabled=true;
  status.textContent='يجري التحقق من HLS التجريبي…';
  try{
    const res=await fetch(manifest,{cache:'no-store',credentials:'same-origin',
      headers:{accept:'application/vnd.apple.mpegurl'},signal:AbortSignal.timeout(20000)});
    if(!res.ok){status.textContent=res.status===401?
      'جلسة المشرف غير صالحة؛ سجل دخولك مجددًا.':'لم ينجح الاتصال بملفات HLS التجريبية ('+res.status+').';return false;}
    const body=await res.text();
    if(body.startsWith('#EXTM3U')){
      status.textContent='نجح جلب قائمة HLS من BLOFY. التشغيل بالصورة والصوت يحتاج اختبار الجهاز.';
      return true;
    }
    status.textContent='ملف الاستجابة ليس قائمة HLS صحيحة.';return false;
  }catch{
    status.textContent='تعذر قراءة HLS من بوابة BLOFY.';return false;
  }finally{check.disabled=false;}
}
check.addEventListener('click',()=>{void verify();});
play.addEventListener('click',async()=>{
  play.disabled=true;
  try{
    const ok=await verify();
    if(!ok)return;
    if(!video.canPlayType('application/vnd.apple.mpegurl')&&!video.canPlayType('application/x-mpegURL')){
      status.textContent='تم التحقق من قائمة HLS، لكن هذا المتصفح لا يدعم تشغيلها مباشرة. استخدم جهازًا يدعم HLS، مثل Safari.';
      return;
    }
    video.src=manifest;
    await video.play();
    status.textContent='بدأ المشغل؛ تحقق من ظهور الصورة وسماع الصوت بنفسك.';
  }catch{
    status.textContent='تعذر التشغيل في هذا المتصفح؛ لا يعني ذلك تعطل بث المصدر.';
  }finally{play.disabled=false;}
});
