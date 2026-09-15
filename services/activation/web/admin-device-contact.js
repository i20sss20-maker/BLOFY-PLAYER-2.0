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

  let annotationGeneration = 0;
  let annotationTimer = null;
  const visiblePage = () => {
    const label = Array.from(document.querySelectorAll('#customers .caption'))
      .find(element => /^صفحة\s+/u.test(String(element.textContent || '').trim()));
    const match = String(label?.textContent || '').match(/^صفحة\s+(\d+)/u);
    return match ? Number(match[1]) : 1;
  };

  const annotatePhones = async () => {
    const generation = ++annotationGeneration;
    addPendingFilter();
    const form = document.getElementById('customer-search');
    const rows = Array.from(document.querySelectorAll('#customer-rows tr'));
    if (!form || !rows.length) return;

    const params = new URLSearchParams(new FormData(form));
    params.set('page', String(visiblePage()));
    try {
      const response = await fetch('/api/v1/admin/device-insights?' + params.toString(), {
        credentials: 'same-origin',
        headers: { accept: 'application/json' }
      });
      if (!response.ok || generation !== annotationGeneration) return;
      const data = await response.json();
      const items = new Map((data.items || []).map(item => [String(item.deviceId || ''), item]));
      for (const row of rows) {
        if (generation !== annotationGeneration) return;
        const first = row.querySelector('td');
        if (!first) continue;
        const match = String(first.textContent || '').match(/BLOFY-[A-Z0-9-]{4,32}/i);
        if (!match) continue;
        const item = items.get(match[0].toUpperCase()) || items.get(match[0]);
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
    } catch (_) {
      // The primary admin table remains usable if this optional display enhancement cannot load.
    }
  };

  const scheduleAnnotation = () => {
    clearTimeout(annotationTimer);
    annotationTimer = setTimeout(annotatePhones, 60);
  };

  const start = () => {
    addPendingFilter();
    const body = document.getElementById('customer-rows');
    if (body) new MutationObserver(scheduleAnnotation).observe(body, { childList: true, subtree: true });
    const search = document.getElementById('customer-search');
    search?.addEventListener('change', scheduleAnnotation);
    document.getElementById('refresh-customers')?.addEventListener('click', scheduleAnnotation);
    scheduleAnnotation();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}
