const el = id => document.getElementById(id);
const state = {
  xtreamServers: [],
  xtreamTotals: {},
  xtreamLoadSequence: 0,
  nativeCsrfToken: '',
  sourceFeedback: new Map(),
  categories: [],
  catalog: [],
  catalogOffset: 0,
  catalogQueryKey: '',
  catalogRequestSerial: 0,
  activeTab: 'xtream',
  pollTimer: null
};
const TAB_NAMES = new Set(['xtream', 'catalog', 'studio']);
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
  showMessage.timer = window.setTimeout(() => { box.hidden = true; }, kind === 'error' ? 16000 : 8500);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  if (response.status === 401) {
    window.location.href = '/admin';
    throw new Error('unauthorized');
  }
  let body = {};
  try { body = await response.json(); } catch {}
  if (!response.ok) {
    const errors={
      xtream_source_busy_retry:'المصدر مشغول بمزامنة كبيرة في قاعدة البيانات. أوقفت بدء دفعات جديدة؛ أعد المحاولة بعد قليل.',
      xtream_unavailable:'تعذر الوصول لقاعدة بيانات المصادر. التغيير لم يُحفظ؛ جرّب مرة أخرى.',
      xtream_server_not_found:'المصدر غير موجود أو سُجل حذفه بالفعل.'
    };
    const reason=String(body.error||'');
    throw new Error(errors[reason]||reason||`HTTP ${response.status}`);
  }
  return body;
}

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function xtStatusClass(status) {
  if (status === 'online') return 'online';
  if (status === 'syncing') return 'syncing';
  if (status === 'offline' || status === 'error') return 'offline';
  return 'unknown';
}

function nativeSourceForm(id, action, label, cls='button ghost') {
  const form=make('form','source-native-form');
  form.method='post';
  form.action='/api/v1/admin/xtream/controls/'+encodeURIComponent(id)+'/'+action+
    (state.nativeCsrfToken?'?csrf='+encodeURIComponent(state.nativeCsrfToken):'');
  const button=make('button',cls,label);
  button.type='submit';
  button.dataset.action=action;
  form.append(button);
  return form;
}

function xtreamProviderHintText(value){
  // Fixed text only. No provider response body, source credentials, IPs,
  // request paths or untrusted provider-controlled strings appear in the UI.
  const hints={
    network_restriction:'رد المصدر يشير إلى قيد IP أو الدولة أو مزود الإنترنت؛ اطلب السماح من المزود',
    connection_limit:'رد المصدر يشير إلى حد الاتصالات المتزامنة',
    account_expired:'رد المصدر يشير إلى انتهاء الاشتراك',
    restream_not_allowed:'رد المصدر يشير إلى عدم السماح بإعادة البث لهذا الحساب',
    output_format_rejected:'رد المصدر يشير إلى صيغة تشغيل غير مسموحة',
    account_inactive:'رد المصدر يشير إلى حساب معطّل أو محظور'
  };
  return hints[String(value||'')]||'';
}

function xtreamSourceErrorText(value){
  const error=String(value||'');
  if(error.includes('xtream_catalog_empty_preserved'))
    return 'المصدر أرسل قائمة فارغة؛ احتفظنا بالمحتوى القديم لحماية مكتبة المشتركين. افحص حساب Xtream ثم أعد المزامنة.';
  if(error.includes('xtream_catalog_suspicious_drop_preserved'))
    return 'المصدر أرسل قائمة ناقصة بشكل كبير؛ تم إيقاف حذف المحتوى القديم. تحقق من الاشتراك وحدود المصدر قبل إعادة المزامنة.';
  if(error.includes('xtream_categories_preserved'))
    return 'لم تصل الأقسام كاملة من المصدر؛ احتفظنا بأقسامك وترتيبها وإعدادات إخفائها.';
  if(error.includes('xtream_http_403'))
    return 'المصدر الأصلي رفض اتصال سيرفر BLOFY (403). تحقق من صلاحيات المصدر أو السماح بالاتصال لدى المزود.';
  if(error.includes('xtream_http_404'))
    return 'واجهة Xtream بالمصدر أعادت 404. راجع الهوست والمنفذ وصلاحية واجهة المصدر.';
  if(error.includes('xtream_source_busy_retry')||error.includes('lock timeout'))
    return 'قاعدة البيانات مشغولة بمزامنة أخرى. جرّب بعد انتهائها، ولا تكرر المزامنة بسرعة.';
  return error;
}

function updateSourceMediaIndicators(container,item){
  container.querySelectorAll('.media-health-pill').forEach(node=>node.remove());
  for(const row of (Array.isArray(item.mediaSummary)?item.mediaSummary:[]).slice(0,4)){
    if(!row?.text)continue;
    const state=['on','off','hidden'].includes(row.className)?row.className:'hidden';
    const pill=make('span','source-state-pill media-health-pill '+state,String(row.text).slice(0,100));
    container.append(pill);
  }
}
function updateSourceAccountWarnings(info,item){
  info.querySelectorAll('.account-health-warning').forEach(node=>node.remove());
  for(const message of (Array.isArray(item.mediaWarnings)?item.mediaWarnings:[]).slice(0,3)){
    if(typeof message!=='string'||!message)continue;
    info.append(make('span','account-health-warning',message.slice(0,200)));
  }
}

function serverCard(item) {
  const card = make('article', 'server-card');
  card.dataset.id = item.id;
  card._latestSource = item;
  // A changing status is not a reason to destroy the user's active form.
  card.dataset.renderSignature = JSON.stringify(item);
  card.dataset.busy = '0';
  const header = make('div', 'server-head');
  const title = make('div');
  title.append(make('strong', '', item.name));
  if(item.featured&&item.type==='live')title.append(make('span','studio-featured-pill','★ مميزة'));
  if(item.channelNumber&&item.type==='live')title.append(make('small','','رقم القناة: '+item.channelNumber));
  title.append(make('code', 'server-url', item.baseUrl));
  title.append(make('small','source-id','ID: '+String(item.id||'').slice(0,8)));
  const status = make('span', `server-status ${xtStatusClass(item.syncing ? 'syncing' : item.status)}`, item.syncing ? 'Syncing' : (item.status==='online'?'API ONLINE':item.status));
  header.append(title, status);

  const metrics = make('div', 'server-metrics');
  [['Live', item.counts?.live], ['Movies', item.counts?.movie], ['Series', item.counts?.series], ['Total', item.counts?.total]].forEach(([label, value]) => {
    const box = make('div');
    box.append(make('span', '', label), make('strong', '', String(Number(value || 0).toLocaleString())));
    metrics.append(box);
  });

  const settings = make('details', 'server-advanced');
  const advancedSummary = make('summary', '', 'تعديل بيانات المصدر · مزامنة أنواع محددة');
  const advancedFields = make('div', 'server-settings');
  const editForm=make('form','source-native-edit');
  editForm.method='post';
  editForm.action='/api/v1/admin/xtream/controls/'+encodeURIComponent(item.id)+'/save'+
    (state.nativeCsrfToken?'?csrf='+encodeURIComponent(state.nativeCsrfToken):'');
  editForm.append(advancedFields);
  settings.append(advancedSummary,editForm);
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
    input.name=role;
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
    ['اختبار بث قناة', 'probe-live', 'button ghost'],
    ['اختبار تشغيل فيلم', 'probe-movie', 'button ghost'],
    ['اختبار بيانات مسلسل', 'probe-series', 'button ghost'],
    ['اختبار تشغيل حلقة', 'probe-episode', 'button ghost'],
    ['حذف المصدر', 'delete', 'button danger']
  ];
  if(item.syncing||item.status==='syncing'){
    buttons.splice(2,0,['⏹ إلغاء المزامنة','cancel-sync','button ghost']);
  }
  buttons.forEach(([text, action, cls]) => {
    if(action==='delete'){
      const link=make('a',cls,text);
      link.href='/api/v1/admin/xtream/controls/'+encodeURIComponent(item.id)+'/confirm-delete';
      link.dataset.action='delete';
      actions.append(link);
      return;
    }
    const form=nativeSourceForm(item.id,action,text,cls);
    form.querySelector('button').disabled=item.syncing && action.startsWith('sync');
    actions.append(form);
  });

  const extraActions = make('div', 'server-actions server-actions-advanced');
  for (const [label, action] of [['Live فقط', 'sync-live'], ['أفلام فقط', 'sync-movie'], ['مسلسلات فقط', 'sync-series']]) {
    const form=nativeSourceForm(item.id,action,label);
    form.querySelector('button').disabled=item.syncing;
    extraActions.append(form);
  }
  const saveButton=make('button','button primary','حفظ التعديلات');
  saveButton.type='submit';
  editForm.append(saveButton);
  settings.append(extraActions);
  const info = make('div', 'server-info');
  if (item.accountInfo?.maxConnections != null) info.append(make('span', 'badge', `Max ${item.accountInfo.maxConnections}`));
  if (item.accountInfo?.activeConnections != null) info.append(make('span', 'badge', `Active ${item.accountInfo.activeConnections}`));
  if (item.lastSyncAt) info.append(make('span', 'muted', `آخر مزامنة: ${new Date(item.lastSyncAt).toLocaleString('ar-SA')}`));
  updateSourceAccountWarnings(info,item);
  if(item.syncProgress){
    const typeNames={starting:'تهيئة',live:'القنوات',movie:'الأفلام',series:'المسلسلات'};
    info.append(make('span','sync-progress-note',
      'جاري استيراد '+(typeNames[item.syncProgress.mediaType]||item.syncProgress.mediaType)+
      ' · '+Number(item.syncProgress.imported||0).toLocaleString('en-US')+' عنصر حتى الآن'));
  }
  if (item.lastError) info.append(make('span', 'error-text', `تنبيه المصدر: ${xtreamSourceErrorText(item.lastError)}`));
  const feedback=state.sourceFeedback.get(item.id);
  const actionStatus=make('p',feedback?.kind==='error'?'source-action-feedback error':'source-action-feedback',feedback?.text||'');
  actionStatus.setAttribute('role','status');
  actionStatus.hidden=!feedback;
  info.append(actionStatus);

  // Source actions are handled by one stable capturing listener on document.
  // Never attach the handler to nodes that background polling may replace.
  const indicators = make('div', 'source-quick-status');
  indicators.append(
    make('span', item.enabled ? 'source-state-pill on' : 'source-state-pill off', item.enabled ? '● المصدر مفعّل' : '● المصدر موقوف'),
    make('span', item.enabled && item.publishCatalog ? 'source-state-pill published' : 'source-state-pill hidden', item.enabled && item.publishCatalog ? '● منشور للمشتركين' : '○ غير ظاهر للمشتركين')
  );
  updateSourceMediaIndicators(indicators,item);
  card.append(header, indicators, metrics, actions, settings, info);
  return card;
}

function refreshSourceCard(card, item) {
  // Keep card and all its buttons mounted while data changes.
  // Source clicks previously disappeared before their own event handlers ran.
  card._latestSource=item;
  card.dataset.renderSignature=JSON.stringify(item);
  const status=card.querySelector('.server-status');
  if(status) {
    status.className='server-status '+xtStatusClass(item.syncing?'syncing':item.status);
    status.textContent=item.syncing?'Syncing':item.status==='online'?'API ONLINE':String(item.status||'unknown');
  }
  const title=card.querySelector('.server-head > div');
  if(title) {
    const name=title.querySelector('strong');
    const host=title.querySelector('.server-url');
    if(name)name.textContent=item.name;
    if(host)host.textContent=item.baseUrl;
  }
  for(const [index,value] of [item.counts?.live,item.counts?.movie,item.counts?.series,item.counts?.total].entries()){
    const total=card.querySelectorAll('.server-metrics strong')[index];
    if(total)total.textContent=Number(value||0).toLocaleString('en-US');
  }
  const pills=card.querySelectorAll('.source-quick-status .source-state-pill');
  if(pills[0]){
    pills[0].className='source-state-pill '+(item.enabled?'on':'off');
    pills[0].textContent=item.enabled?'● المصدر مفعّل':'● المصدر موقوف';
  }
  if(pills[1]){
    pills[1].className='source-state-pill '+(item.enabled&&item.publishCatalog?'published':'hidden');
    pills[1].textContent=item.enabled&&item.publishCatalog?'● منشور للمشتركين':'○ غير ظاهر للمشتركين';
  }
  updateSourceMediaIndicators(card.querySelector('.source-quick-status'),item);
  const enabledButton=card.querySelector('button[data-action="toggle-enabled"]');
  if(enabledButton){
    enabledButton.textContent=item.enabled?'⏸ إيقاف المصدر':'▶ تفعيل المصدر';
    enabledButton.className=item.enabled?'button source-toggle-stop':'button primary';
  }
  const publishedButton=card.querySelector('button[data-action="toggle-publish"]');
  if(publishedButton){
    publishedButton.textContent=item.publishCatalog?'إخفاء المحتوى عن العملاء':'نشر المحتوى للعملاء';
    publishedButton.className=item.publishCatalog?'button ghost':'button primary';
  }
  card.querySelectorAll('button[data-action^="sync-"]').forEach(button=>{
    button.disabled=Boolean(item.syncing);
  });
  const buttons=card.querySelector('.server-actions:not(.server-actions-advanced)');
  let cancel=buttons?.querySelector('button[data-action="cancel-sync"]');
  if(item.syncing||item.status==='syncing'){
    if(!cancel&&buttons){
      const form=nativeSourceForm(item.id,'cancel-sync','⏹ إلغاء المزامنة');
      cancel=form.querySelector('button');
      buttons.insertBefore(form,buttons.querySelector('button[data-action="sync-all"]')?.closest('form')||null);
    }
  }else if(cancel){
    cancel.closest('form')?.remove();
  }
  const info=card.querySelector('.server-info');
  if(info){
    updateSourceAccountWarnings(info,item);
    let progress=info.querySelector('.sync-progress-note');
    if(item.syncProgress){
      if(!progress){progress=make('span','sync-progress-note');info.prepend(progress);}
      const types={starting:'تهيئة',live:'القنوات',movie:'الأفلام',series:'المسلسلات'};
      progress.textContent='جاري استيراد '+(types[item.syncProgress.mediaType]||item.syncProgress.mediaType)+' · '+
        Number(item.syncProgress.imported||0).toLocaleString('en-US')+' عنصر';
    }else progress?.remove();
    let error=info.querySelector('.error-text');
    if(item.lastError){
      if(!error){error=make('span','error-text');info.append(error);}
      error.textContent='تنبيه المصدر: '+xtreamSourceErrorText(item.lastError);
    }else error?.remove();
  }
}

