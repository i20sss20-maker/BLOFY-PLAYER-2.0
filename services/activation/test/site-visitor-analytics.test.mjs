import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cleanAnalyticsEvent,normalizeAnalyticsPage,createSiteAnalyticsHandlers} from '../src/site-analytics.mjs';

const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const session='ad41f89a-9c3f-44fb-9c71-9edaa85ec9aa';
const valid={event:'page_view',page:'/store/offers',sessionId:session,
  source:'snapchat',medium:'paid',campaign:'double_year',device:'mobile'};
function makeFixture(body=valid){
  const saved=new Set(),count={sessionStarts:0,pageViews:0,queries:0},allParameters=[];
  const db={
    async query(sql,params=[]){
      count.queries++;allParameters.push(...params);
      if(sql.startsWith('INSERT INTO blofy_site_analytics_sessions')){
        const hash=params[0]+':'+params[1];
        if(saved.has(hash))return {rows:[],rowCount:0};
        saved.add(hash);return {rows:[{session_hash:params[1]}],rowCount:1};
      }
      if(sql.startsWith('INSERT INTO blofy_site_analytics_daily')){
        if(params[6]==='session_start')count.sessionStarts++;
        if(params[6]==='page_view')count.pageViews++;
      }
      return {rows:[],rowCount:0};
    },release(){}
  };
  const pool={connect:async()=>db,query:db.query};
  const handler=createSiteAnalyticsHandlers({
    pool,keyHex:'a'.repeat(64),authorizeAdmin:(req,res)=>{
      if(req.headers?.authorization==='Bearer admin'){return true;}
      res.status=401;res.data={error:'unauthorized'};return false;
    },
    json:(res,status,data)=>{res.status=status;res.data=data;},
    readJson:async(req)=>req.body||body
  });
  return {handler,count,allParameters};
}
function req(body=valid,headers={}){
  return {method:'POST',body,headers:{
    origin:'https://www.blofyplayer.com','content-type':'application/json',
    'sec-fetch-site':'same-origin',...headers
  },socket:{remoteAddress:'192.0.2.35'}};
}
test('Visitor events accept only public storefront routes and finite event names',()=>{
 for(const route of ['/','/products/stream','/store/offers','/store/faq','/downloads'])
   assert.equal(normalizeAnalyticsPage(route),route);
 for(const route of ['/stream/activate','/admin','/api/v1/admin','/store/offers?token=secret',
   '/products/not-a-product','/account/private','https://evil.test/'])
   assert.equal(normalizeAnalyticsPage(route),null);
 assert.deepEqual(cleanAnalyticsEvent(valid),valid);
 assert.equal(cleanAnalyticsEvent({...valid,sessionId:'device-123'}),null);
 assert.equal(cleanAnalyticsEvent({...valid,event:'password_change'}),null);
 assert.equal(cleanAnalyticsEvent({...valid,page:'/admin'}),null);
 assert.equal(cleanAnalyticsEvent({...valid,source:'https://referrer/?secret=123'}).source,'direct');
 assert.equal(cleanAnalyticsEvent({...valid,campaign:'secret@example.com'}).campaign,'none');
});
test('Consent-collected events count a session once, hash its key, and never persist client IP',async()=>{
 const t=makeFixture();
 let res={};
 const url=new URL('https://blofyplayer.com/api/v1/site-analytics/collect');
 assert.equal(await t.handler(req(),res,url),true);
 assert.equal(res.status,200);
 res={};await t.handler(req(),res,url);
 assert.equal(res.status,200);
 assert.equal(t.count.pageViews,2);
 assert.equal(t.count.sessionStarts,1);
 assert.ok(t.count.queries>2);
 assert.ok(!t.allParameters.includes(session),'raw tab session ID must not be a DB parameter');
 assert.ok(!t.allParameters.includes('192.0.2.35'),'visitor IP must not be a DB parameter');
});
test('Collector blocks invalid origins and malformed events before schema work',async()=>{
 const t=makeFixture(),url=new URL('https://blofyplayer.com/api/v1/site-analytics/collect');
 for(const candidate of [
   req(valid,{origin:'https://attacker.test'}),
   req(valid,{'sec-fetch-site':'cross-site'}),
   req(valid,{'content-type':'text/plain'}),
   req({...valid,page:'/admin'}),
 ]){
   const res={};await t.handler(candidate,res,url);
   assert.ok([403,415,400].includes(res.status));
 }
 assert.equal(t.count.queries,0);
});
test('Analytics summary is private, using the same admin token as BLOFY ONE',async()=>{
 const t=makeFixture(),url=new URL('https://blofyplayer.com/api/v1/admin/site-analytics/summary?days=7');
 const res={};
 await t.handler({method:'GET',headers:{}},res,url);
 assert.equal(res.status,401);
 assert.equal(t.count.queries,0);
 const invalid={};
 await t.handler({method:'GET',headers:{authorization:'Bearer admin'}},invalid,
   new URL('https://blofyplayer.com/api/v1/admin/site-analytics/summary?days=365'));
 assert.equal(invalid.status,400);
});
test('BLOFY ONE visitors UI, first-party consent and sales attribution links are wired',()=>{
 const page=read('../web/visitor-analytics.html'),js=read('../web/visitor-analytics.js');
 const admin=read('../src/admin-session-hook.mjs'),server=read('../src/server.mjs');
 const publicJs=read('../web/public-analytics.js');
 const inventory=read('../web/store-inventory.html'),one=read('../web/blofy-one.html');
 assert.match(page,/lang="ar" dir="rtl"/);
 assert.match(page,/id="timeline"/);
 assert.match(page,/id="campaigns"/);
 assert.match(page,/id="sources"/);
 assert.match(page,/id="metrics"/);
 assert.match(page,/utm_source=snapchat/);
 assert.match(page,/id="days"/);
 assert.doesNotThrow(()=>new Function(js));
 assert.doesNotThrow(()=>new Function(publicJs));
 assert.match(publicJs,/if \(choice === 'accepted'\) startMeasurement\(\)/);
 assert.match(publicJs,/if\(!active\|\|!name\)return/);
 assert.match(publicJs,/credentials:'omit'/);
 assert.match(publicJs,/page_view/);
 assert.match(publicJs,/\/store\/offers/);
 assert.match(publicJs,/UTM|utm_campaign/);
 assert.match(admin,/\/admin\/visitors/);
 assert.match(admin,/validSession\(req\)/);
 assert.match(server,/createSiteAnalyticsHandlers/);
 assert.match(server,/await siteAnalytics\(req,res,requestUrl\)/);
 assert.match(inventory,/\/admin\/visitors/);
 assert.match(one,/\/admin\/visitors/);
 assert.doesNotMatch(publicJs,/\b(?:deviceId|activationCode|username|password)\b/);
 assert.doesNotMatch(page,/id="(?:username|deviceId|activationCode)"/);
});

