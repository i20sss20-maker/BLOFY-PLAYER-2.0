'use strict';(function(){
const $=id=>document.getElementById(id);const buttons=[$('generate'),$('import')];let plans=[];
function status(msg){$('notice').textContent=msg;}
async function request(path,options={}){const res=await fetch(path,{credentials:'same-origin',cache:'no-store',headers:{accept:'application/json',...(options.method?{'content-type':'application/json'}:{})},...options});
const data=await res.json().catch(()=>({}));if(!res.ok)throw Error(data.error||'connection_failed');return data;}
function loading(value){buttons.forEach(b=>b.disabled=value);}
async function reload(){const data=await request('/api/v1/admin/store/inventory');plans=data.products||[];const totals=data.counts||[];
for(const el of document.querySelectorAll('select.sku')){let old=el.value;el.textContent='';for(const p of plans){let opt=document.createElement('option');opt.value=p.sku;opt.textContent=p.name+' — '+(p.priceMinor/100)+' ر.س';el.append(opt);}if(plans.some(p=>p.sku===old))el.value=old;}
const warnings=Array.isArray(data.lowStockAlerts)?data.lowStockAlerts:[];
const alert=$('stock-warning');alert.replaceChildren();
const strong=document.createElement('strong');
strong.textContent=warnings.length?'⚠ باقات تحتاج تعبئة المخزون':'✓ المخزون فوق حد التنبيه';
alert.append(strong);
if(warnings.length){
 const list=document.createElement('ul');
 for(const item of warnings){
  const li=document.createElement('li');
  li.textContent=String(item.name||item.sku)+' — '+Number(item.available||0)+' كود متبقٍ';
  list.append(li);
 }
 alert.append(list);
}else alert.append(document.createTextNode(' — لا توجد باقات أقل من 20 كودًا.'));
const grid=$('stats');grid.textContent='';for(const p of plans){const t=totals.find(q=>q.sku===p.sku)||{available:0,sold:0};const card=document.createElement('div');card.className='stat';const name=document.createElement('b');name.textContent=p.name;const qty=document.createElement('strong');qty.textContent=Number(t.available||0)+' كود';const sold=document.createElement('small');sold.textContent='تم البيع من المخزون: '+Number(t.sold||0);card.append(name,qty,sold);grid.append(card);}}
async function run(kind){const isGenerate=kind==='generate';const sku=$(isGenerate?'generate-sku':'import-sku').value;let body={sku};
if(isGenerate){body.quantity=Number($('quantity').value);if(!Number.isSafeInteger(body.quantity)||body.quantity<1||body.quantity>100){status('الكمية بين 1 و100.');return;}}
else{body.codes=$('bulk').value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);if(body.codes.length<1||body.codes.length>100){status('الصق من 1 إلى 100 كود، كود واحد لكل سطر.');return;}}
const how=isGenerate?'إصدار':'استيراد';if(!confirm('تأكيد '+how+' '+(isGenerate?body.quantity:body.codes.length)+' كود لباقة '+sku+'؟'))return;
loading(true);status('جارٍ التحقق من الطلب...');
try{const result=await request('/api/v1/admin/store/inventory/'+kind,{method:'POST',body:JSON.stringify(body)});status('تمت العملية: '+(result.generated||result.added||0)+' كود تمت إضافته للمخزون.');if(!isGenerate)$('bulk').value='';await reload();}
catch(e){status('تعذرت العملية ('+e.message+'). لم نعتمد أي كود غير مؤهل.');}
finally{loading(false);}}
$('generate').addEventListener('click',()=>void run('generate'));$('import').addEventListener('click',()=>void run('import'));
async function reloadSales(){
 const data=await request('/api/v1/admin/store/sales');
 const paid=(data.sales||[]).filter(x=>x.status==='paid');
 const allPaid=paid.reduce((a,x)=>a+Number(x.orders||0),0);
 const totalMinor=paid.reduce((a,x)=>a+Number(x.amount_minor||0),0);
 const bundles=paid.filter(x=>x.sku==='bundle-2y').reduce((a,x)=>a+Number(x.orders||0),0);
 const pending=(data.sales||[]).filter(x=>x.status==='pending').reduce((a,x)=>a+Number(x.orders||0),0);
 const cards=[['المبيعات المؤكدة',allPaid+' طلب'],['الإيراد المؤكد',(totalMinor/100).toLocaleString('ar-SA')+' ر.س'],['عروض الاشتراكين المباعة',bundles+' عرض'],['طلبات قيد الدفع',pending+' طلب'],['طلبات مدفوعة تحتاج متابعة',Number(data.fulfillmentIssues||0)+' طلب']];
 const root=$('sales-highlights');root.textContent='';
 cards.forEach(([label,value])=>{
   const el=document.createElement('div');el.className='stat';
   const heading=document.createElement('b');heading.textContent=label;
   const number=document.createElement('strong');number.textContent=value;
   el.append(heading,number);root.append(el);
 });
 const breakdown=$('sales-breakdown');breakdown.textContent='';
 const title=document.createElement('h3');title.textContent='تفصيل المبيعات المدفوعة حسب المنتج';breakdown.append(title);
 paid.forEach(row=>{
   const card=document.createElement('div');card.className='sales-row';
   const name=document.createElement('strong');name.textContent=row.sku==='bundle-2y'?'عرض اشتراكين سنويين':(plans.find(p=>p.sku===row.sku)?.name||row.sku);
   const count=document.createElement('span');count.textContent=row.orders+' طلب';
   const sum=document.createElement('span');sum.textContent=(Number(row.amount_minor)/100)+' ر.س';
   card.append(name,count,sum);breakdown.append(card);
 });
 const coupons=$('coupon-list');coupons.textContent='';
 if(!(data.coupons||[]).length){coupons.textContent='لا توجد كوبونات بعد.';}
 (data.coupons||[]).forEach(row=>{
   const line=document.createElement('div');line.className='coupon-row';
   const info=document.createElement('div');const name=document.createElement('b');name.textContent=row.code;
   const detail=document.createElement('small');detail.textContent=row.percent+'% خصم — '+row.paid_uses+'/'+row.max_uses+' طلب مدفوع';
   info.append(name,detail);line.append(info);
   if(row.active&&Date.parse(row.expires_at)>Date.now()){
     const disable=document.createElement('button');disable.type='button';disable.className='btn-coupon-disable';disable.textContent='تعطيل';
     disable.addEventListener('click',async function(){
       if(!confirm('تعطيل كوبون '+row.code+'؟'))return;
       disable.disabled=true;
       try{await request('/api/v1/admin/store/coupons/deactivate',{method:'POST',body:JSON.stringify({code:row.code})});
         $('sales-notice').textContent='تم تعطيل '+row.code;await reloadSales();
       }catch(e){$('sales-notice').textContent='فشل التعطيل: '+e.message;disable.disabled=false;}
     });line.append(disable);
   }else{const state=document.createElement('small');state.textContent='غير فعّال';line.append(state);}
   coupons.append(line);
 });
}
$('coupon-code').addEventListener('input',function(){this.value=this.value.toUpperCase().replace(/[^A-Z0-9_-]/g,'').slice(0,20);});
$('coupon-create').addEventListener('click',async function(){
 const body={code:$('coupon-code').value.trim().toUpperCase(),percent:Number($('coupon-percent').value),
   maxUses:Number($('coupon-max').value),validDays:Number($('coupon-days').value)};
 if(!/^[A-Z0-9][A-Z0-9_-]{3,19}$/.test(body.code)||body.percent<1||body.percent>30||body.maxUses<1||body.validDays<1){
   $('sales-notice').textContent='تحقق من الكود ونسبة الخصم والمدة والعدد.';return;
 }
 if(!confirm('تأكيد إنشاء الكوبون '+body.code+' بنسبة '+body.percent+'%؟'))return;
 this.disabled=true;
 try{await request('/api/v1/admin/store/coupons/create',{method:'POST',body:JSON.stringify(body)});
   $('sales-notice').textContent='تم إنشاء الكوبون: '+body.code;await reloadSales();
 }catch(e){$('sales-notice').textContent='تعذر إنشاء الكوبون: '+e.message;}
 finally{this.disabled=false;}
});
async function reloadOrders(){
 const filter=$('order-filter').value;
 const response=await fetch('/api/v1/admin/store/orders?status='+encodeURIComponent(filter),
   {cache:'no-store',credentials:'same-origin',headers:{accept:'application/json'}});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(data.error||'orders_unavailable');
 const root=$('admin-orders');root.replaceChildren();
 if(!data.orders?.length){root.textContent='ما توجد طلبات بهذه الحالة حاليًا.';return;}
 const statuses={paid:'مدفوع ✓',pending:'قيد الدفع',failed:'فشل الدفع',cancelled:'ملغي'};
 for(const order of data.orders){
   const article=document.createElement('article');article.className='order-card';
   const head=document.createElement('div');head.className='order-card-head';
   const id=document.createElement('strong');id.textContent=order.order_number;
   const state=document.createElement('span');state.textContent=statuses[order.status]||order.status;
   state.className='order-state '+order.status;head.append(id,state);
   const details=document.createElement('div');details.className='order-card-details';
   const desc=document.createElement('span');desc.textContent=order.sku==='cart'
     ?'سلة متعددة المنتجات':order.sku==='bundle-2y'?'عرض اشتراكين سنويين':
     (plans.find(p=>p.sku===order.sku)?.name||order.sku);
   const price=document.createElement('b');price.textContent=(Number(order.amount_minor)/100)+' ر.س';
   const date=document.createElement('small');date.textContent=new Date(order.created_at).toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'});
   details.append(desc,price,date);article.append(head,details);
   if(order.sku==='cart'&&Array.isArray(order.cart_items)){
     const breakdown=document.createElement('div');breakdown.className='order-breakdown';
     for(const line of order.cart_items){
       const text=document.createElement('span');text.textContent=(line.name||line.sku)+' × '+line.quantity;
       breakdown.append(text);
     }
     article.append(breakdown);
   }
   root.append(article);
 }
}
$('order-filter').addEventListener('change',()=>void reloadOrders().catch(err=>{status('فشل تحميل الطلبات: '+err.message);}));
$('order-refresh').addEventListener('click',()=>void reloadOrders().catch(err=>{status('فشل تحميل الطلبات: '+err.message);}));


const brandingFields=['announcement','heroTitle','heroHighlight','heroDescription','heroImage','aboutTitle','aboutDescription','whatsapp','xHandle','theme'];
const brandingForm=$('branding-form'),brandingStatus=$('branding-status'),brandingSave=$('branding-save');
async function loadBranding(){
 const data=await request('/api/v1/admin/store/branding');
 if(!data.branding)throw Error('branding_missing');
 for(const key of brandingFields){
   const node=$('branding-'+key);
   if(node)node.value=String(data.branding[key]||'');
 }
 brandingStatus.textContent='✓ تم تحميل إعدادات الموقع الحالية.';
}
brandingForm?.addEventListener('submit',async event=>{
 event.preventDefault();if(brandingSave.disabled)return;
 const input={};
 for(const key of brandingFields)input[key]=$('branding-'+key).value.trim();
 brandingSave.disabled=true;brandingStatus.textContent='جارٍ حفظ تصميم الموقع...';
 try{
  const updated=await request('/api/v1/admin/store/branding',{
    method:'POST',body:JSON.stringify(input)
  });
  if(updated.ok!==true)throw Error('branding_save_unconfirmed');
  brandingStatus.textContent='✓ تم حفظ إعدادات المتجر. افتح الموقع في تبويب جديد لتظهر الألوان والبانر والنبذة.';
 }catch(e){brandingStatus.textContent='تعذر حفظ تصميم المتجر: '+e.message;}
 finally{brandingSave.disabled=false;}
});
void loadBranding().catch(e=>{brandingStatus.textContent='تعذر تحميل إعدادات الموقع: '+e.message;});

const showcaseNodes={
 form:$('showcase-form'),id:$('showcase-id'),name:$('showcase-name'),
 category:$('showcase-category'),description:$('showcase-description'),
 image:$('showcase-image'),sku:$('showcase-sku'),order:$('showcase-order'),
 active:$('showcase-active'),list:$('showcase-list'),notice:$('showcase-message'),
 save:$('showcase-save')
};
let showcaseProducts=[];
function resetShowcase(){
 showcaseNodes.form.reset();showcaseNodes.id.value='';
 showcaseNodes.order.value='0';showcaseNodes.category.value='المنتجات';
 $('showcase-form-title').textContent='إضافة منتج';
 showcaseNodes.save.textContent='حفظ المنتج';showcaseNodes.notice.textContent='';
}
function editShowcase(product){
 showcaseNodes.id.value=product.id;
 showcaseNodes.name.value=product.title;
 showcaseNodes.description.value=product.description||'';
 showcaseNodes.category.value=product.category||'المنتجات';
 showcaseNodes.image.value=product.imageUrl||'';
 showcaseNodes.sku.value=product.checkoutSku||'';
 showcaseNodes.order.value=String(product.sortOrder||0);
 showcaseNodes.active.checked=product.active===true;
 $('showcase-form-title').textContent='تعديل المنتج';
 showcaseNodes.save.textContent='حفظ التعديلات';
 showcaseNodes.form.scrollIntoView({behavior:'smooth',block:'start'});
}
async function loadShowcase(){
 const data=await request('/api/v1/admin/store/showcase');
 showcaseProducts=Array.isArray(data.products)?data.products:[];
 showcaseNodes.list.replaceChildren();
 if(!showcaseProducts.length){showcaseNodes.list.textContent='ما أضفت منتجات بعد. أضف أول منتج من النموذج.';return;}
 for(const product of showcaseProducts){
  const card=document.createElement('article');card.className='showcase-item';
  const info=document.createElement('div');info.className='showcase-item-info';
  const heading=document.createElement('strong');heading.textContent=product.title;
  const detail=document.createElement('small');
  detail.textContent=(product.active?'منشور':'مسودة')+' · '+product.category+
   ' · '+(product.checkoutSku?'بيع مرتبط بكود '+product.checkoutSku:'استفسار فقط');
  info.append(heading,detail);
  const actions=document.createElement('div');actions.className='showcase-item-actions';
  const edit=document.createElement('button');edit.type='button';edit.textContent='تعديل';edit.className='btn-outline';
  edit.addEventListener('click',()=>editShowcase(product));
  const archive=document.createElement('button');archive.type='button';archive.textContent='إخفاء';
  archive.disabled=!product.active;archive.className='btn-outline';
  archive.addEventListener('click',async()=>{
   if(!confirm('هل تريد إخفاء المنتج «'+product.title+'» من الموقع؟'))return;
   archive.disabled=true;showcaseNodes.notice.textContent='جارٍ إخفاء المنتج...';
   try{
    await request('/api/v1/admin/store/showcase/archive',{
     method:'POST',body:JSON.stringify({id:product.id})
    });
    showcaseNodes.notice.textContent='تم إخفاء المنتج.';await loadShowcase();
   }catch(e){archive.disabled=false;showcaseNodes.notice.textContent='تعذر إخفاء المنتج: '+e.message;}
  });
  actions.append(edit,archive);card.append(info,actions);showcaseNodes.list.append(card);
 }
}
showcaseNodes.form.addEventListener('submit',async event=>{
 event.preventDefault();if(showcaseNodes.save.disabled)return;
 const payload={
  id:showcaseNodes.id.value||null,title:showcaseNodes.name.value.trim(),
  description:showcaseNodes.description.value.trim(),
  category:showcaseNodes.category.value.trim(),
  imageUrl:showcaseNodes.image.value.trim(),checkoutSku:showcaseNodes.sku.value||null,
  sortOrder:Number(showcaseNodes.order.value),active:showcaseNodes.active.checked
 };
 if(!payload.title){showcaseNodes.notice.textContent='اكتب اسم المنتج أولًا.';return;}
 showcaseNodes.save.disabled=true;showcaseNodes.notice.textContent='جارٍ حفظ المنتج...';
 try{
  await request('/api/v1/admin/store/showcase/save',{
   method:'POST',body:JSON.stringify(payload)
  });
  resetShowcase();showcaseNodes.notice.textContent='تم حفظ المنتج.';
  await loadShowcase();
 }catch(e){showcaseNodes.notice.textContent='تعذر الحفظ: '+e.message;}
 finally{showcaseNodes.save.disabled=false;}
});
$('showcase-cancel').addEventListener('click',resetShowcase);
$('showcase-reload').addEventListener('click',()=>void loadShowcase().catch(e=>{
 showcaseNodes.notice.textContent='تعذر تحديث المنتجات: '+e.message;
}));
void loadShowcase().catch(e=>{showcaseNodes.notice.textContent='تعذر تحميل المنتجات: '+e.message;});

reload().then(()=>Promise.all([reloadSales(),reloadOrders()])).catch(e=>status('تعذر تحميل بيانات المتجر: '+e.message));
})();