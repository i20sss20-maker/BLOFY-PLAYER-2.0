/* BLOFY ONE: unified code center. Moves existing UI sections only;
   issuance, lookup, admin sessions and backend logic are unchanged. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const issue=$('one-issue'),legacy=$('legacy-xtream'),ledger=$('stream-management');
  if(!issue||!legacy||!ledger)return;
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
  host.textContent='هوست Xtream: y.blofyplayer.com';
  intro.append(title,host);center.append(intro);
  const tabs=document.createElement('div');tabs.className='one-codes-tabs';
  tabs.setAttribute('role','tablist');
  tabs.setAttribute('aria-label','عمليات الاشتراكات والأكواد');
  const definitions=[
    ['one-issue','＋ إنشاء اشتراك جديد'],
    ['legacy-xtream','⌕ فحص أو استخراج Xtream'],
    ['stream-management','▤ سجل الأكواد والعملاء']
  ];
  for(const [id,name] of definitions){
    const button=document.createElement('button');
    button.type='button';button.textContent=name;
    button.dataset.oneCodesTab=id;
    button.setAttribute('role','tab');
    button.setAttribute('aria-controls',id);
    tabs.append(button);
  }
  center.append(tabs,issue,legacy,ledger);
  const buttons=[...tabs.querySelectorAll('button')];
  let selected='one-issue';
  const choices=new Set(definitions.map(x=>x[0]));
  function wipe(id){
    if(id==='one-issue')$('one-issue-hide')?.click();
    if(id==='legacy-xtream')$('one-legacy-hide')?.click();
    if(id==='stream-management')$('one-stream-secret-hide')?.click();
  }
  function show(id,scroll=false){
    if(!choices.has(id))return;
    if(selected!==id)wipe(selected);
    selected=id;
    for(const el of [issue,legacy,ledger])el.hidden=el.id!==id;
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
    else wipe(selected);
  }
  addEventListener('hashchange',sync);sync();

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
})();
