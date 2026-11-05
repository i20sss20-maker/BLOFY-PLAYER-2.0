const el = id => document.getElementById(id);
const state = {
  items: [],
  repoUrl: '',
  xtreamServers: [],
  xtreamTotals: {},
  categories: [],
  catalog: [],
  activeTab: 'xtream',
  pollTimer: null
};
const statusLabels = { 0: 'متوقف', 1: 'يعمل', 2: 'بطيء', 3: 'Beta' };
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
  const main = make('div', 'source-card-main');
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
  const status = make('span', `server-status ${xtStatusClass(item.syncing ? 'syncing' : item.status)}`, item.syncing ? 'Syncing' : item.status);
  header.append(title, status);

  const metrics = make('div', 'server-metrics');
  [['Live', item.counts?.live], ['Movies', item.counts?.movie], ['Series', item.counts?.series], ['Total', item.counts?.total]].forEach(([label, value]) => {
    const box = make('div');
    box.append(make('span', '', label), make('strong', '', String(Number(value || 0).toLocaleString())));
    metrics.append(box);
  });

  const settings = make('details', 'server-advanced');
  const advancedSummary = make('summary', '', 'إعدادات إضافية · الأولوية والمزامنة حسب النوع');
  const advancedFields = make('div', 'server-settings');
  settings.append(advancedSummary, advancedFields);
  const editableFields = [
    ['name','اسم المصدر','text',item.name,160],
    ['baseUrl','Host / URL','url',item.baseUrl,500],
    ['username','Username جديد (اتركه فارغًا دون تغيير)','text','',512],
    ['password','Password جديد (اتركه فارغًا دون تغيير)','password','',1024],
    ['priority','الأولوية (رقم أقل = أولوية أعلى)','number',String(item.priority??100),5]
  ];
  for (const [role,labelText,inputType,value,maxLength] of editableFields) {
    const field=make('label','server-edit-field');
    field.append(make('span','',labelText));
    const input=document.createElement('input');
    input.type=inputType;input.value=value;input.dataset.role=role;
    input.className='small-input';
    input.autocomplete='off';
    if(inputType==='number'){input.min='0';input.max='10000';input.step='1'}
    else input.maxLength=maxLength;
    field.append(input);advancedFields.append(field);
  }
  const editNotice=make('p','muted','لن تُعرض كلمات المرور الحالية. إدخال بيانات جديدة يستلزم إعادة فحص الاتصال ومزامنة المصدر.');
  advancedFields.append(editNotice);
  const actions = make('div', 'server-actions');
  const buttons = [
    [item.enabled ? '⏸ إيقاف المصدر' : '▶ تفعيل المصدر', 'toggle-enabled', item.enabled ? 'button source-toggle-stop' : 'button primary'],
    [item.publishCatalog ? 'إخفاء المحتوى عن العملاء' : 'نشر المحتوى للعملاء', 'toggle-publish', item.publishCatalog ? 'button ghost' : 'button primary'],
    ['⟳ مزامنة المحتوى', 'sync-all', 'button'],
    ['فحص الاتصال', 'test', 'button ghost'],
    ['حذف المصدر', 'delete', 'button danger']
  ];
  buttons.forEach(([text, action, cls]) => {
    const button = make('button', cls, text);
    button.type = 'button'; button.dataset.action = action;
    button.disabled = item.syncing && (action.startsWith('sync') || action === 'delete');
    actions.append(button);
  });

  const extraActions = make('div', 'server-actions server-actions-advanced');
  for (const [label, action] of [['Live فقط', 'sync-live'], ['أفلام فقط', 'sync-movie'], ['مسلسلات فقط', 'sync-series'], ['حفظ الأولوية', 'save']]) {
    const button = make('button', 'button ghost', label);
    button.type='button';button.dataset.action=action;
    button.disabled = item.syncing && action.startsWith('sync');
    extraActions.append(button);
  }
  settings.append(extraActions);
  const info = make('div', 'server-info');
  if (item.accountInfo?.maxConnections != null) info.append(make('span', 'badge', `Max ${item.accountInfo.maxConnections}`));
  if (item.accountInfo?.activeConnections != null) info.append(make('span', 'badge', `Active ${item.accountInfo.activeConnections}`));
  if (item.lastSyncAt) info.append(make('span', 'muted', `آخر مزامنة: ${new Date(item.lastSyncAt).toLocaleString('ar-SA')}`));
  if (item.lastError) info.append(make('span', 'error-text', `آخر خطأ: ${item.lastError}`));

  card.addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    handleServerAction(item, card, button);
  });
  const indicators = make('div', 'source-quick-status');
  indicators.append(
    make('span', item.enabled ? 'source-state-pill on' : 'source-state-pill off', item.enabled ? '● المصدر مفعّل' : '● المصدر موقوف'),
    make('span', item.enabled && item.publishCatalog ? 'source-state-pill published' : 'source-state-pill hidden', item.enabled && item.publishCatalog ? '● منشور للمشتركين' : '○ غير ظاهر للمشتركين')
  );
  card.append(header, indicators, metrics, actions, settings, info);
  return card;
}

