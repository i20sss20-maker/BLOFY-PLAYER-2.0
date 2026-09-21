'use strict';

if (document.body.dataset.page === 'admin') {
  let usageGeneration = 0;
  const usageBox = node('section', null, 'card usage-card');
  usageBox.id = 'download-usage';
  usageBox.setAttribute('aria-label', 'إحصاءات تحميل BLOFY');
  usageBox.setAttribute('aria-live', 'polite');
  usageBox.append(node('h2', 'تحميلات BLOFY PLAYER'), node('p', 'جارٍ قراءة إحصاءات التحميل…', 'caption'));
  $('overview').before(usageBox);

  async function refreshUsage() {
    const current = ++usageGeneration;
    try {
      const data = await api('/api/v1/admin/experience/usage');
      if (current !== usageGeneration) return;
      usageBox.replaceChildren(node('h2', 'تحميلات BLOFY PLAYER'));
      const metrics = node('div', null, 'usage-metrics');
      for (const [value, label, help] of [
        [data.requests?.blofy, 'طلبات تنزيل BLOFY', 'يشمل إعادة الطلب والمحاولات غير المكتملة'],
        [data.completed?.blofy, 'ملفات أُرسلت كاملة', 'منذ بدء قياس اكتمال التحميل'],
        [data.completed?.today, 'تحميلات مكتملة اليوم', 'اليوم بتوقيت السعودية']
      ]) {
        const card = node('div', null, 'usage-metric');
        card.append(node('strong', value == null ? '—' : Number(value).toLocaleString('ar-SA')),
          node('span', label), node('small', help));
        metrics.append(card);
      }
      usageBox.append(metrics, node('p', 'التحميل من الموقع لا يثبت تثبيت التطبيق. إعادة التنزيل تُحسب مرة أخرى؛ العدد ليس عدد أشخاص.', 'caption'));
      const detail = node('details');
      detail.append(node('summary', 'كيف تُحسب الأرقام؟'), node('p',
        'نعدّ إرسال ملف APK كاملًا، ونستبعد الطلبات الفاشلة وفحص الروابط والأجزاء المنفصلة من التحميل المجزأ. التحميل المباشر من GitHub وGoogle Play غير مشمول. الأجهزة بالأسفل تُعدّ حسب رقم الجهاز، ولا تزيد مع كل فتح للتطبيق.', 'caption'));
      usageBox.append(detail);
      usageBox.append(node('p', data.completed?.startedAt
        ? 'بدأ قياس اكتمال التحميل: ' + date(data.completed.startedAt) + ' · آخر ملف مكتمل: ' + date(data.completed.lastAt)
        : 'قياس الملفات المكتملة غير متاح بعد؛ الطلبات القديمة لا تُعدّ ملفات مكتملة.', 'caption'));
      if (!data.requests) usageBox.append(node('p', 'عداد طلبات التحميل غير متاح حاليًا.', 'status'));
    } catch {
      if (current !== usageGeneration) return;
      usageBox.replaceChildren(node('h2', 'تحميلات BLOFY PLAYER'), node('p', 'تعذر قراءة إحصاءات التحميل. يمكنك متابعة إدارة الأجهزة.', 'status'));
      const retry = node('button', 'إعادة المحاولة', 'ghost');
      retry.type = 'button'; retry.onclick = refreshUsage; usageBox.append(retry);
    }
  }
  $('refresh-customers').addEventListener('click', refreshUsage);
  refreshUsage();
}
