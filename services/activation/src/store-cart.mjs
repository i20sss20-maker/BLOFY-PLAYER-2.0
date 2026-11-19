// Server-owned pricing for the BLOFY guest checkout basket.
// A cart is an invoice for several subscriptions, not a list of payment attempts.
// Never accept arbitrary price, channel, duration, or total from a browser.
export const CART_SKU='cart';
export const CART_MAX_CODES=6;
export const CART_MAX_ITEMS=5;
const CATALOG=new Map([
 ['stream-1m',{name:'BLOFY STREAM — شهر',channel:'app',days:30,priceMinor:2500}],
 ['stream-3m',{name:'BLOFY STREAM — 3 أشهر',channel:'app',days:90,priceMinor:5000}],
 ['stream-6m',{name:'BLOFY STREAM — 6 أشهر',channel:'app',days:180,priceMinor:7000}],
 ['stream-1y',{name:'BLOFY STREAM — سنة',channel:'app',days:365,priceMinor:12000}],
 ['xtream-1m',{name:'Xtream BLOFY — شهر',channel:'xtream',days:30,priceMinor:2500}],
 ['xtream-3m',{name:'Xtream BLOFY — 3 أشهر',channel:'xtream',days:90,priceMinor:5000}],
 ['xtream-6m',{name:'Xtream BLOFY — 6 أشهر',channel:'xtream',days:180,priceMinor:7000}],
 ['xtream-1y',{name:'Xtream BLOFY — سنة',channel:'xtream',days:365,priceMinor:12000}]
]);
const offerPrice=20000;
export function parseStoreCart(input){
 if(!Array.isArray(input)||input.length===0||input.length>CART_MAX_ITEMS)return null;
 const items=[],seen=new Set();let codeCount=0,totalMinor=0;
 for(const raw of input){
   if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
   if(typeof raw.sku!=='string'||!Number.isSafeInteger(raw.quantity)||
      raw.quantity<1||raw.quantity>3)return null;
   const single=CATALOG.get(raw.sku);
   const isBundle=raw.sku==='bundle-2y';
   if(!single&&!isBundle)return null;
   const channels=isBundle?raw.bundleSelection:null;
   if(isBundle&&(!Array.isArray(channels)||channels.length!==2||
       channels.some(c=>c!=='app'&&c!=='xtream')))return null;
   if(!isBundle&&raw.bundleSelection!=null)return null;
   const key=isBundle?'bundle-2y:'+channels.join('+'):raw.sku;
   if(seen.has(key))return null;
   seen.add(key);
   const qty=raw.quantity;
   codeCount+=qty*(isBundle?2:1);
   totalMinor+=qty*(isBundle?offerPrice:single.priceMinor);
   if(codeCount>CART_MAX_CODES||totalMinor>100000)return null;
   items.push({
     sku:raw.sku,quantity:qty,
     ...(isBundle?{bundleSelection:[...channels]}:{}),
     name:isBundle?'عرض اشتراكين سنويين':single.name,
     unitPriceMinor:isBundle?offerPrice:single.priceMinor,
     lineTotalMinor:qty*(isBundle?offerPrice:single.priceMinor)
   });
 }
 return {items,totalMinor,codeCount,currency:'SAR'};
}
// Persist trial lines in the customer basket without allowing them into the
// paid Geidea quote, invoice or paid-code fulfillment. This is intentionally
// a different parser from parseStoreCart.
const FREE_TRIAL_SKUS=new Set(['trial-stream-1d','trial-xtream-1d']);
export function isTrialCartSku(sku){return FREE_TRIAL_SKUS.has(sku)}
export function parseSavedStoreCart(input){
 if(!Array.isArray(input))return null;
 if(input.length===0)return [];
 if(input.length>5)return null;
 let trial=null;
 const paid=[];
 for(const row of input){
  if(isTrialCartSku(row?.sku)){
   if(trial||row?.quantity!==1||row?.bundleSelection!=null)return null;
   trial={sku:row.sku,quantity:1};
  }else paid.push(row);
 }
 if(paid.length){
  const parsed=parseStoreCart(paid);
  if(!parsed||parsed.codeCount+Number(Boolean(trial))>6)return null;
  return parsed.items.map(({sku,quantity,bundleSelection})=>({
   sku,quantity,...(bundleSelection?{bundleSelection}: {})
  })).concat(trial?[trial]:[]);
 }
 return trial?[trial]:null;
}
export function cartVouchers(cart){
 const parsed=parseStoreCart(cart);
 if(!parsed)return null;
 const vouchers=[];
 for(const line of parsed.items){
   for(let i=0;i<line.quantity;i++){
     if(line.sku==='bundle-2y'){
       for(const channel of line.bundleSelection){
         vouchers.push({sku:channel==='app'?'stream-1y':'xtream-1y',
           channel,durationDays:365});
       }
     }else{
       const p=CATALOG.get(line.sku);
       vouchers.push({sku:line.sku,channel:p.channel,durationDays:p.days});
     }
   }
 }
 if(vouchers.length!==parsed.codeCount)return null;
 return vouchers;
}
export function publicOrderNumber(id,createdAt=new Date()){
 const day=new Date(createdAt).toISOString().slice(2,10).replaceAll('-','');
 return 'BF-'+day+'-'+id.slice(0,8).toUpperCase();
}
export const CART_CATALOG=Object.freeze(Object.fromEntries(CATALOG));
