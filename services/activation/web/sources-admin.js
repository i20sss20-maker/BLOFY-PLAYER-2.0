const el = id => document.getElementById(id);
const state = {
  xtreamServers: [],
  xtreamTotals: {},
  xtreamLoadSequence: 0,
  sourceFeedback: new Map(),
  categories: [],
  catalog: [],
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
  if(item.syncing||item.status==='syncing'){
    buttons.splice(2,0,['⏹ إلغاء المزامنة','cancel-sync','button ghost']);
  }
  buttons.forEach(([text, action, cls]) => {
    const button = make('button', cls, text);
    button.type = 'button'; button.dataset.action = action;
    button.disabled = item.syncing && action.startsWith('sync');
    actions.append(button);
  });

  const extraActions = make('div', 'server-actions server-actions-advanced');
  for (const [label, action] of [['Live فقط', 'sync-live'], ['أفلام فقط', 'sync-movie'], ['مسلسلات فقط', 'sync-series'], ['حفظ التعديلات', 'save']]) {
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
  if(item.syncProgress){
    const typeNames={starting:'تهيئة',live:'القنوات',movie:'الأفلام',series:'المسلسلات'};
    info.append(make('span','sync-progress-note',
      'جاري استيراد '+(typeNames[item.syncProgress.mediaType]||item.syncProgress.mediaType)+
      ' · '+Number(item.syncProgress.imported||0).toLocaleString('en-US')+' عنصر حتى الآن'));
  }
  if (item.lastError) info.append(make('span', 'error-text', `آخر خطأ: ${item.lastError}`));
  const feedback=state.sourceFeedback.get(item.id);
  const actionStatus=make('p',feedback?.kind==='error'?'source-action-feedback error':'source-action-feedback',feedback?.text||'');
  actionStatus.setAttribute('role','status');
  actionStatus.hidden=!feedback;
  info.append(actionStatus);

  card.addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button || !card.contains(button) || card.dataset.busy === '1') return;
    handleServerAction(card._latestSource, card, button);
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
    const signature=JSON.stringify(item);
    // Never replace a pending mutation or a user-opened editing form.
    const interacting=old && (old.dataset.busy==='1'
      || Boolean(old.querySelector('details[open]'))
      || old.contains(document.activeElement));
    if(old && (old.dataset.renderSignature===signature || interacting)){
      old._latestSource=item;
      desired.push(old);
    }else{
      const card=serverCard(item);
      desired.push(card);
    }
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

function renderCategoryManager() {
  const target=el('categoryManagerRows');
  if(!target)return;
  target.replaceChildren();
  const all=state.categories||[];
  const query=String(el('categorySearch')?.value||'').trim().toLowerCase();
  const matches=all.filter(category=>String(category.name||'').toLowerCase().includes(query));
  const countOn=all.filter(category=>category.enabled).length;
  el('categoryManagerSummary').textContent=
    'الفئات: '+all.length+' · الظاهرة: '+countOn+' · المخفية: '+(all.length-countOn)+
    (query?' · نتائج البحث: '+matches.length:'')+(query?' · امسح البحث لتحريك الفئات':'');
  const rows=matches.slice(0,120);
  if(!rows.length){
    target.append(make('p','empty','ما توجد فئات مطابقة للمصدر والنوع المحددين.'));
    return;
  }
  for(const category of rows){
    const row=make('article','category-manager-row'+(category.enabled?'':' hidden-category'));
    const info=make('div','category-manager-label');
    info.append(make('strong','',category.name));
    info.append(make('small','',Number(category.itemCount||0).toLocaleString('en-US')+' عنصر'));
    const actions=make('div','category-manager-actions');
    const position=all.findIndex(x=>x.id===category.id);
    const buttons=[
      ['↑','up','رفع الفئة',Boolean(query)||position===0],
      ['↓','down','خفض الفئة',Boolean(query)||position===all.length-1],
      [category.enabled?'إخفاء':'إظهار','toggle',category.enabled?'إخفاء عن العملاء':'إظهار للعملاء',false]
    ];
    for(const [label,action,title,disabled] of buttons){
      const button=make('button','button ghost',label);
      button.type='button';button.dataset.action=action;button.dataset.categoryId=category.id;
      button.title=title;button.disabled=disabled;
      actions.append(button);
    }
    row.append(info,actions);
    target.append(row);
  }
  if(matches.length>rows.length)target.append(make('p','muted','المعروض أول 120 فئة. استخدم البحث للوصول إلى بقية الفئات.'));
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
  if (state.activeTab === 'xtream') await loadXtream();
  else { await loadXtream(true); await loadCategories(); await loadCatalog(); }
}

document.querySelectorAll('.tab').forEach(button => button.addEventListener('click', () => switchTab(button.dataset.tab)));
el('refreshBtn').addEventListener('click', refreshCurrent);
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
el('categorySearch').addEventListener('input',renderCategoryManager);
el('categoryManagerRows').addEventListener('click',event=>{
  const button=event.target.closest('button[data-action][data-category-id]');
  if(button)changeCategory(button).catch(error=>showMessage('تعذر حفظ الفئة: '+error.message,'error'));
});
el('catalogLoadBtn').addEventListener('click', loadCatalog);
el('catalogSearch').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); loadCatalog(); } });
el('enableTypeBtn').addEventListener('click', () => bulkCatalog(true));
el('disableTypeBtn').addEventListener('click', () => bulkCatalog(false));
window.addEventListener('hashchange', () => {
  const name = tabFromHash();
  if (name && name !== state.activeTab) switchTab(name);
});

loadXtream(true);
const initialTab = tabFromHash();
if (initialTab && initialTab !== 'xtream') switchTab(initialTab);
