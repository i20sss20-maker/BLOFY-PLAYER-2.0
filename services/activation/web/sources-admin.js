const el = id => document.getElementById(id);
const state = { items: [], repoUrl: '' };
const statusLabels = { 0: 'متوقف', 1: 'يعمل', 2: 'بطيء', 3: 'Beta' };

function showMessage(text, kind = 'ok') {
  const box = el('message');
  box.textContent = text;
  box.className = `message ${kind}`;
  box.hidden = false;
  window.clearTimeout(showMessage.timer);
  showMessage.timer = window.setTimeout(() => { box.hidden = true; }, 4500);
}

async function api(path, options = {}) {
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

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function sourceCard(item) {
  const card = make('article', `source${item.enabled ? '' : ' off'}`);
  card.dataset.id = item.id;

  const main = make('div', 'source-main');
  const icon = make('div', 'icon');
  if (item.iconUrl) {
    const img = document.createElement('img');
    img.src = item.iconUrl;
    img.alt = '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => {
      img.remove();
      icon.append(make('span', '', (item.name || '?').slice(0, 1).toUpperCase()));
    }, { once: true });
    icon.append(img);
  } else {
    icon.append(make('span', '', (item.name || '?').slice(0, 1).toUpperCase()));
  }
  const title = make('div', 'source-title');
  title.append(make('strong', '', item.name));
  title.append(make('small', '', item.internalName));
  const badges = make('div', 'badges');
  (item.tvTypes || []).slice(0, 4).forEach(type => badges.append(make('span', 'badge', type)));
  if (item.category) badges.append(make('span', 'badge', item.category));
  if (item.language) badges.append(make('span', 'badge', item.language.toUpperCase()));
  title.append(badges);
  main.append(icon, title);

  const enabledField = make('div', 'field');
  enabledField.append(make('label', '', 'النشر'));
  const wrap = make('div', 'switch-wrap');
  const switchLabel = make('label', 'switch');
  const enabled = document.createElement('input');
  enabled.type = 'checkbox';
  enabled.checked = item.enabled;
  enabled.dataset.role = 'enabled';
  const slider = make('span', 'slider');
  switchLabel.append(enabled, slider);
  wrap.append(switchLabel, make('span', 'status-note', item.enabled ? 'منشور' : 'مخفي'));
  enabledField.append(wrap);

  const statusField = make('div', 'field');
  statusField.append(make('label', '', 'الحالة'));
  const select = document.createElement('select');
  select.dataset.role = 'status';
  [1, 2, 0, 3].forEach(value => {
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = statusLabels[value];
    option.selected = Number(item.status) === value;
    select.append(option);
  });
  const note = make('div', `status-note s${item.status}`, `v${item.version}`);
  statusField.append(select, note);

  const priorityField = make('div', 'field');
  priorityField.append(make('label', '', 'الترتيب'));
  const priority = document.createElement('input');
  priority.type = 'number';
  priority.min = '0';
  priority.max = '10000';
  priority.step = '1';
  priority.value = String(item.priority ?? 100);
  priority.dataset.role = 'priority';
  priorityField.append(priority);

  const save = make('button', 'button save', 'حفظ');
  save.type = 'button';
  save.addEventListener('click', () => saveSource(card, save));

  enabled.addEventListener('change', () => {
    card.classList.toggle('off', !enabled.checked);
    const text = enabledField.querySelector('.status-note');
    if (text) text.textContent = enabled.checked ? 'منشور' : 'مخفي';
  });

  card.append(main, enabledField, statusField, priorityField, save);
  return card;
}

function render() {
  const list = el('sources');
  list.replaceChildren();
  state.items.forEach(item => list.append(sourceCard(item)));
  el('loading').hidden = true;
  list.hidden = false;

  const total = state.items.length;
  const enabled = state.items.filter(item => item.enabled).length;
  const down = state.items.filter(item => item.enabled && Number(item.status) === 0).length;
  const beta = state.items.filter(item => item.enabled && Number(item.status) === 3).length;
  el('statTotal').textContent = String(total);
  el('statEnabled').textContent = String(enabled);
  el('statDown').textContent = String(down);
  el('statBeta').textContent = String(beta);
  el('repoUrl').textContent = state.repoUrl || '—';
}

async function load() {
  el('loading').hidden = false;
  el('sources').hidden = true;
  try {
    const data = await api('/api/v1/admin/sources');
    state.items = Array.isArray(data.items) ? data.items : [];
    state.repoUrl = data.publicRepoUrl || '';
    render();
  } catch (error) {
    if (error.message !== 'unauthorized') {
      el('loading').hidden = true;
      showMessage(`تعذر تحميل المصادر: ${error.message}`, 'error');
    }
  }
}

async function saveSource(card, button) {
  const id = card.dataset.id;
  const enabled = card.querySelector('[data-role="enabled"]')?.checked ?? false;
  const status = Number(card.querySelector('[data-role="status"]')?.value ?? 1);
  const priority = Number(card.querySelector('[data-role="priority"]')?.value ?? 100);
  button.disabled = true;
  button.textContent = 'يحفظ…';
  try {
    const data = await api(`/api/v1/admin/sources/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled, status, priority })
    });
    const index = state.items.findIndex(item => item.id === id);
    if (index >= 0 && data.item) state.items[index] = data.item;
    render();
    showMessage('تم حفظ المصدر ونشر التغيير.');
  } catch (error) {
    showMessage(`تعذر الحفظ: ${error.message}`, 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'حفظ';
  }
}

async function sync() {
  const button = el('syncBtn');
  button.disabled = true;
  const old = button.textContent;
  button.textContent = 'تتم المزامنة…';
  try {
    const data = await api('/api/v1/admin/sources/sync', { method: 'POST', body: '{}' });
    showMessage(`تمت مزامنة ${data.synced || 0} مصدر من GitHub.`);
    await load();
  } catch (error) {
    showMessage(`فشلت المزامنة: ${error.message}`, 'error');
  } finally {
    button.disabled = false;
    button.textContent = old;
  }
}

el('refreshBtn').addEventListener('click', load);
el('syncBtn').addEventListener('click', sync);
el('copyRepoBtn').addEventListener('click', async () => {
  if (!state.repoUrl) return;
  try {
    await navigator.clipboard.writeText(state.repoUrl);
    showMessage('تم نسخ رابط المستودع.');
  } catch {
    showMessage('تعذر النسخ التلقائي. انسخ الرابط يدويًا.', 'error');
  }
});

load();
