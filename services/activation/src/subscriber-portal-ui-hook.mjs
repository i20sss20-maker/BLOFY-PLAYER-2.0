import http from 'node:http';

const PORTAL_PATHS = new Set(['/', '/portal']);
const WHATSAPP_NUMBER = String(process.env.BLOFY_RENEWAL_WHATSAPP || '').replace(/\D/g, '');

export function injectSubscriberPortalUi(html) {
  const source = String(html || '');
  if (source.includes('data-page="home"')) return source;
  if (!source.includes('</body>') || source.includes('data-blofy-subscriber-ui="3"')) return source;

  const whatsappNumber = JSON.stringify(WHATSAPP_NUMBER);
  const injection = String.raw`
<style data-blofy-subscriber-ui="3">
  .editor-card{border-radius:22px!important;border-color:rgba(177,108,255,.20)!important;box-shadow:0 26px 70px rgba(0,0,0,.34)!important;background:linear-gradient(155deg,rgba(24,19,36,.96),rgba(10,8,16,.97))!important}
  .editor-card .form-grid{gap:14px 16px!important}
  .editor-card .field{margin-top:10px!important}
  .editor-card .field label{margin-bottom:7px!important;font-size:12.5px!important;color:#d8d2df!important}
  .editor-card input,.editor-card select{height:50px!important;border-radius:13px!important;border-color:rgba(184,140,255,.16)!important;background:#0b0911!important;box-shadow:none!important}
  .editor-card input:focus,.editor-card select:focus{border-color:#9a4fff!important;box-shadow:0 0 0 3px rgba(139,55,255,.12)!important;background:#0e0b16!important}
  #blofySubscriberHint{grid-column:1/-1!important;border-radius:12px!important;margin-top:2px!important;padding:10px 12px!important;background:rgba(139,55,255,.075)!important;border:1px solid rgba(177,108,255,.24)!important;color:#d9c4ff!important;line-height:1.65!important}
  #saveBtn{border-radius:14px!important;min-height:52px!important;box-shadow:0 12px 28px rgba(111,35,229,.24)!important}
  #cancelBtn{border-radius:13px!important;min-height:46px!important;background:rgba(255,255,255,.025)!important;border:1px solid rgba(184,140,255,.14)!important;color:#c8c1cf!important}
  #editorStatus{min-height:18px!important;margin-top:8px!important}
  #blofyRenewBtn{min-height:48px;padding:0 18px;border:1px solid rgba(82,223,154,.3);border-radius:15px;background:rgba(82,223,154,.1);color:#9ff1cb;font-weight:800;cursor:pointer}
  #blofyRenewBtn:hover{background:rgba(82,223,154,.16)}
  .blofy-renew-modal{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;padding:18px;background:rgba(0,0,0,.72);backdrop-filter:blur(8px)}
  .blofy-renew-modal.hidden{display:none!important}
  .blofy-renew-card{width:min(470px,100%);padding:24px;border:1px solid rgba(177,108,255,.25);border-radius:24px;background:linear-gradient(155deg,#181324,#0b0911);box-shadow:0 30px 90px rgba(0,0,0,.55)}
  .blofy-renew-card h3{margin:0 0 8px;font-size:24px}.blofy-renew-card p{margin:0 0 18px;color:#aaa4b7;font-size:13px;line-height:1.7}
  .blofy-renew-options{display:grid;grid-template-columns:1fr 1fr;gap:10px}.blofy-renew-option{min-height:54px;border:1px solid rgba(184,140,255,.18);border-radius:14px;background:#100d18;color:#fff;font-weight:800;cursor:pointer}.blofy-renew-option:hover{border-color:#8b37ff;background:#171122}
  .blofy-renew-close{width:100%;min-height:46px;margin-top:12px;border:1px solid rgba(184,140,255,.14);border-radius:13px;background:transparent;color:#c8c1cf;font-weight:800;cursor:pointer}
  @media(max-width:640px){.editor-card{border-radius:19px!important}.editor-card .form-grid{gap:10px!important}.editor-card .field{margin-top:7px!important}.editor-card input,.editor-card select{height:48px!important}#saveBtn{margin-top:16px!important}.blofy-renew-options{grid-template-columns:1fr}}
</style>
<script>
(function () {
  var rememberedDeviceId = '';
  var rememberedActivationCode = '';
  var editingSubscriberId = null;
  var whatsappNumber = ${whatsappNumber};

  function qs(id) { return document.getElementById(id); }
  function fieldWrapper(input) { return input && input.closest ? input.closest('.field') : null; }
  function setHidden(node, hidden) { if (node) node.style.display = hidden ? 'none' : ''; }
  function status(message, bad) {
    var node = qs('editorStatus');
    if (!node) return;
    node.textContent = message || '';
    node.classList.toggle('bad', !!bad);
    node.classList.toggle('good', !bad && !!message);
  }
  function rememberDeviceAuth() {
    var device = qs('deviceId');
    var code = qs('activationCode');
    var deviceId = device && device.value ? device.value.trim() : '';
    var activationCode = code && code.value ? code.value.trim() : '';
    if (deviceId) rememberedDeviceId = deviceId;
    if (activationCode) rememberedActivationCode = activationCode;
    var label = qs('deviceLabel');
    if (label && label.textContent.trim()) rememberedDeviceId = label.textContent.trim();
  }
  function resolvedDeviceAuth() {
    rememberDeviceAuth();
    return { deviceId: rememberedDeviceId, activationCode: rememberedActivationCode };
  }
  function dispatchValue(node, value) {
    if (!node) return;
    node.value = value == null ? '' : String(value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function installAuthCapture() {
    ['deviceId', 'activationCode'].forEach(function (id) {
      var node = qs(id);
      if (!node || node.dataset.blofyAuthCapture) return;
      node.dataset.blofyAuthCapture = '1';
      node.addEventListener('input', rememberDeviceAuth, true);
      node.addEventListener('change', rememberDeviceAuth, true);
    });
    rememberDeviceAuth();
  }
  function isSubscriberPlaylist(item) {
    if (!item || !item.baseUrl) return false;
    try { return new URL(item.baseUrl).pathname.replace(/\/+$/, '') === '/api/v1/subscribers/xtream'; }
    catch (_) { return false; }
  }

  function configureProviderOptions() {
    var select = qs('providerType');
    if (!select) return;
    Array.from(select.options).forEach(function (option) { if (option.value === 'm3u') option.remove(); });
    var xtream = select.querySelector('option[value="xtream"]');
    if (xtream) xtream.textContent = 'Xtream Codes';
    if (!select.querySelector('option[value="blofy"]')) {
      var option = document.createElement('option');
      option.value = 'blofy';
      option.textContent = 'مشتركين BLOFY';
      select.insertBefore(option, select.firstChild);
    }
    if (!qs('blofySubscriberHint')) {
      var hint = document.createElement('div');
      hint.id = 'blofySubscriberHint';
      hint.style.display = 'none';
      hint.textContent = 'أدخل اسم المستخدم وكلمة المرور فقط. عنوان السيرفر محفوظ داخل BLOFY.';
      var grid = select.closest('.form-grid');
      if (grid) grid.appendChild(hint);
    }
  }

  function applyMode() {
    configureProviderOptions();
    var select = qs('providerType');
    if (!select) return;
    var blofy = select.value === 'blofy';
    var base = qs('baseUrl');
    var name = qs('name');
    var user = qs('username');
    var pass = qs('password');
    var hint = qs('blofySubscriberHint');
    setHidden(fieldWrapper(base), blofy);
    [user, pass].forEach(function (input) { var wrapper = fieldWrapper(input); if (wrapper) { setHidden(wrapper, false); wrapper.classList.remove('hidden'); } });
    if (hint) hint.style.display = blofy ? 'block' : 'none';
    if (blofy) {
      if (name && !name.value.trim()) name.value = 'مشتركين BLOFY';
      if (base) base.value = '';
      if (user) { user.placeholder = 'اسم المستخدم'; user.required = true; }
      if (pass) { pass.placeholder = 'كلمة المرور'; pass.required = true; }
    } else {
      editingSubscriberId = null;
      if (user) user.required = true;
      if (pass) pass.required = true;
    }
  }

  function installRenewalUi() {
    var actions = document.querySelector('.dashboard-head .actions');
    if (!actions || qs('blofyRenewBtn')) return;
    var button = document.createElement('button');
    button.id = 'blofyRenewBtn';
    button.type = 'button';
    button.textContent = '↻ تجديد الاشتراك';
    actions.insertBefore(button, actions.firstChild);

    var modal = document.createElement('div');
    modal.id = 'blofyRenewModal';
    modal.className = 'blofy-renew-modal hidden';
    modal.innerHTML = '<div class="blofy-renew-card" role="dialog" aria-modal="true"><h3>تجديد BLOFY PLAYER</h3><p>اختر مدة التجديد وسيتم فتح واتساب برسالة جاهزة تحتوي على رقم جهازك والمدة المطلوبة.</p><div class="blofy-renew-options"><button class="blofy-renew-option" data-plan="3 شهور">3 شهور</button><button class="blofy-renew-option" data-plan="6 شهور">6 شهور</button><button class="blofy-renew-option" data-plan="سنة">سنة</button><button class="blofy-renew-option" data-plan="مدى الحياة">مدى الحياة</button></div><button class="blofy-renew-close" type="button">إلغاء</button></div>';
    document.body.appendChild(modal);

    button.onclick = function () { modal.classList.remove('hidden'); };
    modal.querySelector('.blofy-renew-close').onclick = function () { modal.classList.add('hidden'); };
    modal.addEventListener('click', function (event) { if (event.target === modal) modal.classList.add('hidden'); });
    modal.querySelectorAll('[data-plan]').forEach(function (planButton) {
      planButton.addEventListener('click', function () {
        rememberDeviceAuth();
        var deviceId = rememberedDeviceId || 'غير معروف';
        var plan = planButton.getAttribute('data-plan');
        if (!whatsappNumber) { alert('رقم واتساب التجديد غير مضاف بعد.'); return; }
        var message = 'السلام عليكم، أحتاج تجديد اشتراك BLOFY PLAYER.\n\nرقم جهازي: ' + deviceId + '\nمدة التجديد المطلوبة: ' + plan + '\n\nأرجو تزويدي بطريقة الدفع وتأكيد التجديد.';
        window.open('https://wa.me/' + whatsappNumber + '?text=' + encodeURIComponent(message), '_blank', 'noopener');
      });
    });
  }

  function installFormOverrides() {
    if (window.blofySubscriberOverridesV3) return;
    var originalTypeUi = window.typeUi;
    var originalEdit = window.edit;
    var originalOpenEditor = window.openEditor;
    var originalClearEditor = window.clearEditor;
    if (typeof originalTypeUi !== 'function' || typeof originalEdit !== 'function') return;
    window.blofySubscriberOverridesV3 = true;

    window.typeUi = function () { var node = qs('providerType'); if (!node || node.value === 'xtream') originalTypeUi.apply(this, arguments); applyMode(); };
    var select = qs('providerType');
    if (select) { select.onchange = window.typeUi; select.addEventListener('change', function () { requestAnimationFrame(applyMode); }); }

    if (typeof originalClearEditor === 'function') {
      window.clearEditor = function () { editingSubscriberId = null; originalClearEditor.apply(this, arguments); configureProviderOptions(); var selectNode = qs('providerType'); if (selectNode) selectNode.value = 'xtream'; applyMode(); };
    }
    if (typeof originalOpenEditor === 'function') {
      window.openEditor = function () { editingSubscriberId = null; originalOpenEditor.apply(this, arguments); configureProviderOptions(); applyMode(); };
      var newBtn = qs('newBtn'); if (newBtn) newBtn.onclick = window.openEditor;
    }

    window.edit = function (item) {
      originalEdit.apply(this, arguments);
      configureProviderOptions();
      if (!isSubscriberPlaylist(item)) { editingSubscriberId = null; applyMode(); return; }
      editingSubscriberId = item.id;
      var providerSelect = qs('providerType'); if (providerSelect) providerSelect.value = 'blofy';
      dispatchValue(qs('username'), ''); dispatchValue(qs('password'), ''); dispatchValue(qs('baseUrl'), '');
      applyMode();
      status('اكتب اسم المستخدم وكلمة المرور من جديد لتحديث اشتراك BLOFY.', false);
    };
  }

  async function createSubscriberSession() {
    var deviceAuth = resolvedDeviceAuth();
    var username = (qs('username') && qs('username').value || '').trim();
    var password = (qs('password') && qs('password').value || '');
    if (!username || !password) throw new Error('أدخل اسم المستخدم وكلمة المرور');
    if (!deviceAuth.deviceId || !deviceAuth.activationCode) throw new Error('بيانات الجهاز غير مكتملة. أعد الدخول إلى البوابة.');
    var response = await fetch('/api/v1/subscribers/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceId: deviceAuth.deviceId, activationCode: deviceAuth.activationCode, username: username, password: password }) });
    var payload = {}; try { payload = await response.json(); } catch (_) {}
    if (!response.ok) {
      var code = payload && payload.error;
      if (code === 'invalid_subscriber_credentials') throw new Error('أدخل اسم المستخدم وكلمة المرور');
      if (code === 'subscriber_login_failed') throw new Error('اسم المستخدم أو كلمة المرور غير صحيحة');
      if (code === 'unauthorized_device') throw new Error('الجهاز غير مفعل أو بيانات الربط غير صحيحة');
      if (code === 'subscriber_service_unavailable') throw new Error('خدمة مشتركين BLOFY غير متاحة حاليًا');
      if (code === 'subscriber_upstream_unavailable') throw new Error('سيرفر المشتركين لا يستجيب حاليًا');
      throw new Error('تعذر تسجيل الدخول إلى مشتركين BLOFY');
    }
    if (!payload || !payload.baseUrl || !payload.username || !payload.password) throw new Error('تعذر تجهيز بيانات مشترك BLOFY. حاول مرة أخرى.');
    return payload;
  }

  async function saveSubscriber() {
    var button = qs('saveBtn');
    if (button.dataset.blofyBusy === '1') return;
    button.dataset.blofyBusy = '1'; button.disabled = true; status('جاري التحقق من اشتراك BLOFY…', false);
    try {
      var session = await createSubscriberSession();
      var authData = resolvedDeviceAuth();
      var response = await fetch('/api/v1/portal/playlists', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceId: authData.deviceId, activationCode: authData.activationCode, id: editingSubscriberId || undefined, name: (qs('name') && qs('name').value.trim()) || session.providerName || 'مشتركين BLOFY', providerType: 'xtream', baseUrl: session.baseUrl, username: session.username, password: session.password, active: !qs('active') || qs('active').checked }) });
      var payload = {}; try { payload = await response.json(); } catch (_) {}
      if (!response.ok) throw new Error(payload.error || 'تعذر حفظ اشتراك BLOFY');
      status('تم حفظ اشتراك BLOFY بنجاح.', false); editingSubscriberId = null;
      if (qs('editor')) qs('editor').classList.add('hidden');
      if (typeof window.clearEditor === 'function') window.clearEditor();
      if (typeof window.load === 'function') await window.load(); else window.location.reload();
    } finally { button.disabled = false; button.dataset.blofyBusy = '0'; }
  }

  function installSaveInterceptor() {
    var button = qs('saveBtn'); var select = qs('providerType');
    if (!button || !select || button.dataset.blofySubscriberInterceptorV3) return;
    button.dataset.blofySubscriberInterceptorV3 = '1';
    button.addEventListener('click', async function (event) {
      if (select.value !== 'blofy') return;
      event.preventDefault(); event.stopImmediatePropagation();
      try { await saveSubscriber(); } catch (error) { status(error && error.message ? error.message : 'تعذر الحفظ', true); }
    }, true);
  }

  function install() { installAuthCapture(); configureProviderOptions(); installFormOverrides(); installSaveInterceptor(); installRenewalUi(); applyMode(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
  var observer = new MutationObserver(function () { install(); }); observer.observe(document.documentElement, { childList: true, subtree: true });
})();
</script>`;

  return source.replace('</body>', injection + '\n</body>');
}

