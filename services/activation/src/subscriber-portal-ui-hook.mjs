import http from 'node:http';

const PORTAL_PATHS = new Set(['/', '/portal']);

export function injectSubscriberPortalUi(html) {
  const source = String(html || '');
  if (!source.includes('</body>') || source.includes('data-blofy-subscriber-ui="1"')) return source;

  const injection = String.raw`
<script data-blofy-subscriber-ui="1">
(function () {
  function qs(id) { return document.getElementById(id); }
  function fieldWrapper(input) { return input && input.closest ? input.closest('.field') : null; }
  function setHidden(node, hidden) { if (node) node.style.display = hidden ? 'none' : ''; }
  function status(message, bad) {
    var node = qs('editorStatus');
    if (!node) return;
    node.textContent = message || '';
    node.classList.toggle('bad', !!bad);
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
    badge.textContent = 'دخول BLOFY الخاص: أدخل اسم المستخدم وكلمة المرور فقط. عنوان السيرفر محفوظ داخل BLOFY ولا يظهر في الموقع أو التطبيق.';
    var grid = select.closest('.form-grid');
    if (grid) grid.appendChild(badge);

    function applyMode() {
      var blofy = select.value === 'blofy';
      var base = qs('baseUrl');
      var name = qs('name');
      var hint = qs('blofySubscriberHint');
      setHidden(fieldWrapper(base), blofy);
      if (hint) hint.style.display = blofy ? 'block' : 'none';
      if (blofy) {
        if (name) name.value = 'مشتركين BLOFY';
        if (base) base.value = '';
        var user = qs('username');
        var pass = qs('password');
        if (user) user.placeholder = 'اسم المستخدم';
        if (pass) pass.placeholder = 'كلمة المرور';
        status('أدخل بيانات اشتراك BLOFY فقط ثم اضغط حفظ.', false);
      }
    }
    select.addEventListener('change', applyMode);
    applyMode();
  }

  async function createSubscriberSession() {
    var deviceId = (qs('deviceId') && qs('deviceId').value || '').trim();
    var activationCode = (qs('activationCode') && qs('activationCode').value || '').trim();
    var username = (qs('username') && qs('username').value || '').trim();
    var password = (qs('password') && qs('password').value || '');
    if (!username || !password) throw new Error('أدخل اسم المستخدم وكلمة المرور');
    if (!deviceId || !activationCode) throw new Error('بيانات الجهاز غير مكتملة');

    var response = await fetch('/api/v1/subscribers/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId, activationCode: activationCode, username: username, password: password })
    });
    var payload = {};
    try { payload = await response.json(); } catch (_) {}
    if (!response.ok) {
      var code = payload && payload.error;
      if (code === 'subscriber_login_failed') throw new Error('اسم المستخدم أو كلمة المرور غير صحيحة');
      if (code === 'unauthorized_device') throw new Error('الجهاز غير مفعل أو بيانات الربط غير صحيحة');
      if (code === 'subscriber_service_unavailable') throw new Error('خدمة مشتركين BLOFY غير متاحة حاليًا');
      if (code === 'subscriber_upstream_unavailable') throw new Error('تعذر الاتصال بخدمة المشتركين');
      throw new Error('تعذر تسجيل الدخول إلى مشتركين BLOFY');
    }
    if (!payload.baseUrl || !payload.username || !payload.password) throw new Error('استجابة BLOFY غير مكتملة');
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
        var name = qs('name');
        var base = qs('baseUrl');
        var user = qs('username');
        var pass = qs('password');
        if (name) name.value = session.providerName || 'مشتركين BLOFY';
        if (base) base.value = session.baseUrl;
        if (user) user.value = session.username;
        if (pass) pass.value = session.password;
        select.value = 'xtream';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        status('تم التحقق. جاري حفظ مشتركين BLOFY على جهازك…', false);
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
    addSubscriberOption();
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
      if (typeof messageOrHeaders === 'string') {
        statusMessage = messageOrHeaders;
        headers = { ...(maybeHeaders || {}) };
      } else {
        headers = { ...(messageOrHeaders || {}) };
      }
      wroteHead = true;
      return res;
    };

    res.end = function interceptedEnd(chunk, encoding, callback) {
      const body = chunk == null ? '' : Buffer.isBuffer(chunk) ? chunk.toString(encoding || 'utf8') : String(chunk);
      const modified = injectSubscriberPortalUi(body);
      if (wroteHead) {
        for (const key of Object.keys(headers)) {
          if (key.toLowerCase() === 'content-length') delete headers[key];
        }
        headers['content-length'] = Buffer.byteLength(modified);
        if (statusMessage) originalWriteHead(statusCode, statusMessage, headers);
        else originalWriteHead(statusCode, headers);
      }
      return originalEnd(modified, 'utf8', callback);
    };

    return listener(req, res);
  });
};
