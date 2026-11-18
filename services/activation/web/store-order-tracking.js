'use strict';
(function(){
 const $=id=>document.getElementById(id),uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 const tokenRe=/^[a-zA-Z0-9_-]{42,44}$/;
 const money=n=>(Number(n)/100).toLocaleString('ar-SA')+' ر.س';
 let currentId='',currentToken='',busy=false;
 function txt(s){$('order-message').textContent=s;}
 function make(tag,className,text){
   const node=document.createElement(tag);if(className)node.className=className;
   if(text!==undefined)node.textContent=text;return node;
 }
 function valueFromHash(){
   const h=location.hash.startsWith('#')?location.hash.slice(1):'';
   const args=new URLSearchParams(h),id=args.get('order')||args.get('store_order')||'';
   if(!uuid.test(id))return;
   let secret=args.get('token')||'';
   if(!secret){
     try{secret=sessionStorage.getItem('blofy.shop.order.'+id)||
       sessionStorage.getItem('blofy.store.'+id)||
       sessionStorage.getItem('blofy.bundle.'+id)||'';}catch(_){}
   }
   $('order-id').value=id;$('access-token').value=secret;
   // Do not leave bearer secrets exposed in browser history/address bar.
   try{history.replaceState(null,'','/store/orders');}catch(_){}
   if(tokenRe.test(secret))void track();
   else txt('لقينا معرّف الطلب، لكن نحتاج مفتاح الوصول الخاص من رابط الطلب لعرض تفاصيله.');
 }
 async function track(){
   const id=$('order-id').value.trim(),secret=$('access-token').value.trim();
   if(!uuid.test(id)||!tokenRe.test(secret)){
     txt('أدخل معرّف الطلب ومفتاح الوصول الصحيحين، أو افتح رابط الطلب الخاص.');return;
   }
   if(busy)return;
   currentId=id;currentToken=secret;busy=true;$('track').disabled=true;
   txt('جارٍ التحقق من حالة طلبك...');
   try{
     const response=await fetch('/api/v1/store/orders/status',{method:'POST',cache:'no-store',
       credentials:'same-origin',headers:{'content-type':'application/json',accept:'application/json'},
       body:JSON.stringify({orderId:id,accessToken:secret})});
     const data=await response.json().catch(()=>({}));
     if(!response.ok)throw Error(data.error||'status_unavailable');
     render(data);txt(data.fulfilled?'تم التحقق من الطلب وتسليم أكواده.':'اطلع على حالة الطلب أدناه. إذا كان الدفع قيد التحقق فلا تعِد الدفع.');
     try{
       sessionStorage.setItem('blofy.shop.order.'+id,secret);
       sessionStorage.setItem('blofy.shop.last-order',id);
     }catch(_){}
   }catch(err){$('receipt').hidden=true;txt('تعذر استرجاع الطلب: '+err.message+'. تحقق من بيانات الوصول أو تواصل مع الدعم.');}
   finally{busy=false;$('track').disabled=false;}
 }
 function render(order){
   $('receipt').hidden=false;
   $('order-number').textContent=order.orderNumber||order.orderId||currentId;
   const statuses={pending:'قيد التحقق من الدفع',paid:'مدفوع',failed:'فشل الدفع',cancelled:'أُلغي الطلب'};
   $('order-status').textContent=statuses[order.status]||'قيد المراجعة';
   $('amount').textContent=Number.isFinite(Number(order.amountMinor))?money(order.amountMinor):'غير متاح';
   $('created').textContent=order.createdAt?new Date(order.createdAt).toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'}):'—';
   const list=$('receipt-products'),codes=$('codes');list.replaceChildren();codes.replaceChildren();
   if(Array.isArray(order.items))order.items.forEach(item=>{
     const label=make('div','receipt-line',item.name+' × '+item.quantity+' — '+money(item.lineTotalMinor));
     list.append(label);
   });
   if(!order.fulfilled){
     $('receipt-note').textContent=order.status==='pending'
       ?'لم نتأكد من الدفع بعد. لا تعِد الطلب؛ استخدم «تحديث حالة الطلب» للمتابعة.'
       :'إذا خُصم المبلغ ولم تحصل على أكوادك، تواصل مع الدعم برقم الطلب وإثبات عملية الدفع.';
     return;
   }
   $('receipt-note').textContent='تم الدفع والتحقق من الطلب. احتفظ بالأكواد لنفسك؛ كل كود يتفعّل بشكل مستقل.';
   const delivered=Array.isArray(order.codes)?order.codes:
     order.code?[{code:order.code,sku:order.sku,channel:order.channel,durationDays:order.durationDays}]:[];
   delivered.forEach((item,i)=>{
     const card=make('div','code-card');
     const name=item.channel==='xtream'?'Xtream مع BLOFY PLAYER':'BLOFY STREAM';
     const heading=make('b','', 'الاشتراك '+(i+1)+' — '+name);
     const span=make('small','', 'المدة: '+(item.durationDays||365)+' يومًا من أول تفعيل');
     const code=make('code','',item.code);
     const copy=make('button','secondary','نسخ الكود');
     copy.type='button';
     copy.addEventListener('click',async()=>{
       try{await navigator.clipboard.writeText(item.code);copy.textContent='تم النسخ ✓';}
       catch{copy.textContent='تعذر النسخ';}
     });
     card.append(heading,span,code,copy);codes.append(card);
   });
 }
 function link(){
   const id=$('order-id').value.trim(),secret=$('access-token').value.trim();
   if(!uuid.test(id)||!tokenRe.test(secret))return null;
   return location.origin+'/store/orders#order='+encodeURIComponent(id)+'&token='+encodeURIComponent(secret);
 }
 $('copy-link').addEventListener('click',async()=>{
   const l=link();
   if(!l){txt('أدخل بيانات طلبك الصحيحة لنسخ الرابط.');return;}
   try{await navigator.clipboard.writeText(l);txt('تم نسخ رابط طلبك الخاص. لا تشاركه مع أي شخص.');}
   catch{txt('تعذر النسخ تلقائيًا.');}
 });
 $('track').addEventListener('click',()=>void track());
 $('check-again').addEventListener('click',()=>void track());
 $('show-token').addEventListener('change',function(){
   $('access-token').type=this.checked?'text':'password';
 });
 valueFromHash();
 if(!location.hash&&!$('order-id').value){
   try{
     const saved=sessionStorage.getItem('blofy.shop.last-order');
     if(uuid.test(saved||'')){
       $('order-id').value=saved;
       $('access-token').value=sessionStorage.getItem('blofy.shop.order.'+saved)||'';
       if($('access-token').value)void track();
     }
   }catch(_){}
 }
})();