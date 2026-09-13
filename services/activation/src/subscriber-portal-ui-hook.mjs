import http from 'node:http';

const PORTAL_PATHS = new Set(['/', '/portal']);

export function injectSubscriberPortalUi(html) {
  const source = String(html || '');
  if (source.includes('data-page="home"')) return source;
  if (!source.includes('</body>') || source.includes('data-blofy-subscriber-ui="1"')) return source;

  const injection = String.raw`
<style data-blofy-subscriber-ui="1">
  .editor-card{border-radius:22px!important;border-color:rgba(177,108,255,.20)!important;box-shadow:0 26px 70px rgba(0,0,0,.34)!important;background:linear-gradient(155deg,rgba(24,19,36,.96),rgba(10,8,16,.97))!important}
  .editor-card .form-grid{gap:14px 16px!important}
  .editor-card .field{margin-top:10px!important}
  .editor-card .field label{margin-bottom:7px!important;font-size:12.5px!important;color:#d8d2df!important}
  .editor-card input,.editor-card select{height:50px!important;border-radius:13px!important;border-color:rgba(184,140,255,.16)!important;background:#0b0911!important;box-shadow:none!important}
  .editor-card input:focus,.editor-card select:focus{border-color:#9a4fff!important;box-shadow:0 0 0 3px rgba(139,55,255,.12)!important;background:#0e0b16!important}
  #blofySubscriberHint{grid-column:1/-1!important;border-radius:12px!important;margin-top:2px!important;padding:10px 12px!important;background:rgba(139,55,255,.075)!important;border-color:rgba(177,108,255,.24)!important}
  #saveBtn{border-radius:14px!important;min-height:52px!important;box-shadow:0 12px 28px rgba(111,35,229,.24)!important}
  #cancelBtn{border-radius:13px!important;min-height:46px!important;background:rgba(255,255,255,.025)!important;border:1px solid rgba(184,140,255,.14)!important;color:#c8c1cf!important}
  #editorStatus{min-height:18px!important;margin-top:8px!important}
  @media(max-width:640px){.editor-card{border-radius:19px!important}.editor-card .form-grid{gap:10px!important}.editor-card .field{margin-top:7px!important}.editor-card input,.editor-card select{height:48px!important}#saveBtn{margin-top:16px!important}}
</style>
<script>
(function () {
  var rememberedDeviceId = '';
  var rememberedActivationCode = '';

  function qs(id) { return document.getElementById(id); }
  function fieldWrapper(input) { return input && input.closest ? input.closest('.field') : null; }
  function setHidden(node, hidden) { if (node) node.style.display = hidden ? 'none' : ''; }
  function status(message, bad) {
    var node = qs('editorStatus');
    if (!node) return;
    node.textContent = message || '';
    node.classList.toggle('bad', !!bad);
  }
  function rememberDeviceAuth() {
    var device = qs('deviceId');
    var code = qs('activationCode');
    var deviceId = device && device.value ? device.value.trim() : '';
    var activationCode = code && code.value ? code.value.trim() : '';
    if (deviceId) rememberedDeviceId = deviceId;
    if (activationCode) rememberedActivationCode = activationCode;
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
  /** A saved subscriber list stores an opaque session token, never the typed credentials. */
  function isSubscriberPlaylist(item) {
    if (!item || !item.baseUrl) return false;
    try { return new URL(item.baseUrl).pathname.replace(/\/+$/, '') === '/api/v1/subscribers/xtream'; }
    catch (_) { return false; }
  }

  function applyMode() {
    var select = qs('providerType');
    if (!select) return;
    var blofy = select.value === 'blofy';
    var base = qs('baseUrl');
    var name = qs('name');
    var user = qs('username');
    var pass = qs('password');
    var hint = qs('blofySubscriberHint');
    setHidden(fieldWrapper(base), blofy);
    if (hint) hint.style.display = blofy ? 'block' : 'none';
    if (!blofy) {
      if (user) user.required = false;
      if (pass) pass.required = false;
      return;
    }
    // The page's own typeUi() hides these for anything that is not "xtream"; a subscriber
    // list needs exactly these two fields, so undo both the class and the inline style.
    [user, pass].forEach(function (input) {
      var wrapper = fieldWrapper(input);
      if (!wrapper) return;
      setHidden(wrapper, false);
      wrapper.classList.remove('hidden');
    });
    if (name && !name.value.trim()) name.value = 'مشتركين BLOFY';
    if (base) base.value = '';
    if (user) { user.placeholder = 'اسم المستخدم'; user.required = true; }
    if (pass) { pass.placeholder = 'كلمة المرور'; pass.required = true; }
  }

  function addSubscriberOption() {
    var select = qs('providerType');
    if (!select || select.querySelector('option[value="blofy"]')) return;
    var option = document.createElement('option');
    option.value = 'blofy';
    option.textContent = 'مشتركين BLOFY';
    option.dataset.blofySubscriber = '1';
    select.insertBefore(option, select.firstChild);

    var badge = document.createElement('div');
    badge.id = 'blofySubscriberHint';
    badge.style.cssText = 'display:none;margin-top:12px;padding:12px 14px;border:1px solid rgba(177,108,255,.35);border-radius:14px;background:rgba(139,55,255,.10);color:#d9c4ff;font-size:13px;line-height:1.65';
    badge.textContent = 'أدخل اسم المستخدم وكلمة المرور فقط. عنوان السيرفر محفوظ داخل BLOFY.';
    var grid = select.closest('.form-grid');
    if (grid) grid.appendChild(badge);

    select.addEventListener('change', function () { requestAnimationFrame(applyMode); });
    applyMode();
  }

  /** The page rebuilds the form through these globals, so the subscriber mode has to
   *  travel with them instead of racing them from a change listener. */
  function installFormOverrides() {
    if (window.blofySubscriberOverrides) return;
    var originalTypeUi = window.typeUi;
    var originalEdit = window.edit;
    if (typeof originalTypeUi !== 'function' || typeof originalEdit !== 'function') return;
    window.blofySubscriberOverrides = true;

    window.typeUi = function () {
      var node = qs('providerType');
      // The original clears username/password whenever the type is not "xtream",
      // which would wipe what the subscriber was in the middle of typing.
      if (!node || node.value !== 'blofy') originalTypeUi.apply(this, arguments);
      applyMode();
    };
    // The select captured the original function by reference when the page wired it up,
    // so the override only reaches it by re-pointing the handler.
    var select = qs('providerType');
    if (select) select.onchange = window.typeUi;

    window.edit = function (item) {
      originalEdit.apply(this, arguments);
      if (!isSubscriberPlaylist(item)) return;
      var select = qs('providerType');
      if (select) select.value = 'blofy';
      // What is stored is a session token, not the subscriber's own credentials:
      // showing it would print an unreadable blob into the username box.
      dispatchValue(qs('username'), '');
      dispatchValue(qs('password'), '');
      applyMode();
      status('اكتب اسم المستخدم وكلمة المرور من جديد لتحديث الاشتراك.', false);
    };
  }

  async function createSubscriberSession() {
    var deviceAuth = resolvedDeviceAuth();
    var deviceId = deviceAuth.deviceId;
    var activationCode = deviceAuth.activationCode;
    var username = (qs('username') && qs('username').value || '').trim();
    var password = (qs('password') && qs('password').value || '');
    if (!username || !password) throw new Error('أدخل اسم المستخدم وكلمة المرور');
    if (!deviceId || !activationCode) throw new Error('بيانات الجهاز غير مكتملة. ارجع لصفحة الربط ثم ادخل مرة أخرى.');

    var response = await fetch('/api/v1/subscribers/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId, activationCode: activationCode, username: username, password: password })
    });
    var payload = {};
    try { payload = await response.json(); } catch (_) {}
    if (!response.ok) {
      var code = payload && payload.error;
      if (code === 'invalid_subscriber_credentials') throw new Error('أدخل اسم المستخدم وكلمة المرور');
      if (code === 'subscriber_login_failed') throw new Error('اسم المستخدم أو كلمة المرور غير صحيحة');
      if (code === 'unauthorized_device') throw new Error('الجهاز غير مفعل أو بيانات الربط غير صحيحة');
      if (code === 'subscriber_service_unavailable') throw new Error('خدمة مشتركين BLOFY تحتاج تفعيل إعدادات السيرفر');
      if (code === 'subscriber_upstream_unavailable') throw new Error('سيرفر المشتركين لا يستجيب حاليًا');
      throw new Error('تعذر تسجيل الدخول إلى مشتركين BLOFY');
    }
    if (!payload || !payload.providerId || !payload.baseUrl || !payload.username || !payload.password) {
      throw new Error('تعذر تجهيز بيانات مشترك BLOFY. حاول مرة أخرى.');
    }
    return payload;
  }

  function installSaveInterceptor() {
    var button = qs('saveBtn');
    var select = qs('providerType');
    if (!button || !select || button.dataset.blofySubscriberInterceptor) return;
    button.dataset.blofySubscriberInterceptor = '1';
    button.addEventListener('click', async function (event) {
      if (select.value !== 'blofy') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (button.dataset.blofyBusy === '1') return;
      button.dataset.blofyBusy = '1';
      button.disabled = true;
      status('جاري التحقق من اشتراك BLOFY…', false);
      try {
        var session = await createSubscriberSession();
        dispatchValue(qs('name'), session.providerName || 'مشتركين BLOFY');
        dispatchValue(qs('baseUrl'), session.baseUrl);
        dispatchValue(qs('username'), session.username);
        dispatchValue(qs('password'), session.password);
        select.value = 'xtream';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        status('تم التحقق. جاري حفظ القائمة على جهازك…', false);
        button.disabled = false;
        button.dataset.blofyBusy = '0';
        button.click();
      } catch (error) {
        button.disabled = false;
        button.dataset.blofyBusy = '0';
        status(error && error.message ? error.message : 'تعذر تسجيل الدخول', true);
      }
    }, true);
  }

  function install() {
    installAuthCapture();
    addSubscriberOption();
    installFormOverrides();
    installSaveInterceptor();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
  var observer = new MutationObserver(function () { install(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
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

    const originalWriteHead = res.writeHead.bind(res);
    const originalEnd = res.end.bind(res);
    let statusCode = 200;
    let statusMessage;
    let headers = {};
    let wroteHead = false;

    res.writeHead = function interceptedWriteHead(code, messageOrHeaders, maybeHeaders) {
      statusCode = code;
      if (typeof messageOrHeaders === 'string') { statusMessage = messageOrHeaders; headers = { ...(maybeHeaders || {}) }; }
      else headers = { ...(messageOrHeaders || {}) };
      wroteHead = true;
      return res;
    };

    res.end = function interceptedEnd(chunk, encoding, callback) {
      const body = chunk == null ? '' : Buffer.isBuffer(chunk) ? chunk.toString(encoding || 'utf8') : String(chunk);
      const modified = injectSubscriberPortalUi(body);
      if (wroteHead) {
        for (const key of Object.keys(headers)) if (key.toLowerCase() === 'content-length') delete headers[key];
        headers['content-length'] = Buffer.byteLength(modified);
        if (statusMessage) originalWriteHead(statusCode, statusMessage, headers); else originalWriteHead(statusCode, headers);
      }
      return originalEnd(modified, 'utf8', callback);
    };
    return listener(req, res);
  });
};
