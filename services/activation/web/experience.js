/* All account credentials stay in this page's memory and never enter a query string. */
'use strict';
const page = document.body.dataset.page;
const $ = id => document.getElementById(id);
const node = (tag, text, className) => { const el=document.createElement(tag); if(text!=null)el.textContent=text; if(className)el.className=className; return el; };
const date = value => value ? new Date(value).toLocaleString('ar-SA',{dateStyle:'medium',timeStyle:'short'}) : '—';
const labels = {active:'ساري',trial:'تجربة',expired:'منتهٍ',blocked:'موقوف',open:'مفتوح',resolved:'تم الحل',testing:'تجريبي',stable:'معتمد'};
const badge = value => node('span',labels[value]||value,'badge '+value);
const setStatus=(id,text,bad=false)=>{const el=$(id);el.textContent=text;el.classList.toggle('bad',bad);};
const errors = {device_changed:'تغيّرت بيانات الجهاز. حدّث السجل وراجعها قبل إعادة الحفظ.',invalid_device_edit:'راجع بيانات العميل وحدود الحقول.',invalid_device_email:'أدخل بريدًا صحيحًا أو اتركه فارغًا.',device_restore_unavailable:'لا توجد حالة سابقة موثقة لاستعادتها. راجع التفعيل قبل تغيير حالة هذا الجهاز.',invalid_duration:'اختر مدة التمديد.',already_lifetime:'هذا الجهاز مفعّل مدى الحياة ولا يحتاج تمديدًا.',device_blocked:'هذا الجهاز موقوف. لا يمكن تمديده أثناء الإيقاف.',activation_changed:'تغيّر تفعيل الجهاز. أغلق التأكيد وراجع التمديد من جديد.',request_conflict:'هذا الطلب مستخدم لعملية أخرى. أعد فتح سجل الجهاز.',unauthorized_device:'كود الجهاز أو رمز الربط غير صحيح، أو الجهاز غير متاح.',check_recently_requested:'تم الفحص قبل قليل. انتظر 15 ثانية ثم أعد المحاولة.',support_recently_submitted:'وصل طلبك السابق. يمكنك إرسال طلب جديد بعد خمس دقائق.',invalid_release:'تحقق من رقم النسخة واسمها ورابط التحميل الآمن.',invalid_device:'تحقق من كود الجهاز.',description_required:'اكتب وصفًا واضحًا للمشكلة.',plan_not_found:'الخطة المختارة غير متاحة.',device_not_found:'لم نعثر على هذا الجهاز.',rate_limited:'طلبات كثيرة. انتظر قليلًا ثم أعد المحاولة.'};
async function api(url, body, method) {
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),20000);
  try {
    const response=await fetch(url,{method:method||(body?'POST':'GET'),credentials:'same-origin',headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:controller.signal});
    if(response.status===401&&page==='admin'){location.assign('/admin');throw new Error('انتهت جلسة المشرف.');}
    const data=await response.json();
    if(!response.ok)throw new Error(errors[data.error]||'تعذر إكمال الطلب. أعد المحاولة بعد قليل.');
    return data;
  } catch(error){if(error.name==='AbortError')throw new Error('تأخر الرد. تحقق من الاتصال وأعد المحاولة.');throw error;} finally {clearTimeout(timeout);}
}
const healthText = {
  active:'الحساب ساري والمصدر يستجيب. هذا الفحص لا يضمن توفر كل قناة.',
  expired:'انتهى اشتراك البث. يحتاج تجديدًا من البائع.',blocked:'حساب البث موقوف. راجع البائع.',
  invalid_account:'المصدر رفض بيانات الحساب. راجع بيانات القائمة.',connection_limit:'الاشتراك ساري وجميع الاتصالات مستخدمة؛ قد يكون منها تشغيل هذا الجهاز.',
  session_expired:'انتهى ربط حساب البث. أعد تسجيل الدخول إلى القائمة.',dns:'تعذر العثور على عنوان المصدر.',timeout:'تأخر المصدر في الرد.',
  unreachable:'المصدر غير متاح للفحص الآن. تحقق من الشبكة وحالة الخدمة.',unknown:'استجاب المصدر دون بيانات صلاحية واضحة.',unsupported:'قوائم M3U لا توفر بيانات الصلاحية بهذا الفحص.'
};
function definition(values){const list=node('dl');for(const [label,value]of values){list.append(node('dt',label),node('dd',value??'—'));}return list;}
function playlistCards(container,items,request){container.replaceChildren();if(!items.length){container.append(node('p','لا توجد قوائم مرتبطة بهذا الجهاز.','empty'));return;}
  for(const item of items){const card=node('div',null,'playlist');const title=node('div',null,'actions');title.append(node('h3',item.name));if(item.active)title.append(node('span','القائمة النشطة','pill'));
    const button=node('button','فحص الحساب');const message=node('p','لم يُفحص في هذه الجلسة.','status');message.setAttribute('role','status');
    button.addEventListener('click',async()=>{button.disabled=true;message.textContent='جارٍ الفحص…';try{const value=await request(item.id);message.textContent=(healthText[value.state]||healthText.unknown)+(value.expiresAt?'\nالانتهاء: '+date(value.expiresAt):'')+(value.connections!=null&&value.limit>0?'\nالاتصالات: '+value.connections+' من '+value.limit:'')+'\nآخر فحص: '+date(value.checkedAt);}
      catch(error){message.textContent=error.message;}finally{button.disabled=false;}});
    card.append(title,node('p',item.type.toUpperCase(),'caption'),button,message);container.append(card);
  }
}
async function releaseCards(container){try{const {items}=await api('/api/v1/releases');container.replaceChildren();
  const channels=['stable','testing'].sort((a,b)=>Number(items.some(x=>x.channel===b))-Number(items.some(x=>x.channel===a)));
  for(const channel of channels){const release=items.find(item=>item.channel===channel);const card=node('article',null,'card download-card'+(release?' available':''));card.append(badge(channel),node('h3',channel==='stable'?'الإصدار المعتمد':'الإصدار التجريبي'));
    if(!release){card.append(node('p',channel==='stable'?'لم يُعلن إصدار معتمد في مركز التحميل بعد.':'لا يوجد إصدار تجريبي منشور حاليًا.'));}
    else{card.append(node('div',release.versionName,'download-version'),node('p',release.releaseNotes||'لا توجد ملاحظات إضافية.','content-text'));
      if(release.downloadUrl&&/^https:\/\//i.test(release.downloadUrl)){const link=node('a','تحميل APK',channel==='stable'?'btn primary':'btn');link.href=release.downloadUrl;link.rel='noopener noreferrer';card.append(link);}
      else card.append(node('p','رابط التحميل لم يُضف بعد.'));
    }container.append(card);
  }}catch(error){container.replaceChildren(node('p',error.message,'notice'));}}

if(page==='admin-login'){
  $('admin-login').addEventListener('submit',async event=>{
    event.preventDefault();const form=event.currentTarget;const button=form.querySelector('button');button.disabled=true;
    setStatus('admin-login-status','جارٍ تسجيل الدخول…');
    try{await api('/api/v1/admin/session/login',Object.fromEntries(new FormData(form)));form.reset();location.assign('/admin');}
    catch{setStatus('admin-login-status','تعذر تسجيل الدخول. تحقق من البيانات وحاول مجددًا.',true);}
    finally{button.disabled=false;}
  });
}
if(page==='home'){
  const hash=new URLSearchParams(location.hash.slice(1));
  if(hash.has('deviceId')&&(hash.has('code')||hash.has('activationCode')))location.replace('/portal'+location.hash);
}
if(page==='downloads'){
  releaseCards($('releases'));
  const instructions={phone:['حمّل ملف APK من الإصدار الذي تختاره أعلاه.','افتح الملف واسمح بالتثبيت من مصدر التحميل عندما يطلب أندرويد ذلك.','ثبّت التطبيق أو حدّث نسختك الحالية، ثم افتح BLOFY واربط جهازك.'],tv:['حمّل ملف APK وانقله إلى التلفزيون أو الرسيفر بوسيلة نقل الملفات المتاحة لديك.','افتح الملف من مدير الملفات وامنح إذن التثبيت عند الطلب.','افتح BLOFY، ثم استخدم كود الجهاز ورمز الربط لإدارة قوائمك من الجوال.'],computer:['هذه نسخة أندرويد APK؛ تشغيلها على الكمبيوتر يحتاج محاكي أندرويد.','شغّل المحاكي، ثم اسحب ملف APK إلى نافذته أو استخدم خيار تثبيت APK.','افتح BLOFY داخل المحاكي. أداء 4K يعتمد على المحاكي وفك الترميز؛ اختبره على الجهاز المستهدف.']};
  const show=type=>{const list=node('ol');instructions[type].forEach(text=>list.append(node('li',text)));$('install-help').replaceChildren(list);document.querySelectorAll('[data-install]').forEach(button=>button.setAttribute('aria-selected',String(button.dataset.install===type)));};
  document.querySelectorAll('[data-install]').forEach(button=>button.addEventListener('click',()=>show(button.dataset.install)));show('phone');
}
if(page==='account'){
  let auth=null;
  const request=(route,extra={})=>api('/api/v1/portal/experience/'+route,{...auth,...extra});
  async function render(){const data=await request('customer');$('account-summary').replaceChildren(node('h2',data.deviceId),definition([['تفعيل التطبيق',labels[data.status]||data.status],['انتهاء التفعيل',data.expiresAt?date(data.expiresAt):data.status==='active'?'بدون تاريخ انتهاء':'—'],['آخر ظهور',date(data.lastSeenAt)],['نسخة التطبيق',data.appVersion]]));
    playlistCards($('account-playlists'),data.playlists,id=>request('check',{playlistId:id}));
    $('account-tickets').replaceChildren();for(const ticket of data.tickets){const row=node('div',null,'support-ticket');row.append(badge(ticket.status),node('p',ticket.description,'content-text'),node('small',date(ticket.created_at),'muted'));$('account-tickets').append(row);}
  }
  $('account-login').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget;const button=form.querySelector('button');button.disabled=true;const values=new FormData(form);auth={deviceId:String(values.get('deviceId')).trim().toUpperCase(),activationCode:String(values.get('activationCode')).trim()};
    setStatus('login-status','جارٍ قراءة الجهاز…');try{await render();form.hidden=true;form.elements.activationCode.value='';$('account-content').hidden=false;$('account-logout').hidden=false;setStatus('login-status','');}catch(error){auth=null;setStatus('login-status',error.message,true);}finally{button.disabled=false;}});
  $('account-logout').addEventListener('click',()=>{auth=null;$('account-content').hidden=true;$('account-summary').replaceChildren();$('account-playlists').replaceChildren();$('account-tickets').replaceChildren();$('account-login').hidden=false;$('account-login').reset();$('account-logout').hidden=true;});
  $('support-form').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget;const button=form.querySelector('button');button.disabled=true;setStatus('support-status','جارٍ إرسال الطلب…');try{await request('support',{description:new FormData(form).get('description')});form.reset();await render();setStatus('support-status','وصل طلبك إلى إدارة BLOFY.');}catch(error){setStatus('support-status',error.message,true);}finally{button.disabled=false;}});
}
if(page==='admin'){
  let selected=null,generation=0,customerGeneration=0,pendingRenewal=null,renewing=false,recordState=null,options=[];
  const record=$('customer-record'),confirmDialog=$('renewal-confirm');
  const request=(route,body)=>api('/api/v1/admin/experience/'+route,body);
  const expiry=(value,status)=>value?date(value):status==='active'?'مدى الحياة':'—';
  function panel(name){for(const key of ['devices','support','releases'])$(key+'-view').hidden=key!==name;document.querySelectorAll('[data-panel]').forEach(b=>b.setAttribute('aria-current',b.dataset.panel===name?'page':'false'));$('admin-view-title').textContent={devices:'الأجهزة والاشتراكات',support:'طلبات الدعم',releases:'إصدارات التطبيق'}[name];}
  document.querySelectorAll('[data-panel]').forEach(button=>button.addEventListener('click',()=>panel(button.dataset.panel)));
  async function overview(){const [data,tickets]=await Promise.all([request('overview'),request('tickets')]);$('overview').replaceChildren();for(const [key,label]of [['total','كل الأجهزة'],['active','تفعيل ساري'],['expired','تفعيل منتهٍ'],['expiring','تنتهي خلال 7 أيام'],['support','طلبات دعم']]){const card=node('div',null,'metric');card.append(node('strong',Number(data[key]||0).toLocaleString('ar-SA')),node('span',label));$('overview').append(card);}
    const box=$('open-tickets');box.replaceChildren(node('h2','طلبات الدعم المفتوحة'));for(const ticket of tickets.items){const row=node('div',null,'support-ticket');row.append(node('strong',ticket.device_id),node('p',ticket.description,'content-text'));const button=node('button','فتح سجل الجهاز ←');button.addEventListener('click',()=>openRecord(ticket.device_id));row.append(button);box.append(row);}if(!tickets.items.length)box.append(node('p','كل شيء هادئ. لا توجد طلبات دعم مفتوحة.','empty'));
  }
  let devicePage=1, deviceItems=[];
  const searchForm=$('customer-search');
  const filterLabel=node('label','عرض الأجهزة'); const filter=node('select');filter.name='filter';
  for(const [value,text] of [['all','كل الأجهزة'],['new24h','جديد خلال 24 ساعة'],['new7d','جديد خلال 7 أيام'],['trial','تجربة'],['active','ساري'],['expired','منتهي'],['blocked','موقوف'],['noPlaylists','بدون قوائم'],['recent','تواصل خلال 10 دقائق'],['inactive7d','لم يتواصل منذ 7 أيام'],['expiring7d','تنتهي خلال 7 أيام']]){const option=node('option',text);option.value=value;filter.append(option);}filterLabel.append(filter);
  const sortLabel=node('label','الترتيب');const sort=node('select');sort.name='sort';
  for(const [value,text]of [['newest','الأحدث تسجيلًا'],['seen','آخر تواصل'],['expiry','الأقرب انتهاءً']]){const option=node('option',text);option.value=value;sort.append(option);}sortLabel.append(sort);
  const versionLabel=node('label','نسخة العميل');const version=node('input');version.name='version';version.placeholder='مثل 2.0.0-rc07.40';version.dir='ltr';versionLabel.append(version);
  searchForm.append(filterLabel,sortLabel,versionLabel);
  filter.onchange=sort.onchange=()=>{devicePage=1;customers();};
  const counters=node('p','','notice');counters.id='device-insights-counts';searchForm.before(counters);
  const pager=node('div',null,'actions');const previous=node('button','السابق'),next=node('button','التالي'),exportButton=node('button','تصدير الصفحة CSV'),pageInfo=node('span','','caption');
  previous.type=next.type=exportButton.type='button';pager.append(previous,pageInfo,next,exportButton);$('customers').append(pager);
  previous.onclick=()=>{if(devicePage>1){devicePage--;customers();}};next.onclick=()=>{devicePage++;customers();};
  const deviceFoot=document.querySelector('#devices-view .admin-foot');if(deviceFoot)deviceFoot.textContent='الجديد = أول تسجيل في خدمة BLOFY، وليس إثباتًا لوقت تنزيل APK. آخر تواصل قد يكون من التطبيق أو بوابة الويب، ولا يعني أن البث يعمل الآن.';
  exportButton.onclick=()=>{const quote=v=>{let t=String(v??'');if(/^[\s\u0000-\u001f]*[=+@-]/.test(t)||/^[\t\r]/.test(t))t="'"+t;return '"'+t.replace(/"/g,'""')+'"';};
    const rows=[['الجهاز','العميل','الجوال','أول تسجيل','آخر تواصل','الحالة','النسخة','عدد القوائم'],...deviceItems.map(x=>[x.deviceId,x.name,x.phone,date(x.firstSeenAt),date(x.lastSeenAt),labels[x.status]||x.status,x.clientVersion,x.playlistCount])];
    const url=URL.createObjectURL(new Blob(['\ufeff'+rows.map(row=>row.map(quote).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));const link=node('a');link.href=url;link.download='blofy-devices-page-'+devicePage+'.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  async function customers(){const current=++customerGeneration;setStatus('admin-status','جارٍ تحديث الأجهزة…');previous.disabled=next.disabled=true;exportButton.disabled=true;
    try{const params=new URLSearchParams(new FormData(searchForm));params.set('page',String(devicePage));const data=await api('/api/v1/admin/device-insights?'+params);if(current!==customerGeneration)return;deviceItems=data.items||[];$('customer-rows').replaceChildren();
      const count=data.counts||{};counters.textContent='أول تسجيل خلال 24 ساعة: '+(count.new24h||0)+' · خلال 7 أيام: '+(count.new7d||0)+' · تواصل حديثًا: '+(count.recent||0)+' · كل الأجهزة: '+(count.total||0);
      for(const item of deviceItems){const row=node('tr');const name=node('td');name.append(node('strong',item.name||item.deviceId));if(item.name)name.append(node('div',item.deviceId,'caption'));
        if(item.isNew)name.append(node('span','جديد · 24 ساعة','badge active'));name.append(node('div','أول تسجيل: '+date(item.firstSeenAt),'caption'),node('div','القوائم: '+item.playlistCount,'caption'));
        const state=node('td');state.append(badge(item.status));const action=node('td');const button=node('button','إدارة ←');button.setAttribute('aria-label','إدارة '+item.deviceId);button.onclick=()=>openRecord(item.deviceId);action.append(button);
        row.append(name,state,node('td',expiry(item.expiresAt,item.status)),node('td',date(item.lastSeenAt)),node('td',item.clientVersion||'غير متاح','version-cell'),action);$('customer-rows').append(row);}
      if(!deviceItems.length){const row=node('tr'),cell=node('td','لا توجد أجهزة مطابقة.','empty');cell.colSpan=6;row.append(cell);$('customer-rows').append(row);}
      pageInfo.textContent='صفحة '+data.page+' · '+data.total+' نتيجة';previous.disabled=devicePage<=1;next.disabled=devicePage*data.pageSize>=data.total;exportButton.disabled=!deviceItems.length;setStatus('admin-status','');
    }catch(error){if(current===customerGeneration){previous.disabled=devicePage<=1;setStatus('admin-status',error.message,true);}}}
  const extra=node('section',null,'card device-insights');extra.id='device-insights';$('record-summary').parentElement.after(extra);
  async function deviceDetails(deviceId,current){extra.replaceChildren(node('p','جارٍ قراءة تفاصيل الجهاز…','caption'));
    try{const data=await api('/api/v1/admin/device-insights/'+encodeURIComponent(deviceId));if(current!==generation||selected!==deviceId)return;
      extra.replaceChildren(node('h3','متابعة الجهاز'),definition([['أول تسجيل في الخدمة',date(data.firstSeenAt)],['بداية التجربة',date(data.trialStartedAt)],['آخر تواصل مع الخدمة',date(data.lastSeenAt)],['نوع آخر عميل',data.platform||'غير متاح'],['نسخة آخر عميل',data.clientVersion||'غير متاح'],['الأيام المتبقية',data.expiresAt==null?(data.status==='active'?'مدى الحياة':'—'):data.remainingDays],['عدد القوائم',data.playlistCount],['القائمة النشطة في الموقع',data.activePlaylist],['آخر تعديل قائمة بالموقع',date(data.playlistUpdatedAt)],['قفل محاولات الدخول حتى',date(data.authLockedUntil)]]));
      extra.append(node('p','وقت تنزيل APK وموديل الجهاز والرام غير متاحة من البيانات الحالية. حفظ القائمة بالموقع لا يثبت وصولها للتطبيق.','caption'));
      const form=node('form');form.className='form device-profile';form.append(node('h3','بيانات العميل وملاحظاتك'));
      for(const [key,label,max]of [['name','اسم العميل',120],['phone','الجوال',32],['email','البريد الإلكتروني',254],['notes','ملاحظات داخلية — لا تضع كلمات مرور',2000]]){const field=node('label',label);const input=node(key==='notes'?'textarea':'input');input.name=key;input.maxLength=max;input.value=data[key]||'';if(key==='email')input.type='email';if(key==='notes')input.rows=3;field.append(input);form.append(field);}
      const save=node('button','حفظ بيانات العميل','primary');save.type='submit';const message=node('p','','status');message.setAttribute('role','status');form.append(save,message);extra.append(form);
      let saving=false;form.onsubmit=async event=>{event.preventDefault();if(saving||current!==generation||!form.reportValidity())return;saving=true;save.disabled=true;
        try{const body=Object.fromEntries(new FormData(form));body.expectedRevision=data.revision;await api('/api/v1/admin/device-insights/'+encodeURIComponent(deviceId),body,'PATCH');if(current!==generation)return;await openRecord(deviceId);if(selected===deviceId)extra.prepend(node('p','تم حفظ بيانات العميل.','status'));customers();}
        catch(error){if(current===generation)message.textContent=error.message;}finally{saving=false;save.disabled=false;}};
      const buttons=node('div',null,'actions');const copy=node('button','نسخ رقم الجهاز');copy.type='button';copy.onclick=()=>navigator.clipboard.writeText(deviceId).then(()=>{message.textContent='تم نسخ رقم الجهاز.';}).catch(()=>{message.textContent='رقم الجهاز: '+deviceId;});
      const block=node('button',data.rawStatus==='blocked'?'إلغاء الإيقاف':'إيقاف الجهاز',data.rawStatus==='blocked'?'':'danger');block.type='button';
      block.onclick=async()=>{if(saving||current!==generation)return;if(!confirm((data.rawStatus==='blocked'?'استعادة تفعيل ':'إيقاف ')+deviceId+' عند التحقق التالي؟ لا يتم حذف القوائم ولا تمديد مدة الاشتراك.'))return;
        saving=true;block.disabled=true;try{await api('/api/v1/admin/device-insights/'+encodeURIComponent(deviceId)+'/status',{action:data.rawStatus==='blocked'?'unblock':'block',expectedStatus:data.rawStatus,expectedExpiresAt:data.expiresAt});if(current!==generation)return;await openRecord(deviceId);customers();overview().catch(()=>{});}
        catch(error){if(current===generation)message.textContent=error.message;}finally{saving=false;block.disabled=false;}};
      buttons.append(copy,block);extra.append(buttons);
    }catch(error){if(current===generation)extra.replaceChildren(node('p','تعذر قراءة التفاصيل الإضافية: '+error.message,'status'));}}
  function updateRenewalAvailability(){const unlimited=recordState?.status==='active'&&recordState.expiresAt==null;const blocked=recordState?.status==='blocked';$('preview-renewal').disabled=!options.length||!selected||unlimited||blocked;for(const input of $('renewal-options').querySelectorAll('input'))input.disabled=unlimited||blocked;if(unlimited||blocked)setStatus('grant-status',unlimited?'هذا الجهاز مفعّل مدى الحياة.':'هذا الجهاز موقوف. التمديد غير متاح.',blocked);}
  async function loadOptions(){try{const result=await request('renewal-options');options=result.items;$('renewal-options').replaceChildren();options.forEach((option,index)=>{const label=node('label');const input=node('input');input.type='radio';input.name='duration';input.value=option.key;input.required=true;input.checked=index===0;label.append(input,node('span',option.name));$('renewal-options').append(label);});updateRenewalAvailability();}catch(error){setStatus('grant-status','تعذر تحميل مدد التمديد. أعد المحاولة.',true);const retry=node('button','إعادة تحميل المدد');retry.type='button';retry.addEventListener('click',loadOptions);$('renewal-options').replaceChildren(retry);}}
  const actions={customer_profile_updated:'حُدثت بيانات العميل',device_blocked:'أُوقف الجهاز',device_unblocked:'أُلغي إيقاف الجهاز',playlist_saved:'حُفظت قائمة',playlist_removed:'حُذفت قائمة',activation_changed:'تغيّر تفعيل الجهاز',subscription_granted:'مُدّد تفعيل التطبيق',support_created:'أُنشئ طلب دعم',support_updated:'تحدّث طلب الدعم',release_updated:'تحدّث إصدار التطبيق'};
  async function openRecord(deviceId){selected=deviceId;const current=++generation;setStatus('admin-status','جارٍ فتح السجل…');try{
    const data=await request('customer?deviceId='+encodeURIComponent(deviceId));if(current!==generation)return;recordState=data;
    $('record-name').textContent=data.customer?.name||data.deviceId;$('record-summary').replaceChildren(definition([['الجهاز',data.deviceId],['الجوال',data.customer?.phone],['البريد',data.customer?.email],['التفعيل',labels[data.status]||data.status],['الانتهاء',expiry(data.expiresAt,data.status)],['آخر تواصل',date(data.lastSeenAt)],['نسخة آخر عميل',data.appVersion]]));
    playlistCards($('record-playlists'),data.playlists,id=>request('check',{deviceId,playlistId:id}));
    $('record-audit').replaceChildren();for(const event of data.audit){const row=node('div',null,'event');const option=options.find(o=>'admin-manual-'+o.key===event.details?.planKey);row.append(node('span',(actions[event.action]||'تحديث الجهاز')+(option?' · '+option.name:'')),node('small',date(event.created_at)+' • '+(event.actor==='device'?'من الجهاز أو بوابته':'المشرف')));$('record-audit').append(row);}if(!data.audit.length)$('record-audit').append(node('p','ستظهر تغييرات الجهاز هنا.','empty'));
    $('record-support').replaceChildren();for(const ticket of data.tickets){const row=node('div',null,'support-ticket');row.append(badge(ticket.status),node('p',ticket.description,'content-text'),node('small',date(ticket.created_at),'muted'));const button=node('button',ticket.status==='open'?'تم حل المشكلة':'إعادة فتح');button.addEventListener('click',async()=>{button.disabled=true;try{await request('support',{deviceId,ticketId:ticket.id,status:ticket.status==='open'?'resolved':'open'});await openRecord(deviceId);await overview();}catch(error){setStatus('admin-status',error.message,true);button.disabled=false;}});row.append(button);$('record-support').append(row);}if(!data.tickets.length)$('record-support').append(node('p','لا توجد طلبات دعم لهذا الجهاز.','empty'));
    setStatus('grant-status','');updateRenewalAvailability();if(!record.open){record.showModal();record.scrollTop=0;}setStatus('admin-status','');
    deviceDetails(deviceId,current);
    // Diagnostics must not delay opening the customer or renewing the application.
    $('record-diagnostics').replaceChildren(node('p','جارٍ قراءة محاولات التشغيل…','muted'));
    api('/api/v1/admin/diagnostics?limit=12&deviceId='+encodeURIComponent(deviceId)).then(diagnostics=>{if(current!==generation)return;$('record-diagnostics').replaceChildren();for(const item of diagnostics.items||[]){const row=node('div',null,'event');const name=data.playlists.find(p=>p.providerKey===item.providerKey)?.name||'قائمة سابقة أو محلية';row.append(node('strong',name+' • '+({live:'بث مباشر',movie:'فيلم',episode:'حلقة',catalog:'تحميل حلقات'}[item.contentKind]||'تشغيل')),node('p',item.errorCode?'تعثر التشغيل • '+item.errorCode:item.ttffMs!=null?'أول صورة خلال '+(item.ttffMs/1000).toFixed(1)+' ث':'تم تسجيل المحاولة'),node('small',date(item.createdAt)+' • '+(item.appVersion||'—')));$('record-diagnostics').append(row);}if(!diagnostics.items?.length)$('record-diagnostics').append(node('p','لا توجد محاولات مسجلة.','empty'));}).catch(()=>{if(current===generation)$('record-diagnostics').replaceChildren(node('p','تعذر تحميل محاولات التشغيل. يمكنك متابعة إدارة الاشتراك.','muted'));});
  }catch(error){if(current===generation)setStatus('admin-status',error.message,true);}}
  $('customer-search').addEventListener('submit',event=>{event.preventDefault();devicePage=1;customers();});$('refresh-customers').addEventListener('click',()=>{customers();overview().catch(error=>setStatus('admin-status',error.message,true));});
  $('close-record').addEventListener('click',()=>record.close());record.addEventListener('close',()=>{selected=null;recordState=null;generation++;});
  $('admin-logout').addEventListener('click',async()=>{try{await api('/api/v1/admin/session/logout',{});location.assign('/admin');}catch(error){setStatus('admin-status',error.message,true);}});
  $('grant-form').addEventListener('submit',async event=>{event.preventDefault();if(!selected)return;const deviceId=selected;const button=$('preview-renewal');button.disabled=true;setStatus('grant-status','جارٍ حساب المدة…');try{const duration=new FormData(event.currentTarget).get('duration');const preview=await request('renewal-preview',{deviceId,duration});if(selected!==deviceId)return;pendingRenewal={deviceId,duration,requestId:crypto.randomUUID(),expectedExpiresAt:preview.previousExpiresAt};$('renewal-summary').replaceChildren(definition([['الجهاز',deviceId],['المدة',preview.name],['الانتهاء الحالي',expiry(preview.previousExpiresAt,recordState.status)],['الانتهاء بعد التمديد',preview.expiresAt?date(preview.expiresAt):'مدى الحياة — بدون انتهاء']]));setStatus('grant-status','');setStatus('renewal-status','');confirmDialog.showModal();}catch(error){setStatus('grant-status',error.message,true);}finally{updateRenewalAvailability();}});
  $('cancel-renewal').addEventListener('click',()=>{if(!renewing){pendingRenewal=null;confirmDialog.close();}});confirmDialog.addEventListener('cancel',event=>{if(renewing)event.preventDefault();else pendingRenewal=null;});
  $('confirm-renewal').addEventListener('click',async()=>{if(!pendingRenewal||renewing)return;renewing=true;const payload=pendingRenewal;const confirmButton=$('confirm-renewal');confirmButton.disabled=true;$('cancel-renewal').disabled=true;setStatus('renewal-status','جارٍ حفظ التمديد…');try{const result=await request('renew',payload);pendingRenewal=null;confirmDialog.close();await openRecord(payload.deviceId);setStatus('grant-status',result.expiresAt?'تم التمديد. الانتهاء الجديد: '+date(result.expiresAt):'تم تفعيل الجهاز مدى الحياة.');customers();overview().catch(()=>{});}catch(error){setStatus('renewal-status',error.message,true);}finally{renewing=false;confirmButton.disabled=false;$('cancel-renewal').disabled=false;}});
  $('release-form').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget;const button=form.querySelector('button');button.disabled=true;try{await request('releases',Object.fromEntries(new FormData(form)));setStatus('release-status','حُفظ الإصدار في مركز التحميل.');await releaseCards($('admin-releases'));}catch(error){setStatus('release-status',error.message,true);}finally{button.disabled=false;}});
  loadOptions();customers();overview().catch(error=>setStatus('admin-status',error.message,true));releaseCards($('admin-releases'));
}
