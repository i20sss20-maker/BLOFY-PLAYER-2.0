import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DEFAULT_BRANDING,validateStoreBranding,createStoreBrandingHandlers} from '../src/store-branding.mjs';

const text=path=>readFileSync(new URL(path,import.meta.url),'utf8');
test('brand defaults stay informative and show only configured payment methods',()=>{
 assert.equal(DEFAULT_BRANDING.whatsapp,'966568941484');
 assert.equal(DEFAULT_BRANDING.theme,'violet');
 const homepage=text('../web/store.html');
 assert.match(homepage,/id="market-search"/);
 assert.match(homepage,/id="blofy-banners"/);
 assert.match(homepage,/id="market-cart-count"/);
 assert.match(homepage,/id="market-footer-phone"/);
 assert.match(homepage,/id="about-blofy"/);
 assert.match(homepage,/id="shop-managed-products"/);
 assert.match(homepage,/id="bundle-first"/);
 assert.match(homepage,/id="bundle-second"/);
 assert.match(homepage,/data-cart-add="stream"/);
 assert.match(homepage,/data-cart-add="xtream"/);
 assert.match(homepage,/id="checkout"/)===false;
 assert.match(homepage,/id="coupon-preview"/);
 assert.match(homepage,/store\/market\.css/);
 assert.match(homepage,/store\/market\.js/);
 assert.match(homepage,/VISA/);
 assert.match(homepage,/مدى/);
 assert.doesNotMatch(homepage,/Google Pay|Apple Pay|شريك رسمي/);
});
test('branding validation rejects script injection, unsafe image, invalid contacts and palette',()=>{
 assert.deepEqual(validateStoreBranding({...DEFAULT_BRANDING}),DEFAULT_BRANDING);
 const invalid=[
  {announcement:'<script>'},{heroTitle:' '},{aboutTitle:'x'.repeat(91)},
  {heroImage:'http://insecure.example/test.jpg'},{heroImage:'javascript:alert(1)'},
  {heroImage:'https://name:secret@example.com/a.jpg'},
  {whatsapp:'foo'},{whatsapp:'0551234567'},{xHandle:'@invalid'},
  {theme:'anything'}
 ];
 for(const entry of invalid)assert.throws(()=>validateStoreBranding({...DEFAULT_BRANDING,...entry}));
});
test('signed admin required before any branding read/write',async()=>{
 let n=0;const unauthorized=createStoreBrandingHandlers({
  pool:{query:async()=>{n++;throw Error('db should not be touched');}},
  json:(res,status,body)=>{res.status=status;res.body=body;},
  readJson:async()=>({...DEFAULT_BRANDING}),
  authorizeAdmin:(req,res)=>{res.status=401;return false;}
 });
 for(const method of ['GET','POST']){
  const res={};await unauthorized({method,headers:{}},res,{pathname:'/api/v1/admin/store/branding'});
  assert.equal(res.status,401);
 }
 assert.equal(n,0);
});
test('branding GET supplies defaults, and authenticated POST saves parameterized data',async()=>{
 const queries=[];let stored=null;
 const pool={query:async(sql,params)=>{
  queries.push({sql,params});
  if(sql.includes('SELECT config FROM'))return {rows:stored?[{config:stored}]:[]};
  if(sql.includes('INSERT INTO blofy_store_branding')){stored=JSON.parse(params[0]);return {rows:[],rowCount:1};}
  return {rows:[],rowCount:0};
 }};
 const handler=createStoreBrandingHandlers({
  pool,json:(res,status,body)=>{res.status=status;res.body=body;},
  readJson:async()=>({...DEFAULT_BRANDING,heroTitle:'تسوّق الآن'}),
  authorizeAdmin:()=>true
 });
 const pub={};await handler({method:'GET',headers:{}},pub,{pathname:'/api/v1/store/branding'});
 assert.equal(pub.status,200);
 assert.equal(pub.body.branding.heroTitle,DEFAULT_BRANDING.heroTitle);
 const block={};await handler({method:'POST',headers:{origin:'https://attacker.example'}},block,{pathname:'/api/v1/admin/store/branding'});
 assert.equal(block.status,403);
 const changed={};await handler({method:'POST',headers:{origin:'https://blofyplayer.com'}},changed,{pathname:'/api/v1/admin/store/branding'});
 assert.equal(changed.status,200);
 assert.equal(changed.body.branding.heroTitle,'تسوّق الآن');
 assert.ok(queries.some(q=>q.sql.includes('INSERT INTO blofy_store_branding')&&q.params[0].includes('تسوّق الآن')));
});
test('market assets and editor fields bind without broken selectors',()=>{
 const homepage=text('../web/store.html');
 const js=text('../web/store-market.js');
 const css=text('../web/store-market.css');
 const admin=text('../web/store-inventory.html');
 const adminJs=text('../web/store-inventory.js');
 const server=text('../src/server.mjs');
 for(const name of ['market-search-form','market-search','market-cart-count','market-footer-phone',
   'market-header-contact','market-search-feedback','hero-title','market-announcement-text']){
   assert.match(homepage,new RegExp('id="'+name+'"'));
 }
 for(const name of ['announcement','heroTitle','heroHighlight','heroDescription','heroImage',
   'aboutTitle','aboutDescription','whatsapp','xHandle','theme']){
   assert.match(admin,new RegExp('id="branding-'+name+'"'));
 }
 assert.match(adminJs,/api\/v1\/admin\/store\/branding/);
 assert.match(server,/storeBranding\(req,res,requestUrl\)/);
 assert.match(server,/serveStoreAssetFile/);
 assert.match(css,/\.market-footer/);
 assert.match(css,/\.market-categories-grid/);
 assert.match(css,/\.market-service-grid/);
 assert.doesNotThrow(()=>new Function(js));
});
