/* BLOFY ONE: unified code center. Moves existing UI sections only;
   issuance, lookup, admin sessions and backend logic are unchanged. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const issue=$('one-issue'),legacy=$('legacy-xtream'),ledger=$('stream-management');
  if(!issue||!legacy||!ledger)return;
  // Existing inventory API generates valid, unactivated codes atomically.
  // Keep stock next to issuance and customer accounts instead of another menu.
  const inventory=document.createElement('section');
  inventory.id='one-inventory';
  inventory.className='one-overview one-inventory';
  inventory.setAttribute('aria-label','مخزون اشتراكات BLOFY');
  inventory.innerHTML=`
    <div class="one-section-heading"><div><span class="one-kicker">STORE STOCK</span>
      <h2>مخزون STREAM وXtream</h2></div>
      <button id="one-inventory-refresh" type="button">↻ تحديث المخزون</button></div>
    <p class="one-footnote">أصدر كمية أكواد للمخزون قبل البيع. لا يبدأ أي اشتراك عند إنشاء الأكواد، والتسليم في المتجر يكون فقط بعد تأكيد الدفع.</p>
    <div id="one-inventory-alerts" class="one-inventory-alerts" role="status" aria-live="polite"></div>
    <div id="one-inventory-counts" class="one-inventory-grid" aria-live="polite"></div>
    <div class="one-inventory-controls">
      <label>نوع الباقة<select id="one-inventory-sku"></select></label>
      <label>عدد الأكواد<input id="one-inventory-quantity" type="number" min="1" max="100" inputmode="numeric" value="10"></label>
      <button id="one-inventory-generate" type="button">＋ إصدار وإضافة للمخزون</button>
    </div>
    <details class="one-inventory-import">
      <summary>لدي أكواد سابقة — استيرادها للمخزون</summary>
      <p>كود واحد في كل سطر، بحد أقصى 100 كود غير مستخدم، ومن نفس باقة وصلاحية المصدر.</p>
      <textarea id="one-inventory-existing" rows="4" maxlength="2600" autocomplete="off" spellcheck="false" placeholder="اكتب كودًا واحدًا في كل سطر"></textarea>
      <button id="one-inventory-import" type="button">استيراد الأكواد</button>
    </details>
    <p id="one-inventory-status" role="status" aria-live="polite"></p>
    <a href="/admin/store-inventory">إدارة منتجات المتجر والبنرات والطلبات ←</a>`;
  const center=document.createElement('div');
  center.id='codes-center';
  center.className='one-codes-center';
  center.setAttribute('aria-labelledby','one-codes-center-title');
  issue.parentNode.insertBefore(center,issue);

  const intro=document.createElement('header');
  intro.className='one-codes-center-heading';
  const title=document.createElement('div');
  const cap=document.createElement('span');cap.className='one-kicker';
  cap.textContent='BLOFY ONE · SUBSCRIPTIONS';
  const h2=document.createElement('h2');h2.id='one-codes-center-title';
  h2.textContent='مركز الاشتراكات والأكواد';
  const desc=document.createElement('p');
  desc.textContent='من هنا فقط: أصدر اشتراكًا، افحص كودًا موجودًا، أو راجع جميع الحسابات. اختر عملية واحدة بدل التنقل بين أقسام كثيرة.';
  title.append(cap,h2,desc);
  const host=document.createElement('span');host.className='one-codes-host';
  host.textContent='Host: https://y.blofyplayer.com:443';
  intro.append(title,host);center.append(intro);
  const tabs=document.createElement('div');tabs.className='one-codes-tabs';
  tabs.setAttribute('role','tablist');
  tabs.setAttribute('aria-label','عمليات الاشتراكات والأكواد');
  const definitions=[
    ['one-issue','＋ إنشاء اشتراك جديد'],
    ['legacy-xtream','⌕ فحص أو استخراج Xtream'],
    ['stream-management','▤ سجل الأكواد والعملاء'],
    ['one-inventory','▥ مخزون البيع']
  ];
  for(const [id,name] of definitions){
    const button=document.createElement('button');
    button.type='button';button.textContent=name;
    button.dataset.oneCodesTab=id;
    button.setAttribute('role','tab');
    button.setAttribute('aria-controls',id);
    tabs.append(button);
  }
  center.append(tabs,issue,legacy,ledger,inventory);
  const buttons=[...tabs.querySelectorAll('button')];
  let selected='one-issue';
  const choices=new Set(definitions.map(x=>x[0]));
  function show(id,scroll=false){
    if(!choices.has(id))return;
    selected=id;
    for(const el of [issue,legacy,ledger,inventory])el.hidden=el.id!==id;
    if(id==='one-inventory')void loadStock();
    for(const button of buttons){
      const active=button.dataset.oneCodesTab===id;
      button.setAttribute('aria-selected',String(active));
      button.tabIndex=active?0:-1;
    }
    if(scroll)requestAnimationFrame(()=>center.scrollIntoView({behavior:'smooth',block:'start'}));
  }
  for(const button of buttons){
    button.addEventListener('click',()=>{
      const id=button.dataset.oneCodesTab;
      if(location.hash==='#'+id)show(id,true);
      else location.hash='#'+id;
    });
    button.addEventListener('keydown',e=>{
      if(!['ArrowLeft','ArrowRight'].includes(e.key))return;
      e.preventDefault();
      const n=buttons.indexOf(button);
      const next=buttons[(n+(e.key==='ArrowRight'?-1:1)+buttons.length)%buttons.length];
      next.focus();next.click();
    });
  }
  function sync(){
    const id=location.hash.slice(1);
    if(choices.has(id))show(id,true);
    else if(id==='codes-center')show('one-issue',true);
    else if(!id)show('one-issue');
    // Other section anchors do not wipe previously displayed codes.
  }
  addEventListener('hashchange',sync);

  // Replace competing code destinations with one obvious menu entry.
  const nav=$('one-nav');
  if(nav){
    for(const href of ['#legacy-xtream','#stream-management']){
      nav.querySelector('a[href="'+href+'"]')?.remove();
    }
    const link=nav.querySelector('a[href="#one-issue"]');
    if(link){link.href='#codes-center';link.textContent='▤ مركز الاشتراكات والأكواد';}
    const caption=nav.querySelector('.one-nav-caption');
    if(caption)caption.textContent='BLOFY ONE · العملاء والاشتراكات';
  }
  for(const a of document.querySelectorAll('.one-workbar a[href="#legacy-xtream"],.one-workbar a[href="#stream-management"]'))a.remove();
  const quick=document.querySelector('.one-workbar a[href="#one-issue"]');
  if(quick){quick.href='#codes-center';quick.textContent='▤ مركز الأكواد';}
  const jump=$('one-quick-jump');
  if(jump){
    for(const val of ['legacy-xtream','stream-management'])jump.querySelector('option[value="'+val+'"]')?.remove();
    const opt=jump.querySelector('option[value="one-issue"]');
    if(opt){opt.value='codes-center';opt.textContent='مركز الاشتراكات والأكواد';}
  }
  for(const el of document.querySelectorAll('.one-top-issue,.one-hero-buttons .one-primary')){
    el.href='#codes-center';
    el.textContent='▤ مركز الاشتراكات والأكواد';
  }
  const cards=$('one-module-list');
  if(cards){
    for(const href of ['#legacy-xtream','#stream-management'])cards.querySelector('a[href="'+href+'"]')?.remove();
    const a=cards.querySelector('a[href="#one-issue"]');
    if(a){
      a.href='#codes-center';
      const name=a.querySelector('strong'),detail=a.querySelector('small');
      if(name)name.textContent='مركز الاشتراكات والأكواد';
      if(detail)detail.textContent='إنشاء، استخراج Xtream، سجل الاشتراكات في مكان واحد';
    }
  }
  const fast=document.querySelector('.one-fast-grid');
  if(fast){
    for(const href of ['#legacy-xtream','#one-sources','#one-storage'])fast.querySelector('a[href="'+href+'"]')?.remove();
    const a=fast.querySelector('a[href="#stream-management"]');
    if(a){
      a.href='#codes-center';
      const name=a.querySelector('strong'),detail=a.querySelector('small');
      if(name)name.textContent='مركز الاشتراكات والأكواد';
      if(detail)detail.textContent='إصدار وفحص واسترجاع';
    }
  }
  const growth=document.querySelector('.one-growth a[href="#one-issue"]');
  if(growth)growth.href='#codes-center';


  // All admin inventory requests use the existing authenticated session and
  // atomic DB transactions. Missing responses must NEVER trigger auto-retry.
  const stockGrid=$('one-inventory-counts'),stockSku=$('one-inventory-sku');
  const stockStatus=$('one-inventory-status');
  let stockBusy=false,stockPlans=[];
  async function stockFetch(path,body){
    const ctl=new AbortController(),t=setTimeout(()=>ctl.abort(),15000);
    try{
      const response=await fetch(path,{method:body===undefined?'GET':'POST',
        credentials:'same-origin',cache:'no-store',
        headers:{accept:'application/json',
          ...(body===undefined?{}:{'content-type':'application/json'})},
        body:body===undefined?undefined:JSON.stringify(body),signal:ctl.signal});
      const data=await response.json().catch(()=>({}));
      if(!response.ok||data.ok===false)throw Error(data.error||'http_'+response.status);
      return data;
    }finally{clearTimeout(t);}
  }
  async function loadStock(){
    if(stockBusy)return;
    stockStatus.textContent='جارٍ تحميل مخزون المتجر…';
    try{
      const data=await stockFetch('/api/v1/admin/store/inventory');
      stockPlans=Array.isArray(data.products)?data.products.filter(p=>p&&
        ['app','xtream'].includes(p.channel)&&Number.isInteger(Number(p.durationDays))):[];
      const warningBox=$('one-inventory-alerts');
      warningBox.replaceChildren();
      const low=Array.isArray(data.lowStockAlerts)?data.lowStockAlerts:[];
      const summary=document.createElement('p');
      summary.textContent=low.length
        ?'⚠ تنبيه: '+low.length+' باقة أقل من 20 كودًا. راجع المخزون قبل نفاده.'
        :'✓ لا توجد باقات أقل من حد 20 كودًا في المخزون.';
      warningBox.append(summary);
      if(low.length){
        const ul=document.createElement('ul');
        for(const item of low){
          const li=document.createElement('li');
          li.textContent=String(item.name||item.sku)+' — '+Number(item.available||0)+' كود متبقٍ';
          ul.append(li);
        }
        warningBox.append(ul);
      }
      stockGrid.replaceChildren();
      for(const p of stockPlans){
        const count=(data.counts||[]).find(x=>x.sku===p.sku)||{};
        const box=document.createElement('article');box.className='one-inventory-stock';
        const title=document.createElement('strong');title.textContent=p.name;
        const available=document.createElement('b');available.textContent='جاهز للبيع: '+Number(count.available||0);
        const sold=document.createElement('small');
        sold.textContent='مباع من المخزون: '+Number(count.sold||0)+
          (Number(count.blocked||0)?' · غير صالح للبيع: '+Number(count.blocked):'');
        box.append(title,available,sold);stockGrid.append(box);
      }
      const original=stockSku.value;
      stockSku.replaceChildren();
      for(const p of stockPlans){
        const option=document.createElement('option');option.value=p.sku;
        option.textContent=p.name;stockSku.append(option);
      }
      if(stockPlans.some(p=>p.sku===original))stockSku.value=original;
      stockStatus.textContent='الأعداد من قاعدة الأكواد الفعلية، ولا تشمل الأكواد المستخدمة أو الملغاة.';
    }catch(e){$('one-inventory-alerts').textContent='تعذر تحميل تنبيهات المخزون.';stockStatus.textContent='فشل قراءة المخزون: '+e.message;}
  }
  $('one-inventory-refresh').addEventListener('click',()=>void loadStock());
  async function stockWrite(kind){
    if(stockBusy)return;
    const sku=stockSku.value;
    if(!stockPlans.some(p=>p.sku===sku))return;
    const payload={sku},source=$('one-inventory-existing');
    if(kind==='generate'){
      payload.quantity=Number($('one-inventory-quantity').value);
      if(!Number.isInteger(payload.quantity)||payload.quantity<1||payload.quantity>100){
        stockStatus.textContent='أدخل عددًا من 1 إلى 100.';return;
      }
    }else{
      payload.codes=source.value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
      if(!payload.codes.length||payload.codes.length>100){
        stockStatus.textContent='أدخل من 1 إلى 100 كود، كل كود في سطر.';return;
      }
    }
    const qty=kind==='generate'?payload.quantity:payload.codes.length;
    if(!confirm('هل تؤكد '+(kind==='generate'?'إنشاء':'استيراد')+' '+qty+
      ' كود لباقـة '+sku+'؟ لن تبدأ مدة الكود، ولن تُسجّل عملية بيع.'))return;
    stockBusy=true;
    $('one-inventory-generate').disabled=true;$('one-inventory-import').disabled=true;
    stockStatus.textContent='جارٍ تسجيل المخزون. لا تكرر الطلب عند تأخر الشبكة.';
    try{
      const data=await stockFetch('/api/v1/admin/store/inventory/'+kind,payload);
      const n=Number(kind==='generate'?data.generated:data.added);
      if(!data.ok||!Number.isInteger(n)||n!==qty)
        throw Error('stock_write_result_unconfirmed');
      stockStatus.textContent='تمت إضافة '+n+' كود إلى المخزون دون تفعيل أي اشتراك.';
      source.value='';
      $('one-stream-refresh')?.click();
      stockBusy=false;
      await loadStock();
    }catch(e){
      stockStatus.textContent='لا يمكن تأكيد العملية: '+e.message+
        ' افحص السجل والمخزون قبل إعادة الطلب كي لا تكرر الأكواد.';
    }finally{
      stockBusy=false;$('one-inventory-generate').disabled=false;
      $('one-inventory-import').disabled=false;
    }
  }
  $('one-inventory-generate').addEventListener('click',()=>void stockWrite('generate'));
  $('one-inventory-import').addEventListener('click',()=>void stockWrite('import'));

  const type=$('one-issue-channel');
  const note=document.createElement('p');note.className='one-codes-product-hint';
  type?.closest('label')?.append(note);
  function describeType(){
    if(!type)return;
    note.textContent=type.value==='xtream'
      ?'Xtream: يصدر كود أولًا. لا تبدأ مدة الاشتراك إلا عند تفعيله؛ يمكنك استخراج Host والمستخدم وكلمة المرور بعد التفعيل.'
      :'BLOFY STREAM: سلّم الكود للعميل ليدخله في التطبيق. المدة تبدأ عند أول تفعيل.';
  }
  type?.addEventListener('change',describeType);describeType();
  // Initialize after inventory consts and listeners exist (deep-linked #one-inventory).
  sync();
})();
