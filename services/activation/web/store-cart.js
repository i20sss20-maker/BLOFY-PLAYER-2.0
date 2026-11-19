'use strict';
(function(){
 const $=id=>document.getElementById(id);
 const storageKey='blofy.shop.cart.v1';
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 const title=sku=>({
   'stream-1m':'BLOFY STREAM — شهر','stream-3m':'BLOFY STREAM — 3 أشهر','stream-6m':'BLOFY STREAM — 6 أشهر',
   'stream-1y':'BLOFY STREAM — سنة','xtream-1m':'Xtream BLOFY — شهر','xtream-3m':'Xtream BLOFY — 3 أشهر',
   'xtream-6m':'Xtream BLOFY — 6 أشهر','xtream-1y':'Xtream BLOFY — سنة',
   'bundle-2y':'عرض اشتراكين سنويين',
   'trial-stream-1d':'تجربة BLOFY STREAM — يوم مجاني',
   'trial-xtream-1d':'تجربة Xtream — يوم مجاني'
 })[sku]||'اشتراك BLOFY';
 const money=n=>(Number(n)/100).toLocaleString('ar-SA',{minimumFractionDigits:0,maximumFractionDigits:2})+' ر.س';
 let items=[],quoted=null,ready=false,creating=false,paymentOpen=false,currentOrder=null,accessToken=null;
 let trialReady=false,trialAvailable=0,embeddedWidget=null,sdkPromise=null;
 let signedIn=false,accountEmail='',profileRequired=false,profileComplete=false,
   cloudRevision=null,cloudSynced=false,cloudSyncing=false,
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
 const trialSku=sku=>sku==='trial-stream-1d'||sku==='trial-xtream-1d';
 const trialLine=()=>items.find(x=>trialSku(x.sku))||null;
 const paidLines=()=>items.filter(x=>!trialSku(x.sku));
 const keyOf=item=>item.sku==='bundle-2y'?'bundle-2y:'+item.bundleSelection.join('+'):item.sku;
 function validLine(item){
   if(!item||typeof item!=='object')return false;
   if(!['stream-1m','stream-3m','stream-6m','stream-1y','xtream-1m','xtream-3m','xtream-6m','xtream-1y','bundle-2y',
     'trial-stream-1d','trial-xtream-1d'].includes(item.sku))return false;
   if(trialSku(item.sku))return item.quantity===1&&item.bundleSelection==null;
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
       if(trialSku(it.sku)&&out.some(x=>trialSku(x.sku)))continue;
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
     if(trialSku(sku)&&items.some(x=>trialSku(x.sku))){
       message('تقدر تختار تجربة مجانية واحدة فقط في السلة. احذف السابقة إذا تبي تغيّر النوع.');
     }else if(same&&!trialSku(sku)&&same.quantity<3&&totalCodes(items)+(sku==='bundle-2y'?2:1)<=6){
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
   $('cart-items-badge').textContent=String(totalCodes(items));
   $('mobile-checkout-dock').hidden=!items.length;
   if(!items.length){
     const empty=el('div','cart-empty');
     const glyph=el('span','cart-empty-icon','🛍️');
     const heading=el('h3','', 'سلتك فارغة');
     const hint=el('p','', 'اختر باقة من المتجر، وسنحتفظ بها هنا حتى تكمل طلبك.');
     const shop=el('a','primary','تصفح الاشتراكات');shop.href='/#products';
     empty.append(glyph,heading,hint,shop);root.append(empty);
     $('checkout').disabled=true;$('mobile-checkout').disabled=true;$('clear-cart').disabled=true;
   }else{
     $('clear-cart').disabled=false;
     for(const [i,item] of items.entries()){
       const row=el('article','item cart-product');
       const icon=el('span','item-symbol',item.sku==='bundle-2y'?'🎁':item.sku.startsWith('xtream')?'▶':'▣');
       icon.setAttribute('aria-hidden','true');
       const details=el('div','item-details');
       const badge=el('span','item-category',item.sku==='bundle-2y'?'عرض خاص':item.sku.startsWith('xtream')?'Xtream':'BLOFY STREAM');
       const heading=el('h3','',title(item.sku));
       const description=el('p','',trialSku(item.sku)?
         'تجربة مجانية لمدة 24 ساعة من أول تفعيل ناجح، كود واحد لكل حساب موثّق.':
         item.sku==='bundle-2y'
         ?'كودان مستقلان لمدة سنة: '+item.bundleSelection.map(x=>x==='app'?'ستريم':'إكستريم').join(' + ')
         :'كود اشتراك رقمي؛ تبدأ مدته عند أول تفعيل');
       const actions=el('div','item-actions');
       const quantity=el('div','quantity-picker');
       quantity.setAttribute('role','group');quantity.setAttribute('aria-label','كمية '+title(item.sku));
       const decrement=el('button','quantity-btn','−');decrement.type='button';decrement.setAttribute('aria-label','تقليل كمية '+title(item.sku));
       const count=el('span','quantity-value',String(item.quantity));
       const increment=el('button','quantity-btn','+');increment.type='button';increment.setAttribute('aria-label','زيادة كمية '+title(item.sku));
       const perCode=item.sku==='bundle-2y'?2:1;
       decrement.disabled=trialSku(item.sku)||item.quantity<=1;
       increment.disabled=trialSku(item.sku)||item.quantity>=3||totalCodes(items)+perCode>6;
       function changeQuantity(step){
         const next=item.quantity+step;
         if(trialSku(item.sku)||next<1||next>3||totalCodes(items)+step*perCode>6){
           message('الحد الأعلى 6 أكواد في الطلب الواحد.');return;
         }
         item.quantity=next;save();void refresh();
       }
       decrement.addEventListener('click',()=>changeQuantity(-1));
       increment.addEventListener('click',()=>changeQuantity(1));
       quantity.append(decrement,count,increment);
       const remove=el('button','remove-item','حذف');remove.type='button';
       remove.setAttribute('aria-label','حذف '+title(item.sku));
       remove.addEventListener('click',()=>{items.splice(i,1);save();void refresh();});
       actions.append(quantity,remove);
       const price=el('div','item-price');
       price.append(el('small','', 'إجمالي المنتج'),el('strong','',lines&&lines[i]?money(lines[i].lineTotalMinor):'جارٍ الحساب'));
       details.append(badge,heading,description,actions);
       row.append(icon,details,price);root.append(row);
     }
   }
   $('codes-count').textContent=String(totalCodes(items));
 }
 function resetPrice(){
   $('subtotal').textContent='—';$('discount').textContent='—';$('total').textContent='—';
   $('checkout').disabled=true;$('mobile-checkout').disabled=true;
   $('mobile-total').textContent='—';quoted=null;
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
   return {items:paidLines().map(x=>({sku:x.sku,quantity:x.quantity,
     ...(x.sku==='bundle-2y'?{bundleSelection:[...x.bundleSelection]}:{})})),
     ...(coupon?{couponCode:coupon}:{})};
 }

 function cleanItems(value){
   if(!Array.isArray(value))return [];
   const out=[],seen=new Set();
   for(const raw of value){
     if(!validLine(raw))continue;
     if(trialSku(raw.sku)&&out.some(x=>trialSku(x.sku)))continue;
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
   const button=$('checkout'),mobile=$('mobile-checkout');
   const needsProfile=signedIn&&profileRequired&&!profileComplete;
   const waiting=paymentOpen?'لديك طلب سابق — تحقق من حالته':
     !signedIn?'تأكيد البريد للمتابعة':
     needsProfile?'أكمل الاسم والجوال لاستلام الكود':
     !cloudSynced?'جارٍ حفظ السلة...':
     !pendingChecked?'جارٍ مراجعة الطلب السابق...':
     trialLine()?'استلام التجربة المجانية — 0 ر.س':
     'إكمال الطلب والدفع';
   const canProceed=trialLine()?trialReady:(ready&&paidLines().length>0);
   const enabled=items.length>0&&quoted!==null&&canProceed&&
      (!signedIn||needsProfile||cloudSynced&&pendingChecked&&!creating&&!paymentOpen);
   button.textContent=waiting;
   mobile.textContent=waiting;
   button.disabled=!enabled;
   mobile.disabled=!enabled;
   $('mobile-checkout-dock').hidden=!items.length;
 }
 function authUI(){
   const gate=$('auth-gate'),headline=$('auth-title'),label=$('auth-message'),link=$('auth-link');
   const needsProfile=signedIn&&profileRequired&&!profileComplete;
   gate.dataset.state=!signedIn?'login':needsProfile?'incomplete':'verified';
   headline.textContent=!signedIn?'تأكيد البريد قبل استلام طلبك':
     needsProfile?'بريدك موثّق ✓ — أكمل البيانات':'بريدك موثّق وبياناتك مكتملة ✓';
   label.textContent=!signedIn?
     'أرسل رمز الدخول إلى بريدك لتأكيد الطلب دون كلمة مرور أو الانتقال لصفحة أخرى.':
     needsProfile?'الحساب: '+accountEmail+' — أدخل اسمك ورقم الجوال هنا مرة واحدة، ثم استلم التجربة دون دفع.':
     'الحساب: '+accountEmail+' — طلباتك وأكوادك محفوظة عندنا.';
   $('checkout-auth-panel').hidden=signedIn;
   $('checkout-profile-panel').hidden=!needsProfile;
   $('trial-cart-recovery').hidden=!signedIn;
   link.hidden=signedIn;
   $('step-cart').classList?.toggle('complete',items.length>0);
   $('step-account').classList?.toggle('complete',signedIn&&!needsProfile);
   $('step-account').classList?.toggle('active',!signedIn||needsProfile);
   $('step-payment').classList?.toggle('active',signedIn&&!needsProfile);
   const indicator=$('cart-sync');
   indicator.textContent=!signedIn?'سنحفظ السلة في حسابك بعد تأكيد البريد.':
     cloudSynced?'✓ محفوظة في حسابك':'جارٍ حفظ السلة في حسابك…';
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
     profileRequired=data.profileRequired===true;
     profileComplete=data.profileComplete===true||!profileRequired;
     $('checkout-profile-name').value=String(data.fullName||'');
     $('checkout-profile-phone').value=String(data.phone||'');
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
     if($('coupon').value)$('coupon-details').open=true;
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
   if(!paidLines().length){pendingChecked=true;updateCheckoutButton();return;}
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
   message('جارٍ التحقق من السعر والمخزون من خادم BLOFY...');
   try{
     const paid=paidLines(),trial=trialLine();
     const data=paid.length?await request('/api/v1/store/cart/quote',body()):
       {subtotalMinor:0,discountMinor:0,totalMinor:0,codeCount:0,items:[]};
     let availability=null;
     if(trial){
       const response=await fetch('/api/v1/store/trials/availability',{
         credentials:'same-origin',cache:'no-store',headers:{accept:'application/json'}
       });
       if(!response.ok)throw Error('trial_stock_unavailable');
       availability=await response.json();
       const p=(availability.products||[]).find(x=>x.sku===trial.sku);
       if(p&&(p.priceMinor!==0||p.currency!=='SAR'||p.durationDays!==1))
         throw Error('trial_quote_invalid');
       trialAvailable=Math.max(0,Number(p?.available)||0);
       trialReady=availability.enabled===true&&trialAvailable>0;
     }else{trialReady=false;trialAvailable=0;}
     if(serial!==requestSerial)return;
     quoted=data;
     $('subtotal').textContent=money(data.subtotalMinor);$('discount').textContent=money(data.discountMinor);
     $('total').textContent=money(data.totalMinor);$('mobile-total').textContent=money(data.totalMinor);
     $('codes-count').textContent=String(data.codeCount+Number(Boolean(trial)));
     const priceLines=[];
     for(const item of items){
       if(trialSku(item.sku))priceLines.push({lineTotalMinor:0});
       else priceLines.push(data.items?.find(x=>x.sku===item.sku&&
          JSON.stringify(x.bundleSelection||null)===JSON.stringify(item.bundleSelection||null))||null);
     }
     render(priceLines);
     $('summary-heading').textContent=paid.length?'تفاصيل الدفع':'ملخص التجربة المجانية';
     $('step-payment-label').textContent=paid.length?'الدفع':'استلام الكود';
     $('payment-methods').hidden=!paid.length;
     $('payment-wallet-note').hidden=!paid.length;
     $('checkout-disclaimer').textContent=!paid.length?
       '✓ تجربة مجانية بدون بطاقة أو عملية دفع. يتم تخصيص الكود بعد تأكيد بريدك.':
       '🔒 الدفع للمنتجات المدفوعة فقط عبر Geidea؛ لا تُرسل بيانات البطاقة إلى BLOFY.';
     $('coupon-details').hidden=!paid.length;
     updateCheckoutButton();
     message(trial&&!trialReady?'التجربة غير متوفرة حاليًا في المخزون؛ يمكنك حذفها ومتابعة الباقات المدفوعة.':
       trial&&paid.length?'التجربة 0 ريال؛ استلم كود التجربة أولًا، ثم أكمل دفع الباقات الأخرى بشكل منفصل.':
       trial?'التجربة مجانية بالكامل. سجّل الدخول بالبريد لتستلم الكود من المخزون دون دفع.':
       !ready?'الدفع غير متاح حاليًا. تواصل مع الدعم.':
       !signedIn?'السلة جاهزة. سجّل دخولك بالبريد قبل الدفع، وستبقى المنتجات محفوظة.':
       !cloudSynced?'جارٍ حفظ السلة في حسابك. لن يبدأ الدفع حتى يكتمل الحفظ.':
       'ممتاز! سلتك محفوظة بحسابك. تأكد من السعر ثم أكمل عملية الدفع الواحدة.');
   }catch(err){
     if(serial!==requestSerial)return;
     message('تعذر حساب السعر أو الكوبون: '+err.message+'. لم يتم بدء أي عملية دفع.');
   }
 }
 // Geidea's supported Drop-in mode mounts the hosted payment form into
 // #checkout-tag. We do not embed an HPP URL ourselves or touch card fields.
 function ensureEmbeddedGeidea(){
   if(typeof window.GeideaCheckout==='function')return Promise.resolve(true);
   if(sdkPromise)return sdkPromise;
   sdkPromise=new Promise((resolve,reject)=>{
     const sdk=document.createElement('script');
     sdk.src='https://www.ksamerchant.geidea.net/hpp/geideaCheckout.min.js';
     sdk.async=true;sdk.referrerPolicy='no-referrer';
     let completed=false;let timer;
     function finish(error){
       if(completed)return;completed=true;clearTimeout(timer);
       if(error||typeof window.GeideaCheckout!=='function'){
         sdk.remove();reject(error||Error('sdk_not_ready'));return;
       }
       resolve(true);
     }
     sdk.addEventListener('load',()=>finish(null),{once:true});
     sdk.addEventListener('error',()=>finish(Error('sdk_network_failed')),{once:true});
     timer=setTimeout(()=>finish(Error('sdk_timeout')),11000);
     document.head.appendChild(sdk);
   }).catch(()=>{sdkPromise=null;return false;});
   return sdkPromise;
 }
 async function verifyEmbeddedOrder(orderId,token){
   // Never deliver paid codes based on Geidea's browser callback alone.
   try{
     const result=await request('/api/v1/store/orders/status',{
       orderId,accessToken:token
     });
     if(result.status==='paid'&&result.fulfilled===true){
       $('geidea-embedded-notice').textContent='✓ تأكد الدفع من الخادم. جارٍ فتح أكواد طلبك.';
       location.assign('/store/orders#order='+encodeURIComponent(orderId));
       return;
     }
     $('geidea-embedded-notice').textContent=
       'الدفع قيد التحقق أو لم يكتمل. لا تعِد الدفع؛ راجع حالة نفس الطلب.';
   }catch(_){
     $('geidea-embedded-notice').textContent=
       'تعذّر التحقق من نتيجة الدفع حاليًا. لم يُصدر كود جديد؛ استخدم مراجعة الطلب.';
   }
 }
 function mountEmbeddedGeidea(data){
   const panel=$('geidea-embedded-panel');
   panel.hidden=false;
   $('geidea-embedded-order').textContent=data.orderNumber||data.orderId;
   $('geidea-embedded-total').textContent=money(data.priceMinor);
   $('geidea-review-order').href='/store/orders#order='+encodeURIComponent(data.orderId);
   $('geidea-hosted-fallback').href=hostedPaymentUrl(data.sessionId);
   $('geidea-hosted-fallback').hidden=false;
   $('geidea-embedded-notice').textContent='تم إنشاء طلبك. يمكنك الدفع من الحقول المحمية هنا، أو فتح نفس جلسة الدفع في Geidea.';
   $('checkout-tag').replaceChildren();
   panel.scrollIntoView({behavior:'smooth',block:'start'});
   if(typeof window.GeideaCheckout!=='function'){
     $('geidea-embedded-notice').textContent='تعذّر تحميل نموذج البطاقة داخل الموقع. افتح نفس جلسة الدفع في Geidea؛ لن ننشئ طلبًا ثانيًا.';
     return;
   }
   try{
     embeddedWidget=new window.GeideaCheckout(
       ()=>{void verifyEmbeddedOrder(data.orderId,data.accessToken);},
       ()=>{$('geidea-embedded-notice').textContent='لم يكتمل الدفع أو ظهر خطأ. راجع حالة الطلب قبل إعادة المحاولة.';},
       ()=>{$('geidea-embedded-notice').textContent='تم إغلاق نموذج الدفع، راجع حالة الطلب قبل إعادة المحاولة.';}
     );
     embeddedWidget.startPayment(data.sessionId,null,'checkout-tag');
     $('geidea-embedded-notice').textContent='أكمل إدخال البطاقة في نموذج Geidea الآمن المضمّن داخل الصفحة.';
   }catch(_){
     $('checkout-tag').replaceChildren();
     $('geidea-embedded-notice').textContent='تعذّر عرض النموذج المضمّن؛ افتح نفس جلسة الدفع من الرابط، بدون إنشاء طلب جديد.';
   }
 }

 // Recover using the verified customer's existing session, never issue a second
 // voucher to resolve a failed response. This is also available in the cart.
 let recoveringTrial=false;
 function renderTrialInCart(trial,fromRecovery=false){
   if(!trial||typeof trial.code!=='string'||!['app','xtream'].includes(trial.channel))
     return false;
   $('trial-cart-code').textContent=trial.code;
   const previouslyOwned=fromRecovery||trial.alreadyClaimed===true;
   $('trial-cart-info').textContent=previouslyOwned?
     'هذا كود التجربة الموجود في حسابك سابقًا، ولن تُمنح تجربة ثانية.':
     'تم استلام كود مجاني واحد لحسابك، وتبدأ مدة اليوم من أول تفعيل ناجح.';
   const time=value=>new Date(value).toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'});
   $('trial-cart-dates').textContent=trial.expiresAt?
     'تم التفعيل '+(trial.activatedAt?'بتاريخ '+time(trial.activatedAt):'')+
       ' · تنتهي التجربة بتاريخ '+time(trial.expiresAt):
     'لم يُفعّل الكود بعد. ستبدأ مدة 24 ساعة بعد أول تفعيل ناجح، وسيظهر تاريخ الانتهاء بعد ذلك.';
   $('trial-cart-download').hidden=trial.channel!=='app';
   $('trial-cart-xtream').hidden=trial.channel!=='xtream';
   const guide=$('trial-cart-guide');
   guide.replaceChildren();
   const steps=trial.channel==='xtream'?
     ['انسخ الكود أعلاه.','افتح صفحة تفعيل واستخراج Xtream من الزر أدناه.',
      'أدخل الكود واستخرج رابط Host الكامل واسم المستخدم وكلمة المرور.',
      'أضف بيانات Xtream إلى BLOFY PLAYER أو مشغّل متوافق.']:
     ['انسخ الكود أعلاه.','نزّل تطبيق BLOFY STREAM من الرابط أدناه.',
      'افتح التطبيق وأدخل الكود التجريبي لتفعيله.','تبدأ مدة اليوم من أول تفعيل ناجح.'];
   for(const text of steps){const li=document.createElement('li');li.textContent=text;guide.append(li);}
   $('trial-cart-result').hidden=false;
   return true;
 }
 async function recoverExistingTrial({quiet=false}={}){
   if(!signedIn||recoveringTrial)return false;
   recoveringTrial=true;
   const button=$('trial-cart-recover');
   button.disabled=true;
   if(!quiet)$('trial-cart-recovery-status').textContent='جارٍ التحقق من كود التجربة المسلّم لهذا الحساب…';
   try{
     const response=await fetch('/api/v1/store/trials/mine',{
       credentials:'same-origin',cache:'no-store',headers:{accept:'application/json'}
     });
     const data=await response.json().catch(()=>({}));
     if(!response.ok)throw Error(data.error||'trial_recovery_unavailable');
     if(data.claimed&&renderTrialInCart(data.trial,true)){
       $('trial-cart-recovery-status').textContent='✓ تم استرجاع الكود السابق من حسابك بأمان، دون إصدار كود جديد.';
       $('trial-cart-result').scrollIntoView({behavior:'smooth',block:'nearest'});
       return true;
     }
     if(!quiet)$('trial-cart-recovery-status').textContent='لا توجد تجربة مسلّمة لهذا الحساب حتى الآن.';
     return false;
   }catch(error){
     if(!quiet)$('trial-cart-recovery-status').textContent=
       'تعذّر استرجاع التجربة: '+error.message+'. تحقق من اتصالك وحسابك.';
     return false;
   }finally{
     recoveringTrial=false;button.disabled=false;
   }
 }
 async function claimFreeTrialFromCart(){
   const trial=trialLine();
   if(!trial||!trialReady)return;
   creating=true;updateCheckoutButton();
   message('جارٍ تسليم التجربة المجانية إلى حسابك، دون استخدام بوابة الدفع…');
   try{
     const response=await fetch('/api/v1/store/trials/claim',{
       method:'POST',credentials:'same-origin',cache:'no-store',
       headers:{'content-type':'application/json','x-blofy-trial':'1',accept:'application/json'},
       body:JSON.stringify({sku:trial.sku})
     });
     const result=await response.json().catch(()=>({}));
     if(!response.ok||result.ok!==true||typeof result.code!=='string')
       throw Error(result?.error||'trial_claim_unavailable');
     // A one-trial-per-account claim may return a previously claimed code
     // for a different channel. Never treat that as a new STREAM/Xtream issue.
     const expectedChannel=trial.sku==='trial-stream-1d'?'app':'xtream';
     if(result.channel!==expectedChannel&&result.alreadyClaimed!==true)
       throw Error('trial_channel_mismatch');
     if(!renderTrialInCart(result,false))throw Error('trial_delivery_invalid');
     items=items.filter(item=>!trialSku(item.sku));
     save();await refresh();
     message(result.alreadyClaimed?
       '✓ استعدنا كود تجربتك السابقة. لا يمكن منح تجربة جديدة لهذا الحساب.':
       items.length?'✓ استلمت تجربتك المجانية. الباقات المدفوعة باقية في سلتك.':
       '✓ تم التسليم بسعر 0 ريال، دون دفع أو بطاقة.');
     $('trial-cart-result').scrollIntoView({behavior:'smooth',block:'nearest'});
   }catch(error){
     const explanations={
       trial_login_required:'يجب تأكيد بريدك الإلكتروني أولًا.',
       trial_profile_required:'بريدك موثّق، لكن الاسم ورقم الجوال مطلوبان قبل تسليم الكود.',
       trial_origin_invalid:'تعذّر التحقق من مصدر الطلب. حدّث صفحة BLOFY الرسمية.',
       trial_out_of_stock:'نفد مخزون التجربة؛ لم يتم خصم أي مبلغ.',
       trial_daily_quota_reached:'اكتملت حصة التجارب اليومية. لم يتم خصم أي مبلغ.',
       trial_rate_limited:'وصلت محاولات الطلب إلى الحد المسموح؛ لا تكرر الضغط.',
       trial_already_claimed:'لديك تجربة سابقة لهذا الحساب، يمكنك استرجاع كودها من السلة.',
       trials_unavailable:'خدمة التجارب غير متاحة على الخادم حاليًا.',
       trial_code_unavailable:'تعذّر عرض كودك المخزّن؛ تواصل مع الدعم.',
       trial_code_integrity_unavailable:'تعذّر التحقق من الكود المخزّن؛ تواصل مع الدعم.'
     };
     if(error.message==='trial_profile_required'){
       profileRequired=true;profileComplete=false;authUI();
       $('checkout-profile-panel').scrollIntoView({behavior:'smooth',block:'center'});
       $('checkout-profile-message').textContent=explanations.trial_profile_required;
       message('أكمل الاسم والجوال في نموذج بيانات العميل الظاهر هنا، ثم أعد الطلب.');
     }else{
       // Network, proxy, or timeout may occur AFTER the claim committed.
       // Read the existing claim first rather than issuing another voucher.
       const recovered=await recoverExistingTrial({quiet:true});
       if(recovered){
         items=items.filter(item=>!trialSku(item.sku));save();await refresh();
         message('✓ تم العثور على كود التجربة المسلّم لحسابك وعرضه هنا. لا تعِد الطلب.');
       }else{
         message(explanations[error.message]||
           'لم نتمكن من تأكيد التسليم. اضغط «استرجاع تجربتي» أسفل هذا الملخص للتحقق من حسابك دون إصدار طلب آخر.');
       }
     }
   }finally{creating=false;updateCheckoutButton();}
 }

 $('trial-cart-recover').addEventListener('click',()=>void recoverExistingTrial());
 $('trial-cart-copy').addEventListener('click',async()=>{
   const code=$('trial-cart-code').textContent;
   if(!code)return;
   try{await navigator.clipboard.writeText(code);message('تم نسخ كود التجربة.');}
   catch(_){message('حدد الكود الظاهر لنسخه يدويًا.');}
 });
 async function checkout(){
   if(!signedIn){
     $('auth-gate').scrollIntoView({behavior:'smooth',block:'center'});
     $('checkout-email').focus({preventScroll:true});
     message('أدخل بريدك واضغط «إرسال الرمز» لإكمال الطلب في نفس الصفحة.');
     return;
   }
   if(profileRequired&&!profileComplete){
     $('checkout-profile-panel').hidden=false;
     $('checkout-profile-panel').scrollIntoView({behavior:'smooth',block:'center'});
     $('checkout-profile-name').focus({preventScroll:true});
     message('أكمل الاسم ورقم الجوال من داخل السلة ثم استلم الكود هنا، بدون الانتقال لصفحة أخرى.');
     return;
   }
   if(!cloudSynced){message('سلتك لم تُحفظ بعد في الحساب. تأكد من اتصالك قبل الاستلام.');return;}
   if(creating||paymentOpen||!pendingChecked||!quoted||!items.length)return;
   if(trialLine()){await claimFreeTrialFromCart();return;}
   if(!ready||!paidLines().length)return;
   creating=true;$('checkout').disabled=true;message('جارٍ تجهيز طلبك...');
   try{
     const embeddedReady=await ensureEmbeddedGeidea();
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
     message(embeddedReady?
       'تم تجهيز طلبك '+data.orderNumber+'. أكمل الدفع داخل نموذج Geidea الآمن في نفس الصفحة.':
       'تم إنشاء طلبك '+data.orderNumber+'. نموذج Geidea المضمّن لم يُحمّل؛ استخدم رابط نفس الجلسة.');
     window.BLOFYAnalytics?.track('checkout_started');
     // Official drop-in: startPayment(sessionId, null, divId).
     // No navigation and no new session when the embedded SDK fails.
     mountEmbeddedGeidea(data);
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

 const profileErrors={
   invalid_customer_profile:'أدخل الاسم الكامل ورقم جوال سعودي صحيح مثل 05xxxxxxxx.',
   customer_phone_in_use:'هذا الجوال مسجّل في حساب BLOFY آخر. استخدم حسابك الأول أو تواصل مع الدعم.',
   rate_limited:'محاولات عديدة لحفظ الملف. حاول بعد قليل.',
   login_required:'انتهت جلسة البريد، سجّل دخولك من جديد.'
 };
 $('checkout-profile-form').addEventListener('submit',async event=>{
   event.preventDefault();
   if(!signedIn||profileComplete)return;
   const name=$('checkout-profile-name').value.trim().replace(/\s+/g,' ');
   const phone=$('checkout-profile-phone').value.trim();
   if(name.length<2||name.length>100||/[<>]/.test(name)||
      !/^(?:05\d{8}|5\d{8}|\+9665\d{8}|009665\d{8})$/.test(phone)){
     $('checkout-profile-message').textContent=profileErrors.invalid_customer_profile;
     return;
   }
   const button=$('checkout-profile-submit');button.disabled=true;
   $('checkout-profile-message').textContent='جارٍ حفظ بياناتك بشكل آمن في حساب BLOFY…';
   try{
     const result=await request('/api/v1/store/account/profile',{fullName:name,phone});
     if(result.ok!==true||result.profileComplete!==true)throw Error('profile_not_confirmed');
     profileComplete=true;profileRequired=true;
     $('checkout-profile-message').textContent='✓ تم توثيق بريدك وحفظ الاسم والجوال.';
     authUI();await refresh();
     message('✓ بياناتك مكتملة. يمكنك الآن الضغط على «استلام التجربة المجانية — 0 ريال».');
     $('checkout').scrollIntoView({behavior:'smooth',block:'nearest'});
   }catch(error){
     $('checkout-profile-message').textContent=profileErrors[error.message]||
       'تعذّر حفظ البيانات: '+error.message+'. راجع معلوماتك ولا تكرر الطلب حتى تتأكد.';
   }finally{button.disabled=false;}
 });
 const loginMessage=text=>{$('checkout-login-message').textContent=text;};
 const loginErrors={
   invalid_email:'تأكد من صحة البريد الإلكتروني.',
   rate_limited:'محاولات كثيرة. حاول بعد قليل.',
   customer_email_unavailable:'تعذر إرسال الرمز حاليًا. جرّب لاحقًا.',
   customer_email_key_invalid:'خدمة البريد تحتاج إصلاحًا من الإدارة.',
   customer_email_domain_unverified:'خدمة البريد تحتاج توثيقًا من الإدارة.',
   customer_email_sender_restricted:'خدمة البريد لا تسمح بالإرسال حاليًا.',
   login_code_incorrect:'الرمز غير صحيح أو منتهي. حاول مجددًا.',
   origin_forbidden:'أعد فتح السلة من نطاق BLOFY الرسمي.'
 };
 let loginBusy=false;
 $('checkout-login-form').addEventListener('submit',async event=>{
   event.preventDefault();if(loginBusy||signedIn)return;
   const email=$('checkout-email').value.trim().toLowerCase();
   if(!$('checkout-email').checkValidity()){$('checkout-email').reportValidity();return;}
   loginBusy=true;$('checkout-send-code').disabled=true;
   loginMessage('جارٍ إرسال رمز الدخول إلى بريدك...');
   try{
     await request('/api/v1/store/account/request-code',{email});
     $('checkout-verify-form').hidden=false;
     $('checkout-send-code').textContent='إعادة إرسال الرمز';
     loginMessage('إذا وصل الرمز، أدخله هنا لإكمال الشراء. إذا طلبته مجددًا انتظر دقيقة.');
     $('checkout-otp').focus();
   }catch(err){loginMessage(loginErrors[err.message]||'تعذر إرسال الرمز. راجع البريد وحاول لاحقًا.');}
   finally{loginBusy=false;$('checkout-send-code').disabled=false;}
 });
 $('checkout-otp').addEventListener('input',event=>{
   event.target.value=event.target.value.replace(/\D/g,'').slice(0,6);
 });
 $('checkout-verify-form').addEventListener('submit',async event=>{
   event.preventDefault();if(loginBusy||signedIn)return;
   const email=$('checkout-email').value.trim().toLowerCase(),code=$('checkout-otp').value.trim();
   if(!/^\d{6}$/.test(code)){loginMessage('أدخل الرمز المكوّن من ستة أرقام.');return;}
   loginBusy=true;$('checkout-verify-code').disabled=true;
   loginMessage('جارٍ تأكيد حسابك وحفظ السلة...');
   try{
     await request('/api/v1/store/account/verify-code',{email,code});
     loginMessage('تم تأكيد البريد، جارٍ تجهيز السلة.');
     await initAccount();
     $('order-summary').scrollIntoView({behavior:'smooth',block:'nearest'});
   }catch(err){loginMessage(loginErrors[err.message]||'تعذر التحقق من الرمز. جرّب مرة أخرى.');}
   finally{loginBusy=false;$('checkout-verify-code').disabled=false;}
 });
 $('mobile-checkout').addEventListener('click',()=>void checkout());
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
