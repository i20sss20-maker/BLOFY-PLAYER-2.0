'use strict';
(function(){
 const $=id=>document.getElementById(id);
 const search=$('market-search'),searchForm=$('market-search-form');
 const safeText=(selector,value)=>{if(typeof value==='string'){const node=document.querySelector(selector);if(node)node.textContent=value;}};
 let matches=null;
 function siteSearch(event){
   event?.preventDefault();
   const q=String(search?.value||'').trim().toLocaleLowerCase('ar');
   const cards=[...document.querySelectorAll('.product,[data-product-card],.managed-product')];
   const unique=[...new Set(cards)];
   let count=0;
   for(const node of unique){
     const keywords=String(node.textContent||'').toLocaleLowerCase('ar');
     const ok=!q||keywords.includes(q);
     node.hidden=!ok;
     if(ok)count++;
   }
   if(q&&count===0){
     const result=$('market-search-feedback');
     if(result){result.hidden=false;result.textContent='ما وجدنا نتيجة مطابقة. جرّب «ستريم» أو «إكستريم»، أو تواصل مع الدعم.';}
   }else if($('market-search-feedback'))$('market-search-feedback').hidden=true;
   location.hash='#products';
 }
 searchForm?.addEventListener('submit',siteSearch);
 search?.addEventListener('input',()=>{if(!search.value.trim()){for(const node of document.querySelectorAll('.product,.managed-product'))node.hidden=false;const out=$('market-search-feedback');if(out)out.hidden=true;}});
 function updateCartCount(){
   try{
     const list=JSON.parse(localStorage.getItem('blofy.shop.cart.v1')||'[]');
     if(!Array.isArray(list))return;
     let count=0;
     for(const item of list){
       if(!item||!Number.isInteger(item.quantity)||item.quantity<1||item.quantity>3)continue;
       count+=item.quantity*(item.sku==='bundle-2y'?2:1);
     }
     const badge=$('market-cart-count');
     if(badge){badge.hidden=count===0;badge.textContent=String(count);}
   }catch(_){}
 }
 updateCartCount();
 window.addEventListener('storage',updateCartCount);
 window.addEventListener('pageshow',updateCartCount);
 function branding(config){
   if(!config||typeof config!=='object')return;
   safeText('#market-announcement-text',config.announcement);
   for(const key of ['heroTitle','heroHighlight','heroDescription','aboutTitle','aboutDescription']){
     safeText('[data-market-content="'+key+'"]',config[key]);
   }
   if(typeof config.heroImage==='string'&&(
       /^\/store\/media\//.test(config.heroImage)||config.heroImage.startsWith('https://'))){
     const img=document.querySelector('#blofy-banners [data-slide] .market-slide-media');
     if(img)img.src=config.heroImage;
   }
   if(['violet','ocean','rose'].includes(config.theme))document.body.dataset.marketTheme=config.theme;
   if(typeof config.whatsapp==='string'&&/^9665\d{8}$/.test(config.whatsapp)){
     window.BLOFY_MARKET_WHATSAPP=config.whatsapp;
     const url='https://wa.me/'+config.whatsapp;
     const phone=$('market-footer-phone');
     if(phone){
       phone.href=url;
       phone.textContent='+'+config.whatsapp.slice(0,3)+' '+config.whatsapp.slice(3,5)+' '+config.whatsapp.slice(5,8)+' '+config.whatsapp.slice(8);
     }
     const head=$('market-header-contact');
     if(head){head.href=url;const b=head.querySelector('b');if(b)b.textContent='0'+config.whatsapp.slice(3,5)+' '+config.whatsapp.slice(5,8)+' '+config.whatsapp.slice(8);}
     document.querySelectorAll('.market-contact-band a,.market-footer-social a[href*="wa.me"]').forEach(a=>a.href=url);
     const floating=document.querySelector('.market-help-bubble');
     if(floating)floating.href=url+'?text='+encodeURIComponent('السلام عليكم، عندي استفسار عن اشتراكات BLOFY.');
   }
   if(typeof config.xHandle==='string'&&/^[a-zA-Z0-9_]{1,15}$/.test(config.xHandle)){
     document.querySelectorAll('.market-footer-social a[href*="x.com"]').forEach(a=>{a.href='https://x.com/'+config.xHandle;});
   }
 }
 fetch('/api/v1/store/branding',{credentials:'same-origin',cache:'no-store',headers:{accept:'application/json'}})
   .then(async res=>{if(!res.ok)throw Error('unavailable');return res.json();})
   .then(data=>branding(data.branding)).catch(()=>{});
})();