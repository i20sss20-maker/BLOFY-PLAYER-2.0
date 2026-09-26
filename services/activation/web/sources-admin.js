const el = id => document.getElementById(id);
const state = {
  items: [],
  repoUrl: '',
  xtreamServers: [],
  xtreamTotals: {},
  categories: [],
  catalog: [],
  activeTab: 'sources',
  pollTimer: null
};
const statusLabels = { 0: 'متوقف', 1: 'يعمل', 2: 'بطيء', 3: 'تجريبي' };
const TAB_NAMES = new Set(['sources', 'xtream', 'catalog']);
const tabFromHash = () => {
  const name = String(location.hash || '').replace(/^#/, '').trim().toLowerCase();
  return TAB_NAMES.has(name) ? name : null;
};

function showMessage(text, kind = 'ok') {
  const box = el('message');
  box.textContent = text;
  box.className = `message ${kind}`;
  box.hidden = false;
  window.clearTimeout(showMessage.timer);
  showMessage.timer = window.setTimeout(() => { box.hidden = true; }, 5000);
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
  } else icon.append(make('span', '', (item.name || '?').slice(0, 1).toUpperCase()));

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
  const switchLabel = make('label', 'switch');
  const enabled = document.createElement('input');
  enabled.type = 'checkbox';
  enabled.checked = item.enabled;
  enabled.dataset.role = 'enabled';
  switchLabel.append(enabled, make('span', 'slider'));
  const wrap = make('div', 'switch-wrap');
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
  statusField.append(select, make('div', `status-note s${item.status}`, `v${item.version}`));

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

function renderSources() {
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

async function loadSources() {
  el('loading').hidden = false;
  try {
    const data = await api('/api/v1/admin/sources');
    state.items = Array.isArray(data.items) ? data.items : [];
    state.repoUrl = data.publicRepoUrl || '';
    renderSources();
  } catch (error) {
    if (error.message !== 'unauthorized') {
      el('loading').hidden = true;
      showMessage(`تعذر تحميل الإضافات: ${error.message}`, 'error');
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
      method: 'PATCH', body: JSON.stringify({ enabled, status, priority })
    });
    const index = state.items.findIndex(item => item.id === id);
    if (index >= 0 && data.item) state.items[index] = data.item;
    renderSources();
    showMessage('تم حفظ المصدر ونشر التغيير.');
  } catch (error) {
    showMessage(`تعذر الحفظ: ${error.message}`, 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'حفظ';
  }
}

async function syncSources() {
  const button = el('syncBtn');
  button.disabled = true;
  const old = button.textContent;
  button.textContent = 'تتم المزامنة…';
  try {
    const data = await api('/api/v1/admin/sources/sync', { method: 'POST', body: '{}' });
    showMessage(`تمت مزامنة ${data.synced || 0} مصدر من GitHub.`);
    await loadSources();
  } catch (error) {
    showMessage(`فشلت المزامنة: ${error.message}`, 'error');
  } finally {
    button.disabled = false;
    button.textContent = old;
  }
}

function xtStatusClass(status) {
  if (status === 'online') return 'online';
  if (status === 'syncing') return 'syncing';
  if (status === 'offline' || status === 'error') return 'offline';
  return 'unknown';
}

function serverCard(item) {
  const card = make('article', 'server-card');
  card.dataset.id = item.id;
  const header = make('div', 'server-head');
  const title = make('div');
  title.append(make('strong', '', item.name));
  title.append(make('code', 'server-url', item.baseUrl));
  const statusKey = item.syncing ? 'syncing' : item.status;
  const statusText = ({ online:'متصل', syncing:'جاري المزامنة', offline:'غير متصل', error:'خطأ', unknown:'غير معروف' })[statusKey] || statusKey;
  const status = make('span', `server-status ${xtStatusClass(statusKey)}`, statusText);
  header.append(title, status);

  const metrics = make('div', 'server-metrics');
  [['البث المباشر', item.counts?.live], ['الأفلام', item.counts?.movie], ['المسلسلات', item.counts?.series], ['الإجمالي', item.counts?.total]].forEach(([label, value]) => {
    const box = make('div');
    box.append(make('span', '', label), make('strong', '', String(Number(value || 0).toLocaleString())));
    metrics.append(box);
  });

  const settings = make('div', 'server-settings');
  const enabledLabel = make('label', 'check compact');
  const enabled = document.createElement('input');
  enabled.type = 'checkbox'; enabled.checked = item.enabled; enabled.dataset.role = 'enabled';
  enabledLabel.append(enabled, make('span', '', 'مفعل'));
  const publishLabel = make('label', 'check compact');
  const publish = document.createElement('input');
  publish.type = 'checkbox'; publish.checked = item.publishCatalog; publish.dataset.role = 'publish';
  publishLabel.append(publish, make('span', '', 'نشر الكتالوج'));
  const priority = document.createElement('input');
  priority.type = 'number'; priority.min = '0'; priority.max = '10000'; priority.value = String(item.priority ?? 100); priority.dataset.role = 'priority';
  priority.className = 'small-input';
  settings.append(enabledLabel, publishLabel, make('span', 'muted', item.transportSecurity === 'https' ? 'HTTPS' : 'HTTP'), priority);

  const actions = make('div', 'server-actions');
  const buttons = [
    ['فحص', 'test', 'button'],
    ['مزامنة الكل', 'sync-all', 'button primary'],
    ['البث المباشر', 'sync-live', 'button ghost'],
    ['الأفلام', 'sync-movie', 'button ghost'],
    ['المسلسلات', 'sync-series', 'button ghost'],
    ['حفظ', 'save', 'button'],
    ['حذف', 'delete', 'button danger']
  ];
  buttons.forEach(([text, action, cls]) => {
    const button = make('button', cls, text);
    button.type = 'button'; button.dataset.action = action;
    button.disabled = item.syncing && action.startsWith('sync');
    actions.append(button);
  });

  const info = make('div', 'server-info');
  if (item.accountInfo?.maxConnections != null) info.append(make('span', 'badge', `الحد ${item.accountInfo.maxConnections}`));
  if (item.accountInfo?.activeConnections != null) info.append(make('span', 'badge', `النشط ${item.accountInfo.activeConnections}`));
  if (item.lastSyncAt) info.append(make('span', 'muted', `آخر مزامنة: ${new Date(item.lastSyncAt).toLocaleString('ar-SA')}`));
  if (item.lastError) info.append(make('span', 'error-text', `آخر خطأ: ${item.lastError}`));

  actions.addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    handleServerAction(item, card, button);
  });
  card.append(header, metrics, settings, actions, info);
  return card;
}

