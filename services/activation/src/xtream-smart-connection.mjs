// BLOFY Smart Connection: a small, non-invasive per-source diagnosis.
// The report intentionally contains no hostname, IP, username, password,
// provider response body or unbounded exception text.
const KNOWN=new Set([
  'xtream_transport_dns_failed','xtream_transport_connection_refused',
  'xtream_transport_connection_reset','xtream_transport_timeout',
  'xtream_transport_tls_invalid','xtream_transport_unreachable',
  'xtream_http_401','xtream_http_403','xtream_http_404',
  'xtream_http_429','xtream_http_456','xtream_auth_failed',
  'xtream_account_response_invalid','xtream_account_response_too_large',
  'xtream_private_host_blocked','xtream_host_unresolved'
]);

const EXPLAIN=Object.freeze({
  xtream_transport_dns_failed:['تعذر الوصول إلى اسم المصدر','تأكد من كتابة هوست المصدر وصحة DNS لدى المزود.'],
  xtream_transport_connection_refused:['السيرفر رفض اتصال Railway','تأكد من المنفذ والبروتوكول واطلب من المزود السماح باتصال السيرفر.'],
  xtream_transport_connection_reset:['المصدر قطع اتصال Railway','قارن نفس الحساب من تطبيق آخر. إذا كان يعمل، اطلب من المزود مراجعة قيود اتصال السيرفر وعنوان الخروج.'],
  xtream_transport_timeout:['المصدر لم يستجب خلال المهلة','راجع استقرار المصدر والمنفذ والمسار الشبكي بين Railway والمزود.'],
  xtream_transport_tls_invalid:['شهادة HTTPS غير صالحة','اطلب تصحيح شهادة المصدر؛ لا تعطل التحقق الأمني.'],
  xtream_transport_unreachable:['تعذر اتصال Railway بالمصدر','تحقق من السماح باتصالات الاستضافة ومن مسار الشبكة لدى مزود المصدر.'],
  xtream_http_401:['بيانات المصدر مرفوضة (401)','راجع بيانات دخول المصدر وصلاحية الاشتراك معه.'],
  xtream_http_403:['المصدر رفض السماح (403)','اطلب من المزود توضيح شروط الاتصال والسماح بعنوان الخروج إن لزم.'],
  xtream_http_404:['واجهة Xtream غير موجودة (404)','تحقق من هوست Xtream ومسار API ونوع الخدمة لدى المزود.'],
  xtream_http_429:['المصدر يحد عدد الطلبات (429)','لا تكرر الفحص بسرعة؛ اطلب رفع الحد إذا كان اشتراكك يسمح بذلك.'],
  xtream_http_456:['المصدر رفض الطلب (456)','راجع سياسة المزود وقيود الحساب أو المنطقة؛ لا تحاول تجاوز شروط الوصول.'],
  xtream_auth_failed:['رفض حساب Xtream','تأكد من اسم المستخدم وكلمة المرور ومن تفعيل الحساب لدى المزود.'],
  xtream_account_response_invalid:['المصدر لا يعيد بيانات Xtream صحيحة','تأكد أن الرابط مخصص لواجهة Xtream وليس موقعًا أو صفحة حماية.'],
  xtream_account_response_too_large:['استجابة الحساب أكبر من المتوقع','اطلب من المزود تصحيح استجابة Xtream.'],
  xtream_private_host_blocked:['تم منع عنوان خاص أو محلي','استخدم عنوان المصدر العام المصرح به فقط.'],
  xtream_host_unresolved:['تعذر التحقق من هوست المصدر','راجع اسم النطاق وسجلات DNS.']
});

export function normalizedXtreamIssue(errorCode){
  const text=String(errorCode||'').trim();
  if(KNOWN.has(text))return text;
  // Provider status codes not explicitly mapped are not assumed to be network errors.
  return 'xtream_connection_unknown';
}

export function xtreamConnectionReport({ok=false,errorCode=null,checkedAt=Date.now()}={}){
  const code=ok?'xtream_api_reachable':normalizedXtreamIssue(errorCode);
  const [title,nextStep]=ok
    ? ['واجهة حساب Xtream تستجيب من Railway','هذا يؤكد وصول API فقط. افحص تشغيل قناة وفيلم وحلقة بشكل منفصل.']
    : EXPLAIN[code]||['تعذر فحص اتصال المصدر','راجع سجل المصدر ونتيجة فحص حساب Xtream ثم تواصل مع المزود عند الحاجة.'];
  return {
    ok:Boolean(ok),
    stage:'xtream_account_api',
    code,
    title,
    nextStep,
    checkedAt:new Date(Number.isFinite(checkedAt)?checkedAt:Date.now()).toISOString(),
    playbackVerified:false,
    staticOutboundIpStatus:'not_checked',
    route:'railway_default',
    note:'نجاح اتصال API لا يؤكد تشغيل الفيديو. تغيير مسار الشبكة يتطلب موافقة مزود المصدر.'
  };
}