function renderXtream() {
  const totals = state.xtreamTotals || {};
  el('xtServers').textContent = String(totals.servers || 0);
  el('xtOnline').textContent = String(totals.online || 0);
  el('xtLive').textContent = Number(totals.live || 0).toLocaleString();
  el('xtMovies').textContent = Number(totals.movie || 0).toLocaleString();
  el('xtSeries').textContent = Number(totals.series || 0).toLocaleString();
  const text=el('xtreamTotalsNotice');
  if(text){
    const count=Number(totals.live||0)+Number(totals.movie||0)+Number(totals.series||0);
    const failed=state.xtreamServers.filter(item=>item.lastError);
    const syncing=state.xtreamServers.filter(item=>item.syncing||item.status==='syncing');
    text.className='stream-totals-notice';
    if(!state.xtreamServers.length){
      text.textContent='لم تضف حساب Xtream إلى هذه اللوحة بعد. ابدأ من نموذج Host وUsername وPassword بالأعلى. عناصر لوحة إعادة البث القديمة لا تُحسب هنا تلقائيًا.';
      text.classList.add('warning');
    }else if(syncing.length){
      text.textContent='جارٍ استيراد '+syncing.length+' مصدر… سيظهر العدد الحقيقي بعد انتهاء المزامنة، ويمكنك تحديث الصفحة لمعرفة النتيجة.';
    }else if(!count && failed.length){
      const err=String(failed[0].lastError||'');
      text.textContent='تم حفظ '+state.xtreamServers.length+' مصدر، لكن فشل استيراد المحتوى '+(err.includes('404')?'لأن المصدر لا يدعم مسارًا من API (404). جرّب زر «مزامنة الكل» مرة أخرى بعد التحديث.':err.includes('403')?'لأن المزود يرفض الاتصال (403). يجب إصلاح الوصول المصرح به لدى المصدر.':': '+err)+ ' لا تظهر عناصر من الفهرس القديم ضمن هذه الأرقام.';
      text.classList.add('warning');
    }else if(!count){
      text.textContent='مصادر Xtream موجودة، ولكن لم تنجح مزامنة أي محتوى حتى الآن. اضغط «مزامنة الكل» من بطاقة المصدر.';
      text.classList.add('warning');
    }else{
      text.textContent='تم استيراد '+count.toLocaleString('en-US')+' عنصر إلى مكتبة BLOFY الحالية.'+(failed.length?' توجد '+failed.length+' مصادر بها خطأ جزئي؛ راجع بطاقة المصدر.':'');
      text.classList.add(failed.length?'warning':'ok');
    }
  }

  const list = el('xtreamServers');
  list.replaceChildren();
  const query=String(el('xtSourceSearch')?.value||'').trim().toLowerCase();
  const filter=String(el('xtSourceFilter')?.value||'all');
  const visible=state.xtreamServers.filter(item=>
    (!query||String(item.name+' '+item.baseUrl).toLowerCase().includes(query)) &&
    (filter==='all'||(filter==='enabled'&&item.enabled)||(filter==='disabled'&&!item.enabled)||(filter==='published'&&item.enabled&&item.publishCatalog))
  );
  const countEnabled=state.xtreamServers.filter(x=>x.enabled).length;
  const countPublished=state.xtreamServers.filter(x=>x.enabled&&x.publishCatalog).length;
  el('xtSourceSummary').textContent='الإجمالي: '+state.xtreamServers.length+' · المفعلة: '+countEnabled+' · المنشورة: '+countPublished+' · المعروضة: '+visible.length;
  if(!state.xtreamServers.length)list.append(make('div','empty','ما عندك مصادر Xtream مضافة. اضغط «+ إضافة Xtream جديد» للبدء.'));
  else if(!visible.length)list.append(make('div','empty','ما فيه مصادر تطابق البحث أو الفلتر الحالي.'));
  visible.forEach(item=>list.append(serverCard(item)));
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
    if (!silent) showMessage(`تعذر تحميل Xtream: ${error.message}`, 'error');
    const notice=el('xtreamTotalsNotice');
    if(notice){notice.className='stream-totals-notice warning';notice.textContent='تعذر قراءة أعداد المحتوى من السيرفر: '+error.message;}
    el('xtreamLoading').hidden=true;
  }
}

