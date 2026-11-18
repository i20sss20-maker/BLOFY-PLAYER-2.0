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
reload().catch(e=>status('تعذر تحميل المخزون: '+e.message));
})();