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
  const annotatePhones = () => {
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
      const previous = first.querySelector('[data-blofy-device-phone]');
      if (!item?.phone) { previous?.remove(); continue; }
      const text = 'الجوال: ' + item.phone;
      if (previous) { if (previous.textContent !== text) previous.textContent = text; continue; }
      const phone = document.createElement('div');
      phone.className = 'caption';
      phone.dataset.blofyDevicePhone = '1';
      phone.textContent = text;
      first.appendChild(phone);
    }
  };

  const scheduleAnnotation = () => {
    clearTimeout(annotationTimer);
    annotationTimer = setTimeout(annotatePhones, 40);
  };

  const start = () => {
    addPendingFilter();
    const body = document.getElementById('customer-rows');
    if (body) new MutationObserver(scheduleAnnotation).observe(body, { childList: true, subtree: true });
    scheduleAnnotation();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}
