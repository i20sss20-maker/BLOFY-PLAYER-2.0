const gx = id => document.getElementById(id);
const gatewayState = { serverUrl: '', items: [], sources: [], lastIssued: [] };

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

function renderGatewayBatch(credentials){
  gatewayState.lastIssued=credentials.map(x=>({
    serverUrl:String(x.serverUrl||''),
    username:String(x.username||''),
    password:String(x.password||''),
    appCode:''
  }));
  const panel=gx('gatewayBatchCredentials'),rows=gx('gatewayBatchRows');
  rows.replaceChildren();
  gatewayState.lastIssued.forEach((account,index)=>{
    const line=gatewayNode('div','gateway-batch-row');
    const details=gatewayNode('div','gateway-batch-details');
    details.append(gatewayNode('strong','',account.username));
    details.append(gatewayNode('code','',account.serverUrl+' · '+account.password));
    const button=gatewayNode('button','button ghost','إصدار كود تطبيق BLOFY');
    button.type='button';
    button.addEventListener('click',async()=>{
      if(!window.confirm('هل تريد إصدار كود تفعيل تطبيق BLOFY لهذا الحساب؟'))return;
      button.disabled=true;
      try{
        const result=await gatewayApi('/api/v1/admin/blofy-codes',{
          method:'POST',body:JSON.stringify({
            source:'custom',host:account.serverUrl,username:account.username,password:account.password
          })
        });
        if(!result.code)throw new Error('blofy_code_not_returned');
        account.appCode=String(result.code);
        button.replaceWith(gatewayNode('strong','gateway-app-code', 'كود التطبيق: '+account.appCode));
        gatewayMessage('تم إصدار كود BLOFY لهذا الحساب. احفظه الآن مع بيانات Xtream.');
      }catch(error){
        button.disabled=false;
        gatewayMessage('تعذر إصدار كود BLOFY: '+error.message,'error');
      }
    });
    line.append(details,button);
    rows.append(line);
  });
  panel.hidden=gatewayState.lastIssued.length===0;
  gx('gatewayCredentials').hidden=true;
}
function formatBatchText(){
  return gatewayState.lastIssued.map(x=>'Host: '+x.serverUrl+'\nUsername: '+x.username+'\nPassword: '+x.password).join('\n\n');
}
function downloadBatchCsv(){
  if(!gatewayState.lastIssued.length)return;
  const quote=v=>{
    let raw=String(v??'');
    if(/^[\s]*[=+\-@]/.test(raw))raw="'"+raw;
    return '"'+raw.replaceAll('"','""')+'"';
  };
  const lines=['Host,Username,Password,BlofyAppCode'].concat(
    gatewayState.lastIssued.map(x=>[x.serverUrl,x.username,x.password,x.appCode||''].map(quote).join(','))
  );
  const url=URL.createObjectURL(new Blob(['\ufeff'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'}));
  const link=document.createElement('a');
  link.href=url;link.download='BLOFY-new-Xtream-accounts.csv';document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function hideIssuedCredentials(){
  gatewayState.lastIssued=[];
  gx('gatewayBatchCredentials').hidden=true;
  gx('gatewayCredentials').hidden=true;
  gx('gatewayBatchRows').replaceChildren();
  gx('gatewayCredPass').textContent='—';
}

function accountExpiresAt(value){
  if(!value)return 'بدون انتهاء';
  const date=new Date(value);
  return Number.isFinite(date.getTime())?date.toLocaleDateString('ar-SA'):'غير معروف';
}

function publishedSources(){
  return gatewayState.sources.filter(x=>x.enabled&&x.publishCatalog);
}

function updateSourceReadiness(){
  const el=gx('gatewaySourceHealth');
  if(!el)return;
  const published=publishedSources();
  const online=published.filter(x=>x.status==='online');
  const total=published.reduce((acc,x)=>acc+Number(x.counts?.live||0)+Number(x.counts?.movie||0)+Number(x.counts?.series||0),0);
  el.textContent=!published.length
    ?'⚠ لا توجد مصادر منشورة للمشتركين. أضف مصدر Xtream مرخّصًا، افحصه وفعّل نشر المحتوى أولًا.'
    :online.length===0
      ?'⚠ يوجد '+published.length+' مصدر منشور، لكنها غير متصلة حاليًا. قد تصدر بيانات الدخول بدون تشغيل المحتوى.'
      :'✓ '+online.length+' مصدر متصل من '+published.length+' منشور · '+total.toLocaleString('en-US')+' عنصر ضمن المكتبة. تحقق من تشغيل العناوين قبل البيع.';
  el.classList.toggle('source-warning',!online.length);
}

function gatewaySourceOptions(select,chosen,editable=true) {
  const prior=String(chosen||'');
  select.replaceChildren();
  const all=gatewayNode('option','','كل مصادر BLOFY المنشورة');
  all.value='';select.append(all);
  for(const source of gatewayState.sources){
    const available=Boolean(source.enabled && source.publishCatalog);
    if(!available && source.id!==prior)continue;
    const option=gatewayNode('option','',source.name+' · '+String(source.counts?.total||0).toLocaleString('en-US')+' عنصر'+(available?'':' (غير متاح)'));
    option.value=source.id;option.disabled=!available;select.append(option);
  }
  if(prior && !gatewayState.sources.some(x=>x.id===prior)){
    const unavailable=gatewayNode('option','','المصدر الأصلي محذوف أو غير متاح');
    unavailable.value=prior;unavailable.disabled=true;select.append(unavailable);
  }
  select.value=prior;
  if(select.value!==prior)select.value='';
  select.disabled=!editable;
}

function renderGatewaySourcePicker(){
  const picker=gx('gatewaySourceId');if(!picker)return;
  gatewaySourceOptions(picker,picker.value);
}

// Gateway account expirations may be numeric epoch milliseconds or ISO dates.
// Null/invalid expirations are unlimited; never silently convert them to 30 days.
function accountExpiryMs(value){
  if(value==null||value==='')return null;
  const n=Number(value);
  const ms=Number.isFinite(n)&&n>0?(n<1e12?n*1000:n):Date.parse(String(value));
  return Number.isFinite(ms)&&ms>0?ms:null;
}
function gatewayAccountFlags(item,now=Date.now()){
  const expires=accountExpiryMs(item?.expiresAt);
  const hasExpiry=expires!==null;
  const expired=hasExpiry&&expires<=now;
  const expiring=hasExpiry&&!expired&&expires-now<=7*86400000;
  return {expired,expiring,disabled:!item.enabled};
}

function renderGatewayAccounts() {
  const list = gx('gatewayAccounts');
  list.replaceChildren();
  gx('gatewayServerUrl').textContent = gatewayState.serverUrl || '—';
  const query=String(gx('gatewayAccountSearch')?.value||'').trim().toLocaleLowerCase();
  const filter=String(gx('gatewayAccountFilter')?.value||'all');
  const all=gatewayState.items;
  const expiredCount=all.filter(item=>gatewayAccountFlags(item).expired).length;
  const soonCount=all.filter(item=>gatewayAccountFlags(item).expiring).length;
  const disabledCount=all.filter(item=>!item.enabled).length;
  const matching=all.filter(item=>{
    const flags=gatewayAccountFlags(item);
    const text=(String(item.label||'')+' '+String(item.username||'')).toLocaleLowerCase();
    if(query&&!text.includes(query))return false;
    if(filter==='enabled')return item.enabled&&!flags.expired;
    if(filter==='expired')return flags.expired;
    if(filter==='expiring')return flags.expiring;
    if(filter==='disabled')return flags.disabled;
    return true;
  });
  const summary=gx('gatewayAccountsSummary');
  if(summary)summary.textContent='الحسابات: '+all.length.toLocaleString('en-US')+
    ' · منتهية: '+expiredCount.toLocaleString('en-US')+
    ' · تنتهي خلال أسبوع: '+soonCount.toLocaleString('en-US')+
    ' · موقوفة: '+disabledCount.toLocaleString('en-US')+
    ' · المعروض: '+matching.length.toLocaleString('en-US');
  if (!matching.length) {
    list.append(gatewayNode('div', 'empty-state',all.length?
      'لا توجد حسابات مطابقة. غيّر البحث أو فلتر الحالة.':
      'ما فيه بيانات دخول حتى الآن. اضغط «إنشاء بيانات دخول» وبتطلع لك جاهزة.'));
    return;
  }
  for (const item of matching) {
    const flags=gatewayAccountFlags(item);
    const card = gatewayNode('article', `gateway-account${item.enabled ? '' : ' off'}${flags.expired?' expired':''}`);
    const main = gatewayNode('div', 'gateway-account-main');
    main.append(gatewayNode('strong', '', item.label || 'BLOFY Player'));
    const user = gatewayNode('code', '', item.username);
    main.append(user);
    const label=flags.expired?'🔴 منتهي الصلاحية':flags.disabled?'⏸ موقوف':flags.expiring?'🟠 ينتهي خلال 7 أيام':'✓ مفعل';
    const meta = gatewayNode('small', 'muted', `${label} · ${item.maxConnections || 1} اتصال · ينتهي: ${accountExpiresAt(item.expiresAt)}`);
    main.append(meta);
    const linked=gatewayState.sources.find(source=>source.id===item.sourceId);
    main.append(gatewayNode('small','muted','محتوى الحساب: '+(item.sourceId?(linked?.name||'المصدر الأصلي غير متاح'):'جميع المصادر المنشورة')));
    const sourceTools=gatewayNode('div','gateway-account-source-picker');
    const sourceSelect=gatewayNode('select','');
    gatewaySourceOptions(sourceSelect,item.sourceId);
    const sourceSave=gatewayNode('button','button ghost','تغيير المصدر');
    sourceSave.type='button';
    sourceSave.addEventListener('click',async()=>{
      if(!window.confirm('تغيير مصدر المحتوى لهذا المستخدم؟ سيتغير ما يمكنه مشاهدته فورًا.'))return;
      sourceSave.disabled=true;
      try{
        await gatewayApi('/api/v1/admin/xtream-gateway/accounts/'+encodeURIComponent(item.id),{
          method:'PATCH',body:JSON.stringify({sourceId:sourceSelect.value||null})
        });
        gatewayMessage('تم حفظ مصدر المحتوى لهذا المستخدم.');
        await loadGateway();
      }catch(error){gatewayMessage('تعذر تغيير المصدر: '+error.message,'error');}
      finally{sourceSave.disabled=false;}
    });
    sourceTools.append(sourceSelect,sourceSave);
    main.append(sourceTools);

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

    const renew=gatewayNode('button', 'button ghost', accountExpiryMs(item.expiresAt)===null?'بدون انتهاء':'تجديد شهر');
    renew.type='button';
    renew.disabled=accountExpiryMs(item.expiresAt)===null;
    if(renew.disabled)renew.title='هذا الحساب بدون تاريخ انتهاء، ولا يحتاج لتجديد يغيّر صلاحياته.';
    renew.addEventListener('click',async()=>{
      if(!window.confirm('تجديد اشتراك '+item.username+' لمدة 30 يومًا؟'))return;
      renew.disabled=true;
      try{
        const now=Date.now();
        const existingExpiry=accountExpiryMs(item.expiresAt);
        if(existingExpiry===null)throw new Error('هذا الحساب غير محدد الانتهاء، ولا يحتاج لتجديد.');
        const starting=Math.max(now,existingExpiry);
        await gatewayApi('/api/v1/admin/xtream-gateway/accounts/'+encodeURIComponent(item.id),{
          method:'PATCH',body:JSON.stringify({expiresAt:new Date(starting+30*24*60*60*1000).toISOString(),enabled:true})
        });
        gatewayMessage('تم تجديد اشتراك '+item.username+' لمدة شهر.');
        await loadGateway();
      }catch(error){gatewayMessage('تعذر التجديد: '+error.message,'error')}
      finally{renew.disabled=false}
    });

    actions.append(copy, renew, toggle, reset, remove);
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
    // Summary only; never broadcast usernames, passwords, tokens or account records.
    const now=Date.now();
    const accounts=gatewayState.items;
    const expiry=item=>accountExpiryMs(item.expiresAt);
    const accountSnapshot={
      total:accounts.length,
      active:accounts.filter(x=>x.enabled&&(expiry(x)==null||expiry(x)>now)).length,
      expiring:accounts.filter(x=>x.enabled&&expiry(x)!=null&&expiry(x)>now&&expiry(x)-now<=7*86400000).length,
      expired:accounts.filter(x=>expiry(x)!=null&&expiry(x)<=now).length,
      disabled:accounts.filter(x=>!x.enabled).length
    };
    window.__BLOFY_ACCOUNT_SUMMARY__=accountSnapshot;
    document.dispatchEvent(new CustomEvent('blofy:account-snapshot',{detail:accountSnapshot}));
    renderGatewayAccounts();
    try{
      const sources=await gatewayApi('/api/v1/admin/xtream/servers');
      gatewayState.sources=Array.isArray(sources.items)?sources.items:[];
      updateSourceReadiness();
      renderGatewaySourcePicker();
      renderGatewayAccounts();
    }catch{if(gx('gatewaySourceHealth'))gx('gatewaySourceHealth').textContent='تعذر التحقق من المصادر الآن.';}
  } catch (error) {
    if (error.message !== 'unauthorized') {
      gatewayMessage(`تعذر تحميل بوابة Xtream: ${error.message}`, 'error');
      // Do not show stale subscriber figures as if they were current.
      document.dispatchEvent(new CustomEvent('blofy:account-unavailable'));
    }
  } finally {
    if (loading) loading.hidden = true;
  }
}

// Auto refresh is read-only. Do not sync providers or mutate any subscription.
document.addEventListener('blofy:refresh-accounts',()=>{void loadGateway();});
gx('gatewayAccountSearch')?.addEventListener('input',renderGatewayAccounts);
gx('gatewayAccountFilter')?.addEventListener('change',renderGatewayAccounts);

gx('gatewayCreateBtn')?.addEventListener('click', async () => {
  const button = gx('gatewayCreateBtn');
  button.disabled = true;
  const old = button.textContent;
  button.textContent = 'جارٍ الإنشاء…';
  try {
    const days=Number(gx('gatewayDurationDays')?.value||30);
    const maxConnections=Number(gx('gatewayMaxConnections')?.value||1);
    const label=String(gx('gatewayCustomerLabel')?.value||'BLOFY Player').trim();
    if(!Number.isInteger(days)||days<1||days>3650)throw new Error('مدة الاشتراك غير صالحة');
    if(!Number.isInteger(maxConnections)||maxConnections<1||maxConnections>3)throw new Error('عدد الاتصالات غير صالح');
    const published=publishedSources();
    const requestedSource=String(gx('gatewaySourceId')?.value||'');
    if(requestedSource&&!published.some(x=>x.id===requestedSource)){
      throw new Error('المصدر المختار غير منشور أو موقوف. فعّله وانشر محتواه أولًا.');
    }
    if(!published.some(x=>x.status==='online'&&(!requestedSource||x.id===requestedSource))){
      if(!window.confirm('المصدر المختار غير متصل حاليًا. قد يصدر اليوزر لكن المحتوى لا يعمل. هل تريد المتابعة؟'))return;
    }
    const sourceId=String(gx('gatewaySourceId')?.value||'');
    const count=Number(gx('gatewayQuantity')?.value||1);
    if(![1,5,10].includes(count))throw new Error('عدد الحسابات غير صالح');
    const data = await gatewayApi('/api/v1/admin/xtream-gateway/accounts/bulk', {
      method: 'POST',
      body: JSON.stringify({
        count,label:label||'BLOFY Player',maxConnections,sourceId:sourceId||null,
        expiresAt:new Date(Date.now()+days*86400000).toISOString()
      })
    });
    renderGatewayBatch(Array.isArray(data.credentials)?data.credentials:[]);
    gatewayMessage('تم إصدار '+String(data.count||0)+' حساب Xtream. انسخ Host وUsername وPassword الآن، أو حمّل ملف CSV.');
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

gx('gatewayHideCredentialsBtn')?.addEventListener('click', hideIssuedCredentials);
gx('gatewayHideBatchBtn')?.addEventListener('click', hideIssuedCredentials);
gx('gatewayCopyBatchBtn')?.addEventListener('click',()=>copyText(formatBatchText(),'تم نسخ بيانات جميع الحسابات.'));
gx('gatewayDownloadBatchBtn')?.addEventListener('click',downloadBatchCsv);

function openGatewayHashTab() {
  const name = String(location.hash || '').replace(/^#/, '').trim().toLowerCase();
  if (!['sources', 'xtream', 'catalog'].includes(name)) return;
  const button = document.querySelector(`.tab[data-tab="${name}"]`);
  if (button && !button.classList.contains('active')) button.click();
}

window.addEventListener('hashchange', openGatewayHashTab);
setTimeout(openGatewayHashTab, 0);
loadGateway();