function renderXtream() {
  const totals = state.xtreamTotals || {};
  el('xtServers').textContent = String(totals.servers || 0);
  el('xtOnline').textContent = String(totals.online || 0);
  el('xtLive').textContent = Number(totals.live || 0).toLocaleString();
  el('xtMovies').textContent = Number(totals.movie || 0).toLocaleString();
  el('xtSeries').textContent = Number(totals.series || 0).toLocaleString();
  const list = el('xtreamServers');
  list.replaceChildren();
  if (!state.xtreamServers.length) list.append(make('div', 'empty', 'لا توجد سيرفرات Xtream مضافة حتى الآن.'));
  state.xtreamServers.forEach(item => list.append(serverCard(item)));
  el('xtreamLoading').hidden = true;
  list.hidden = false;
  updateCatalogServerOptions();
}

function scheduleXtreamPoll() {
  window.clearTimeout(state.pollTimer);
  const busy = state.xtreamServers.some(item => item.syncing || item.status === 'syncing');
  if (!busy) return;
  state.pollTimer = window.setTimeout(async () => {
    await loadXtream(true);
    scheduleXtreamPoll();
  }, 3500);
}

async function loadXtream(silent = false) {
  if (!silent) el('xtreamLoading').hidden = false;
  try {
    const data = await api('/api/v1/admin/xtream/servers');
    state.xtreamServers = Array.isArray(data.items) ? data.items : [];
    state.xtreamTotals = data.totals || {};
    renderXtream();
    scheduleXtreamPoll();
  } catch (error) {
    if (!silent) showMessage(`تعذر تحميل سيرفرات Xtream: ${error.message}`, 'error');
  }
}

