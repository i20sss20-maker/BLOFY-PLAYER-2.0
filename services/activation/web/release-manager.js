/* Release-only enhancement. Detached legacy nodes cannot overwrite a refreshed catalogue. */
(function () {
  'use strict';
  const admin = document.body.dataset.page === 'admin';
  if (!admin && document.body.dataset.page !== 'downloads') return;
  const root = '/api/v1/admin/experience/releases';
  const el = (tag, text, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; };
  const errors = { primary_release_delete_forbidden: 'اختر إصدارًا أساسيًا آخر قبل حذف هذا الإصدار.',
    release_changed: 'تغيّر الإصدار في جلسة أخرى. حدّث القائمة وراجع التعديل.', release_not_found: 'الإصدار غير موجود. حدّث القائمة.',
    release_version_exists: 'رقم الإصدار موجود مسبقًا. استخدم تعديل بدل إضافة نسخة مكررة.',
    release_catalog_full: 'وصل عدد الإصدارات إلى 200. احذف إصدارًا غير أساسي أولًا.',
    invalid_release: 'أدخل اسم إصدار صحيحًا ورقمه ورابط HTTPS مباشرًا ينتهي بـ .apk.',
    invalid_release_request: 'تعذر تحديد الإصدار. حدّث القائمة.', rate_limited: 'انتظر قليلًا ثم أعد المحاولة.' };
  async function request(path, method = 'GET', body) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(path, { method, credentials: 'same-origin', signal: controller.signal,
        headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
      if (response.status === 401 && admin) { location.assign('/admin'); throw new Error('انتهت جلسة المشرف.'); }
      const data = await response.json();
      if (!response.ok) throw new Error(errors[data.error] || 'تعذر إكمال الطلب. لم نؤكد حفظ أي تغيير؛ حدّث القائمة للمراجعة.');
      return data;
    } catch (error) { if (error.name === 'AbortError') throw new Error('تأخر الرد. حدّث القائمة للتحقق من حالة الطلب قبل تكراره.'); throw error; }
    finally { clearTimeout(timer); }
  }
  const previousList = document.getElementById(admin ? 'admin-releases' : 'releases');
  if (!previousList) return;
  const list = previousList.cloneNode(false);
  const library = el('section', null, 'release-library'); previousList.replaceWith(library); library.append(list);
  let form, status, saveButton, cancelButton, formTitle, editing = null, busy = false, generation = 0, selectionRevision = 1;
  const notice = el('p', '', 'status'); notice.setAttribute('role', 'status'); list.before(notice);
  function message(text, bad = false) { notice.textContent = text; notice.classList.toggle('bad', bad); }
  function resetForm() {
    editing = null; form.reset(); formTitle.textContent = 'إضافة إصدار'; saveButton.textContent = 'حفظ الإصدار'; cancelButton.hidden = true; status.textContent = ''; status.classList.remove('bad');
  }
  function edit(item) {
    if (busy) return;
    editing = item;
    for (const key of ['channel','versionCode','versionName','downloadUrl','releaseNotes']) form.elements.namedItem(key).value = item[key] ?? '';
    formTitle.textContent = 'تعديل ' + item.versionName; saveButton.textContent = 'حفظ التعديل'; cancelButton.hidden = false;
    status.textContent = item.isPrimary ? 'هذا الإصدار أساسي؛ تغيير رابطه أو بياناته سيظهر للعملاء بعد الحفظ.' : '';
    form.scrollIntoView({ behavior: 'smooth', block: 'start' }); form.elements.namedItem('versionName').focus({ preventScroll: true });
  }
  function setBusy(value) {
    busy = value;
    if (form) for (const field of form.elements) field.disabled = value;
    for (const button of list.querySelectorAll('button')) button.disabled = value || button.dataset.locked === 'true';
  }
  async function action(item, kind) {
    if (busy) return;
    const text = kind === 'delete' ? 'حذف ' + item.versionName + ' من مركز الإصدارات؟ لن يُحذف ملف APK الأصلي من GitHub ولا التطبيق من أجهزة العملاء.' :
      'تعيين ' + item.versionName + ' كإصدار أساسي للتحميل وفحص التحديث داخل التطبيق؟ الإصدارات الأحدث المثبتة لن ترجع للخلف تلقائيًا.';
    if (!window.confirm(text)) return;
    setBusy(true); message('جارٍ حفظ التغيير…');
    try {
      await request(root + '/' + item.id + (kind === 'primary' ? '/primary' : ''), kind === 'delete' ? 'DELETE' : 'POST',
        { expectedRevision: item.revision, expectedSelectionRevision: selectionRevision });
      if (editing?.id === item.id) resetForm();
      await load(); message(kind === 'delete' ? 'تم حذف الإصدار من القائمة.' : 'تم اعتماد الإصدار الأساسي. رابط التحميل الثابت وفحص التحديث يستخدمانه الآن.');
    } catch (error) { message(error.message, true); }
    finally { setBusy(false); }
  }
  async function load() {
    const current = ++generation;
    const data = await request(admin ? root : '/api/v1/releases');
    if (current !== generation) return;
    selectionRevision = data.selectionRevision || 1;
    list.replaceChildren();
    if (!data.items?.length) { list.append(el('p', 'لا توجد إصدارات بعد.', 'empty')); return; }
    for (const item of data.items) {
      const card = el('article', null, 'card release-card' + (item.isPrimary ? ' release-primary' : ''));
      const title = el('div', null, 'release-heading');
      const versionTitle = el('h3', item.versionName); versionTitle.dir = 'ltr';
      title.append(versionTitle, el('span', item.isPrimary ? '★ الإصدار الأساسي' : (item.channel === 'stable' ? 'معتمد' : 'تجريبي'), 'badge'));
      card.append(title, el('p', 'رقم الإصدار: ' + item.versionCode, 'caption'), el('p', item.releaseNotes || 'لا توجد ملاحظات إضافية.', 'content-text'));
      const actions = el('div', null, 'release-actions');
      if (admin) {
        const editButton = el('button', 'تعديل'); editButton.type = 'button'; editButton.onclick = () => edit(item);
        const primaryButton = el('button', item.isPrimary ? 'الإصدار الأساسي' : 'تعيين كأساسي', 'primary'); primaryButton.type = 'button';
        primaryButton.dataset.locked = String(item.isPrimary); primaryButton.disabled = item.isPrimary; primaryButton.onclick = () => action(item, 'primary');
        const deleteButton = el('button', 'حذف', 'danger'); deleteButton.type = 'button';
        deleteButton.dataset.locked = String(item.isPrimary); deleteButton.disabled = item.isPrimary;
        deleteButton.title = item.isPrimary ? 'اختر إصدارًا أساسيًا آخر قبل الحذف.' : 'حذف من مركز الإصدارات'; deleteButton.onclick = () => action(item, 'delete');
        actions.append(editButton, primaryButton, deleteButton);
      }
      const link = el('a', 'تحميل APK', 'btn');
      // Only safe APK links are rendered, even if an unexpected response is supplied.
      try { const url = new URL(item.downloadUrl); if (url.protocol === 'https:' && !url.username && !url.password && /\.apk$/i.test(url.pathname)) {
        link.href = url.href; link.rel = 'noopener noreferrer'; actions.append(link);
      } } catch { /* omit invalid links */ }
      card.append(actions); list.append(card);
    }
    setBusy(busy);
  }
  if (admin) {
    const previousForm = document.getElementById('release-form');
    form = previousForm.cloneNode(true); previousForm.replaceWith(form);
    formTitle = el('h3', 'إضافة إصدار', 'full'); form.prepend(formTitle);
    saveButton = form.querySelector('button'); saveButton.type = 'submit';
    status = form.querySelector('#release-status');
    cancelButton = el('button', 'إلغاء التعديل', 'ghost full'); cancelButton.type = 'button'; cancelButton.hidden = true; cancelButton.onclick = resetForm; saveButton.after(cancelButton);
    form.elements.namedItem('versionCode').max = '2100000000';
    form.elements.namedItem('versionCode').step = '1';
    form.elements.namedItem('versionName').placeholder = '2.0.0-rc07.40';
    form.elements.namedItem('versionName').dir = 'ltr';
    const hint = el('p', 'اكتب رقم الإصدار الموجود داخل ملف APK، وليس رقم النسخة المختصر. مثال الإصدار 40: 2000051. الإضافة لا تجعله أساسيًا حتى تختار «تعيين كأساسي».', 'caption full');
    formTitle.after(hint);
    const tools = el('div', null, 'release-tools');
    const refresh = el('button', '↻ تحديث الإصدارات'); refresh.type = 'button';
    refresh.onclick = () => { if (!busy) load().then(() => message('تم تحديث القائمة.')).catch(error => message(error.message, true)); };
    const download = el('a', 'رابط تحميل الإصدار الأساسي', 'btn'); download.href = '/download/latest.apk';
    tools.append(refresh, download); notice.before(tools);
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (busy || !form.reportValidity()) return;
      if (editing?.isPrimary && !window.confirm('حفظ التعديل على الإصدار الأساسي؟ تأكد أن الرقم والرابط يطابقان ملف APK الموقّع.')) return;
      const body = Object.fromEntries(new FormData(form));
      body.minSupportedVersionCode = editing?.minSupportedVersionCode || 1;
      if (editing) body.expectedRevision = editing.revision;
      const id = editing?.id;
      setBusy(true); status.textContent = 'جارٍ الحفظ…';
      try {
        await request(root + (id ? '/' + id : ''), id ? 'PATCH' : 'POST', body);
        resetForm(); await load(); message(id ? 'تم حفظ التعديل.' : 'تمت إضافة الإصدار. اختر «تعيين كأساسي» لاعتماده للعملاء.');
      } catch (error) { status.textContent = error.message; status.classList.add('bad'); }
      finally { setBusy(false); }
    });
    // Keep the releases tab reachable after reload without touching other admin navigation.
    for (const button of document.querySelectorAll('[data-panel]')) button.addEventListener('click', () => history.replaceState(null, '', '/admin#' + button.dataset.panel));
    if (location.hash === '#releases') document.querySelector('[data-panel="releases"]')?.click();
  }
  load().catch(error => message(error.message, true));
})();