function renderXtream() {
  const totals = state.xtreamTotals || {};
  el('xtServers').textContent = String(totals.servers || 0);
  el('xtOnline').textContent = String(totals.online || 0);
  el('xtLive').textContent = Number(totals.live || 0).toLocaleString();
  el('xtMovies').textContent = Number(totals.movie || 0).toLocaleString();
  el('xtSeries').textContent = Number(totals.series || 0).toLocaleString();
  renderStudioOverview();
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
  const query=String(el('xtSourceSearch')?.value||'').trim().toLowerCase();
  const filter=String(el('xtSourceFilter')?.value||'all');
  const visible=state.xtreamServers.filter(item=>
    (!query||String(item.name+' '+item.baseUrl).toLowerCase().includes(query)) &&
    (filter==='all'||(filter==='enabled'&&item.enabled)||(filter==='disabled'&&!item.enabled)||(filter==='published'&&item.enabled&&item.publishCatalog))
  );
  const countEnabled=state.xtreamServers.filter(x=>x.enabled).length;
  const countPublished=state.xtreamServers.filter(x=>x.enabled&&x.publishCatalog).length;
  el('xtSourceSummary').textContent='الإجمالي: '+state.xtreamServers.length+' · المفعلة: '+countEnabled+' · المنشورة: '+countPublished+' · المعروضة: '+visible.length;
  // Keyed reconciliation is critical for large imports. Previously the whole
  // list was destroyed every 3.5 seconds: buttons vanished, opened editors
  // collapsed and typing was lost even when no server-side change happened.
  const existing=new Map([...list.querySelectorAll(':scope > article.server-card[data-id]')]
    .map(card=>[card.dataset.id,card]));
  const desired=[];
  for(const item of visible){
    const old=existing.get(item.id);
    if(old) {
      refreshSourceCard(old,item);
      desired.push(old);
    }else desired.push(serverCard(item));
  }
  if(desired.length===0){
    const hint=make('div','empty',state.xtreamServers.length
      ?'ما فيه مصادر تطابق البحث أو الفلتر الحالي.'
      :'ما عندك مصادر Xtream مضافة. اضغط «+ إضافة Xtream جديد» للبدء.');
    list.replaceChildren(hint);
  }else{
    // Do not move a card already in the correct position, because doing so
    // blurs focused fields in some browsers.
    for(let i=0;i<desired.length;i++){
      if(list.children[i]!==desired[i])list.insertBefore(desired[i],list.children[i]||null);
    }
    const allowed=new Set(desired);
    for(const node of [...list.children])if(!allowed.has(node))node.remove();
  }
  el('xtreamLoading').hidden = true;
  list.hidden = false;
  updateCatalogServerOptions();
}

function scheduleXtreamPoll() {
  window.clearTimeout(state.pollTimer);
  // A persisted 'syncing' status can survive a service restart. Poll only
  // while a real import is in progress rather than replacing cards forever.
  const busy = state.xtreamServers.some(item => item.syncing === true);
  if (!busy) return;
  state.pollTimer = window.setTimeout(async () => {
    await loadXtream(true);
    scheduleXtreamPoll();
  }, 3500);
}

async function loadXtream(silent = false, strict = false) {
  const seq=++state.xtreamLoadSequence;
  if (!silent) el('xtreamLoading').hidden = false;
  try {
    const data = await api('/api/v1/admin/xtream/servers');
    // Ignore stale requests started before a later refresh or mutation.
    if(seq!==state.xtreamLoadSequence) {
      if(strict)throw new Error('xtream_readback_superseded');
      return null;
    }
    state.nativeCsrfToken=String(data.csrfToken||'');
    state.xtreamServers = Array.isArray(data.items) ? data.items : [];
    state.xtreamTotals = data.totals || {};
    renderXtream();
    smartSources();
    scheduleXtreamPoll();
    return data;
  } catch (error) {
    if (!silent) showMessage(`تعذر تحميل Xtream: ${error.message}`, 'error');
    const notice=el('xtreamTotalsNotice');
    if(notice){notice.className='stream-totals-notice warning';notice.textContent='تعذر قراءة أعداد المحتوى من السيرفر: '+error.message;}
    el('xtreamLoading').hidden=true;
    if(strict)throw error;
    return null;
  }
}

function renderStudioOverview(){
  const box=el('studioQuickStats'),alerts=el('studioSourceAlerts');
  if(!box||!alerts)return;
  box.replaceChildren();alerts.replaceChildren();
  const sources=state.xtreamServers||[];
  const now=Date.now();
  const published=sources.filter(x=>x.enabled&&x.publishCatalog);
  const flagged=sources.filter(x=>x.enabled&&(x.lastError||x.status==='offline'||x.status==='error'));
  const stale=sources.filter(x=>x.enabled&&x.publishCatalog&&x.lastSyncAt&&now-Number(x.lastSyncAt)>48*3600_000);
  const untested=sources.filter(x=>x.enabled&&!x.lastTestAt);
  const stats=[
    ['المصادر المسجلة',sources.length],
    ['مفهرسة ومنشورة',published.length],
    ['تحتاج متابعة',flagged.length],
    ['مزامنتها قديمة',stale.length],
    ['لم تُفحص',untested.length]
  ];
  for(const [label,count] of stats){
    const card=make('div','studio-stat');
    card.append(make('small','',label),make('strong','',Number(count).toLocaleString('en-US')));
    box.append(card);
  }
  const warns=[...new Map([...flagged,...stale,...untested].map(x=>[x.id,x])).values()].slice(0,8);
  if(!sources.length)alerts.append(make('p','muted','أضف مصدر Xtream لعرض حالته هنا.'));
  else if(!warns.length)alerts.append(make('p','studio-notice ok','لا توجد تحذيرات فهرسة مسجلة. تأكد من تشغيل الفيديو بالفحص الفعلي.'));
  for(const item of warns){
    const detail=item.lastError?xtreamSourceErrorText(item.lastError):
      item.status==='offline'||item.status==='error'?'المصدر لم ينجح في آخر اتصال أو مزامنة.':
      item.lastSyncAt&&now-Number(item.lastSyncAt)>48*3600_000?'آخر مزامنة أقدم من 48 ساعة.':
      'لا يوجد تاريخ فحص موثوق لهذا المصدر.';
    const row=make('div','studio-alert');
    row.append(make('strong','',item.name),make('span','',detail));
    const button=make('button','button ghost','عرض المصدر');
    button.type='button';
    button.addEventListener('click',()=>{
      const card=el('xtreamServers').querySelector('[data-id="'+item.id+'"]');
      if(card){card.scrollIntoView({behavior:'smooth',block:'center'});}
      else{el('xtSourceSearch').value=item.name;el('xtSourceFilter').value='all';renderXtream();}
    });
    row.append(button);alerts.append(row);
  }
}

async function loadCatalogAudit(){
  const button=el('catalogAuditBtn'),results=el('catalogAuditResults');
  const serverId=el('catalogServer').value,mediaType=el('catalogType').value;
  if(!serverId){showMessage('اختر مصدر Xtream أولًا.','error');return;}
  button.disabled=true;button.textContent='جارٍ قراءة العينة…';
  results.replaceChildren(make('p','muted','يجري فحص عينة محدودة بدون تعديل أي محتوى…'));
  try{
    const query=new URLSearchParams({serverId,type:mediaType});
    const report=await api('/api/v1/admin/xtream/catalog/insights?'+query);
    // Ignore stale responses if a source/type was changed while scanning.
    if(serverId!==el('catalogServer').value||mediaType!==el('catalogType').value)return;
    results.replaceChildren();
    const cards=make('div','catalog-audit-stats');
    for(const [title,count] of [
      ['عناصر العينة',report.sampledPrimary||0],
      ['صور ناقصة',report.missingPoster||0],
      ['سنة غير معروفة',report.missingYear||0],
      ['قصة غير متوفرة',report.missingPlot||0],
      ['مجموعات مكررة',report.duplicateGroupCount||0]
    ]){
      const card=make('article','catalog-audit-stat');
      card.append(make('small','',title),make('strong','',Number(count).toLocaleString('en-US')));
      cards.append(card);
    }
    results.append(cards);
    const section=(title,rows,render)=>{
      const box=make('section','catalog-audit-section');
      box.append(make('h4','',title));
      if(!rows?.length)box.append(make('p','muted','لم تظهر نتائج في هذه العينة.'));
      else for(const item of rows.slice(0,10))box.append(render(item));
      return box;
    };
    results.append(section('النسخ المكررة المحتملة',report.duplicateGroups,row=>{
      const card=make('div','catalog-audit-result');
      card.append(make('strong','',row.name),
        make('small','',String(row.copies)+' نسخ · '+(row.year??'سنة غير معروفة')));
      return card;
    }));
    results.append(section('بدائل محتملة من مصادر أخرى (للمراجعة فقط)',report.candidateAlternatives,row=>{
      const card=make('div','catalog-audit-result');
      card.append(make('strong','',row.name),
        make('small','',(row.otherSources||[]).join('، ')+' · لم يُتحقق من التشغيل أو حقوق المصدر'));
      return card;
    }));
    results.append(make('p','muted','المعاينة محدودة إلى '+Number(report.sampledPrimary||0).toLocaleString('en-US')+
      ' عنصر من المصدر و'+Number(report.sampledOther||0).toLocaleString('en-US')+
      ' من المصادر الأخرى. لا تحذف النسخ أو تختار مصدر تشغيل احتياطي تلقائيًا.'));
  }catch(error){
    results.replaceChildren(make('p','muted','تعذر فحص عينة المكتبة: '+error.message));
  }finally{button.disabled=false;button.textContent='فحص عينة المكتبة';}
}

