import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { createZidPaymentHandlers, ZID_DEVICE_FIELD } from '../src/zid-payments.mjs';

test('Zid verified orders: real HTTP and isolated PostgreSQL',async t=>{
  const connection=process.env.BLOFY_TEST_DATABASE_URL;
  assert.ok(connection,'Dedicated local BLOFY_TEST_DATABASE_URL required');
  const url=new URL(connection);
  assert.ok(['127.0.0.1','localhost'].includes(url.hostname)&&url.pathname==='/blofy_zid_test');
  const setup=new pg.Pool({connectionString:connection,ssl:false});
  const schema='zid_'+crypto.randomUUID().replaceAll('-','');
  await setup.query(`CREATE SCHEMA ${schema}`);
  url.searchParams.set('options','-c search_path='+schema);
  const pool=new pg.Pool({connectionString:url.toString(),ssl:false,max:12});
  await pool.query(await readFile(new URL('../schema.sql',import.meta.url),'utf8'));
  await pool.query("INSERT INTO devices(device_id,activation_code,status) VALUES('BLOFY-AB12-CD34','test-proof','expired'),('BLOFY-BLOC-KED1','test-proof','blocked'),('BLOFY-LIFE-LONG','test-proof','active')");
  const plan={planKey:'zid-3m',productId:'9d53456e-ea98-40b0-957d-468267c7eefd',sku:'BLOFY-PLAYER-3M',name:'3 months',durationDays:90,priceMinor:1000,
    productUrl:'https://blofysat.com/products/test-fixture'};
  const env={BLOFY_ZID_ENABLED:'true',BLOFY_PAYMENT_PROVIDER:'zid',BLOFY_ZID_STORE_ID:'3202741',BLOFY_ZID_WEBHOOK_SECRET:'test-fixture-only-secret-32-characters',
    BLOFY_ZID_AUTHORIZATION:'fixture-app-auth',BLOFY_ZID_MANAGER_TOKEN:'fixture-manager-token',BLOFY_ZID_PLANS_JSON:JSON.stringify([plan])};
  const makeOrder=(id,device='BLOFY-AB12-CD34',extra={})=>({id,store_id:3202741,payment_status:'paid',currency_code:'SAR',order_total:'10',
    products:[{id:plan.productId,sku:plan.sku,order_product_id:id*10,quantity:1,total:10,custom_fields:[{label:ZID_DEVICE_FIELD,value:device}]}],...extra});
  const orders=new Map([[100,makeOrder(100)]]);
  let calls=0;
  const handler=createZidPaymentHandlers({pool,env,
    json:(res,status,body)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body))},
    readJson:async req=>{let body='';for await(const chunk of req)body+=chunk;return JSON.parse(body)},
    authorize:async(req,res,body)=>body.deviceId,
    fetchImpl:async(target,options)=>{
      calls++;assert.equal(new URL(target).origin,'https://api.zid.sa');assert.equal(options.redirect,'error');
      assert.equal(options.headers.authorization,env.BLOFY_ZID_AUTHORIZATION);
      assert.equal(options.headers['x-manager-token'],env.BLOFY_ZID_MANAGER_TOKEN);
      const order=orders.get(Number(target.match(/orders\/(\d+)\/view/)[1]));
      return {ok:true,json:async()=>({order})};
    }});
  const server=http.createServer(async(req,res)=>{
    try{if(!await handler(req,res,new URL(req.url,'http://localhost'))){res.writeHead(404);res.end()}}
    catch(error){res.writeHead(500);res.end(error.message)}
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await pool.end();await setup.query(`DROP SCHEMA ${schema} CASCADE`);await setup.end()});
  const origin='http://127.0.0.1:'+server.address().port;
  const webhook=async(orderId,auth=true,claimed={})=>{
    const response=await fetch(origin+'/api/v1/payments/zid/webhook',{method:'POST',headers:{'content-type':'application/json',authorization:auth?'Basic '+Buffer.from('blofy-zid:'+env.BLOFY_ZID_WEBHOOK_SECRET).toString('base64'):'Basic forged'},body:JSON.stringify({id:orderId,...claimed})});
    return {status:response.status,body:await response.json()};
  };
  const expiry=async()=>new Date((await pool.query("SELECT expires_at FROM devices WHERE device_id='BLOFY-AB12-CD34'")).rows[0].expires_at).getTime();
  assert.equal((await webhook(100,false)).status,401);assert.equal(calls,0);
  await t.test('eight simultaneous paid notifications grant once',async()=>{
    const responses=await Promise.all(Array.from({length:8},()=>webhook(100)));
    assert.ok(responses.every(r=>r.status===200),JSON.stringify(responses));
    assert.equal(responses.reduce((sum,r)=>sum+r.body.granted,0),1);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM zid_license_grants')).rows[0].n,1);
    assert.ok(Math.abs(await expiry()-(Date.now()+90*86400000))<10000);
  });
  await t.test('a second paid order extends remaining time; a changed replay rolls back',async()=>{
    const before=await expiry();orders.set(101,makeOrder(101));
    assert.equal((await webhook(101)).body.granted,1);assert.equal(await expiry(),before+90*86400000);
    orders.set(101,makeOrder(101,'BLOFY-LIFE-LONG'));
    assert.equal((await webhook(101)).status,409);assert.equal(await expiry(),before+90*86400000);
  });
  await t.test('pending orders and forged paid payload never grant',async()=>{
    const before=await expiry();orders.set(102,makeOrder(102,'BLOFY-AB12-CD34',{payment_status:'pending'}));
    assert.equal((await webhook(102,true,{paid:true,days:9999})).body.paid,false);assert.equal(await expiry(),before);
    orders.set(102,makeOrder(102));assert.equal((await webhook(102)).body.granted,1);
  });
  await t.test('unknown and blocked device, wrong store, quantity and free orders roll back',async()=>{
    for(const [orderId,order] of [[103,makeOrder(103,'BLOFY-NONE-NONE')],[104,makeOrder(104,'BLOFY-BLOC-KED1')],
      [105,makeOrder(105,'BLOFY-AB12-CD34',{store_id:1})],[106,makeOrder(106,'BLOFY-AB12-CD34',{order_total:0})]]){
      orders.set(orderId,order);assert.equal((await webhook(orderId)).status,409);
    }
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM zid_license_grants')).rows[0].n,3);
  });
  await t.test('lifetime entitlement stays unlimited',async()=>{
    orders.set(107,makeOrder(107,'BLOFY-LIFE-LONG'));assert.equal((await webhook(107)).body.granted,1);
    assert.equal((await pool.query("SELECT expires_at FROM devices WHERE device_id='BLOFY-LIFE-LONG'")).rows[0].expires_at,null);
  });
  await t.test('refund is flagged once and replay cannot reactivate it',async()=>{
    const before=await expiry();orders.set(100,makeOrder(100,'BLOFY-AB12-CD34',{payment_status:'refunded'}));
    assert.equal((await webhook(100)).body.needsReview,true);
    assert.equal((await webhook(100)).body.needsReview,false);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM device_audit WHERE action='payment_needs_review'")).rows[0].n,1);
    orders.set(100,makeOrder(100));assert.equal((await webhook(100)).status,409);assert.equal(await expiry(),before);
  });
});