const previousCreateServer = http.createServer.bind(http);
http.createServer = function patchedPortalCreateServer(listener) {
  if (typeof listener !== 'function') return previousCreateServer(listener);
  return previousCreateServer(async (req, res) => {
    let pathname = '/';
    try { pathname = new URL(req.url || '/', 'http://localhost').pathname; } catch (_) {}
    if (req.method !== 'GET' || !PORTAL_PATHS.has(pathname)) return listener(req, res);
    const originalWriteHead = res.writeHead.bind(res); const originalEnd = res.end.bind(res);
    let statusCode = 200; let statusMessage; let headers = {}; let wroteHead = false;
    res.writeHead = function interceptedWriteHead(code, messageOrHeaders, maybeHeaders) { statusCode = code; if (typeof messageOrHeaders === 'string') { statusMessage = messageOrHeaders; headers = { ...(maybeHeaders || {}) }; } else headers = { ...(messageOrHeaders || {}) }; wroteHead = true; return res; };
    res.end = function interceptedEnd(chunk, encoding, callback) {
      const body = chunk == null ? '' : Buffer.isBuffer(chunk) ? chunk.toString(encoding || 'utf8') : String(chunk);
      const modified = injectSubscriberPortalUi(body);
      if (wroteHead) { for (const key of Object.keys(headers)) if (key.toLowerCase() === 'content-length') delete headers[key]; headers['content-length'] = Buffer.byteLength(modified); if (statusMessage) originalWriteHead(statusCode, statusMessage, headers); else originalWriteHead(statusCode, headers); }
      return originalEnd(modified, 'utf8', callback);
    };
    return listener(req, res);
  });
};