// Operator-initiated batch probes: one authorized source sample at a time.
// Keep requests bounded and cancelable; never start continuous provider scans.
let sourceBatchProbe=null;
async function runXtreamBatchProbe(){
  if(sourceBatchProbe)return;
  const search=String(el('xtSourceSearch').value||'').trim().toLocaleLowerCase();
  const filter=el('xtSourceFilter').value;
  const available=state.xtreamServers.filter(row=>row.enabled&&filter!=='disabled'&&
    (!search||String(row.name+' '+row.baseUrl).toLocaleLowerCase().includes(search))&&
    (filter!=='published'||row.publishCatalog));
  if(!available.length){showMessage('لا توجد مصادر مفعّلة مطابقة للفحص.','error');return;}
  const sources=available.slice(0,6);
  const kinds=[['live','قناة'],['movie','فيلم'],['series','بيانات مسلسل'],['episode','حلقة']];
  const total=sources.length*kinds.length;
  const panel=el('xtBatchProbePanel'),list=el('xtBatchProbeResults');
  const summary=el('xtBatchProbeSummary'),progress=el('xtBatchProbeProgress');
  panel.hidden=false;list.replaceChildren();
  progress.value=0;progress.max=total;
  const session={cancelled:false,controller:null,finished:0,passed:0,failed:0};
  sourceBatchProbe=session;
  el('xtProbeAllBtn').disabled=true;
  summary.textContent='بدء فحص '+sources.length+' مصادر · '+total+' عيّنة'+
    (available.length>sources.length?' · عُرض أول 6 مصادر لتجنب الضغط الزائد.':'');
  panel.scrollIntoView({behavior:'smooth',block:'center'});
  try{
    outer:for(const source of sources){
      for(const [kind,label] of kinds){
        if(session.cancelled)break outer;
        const row=make('div','xt-batch-probe-row');
        row.append(make('strong','',source.name+' · '+label),make('span','status','جارٍ الفحص…'));
        list.append(row);
        const status=row.querySelector('.status');
        const controller=new AbortController();session.controller=controller;
        const timeout=setTimeout(()=>controller.abort(),14500);
        try{
          const result=await api('/api/v1/admin/xtream/servers/'+encodeURIComponent(source.id)+'/probe-playback',{
            method:'POST',body:JSON.stringify({mediaType:kind}),signal:controller.signal
          });
          if(result.ok){
            session.passed++;
            status.className='status passed';
            const sample=(result.checks||[]).find(x=>x.ok);
            const failedSamples=(result.checks||[]).filter(x=>x&&!x.ok).length;
            const formats=kind==='live'?(result.checks||[])
              .filter(x=>['ts','m3u8'].includes(x.outputFormat))
              .map(x=>x.outputFormat.toUpperCase()+' '+(x.httpStatus?'HTTP '+x.httpStatus:(x.error||'تعذر الاتصال'))):[];
            status.textContent='✓ وصلت البيانات'+(sample?.episodeCount?' · '+sample.episodeCount+' حلقة':'')+
              (sample?.httpStatus?' · HTTP '+sample.httpStatus:'')+
              (failedSamples?' · نجحت عينة بعد '+failedSamples+' عينة فاشلة':'')+
              (formats.length?' · '+formats.join(' / '):'');
          }else{
            session.failed++;
            status.className='status failed';
            const sample=(result.checks||[]).find(x=>!x.ok&&[401,403,456,429].includes(Number(x.httpStatus))) ||
              (result.checks||[]).find(x=>!x.ok);
            const http=Number(sample?.httpStatus);
            const reason=String(sample?.error||result.reason||'');
            const known={
              empty_media:'بث فارغ',upstream_non_media_response:'استجابة نصية بدل فيديو',
              no_imported_items:'لا يوجد محتوى مستورد',output_format_not_allowed:'لا توجد TS أو M3U8 مصرح بها لهذا الحساب',no_episode_info:'تفاصيل حلقات غير متاحة',
              no_playable_episodes:'لا توجد حلقات',timeout:'انتهت مهلة المصدر',
              upstream_unreachable:'فشل الاتصال بالمصدر'
            };
            const statuses={
              401:'المصدر رفض بيانات الدخول',
              403:'المصدر يمنع تشغيل هذه العينة',
              404:'رابط الملف غير موجود لدى المصدر؛ قد تعمل عناصر أخرى',
              429:'تجاوز حد الطلبات أو الاتصالات',
              456:'رمز غير قياسي من المصدر؛ راجع السماح بتشغيل الفيديو لدى المزود'
            };
            status.textContent='✕ '+(http>=400&&http<=599?'HTTP '+http+' · ':'')+
              (statuses[http]||known[reason]||'المصدر لم يؤكد تشغيل العينة')+
              (xtreamProviderHintText(sample?.providerHint)?' · '+xtreamProviderHintText(sample?.providerHint):'')+
              (kind==='live'&&['ts','m3u8'].includes(sample?.outputFormat)?' · '+sample.outputFormat.toUpperCase():'');
            // Denied media is not automatically switched to an unverified
            // source. Offer the operator an explicit reversible unpublish.
            if([403,456].includes(http)&&source.publishCatalog){
              const pause=make('button','button ghost xt-denial-pause','إخفاء هذا المصدر عن المشتركين');
              pause.type='button';
              pause.title='إيقاف النشر فقط. يحتفظ BLOFY بالمصدر والمكتبة وحسابات المشتركين.';
              pause.addEventListener('click',async()=>{
                if(!window.confirm('المصدر «'+source.name+'» رفض تشغيل العينة (HTTP '+http+'). هل تريد إخفاء محتواه مؤقتًا عن المشتركين؟ لن يُحذف المصدر أو بياناته.'))return;
                pause.disabled=true;
                try{
                  const changed=await api('/api/v1/admin/xtream/servers/'+encodeURIComponent(source.id),{
                    method:'PATCH',body:JSON.stringify({publishCatalog:false})
                  });
                  if(changed.item?.publishCatalog!==false)throw new Error('لم يؤكد السيرفر إيقاف النشر.');
                  await loadXtream(true,true);
                  const verified=state.xtreamServers.find(item=>item.id===source.id);
                  if(!verified||verified.publishCatalog!==false)
                    throw new Error('حالة النشر غير مؤكدة بعد إعادة القراءة.');
                  source.publishCatalog=false;
                  pause.remove();
                  showMessage('✓ تم إخفاء محتوى «'+source.name+'» عن المشتركين. المصدر محفوظ ويمكن إعادة نشره من بطاقة المصدر.');
                }catch(error){
                  showMessage('تعذر إخفاء المصدر: '+error.message,'error');
                  pause.disabled=false;
                }
              });
              row.append(pause);
            }
          }
        }catch(error){
          if(session.cancelled)break outer;
          session.failed++;status.className='status failed';
          status.textContent=controller.signal.aborted?'انتهت مهلة العينة (14.5 ثانية)':
            'تعذر الفحص: '+String(error.message||'خطأ').slice(0,90);
        }finally{
          clearTimeout(timeout);session.controller=null;
          session.finished++;progress.value=session.finished;
          summary.textContent='المكتمل: '+session.finished+'/'+total+
            ' · ناجح: '+session.passed+' · تعذر: '+session.failed;
        }
      }
    }
  }finally{
    sourceBatchProbe=null;
    el('xtProbeAllBtn').disabled=false;
    summary.textContent=(session.cancelled?'أُلغي الفحص. ':'انتهى فحص العينات. ')+
      'نجح '+session.passed+' من '+session.finished+' اختبار؛ '+
      'فشل '+session.failed+'. النتائج تخص العينات ولا تثبت تشغيل جميع العناصر.';
    // Probes persist sanitized media status per source. Refresh cards now so
    // operators immediately see API ONLINE vs rejected media samples.
    try{await loadXtream(true)}catch(error){
      console.warn('Xtream probe card refresh failed:',String(error?.message||'unknown').slice(0,100));
    }
  }
}
function cancelXtreamBatchProbe(){
  const current=sourceBatchProbe;
  if(!current)return;
  current.cancelled=true;
  current.controller?.abort();
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
    showMessage('تم حفظ حساب Xtream وبدء الاستيراد. راجع قسم المصادر للتأكد من الأعداد وحالة النشر.');
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
  card.dataset.busy = '1';
  button.disabled = true;
  const old = button.textContent;
  button.textContent = 'جارٍ الحفظ…';
  const writeFeedback=(message,kind='ok')=>{
    state.sourceFeedback.set(item.id,{text:message,kind});
    const target=card.querySelector('.source-action-feedback');
    if(target){
      target.textContent=message;
      target.classList.toggle('error',kind==='error');
      target.hidden=false;
    }
  };
  writeFeedback('تم استلام الضغط على الزر. جارٍ إرسال الطلب للسيرفر…');
  try {
    if (action === 'toggle-enabled' || action === 'toggle-publish') {
      const isEnable=action==='toggle-enabled';
      const next=isEnable?!item.enabled:!item.publishCatalog;
      const field=isEnable?'enabled':'publishCatalog';
      const payload=isEnable?{enabled:next}:{publishCatalog:next};
      const result=await api(`/api/v1/admin/xtream/servers/${item.id}`, {
        method:'PATCH',body:JSON.stringify(payload)
      });
      if(!result.item||Boolean(result.item[field])!==next){
        throw new Error('لم يؤكد السيرفر حفظ التغيير. لم نغير الحالة في الواجهة.');
      }
      // A source should never vanish just because a "published"/"enabled"
      // filter was selected when the administrator paused or hid it.
      if(el('xtSourceFilter').value!=='all'){
        el('xtSourceFilter').value='all';
      }
      await loadXtream(true,true);
      const saved=state.xtreamServers.find(source=>source.id===item.id);
      if(!saved||Boolean(saved[field])!==next){
        throw new Error('حالة المصدر لا تطابق التغيير بعد إعادة القراءة من قاعدة البيانات.');
      }
      showMessage(isEnable
        ?(`تم حفظ ${next?'تفعيل':'إيقاف'} المصدر «${item.name}» في قاعدة البيانات، وسيبقى كذلك بعد تحديث الصفحة.`)
        :(`تم حفظ ${next?'نشر':'إخفاء'} محتوى «${item.name}» ${next?'للعملاء':'عن العملاء'}.`));
    } else if (action === 'cancel-sync') {
      const result=await api('/api/v1/admin/xtream/servers/'+item.id+'/cancel-sync',{
        method:'POST',body:'{}'
      });
      if(result.cancelRequested)showMessage('تم طلب إلغاء مزامنة «'+item.name+'». سيكمل السيرفر إيقافها بعد الدفعة الحالية.');
      else showMessage(result.staleStateCleared
        ?'تم تصحيح حالة المزامنة القديمة للمصدر «'+item.name+'». يمكنك بدء مزامنة جديدة.'
        :'لا توجد مزامنة نشطة لهذا المصدر.');
      await loadXtream(true);
    } else if (['probe-live','probe-movie','probe-series','probe-episode'].includes(action)) {
      const mediaType=action.slice('probe-'.length);
      const labels={live:'قناة',movie:'فيلم',series:'بيانات مسلسل',episode:'حلقة من مسلسل'};
      writeFeedback('جارٍ فحص '+labels[mediaType]+' من مصدر Xtream مباشرة…');
      const result=await api('/api/v1/admin/xtream/servers/'+item.id+'/probe-playback',{
        method:'POST',body:JSON.stringify({mediaType})
      });
      const checked=Array.isArray(result.checks)?result.checks:[];
      const codeHint=check=>{
        const code=String(check.error||'');
        const status=check.httpStatus||(code.startsWith('xtream_http_')?Number(code.slice(12)):null);
        if(status===403)return '403: رفض المصدر تشغيل المحتوى أو الوصول للـ API';
        if(status===401)return '401: بيانات اعتماد المصدر مرفوضة';
        if(status===404)return '404: الرابط أو المحتوى غير موجود لدى المصدر';
        if(status===429)return '429: تجاوز حدود اتصال المصدر';
        if(status>=500)return status+': خلل في سيرفر المصدر';
        const failures={empty_media:'البث فارغ',timeout:'انتهت مهلة المصدر',
          no_episode_info:'تفاصيل الحلقات غير متاحة',no_playable_episodes:'لم توجد حلقات قابلة للتشغيل',
          series_response_invalid:'بيانات المسلسل غير صالحة',series_response_too_large:'حجم معلومات المسلسل كبير',
          upstream_html_instead_of_video:'المصدر يعيد صفحة بدل الفيديو',
          upstream_non_media_response:'المصدر يعيد رسالة أو صفحة بدل بيانات الفيديو (حتى مع HTTP 200)'};
        return failures[check.error]||'تعذر التحقق من البث';
      };
      const summary=checked.map(check=>
        check.title+' · '+(check.ok?'✓ HTTP '+check.httpStatus:codeHint(check))+
        (check.episodeCount?' · '+check.episodeCount+' حلقة':'')+
        (check.seasonCount?' · '+check.seasonCount+' موسمًا':'')+
        (check.rangeFallbackUsed?' · تمت إعادة التجربة بدون Range':'')).join(' | ');
      const message=result.ok
        ?'✓ نجح فحص '+labels[mediaType]+'؛ '+summary+
          ' · نجاح الفحص لا يؤكد استمرار الصوت والصورة.'
        :'تعذر فحص '+labels[mediaType]+'؛ '+(result.reason==='no_imported_items'
          ?'لا يوجد محتوى مستورد لهذا النوع حتى الآن. افحص المزامنة.':summary||'المصدر لا يرسل استجابة تشغيل صالحة.');
      writeFeedback(message,result.ok?'ok':'error');
      showMessage(message,result.ok?'success':'error');
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
      if(!window.confirm(`حذف مصدر «${item.name}» نهائيًا من BLOFY؟\nسيُخفى ${total} عنصر عن المشتركين فور حفظ الحذف في قاعدة البيانات.\nلن يتأثر الاشتراك الأصلي لدى مزود Xtream.\n\nهل تؤكد الحذف؟`))return;
      window.clearTimeout(state.pollTimer);
      const result=await api(`/api/v1/admin/xtream/servers/${item.id}`, { method: 'DELETE' });
      if(result.deletionQueued!==true||result.deletedFromCatalog!==true)
        throw new Error('لم يؤكد السيرفر حفظ الحذف. المصدر لم يُحذف من القائمة.');
      // DELETE only succeeds after PostgreSQL commits the deletion tombstone.
      // Verify the authoritative source listing before showing success.
      try {
        await loadXtream(true,true);
        if(state.xtreamServers.some(source=>source.id===item.id))
          throw new Error('المصدر ما زال ظاهرًا في استجابة القائمة الجديدة.');
        showMessage('تم حفظ حذف المصدر «'+item.name+'» في قاعدة البيانات. لن يرجع بعد التحديث. يجري تنظيف '+total+' عنصر بالخلفية.');
      } catch(readError) {
        // A committed DELETE must not be reported as a failed deletion just
        // because the follow-up display refresh timed out.
        showMessage('حُفظ طلب الحذف في قاعدة البيانات، لكن تعذّر تأكيد تحديث القائمة: '+readError.message,'error');
      }
    } else if (action.startsWith('sync-')) {
      const type = action === 'sync-all' ? ['live','movie','series'] : [action.replace('sync-', '')];
      await api(`/api/v1/admin/xtream/servers/${item.id}/sync`, { method: 'POST', body: JSON.stringify({ types: type }) });
      showMessage(`بدأت مزامنة ${item.name}.`);
    }
    if(!['toggle-enabled','toggle-publish','delete'].includes(action))await loadXtream(true);
  } catch (error) {
    writeFeedback('لم يُحفظ التغيير: '+error.message,'error');
    showMessage(`فشلت العملية: ${error.message}`, 'error');
  } finally {
    card.dataset.busy = '0';
    button.disabled = false;
    button.textContent = old;
    if(document.activeElement===button)button.blur();
    const status=state.sourceFeedback.get(item.id);
    if(status?.text==='تم استلام الضغط على الزر. جارٍ إرسال الطلب للسيرفر…'){
      const message='انتهى الطلب. النتيجة الدقيقة ظاهرة في رسالة الحالة أعلى اللوحة.';
      state.sourceFeedback.set(item.id,{text:message,kind:'ok'});
      const inline=card.querySelector('.source-action-feedback');
      if(inline)inline.textContent=message;
    }
    renderXtream();
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

const categorySmartUi={grouped:true};
function describeCategoryShelf(name,mediaType){
  const text=String(name||'').replace(/[٠-٩]/g,c=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)));
  const year=text.match(/(^|[^0-9])(19[5-9][0-9]|20[0-9]{2})(?=$|[^0-9])/);
  const groups=mediaType==='live'?[
    ['sports','⚽ رياضة',/رياضة|رياضي|sport|football|bein|كرة/iu],
    ['news','📰 أخبار',/أخبار|اخبار|news/iu],
    ['kids','🧸 أطفال',/أطفال|اطفال|kids|cartoon|كرتون/iu],
    ['entertainment','📺 ترفيه',/ترفيه|entertainment|general|عام/iu]
  ]:[
    ['arabic','🎬 عربي',/عرب(?:ي|ية|ى)?|عربيه|arabic/iu],
    ['foreign','🌍 أجنبي',/أجنبي|اجنبي|اجنبية|انجليزي|إنجليزي|english|foreign|hollywood|american|أمريكي|امريكي/iu],
    ['turkish','🇹🇷 تركي',/تركي|تركية|turkish|turkey/iu],
    ['indian','🇮🇳 هندي',/هندي|هندية|indian|hindi|bollywood/iu],
    ['korean','🇰🇷 كوري',/كوري|كورية|korean/iu],
    ['anime','✨ أنمي',/أنمي|انمي|anime|انيمي/iu],
    ['kids','🧸 أطفال',/أطفال|اطفال|kids|cartoon|كرتون/iu],
    ['documentary','🎞️ وثائقي',/وثائقي|وثائقية|documentary/iu]
  ];
  const index=groups.findIndex(([, ,pattern])=>pattern.test(text));
  const picked=groups[index]||['other',mediaType==='live'?'📡 بقية القنوات':'📁 أقسام أخرى'];
  return{key:picked[0],label:picked[1],priority:index<0?99:index,year:year?Number(year[2]):null};
}

