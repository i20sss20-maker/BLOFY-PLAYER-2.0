/* BLOFY ONE: exact-code, owner-only legacy/current STREAM voucher lookup.
 * Works with original 24-hex and 8–12 digit codes already registered in the
 * current BLOFY STREAM ledger. Never starts a subscription or rotates secrets.
 */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const form = $('one-legacy-lookup-form');
  if (!form) return;
  const input = $('one-legacy-code');
  const lookupButton = $('one-legacy-lookup-btn');
  const extractButton = $('one-legacy-extract-btn');
  const stateBox = $('one-legacy-status');
  const info = $('one-legacy-info');
  const secretsBox = $('one-legacy-credentials');
  const fields = ['one-legacy-host', 'one-legacy-user', 'one-legacy-password'];
  let exactCode = null;
  let details = null;
  let credentials = null;
  let hideTimer = null;
  let serial = 0;

  const normalize = value => String(value ?? '').trim().toUpperCase()
    .replace(/[٠-٩]/g, x => String(x.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, x => String(x.charCodeAt(0) - 0x6f0))
    .replace(/[\s-]+/g, '');
  const isValid = value => /^(?:[0-9]{8,12}|[A-F0-9]{24})$/.test(value);
  const date = value => {
    if (!value) return 'غير محدد';
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) && ms > 0 ?
      new Date(ms).toLocaleDateString('ar-SA', { day:'numeric', month:'long', year:'numeric' }) :
      'غير معروف';
  };
  function setStatus(message, error = false) {
    stateBox.textContent = message;
    stateBox.classList.toggle('is-error', error);
  }
  function hideCredentials() {
    window.clearTimeout(hideTimer);
    hideTimer = null;
    credentials = null;
    secretsBox.hidden = true;
    fields.forEach(id => { $(id).textContent = ''; });
  }
  function clearState() {
    serial++;
    exactCode = null;
    details = null;
    info.hidden = true;
    extractButton.disabled = true;
    hideCredentials();
  }
  async function request(path, code) {
    const ctl = new AbortController();
    const timer = window.setTimeout(() => ctl.abort(), 14000);
    try {
      const response = await fetch(path, {
        method:'POST',credentials:'same-origin',cache:'no-store',
        headers:{accept:'application/json','content-type':'application/json'},
        body:JSON.stringify({code}),signal:ctl.signal
      });
      if (response.status === 401) throw Error('انتهت جلسة المشرف؛ سجّل الدخول من /admin.');
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok !== true) {
        const reasons = {
          stream_code_not_found:'الكود غير موجود في سجلات BLOFY STREAM. تأكد أنه ليس كود PLAYER أو رمز اقتران.',
          stream_link_code_not_found:'الكود القديم غير مسجّل في BLOFY STREAM الحالي.',
          stream_link_activate_first:'الكود لم يُفعّل بعد؛ لا يوجد حساب Xtream لاستخراجه.',
          stream_link_account_expired:'انتهت صلاحية حساب Xtream المرتبط.',
          stream_link_code_expired:'انتهت صلاحية الكود.',
          stream_link_code_revoked:'الكود ملغى.',
          stream_link_account_unavailable:'حساب Xtream غير متاح أو موقوف.',
          stream_link_credentials_unavailable:'كلمة مرور Xtream القديمة ليست محفوظة بشكل قابل للاسترجاع؛ لا يمكن استخراجها دون تغيير بيانات الدخول.',
          stream_link_saleh_source_only:'الكود مرتبط بمصدر مختلف عن مصدر صالح المعتمد.',
          stream_link_origin_invalid:'إعدادات Host غير صالحة حاليًا.',
          stream_code_invalid:'صيغة الكود غير صحيحة.'
        };
        throw Error(reasons[data.error || data.code] ||
          (response.status===429?'محاولات كثيرة، حاول لاحقًا.':'تعذر إتمام العملية (HTTP '+response.status+').'));
      }
      return data;
    } catch(e) {
      if (e.name==='AbortError') throw Error('انتهت مهلة الاتصال بالسيرفر.');
      throw e;
    } finally {
      window.clearTimeout(timer);
    }
  }
  function showStatus(record, code) {
    const sub = record.subscription || {};
    const item = record.item || {};
    const activated = sub.redeemed === true;
    const active = sub.active === true;
    const label = item.status === 'revoked' ? 'ملغى' :
      !activated ? 'غير مفعّل' : active ? 'نشط' :
      sub.expired ? 'منتهي' : !sub.accountEnabled ? 'الحساب موقوف' : 'يحتاج مراجعة';
    $('one-legacy-kind').textContent = /^[A-F0-9]{24}$/.test(code) ?
      'قديم · 24 خانة' : 'رقمي · 8–12 رقمًا';
    $('one-legacy-state').textContent = label;
    $('one-legacy-expiry').textContent = date(sub.expiresAt);
    $('one-legacy-linked').textContent = sub.accountExists === true ? 'نعم' : 'لا';
    $('one-legacy-hint').textContent = String(item.codeHint || '—').slice(0,42);
    info.hidden = false;
    extractButton.disabled = !active;
    setStatus(active ?
      'الكود موجود ونشط ومرتبط بحساب Xtream. يمكنك استخراج بيانات نفس الحساب دون تغيير المدة.' :
      !activated ? 'الكود محفوظ لكنه لم يُستخدم بعد. استخراج Xtream لا يبدأ الاشتراك نيابةً عن العميل.' :
      'لا يمكن استخراج بيانات Xtream لهذا الكود حاليًا. راجع الحالة أعلاه.',
      !active);
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const code = normalize(input.value);
    clearState();
    if (!isValid(code)) {
      setStatus('أدخل 8–12 رقمًا أو الكود القديم الكامل المكوّن من 24 خانة Hex. رمز الاقتران (6 أرقام) غير مدعوم.', true);
      return;
    }
    lookupButton.disabled = true;
    setStatus('جارٍ البحث عن الكود في قاعدة BLOFY STREAM دون تفعيله أو تجديده…');
    const version = serial;
    try {
      const record = await request('/api/v1/admin/xtream-gateway/codes/lookup', code);
      if (version !== serial) return;
      exactCode = code;
      details = record;
      showStatus(record, code);
    } catch(e) {
      if (version === serial) setStatus(e.message, true);
    } finally {
      lookupButton.disabled = false;
    }
  });
  input.addEventListener('input', () => {
    clearState();
    setStatus('افحص الكود كاملًا أولًا قبل استخراج بيانات Xtream.');
  });
  extractButton.addEventListener('click', async () => {
    if (!details?.subscription?.active || !exactCode || !isValid(exactCode)) return;
    if (!window.confirm('إظهار بيانات Xtream لنفس اشتراك العميل؟ يجب التحقق من صاحب الاشتراك قبل تسليم Host وUsername وPassword.')) return;
    hideCredentials();
    extractButton.disabled = true;
    setStatus('جارٍ استرجاع بيانات الحساب المفعّل؛ لا ننشئ اشتراكًا جديدًا…');
    const code = exactCode,version = serial;
    try {
      const result = await request('/api/v1/admin/xtream-gateway/link/code-to-xtream',code);
      if (serial !== version) return;
      const c = result.credentials || {};
      if (!c.serverUrl || !c.username || !c.password || result.created !== false ||
          result.subscriptionUnchanged !== true) throw Error('رد غير مكتمل من السيرفر، لم تعرض أي بيانات.');
      credentials = { serverUrl:String(c.serverUrl),username:String(c.username),password:String(c.password) };
      $('one-legacy-host').textContent = credentials.serverUrl;
      $('one-legacy-user').textContent = credentials.username;
      $('one-legacy-password').textContent = credentials.password;
      secretsBox.hidden = false;
      // The code cannot be reused after credential reveal until revalidated.
      exactCode = null;
      input.value = '';
      info.hidden = true;
      setStatus('تم استخراج Xtream من نفس الاشتراك. أخفِ البيانات بعد نسخها أو عند الانتهاء.');
      hideTimer = window.setTimeout(hideCredentials, 90000);
    } catch(e) {
      if (serial===version) setStatus(e.message,true);
    } finally {
      extractButton.disabled = !details?.subscription?.active || !exactCode;
    }
  });
  $('one-legacy-copy').addEventListener('click', async () => {
    if (!credentials) return;
    try {
      await navigator.clipboard.writeText('Host: '+credentials.serverUrl+'\nUsername: '+
        credentials.username+'\nPassword: '+credentials.password);
      setStatus('تم نسخ بيانات Xtream. تُخفى البيانات المعروضة تلقائيًا.');
    } catch {
      setStatus('تعذر النسخ تلقائيًا. انسخ القيم مباشرة من الحقول.',true);
    }
  });
  $('one-legacy-hide').addEventListener('click', hideCredentials);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hideCredentials();
      clearState();
      input.value='';
    }
  });
  window.addEventListener('pagehide', () => {
    hideCredentials();
    clearState();
    input.value='';
  });
})();
