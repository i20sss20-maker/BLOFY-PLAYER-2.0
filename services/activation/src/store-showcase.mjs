// Administrative storefront showcase: independent of checkout pricing and code fulfillment.
// A product without a supported checkout SKU is inquiry-only. Never accept prices from this table.
import crypto from 'node:crypto';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRICE=Object.freeze({
 'stream-3m':4000,'stream-6m':7000,'stream-1y':12000,
 'xtream-3m':4000,'xtream-6m':7000,'xtream-1y':12000,
 'bundle-2y':20000
});
const SITE_ORIGINS=new Set(['https://blofyplayer.com','https://www.blofyplayer.com','https://api.blofyplayer.com']);
const error=(message,status=400)=>Object.assign(Error(message),{status});
export const STORE_SHOWCASE_SKUS=Object.freeze(Object.keys(PRICE));
export function validateStoreShowcaseProduct(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw error('store_product_invalid');
 const text=(value,max)=>typeof value==='string'?value.trim().slice(0,max+1):'';
 const title=text(input.title,110),description=text(input.description,1000),
  category=text(input.category,50)||'المنتجات',imageUrl=text(input.imageUrl,700);
 const sku=input.checkoutSku==null||input.checkoutSku===''?null:input.checkoutSku;
 if(!title||title.length>110||description.length>1000||category.length>50||
    /[<>\u0000-\u001f]/.test(title+description+category))throw error('store_product_text_invalid');
 if(sku!==null&&!Object.hasOwn(PRICE,sku))throw error('store_product_checkout_sku_invalid');
 if(typeof input.active!=='boolean')throw error('store_product_status_invalid');
 const sortOrder=input.sortOrder??0;
 if(!Number.isInteger(sortOrder)||sortOrder<0||sortOrder>9999)throw error('store_product_sort_invalid');
 if(imageUrl){
   if(!/^\/store\/media\/(?:strong8k|player)\.jpg$/.test(imageUrl)&&
      !/^\/store\/media\/(?:stream|xtream|strong8k|player|bundle)\.svg$/.test(imageUrl)){
      let parsed;
      try{parsed=new URL(imageUrl);}catch{throw error('store_product_image_invalid');}
      if(parsed.protocol!=='https:'||parsed.username||parsed.password||
         !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(parsed.hostname)||
         !['','443'].includes(parsed.port)||parsed.hash||imageUrl.length>700)
        throw error('store_product_image_invalid');
   }
 }
 const id=input.id==null||input.id===''?null:String(input.id);
 if(id&&!UUID.test(id))throw error('store_product_id_invalid');
 return {id,title,description,category,imageUrl,checkoutSku:sku,active:input.active,sortOrder};
}
export function storeShowcasePublic(row){
 const sku=row.checkout_sku||null;
 return {id:row.id,title:row.title,description:row.description,category:row.category,
  imageUrl:row.image_url||null,checkoutSku:sku,priceMinor:sku?PRICE[sku]:null,
  currency:'SAR',checkoutUrl:sku?'/store/cart?add='+encodeURIComponent(sku)+
    (sku==='bundle-2y'?'&first=app&second=app':''):'/store/contact',
  sortOrder:row.sort_order};
}
export function createStoreShowcaseHandlers({pool,json,readJson,authorizeAdmin}){
 let ready;
 async function schema(){
  if(!ready)ready=pool.query(
   'CREATE TABLE IF NOT EXISTS blofy_store_showcase_products ('+
    'id UUID PRIMARY KEY,title TEXT NOT NULL,description TEXT NOT NULL DEFAULT \'\','+
    'category TEXT NOT NULL DEFAULT \'المنتجات\',image_url TEXT NOT NULL DEFAULT \'\','+
    'checkout_sku TEXT,active BOOLEAN NOT NULL DEFAULT FALSE,'+
    'sort_order INTEGER NOT NULL DEFAULT 0,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),'+
    'updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())'
  ).catch(e=>{ready=null;throw e});
  return ready;
 }
 function sameOrigin(req,res){
  const origin=req.headers?.origin;
  if(origin&&!SITE_ORIGINS.has(origin)){json(res,403,{error:'store_product_origin_forbidden'});return false;}
  return true;
 }
 async function publicList(req,res){
  await schema();
  const data=(await pool.query(
   'SELECT id,title,description,category,image_url,checkout_sku,sort_order '+
   'FROM blofy_store_showcase_products WHERE active=TRUE ORDER BY sort_order ASC,created_at DESC LIMIT 80'
  )).rows.map(storeShowcasePublic);
  return json(res,200,{ok:true,products:data});
 }
 async function adminList(req,res){
  if(!authorizeAdmin(req,res))return;
  await schema();
  const rows=(await pool.query(
   'SELECT id,title,description,category,image_url AS "imageUrl",checkout_sku AS "checkoutSku",'+
   'active,sort_order AS "sortOrder",created_at AS "createdAt",updated_at AS "updatedAt" '+
   'FROM blofy_store_showcase_products ORDER BY sort_order ASC,created_at DESC LIMIT 100'
  )).rows;
  return json(res,200,{ok:true,products:rows,checkoutSkus:STORE_SHOWCASE_SKUS});
 }
 async function upsert(req,res){
  if(!authorizeAdmin(req,res)||!sameOrigin(req,res))return;
  const raw=await readJson(req),p=validateStoreShowcaseProduct(raw);
  await schema();
  let row;
  if(p.id){
   row=(await pool.query(
    'UPDATE blofy_store_showcase_products SET title=$2,description=$3,category=$4,image_url=$5,'+
     'checkout_sku=$6,active=$7,sort_order=$8,updated_at=NOW() WHERE id=$1 RETURNING id',
    [p.id,p.title,p.description,p.category,p.imageUrl,p.checkoutSku,p.active,p.sortOrder]
   )).rows[0];
   if(!row)return json(res,404,{error:'store_product_not_found'});
  }else{
   const count=Number((await pool.query('SELECT COUNT(*)::int AS n FROM blofy_store_showcase_products')).rows[0].n);
   if(count>=100)return json(res,409,{error:'store_product_limit'});
   row=(await pool.query(
    'INSERT INTO blofy_store_showcase_products(id,title,description,category,image_url,checkout_sku,active,sort_order) '+
     'VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
    [crypto.randomUUID(),p.title,p.description,p.category,p.imageUrl,p.checkoutSku,p.active,p.sortOrder]
   )).rows[0];
  }
  return json(res,200,{ok:true,id:row.id,active:p.active,
   checkoutAvailable:p.checkoutSku!==null});
 }
 async function archive(req,res){
  if(!authorizeAdmin(req,res)||!sameOrigin(req,res))return;
  const b=await readJson(req);
  if(!UUID.test(b?.id||''))return json(res,400,{error:'store_product_id_invalid'});
  await schema();
  const changed=await pool.query(
   'UPDATE blofy_store_showcase_products SET active=FALSE,updated_at=NOW() WHERE id=$1 RETURNING id',[b.id]);
  return json(res,changed.rowCount?200:404,changed.rowCount?{ok:true}:{error:'store_product_not_found'});
 }
 return async (req,res,url)=>{
  const path=url.pathname;
  try{
   if(req.method==='GET'&&path==='/api/v1/store/showcase'){await publicList(req,res);return true;}
   if(req.method==='GET'&&path==='/api/v1/admin/store/showcase'){await adminList(req,res);return true;}
   if(req.method==='POST'&&path==='/api/v1/admin/store/showcase/save'){await upsert(req,res);return true;}
   if(req.method==='POST'&&path==='/api/v1/admin/store/showcase/archive'){await archive(req,res);return true;}
  }catch(e){
   if(e.status){json(res,e.status,{error:e.message});return true;}
   throw e;
  }
  return false;
 };
}
