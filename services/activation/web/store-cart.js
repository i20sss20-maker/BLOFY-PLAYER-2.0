'use strict';
(function(){
 const $=id=>document.getElementById(id);
 const storageKey='blofy.shop.cart.v1';
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 const title=sku=>({
   'stream-3m':'BLOFY STREAM — 3 أشهر','stream-6m':'BLOFY STREAM — 6 أشهر',
   'stream-1y':'BLOFY STREAM — سنة','xtream-3m':'Xtream BLOFY — 3 أشهر',
   'xtream-6m':'Xtream BLOFY — 6 أشهر','xtream-1y':'Xtream BLOFY — سنة',
   'bundle-2y':'عرض اشتراكين سنويين'
 })[sku]||'اشتراك BLOFY';
 const money=n=>(Number(n)/100).toLocaleString('ar-SA',{minimumFractionDigits:0,maximumFractionDigits:2})+' ر.س';
 let items=[],quoted=null,ready=false,creating=false,paymentOpen=false,currentOrder=null,accessToken=null;
 let signedIn=false,accountEmail='',cloudRevision=null,cloudSynced=false,cloudSyncing=false,
   savedSnapshot='',hasUrlAddition=false,urlAddedLine=null,accountId='',pendingChecked=false,checkingPending=false;
 const pendingKey='blofy.shop.pending-checkout.v1';
 const cloudEndpoint='/api/v1/store/account/cart',ownerKey='blofy.shop.cart.owner.v1';
 // Geidea officially supports browser redirection using the already created session.
 // Never depend on the external modal JavaScript loading to let customers pay.
 function hostedPaymentUrl(sessionId){
   return UUID.test(sessionId||'')?
     'https://www.ksamerchant.geidea.net/hpp/checkout/?'+encodeURIComponent(sessionId):null;
 }
 const message=(text)=>{$('message').textContent=text;};
 const keyOf=item=>item.sku==='bundle-2y'?'bundle-2y:'+item.bundleSelection.join('+'):item.sku;
 function validLine(item){
   if(!item||typeof item!=='object')return false;
   if(!['stream-3m','stream-6m','stream-1y','xtream-3m','xtream-6m','xtream-1y','bundle-2y'].includes(item.sku))return false;
   if(!Number.isInteger(item.quantity)||item.quantity<1||item.quantity>3)return false;
   if(item.sku==='bundle-2y')return Array.isArray(item.bundleSelection)&&item.bundleSelection.length===2&&
     item.bundleSelection.every(s=>s==='app'||s==='xtream');
   return item.bundleSelection==null;
 }
 function totalCodes(value){return value.reduce((n,x)=>n+x.quantity*(x.sku==='bundle-2y'?2:1),0);}
 function save(){
   try{localStorage.setItem(storageKey,JSON.stringify(items));queueSync();return true;}
   catch(_){message('التخزين المحلي غير متاح؛ قد تختفي السلة عند إغلاق الصفحة.');return false;}
 }
 function restore(){
   try{
     const parsed=JSON.parse(localStorage.getItem(storageKey)||'[]');
     if(!Array.isArray(parsed))return [];
     const seen=new Set(),out=[];
     for(const it of parsed){
       if(!validLine(it))continue;
       const key=keyOf(it);
       if(seen.has(key))continue;
       seen.add(key);out.push({sku:it.sku,quantity:it.quantity,
         ...(it.sku==='bundle-2y'?{bundleSelection:[...it.bundleSelection]}:{})});
       if(out.length>=5)break;
     }
     while(totalCodes(out)>6)out.pop();
     return out;
   }catch(_){return [];}
 }
 function addFromURL(){
   const params=new URLSearchParams(location.search),sku=params.get('add');
   if(!sku)return;
   const line={sku,quantity:1};
   if(sku==='bundle-2y')
     line.bundleSelection=[params.get('first')||'app',params.get('second')||'app'];
   if(validLine(line)){
     const same=items.find(x=>keyOf(x)===keyOf(line));
     let added=false;
     if(same&&same.quantity<3&&totalCodes(items)+(sku==='bundle-2y'?2:1)<=6){
       same.quantity++;added=true;
     }else if(!same&&items.length<5&&totalCodes(items)+(sku==='bundle-2y'?2:1)<=6){
       items.push(line);added=true;
     }else message('بلغت الحد الأعلى للسلة، 6 أكواد في الطلب الواحد.');
     if(added){
       // Remember ONLY the item chosen in this visit. Never import another
       // signed-in customer's saved browser cart into a new account.
       hasUrlAddition=true;
       urlAddedLine={...line,...(line.bundleSelection?{bundleSelection:[...line.bundleSelection]}:{})};
       save();
     }
   }else message('المنتج غير متاح. أضفه مجددًا من المتجر.');
   history.replaceState(null,'','/store/cart');
 }
 function el(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;}
 function render(lines=null){
   const root=$('items');root.replaceChildren();
   if(!items.length){
     root.append(el('p','', 'السلة فارغة حاليًا. اختر اشتراك ستريم أو إكستريم أو العرض السنوي من المتجر.'));
     $('checkout').disabled=true;$('clear-cart').disabled=true;
   }else{
     $('clear-cart').disabled=false;
     for(const [i,item] of items.entries()){
       const row=el('div','item'),content=el('div'),p=el('p','',item.sku==='bundle-2y'
         ?'كودان مستقلان لسنة كاملة: '+item.bundleSelection.map(x=>x==='app'?'ستريم':'إكستريم').join(' + ')
         :'كود واحد لكل اشتراك'),heading=el('h3','',title(item.sku));
       const act=el('div','item-actions'),label=el('label','', 'الكمية'),select=el('select');
       select.setAttribute('aria-label','عدد '+title(item.sku));
       for(let q=1;q<=3;q++){const option=el('option','',String(q));option.value=String(q);if(q===item.quantity)option.selected=true;select.append(option);}
       select.addEventListener('change',()=>{
         const before=item.quantity;item.quantity=Number(select.value);
         if(totalCodes(items)>6){item.quantity=before;message('الطلب الواحد يسمح بـ6 أكواد فقط.');render();return;}
         save();void refresh();
       });
       const remove=el('button','', 'حذف المنتج');remove.type='button';remove.addEventListener('click',()=>{
         items.splice(i,1);save();void refresh();
       });
       act.append(label,select,remove);content.append(heading,p,act);
       const price=lines&&lines[i]?money(lines[i].lineTotalMinor):'يُحسب الآن';
       const sum=el('strong','',price);row.append(content,sum);root.append(row);
     }
   }
   $('codes-count').textContent=String(totalCodes(items));
 }
 function resetPrice(){
   $('subtotal').textContent='—';$('discount').textContent='—';$('total').textContent='—';
   $('checkout').disabled=true;quoted=null;
 }
 async function request(path,body){
   const response=await fetch(path,{method:'POST',credentials:'same-origin',cache:'no-store',
     headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify(body)});
   const data=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(data.error||'store_unavailable');
   return data;
 }
 function body(){
   const coupon=$('coupon').value.trim().toUpperCase();
   return {items:items.map(x=>({sku:x.sku,quantity:x.quantity,
     ...(x.sku==='bundle-2y'?{bundleSelection:[...x.bundleSelection]}:{})})),
     ...(coupon?{couponCode:coupon}:{})};
 }

 function cleanItems(value){
   if(!Array.isArray(value))return [];
   const out=[],seen=new Set();
   for(const raw of value){
     if(!validLine(raw))continue;
     const key=keyOf(raw);
     if(seen.has(key))continue;
     if(out.length>=5||totalCodes(out)+raw.quantity*(raw.sku==='bundle-2y'?2:1)>6)continue;
     seen.add(key);
     out.push({sku:raw.sku,quantity:raw.quantity,
       ...(raw.sku==='bundle-2y'?{bundleSelection:[...raw.bundleSelection]}:{})});
   }
   return out;
 }
 function mergeSavedCart(cloud,local){
   // Previously synced devices respect server deletions. A newly added URL item
   // and a first-time guest basket merge, without doubling duplicate quantities.
   const merged=cleanItems(cloud),byKey=new Map(merged.map(x=>[keyOf(x),x]));
   for(const line of cleanItems(local)){
     const existing=byKey.get(keyOf(line));
     if(existing){
       const former=existing.quantity;
       existing.quantity=Math.max(existing.quantity,line.quantity);
       if(totalCodes(merged)>6)existing.quantity=former;
     }else if(merged.length<5&&totalCodes(merged)+line.quantity*
       (line.sku==='bundle-2y'?2:1)<=6){
       const copied={...line,...(line.bundleSelection?{bundleSelection:[...line.bundleSelection]}:{})};
       merged.push(copied);byKey.set(keyOf(copied),copied);
     }
   }
   return merged;
 }
 function cartSnapshot(){
   return JSON.stringify({items:items.map(x=>({sku:x.sku,quantity:x.quantity,
     ...(x.bundleSelection?{bundleSelection:[...x.bundleSelection]}:{})})),
     couponCode:$('coupon').value.trim().toUpperCase()});
 }
 function updateCheckoutButton(){
   const button=$('checkout');
   button.textContent=!signedIn?'تسجيل الدخول مطلوب قبل الدفع':
     paymentOpen?'لديك طلب دفع سابق، راجع حالته':
     !cloudSynced?'جارٍ حفظ السلة...':
     !pendingChecked?'جارٍ فحص الطلبات السابقة...':'إكمال الطلب والدفع الآمن';
   button.disabled=!signedIn||!cloudSynced||!pendingChecked||!ready||creating||paymentOpen||!quoted||!items.length;
 }
 function authUI(){
   const gate=$('auth-gate'),headline=$('auth-title'),label=$('auth-message'),link=$('auth-link');
   gate.dataset.state=signedIn?'verified':'login';
   headline.textContent=signedIn?'تم التحقق من حسابك ✓':'سجّل الدخول قبل الدفع';
   label.textContent=signedIn?'البريد الموثق: '+accountEmail+
     ' · سلتك مرتبطة بحسابك ويمكنك متابعتها من أي جهاز.':
     'اختر باقاتك الآن، ثم سجّل الدخول برمز يصلك على البريد؛ السلة لن تختفي أثناء التسجيل.';
   link.hidden=signedIn;
   const indicator=$('cart-sync');
   indicator.textContent=!signedIn?'ستُحفظ السلة في حسابك بعد تسجيل الدخول.':
     cloudSynced?'✓ محفوظة بحسابك':'جارٍ مزامنة السلة مع حسابك…';
   indicator.dataset.state=cloudSynced?'saved':'pending';
   if(cloudSynced)$('retry-cart-sync').hidden=true;
   updateCheckoutButton();
 }
 function queueSync(){
   if(!signedIn||cloudRevision===null)return;
   cloudSynced=false;pendingChecked=false;
   $('retry-cart-sync').hidden=true;authUI();
   if(!cloudSyncing)void syncCloud();
 }
 async function syncCloud(){
   if(cloudSyncing||!signedIn||cloudRevision===null)return;
   cloudSyncing=true;
   try{
     // Serialize writes and check the snapshot after every response; this prevents
     // out-of-order changes from reverting quantities or coupons.
     for(let attempt=0;attempt<8;attempt++){
       const payload=cartSnapshot();
       if(payload===savedSnapshot){cloudSynced=true;break;}
       const snapshot=JSON.parse(payload);
       const result=await request(cloudEndpoint,{...snapshot,revision:cloudRevision});
       if(!Number.isSafeInteger(result.revision))throw Error('cart_save_failed');
       cloudRevision=result.revision;savedSnapshot=payload;
       if(cartSnapshot()===payload){cloudSynced=true;break;}
     }
     authUI();
     if(cloudSynced)await checkPendingForCart();
   }catch(err){
     cloudSynced=false;pendingChecked=false;
     const changedElsewhere=err.message==='store_cart_changed_on_another_device';
     $('cart-sync').textContent=changedElsewhere
       ?'السلة تغيرت من جهاز آخر. حدّث الصفحة لجلب أحدث نسخة قبل الدفع.'
       :'فشل حفظ السلة في حسابك. لم يبدأ الدفع؛ أعد محاولة الحفظ.';
     $('cart-sync').dataset.state='error';
     const retry=$('retry-cart-sync');
     retry.textContent=changedElsewhere?'جلب السلة المحدثة':'إعادة حفظ السلة';
     retry.hidden=false;retry.dataset.reload=changedElsewhere?'yes':'no';
     updateCheckoutButton();
   }finally{
     cloudSyncing=false;
     // An edit made during an in-flight request must not remain unsaved.
     if(signedIn&&cloudRevision!==null&&savedSnapshot!==cartSnapshot()&&cloudSynced)
       queueSync();
   }
 }
 async function initAccount(){
   try{
     const response=await fetch('/api/v1/store/account',{cache:'no-store',credentials:'same-origin',
       headers:{accept:'application/json'}});
     if(response.status===401){authUI();return;}
     if(!response.ok)throw Error('account_unavailable');
     const data=await response.json();
     if(typeof data.email!=='string'||typeof data.customerId!=='string')
       throw Error('account_invalid');
     signedIn=true;accountEmail=data.email;accountId=data.customerId;
     const saved=await fetch(cloudEndpoint,{cache:'no-store',credentials:'same-origin',
       headers:{accept:'application/json'}});
     if(!saved.ok)throw Error('cart_unavailable');
     const remote=await saved.json();
     if(!Number.isSafeInteger(remote.revision)||!Array.isArray(remote.items))
       throw Error('cart_invalid');
     // The browser may still contain another verified account's basket.
     // Use its owner marker to avoid leaking those items or coupon into
     // the newly verified account. A product selected on this visit is safe.
     let previousOwner=null;
     try{previousOwner=localStorage.getItem(ownerKey);}catch(_){}
     const accountChanged=!!previousOwner&&previousOwner!==data.customerId;
     const previouslySynced=previousOwner===data.customerId;
     const guestLines=accountChanged?(urlAddedLine?[urlAddedLine]:[]):items;
     items=(!hasUrlAddition&&previouslySynced)?
       cleanItems(remote.items):mergeSavedCart(remote.items,guestLines);
     // Preserve the remote coupon on account change. Never carry an old
     // customer's private discount or stale quote into this checkout.
     $('coupon').value=accountChanged||(!hasUrlAddition&&previouslySynced)?
       (remote.couponCode||''):($('coupon').value||remote.couponCode||'');
     cloudRevision=remote.revision;
     savedSnapshot=JSON.stringify({items:cleanItems(remote.items),couponCode:remote.couponCode||''});
     try{
       localStorage.setItem(ownerKey,data.customerId);
       localStorage.setItem(storageKey,JSON.stringify(items));
     }catch(_){
       // Cloud is authoritative; private-browsing storage may be disabled.
     }
     await restorePendingCheckout();
     authUI();queueSync();void refresh();
   }catch(_){
     // Fail closed: no payment if a verified account or saved cart is unavailable.
     cloudSynced=false;pendingChecked=false;
     $('cart-sync').textContent='لا يمكن التحقق من حسابك أو حفظ السلة الآن. حدّث الصفحة.';
     $('cart-sync').dataset.state='error';
     updateCheckoutButton();
   }
 }


 // Show only a session belonging to the signed-in account.
 // The order's confidential receipt token is intentionally not disclosed across devices.
 function showOwnedPending(pending){
   if(!UUID.test(pending.orderId||''))return;
   paymentOpen=true;pendingChecked=true;
   currentOrder=pending.orderId;
   try{accessToken=sessionStorage.getItem('blofy.shop.order.'+currentOrder)||null;}
   catch(_){accessToken=null;}
   $('started').hidden=false;
   $('order-number').textContent=pending.orderNumber||currentOrder;
   $('check-pending').href=accessToken?
     '/store/orders#order='+encodeURIComponent(currentOrder):'/store/account';
   $('copy-private-link').hidden=!accessToken;
   const until=Date.parse(pending.sessionExpiresAt||'');
   const paymentUrl=UUID.test(pending.sessionId||'')&&Number.isFinite(until)&&
     until>Date.now()+15000?hostedPaymentUrl(pending.sessionId):null;
   if(paymentUrl){
     $('open-geidea').href=paymentUrl;$('open-geidea').hidden=false;
     $('pending-status').textContent='هذا طلبك السابق لنفس السلة، افتح نفس جلسة Geidea بدل إنشاء فاتورة ثانية.';
   }else{
     $('open-geidea').hidden=true;
     $('pending-status').textContent='طلبك السابق قيد التحقق، لكن مهلة جلسة الدفع انتهت. راجع الطلب في حسابك قبل محاولة جديدة.';
   }
   updateCheckoutButton();
 }
 async function checkPendingForCart(){
   if(!signedIn||!cloudSynced||checkingPending)return;
   if(!items.length){pendingChecked=true;updateCheckoutButton();return;}
   checkingPending=true;pendingChecked=false;
   const snapshot=cartSnapshot();updateCheckoutButton();
   try{
     const data=await request('/api/v1/store/cart/pending',body());
     if(snapshot!==cartSnapshot())return;
     pendingChecked=true;
     if(data.pending)showOwnedPending(data);
     else if(!paymentOpen){
       $('pending-status').textContent='';
       $('started').hidden=true;
     }
     updateCheckoutButton();
   }catch(_){
     if(snapshot===cartSnapshot()){
       pendingChecked=false;
       $('cart-sync').textContent='تعذر فحص طلبات الدفع السابقة. أعد التحقق من السلة قبل بدء أي دفع.';
       $('cart-sync').dataset.state='error';
       $('retry-pending').hidden=false;
       updateCheckoutButton();
     }
   }finally{
     checkingPending=false;
     if(snapshot!==cartSnapshot()&&cloudSynced)void checkPendingForCart();
   }
 }

 async function restorePendingCheckout(){
   let pending;
   try{pending=JSON.parse(sessionStorage.getItem(pendingKey)||'null');}catch{return;}
   if(!pending||!UUID.test(pending.orderId||'')||!UUID.test(pending.sessionId||'')||
     pending.accountId!==accountId)return;
   // A past checkout from a different basket must not freeze a new basket.
   // The current basket is separately checked with the server before payment.
   if(pending.cartSnapshot&&pending.cartSnapshot!==cartSnapshot())return;
   const token=sessionStorage.getItem('blofy.shop.order.'+pending.orderId);
   if(!/^[a-zA-Z0-9_-]{42,44}$/.test(token||''))return;
   // Block creation of another Geidea session while checking the older one.
   paymentOpen=true;
   currentOrder=pending.orderId;accessToken=token;
   $('started').hidden=false;
   $('order-number').textContent=pending.orderNumber||pending.orderId;
   $('check-pending').href='/store/orders#order='+encodeURIComponent(pending.orderId);
   $('open-geidea').hidden=true;
   $('pending-status').textContent='جارٍ مراجعة حالة طلبك السابق لدى مزود الدفع...';
   updateCheckoutButton();
   try{
     const status=await request('/api/v1/store/orders/status',{orderId:pending.orderId,accessToken:token});
     if(status.status==='paid'){
       sessionStorage.removeItem(pendingKey);
       $('pending-status').textContent='الطلب مدفوع، افتح تفاصيل طلبك لرؤية الأكواد.';
       location.assign('/store/orders#order='+encodeURIComponent(pending.orderId));
       return;
     }
     if(status.status==='failed'||status.status==='cancelled'){
       sessionStorage.removeItem(pendingKey);
       currentOrder=null;accessToken=null;paymentOpen=false;
       $('started').hidden=true;
       updateCheckoutButton();
       return;
     }
     // An expired Geidea session cannot be relaunched. Do not silently create
     // a new order while provider settlement may still be in flight.
     const valid=Number.isFinite(pending.expiresAt)&&Date.now()<pending.expiresAt;
     const paymentUrl=valid?hostedPaymentUrl(pending.sessionId):null;
     if(paymentUrl){
       $('open-geidea').href=paymentUrl;
       $('open-geidea').hidden=false;
       $('pending-status').textContent='طلبك السابق لا يزال قيد التحقق. تقدر تكمل الدفع على نفس الجلسة أو تراجع حالة الطلب، من دون إنشاء طلب جديد.';
     }else{
       $('open-geidea').hidden=true;
       $('pending-status').textContent='انتهت مهلة جلسة الدفع السابقة، لكن حالة الطلب ما زالت قيد التحقق. افتح تفاصيل الطلب أو تواصل مع الدعم قبل أي عملية جديدة.';
     }
   }catch(_){
     $('pending-status').textContent='تعذر التأكد من حالة الطلب السابق. لم ننشئ طلبًا آخر؛ افتح تفاصيل الطلب أو تواصل مع الدعم.';
   }
   updateCheckoutButton();
 }

 let requestSerial=0;
 async function refresh(){
   const serial=++requestSerial;
   resetPrice();render();
   if(!items.length){message('اختر اشتراكاتك من المتجر ثم ارجع إلى السلة.');return;}
   message('جارٍ حساب السعر النهائي من خادم BLOFY...');
   try{
     const data=await request('/api/v1/store/cart/quote',body());
     if(serial!==requestSerial)return;
     quoted=data;
     $('subtotal').textContent=money(data.subtotalMinor);$('discount').textContent=money(data.discountMinor);
     $('total').textContent=money(data.totalMinor);$('codes-count').textContent=String(data.codeCount);
     render(data.items);
     updateCheckoutButton();
     message(!ready?'الدفع غير متاح حاليًا. تواصل مع الدعم.':
       !signedIn?'السلة جاهزة. سجّل دخولك بالبريد قبل الدفع، وستبقى المنتجات محفوظة.':
       !cloudSynced?'جارٍ حفظ السلة في حسابك. لن يبدأ الدفع حتى يكتمل الحفظ.':
       'ممتاز! سلتك محفوظة بحسابك. تأكد من السعر ثم أكمل عملية الدفع الواحدة.');
   }catch(err){
     if(serial!==requestSerial)return;
     message('تعذر حساب السعر أو الكوبون: '+err.message+'. لم يتم بدء أي عملية دفع.');
   }
 }
 async function checkout(){
   if(!signedIn){location.assign('/store/account?next=%2Fstore%2Fcart');return;}
   if(!cloudSynced){message('سلتك لم تُحفظ بعد في الحساب. تأكد من اتصالك قبل الدفع.');return;}
   if(!ready||creating||paymentOpen||!pendingChecked||!quoted||!items.length)return;
   creating=true;$('checkout').disabled=true;message('جارٍ تجهيز طلبك...');
   try{
     const payload=body();
     const data=await request('/api/v1/store/cart/checkout',payload);
     if(data.provider!=='geidea'||(data.checkoutMode!=='modal'&&data.checkoutMode!=='redirect')||
       data.sku!=='cart'||!UUID.test(data.orderId||'')||
       !/^[a-zA-Z0-9_-]{42,44}$/.test(data.accessToken||'')||
       !UUID.test(data.sessionId||'')||data.priceMinor!==quoted.totalMinor||
       data.currency!=='SAR')throw Error('checkout_quote_mismatch');
     const paymentUrl=hostedPaymentUrl(data.sessionId);
     if(!paymentUrl)throw Error('checkout_session_invalid');
     currentOrder=data.orderId;accessToken=data.accessToken;
     try{
       sessionStorage.setItem('blofy.shop.order.'+currentOrder,accessToken);
       sessionStorage.setItem('blofy.shop.last-order',currentOrder);
       sessionStorage.setItem('blofy.shop.cart.checkout.'+currentOrder,JSON.stringify(items));
       sessionStorage.setItem(pendingKey,JSON.stringify({
         orderId:data.orderId,orderNumber:data.orderNumber,sessionId:data.sessionId,
         accountId,cartSnapshot:cartSnapshot(),createdAt:Date.now(),
         expiresAt:Date.parse(data.sessionExpiresAt)||Date.now()+12*60*1000
       }));
     }catch(_){}
     $('started').hidden=false;$('order-number').textContent=data.orderNumber;
     const paymentLink=$('open-geidea');
     paymentLink.href=paymentUrl;paymentLink.hidden=false;
     paymentOpen=true;
     $('pending-status').textContent='إذا رجعت من صفحة الدفع، تقدر تكمل نفس الطلب أو تتحقق من حالته دون إنشاء طلب جديد.';
     $('check-pending').href='/store/orders#order='+encodeURIComponent(currentOrder);
     message('تم تجهيز طلبك '+data.orderNumber+'. جارٍ فتح صفحة الدفع الرسمية لدى Geidea. إذا لم تنتقل تلقائيًا، اضغط «فتح بوابة الدفع» في الأسفل.');
     window.BLOFYAnalytics?.track('checkout_started');
     // Same-tab navigation preserves sessionStorage for order recovery on return.
     // Geidea is the only origin receiving the session ID; no card data touches BLOFY.
     try{location.assign(paymentUrl);}catch(_){
       message('تم إنشاء الطلب، لكن المتصفح منع الانتقال. استخدم زر «فتح بوابة الدفع» أدناه لنفس الطلب دون إعادة إنشائه.');
     }
   }catch(err){
     // Even a network/JSON error may occur AFTER the server created a Geidea
     // session, so never assume a failed response means no payment session.
     const indeterminate=!['store_geidea_session_unavailable',
       'store_geidea_session_invalid','store_invalid_cart','store_invalid_coupon',
       'store_coupon_unavailable','store_coupon_limit_reached','rate_limited',
       'customer_login_required','store_checkout_disabled'].includes(err.message);
     if(indeterminate){
       try{
         const previous=await request('/api/v1/store/cart/pending',body());
         if(previous.pending){
           showOwnedPending(previous);
           message('استرجعنا طلب الدفع السابق من حسابك. استخدم جلسة Geidea نفسها، بدون إنشاء فاتورة جديدة.');
           return;
         }
         if(err.message==='store_pending_checkout_exists'){
           // Race between server finalization and the recovery read. Ask the
           // customer to verify their order, rather than guessing settlement.
           paymentOpen=true;pendingChecked=false;
           $('started').hidden=false;
           $('check-pending').href='/store/account';
           $('open-geidea').hidden=true;
           $('pending-status').textContent='لا يمكن تأكيد حالة الطلب السابق الآن. راجع حسابك قبل بدء دفع جديد.';
         }else{
           pendingChecked=false;
           $('retry-pending').hidden=false;
           message('تعذر إكمال الطلب. تحقّق من الطلبات السابقة بالزر أدناه قبل إعادة الدفع.');
         }
       }catch(_){
         // Fail closed if the request might have succeeded but recovery is
         // unavailable; a retry can otherwise charge twice.
         pendingChecked=false;
         $('retry-pending').hidden=false;
         message('انقطع الاتصال أثناء تجهيز الدفع. لم ننشئ طلبًا ثانيًا؛ أعد فحص الطلبات السابقة قبل المحاولة.');
       }
     }else{
       message('تعذر بدء الدفع: '+err.message+'. لم يتم تأكيد أي خصم، ويمكنك المحاولة بعد مراجعة السلة.');
     }
   }finally{creating=false;updateCheckoutButton();}
 }
 function privateLink(){
   if(!currentOrder||!accessToken)return null;
   return location.origin+'/store/orders#order='+currentOrder+'&token='+encodeURIComponent(accessToken);
 }
 $('copy-private-link').addEventListener('click',async()=>{
   const value=privateLink();if(!value)return;
   try{await navigator.clipboard.writeText(value);message('تم نسخ رابط الطلب الخاص. لا تشاركه مع أحد.');}
   catch{message('تعذر النسخ التلقائي. احتفظ برقم طلبك وتواصل مع الدعم عند الحاجة.');}
 });
 $('retry-pending').addEventListener('click',()=>{
   $('retry-pending').hidden=true;void checkPendingForCart();
 });
 $('retry-cart-sync').addEventListener('click',()=>{
   const button=$('retry-cart-sync');
   button.hidden=true;
   if(button.dataset.reload==='yes'){
     // Never overwrite an edit saved by another device with a stale revision.
     location.reload();
     return;
   }
   if(!signedIn||cloudRevision===null||cloudSyncing)return;
   cloudSynced=false;pendingChecked=false;
   authUI();void syncCloud();
 });
 $('checkout').addEventListener('click',()=>void checkout());
 $('clear-cart').addEventListener('click',()=>{
   if(!confirm('تبغى تفرغ سلة مشترياتك؟'))return;
   items=[];save();void refresh();
 });
 $('coupon').addEventListener('input',function(){
   this.value=this.value.toUpperCase().replace(/[^A-Z0-9_-]/g,'').slice(0,20);
   resetPrice();
 });
 $('apply').addEventListener('click',()=>{queueSync();void refresh();});
 items=restore();addFromURL();render();
 void initAccount();
 fetch('/api/v1/store/products',{cache:'no-store',headers:{accept:'application/json'}})
   .then(r=>r.ok?r.json():Promise.reject(Error('catalog_unavailable')))
   .then(data=>{ready=data.checkoutAvailable===true;void refresh();})
   .catch(()=>message('تعذر التحقق من خدمة الدفع حاليًا. لن تُحصّل أي مبالغ.'));
})();
