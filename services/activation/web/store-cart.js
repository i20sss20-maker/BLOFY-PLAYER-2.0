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
   try{localStorage.setItem(storageKey,JSON.stringify(items));return true;}
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
     if(same&&same.quantity<3&&totalCodes(items)+(sku==='bundle-2y'?2:1)<=6)same.quantity++;
     else if(!same&&items.length<5&&totalCodes(items)+(sku==='bundle-2y'?2:1)<=6)items.push(line);
     else message('بلغت الحد الأعلى للسلة، 6 أكواد في الطلب الواحد.');
     save();
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
     $('checkout').disabled=!ready||creating;
     message(ready?'السلة جاهزة. تأكد من المنتجات والسعر ثم أكمل الدفع.':'الدفع غير متاح حاليًا. تواصل مع الدعم.');
   }catch(err){
     if(serial!==requestSerial)return;
     message('تعذر حساب السعر أو الكوبون: '+err.message+'. لم يتم بدء أي عملية دفع.');
   }
 }
 async function checkout(){
   if(!ready||creating||paymentOpen||!quoted||!items.length)return;
   if(typeof window.GeideaCheckout!=='function'){
     message('نافذة الدفع غير متاحة حاليًا. حدّث الصفحة أو تواصل مع الدعم.');return;
   }
   creating=true;$('checkout').disabled=true;message('جارٍ تجهيز طلبك...');
   try{
     const payload=body();
     const data=await request('/api/v1/store/cart/checkout',payload);
     if(data.provider!=='geidea'||data.checkoutMode!=='modal'||
       data.sku!=='cart'||!UUID.test(data.orderId||'')||
       !/^[a-zA-Z0-9_-]{42,44}$/.test(data.accessToken||'')||
       !UUID.test(data.sessionId||'')||data.priceMinor!==quoted.totalMinor||
       data.currency!=='SAR')throw Error('checkout_quote_mismatch');
     currentOrder=data.orderId;accessToken=data.accessToken;
     try{
       sessionStorage.setItem('blofy.shop.order.'+currentOrder,accessToken);
       sessionStorage.setItem('blofy.shop.last-order',currentOrder);
     }catch(_){}
     $('started').hidden=false;$('order-number').textContent=data.orderNumber;
     message('رقم طلبك '+data.orderNumber+'. احفظ رابط الطلب الخاص ثم أكمل الدفع.');
     const widget=new window.GeideaCheckout(
       function(){location.assign('/store/orders#order='+encodeURIComponent(currentOrder));},
       function(){location.assign('/store/orders#order='+encodeURIComponent(currentOrder));},
       function(){location.assign('/store/orders#order='+encodeURIComponent(currentOrder));}
     );
     widget.startPayment(data.sessionId);
     paymentOpen=true;
     window.BLOFYAnalytics?.track('checkout_started');
   }catch(err){
     message('تعذر إكمال الدفع: '+err.message+'. إذا سبق إنشاء الطلب لا تعِد الدفع قبل التحقق من حالته.');
   }finally{creating=false;$('checkout').disabled=paymentOpen||!quoted||!ready;}
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
 $('checkout').addEventListener('click',()=>void checkout());
 $('clear-cart').addEventListener('click',()=>{
   if(!confirm('تبغى تفرغ سلة مشترياتك؟'))return;
   items=[];save();void refresh();
 });
 $('coupon').addEventListener('input',function(){
   this.value=this.value.toUpperCase().replace(/[^A-Z0-9_-]/g,'').slice(0,20);
   resetPrice();
 });
 $('apply').addEventListener('click',()=>void refresh());
 items=restore();addFromURL();render();
 fetch('/api/v1/store/products',{cache:'no-store',headers:{accept:'application/json'}})
   .then(r=>r.ok?r.json():Promise.reject(Error('catalog_unavailable')))
   .then(data=>{ready=data.checkoutAvailable===true;void refresh();})
   .catch(()=>message('تعذر التحقق من خدمة الدفع حاليًا. لن تُحصّل أي مبالغ.'));
})();
