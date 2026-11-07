// BLOFY ONE reads existing services only. No credentials in browser storage,
// no source sync, no subscriber updates and no background polling.
const byId=id=>document.getElementById(id);
const stamp=new Intl.DateTimeFormat('ar-SA',{hour:'2-digit',minute:'2-digit'});
const count=new Intl.NumberFormat('en-US');
async function readJson(path){
  const response=await fetch(path,{method:'GET',cache:'no-store',credentials:'same-origin',
    headers:{accept:'application/json'},signal:AbortSignal.timeout(10_000)});
  if(!response.ok)throw new Error(response.status===401?'session_required':'service_unavailable');
  return response.json();
}
function state(prefix,{label,value,tone='pending'}){
  const pill=byId('one-'+prefix+'-pill'),text=byId('one-'+prefix+'-value');
  pill.textContent=label;pill.className='one-pill '+tone;text.textContent=value;
}
async function refresh(){
  const button=byId('one-refresh');
  if(button.disabled)return;
  button.disabled=true;byId('one-last-checked').textContent='جارٍ التحقق من الحالات الفعلية…';
  const outcomes=await Promise.allSettled([
    readJson('/health'),readJson('/xtream/health'),readJson('/api/v1/admin/restream-engine/health')
  ]);
  const [portal,xtream,engine]=outcomes;
  if(portal.status==='fulfilled'&&portal.value?.ok){
    state('portal',{label:'متصل',value:'الموقع وقاعدة البيانات يعملان',tone:'ok'});
  }else state('portal',{label:'غير متاح',value:'فشل فحص صحة الموقع',tone:'fail'});
  if(xtream.status==='fulfilled'&&xtream.value?.ok){
    state('xtream',{label:'متصل',value:'بوابة Xtream تستجيب',tone:'ok'});
    const catalog=xtream.value.catalog||{};
    for(const [name,value] of [['live',catalog.live],['movies',catalog.movie],
      ['series',catalog.series],['accounts',xtream.value.accounts]]){
      byId('one-'+name).textContent=Number.isSafeInteger(value)&&value>=0?count.format(value):'—';
    }
  }else{
    state('xtream',{label:'غير متاح',value:'تعذر قراءة بوابة Xtream',tone:'fail'});
    for(const id of ['live','movies','series','accounts'])byId('one-'+id).textContent='—';
  }
  if(engine.status==='fulfilled'&&engine.value?.connected){
    state('engine',{label:'متصل',value:'المحرك الخاص يستجيب — لم يثبت البث الحقيقي',tone:'warn'});
  }else{
    state('engine',{label:'غير جاهز',value:engine.status==='fulfilled'&&engine.value?.state==='not_configured'
      ?'رابط محرك البث غير مهيأ':'تعذر الاتصال بمحرك البث',tone:'warn'});
  }
  byId('one-last-checked').textContent='آخر فحص: '+stamp.format(new Date());
  button.disabled=false;
}
async function smoke(){
  const button=byId('one-smoke'),result=byId('one-smoke-result');
  if(button.disabled)return;
  button.disabled=true;result.textContent='يجري فحص HLS التجريبي داخل شبكة Railway…';
  try{
    const response=await fetch('/api/v1/admin/restream-engine/smoke',{
      method:'GET',credentials:'same-origin',cache:'no-store',
      headers:{accept:'application/json'},signal:AbortSignal.timeout(22_000)});
    const data=await response.json();
    if(response.status===429)result.textContent='تم الاختبار مؤخرًا؛ أعد المحاولة بعد 30 ثانية.';
    else if(response.status===401)result.textContent='انتهت جلسة الإدارة؛ سجّل الدخول مجددًا.';
    else if(data.ok&&data.mediaVerified)
      result.textContent='نجح اختبار مقطع TS التجريبي. هذا لا يثبت تشغيل مصادر العملاء أو فك الصوت والصورة.';
    else{
      const reasons={
        restream_smoke_not_published:'قناة الاختبار غير منشورة داخل MediaMTX.',
        restream_smoke_auth_rejected:'رفض محرك البث وصول مقطع HLS.',
        restream_smoke_engine_unreachable:'تعذر الوصول إلى المحرك الخاص.',
        restream_smoke_segment_missing:'لا توجد مقاطع بث جاهزة حاليًا.',
        restream_smoke_not_mpegts:'لم تصل بيانات MPEG-TS صحيحة.',
        restream_not_configured:'لم يجهز عنوان المحرك الخاص.',
        restream_smoke_rate_limited:'تم الاختبار مؤخرًا، أعد المحاولة لاحقًا.'
      };
      result.textContent=reasons[data.code]||'لم يجتز المحرك اختبار البث التجريبي بعد.';
    }
  }catch{result.textContent='تعذر إكمال فحص المحرك. لا توجد تغييرات على بث العملاء.';}
  finally{button.disabled=false;}
}
byId('one-refresh')?.addEventListener('click',()=>{void refresh()});
byId('one-smoke')?.addEventListener('click',()=>{void smoke()});
void refresh();
