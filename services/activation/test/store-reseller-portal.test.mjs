import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 createStoreResellerPortal,resellerTokenFromCookie,resellerCookie,resellerPortalCsp
} from '../src/store-reseller-portal.mjs';

const TOKEN='a'.repeat(43);
const BRIDGE='b'.repeat(48);
const environment={BLOFY_STREAM_UNIFIED_BRIDGE_KEY:BRIDGE,PORT:'3000'};
const json=(res,status,body,headers)=>Object.assign(res,{status,body,headers});
const url=pathname=>({pathname});
const request=(payload={},overrides={})=>{
 const {headers:headerOverrides={},...other}=overrides;
 return {
  method:'POST',headers:{
   origin:'https://blofyplayer.com','x-blofy-reseller':'1',
   'content-type':'application/json',...headerOverrides
  },
  socket:{remoteAddress:'127.0.0.1'},payload,...other
 };
};
const incoming=(body,status=200)=>({
 ok:status>=200&&status<300,status,
 headers:{get:()=>null},
 text:async()=>JSON.stringify(body)
});
const harness=({reply,env=environment}={})=>{
 const calls=[];
 const handler=createStoreResellerPortal({
  env,json,readJson:async req=>req.payload,
  fetchImpl:async(path,options)=>{
   calls.push({path,options});
   const r=typeof reply==='function'?reply(path,options):reply;
   return r||incoming({ok:true,item:{name:'Dealer',credits:6},token:TOKEN});
  },
  now:()=>123456
 });
 return {handler,calls};
};
test('session cookies are Secure+HttpOnly and reject invalid or duplicate values',()=>{
 const header=resellerCookie(TOKEN);
 assert.match(header,/^__Host-blofy_reseller=/);
 for(const flag of ['Path=/','Secure','HttpOnly','SameSite=Strict','Max-Age=43200'])
  assert.ok(header.includes(flag),flag);
 assert.equal(resellerTokenFromCookie('__Host-blofy_reseller='+TOKEN),TOKEN);
 assert.equal(resellerTokenFromCookie('__Host-blofy_reseller=short'),null);
 assert.equal(resellerTokenFromCookie('__Host-blofy_reseller='+TOKEN+'; __Host-blofy_reseller='+TOKEN),null);
 assert.match(resellerCookie('',true),/Max-Age=0/);
});
test('non-matching paths and disallowed commands never reach private internal bridge',async()=>{
 const {handler,calls}=harness();let res={};
 assert.equal(await handler(request(),res,url('/api/v1/store/checkout')),false);
 await handler(request(),res,url('/api/v1/store/reseller/admin'));
 assert.equal(res.status,404);
 await handler(request(),res,url('/api/v1/store/reseller/issue/private'));
 assert.equal(res.status,404);
 assert.equal(calls.length,0);
});
test('same-origin custom JSON header and POST required, before network access',async()=>{
 const {handler,calls}=harness();
 const cases=[
  [request({}, {method:'GET'}),405],
  [request({}, {headers:{origin:'https://attacker.test'}}),403],
  [request({}, {headers:{origin:''}}),403],
  [request({}, {headers:{'x-blofy-reseller':'wrong'}}),403],
  [request({}, {headers:{'content-type':'text/plain'}}),415],
  [request({}, {headers:{'content-length':'4001'}}),413]
 ];
 for(const [req,status] of cases){
  const res={};await handler(req,res,url('/api/v1/store/reseller/login'));
  assert.equal(res.status,status);
 }
 assert.equal(calls.length,0);
});
test('server-side bridge token is never returned to reseller browser',async()=>{
 const {handler,calls}=harness();
 const res={};await handler(request({username:'seller',password:'examplePass123'}),res,
  url('/api/v1/store/reseller/login'));
 assert.equal(res.status,200);
 assert.equal(res.body.ok,true);
 assert.equal(res.body.token,undefined);
 assert.equal(res.body.item.credits,6);
 assert.ok(res.headers['set-cookie'].includes(TOKEN));
 assert.equal(calls.length,1);
 assert.equal(calls[0].options.headers.authorization,'Bearer '+BRIDGE);
 assert.match(calls[0].path,/^http:\/\/127\.0\.0\.1:3000\/internal\/blofy-stream\/distributor\/login$/);
 assert.deepEqual(JSON.parse(calls[0].options.body),{username:'seller',password:'examplePass123'});
});
test('no reseller action without scoped session even when browser presents owner key',async()=>{
 const {handler,calls}=harness();
 const res={};await handler(request({adminToken:BRIDGE,sessionToken:TOKEN}),res,
  url('/api/v1/store/reseller/issue'));
 assert.equal(res.status,401);assert.equal(calls.length,0);
});
test('session cookie replaces any forged browser session or admin token',async()=>{
 const {handler,calls}=harness({reply:()=>incoming({
  ok:true,stats:{today:2},token:'internal_must_not_leak',sessionToken:'private'
 })});
 const res={};
 await handler(request({sessionToken:'bad',adminToken:'bad',authorization:'bearer nope',
   offset:0},{headers:{cookie:'__Host-blofy_reseller='+TOKEN}}),res,
   url('/api/v1/store/reseller/analytics'));
 assert.equal(res.status,200);assert.equal(res.body.stats.today,2);
 assert.equal(JSON.stringify(res.body).includes('internal_must_not_leak'),false);
 assert.deepEqual(JSON.parse(calls[0].options.body),{offset:0,sessionToken:TOKEN});
 assert.ok(!JSON.stringify(calls[0].options.body).includes(BRIDGE));
});
test('upstream auth expiry expires local cookie; other internal errors are sanitized',async()=>{
 const {handler}=harness({reply:()=>incoming({ok:false,code:'internal_owner_db_config'},401)});
 const res={};await handler(request({}, {headers:{cookie:'__Host-blofy_reseller='+TOKEN}}),res,
  url('/api/v1/store/reseller/me'));
 assert.equal(res.status,401);
 assert.equal(res.body.error,'reseller_request_failed');
 assert.match(res.headers['set-cookie'],/Max-Age=0/);
});
test('safe logout revokes server-side session and browser cookie',async()=>{
 const {handler,calls}=harness({reply:()=>incoming({ok:true})});
 const res={};await handler(request({}, {headers:{cookie:'__Host-blofy_reseller='+TOKEN}}),res,
  url('/api/v1/store/reseller/logout'));
 assert.equal(res.status,200);assert.match(res.headers['set-cookie'],/Max-Age=0/);
 assert.equal(JSON.parse(calls[0].options.body).sessionToken,TOKEN);
});
test('bridge absent is fail closed rather than exposing admin paths',async()=>{
 const {handler,calls}=harness({env:{PORT:'3000'}});
 const res={};await handler(request({username:'seller',password:'examplePass123'}),res,
   url('/api/v1/store/reseller/login'));
 assert.equal(res.status,503);
 assert.equal(res.body.error,'reseller_service_not_configured');
 assert.equal(calls.length,0);
});
test('reseller interface is isolated, responsive and cannot submit directly to owner APIs',()=>{
 const html=readFileSync(new URL('../web/store-reseller.html',import.meta.url),'utf8');
 const script=readFileSync(new URL('../web/store-reseller.js',import.meta.url),'utf8');
 const css=readFileSync(new URL('../web/store-reseller.css',import.meta.url),'utf8');
 const server=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
 assert.equal(ids.length,new Set(ids).size);
 for(const id of ['login-panel','reseller-workspace','view-overview','view-issue',
  'view-codes','view-customers','view-account','issue-form','renew-form','login-form'])
  assert.ok(ids.includes(id),id+' must exist');
 assert.match(script,/credentials:'same-origin'/);
 assert.match(script,/x-blofy-reseller/);
 assert.match(script,/crypto\.randomUUID\(\)/);
 assert.match(script,/textContent/);
 assert.doesNotMatch(script,/innerHTML|localStorage|sessionStorage|\/api\/v1\/admin|\/internal\/blofy-stream/);
 assert.doesNotThrow(()=>new Function(script));
 assert.match(css,/@media\(max-width:720px\)/);
 assert.match(server,/storeResellerPortal\(req,res,requestUrl\)/);
 assert.match(server,/content-security-policy':resellerPortalCsp/);
 assert.match(resellerPortalCsp,/frame-ancestors 'none'/);
 assert.match(readFileSync(new URL('../web/store-inventory.html',import.meta.url),'utf8'),
  /href="\/distributor"/);
});
