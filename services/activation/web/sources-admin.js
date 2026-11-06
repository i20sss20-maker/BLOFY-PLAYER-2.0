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
const TAB_NAMES = new Set(['xtream', 'catalog']);
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
  title.append(make('code', 'server-url', item.baseUrl));
  title.append(make('small','source-id','ID: '+String(item.id||'').slice(0,8)));
  const status = make('span', `server-status ${xtStatusClass(item.syncing ? 'syncing' : item.status)}`, item.syncing ? 'Syncing' : item.status);
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
    status.textContent=item.syncing?'Syncing':String(item.status||'unknown');
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
            status.textContent='✓ وصلت البيانات'+(sample?.episodeCount?' · '+sample.episodeCount+' حلقة':'')+
              (sample?.httpStatus?' · HTTP '+sample.httpStatus:'');
          }else{
            session.failed++;
            status.className='status failed';
            const sample=(result.checks||[]).find(x=>!x.ok);
            const http=Number(sample?.httpStatus);
            const reason=String(sample?.error||result.reason||'');
            const known={
              empty_media:'بث فارغ',upstream_non_media_response:'استجابة نصية بدل فيديو',
              no_imported_items:'لا يوجد محتوى مستورد',no_episode_info:'تفاصيل حلقات غير متاحة',
              no_playable_episodes:'لا توجد حلقات',timeout:'انتهت مهلة المصدر',
              upstream_unreachable:'فشل الاتصال بالمصدر'
            };
            status.textContent='✕ '+(http>=400&&http<=599?'HTTP '+http+' · ':'')+
              (known[reason]||'المصدر لم يؤكد تشغيل العينة');
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
  }
  card.append(media,actions,details);
  return card;
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
      upstream_http_404:'رابط التشغيل غير موجود لدى المزود.',
      upstream_http_429:'تجاوز حد اتصالات المزود أو تقييد الطلبات.'
    };
    if(result.ok){
      const format={ts:'TS',hls:'HLS',mp4:'MP4',mkv:'MKV',unknown:'غير محدد'}[result.format]||'غير محدد';
      note.textContent='✅ وصلت أول بيانات الفيديو · صيغة '+format+' · '+Number(result.elapsedMs||0).toLocaleString('en-US')+' ms. هذا لا يضمن استمرار التشغيل.';
    }else{
      note.textContent='❌ فشل المصدر'+(result.httpStatus?' · HTTP '+result.httpStatus:'')+' — '+
        (reasons[result.reason]||'راجع إعدادات المصدر والرابط والصيغة وحقوق التشغيل.');
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
      upstream_http_404:'المحتوى أو مساره غير موجود (404)',
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
        make('small','',reason+' · '+new Date(row.at).toLocaleString('ar-SA')));
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
  if (name === 'catalog') {
    await loadXtream(true);
    await loadCategories();
    await loadCatalog();
  }
}

async function refreshCurrent() {
  if (state.activeTab === 'xtream') { await loadXtream(); await loadBlofyPlaybackHealth(); }
  else { await loadXtream(true); await loadCategories(); await loadCatalog(); }
}

document.querySelectorAll('.tab').forEach(button => button.addEventListener('click', () => switchTab(button.dataset.tab)));
el('refreshBtn').addEventListener('click', refreshCurrent);
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
const initialTab = tabFromHash();
if (initialTab && initialTab !== 'xtream') switchTab(initialTab);