async function addXtream(event) {
  event.preventDefault();
  const button = el('xtAddBtn');
  button.disabled = true;
  const old = button.textContent;
  button.textContent = 'يتم الإضافة…';
  try {
    const data = await api('/api/v1/admin/xtream/servers', {
      method: 'POST',
      body: JSON.stringify({
        name: el('xtName').value,
        baseUrl: el('xtBaseUrl').value,
        username: el('xtUsername').value,
        password: el('xtPassword').value,
        priority: Number(el('xtPriority').value || 100),
        enabled: el('xtEnabled').checked,
        publishCatalog: el('xtPublish').checked
      })
    });
    const id = data.item?.id;
    if (!id) throw new Error('xtream_create_failed');
    button.textContent = 'يتم الفحص…';
    await api(`/api/v1/admin/xtream/servers/${id}/test`, { method: 'POST', body: '{}' });
    button.textContent = 'بدء الاستيراد…';
    await api(`/api/v1/admin/xtream/servers/${id}/sync`, { method: 'POST', body: JSON.stringify({ types: ['live','movie','series'] }) });
    el('xtreamForm').reset();
    el('xtEnabled').checked = true;
    el('xtPriority').value = '100';
    showMessage('تمت إضافة السيرفر وفحصه وبدأ استيراد البث المباشر والأفلام والمسلسلات.');
    await loadXtream();
  } catch (error) {
    showMessage(`تعذر إضافة السيرفر: ${error.message}`, 'error');
  } finally {
    button.disabled = false;
    button.textContent = old;
  }
}

