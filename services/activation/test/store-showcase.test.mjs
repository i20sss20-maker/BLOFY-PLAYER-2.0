import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateStoreShowcaseProduct,storeShowcasePublic,
  STORE_SHOWCASE_SKUS,createStoreShowcaseHandlers} from '../src/store-showcase.mjs';
const item={
 title:'باقة BLOFY الجديدة',description:'اشتراك سنوي',
 category:'الباقات',imageUrl:'/store/media/player.jpg',
 checkoutSku:'stream-1y',sortOrder:2,active:true
};
test('showcase accepts safe product metadata but never a client-selected price',()=>{
 const a=validateStoreShowcaseProduct({...item,priceMinor:1});
 assert.equal(a.title,item.title);assert.equal(a.checkoutSku,'stream-1y');
 assert.equal(Object.hasOwn(a,'priceMinor'),false);
 assert.equal(a.active,true);
 assert.ok(STORE_SHOWCASE_SKUS.includes('bundle-2y'));
});
test('showcase safely rejects unsupported paid products, broken images and malformed input',()=>{
 for(const value of [
  {...item,checkoutSku:'secret-product'},
  {...item,title:'<script>alert(1)</script>'},
  {...item,category:'a'.repeat(51)},
  {...item,sortOrder:-1},
  {...item,sortOrder:999999},
  {...item,active:'true'},
  {...item,imageUrl:'http://example.com/test.jpg'},
  {...item,imageUrl:'javascript:alert(1)'},
  {...item,imageUrl:'https://user:pass@example.com/a.jpg'}
 ])assert.throws(()=>validateStoreShowcaseProduct(value));
 assert.equal(validateStoreShowcaseProduct({...item,checkoutSku:null}).checkoutSku,null);
});
test('trusted pricing and checkout route come only from whitelist',()=>{
 const row={id:'b26c6d48-4365-49f8-b7d6-88d3d38a0cb2',
  title:item.title,description:item.description,category:'الباقات',
  image_url:item.imageUrl,checkout_sku:'stream-1y',sort_order:0};
 const sell=storeShowcasePublic(row);
 assert.equal(sell.priceMinor,12000);
 assert.equal(sell.checkoutUrl,'/store/cart?add=stream-1y');
 const inquire=storeShowcasePublic({...row,checkout_sku:null});
 assert.equal(inquire.priceMinor,null);
 assert.equal(inquire.checkoutUrl,'/store/contact');
 const bundle=storeShowcasePublic({...row,checkout_sku:'bundle-2y'});
 assert.equal(bundle.priceMinor,20000);
 assert.match(bundle.checkoutUrl,/first=app&second=app/);
});
test('admin routes reject unauthenticated requests before database access',async()=>{
 const calls=[];
 const handler=createStoreShowcaseHandlers({
  pool:{query:async(...args)=>{calls.push(args);throw Error('DB must not be read');}},
  json:(res,status,body)=>{res.status=status;res.body=body;},
  readJson:async()=>item,
  authorizeAdmin:(req,res)=>{res.status=401;return false;}
 });
 for(const path of ['/api/v1/admin/store/showcase',
  '/api/v1/admin/store/showcase/save','/api/v1/admin/store/showcase/archive']){
  const res={};
  await handler({method:path.endsWith('/showcase')?'GET':'POST',headers:{}},
    res,{pathname:path});
  assert.equal(res.status,401);
 }
 assert.equal(calls.length,0);
});
test('public script/admin UI/server route are present and no arbitrary price entry is exposed',()=>{
 const text=path=>readFileSync(new URL(path,import.meta.url),'utf8');
 const store=text('../web/store.html');
 const admin=text('../web/store-inventory.html');
 const server=text('../src/server.mjs');
 const publicScript=text('../web/store-showcase.js');
 assert.match(store,/id="shop-managed-products"/);
 assert.match(store,/\/store\/showcase\.js/);
 assert.match(admin,/id="showcase-form"/);
 assert.match(admin,/id="showcase-sku"/);
 assert.match(server,/createStoreShowcaseHandlers/);
 assert.match(server,/serveStoreShowcaseScript/);
 assert.match(publicScript,/api\/v1\/store\/showcase/);
 assert.doesNotMatch(admin,/id="showcase-price"/);
 assert.doesNotThrow(()=>new Function(publicScript));
});