function categoryRow(category,position,allLength){
  const row=make('article','category-manager-row'+(category.enabled?'':' hidden-category'));
  const info=make('div','category-manager-label');
  const title=make('div','category-smart-name');
  title.append(make('span','category-smart-index',String(position+1)),make('strong','',category.name));
  info.append(title);
  info.append(make('small','',Number(category.itemCount||0).toLocaleString('en-US')+' عنصر · '+(category.enabled?'ظاهر للمشتركين':'مخفي عن المشتركين')));
  const actions=make('div','category-manager-actions');
  for(const [label,action,titleText,disabled] of [
    ['للأول','top','ضع هذا القسم أولًا في ترتيب تطبيقات المشتركين',position===0],
    ['↑','up','رفع في الترتيب الحقيقي',position===0],
    ['↓','down','خفض في الترتيب الحقيقي',position===allLength-1],
    [category.enabled?'إخفاء':'إظهار','toggle',category.enabled?'إخفاء القسم عن المشتركين':'إظهار القسم للمشتركين',false]
  ]){
    const button=make('button','button ghost',label);
    button.type='button';button.dataset.action=action;button.dataset.categoryId=category.id;
    button.title=titleText;button.disabled=disabled;actions.append(button);
  }
  row.append(info,actions);
  return row;
}

function renderCategoryManager(){
  const target=el('categoryManagerRows');
  if(!target)return;
  target.replaceChildren();
  target.classList.toggle('is-grouped',categorySmartUi.grouped);
  const all=state.categories||[];
  const query=String(el('categorySearch')?.value||'').trim().toLocaleLowerCase();
  const visibility=el('categoryVisibility')?.value||'all';
  const mediaType=el('catalogType').value;
  const matches=all.map((item,index)=>({...item,originalPosition:index})).filter(item=>
    (!query||String(item.name||'').toLocaleLowerCase().includes(query))&&
    (visibility==='all'||(visibility==='hidden'?!item.enabled:item.enabled))
  );
  const visible=all.filter(item=>item.enabled).length;
  el('categoryManagerSummary').textContent=
    'الأقسام: '+all.length.toLocaleString('en-US')+
    ' · الظاهرة: '+visible.toLocaleString('en-US')+
    ' · المخفية: '+(all.length-visible).toLocaleString('en-US')+
    ' · نتائج العرض: '+matches.length.toLocaleString('en-US');
  const show=matches.slice(0,240);
  if(!show.length){
    target.append(make('p','empty','ما توجد أقسام مطابقة. جرّب تغيير البحث أو اختيار مصدر آخر.'));
    return;
  }
  if(!categorySmartUi.grouped){
    for(const item of show)target.append(categoryRow(item,item.originalPosition,all.length));
  }else{
    const sections=new Map();
    for(const item of show){
      const info=describeCategoryShelf(item.name,mediaType);
      let section=sections.get(info.key);
      if(!section){section={...info,years:new Map(),total:0,items:0};sections.set(info.key,section);}
      const yearKey=mediaType==='live'?'all':String(info.year??'unknown');
      if(!section.years.has(yearKey))section.years.set(yearKey,[]);
      section.years.get(yearKey).push(item);
      section.total++;
      section.items+=Number(item.itemCount||0);
    }
    const ordered=[...sections.values()].sort((a,b)=>a.priority-b.priority);
    ordered.forEach((section,sectionIndex)=>{
      const outer=make('details','category-smart-section');
      outer.open=sectionIndex===0||Boolean(query);
      const head=make('summary','category-smart-section-head');
      const title=make('strong','',section.label);
      const meta=make('span','category-smart-count',section.total+' قسم · '+section.items.toLocaleString('en-US')+' عنصر');
      head.append(title,meta);outer.append(head);
      const years=[...section.years].sort(([a],[b])=>Number(b==='unknown'?0:b)-Number(a==='unknown'?0:a));
      years.forEach(([year,items],yearIndex)=>{
        const box=make('details','category-smart-year');
        box.open=yearIndex===0||Boolean(query);
        const sum=make('summary','category-smart-year-head');
        const yearText=year==='all'?'جميع القنوات':year==='unknown'?'بدون سنة في اسم القسم':'سنة '+year;
        sum.append(make('span','',yearText),make('small','',items.length+' قسم'));
        box.append(sum);
        const rows=make('div','category-smart-list');
        for(const item of items)rows.append(categoryRow(item,item.originalPosition,all.length));
        box.append(rows);outer.append(box);
      });
      target.append(outer);
    });
  }
  if(matches.length>show.length)
    target.append(make('p','muted','تم عرض أول 240 قسمًا. ابحث بالاسم للوصول إلى البقية.'));
}

async function autoSortCurrentCategories(){
  const serverId=el('catalogServer').value,mediaType=el('catalogType').value;
  const mode=el('categoryAutoSortMode').value,button=el('categoryAutoSortBtn');
  if(!serverId){showMessage('اختر المصدر أولًا ثم نوع المحتوى.','error');return;}
  if(!state.categories.length){showMessage('لا توجد أقسام لترتيبها في هذا الاختيار.','error');return;}
  if(!['popular','alphabetical','smart'].includes(mode))return;
  const description=mode==='smart'?'عربي ثم أجنبي ثم بقية الأقسام، وسنة 2026 ثم 2025 والأقدم داخل كل لغة':
    mode==='popular'?'الأقسام الأكثر محتوى أولًا':'الترتيب الأبجدي للأقسام';
  if(!window.confirm('تطبيق '+description+' على '+state.categories.length+' قسمًا لهذا المصدر فقط؟ ستبقى الأقسام المخفية كما هي.'))return;
  button.disabled=true;
  button.textContent='جارٍ حفظ الترتيب…';
  try{
    const result=await api('/api/v1/admin/xtream/categories/auto-sort',{
      method:'POST',body:JSON.stringify({serverId,mediaType,mode})
    });
    await loadCategories();
    showMessage(result.unchanged?'الأقسام مرتبة بالفعل بهذا الشكل.':
      'تم ترتيب '+Number(result.updated||0).toLocaleString('en-US')+' قسمًا وحفظ التغييرات. لا تغيير على إظهارها أو محتواها.');
  }catch(error){
    showMessage('تعذر ترتيب الأقسام: '+(error.message==='xtream_category_busy_retry'?
      'المصدر مشغول بالمزامنة. جرّب مجددًا بعد انتهاء مزامنته.':error.message),'error');
  }finally{
    button.disabled=false;button.textContent='تطبيق الترتيب';
  }
}

async function changeCategory(button) {
  const categoryId=button.dataset.categoryId;
  const action=button.dataset.action;
  const category=state.categories.find(x=>x.id===categoryId);
  const serverId=el('catalogServer').value,kind=el('catalogType').value;
  if(!category||!serverId)return;
  button.disabled=true;
  try{
    const payload=action==='toggle'?{enabled:!category.enabled}:{direction:action};
    await api('/api/v1/admin/xtream/categories/'+encodeURIComponent(serverId)+'/'+encodeURIComponent(kind)+'/'+encodeURIComponent(categoryId),{
      method:'PATCH',body:JSON.stringify(payload)
    });
    // Read back persisted state rather than trusting a local optimistic toggle.
    await loadCategories();
    showMessage(action==='toggle'
      ?'تم حفظ '+(payload.enabled?'إظهار':'إخفاء')+' الفئة «'+category.name+'».'
      :'تم حفظ ترتيب الفئة «'+category.name+'» في قاعدة البيانات.');
  }catch(error){
    showMessage('فشل حفظ الفئة «'+category.name+'»: '+error.message,'error');
  }finally{button.disabled=false;}
}

async function loadCategories() {
  const serverId = el('catalogServer').value;
  const type = el('catalogType').value;
  const select = el('catalogCategory');
  select.replaceChildren();
  const all = document.createElement('option'); all.value = ''; all.textContent = 'كل الأقسام'; select.append(all);
  if (!serverId){state.categories=[];renderCategoryManager();return;}
  try {
    const data = await api(`/api/v1/admin/xtream/categories?serverId=${encodeURIComponent(serverId)}&type=${encodeURIComponent(type)}`);
    state.categories = Array.isArray(data.items) ? data.items : [];
    state.categories.forEach(category => {
      const option = document.createElement('option');
      option.value = category.id;
      option.textContent = `${category.enabled ? '' : '⛔ '} ${category.name} (${Number(category.itemCount || 0).toLocaleString()})`;
      select.append(option);
    });
    renderCategoryManager();
  } catch (error) {
    el('categoryManagerSummary').textContent='تعذر تحميل الفئات: '+error.message;
    showMessage(`تعذر تحميل الأقسام: ${error.message}`, 'error');
  }
}

let tmdbMetadataAvailable=false;
async function loadTmdbIntegrationStatus(){
  try{
    const result=await api('/api/v1/admin/xtream/tmdb/status');
    tmdbMetadataAvailable=Boolean(result.enabled);
    const note=el('tmdbIntegrationState');
    if(note)note.textContent=tmdbMetadataAvailable?
      'TMDB التجاري مفعل: بيانات إضافية للأعمال التي لديها رقم TMDB موثوق.':
      'TMDB غير مفعل: يلزم ترخيص استخدام تجاري ومفتاح قراءة في إعدادات السيرفر.';
    el('tmdbAttribution').hidden=!tmdbMetadataAvailable;
    if(state.catalog.length)renderCatalog();
  }catch{
    tmdbMetadataAvailable=false;
    const note=el('tmdbIntegrationState');
    if(note)note.textContent='حالة TMDB غير متاحة الآن.';
  }
}

