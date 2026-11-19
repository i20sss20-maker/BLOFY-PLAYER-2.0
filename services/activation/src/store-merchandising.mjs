// Storefront marketing controls are kept apart from checkout prices, inventory and code delivery.
const defaultSlides=[
 {title:'اشتراكان سنويان',highlight:'بسعر 200 ريال',description:'كودان مستقلان لمدة سنة. وفّر 40 ريالًا مقارنةً بالسعر المعتاد للاشتراكين.',imageUrl:'/store/media/bundle.svg',href:'/store/offers',cta:'اطلب العرض',active:true},
 {title:'باقتك جاهزة',highlight:'بخطوات بسيطة',description:'تعرّف على BLOFY STREAM وBLOFY PLAYER، وقارن بين طرق الاشتراك والتفعيل.',imageUrl:'/store/media/player.jpg',href:'/#products',cta:'استعرض الباقات',active:true}
];
export const DEFAULT_MERCHANDISING=Object.freeze({
 slides:defaultSlides,
 sections:{categories:true,offers:true,featured:true,about:true,questions:true}
});
const validLinks=new Set(['/#products','/#categories','/store/offers','/store/trial','/store/cart','/store/contact','/products/stream','/products/xtream']);
const allowedOrigins=new Set(['https://blofyplayer.com','https://www.blofyplayer.com','https://api.blofyplayer.com']);
const invalid=(field)=>Object.assign(Error('store_merchandising_invalid_'+field),{status:400});
function copy(x){return JSON.parse(JSON.stringify(x));}
function imageURL(input){
 if(typeof input!=='string'||input.length>700)return false;
 if(/^\/store\/media\/(?:strong8k|player)\.jpg$/.test(input)||
    /^\/store\/media\/(?:bundle|stream|xtream|strong8k|player)\.svg$/.test(input))return true;
 try{
  const x=new URL(input);
  return x.protocol==='https:'&&!x.username&&!x.password&&!x.hash&&
    /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(x.hostname)&&(!x.port||x.port==='443');
 }catch{return false;}
}
function plainText(value,max,field){
 if(typeof value!=='string'||!value.trim()||value.length>max||/[<>\x00-\x1f]/.test(value))throw invalid(field);
 return value.trim();
}
export function validateMerchandising(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw invalid('payload');
 if(!Array.isArray(raw.slides)||raw.slides.length!==2)throw invalid('slides');
 const slides=raw.slides.map((p,i)=>{
  if(!p||typeof p!=='object'||Array.isArray(p))throw invalid('slide_'+i);
  const out={
   title:plainText(p.title,55,'title'),highlight:plainText(p.highlight,55,'highlight'),
   description:plainText(p.description,240,'description'),
   imageUrl:p.imageUrl,
   href:p.href,
   cta:plainText(p.cta,40,'cta'),
   active:p.active
  };
  if(!imageURL(out.imageUrl))throw invalid('image');
  if(!validLinks.has(out.href))throw invalid('href');
  if(typeof out.active!=='boolean')throw invalid('active');
  return out;
 });
 if(!raw.sections||typeof raw.sections!=='object'||Array.isArray(raw.sections))throw invalid('sections');
 const sections={};
 for(const key of Object.keys(DEFAULT_MERCHANDISING.sections)){
  if(typeof raw.sections[key]!=='boolean')throw invalid('section_'+key);
  sections[key]=raw.sections[key];
 }
 return {slides,sections};
}
export function createStoreMerchandisingHandlers({pool,json,readJson,authorizeAdmin}){
 let initialized;
 async function schema(){
  if(!initialized)initialized=pool.query('CREATE TABLE IF NOT EXISTS blofy_store_merchandising ('+
    'id SMALLINT PRIMARY KEY CHECK(id=1), config JSONB NOT NULL,'+
    'updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())').catch(e=>{initialized=null;throw e});
  await initialized;
 }
 async function read(){
  await schema();
  const row=(await pool.query('SELECT config FROM blofy_store_merchandising WHERE id=1')).rows[0];
  try{return validateMerchandising(row?.config||DEFAULT_MERCHANDISING);}
  catch{return copy(DEFAULT_MERCHANDISING);}
 }
 return async(req,res,url)=>{
  const path=url.pathname;
  if(path!=='/api/v1/store/merchandising'&&path!=='/api/v1/admin/store/merchandising')return false;
  try{
   if(path==='/api/v1/store/merchandising'&&req.method==='GET'){
    json(res,200,{ok:true,merchandising:await read()});return true;
   }
   if(!authorizeAdmin(req,res))return true;
   if(path==='/api/v1/admin/store/merchandising'&&req.method==='GET'){
    json(res,200,{ok:true,merchandising:await read()});return true;
   }
   if(path==='/api/v1/admin/store/merchandising'&&req.method==='POST'){
    if(req.headers?.origin&&!allowedOrigins.has(req.headers.origin)){
     json(res,403,{error:'store_merchandising_origin_forbidden'});return true;
    }
    const config=validateMerchandising(await readJson(req));
    await schema();
    await pool.query('INSERT INTO blofy_store_merchandising(id,config) VALUES(1,$1::jsonb) '+
      'ON CONFLICT(id) DO UPDATE SET config=EXCLUDED.config, updated_at=NOW()',
     [JSON.stringify(config)]);
    json(res,200,{ok:true,merchandising:config});return true;
   }
   json(res,405,{error:'method_not_allowed'});return true;
  }catch(e){
   if(e.status){json(res,e.status,{error:e.message});return true;}
   throw e;
  }
 };
}
