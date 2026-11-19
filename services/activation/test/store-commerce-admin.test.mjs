import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DEFAULT_MERCHANDISING,validateMerchandising,createStoreMerchandisingHandlers}
  from '../src/store-merchandising.mjs';
import {commercialPeriod,buildStoreCommercialReport,createStoreCommercialInsightsHandlers}
  from '../src/store-commercial-insights.mjs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
test('merchant banner validation enforces safe images, routes and active state',()=>{
 const valid=validateMerchandising(DEFAULT_MERCHANDISING);
 assert.deepEqual(valid,DEFAULT_MERCHANDISING);
 for(const invalid of [
  {slides:[DEFAULT_MERCHANDISING.slides[0]]},
  {slides:DEFAULT_MERCHANDISING.slides.map((s,i)=>i===0?{...s,title:'<script>'}:s)},
  {slides:DEFAULT_MERCHANDISING.slides.map((s,i)=>i===0?{...s,href:'https://bad.example/'}:s)},
  {slides:DEFAULT_MERCHANDISING.slides.map((s,i)=>i===0?{...s,imageUrl:'javascript:alert(1)'}:s)},
  {slides:DEFAULT_MERCHANDISING.slides.map((s,i)=>i===0?{...s,imageUrl:'http://bad.example/x.png'}:s)},
  {slides:DEFAULT_MERCHANDISING.slides.map((s,i)=>i===0?{...s,active:'false'}:s)},
  {sections:{...DEFAULT_MERCHANDISING.sections,about:'false'}},
 ]){
  assert.throws(()=>validateMerchandising({...DEFAULT_MERCHANDISING,...invalid}));
 }
});
test('merchant can disable promo slides and sections without disabling products/checkout',()=>{
 const edit=validateMerchandising({
  slides:DEFAULT_MERCHANDISING.slides.map((x,i)=>i===1?{...x,active:false}:x),
  sections:{...DEFAULT_MERCHANDISING.sections,about:false,featured:false}
 });
 assert.equal(edit.slides[1].active,false);
 assert.equal(edit.sections.about,false);
 assert.equal(edit.sections.featured,false);
 const home=read('../web/store.html');
 assert.match(home,/id="products"/);
 assert.match(home,/id="bundle-add-cart"/);
 assert.match(home,/data-market-promo="0"/);
 assert.match(home,/data-market-promo="1"/);
 assert.match(home,/data-promo-link/);
 const market=read('../web/store-market.js');
 assert.match(market,/api\/v1\/store\/merchandising/);
 assert.match(market,/blofy:merchandising-ready/);
 const carousel=read('../web/store-offers.js');
 assert.match(carousel,/dataset\.published!=='false'/);
 assert.match(carousel,/available\.includes\(i\)/);
 assert.match(read('../web/store-showcase.js'),/dataset\.merchDisabled/);
});
test('admin authorization is required before touching merchandising data',async()=>{
 let touched=0;
 const handler=createStoreMerchandisingHandlers({
  pool:{query:async()=>{touched++;return {rows:[]};}},
  json:(res,status,body)=>{res.status=status;res.data=body;},
  readJson:async()=>DEFAULT_MERCHANDISING,
  authorizeAdmin:(req,res)=>{res.status=401;return false;}
 });
 for(const method of ['GET','POST']){
  const res={};
  assert.equal(await handler({method,headers:{}},res,{pathname:'/api/v1/admin/store/merchandising'}),true);
  assert.equal(res.status,401);
 }
 assert.equal(touched,0);
});
test('merchant settings persist and old defaults remain safe',async()=>{
 let config;
 const query=async(sql,params)=>{
  if(sql.startsWith('SELECT config FROM'))return {rows:config?[{config}]:[]};
  if(sql.includes('INSERT INTO blofy_store_merchandising'))config=JSON.parse(params[0]);
  return {rows:[],rowCount:1};
 };
 const handler=createStoreMerchandisingHandlers({
  pool:{query},json:(res,status,body)=>{res.status=status;res.body=body;},
  readJson:async()=>({...DEFAULT_MERCHANDISING,sections:{...DEFAULT_MERCHANDISING.sections,offers:false}}),
  authorizeAdmin:()=>true
 });
 const pub={};
 await handler({method:'GET',headers:{}},pub,{pathname:'/api/v1/store/merchandising'});
 assert.equal(pub.status,200);assert.equal(pub.body.merchandising.sections.offers,true);
 const denied={};
 await handler({method:'POST',headers:{origin:'https://third-party.test'}},denied,{pathname:'/api/v1/admin/store/merchandising'});
 assert.equal(denied.status,403);
 const saved={};
 await handler({method:'POST',headers:{origin:'https://blofyplayer.com'}},saved,{pathname:'/api/v1/admin/store/merchandising'});
 assert.equal(saved.status,200);assert.equal(saved.body.merchandising.sections.offers,false);
 const again={};
 await handler({method:'GET',headers:{}},again,{pathname:'/api/v1/store/merchandising'});
 assert.equal(again.body.merchandising.sections.offers,false);
});
test('real commercial reports include only paid amounts as revenue',()=>{
 assert.deepEqual([7,30,90].map(commercialPeriod),[7,30,90]);
 assert.throws(()=>commercialPeriod('999'));
 assert.throws(()=>commercialPeriod('30;DROP TABLE'));
 const data=buildStoreCommercialReport([
  {status:'paid',orders:3,amount_minor:30000},
  {status:'pending',orders:2,amount_minor:40000},
  {status:'failed',orders:1,amount_minor:20000}
 ],[{day:'2026-11-19',paid_orders:3,created_orders:6,revenue_minor:30000}],
 [{sku:'cart',orders:2,revenue_minor:25000}],30);
 assert.equal(data.metrics.createdOrders,6);
 assert.equal(data.metrics.paidOrders,3);
 assert.equal(data.metrics.pendingOrders,2);
 assert.equal(data.metrics.revenueMinor,30000);
 assert.equal(data.metrics.averageOrderMinor,10000);
 assert.equal(data.metrics.completionPercent,50);
 assert.equal(data.productGroups[0].sku,'cart');
});
test('insights use read-only parameterized SQL and protected admin path',async()=>{
 const recorded=[];
 const handler=createStoreCommercialInsightsHandlers({
  pool:{query:async(sql,args)=>{recorded.push({sql,args});return {rows:[]};}},
  json:(res,status,body)=>{res.status=status;res.body=body;},
  authorizeAdmin:(req,res)=>req.headers?.authorization==='test'?true:(res.status=401,false)
 });
 const denied={};
 await handler({method:'GET',headers:{}},denied,{pathname:'/api/v1/admin/store/insights',searchParams:new URLSearchParams('days=7')});
 assert.equal(denied.status,401);assert.equal(recorded.length,0);
 const res={};
 await handler({method:'GET',headers:{authorization:'test'}},res,
  {pathname:'/api/v1/admin/store/insights',searchParams:new URLSearchParams('days=7')});
 assert.equal(res.status,200);assert.equal(res.body.periodDays,7);
 assert.equal(recorded.length,3);
 for(const x of recorded){assert.deepEqual(x.args,[7]);assert.match(x.sql,/\$1::int/);assert.doesNotMatch(x.sql,/UPDATE|DELETE|INSERT/);}
 const invalid={};
 await handler({method:'GET',headers:{authorization:'test'}},invalid,
  {pathname:'/api/v1/admin/store/insights',searchParams:new URLSearchParams('days=500')});
 assert.equal(invalid.status,400);
});
test('sales dashboard and banners bind to correct admin UI fields',()=>{
 const html=read('../web/store-inventory.html'),js=read('../web/store-inventory.js'),server=read('../src/server.mjs');
 for(const name of ['commercial-period','commercial-metrics','commercial-trend','commercial-products',
   'commercial-export','merchandising-form','merch-save','merch-status','merch-slide-0-title',
   'merch-slide-1-imageUrl','merch-section-categories','merch-section-about']){
   assert.ok(html.includes('id="'+name+'"'),name+' missing');
 }
 assert.match(js,/api\/v1\/admin\/store\/insights/);
 assert.match(js,/api\/v1\/admin\/store\/merchandising/);
 assert.match(server,/storeCommercialInsights\(req,res,requestUrl\)/);
 assert.match(server,/storeMerchandising\(req,res,requestUrl\)/);
 assert.doesNotThrow(()=>new Function(js));
});
