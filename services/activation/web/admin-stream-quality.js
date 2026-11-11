/* Aggregated, opt-in STREAM playback observations. No device IDs or URLs. */
(() => {
  'use strict';
  const root = document.getElementById('stream-qoe-summary');
  const refresh = document.getElementById('stream-qoe-refresh');
  if (!root) return;
  let active = null;
  const label = {live:'قنوات مباشرة',movie:'أفلام',series:'مسلسلات',episode:'حلقات',catchup:'إعادة مشاهدة',unknown:'أخرى'};
  const formatMs = (n) => n == null ? '—' : (Number(n)/1000).toFixed(1)+' ث';
  function text(tag, value, className) {
    const element = document.createElement(tag);
    if (className) element.className=className;
    element.textContent=value;
    return element;
  }
  async function load() {
    if (active) active.abort();
    const controller=new AbortController();
    active=controller;
    root.replaceChildren(text('p','جارٍ جلب إحصاءات تشغيل آخر 24 ساعة…','caption'));
    try {
      const timer=setTimeout(() => controller.abort(),12000);
      let response;
      try {
        response=await fetch('/api/v1/admin/diagnostics/quality?hours=24',{
          method:'GET',credentials:'same-origin',cache:'no-store',
          headers:{accept:'application/json'},signal:controller.signal
        });
      } finally {clearTimeout(timer)}
      if (!response.ok) throw new Error('admin_quality_'+response.status);
      const payload=await response.json();
      if (active!==controller) return;
      root.replaceChildren();
      if (!Array.isArray(payload.groups) || payload.groups.length === 0) {
        root.appendChild(text('p','لا توجد قياسات تشغيل حديثة. تظهر البيانات فقط عند تفعيل إرسال التشخيصات من الأجهزة.','caption'));
        return;
      }
      for (const group of payload.groups) {
        const card=text('div','', 'blofy-performance-metric');
        const title=text('strong',label[group.kind]||'محتوى آخر');
        const line=text('small',
          'بداية العرض (وسيط / P90): '+formatMs(group.medianFirstFrameMs)+' / '+formatMs(group.p90FirstFrameMs)+
          ' | ملاحظات '+Number(group.observations||0)+
          ' | أخطاء '+Number(group.errors||0)+
          ' | تقطيع '+Number(group.rebufferCount||0)+
          ' | زمن التقطيع '+formatMs(group.rebufferMs)+
          ' | استعادة '+Number(group.recoveryCount||0));
        card.append(title,line);
        root.append(card);
      }
      root.appendChild(text('p','هذه قياسات الأجهزة التي وافقت على التشخيص؛ ليست ضمانًا لتوفر المصدر أو تمثيلًا لكل المشاهدات.','caption'));
    } catch {
      if (active!==controller) return;
      root.replaceChildren(text('p','تعذر عرض قياسات جودة التشغيل الآن. تأكد من تسجيل دخول الإدارة وأعد المحاولة.','caption'));
    } finally {if(active===controller)active=null}
  }
  refresh?.addEventListener('click',load);
  load();
})();
