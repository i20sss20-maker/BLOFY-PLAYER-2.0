/* BLOFY ONE — quick operator experience. Uses existing admin operations
 * only; does not issue, redeem, renew, publish or sell without explicit input.
 */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const issue=$('one-issue'),form=$('one-issue-form');
  if(!issue||!form)return;

  // The dashboard quick stats mirror the existing authenticated management
  // widgets — no guessed numbers, duplicate API calls or placeholder sales.
  const mirrors=[
    ['one-customer-total','one-dashboard-customers'],
    ['one-stream-code-total','one-dashboard-codes'],
    ['one-stream-unused','one-dashboard-unused'],
    ['one-src-active','one-dashboard-sources']
  ];
  for(const [sourceId,targetId] of mirrors){
    const source=$(sourceId),target=$(targetId);
    if(!source||!target)continue;
    const sync=()=>{
      const value=String(source.textContent||'').trim();
      target.textContent=value&&value.length<=40?value:'—';
    };
    sync();
    new MutationObserver(sync).observe(source,{childList:true,characterData:true,subtree:true});
  }
  // One clear path from the opening viewport to the real code issuing form.
  const quickJump=$('one-quick-jump');
  quickJump?.addEventListener('change',()=>{
    const id=String(quickJump.value||'');
    if(!/^[a-z][a-z0-9-]{0,40}$/.test(id))return;
    const target=$(id);
    if(target){
      window.location.hash='#'+id;
      target.scrollIntoView({behavior:'smooth',block:'start'});
    }
    quickJump.value='';
  });

  const mainNav=$('one-nav');
  const trackedLinks=mainNav?
    [...mainNav.querySelectorAll('a[href^="#"]')]:[];
  function setActive(anchor){
    for(const link of trackedLinks){
      const selected=link.getAttribute('href')===anchor;
      link.classList.toggle('is-active',selected);
      if(selected)link.setAttribute('aria-current','location');
      else link.removeAttribute('aria-current');
    }
  }
  const hashUpdate=()=>setActive(window.location.hash||'#one-issue');
  window.addEventListener('hashchange',hashUpdate);
  hashUpdate();

  const days=$('one-issue-days'),channel=$('one-issue-channel');
  const quantity=$('one-issue-quantity'),connections=$('one-issue-connections');
  const label=$('one-issue-label'),summary=$('one-issue-preview');
  const presets=[...issue.querySelectorAll('[data-one-days]')];
  const channelName=value=>value==='app'?'BLOFY STREAM':'Xtream';
  const durationName=value=>({1:'يوم واحد',7:'أسبوع',30:'شهر',90:'3 أشهر',180:'6 أشهر',365:'سنة'})[value]||
    String(value)+' يومًا';
  const wordQuantity=value=>value===1?'كود واحد':String(value)+' أكواد';
  const connectionsName=value=>value===1?'اتصال واحد':String(value)+' اتصالات';
  function updatePreview(){
    const count=Number(quantity?.value||0),conn=Number(connections?.value||0);
    summary.textContent=wordQuantity(count)+' · '+channelName(channel.value)+' · '+
      durationName(Number(days.value))+' · '+connectionsName(conn);
    for(const b of presets){
      const current=b.dataset.oneDays===days.value;
      b.classList.toggle('is-active',current);
      b.setAttribute('aria-pressed',String(current));
    }
    issue.dataset.channel=channel.value;
  }
  for(const preset of presets){
    preset.addEventListener('click',()=>{
      const selected=preset.dataset.oneDays;
      if(![...days.options].some(option=>option.value===selected))return;
      days.value=selected;
      days.dispatchEvent(new Event('change',{bubbles:true}));
    });
  }
  for(const field of [days,channel,quantity,connections,label]){
    field?.addEventListener('change',updatePreview);
    field?.addEventListener('input',updatePreview);
  }
  updatePreview();

  // Simple single-code default, without calling the API. The primary
  // Create button still goes through the existing confirm dialog.
  document.addEventListener('keydown',event=>{
    if(event.defaultPrevented||event.altKey!==true||event.ctrlKey||event.metaKey||
       String(event.key).toLowerCase()!=='n')return;
    const tag=String(document.activeElement?.tagName||'').toLowerCase();
    if(['input','textarea','select'].includes(tag))return;
    event.preventDefault();
    window.location.hash='#one-issue';
    issue.scrollIntoView({behavior:'smooth',block:'start'});
    channel.focus({preventScroll:true});
  });

  // Each freshly issued voucher gets a convenient copy action. The code
  // remains in the already time-limited result container, never storage.
  const list=$('one-issue-code-list'),result=$('one-issue-result');
  const message=$('one-issue-status');
  const copyAll=$('one-issue-copy');
  const countdown=$('one-issue-countdown');
  function enhanceResult(){
    if(!list||result.hidden)return;
    const codes=[...list.querySelectorAll('.one-issue-code')];
    for(const row of codes){
      if(row.querySelector('[data-one-copy]'))continue;
      const element=row.querySelector('code');
      if(!element)continue;
      const button=document.createElement('button');
      button.type='button';
      button.className='one-copy-single';
      button.dataset.oneCopy='true';
      button.textContent='نسخ';
      button.setAttribute('aria-label','نسخ هذا الكود فقط');
      row.append(button);
    }
    if(countdown){
      if(codes.length&&!countdown.dataset.expiresAt){
        countdown.dataset.expiresAt=String(Date.now()+90000);
      }
      if(!codes.length)delete countdown.dataset.expiresAt;
    }
  }
  const listObserver=new MutationObserver(enhanceResult);
  if(list)listObserver.observe(list,{childList:true});
  list?.addEventListener('click',async event=>{
    const button=event.target.closest('button[data-one-copy]');
    if(!button)return;
    const row=button.closest('.one-issue-code');
    const code=row?.querySelector('code')?.textContent;
    if(!code||!/^\d{8,12}$/.test(code))return;
    try{
      await navigator.clipboard.writeText(code);
      const previous=button.textContent;
      button.textContent='✓ نُسخ';
      setTimeout(()=>{
        if(button.isConnected&&button.textContent==='✓ نُسخ')button.textContent=previous;
      },1900);
      if(message)message.textContent='تم نسخ الكود المحدد؛ سلّمه لصاحب الاشتراك فقط.';
    }catch{
      if(message)message.textContent='تعذر النسخ التلقائي، حدد الكود وانسخه يدويًا.';
    }
  });
  const cleanTimer=setInterval(()=>{
    if(!countdown)return;
    if(result.hidden||!list?.childElementCount){
      countdown.textContent='';
      delete countdown.dataset.expiresAt;
      return;
    }
    const expiry=Number(countdown.dataset.expiresAt||0);
    if(expiry>0){
      const remaining=Math.max(0,Math.ceil((expiry-Date.now())/1000));
      countdown.textContent='تُخفى الأكواد خلال '+remaining+' ثانية';
    }
  },1000);
  window.addEventListener('pagehide',()=>clearInterval(cleanTimer));

  // Not new purchases or automatic renewals: only navigation aids.
  const mobile=document.createElement('a');
  mobile.className='one-mobile-create';
  mobile.href='#one-issue';
  mobile.textContent='＋ إنشاء كود اشتراك';
  mobile.setAttribute('aria-label','الانتقال مباشرة إلى نموذج إصدار كود');
  document.body.append(mobile);
})();
