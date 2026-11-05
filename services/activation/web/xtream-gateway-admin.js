const gx = id => document.getElementById(id);
const gatewayState = { serverUrl: '', items: [], sources: [] };

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
    const meta = gatewayNode('small', 'muted', `${item.enabled ? 'مفعل' : 'متوقف'} · ${item.maxConnections || 1} اتصال · ينتهي: ${accountExpiresAt(item.expiresAt)}`);
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

    const renew=gatewayNode('button', 'button ghost', 'تجديد شهر');
    renew.type='button';
    renew.addEventListener('click',async()=>{
      if(!window.confirm('تجديد اشتراك '+item.username+' لمدة 30 يومًا؟'))return;
      renew.disabled=true;
      try{
        const now=Date.now();
        const starting=Math.max(now,Number(item.expiresAt)||0);
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
    renderGatewayAccounts();
    try{
      const sources=await gatewayApi('/api/v1/admin/xtream/servers');
      gatewayState.sources=Array.isArray(sources.items)?sources.items:[];
      updateSourceReadiness();
    }catch{if(gx('gatewaySourceHealth'))gx('gatewaySourceHealth').textContent='تعذر التحقق من المصادر الآن.';}
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
    const days=Number(gx('gatewayDurationDays')?.value||30);
    const maxConnections=Number(gx('gatewayMaxConnections')?.value||1);
    const label=String(gx('gatewayCustomerLabel')?.value||'BLOFY Player').trim();
    if(!Number.isInteger(days)||days<1||days>3650)throw new Error('مدة الاشتراك غير صالحة');
    if(!Number.isInteger(maxConnections)||maxConnections<1||maxConnections>3)throw new Error('عدد الاتصالات غير صالح');
    const published=publishedSources();
    if(!published.some(x=>x.status==='online')){
      if(!window.confirm('ليس لديك مصادر منشورة ومتصلة حاليًا. سيتم إصدار البيانات بدون تأكيد عمل المحتوى. هل تريد المتابعة؟'))return;
    }
    const data = await gatewayApi('/api/v1/admin/xtream-gateway/accounts', {
      method: 'POST',
      body: JSON.stringify({
        label:label||'BLOFY Player',maxConnections,
        expiresAt:new Date(Date.now()+days*86400000).toISOString()
      })
    });
    showCredentials(data.credentials);
    gatewayMessage('تم إصدار Host وUsername وPassword. انسخها الآن؛ كلمة السر لا يمكن استعادتها بعد إخفائها.');
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
