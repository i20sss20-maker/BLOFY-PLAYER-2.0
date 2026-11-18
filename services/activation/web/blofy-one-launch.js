/* BLOFY ONE · real, read-only, consent-based marketing and readiness.
 * Never mixes paid order statuses with bank settlement or manual sales.
 * No secrets, no client-level profiling, no media probing or auto-issuance.
 */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const root=$('one-growth');
  if(!root)return;
  const refresh=$('one-growth-refresh'), days=$('one-growth-days');
  const status=$('one-growth-status'),issues=$('one-growth-issues');
  const integer=new Intl.NumberFormat('en-US');
  let running=false,generation=0;
  const ids=['sessions','views','wa-clicks','checkout-starts','store-paid','store-revenue',
    'funnel-views','funnel-product','funnel-checkout','funnel-paid'];
  const healthNames=['activation','downloads','stream','payment','fulfillment','stock','customers'];
  const text=(id,value)=>{const e=$('one-growth-'+id);if(e)e.textContent=value;};
  const safeCount=value=>{
    const n=Number(value);
    return Number.isSafeInteger(n)&&n>=0?integer.format(n):'—';
  };
  function moneyMinor(value){
    const raw=String(value??'');
    if(!/^\d{1,22}$/.test(raw))return '—';
    const minor=BigInt(raw);
    return integer.format(minor/100n)+'.'+String(minor%100n).padStart(2,'0')+' ر.س';
  }
  function signal(name,label,tone){
    const el=$('one-growth-health-'+name);
    if(!el)return;
    el.textContent=label;
    el.dataset.state=tone;
  }
  function emptyTable(label){
    const tbody=$('one-growth-campaigns');
    tbody.replaceChildren();
    const row=document.createElement('tr'),td=document.createElement('td');
    td.colSpan=3;td.textContent=label;
    row.append(td);tbody.append(row);
  }
  function row(cells){
    const tr=document.createElement('tr');
    for(const v of cells){
      const td=document.createElement('td');
      td.textContent=String(v??'—').slice(0,100);
      tr.append(td);
    }
    return tr;
  }
  function renderCampaigns(data){
    const tbody=$('one-growth-campaigns');
    tbody.replaceChildren();
    const campaigns=Array.isArray(data.campaigns)?data.campaigns:[];
    const sources=Array.isArray(data.sources)?data.sources:[];
    const rows=campaigns.filter(x=>x&&typeof x==='object').slice(0,7);
    if(!rows.length){
      for(const x of sources.slice(0,7)){
        if(!x||typeof x!=='object')continue;
        rows.push({source:x.source,campaign:'بدون حملة',sessions:x.sessions});
      }
    }
    if(!rows.length)return emptyTable('لا توجد زيارات بموافقة القياس خلال الفترة المحددة.');
    for(const v of rows){
      tbody.append(row([v.source||'غير محدد',v.campaign||'—',safeCount(v.sessions)]));
    }
  }
  function reset(){
    for(const id of ids)text(id,'—');
    emptyTable('جارٍ التحقق من مصادر الزيارات…');
    for(const name of healthNames)signal(name,'جارٍ الفحص','pending');
    // WhatsApp and media remain explicit "not integrated / not measured".
    signal('whatsapp','رابط فقط','warn');
    signal('media','غير مُقاس','warn');
    issues.classList.remove('is-error');
    issues.textContent='جارٍ فحص الطلبات والمدفوعات؛ لا تتخذ قرارًا بناءً على بيانات قديمة.';
  }
  async function get(path){
    const ctrl=new AbortController();
    const timer=setTimeout(()=>ctrl.abort(),12000);
    try{
      const response=await fetch(path,{method:'GET',credentials:'same-origin',
        cache:'no-store',headers:{accept:'application/json'},signal:ctrl.signal});
      if(response.status===401)throw Error('session_required');
      if(response.status===429)throw Error('rate_limited');
      if(!response.ok)throw Error('http_'+response.status);
      const data=await response.json();
      if(!data||typeof data!=='object'||data.ok===false)
        throw Error('invalid_response');
      return data;
    }catch(error){
      if(error.name==='AbortError')throw Error('timeout');
      throw error;
    }finally{clearTimeout(timer)}
  }
  async function load(){
    if(running)return;
    running=true;const seq=++generation;
    refresh.disabled=true;reset();
    status.textContent='جارٍ جمع المؤشرات الموثقة من المتجر والخدمات…';
    const span=Number(days.value);
    const interval=[7,30,90].includes(span)?span:30;
    const requests=[
      get('/api/v1/admin/site-analytics/summary?days='+interval),
      get('/api/v1/public/system-health'),
      get('/health'),
      get('/api/v1/store/products'),
      get('/api/v1/admin/store/sales'),
      get('/api/v1/admin/store/inventory'),
      get('/api/v1/admin/whatsapp/cloud/status'),
      get('/api/v1/admin/store/customer-accounts/summary'),
      get('/api/v1/admin/store/fulfillment-audit')
    ];
    try{
      const settled=await Promise.allSettled(requests);
      if(seq!==generation)return;
      const good=i=>settled[i].status==='fulfilled';
      const value=i=>good(i)?settled[i].value:null;
      const analytics=value(0),systems=value(1),portal=value(2),
        catalog=value(3),sales=value(4),inventory=value(5),whatsapp=value(6),customer=value(7),fulfillmentAudit=value(8);
      if(analytics?.source==='consented_first_party'&&analytics.days===interval){
        const totals=analytics.totals||{};
        const event=new Map((Array.isArray(analytics.events)?analytics.events:[])
          .filter(x=>x&&typeof x.event==='string').map(x=>[x.event,Number(x.hits)||0]));
        text('sessions',safeCount(totals.sessions));
        text('views',safeCount(totals.views));
        text('wa-clicks',safeCount(event.get('whatsapp_click')||0));
        text('checkout-starts',safeCount(event.get('checkout_started')||0));
        text('funnel-views',safeCount(totals.views));
        text('funnel-product',safeCount(event.get('product_click')||0));
        text('funnel-checkout',safeCount(event.get('checkout_started')||0));
        renderCampaigns(analytics);
      }else emptyTable('تعذر قراءة التحليلات بموافقة الزوار؛ لا تظهر أرقام تقديرية.');
      if(portal?.ok===true&&portal.database==='ready')
        signal('activation','متصل · DB جاهزة','ok');
      else signal('activation','غير مؤكّد','fail');
      for(const name of ['downloads','stream']){
        const state=systems?.services?.[name]?.status;
        if(state==='healthy')signal(name,'HTTP متصل','ok');
        else if(state==='degraded')signal(name,'استجابة غير سليمة','fail');
        else signal(name,'اتصال غير مؤكد',state==='unknown'?'warn':'pending');
      }
      const providerStatus=customer?.emailProviderStatus;
      const emailReady=customer?.accountsEnabled===true&&customer?.emailConfigured===true;
      const emailProof=customer?.emailDeliveryVerified===true&&
        customer?.emailDeliveryEvidence==='otp_verified_within_24h';
      const providerVerified=providerStatus==='verified';
      const emailDegraded=new Set(['key_invalid','sender_domain_absent',
        'sender_domain_not_verified','invalid_config']).has(providerStatus);
      if(!emailReady)
        signal('customers',customer?.accountsEnabled===true?'البريد غير مهيأ':'الحسابات غير مفعلة','warn');
      else if(emailDegraded)
        signal('customers',providerStatus==='key_invalid'?
          'مفتاح البريد مرفوض من مزود الإرسال':'نطاق إرسال البريد يحتاج إصلاحًا','fail');
      else if(emailProof)
        signal('customers',safeCount(customer.customers)+
          ' حساب · تم تأكيد رمز دخول خلال 24 ساعة','ok');
      else if(providerVerified)
        signal('customers',safeCount(customer.customers)+
          ' حساب · النطاق موثّق، اختبار إرسال مطلوب','warn');
      else signal('customers',safeCount(customer.customers)+
          ' حساب · جاهزية البريد غير مؤكدة','warn');
      if(whatsapp?.provider==='meta_whatsapp_cloud'&&whatsapp.configured===true)
        signal('whatsapp','Cloud API مهيأ · تحقق Meta مطلوب','warn');
      else signal('whatsapp','رابط فقط · Cloud API غير مهيأ','warn');
      const payReady=catalog?.provider==='geidea'&&catalog.checkoutAvailable===true;
      signal('payment',payReady?'بدء الدفع متاح':'غير جاهز أو غير مؤكد',
        payReady?'ok':'warn');
      let paidOrders=null,paidMinor=null,fulfillmentIssues=null;
      if(sales&&Array.isArray(sales.sales)){
        paidOrders=0;paidMinor=0n;
        for(const item of sales.sales){
          if(item?.status!=='paid')continue;
          const orders=Number(item.orders);
          const amount=String(item.amount_minor??'');
          if(!Number.isSafeInteger(orders)||orders<0||!/^\d{1,22}$/.test(amount)){
            paidOrders=null;paidMinor=null;break;
          }
          paidOrders+=orders;
          paidMinor+=BigInt(amount);
        }
        // Legacy count checks only for any cart code, not the full purchased set;
        // it cannot prove that every paid voucher is delivered.
      }
      if(Number.isSafeInteger(paidOrders)&&paidOrders>=0&&paidMinor!==null){
        text('store-paid',safeCount(paidOrders));
        text('store-revenue',moneyMinor(String(paidMinor)));
        text('funnel-paid',safeCount(paidOrders));
      }
      const auditReady=fulfillmentAudit?.ok===true &&
        Number.isSafeInteger(fulfillmentAudit.auditedOrders) &&
        Number.isSafeInteger(fulfillmentAudit.issueOrders);
      fulfillmentIssues=auditReady?fulfillmentAudit.issueOrders:null;
      if(auditReady){
        const audited=safeCount(fulfillmentAudit.auditedOrders);
        const label=fulfillmentIssues>0
          ?safeCount(fulfillmentIssues)+' طلب ناقص من '+audited+' تم تدقيقه'
          :fulfillmentAudit.truncated
            ?'أحدث '+audited+' طلب سليم · تدقيق جزئي'
            :audited+' طلب تم فحص أكوادها';
        signal('fulfillment',label,fulfillmentIssues>0?'fail':
          fulfillmentAudit.truncated?'warn':'ok');
      }else signal('fulfillment','التدقيق التفصيلي للأكواد غير متاح','pending');
      let stock=null;
      if(inventory?.ok===true&&Array.isArray(inventory.counts)){
        stock=inventory.counts.reduce((sum,x)=>{
          const available=Number(x?.available);
          return Number.isSafeInteger(available)&&available>=0?sum+available:sum;
        },0);
        signal('stock',safeCount(stock)+' كود جاهز',stock>0?'ok':'warn');
      }else signal('stock','لم يُتحقق من المخزون','pending');
      const warnings=[];
      if(!good(0))warnings.push('إحصائيات المتجر غير متاحة');
      if(!portal?.ok||portal?.database!=='ready')warnings.push('التفعيل أو قاعدة بياناته تحتاج فحصًا');
      if(systems?.services?.downloads?.status!=='healthy')warnings.push('موقع التحميلات ليس مؤكدًا');
      if(systems?.services?.stream?.status!=='healthy')warnings.push('STREAM API ليست مؤكدة');
      if(!payReady)warnings.push('بدء الدفع غير متاح أو لم يتم التحقق منه');
      if(!emailReady)warnings.push('حسابات العملاء أو إعدادات بريد الدخول لم تجهز بعد');
      else if(emailDegraded)warnings.push(providerStatus==='key_invalid'?
        'مفتاح Resend مرفوض: طلبات رمز الدخول ستفشل حتى تصحيح المفتاح':
        'نطاق البريد ليس موثوقًا لدى مزود الإرسال');
      else if(emailProof){
        // OTP verification is recent successful delivery evidence, not
        // a guarantee that the provider will accept every future request.
      }else if(!providerVerified)warnings.push('جاهزية مزود البريد غير مؤكدة؛ يلزم اختبار استلام رمز حقيقي');
      else warnings.push('تحقق النطاق وحده لا يثبت وصول رسائل الدخول؛ اختبر الإرسال فعليًا');
      if(Number.isSafeInteger(fulfillmentIssues)&&fulfillmentIssues>0)
        warnings.push(safeCount(fulfillmentIssues)+' طلب مدفوع به أكواد ناقصة أو غير سليمة');
      if(fulfillmentAudit?.truncated)warnings.push('التدقيق مقتصر على أحدث 500 طلب مدفوع في 90 يومًا؛ لا يمثل جميع الطلبات');
      if(fulfillmentIssues===null)warnings.push('لا توجد قراءة مؤكدة لحالات تسليم الطلبات');
      if(stock===null)warnings.push('مخزون الأكواد لم يُقرأ');
      issues.classList.toggle('is-error',warnings.length>0);
      issues.textContent=warnings.length?
        'ملاحظات تحتاج مراجعة: '+warnings.join(' · ')+'.':
        'لا توجد مشاكل ظاهرة في فحوصات الخدمات وسجل تسليم الأكواد الحالية. لا يعني ذلك إثبات قدرة بث متزامن.';
      const failed=settled.filter(x=>x.status==='rejected').length;
      const sessionExpired=settled.some(x=>x.status==='rejected'&&x.reason?.message==='session_required');
      status.textContent=(sessionExpired?'انتهت جلسة الإدارة؛ سجّل الدخول مجددًا. ':
        'آخر فحص: '+new Date().toLocaleString('ar-SA')+'. ')+
        'مصادر استجابت: '+(settled.length-failed)+' من '+settled.length+
        ' · الزيارات بموافقة فقط · لا يعدّ ذلك اختبار ضغط أو تسوية بنكية.';
      status.classList.toggle('is-error',failed>0);
    }finally{running=false;refresh.disabled=false;}
  }
  refresh.addEventListener('click',()=>void load());
  days.addEventListener('change',()=>void load());
  $('one-refresh')?.addEventListener('click',()=>void load());
  void load();
})();
