/* Administrative release controls. APK files and installed applications are never deleted here. */
(() => {
  'use strict';
  if (document.body.dataset.page !== 'admin') return;
  const form = document.getElementById('release-form');
  const list = document.getElementById('admin-releases');
  if (!form || !list) return;
  const message = document.getElementById('release-status');
  const endpoint = '/api/v1/admin/experience/releases';
  let snapshot = null, editing = null, busy = false, loadGeneration = 0;
  const errorText = {
    invalid_release: 'تحقق من اسم النسخة ورقم الإصدار ورابط HTTPS الصحيح.',
    release_conflict: 'تغيّرت الإصدارات من جلسة أخرى. حدّث القائمة وراجع التعديل قبل الحفظ.',
    release_exists: 'رقم الإصدار موجود بالفعل. استخدم زر تعديل النسخة الموجودة.',
    release_identity_locked: 'رقم الإصدار داخل APK لا يُغيّر أثناء التعديل. أضف نسخة جديدة برقم جديد.',
    release_not_found: 'هذه النسخة لم تعد موجودة. حدّث القائمة.',
    primary_release_protected: 'لا يمكن حذف الإصدار الأساسي. عيّن نسخة أخرى كأساسية أولًا.',
    release_limit: 'وصل عدد الإصدارات إلى الحد المسموح. احذف نسخة قديمة أولًا.',
    rate_limited: 'طلبات كثيرة. انتظر قليلًا ثم أعد المحاولة.',
    forbidden_origin: 'أعد فتح لوحة الإدارة من رابطها الأصلي.',
    release_catalog_unavailable: 'تعذر قراءة الإصدارات. لم تُحفظ أي تغييرات.'
  };
  function element(tag, text, className) {
    const value = document.createElement(tag);
    if (text != null) value.textContent = text;
    if (className) value.className = className;
    return value;
  }
  function status(text, bad = false) {
    message.textContent = text; message.classList.toggle('bad', bad);
  }
  async function request(path = '', method = 'GET', body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(endpoint + path, {
        method, credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        headers: body ? {'content-type': 'application/json'} : {},
        body: body ? JSON.stringify(body) : undefined
      });
      if (response.status === 401) { location.assign('/admin'); throw new Error('انتهت جلسة المشرف.'); }
      const data = await response.json();
      if (!response.ok) throw new Error(errorText[data.error] || 'تعذر إكمال الطلب. أعد المحاولة.');
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('تأخر الرد؛ حدّث القائمة للتحقق من الحفظ قبل إعادة المحاولة.');
      throw error;
    } finally { clearTimeout(timer); }
  }
  const title = element('h3', 'إضافة إصدار'); title.id = 'release-form-title'; title.className = 'full';
  form.prepend(title);
  form.elements.versionName.dir = 'ltr'; form.elements.versionCode.dir = 'ltr';
  const saveButton = form.querySelector('button'); saveButton.type = 'submit';
  const cancelButton = element('button', 'إلغاء التعديل', 'ghost full');
  cancelButton.type = 'button'; cancelButton.hidden = true; cancelButton.id = 'cancel-release-edit';
  saveButton.after(cancelButton);
  const notice = element('p', 'الحفظ يضيف نسخة إلى القائمة ولا يجعلها أساسية تلقائيًا. يجب أن تطابق بيانات الإصدار ملف APK الموقّع.', 'caption full');
  message.after(notice);
  const refresh = element('button', '↻ تحديث الإصدارات', 'ghost'); refresh.type = 'button'; refresh.id = 'refresh-releases';
  document.querySelector('#release-manager .section-top').append(refresh);
  const selected = element('div', '', 'notice'); selected.id = 'primary-release-summary';
  document.querySelector('#release-manager .two').before(selected);
  function lock(value) {
    busy = value;
    for (const control of form.querySelectorAll('input,textarea,select,button')) control.disabled = value;
    refresh.disabled = value;
    for (const button of list.querySelectorAll('button')) button.disabled = value || button.dataset.protected === '1';
    saveButton.disabled = value || !snapshot;
  }
  function reset() {
    editing = null; form.reset(); form.elements.versionCode.readOnly = false;
    title.textContent = 'إضافة إصدار'; saveButton.textContent = 'حفظ الإصدار'; cancelButton.hidden = true;
  }
  function edit(item) {
    if (busy) return;
    editing = item;
    for (const key of ['channel','versionName','versionCode','downloadUrl','releaseNotes']) form.elements[key].value = item[key] ?? '';
    form.elements.versionCode.readOnly = true;
    title.textContent = 'تعديل ' + item.versionName; saveButton.textContent = 'حفظ التعديلات'; cancelButton.hidden = false;
    status('تعدّل بيانات النسخة الحالية؛ رقم الإصدار يبقى مطابقًا لملف APK.');
    form.scrollIntoView({block: 'nearest', behavior: 'smooth'}); form.elements.versionName.focus();
  }
  function button(label, action, className = 'ghost') {
    const value = element('button', label, className); value.type = 'button';
    value.addEventListener('click', action); return value;
  }
  function render() {
    list.replaceChildren();
    const primary = snapshot.items.find(item => item.isPrimary);
    const summary = element('strong', primary ? 'الإصدار الأساسي: ' : 'لم يُحدد إصدار أساسي');
    if (primary) { const version = element('bdi', primary.versionName); version.dir = 'ltr'; summary.append(version); }
    selected.replaceChildren(summary);
    selected.append(element('p', 'الأساسي هو رابط التحميل الافتراضي والتحديث داخل التطبيق. الأجهزة ذات رقم إصدار أعلى لا ترجع إلى نسخة أقدم.', 'caption'));
    const link = element('a', 'رابط التحميل الثابت ↗'); link.href = '/download/latest.apk';
    link.target = '_blank'; link.rel = 'noopener noreferrer'; selected.append(link);
    for (const item of snapshot.items) {
      const card = element('article', null, 'card download-card available'); card.dataset.versionCode = item.versionCode;
      const head = element('div', null, 'actions'); const name = element('h3', item.versionName); name.dir = 'ltr'; head.append(name);
      if (item.isPrimary) head.append(element('span', '★ الإصدار الأساسي', 'pill'));
      card.append(head, element('p', (item.channel === 'stable' ? 'معتمدة' : 'تجريبية') + ' · رقم الإصدار: ' + item.versionCode, 'caption'),
        element('p', item.releaseNotes || 'لا توجد ملاحظات إضافية.', 'content-text'));
      const download = element('a', 'تحميل APK ↗', 'btn');
      download.href = item.downloadUrl; download.target = '_blank'; download.rel = 'noopener noreferrer';
      const actions = element('div', null, 'actions'); actions.append(download, button('تعديل', () => edit(item)));
      const primaryButton = button(item.isPrimary ? 'أساسي حاليًا' : 'تعيين كأساسي', () => makePrimary(item), 'primary');
      const removeButton = button('حذف', () => remove(item));
      for (const value of [primaryButton, removeButton]) { value.disabled = item.isPrimary; value.dataset.protected = item.isPrimary ? '1' : '0'; }
      if (item.isPrimary) removeButton.title = 'عيّن نسخة أخرى كأساسية قبل حذف هذه النسخة';
      actions.append(primaryButton, removeButton); card.append(actions); list.append(card);
    }
    list.append(element('p', 'الحذف يزيل النسخة من قائمة الموقع فقط؛ لا يحذف ملف APK من GitHub ولا التطبيق المثبّت على أجهزة العملاء.', 'caption'));
  }
  async function load() {
    if (busy) return;
    const generation = ++loadGeneration; lock(true);
    try { const data = await request(); if (generation !== loadGeneration) return; snapshot = data; render(); }
    catch (error) { status(error.message, true); }
    finally { if (generation === loadGeneration) lock(false); }
  }
  async function mutate(path, method, values, success) {
    if (busy || !snapshot) return;
    lock(true);
    try {
      snapshot = await request(path, method, {...values, revision: snapshot.revision});
      reset(); render(); status(success);
    } catch (error) { status(error.message, true); }
    finally { lock(false); }
  }
  function makePrimary(item) {
    if (busy || item.isPrimary) return;
    if (!confirm('تعيين ' + item.versionName + ' كأساسي للتحميل والتحديث؟\nتأكد أن الرابط يشير إلى APK الموقّع وأن رقم الإصدار مطابق.')) return;
    mutate('/' + item.versionCode + '/primary', 'POST', {}, 'تم تعيين ' + item.versionName + ' كأساسي.');
  }
  function remove(item) {
    if (busy || item.isPrimary) return;
    if (!confirm('حذف ' + item.versionName + ' من قائمة الموقع؟\nلن يُحذف ملف GitHub أو التطبيق من أجهزة العملاء.')) return;
    mutate('/' + item.versionCode, 'DELETE', {}, 'حُذفت النسخة من قائمة الإصدارات.');
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (busy || !snapshot || !form.reportValidity()) return;
    const input = Object.fromEntries(new FormData(form));
    input.minSupportedVersionCode = editing?.minSupportedVersionCode || 1;
    mutate(editing ? '/' + editing.versionCode : '', editing ? 'PATCH' : 'POST', input,
      editing ? 'حُفظت تعديلات النسخة.' : 'أُضيفت النسخة. يمكنك الآن تعيينها كأساسية.');
  });
  cancelButton.addEventListener('click', () => { reset(); status(''); });
  refresh.addEventListener('click', () => { reset(); status(''); load(); });
  lock(false); load();
})();
