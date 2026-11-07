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
const e2e=document.getElementById('one-preview-e2e');
e2e?.addEventListener('click',async()=>{
  if(e2e.disabled)return;
  e2e.disabled=true;
  status.textContent='يجري اختبار الجلسة وقائمة HLS ومقطع الفيديو داخل BLOFY…';
  try{
    const response=await fetch('/api/v1/admin/restream-engine/demo/check',{
      method:'GET',credentials:'same-origin',cache:'no-store',
      headers:{accept:'application/json'},signal:AbortSignal.timeout(45000)});
    const report=await response.json();
    if(response.status===401)status.textContent='جلسة المشرف غير صالحة؛ سجّل دخولك مجددًا.';
    else if(response.status===429)status.textContent='تم الاختبار قبل قليل؛ أعد المحاولة بعد 30 ثانية.';
    else if(report.ok&&report.mediaVerified){
      status.textContent='نجح مسار HLS التجريبي كاملًا: جلسة المشرف، قائمة البث، ومقطع MPEG-TS. الصوت والصورة الحقيقية للمصدر الخارجي غير مؤكدة.';
    }else status.textContent='تعذر إكمال اختبار المسار الداخلي ('+String(report.reason||'unavailable').slice(0,48)+').';
  }catch{status.textContent='فشل فحص مسار HLS الداخلي؛ لم تتأثر اشتراكات العملاء.';}
  finally{e2e.disabled=false;}
});
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
