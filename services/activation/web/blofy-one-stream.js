/* BLOFY ONE integrated STREAM operations. Same site, same admin session.
 * Live account/voucher lists are read-only; a voucher may be created only
 * after explicit owner confirmation of Xtream -> BLOFY code conversion.
 * No usernames/passwords are persisted or exported.
 */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const section=$('stream-management');
  if(!section)return;
  const accountSearch=$('one-stream-account-search');
  const accountFilter=$('one-stream-account-filter');
  const accountRows=$('one-stream-accounts-rows');
  const codeSearch=$('one-stream-code-search');
  const codeFilter=$('one-stream-code-filter');
  const codeRows=$('one-stream-codes-rows');
  const codesPrev=$('one-stream-codes-prev');
  const codesNext=$('one-stream-codes-next');
  const secretBox=$('one-stream-secret');
  const status=$('one-stream-overall-status');
  const refreshButton=$('one-stream-refresh');
  const accountNameMax=65, pageSize=40;
  const SALEH='d2bb0397-1c56-4751-adc9-1a17758022f6';
  const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
  let accounts=[], codes=[], codeTotals={}, codeOffset=0;
  let nextOffset=null, accountsLoaded=false, codesLoaded=false;
  let codeSearchRemote=false,codeFilteredTotal=null,codeLoadSeq=0,codeSearchTimer=null;
  let serial=0, secretTimer=null, secretValue=null, busy=false;
  const readableStatus=Object.freeze({unused:'غير مفعّل',redeemed:'مستخدم',revoked:'ملغى'});
  const errors=Object.freeze({
    stream_link_legacy_code_not_recoverable:'الكود القديم ليس محفوظًا كنص قابل للاسترجاع. لا يمكن كشفه من بصمته.',
    stream_link_code_unavailable:'الكود المرتبط بهذا الحساب غير متاح.',
    stream_link_code_expired:'انتهت صلاحية الكود المرتبط بالحساب.',
    stream_link_account_expired:'انتهت صلاحية حساب Xtream.',
    stream_link_account_unavailable:'الحساب غير نشط أو غير متاح.',
    stream_link_saleh_source_only:'الحساب لا يتبع مصدر صالح المعتمد.',
    stream_link_account_expiry_required:'الحساب بلا تاريخ انتهاء؛ يحتاج مراجعة قبل الربط.',
    stream_link_duration_unsupported:'مدة الحساب غير مدعومة للتحويل التلقائي.',
    stream_code_legacy_unrecoverable:'السجل القديم لا يحتوي الكود الأصلي في المخزن المشفّر.',
    stream_code_vault_integrity_failed:'تعذر التحقق من سلامة بيانات الكود المشفّرة.',
    stream_code_revoked:'الكود ملغى.'
  });
  function node(tag,value,cls){
    const n=document.createElement(tag);
    if(value!==undefined)n.textContent=String(value??'');
    if(cls)n.className=cls;
    return n;
  }
  function number(value){
    const n=Number(value);
    return Number.isSafeInteger(n)&&n>=0?n.toLocaleString('en-US'):'—';
  }
  function date(value){
    if(value===null||value===undefined||value==='')return 'غير محدد';
    const n=new Date(value).getTime();
    return Number.isFinite(n)&&n>0
      ?new Date(n).toLocaleDateString('ar-SA',{year:'numeric',month:'short',day:'numeric'})
      :'غير معروف';
  }
  function setStatus(message,error=false){
    status.textContent=message;
    status.classList.toggle('one-stream-error',error);
  }
  function clearSecret(){
    window.clearTimeout(secretTimer);
    secretTimer=null;
    secretValue=null;
    secretBox.hidden=true;
    $('one-stream-secret-code').textContent='';
    $('one-stream-secret-title').textContent='الكود المسترجع';
    $('one-stream-secret-description').textContent='';
  }
  function revealSecret(value,{created=false,from='voucher'}={}){
    clearSecret();
    secretValue=String(value||'');
    if(!/^(?:[0-9]{8,12}|[A-F0-9]{24})$/i.test(secretValue))throw Error('رد غير صالح من السيرفر؛ لم تُعرض بيانات.');
    $('one-stream-secret-code').textContent=secretValue;
    $('one-stream-secret-title').textContent=created?'كود BLOFY جديد مرتبط بنفس حساب Xtream':'كود BLOFY الأصلي المرتبط بالحساب';
    $('one-stream-secret-description').textContent=created?
      'تم إصدار كود واحد لنفس حساب Xtream ونفس الانتهاء؛ لم تُنشأ مدة اشتراك جديدة.' :
      'كود الاشتراك المسترجع. لم يتم تمديد الصلاحية أو تغيير بيانات Xtream.';
    secretBox.hidden=false;
    secretTimer=window.setTimeout(clearSecret,90000);
    secretBox.scrollIntoView({behavior:'smooth',block:'center'});
  }
  async function api(path,{method='GET',body}={}){
    const ctl=new AbortController();
    const timer=window.setTimeout(()=>ctl.abort(),14000);
    try{
      const response=await fetch(path,{
        method,credentials:'same-origin',cache:'no-store',
        headers:{accept:'application/json',...(body===undefined?{}:{'content-type':'application/json'})},
        body:body===undefined?undefined:JSON.stringify(body),
        signal:ctl.signal
      });
      if(response.status===401)throw Error('انتهت جلسة الإدارة؛ سجّل الدخول من /admin.');
      const result=await response.json().catch(()=>({}));
      if(!response.ok || result.ok===false){
        throw Error(errors[result.error||result.code] ||
          (response.status===429?'تم تجاوز حد الطلبات. أعد المحاولة بعد قليل.':
           'تعذر تنفيذ الطلب (HTTP '+response.status+').'));
      }
      return result;
    }catch(e){
      if(e.name==='AbortError')throw Error('انتهت مهلة الاتصال بالسيرفر.');
      throw e;
    }finally{window.clearTimeout(timer);}
  }
  function accountState(a){
    if(!a.enabled)return {label:'موقوف',key:'disabled'};
    const expiry=Number(a.expiresAt);
    if(a.expiresAt!==null&&a.expiresAt!==undefined&&Number.isFinite(expiry)){
      if(expiry<=Date.now())return {label:'منتهي',key:'expired'};
      if(expiry<=Date.now()+7*86400000)return {label:'ينتهي قريبًا',key:'expiring'};
      return {label:'نشط',key:'active'};
    }
    return {label:'بلا انتهاء محدد',key:'unknown'};
  }
  function accountMatchesFilter(account){
    const current=accountState(account);
    const filter=accountFilter.value;
    if(filter==='active')return current.key==='active'||current.key==='expiring';
    if(filter==='expiring')return current.key==='expiring';
    if(filter==='disabled')return current.key==='disabled';
    if(filter==='expired')return current.key==='expired';
    return true;
  }
  function renderAccounts(){
    const search=accountSearch.value.trim().toLocaleLowerCase('ar');
    const matching=accounts.filter(a=>accountMatchesFilter(a) &&
      [a.label,a.username,a.id].join(' ').toLocaleLowerCase('ar').includes(search));
    accountRows.replaceChildren();
    const shown=matching.slice(0,80);
    for(const a of shown){
      if(!a?.id)continue;
      const tr=node('tr');
      const current=accountState(a);
      const name=node('td');
      name.append(node('strong',String(a.label||'عميل BLOFY').slice(0,accountNameMax)));
      const user=node('td');
      user.append(node('code',String(a.username||'—').slice(0,100)));
      const badge=node('span',current.label,'one-stream-badge state-'+current.key);
      const state=node('td');state.append(badge);
      const action=node('td');
      const getCode=node('button','استرجاع كود','one-stream-compact-button');
      getCode.type='button';
      const usable=a.enabled===true&&a.expiresAt!=null&&Number(a.expiresAt)>Date.now();
      getCode.disabled=!usable;
      getCode.title=usable?'استخراج الكود الأصلي أو إنشاء كود مرتبط واحد بعد التأكيد':
        'يحتاج الحساب إلى تفعيل وصلاحية محددة';
      getCode.addEventListener('click',()=>{void restoreFromXtream(a,getCode);});
      action.append(getCode);
      tr.append(name,user,state,node('td',date(a.expiresAt)),
        node('td',number(a.maxConnections)),action);
      accountRows.append(tr);
    }
    if(!shown.length){
      const tr=node('tr'),td=node('td',accountsLoaded?'لا توجد حسابات مطابقة.':'لا تتوفر بيانات الحسابات حاليًا.');
      td.colSpan=6;tr.append(td);accountRows.append(tr);
    }
    $('one-stream-accounts-count').textContent=
      'حسابات مطابقة: '+number(matching.length)+' من '+number(accounts.length)+
      (matching.length>80?' · عُرض أول 80؛ اكتب بحثًا أدق.':'');
  }
  function renderCodes(){
    const search=codeSearch.value.trim().toLocaleLowerCase('ar');
    const filter=codeFilter.value;
    const matching=codeSearchRemote?codes:codes.filter(c=>
      (filter==='all'||c.status===filter) &&
      [c.label,c.codeHint,c.id].join(' ').toLocaleLowerCase('ar').includes(search));
    codeRows.replaceChildren();
    for(const c of matching){
      if(!c?.id)continue;
      const tr=node('tr');
      const title=node('td');
      title.append(node('strong',String(c.label||'كود BLOFY').slice(0,70)));
      title.append(node('small',String(c.codeHint||'—'),'one-stream-code-hint'));
      if(c.buyerName||c.buyerPhone){
        const parts=[];
        if(c.buyerName)parts.push('العميل: '+String(c.buyerName).slice(0,65));
        if(c.buyerPhone)parts.push('جوال ينتهي بـ '+String(c.buyerPhone).slice(-4));
        title.append(node('small',parts.join(' · '),'one-stream-code-buyer'));
      }
      const badge=node('span',readableStatus[c.status]||'غير معروف','one-stream-badge state-'+c.status);
      const state=node('td');state.append(badge);
      const action=node('td');
      const button=node('button',c.copyAvailable?'كشف الكود':'غير قابل للكشف','one-stream-compact-button');
      button.type='button';
      button.disabled=!c.copyAvailable||c.status==='revoked';
      button.addEventListener('click',()=>{void revealVoucher(c,button);});
      action.append(button);
      const manage=node('button','إدارة الاشتراك','one-stream-compact-button one-stream-manage-code');
      manage.type='button';
      manage.setAttribute('aria-label','إدارة سجل كود '+String(c.codeHint||c.label||'BLOFY').slice(0,45));
      manage.addEventListener('click',()=>{
        window.dispatchEvent(new CustomEvent('blofy-one:manage-code',{
          detail:{record:{...c},offset:codeOffset}
        }));
      });
      action.append(manage);
      tr.append(title,node('td',c.channel==='app'?'كود التطبيق':'كود Xtream'),
        state,node('td',date(c.expiresAt)),
        node('td',c.accountId?'مرتبط':'غير مرتبط'),action);
      codeRows.append(tr);
    }
    if(!matching.length){
      const tr=node('tr'),td=node('td',codesLoaded?'لا توجد أكواد مطابقة في هذه الصفحة.':'تعذر تحميل قائمة الأكواد.');
      td.colSpan=6;tr.append(td);codeRows.append(tr);
    }
    $('one-stream-codes-count').textContent=codeSearchRemote?
      'نتائج البحث في كامل السجل: '+number(codeFilteredTotal)+
        ' · المعروض في هذه الصفحة: '+number(matching.length)+
        ' · لا تُعرض الأكواد الأصلية إلا بعد تأكيد المشرف.' :
      'الأكواد المعروضة في هذه الصفحة: '+number(matching.length)+
        ' · من '+number(codes.length)+' محمّلة. البحث في كامل السجل متاح بكتابة حرفين أو أكثر.';
    const currentPage=Math.floor(codeOffset/pageSize)+1;
    $('one-stream-codes-page').textContent='الصفحة '+number(currentPage)+
      ' · إجمالي '+number(codeTotals.total);
    codesPrev.disabled=codeOffset<=0;
    codesNext.disabled=nextOffset===null;
  }
  async function restoreFromXtream(a,button){
    if(busy||!a?.id||!UUID.test(a.id)||!a.enabled)return;
    const current=accountState(a);
    if(current.key==='expired'||current.key==='disabled'||current.key==='unknown')return;
    const label=String(a.label||a.username||'حساب Xtream').slice(0,65);
    const confirmed=window.confirm('استرجاع كود BLOFY لحساب '+label+
      '؟\nإن كان للحساب كود سابق قابل للاسترجاع سيظهر نفسه، وإن لم يكن مرتبطًا بكود فسيُنشأ كود واحد على نفس الحساب ونفس تاريخ الانتهاء. لن تُغيّر بيانات Xtream أو تمدد مدة الاشتراك.');
    if(!confirmed)return;
    busy=true;button.disabled=true;clearSecret();
    setStatus('جارٍ استرجاع الكود من حساب Xtream مع الحفاظ على اشتراك العميل…');
    try{
      const result=await api('/api/v1/admin/xtream-gateway/link/xtream-to-code',{
        method:'POST',body:{accountId:a.id}
      });
      if(result.ok!==true||result.subscriptionUnchanged!==true||
          result.accountId!==a.id||typeof result.code!=='string')
        throw Error('العملية لم تُرجع كودًا موثوقًا؛ لا يمكن عرض بيانات.');
      revealSecret(result.code,{created:result.created===true,from:'account'});
      setStatus(result.created?
        'تم إنشاء كود مرتبط واحد بالحساب الحالي دون تجديد أو إنشاء حساب Xtream آخر.':
        'تم استخراج الكود الأصلي للحساب الحالي دون تعديل تاريخ الانتهاء.');
      void loadCodes();
    }catch(e){setStatus(e.message,true);}
    finally{busy=false;button.disabled=false;}
  }
  async function revealVoucher(c,button){
    if(busy||!c?.id||!UUID.test(c.id)||c.copyAvailable!==true||c.status==='revoked')return;
    if(!window.confirm('عرض كود هذا العميل للمشرف فقط؟ لا تسلّمه إلا لصاحب الاشتراك بعد التحقق من ملكيته.'))return;
    busy=true;button.disabled=true;clearSecret();
    setStatus('جارٍ كشف الكود من مخزن BLOFY المشفّر…');
    try{
      const result=await api('/api/v1/admin/xtream-gateway/codes/'+encodeURIComponent(c.id)+'/reveal');
      if(result.ok!==true||result.id!==c.id||!result.code)
        throw Error('لم يُرجع السيرفر الكود الصحيح.');
      revealSecret(result.code,{from:'voucher'});
      setStatus('الكود مسترجع مؤقتًا. لا يتم تفعيل أو تجديد الاشتراك بهذه العملية.');
    }catch(e){setStatus(e.message,true);}
    finally{busy=false;button.disabled=false;}
  }
  function renderTotals(){
    $('one-stream-accounts-total').textContent=accountsLoaded?number(accounts.length):'—';
    $('one-stream-active-accounts').textContent=accountsLoaded?
      number(accounts.filter(a=>accountState(a).key==='active'||accountState(a).key==='expiring').length):'—';
    $('one-stream-code-total').textContent=codeTotals.total==null?'—':number(codeTotals.total);
    $('one-stream-redeemed').textContent=codeTotals.redeemed==null?'—':number(codeTotals.redeemed);
    $('one-stream-unused').textContent=codeTotals.unused==null?'—':number(codeTotals.unused);
  }
  async function loadAccounts(){
    const result=await api('/api/v1/admin/xtream-gateway');
    if(!Array.isArray(result.items))throw Error('قائمة حسابات Xtream غير مكتملة.');
    accounts=result.items.filter(a=>a&&UUID.test(String(a.id||'')));
    accountsLoaded=true;
    renderAccounts();renderTotals();
  }
  async function loadCodes(){
    const current=++codeLoadSeq;
    const query=codeSearch.value.trim();
    const filter=codeFilter.value;
    // One-character text queries are too broad for private customer searches.
    // The request never puts the original code or phone in a URL.
    if(query.length===1){
      codeSearchRemote=true;codeFilteredTotal=0;
      codes=[];nextOffset=null;codesLoaded=true;
      renderCodes();
      $('one-stream-codes-count').textContent='اكتب حرفين على الأقل للبحث في جميع الأكواد، أو امسح النص لعرض السجل.';
      return;
    }
    const remote=query.length>=2||filter!=='all';
    const result=remote?
      await api('/api/v1/admin/xtream-gateway/codes/search',{
        method:'POST',body:{query,status:filter,offset:codeOffset,limit:pageSize}
      }):
      await api('/api/v1/admin/xtream-gateway/codes?limit='+pageSize+'&offset='+codeOffset);
    if(current!==codeLoadSeq)return;
    if(!Array.isArray(result.items)||typeof result.totals!=='object'||
      (remote&&(result.searchApplied!==true||
        !Number.isSafeInteger(result.filteredTotal))))
      throw Error('قائمة أكواد STREAM غير مكتملة.');
    codes=result.items.filter(item=>item&&UUID.test(String(item.id||'')));
    codeTotals=result.totals||{};
    codeSearchRemote=remote;
    codeFilteredTotal=remote?result.filteredTotal:null;
    nextOffset=result.nextOffset===null?null:
      (Number.isSafeInteger(result.nextOffset)&&result.nextOffset>codeOffset?result.nextOffset:null);
    codesLoaded=true;
    renderCodes();renderTotals();
  }
  async function loadCommercial(){
    const result=await api('/api/v1/admin/xtream-gateway/codes/sales-summary');
    if(result.ok!==true||result.currency!=='SAR')
      throw Error('ملخص سجل أكواد STREAM غير مكتمل.');
    $('one-stream-expiring').textContent=number(result.expiring_soon);
    $('one-stream-sold').textContent=number(result.sold);
    $('one-stream-transfers').textContent=number(result.transfers);
    const price=String(result.recorded_revenue_halalas??'');
    $('one-stream-revenue').textContent=/^\d{1,22}$/.test(price)?
      (Number(price)/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})+' ر.س':'—';
  }
  async function refresh({justCodes=false}={}){
    if(refreshButton.disabled)return;
    refreshButton.disabled=true;
    const version=++serial;
    setStatus('جارٍ تحميل بيانات العملاء والأكواد من نفس لوحة الإدارة…');
    const tasks=justCodes?[loadCodes()]:[loadAccounts(),loadCodes(),loadCommercial()];
    const results=await Promise.allSettled(tasks);
    if(version!==serial)return;
    const errors=results.filter(r=>r.status==='rejected').map(r=>r.reason.message);
    setStatus(errors.length?
      'تم تحديث الأقسام المتاحة، وتعذر تحديث قسم آخر: '+errors.slice(0,2).join(' · '):
      'تم تحديث حسابات Xtream وأكواد STREAM وإحصائياتها. جميع النتائج من السجلات الحية.',errors.length>0);
    refreshButton.disabled=false;
  }
  accountSearch.addEventListener('input',renderAccounts);
  accountFilter.addEventListener('change',renderAccounts);
  codeSearch.addEventListener('input',()=>{
    window.clearTimeout(codeSearchTimer);
    codeOffset=0;
    codeSearchTimer=window.setTimeout(()=>{
      void refresh({justCodes:true});
    },330);
  });
  codeFilter.addEventListener('change',()=>{
    window.clearTimeout(codeSearchTimer);
    codeOffset=0;
    void refresh({justCodes:true});
  });
  codesPrev.addEventListener('click',()=>{
    if(codeOffset<=0)return;
    codeOffset=Math.max(0,codeOffset-pageSize);
    void refresh({justCodes:true});
  });
  codesNext.addEventListener('click',()=>{
    if(nextOffset===null)return;
    codeOffset=nextOffset;
    void refresh({justCodes:true});
  });
  refreshButton.addEventListener('click',()=>void refresh());
  $('one-stream-secret-copy').addEventListener('click',async()=>{
    if(!secretValue)return;
    try{
      await navigator.clipboard.writeText(secretValue);
      setStatus('نُسخ كود العميل. تُخفى النسخة المعروضة تلقائيًا بعد 90 ثانية.');
    }catch{setStatus('تعذر النسخ الآلي. انسخ الكود من الحقل مؤقتًا.',true);}
  });
  $('one-stream-secret-hide').addEventListener('click',clearSecret);
  $('one-stream-secret-xtream').addEventListener('click',()=>{
    if(!secretValue)return;
    const field=$('one-legacy-code'),form=$('one-legacy-lookup-form');
    if(!field||!form)return;
    field.value=secretValue;
    field.dispatchEvent(new Event('input',{bubbles:true}));
    form.requestSubmit();
    clearSecret();
    field.scrollIntoView({behavior:'smooth',block:'center'});
    setStatus('يتم فحص نفس الكود في قسم استخراج Xtream داخل BLOFY ONE.');
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden)clearSecret();});
  window.addEventListener('pagehide',clearSecret);
  $('one-refresh')?.addEventListener('click',()=>void refresh());
  void refresh();
})();
