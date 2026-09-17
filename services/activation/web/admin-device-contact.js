'use strict';

if (document.body.dataset.page === 'admin') {
  try { labels.pending = 'بانتظار التطبيق'; } catch (_) {}

  const PANEL_NAMES = new Set(['devices', 'support', 'releases']);
  const panelFromHash = () => {
    const name = String(location.hash || '').replace(/^#/, '').trim().toLowerCase();
    return PANEL_NAMES.has(name) ? name : null;
  };

  const openHashPanel = () => {
    const name = panelFromHash();
    if (!name) return;
    const button = document.querySelector(`[data-panel="${name}"]`);
    if (button && button.getAttribute('aria-current') !== 'page') button.click();
  };

  const installPanelRouting = () => {
    document.querySelectorAll('[data-panel]').forEach(button => {
      if (button.dataset.blofyHashRouting === '1') return;
      button.dataset.blofyHashRouting = '1';
      button.addEventListener('click', () => {
        const name = button.dataset.panel;
        if (PANEL_NAMES.has(name) && location.hash !== `#${name}`) history.replaceState(null, '', `#${name}`);
      });
    });
    window.addEventListener('hashchange', openHashPanel);
    openHashPanel();
  };

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
    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      if (cells.length < 2) continue;
      const stateText = String(cells[1].textContent || '');
      const expired = stateText.includes('منتهٍ') || stateText.includes('منتهي');
      row.classList.toggle('is-expired', expired);
      const actionButton = cells[cells.length - 1]?.querySelector('button');
      if (!actionButton) continue;
      if (expired) {
        actionButton.textContent = 'تجديد / إدارة ←';
        actionButton.classList.add('renew-action');
        actionButton.title = 'فتح الجهاز وإعادة تفعيله';
      } else {
        actionButton.classList.remove('renew-action');
        if (actionButton.textContent.includes('تجديد')) actionButton.textContent = 'إدارة ←';
        actionButton.removeAttribute('title');
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
    installPanelRouting();
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
