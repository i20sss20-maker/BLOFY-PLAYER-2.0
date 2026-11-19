import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createStoreMetricoolOverview,storeMetricoolConfig,metricoolScheduledPosts}
 from '../src/store-metricool-overview.mjs';

const env={
 BLOFY_METRICOOL_API_ENABLED:'true',
 BLOFY_METRICOOL_API_TOKEN:'this-is-test-only-not-a-real-token-abcd',
 BLOFY_METRICOOL_USER_ID:'6325113',
 BLOFY_METRICOOL_BLOG_ID:'8052229'
};
const url={pathname:'/api/v1/admin/store/metricool'};
const json=(res,status,payload,headers)=>Object.assign(res,{status,body:payload,headers});
const authorizeAdmin=(req,res)=>req.headers?.authorization==='admin'?
 true:(res.status=401,false);
const fixedClock=()=>Date.UTC(2026,10,19,12,15);
const payload={data:[
 {id:10,token:'NEVER-SHOW',text:'تعرف على BLOFY PLAYER للمتاجر',
  publicationDate:{dateTime:'2026-11-20T18:00:00',timezone:'Asia/Riyadh'},
  providers:[{network:'tiktok',status:'PENDING'}],media:['https://static.metricool.com/media.jpg']},
 {id:11,username:'private',text:'BLOFY IPTV #IPTV',
  publicationDate:{dateTime:'2026-11-21T18:00:00',timezone:'Asia/Riyadh'},
  providers:[{network:'tiktok',status:'PENDING'},{network:'instagram',status:'PENDING'}],media:[]},
 {id:12,text:'Do not include this draft',
  publicationDate:{dateTime:'2026-11-22T18:00:00'},providers:[{network:'tiktok'}],draft:true}
]};
test('Metricool connection requires Advanced API token and explicit opt-in',()=>{
 const good=storeMetricoolConfig(env);
 assert.equal(good.configured,true);
 for(const change of [{BLOFY_METRICOOL_API_ENABLED:'false'},
  {BLOFY_METRICOOL_API_TOKEN:''},{BLOFY_METRICOOL_BLOG_ID:'not-a-number'}]){
  assert.equal(storeMetricoolConfig({...env,...change}).configured,false);
 }
});
test('post projection removes provider IDs, secrets, media URLs and flags keyword review',()=>{
 const out=metricoolScheduledPosts(payload);
 assert.equal(out.items.length,2);
 assert.equal(out.totalReturned,3);
 assert.equal(out.platformCount.tiktok,2);
 assert.equal(out.platformCount.instagram,1);
 assert.equal(out.items[0].mediaAttached,true);
 assert.equal(out.items[1].mediaAttached,false);
 assert.deepEqual(out.items[1].reviewFlags,['avoid_iptv_keyword']);
 assert.doesNotMatch(JSON.stringify(out),/NEVER-SHOW|static.metricool.com|private|username|token/);
});
test('unauthenticated clients cannot fetch schedule even if API integration is off',async()=>{
 let calls=0;
 const handler=createStoreMetricoolOverview({env,authorizeAdmin,json,clock:fixedClock,
  fetchImpl:async()=>{calls++;throw Error('unreachable');}});
 const res={};
 assert.equal(await handler({method:'GET',headers:{}},res,url),true);
 assert.equal(res.status,401);
 assert.equal(calls,0);
 assert.equal(await handler({method:'GET',headers:{}},res,{pathname:'/api/v1/store/products'}),false);
});
test('disabled API gives accurate manual mode and does not call external network',async()=>{
 let calls=0;
 const handler=createStoreMetricoolOverview({
  env:{BLOFY_METRICOOL_API_ENABLED:'false'},authorizeAdmin,json,clock:fixedClock,
  fetchImpl:async()=>{calls++;throw Error('should not fetch');}
 });
 const res={};
 await handler({method:'GET',headers:{authorization:'admin'}},res,url);
 assert.equal(res.status,200);
 assert.equal(res.body.mode,'manual');
 assert.equal(res.body.apiConfigured,false);
 assert.equal(res.body.scheduled,null);
 assert.equal(calls,0);
});
test('configured owner-only GET fetches exactly one safe official Metricool calendar',async()=>{
 const requests=[];
 const handler=createStoreMetricoolOverview({env,authorizeAdmin,json,clock:fixedClock,
  fetchImpl:async(path,options)=>{
   requests.push({path,options});
   return {ok:true,headers:{get:()=>null},text:async()=>JSON.stringify(payload)};
  }
 });
 const res={};
 await handler({method:'GET',headers:{authorization:'admin'}},res,url);
 assert.equal(res.status,200);
 assert.equal(res.body.mode,'official_api_read_only');
 assert.equal(res.body.readOnly,true);
 assert.equal(res.body.scheduled.items.length,2);
 assert.equal(res.headers['cache-control'],'no-store, private');
 assert.equal(requests.length,1);
 assert.equal(requests[0].options.method,'GET');
 assert.equal(requests[0].options.headers['x-mc-auth'],env.BLOFY_METRICOOL_API_TOKEN);
 const target=new URL(requests[0].path);
 assert.equal(target.hostname,'app.metricool.com');
 assert.equal(target.pathname,'/api/v2/scheduler/posts');
 assert.equal(target.searchParams.get('blogId'),'8052229');
 assert.equal(target.searchParams.get('userId'),'6325113');
 assert.equal(target.searchParams.get('timezone'),'Asia/Riyadh');
 assert.equal(target.searchParams.get('start'),'2026-11-19T15:15:00');
 assert.doesNotMatch(JSON.stringify(res.body),/this-is-test-only-not-a-real-token/);
});
test('provider errors and oversized payloads fail closed without leaking provider secrets',async()=>{
 let response={
  ok:false,status:403,headers:{get:()=>null},text:async()=>JSON.stringify({error:'private upstream detail'})
 };
 const handler=createStoreMetricoolOverview({env,authorizeAdmin,json,clock:fixedClock,
  fetchImpl:async()=>response
 });
 const res={};await handler({method:'GET',headers:{authorization:'admin'}},res,url);
 assert.equal(res.status,503);
 assert.equal(res.body.error,'metricool_temporarily_unavailable');
 assert.doesNotMatch(JSON.stringify(res),/private upstream detail|this-is-test-only/);
 response={ok:true,headers:{get:()=>String(500000)},text:async()=>''};
 const next={};await handler({method:'GET',headers:{authorization:'admin'}},next,url);
 assert.equal(next.status,503);
});
test('read-only endpoint refuses POST and dashboard uses safe text rendering',async()=>{
 const handler=createStoreMetricoolOverview({env,authorizeAdmin,json,clock:fixedClock,
  fetchImpl:async()=>{throw Error('should not call');}
 });
 const res={};await handler({method:'POST',headers:{authorization:'admin'}},res,url);
 assert.equal(res.status,405);
 const html=readFileSync(new URL('../web/store-inventory.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../web/store-inventory.js',import.meta.url),'utf8');
 const css=readFileSync(new URL('../web/store-inventory.css',import.meta.url),'utf8');
 const server=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
 for(const id of ['metricool-panel','metricool-title','metricool-refresh',
  'metricool-connection','metricool-counts','metricool-posts'])
  assert.ok(html.includes('id="'+id+'"'),id);
 assert.match(js,/api\/v1\/admin\/store\/metricool/);
 assert.match(js,/preview\.textContent/);
 assert.match(js,/reviewFlags\?\.includes\('avoid_iptv_keyword'\)/);
 assert.doesNotThrow(()=>new Function(js));
 assert.match(css,/@media\(max-width:420px\)/);
 assert.match(server,/createStoreMetricoolOverview/);
 assert.match(server,/storeMetricoolOverview\(req,res,requestUrl\)/);
});
