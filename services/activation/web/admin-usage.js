'use strict';

if (document.body.dataset.page === 'admin') {
  let usageGeneration = 0;
  let analyticsCache = null;
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
        card.append(node('strong', value == null ? '—' : Number(value).toLocaleString('en-US')),
          node('span', label), node('small', help));
        metrics.append(card);
      }
      usageBox.append(metrics);
      const requests = Number(data.requests?.blofy);
      const completed = Number(data.completed?.blofy);
      if (Number.isFinite(requests) && requests > 0 && Number.isFinite(completed)) {
        const ratio = node('p', 'الملفات المكتملة مقارنة بالطلبات: ' + (100 * completed / requests).toFixed(1) + '% (مؤشر تقريبي، وليس نسبة نجاح فعلية)', 'caption');
        usageBox.append(ratio);
      }
      try {
        const activity = await api('/api/v1/admin/device-insights/analytics');
        analyticsCache = activity;
        if (current !== usageGeneration) return;
        const heading = node('h2', 'نشاط الأجهزة والإصدارات');
        usageBox.append(heading);
        const deviceMetrics = node('div', null, 'usage-metrics');
        for (const [value, label] of [
          [activity.summary?.registered, 'الأجهزة المسجلة'],
          [activity.summary?.active24h, 'تواصلت خلال 24 ساعة'],
          [activity.summary?.active7d, 'تواصلت خلال 7 أيام'],
          [activity.summary?.active30d, 'تواصلت خلال 30 يومًا'],
          [activity.summary?.registered24h, 'أجهزة جديدة خلال 24 ساعة']
        ]) {
          const card = node('div', null, 'usage-metric');
          card.append(node('strong', value == null ? '—' : Number(value).toLocaleString('en-US')), node('span', label));
          deviceMetrics.append(card);
        }
        usageBox.append(deviceMetrics);
        const currentWeek = Number(activity.summary?.registered7d);
        const previousWeek = Number(activity.summary?.registeredPrevious7d);
        if (Number.isFinite(currentWeek) && Number.isFinite(previousWeek) && activity.summary?.registered7d != null && activity.summary?.registeredPrevious7d != null) {
          const difference = currentWeek - previousWeek;
          const direction = difference > 0 ? 'زيادة' : difference < 0 ? 'انخفاض' : 'دون تغيير';
          const comparison = node('p', 'الأجهزة الجديدة خلال 7 أيام: ' + currentWeek.toLocaleString('en-US') + ' مقابل ' + previousWeek.toLocaleString('en-US') + ' في الأيام السبعة السابقة • ' + direction + (difference ? ' بمقدار ' + Math.abs(difference).toLocaleString('en-US') : ''), 'caption');
          usageBox.append(comparison);
        }
        for (const [title, rows] of [['إصدارات التطبيق',activity.versions],['أنظمة الأجهزة',activity.platforms]]) {
          const section = node('details');
          section.append(node('summary', title));
          for (const row of rows || []) section.append(node('p', String(row.label) + ': ' + Number(row.count).toLocaleString('en-US'), 'caption'));
          usageBox.append(section);
        }
        const history = node('details');
        history.open = true;
        history.append(node('summary', 'تسجيل الأجهزة خلال آخر 14 يومًا'));
        const days = activity.registrations || [];
        const max = Math.max(1, ...days.map(row => Number(row.registrations) || 0));
        const chart = node('div', null, 'blofy-registration-chart');
        chart.setAttribute('role', 'img');
        chart.setAttribute('aria-label', 'أعداد تسجيل الأجهزة يوميًا خلال آخر 14 يومًا');
        chart.style.cssText = 'display:flex;align-items:end;gap:8px;min-height:145px;overflow-x:auto;padding:16px 4px 4px';
        for (const row of days) {
          const count = Math.max(0, Number(row.registrations) || 0);
          const item = node('div', null, 'blofy-registration-day');
          item.style.cssText = 'flex:1;min-width:35px;display:flex;flex-direction:column;align-items:center;gap:6px';
          const number = node('small', String(count));
          const bar = node('div');
          bar.style.cssText = 'width:100%;max-width:32px;height:' + Math.max(3,Math.round(95*count/max)) + 'px;border-radius:7px 7px 2px 2px;background:linear-gradient(180deg,#a878ff,#6131ba)';
          const label = node('small', String(row.day).slice(5));
          item.title = String(row.day) + ': ' + count;
          item.append(number,bar,label); chart.append(item);
        }
        if (!days.length) history.append(node('p', 'لا توجد بيانات للرسم البياني حاليًا.', 'caption'));
        history.append(chart);
        usageBox.append(history, node('p', activity.note || 'النشاط مبني على آخر تواصل مسجل، وليس عدد مرات تشغيل التطبيق.', 'caption'));
      } catch {
        usageBox.append(node('p', 'تعذر تحديث تقارير الأجهزة حاليًا. إحصاءات التحميل مستقلة عنها.', 'caption'));
      }
      const insights = node('a', 'عرض تقارير الأجهزة والإصدارات ←', 'btn');
      insights.href = '/api/v1/admin/device-insights';
      usageBox.append(insights, node('p', 'التحميل من الموقع لا يثبت تثبيت التطبيق. إعادة التنزيل تُحسب مرة أخرى؛ العدد ليس عدد أشخاص.', 'caption'));
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
  const exportButton = node('button', 'تنزيل تقرير الأجهزة CSV', 'ghost');
  exportButton.type = 'button';
  exportButton.setAttribute('aria-label', 'تنزيل ملخص نشاط الأجهزة دون معلومات تعريفية');
  exportButton.addEventListener('click', () => {
    if (!analyticsCache) return;
    const rows = [['المؤشر','القيمة']];
    const summary = analyticsCache.summary || {};
    for (const [key,label] of [['registered','الأجهزة المسجلة'],['active24h','نشطة خلال 24 ساعة'],['active7d','نشطة خلال 7 أيام'],['active30d','نشطة خلال 30 يومًا'],['registered24h','جديدة خلال 24 ساعة'],['registered7d','جديدة خلال 7 أيام']]) {
      rows.push([label, summary[key] == null ? '' : String(summary[key])]);
    }
    rows.push(['اليوم','تسجيلات جديدة']);
    for (const day of analyticsCache.registrations || []) rows.push([String(day.day || ''), String(day.registrations || 0)]);
    const escape = value => '"' + String(value).replace(/"/g,'""') + '"';
    const csv = '\uFEFF' + rows.map(row => row.map(escape).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
    const link = document.createElement('a');
    link.href = url; link.download = 'blofy-device-analytics.csv';
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  usageBox.after(exportButton);
  $('refresh-customers').addEventListener('click', refreshUsage);
  refreshUsage();
  const usageTimer = setInterval(() => { if (!document.hidden) refreshUsage(); }, 60000);
  window.addEventListener('pagehide', () => clearInterval(usageTimer), { once: true });
}