async function addXtream(event) {
  event.preventDefault();
  const button = el('xtAddBtn');
  const rightsConfirmed=el('xtRightsConfirmed').checked;
  if(!rightsConfirmed){showMessage('يلزم تأكيد صلاحية توزيع المحتوى.','error');return;}
  const host=el('xtBaseUrl').value.trim();
  let label=el('xtName').value.trim();
  if(!label){try{label='XTREAM · '+new URL(host).hostname}catch{label='BLOFY Xtream'}}
  let createdId=null;
  button.disabled = true;
  const old = button.textContent;
  button.textContent = 'يتم الإضافة…';
  try {
    const data = await api('/api/v1/admin/xtream/servers', {
      method: 'POST',
      body: JSON.stringify({
        name: label,
        baseUrl: host,
        username: el('xtUsername').value,
        password: el('xtPassword').value,
        priority: Number(el('xtPriority').value || 100),
        enabled: el('xtEnabled').checked,
        publishCatalog: el('xtPublish').checked,
        rightsConfirmed
      })
    });
    const id = data.item?.id;
    if (!id) throw new Error('xtream_create_failed');
    createdId=id;
    button.textContent = 'يتم الفحص…';
    await api(`/api/v1/admin/xtream/servers/${id}/test`, { method: 'POST', body: '{}' });
    button.textContent = 'بدء الاستيراد…';
    await api(`/api/v1/admin/xtream/servers/${id}/sync`, { method: 'POST', body: JSON.stringify({ types: ['live','movie','series'] }) });
    el('xtreamForm').reset();
    el('xtEnabled').checked = true;
    el('xtPublish').checked = true;
    el('xtPriority').value = '100';
    showMessage('تمت إضافة السيرفر وفحصه وبدأ استيراد Live + Movies + Series.');
    await loadXtream();
  } catch (error) {
    const raw=String(error.message||error);
    const reason=raw.includes('403')?'المصدر رفض الاتصال من سيرفر BLOFY (403). راجع صلاحيات المصدر أو السماح لاتصال السيرفر؛ لا يمكن تجاوز المنع من BLOFY.':
      raw.includes('401')?'بيانات الدخول غير مقبولة من المصدر (401).':
      raw.includes('404')?'رابط المصدر أو واجهة Xtream غير متاحة (404).':raw;
    showMessage(createdId
      ?'حُفظ المصدر، لكن لم تكتمل عملية الفحص أو الاستيراد: '+reason+' يمكنك إعادة الفحص من بطاقة المصدر.'
      :'تعذر إضافة المصدر: '+reason,'error');
    if(createdId)await loadXtream().catch(()=>{});
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
    if (action === 'toggle-enabled' || action === 'toggle-publish') {
      const isEnable=action==='toggle-enabled';
      const next=isEnable?!item.enabled:!item.publishCatalog;
      const payload=isEnable?{enabled:next}:{publishCatalog:next};
      await api(`/api/v1/admin/xtream/servers/${item.id}`, {
        method:'PATCH',body:JSON.stringify(payload)
      });
      showMessage(isEnable
        ?(`تم ${next?'تفعيل':'إيقاف'} مصدر «${item.name}»`)
        :(`تم ${next?'نشر':'إخفاء'} محتوى «${item.name}» ${next?'لعملائك':'عن عملائك'}`));
    } else if (action === 'test') {
      await api(`/api/v1/admin/xtream/servers/${item.id}/test`, { method: 'POST', body: '{}' });
      showMessage(`اتصال ${item.name} ناجح.`);
    } else if (action === 'save') {
      const input=role=>card.querySelector('[data-role="'+role+'"]').value.trim();
      const next={
        name:input('name'),baseUrl:input('baseUrl'),
        priority:Number(input('priority'))
      };
      if(input('username'))next.username=input('username');
      if(input('password'))next.password=input('password');
      await api(`/api/v1/admin/xtream/servers/${item.id}`, {
        method:'PATCH',body:JSON.stringify(next)
      });
      showMessage('تم حفظ تعديل مصدر «'+item.name+'». اضغط «فحص الاتصال» ثم «مزامنة المحتوى» إذا غيّرت بيانات Host أو Username أو Password.');
    } else if (action === 'delete') {
      const total=Number(item.counts?.total||0).toLocaleString('en-US');
      if(!window.confirm(`حذف مصدر «${item.name}» نهائيًا من BLOFY؟\\nسيتم حذف ${total} عنصر مستورد منه ولن يظهر محتواه لعملائك.\\nلن يتأثر اشتراكك الأصلي لدى مزود Xtream.\\n\\nهل تؤكد الحذف؟`))return;
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
  title.append(make('small', '', meta.join(' · ') || item.type));
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
el('xtSourceSearch').addEventListener('input', renderXtream);
el('xtSourceFilter').addEventListener('change', renderXtream);
el('xtNewSourceBtn').addEventListener('click', () => {
  el('xtAddSourceSection').scrollIntoView({behavior:'smooth',block:'center'});
  el('xtName').focus({preventScroll:true});
});
el('xtRefreshSourcesBtn').addEventListener('click', ()=>loadXtream().catch(error=>showMessage('تعذر تحديث مصادر Xtream: '+error.message,'error')));

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
