// Admin-editable BLOFY storefront identity/hero/contact text.
// No HTML, payment configuration, price, bank/card logos or wallet claims are editable here.
export const DEFAULT_BRANDING=Object.freeze({
  announcement:'تسوّق باقات BLOFY الرقمية بسهولة — الدفع بالبطاقات متاح',
  heroTitle:'عالم BLOFY',heroHighlight:'اشتراكك صار أسهل.',
  heroDescription:'اختر اشتراكك المناسب، أضفه للسلة، وتابع أكوادك من حسابك في مكان واحد.',
  heroImage:'/store/media/strong8k.jpg',
  aboutTitle:'BLOFY — اختيار أبسط لتجربتك الرقمية',
  aboutDescription:'في BLOFY نركز على تسهيل اختيار الاشتراكات الرقمية وربطها بحساب واحد. نوفر واجهة عربية واضحة للمقارنة بين الباقات، وإتمام الطلب عبر بوابة دفع معروفة، ومتابعة الأكواد بعد تأكيد الدفع.',
  whatsapp:'966568941484',xHandle:'i20au',
  theme:'violet'
});
const SITE_ORIGINS=new Set(['https://blofyplayer.com','https://www.blofyplayer.com','https://api.blofyplayer.com']);
const limits={announcement:150,heroTitle:55,heroHighlight:65,heroDescription:250,aboutTitle:90,aboutDescription:850};
export function validateStoreBranding(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Object.assign(Error('branding_invalid'),{status:400});
 const result={};
 for(const [key,max] of Object.entries(limits)){
   const value=raw[key];
   if(typeof value!=='string'||!value.trim()||value.length>max||
      /[<>\x00-\x1f]/.test(value))
     throw Object.assign(Error('branding_text_invalid_'+key),{status:400});
   result[key]=value.trim();
 }
 const path=raw.heroImage;
 if(typeof path!=='string'||path.length>700)throw Object.assign(Error('branding_image_invalid'),{status:400});
 const local=/^\/store\/media\/(?:strong8k|player)\.jpg$/.test(path)||
             /^\/store\/media\/(?:bundle|stream|xtream|strong8k|player)\.svg$/.test(path);
 if(!local){
   try{
     const url=new URL(path);
     if(url.protocol!=='https:'||url.username||url.password||url.hash||
        !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname)||url.port&&!['443'].includes(url.port))
       throw Error('unsafe');
   }catch{throw Object.assign(Error('branding_image_invalid'),{status:400});}
 }
 result.heroImage=path;
 if(typeof raw.whatsapp!=='string'||!/^9665\d{8}$/.test(raw.whatsapp))
   throw Object.assign(Error('branding_whatsapp_invalid'),{status:400});
 result.whatsapp=raw.whatsapp;
 if(typeof raw.xHandle!=='string'|| !/^[A-Za-z0-9_]{1,15}$/.test(raw.xHandle))
   throw Object.assign(Error('branding_social_invalid'),{status:400});
 result.xHandle=raw.xHandle;
 if(!['violet','ocean','rose'].includes(raw.theme))
   throw Object.assign(Error('branding_theme_invalid'),{status:400});
 result.theme=raw.theme;
 return result;
}
export function createStoreBrandingHandlers({pool,json,readJson,authorizeAdmin}){
 let schemaReady=null;
 async function schema(){
   if(!schemaReady)schemaReady=pool.query('CREATE TABLE IF NOT EXISTS blofy_store_branding ('+
     'id SMALLINT PRIMARY KEY CHECK(id=1),config JSONB NOT NULL,'+
     'updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())'
   ).catch(e=>{schemaReady=null;throw e;});
   return schemaReady;
 }
 async function get(){
   await schema();
   const row=(await pool.query('SELECT config FROM blofy_store_branding WHERE id=1')).rows[0];
   try{return validateStoreBranding(row?.config||DEFAULT_BRANDING);}
   catch{return {...DEFAULT_BRANDING};}
 }
 return async function handler(req,res,url){
   const path=url.pathname;
   if(path!=='/api/v1/store/branding'&&path!=='/api/v1/admin/store/branding')return false;
   try{
     if(path==='/api/v1/store/branding'&&req.method==='GET'){
       return json(res,200,{ok:true,branding:await get()}),true;
     }
     if(path==='/api/v1/admin/store/branding'){
       if(!authorizeAdmin(req,res))return true;
       if(req.method==='GET')return json(res,200,{ok:true,branding:await get()}),true;
       if(req.method==='POST'){
         if(req.headers?.origin&&!SITE_ORIGINS.has(req.headers.origin)){
           json(res,403,{error:'branding_origin_forbidden'});return true;
         }
         const config=validateStoreBranding(await readJson(req));
         await schema();
         await pool.query('INSERT INTO blofy_store_branding(id,config) VALUES(1,$1::jsonb) '+
           'ON CONFLICT(id) DO UPDATE SET config=EXCLUDED.config,updated_at=NOW()',
           [JSON.stringify(config)]);
         json(res,200,{ok:true,branding:config});return true;
       }
     }
     json(res,405,{error:'method_not_allowed'});return true;
   }catch(e){
     if(e.status){json(res,e.status,{error:e.message});return true;}
     throw e;
   }
 };
}
