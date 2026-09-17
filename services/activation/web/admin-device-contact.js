'use strict';

if (document.body.dataset.page === 'admin') {
  try { labels.pending = 'بانتظار التطبيق'; } catch (_) {}

  const addPendingFilter = () => {
    const filter = document.querySelector('#customer-search select[name="filter"]');
    if (!filter || filter.querySelector('option[value="pending"]')) return;
    const option = document.createElement('option');
    option.value = 'pending';
    option.textContent = 'بانتظار التطبيق';
    const trial = filter.querySelector('option[value="trial"]');
    if (trial) filter.insertBefore(option, trial); else filter.appendChild(option);
  };

  let annotationTimer = null;
  const annotateRows = () => {
    addPendingFilter();
    const rows = Array.from(document.querySelectorAll('#customer-rows tr'));
    if (!rows.length || typeof deviceItems === 'undefined') return;
    const items = new Map((deviceItems || []).map(item => [String(item.deviceId || '').toUpperCase(), item]));
    for (const row of rows) {
      const first = row.querySelector('td');
      if (!first) continue;
      const match = String(first.textContent || '').match(/BLOFY-[A-Z0-9-]{4,32}/i);
      if (!match) continue;
      const item = items.get(match[0].toUpperCase());
      if (!item) continue;

      const previous = first.querySelector('[data-blofy-device-phone]');
      if (!item.phone) previous?.remove();
      else {
        const text = 'الجوال: ' + item.phone;
        if (previous) { if (previous.textContent !== text) previous.textContent = text; }
        else {
          const phone = document.createElement('div');
          phone.className = 'caption';
          phone.dataset.blofyDevicePhone = '1';
          phone.textContent = text;
          first.appendChild(phone);
        }
      }

      row.classList.toggle('is-expired', item.status === 'expired');
      const actionButton = row.querySelector('td:last-child button');
      if (actionButton) {
        if (item.status === 'expired') {
          actionButton.textContent = 'تجديد / إدارة ←';
          actionButton.classList.add('renew-action');
          actionButton.title = 'فتح الجهاز وإعادة تفعيله';
        } else {
          actionButton.classList.remove('renew-action');
          if (actionButton.textContent.includes('تجديد')) actionButton.textContent = 'إدارة ←';
          actionButton.removeAttribute('title');
        }
      }
    }
  };

  const updateRenewalCopy = () => {
    const summary = document.getElementById('record-summary');
    const box = document.getElementById('grant-form');
    const heading = document.getElementById('renewal-heading');
    const caption = document.getElementById('renewal-caption');
    const state = document.getElementById('renewal-state');
    const preview = document.getElementById('preview-renewal');
    if (!summary || !box || !heading || !caption || !state || !preview) return;

    const text = String(summary.textContent || '');
    const expired = text.includes('منتهٍ') || text.includes('منتهي');
    const blocked = text.includes('موقوف');
    const lifetime = text.includes('مدى الحياة');
    box.classList.toggle('renewal-expired', expired && !blocked);

    if (expired && !blocked) {
      heading.textContent = 'إعادة تفعيل الجهاز';
      caption.textContent = 'هذا الجهاز منتهي. اختر المدة الجديدة وستبدأ من وقت التجديد، وليس من تاريخ الانتهاء القديم.';
      state.textContent = 'منتهي — قابل للتجديد';
      preview.textContent = 'مراجعة إعادة التفعيل ←';
      const choices = Array.from(document.querySelectorAll('#renewal-options input'));
      if (choices.length && choices.some(input => !input.disabled)) preview.disabled = false;
    } else if (blocked) {
      heading.textContent = 'الجهاز موقوف';
      caption.textContent = 'ألغِ إيقاف الجهاز أولًا ثم ارجع لتجديد المدة.';
      state.textContent = 'موقوف';
      preview.textContent = 'مراجعة التجديد ←';
    } else if (lifetime) {
      heading.textContent = 'تفعيل مدى الحياة';
      caption.textContent = 'هذا الجهاز لا يحتاج إلى تمديد إضافي.';
      state.textContent = 'مدى الحياة';
      preview.textContent = 'مراجعة التجديد ←';
    } else {
      heading.textContent = 'تمديد التفعيل';
      caption.textContent = 'المدة الجديدة تُضاف إلى الوقت المتبقي من التفعيل الحالي.';
      state.textContent = 'ساري';
      preview.textContent = 'مراجعة التجديد ←';
    }
  };

  const scheduleAnnotation = () => {
    clearTimeout(annotationTimer);
    annotationTimer = setTimeout(() => { annotateRows(); updateRenewalCopy(); }, 40);
  };

  const start = () => {
    addPendingFilter();
    const body = document.getElementById('customer-rows');
    if (body) new MutationObserver(scheduleAnnotation).observe(body, { childList: true, subtree: true });
    const summary = document.getElementById('record-summary');
    if (summary) new MutationObserver(scheduleAnnotation).observe(summary, { childList: true, subtree: true, characterData: true });
    const renewalOptions = document.getElementById('renewal-options');
    if (renewalOptions) new MutationObserver(scheduleAnnotation).observe(renewalOptions, { childList: true, subtree: true, attributes: true });
    scheduleAnnotation();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}