async function handleServerAction(item, card, button) {
  const action = button.dataset.action;
  button.disabled = true;
  const old = button.textContent;
  button.textContent = '...';
  try {
    if (action === 'test') {
      await api(`/api/v1/admin/xtream/servers/${item.id}/test`, { method: 'POST', body: '{}' });
      showMessage(`اتصال ${item.name} ناجح.`);
    } else if (action === 'save') {
      await api(`/api/v1/admin/xtream/servers/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          enabled: card.querySelector('[data-role="enabled"]').checked,
          publishCatalog: card.querySelector('[data-role="publish"]').checked,
          priority: Number(card.querySelector('[data-role="priority"]').value || 100)
        })
      });
      showMessage('تم حفظ إعدادات السيرفر.');
    } else if (action === 'delete') {
      if (!window.confirm(`حذف ${item.name} وكل الكتالوج المستورد منه؟`)) return;
      await api(`/api/v1/admin/xtream/servers/${item.id}`, { method: 'DELETE' });
      showMessage('تم حذف السيرفر وبياناته المستوردة.');
    } else if (action.startsWith('sync-')) {
      const type = action === 'sync-all' ? ['live','movie','series'] : [action.replace('sync-', '')];
      await api(`/api/v1/admin/xtream/servers/${item.id}/sync`, { method: 'POST', body: JSON.stringify({ types: type }) });
      showMessage(`بدأت مزامنة ${item.name}.`);
    }
    await loadXtream(true);
  } catch (error) {
    showMessage(`فشلت العملية: ${error.message}`, 'error');
  } finally {
    button.disabled = false;
    button.textContent = old;
  }
}

async function syncAllXtream() {
  const button = el('syncAllXtreamBtn');
  button.disabled = true;
  try {
    const data = await api('/api/v1/admin/xtream/sync-all', { method: 'POST', body: '{}' });
    showMessage(`بدأت مزامنة ${data.started?.length || 0} سيرفر.`);
    await loadXtream(true);
  } catch (error) {
    showMessage(`تعذر بدء المزامنة: ${error.message}`, 'error');
  } finally {
    button.disabled = false;
  }
}

function updateCatalogServerOptions() {
  const select = el('catalogServer');
  if (!select) return;
  const current = select.value;
  select.replaceChildren();
  state.xtreamServers.forEach(server => {
    const option = document.createElement('option');
    option.value = server.id;
    option.textContent = server.name;
    select.append(option);
  });
  if (state.xtreamServers.some(server => server.id === current)) select.value = current;
}

async function loadCategories() {
  const serverId = el('catalogServer').value;
  const type = el('catalogType').value;
  const select = el('catalogCategory');
  select.replaceChildren();
  const all = document.createElement('option'); all.value = ''; all.textContent = 'كل الأقسام'; select.append(all);
  if (!serverId) return;
  try {
    const data = await api(`/api/v1/admin/xtream/categories?serverId=${encodeURIComponent(serverId)}&type=${encodeURIComponent(type)}`);
    state.categories = Array.isArray(data.items) ? data.items : [];
    state.categories.forEach(category => {
      const option = document.createElement('option');
      option.value = category.id;
      option.textContent = `${category.enabled ? '' : '⛔ '} ${category.name} (${Number(category.itemCount || 0).toLocaleString()})`;
      select.append(option);
    });
  } catch (error) {
    showMessage(`تعذر تحميل الأقسام: ${error.message}`, 'error');
  }
}

function catalogCard(item) {
  const card = make('article', `catalog-item${item.enabled ? '' : ' off'}`);
  const media = make('div', 'catalog-media');
  const poster = make('div', 'catalog-icon');
  if (item.iconUrl) {
    const img = document.createElement('img');
    img.src = item.iconUrl; img.alt = ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => img.remove(), { once: true });
    poster.append(img);
  }
  const title = make('div', 'catalog-title');
  title.append(make('strong', '', item.name));
  const meta = [];
  if (item.categoryName) meta.push(item.categoryName);
  if (item.metadata?.year) meta.push(String(item.metadata.year));
  if (item.metadata?.rating) meta.push(`★ ${item.metadata.rating}`);
  if (item.containerExtension) meta.push(item.containerExtension.toUpperCase());
  const typeLabel = ({ live:'بث مباشر', movie:'فيلم', series:'مسلسل' })[item.type] || item.type;
  title.append(make('small', '', meta.join(' · ') || typeLabel));
  media.append(poster, title);
  const toggle = make('button', item.enabled ? 'button ghost' : 'button', item.enabled ? 'تعطيل' : 'تفعيل');
  toggle.type = 'button';
  toggle.addEventListener('click', async () => {
    toggle.disabled = true;
    try {
      await api(`/api/v1/admin/xtream/items/${encodeURIComponent(item.serverId)}/${encodeURIComponent(item.type)}/${encodeURIComponent(item.id)}`, {
        method: 'PATCH', body: JSON.stringify({ enabled: !item.enabled })
      });
      item.enabled = !item.enabled;
      renderCatalog();
    } catch (error) {
      showMessage(`تعذر تحديث العنصر: ${error.message}`, 'error');
    }
  });
  card.append(media, toggle);
  return card;
}

function renderCatalog() {
  const list = el('catalogItems');
  list.replaceChildren();
  if (!state.catalog.length) list.append(make('div', 'empty', 'ما فيه نتائج في هذا الاختيار.'));
  state.catalog.forEach(item => list.append(catalogCard(item)));
  el('catalogHint').textContent = state.catalog.length ? `معروض ${state.catalog.length} عنصر (حتى 250 في الصفحة).` : '';
}

async function loadCatalog() {
  const serverId = el('catalogServer').value;
  if (!serverId) return;
  el('catalogLoading').hidden = false;
  try {
    const params = new URLSearchParams({ serverId, type: el('catalogType').value, limit: '250' });
    if (el('catalogCategory').value) params.set('categoryId', el('catalogCategory').value);
    if (el('catalogSearch').value.trim()) params.set('q', el('catalogSearch').value.trim());
    const data = await api(`/api/v1/admin/xtream/catalog?${params}`);
    state.catalog = Array.isArray(data.items) ? data.items : [];
    renderCatalog();
  } catch (error) {
    showMessage(`تعذر تحميل الكتالوج: ${error.message}`, 'error');
  } finally {
    el('catalogLoading').hidden = true;
  }
}

async function bulkCatalog(enabled) {
  const serverId = el('catalogServer').value;
  if (!serverId) return;
  const body = {
    serverId,
    mediaType: el('catalogType').value,
    categoryId: el('catalogCategory').value || null,
    target: 'both',
    enabled
  };
  try {
    const result = await api('/api/v1/admin/xtream/bulk', { method: 'POST', body: JSON.stringify(body) });
    showMessage(`${enabled ? 'تم تفعيل' : 'تم تعطيل'} ${result.items || 0} عنصر و${result.categories || 0} قسم.`);
    await loadCategories();
    await loadCatalog();
  } catch (error) {
    showMessage(`فشلت العملية الجماعية: ${error.message}`, 'error');
  }
}

async function switchTab(name) {
  if (!TAB_NAMES.has(name)) return;
  state.activeTab = name;
  if (location.hash !== `#${name}`) history.replaceState(null, '', `#${name}`);
  document.querySelectorAll('.tab').forEach(button => button.classList.toggle('active', button.dataset.tab === name));
  document.querySelectorAll('.tab-page').forEach(page => {
    const active = page.id === `tab-${name}`;
    page.hidden = !active;
    page.classList.toggle('active', active);
  });
  if (name === 'xtream') await loadXtream();
  if (name === 'catalog') {
    await loadXtream(true);
    await loadCategories();
    await loadCatalog();
  }
}

async function refreshCurrent() {
  if (state.activeTab === 'sources') await loadSources();
  else if (state.activeTab === 'xtream') await loadXtream();
  else { await loadXtream(true); await loadCategories(); await loadCatalog(); }
}

document.querySelectorAll('.tab').forEach(button => button.addEventListener('click', () => switchTab(button.dataset.tab)));
el('refreshBtn').addEventListener('click', refreshCurrent);
el('syncBtn').addEventListener('click', syncSources);
el('copyRepoBtn').addEventListener('click', async () => {
  if (!state.repoUrl) return;
  try { await navigator.clipboard.writeText(state.repoUrl); showMessage('تم نسخ رابط المستودع.'); }
  catch { showMessage('تعذر النسخ التلقائي. انسخ الرابط يدويًا.', 'error'); }
});
el('xtreamForm').addEventListener('submit', addXtream);
el('syncAllXtreamBtn').addEventListener('click', syncAllXtream);
el('catalogServer').addEventListener('change', async () => { await loadCategories(); await loadCatalog(); });
el('catalogType').addEventListener('change', async () => { await loadCategories(); await loadCatalog(); });
el('catalogCategory').addEventListener('change', loadCatalog);
el('catalogLoadBtn').addEventListener('click', loadCatalog);
el('catalogSearch').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); loadCatalog(); } });
el('enableTypeBtn').addEventListener('click', () => bulkCatalog(true));
el('disableTypeBtn').addEventListener('click', () => bulkCatalog(false));
window.addEventListener('hashchange', () => {
  const name = tabFromHash();
  if (name && name !== state.activeTab) switchTab(name);
});

loadSources();
loadXtream(true);
const initialTab = tabFromHash();
if (initialTab && initialTab !== 'sources') switchTab(initialTab);