function catalogCard(item) {
  const card = make('article', `catalog-item${item.enabled ? '' : ' off'}`);
  const media = make('div', 'catalog-media');
  const poster = make('div', 'catalog-icon');
  if (item.iconUrl) {
    const img = document.createElement('img');
    try {
      const url=new URL(String(item.iconUrl),location.origin);
      if(!['http:','https:'].includes(url.protocol))throw new Error('unsafe_image_scheme');
      img.src=url.href;
    }catch{img.removeAttribute('src');}
    img.alt = ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
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
  const details=make('details','catalog-expanded');
  const header=make('summary','', 'ℹ معلومات المحتوى');
  details.append(header);
  const metaInfo=make('div','catalog-expanded-body');
  const fields=[
    ['التصنيف',item.metadata?.genre],
    ['سنة الإنتاج',item.metadata?.year||item.metadata?.releaseDate],
    ['التقييم',item.metadata?.rating],
    ['القصة',item.metadata?.plot],
    ['الممثلون',item.metadata?.cast],
    ['المخرج',item.metadata?.director],
    ['مدة الحلقة',item.metadata?.episodeRunTime],
    ['المصدر',item.serverName]
  ];
  for(const [label,value] of fields){
    if(value===undefined||value===null||String(value).trim()==='')continue;
    const line=make('div','catalog-expanded-line');
    line.append(make('b','',label),make('span','',String(value).slice(0,1800)));
    metaInfo.append(line);
  }
  const links=make('div','catalog-expanded-links');
  const tmdb=String(item.metadata?.tmdb||'').trim();
  const imdb=String(item.metadata?.imdb||'').trim();
  const trailer=String(item.metadata?.youtubeTrailer||'').trim();
  const addLink=(label,url)=>{
    const a=make('a','button ghost',label);
    a.href=url;a.target='_blank';a.rel='noopener noreferrer';
    links.append(a);
  };
  if(/^\d{1,12}$/.test(tmdb)&&item.type!=='live')
    addLink('TMDB','https://www.themoviedb.org/'+(item.type==='series'?'tv/':'movie/')+tmdb);
  if(/^tt\d{5,12}$/.test(imdb))addLink('IMDb','https://www.imdb.com/title/'+imdb+'/');
  try{
    const video=new URL(trailer);
    if(['www.youtube.com','youtube.com','youtu.be','m.youtube.com'].includes(video.hostname)&&
      video.protocol==='https:')addLink('الإعلان التشويقي',video.href);
  }catch{}
  if(links.children.length)metaInfo.append(links);
  if(!metaInfo.children.length)metaInfo.append(make('p','muted','المصدر لم يوفر معلومات إضافية لهذا العنصر.'));
  details.append(metaInfo);
  const actions=make('div','catalog-actions');
  actions.append(toggle);
  if(item.type==='movie'||item.type==='series'){
    const enrich=make('button','button ghost','✨ تحديث معلومات المحتوى');
    enrich.type='button';
    enrich.title='يجلب القصة والتقييم والصورة المتوفرة من مصدر Xtream لهذا العنصر فقط دون تغيير التشغيل أو التصنيف.';
    enrich.addEventListener('click',async()=>{
      enrich.disabled=true;enrich.textContent='جارٍ جلب المعلومات…';
      try{
        const r=await api('/api/v1/admin/xtream/items/'+encodeURIComponent(item.serverId)+
          '/'+encodeURIComponent(item.type)+'/'+encodeURIComponent(item.id)+'/enrich',{method:'POST'});
        showMessage('✓ تم تحديث معلومات '+item.name+'. الحقول المستلمة: '+Number(r.fieldsFound||0));
        await loadCatalog();
      }catch(error){
        showMessage('تعذر تحديث معلومات '+item.name+': '+error.message,'error');
        enrich.disabled=false;enrich.textContent='✨ تحديث معلومات المحتوى';
      }
    });
    actions.append(enrich);
    const tmdbId=String(item.metadata?.tmdb||'').trim();
    if(tmdbMetadataAvailable&&/^[1-9][0-9]{0,11}$/.test(tmdbId)){
      const button=make('button','button ghost','🎞️ تحديث من TMDB');
      button.type='button';
      button.title='استخدام بيانات TMDB التجارية للعمل ذي الرقم المطابق فقط.';
      button.addEventListener('click',async()=>{
        button.disabled=true;button.textContent='جارٍ جلب TMDB…';
        try{
          await api('/api/v1/admin/xtream/items/'+encodeURIComponent(item.serverId)+
            '/'+encodeURIComponent(item.type)+'/'+encodeURIComponent(item.id)+'/tmdb-enrich',{method:'POST'});
          showMessage('✓ تم تحديث بيانات TMDB للعمل '+item.name);
          await loadCatalog();
        }catch(error){
          showMessage('تعذر تحديث TMDB: '+error.message,'error');
          button.disabled=false;button.textContent='🎞️ تحديث من TMDB';
        }
      });
      actions.append(button);
    }
  }
  const studioEditor=make('details','catalog-studio-editor');
  studioEditor.append(make('summary','','🎨 تخصيص الاسم والشعار'+(item.type==='live'?' والرقم':'') ));
  const form=make('form','catalog-studio-form');
  const row=make('div','catalog-studio-fields');
  const label=(text,control)=>{
    const box=make('label','catalog-studio-field');
    box.append(make('span','',text),control);return box;
  };
  const nameInput=make('input','');
  nameInput.type='text';nameInput.maxLength=160;
  nameInput.placeholder=item.originalName||item.name;
  nameInput.value=item.customName||'';
  row.append(label('الاسم المخصص (اتركه فارغًا للعودة للأصلي)',nameInput));
  const logoInput=make('input','');
  logoInput.type='url';logoInput.maxLength=2048;
  logoInput.placeholder='https://example.com/channel-logo.png';
  logoInput.value=item.customIconUrl||'';
  row.append(label('رابط شعار HTTPS',logoInput));
  let pinInput=null,numberInput=null;
  if(item.type==='live'){
    pinInput=make('input','');
    pinInput.type='checkbox';pinInput.checked=Boolean(item.featured);
    row.append(label('⭐ تثبيت كمميزة',pinInput));
    numberInput=make('input','');
    numberInput.type='number';numberInput.min='1';numberInput.max='99999';
    numberInput.placeholder='مثال 101';numberInput.value=item.channelNumber||'';
    row.append(label('رقم القناة في Xtream',numberInput));
  }
  form.append(row);
  const controls=make('div','inline-actions');
  const save=make('button','button primary','حفظ التخصيص');save.type='submit';
  const reset=make('button','button ghost','إرجاع الأصل');reset.type='button';
  controls.append(save,reset);
  form.append(controls);
  const url='/api/v1/admin/xtream/items/'+encodeURIComponent(item.serverId)+
    '/'+encodeURIComponent(item.type)+'/'+encodeURIComponent(item.id)+'/studio';
  form.addEventListener('submit',async event=>{
    event.preventDefault();save.disabled=true;reset.disabled=true;
    try{
      const data={displayName:nameInput.value.trim()||null,
        iconUrl:logoInput.value.trim()||null};
      if(item.type==='live'){
        data.featured=pinInput.checked;
        data.channelNumber=numberInput.value?Number(numberInput.value):null;
      }
      await api(url,{method:'PATCH',body:JSON.stringify(data)});
      showMessage('✓ تم حفظ التخصيص للمشتركين: '+(data.displayName||item.originalName||item.name));
      await loadCatalog();
    }catch(error){
      showMessage('تعذر حفظ القناة: '+error.message,'error');
      save.disabled=false;reset.disabled=false;
    }
  });
  reset.addEventListener('click',async()=>{
    reset.disabled=true;save.disabled=true;
    try{
      await api(url,{method:'DELETE'});
      showMessage('✓ رجعنا اسم وشعار القناة للقيم الأصلية.');
      await loadCatalog();
    }catch(error){showMessage('تعذر إرجاع الأصل: '+error.message,'error');reset.disabled=false;save.disabled=false;}
  });
  studioEditor.append(form);
  card.append(media,actions,details,studioEditor);
  return card;
}

// The operator must explicitly approve each batch. Requests are sequential,
// limited to eight missing-detail items on the visible page, and cancelable.
let catalogEnrichSession=null;
function refreshCatalogEnrichmentAvailability(){
  const btn=el('catalogEnrichBatchBtn');
  if(!btn)return;
  const type=el('catalogType').value;
  btn.disabled=Boolean(catalogEnrichSession)||!el('catalogServer').value||type==='live';
}
async function enrichCurrentCatalogPage(){
  if(catalogEnrichSession)return;
  const sourceId=el('catalogServer').value,type=el('catalogType').value;
  if(!sourceId||!['movie','series'].includes(type)){
    showMessage('اختر مصدرًا من الأفلام أو المسلسلات أولًا.','error');return;
  }
  const targets=state.catalog.filter(item=>item.serverId===sourceId&&item.type===type&&
    (!item.iconUrl||!item.metadata?.plot||!item.metadata?.year)).slice(0,8);
  if(!targets.length){
    showMessage('لا توجد معلومات أساسية ناقصة ضمن العناصر المعروضة في هذه الصفحة.');return;
  }
  if(!window.confirm('تحديث معلومات '+targets.length+' أعمال من المصدر الأصلي؟ لن تتغير القنوات أو روابط التشغيل أو اشتراكات العملاء.'))return;
  const session={cancelled:false,controller:null,processed:0,success:0,failed:0};
  catalogEnrichSession=session;
  const btn=el('catalogEnrichBatchBtn'),cancel=el('catalogEnrichCancelBtn');
  const progress=el('catalogEnrichProgress'),status=el('catalogEnrichStatus');
  btn.disabled=true;cancel.hidden=false;progress.hidden=false;
  progress.max=targets.length;progress.value=0;
  status.textContent='جارٍ تحديث '+targets.length+' عنصر…';
  try{
    for(const item of targets){
      if(session.cancelled||el('catalogServer').value!==sourceId||el('catalogType').value!==type)break;
      const controller=new AbortController();session.controller=controller;
      const timeout=window.setTimeout(()=>controller.abort(),14500);
      try{
        await api('/api/v1/admin/xtream/items/'+encodeURIComponent(item.serverId)+
          '/'+encodeURIComponent(item.type)+'/'+encodeURIComponent(item.id)+'/enrich',
          {method:'POST',signal:controller.signal});
        session.success++;
      }catch{if(!session.cancelled)session.failed++;}
      finally{
        window.clearTimeout(timeout);
        session.controller=null;session.processed++;
        progress.value=session.processed;
        status.textContent='تم: '+session.processed+'/'+targets.length+' · تحديث ناجح: '+
          session.success+' · تعذر: '+session.failed;
      }
    }
  }finally{
    catalogEnrichSession=null;cancel.hidden=true;
    status.textContent=(session.cancelled?'تم إيقاف العملية. ':'انتهت عملية تحديث العينة. ')+
      'نجح '+session.success+' من '+session.processed+' · تعذر '+session.failed+
      '. اطلع على الحقول في «معلومات المحتوى».';
    refreshCatalogEnrichmentAvailability();
    if(el('catalogServer').value===sourceId&&el('catalogType').value===type)
      await loadCatalog();
  }
}
function stopCatalogEnrichment(){
  if(!catalogEnrichSession)return;
  catalogEnrichSession.cancelled=true;
  catalogEnrichSession.controller?.abort();
}

function renderCatalog() {
  const list = el('catalogItems');
  list.replaceChildren();
  if (!state.catalog.length) list.append(make('div', 'empty', 'ما فيه نتائج في هذا الاختيار.'));
  state.catalog.forEach(item => list.append(catalogCard(item)));
  const count=state.catalog.length;
  const page=Math.floor(state.catalogOffset/250)+1;
  el('catalogHint').textContent=count?
    'المعروض '+(state.catalogOffset+1).toLocaleString('en-US')+'–'+
      (state.catalogOffset+count).toLocaleString('en-US')+' (من المحتوى المطابق).':
    'لا توجد نتائج في هذه الصفحة.';
  el('catalogPageStatus').textContent='الصفحة '+page.toLocaleString('en-US');
  el('catalogPrevPage').disabled=state.catalogOffset===0;
  el('catalogNextPage').disabled=count<250;
  refreshCatalogEnrichmentAvailability();
}

// Year/language browsing is read-only: never let the unfiltered bulk toggle
// accidentally modify an entire source while a smart shelf is selected.
function updateCatalogVideoFilters(){
  const video=el('catalogType').value!=='live';
  for(const label of document.querySelectorAll('.catalog-video-filter'))label.hidden=!video;
  for(const id of ['catalogYear','catalogLanguage']){
    el(id).disabled=!video;
    if(!video)el(id).value='';
  }
  const filtered=video&&Boolean(el('catalogYear').value||el('catalogLanguage').value);
  el('enableTypeBtn').disabled=filtered;
  el('disableTypeBtn').disabled=filtered;
  el('catalogSmartNotice').textContent=filtered?
    'عرض مخصص للغة والسنة — يمكنك البحث والتصفح وتعطيل عنصر واحد، لكن التغيير الجماعي متوقف لحماية بقية المحتوى.':
    'اختر «عربي» و«2026» لعرض عناصر السنة الفعلية إن كانت محفوظة في بيانات المصدر. العرض لا يصنع تصنيفات أو سنوات وهمية.';
}

function initCatalogSmartShortcuts(){
  const container=el('catalogSmartQuick');
  const current=new Date().getFullYear();
  const items=[
    {title:'🎬 عربي '+current,type:'movie',language:'arabic',year:current},
    {title:'🎬 عربي '+(current-1),type:'movie',language:'arabic',year:current-1},
    {title:'🌍 أجنبي '+current,type:'movie',language:'foreign',year:current},
    {title:'📺 مسلسلات عربي '+current,type:'series',language:'arabic',year:current},
    {title:'⭐ كل أعمال '+current,type:'movie',language:'',year:current},
    {title:'✕ مسح الفلاتر',type:'current',language:'',year:''}
  ];
  for(const [index,item] of items.entries()){
    const btn=make('button','catalog-smart-chip'+(index===0?' featured':''),item.title);
    btn.type='button';btn.dataset.shelf=String(index);
    container.append(btn);
  }
  container.addEventListener('click',async event=>{
    const button=event.target.closest('button[data-shelf]');
    if(!button||!container.contains(button))return;
    const selected=items[Number(button.dataset.shelf)];
    if(!selected||!el('catalogServer').value){
      showMessage('اختر مصدر Xtream أولًا لعرض الأقسام حسب اللغة والسنة.','error');return;
    }
    button.disabled=true;
    try{
      if(selected.type!=='current')el('catalogType').value=selected.type;
      el('catalogLanguage').value=selected.language;
      el('catalogYear').value=String(selected.year);
      el('catalogSearch').value='';
      updateCatalogVideoFilters();
      await loadCategories();
      await loadCatalog();
      el('catalogItems').scrollIntoView({behavior:'smooth',block:'start'});
    }catch(error){showMessage('تعذر استعراض القسم: '+error.message,'error');}
    finally{button.disabled=false;}
  });
}

function initCatalogYearPicker(){
  const picker=el('catalogYear');
  const start=new Date().getFullYear()+1;
  for(let year=start;year>=1950;year--){
    const option=document.createElement('option');
    option.value=String(year);option.textContent=String(year);
    picker.append(option);
  }
  updateCatalogVideoFilters();
}

function catalogFilterQuery(){
  const params=new URLSearchParams({
    serverId:el('catalogServer').value,
    type:el('catalogType').value,
    limit:'250'
  });
  if(el('catalogCategory').value)params.set('categoryId',el('catalogCategory').value);
  if(el('catalogType').value!=='live'&&el('catalogYear').value)params.set('year',el('catalogYear').value);
  if(el('catalogType').value!=='live'&&el('catalogLanguage').value)params.set('language',el('catalogLanguage').value);
  if(el('catalogSearch').value.trim())params.set('q',el('catalogSearch').value.trim());
  return params;
}

async function changeCatalogPage(direction){
  const next=Math.max(0,state.catalogOffset+direction*250);
  if(direction>0&&state.catalog.length<250)return;
  state.catalogOffset=next;
  await loadCatalog();
  el('catalogItems').scrollIntoView({behavior:'smooth',block:'start'});
}

async function loadCatalog() {
  const serverId=el('catalogServer').value;
  if(!serverId)return;
  const params=catalogFilterQuery(),key=params.toString();
  if(state.catalogQueryKey!==key){state.catalogQueryKey=key;state.catalogOffset=0;}
  params.set('offset',String(state.catalogOffset));
  const serial=++state.catalogRequestSerial;
  el('catalogLoading').hidden=false;
  try{
    const response=await api('/api/v1/admin/xtream/catalog?'+params);
    if(serial!==state.catalogRequestSerial)return;
    state.catalog=Array.isArray(response.items)?response.items:[];
    renderCatalog();
  }catch(error){
    if(serial===state.catalogRequestSerial)showMessage('تعذر تحميل الكتالوج: '+error.message,'error');
  }finally{
    if(serial===state.catalogRequestSerial)el('catalogLoading').hidden=true;
  }
}

async function bulkCatalog(enabled) {
  if(el('catalogYear').value||el('catalogLanguage').value){
    showMessage('ألغِ فلاتر السنة واللغة قبل أي تغيير جماعي.','error');return;
  }
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

async function runBlofyItemProbe(){
  const button=el('blofyProbeRun'),note=el('blofyProbeResult');
  const kind=el('blofyProbeKind').value;
  const itemId=el('blofyProbeId').value.trim();
  if(!['live','movie','series'].includes(kind)||!(/^[1-9][0-9]{0,14}$/.test(itemId))){
    note.textContent='اختر النوع وأدخل رقم المحتوى الصحيح فقط.';return;
  }
  button.disabled=true;
  note.textContent='جارٍ طلب أول بيانات الفيديو من المصدر…';
  try{
    const result=await api('/api/v1/admin/xtream-gateway/playback-probe',{
      method:'POST',body:JSON.stringify({kind,itemId})
    });
    const reasons={
      catalog_item_not_found:'العنصر غير موجود أو مخفي من المصدر المنشور.',
      upstream_empty_media:'رابط المصدر لا يرسل بيانات فيديو.',
      upstream_non_media_response:'المصدر يعيد صفحة ويب بدل الفيديو.',
      source_unreachable:'تعذر الاتصال بالمصدر.',
      timeout:'انتهت مهلة الاتصال دون فيديو.',
      upstream_http_403:'المصدر يرفض الوصول؛ راجع صلاحية الحساب لدى المزود.',
      upstream_http_404:'المصدر أعاد 404. قد يكون امتداد الحلقة تغيّر؛ يحاول BLOFY مراجعته من بيانات المسلسل مرة واحدة.',
      episode_missing_from_source:'الحلقة لم تعد موجودة ضمن قائمة حلقات المسلسل لدى المزود. حدّث قائمة المسلسلات وأعد فتح المسلسل.',
      upstream_http_456:'رمز غير قياسي من المزود؛ تحقق من أذونات التشغيل وقيود الحساب، ولا يمكن الجزم بسببه من الرمز وحده.',
      upstream_http_429:'تجاوز حد اتصالات المزود أو تقييد الطلبات.'
    };
    if(result.ok){
      const format={ts:'TS',hls:'HLS',mp4:'MP4',mkv:'MKV',unknown:'غير محدد'}[result.format]||'غير محدد';
      note.textContent='✅ وصلت أول بيانات الفيديو · صيغة '+format+' · '+Number(result.elapsedMs||0).toLocaleString('en-US')+' ms'+
        (result.rangeFallbackUsed?' · نجح الفحص بعد إعادة المحاولة بدون Range':'')+
        (result.repairedExtension?' · تم تحديث امتداد الحلقة تلقائيًا من بيانات المزود':'')+'. هذا لا يضمن استمرار التشغيل.';
    }else{
      note.textContent='❌ فشل المصدر'+(result.httpStatus?' · HTTP '+result.httpStatus:'')+' — '+
        (reasons[result.reason]||'راجع إعدادات المصدر والرابط والصيغة وحقوق التشغيل.')+
        (xtreamProviderHintText(result.providerHint)?' · '+xtreamProviderHintText(result.providerHint):'');
    }
  }catch(error){
    note.textContent=/xtream_media_probe_(cooldown|busy)/.test(error.message)
      ?'الفحص محدود لمنع استهلاك المصدر؛ جرّبه بعد 12 ثانية.'
      :'تعذر إكمال الفحص: '+error.message;
  }finally{button.disabled=false}
}

async function loadBlofyPlaybackHealth(){
  const box=el('blofyPlaybackMetrics'),issues=el('blofyPlaybackIssues');
  const note=el('blofyPlaybackNote');
  try{
    const result=await api('/api/v1/admin/xtream-gateway/playback-health');
    const m=result.metrics||{};
    const asMs=value=>value===null||value===undefined?'—':Number(value).toLocaleString('en-US')+' ms';
    const stats=[
      ['بدأ التشغيل',m.started??0],
      ['فشل بدء البث',m.failed??0],
      ['رفض دخول BLOFY',m.gatewayAuthDenied??0],
      ['محتوى غير متاح',m.unavailableItems??0],
      ['أخطاء المصدر',m.upstreamFailed??0],
      ['انقطع بعد البدء',m.interrupted??0],
      ['بدأ ببطء',m.slowStarts??0],
      ['متوسط البداية الوسيط',asMs(m.medianStartMs)],
      ['95% يبدأ خلال',asMs(m.p95StartMs)]
    ];
    box.replaceChildren();
    for(const [label,value] of stats){
      const card=make('div','blofy-playback-metric');
      card.append(make('small','',label),
        make('strong','',typeof value==='number'?value.toLocaleString('en-US'):value));
      box.append(card);
    }
    issues.replaceChildren();
    const errorNames={
      gateway_auth_denied:'بيانات دخول حساب BLOFY غير صالحة أو منتهية (401) — راجع حالة الحساب وبيانات Host واسم المستخدم وكلمة المرور الصادرة من BLOFY.',
      catalog_item_unavailable:'هذا المحتوى غير متاح في المكتبة المنشورة (404)، أو لا ينتمي للمصدر المرتبط بالحساب.',
      upstream_http_403:'المصدر رفض الوصول (403)',
      upstream_http_404:'المصدر أعاد 404 حتى بعد التحقق من صيغة الحلقة أو رابط التشغيل',
      episode_missing_from_source:'رقم الحلقة قديم ولم يعد المزود يدرجه ضمن هذا المسلسل. أعد فتح المسلسل لتحديث قائمة الحلقات.',
      upstream_http_456:'المصدر أعاد HTTP 456: رفض خاص بالمزود. تأكد من تفعيل مشاهدة الفيديو لهذا الحساب ومن قيود الشبكة أو الاتصال المسموح بها لدى المزود.',
      upstream_denial_cooldown:'حماية مؤقتة: أوقف BLOFY المحاولات المتكررة لهذه القناة بعد رفض المصدر HTTP 403/456. لن يزيل ذلك قيود المزود.',
      upstream_http_429:'تجاوز حد اتصالات المصدر',
      headers_timeout:'تأخر الاتصال بالمصدر',
      media_read_timeout:'انقطع وصول بيانات الفيديو',
      upstream_empty_media:'المصدر أرسل بثًا فارغًا',
      upstream_non_media_response:'المصدر أرسل صفحة بدل الفيديو',
      upstream_unreachable:'تعذر الوصول للمصدر',
      upstream_http_other:'المصدر رفض الطلب'
    };
    const recent=Array.isArray(m.recentIssues)?m.recentIssues:[];
    for(const row of recent){
      const item=make('div','blofy-playback-issue');
      const media={live:'قناة',movie:'فيلم',series:'حلقة'}[row.kind]||'بث';
      const phase=row.phase==='interrupted'?'انقطع بعد التشغيل':'فشل التشغيل';
      const reason=errorNames[row.reason]||row.reason||
        (row.upstreamStatus?'استجابة المصدر '+row.upstreamStatus:'سبب غير معروف');
      item.append(make('strong','',media+' · '+phase),
        make('small','',reason+
          (xtreamProviderHintText(row.providerHint)?' · '+xtreamProviderHintText(row.providerHint):'')+
          ' · '+new Date(row.at).toLocaleString('ar-SA')));
      if(!['gateway_auth_denied','catalog_item_unavailable'].includes(row.reason)&&Number.isSafeInteger(row.itemId)&&row.itemId>0){
        const probe=make('button','button ghost','فحص #'+row.itemId);
        probe.type='button';probe.dataset.probeItem=String(row.itemId);
        probe.dataset.probeKind=row.kind;
        item.append(probe);
      }
      issues.append(item);
    }
    if(!recent.length){
      issues.append(make('p','muted','لا توجد أخطاء تشغيل مسجلة خلال الساعة الماضية على هذه النسخة.'));
    }
    const upstreamCodes=Object.entries(m.upstreamCodes||{});
    note.textContent='الأرقام لآخر ساعة على هذا السيرفر فقط. رفض حساب BLOFY (401) يختلف عن رفض المصدر (403)، ولا يعني حدوث عطل بالمصدر. نجاح بدء البث لا يضمن استمراره طوال المشاهدة.'+
      (upstreamCodes.length?' · أخطاء المصدر: '+upstreamCodes.map(([code,n])=>'HTTP '+code+' ('+n+')').join('، '):'');
  }catch(error){
    note.textContent='تعذر تحديث مراقبة إعادة البث: '+error.message;
    if(!box.children.length)box.append(make('p','muted','لا تتوفر بيانات التشغيل الآن.'));
  }
}

function renderStudioBranding(data){
  const name=String(data?.name||'BLOFY STREAM');
  el('studioDisplayName').value=name;
  const image=el('studioLogoImage');
  image.hidden=!data.logoUrl;
  if(data.logoUrl)image.src=data.logoUrl;
  else image.removeAttribute('src');
  el('studioLogoFallback').hidden=Boolean(data.logoUrl);
  el('studioBrandStatus').textContent=data.logoUrl?
    '✓ الشعار محفوظ في قاعدة البيانات ويظهر ضمن بيانات السيرفر.':
    'ارفع شعارك لتظهر هوية BLOFY المخصصة في السيرفر.';
}
async function loadStudioBranding(){
  try{
    const data=await api('/api/v1/admin/xtream/studio');
    renderStudioBranding(data);
  }catch(error){
    el('studioBrandStatus').textContent='تعذر تحميل الهوية: '+error.message;
  }
}
async function saveStudioName(event){
  event.preventDefault();
  const button=el('studioSaveName');button.disabled=true;
  try{
    const result=await api('/api/v1/admin/xtream/studio',{
      method:'PATCH',body:JSON.stringify({name:el('studioDisplayName').value.trim()})
    });
    renderStudioBranding(result);
    showMessage('✓ تم حفظ اسم السيرفر: '+result.name);
  }catch(error){showMessage('تعذر حفظ الاسم: '+error.message,'error');}
  finally{button.disabled=false;}
}
async function changeStudioLogo(remove=false){
  const button=el(remove?'studioRemoveLogo':'studioUploadLogo');
  button.disabled=true;
  try{
    let file=null;
    if(!remove){
      file=el('studioLogoFile').files[0];
      if(!file)throw new Error('اختر ملف شعار أولًا.');
      if(!['image/png','image/jpeg','image/webp'].includes(file.type))
        throw new Error('الشعار يجب أن يكون PNG أو JPG أو WebP.');
      if(!file.size||file.size>1024*1024)throw new Error('حجم الشعار أكبر من 1 ميجابايت.');
    }
    const response=await fetch('/api/v1/admin/xtream/studio/logo',{
      method:remove?'DELETE':'PUT',
      credentials:'same-origin',
      cache:'no-store',
      ...(remove?{}:{headers:{'content-type':file.type},body:file})
    });
    if(response.status===401){location.href='/admin';return;}
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error||'HTTP '+response.status);
    renderStudioBranding(result);
    el('studioLogoFile').value='';
    showMessage(remove?'✓ تمت إزالة الشعار.':'✓ تم رفع شعار السيرفر وحفظه.');
  }catch(error){showMessage('تعذر تغيير الشعار: '+error.message,'error');}
  finally{button.disabled=false;}
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
  if (name === 'xtream') { await loadXtream(); await loadBlofyPlaybackHealth(); }
  if (name === 'studio') await loadStudioBranding();
  if (name === 'catalog') {
    await loadXtream(true);
    await loadCategories();
    await loadCatalog();
  }
}

async function refreshCurrent() {
  if (state.activeTab === 'xtream') { await loadXtream(); await loadBlofyPlaybackHealth(); }
  else if(state.activeTab==='studio')await loadStudioBranding();
  else { await loadXtream(true); await loadCategories(); await loadCatalog(); }
}


// BLOFY Smart Command Center: safe previews over existing protected Xtream APIs.
// No model key or external AI service. Execution never generates arbitrary URLs,
// SQL, code, customer changes or hidden mutations.
let smartCommandPlan=null,smartCommandRun=null;
const smartKindLabels={live:'القنوات',movie:'الأفلام',series:'المسلسلات'};
const smartNotice=message=>{el('smartCommandStatus').textContent=message;};
function smartInvalidate(){
  smartCommandPlan=null;
  const button=el('smartCommandExecuteBtn');
  button.hidden=true;button.disabled=true;
  el('smartCommandPreview').hidden=true;
}
function smartSources(){
  const select=el('smartCommandSource');
  if(!select)return;
  const previous=select.value;
  select.replaceChildren(make('option','','اختر مصدر Xtream أولًا'));
  select.firstChild.value='';
  for(const source of state.xtreamServers){
    const option=make('option','',source.name+(source.enabled?'':' · متوقف'));
    option.value=source.id;
    select.append(option);
  }
  if(state.xtreamServers.some(row=>row.id===previous))select.value=previous;
}
function smartItemLabel(item){return String(item?.name||'عنصر').slice(0,110);}
function smartTargets(parsed,selection){
  const raw=Array.isArray(parsed.mediaTypes)&&parsed.mediaTypes.length?
    parsed.mediaTypes:selection==='all'?['live','movie','series']:[selection];
  const types=[...new Set(raw.filter(x=>['live','movie','series'].includes(x)))];
  if(parsed.intent==='enrich')return types.filter(x=>x!=='live');
  return types;
}
function smartPreviewRow(container,text,cls=''){
  container.append(make('li',cls,text));
}
async function buildSmartCommandPlan(event){
  if(event)event.preventDefault();
  if(smartCommandRun)return;
  smartInvalidate();
  const text=el('smartCommandText').value.trim();
  const parser=globalThis.BlofySmartCommands;
  if(!parser){smartNotice('تعذر تحميل محرك الأوامر. حدّث صفحة BLOFY وجرب مرة أخرى.');return;}
  const parsed=parser.parse(text);
  if(parsed.intent==='unknown'){smartNotice(parsed.reason);return;}
  const serverId=el('smartCommandSource').value;
  const source=state.xtreamServers.find(row=>row.id===serverId);
  if(!source){smartNotice('اختر مصدر Xtream محددًا أولًا؛ ما راح أغيّر مصادر أخرى تلقائيًا.');return;}
  const types=smartTargets(parsed,el('smartCommandType').value);
  if(!types.length){smartNotice('تحديث معلومات الأعمال يدعم الأفلام والمسلسلات فقط. غيّر نطاق الأمر.');return;}
  if(['sync','enrich','probe'].includes(parsed.intent)&&!source.enabled){
    smartNotice('هذا المصدر متوقف. شغّله يدويًا قبل طلب المزامنة أو تحديث معلوماته أو فحصه.');return;
  }
  const snapshot={text,serverId,selectedType:el('smartCommandType').value,
    sourceName:source.name,parsed,types,createdAt:Date.now(),tasks:[]};
  const preview=el('smartCommandPreview');
  preview.replaceChildren(make('h3','','فهمت طلبك: '+parsed.label),
    make('p','','المصدر: '+source.name+' · النطاق: '+types.map(x=>smartKindLabels[x]).join(' + ')));
  const list=make('ol','');
  preview.append(list);
  el('smartCommandPreviewBtn').disabled=true;
  smartNotice('أتحقق من نطاق الأمر وأجمع معاينة فعلية بدون تنفيذ أي تغيير…');
  try{
    if(parsed.intent==='sort'){
      for(const kind of types){
        const response=await api('/api/v1/admin/xtream/categories?'+new URLSearchParams({serverId,type:kind}));
        const categories=(response.items||[]).filter(x=>x.serverId===serverId&&x.mediaType===kind);
        if(categories.length>1000)throw new Error('عدد أقسام '+smartKindLabels[kind]+' تجاوز 1000؛ رتّبها يدويًا.');
        snapshot.tasks.push({kind,action:'sort',count:categories.length,
          examples:categories.slice(0,4).map(x=>x.name)});
        smartPreviewRow(list,'ترتيب '+categories.length+' قسمًا في '+smartKindLabels[kind]+
          ' (الأسماء والمحتوى والظهور لا تتغير). '+(categories.length?
          'مثال: '+categories.slice(0,3).map(x=>x.name).join('، '):'لا توجد أقسام.'));
      }
      const mode={smart:'ترتيب ذكي حسب اللغة والسنة الموجودة في أسماء الأقسام',
        popular:'الأقسام الأكثر محتوى أولًا',alphabetical:'الترتيب الأبجدي'}[parsed.mode];
      preview.append(make('p','',mode+'. سيحفظ السيرفر الترتيب بعد التنفيذ؛ هذه معاينة للنطاق، وليست قائمة نهائية متوقعة.'));
    }else if(parsed.intent==='enrich'){
      // Scan only the first 250 displayed records per selected type. No mass
      // unbounded provider fetching, and no guessing from unsupported sources.
      let slots=8;
      for(const kind of types){
        const response=await api('/api/v1/admin/xtream/catalog?'+
          new URLSearchParams({serverId,type:kind,limit:'250',offset:'0'}));
        const candidates=(response.items||[]).filter(item=>
          item.serverId===serverId&&item.type===kind&&
          (!item.iconUrl||!item.metadata?.plot||!item.metadata?.year));
        const availableKinds=types.length;
        const portion=availableKinds>1?Math.min(4,slots):slots;
        const items=candidates.slice(0,portion).map(item=>({id:item.id,name:smartItemLabel(item)}));
        slots-=items.length;
        snapshot.tasks.push({action:'enrich',kind,items});
        smartPreviewRow(list,'تحديث بيانات '+items.length+' من '+smartKindLabels[kind]+
          ' (أول 250 عنصرًا في العينة): '+(items.length?
            items.slice(0,4).map(x=>x.name).join('، '):'ما لقيت بيانات ناقصة في العينة.'));
      }
      preview.append(make('p','smart-danger',
        'يستخدم بيانات Xtream الأصلية فقط؛ قد لا يرجع المزود معلومات إضافية. لا تُخمّن سنوات أو تقييمات ولا تتغير الروابط أو الاشتراكات. الحد الأقصى 8 أعمال في الأمر الواحد.'));
    }else if(parsed.intent==='sync'){
      snapshot.tasks.push({action:'sync',types});
      smartPreviewRow(list,'طلب مزامنة '+types.map(x=>smartKindLabels[x]).join(' و ')+
        ' من المصدر المحدد فقط؛ يبدأ الاستيراد على السيرفر في الخلفية بعد التأكيد.');
      preview.append(make('p','smart-danger',
        'المزامنة لا تعالج رفض HTTP 403/456 ولا تعني نجاح تشغيل الفيديو. المصدر والمشتركين يبقون كما هم.'));
    }else if(parsed.intent==='probe'){
      for(const kind of types){
        snapshot.tasks.push({action:'probe',kind});
        smartPreviewRow(list,'فحص عينة تشغيل فعلية من '+smartKindLabels[kind]+
          ' وتسجيل حالة المصدر (قد ترجع 403 أو 456).');
      }
      preview.append(make('p','','عملية فحص فقط؛ لا تفعّل أو تنشر محتوى تلقائيًا.'));
    }else if(parsed.intent==='audit'){
      for(const kind of types){
        snapshot.tasks.push({action:'audit',kind});
        smartPreviewRow(list,'قراءة تقرير عينة '+smartKindLabels[kind]+
          ': الصور والسنوات والقصص الناقصة والتكرارات المحتملة.');
      }
      preview.append(make('p','','النتائج تقديرية من عينة محدودة؛ لا يُحذف أو يُنقل أي عمل.'));
    }else if(parsed.intent==='branding'){
      snapshot.tasks.push({action:'branding'});
      smartPreviewRow(list,'الانتقال إلى محرر اسم وشعار السيرفر الموجود في هذه الصفحة.');
      preview.append(make('p','','رفع الشعار يحتاج اختيار ملف الصورة بنفسك؛ لا يُولّد المساعد شعارًا مزيفًا.'));
    }else throw new Error('هذا الأمر غير مدعوم حاليًا.');
    preview.hidden=false;
    const count=snapshot.tasks.reduce((sum,t)=>sum+(t.action==='enrich'?t.items.length:1),0);
    if(!count){smartNotice('ما فيه عناصر تحتاج تحديثًا في العينة المحددة. ما راح أنفذ طلبات فارغة.');return;}
    smartCommandPlan=snapshot;
    const go=el('smartCommandExecuteBtn');
    go.hidden=false;go.disabled=false;
    go.textContent=parsed.readOnly?'تشغيل الفحص / عرض التقرير':'اعتماد وتنفيذ الخطة';
    smartNotice('المعاينة جاهزة. راجع المصدر والخطوات، ثم اضغط زر التنفيذ إذا وافقت.');
  }catch(error){
    preview.hidden=true;
    smartNotice('تعذر تجهيز المعاينة: '+String(error.message||'خطأ غير معروف').slice(0,230));
  }finally{
    el('smartCommandPreviewBtn').disabled=false;
  }
}
async function executeSmartCommand(){
  if(smartCommandRun||!smartCommandPlan)return;
  const plan=smartCommandPlan;
  if(Date.now()-plan.createdAt>2*60*1000){
    smartInvalidate();smartNotice('انتهت صلاحية المعاينة بعد دقيقتين. جهّز معاينة جديدة قبل التغيير.');return;
  }
  if(plan.text!==el('smartCommandText').value.trim()||
     plan.serverId!==el('smartCommandSource').value||
     plan.selectedType!==el('smartCommandType').value){
    smartInvalidate();smartNotice('تغير النص أو المصدر أو النطاق. جهز معاينة جديدة أولًا.');return;
  }
  const source=state.xtreamServers.find(row=>row.id===plan.serverId);
  if(!source){smartInvalidate();smartNotice('المصدر تغير أو لم يعد موجودًا. حدّث اللوحة.');return;}
  if(!plan.parsed.readOnly&&!window.confirm('تأكيد تنفيذ «'+plan.parsed.label+
     '» على المصدر «'+plan.sourceName+'» فقط؟ راجعت المعاينة أعلاه.'))return;
  const session={cancelled:false,finished:0,success:0,failed:0};
  smartCommandRun=session;
  smartCommandPlan=null;
  const button=el('smartCommandExecuteBtn');
  button.disabled=true;el('smartCommandPreviewBtn').disabled=true;
  const cancel=el('smartCommandCancelBtn');
  cancel.hidden=false;cancel.disabled=false;
  const progress=el('smartCommandProgress');
  const tasks=plan.tasks.flatMap(task=>task.action==='enrich'?
    task.items.map(item=>({...task,item})): [task]);
  progress.hidden=false;progress.value=0;progress.max=tasks.length||1;
  const results=make('ul','smart-command-outcomes');
  el('smartCommandPreview').append(results);
  let failedInRow=0;
  try{
    for(const task of tasks){
      if(session.cancelled)break;
      let message='';
      try{
        if(task.action==='sort'){
          if(task.count){
            const result=await api('/api/v1/admin/xtream/categories/auto-sort',{
              method:'POST',body:JSON.stringify({serverId:plan.serverId,
                mediaType:task.kind,mode:plan.parsed.mode})
            });
            message=smartKindLabels[task.kind]+': '+(result.unchanged?'الترتيب موجود مسبقًا':
              'حُفظ ترتيب '+Number(result.updated||0)+' قسمًا');
          }else message=smartKindLabels[task.kind]+': لا توجد أقسام';
        }else if(task.action==='enrich'){
          const result=await api('/api/v1/admin/xtream/items/'+encodeURIComponent(plan.serverId)+'/'+
            encodeURIComponent(task.kind)+'/'+encodeURIComponent(task.item.id)+'/enrich',{
              method:'POST',body:'{}'
            });
          message=task.item.name+': '+Number(result.fieldsFound||0)+' حقلًا من المصدر';
        }else if(task.action==='sync'){
          const result=await api('/api/v1/admin/xtream/servers/'+encodeURIComponent(plan.serverId)+'/sync',{
            method:'POST',body:JSON.stringify({types:task.types})
          });
          message=result.started?'بدأت المزامنة على السيرفر، ولم يكتمل الاستيراد بعد.':
            'لم يؤكد السيرفر بدء المزامنة.';
          if(!result.started)throw new Error(message);
        }else if(task.action==='probe'){
          const result=await api('/api/v1/admin/xtream/servers/'+encodeURIComponent(plan.serverId)+'/probe-playback',{
            method:'POST',body:JSON.stringify({mediaType:task.kind})
          });
          const example=(result.checks||[]).find(x=>x.ok)||
            (result.checks||[]).find(x=>[403,456].includes(Number(x.httpStatus)))||
            (result.checks||[])[0];
          message=smartKindLabels[task.kind]+': '+(result.ok?'وصلت بيانات فيديو للعينة':
            'فشل تشغيل العينة')+(example?.httpStatus?' · HTTP '+example.httpStatus:'')+
            (example?.providerHint?' · تنبيه المصدر: '+({
              network_restriction:'قيد شبكة محتمل',connection_limit:'حد الاتصالات',
              restream_not_allowed:'إعادة البث غير مسموحة',account_expired:'انتهاء الاشتراك',
              account_inactive:'حساب غير نشط',output_format_rejected:'صيغة مرفوضة'
            }[example.providerHint]||'قيد من المصدر'):'');
        }else if(task.action==='audit'){
          const report=await api('/api/v1/admin/xtream/catalog/insights?'+
            new URLSearchParams({serverId:plan.serverId,type:task.kind}));
          message=smartKindLabels[task.kind]+': عينة '+Number(report.sampledPrimary||0)+
            ' · صور ناقصة '+Number(report.missingPoster||0)+
            ' · سنوات ناقصة '+Number(report.missingYear||0)+
            ' · قصص ناقصة '+Number(report.missingPlot||0)+
            ' · مجموعات مكررة محتملة '+Number(report.duplicateGroupCount||0);
        }else if(task.action==='branding'){
          el('studioIdentityHeading').scrollIntoView({behavior:'smooth',block:'center'});
          message='فتح محرر الهوية؛ ارفع شعارك أو عدّل الاسم يدويًا.';
        }
        session.success++;failedInRow=0;
        smartPreviewRow(results,'✓ '+message,'smart-good');
      }catch(error){
        session.failed++;failedInRow++;
        const text=String(error.message||'خطأ غير معروف').slice(0,145);
        smartPreviewRow(results,'✕ '+(task.item?.name||smartKindLabels[task.kind]||plan.parsed.label)+
          ': '+text,'smart-danger');
        // Stop on persistent provider or DB problems instead of flooding Xtream.
        if(failedInRow>=2||/403|456|busy|429|503|rate_limited|unavailable/.test(text)){
          session.cancelled=true;
          smartPreviewRow(results,'تم إيقاف بقية الطلبات احترازيًا بعد رفض أو تعذر المصدر.','smart-danger');
        }
      }
      session.finished++;
      progress.value=session.finished;
      smartNotice('المكتمل '+session.finished+'/'+tasks.length+' · نجح '+session.success+
        ' · تعذر '+session.failed);
    }
  }finally{
    smartCommandRun=null;
    cancel.hidden=true;
    el('smartCommandPreviewBtn').disabled=false;
    button.hidden=true;
    progress.hidden=false;
    smartNotice((session.cancelled?'أُوقف المتبقي. ':'انتهى تنفيذ الأمر. ')+
      'نجح '+session.success+' من '+session.finished+' خطوة، تعذر '+session.failed+
      '. تحديث المعلومات لا يضمن توفير البيانات، والمزامنة قد تكون ما زالت تعمل.');
    if(['sort','enrich','sync','probe'].includes(plan.parsed.intent)){
      await loadXtream(true).catch(()=>{});
    }
  }
}

document.querySelectorAll('.tab').forEach(button => button.addEventListener('click', () => switchTab(button.dataset.tab)));
el('refreshBtn').addEventListener('click', refreshCurrent);
el('smartCommandForm').addEventListener('submit',event=>void buildSmartCommandPlan(event));
el('smartCommandExecuteBtn').addEventListener('click',()=>void executeSmartCommand());
el('smartCommandCancelBtn').addEventListener('click',()=>{
  if(smartCommandRun){smartCommandRun.cancelled=true;smartNotice('سيُوقف BLOFY الطلبات المتبقية بعد انتهاء العملية الجارية.');}
});
for(const id of ['smartCommandSource','smartCommandType'])
  el(id).addEventListener('change',smartInvalidate);
el('smartCommandText').addEventListener('input',smartInvalidate);
document.querySelectorAll('[data-smart-example]').forEach(button=>button.addEventListener('click',()=>{
  el('smartCommandText').value=button.dataset.smartExample||'';
  smartInvalidate();
  el('smartCommandText').focus();
}));
el('studioIdentityForm').addEventListener('submit',saveStudioName);
el('studioUploadLogo').addEventListener('click',()=>changeStudioLogo());
el('studioRemoveLogo').addEventListener('click',()=>changeStudioLogo(true));
el('studioOpenChannels').addEventListener('click',()=>{
  el('catalogType').value='live';
  updateCatalogVideoFilters();
  switchTab('catalog');
});
el('blofyPlaybackRefresh').addEventListener('click', loadBlofyPlaybackHealth);
el('blofyProbeRun').addEventListener('click',runBlofyItemProbe);
el('blofyPlaybackIssues').addEventListener('click',event=>{
  const button=event.target.closest('button[data-probe-item]');
  if(!button)return;
  el('blofyProbeKind').value=button.dataset.probeKind;
  el('blofyProbeId').value=button.dataset.probeItem;
  runBlofyItemProbe();
});
el('xtreamForm').addEventListener('submit', addXtream);
el('syncAllXtreamBtn').addEventListener('click', syncAllXtream);
// Capture source commands before a background catalog refresh can detach
// individual cards. Buttons are ordinary type=button controls; no form submit.
document.addEventListener('click',event=>{
  const button=event.target instanceof Element
    ?event.target.closest('button[data-action]'):null;
  if(!button||!el('xtreamServers').contains(button))return;
  // Browser form submissions are authoritative; they work even with broken JS.
  if(button.closest('.source-native-form')||button.closest('.source-native-edit'))return;
  const card=button.closest('.server-card[data-id]');
  if(!card||card.dataset.busy==='1'||button.disabled)return;
  event.preventDefault();
  event.stopPropagation();
  const item=card._latestSource;
  if(!item){showMessage('تعذر تحديد المصدر لهذا الزر؛ حدث القائمة وحاول مجددًا.','error');return;}
  void handleServerAction(item,card,button).catch(error=>
    showMessage('تعذر تنفيذ إجراء المصدر: '+String(error?.message||'خطأ غير معروف'),'error'));
},true);
el('xtSourceSearch').addEventListener('input', renderXtream);
el('xtSourceFilter').addEventListener('change', renderXtream);
el('xtNewSourceBtn').addEventListener('click', () => {
  el('xtAddSourceSection').scrollIntoView({behavior:'smooth',block:'center'});
  el('xtName').focus({preventScroll:true});
});
el('xtRefreshSourcesBtn').addEventListener('click', ()=>loadXtream().catch(error=>showMessage('تعذر تحديث مصادر Xtream: '+error.message,'error')));
el('studioRefreshBtn').addEventListener('click',()=>loadXtream().catch(error=>showMessage(error.message,'error')));
el('xtProbeAllBtn').addEventListener('click',()=>void runXtreamBatchProbe());
el('xtBatchProbeCancel').addEventListener('click',cancelXtreamBatchProbe);
el('catalogAuditBtn').addEventListener('click',loadCatalogAudit);
el('catalogEnrichBatchBtn').addEventListener('click',()=>void enrichCurrentCatalogPage());
el('catalogEnrichCancelBtn').addEventListener('click',stopCatalogEnrichment);

el('catalogServer').addEventListener('change', async () => { await loadCategories(); await loadCatalog(); });
el('catalogType').addEventListener('change', async () => { updateCatalogVideoFilters(); await loadCategories(); await loadCatalog(); });
el('catalogCategory').addEventListener('change', loadCatalog);
for(const id of ['catalogYear','catalogLanguage'])el(id).addEventListener('change',()=>{
  updateCatalogVideoFilters();loadCatalog().catch(error=>showMessage(error.message,'error'));
});
el('categorySearch').addEventListener('input',renderCategoryManager);
el('categoryVisibility').addEventListener('change',renderCategoryManager);
for(const [id,grouped] of [['categoryGroupedView',true],['categoryFlatView',false]]){
  el(id).addEventListener('click',()=>{
    categorySmartUi.grouped=grouped;
    for(const [buttonId,active] of [['categoryGroupedView',grouped],['categoryFlatView',!grouped]]){
      const button=el(buttonId);
      button.className=active?'button primary':'button ghost';
      button.setAttribute('aria-pressed',String(active));
    }
    renderCategoryManager();
  });
}
el('categoryAutoSortBtn').addEventListener('click',autoSortCurrentCategories);
el('categoryManagerRows').addEventListener('click',event=>{
  const button=event.target.closest('button[data-action][data-category-id]');
  if(button)changeCategory(button).catch(error=>showMessage('تعذر حفظ الفئة: '+error.message,'error'));
});
el('catalogLoadBtn').addEventListener('click', loadCatalog);
const catalogSearch=el('catalogSearch');
let catalogSearchTimer=null;
catalogSearch.addEventListener('input',()=>{
  window.clearTimeout(catalogSearchTimer);
  catalogSearchTimer=window.setTimeout(()=>void loadCatalog(),450);
});
catalogSearch.addEventListener('keydown',event=>{
  if(event.key==='Enter'){event.preventDefault();window.clearTimeout(catalogSearchTimer);void loadCatalog();}
});
el('catalogPrevPage').addEventListener('click',()=>changeCatalogPage(-1));
el('catalogNextPage').addEventListener('click',()=>changeCatalogPage(1));
el('enableTypeBtn').addEventListener('click', () => bulkCatalog(true));
el('disableTypeBtn').addEventListener('click', () => bulkCatalog(false));
window.addEventListener('hashchange', () => {
  const name = tabFromHash();
  if (name && name !== state.activeTab) switchTab(name);
});

initCatalogYearPicker();
initCatalogSmartShortcuts();
loadXtream(true);
loadBlofyPlaybackHealth();
void loadTmdbIntegrationStatus();
const initialTab = tabFromHash();
if (initialTab && initialTab !== 'xtream') switchTab(initialTab);
