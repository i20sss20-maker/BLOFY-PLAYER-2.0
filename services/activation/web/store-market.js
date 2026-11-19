'use strict';
(function(){
 const $=id=>document.getElementById(id);
 const search=$('market-search'),searchForm=$('market-search-form');
 const safeText=(selector,value)=>{if(typeof value==='string'){const node=document.querySelector(selector);if(node)node.textContent=value;}};
 // One search covers fixed subscription cards AND admin-published products.
 // No remote customer search, no unsafe HTML; live filtering stays on this page.
 let filter='all',searchTimer=null;
 const reducedMotion=()=>{try{return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches===true;}catch(_){return false;}};
 const normalize=value=>String(value||'').normalize('NFKC').toLowerCase()
   .replace(/[ًٌٍَُِّْٰ]/g,'').replace(/[إأآٱ]/g,'ا')
   .replace(/ى/g,'ي').replace(/ـ/g,'').replace(/[^\p{L}\p{N}]+/gu,' ')
   .trim().replace(/\s+/g,' ');
 function products(){
   return [...document.querySelectorAll('article.product,article.managed-product')];
 }
 function kindOf(node){
   const sku=node.dataset.checkoutSku||node.dataset.productCard||'';
   if(sku==='stream'||sku.startsWith('stream-'))return 'stream';
   if(sku==='xtream'||sku.startsWith('xtream-'))return 'xtream';
   return 'other';
 }
 function searchMatches(node,query){
   if(!query)return true;
   let text=normalize(node.textContent);
   const kind=kindOf(node);
   if(kind==='stream')text+=' stream blofy streaming ستريم';
   if(kind==='xtream')text+=' xtream player اكستريم بلاير';
   return query.split(' ').every(token=>text.includes(token));
 }
 function filterProducts({scroll=false}={}){
   const query=normalize(search?.value);
   let matching=0,fixed=0,managed=0;
   for(const card of products()){
     const show=(filter==='all'||kindOf(card)===filter)&&searchMatches(card,query);
     card.hidden=!show;
     if(show){
       matching++;
       if(card.classList.contains('managed-product'))managed++;
       else fixed++;
     }
   }
   const collection=$('shop-managed-products');
   if(collection&&collection.querySelector('.managed-product'))
     collection.hidden=managed===0;
   for(const button of document.querySelectorAll('[data-market-filter]')){
     button.setAttribute('aria-pressed',String(button.dataset.marketFilter===filter));
   }
   const output=$('market-results-count');
   if(output)output.textContent=matching
      ?matching===1?'منتج واحد مطابق':'عدد المنتجات المطابقة: '+matching
      :'لا توجد منتجات مطابقة';
   const feedback=$('market-search-feedback');
   if(feedback){
     feedback.hidden=matching>0||(!query&&filter==='all');
     if(!feedback.hidden)feedback.textContent='ما لقينا منتجًا بهذا الاختيار. جرّب البحث عن «ستريم» أو «بلاير»، أو اضغط «كل الباقات».';
   }
   if(scroll){
     const destination=matching>0&&fixed===0&&managed>0?collection:$('products');
     destination?.scrollIntoView({behavior:reducedMotion()?'auto':'smooth',block:'start'});
   }
 }
 searchForm?.addEventListener('submit',event=>{
   event.preventDefault();filterProducts({scroll:true});
 });
 search?.addEventListener('input',()=>{
   if(searchTimer)clearTimeout(searchTimer);
   searchTimer=setTimeout(()=>filterProducts(),150);
 });
 for(const button of document.querySelectorAll('[data-market-filter]')){
   button.addEventListener('click',()=>{
     filter=button.dataset.marketFilter;
     filterProducts({scroll:false});
   });
 }
 document.addEventListener('blofy:showcase-ready',()=>filterProducts());
 if(new URLSearchParams(location.search).get('q')){
   const q=new URLSearchParams(location.search).get('q').slice(0,100);
   if(search){search.value=q;filterProducts();}
 }
 function updateCartCount(){
   try{
     const list=JSON.parse(localStorage.getItem('blofy.shop.cart.v1')||'[]');
     if(!Array.isArray(list))return;
     let count=0;
     for(const item of list){
       if(!item||!Number.isInteger(item.quantity)||item.quantity<1||item.quantity>3)continue;
       count+=item.quantity*(item.sku==='bundle-2y'?2:1);
     }
     for(const id of ['market-cart-count','market-mobile-cart-count']){
       const badge=$(id);
       if(badge){
         badge.hidden=count===0;
         badge.textContent=String(count);
         badge.setAttribute('aria-label','عدد الأكواد في السلة: '+count);
       }
     }
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
 function merchandising(config){
   if(!config||!Array.isArray(config.slides)||config.slides.length!==2)return;
   const slides=document.querySelectorAll('#blofy-banners [data-market-promo]');
   for(const slide of slides){
     const index=Number(slide.dataset.marketPromo),banner=config.slides[index];
     if(!banner)continue;
     const edit=(selector,value)=>{const el=slide.querySelector(selector);if(el&&typeof value==='string')el.textContent=value;};
     edit('[data-promo-title]',banner.title);
     edit('[data-promo-highlight]',banner.highlight);
     edit('[data-promo-description]',banner.description);
     edit('[data-promo-cta]',banner.cta);
     const picture=slide.querySelector('img.market-slide-media');
     if(picture&&typeof banner.imageUrl==='string'&&(
       /^\/store\/media\/(?:[a-z0-9-]+\.(?:jpg|svg))$/.test(banner.imageUrl)||
       banner.imageUrl.startsWith('https://')))picture.src=banner.imageUrl;
     const link=slide.querySelector('[data-promo-link]');
     if(link&&typeof banner.href==='string'&&banner.href.startsWith('/'))link.href=banner.href;
     slide.dataset.published=banner.active===false?'false':'true';
   }
   const selectors={
      categories:'#categories',offers:'#offer',featured:'#shop-managed-products',
      about:'#about-blofy',questions:'#questions'
   };
   for(const [key,selector] of Object.entries(selectors)){
      if(typeof config.sections?.[key]!=='boolean')continue;
      const node=document.querySelector(selector);
      if(!node)continue;
      if(key==='featured'){
        node.dataset.merchDisabled=config.sections[key]?'false':'true';
        // Keep the product section hidden until published products load.
        node.hidden=!config.sections[key]||!node.querySelector('.managed-product');
      }else node.hidden=!config.sections[key];
   }
   document.dispatchEvent(new Event('blofy:merchandising-ready'));
 }
 fetch('/api/v1/store/merchandising',{credentials:'same-origin',cache:'no-store',
   headers:{accept:'application/json'}})
   .then(async res=>{if(!res.ok)throw Error('merchandising_unavailable');return res.json();})
   .then(data=>merchandising(data.merchandising)).catch(()=>{});
 fetch('/api/v1/store/branding',{credentials:'same-origin',cache:'no-store',headers:{accept:'application/json'}})
   .then(async res=>{if(!res.ok)throw Error('unavailable');return res.json();})
   .then(data=>branding(data.branding)).catch(()=>{});
})();