/* BLOFY STREAM Professional Operations Console
   Client-side enhancement of the existing authenticated admin dashboard.
   Read-only source insights, local CSV export, and navigation. No provider
   credentials, hidden mutations, remote SDKs, or new streaming endpoints. */
(() => {
  'use strict';
  const byId=id=>document.getElementById(id);
  const q=selector=>document.querySelector(selector);
  const fmt=value=>Math.max(0,Number(value)||0).toLocaleString('en-US');
  const normalized=value=>String(value||'').toLocaleLowerCase('ar').replace(/[\u064B-\u065F\u0640]/g,'').trim();
  let snapshot={sources:[],totals:{live:0,movie:0,series:0,servers:0}};
  let accountSummary=null;
  let lastSourceSummaryLoaded=false;
  let autoRefreshEnabled=false;
  let autoRefreshTimer=null;
  let selectedIndex=0;
  let visibleCommands=[];
  const palette=byId('streamCommandDialog');
  const search=byId('streamCommandInput');
  const results=byId('streamCommandResults');

  function clickExisting(selector){const button=q(selector);if(button)button.click();}
  function openWorkspace(mode){clickExisting('[data-open-workspace="'+mode+'"]');}
  function openTab(tab){clickExisting('[data-open-tab="'+tab+'"]');}
  function focusSource(source){
    openWorkspace('sources');
    const field=byId('xtSourceSearch'),filter=byId('xtSourceFilter');
    if(filter){filter.value='all';filter.dispatchEvent(new Event('change',{bubbles:true}));}
    if(field){
      field.value=String(source.id||source.name||'');
      field.dispatchEvent(new Event('input',{bubbles:true}));
      field.focus({preventScroll:true});
    }
    byId('xtreamManager')?.scrollIntoView({behavior:'smooth',block:'start'});
  }
  function openIssues(){
    openWorkspace('sources');
    const filter=byId('xtSourceFilter'),field=byId('xtSourceSearch');
    if(field){field.value='';field.dispatchEvent(new Event('input',{bubbles:true}));}
    if(filter){filter.value='issues';filter.dispatchEvent(new Event('change',{bubbles:true}));}
  }
  function newSource(){
    openWorkspace('sources');
    byId('xtNewSourceBtn')?.click();
  }
  const defaultCommands=[
    {title:'الرئيسية',description:'ملخص عمليات BLOFY',icon:'⌂',keywords:'dashboard home الرئيسية',action:()=>openTab('home')},
    {title:'المصادر',description:'فحص وإضافة ومزامنة المصادر',icon:'▤',keywords:'xtream source host مصدر',action:()=>openWorkspace('sources')},
    {title:'إضافة مصدر Xtream',description:'افتح نموذج إضافة مصدر جديد',icon:'＋',keywords:'add new source إضافة هوست',action:newSource},
    {title:'المشتركون',description:'إنشاء وإدارة حسابات العملاء',icon:'◎',keywords:'accounts users customer subscription عملاء',action:()=>openWorkspace('accounts')},
    {title:'فحص التشغيل',description:'أخطاء 401 و404 و502 وفحص المحتوى',icon:'◷',keywords:'diagnostics probe health 401 404 502 خطأ',action:()=>openWorkspace('diagnostics')},
    {title:'مصادر تحتاج متابعة',description:'عرض المصادر التي سجلت أخطاء',icon:'!',keywords:'errors alerts offline problems مشاكل',action:openIssues},
    {title:'المكتبة',description:'القنوات والأفلام والمسلسلات',icon:'▦',keywords:'catalog movie live series films مكتبة',action:()=>openTab('catalog')},
    {title:'التحكم المتقدم',description:'الهوية والتخصيص وأدوات الإدارة',icon:'⚙',keywords:'studio advanced settings إعدادات',action:()=>openTab('studio')},
    {title:'تحديث البيانات',description:'جلب آخر الأرقام دون تعديل البيانات',icon:'↻',keywords:'refresh update reload تحديث',action:()=>byId('refreshBtn')?.click()},
    {title:'تصدير ملخص المصادر',description:'ملف CSV بدون كلمات مرور أو حسابات',icon:'↓',keywords:'csv export report تقرير',action:exportSnapshot}
  ];
  function buildCommands(query){
    const phrase=normalized(query);
    const staticItems=defaultCommands
      .filter(item=>!phrase||normalized(item.title+' '+item.description+' '+item.keywords).includes(phrase));
    if(!phrase)return staticItems.slice(0,8);
    const matchedSources=snapshot.sources
      .filter(item=>normalized(item.name).includes(phrase)||normalized(item.id).includes(phrase))
      .slice(0,12).map(source=>({
        title:source.name,
        description:source.issue?'مصدر يحتاج متابعة':source.enabled?'مصدر مسجل ومفعل':'مصدر متوقف',
        icon:'▤',action:()=>focusSource(source)
      }));
    return [...matchedSources,...staticItems].slice(0,17);
  }
  function runCommand(index){
    const chosen=visibleCommands[index];
    if(!chosen)return;
    if(palette?.open)palette.close();
    chosen.action();
  }
  function renderCommands(value=''){
    if(!results)return;
    visibleCommands=buildCommands(value);
    selectedIndex=0;
    results.replaceChildren();
    if(!visibleCommands.length){
      const empty=document.createElement('p');
      empty.className='premium-command-empty';
      empty.textContent='لا توجد نتائج مطابقة. جرّب اسم مصدر أو كلمة أخرى.';
      results.append(empty);
      return;
    }
    visibleCommands.forEach((item,i)=>{
      const button=document.createElement('button');
      button.type='button';button.className='premium-command-result';
      button.setAttribute('role','option');button.setAttribute('aria-selected',String(i===0));
      const icon=document.createElement('span');icon.className='premium-command-result-icon';
      icon.textContent=item.icon||'⌕';icon.setAttribute('aria-hidden','true');
      const name=document.createElement('span');name.className='premium-command-result-label';
      const title=document.createElement('strong');title.textContent=item.title;
      const desc=document.createElement('small');desc.textContent=item.description||'';
      name.append(title,desc);
      const shortcut=document.createElement('span');shortcut.className='premium-command-result-shortcut';
      shortcut.textContent='↵';shortcut.setAttribute('aria-hidden','true');
      button.append(icon,name,shortcut);
      button.addEventListener('click',()=>runCommand(i));
      results.append(button);
    });
  }
  function chooseIndex(next){
    const len=visibleCommands.length;
    if(!len)return;
    selectedIndex=((next%len)+len)%len;
    [...results.querySelectorAll('[role="option"]')].forEach((node,i)=>{
      node.setAttribute('aria-selected',String(i===selectedIndex));
      if(i===selectedIndex)node.scrollIntoView({block:'nearest'});
    });
  }
  function openPalette(){
    if(!palette||typeof palette.showModal!=='function')return;
    if(!palette.open)palette.showModal();
    search.value='';renderCommands();search.focus();
  }

  function number(value){const n=Number(value);return Number.isFinite(n)?Math.max(0,Math.floor(n)):0;}
  function elementText(id,value){const node=byId(id);if(node)node.textContent=value;}
  function makeAlert(description,source){
    const li=document.createElement('li');
    const inner=document.createElement('div');
    const name=document.createElement('strong');name.textContent=source.name;
    const detail=document.createElement('small');detail.textContent=description;
    inner.append(name,detail);
    const action=document.createElement('button');action.type='button';
    action.textContent='فتح المصدر';action.addEventListener('click',()=>focusSource(source));
    li.append(inner,action);return li;
  }
  const SOURCE_ISSUE_LABELS=Object.freeze({
    xtream_sync_state_uncertain:'مزامنة قديمة غير مؤكدة · راجع بطاقة المصدر',
    xtream_transport_dns_failed:'تعذر DNS · تحقق من اسم المصدر',
    xtream_transport_connection_refused:'اتصال مرفوض · راجع منفذ المصدر',
    xtream_transport_connection_reset:'اتصال منقطع · المصدر قطع الطلب',
    xtream_transport_timeout:'مهلة اتصال · المصدر لم يستجب',
    xtream_transport_tls_invalid:'شهادة HTTPS تحتاج تصحيحًا',
    xtream_transport_unreachable:'تعذر الوصول من Railway إلى المصدر',
    xtream_http_401:'رفض مصادقة المصدر 401',
    xtream_http_403:'المصدر رفض الوصول 403',
    xtream_http_404:'مسار المصدر غير متاح 404',
    xtream_http_456:'المزود رفض الطلب 456',
    xtream_catalog_empty_preserved:'قائمة فارغة · المكتبة السابقة محفوظة',
    xtream_catalog_suspicious_drop_preserved:'قائمة ناقصة · منع حذف المكتبة'
  });

  function renderAlerts(sources){
    const list=byId('premiumSourceAlerts');
    if(!list)return;
    list.replaceChildren();
    const problems=sources.filter(s=>s.issue);
    const untested=sources.filter(s=>s.enabled&&!s.tested&&!s.issue);
    if(!sources.length){
      const row=document.createElement('li');row.className='premium-no-alert';
      row.textContent='لا توجد مصادر مضافة. ابدأ بإضافة مصدر مصرح به.';
      list.append(row);
      elementText('premiumIssueHeadline','لا توجد مصادر');
    }else if(!problems.length&&!untested.length){
      const row=document.createElement('li');row.className='premium-no-alert';
      row.textContent='لا تظهر أخطاء مصادر مسجلة حاليًا. فحص الفيديو خطوة مستقلة.';
      list.append(row);
      elementText('premiumIssueHeadline','لا توجد أخطاء مسجلة');
    }else{
      const attention=[...problems.slice(0,3),...untested.slice(0,Math.max(0,3-problems.length))];
      for(const source of attention){
        const text=source.issue?(SOURCE_ISSUE_LABELS[source.issueCode]||'آخر اتصال أو مزامنة يحتاج مراجعة'):'المصدر لم يخضع لاختبار اتصال مسجل';
        list.append(makeAlert(text,source));
      }
      elementText('premiumIssueHeadline',fmt(problems.length)+' مصدر بأخطاء · '+fmt(untested.length)+' غير مفحوص');
    }
  }
  function renderCatalog(totals){
    const live=number(totals.live),movie=number(totals.movie),series=number(totals.series);
    const total=live+movie+series;
    elementText('premiumCatalogTotal',fmt(total));
    const values=[live,movie,series];
    for(const [id,value] of [['premiumShareLive',live],['premiumShareMovies',movie],['premiumShareSeries',series]]){
      elementText(id,total?Math.round(100*value/total)+'%':'—');
    }
    const pie=byId('premiumCatalogDonut');
    if(pie){
      const a=total?100*live/total:0,b=total?100*(live+movie)/total:0;
      pie.style.background=total
        ?'conic-gradient(#6bdad6 0% '+a.toFixed(3)+'%,#9182f4 '+a.toFixed(3)+'% '+b.toFixed(3)+'%,#d5a6fa '+b.toFixed(3)+'% 100%)'
        :'conic-gradient(#394255 0 100%)';
      pie.setAttribute('aria-label',total
        ?'القنوات '+fmt(live)+'، الأفلام '+fmt(movie)+'، المسلسلات '+fmt(series)
        :'المكتبة لم تسجل عناصر مفهرسة بعد');
    }
  }
  function updateActionCenter(){
    const shell=byId('premiumActionableIssues');
    if(!shell)return;
    const problems=snapshot.sources.filter(x=>x.issue).length;
    const expiring=accountSummary?.expiring??0;
    const known=lastSourceSummaryLoaded||accountSummary!==null;
    const important=problems+expiring;
    shell.hidden=!known||important===0;
    const text=byId('premiumActionableText');
    if(text&&important){
      const notes=[];
      if(problems)notes.push(fmt(problems)+' مصدر يحتاج مراجعة اتصال أو مزامنة');
      if(expiring)notes.push(fmt(expiring)+' اشتراك Xtream ينتهي خلال أسبوع');
      text.textContent=notes.join(' · ')+'. هذه تنبيهات من البيانات المسجلة وليست نتيجة اختبار بث.';
    }
    const subs=byId('premiumReviewExpiring');
    if(subs)subs.hidden=!expiring;
    const sources=byId('premiumReviewSources');
    if(sources)sources.hidden=!problems;
  }
  function openExpiringAccounts(){
    openWorkspace('accounts');
    const filter=byId('gatewayAccountFilter'),input=byId('gatewayAccountSearch');
    if(input){input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));}
    if(filter){filter.value='expiring';filter.dispatchEvent(new Event('change',{bubbles:true}));}
  }
  function setAutoRefresh(value){
    autoRefreshEnabled=Boolean(value);
    if(autoRefreshTimer){clearInterval(autoRefreshTimer);autoRefreshTimer=null;}
    if(autoRefreshEnabled){
      autoRefreshTimer=setInterval(()=>{
        if(document.visibilityState!=='visible')return;
        byId('refreshBtn')?.click(); // Existing read-only admin refresh also updates subscriber counts.
      },90000);
    }
    const btn=byId('streamAutoRefreshToggle');
    if(btn){
      btn.setAttribute('aria-pressed',String(autoRefreshEnabled));
      btn.textContent=autoRefreshEnabled?'تحديث تلقائي: يعمل':'تحديث تلقائي: متوقف';
    }
    try{localStorage.setItem('blofy-stream-auto-refresh',autoRefreshEnabled?'1':'0')}catch{}
  }

  function showSubscriberUnavailable(){
    accountSummary=null;
    for(const id of ['homeMetricActiveAccounts','premiumAccountsActive','premiumAccountsExpiring','premiumAccountsExpired','premiumAccountsDisabled'])
      elementText(id,'—');
    const notice=byId('premiumSubscriptionsNotice');
    if(notice)notice.textContent='تعذر تحديث حالة حسابات Xtream. الأرقام غير متاحة الآن، ولم تتغير الاشتراكات.';
    updateActionCenter();
  }
  function renderAccounts(data){
    if(!data||!Number.isFinite(Number(data.total)))return;
    accountSummary={
      total:number(data.total),active:number(data.active),
      expiring:number(data.expiring),expired:number(data.expired),disabled:number(data.disabled)
    };
    elementText('homeMetricActiveAccounts',fmt(accountSummary.active));
    elementText('premiumAccountsActive',fmt(accountSummary.active));
    elementText('premiumAccountsExpiring',fmt(accountSummary.expiring));
    elementText('premiumAccountsExpired',fmt(accountSummary.expired));
    elementText('premiumAccountsDisabled',fmt(accountSummary.disabled));
    const warning=byId('premiumSubscriptionsNotice');
    if(warning)warning.textContent=accountSummary.expiring
      ?fmt(accountSummary.expiring)+' اشتراك Xtream يقترب من الانتهاء، راجع تواريخ الحسابات قبل التجديد.'
      :'تم تحميل بيانات حسابات Xtream. لا توجد اشتراكات تنتهي خلال أسبوع.';
    updateActionCenter();
  }

  function renderSnapshot(data){
    if(!data||!Array.isArray(data.sources)||!data.totals)return;
    snapshot={
      sources:data.sources.map(s=>({
        id:String(s.id||''),name:String(s.name||'مصدر').slice(0,120),
        enabled:Boolean(s.enabled),published:Boolean(s.published),issue:Boolean(s.issue),
        syncing:Boolean(s.syncing),queued:Boolean(s.queued),tested:Boolean(s.tested),
        issueCode:Object.hasOwn(SOURCE_ISSUE_LABELS,String(s.issueCode||''))?String(s.issueCode):''
      })),
      totals:{
        live:number(data.totals.live),movie:number(data.totals.movie),
        series:number(data.totals.series),servers:number(data.totals.servers)
      }
    };
    const sources=snapshot.sources;
    elementText('premiumPublishedCount',fmt(sources.filter(s=>s.published).length));
    elementText('premiumIssueCount',fmt(sources.filter(s=>s.issue).length));
    elementText('premiumSyncCount',fmt(sources.filter(s=>s.syncing).length));
    elementText('premiumQueuedCount',fmt(sources.filter(s=>s.queued).length));
    renderAlerts(sources);
    renderCatalog(snapshot.totals);
    const time=new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
    elementText('premiumLastUpdated','آخر تحديث '+time);
    lastSourceSummaryLoaded=true;
    updateActionCenter();
    if(palette?.open)renderCommands(search?.value||'');
  }
  // Escape formula-like cells when exporting human-supplied source names.
  function csvCell(value){
    let safe=String(value??'');
    if(/^[\s]*[=+\-@]/.test(safe))safe="'"+safe;
    return '"'+safe.replace(/"/g,'""')+'"';
  }
  function exportSnapshot(){
    const lines=[
      ['BLOFY STREAM','Operational source summary'],
      ['Generated',new Date().toISOString()],
      ['Sources',snapshot.sources.length],
      ['Published sources',snapshot.sources.filter(x=>x.published).length],
      ['Sources with recorded issues',snapshot.sources.filter(x=>x.issue).length],
      ['Indexed live',snapshot.totals.live],
      ['Indexed movies',snapshot.totals.movie],
      ['Indexed series',snapshot.totals.series],
      ['Active Xtream accounts',accountSummary?.active??'Unavailable'],
      ['Xtream accounts expiring within 7 days',accountSummary?.expiring??'Unavailable'],
      ['Expired Xtream accounts',accountSummary?.expired??'Unavailable'],
      ['Disabled Xtream accounts',accountSummary?.disabled??'Unavailable'],
      [],
      ['Source name','Enabled','Published','Recorded issue','Syncing','Tested'],
      ...snapshot.sources.map(x=>[x.name,x.enabled?'Yes':'No',x.published?'Yes':'No',x.issue?'Yes':'No',x.syncing?'Yes':'No',x.tested?'Yes':'No'])
    ];
    const csv='\uFEFF'+lines.map(row=>row.map(csvCell).join(',')).join('\r\n');
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');link.href=url;
    link.download='BLOFY-STREAM-operations-'+new Date().toISOString().slice(0,10)+'.csv';
    document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function setCompact(value){
    const compact=Boolean(value);
    document.documentElement.classList.toggle('stream-density-compact',compact);
    const button=byId('streamDensityToggle');
    if(button){
      button.setAttribute('aria-pressed',String(compact));
      button.textContent=compact?'عرض مريح':'عرض مكثف';
    }
    try{localStorage.setItem('blofy-stream-density',compact?'compact':'comfortable')}catch{}
  }
  function wire(){
    byId('streamCommandOpen')?.addEventListener('click',openPalette);
    byId('streamCommandClose')?.addEventListener('click',()=>palette?.close());
    search?.addEventListener('input',()=>renderCommands(search.value));
    search?.addEventListener('keydown',event=>{
      if(event.key==='ArrowDown'){event.preventDefault();chooseIndex(selectedIndex+1)}
      if(event.key==='ArrowUp'){event.preventDefault();chooseIndex(selectedIndex-1)}
      if(event.key==='Enter'){event.preventDefault();runCommand(selectedIndex)}
    });
    document.addEventListener('keydown',event=>{
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){
        event.preventDefault();openPalette();return;
      }
      const target=event.target;
      const editing=target instanceof HTMLElement &&
        (target.matches('input,textarea,select,[contenteditable="true"]')||target.isContentEditable);
      if(event.key==='/'&&!editing&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!palette?.open){
        event.preventDefault();openPalette();
      }
    });
    document.querySelectorAll('[data-open-source-filter]').forEach(button=>
      button.addEventListener('click',()=>{
        if(button.dataset.openSourceFilter==='issues')openIssues();
      }));
    byId('streamExportReport')?.addEventListener('click',exportSnapshot);
    byId('premiumReviewSources')?.addEventListener('click',openIssues);
    byId('premiumReviewExpiring')?.addEventListener('click',openExpiringAccounts);
    byId('streamAutoRefreshToggle')?.addEventListener('click',()=>setAutoRefresh(!autoRefreshEnabled));
    let pref=false;try{pref=localStorage.getItem('blofy-stream-auto-refresh')==='1'}catch{}
    setAutoRefresh(pref);
    let compact=false;try{compact=localStorage.getItem('blofy-stream-density')==='compact'}catch{}
    // Apply preference but do not modify any source or customer data.
    setCompact(compact);
    byId('streamDensityToggle')?.addEventListener('click',()=>{
      setCompact(!document.documentElement.classList.contains('stream-density-compact'));
    });
    document.addEventListener('blofy:stream-snapshot',event=>renderSnapshot(event.detail));
    document.addEventListener('blofy:account-snapshot',event=>renderAccounts(event.detail));
    document.addEventListener('blofy:account-unavailable',showSubscriberUnavailable);
    if(window.__BLOFY_ACCOUNT_SUMMARY__)renderAccounts(window.__BLOFY_ACCOUNT_SUMMARY__);
    if(window.__BLOFY_STREAM_SNAPSHOT__)renderSnapshot(window.__BLOFY_STREAM_SNAPSHOT__);
    renderCommands();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',wire,{once:true});
  else wire();
})();
