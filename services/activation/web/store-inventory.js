'use strict';(function(){
const $=id=>document.getElementById(id);const buttons=[$('generate'),$('import')];let plans=[];
function status(msg){$('notice').textContent=msg;}
async function request(path,options={}){const res=await fetch(path,{credentials:'same-origin',cache:'no-store',headers:{accept:'application/json',...(options.method?{'content-type':'application/json'}:{})},...options});
const data=await res.json().catch(()=>({}));if(!res.ok)throw Error(data.error||'connection_failed');return data;}
function loading(value){buttons.forEach(b=>b.disabled=value);}
async function reload(){const data=await request('/api/v1/admin/store/inventory');plans=data.products||[];const totals=data.counts||[];
for(const el of document.querySelectorAll('select.sku')){let old=el.value;el.textContent='';for(const p of plans){let opt=document.createElement('option');opt.value=p.sku;opt.textContent=p.name+' — '+(p.priceMinor/100)+' ر.س';el.append(opt);}if(plans.some(p=>p.sku===old))el.value=old;}
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
reload().then(()=>reloadSales()).catch(e=>status('تعذر تحميل بيانات المتجر: '+e.message));
})();