'use strict';
(function(){
 const $=id=>document.getElementById(id);
 const number=n=>Number(n||0).toLocaleString('ar-SA');
 const currency=n=>(Number(n||0)/100).toLocaleString('ar-SA',{minimumFractionDigits:0,maximumFractionDigits:2})+' ر.س';
 const labels={
   '/':'الرئيسية','/shop':'المتجر','/products/stream':'اشتراك BLOFY STREAM',
   '/products/xtream':'اشتراك Xtream','/store/offers':'عرض الاشتراكين السنويين',
   '/store/trial':'صفحة التجربة','/store/about':'عن BLOFY','/store/faq':'الأسئلة الشائعة',
   '/store/contact':'التواصل','/store/terms':'الشروط','/guide':'دليل الاستخدام',
   '/support':'الدعم','/downloads':'التنزيلات','/releases':'الإصدارات',
   '/en':'الإنجليزية','/es':'الإسبانية','/fr':'الفرنسية'
 };
 const sourceLabels={
   direct:'زيارة مباشرة',google:'جوجل',bing:'بينغ',snapchat:'سناب شات',
   tiktok:'تيك توك',instagram:'إنستغرام',x:'منصة إكس',
   facebook:'فيسبوك',whatsapp:'واتساب',referral:'مواقع أخرى'
 };
 const deviceLabels={mobile:'الجوال',tablet:'جهاز لوحي',desktop:'كمبيوتر / شاشة كبيرة'};
 const eventLabels={
   page_view:'عرض صفحة',whatsapp_click:'ضغطات واتساب',
   trial_click:'طلب التجربة',offer_click:'فتح العرض',
   product_click:'زيارة منتج',checkout_click:'ضغط زر الشراء',
   checkout_started:'فتح جلسة دفع',coupon_check:'فحص كوبون',
   download_click:'زيارة صفحة التنزيلات'
 };
 function node(tag,className,txt){
   const el=document.createElement(tag);if(className)el.className=className;
   if(txt!==undefined)el.textContent=txt;return el;
 }
 function clear(id){const el=$(id);el.replaceChildren();return el;}
 function metric(label,value,sub){
   const card=node('div','metric'),title=node('span','',label),
      strong=node('strong','',value),small=node('small','',sub);
   card.append(title,strong,small);return card;
 }
 function showMetrics(data){
   const t=data.totals||{},container=clear('metrics');
   const ev=Object.fromEntries((data.events||[]).map(r=>[r.event,Number(r.hits||0)]));
   const cards=[
     ['الجلسات التقريبية',number(t.sessions),'من زوار وافقوا على القياس'],
     ['مشاهدات الصفحات',number(t.views),'جميع الصفحات التي زِيرت'],
     ['نشاط آخر 5 دقائق',number(t.activeLast5m),'جلسات أرسلت تفاعلًا حديثًا'],
     ['بدأوا جلسة دفع',number(ev.checkout_started),'تتبع بموافقة الزائر فقط'],
     ['طلبات مدفوعة',number(t.paidOrders),'من قاعدة طلبات المتجر'],
     ['إجمالي المبيعات',currency(t.revenueMinor),'طلبات دفع مؤكدة']
   ];
   cards.forEach(v=>container.append(metric(...v)));
 }
 function showTimeline(data){
   const rows=new Map((data.series||[]).map(r=>[r.day,{views:Number(r.views||0),sessions:Number(r.sessions||0)}]));
   const days=Number(data.days)||7;
   const root=clear('timeline');
   const now=new Date(Date.now()+3*3600000);
   const dates=[];
   for(let i=days-1;i>=0;i--){
     const date=new Date(now.getTime()-i*86400000).toISOString().slice(0,10);
     dates.push({day:date,...(rows.get(date)||{views:0,sessions:0})});
   }
   const maximum=Math.max(1,...dates.map(x=>x.views),...dates.map(x=>x.sessions));
   dates.forEach((d,i)=>{
     const day=node('div','day');day.title=d.day+': '+d.views+' مشاهدة و'+d.sessions+' جلسة';
     const bars=node('div','day-bars');
     const views=node('i','v');views.style.height=Math.max(2,Math.round(d.views/maximum*133))+'px';
     const sessions=node('i','s');sessions.style.height=Math.max(2,Math.round(d.sessions/maximum*133))+'px';
     const label=node('label','',days>30?(i%7===0?d.day.slice(5):''):d.day.slice(5));
     bars.append(views,sessions);day.append(bars,label);root.append(day);
   });
   if(!(data.totals?.views||data.totals?.sessions)){
     const notice=node('span','empty','لا توجد زيارات مسجلة بعد الموافقة على الإحصائيات خلال الفترة المختارة.');
     root.append(notice);
   }
 }
 function ranking(id,items,{name,value,maxItems=15}){
   const root=clear(id);
   if(!items?.length){root.append(node('div','empty','ما ظهرت بيانات لهذه الفترة حتى الآن.'));return;}
   const rows=items.slice(0,maxItems);
   const max=Math.max(1,...rows.map(x=>Number(x[value]||0)));
   for(const item of rows){
     const count=Number(item[value]||0);
     const wrap=node('div','rank-item'),text=node('div','rank-text');
     const title=node('strong','',name(item));
     const numberEl=node('span','',number(count));
     text.append(title,numberEl);
     const line=node('div','rank-bar');const fill=node('i');
     fill.style.width=Math.max(1,Math.round(count/max*100))+'%';line.append(fill);
     wrap.append(text,line);root.append(wrap);
   }
 }
 function showActivities(data){
   const root=clear('activity'),counts=new Map((data.events||[]).map(r=>[r.event,Number(r.hits||0)]));
   for(const key of ['offer_click','product_click','checkout_click','checkout_started',
     'whatsapp_click','trial_click','coupon_check','download_click']){
     root.append(metric(eventLabels[key],number(counts.get(key)||0),
       'تفاعل مسجّل بموافقة الزائر'));
   }
 }
 async function reload(){
   const button=$('refresh'),days=$('days').value;
   button.disabled=true;$('state').textContent='جارٍ قراءة بيانات الزوار والمبيعات...';
   try{
     const res=await fetch('/api/v1/admin/site-analytics/summary?days='+encodeURIComponent(days),{
       credentials:'same-origin',cache:'no-store',headers:{accept:'application/json'}
     });
     if(res.status===401){$('state').textContent='انتهت جلسة الإدارة. سجّل الدخول من صفحة الإدارة ثم حدّث الصفحة.';return;}
     const data=await res.json().catch(()=>({}));
     if(!res.ok||!data.ok)throw Error(data.error||'analytics_unavailable');
     showMetrics(data);showTimeline(data);
     ranking('sources',data.sources,{name:r=>sourceLabels[r.source]||r.source,value:'sessions'});
     ranking('campaigns',data.campaigns,{name:r=>(sourceLabels[r.source]||r.source)+' · '+r.campaign,value:'sessions'});
     ranking('pages',data.pages,{name:r=>labels[r.page]||r.page,value:'views'});
     ranking('devices',data.devices,{name:r=>deviceLabels[r.device]||r.device,value:'sessions'});
     showActivities(data);
     $('last-updated').textContent='آخر تحديث: '+new Date().toLocaleString('ar-SA',{timeZone:'Asia/Riyadh',hour:'2-digit',minute:'2-digit',day:'numeric',month:'short'});
     $('state').textContent='الإحصائيات تعمل؛ تُعرض الزيارات بموافقة الزائر فقط. التوقيت: الرياض.';
   }catch(err){
     $('state').textContent='تعذّر قراءة الإحصائيات الآن ('+err.message+'). حاول تحديث الأرقام.';
   }finally{button.disabled=false;}
 }
 $('days').addEventListener('change',()=>void reload());
 $('refresh').addEventListener('click',()=>void reload());
 document.querySelectorAll('[data-copy]').forEach(btn=>{
   btn.addEventListener('click',async()=>{
     try{await navigator.clipboard.writeText(btn.dataset.copy);btn.textContent='تم النسخ ✓';}
     catch{btn.textContent='حدّد الرابط وانسخه';}
   });
 });
 void reload();
})();