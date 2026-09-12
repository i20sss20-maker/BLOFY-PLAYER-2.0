import http from 'node:http';

const PORTAL_PATHS = new Set(['/', '/portal']);
const WHATSAPP_NUMBER = String(process.env.BLOFY_RENEWAL_WHATSAPP || '').replace(/\D/g, '');

export function injectSubscriberPortalUi(html) {
  const source = String(html || '');
  if (!source.includes('</body>') || source.includes('data-blofy-subscriber-ui="5"')) return source;

  const whatsappNumber = JSON.stringify(WHATSAPP_NUMBER);
  const injection = String.raw`
<style data-blofy-subscriber-ui="5">
  #blofySubscriberHint{grid-column:1/-1!important;border-radius:13px!important;margin-top:2px!important;padding:11px 13px!important;background:rgba(139,55,255,.09)!important;border:1px solid var(--line-accent,rgba(164,97,255,.34))!important;color:#d9c4ff!important;line-height:1.65!important}
  #blofyRenewBtn{min-height:48px;padding:0 18px;border:1px solid rgba(82,223,154,.30);border-radius:15px;background:rgba(82,223,154,.10);color:#9ff1cb;font-weight:800;cursor:pointer}
  #blofyRenewBtn:hover{background:rgba(82,223,154,.16)}
  .blofy-renew-modal{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;padding:18px;background:rgba(0,0,0,.72);backdrop-filter:blur(8px)}
  .blofy-renew-modal.hidden{display:none!important}
  .blofy-renew-card{width:min(470px,100%);padding:24px;border:1px solid var(--line-accent,rgba(164,97,255,.34));border-radius:24px;background:linear-gradient(155deg,rgba(27,22,42,.98),rgba(12,10,19,.98));box-shadow:0 30px 90px rgba(0,0,0,.55)}
  .blofy-renew-card h3{margin:0 0 8px;font-size:24px}.blofy-renew-card p{margin:0 0 18px;color:var(--muted,#aaa4b7);font-size:13px;line-height:1.7}
  .blofy-renew-options{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .blofy-renew-option{min-height:62px;border:1px solid var(--line,rgba(184,140,255,.19));border-radius:14px;background:#100d18;color:#fff;font-weight:800;cursor:pointer;display:grid;place-items:center;gap:3px}
  .blofy-renew-option:hover{border-color:var(--accent,#8b37ff);background:#171122}.blofy-renew-option small{color:#9ff1cb;font-size:12px;font-weight:900}
  .blofy-renew-close{width:100%;min-height:46px;margin-top:12px;border:1px solid var(--line,rgba(184,140,255,.19));border-radius:13px;background:transparent;color:#c8c1cf;font-weight:800;cursor:pointer}
  @media(max-width:640px){.blofy-renew-options{grid-template-columns:1fr}.dashboard-head .actions{gap:8px}#blofyRenewBtn{flex:1}}
</style>
<script>
(function () {
  var editingSubscriberId = null;
  var whatsappNumber = ${whatsappNumber};

  function qs(id) { return document.getElementById(id); }
  function fieldWrapper(input) { return input && input.closest ? input.closest('.field') : null; }
  function setHidden(node, hidden) {
    if (!node) return;
    node.classList.toggle('hidden', hidden);
    node.style.display = hidden ? 'none' : '';
  }
  function status(message, bad) {
    var node = qs('editorStatus');
    if (!node) return;
    node.textContent = message || '';
    node.classList.toggle('bad', !!bad);
    node.classList.toggle('good', !bad && !!message);
  }
  function deviceAuth() {
    var state = typeof auth !== 'undefined' && auth;
    return {
      deviceId: String(state && state.deviceId || '').trim(),
      activationCode: String(state && state.activationCode || '').trim()
    };
  }
  function isSubscriberPlaylist(item) {
    if (!item || !item.baseUrl) return false;
    try { return new URL(item.baseUrl).pathname.replace(/\/+$/, '') === '/api/v1/subscribers/xtream'; }
    catch (_) { return false; }
  }
  function installOptionalName() {
    var input = qs('name');
    if (!input || input.dataset.blofyOptionalName === '1') return;
    input.dataset.blofyOptionalName = '1';
    input.required = false;
    var labels = {
      ar: 'اسم القائمة (اختياري)', en: 'Playlist name (optional)', fr: 'Nom de la playlist (facultatif)',
      es: 'Nombre de la lista (opcional)', pt: 'Nome da playlist (opcional)', de: 'Playlist-Name (optional)',
      it: 'Nome della playlist (facoltativo)', tr: 'Oynatma listesi adı (isteğe bağlı)', nl: 'Naam van afspeellijst (optioneel)',
      ru: 'Название плейлиста (необязательно)', fa: 'نام فهرست (اختیاری)', ur: 'پلے لسٹ کا نام (اختیاری)',
      hi: 'प्लेलिस्ट का नाम (वैकल्पिक)', id: 'Nama daftar putar (opsional)', zh: '播放列表名称（可选）'
    };
    if (typeof translations !== 'undefined') Object.keys(labels).forEach(function (code) { if (translations[code]) translations[code].playlistNameLabel = labels[code]; });
    var label = input.labels && input.labels[0];
    if (label) label.textContent = typeof t === 'function' ? t('playlistNameLabel') : labels.ar;
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
      hint.className = 'full';
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
    var user = qs('username');
    var pass = qs('password');
    var hint = qs('blofySubscriberHint');
    setHidden(fieldWrapper(base), blofy);
    setHidden(fieldWrapper(user), false);
    setHidden(fieldWrapper(pass), false);
    if (hint) hint.style.display = blofy ? 'block' : 'none';
    if (blofy) {
      if (base) { base.value = ''; base.setCustomValidity(''); }
      if (user) { user.placeholder = 'اسم المستخدم'; user.required = true; }
      if (pass) { pass.placeholder = 'كلمة المرور'; pass.required = true; }
      status('أدخل اسم المستخدم وكلمة المرور فقط ثم اضغط حفظ.', false);
    } else {
      editingSubscriberId = null;
      if (user) user.required = true;
      if (pass) pass.required = true;
    }
  }
  function installFormOverrides() {
    if (window.blofySubscriberOverridesV5) return;
    var originalTypeUi = typeof typeUi === 'function' ? typeUi : null;
    var originalEdit = typeof edit === 'function' ? edit : null;
    var originalClearEditor = typeof clearEditor === 'function' ? clearEditor : null;
    var originalOpenEditor = typeof openEditor === 'function' ? openEditor : null;
    if (!originalTypeUi || !originalEdit) return;
    window.blofySubscriberOverridesV5 = true;

    typeUi = function () {
      var select = qs('providerType');
      if (!select || select.value === 'xtream') originalTypeUi.apply(this, arguments);
      applyMode();
    };
    var select = qs('providerType');
    if (select) select.onchange = typeUi;

    if (originalClearEditor) clearEditor = function () {
      editingSubscriberId = null;
      originalClearEditor.apply(this, arguments);
      configureProviderOptions();
      if (qs('providerType')) qs('providerType').value = 'xtream';
      applyMode();
    };
    if (originalOpenEditor) {
      openEditor = function () {
        editingSubscriberId = null;
        originalOpenEditor.apply(this, arguments);
        configureProviderOptions();
        applyMode();
      };
      if (qs('newBtn')) qs('newBtn').onclick = openEditor;
    }
    edit = function (item) {
      originalEdit.apply(this, arguments);
      configureProviderOptions();
      if (!isSubscriberPlaylist(item)) { editingSubscriberId = null; applyMode(); return; }
      editingSubscriberId = item.id;
      if (qs('providerType')) qs('providerType').value = 'blofy';
      if (qs('baseUrl')) qs('baseUrl').value = '';
      if (qs('username')) qs('username').value = '';
      if (qs('password')) qs('password').value = '';
      applyMode();
      status('اكتب اسم المستخدم وكلمة المرور من جديد لتحديث اشتراك BLOFY.', false);
    };
  }
  async function createSubscriberSession() {
    var state = deviceAuth();
    var username = String(qs('username') && qs('username').value || '').trim();
    var password = String(qs('password') && qs('password').value || '');
    if (!username || !password) throw new Error('أدخل اسم المستخدم وكلمة المرور');
    if (!state.deviceId || !state.activationCode) throw new Error('بيانات الجهاز غير مكتملة. أعد الدخول إلى البوابة.');
    var response = await fetch('/api/v1/subscribers/session', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: state.deviceId, activationCode: state.activationCode, username: username, password: password })
    });
    var payload = {};
    try { payload = await response.json(); } catch (_) {}
    if (!response.ok) {
      var code = payload && payload.error;
      if (code === 'subscriber_login_failed') throw new Error('اسم المستخدم أو كلمة المرور غير صحيحة');
      if (code === 'unauthorized_device') throw new Error('الجهاز غير مفعل أو بيانات الربط غير صحيحة');
      if (code === 'subscriber_service_unavailable') throw new Error('خدمة مشتركين BLOFY غير متاحة حاليًا');
      if (code === 'subscriber_upstream_unavailable') throw new Error('سيرفر المشتركين لا يستجيب حاليًا');
      throw new Error('تعذر تسجيل الدخول إلى مشتركين BLOFY');
    }
    if (!payload.baseUrl || !payload.username || !payload.password) throw new Error('تعذر تجهيز بيانات مشترك BLOFY. حاول مرة أخرى.');
    return payload;
  }
  async function saveSubscriber() {
    var button = qs('saveBtn');
    if (!button || button.dataset.blofyBusy === '1') return;
    button.dataset.blofyBusy = '1';
    button.disabled = true;
    status('جاري التحقق من اشتراك BLOFY…', false);
    try {
      var session = await createSubscriberSession();
      var state = deviceAuth();
      var response = await fetch('/api/v1/portal/playlists', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          deviceId: state.deviceId, activationCode: state.activationCode,
          id: editingSubscriberId || undefined,
          name: String(qs('name') && qs('name').value || '').trim() || session.providerName || 'مشتركين BLOFY',
          providerType: 'xtream', baseUrl: session.baseUrl, username: session.username, password: session.password,
          active: !qs('active') || qs('active').checked
        })
      });
      var payload = {};
      try { payload = await response.json(); } catch (_) {}
      if (!response.ok) throw new Error(payload.error || 'تعذر حفظ اشتراك BLOFY');
      status('تم حفظ اشتراك BLOFY بنجاح.', false);
      editingSubscriberId = null;
      if (qs('editor')) qs('editor').classList.add('hidden');
      if (typeof clearEditor === 'function') clearEditor();
      if (typeof load === 'function') await load();
    } finally {
      button.disabled = false;
      button.dataset.blofyBusy = '0';
    }
  }
  function installSaveInterceptor() {
    var button = qs('saveBtn');
    var select = qs('providerType');
    if (!button || !select || button.dataset.blofySubscriberInterceptorV5) return;
    button.dataset.blofySubscriberInterceptorV5 = '1';
    button.addEventListener('click', async function (event) {
      if (select.value !== 'blofy') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      try { await saveSubscriber(); }
      catch (error) { status(error && error.message ? error.message : 'تعذر الحفظ', true); }
    }, true);
  }
  function installRenewalUi() {
    var actions = document.querySelector('.dashboard-head .actions');
    if (!actions || qs('blofyRenewBtn')) return;
    var button = document.createElement('button');
    button.id = 'blofyRenewBtn'; button.type = 'button'; button.textContent = '↻ تجديد الاشتراك';
    actions.insertBefore(button, actions.firstChild);
    var modal = document.createElement('div');
    modal.id = 'blofyRenewModal'; modal.className = 'blofy-renew-modal hidden';
    modal.innerHTML = '<div class="blofy-renew-card" role="dialog" aria-modal="true"><h3>تجديد BLOFY PLAYER</h3><p>اختر مدة التجديد وسيتم فتح واتساب برسالة جاهزة تحتوي على رقم جهازك والمدة والسعر.</p><div class="blofy-renew-options"><button class="blofy-renew-option" data-plan="3 شهور" data-price="10 ريال"><span>3 شهور</span><small>10 ريال</small></button><button class="blofy-renew-option" data-plan="6 شهور" data-price="18 ريال"><span>6 شهور</span><small>18 ريال</small></button><button class="blofy-renew-option" data-plan="سنة" data-price="25 ريال"><span>سنة</span><small>25 ريال</small></button><button class="blofy-renew-option" data-plan="مدى الحياة" data-price="40 ريال"><span>مدى الحياة</span><small>40 ريال</small></button></div><button class="blofy-renew-close" type="button">إلغاء</button></div>';
    document.body.appendChild(modal);
    button.onclick = function () { modal.classList.remove('hidden'); };
    modal.querySelector('.blofy-renew-close').onclick = function () { modal.classList.add('hidden'); };
    modal.addEventListener('click', function (event) { if (event.target === modal) modal.classList.add('hidden'); });
    modal.querySelectorAll('[data-plan]').forEach(function (planButton) {
      planButton.addEventListener('click', function () {
        var state = deviceAuth();
        var deviceId = state.deviceId || String(qs('deviceLabel') && qs('deviceLabel').textContent || '').trim() || 'غير معروف';
        var plan = planButton.getAttribute('data-plan');
        var price = planButton.getAttribute('data-price');
        if (!whatsappNumber) { alert('رقم واتساب التجديد غير مضاف بعد.'); return; }
        var message = 'السلام عليكم، أحتاج تجديد اشتراك BLOFY PLAYER.\n\nرقم جهازي: ' + deviceId + '\nمدة التجديد المطلوبة: ' + plan + '\nالسعر: ' + price + '\n\nأرجو تأكيد التجديد.';
        window.open('https://wa.me/' + whatsappNumber + '?text=' + encodeURIComponent(message), '_blank', 'noopener');
      });
    });
  }
  function install() {
    installOptionalName();
    configureProviderOptions();
    installFormOverrides();
    installSaveInterceptor();
    installRenewalUi();
    applyMode();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
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
