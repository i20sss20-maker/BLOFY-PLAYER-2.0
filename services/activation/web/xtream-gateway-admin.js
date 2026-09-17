const gx = id => document.getElementById(id);
const gatewayState = { serverUrl: '', items: [] };

async function gatewayApi(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  if (response.status === 401) {
    window.location.href = '/admin';
    throw new Error('unauthorized');
  }
  let body = {};
  try { body = await response.json(); } catch {}
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

function gatewayMessage(text, kind = 'ok') {
  const box = document.getElementById('message');
  if (!box) return;
  box.textContent = text;
  box.className = `message ${kind}`;
  box.hidden = false;
  window.clearTimeout(gatewayMessage.timer);
  gatewayMessage.timer = window.setTimeout(() => { box.hidden = true; }, 5000);
}

function gatewayNode(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function copyText(value, success = 'تم النسخ.') {
  try {
    await navigator.clipboard.writeText(String(value || ''));
    gatewayMessage(success);
  } catch {
    gatewayMessage('تعذر النسخ التلقائي. انسخ القيمة يدويًا.', 'error');
  }
}

function showCredentials(credentials) {
  if (!credentials) return;
  gx('gatewayCredentials').hidden = false;
  gx('gatewayCredHost').textContent = credentials.serverUrl || '—';
  gx('gatewayCredUser').textContent = credentials.username || '—';
  gx('gatewayCredPass').textContent = credentials.password || '—';
  gx('gatewayCredentials').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderGatewayAccounts() {
  const list = gx('gatewayAccounts');
  list.replaceChildren();
  gx('gatewayServerUrl').textContent = gatewayState.serverUrl || '—';
  if (!gatewayState.items.length) {
    list.append(gatewayNode('div', 'empty-state', 'ما فيه بيانات دخول حتى الآن. اضغط «إنشاء بيانات دخول» وبتطلع لك جاهزة.'));
    return;
  }
  for (const item of gatewayState.items) {
    const card = gatewayNode('article', `gateway-account${item.enabled ? '' : ' off'}`);
    const main = gatewayNode('div', 'gateway-account-main');
    main.append(gatewayNode('strong', '', item.label || 'BLOFY Player'));
    const user = gatewayNode('code', '', item.username);
    main.append(user);
    const meta = gatewayNode('small', 'muted', `${item.enabled ? 'مفعل' : 'متوقف'} · ${item.maxConnections || 1} اتصال`);
    main.append(meta);

    const actions = gatewayNode('div', 'inline-actions');
    const copy = gatewayNode('button', 'button ghost', 'نسخ اليوزر');
    copy.type = 'button';
    copy.addEventListener('click', () => copyText(item.username, 'تم نسخ اسم المستخدم.'));

    const toggle = gatewayNode('button', 'button', item.enabled ? 'إيقاف' : 'تفعيل');
    toggle.type = 'button';
    toggle.addEventListener('click', async () => {
      toggle.disabled = true;
      try {
        await gatewayApi(`/api/v1/admin/xtream-gateway/accounts/${encodeURIComponent(item.id)}`, {
          method: 'PATCH', body: JSON.stringify({ enabled: !item.enabled })
        });
        gatewayMessage(item.enabled ? 'تم إيقاف بيانات الدخول.' : 'تم تفعيل بيانات الدخول.');
        await loadGateway();
      } catch (error) { gatewayMessage(`تعذر التحديث: ${error.message}`, 'error'); }
      finally { toggle.disabled = false; }
    });

    const reset = gatewayNode('button', 'button', 'كلمة سر جديدة');
    reset.type = 'button';
    reset.addEventListener('click', async () => {
      reset.disabled = true;
      try {
        const data = await gatewayApi(`/api/v1/admin/xtream-gateway/accounts/${encodeURIComponent(item.id)}/reset`, {
          method: 'POST', body: '{}'
        });
        showCredentials(data.credentials);
        gatewayMessage('تم تغيير كلمة السر. القديمة توقفت فورًا.');
        await loadGateway();
      } catch (error) { gatewayMessage(`تعذر تغيير كلمة السر: ${error.message}`, 'error'); }
      finally { reset.disabled = false; }
    });

    const remove = gatewayNode('button', 'button danger', 'حذف');
    remove.type = 'button';
    remove.addEventListener('click', async () => {
      if (!window.confirm(`حذف بيانات الدخول ${item.username}؟`)) return;
      remove.disabled = true;
      try {
        await gatewayApi(`/api/v1/admin/xtream-gateway/accounts/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
        gatewayMessage('تم حذف بيانات الدخول.');
        await loadGateway();
      } catch (error) { gatewayMessage(`تعذر الحذف: ${error.message}`, 'error'); }
      finally { remove.disabled = false; }
    });

    actions.append(copy, toggle, reset, remove);
    card.append(main, actions);
    list.append(card);
  }
}

async function loadGateway() {
  const loading = gx('gatewayLoading');
  if (loading) loading.hidden = false;
  try {
    const data = await gatewayApi('/api/v1/admin/xtream-gateway');
    gatewayState.serverUrl = data.serverUrl || '';
    gatewayState.items = Array.isArray(data.items) ? data.items : [];
    renderGatewayAccounts();
  } catch (error) {
    if (error.message !== 'unauthorized') gatewayMessage(`تعذر تحميل بوابة Xtream: ${error.message}`, 'error');
  } finally {
    if (loading) loading.hidden = true;
  }
}

gx('gatewayCreateBtn')?.addEventListener('click', async () => {
  const button = gx('gatewayCreateBtn');
  button.disabled = true;
  const old = button.textContent;
  button.textContent = 'جارٍ الإنشاء…';
  try {
    const data = await gatewayApi('/api/v1/admin/xtream-gateway/accounts', {
      method: 'POST',
      body: JSON.stringify({ label: 'BLOFY Player', maxConnections: 1 })
    });
    showCredentials(data.credentials);
    gatewayMessage('تم إنشاء بيانات Xtream جاهزة للاستخدام.');
    await loadGateway();
  } catch (error) {
    gatewayMessage(`تعذر إنشاء بيانات الدخول: ${error.message}`, 'error');
  } finally {
    button.disabled = false;
    button.textContent = old;
  }
});

gx('gatewayCopyHostBtn')?.addEventListener('click', () => copyText(gatewayState.serverUrl, 'تم نسخ رابط السيرفر.'));

gx('gatewayCopyAllBtn')?.addEventListener('click', () => {
  const host = gx('gatewayCredHost')?.textContent || '';
  const username = gx('gatewayCredUser')?.textContent || '';
  const password = gx('gatewayCredPass')?.textContent || '';
  copyText(`Server: ${host}\nUsername: ${username}\nPassword: ${password}`, 'تم نسخ بيانات Xtream كاملة.');
});

gx('gatewayHideCredentialsBtn')?.addEventListener('click', () => { gx('gatewayCredentials').hidden = true; });

function openGatewayHashTab() {
  const name = String(location.hash || '').replace(/^#/, '').trim().toLowerCase();
  if (!['sources', 'xtream', 'catalog'].includes(name)) return;
  const button = document.querySelector(`.tab[data-tab="${name}"]`);
  if (button && !button.classList.contains('active')) button.click();
}

window.addEventListener('hashchange', openGatewayHashTab);
setTimeout(openGatewayHashTab, 0);
loadGateway();
