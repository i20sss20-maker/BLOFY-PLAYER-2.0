/* BLOFY store: offer checkout and consent-friendly homepage banners. */
(function(){
  'use strict';
  var buy=document.getElementById('bundle-buy');
  var status=document.getElementById('bundle-status');
  if(!buy||!status)return;
  var ready=false,busy=false,order=null,token=null;
  var quote=document.getElementById('coupon-preview');
  var coupon=document.getElementById('store-coupon');
  var result=document.getElementById('coupon-result');
  var receipt=document.getElementById('bundle-receipt');
  var receiptStatus=document.getElementById('bundle-receipt-status');
  var receiptCodes=document.getElementById('bundle-receipt-codes');
  var recheck=document.getElementById('bundle-recheck');
  var first=document.getElementById('bundle-first'),second=document.getElementById('bundle-second');
  var state='pending';
  function info(message,isError){status.textContent=message;status.classList.toggle('bad',!!isError);}
  function setBusy(v){busy=v;buy.disabled=v;buy.textContent=v?'جارٍ متابعة عملية الدفع...':'اشترك في العرض — 200 ر.س';}
  async function post(path,data){
    var response=await fetch(path,{method:'POST',credentials:'same-origin',cache:'no-store',
       headers:{accept:'application/json','content-type':'application/json'},body:JSON.stringify(data)});
    var body=await response.json().catch(function(){return {};});
    if(!response.ok)throw Error(body.error||'service_unavailable');
    return body;
  }
  function presentReceipt(message){
    receipt.hidden=false;receiptStatus.textContent=message;
    receipt.scrollIntoView({block:'center',behavior:'smooth'});
  }
  async function statusCheck(){
    if(!order||!token)return;
    presentReceipt('جارٍ التأكد من إتمام الدفع وتسليم الكودين...');
    try{
      var data=await post('/api/v1/store/orders/status',{orderId:order,accessToken:token});
      state=data.status;
      if(data.status==='paid'&&data.fulfilled&&Array.isArray(data.codes)&&data.codes.length===2){
        receiptStatus.textContent='تم تأكيد الدفع بنجاح. احتفظ بكل كود في مكان آمن؛ لكل اشتراك مدة مستقلة.';
        receiptCodes.textContent='';
        data.codes.forEach(function(item,i){
          var block=document.createElement('div');block.className='bundle-receipt-item';
          var label=document.createElement('b');
          label.textContent='اشتراك '+(i+1)+' — '+(item.channel==='xtream'?'Xtream مع BLOFY PLAYER':'BLOFY STREAM');
          var code=document.createElement('code');code.textContent=item.code;
          var copy=document.createElement('button');copy.type='button';copy.className='btn btn-outline btn-sm';
          copy.textContent='نسخ الكود';
          copy.addEventListener('click',function(){
            navigator.clipboard?.writeText(item.code).then(function(){copy.textContent='تم النسخ ✓';}).catch(function(){});
          });
          var help=document.createElement('small');
          help.textContent=item.channel==='xtream'?'استبدل الكود ببيانات Xtream في صفحة تفعيل ستريم.':'استخدم الكود في صفحة تفعيل BLOFY STREAM.';
          block.append(label,code,help,copy);receiptCodes.append(block);
        });
        recheck.hidden=true;
        // Keep the one-tab recovery token until the browser session ends.
        // Customers can refresh the receipt without triggering another payment.
        setBusy(false);
        return true;
      }
      if(data.status==='cancelled'||data.status==='failed'){
        receiptStatus.textContent='لم يُؤكد إتمام الدفع. لم يُصدر أي كود من العرض. إذا خُصم مبلغ فتواصل مع الدعم برقم الطلب.';
      }else{
        receiptStatus.textContent='طلبك قيد التحقق؛ لا تعِد الدفع. استخدم «تحقق مرة أخرى» بعد قليل.';
      }
    }catch(_){
      receiptStatus.textContent='تعذر التحقق مؤقتًا؛ لا تعِد الدفع. احتفظ برقم الطلب واضغط «تحقق مرة أخرى».';
    }
    recheck.hidden=false;setBusy(false);
    return false;
  }
  async function afterPayment(){
    for(var i=0;i<8;i++){if(await statusCheck())return;
      await new Promise(function(resolve){setTimeout(resolve,2700);});}
  }
  async function buyBundle(){
    if(!ready||busy)return;
    if(typeof window.GeideaCheckout!=='function'){
      info('تعذر فتح نافذة الدفع. جرّب تحديث الصفحة.',true);return;
    }
    setBusy(true);info('جارٍ فتح نافذة الدفع الآمنة...');
    var opened=false;
    try{
      var choices=[first.value,second.value];
      if(choices.length!==2||choices.some(function(x){return x!=='app'&&x!=='xtream';}))
        throw Error('invalid_selection');
      var discount=coupon.value.trim().toUpperCase();
      var payment=await post('/api/v1/store/checkout',{sku:'bundle-2y',bundleSelection:choices,
        couponCode:discount||undefined});
      if(payment.provider!=='geidea'||payment.checkoutMode!=='modal'||
        payment.sku!=='bundle-2y'||payment.currency!=='SAR'||!payment.orderId||
        !payment.accessToken||!payment.sessionId||
        payment.priceMinor>20000||payment.priceMinor<13999)throw Error('invalid_payment_session');
      order=payment.orderId;token=payment.accessToken;
      sessionStorage.setItem('blofy.bundle.'+order,token);
      var widget=new window.GeideaCheckout(
        function(){void afterPayment();},
        function(){presentReceipt('العملية لم تكتمل. نتحقق من حالة الدفع قبل أي محاولة أخرى.');void statusCheck();},
        function(){presentReceipt('أُغلقت نافذة الدفع. نتحقق من طلبك دون إعادة الدفع.');void statusCheck();}
      );
      widget.startPayment(payment.sessionId);opened=true;
      window.BLOFYAnalytics?.track('checkout_started');
      info('أكمل عملية الدفع داخل النافذة الآمنة.');
    }catch(e){
      info('تعذّر بدء العملية. لم يتم إصدار أي كود؛ تواصل مع الدعم إذا احتجت مساعدة.',true);
    }finally{if(!opened)setBusy(false);}
  }
  function runCarousel(){
    var root=document.getElementById('blofy-banners'),slides=[].slice.call(root?.querySelectorAll('[data-slide]')||[]);
    if(slides.length<2)return;
    var current=0;
    var dots=[].slice.call(root.querySelectorAll('[data-slide-dot]'));
    function show(n){
      current=(n+slides.length)%slides.length;
      slides.forEach(function(s,i){s.hidden=i!==current;});
      dots.forEach(function(d,i){d.setAttribute('aria-pressed',i===current?'true':'false');});
    }
    root.querySelector('[data-prev-slide]').addEventListener('click',function(){show(current-1);});
    root.querySelector('[data-next-slide]').addEventListener('click',function(){show(current+1);});
    dots.forEach(function(d){d.addEventListener('click',function(){show(Number(d.dataset.slideDot));});});
    var reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if(!reduce)window.setInterval(function(){
      if(!document.hidden&&!root.matches(':hover')&&!root.contains(document.activeElement))show(current+1);
    },7000);
    show(0);
  }
  function updateCartOffer(){
    var link=document.getElementById('bundle-add-cart');
    if(link)link.href='/store/cart?add=bundle-2y&first='+encodeURIComponent(first.value)+
      '&second='+encodeURIComponent(second.value);
  }
  first.addEventListener('change',updateCartOffer);
  second.addEventListener('change',updateCartOffer);
  updateCartOffer();
  runCarousel();
  recheck.addEventListener('click',function(){void statusCheck();});
  buy.addEventListener('click',function(){void buyBundle();});
  coupon.addEventListener('input',function(){coupon.value=coupon.value.toUpperCase().replace(/[^A-Z0-9_-]/g,'').slice(0,20);result.textContent='';});
  quote.addEventListener('click',async function(){
    var code=coupon.value.trim().toUpperCase();
    if(!code){result.textContent='أدخل كود خصم أولًا.';return;}
    var sku=document.getElementById('coupon-sku')?.value||'bundle-2y';
    try{
      var calc=await post('/api/v1/store/coupon/quote',{sku,couponCode:code});
      result.textContent='تم التحقق: الخصم '+(calc.discountMinor/100)+' ريال، والإجمالي '+(calc.priceMinor/100)+' ريال.';
    }catch(_){result.textContent='الكوبون غير صالح أو انتهت صلاحيته. يمكنك الاستمرار بالسعر العادي بعد مسح الكوبون.';}
  });
  var returned=location.hash.match(/^#store_order=([0-9a-f-]{36})$/i);
  if(returned){
    var saved='';
    try{saved=sessionStorage.getItem('blofy.bundle.'+returned[1])||'';}catch(_){}
    if(saved){order=returned[1];token=saved;void afterPayment();}
  }
  fetch('/api/v1/store/products',{cache:'no-store',headers:{accept:'application/json'}})
    .then(function(r){if(!r.ok)throw Error();return r.json();})
    .then(function(data){
      var offer=Array.isArray(data.offers)&&data.offers.find(function(x){return x.sku==='bundle-2y';});
      ready=!!(data.checkoutAvailable&&offer&&offer.priceMinor===20000&&offer.quantity===2);
      // All new purchases use the verified-account cart.
      buy.hidden=true;
      info(ready?'اختر الاشتراكين ثم أكمل الطلب.':'الدفع الإلكتروني غير متاح حاليًا. تواصل معنا للاستفسار.');
    }).catch(function(){info('تعذر التحقق من جاهزية الدفع. تواصل مع الدعم.',true);});
})();