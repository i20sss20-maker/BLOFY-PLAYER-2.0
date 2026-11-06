// Server-rendered Xtream controls: reliable even when browser JS fails.
// All writes are handled by authenticated same-origin POSTs in xtream-admin-hook.
export const CONTROL_PATH='/api/v1/admin/xtream/controls';

export function escapeControlHtml(value) {
  return String(value??'').replace(/[&<>"']/g,char=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[char]);
}
const esc=escapeControlHtml;
const enc=value=>encodeURIComponent(String(value));
const n=value=>Number(value||0).toLocaleString('en-US');
const form=(id,action,label,klass='',csrfToken='')=>
  '<form method="post" action="'+CONTROL_PATH+'/'+enc(id)+'/'+enc(action)+
  (csrfToken?'?csrf='+enc(csrfToken):'')+'" class="one-action">'+
  '<button type="submit" class="'+esc(klass)+'">'+esc(label)+'</button></form>';

export async function readControlForm(req) {
  if(!/^application\/x-www-form-urlencoded(?:\s*;|$)/i.test(String(req.headers['content-type']||'')))
    throw Object.assign(new Error('control_form_required'),{status:415});
  const chunks=[];let size=0;
  for await(const chunk of req){
    size+=chunk.length;
    if(size>12000)throw Object.assign(new Error('control_form_too_large'),{status:413});
    chunks.push(chunk);
  }
  const query=new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
  const body=Object.create(null);
  for(const [key,value] of query) {
    if(!['name','baseUrl','username','password','m3uUrl','m3uRemove','priority','rightsConfirmed','confirmId','ack'].includes(key))
      continue;
    if(Object.hasOwn(body,key))throw Object.assign(new Error('control_duplicate_field'),{status:400});
    body[key]=value;
  }
  return body;
}

function noticeText(code) {
  const notices={
    added:'حُفظ المصدر الجديد وبدأ طلب استيراد محتواه.',
    enabled:'تم حفظ تفعيل المصدر في قاعدة البيانات.',
    paused:'تم حفظ إيقاف المصدر في قاعدة البيانات.',
    published:'تم نشر المحتوى للعملاء.',
    hidden:'تم إخفاء المحتوى عن العملاء.',
    saved:'تم حفظ بيانات المصدر. افحص الاتصال وأعد المزامنة إذا غيّرت بيانات الدخول.',
    'm3u-saved':'✓ تم حفظ رابط M3U المشفر لهذا المصدر في قاعدة البيانات. ارجع إلى لوحة BLOFY وتأكد من ظهور M3U مرتبط، ثم اختبر قائمة M3U.',
    'm3u-removed':'✓ تم إلغاء ربط M3U لهذا المصدر دون حذف مكتبة Xtream.',
    'm3u-tested':'✓ تم التحقق من رابط M3U المحفوظ وأن الملف يبدأ بترويسة قائمة سليمة. لا يعني ذلك أن كل الأفلام والحلقات تعمل.',
    'm3u-indexing':'بدأت فهرسة الروابط من M3U بأمان. حدّث الصفحة للاطلاع على عدد الأفلام والحلقات المفهرسة؛ لا تحذف المصدر.',
    testing:'بدأ فحص الاتصال؛ حدث الصفحة لمعرفة النتيجة.',
    'probe-ok':'تم اختبار بث الوسائط واستجاب المصدر بنجاح.',
    syncing:'بدأت المزامنة. المكتبة الكبيرة قد تستغرق وقتًا.',
    cancelled:'تم إرسال طلب إلغاء المزامنة.',
    deleted:'تم تسجيل حذف المصدر نهائيًا من القائمة ويجري تنظيف المحتوى بالخلفية.'
  };
  return notices[String(code||'')]||'';
}
export function controlPage({items=[],success='',error='',csrfToken=''}) {
  const securedForm=(id,action,label,klass='')=>form(id,action,label,klass,csrfToken);
  const securedUrl=(path)=>path+(csrfToken?'?csrf='+enc(csrfToken):'');
  const message=noticeText(success)||(String(success).startsWith('probe:')?String(success).slice(6,340):'');
  const cards=items.map(item=>{
    const id=esc(item.id),name=esc(item.name),url=esc(item.baseUrl);
    const status=esc(String(item.status||'unknown'));
    const enabled=Boolean(item.enabled),published=Boolean(item.publishCatalog);
    const counts=item.counts||{};
    const lastError=item.lastError?'<p class="err">آخر خطأ: '+esc(item.lastError)+'</p>':'';
    const metrics='<div class="metrics"><span>القنوات <b>'+n(counts.live)+'</b></span><span>الأفلام <b>'+n(counts.movie)+'</b></span><span>المسلسلات <b>'+n(counts.series)+'</b></span><span>الإجمالي <b>'+n(counts.total)+'</b></span></div>';
    const editForm='<details><summary>تعديل المصدر (يُحفظ في قاعدة البيانات)</summary>'+
      '<form class="edit" method="post" action="'+securedUrl(CONTROL_PATH+'/'+id+'/save')+'">'+
      '<label>الاسم<input name="name" required maxlength="160" value="'+name+'"></label>'+
      '<label>Host<input name="baseUrl" type="url" required maxlength="500" dir="ltr" value="'+url+'"></label>'+
      '<label>رابط M3U جديد (اختياري)<input name="m3uUrl" type="url" maxlength="4096" autocomplete="off" dir="ltr" placeholder="https://provider.example/get.php?..."></label>'+
      '<label><input name="m3uRemove" type="checkbox" value="yes"> حذف رابط M3U المحفوظ</label>'+
      '<label>Username جديد (اختياري)<input name="username" maxlength="512" autocomplete="off"></label>'+
      '<label>Password جديد (اختياري)<input name="password" type="password" maxlength="1024" autocomplete="new-password"></label>'+
      '<label>الأولوية<input name="priority" type="number" min="0" max="10000" value="'+esc(item.priority??100)+'"></label>'+
      '<button type="submit">حفظ التعديلات</button></form></details>';
    return '<article class="card" id="source-'+id+'">'+
      '<div class="head"><div><h2>'+name+'</h2><code>'+url+'</code><small>المعرف: '+id.slice(0,8)+'</small></div><div class="badges">'+
      '<span class="badge">'+status+'</span><span class="badge '+(enabled?'on':'off')+'">'+(enabled?'مفعّل':'موقوف')+'</span>'+
      '<span class="badge '+(enabled&&published?'on':'off')+'">'+(enabled&&published?'منشور':'غير منشور')+'</span>'+
      '<span class="badge '+(item.m3uConfigured?'on':'off')+'">'+(item.m3uConfigured?'M3U مرتبط':'M3U غير مربوط')+'</span>'+
      '<span class="badge '+(item.m3uIndexed?'on':'off')+'">'+(item.m3uIndexed?'فهرس M3U جاهز':'فهرس M3U لم يكتمل')+'</span></div></div'+ '>'+
      metrics+
      '<div class="actions">'+
      securedForm(id,'toggle-enabled',enabled?'إيقاف المصدر':'تفعيل المصدر')+
      securedForm(id,'toggle-publish',published?'إخفاء عن العملاء':'نشر للعملاء')+
      securedForm(id,'test','فحص الاتصال')+
      securedForm(id,'test-m3u','▶ اختبار رابط M3U')+
      securedForm(id,'index-m3u','⚡ فهرسة أفلام وحلقات M3U')+
      securedForm(id,'probe-live','اختبار بث قناة')+
      securedForm(id,'probe-movie','اختبار تشغيل فيلم')+
      securedForm(id,'probe-series','اختبار بيانات مسلسل')+
      securedForm(id,'probe-episode','اختبار تشغيل حلقة')+
      securedForm(id,'sync-all','مزامنة الكل')+
      securedForm(id,'sync-live','مزامنة القنوات')+
      securedForm(id,'sync-movie','مزامنة الأفلام')+
      securedForm(id,'sync-series','مزامنة المسلسلات')+
      securedForm(id,'cancel-sync','إلغاء المزامنة')+
      '<a class="danger" href="'+CONTROL_PATH+'/'+id+'/confirm-delete">حذف المصدر</a></div>'+
      editForm+lastError+'</article>';
  }).join('');
  return '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">'+
  '<meta name="viewport" content="width=device-width,initial-scale=1">'+
  '<title>BLOFY STREAM | لوحة المصادر المباشرة</title>'+
  '<style>:root{color-scheme:dark}*{box-sizing:border-box}body{background:#0e0b17;color:#f4ecff;font-family:system-ui,Tahoma,sans-serif;margin:0;padding:22px}'+
  'main{max-width:1360px;margin:auto}header{display:flex;gap:20px;justify-content:space-between;align-items:center;flex-wrap:wrap;margin-bottom:24px}'+
  'a{color:#d4b4ff}nav{display:flex;gap:14px;flex-wrap:wrap}h1{margin:5px 0}p{line-height:1.7}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,500px),1fr));gap:16px}'+
  '.card,.add{background:#1a1527;border:1px solid #58456f;border-radius:19px;padding:20px;min-width:0}'+
  '.head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}.head h2{margin:0 0 9px;font-size:20px}.head code{display:block;overflow-wrap:anywhere;direction:ltr;text-align:right;color:#c4ade5}.head small{color:#ae9cbd}'+
  '.badges{display:flex;gap:7px;flex-wrap:wrap}.badge{border:1px solid #685576;border-radius:20px;font-size:12px;padding:5px 9px}.badge.on{background:#13362a;color:#b3f1d4}.badge.off{background:#372329;color:#ffd0d6}'+
  '.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;margin:17px 0}.metrics span{background:#110e1b;padding:11px 5px;text-align:center;font-size:12px;border-radius:10px}.metrics b{display:block;font-size:18px;margin-top:5px}'+
  '.actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.actions form,.one-action{margin:0}.actions button,.actions .danger,button{display:block;width:100%;min-height:42px;padding:11px;border-radius:10px;border:1px solid #6d5a7d;color:#f4e8ff;background:#302342;font:inherit;font-weight:600;cursor:pointer;text-decoration:none;text-align:center}'+
  'button:hover,.actions .danger:hover{background:#533873}.actions .danger{grid-column:1/-1;background:#43212a;border-color:#8d3b50}'+
  'details{margin-top:15px;border:1px solid #514060;padding:12px;border-radius:11px}summary{cursor:pointer}.edit,.add form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px;margin-top:14px}'+
  'label{display:block;font-size:13px}input{display:block;width:100%;margin-top:6px;background:#110d1a;color:white;border:1px solid #766089;padding:12px;border-radius:9px;font:inherit}label:has(input[type=checkbox]){display:flex;align-items:center;gap:8px}input[type=checkbox]{width:auto;margin:0}.add button,.edit button{grid-column:1/-1}.note{padding:13px;background:#163425;color:#aef1d2;border-radius:10px}.err{padding:13px;border:1px solid #a1465c;background:#3e202a;border-radius:10px;color:#ffd2dc}.muted{color:#b7a8c9}'+
  '@media(max-width:620px){.metrics{grid-template-columns:repeat(2,1fr)}.edit,.add form{grid-template-columns:1fr}}</style>'+
  '</head><body><main><header><div><h1>BLOFY STREAM — إدارة مباشرة</h1><p class="muted">أوامر حقيقية تُرسل إلى السيرفر بدون الحاجة إلى JavaScript. كل تغيير يُحفظ قبل إعادة عرض المصادر.</p></div>'+
  '<nav><a href="/sources-admin#xtream">اللوحة الرئيسية</a><a href="'+CONTROL_PATH+'">تحديث القائمة</a></nav></header>'+
  (message?'<p class="note" role="status">'+esc(message)+'</p>':'')+
  (error?'<p class="err" role="alert">'+
    (String(error).startsWith('probe:')?'نتيجة الفحص: '+esc(String(error).slice(6,340)):'تعذر تنفيذ العملية: '+esc(error))+'</p>':'')+
  '<section class="add"><h2>إضافة مصدر Xtream جديد</h2><form method="post" action="'+securedUrl(CONTROL_PATH+'/new/add')+'">'+
  '<label>اسم المصدر<input name="name" maxlength="160" required></label>'+
  '<label>Host<input name="baseUrl" type="url" maxlength="500" required placeholder="https://your-host.example"></label>'+
  '<label>رابط M3U اختياري<input name="m3uUrl" type="url" maxlength="4096" autocomplete="off" placeholder="https://provider.example/get.php?..."></label>'+
  '<label>Username<input name="username" maxlength="512" required autocomplete="off"></label>'+
  '<label>Password<input name="password" type="password" maxlength="1024" required autocomplete="off"></label>'+
  '<label>الأولوية<input name="priority" type="number" value="100" min="0" max="10000"></label>'+
  '<label><input name="rightsConfirmed" value="yes" type="checkbox" required> أؤكد أن لدي صلاحية استخدام المحتوى وتوزيعه</label>'+
  '<button type="submit">حفظ المصدر وبدء المزامنة</button></form></section>'+
  '<p class="muted">عدد المصادر: '+n(items.length)+' — المصادر الموقوفة تبقى في القائمة ولا تختفي.</p>'+
  '<div class="grid">'+(cards||'<p class="muted">لا توجد مصادر مضافة.</p>')+'</div></main></body></html>';
}

export function deleteConfirmationPage(source,csrfToken='') {
  const id=esc(source.id),name=esc(source.name);
  return '<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>تأكيد الحذف — BLOFY</title><body style="background:#100c19;color:#fff;font:18px system-ui;padding:30px;max-width:700px;margin:auto">'+
    '<h1>تأكيد حذف مصدر Xtream</h1><p>أنت على وشك حذف <strong>'+name+
    '</strong>. سيُخفى محتواه عن العملاء فورًا، ثم يُزال من BLOFY على دفعات. هذا لا يلغي اشتراكك عند مزود المصدر.</p>'+
    '<form method="post" action="'+CONTROL_PATH+'/'+id+'/delete'+
    (csrfToken?'?csrf='+enc(csrfToken):'')+'">'+
    '<input type="hidden" name="confirmId" value="'+id+'">'+
    '<label><input type="checkbox" name="ack" value="yes" required> أؤكد حذف هذا المصدر ومحتواه من BLOFY.</label>'+
    '<p><button type="submit" style="padding:14px;background:#82344a;color:#fff;border:0;border-radius:9px">تأكيد الحذف النهائي</button></p></form>'+
    '<a style="color:#c9a8ff" href="'+CONTROL_PATH+'">إلغاء والعودة إلى المصادر</a></body></html>';
}
