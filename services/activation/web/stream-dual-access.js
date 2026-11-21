/* BLOFY STREAM operator workspace: one subscription, two login methods.
 * No secrets in query strings, browser storage, logs or account lists.
 * Every mutation is an explicit administrator action through the existing API.
 */
(() => {
  'use strict';
  const root = document.getElementById('streamDualAccess');
  if (!root) return;
  const $ = id => document.getElementById(id);
  const codeInput = $('dualVoucher');
  const accountSearch = $('dualAccountSearch');
  const accountSelect = $('dualAccountSelect');
  const accountRefresh = $('dualAccountRefresh');
  const codeButton = $('dualCodeToXtream');
  const accountButton = $('dualXtreamToCode');
  const codeStatus = $('dualCodeStatus');
  const accountStatus = $('dualAccountStatus');
  const credentialResult = $('dualXtreamResult');
  const voucherResult = $('dualVoucherResult');
  const now = () => Date.now();
  let accounts = [];
  let loadedAt = 0;
  let accountsLoading = null;
  let secretTimer = null;
  let revealedCredentials = null;
  let revealedCode = null;

  const normalizeCode = value => String(value || '').trim().toUpperCase()
    .replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 0x6f0))
    .replace(/[\s-]+/g, '');
  const validCode = code => /^(?:[0-9]{8,12}|[A-F0-9]{24})$/.test(code);
  const dateText = value => {
    const d = new Date(value);
    return value && Number.isFinite(d.getTime())
      ? d.toLocaleDateString('ar-SA', { year: 'numeric', month: 'short', day: 'numeric' })
      : 'غير معروف';
  };
  const errors = {
    stream_link_code_not_found: 'الكود غير موجود في نظام BLOFY STREAM.',
    stream_link_activate_first: 'الكود غير مفعّل بعد. يجب تفعيله أولًا.',
    stream_link_code_expired: 'انتهت صلاحية الكود، ولا يمكن استخراج بياناته.',
    stream_link_code_revoked: 'الكود ملغى.',
    stream_link_account_expired: 'انتهت صلاحية حساب Xtream.',
    stream_link_account_unavailable: 'حساب Xtream غير نشط أو غير موجود.',
    stream_link_account_expiry_required: 'الحساب لا يحتوي تاريخ انتهاء؛ لا يمكن ربطه تلقائيًا.',
    stream_link_legacy_code_not_recoverable: 'الكود القديم غير قابل للاسترجاع. لا يتم استبداله تلقائيًا.',
    stream_link_saleh_source_only: 'هذه العملية متاحة لمصدر صالح المعتمد فقط.',
    stream_link_code_unavailable: 'الكود المرتبط غير متاح أو لم يكتمل تفعيله.',
    stream_link_credentials_unavailable: 'تعذر استرجاع بيانات الحساب من المخزن الآمن.',
    stream_link_duration_unsupported: 'مدة الحساب غير مدعومة لربط الكود.',
    stream_link_code_already_exists: 'الحساب مرتبط بكود سابق. حدّث القائمة وحاول مجددًا.',
    stream_code_invalid: 'صيغة الكود غير صحيحة.'
  };
  function status(target, message, isError = false) {
    target.textContent = message;
    target.classList.toggle('dual-error', isError);
  }
  function conceal() {
    window.clearTimeout(secretTimer);
    secretTimer = null;
    revealedCredentials = null;
    revealedCode = null;
    for (const id of ['dualHostValue', 'dualUserValue', 'dualPasswordValue', 'dualAppCodeValue']) {
      const field = $(id);
      if (field) field.textContent = '';
    }
    credentialResult.hidden = true;
    voucherResult.hidden = true;
  }
  function armConceal() {
    window.clearTimeout(secretTimer);
    secretTimer = window.setTimeout(conceal, 90000);
  }
  async function request(path, body) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 18000);
    try {
      const response = await fetch(path, {
        method: body === undefined ? 'GET' : 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal
      });
      if (response.status === 401) {
        conceal();
        window.location.assign('/admin');
        throw new Error('انتهت جلسة الإدارة. سجّل الدخول مجددًا.');
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok && body !== undefined) {
        throw new Error(errors[data.error || data.code] ||
          (response.status === 429 ? 'طلبات كثيرة. أعد المحاولة لاحقًا.' :
            'تعذر تنفيذ العملية (HTTP ' + response.status + ').'));
      }
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('انتهت مهلة الاتصال. حاول مرة أخرى.');
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }
  async function copy(value, target, successMessage) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      status(target, successMessage);
    } catch {
      status(target, 'تعذر النسخ تلقائيًا. حدّد القيمة وانسخها يدويًا.', true);
    }
  }
  function showXtream(result) {
    const cred = result.credentials || {};
    revealedCredentials = {
      serverUrl: String(cred.serverUrl || ''),
      username: String(cred.username || ''),
      password: String(cred.password || '')
    };
    $('dualHostValue').textContent = revealedCredentials.serverUrl;
    $('dualUserValue').textContent = revealedCredentials.username;
    $('dualPasswordValue').textContent = revealedCredentials.password;
    $('dualXtreamExpiry').textContent = 'الانتهاء: ' + dateText(result.expiresAt);
    credentialResult.hidden = false;
    armConceal();
  }
  function showCode(result) {
    revealedCode = String(result.code || '');
    $('dualAppCodeValue').textContent = revealedCode;
    $('dualVoucherExpiry').textContent = 'الانتهاء: ' + dateText(result.expiresAt);
    $('dualVoucherExplanation').textContent = result.created
      ? 'تم إنشاء كود واحد مرتبط بحساب Xtream الحالي، دون اشتراك إضافي أو تجديد.'
      : 'هذا هو الكود الأصلي المرتبط بنفس الحساب، ولم تتغير مدته.';
    voucherResult.hidden = false;
    armConceal();
  }
  function renderAccounts() {
    const query = accountSearch.value.trim().toLocaleLowerCase();
    const previous = accountSelect.value;
    const filtered = accounts.filter(item => {
      const label = [item.username, item.label, item.id].join(' ').toLocaleLowerCase();
      return label.includes(query);
    });
    accountSelect.replaceChildren();
    if (!filtered.length) {
      const option = document.createElement('option');
      option.textContent = query ? 'لا يوجد حساب مطابق' : 'لا توجد حسابات متاحة';
      option.value = '';
      accountSelect.append(option);
    } else {
      const fragment = document.createDocumentFragment();
      for (const item of filtered.slice(0, 60)) {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = String(item.username || 'حساب') + ' — ' +
          String(item.label || 'عميل BLOFY').slice(0, 45) +
          (item.enabled ? '' : ' · موقوف') + ' · ' + dateText(item.expiresAt);
        fragment.append(option);
      }
      accountSelect.append(fragment);
      if (filtered.some(item => item.id === previous)) accountSelect.value = previous;
    }
    $('dualAccountCount').textContent = filtered.length > 60
      ? 'عُرض أول 60 من ' + filtered.length + ' حسابًا. اكتب اسمًا أدق.'
      : 'عدد النتائج: ' + filtered.length;
    accountButton.disabled = !accountSelect.value;
  }
  async function loadAccounts(force = false) {
    if (accountsLoading) return accountsLoading;
    if (!force && loadedAt && now() - loadedAt < 60000) return;
    accountRefresh.disabled = true;
    status(accountStatus, 'جارٍ تحميل حسابات Xtream من السيرفر…');
    accountsLoading = (async () => {
      const data = await request('/api/v1/admin/xtream-gateway');
      accounts = Array.isArray(data.items) ? data.items.filter(item => item && item.id) : [];
      loadedAt = now();
      renderAccounts();
      status(accountStatus, 'اختر الحساب الموجود. لن تتغير بيانات Xtream أو تاريخ الانتهاء.');
    })();
    try {
      return await accountsLoading;
    } catch (error) {
      status(accountStatus, error.message, true);
    } finally {
      accountsLoading = null;
      accountRefresh.disabled = false;
    }
  }
  $('dualCodeForm').addEventListener('submit', async event => {
    event.preventDefault();
    const code = normalizeCode(codeInput.value);
    conceal();
    if (!validCode(code)) {
      status(codeStatus, 'أدخل 8–12 رقمًا أو كودًا قديمًا صالحًا من 24 خانة.', true);
      return;
    }
    if (!window.confirm('استخراج بيانات Xtream لهذا الكود وعرضها مؤقتًا للمشرف فقط؟')) return;
    codeButton.disabled = true;
    status(codeStatus, 'جارٍ التحقق من الكود، دون تغييره أو تجديده…');
    try {
      const result = await request('/api/v1/admin/xtream-gateway/link/code-to-xtream', { code });
      codeInput.value = '';
      showXtream(result);
      status(codeStatus, 'نجح الاستخراج. بيانات نفس الاشتراك معروضة لمدة 90 ثانية فقط.');
    } catch (error) {
      status(codeStatus, error.message, true);
    } finally {
      codeButton.disabled = false;
    }
  });
  $('dualAccountForm').addEventListener('submit', async event => {
    event.preventDefault();
    conceal();
    const accountId = accountSelect.value;
    if (!/^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(accountId)) {
      status(accountStatus, 'اختر حساب Xtream من القائمة أولًا.', true);
      return;
    }
    if (!window.confirm('استخراج الكود الأصلي لهذا الحساب، أو إنشاء كود مرتبط واحد إذا لم يوجد؟ لن يتم تجديد المدة أو تغيير بيانات Xtream.')) return;
    accountButton.disabled = true;
    status(accountStatus, 'جارٍ ربط الكود بنفس الحساب وتاريخ الانتهاء…');
    try {
      const result = await request('/api/v1/admin/xtream-gateway/link/xtream-to-code', { accountId });
      showCode(result);
      status(accountStatus, 'نجحت العملية. الكود معروض مؤقتًا لمدة 90 ثانية.');
    } catch (error) {
      status(accountStatus, error.message, true);
    } finally {
      accountButton.disabled = !accountSelect.value;
    }
  });
  accountSearch.addEventListener('input', renderAccounts);
  accountSearch.addEventListener('focus', () => { void loadAccounts(); }, { once: true });
  accountRefresh.addEventListener('click', () => { void loadAccounts(true); });
  accountSelect.addEventListener('change', () => { accountButton.disabled = !accountSelect.value; });
  $('dualCopyXtream').addEventListener('click', () => {
    if (!revealedCredentials) return;
    const c = revealedCredentials;
    void copy('Host: ' + c.serverUrl + '\nUsername: ' + c.username +
      '\nPassword: ' + c.password, codeStatus, 'تم نسخ بيانات Xtream.');
  });
  $('dualCopyCode').addEventListener('click', () => {
    void copy(revealedCode, accountStatus, 'تم نسخ كود التطبيق.');
  });
  for (const id of ['dualHideXtream', 'dualHideCode']) $(id).addEventListener('click', conceal);
  document.addEventListener('visibilitychange', () => { if (document.hidden) conceal(); });
  window.addEventListener('pagehide', conceal);
  document.querySelectorAll('[data-blofy-dual-shortcut]').forEach(button => {
    button.addEventListener('click', event => {
      event.preventDefault();
      conceal();
      const accountsMode = document.querySelector('.console-workspace-nav [data-workspace-mode="accounts"]');
      accountsMode?.click();
      document.querySelector('.tab[data-tab="xtream"]')?.click();
      window.setTimeout(() => {
        if (root.closest('.tab-page')?.hidden) return;
        root.scrollIntoView({ behavior: 'smooth', block: 'start' });
        codeInput.focus({ preventScroll: true });
      }, 350);
    });
  });
  document.querySelectorAll('[data-sidebar-tab], .tab[data-tab]').forEach(button => {
    button.addEventListener('click', event => {
      if (!event.currentTarget.hasAttribute('data-blofy-dual-shortcut')) conceal();
    });
  });
  // Deep link from BLOFY ONE to the exact operator workflow.
  // Do not put the subscriber's voucher or password into the URL.
  if (window.location.hash.toLowerCase() === '#dual') {
    window.setTimeout(() => {
      document.querySelector('[data-blofy-dual-shortcut]')?.click();
    }, 0);
  }
})();