'use strict';
(function(){
 const section=document.getElementById('shop-managed-products');
 const root=document.getElementById('shop-managed-grid');
 if(!section||!root)return;
 const el=(tag,cls,txt)=>{
  const element=document.createElement(tag);
  if(cls)element.className=cls;
  if(txt!=null)element.textContent=txt;
  return element;
 };
 const money=v=>(v/100).toLocaleString('ar-SA',{maximumFractionDigits:2})+' ر.س';
 const fallback=sku=>sku&&sku.startsWith('xtream')?'/store/media/player.jpg':
   sku==='bundle-2y'?'/store/media/bundle.svg':'/store/media/strong8k.jpg';
 fetch('/api/v1/store/showcase',{cache:'no-store',headers:{accept:'application/json'}})
  .then(async r=>{if(!r.ok)throw Error('showcase_unavailable');return r.json();})
  .then(data=>{
    if(!Array.isArray(data.products)||data.products.length===0)return;
    root.replaceChildren();
    for(const p of data.products){
      if(!p||typeof p.title!=='string'||typeof p.checkoutUrl!=='string')continue;
      const card=el('article','managed-product');
      if(typeof p.checkoutSku==='string')card.dataset.checkoutSku=p.checkoutSku;
      const art=el('a','managed-product-art');
      art.href=p.checkoutUrl;
      const img=el('img');img.loading='lazy';img.decoding='async';
      img.alt=p.title;img.src=p.imageUrl||fallback(p.checkoutSku);
      img.addEventListener('error',()=>{if(img.src!==new URL(fallback(p.checkoutSku),location.origin).href)img.src=fallback(p.checkoutSku);},{once:true});
      art.append(img);
      const body=el('div','managed-product-body');
      const category=el('span','managed-product-category',p.category||'المنتجات');
      const title=el('h3','',p.title);
      const description=el('p','',p.description||'اكتشف التفاصيل واختر ما يناسبك');
      const footer=el('div','managed-product-footer');
      const price=el('strong','managed-product-price',
         Number.isInteger(p.priceMinor)?money(p.priceMinor):'اطلب التفاصيل');
      const buy=el('a','managed-product-buy',
         Number.isInteger(p.priceMinor)?'أضف للسلة ←':'استفسر عن المنتج ←');
      buy.href=p.checkoutUrl;
      footer.append(price,buy);
      body.append(category,title,description,footer);
      card.append(art,body);root.append(card);
    }
    section.hidden=!root.children.length;
    document.dispatchEvent(new Event('blofy:showcase-ready'));
  })
  .catch(()=>{section.hidden=true;});
})();
