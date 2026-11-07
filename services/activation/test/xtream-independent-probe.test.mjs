import test from 'node:test';
import assert from 'node:assert/strict';
import {compareXtreamFromIndependentRailway} from '../src/xtream-independent-probe.mjs';
const origin='https://blofy-stream-api-production.up.railway.app';
const token='t'.repeat(42);
const env={BLOFY_STREAM_RELAY_ORIGIN:origin,BLOFY_STREAM_RELAY_SHARED_TOKEN:token};
test('independent Railway source test is pinned to exact HTTPS host and a shared bearer',async()=>{
 const invalid={...env,BLOFY_STREAM_RELAY_ORIGIN:'https://other.up.railway.app'};
 const r=await compareXtreamFromIndependentRailway('http://source.example/player_api.php?username=u&password=p',{env:invalid});
 assert.equal(r.ok,false);
 assert.equal(r.code,'bridge_unconfigured');
});
test('only sanitized result returns; source and passwords never logged',async()=>{
 let invoked=false;
 const url='http://licensed.example/player_api.php?username=realuser&password=secret';
 const out=await compareXtreamFromIndependentRailway(url,{env,fetchImpl:async(resource,options)=>{
   invoked=true;
   assert.equal(resource,origin+'/internal/xtream-account-diagnostic');
   assert.equal(options.method,'POST');
   assert.equal(options.redirect,'manual');
   assert.equal(options.headers.authorization,'Bearer '+token);
   assert.equal(JSON.parse(options.body).accountUrl,url);
   return new Response(JSON.stringify({ok:true,code:'account_verified',stage:'http',
     httpStatus:200,hidden:'do_not_leak',providerUrl:'http://source.example/foo'}),
     {status:200,headers:{'content-type':'application/json'}});
 }});
 assert.equal(invoked,true);
 assert.equal(out.ok,true);
 assert.equal(out.code,'account_verified');
 assert.equal(out.mediaVerified,false);
 assert.doesNotMatch(JSON.stringify(out),/secret|realuser|source.example|hidden|providerUrl/);
});
test('provider account rejected is not converted into a network failure',async()=>{
 const r=await compareXtreamFromIndependentRailway('http://foo.example/player_api.php?username=a&password=b',{
   env,fetchImpl:async()=>new Response(JSON.stringify({
     ok:false,code:'account_rejected',stage:'http',httpStatus:200
   }),{status:200})});
 assert.equal(r.ok,false);
 assert.equal(r.code,'account_rejected');
});
test('HTTP error never follows redirect or confuses probe 401 with customer auth',async()=>{
 const r=await compareXtreamFromIndependentRailway('http://foo.example/player_api.php?username=a&password=b',{
 env,fetchImpl:async()=>new Response(null,{status:302,headers:{location:'https://unknown.example/capture'}})});
 assert.equal(r.ok,false);
 assert.equal(r.code,'probe_service_denied');
 assert.equal(r.status,302);
});
test('source account comparison code is dormant unless explicitly enabled',async()=>{
 const fs=await import('node:fs/promises');
 const hook=await fs.readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 assert.match(hook,/BLOFY_XTREAM_INDEPENDENT_PROBE_ON_BOOT==='1'/);
 assert.match(hook,/compareXtreamFromIndependentRailway\(target\)/);
 assert.match(hook,/credentialsLogged:false/);
});