test('visitors dashboard uses one leased pg client without any overlapping queries',async()=>{
 // pg@9 will reject a query started while the same client is busy.
 let active=0,maxActive=0,released=0,summaryQueries=0;
 const db={
  async query(sql,params=[]){
   active++;maxActive=Math.max(active,maxActive);
   if(active!==1)throw Error('concurrent client.query called on one pg client');
   try{
    await new Promise(resolve=>setTimeout(resolve,2));
    if(sql.includes("FROM blofy_site_analytics_daily")||
       sql.includes("FROM blofy_site_analytics_sessions")||
       sql.includes("to_regclass('public.blofy_store_geidea_orders')"))
      summaryQueries++;
    if(sql.includes("AS views,COALESCE")&&sql.includes(" AS sessions"))
      return {rows:[{views:34,sessions:10}]};
    if(sql.includes("last_seen_at >= NOW()-INTERVAL '5 minutes'"))
      return {rows:[{n:3}]};
    if(sql.includes('to_regclass('))return {rows:[{n:false}]};
    return {rows:[],rowCount:0};
   }finally{active--;}
  },
  release(){released++;}
 };
 const pool={connect:async()=>db,query:db.query};
 const handler=createSiteAnalyticsHandlers({
  pool,keyHex:'a'.repeat(64),authorizeAdmin:()=>true,
  json:(res,status,data)=>{res.status=status;res.data=data;},
  readJson:async(req)=>req.body
 });
 const reply={};
 const handled=await handler({method:'GET',headers:{}},reply,
  new URL('https://blofyplayer.com/api/v1/admin/site-analytics/summary?days=7'));
 assert.equal(handled,true);
 assert.equal(reply.status,200);
 assert.equal(reply.data.ok,true);
 assert.equal(reply.data.totals.activeLast5m,3);
 assert.equal(reply.data.totals.paidOrders,0);
 assert.equal(maxActive,1);
 assert.equal(summaryQueries,9,'all nine analytics dashboard queries still execute');
 assert.equal(released,2,'schema and dashboard each release the client');
 const implementation=read('../src/site-analytics.mjs');
 assert.doesNotMatch(implementation,/Promise\.all\(\[\s*db\.query/);
 assert.match(implementation,/for\(const run of summaries\)summaryRows\.push\(await run\(\)\)/);
});
