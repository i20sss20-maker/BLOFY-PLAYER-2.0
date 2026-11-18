/* BLOFY ONE: real customer administration through existing signed-session APIs.
 * No new customer store, default subscription changes or background writes.
 * Sensitive records are kept in memory only, and rendered with textContent.
 */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  if (!$('one-customer-search-form')) return;
  const form = $('one-customer-search-form');
  const search = $('one-customer-query');
  const filter = $('one-customer-filter');
  const sort = $('one-customer-sort');
  const refreshButton = $('one-customer-refresh');
  const statusLine = $('one-customer-status');
  const rows = $('one-customer-rows');
  const prev = $('one-customer-prev');
  const next = $('one-customer-next');
  const exportButton = $('one-customer-export');
  const pageLabel = $('one-customer-page');
  const modal = $('one-customer-dialog');
  const profileForm = $('one-customer-edit-form');
  const profileSummary = $('one-customer-dialog-summary');
  const profileStatus = $('one-customer-edit-status');
  const saveButton = $('one-customer-save');
  const blockButton = $('one-customer-toggle-block');

  let page = 1;
  let total = 0;
  let pageSize = 20;
  let currentItems = [];
  let requestVersion = 0;
  let detailVersion = 0;
  let selected = null;
  let writing = false;

  const labels = Object.freeze({
    active: 'نشط', trial: 'تجربة', expired: 'منتهي',
    blocked: 'موقوف', new: 'جديد', pending: 'قيد التفعيل'
  });
  const number = value => Number.isSafeInteger(Number(value)) && Number(value) >= 0
    ? Number(value).toLocaleString('en-US') : '—';
  const date = value => {
    if (value === null || value === undefined || value === '') return 'غير محدد';
    const n = new Date(value);
    return Number.isFinite(n.getTime()) && n.getTime() > 0
      ? n.toLocaleDateString('ar-SA', { day: 'numeric', month: 'short', year: 'numeric' })
      : 'غير معروف';
  };
  const text = (tag, content, cls) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    node.textContent = String(content ?? '');
    return node;
  };
  const setStatus = (area, message, error = false) => {
    area.textContent = message;
    area.classList.toggle('one-customer-error', error);
  };
  async function api(path, method = 'GET', body) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(path, {
        method, credentials: 'same-origin', cache: 'no-store',
        headers: { 'accept': 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal
      });
      if (response.status === 401) throw new Error('انتهت جلسة الإدارة. سجّل الدخول من /admin.');
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = {
          invalid_revision: 'بيانات العميل تغيّرت من مكان آخر. أعد فتح سجله قبل الحفظ.',
          revision_conflict: 'تم تعديل سجل العميل مؤخرًا. أعد فتحه.',
          invalid_phone: 'رقم الجوال غير صالح.',
          invalid_email: 'البريد الإلكتروني غير صالح.',
          rate_limited: 'طلبات كثيرة؛ أعد المحاولة لاحقًا.'
        }[data.error];
        throw new Error(message || 'فشل الطلب (HTTP ' + response.status + ').');
      }
      return data;
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('انتهت مهلة الاتصال. أعد المحاولة.');
      throw err;
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function loadSummary() {
    const targets = [
      ['one-customer-total', '—'],
      ['one-customer-phones', '—'],
      ['one-codes-active', '—'],
      ['one-codes-expiring', '—']
    ];
    for (const [id, value] of targets) $(id).textContent = value;
    const results = await Promise.allSettled([
      api('/api/v1/admin/device-insights?filter=all&sort=newest&page=1'),
      api('/api/v1/admin/code-ops/summary')
    ]);
    if (results[0].status === 'fulfilled') {
      const counts = results[0].value.counts || {};
      $('one-customer-total').textContent = number(counts.total);
      $('one-customer-phones').textContent = number(counts.with_phone);
    }
    if (results[1].status === 'fulfilled') {
      const totals = results[1].value.totals || {};
      $('one-codes-active').textContent = number(totals.enabled);
      $('one-codes-expiring').textContent = number(totals.expiring);
    }
  }

  function render() {
    rows.replaceChildren();
    const frag = document.createDocumentFragment();
    for (const item of currentItems) {
      if (!item || !item.deviceId) continue;
      const row = document.createElement('tr');
      const customer = document.createElement('td');
      customer.append(text('strong', item.name || item.deviceId),
        text('small', item.name ? item.deviceId : 'جهاز BLOFY'));
      const kind = text('span', labels[item.status] || item.status || 'غير مؤكد',
        'one-customer-badge status-' + String(item.status || 'unknown').replace(/[^a-z]/ig, ''));
      const state = document.createElement('td');
      state.append(kind);
      const contact = text('td', item.phone || 'غير مسجل');
      contact.dir = 'ltr';
      const action = document.createElement('td');
      const manage = text('button', 'فتح السجل', 'one-customer-open');
      manage.type = 'button';
      manage.addEventListener('click', () => { void openCustomer(item.deviceId); });
      action.append(manage);
      row.append(customer, state,
        text('td', date(item.expiresAt)),
        text('td', date(item.lastSeenAt)), contact, action);
      frag.append(row);
    }
    if (!frag.childNodes.length) {
      const row = document.createElement('tr');
      const cell = text('td', 'لا توجد أجهزة مطابقة لهذا البحث.');
      cell.colSpan = 6;
      row.append(cell);
      frag.append(row);
    }
    rows.append(frag);
    pageLabel.textContent = 'الصفحة ' + page + ' · ' + number(total) + ' نتيجة';
    prev.disabled = page <= 1;
    next.disabled = page * pageSize >= total;
    exportButton.disabled = currentItems.length === 0;
  }

  async function loadCustomers({ withSummary = false } = {}) {
    const version = ++requestVersion;
    refreshButton.disabled = true;
    prev.disabled = true;
    next.disabled = true;
    exportButton.disabled = true;
    setStatus(statusLine, 'جارٍ قراءة بيانات العملاء من الخدمة الأصلية…');
    const params = new URLSearchParams({
      q: search.value.trim(), filter: filter.value,
      sort: sort.value, page: String(page)
    });
    try {
      const result = await api('/api/v1/admin/device-insights?' + params);
      if (version !== requestVersion) return;
      currentItems = Array.isArray(result.items) ? result.items : [];
      total = Number.isSafeInteger(Number(result.total)) && Number(result.total) >= 0 ? Number(result.total) : 0;
      pageSize = Number.isSafeInteger(Number(result.pageSize)) && Number(result.pageSize) > 0
        ? Number(result.pageSize) : 20;
      render();
      setStatus(statusLine, currentItems.length + ' عميل/جهاز في هذه الصفحة — عدد النتائج: ' + number(total));
    } catch (error) {
      if (version !== requestVersion) return;
      currentItems = [];
      total = 0;
      render();
      setStatus(statusLine, error.message, true);
    } finally {
      if (version === requestVersion) refreshButton.disabled = false;
    }
    if (withSummary && version === requestVersion) await loadSummary();
  }
  function clearProfile() {
    detailVersion++;
    selected = null;
    writing = false;
    profileForm.reset();
    saveButton.disabled = false;
    blockButton.disabled = false;
    profileSummary.replaceChildren();
    setStatus(profileStatus, '');
  }
  function closeProfile() {
    modal.close();
    clearProfile();
  }
  function recordSummary(data) {
    profileSummary.replaceChildren();
    for (const [name, value] of [
      ['الجهاز', data.deviceId || selected?.deviceId || '—'],
      ['الحالة', labels[data.status] || data.status || 'غير معروف'],
      ['الانتهاء', date(data.expiresAt)],
      ['آخر تواصل', date(data.lastSeenAt)]
    ]) {
      const p = text('p', '');
      p.append(text('strong', name + ': '), text('span', value));
      profileSummary.append(p);
    }
  }
  async function openCustomer(deviceId) {
    if (!deviceId || writing) return;
    clearProfile();
    const version = ++detailVersion;
    modal.showModal();
    setStatus(profileStatus, 'جارٍ تحميل بيانات العميل…');
    saveButton.disabled = true;
    blockButton.disabled = true;
    try {
      const data = await api('/api/v1/admin/device-insights/' + encodeURIComponent(deviceId));
      if (version !== detailVersion || !modal.open) return;
      selected = { deviceId, revision: data.revision, status: data.rawStatus, expiresAt: data.expiresAt };
      recordSummary({ ...data, deviceId });
      for (const name of ['name', 'phone', 'email', 'notes']) {
        profileForm.elements[name].value = String(data[name] || '');
      }
      blockButton.textContent = data.rawStatus === 'blocked' ? 'إلغاء إيقاف الجهاز' : 'إيقاف الجهاز';
      blockButton.classList.toggle('one-customer-danger', data.rawStatus !== 'blocked');
      saveButton.disabled = false;
      blockButton.disabled = false;
      setStatus(profileStatus, 'البيانات الحالية من قاعدة BLOFY؛ التعديل يحتاج حفظًا صريحًا.');
    } catch (error) {
      if (version !== detailVersion || !modal.open) return;
      setStatus(profileStatus, error.message, true);
    }
  }
  async function saveProfile(event) {
    event.preventDefault();
    if (!selected || writing || !profileForm.reportValidity()) return;
    const record = selected;
    const version = detailVersion;
    const body = Object.fromEntries(new FormData(profileForm));
    body.expectedRevision = record.revision;
    if (!window.confirm('حفظ بيانات هذا العميل فقط؟ لن يُعدل الاشتراك أو ارتباط الجهاز.')) return;
    writing = true;
    saveButton.disabled = true;
    blockButton.disabled = true;
    setStatus(profileStatus, 'جارٍ حفظ معلومات العميل…');
    try {
      await api('/api/v1/admin/device-insights/' + encodeURIComponent(record.deviceId), 'PATCH', body);
      if (detailVersion !== version) return;
      setStatus(profileStatus, 'تم الحفظ. نعيد تحميل السجل للتحقق من آخر نسخة…');
      const latest = record.deviceId;
      closeProfile();
      await loadCustomers({ withSummary: true });
      await openCustomer(latest);
      setStatus(profileStatus, 'تم تحديث بيانات العميل وحفظها.');
    } catch (error) {
      if (detailVersion === version) setStatus(profileStatus, error.message, true);
    } finally {
      writing = false;
      if (detailVersion === version) {
        saveButton.disabled = false;
        blockButton.disabled = false;
      }
    }
  }
  async function toggleBlock() {
    if (!selected || writing) return;
    const record = selected;
    const version = detailVersion;
    const isBlocked = record.status === 'blocked';
    const verb = isBlocked ? 'إلغاء إيقاف' : 'إيقاف';
    if (!window.confirm(verb + ' الجهاز ' + record.deviceId +
      ' عند التحقق القادم؟ لا يتغير تاريخ الانتهاء ولا يُحذف محتوى العميل.')) return;
    writing = true;
    saveButton.disabled = true;
    blockButton.disabled = true;
    setStatus(profileStatus, 'جارٍ تنفيذ إجراء الجهاز…');
    try {
      await api('/api/v1/admin/device-insights/' + encodeURIComponent(record.deviceId) + '/status',
        'POST', {
          action: isBlocked ? 'unblock' : 'block',
          expectedStatus: record.status,
          expectedExpiresAt: record.expiresAt
        });
      if (version !== detailVersion) return;
      const id = record.deviceId;
      closeProfile();
      await loadCustomers({ withSummary: true });
      await openCustomer(id);
      setStatus(profileStatus, 'تم ' + verb + ' الجهاز بنجاح. لم يُمدد اشتراكه.');
    } catch (error) {
      if (version === detailVersion) setStatus(profileStatus, error.message, true);
    } finally {
      writing = false;
      if (version === detailVersion) {
        saveButton.disabled = false;
        blockButton.disabled = false;
      }
    }
  }
  function exportCsv() {
    if (!currentItems.length || !window.confirm('تصدير بيانات عملاء هذه الصفحة فقط؟ قد يحتوي الملف أرقام جوال؛ احتفظ به بشكل آمن.')) return;
    // Avoid spreadsheet formula injection, even for device IDs or customer names.
    const quote = value => {
      let item = String(value ?? '').replace(/[\u0000-\u001f]/g, ' ');
      if (/^[\s]*[=+\-@]/.test(item)) item = "'" + item;
      return '"' + item.replaceAll('"', '""') + '"';
    };
    const fields = [
      ['الاسم', 'الجهاز', 'الجوال', 'الحالة', 'الانتهاء', 'آخر تواصل'],
      ...currentItems.map(item => [
        item.name, item.deviceId, item.phone,
        labels[item.status] || item.status, date(item.expiresAt), date(item.lastSeenAt)
      ])
    ];
    const url = URL.createObjectURL(new Blob(['\ufeff' +
      fields.map(row => row.map(quote).join(',')).join('\r\n')], {
        type: 'text/csv;charset=utf-8'
      }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'blofy-one-customers-page-' + page + '.csv';
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    page = 1;
    void loadCustomers({ withSummary: true });
  });
  for (const field of [filter, sort]) field.addEventListener('change', () => {
    page = 1;
    void loadCustomers({ withSummary: false });
  });
  refreshButton.addEventListener('click', () => { void loadCustomers({ withSummary: true }); });
  prev.addEventListener('click', () => { if (page > 1) { page--; void loadCustomers(); } });
  next.addEventListener('click', () => { if (page * pageSize < total) { page++; void loadCustomers(); } });
  exportButton.addEventListener('click', exportCsv);
  profileForm.addEventListener('submit', event => { void saveProfile(event); });
  blockButton.addEventListener('click', () => { void toggleBlock(); });
  $('one-customer-dialog-close').addEventListener('click', () => { if (!writing) closeProfile(); });
  modal.addEventListener('cancel', event => {
    if (writing) event.preventDefault();
    else clearProfile();
  });
  modal.addEventListener('close', clearProfile);
  window.addEventListener('pagehide', clearProfile);
  void loadCustomers({ withSummary: true });
})();
