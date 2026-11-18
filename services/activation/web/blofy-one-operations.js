/* BLOFY ONE — integrated operator workspace.
 * Existing same-origin signed admin cookie; no credentials in browser storage.
 * Only explicit owner-confirmed release selection mutates backend state.
 */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  if(!$('one-sources'))return;

  const sets={
    sources:{button:$('one-sources-refresh'),status:$('one-sources-status'),items:[],loaded:false},
    storage:{button:$('one-storage-refresh'),status:$('one-storage-status')},
    distributors:{button:$('one-distributors-refresh'),status:$('one-distributors-status'),items:[],loaded:false},
    releases:{button:$('one-releases-refresh'),status:$('one-releases-status'),items:[],state:null,loaded:false}
  };
  const safeNumber=value=>{
    if(value===null||value===undefined||value==='')return '—';
    const n=Number(value);
    return Number.isSafeInteger(n)&&n>=0?n.toLocaleString('en-US'):'—';
  };
  const date=value=>{
    if(!value)return 'غير محدد';
    const n=new Date(value).getTime();
    return Number.isFinite(n)&&n>0?
      new Date(n).toLocaleDateString('ar-SA',{year:'numeric',month:'short',day:'numeric'}):'غير معروف';
  };
  const el=(tag,text,cls)=>{
    const node=document.createElement(tag);
    node.textContent=String(text??'');
    if(cls)node.className=cls;
    return node;
  };
  function status(group,message,error=false){
    group.status.textContent=message;
    group.status.classList.toggle('is-error',error);
  }
  function emptyRow(body,text,colspan){
    body.replaceChildren();
    const tr=document.createElement('tr'),td=el('td',text);
    td.colSpan=colspan;tr.append(td);body.append(tr);
  }
  async function request(path,{method='GET',body}={}){
    const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),14500);
    try{
      const r=await fetch(path,{method,credentials:'same-origin',cache:'no-store',
        headers:{accept:'application/json',...(body===undefined?{}:{'content-type':'application/json'})},
        body:body===undefined?undefined:JSON.stringify(body),signal:ctrl.signal});
      if(r.status===401)throw Error('انتهت جلسة الإدارة. ادخل /admin وأعد تسجيل الدخول.');
      if(r.status===429)throw Error('طلبات كثيرة. أعد المحاولة لاحقًا.');
      const data=await r.json().catch(()=>({}));
      if(!r.ok||data.ok===false)throw Error(
        data.error==='release_changed'?
          'تغيّر إصدار التطبيق من جلسة أخرى؛ حدّث السجل قبل المحاولة.':
        'الخدمة لم تؤكد الطلب (HTTP '+r.status+').');
      return data;
    }catch(e){
      if(e.name==='AbortError')throw Error('انتهت مهلة قراءة الخدمة.');
      throw e;
    }finally{clearTimeout(timer)}
  }
  function badge(text,tone='warn'){return el('span',text,'one-ops-badge '+tone);}
  function anyArray(payload,keys=['items']){
    if(Array.isArray(payload))return payload;
    for(const key of keys)if(Array.isArray(payload?.[key]))return payload[key];
    return null;
  }
  function sourceState(s){
    if(s.enabled!==true)return ['موقوف','bad'];
    if(s.status==='offline'||s.status==='error'||s.lastError)return ['يحتاج فحصًا','bad'];
    if(s.status==='online'||s.status==='ready')return ['متصل حسب آخر فحص','good'];
    return ['مفعّل · الاتصال غير مؤكد','warn'];
  }
  function renderSources(){
    const group=sets.sources,rows=$('one-sources-rows');
    rows.replaceChildren();
    const query=$('one-sources-search').value.trim().toLocaleLowerCase('ar');
    const matched=group.items.filter(s=>String(s.name||s.label||'').toLocaleLowerCase('ar').includes(query));
    const list=matched.slice(0,80);
    for(const s of list){
      const tr=document.createElement('tr');
      const label=el('td','');
      label.append(el('strong',String(s.name||s.label||'مصدر BLOFY').slice(0,90)));
      const state=el('td','');const [msg,tone]=sourceState(s);state.append(badge(msg,tone));
      const published=el('td','');published.append(badge(s.publishCatalog===true?'ينشر':'لا ينشر',
        s.publishCatalog===true?'good':'warn'));
      const test=el('td','');test.textContent=date(s.lastTestAt);
      tr.append(label,state,published,el('td',date(s.lastSyncAt)),test);
      rows.append(tr);
    }
    if(!list.length)emptyRow(rows,group.loaded?'لا توجد مصادر مطابقة للبحث.':'تعذر قراءة قائمة المصادر.',5);
    const sources=group.items;
    $('one-src-total').textContent=group.loaded?safeNumber(sources.length):'—';
    $('one-src-active').textContent=group.loaded?safeNumber(sources.filter(x=>x.enabled===true).length):'—';
    $('one-src-published').textContent=group.loaded?safeNumber(sources.filter(x=>x.publishCatalog===true).length):'—';
    $('one-src-alerts').textContent=group.loaded?
      safeNumber(sources.filter(x=>x.enabled===true&&(x.lastError||x.status==='offline'||x.status==='error')).length):'—';
    if(group.loaded)status(group,'مصادر مسجلة: '+safeNumber(sources.length)+
      ' · المعروض: '+safeNumber(list.length)+(matched.length>80?' · يظهر أول 80 نتيجة فقط.':'')+
      ' · لا يعني هذا أن القنوات تعمل.');
  }
  async function refreshSources(){
    const group=sets.sources;
    if(group.button.disabled)return;
    group.button.disabled=true;status(group,'جارٍ قراءة المصادر الحقيقية…');
    try{
      const data=await request('/api/v1/admin/xtream/servers');
      if(!Array.isArray(data.items))throw Error('واجهة المصادر لم تُرجع القائمة المتوقعة.');
      group.items=data.items.filter(x=>x&&typeof x==='object');
      group.loaded=true;renderSources();
    }catch(e){
      group.items=[];group.loaded=false;
      $('one-src-total').textContent='—';$('one-src-active').textContent='—';
      $('one-src-published').textContent='—';$('one-src-alerts').textContent='—';
      emptyRow($('one-sources-rows'),'المصادر غير متاحة الآن.',5);
      status(group,e.message,true);
    }finally{group.button.disabled=false}
  }
  function availability(flag){return flag===true?'متاح':flag===false?'غير متاح':'غير مؤكد';}
  function running(flag){return flag===true?'نعم':flag===false?'لا':'غير مؤكد';}
  function renderRuns(items){
    const area=$('one-hub-runs');area.replaceChildren();
    if(!Array.isArray(items)||!items.length){
      area.append(el('p','لم تُرجع الخدمة مهامًا سابقة قابلة للعرض.','one-ops-status'));return;
    }
    for(const row of items.slice(0,8)){
      if(!row||typeof row!=='object')continue;
      const card=document.createElement('article');card.className='one-ops-run';
      const label=String(row.label||row.title||row.mediaKind||row.kind||'مهمة محتوى').slice(0,90);
      // Never show raw source URLs, provider credential fields, S3 paths,
      // untrusted metadata objects or media asset identities.
      card.append(el('strong',label),
        el('span','الحالة: '+String(row.status||row.state||'غير مؤكدة').slice(0,50)),
        el('small','آخر تحديث: '+date(row.updatedAt||row.completedAt||row.createdAt)));
      area.append(card);
    }
    if(!area.childElementCount)area.append(el('p','لا تتوفر مهام موثقة حاليًا.','one-ops-status'));
  }
  async function refreshStorage(){
    const group=sets.storage;if(group.button.disabled)return;
    group.button.disabled=true;status(group,'جارٍ قراءة حالة التخزين والتجهيز…');
    try{
      const data=await request('/api/v1/admin/content-hub/status');
      if(data.ok!==true)throw Error('لم يؤكد Content Hub صحته.');
      $('one-hub-database').textContent=availability(data.databaseAvailable);
      $('one-hub-bucket').textContent=availability(data.privateBucketAvailable);
      $('one-hub-pilot').textContent=running(data.pilotRunning);
      $('one-hub-batch').textContent=availability(data.chunkedBatchEnabled);
      renderRuns(data.runs);
      status(group,'حالة الخدمة: '+String(data.service||'غير مؤكدة').slice(0,35)+
        ' · الفحص لا يثبت تشغيل الملفات على جهاز العميل.');
    }catch(e){
      for(const id of ['database','bucket','pilot','batch'])$('one-hub-'+id).textContent='—';
      renderRuns([]);status(group,e.message,true);
    }finally{group.button.disabled=false}
  }
  function renderDistributors(){
    const group=sets.distributors,body=$('one-distributors-rows');
    body.replaceChildren();
    const query=$('one-distributors-search').value.trim().toLocaleLowerCase('ar');
    const filtered=group.items.filter(d=>
      [d.name,d.username].join(' ').toLocaleLowerCase('ar').includes(query));
    for(const d of filtered.slice(0,80)){
      const tr=document.createElement('tr');
      const label=el('td','');label.append(el('strong',String(d.name||'موزع BLOFY').slice(0,95)));
      const state=el('td','');state.append(badge(d.enabled===true?'مفعّل':'موقوف',d.enabled===true?'good':'bad'));
      const user=el('td','');user.append(el('code',String(d.username||'—').slice(0,60)));
      tr.append(label,user,state,el('td',safeNumber(d.credits)));
      body.append(tr);
    }
    if(!body.childElementCount)emptyRow(body,group.loaded?'لا يوجد موزعون مطابقون.':'تعذر تحميل الموزعين.',4);
    $('one-dist-total').textContent=group.loaded?safeNumber(group.items.length):'—';
    $('one-dist-active').textContent=group.loaded?safeNumber(group.items.filter(d=>d.enabled===true).length):'—';
    if(group.loaded)status(group,'تم تحديث '+safeNumber(group.items.length)+
      ' موزعًا · يعرض البحث أول 80 نتيجة دون بيانات دخول حساسة.');
  }
  async function refreshDistributors(){
    const group=sets.distributors;if(group.button.disabled)return;
    group.button.disabled=true;status(group,'جارٍ الاتصال بسجل موزعي BLOFY STREAM…');
    try{
      const data=await request('/operator/api/distributors');
      const items=anyArray(data,['items','distributors']);
      if(!items)throw Error('سجل الموزعين لم يُرجع قائمة مؤكدة.');
      group.items=items.filter(x=>x&&typeof x==='object');group.loaded=true;
      renderDistributors();
    }catch(e){
      group.items=[];group.loaded=false;
      $('one-dist-total').textContent='—';$('one-dist-active').textContent='—';
      emptyRow($('one-distributors-rows'),'تعذر قراءة الموزعين؛ لا يُعرض أي عدد تقديري.',4);
      status(group,'قد تكون وصلة مشرف STREAM غير متاحة: '+e.message,true);
    }finally{group.button.disabled=false}
  }
  function renderReleases(){
    const group=sets.releases,body=$('one-releases-rows');
    body.replaceChildren();
    const sorted=group.items.slice().sort((a,b)=>Number(b.versionCode||0)-Number(a.versionCode||0));
    for(const rel of sorted.slice(0,100)){
      if(!rel?.id)continue;
      const tr=document.createElement('tr');
      const name=el('td','');name.append(el('strong',String(rel.versionName||'نسخة BLOFY').slice(0,85)));
      const statusCell=el('td','');statusCell.append(badge(rel.isPrimary?'الإصدار الأساسي':'مسجّل',
        rel.isPrimary?'good':'warn'));
      const action=el('td','');
      const button=el('button',rel.isPrimary?'معتمد':'اعتماد أساسي','one-ops-smallbutton');
      button.type='button';
      button.disabled=rel.isPrimary||!/^https:\/\//i.test(String(rel.downloadUrl||''));
      button.title=rel.isPrimary?'هذا هو الإصدار الأساسي بالفعل':
        'يحتاج تأكيد توقيع APK وتاريخ الإصدار يدويًا قبل تغيير روابط التحديث';
      button.addEventListener('click',()=>{void makePrimary(rel,button);});
      action.append(button);
      tr.append(name,el('td',safeNumber(rel.versionCode)),
        el('td',String(rel.channel||'—').slice(0,35)),statusCell,action);
      body.append(tr);
    }
    if(!body.childElementCount)emptyRow(body,group.loaded?'لا توجد إصدارات في الكتالوج.':'الإصدارات غير متاحة.',5);
    const primary=group.items.find(i=>i?.id===group.state?.primaryId||i?.isPrimary===true);
    $('one-release-primary').textContent=primary?String(primary.versionName||primary.versionCode):'—';
    $('one-release-count').textContent=group.loaded?safeNumber(group.items.length):'—';
    if(group.loaded)status(group,'الإصدارات المسجلة: '+safeNumber(group.items.length)+
      ' · العدد مأخوذ من كتالوج التطبيق الموجود، ولا يثبت توقيع APK أو نشره للمتجر.');
  }
  async function refreshReleases(){
    const group=sets.releases;if(group.button.disabled)return;
    group.button.disabled=true;status(group,'جارٍ تحميل الإصدارات من كتالوج BLOFY PLAYER…');
    try{
      const data=await request('/api/v1/admin/experience/releases');
      if(!Array.isArray(data.items)||!Number.isSafeInteger(data.selectionRevision))
        throw Error('كتالوج الإصدارات غير مكتمل.');
      group.items=data.items.filter(x=>x&&typeof x==='object');
      group.state={primaryId:data.primaryId,revision:data.selectionRevision};
      group.loaded=true;renderReleases();
    }catch(e){
      group.loaded=false;group.items=[];group.state=null;
      $('one-release-primary').textContent='—';$('one-release-count').textContent='—';
      emptyRow($('one-releases-rows'),'تعذر التحقق من كتالوج الإصدارات.',5);
      status(group,e.message,true);
    }finally{group.button.disabled=false}
  }
  let publishing=false;
  async function makePrimary(rel,button){
    const group=sets.releases;
    if(publishing||!group.loaded||!group.state||rel.isPrimary||
       !Number.isSafeInteger(rel.revision)||!Number.isSafeInteger(group.state.revision))
      return;
    // This is a real production release switch. Require multiple explicit
    // acts; no downloads or automatic updates are triggered by loading page.
    if(!window.confirm('هذا الإجراء يغيّر الإصدار الأساسي في كتالوج BLOFY PLAYER وقد يؤثر على تحديثات العملاء. هل تحققت خارج الموقع من توقيع APK وصحة الرابط؟'))return;
    const target=String(rel.versionName||rel.versionCode);
    const typed=window.prompt('لتأكيد اعتماد النسخة، اكتب اسم الإصدار كما هو:\n'+target,'');
    if(typed!==target){status(group,'ألغي التغيير لأن اسم النسخة لم يتطابق.',true);return;}
    if(!window.confirm('تأكيد نهائي: اعتماد '+target+' إصدارًا أساسيًا الآن؟'))return;
    publishing=true;button.disabled=true;
    status(group,'جارٍ اعتماد الإصدار المحدد في السجل…');
    try{
      const data=await request('/api/v1/admin/experience/releases/'+encodeURIComponent(rel.id)+'/primary',{
        method:'POST',body:{expectedRevision:rel.revision,
          expectedSelectionRevision:group.state.revision}
      });
      if(data.ok!==true)throw Error('الخدمة لم تؤكد اعتماد النسخة.');
      status(group,'تم قبول طلب الاعتماد. جارٍ التحقق من السجل بعد التغيير…');
      // No automatic retry of a release write after an ambiguous response.
      await refreshReleases();
      const verified=group.state?.primaryId===rel.id;
      status(group,verified?'تم التحقق من اعتماد '+target+' من كتالوج الإصدارات.':
        'لم يُثبت التغيير بعد القراءة. راجع كتالوج الإصدارات قبل أي إعادة إرسال.',!verified);
    }catch(e){status(group,'تعذر تأكيد الاعتماد: '+e.message+
      ' · حدّث الكتالوج قبل إعادة تنفيذ أي أمر.',true);}
    finally{publishing=false;button.disabled=false}
  }
  $('one-sources-search').addEventListener('input',renderSources);
  $('one-distributors-search').addEventListener('input',renderDistributors);
  sets.sources.button.addEventListener('click',()=>void refreshSources());
  sets.storage.button.addEventListener('click',()=>void refreshStorage());
  sets.distributors.button.addEventListener('click',()=>void refreshDistributors());
  sets.releases.button.addEventListener('click',()=>void refreshReleases());
  $('one-refresh')?.addEventListener('click',()=>{
    void refreshSources();void refreshStorage();void refreshDistributors();void refreshReleases();
  });
  // Real owner-confirmed code issuance. Issued vouchers are kept in memory
  // for 90 seconds; no auto-redemption, recording a sale or new subscription clock.
  const issueForm=$('one-issue-form');
  const issueResult=$('one-issue-result'),issueArea=$('one-issue-code-list');
  const issueStatus=$('one-issue-status'),issueButton=$('one-issue-submit');
  let issuedCodes=[],issueTimer=null,issuing=false;
  function hideIssued(){
    clearTimeout(issueTimer);issueTimer=null;
    issuedCodes=[];issueArea.replaceChildren();
    issueResult.hidden=true;
  }
  function issueMessage(message,isError=false){
    issueStatus.textContent=message;issueStatus.classList.toggle('is-error',isError);
  }
  async function issueCodes(event){
    event.preventDefault();
    if(issuing||!issueForm.reportValidity())return;
    const f=issueForm.elements;
    const payload={
      durationDays:Number(f.durationDays.value),quantity:Number(f.quantity.value),
      maxConnections:Number(f.maxConnections.value),
      channel:String(f.channel.value),label:String(f.label.value).trim(),
      sourceId:'d2bb0397-1c56-4751-adc9-1a17758022f6'
    };
    if(![30,90,180,365].includes(payload.durationDays)||
       !Number.isInteger(payload.quantity)||payload.quantity<1||payload.quantity>20||
       ![1,2].includes(payload.maxConnections)||
       !['app','xtream'].includes(payload.channel)||!payload.label||payload.label.length>95){
      issueMessage('القيم المختارة غير صالحة. راجع نوع الكود والعدد والمدة.',true);return;
    }
    const type=payload.channel==='app'?'BLOFY STREAM':'Xtream';
    if(!window.confirm('إصدار '+payload.quantity+' كود '+type+
      ' لمدة '+payload.durationDays+' يومًا بعد أول تفعيل، من مصدر صالح فقط؟\n'+
      'لن يبدأ وقت الاشتراك الآن، ولن تُسجل عملية بيع.'))return;
    if(payload.quantity>5&&!window.confirm('أنت على وشك إصدار دفعة كبيرة من '+payload.quantity+' كودًا. تأكد من العدد لتجنب تكرار إصدار أكواد غير مقصودة. هل تؤكد الإصدار؟'))return;
    issuing=true;issueButton.disabled=true;hideIssued();
    issueMessage('جارٍ إصدار الأكواد؛ لا تُكرر الطلب إذا تأخر اتصال الشبكة…');
    try{
      const result=await request('/api/v1/admin/xtream-gateway/codes',{
        method:'POST',body:payload
      });
      const items=Array.isArray(result.items)?result.items:[];
      if(result.ok!==true||items.length!==payload.quantity||
         items.some(x=>typeof x.code!=='string'||
           !/^(?:[0-9]{8,12}|[A-F0-9]{24})$/.test(x.code)))
        throw Error('رد الإصدار غير مكتمل. تحقق من سجل الأكواد قبل طلب إصدار آخر.');
      if(document.hidden){
        issueMessage('تم إصدار الأكواد لكن الصفحة مخفية. استرجعها من سجل الأكواد بعد العودة.');
      }else{
        issuedCodes=items.map(x=>x.code);
        issueArea.replaceChildren();
        issuedCodes.forEach((code,index)=>{
          const row=document.createElement('div');row.className='one-issue-code';
          row.append(el('span','كود '+(index+1)),el('code',code));
          issueArea.append(row);
        });
        issueResult.hidden=false;
        issueTimer=window.setTimeout(hideIssued,90000);
        issueMessage('تم إصدار '+items.length+' كودًا؛ لم تبدأ مدة الاشتراك ولم تُسجّل عملية بيع.');
      }
      $('one-stream-refresh')?.click();
    }catch(error){
      issueMessage('لم نتمكن من تأكيد نتيجة الإصدار: '+error.message+
        ' تحقق من سجل الأكواد قبل محاولة أخرى لمنع التكرار.',true);
    }finally{issuing=false;issueButton.disabled=false;}
  }
  issueForm.addEventListener('submit',event=>{void issueCodes(event);});
  $('one-issue-copy').addEventListener('click',async()=>{
    if(!issuedCodes.length)return;
    try{
      await navigator.clipboard.writeText(issuedCodes.join('\n'));
      issueMessage('نُسخت الأكواد. تذكر إخفاء بيانات العملاء بعد استخدامها.');
    }catch{issueMessage('تعذر النسخ التلقائي، انسخ من الحقول مباشرة.',true)}
  });
  $('one-issue-hide').addEventListener('click',hideIssued);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)hideIssued();});
  window.addEventListener('pagehide',hideIssued);

  void Promise.allSettled([
    refreshSources(),refreshStorage(),refreshDistributors(),refreshReleases()
  ]);
})();