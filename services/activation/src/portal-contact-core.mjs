const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const EASTERN_ARABIC = '۰۱۲۳۴۵۶۷۸۹';

function asciiDigits(value) {
  return String(value || '')
    .replace(/[٠-٩]/g, digit => String(ARABIC_INDIC.indexOf(digit)))
    .replace(/[۰-۹]/g, digit => String(EASTERN_ARABIC.indexOf(digit)));
}

export function normalizePortalPhone(value) {
  let phone = asciiDigits(value).trim();
  if (!phone) return null;
  phone = phone.replace(/[\s().-]+/g, '');
  if (phone.startsWith('00')) phone = '+' + phone.slice(2);
  if (/^05\d{8}$/.test(phone)) phone = '+966' + phone.slice(1);
  else if (/^5\d{8}$/.test(phone)) phone = '+966' + phone;
  else if (/^9665\d{8}$/.test(phone)) phone = '+' + phone;
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) return null;
  return phone;
}

export function maskPortalPhone(value) {
  const phone = normalizePortalPhone(value);
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  return '+' + digits.slice(0, Math.min(3, digits.length - 4)) + '••••' + digits.slice(-4);
}

export function injectPortalContactUi(html) {
  const source = String(html || '');
  if (!source.includes('</body>') || source.includes('data-blofy-contact-ui="1"')) return source;

  const injection = String.raw`
<style data-blofy-contact-ui="1">
  .blofy-contact-modal{position:fixed;inset:0;z-index:10020;display:grid;place-items:center;padding:18px;background:rgba(0,0,0,.76);backdrop-filter:blur(9px)}
  .blofy-contact-modal.hidden{display:none!important}
  .blofy-contact-card{width:min(440px,100%);padding:24px;border:1px solid var(--line-accent,rgba(164,97,255,.34));border-radius:24px;background:linear-gradient(155deg,rgba(27,22,42,.99),rgba(12,10,19,.99));box-shadow:0 30px 90px rgba(0,0,0,.58)}
  .blofy-contact-card h3{margin:0 0 8px;font-size:23px}.blofy-contact-card p{margin:0 0 17px;color:var(--muted,#aaa4b7);font-size:13px;line-height:1.75}
  .blofy-contact-card label{display:block;margin:0 2px 8px;color:#ddd8e8;font-size:13px;font-weight:800}
  .blofy-contact-card input{width:100%;height:52px;border:1px solid var(--line,rgba(184,140,255,.19));border-radius:15px;background:#0b0911;color:#fff;padding:0 15px;direction:ltr;text-align:left;outline:0}
  .blofy-contact-card input:focus{border-color:var(--accent,#8b37ff);box-shadow:0 0 0 4px rgba(126,44,255,.12)}
  .blofy-contact-actions{display:flex;gap:9px;margin-top:16px}.blofy-contact-actions button{min-height:48px;border-radius:14px;font-weight:800;cursor:pointer}
  #blofyContactSave{flex:1;border:0;background:linear-gradient(110deg,#7524ef,#a84fff);color:#fff}.blofy-contact-cancel{padding:0 16px;border:1px solid var(--line,rgba(184,140,255,.19));background:transparent;color:#c8c1cf}
  .blofy-contact-note{margin-top:11px!important;color:#817b8b!important;font-size:11px!important}.blofy-contact-status{min-height:20px;margin-top:10px;color:#ff9da6;font-size:12px}
  #blofyPhoneBtn{min-height:48px;padding:0 15px;border:1px solid var(--line,rgba(184,140,255,.19));border-radius:15px;background:var(--surface-alt,#1b162a);color:#fff;font-weight:800;cursor:pointer}
  @media(max-width:640px){#blofyPhoneBtn{flex:1}.blofy-contact-card{padding:21px 18px}}
</style>
<script>
(function () {
  var contactState = { required: false, masked: '', checkedDevice: '' };
  function el(id) { return document.getElementById(id); }
  function contactStorageKey(deviceId) { return 'blofy.contact.complete.v1:' + String(deviceId || '').toUpperCase(); }
  function hasRememberedContact(deviceId) {
    try { return localStorage.getItem(contactStorageKey(deviceId)) === '1'; } catch (_) { return false; }
  }
  function rememberContact(deviceId) {
    try { if (deviceId) localStorage.setItem(contactStorageKey(deviceId), '1'); } catch (_) {}
  }
  function currentAuth() {
    var state = typeof auth !== 'undefined' && auth;
    return { deviceId: String(state && state.deviceId || '').trim(), activationCode: String(state && state.activationCode || '').trim() };
  }
  function copy() {
    var lang = (document.documentElement.lang || 'ar').toLowerCase();
    if (lang === 'ar') return {
      title: 'أكمل بيانات التواصل', text: 'أضف رقم جوالك مرة واحدة للدعم واسترجاع الوصول والتواصل المهم بخصوص حساب BLOFY PLAYER.',
      label: 'رقم الجوال', placeholder: '05XXXXXXXX', save: 'حفظ الرقم', cancel: 'إلغاء', edit: 'تحديث الجوال',
      note: 'يُحفظ الرقم بشكل خاص على جهازك ولا يظهر للمستخدمين الآخرين.', invalid: 'أدخل رقم جوال صحيحًا.', failed: 'تعذر حفظ الرقم. حاول مرة أخرى.'
    };
    return {
      title: 'Add your contact number', text: 'Add your mobile number once for support, account recovery and important BLOFY PLAYER account communication.',
      label: 'Mobile number', placeholder: '+9665XXXXXXXX', save: 'Save number', cancel: 'Cancel', edit: 'Update mobile',
      note: 'Your number is stored privately for this device and is not shown to other users.', invalid: 'Enter a valid mobile number.', failed: 'Could not save the number. Try again.'
    };
  }
  async function contactApi(path, body) {
    var response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    var data = {}; try { data = await response.json(); } catch (_) {}
    if (!response.ok) { var error = new Error(data.error || 'contact_failed'); error.code = data.error; throw error; }
    return data;
  }
  function modal() {
    var node = el('blofyContactModal');
    if (node) return node;
    var c = copy();
    node = document.createElement('div'); node.id = 'blofyContactModal'; node.className = 'blofy-contact-modal hidden';
    node.innerHTML = '<div class="blofy-contact-card" role="dialog" aria-modal="true" aria-labelledby="blofyContactTitle"><div class="blofy-modal-brand"><img src="/blofy-logo.png" alt=""><div><strong>BLOFY PLAYER</strong><span>ACCOUNT</span></div></div><h3 id="blofyContactTitle"></h3><p id="blofyContactText"></p><label for="blofyContactPhone"></label><input id="blofyContactPhone" type="tel" inputmode="tel" autocomplete="tel" maxlength="24"><div id="blofyContactStatus" class="blofy-contact-status" role="status"></div><div class="blofy-contact-actions"><button id="blofyContactSave" type="button"></button><button class="blofy-contact-cancel" type="button"></button></div><p class="blofy-contact-note" id="blofyContactNote"></p></div>';
    document.body.appendChild(node);
    el('blofyContactTitle').textContent = c.title; el('blofyContactText').textContent = c.text;
    node.querySelector('label').textContent = c.label; el('blofyContactPhone').placeholder = c.placeholder;
    el('blofyContactSave').textContent = c.save; node.querySelector('.blofy-contact-cancel').textContent = c.cancel; el('blofyContactNote').textContent = c.note;
    el('blofyContactSave').onclick = savePhone;
    node.querySelector('.blofy-contact-cancel').onclick = function () { if (!contactState.required) node.classList.add('hidden'); };
    node.addEventListener('click', function (event) { if (event.target === node && !contactState.required) node.classList.add('hidden'); });
    return node;
  }
  function openModal(required) {
    contactState.required = !!required;
    var node = modal(); var cancel = node.querySelector('.blofy-contact-cancel');
    cancel.style.display = required ? 'none' : '';
    el('blofyContactStatus').textContent = '';
    el('blofyContactPhone').value = '';
    node.classList.remove('hidden'); setTimeout(function () { el('blofyContactPhone').focus(); }, 20);
  }
  async function savePhone() {
    var state = currentAuth(); var c = copy(); var phone = String(el('blofyContactPhone').value || '').trim();
    if (!phone) { el('blofyContactStatus').textContent = c.invalid; return; }
    var button = el('blofyContactSave'); button.disabled = true; el('blofyContactStatus').textContent = '';
    try {
      var result = await contactApi('/api/v1/portal/contact', { deviceId: state.deviceId, activationCode: state.activationCode, phone: phone });
      contactState.required = false; contactState.masked = result.maskedPhone || ''; contactState.checkedDevice = state.deviceId; rememberContact(state.deviceId); modal().classList.add('hidden'); installButton();
    } catch (_) { el('blofyContactStatus').textContent = c.failed; }
    finally { button.disabled = false; }
  }
  function installButton() {
    var actions = document.querySelector('.dashboard-head .actions'); if (!actions) return;
    var button = el('blofyPhoneBtn'); if (!button) { button = document.createElement('button'); button.id = 'blofyPhoneBtn'; button.type = 'button'; actions.appendChild(button); }
    button.textContent = copy().edit + (contactState.masked ? ' · ' + contactState.masked : '');
    button.onclick = function () { openModal(false); };
  }
  async function ensureContact() {
    var state = currentAuth(); if (!state.deviceId || !state.activationCode) return;
    if (contactState.checkedDevice === state.deviceId) { installButton(); return; }
    var remembered = hasRememberedContact(state.deviceId);
    try {
      var status = await contactApi('/api/v1/portal/contact/status', state);
      contactState.checkedDevice = state.deviceId; contactState.masked = status.maskedPhone || '';
      if (status.hasPhone) rememberContact(state.deviceId);
      contactState.required = !status.hasPhone && !remembered;
      installButton(); if (contactState.required) openModal(true);
    } catch (_) {
      if (remembered) {
        contactState.checkedDevice = state.deviceId;
        contactState.required = false;
        installButton();
      }
    }
  }
  function watchLogin() {
    if (window.blofyContactLoginHook) return; window.blofyContactLoginHook = true;
    if (typeof login === 'function') {
      var originalLogin = login;
      login = async function () { await originalLogin.apply(this, arguments); var app = el('app'); if (typeof auth !== 'undefined' && auth && app && !app.classList.contains('hidden')) await ensureContact(); };
    }
    var app = el('app'); if (app) {
      new MutationObserver(function () { if (!app.classList.contains('hidden')) ensureContact(); }).observe(app, { attributes: true, attributeFilter: ['class'] });
      if (!app.classList.contains('hidden')) ensureContact();
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchLogin, { once: true }); else watchLogin();
})();
</script>`;
  return source.replace('</body>', injection + '\n</body>');
}
